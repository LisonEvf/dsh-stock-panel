/**
 * 指数页（M5）：指数切换条 + 实时摘要 + 日K/分时图。
 *
 * 数据：quote（指数列表实时价）+ IndexChart（kline DAILY / tick_chart）。
 * 每 15s 刷新指数报价。
 */

import { useEffect, useMemo, useState } from 'react'
import { RefreshCw } from 'lucide-react'
import { fetchIndexQuotes, pctText } from '@/lib/market'
import { IndexChart } from '@/components/IndexChart'
import { useSwr, swrKey } from '@/lib/cache'
import { fmtBigNum } from '@/lib/format'
import type { MarketTag } from '@/lib/symbol'

const UP = '#c74040'
const DOWN = '#2d9b65'

function pctColor(v: number): string {
  if (v > 0) return UP
  if (v < 0) return DOWN
  return '#94a3b8'
}

interface Props {
  initial?: { market: MarketTag; code: string; name: string } | null
  /** 是否轮询（合并页按"滚动到可视区才轮询"传 false/true）。 */
  enabled?: boolean
  /** 统一节拍递增值（合并页传递；变化一次 → 强制验证一次）。 */
  tick?: number
  /** 自轮询间隔覆盖（0 = 交给外部节拍器）。 */
  pollMs?: number
  /** 嵌入聚合面板：交出整页布局与页头（块外壳负责标题/时间/刷新）。 */
  embedded?: boolean
  /** 数据时间戳回传（聚合页显示本块刷新时间）。 */
  onUpdatedAt?: (at: number) => void
}

