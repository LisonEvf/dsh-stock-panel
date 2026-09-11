/**
 * src/lib/host-state.ts — host 侧持久化的浏览器端接入（A1）。
 *
 * ## 模型
 *
 * **host 域是权威，localStorage 是镜像 + 离线兜底**（决策见 `docs/ROADMAP.md` A1）：
 *
 * ```
 * 启动   GET  /api/stock-panel/state ──▶ 域里的记录 → 写进 localStorage（镜像）
 *        └─ 域里为空而本地有数据 → **首迁上传**
 *        └─ 通知各 store 重新载入（onHostHydrated）
 * 读取   各 store 仍是同步内存读（localStorage 载入）——UI 代码零改动
 * 写入   各 store 照旧写 localStorage，然后调 syncTable() 增量推给 host
 *        （只推新增/变化，删掉的记录发 delete —— 事件流 500 条也不会每次全量重发）
 * 降级   host 不可用（路由 503 / 无该子系统 / 网络错）→ 只写 localStorage，
 *        状态与原因由 hostStateInfo() 暴露，界面据此标注「本地存储」
 * ```
 *
 * ## 为什么是增量
 *
 * `events` 表最多 500 条、每 30s 有一次捕获；全量重推等于每轮 500 个请求。
 * 所以按表维护 `key → JSON` 指纹，只发差异。
 */
import { STATE_ROUTE } from './endpoints'
import { STATE_TABLES, keyOfRecord, type StateTableMeta } from './state-tables'

/** 持久化可用性。 */
export type HostStateAvailability = 'unknown' | 'available' | 'unavailable'

/** 对外的持久化状态（UI/诊断读它）。 */
export interface HostStateInfo {
  availability: HostStateAvailability
  /** 不可用原因（如实展示，不静默）。 */
  reason: string
  /** host 侧各表记录数（可用时有值）。 */
  counts?: Record<string, number>
  /** 是否已完成过一次「从 localStorage 首迁」。 */
  migrated?: boolean
  /** 同步失败、等待重试的表数（0 = 全部落地）。 */
  pending?: number
  /** host 报告的构建 id（便于排查「前端/后端不同版本」）。 */
  buildId?: string
}

let info: HostStateInfo = { availability: 'unknown', reason: '' }
const infoListeners = new Set<() => void>()
const hydratedListeners = new Set<() => void>()
/** 表 → （记录键 → 已同步的 JSON 指纹）。 */
const synced = new Map<string, Map<string, string>>()
/** 每张表一条写链，避免批量写入交错。 */
const chains = new Map<string, Promise<void>>()
/** 上一次同步失败、尚未成功的表（用于重试与诊断）。 */
const failedTables = new Set<string>()

/** 是否已完成「本地 → host」的首迁（只有上传**全部成功**才置位）。 */
let migrationDone = false

/** 当前持久化状态。 */
export function hostStateInfo(): HostStateInfo {
  return info
}

/** 订阅持久化状态变化（React hook 用）。 */
export function subscribeHostState(fn: () => void): () => void {
  infoListeners.add(fn)
  return () => {
    infoListeners.delete(fn)
  }
}

/**
 * 订阅「host 数据已落到 localStorage」事件。
 *
 * 各 store 在模块加载时已经从 localStorage 读过一次，所以 hydrate 之后必须重载：
 * 它们注册一个回调，回调里重新 load + notify（UI 不动，只是数据换成 host 权威版本）。
 */
export function onHostHydrated(fn: () => void): () => void {
  hydratedListeners.add(fn)
  return () => {
    hydratedListeners.delete(fn)
  }
}

function setInfo(next: Partial<HostStateInfo>): void {
  info = { ...info, ...next }
  for (const fn of infoListeners) {
    try {
      fn()
    } catch {
      /* ignore */
    }
  }
}

/** 带超时的 fetch（10s；宿主不可达时不要挂住启动）。 */
async function requestState(init: RequestInit): Promise<Response> {
  const ac = new AbortController()
  const timer = window.setTimeout(() => ac.abort(), 10_000)
  try {
    return await fetch(STATE_ROUTE, { ...init, signal: ac.signal })
  } finally {
    window.clearTimeout(timer)
  }
}

