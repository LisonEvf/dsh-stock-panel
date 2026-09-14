/**
 * 指数页（M5）：指数切换条 + 实时摘要 + 日K/分时图。
 *
 * 数据：quote（指数列表实时价）+ IndexChart（kline DAILY / tick_chart）。
 * 每 15s 刷新指数报价。
 */

import { useEffect, useMemo, useRef, useState } from 'react'
import { RefreshCw } from 'lucide-react'
import { fetchIndexQuotes, pctText } from '@/lib/market'
import { IndexChart } from '@/components/IndexChart'
import { useSwr, swrKey } from '@/lib/cache'
import { useAvailableHeight } from '@/panel/hooks'
import { fmtBigNum } from '@/lib/format'
import type { MarketTag } from '@/lib/symbol'

const UP = 'var(--dc-up)'
const DOWN = 'var(--dc-down)'

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

  // 图表高度**随容器**（不再写死 340px）：3 列布局下这一块上下都空着
  // （固定图高 + 一行摘要 ≈ 440px，而列高 ~700px），而图是本块唯一的信息载体。
  const chartBoxRef = useRef<HTMLDivElement | null>(null)
  const chartAvail = useAvailableHeight(chartBoxRef, { min: 240, gap: 12 })
  // 量不到（首帧 / 单列整页滚动）时退回 340 —— 那个值在此前是唯一的档位，仍然可用。
  const chartHeight = embedded && chartAvail > 0 ? Math.min(chartAvail, 720) : 340

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
            <span className="text-sm font-semibold text-slate-800">指数</span>
            <button
              onClick={() => quotesSwr.refresh()}
              className="flex items-center gap-1 rounded px-1.5 py-0.5 dc-t-note text-slate-400 hover:bg-slate-100 hover:text-slate-600"
            >
              <RefreshCw className={`h-3 w-3 ${refreshing ? 'animate-spin' : ''}`} />
            </button>
          </div>
        )}

        {error && <div className="mb-1.5 rounded bg-red-50 px-2 py-1 dc-t-note text-red-500">{error}</div>}

        {/* 指数切换条：**横向滚动**而不是换行 —— 9 个指数在 320px 的列里必然放不下，
            换行会把图表挤下去（图表才是这一块的信息载体）。 */}
        {quotes.length > 0 && (
          <div className="dc-index-strip-inline mb-1.5">
            {quotes.map((q) => {
              const isActive = selected?.market === q.market && selected?.code === q.code
              return (
                <button
                  key={`${q.market}${q.code}`}
                  onClick={() => setSelected({ market: q.market, code: q.code, name: q.name })}
                  title={`${q.name} ${q.code}｜${pctText(q.pct)}${isActive ? '（当前）' : '（点击切换）'}`}
                  className={`shrink-0 rounded-dc-sm border px-2 py-0.5 text-left transition-colors ${
                    isActive ? 'dc-soft-info border-transparent' : 'border-dc-border bg-dc-layer-2 hover:bg-dc-layer-3'
                  }`}
                >
                  <span className={`dc-t-data font-medium ${isActive ? 'text-dc-info' : 'text-dc-text-2'}`}>
                    {q.name}
                  </span>
                  <span className="ml-1.5 font-mono dc-t-note tabular-nums" style={{ color: pctColor(q.pct) }}>
                    {pctText(q.pct)}
                  </span>
                </button>
              )
            })}
          </div>
        )}

        {/* 摘要：选中指数的实时读数（现价 + 6 个字段） */}
        {active && (
          <div className="mb-1.5 rounded-dc-sm border border-dc-border bg-dc-layer-2 px-2 py-1.5">
            <div className="flex items-baseline justify-between gap-2">
              <div className="min-w-0">
                <span className="text-sm font-semibold text-dc-text">{active.name}</span>
                <span className="ml-1.5 font-mono dc-t-data text-dc-text-3">{active.code}</span>
              </div>
              <div className="flex items-baseline gap-1.5">
                <span className="font-mono text-lg font-bold tabular-nums" style={{ color: pctColor(active.pct) }}>
                  {active.close.toFixed(2)}
                </span>
                <span className="font-mono dc-t-note tabular-nums" style={{ color: pctColor(active.pct) }}>
                  {active.change >= 0 ? '+' : ''}
                  {active.change.toFixed(2)} / {pctText(active.pct)}
                </span>
              </div>
            </div>
            <div className="mt-1.5 grid grid-cols-3 gap-1">
              {summary?.map((c) => (
                <div key={c.label} className="min-w-0 rounded-dc-sm bg-dc-layer-1 px-1.5 py-1">
                  <div className="dc-t-micro text-dc-text-3">{c.label}</div>
                  <div className="truncate font-mono dc-t-note tabular-nums text-dc-text-2" style={c.color !== undefined ? { color: c.color } : undefined}>
                    {c.value}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* 图表高度随容器（见 chartHeight）：嵌入聚合页时吃掉剩余高度 */}
        {selected && (
          <div ref={chartBoxRef} className="min-h-0 flex-1">
            <IndexChart
              key={`${selected.market}${selected.code}`}
              market={selected.market}
              code={selected.code}
              name={selected.name}
              height={chartHeight}
            />
          </div>
        )}

        {quotes.length === 0 && !error && !settled && (
          <div className="py-10 text-center text-xs text-slate-300">加载指数…</div>
        )}
        {quotes.length === 0 && !error && settled && (
          <div className="rounded-md border border-amber-100 bg-amber-50/60 px-2.5 py-3 text-center">
            <div className="dc-t-note font-medium text-amber-600">行情源暂无指数数据</div>
            <div className="mt-1 dc-t-data leading-relaxed text-amber-500/80">
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