export function IndicesPage({ initial, enabled = true, tick = 0, pollMs = 15_000, embedded = false, onUpdatedAt }: Props) {
  const [selected, setSelected] = useState<{ market: MarketTag; code: string; name: string } | null>(
    initial ?? null,
  )

  // SWR 缓存：命中旧数据立即渲染（秒开），每 15s 后台验证；失败下线重试，避免以假乱真。
  const quotesSwr = useSwr(swrKey.indices(), () => fetchIndexQuotes(), {
    ttl: 6_000,
    refreshInterval: pollMs,
    enabled,
  })

  // 外部指定标的（总览里的指数芯片点击）→ 跟随切换
  useEffect(() => {
    if (initial) setSelected(initial)
  }, [initial])

  // 统一节拍
  const refreshQuotes = quotesSwr.refresh
  useEffect(() => {
    if (tick === 0 || !enabled) return
    refreshQuotes()
  }, [tick, enabled, refreshQuotes])
  // useMemo 收口：`?? []` 每帧都是新数组，直接进依赖会让下游 effect/memo 反复重跑（lint 抓到）。
  const quotes = useMemo(() => quotesSwr.data ?? [], [quotesSwr.data])
  const error = quotesSwr.error
  const refreshing = quotesSwr.isLoading
  const settled = quotesSwr.status !== 'loading' && quotesSwr.status !== 'idle'

  // 默认选中第一个可用指数
  useEffect(() => {
    if (!selected && quotes.length > 0) {
      setSelected({ market: quotes[0].market, code: quotes[0].code, name: quotes[0].name })
    }
  }, [quotes, selected])

  const active = useMemo(() => {
    if (!selected) return null
    return quotes.find((q) => q.market === selected.market && q.code === selected.code) ?? null
  }, [quotes, selected])

  const summary = useMemo(() => {
    if (!active) return null
    const cells: { label: string; value: string; color?: string }[] = [
      { label: '今开', value: active.open.toFixed(2) },
      { label: '最高', value: active.high.toFixed(2), color: UP },
      { label: '最低', value: active.low.toFixed(2), color: DOWN },
      { label: '昨收', value: active.pre_close.toFixed(2) },
      { label: '成交额', value: fmtBigNum(active.amount) },
      { label: '量比', value: active.vol_ratio ? active.vol_ratio.toFixed(2) : '—' },
    ]
    return cells
  }, [active])

  // 聚合页需要在块标题上显示本块刷新时间
  useEffect(() => {
    if (quotesSwr.updatedAt !== undefined && onUpdatedAt) onUpdatedAt(quotesSwr.updatedAt)
  }, [quotesSwr.updatedAt, onUpdatedAt])

  return (
    <div className={embedded ? 'flex h-full min-h-0 flex-col overflow-hidden' : 'flex h-full flex-col overflow-hidden'}>
      <div className={embedded ? 'flex h-full min-h-0 flex-col overflow-y-auto px-2 pb-2' : 'flex h-full min-h-0 flex-col overflow-y-auto px-2.5 pb-3'}>
        {/* 吸顶头部（嵌入聚合面板时由块外壳提供） */}
        {!embedded && (
          <div className="ds-sticky-head -mx-2.5 mb-1.5 flex shrink-0 items-center justify-between border-b border-slate-100 px-2.5 pb-1.5 pt-2">
            <span className="text-[13px] font-semibold text-slate-800">指数</span>
            <button
              onClick={() => quotesSwr.refresh()}
              className="flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] text-slate-400 hover:bg-slate-100 hover:text-slate-600"
            >
              <RefreshCw className={`h-3 w-3 ${refreshing ? 'animate-spin' : ''}`} />
            </button>
          </div>
        )}

        {error && <div className="mb-1.5 rounded bg-red-50 px-2 py-1 text-[11px] text-red-500">{error}</div>}

        {/* 指数切换条 */}
        {quotes.length > 0 && (
          <div className="mb-1.5 flex gap-1 overflow-x-auto pb-1">
            {quotes.map((q) => {
              const isActive = selected?.market === q.market && selected?.code === q.code
              return (
                <button
                  key={`${q.market}${q.code}`}
                  onClick={() => setSelected({ market: q.market, code: q.code, name: q.name })}
                  className={`shrink-0 rounded-md border px-2 py-1 text-left transition-colors ${
                    isActive
                      ? 'border-emerald-300 bg-emerald-50'
                      : 'border-slate-100 bg-slate-50 hover:bg-slate-100'
                  }`}
                >
                  <div className="flex items-center gap-1">
                    <span className={`text-[10px] font-medium ${isActive ? 'text-emerald-700' : 'text-slate-500'}`}>
                      {q.name}
                    </span>
                  </div>
                  <div className="mt-0.5 flex items-center justify-between gap-1">
                    <span className="font-mono text-[10px] tabular-nums" style={{ color: pctColor(q.pct) }}>
                      {pctText(q.pct)}
                    </span>
                  </div>
                </button>
              )
            })}
          </div>
        )}

        {/* 摘要 */}
        {active && (
          <div className="mb-1.5 rounded-md border border-slate-100 bg-slate-50/80 px-2 py-1.5">
            <div className="flex items-baseline justify-between gap-2">
              <div className="min-w-0">
                <span className="text-sm font-semibold text-slate-800">{active.name}</span>
                <span className="ml-1.5 font-mono text-[10px] text-slate-400">{active.code}</span>
              </div>
              <div className="flex items-baseline gap-1.5">
                <span className="font-mono text-lg font-bold tabular-nums" style={{ color: pctColor(active.pct) }}>
                  {active.close.toFixed(2)}
                </span>
                <span className="font-mono text-[11px] tabular-nums" style={{ color: pctColor(active.pct) }}>
                  {active.change >= 0 ? '+' : ''}
                  {active.change.toFixed(2)} / {pctText(active.pct)}
                </span>
              </div>
            </div>
            <div className="mt-1.5 grid grid-cols-3 gap-1">
              {summary?.map((c) => (
                <div key={c.label} className="min-w-0 rounded bg-white/70 px-1.5 py-1">
                  <div className="text-[9px] text-slate-400">{c.label}</div>
                  <div
                    className="truncate font-mono text-[11px] tabular-nums"
                    style={{ color: c.color ?? '#334155' }}
                  >
                    {c.value}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* 图表 */}
        {selected && (
          <IndexChart
            key={`${selected.market}${selected.code}`}
            market={selected.market}
            code={selected.code}
            name={selected.name}
            height={340}
          />
        )}

        {quotes.length === 0 && !error && !settled && (
          <div className="py-10 text-center text-xs text-slate-300">加载指数…</div>
        )}
        {quotes.length === 0 && !error && settled && (
          <div className="rounded-md border border-amber-100 bg-amber-50/60 px-2.5 py-3 text-center">
            <div className="text-[11px] font-medium text-amber-600">行情源暂无指数数据</div>
            <div className="mt-1 text-[10px] leading-relaxed text-amber-500/80">
              可能处于非交易时段或数据源未连接，点击右上角刷新重试。
              <br />
              交易日盘中即可查看 9 大指数实时行情与走势。
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
