/**
 * src/panel/use-ai.ts — 「一键问模型」的运行器（视图与状态带共用同一份状态）。
 *
 * 为什么是一个 hook：状态带的「问模型」按钮与右栏的 AI 卡是**同一个动作的两个入口**，
 * 必须共享 loading / 结果 / 错误，否则点状态带按钮时右栏毫无反应。
 * 由 AppShell 实例化一次，向下传给 StatusStrip（触发）与 AiPanel（渲染）。
 *
 * 上下文组装原则：**模型看到的就是你屏幕上看到的**——用与主图/状态带完全相同的
 * useSwr 缓存 key 取数（不产生额外请求），再经 lib/ai.ts 的压缩函数瘦身。
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { useSwr, swrKey } from '@/lib/cache'
import { fetchCapitalFlow, fetchKlineRows, fetchQuote, type QuoteRow } from '@/lib/stock-data'
import { fetchAllA, fetchIndexQuotes } from '@/lib/market'
import { computeBreadth } from '@/lib/market'
import {
  aiAvailability,
  compactBreadth,
  compactKline,
  compactQuote,
  removeVerdict,
  runStockVerdict,
  saveVerdict,
  todayKey,
  useVerdict,
  verdictOf,
  type AiAvailability,
  type AiVerdictRecord,
} from '@/lib/ai'
import type { AiCallMeta, StockVerdict } from '@/lib/ai-contract'
import { phaseFromDate } from '@/lib/session-clock'

/** 可用性类型从 lib/ai 透出（右栏 AI 卡从本模块 import）。 */
export type { AiAvailability }

/** 运行器状态。 */
export interface AiRunState {
  status: 'idle' | 'running' | 'ok' | 'error'
  error?: string
  /** 本次（或存档）的结构化结论。 */
  verdict?: StockVerdict
  /** 模型原文（结构化失败时视图兜底显示）。 */
  raw?: string
  reasoning?: string
  meta?: AiCallMeta
}

export interface AiRunner {
  state: AiRunState
  availability: AiAvailability | null
  /** 已存档的当日结论（跨刷新/跨标签保留）。 */
  record: AiVerdictRecord | null
  /** 一键研判（可选追加要求）。 */
  run: (ask?: string) => Promise<void>
  /** 正在运行。 */
  busy: boolean
  /** 清除当前标的的存档结论。 */
  clear: () => void
  /** 最近一次运行用的模型路由与耗时（脚注展示）。 */
  lastMeta: AiCallMeta | null
}

