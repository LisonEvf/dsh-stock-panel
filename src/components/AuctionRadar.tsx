/**
 * 竞价雷达（N2：AuctionRadar）。
 *
 * 依据 WATCH-METHODOLOGY §4「竞价与开盘」与 PRODUCT-DESIGN §5.1 竞价雷达：
 *   1. 9:25 后拉 auction 工具（当日 09:15-09:24:57 逐点 matched/unmatched）；
 *   2. 特征化（analyzeAuction）：openPct / nearLimit / slope920_925 / climaxDir /
 *      fakeBigThenDrop；
 *   3. 与昨日预期对照（judgeExpectation）→ 对照矩阵判定；
 *   4. 陷阱过滤（isFalseStrong，N4 盘中数据可得后再启用）。
 *
 * ⚠️ 实现前须冒烟验证：unmatched 正负号语义、matched 单位、price≈buy_price_limit 判定。
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { RefreshCw } from 'lucide-react'
import { callToolJson, fetchQuote } from '@/lib/stock-data'
import {
  analyzeAuction,
  judgeExpectation,
  verdictColor,
  verdictLabel,
  type AuctionFeatures,
  type AuctionPoint,
  type Verdict,
} from '@/lib/auction-analysis'
import { getReview, today } from '@/lib/review-store'
import { runPool } from '@/lib/pool'
import type { MarketTag } from '@/lib/symbol'
import type { OpenStock } from '@/panel/PanelApp'

interface Props {
  onOpenStock: (s: OpenStock) => void
  watchlist: { market: MarketTag; code: string; name: string }[]
}

/** 竞价雷达行 = 特征 + 标的身份 + 判定。 */
interface RadarRow extends AuctionFeatures {
  market: MarketTag
  code: string
  name: string
  verdict: Verdict
  streak: number
  boardTrend: string
}

const REFRESH_MS = 15_000
/** 观察池上限（PRODUCT-DESIGN §7 预算：竞价时段 ×≤40 标的）。 */
const WATCH_CAP = 40

export function AuctionRadar({ onOpenStock, watchlist }: Props) {
  const [rows, setRows] = useState<RadarRow[]>([])
  const [loading, setLoading] = useState(true)
  const [msg, setMsg] = useState('')
  const busyRef = useRef(false)
  const abortRef = useRef<AbortController | null>(null)

  const load = useCallback(async () => {
    if (busyRef.current) return
    busyRef.current = true
    if (abortRef.current) abortRef.current.abort()
    const ac = new AbortController()
    abortRef.current = ac
    try {
      const day = today()
      const prev = getReview(day)
      const pool = watchlist.slice(0, WATCH_CAP)
      const found = await runPool(
        pool,
        async (item): Promise<RadarRow | null> => {
          try {
            const q = await fetchQuote(item.market, item.code)
            if (!q) return null
            let points: AuctionPoint[] = []
            try {
               
              const data = (await callToolJson('auction', { market: item.market, code: item.code })) as any
              points = Array.isArray(data)
                ? (data as AuctionPoint[])
                : Array.isArray(data && data.items)
                  ? (data.items as AuctionPoint[])
                  : []
            } catch {
              /* auction 可能无数据（如未到竞价时段） */
            }
            const a = analyzeAuction(points, Number(q.pre_close), Number(q.buy_price_limit))
            if (!a) return null
            const exp = prev?.expectations?.find((e) => e.symbol === `${item.market}${item.code}`)
            const verdict = judgeExpectation((exp && exp.state) || 'divergence', a, true)
            return { ...a, market: item.market, code: item.code, name: item.name, verdict, streak: 0, boardTrend: 'flat' }
          } catch {
            return null
          }
        },
        { concurrency: 4, signal: ac.signal },
      )
      if (!ac.signal.aborted) {
        setRows(found.filter((r): r is RadarRow => r !== null))
        setMsg('竞价特征就绪')
        window.setTimeout(() => setMsg(''), 2000)
      }
    } catch (e) {
      if (!ac.signal.aborted) setMsg('竞价加载失败：' + (e as Error).message)
    } finally {
      busyRef.current = false
      setLoading(false)
    }
  }, [watchlist])

  useEffect(() => {
    void load()
    const timer = window.setInterval(() => {
      // 后台标签页不轮询（B3：竞价雷达是 ≤40 标的的批量请求，最不该在后台空跑）
      if (document.hidden) return
      void load()
    }, REFRESH_MS)
    return () => {
      window.clearInterval(timer)
      if (abortRef.current) abortRef.current.abort()
    }
  }, [load])

  return (
    <div>
      <div className="mb-1 flex items-center justify-between">
        <span className="text-[10px] font-medium text-slate-400">
          竞价雷达 · {Math.min(watchlist.length, WATCH_CAP)} 只观察池
        </span>
        <button
          onClick={() => void load()}
          className="rounded p-0.5 text-slate-300 hover:bg-slate-100 hover:text-slate-500"
          title="刷新"
        >
          <RefreshCw className={`h-3 w-3 ${loading ? 'animate-spin' : ''}`} />
        </button>
      </div>

      {msg && <div className="mb-1.5 rounded bg-amber-50 px-2 py-1 text-[10px] text-amber-600">{msg}</div>}

      {loading && rows.length === 0 && (
        <div className="py-6 text-center text-xs text-slate-300">9:15 后拉取竞价特征…</div>
      )}

      <ul className="space-y-1">
        {rows.map((r) => {
          const vc = verdictColor(r.verdict)
          return (
            <li key={`${r.market}${r.code}`} className="rounded-md border border-slate-100 bg-white px-2 py-1.5">
              <div className="flex items-center justify-between">
                <button
                  onClick={() => onOpenStock({ market: r.market, code: r.code, name: r.name })}
                  className="flex min-w-0 items-center gap-1.5 text-left"
                  title={`${r.name} ${r.code}`}
                >
                  <span className="min-w-0 flex-1 truncate text-[11px] font-semibold text-slate-700">{r.name}</span>
                  <span className="shrink-0 font-mono text-[8px] text-slate-300">{r.code}</span>
                </button>
                <span
                  className="shrink-0 rounded px-1.5 py-0.5 text-[8px] font-medium"
                  style={{ color: vc, background: vc + '1a' }}
                >
                  {verdictLabel(r.verdict)}
                </span>
              </div>
              <div className="mt-0.5 flex flex-wrap gap-x-2 gap-y-0.5 text-[8px] text-slate-400">
                <span>
                  开 {r.openPct >= 0 ? '+' : ''}
                  {r.openPct.toFixed(1)}%
                </span>
                <span>{r.nearLimit ? '封板' : '未封'}</span>
                <span>{r.climaxDir === 'buy' ? '冲刺买' : r.climaxDir === 'sell' ? '冲刺卖' : '平'}</span>
                {r.fakeBigThenDrop && <span className="text-amber-600">诱多!</span>}
              </div>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
