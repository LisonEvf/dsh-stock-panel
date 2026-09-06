/**
 * 个股竞价回顾（N7）。
 *
 * 当日 auction（9:15–9:24:57 逐点 matched/unmatched）→ analyzeAuction 强度特征摘要：
 *   竞价开幅 / 是否贴板 / 末端冲刺方向 / 撤单诱多特征 / 竞价总匹配量。
 * 用途：复盘时回看当日竞价、次日开盘对照竞价质量（WATCH-METHODOLOGY §4）。
 * ⚠️ unmatched 正负号语义待协议冒烟定论（见 PRODUCT-DESIGN §2.3）。
 */

import { useEffect, useState } from 'react'
import { fetchAuctionSeries, fetchQuote } from '@/lib/stock-data'
import { analyzeAuction, type AuctionFeatures } from '@/lib/auction-analysis'
import type { MarketTag } from '@/lib/symbol'

interface Props {
  market: MarketTag
  code: string
}

const UP = '#c74040'
const DOWN = '#2d9b65'

export function StockAuctionReview({ market, code }: Props) {
  const [feat, setFeat] = useState<AuctionFeatures | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let alive = true
    setLoading(true)
    setFeat(null)
    ;(async () => {
      const [q, pts] = await Promise.all([
        fetchQuote(market, code),
        fetchAuctionSeries(market, code),
      ])
      if (!alive) return
      const a = analyzeAuction(pts, Number(q && q.pre_close), Number(q && q.buy_price_limit))
      if (alive) {
        setFeat(a)
        setLoading(false)
      }
    })()
    return () => {
      alive = false
    }
  }, [market, code])

  return (
    <div className="mt-2.5">
      <h3 className="mb-1.5 text-xs font-medium text-slate-500">竞价回顾（当日）</h3>
      <div className="rounded-lg border border-slate-100 bg-slate-50/40 px-2 py-1.5">
        {loading ? (
          <div className="py-2 text-center text-[10px] text-slate-300">竞价数据加载中…</div>
        ) : !feat ? (
          <div className="py-2 text-center text-[10px] text-slate-300">当日暂无竞价数据</div>
        ) : (
          <>
            <div className="flex flex-wrap gap-x-2.5 gap-y-1 text-[10px]">
              <span className="font-mono font-semibold tabular-nums" style={{ color: feat.openPct >= 0 ? UP : DOWN }}>
                竞价开 {feat.openPct >= 0 ? '+' : ''}
                {feat.openPct.toFixed(1)}%
              </span>
              <span className="text-slate-500">{feat.nearLimit ? '贴板' : '未贴板'}</span>
              <span className="text-slate-500">
                {feat.climaxDir === 'buy' ? '冲刺买' : feat.climaxDir === 'sell' ? '冲刺卖' : '竞价平稳'}
              </span>
              {feat.fakeBigThenDrop && <span className="font-medium text-amber-600">⚠ 撤单诱多特征</span>}
            </div>
            <div className="mt-1 text-[9px] text-slate-300">竞价总匹配量 {feat.matchedTotal.toLocaleString()} · 盘后仍可回看当日竞价</div>
          </>
        )}
      </div>
    </div>
  )
}
