/**
 * 市场总览（M5）：指数条 + 大盘速览 + 涨跌分布 + 榜单 + 异动速递。
 *
 * 数据全部直连 MCP（无后端）：
 *   - fetchIndexQuotes：预设 9 大指数实时报价
 *   - fetchAllA：全 A 5566 只一次拉取（20s 缓存），广度/分布/榜单客户端计算
 *   - fetchUnusualAll：SH/SZ/BJ 三市场异动合并
 *
 * 点击股票行 → 切「个股」Tab；点击指数芯片 → 切「指数」Tab。
 */

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { RefreshCw } from 'lucide-react'
import {
  computeBreadth,
  computeDistribution,
  fetchAllA,
  fetchIndexQuotes,
  fetchUnusualAll,
  pctText,
  ensureSearchIndex,
  type AShareRow,
  type DistBucket,
  type IndexQuote,
  type UnusualItem,
} from '@/lib/market'
import { fmtBigNum } from '@/lib/format'
import type { MarketTag } from '@/lib/symbol'
import type { OpenStock } from '@/panel/PanelApp'

const UP = '#c74040'
const DOWN = '#2d9b65'

function pctColor(v: number): string {
  if (v > 0) return UP
  if (v < 0) return DOWN
  return '#94a3b8'
}

interface Props {
  onOpenStock: (s: OpenStock) => void
  onOpenIndex: (m: MarketTag, code: string, name: string) => void
}

