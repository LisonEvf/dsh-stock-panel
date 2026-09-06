/**
 * 涨停梯队 + 板块热度页（M6）。
 *
 * 顶部速览（涨停/跌停/最高板）+ 梯队条形 + 按板数分组列表 + 板块热度 TOP。
 * 30s 轮询；点股票行 → 打开个股 Tab。
 */

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { RefreshCw, Flame } from 'lucide-react'
import { loadLadder, type LadderSnapshot } from '@/lib/ladder'
import { fmtBigNum } from '@/lib/format'
import { inferMarket, type MarketTag } from '@/lib/symbol'
import type { OpenStock } from '@/panel/PanelApp'

const UP = '#c74040'
const DOWN = '#2d9b65'
const REFRESH_MS = 30_000

function pctColor(v: number): string {
  return v > 0 ? UP : v < 0 ? DOWN : '#94a3b8'
}

interface Props {
  onOpenStock: (s: OpenStock) => void
}

export function LadderPage({ onOpenStock }: Props) {
  const [snap, setSnap] = useState<LadderSnapshot | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const busyRef = useRef(false)
  const abortRef = useRef<AbortController | null>(null)

  const load = useCallback(async () => {
    if (busyRef.current) return
    busyRef.current = true
    if (abortRef.current) abortRef.current.abort()
    const ac = new AbortController()
    abortRef.current = ac
    try {
      const s = await loadLadder(ac.signal)
      if (!ac.signal.aborted) {
        setSnap(s)
        setError('')
      }
    } catch (e) {
      if (!ac.signal.aborted) setError((e as Error).message || '加载失败')
    } finally {
      busyRef.current = false
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
    const timer = window.setInterval(() => void load(), REFRESH_MS)
    return () => {
      window.clearInterval(timer)
      abortRef.current?.abort()
    }
  }, [load])

  const known = useMemo(() => snap?.limitUp.filter((s) => s.streakKnown) ?? [], [snap])
  const unknown = useMemo(() => snap?.limitUp.filter((s) => !s.streakKnown) ?? [], [snap])

  const maxStreak = useMemo(() => {
    if (!known.length) return 0
    return Math.max(...known.map((s) => s.streak))
  }, [known])

  const tiers = useMemo(() => {
    const m = new Map<number, number>()
    for (const s of known) m.set(s.streak, (m.get(s.streak) ?? 0) + 1)
    return [...m.entries()].sort((a, b) => b[0] - a[0])
  }, [known])

  const maxTierCount = useMemo(() => Math.max(1, ...tiers.map(([, c]) => c)), [tiers])

  const openStock = (market: MarketTag, code: string, name: string) =>
    onOpenStock({ market, code, name })

  return (
    <div className="h-full overflow-y-auto px-2.5 pb-3">
      <div className="ds-sticky-head -mx-2.5 mb-1.5 flex items-center justify-between border-b border-slate-100 px-2.5 pb-1.5 pt-2">
        <span className="flex items-center gap-1 text-[13px] font-semibold text-slate-800">
          <Flame className="h-3.5 w-3.5 text-red-500" />
          涨停梯队
        </span>
        <div className="flex items-center gap-2">
          {snap && (
            <span className="text-[10px] text-slate-300">
              {new Date(snap.fetchedAt).toLocaleTimeString('zh-CN', { hour12: false })}
            </span>
          )}
          <button
            onClick={() => {
              setLoading(true)
              void load()
            }}
            className="rounded p-0.5 text-slate-300 hover:bg-slate-100 hover:text-slate-500"
            title="刷新"
          >
            <RefreshCw className={`h-3 w-3 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      {error && <div className="mb-1.5 rounded bg-red-50 px-2 py-1.5 text-[11px] text-red-500">{error}</div>}

      {/* 速览（2×2 纵排） */}
      {snap && (
        <div className="mb-1.5 grid grid-cols-2 gap-1.5">
          <StatCell label="涨停" value={<span style={{ color: UP }}>{snap.limitUp.length}</span>} sub="封板数" />
          <StatCell label="跌停" value={<span style={{ color: DOWN }}>{snap.limitDownCount}</span>} sub="封板数" />
          <StatCell label="最高连板" value={`${maxStreak}板`} sub={`${tiers.length} 组梯队`} />
          <StatCell label="≥2板晋级" value={`${tiers.filter(([n]) => n >= 2).reduce((a, [, c]) => a + c, 0)}`} sub="高位家数" />
        </div>
      )}

      {/* 梯队条形 */}
      {tiers.length > 0 && (
        <div className="mb-1.5 rounded-md border border-slate-100 bg-slate-50/60 px-2 py-1.5">
          <div className="mb-1 flex items-center justify-between">
            <span className="text-[10px] font-medium text-slate-400">连板梯队（{known.length} 只）</span>
            {unknown.length > 0 && (
              <span className="text-[9px] text-amber-500/80">{unknown.length} 只连板待确认</span>
            )}
          </div>
          <div className="space-y-1">
            {tiers.map(([n, c]) => (
              <div key={n} className="grid grid-cols-[34px_1fr_26px] items-center gap-1.5">
                <span
                  className={`font-mono text-[11px] font-bold ${n >= 5 ? 'text-red-500' : n >= 3 ? 'text-amber-500' : 'text-slate-500'}`}
                >
                  {n}板
                </span>
                <div className="h-1.5 overflow-hidden rounded-full bg-slate-200/70">
                  <div
                    className="h-full rounded-full"
                    style={{ width: `${Math.max(8, (c / maxTierCount) * 100)}%`, background: n >= 3 ? 'rgba(199,64,64,0.7)' : 'rgba(148,163,184,0.6)' }}
                  />
                </div>
                <span className="text-right font-mono text-[11px] text-slate-500">{c}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 分组列表 */}
      {snap && snap.limitUp.length > 0 ? (
        <div className="mb-1.5 space-y-1.5">
          {tiers.map(([n, count]) => {
            const group = known.filter((s) => s.streak === n)
            return (
              <div key={n} className="rounded-md border border-slate-100 bg-slate-50/50 px-2 py-1.5">
                <div className="mb-1 text-[10px] font-semibold text-slate-400">
                  {n}板 · {count}只
                </div>
                <ul className="space-y-0.5">
                  {group.map((s) => (
                    <li key={`${s.market}${s.code}`}>
                      <button
                        onClick={() => openStock(s.market, s.code, s.name)}
                        className="flex w-full items-center gap-1 rounded px-1 py-[3px] text-left hover:bg-white"
                        title={`${s.name} ${s.code} · 涨停 ${s.dates.length} 连板`}
                      >
                        {s.oneWord && (
                          <span className="shrink-0 rounded bg-red-100 px-1 text-[8px] font-medium text-red-600">一字</span>
                        )}
                        <span className="min-w-0 flex-1 truncate text-[11px] text-slate-700">{s.name}</span>
                        <span className="shrink-0 font-mono text-[8px] text-slate-300">{s.code}</span>
                        <span className="w-10 shrink-0 text-right font-mono text-[9px] text-slate-400 tabular-nums">
                          {s.turnover ? `${s.turnover.toFixed(1)}%` : '—'}
                        </span>
                        <span className="w-12 shrink-0 text-right font-mono text-[9px] text-slate-500 tabular-nums">
                          {fmtBigNum(s.amount)}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            )
          })}

          {/* 连板待确认（数据拉取失败/超时的涨停股） */}
          {unknown.length > 0 && (
            <div className="rounded-md border border-dashed border-amber-200 bg-amber-50/30 px-2 py-1.5">
              <div className="mb-1 text-[10px] font-semibold text-amber-500/80">连板待确认 · {unknown.length} 只</div>
              <ul className="space-y-0.5">
                {unknown.map((s) => (
                  <li key={`${s.market}${s.code}`}>
                    <button
                      onClick={() => openStock(s.market, s.code, s.name)}
                      className="flex w-full items-center gap-1.5 rounded px-1 py-0.5 text-left hover:bg-white"
                      title={`${s.name} ${s.code}`}
                    >
                      <span className="min-w-0 flex-1 truncate text-[11px] text-slate-500">{s.name}</span>
                      <span className="shrink-0 font-mono text-[9px] text-slate-300">{s.code}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      ) : (
        !loading && (
          <div className="rounded-md border border-dashed border-slate-200 py-8 text-center text-xs text-slate-300">
            今日暂无封涨停（或盘中尚未封板）
          </div>
        )
      )}

      {/* 板块热度 */}
      {snap && snap.boards.length > 0 && (
        <div className="rounded-md border border-slate-100 bg-slate-50/60 px-2 py-1.5">
          <div className="mb-1 flex items-center justify-between">
            <span className="text-[10px] font-medium text-slate-400">涨停板块热度</span>
            <span className="text-[8px] text-slate-300">按板块当日涨停家数</span>
          </div>
          <ul className="space-y-0.5">
            {snap.boards.map((b) => (
              <li key={b.boardSymbol}>
                <button
                  onClick={() => openStock(inferMarket(b.repCode), b.repCode, b.rep)}
                  className="flex w-full items-center gap-1.5 rounded px-1 py-0.5 text-left hover:bg-white"
                  title={`${b.name} · 代表 ${b.rep}（${b.repCode}）`}
                >
                  <span className="min-w-0 flex-1 truncate text-[11px] text-slate-600">{b.name}</span>
                  <span className="shrink-0 rounded bg-red-50 px-1 py-px font-mono text-[9px] font-medium text-red-500">
                    {b.limitUpCount} 涨停
                  </span>
                  <span className="w-11 shrink-0 text-right font-mono text-[10px] tabular-nums" style={{ color: pctColor(b.pct) }}>
                    {b.pct >= 0 ? '+' : ''}
                    {b.pct.toFixed(2)}%
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {loading && !snap && <div className="py-10 text-center text-xs text-slate-300">加载涨停池…</div>}
    </div>
  )
}

function StatCell({ label, value, sub }: { label: string; value: ReactNode; sub?: string }) {
  return (
    <div className="min-w-0 rounded-md border border-slate-100 bg-slate-50/80 px-2 py-1.5">
      <div className="truncate text-[10px] text-slate-400">{label}</div>
      <div className="mt-0.5 font-mono text-[14px] font-bold leading-none text-slate-700 tabular-nums">{value}</div>
      {sub && <div className="mt-1 truncate text-[9px] text-slate-300">{sub}</div>}
    </div>
  )
}
