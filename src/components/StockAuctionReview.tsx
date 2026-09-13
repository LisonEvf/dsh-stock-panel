/**
 * 个股竞价回顾（N7）。
 *
 * 当日 auction（9:15–9:24:57 逐点 matched/unmatched）→ analyzeAuction 强度特征摘要：
 *   竞价开幅 / 是否贴板 / 末端冲刺方向 / 撤单诱多特征 / 竞价总匹配量。
 * 用途：复盘时回看当日竞价、次日开盘对照竞价质量（WATCH-METHODOLOGY §4）。
 * ⚠️ unmatched 正负号语义待协议冒烟定论（见 PRODUCT-DESIGN §2.3）。
 */

import { useMemo } from 'react'
import { fetchAuctionSeries, fetchQuote } from '@/lib/stock-data'
import { analyzeAuction, type AuctionFeatures } from '@/lib/auction-analysis'
import { useSwr, swrKey } from '@/lib/cache'
import type { MarketTag } from '@/lib/symbol'

interface Props {
  market: MarketTag
  code: string
}

const UP = 'var(--dc-up)'
const DOWN = 'var(--dc-down)'

export function StockAuctionReview({ market, code }: Props) {
  // 懒加载缓存：报价 + 竞价序列分离缓存，命中立即回看，失败下线重试。
  const quotesSwr = useSwr(swrKey.quote(market, code), () => fetchQuote(market, code), { ttl: 60_000 })
  const auctionSwr = useSwr(swrKey.auction(market, code), () => fetchAuctionSeries(market, code), { ttl: 60_000 })
  const loading = quotesSwr.status === 'loading' || auctionSwr.status === 'loading'

  const feat = useMemo<AuctionFeatures | null>(() => {
    const q = quotesSwr.data
    const pts = auctionSwr.data ?? []
    const a = analyzeAuction(pts, Number(q && q.pre_close), Number(q && q.buy_price_limit))
    return a
  }, [quotesSwr.data, auctionSwr.data])

  return (
    <div className="mt-2.5">
      <h3 className="mb-1.5 text-xs font-medium text-slate-500">竞价回顾（当日）</h3>
      <div className="rounded-lg border border-slate-100 bg-slate-50/40 px-2 py-1.5">
        {loading ? (
          <div className="py-2 text-center dc-t-data text-slate-300">竞价数据加载中…</div>
        ) : !feat ? (
          <div className="py-2 text-center dc-t-data text-slate-300">当日暂无竞价数据</div>
        ) : (
          <>
            <div className="flex flex-wrap gap-x-2.5 gap-y-1 dc-t-data">
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
            <div className="mt-1 dc-t-micro text-slate-300">竞价总匹配量 {feat.matchedTotal.toLocaleString()} · 盘后仍可回看当日竞价</div>
          </>
        )}
      </div>
    </div>
  )
}
