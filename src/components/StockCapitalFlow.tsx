/**
 * 个股资金面板（N7）。
 *
 * ⚠️ 依据 STRATEGY-RESEARCH §3：主力资金流（净流入/大单）是可被操纵、与散户博弈的异象，
 * 只可作「相对排名 / 5 日方向」的方向确认，**不可单独作为买卖信号**——页面附提示。
 */

import { useMemo } from 'react'
import { fetchCapitalFlow, type CapitalFlowRow } from '@/lib/stock-data'
import { useSwr, swrKey } from '@/lib/cache'
import { fmtBigNum } from '@/lib/format'
import type { MarketTag } from '@/lib/symbol'

interface Props {
  market: MarketTag
  code: string
}

const UP = 'var(--dc-up)'
const DOWN = 'var(--dc-down)'

export function StockCapitalFlow({ market, code }: Props) {
  // 懒加载缓存：命中缓存秒开，后台验证失败自动下线重试（避免以假乱真）。
  const { data: row, status } = useSwr<CapitalFlowRow | null>(
    swrKey.capitalFlow(market, code),
    () => fetchCapitalFlow(market, code),
    { ttl: 60_000 },
  )
  const loading = status === 'loading'

  const num = (v: unknown): number => {
    const n = Number(v)
    return Number.isFinite(n) ? n : 0
  }

  const items = useMemo<{ l: string; v: number }[]>(() => {
    if (!row) return []
    return [
      { l: '今日主力净流入', v: num(row['今日主力净流入']) },
      { l: '今日散户净流入', v: num(row['今日散户净流入']) },
      { l: '5日主力净流入', v: num(row['5日主力净流入']) },
      { l: '5日超大单净额', v: num(row['5日超大单净额']) },
    ]
  }, [row])

  return (
    <div className="mt-2.5">
      <h3 className="mb-1.5 text-xs font-medium text-slate-500">资金 · 当日/5日</h3>
      <div className="rounded-lg border border-slate-100 bg-slate-50/40 px-2 py-1.5">
        {loading ? (
          <div className="py-2 text-center dc-t-data text-slate-300">资金流加载中…</div>
        ) : !row || !items.length ? (
          <div className="py-2 text-center dc-t-data text-slate-300">暂无资金流数据</div>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-1">
              {items.map((it) => (
                <div key={it.l} className="min-w-0 rounded bg-white px-1.5 py-1">
                  <div className="truncate dc-t-micro text-slate-400">{it.l}</div>
                  <div
                    className="font-mono dc-t-note font-semibold tabular-nums"
                    style={{ color: it.v > 0 ? UP : it.v < 0 ? DOWN : '#94a3b8' }}
                  >
                    {it.v > 0 ? '+' : ''}
                    {fmtBigNum(it.v)}
                  </div>
                </div>
              ))}
            </div>
            <div className="mt-1 dc-t-micro leading-relaxed text-slate-300">
              ⚠️ 仅作方向确认（相对排名 / 5日持续性），不作买卖信号
            </div>
          </>
        )}
      </div>
    </div>
  )
}