export function MarketOverview({ onOpenStock, onOpenIndex }: Props) {
  const [indices, setIndices] = useState<IndexQuote[]>([])
  const [rows, setRows] = useState<AShareRow[]>([])
  const [unusual, setUnusual] = useState<UnusualItem[]>([])
  const [updatedAt, setUpdatedAt] = useState<number | null>(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const timerRef = useRef<number | null>(null)

  const load = useCallback(async () => {
    try {
      const [idx, allRows, uni] = await Promise.allSettled([
        fetchIndexQuotes(),
        fetchAllA(),
        fetchUnusualAll(40),
      ])
      if (idx.status === 'fulfilled') setIndices(idx.value)
      if (allRows.status === 'fulfilled') setRows(allRows.value)
      if (uni.status === 'fulfilled') setUnusual(uni.value)
      setError('')
      setUpdatedAt(Date.now())
    } catch (e) {
      setError((e as Error).message || '加载失败')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
    // 预热本地搜索索引（市场页首屏已拉全 A，搜索零成本）
    void ensureSearchIndex().catch(() => undefined)
    timerRef.current = window.setInterval(() => void load(), 20_000)
    return () => {
      if (timerRef.current) window.clearInterval(timerRef.current)
    }
  }, [load])

  const breadth = useMemo(() => computeBreadth(rows), [rows])
  const dist = useMemo(() => computeDistribution(rows), [rows])

  const sorted = useMemo(() => {
    const byPct = [...rows].sort((a, b) => b.pct - a.pct)
    return {
      gainers: byPct.slice(0, 5),
      losers: byPct.slice(-5).reverse(),
      amount: [...rows].sort((a, b) => b.amount - a.amount).slice(0, 5),
      turnover: [...rows].sort((a, b) => b.turnover - a.turnover).slice(0, 5),
    }
  }, [rows])

  const openStock = (r: AShareRow) => onOpenStock({ market: r.market, code: r.code, name: r.name })
  const openStockUnusual = (u: UnusualItem) => onOpenStock({ market: u.market, code: u.code, name: u.name })

  const maxDist = Math.max(1, ...dist.map((d) => d.count))

  return (
    <div className="h-full overflow-y-auto px-2.5 pb-3">
      {/* 头部：标题 + 刷新（吸顶） */}
      <div className="ds-sticky-head -mx-2.5 mb-1.5 flex items-center justify-between border-b border-slate-100 px-2.5 pb-1.5 pt-2">
        <span className="text-[13px] font-semibold text-slate-800">市场总览</span>
        <div className="flex items-center gap-2">
          {updatedAt && (
            <span className="text-[10px] text-slate-300">
              {new Date(updatedAt).toLocaleTimeString('zh-CN', { hour12: false })}
            </span>
          )}
          <button
            onClick={() => { setLoading(true); void load() }}
            className="flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] text-slate-400 hover:bg-slate-100 hover:text-slate-600"
            title="刷新"
          >
            <RefreshCw className={`h-3 w-3 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      {error && (
        <div className="mb-1.5 rounded bg-red-50 px-2 py-1.5 text-[11px] text-red-500">{error}</div>
      )}

      {/* 行情源空态（休市/未连接）：已请求完成但无任何 A 股行情 */}
      {!loading && rows.length === 0 && !error && (
        <div className="mb-1.5 rounded-md border border-amber-100 bg-amber-50/60 px-2.5 py-2.5">
          <div className="text-[11px] font-medium text-amber-600">行情源暂无 A 股数据</div>
          <div className="mt-0.5 text-[10px] leading-relaxed text-amber-500/80">
            当前可能处于非交易时段或数据源未连接（20s 自动重试中）。
            <br />
            交易日盘中可查看广度 / 分布 / 榜单 / 异动；休市期建议到「复盘」页做功课。
          </div>
        </div>
      )}

      {/* 指数条（纵向单列通栏） */}
      {indices.length > 0 && (
        <div className="mb-1.5 overflow-hidden rounded-md border border-slate-100">
          {indices.map((q, i) => (
            <button
              key={`${q.market}${q.code}`}
              onClick={() => onOpenIndex(q.market, q.code, q.name)}
              className={`flex w-full items-center gap-2 px-2 py-[5px] text-left transition-colors hover:bg-emerald-50/60 ${i > 0 ? 'border-t border-slate-100' : ''}`}
              title={`查看 ${q.name} 走势`}
            >
              <span className="min-w-0 flex-1 truncate text-[11px] font-medium text-slate-600">{q.name}</span>
              <span className="shrink-0 font-mono text-[9px] text-slate-300">{q.code}</span>
              <span className="w-14 shrink-0 text-right font-mono text-[11px] text-slate-500 tabular-nums">
                {q.close.toFixed(2)}
              </span>
              <span className="w-14 shrink-0 text-right font-mono text-[11px] font-semibold tabular-nums" style={{ color: pctColor(q.pct) }}>
                {pctText(q.pct)}
              </span>
            </button>
          ))}
        </div>
      )}

      {/* 大盘速览（2×2 纵排） */}
      {rows.length > 0 && (
        <div className="mb-1.5 grid grid-cols-2 gap-1.5">
          <MiniCell label="涨 / 平 / 跌" main={<><span style={{ color: UP }}>{breadth.up}</span><span className="text-slate-300">/</span><span className="text-slate-400">{breadth.flat}</span><span className="text-slate-300">/</span><span style={{ color: DOWN }}>{breadth.down}</span></>} sub={`共 ${breadth.total} 只`} />
          <MiniCell label="涨停 / 跌停" main={<><span style={{ color: UP }}>{breadth.limitUp}</span><span className="text-slate-300">/</span><span style={{ color: DOWN }}>{breadth.limitDown}</span></>} sub="按交易所涨停价" />
          <MiniCell label="强势 / 弱势(±3%)" main={<><span style={{ color: UP }}>{breadth.strongUp}</span><span className="text-slate-300">/</span><span style={{ color: DOWN }}>{breadth.strongDown}</span></>} sub="涨跌≥3%" />
          <MiniCell label="两市成交" main={<span className="text-[13px] font-semibold">{fmtBigNum(breadth.amountSum)}</span>} sub={`平均涨跌 ${pctText(breadth.avgPct, 2)}`} />
        </div>
      )}

      {/* 涨跌分布（仅在有行情时展示，避免空数据画全零柱误导） */}
      {rows.length > 0 && dist.length > 0 && (
        <div className="mb-1.5 rounded-md border border-slate-100 bg-slate-50/60 px-2 py-1.5">
          <div className="mb-1 text-[10px] font-medium text-slate-400">涨跌分布（% 区间）</div>
          <div className="flex h-12 items-end gap-0.5">
            {dist.map((b: DistBucket) => (
              <div
                key={b.key}
                className="flex min-w-0 flex-1 flex-col items-center justify-end"
                title={`${b.label}%: ${b.count}只`}
              >
                <span className="mb-0.5 text-[8px] leading-none text-slate-400 tabular-nums">{b.count || ''}</span>
                <div
                  className="w-full rounded-sm"
                  style={{
                    height: `${Math.max(4, (b.count / maxDist) * 34)}px`,
                    background: b.up ? 'rgba(199,64,64,0.55)' : 'rgba(45,155,101,0.55)',
                  }}
                />
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 榜单（纵向单列） */}
      {rows.length > 0 && (
        <div className="mb-1.5 space-y-1.5">
          <RankList title="涨幅榜" items={sorted.gainers} mode="pct" onOpen={openStock} />
          <RankList title="跌幅榜" items={sorted.losers} mode="pct" onOpen={openStock} />
          <RankList title="成交额榜" items={sorted.amount} mode="amount" onOpen={openStock} />
          <RankList title="换手率榜" items={sorted.turnover} mode="turnover" onOpen={openStock} />
        </div>
      )}

      {/* 异动速递 */}
      {unusual.length > 0 && (
        <div className="rounded-md border border-slate-100 bg-slate-50/60 px-2 py-1.5">
          <div className="mb-1 text-[10px] font-medium text-slate-400">市场异动</div>
          <ul className="space-y-0.5">
            {unusual.slice(0, 14).map((u, i) => (
              <li key={`${u.market}${u.code}-${i}`}>
                <button
                  onClick={() => openStockUnusual(u)}
                  className="flex w-full items-center gap-1.5 rounded px-1 py-0.5 text-left hover:bg-white"
                  title={`${u.name} ${u.code}`}
                >
                  <span
                    className="shrink-0 rounded px-1 py-px text-[9px] font-medium"
                    style={{
                      color: u.kind === 'up' ? UP : u.kind === 'down' ? DOWN : '#b45309',
                      background: u.kind === 'up' ? 'rgba(199,64,64,0.08)' : u.kind === 'down' ? 'rgba(45,155,101,0.08)' : 'rgba(180,83,9,0.08)',
                    }}
                  >
                    {u.desc.replace(/[（）()]/g, '')}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-[11px] text-slate-600">{u.name}</span>
                  <span className="shrink-0 font-mono text-[9px] text-slate-400 tabular-nums">{u.time}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {loading && rows.length === 0 && indices.length === 0 && (
        <div className="py-10 text-center text-xs text-slate-300">加载市场数据…</div>
      )}
    </div>
  )
}

function MiniCell({ label, main, sub }: { label: string; main: ReactNode; sub?: string }) {
  return (
    <div className="min-w-0 rounded-md border border-slate-100 bg-slate-50/80 px-2 py-1.5">
      <div className="truncate text-[10px] text-slate-400">{label}</div>
      <div className="mt-0.5 font-mono text-[14px] font-semibold leading-none text-slate-700 tabular-nums">{main}</div>
      {sub && <div className="mt-1 truncate text-[9px] text-slate-300">{sub}</div>}
    </div>
  )
}

function RankList({
  title,
  items,
  mode,
  onOpen,
}: {
  title: string
  items: AShareRow[]
  mode: 'pct' | 'amount' | 'turnover'
  onOpen: (r: AShareRow) => void
}) {
  return (
    <div className="min-w-0 rounded-md border border-slate-100 bg-slate-50/60 px-1.5 py-1.5">
      <div className="mb-1 flex items-center justify-between">
        <span className="text-[10px] font-medium text-slate-500">{title}</span>
        <span className="text-[8px] text-slate-300">TOP{items.length}</span>
      </div>
      <ul className="space-y-0.5">
        {items.map((r) => (
          <li key={`${r.market}${r.code}`}>
            <button
              onClick={() => onOpen(r)}
              className="flex w-full items-center gap-1 rounded px-1 py-[3px] text-left hover:bg-white"
              title={`${r.name} ${r.code} · 查看详情`}
            >
              <span className="min-w-0 flex-1 truncate text-[11px] text-slate-700">{r.name}</span>
              <span className="shrink-0 font-mono text-[8px] text-slate-300">{r.code}</span>
              {mode === 'pct' && (
                <span className="w-14 shrink-0 text-right font-mono text-[11px] font-semibold tabular-nums" style={{ color: pctColor(r.pct) }}>
                  {pctText(r.pct)}
                </span>
              )}
              {mode === 'amount' && (
                <span className="w-14 shrink-0 text-right font-mono text-[9px] text-slate-500 tabular-nums">
                  {fmtBigNum(r.amount)}
                </span>
              )}
              {mode === 'turnover' && (
                <span className="w-10 shrink-0 text-right font-mono text-[9px] text-slate-500 tabular-nums">
                  {r.turnover.toFixed(1)}%
                </span>
              )}
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}