export function useAiVerdict(input: {
  symbol: string | null
  name: string
  market: 'SH' | 'SZ' | 'BJ' | null
  code: string | null
  days: number
}): AiRunner {
  const { symbol, name, market, code, days } = input
  const [state, setState] = useState<AiRunState>({ status: 'idle' })
  const [availability, setAvailability] = useState<AiAvailability | null>(null)
  const [lastMeta, setLastMeta] = useState<AiCallMeta | null>(null)
  const abortRef = useRef<AbortController | null>(null)
  const record = useVerdict(symbol)

  // 可用性探测（一次即可；宿主挂载 LLM 服务与否在进程内不会变）
  useEffect(() => {
    let alive = true
    void aiAvailability().then((a) => {
      if (alive) setAvailability(a)
    })
    return () => {
      alive = false
    }
  }, [])

  // 与主图/状态带共享缓存的数据（同 key 不重复请求）
  const quote = useSwr(
    market !== null && code !== null ? swrKey.quote(market, code) : 'swr:quote:none',
    () => (market !== null && code !== null ? fetchQuote(market, code) : Promise.resolve(null)),
    { ttl: 6000, refreshInterval: 12000, enabled: market !== null && code !== null },
  )
  const kline = useSwr(
    symbol !== null ? swrKey.kline(symbol, days) : 'swr:kline:none',
    () => (market !== null && code !== null ? fetchKlineRows(market, code, 'DAILY', days) : Promise.resolve([])),
    { ttl: 60000, enabled: symbol !== null && market !== null && code !== null },
  )
  const flow = useSwr(
    market !== null && code !== null ? swrKey.capitalFlow(market, code) : 'swr:flow:none',
    () => (market !== null && code !== null ? fetchCapitalFlow(market, code) : Promise.resolve(null)),
    { ttl: 60000, enabled: market !== null && code !== null },
  )
  const allA = useSwr(swrKey.allA(), () => fetchAllA(), { ttl: 15000, refreshInterval: 30000 })
  const indices = useSwr(swrKey.indices(), () => fetchIndexQuotes(), { ttl: 8000, refreshInterval: 15000 })

  /** 组装喂给模型的上下文（压缩后）。 */
  const buildContext = useCallback(() => {
    const q: QuoteRow | null | undefined = quote.data
    const rows = kline.data ?? []
    const mapped = rows.map((r) => ({
      date: r.datetime,
      open: r.open,
      high: r.high,
      low: r.low,
      close: r.close,
      volume: r.vol ?? r.volume,
    }))
    const breadth = allA.data ? computeBreadth(allA.data) : null
    return {
      symbol,
      name,
      asOf: new Date().toISOString().slice(0, 16).replace('T', ' '),
      session: phaseFromDate(new Date()),
      quote: compactQuote(q as unknown as Record<string, unknown> | null | undefined),
      dailyKline: compactKline(mapped as unknown as Array<Record<string, unknown>>, 90),
      capitalFlow: flow.data ?? null,
      market: {
        breadth: breadth ? compactBreadth(breadth as unknown as Record<string, unknown>) : null,
        indices: (indices.data ?? [])
          .filter((i) => i.ok)
          .slice(0, 5)
          .map((i) => ({ name: i.name, pct: Math.round(i.pct * 100) / 100 })),
      },
    }
  }, [quote.data, kline.data, flow.data, allA.data, indices.data, symbol, name])

  const run = useCallback(
    async (ask?: string) => {
      if (symbol === null) return
      if (abortRef.current) abortRef.current.abort()
      const ac = new AbortController()
      abortRef.current = ac
      setState({ status: 'running' })
      // signal 必须透传到 fetch：否则切换标的/重跑时旧请求仍跑满 90s（白烧额度）。
      const res = await runStockVerdict(buildContext(), ask, ac.signal)
      if (ac.signal.aborted) return
      if (!res.ok) {
        setState({ status: 'error', error: res.error ?? '未知错误' })
        return
      }
      const verdict = verdictOf(res)
      const meta = res.meta
      const reasoning = (res as { reasoning?: string }).reasoning
      setLastMeta(meta ?? null)
      setState({
        status: 'ok',
        ...(verdict !== null ? { verdict } : {}),
        raw: res.text ?? '',
        ...(reasoning !== undefined && reasoning !== '' ? { reasoning } : {}),
        ...(meta !== undefined ? { meta } : {}),
      })
      // 存档：即使结构化失败也把原文留下（复盘时能看到当时模型说了什么）
      if (verdict !== null) {
        saveVerdict({
          symbol,
          name,
          day: todayKey(),
          verdict,
          raw: res.text ?? '',
          provider: meta?.provider ?? '',
          model: meta?.model ?? '',
          ms: meta?.ms ?? 0,
          createdAt: Date.now(),
        })
      }
    },
    [symbol, name, buildContext],
  )

  const clear = useCallback(() => {
    setState({ status: 'idle' })
    if (symbol !== null) removeVerdict(symbol, todayKey())
  }, [symbol])

  // 切换标的时清掉上一次的运行结果（存档仍在，由 record 提供）；
  // cleanup 同时取消在途请求：切换标的/卸载后不再有 90s 的 AI 流空跑烧额度（B6）。
  useEffect(() => {
    setState({ status: 'idle' })
    return () => {
      if (abortRef.current) abortRef.current.abort()
    }
  }, [symbol])

  return {
    state,
    availability,
    record,
    run,
    busy: state.status === 'running',
    clear,
    lastMeta,
  }
}
