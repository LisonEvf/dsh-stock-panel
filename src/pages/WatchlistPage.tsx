/**
 * 自选实时行情页（M5）：本地存储的自选列表 + quote 轮询实时价。
 *
 * 数据：watchlist-store（localStorage）+ MCP quote（每只并行拉取，12s 轮询）。
 * 点击行 → 打开个股详情；支持搜索添加 / 移除 / 清空。
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Trash2, Search, X, RefreshCw, Plus } from 'lucide-react'
import { useWatchlist, type WatchItem } from '@/lib/watchlist-store'
import { fetchQuote, type QuoteRow } from '@/lib/stock-data'
import { searchInstruments, type SearchHit } from '@/lib/market'
import { fmtBigNum } from '@/lib/format'
import { parseSymbol } from '@/lib/symbol'
import { setView } from '@/lib/selection'
import { StateView, classifyStateError } from '@/components/StateView'
import { ConfirmButton } from '@/components/ConfirmButton'
import type { OpenStock } from '@/panel/PanelApp'

/**
 * 涨跌色一律走 token，**不写字面量**（A 股语义色的唯一来源是 index.css.txt 的 --dc-*）。
 * 为什么（审计 V4/L8）：字面量在暗色主题下不会跟着变亮 → 同屏出现两种红
 * （实测 3.17:1 vs 4.73:1，前者不达 AA）。`--dc-flat` 是既有的"平盘/缺失"中性色。
 */
