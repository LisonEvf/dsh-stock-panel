/**
 * 轻量 SWR(stale-while-revalidate) 数据缓存层。
 *
 * 目标：让面板「秒开」且不阻塞 —— 首次进入先用缓存里的旧数据立即渲染
 * （懒加载，UI 不空转），同时后台静默重新验证；新数据一到就替换。
 *
 * 核心不变式（对应需求「避免以假乱真」）：
 *   - 命中新鲜缓存（age < ttl）→ 直接返回，零网络，UI 零等待；
 *   - 命中过期缓存（age ≥ ttl）→ 立即返回旧数据（首页秒开），后台重新验证；
 *   - **后台重新验证失败 → 丢弃该键的缓存数据（把旧数据下线，绝不把过期数据
 *     当实时行情继续展示）→ 立即自动重试一次；仍失败才进入 error 态**，
 *     由消费方显示「加载失败 + 重试」而非假数据；
 *   - 无缓存 → 前台拉取；失败则进入 error 态（不缓存假数据）。
 *
 * 并发保护：同一 key 的多个请求合并（in-flight 去重），避免并发轮询互相打架。
 * 订阅机制：通过 useSyncExternalStore 让组件在缓存后台更新/下线时自动重渲。
 *
 * 说明：本缓存只作用于显式传入 useSwr 的取数器（组件级取数），不改动
 * stock-data / market 等原始取数函数的下游语义，因此像 event-stream 这类
 * 每轮都必须拿新数据的轮询器不会受影响。
 */
import { useCallback, useEffect, useReducer, useRef, useSyncExternalStore } from 'react'

export type SwrStatus = 'idle' | 'loading' | 'success' | 'error'

export interface SwrEntry<T> {
  /** 已缓存的数据；error 态为 undefined（已下线，避免以假乱真）。 */
  data: T | undefined
  /** 最近一次成功取数的时间戳。 */
  at: number
  status: SwrStatus
  error?: string
}

export interface SwrOptions {
  /** 新鲜窗口(ms)：此内命中直接返回，不发网络。默认 0（每次都验证）。 */
  ttl?: number
  /** 后台轮询间隔(ms)：>0 时定时强制重新验证（适用于行情自动刷新）。 */
  refreshInterval?: number
  /** error 后自动重试的最短冷却(ms)，防止源持续不可达时刷爆网络。默认 5s。 */
  retryCooldown?: number
  /** 为 false 时仅读缓存不主动取数。默认 true。 */
  enabled?: boolean
}

const store = new Map<string, SwrEntry<unknown>>()
const listeners = new Map<string, Set<() => void>>()
const inflight = new Map<string, Promise<void>>()

// 空快照（稳定引用；不同 key 未命中共用，避免 useSyncExternalStore 误判变化）。
const EMPTY: SwrEntry<unknown> = { data: undefined, at: 0, status: 'idle' }

function getEntry<T>(key: string): SwrEntry<T> | undefined {
  return store.get(key) as SwrEntry<T> | undefined
}

function emit(key: string): void {
  const set = listeners.get(key)
  if (!set) return
  for (const fn of Array.from(set)) {
    try { fn() } catch { /* 忽略订阅回调异常 */ }
  }
}

function setEntry<T>(key: string, entry: SwrEntry<T>): void {
  store.set(key, entry as SwrEntry<unknown>)
  emit(key)
}

function subscribe(key: string, cb: () => void): () => void {
  let set = listeners.get(key)
  if (!set) {
    set = new Set()
    listeners.set(key, set)
  }
  set.add(cb)
  return () => {
    set.delete(cb)
    if (set.size === 0) listeners.delete(key)
  }
}

function errMsg(err: unknown): string {
  if (err instanceof Error) return err.message
  if (typeof err === 'string') return err
  return '加载失败'
}

/** 读取当前快照（供 useSyncExternalStore.getSnapshot 用；未命中返回稳定空对象）。 */
function getSnapshot<T>(key: string): SwrEntry<T> {
  return (store.get(key) as SwrEntry<T> | undefined) ?? (EMPTY as SwrEntry<T>)
}