/** POST 一个 body（失败只告警，绝不影响本地功能）。 */
async function postState(body: unknown): Promise<{ ok: boolean; error?: string }> {
  try {
    const res = await requestState({
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    const json = (await res.json()) as { ok?: boolean; error?: string }
    if (!res.ok || json.ok !== true) {
      return { ok: false, error: json.error ?? `HTTP ${res.status}` }
    }
    return { ok: true }
  } catch (err) {
    return { ok: false, error: (err as Error)?.message ?? String(err) }
  }
}

/** 把一张表的 localStorage 值规范化成「记录键 → 记录」。 */
function toRecords(meta: StateTableMeta, value: unknown): Map<string, Record<string, unknown>> {
  const out = new Map<string, Record<string, unknown>>()
  if (meta.shape === 'keyed') {
    if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
      for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
        if (v !== null && typeof v === 'object' && !Array.isArray(v)) out.set(k, v as Record<string, unknown>)
      }
    }
    return out
  }
  if (!Array.isArray(value)) return out
  for (const item of value) {
    const key = keyOfRecord(meta.table, item)
    if (key === null) continue
    out.set(key, item as Record<string, unknown>)
  }
  return out
}

/** 记录集合 → 该表在 localStorage 里的形状。 */
function fromRecords(meta: StateTableMeta, records: Record<string, Record<string, unknown>>): unknown {
  if (meta.shape === 'keyed') return records
  return Object.values(records)
}

/** 读 localStorage 里某表当前的值（解析失败视为空）。 */
function readLocal(meta: StateTableMeta): unknown {
  try {
    const raw = localStorage.getItem(meta.storageKey)
    if (raw === null) return null
    return JSON.parse(raw)
  } catch {
    return null
  }
}

/** 写 localStorage 镜像（配额/隐私模式下静默失败）。 */
function writeLocal(meta: StateTableMeta, value: unknown): void {
  try {
    localStorage.setItem(meta.storageKey, JSON.stringify(value))
  } catch {
    /* ignore */
  }
}

/**
 * 增量同步一张表到 host。
 *
 * @param table 表名（必须是 `STATE_TABLES` 里的表）
 * @param value 该表在 localStorage 里的完整值（数组或键值对象）
 * @returns 是否**真正落盘成功**（失败时已回滚指纹，下次同步会重带这批差异；
 *          调用方通常忽略返回值 —— store 的 `persist()` 是同步上下文）
 */
export function syncTable(table: string, value: unknown): Promise<boolean> {
  if (info.availability !== 'available') return Promise.resolve(false)
  const meta = STATE_TABLES.find((t) => t.table === table)
  if (meta === undefined) return Promise.resolve(false)
  const next = toRecords(meta, value)
  const prev = synced.get(table) ?? new Map<string, string>()

  const put: Record<string, Record<string, unknown>> = {}
  const nextFingerprints = new Map<string, string>()
  for (const [key, rec] of next) {
    const fp = JSON.stringify(rec)
    nextFingerprints.set(key, fp)
    if (prev.get(key) !== fp) put[key] = rec
  }
  const deletes: string[] = []
  for (const key of prev.keys()) if (!next.has(key)) deletes.push(key)

  synced.set(table, nextFingerprints)
  if (Object.keys(put).length === 0 && deletes.length === 0) return Promise.resolve(true)

  const body: Record<string, unknown> = { table }
  if (Object.keys(put).length > 0) body.records = put
  if (deletes.length > 0) body.deletes = deletes

  const prevChain = chains.get(table) ?? Promise.resolve()
  const chain = prevChain.then(async (): Promise<boolean> => {
    const r = await postState(body)
    if (r.ok) {
      failedTables.delete(table)
      return true
    }
    // 同步失败：把指纹回滚，下一轮重试时仍会带上这批差异。
    const back = synced.get(table)
    if (back !== undefined) for (const k of Object.keys(put)) back.delete(k)
    failedTables.add(table)
    setInfo({ reason: `同步失败（${table}）：${r.error ?? '未知'}`, availability: 'available', pending: failedTables.size })
    return false
  })
  chains.set(
    table,
    chain.then(() => undefined),
  )
  return chain
}

/**
 * 等待所有在途写入落地。
 *
 * 首迁必须用它：**先确认全部上传成功，再写「已首迁」标记** ——
 * 否则会出现真机实测过的那种矛盾状态：标记写了、数据一条没有
 * （页面在途刷新会取消 fetch，标记却落了地）。
 */
export async function flushState(): Promise<{ ok: boolean; failed: string[] }> {
  await Promise.allSettled([...chains.values()])
  return { ok: failedTables.size === 0, failed: [...failedTables] }
}