const UP = 'var(--dc-up)'
const DOWN = 'var(--dc-down)'
const FLAT = 'var(--dc-flat)'

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
  /**
   * 整轮取数失败记账（审计：三态碎片化 + 静默失败）。
   *
   * 为什么只记"整轮全失败"：逐只并行拉取时个别失败是常态（停牌/退市/无权限），
   * 每轮都弹错误条会变成噪音；但**全部失败**说明数据源不可达 —— 此时每行只剩「—」，
   * 不给结论的话用户会把"取不到"读成"这些票没行情"（错误结论与正常结论长得一样）。
   */
  const [quoteError, setQuoteError] = useState<{ failed: number; total: number; streak: number; reason: string } | null>(null)

  const loadQuotes = useCallback(async (list: WatchItem[]) => {
    if (!list.length) {
      setQuotes({})
      setLastUpdated(null)
      setQuoteError(null)
      return
    }
    const settled = await Promise.allSettled(list.map((it) => fetchQuote(it.market, it.code)))
    const next: Record<string, QuoteRow | null> = {}
    let failed = 0
    let reason = ''
    settled.forEach((r, i) => {
      const it = list[i]
      if (r.status === 'fulfilled') {
        next[`${it.market}${it.code}`] = r.value
        return
      }
      next[`${it.market}${it.code}`] = null
      failed += 1
      if (reason === '') reason = (r.reason as Error)?.message ?? String(r.reason)
    })
    setQuotes(next)
    setLastUpdated(Date.now())
    setQuoteError((prev) => ({
      failed,
      total: list.length,
      // 连续全失败计数：任一轮恢复即归零（单轮抖动不弹错误条，但也不装作没发生）
      streak: failed === list.length ? (prev?.streak ?? 0) + 1 : 0,
      reason,
    }))
  }, [])

  // 列表变化后立即拉一次
  useEffect(() => {
    void loadQuotes(items)
  }, [items, loadQuotes])

  // 轮询（12s）
  useEffect(() => {
    timerRef.current = window.setInterval(() => {
      // 后台标签页不轮询（B3；自选盘是逐只并行请求，最不该在后台空跑）
      if (document.hidden) return
      void loadQuotes(itemsRef.current)
    }, POLL_MS)
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

  /** 整轮全失败 → 统一走 `classifyStateError` 分类（能区分"超时"与"不可达"）。 */
  const quoteFail =
    quoteError !== null && quoteError.total > 0 && quoteError.failed === quoteError.total
      ? {
          ...classifyStateError(quoteError.reason, '自选行情取数失败'),
          total: quoteError.total,
          streak: quoteError.streak,
        }
      : null

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <div className="h-full overflow-y-auto px-2.5 pb-3">
        {/* 吸顶头部 */}
        <div className="ds-sticky-head -mx-2.5 mb-1.5 flex items-center justify-between border-b border-slate-100 px-2.5 pb-1.5 pt-2">
          <span className="text-sm font-semibold text-slate-800">
            自选行情
            <span className="ml-1 dc-t-data font-normal text-slate-300">({items.length})</span>
          </span>
          <div className="flex items-center gap-1.5">
            {lastUpdated && (
              <span className="dc-t-data text-slate-300">
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
            {/* 审计 I8（原 `onClick={clear}` 一行直清，无二次确认）：清空自选写的是
                localStorage，误点即不可逆 —— 加一道闸，并把**数量**写进确认文案，
                让用户在按下去之前能核对"要清掉的到底是几只"。 */}
            {items.length > 0 && (
              <ConfirmButton
                label="清空"
                confirmLabel={`确认清空 ${items.length} 只？`}
                title="清空全部自选（不可撤销）"
                onConfirm={clear}
                className="dc-t-data text-slate-300 hover:text-red-500"
              />
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
                <div className="px-3 py-1.5 dc-t-note text-slate-300">搜索中…</div>
              ) : hits.length > 0 ? (
                hits.map((h) => {
                  const added = items.some((it) => it.market === h.market && it.code === h.code)
                  return (
                    <button
                      key={h.symbol}
                      onClick={() => addHit(h)}
                      className="flex w-full items-center gap-2 px-2.5 py-1.5 text-left hover:bg-emerald-50"
                    >
                      <span className="w-16 shrink-0 font-mono dc-t-note text-slate-600">{h.code}</span>
                      <span className="min-w-0 flex-1 truncate dc-t-note text-slate-700">{h.name}</span>
                      {added && <span className="shrink-0 dc-t-micro text-emerald-500">已添加</span>}
                      {!added && <span className="shrink-0 rounded bg-emerald-500 px-1 py-px dc-t-micro text-white">＋</span>}
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
                  <span className="min-w-0 flex-1 truncate dc-t-note text-slate-700">
                    直接加入 <span className="font-mono">{codeCandidate.market}{codeCandidate.code}</span>
                  </span>
                  <span className="shrink-0 dc-t-micro text-slate-300">本地索引暂无数据，按代码规则推断市场</span>
                  {codeCandidate.added && <span className="shrink-0 dc-t-micro text-emerald-500">已添加</span>}
                </button>
              ) : (
                <div className="px-3 py-1.5 dc-t-note text-slate-300">未找到匹配 · 试试 6 位代码（如 600519）</div>
              )}
            </div>
          )}
        </div>

        {/* 整轮取数失败：把"数据源不可达"说出来（每行的「—」本身不解释原因） */}
        {quoteFail !== null && (
          <StateView
            kind="error"
            compact
            kindLabel={quoteFail.kindLabel}
            title={`自选行情取数失败（${quoteFail.total} 只全部失败）`}
            hint={quoteFail.streak >= 2 ? `已连续 ${quoteFail.streak} 轮；12s 后自动重试` : '本轮失败；12s 后自动重试'}
            reason={quoteFail.reason}
            retryLabel="立即重试"
            onRetry={() => void loadQuotes(items)}
          />
        )}

        {/* 列表 */}
        {sortedItems.length === 0 ? (
          <StateView
            kind="empty"
            title="暂无自选"
            hint={
              <>
                输入 6 位代码直接加（如 600519 / 000001，自动推断市场），
                <br />
                或到「行情」页把看中的标的加进来
              </>
            }
            action={{ label: '去行情页挑标的', onClick: () => setView('market') }}
          />
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
                      <span className="truncate dc-t-data font-medium text-slate-700">{displayName}</span>
                      <span className="shrink-0 rounded bg-slate-100 px-1 dc-t-micro font-bold text-slate-400">
                        {it.market}
                      </span>
                    </div>
                    <div className="font-mono dc-t-micro text-slate-300">
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
                        <div className="font-mono text-sm font-bold tabular-nums text-slate-700">
                          {q.close.toFixed(2)}
                        </div>
                        <div className="font-mono dc-t-data tabular-nums" style={{ color: pct == null ? FLAT : pct >= 0 ? UP : DOWN }}>
                          {pct == null ? '—' : `${pct >= 0 ? '+' : ''}${pct.toFixed(2)}%`}
                        </div>
                      </>
                    ) : (
                      <span className="dc-t-data text-slate-200">{q === null ? '—' : '…'}</span>
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