/**
 * 前台取数：无缓存时的默认路径。成功缓存；失败进入 error 态且不缓存数据。
 * 并发去重：同 key 只有一个 in-flight；后到者复用同一 Promise。
 */
function loadNow<T>(key: string, fetcher: () => Promise<T>): Promise<void> {
  const existing = inflight.get(key)
  if (existing) return existing

  const p = (async () => {
    const cur = getEntry<T>(key)
    setEntry<T>(key, { data: cur?.data, at: cur?.at ?? Date.now(), status: 'loading' })
    try {
      const data = await fetcher()
      setEntry<T>(key, { data, at: Date.now(), status: 'success' })
    } catch (err) {
      setEntry<T>(key, { data: undefined, at: Date.now(), status: 'error', error: errMsg(err) })
    }
  })()

  inflight.set(key, p)
  void p.finally(() => inflight.delete(key))
  return p
}

/**
 * 后台重新验证（stale-while-revalidate 的核心，也是「失败去懒加载数据并重试」的实现）。
 *
 * 失败处理：
 *   1. 立即把该 key 的缓存数据下线（status='error'，data=undefined），通知订阅方，
 *      这样 UI 会停止显示过期数据（避免以假乱真）；
 *   2. 自动重试一次（前台拉取）；重试成功 → 恢复成功态并更新数据；
 *   3. 重试仍失败 → 保持 error 态，由消费方展示「加载失败 + 重试」。
 */
function revalidate<T>(key: string, fetcher: () => Promise<T>): Promise<void> {
  const existing = inflight.get(key)
  if (existing) return existing

  const p = (async () => {
    try {
      const data = await fetcher()
      setEntry<T>(key, { data, at: Date.now(), status: 'success' })
      return
    } catch (err) {
      // 1) 下线过期数据（避免以假乱真）
      const cur = getEntry<T>(key)
      const lastAt = cur?.at ?? Date.now()
      setEntry<T>(key, { data: undefined, at: lastAt, status: 'error', error: errMsg(err) })
      // 2) 自动重试一次
      try {
        const data = await fetcher()
        setEntry<T>(key, { data, at: Date.now(), status: 'success' })
      } catch (err2) {
        setEntry<T>(key, { data: undefined, at: Date.now(), status: 'error', error: errMsg(err2) })
      }
    }
  })()

  inflight.set(key, p)
  void p.finally(() => inflight.delete(key))
  return p
}

/**
 * 核心调度：fresh 直接跳过；stale 后台验证；无缓存/error 态前台取数
 * （error 态受 retryCooldown 限流，避免源持续不可达时刷爆网络）。
 */
function ensure<T>(key: string, fetcher: () => Promise<T>, opts: SwrOptions): void {
  const cur = getEntry<T>(key)
  const now = Date.now()
  const ttl = opts.ttl ?? 0
  const retryCooldown = opts.retryCooldown ?? 5_000

  // 新鲜命中：直接返回缓存，不发网络。
  if (cur?.status === 'success' && now - cur.at < ttl) return

  // 有数据但过期：后台验证（保留旧数据渲染，新数据到达即替换）。
  if (cur?.status === 'success') {
    void revalidate<T>(key, fetcher)
    return
  }

  // error 态：冷却期内不自动重试（让用户手动点刷新），否则重试。
  if (cur?.status === 'error') {
    if (now - cur.at >= retryCooldown) void loadNow<T>(key, fetcher)
    return
  }

  // idle / loading：前台取数。
  void loadNow<T>(key, fetcher)
}

/**
 * React 数据获取 Hook（SWR 语义）。
 *
 *   const { data, error, status, refresh } = useSwr('mkt:overview', () => loadOverview(), { ttl: 5000, refreshInterval: 20000 })
 *
 * 特点：
 *   - 首次挂载/换 key：若有缓存 → 立即返回旧数据（懒加载秒开）；否则取数；
 *   - 缓存过期 → 后台验证，成功替换数据、失败下线并自动重试一次；
 *   - 组件卸载/换 key 不销毁缓存，切回 Tab 秒开。
 */