/** 标记「本地数据已首迁到 host」（仅在上传确认成功后调用）。 */
export async function markLocalDataMigrated(): Promise<boolean> {
  if (info.availability !== 'available') return false
  const r = await postState({ migrated: true })
  if (r.ok) {
    migrationDone = true
    setInfo({ migrated: true })
    return true
  }
  setInfo({ reason: `首迁标记写入失败：${r.error ?? '未知'}（下次打开会重试）` })
  return false
}

/** 失败重试：可见时（用户回到页面）与一次延时之后各试一次。 */
function scheduleSyncRetry(): void {
  const retry = (): void => {
    if (failedTables.size === 0) return
    for (const table of [...failedTables]) {
      const local = readLocalFor(table)
      if (local !== null) void syncTable(table, local)
      else failedTables.delete(table)
    }
  }
  if (typeof document !== 'undefined') {
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) retry()
    })
  }
  window.setTimeout(retry, 5000)
}

/** 按表名读回 localStorage 镜像（重试用）。 */
function readLocalFor(table: string): unknown {
  const meta = STATE_TABLES.find((t) => t.table === table)
  return meta === undefined ? null : readLocal(meta)
}

/**
 * 启动时接入 host 持久化。
 *
 * 由 `client.ts` 的 apply 调用一次（面板渲染前），幂等。
 */
export async function initHostState(): Promise<HostStateAvailability> {
  let res: Response
  try {
    res = await requestState({ method: 'GET', headers: { Accept: 'application/json' }, cache: 'no-store' })
  } catch (err) {
    setInfo({ availability: 'unavailable', reason: `持久化不可用：${(err as Error)?.message ?? String(err)}` })
    return info.availability
  }
  try {
    const body = (await res.json()) as {
      ok?: boolean
      available?: boolean
      reason?: string
      counts?: Record<string, number>
      migratedFromLocalStorage?: boolean
      build?: { buildId?: string }
      tables?: Record<string, Record<string, Record<string, unknown>>>
    }
    if (!res.ok || body.ok !== true || body.available !== true) {
      setInfo({
        availability: 'unavailable',
        reason: body.reason ?? `持久化不可用（HTTP ${res.status}）`,
      })
      return info.availability
    }

    let uploaded = false
    /** 需要上传的表（首迁）。 */
    const toUpload: string[] = []
    for (const meta of STATE_TABLES) {
      const remote = body.tables?.[meta.table] ?? {}
      if (Object.keys(remote).length > 0) {
        // 域是权威：覆盖本地镜像，并记下指纹（避免刚 hydrate 就把同样的数据回推）
        writeLocal(meta, fromRecords(meta, remote))
        const fps = new Map<string, string>()
        for (const [k, v] of Object.entries(remote)) fps.set(k, JSON.stringify(v))
        synced.set(meta.table, fps)
      } else {
        // 域里空：本地有数据就首迁（一次性）
        const local = readLocal(meta)
        if (local !== null) {
          const recs = toRecords(meta, local)
          if (recs.size > 0) {
            uploaded = true
            toUpload.push(meta.table)
            void syncTable(meta.table, local)
          }
        }
      }
    }
    setInfo({
      availability: 'available',
      reason: '',
      counts: body.counts ?? {},
      migrated: body.migratedFromLocalStorage === true || migrationDone,
      pending: failedTables.size,
      ...(typeof body.build?.buildId === 'string' ? { buildId: body.build.buildId } : {}),
    })

    // 首迁：**先等上传确认成功，再写「已首迁」标记**（顺序反了就会出现
    // 真机实测过的矛盾状态：标记写了、数据一条没有 —— 刷新会取消在途 fetch）。
    if (uploaded) {
      const { ok, failed } = await flushState()
      if (ok) {
        await markLocalDataMigrated()
      } else {
        setInfo({
          reason: `首迁上传未完成（${failed.join('、')}）：数据仍在本地镜像，回到页面或 5 秒后自动重试`,
          pending: failed.length,
        })
        scheduleSyncRetry()
      }
    }

    // 通知各 store 用 host 权威数据重载（同步回调，UI 立即刷新）
    for (const fn of hydratedListeners) {
      try {
        fn()
      } catch {
        /* ignore */
      }
    }
    return info.availability
  } catch (err) {
    setInfo({ availability: 'unavailable', reason: `持久化响应解析失败：${(err as Error)?.message ?? String(err)}` })
    return info.availability
  }
}
