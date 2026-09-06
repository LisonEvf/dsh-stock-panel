/**
 * 自选实时行情页（M5）：本地存储的自选列表 + quote 轮询实时价。
 *
 * 数据：watchlist-store（localStorage）+ MCP quote（每只并行拉取，12s 轮询）。
 * 点击行 → 打开个股详情；支持搜索添加 / 移除 / 清空。
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Star, Trash2, Search, X, RefreshCw, Plus } from 'lucide-react'
import { useWatchlist, type WatchItem } from '@/lib/watchlist-store'
import { fetchQuote, type QuoteRow } from '@/lib/stock-data'
import { searchInstruments, type SearchHit } from '@/lib/market'
import { fmtBigNum } from '@/lib/format'
import { parseSymbol } from '@/lib/symbol'
import type { OpenStock } from '@/panel/PanelApp'

const UP = '#c74040'
const DOWN = '#2d9b65'

interface Props {
  onOpenStock: (s: OpenStock) => void
}

const POLL_MS = 12_000

export function WatchlistPage({ onOpenStock }: Props) {
  const { items, add, remove, clear } = useWatchlist()
  const itemsRef = useRef(items)
  itemsRef.current = items
  const [quotes, setQuotes] = useState<Record<string, QuoteRow | null>>({})
  const [lastUpdated, setLastUpdated] = useState<number | null>(null)
  const [query, setQuery] = useState('')
  const [hits, setHits] = useState<SearchHit[]>([])
  const [searching, setSearching] = useState(false)
  const timerRef = useRef<number | null>(null)

  const loadQuotes = useCallback(async (list: WatchItem[]) => {
    if (!list.length) {
      setQuotes({})
      setLastUpdated(null)
      return
    }
    const settled = await Promise.allSettled(list.map((it) => fetchQuote(it.market, it.code)))
    const next: Record<string, QuoteRow | null> = {}
    settled.forEach((r, i) => {
      const it = list[i]
      next[`${it.market}${it.code}`] = r.status === 'fulfilled' ? r.value : null
    })
    setQuotes(next)
    setLastUpdated(Date.now())
  }, [])

  // 列表变化后立即拉一次
  useEffect(() => {
    void loadQuotes(items)
  }, [items, loadQuotes])

  // 轮询（12s）
  useEffect(() => {
    timerRef.current = window.setInterval(() => void loadQuotes(itemsRef.current), POLL_MS)
    return () => {
      if (timerRef.current) window.clearInterval(timerRef.current)
    }
  }, [loadQuotes])

  // 搜索建议（本地全 A 索引）
  useEffect(() => {
    const q = query.trim()
    if (!q) {
      setHits([])
      return
    }
    let cancelled = false
    setSearching(true)
    const t = window.setTimeout(async () => {
      try {
        const res = await searchInstruments(q, 12)
        if (!cancelled) setHits(res)
      } catch {
        if (!cancelled) setHits([])
      } finally {
        if (!cancelled) setSearching(false)
      }
    }, 250)
    return () => {
      cancelled = true
      window.clearTimeout(t)
    }
  }, [query])

  const sortedItems = useMemo(() => {
    return [...items].sort((a, b) => {
      const qa = quotes[`${a.market}${a.code}`]
      const qb = quotes[`${b.market}${b.code}`]
      const pa = qa ? (qa.close - qa.pre_close) / qa.pre_close : -9999
      const pb = qb ? (qb.close - qb.pre_close) / qb.pre_close : -9999
      return pb - pa
    })
  }, [items, quotes])

  const addHit = (h: SearchHit) => {
    if (items.length >= 60) return
    if (!items.some((it) => it.market === h.market && it.code === h.code)) {
      add({ market: h.market, code: h.code, name: h.name })
    }
    setQuery('')
    setHits([])
  }

  /** 休市/全 A 索引为空时，支持按代码直接加自选（市场按代码规则推断）。 */
  const addByCode = (raw: string) => {
    const p = parseSymbol(raw)
    if (!p || items.length >= 60) return
    if (!items.some((it) => it.market === p.market && it.code === p.code)) {
      add({ market: p.market, code: p.code, name: p.code })
    }
    setQuery('')
    setHits([])
  }

  // 直接按代码加入的候选（搜索无命中但输入可解析为标的时展示）
  const codeCandidate = useMemo(() => {
    const q = query.trim()
    if (!q || searching || hits.length > 0) return null
    const p = parseSymbol(q)
    if (!p) return null
    const added = items.some((it) => it.market === p.market && it.code === p.code)
    return { market: p.market, code: p.code, added }
  }, [query, searching, hits, items])

  // 搜索完全无命中且输入不是合法代码 → 展示引导提示
  const showNoMatch = useMemo(() => {
    const q = query.trim()
    return q.length >= 3 && !searching && hits.length === 0 && !codeCandidate
  }, [query, searching, hits, codeCandidate])

  const openRow = (it: WatchItem) => {
    const q = quotes[`${it.market}${it.code}`]
    onOpenStock({ market: it.market, code: it.code, name: q?.name || it.name || it.code })
  }

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <div className="h-full overflow-y-auto px-2.5 pb-3">
        {/* 吸顶头部 */}
        <div className="ds-sticky-head -mx-2.5 mb-1.5 flex items-center justify-between border-b border-slate-100 px-2.5 pb-1.5 pt-2">
          <span className="text-[13px] font-semibold text-slate-800">
            自选行情
            <span className="ml-1 text-[10px] font-normal text-slate-300">({items.length})</span>
          </span>
          <div className="flex items-center gap-1.5">
            {lastUpdated && (
              <span className="text-[10px] text-slate-300">
                {new Date(lastUpdated).toLocaleTimeString('zh-CN', { hour12: false })}
              </span>
            )}
            <button
              onClick={() => void loadQuotes(items)}
              className="rounded p-0.5 text-slate-300 hover:bg-slate-100 hover:text-slate-500"
              title="立即刷新"
            >
              <RefreshCw className="h-3 w-3" />
            </button>
            {items.length > 0 && (
              <button onClick={clear} className="text-[10px] text-slate-300 hover:text-red-500">
                清空
              </button>
            )}
          </div>
        </div>

        {/* 添加搜索 */}
        <div className="relative mb-1.5">
          <div className="relative">
            <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-300" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="输入代码/名称加自选…"
              className="w-full rounded-md border border-slate-200 py-1.5 pl-7 pr-7 text-xs outline-none placeholder:text-slate-300 focus:border-emerald-400"
              autoComplete="off"
            />
            {query && (
              <button
                onClick={() => { setQuery(''); setHits([]) }}
                className="absolute right-1.5 top-1/2 -translate-y-1/2 text-slate-300 hover:text-slate-500"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
          {(hits.length > 0 || searching || codeCandidate || showNoMatch) && (
            <div className="absolute z-40 mt-1 max-h-52 w-full overflow-y-auto rounded-md border border-slate-200 bg-white py-1 shadow-lg">
              {searching && hits.length === 0 && !codeCandidate ? (
                <div className="px-3 py-1.5 text-[11px] text-slate-300">搜索中…</div>
              ) : hits.length > 0 ? (
                hits.map((h) => {
                  const added = items.some((it) => it.market === h.market && it.code === h.code)
                  return (
                    <button
                      key={h.symbol}
                      onClick={() => addHit(h)}
                      className="flex w-full items-center gap-2 px-2.5 py-1.5 text-left hover:bg-emerald-50"
                    >
                      <span className="w-16 shrink-0 font-mono text-[11px] text-slate-600">{h.code}</span>
                      <span className="min-w-0 flex-1 truncate text-[11px] text-slate-700">{h.name}</span>
                      {added && <span className="shrink-0 text-[9px] text-emerald-500">已添加</span>}
                      {!added && <span className="shrink-0 rounded bg-emerald-500 px-1 py-px text-[9px] text-white">＋</span>}
                    </button>
                  )
                })
              ) : codeCandidate ? (
                <button
                  onClick={() => addByCode(query)}
                  className="flex w-full items-center gap-2 px-2.5 py-1.5 text-left hover:bg-emerald-50"
                  title={`按 ${codeCandidate.market}${codeCandidate.code} 直接加入`}
                >
                  <Plus className="h-3.5 w-3.5 shrink-0 text-emerald-500" />
                  <span className="min-w-0 flex-1 truncate text-[11px] text-slate-700">
                    直接加入 <span className="font-mono">{codeCandidate.market}{codeCandidate.code}</span>
                  </span>
                  <span className="shrink-0 text-[9px] text-slate-300">本地索引暂无数据，按代码规则推断市场</span>
                  {codeCandidate.added && <span className="shrink-0 text-[9px] text-emerald-500">已添加</span>}
                </button>
              ) : (
                <div className="px-3 py-1.5 text-[11px] text-slate-300">未找到匹配 · 试试 6 位代码（如 600519）</div>
              )}
            </div>
          )}
        </div>

        {/* 列表 */}
        {sortedItems.length === 0 ? (
          <div className="flex flex-col items-center gap-1.5 py-10 text-center">
            <Star className="h-6 w-6 text-slate-200" />
            <div className="text-xs text-slate-400">暂无自选</div>
            <div className="px-6 text-[11px] leading-relaxed text-slate-300">
              输入 6 位代码直接加（如 600519 / 000001，自动推断市场），
              <br />
              或到「市场」页把看中的标的加进来
            </div>
          </div>
        ) : (
          <ul className="space-y-0.5">
            {sortedItems.map((it) => {
              const q = quotes[`${it.market}${it.code}`]
              const key = `${it.market}${it.code}`
              const displayName = q?.name || it.name || it.code
              const pct = q && q.pre_close > 0 ? ((q.close - q.pre_close) / q.pre_close) * 100 : null
              return (
                <li
                  key={key}
                  onClick={() => openRow(it)}
                  role="button"
                  className="group flex cursor-pointer items-center gap-2 rounded-md border border-slate-100 bg-slate-50/70 px-1.5 py-1 hover:border-emerald-200 hover:bg-emerald-50/50"
                  title={`查看 ${displayName} 详情`}
                >
                  <button
                    onClick={(e) => {
                      e.stopPropagation()
                      remove(it.market, it.code)
                    }}
                    className="shrink-0 text-slate-200 opacity-0 transition-opacity hover:text-red-500 group-hover:opacity-100"
                    title="移出自选"
                  >
                    <Trash2 className="h-3 w-3" />
                  </button>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1">
                      <span className="truncate text-[12px] font-medium text-slate-700">{displayName}</span>
                      <span className="shrink-0 rounded bg-slate-100 px-1 text-[8px] font-bold text-slate-400">
                        {it.market}
                      </span>
                    </div>
                    <div className="font-mono text-[9px] text-slate-300">
                      {it.code}
                      {q
                        ? ` · 量比 ${(q.vol_ratio ?? 0).toFixed(1)} · 额 ${fmtBigNum(q.amount)}`
                        : q === null
                          ? ' · 行情源暂无报价（休市/未连接）'
                          : ' · 加载中…'}
                    </div>
                  </div>
                  <div className="shrink-0 text-right">
                    {q ? (
                      <>
                        <div className="font-mono text-[13px] font-bold tabular-nums text-slate-700">
                          {q.close.toFixed(2)}
                        </div>
                        <div className="font-mono text-[10px] tabular-nums" style={{ color: pct == null ? '#94a3b8' : pct >= 0 ? UP : DOWN }}>
                          {pct == null ? '—' : `${pct >= 0 ? '+' : ''}${pct.toFixed(2)}%`}
                        </div>
                      </>
                    ) : (
                      <span className="text-[10px] text-slate-200">{q === null ? '—' : '…'}</span>
                    )}
                  </div>
                </li>
              )
            })}
          </ul>
        )}
      </div>
    </div>
  )
}