export function useSwr<T>(
  key: string,
  fetcher: () => Promise<T>,
  options: SwrOptions = {},
): {
  data: T | undefined
  error: string | undefined
  status: SwrStatus
  /** 是否正在（本地）首次取数（无缓存时）。 */
  isLoading: boolean
  /** 最近一次成功取数的时间戳（用于展示刷新时间）。 */
  updatedAt: number | undefined
  /** 手动强制刷新（绕过 ttl）。 */
  refresh: () => void
} {
  const fetcherRef = useRef(fetcher)
  fetcherRef.current = fetcher
  const optsRef = useRef(options)
  optsRef.current = options
  const forceRef = useRef(false)
  const [nonce, bump] = useReducer((v: number) => v + 1, 0)
  // 是否启用（如折叠面板展开时才取数）；作为 effect 依赖，使 enabled 翻转能重新调度。
  const enabled = options.enabled !== false

  const entry = useSyncExternalStore(
    (cb) => subscribe(key, cb),
    () => getSnapshot<T>(key),
  )

  // key 变化 / 手动 refresh / enabled 翻转 → 触发一次调度。forceRef 供 refresh 绕过 ttl。
  useEffect(() => {
    if (!enabled) return
    const force = forceRef.current
    forceRef.current = false
    ensure<T>(key, fetcherRef.current, force ? { ...optsRef.current, ttl: 0 } : optsRef.current)
  }, [key, nonce, enabled])

  // 定时轮询（refreshInterval）：每次强制验证，确保拿到最新行情。
  useEffect(() => {
    if (!enabled) return
    const interval = optsRef.current.refreshInterval ?? 0
    if (interval <= 0) return
    const timer = window.setInterval(() => {
      ensure<T>(key, fetcherRef.current, { ...optsRef.current, ttl: 0 })
    }, interval)
    return () => window.clearInterval(timer)
  }, [key, enabled])

  const refresh = useCallback(() => {
    forceRef.current = true
    bump()
  }, [])

  return {
    data: entry.data,
    error: entry.error,
    status: entry.status ?? 'idle',
    isLoading: (entry.status ?? 'idle') === 'loading',
    updatedAt: entry.status === 'success' && entry.at > 0 ? entry.at : undefined,
    refresh,
  }
}

/**
 * 生成缓存 key 的语义化辅助函数（与查询语义一一对应，避免字符串手拼错）。
 */
export const swrKey = {
  marketOverview: () => 'swr:mkt:overview',
  indices: () => 'swr:mkt:indices',
  allA: () => 'swr:mkt:allA',
  unusualAll: () => 'swr:mkt:unusual',
  kline: (symbol: string, days: number) => `swr:kline:${symbol}:${days}`,
  quote: (market: string, code: string) => `swr:quote:${market}:${code}`,
  tick: (market: string, code: string, date?: string) => `swr:tick:${market}:${code}:${date ?? ''}`,
  transactions: (market: string, code: string) => `swr:tx:${market}:${code}`,
  /** 筹码逐笔（L1）：同标的当日全量逐笔，供 chips 聚合（与逐笔面板的 60 条不同 key）。 */
  chipsTicks: (market: string, code: string, date: string) => `swr:tx-full:${market}:${code}:${date ?? ''}`,
  capitalFlow: (market: string, code: string) => `swr:flow:${market}:${code}`,
  auction: (market: string, code: string) => `swr:auction:${market}:${code}`,
  goodsQuote: (market: string, code: string) => `swr:goods-q:${market}:${code}`,
  goodsKline: (market: string, code: string, period: string, count: number) =>
    `swr:goods-k:${market}:${code}:${period}:${count}`,
}

/** 清空整个缓存（调试/切换数据源用）。 */
export function clearSwrCache(): void {
  store.clear()
  for (const set of listeners.values()) {
    for (const fn of Array.from(set)) {
      try { fn() } catch { /* ignore */ }
    }
  }
}

/** 主动下线某个 key 的缓存数据（下次 useSwr 会重新取数）。 */
export function evictSwr(key: string): void {
  if (!store.has(key)) return
  store.delete(key)
  emit(key)
}

/** 手动标记某 key 为失败态（等价于「取数失败，数据下线」）。 */
export function failSwr(key: string, message: string): void {
  setEntry(key, { data: undefined, at: Date.now(), status: 'error', error: message })
}
