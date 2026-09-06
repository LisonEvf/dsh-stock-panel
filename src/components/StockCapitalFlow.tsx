/**
 * 个股资金面板（N7）。
 *
 * ⚠️ 依据 STRATEGY-RESEARCH §3：主力资金流（净流入/大单）是可被操纵、与散户博弈的异象，
 * 只可作「相对排名 / 5 日方向」的方向确认，**不可单独作为买卖信号**——页面附提示。
 */

import { useEffect, useState } from 'react'
import { fetchCapitalFlow, type CapitalFlowRow } from '@/lib/stock-data'
import { fmtBigNum } from '@/lib/format'
import type { MarketTag } from '@/lib/symbol'

interface Props {
  market: MarketTag
  code: string
}

const UP = '#c74040'
const DOWN = '#2d9b65'

export function StockCapitalFlow({ market, code }: Props) {
  const [row, setRow] = useState<CapitalFlowRow | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let alive = true
    setLoading(true)
    setRow(null)
    fetchCapitalFlow(market, code).then((r) => {
      if (!alive) return
      setRow(r)
      setLoading(false)
    })
    return () => {
      alive = false
    }
  }, [market, code])

  const num = (v: unknown): number => {
    const n = Number(v)
    return Number.isFinite(n) ? n : 0
  }

  const items = row
    ? [
        { l: '今日主力净流入', v: num(row['今日主力净流入']) },
        { l: '今日散户净流入', v: num(row['今日散户净流入']) },
        { l: '5日主力净流入', v: num(row['5日主力净流入']) },
        { l: '5日超大单净额', v: num(row['5日超大单净额']) },
      ]
    : []

  return (
    <div className="mt-2.5">
      <h3 className="mb-1.5 text-xs font-medium text-slate-500">资金 · 当日/5日</h3>
      <div className="rounded-lg border border-slate-100 bg-slate-50/40 px-2 py-1.5">
        {loading ? (
          <div className="py-2 text-center text-[10px] text-slate-300">资金流加载中…</div>
        ) : !row || !items.length ? (
          <div className="py-2 text-center text-[10px] text-slate-300">暂无资金流数据</div>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-1">
              {items.map((it) => (
                <div key={it.l} className="min-w-0 rounded bg-white px-1.5 py-1">
                  <div className="truncate text-[9px] text-slate-400">{it.l}</div>
                  <div
                    className="font-mono text-[11px] font-semibold tabular-nums"
                    style={{ color: it.v > 0 ? UP : it.v < 0 ? DOWN : '#94a3b8' }}
                  >
                    {it.v > 0 ? '+' : ''}
                    {fmtBigNum(it.v)}
                  </div>
                </div>
              ))}
            </div>
            <div className="mt-1 text-[8px] leading-relaxed text-slate-300">
              ⚠️ 仅作方向确认（相对排名 / 5日持续性），不作买卖信号
            </div>
          </>
        )}
      </div>
    </div>
  )
}
