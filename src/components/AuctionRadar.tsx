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
 *
 * ── I3（错误契约贯通）改了什么 ──
 * 旧版逐项 worker 是 `catch { return null }`，唯一的整体 catch 只写一句琥珀色小字：
 * 结果是"40 只全挂"和"今天没有竞价特征"在界面上完全同形 —— 空面板、无原因、无出路。
 * 现在：逐项失败**分桶计数**（报价失败 / 无竞价逐点数据 / 特征不足），真失败给出
 * `ErrorBar`（分类 + 人话 + 原因 + 重试），"非失败的空桶"也如实显示计数，
 * 区分"取数挂了"与"9:15 前本来就没有逐点数据"。
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
import { toToolError } from '@/lib/mcp'
import type { MarketTag } from '@/lib/symbol'
import type { OpenStock } from '@/panel/PanelApp'
import { ErrorBar } from './ErrorBar'

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

/**
 * 逐项结果（**不再用 `null` 表示"失败"**：null 没法区分"没数据"与"取数挂了"）。
 *   quote   —— 报价这一路失败（异常或空返回）：真失败，要有出路；
 *   auction —— 竞价逐点数据取不到：多数是没到 9:15 或该票当日无逐点，**如实计数但不算故障**；
 *   feature —— 有逐点数据但特征算不出来（点太少/价不合法），算降级，如实计数。
 */
type ItemOutcome =
  | { ok: true; row: RadarRow }
  | { ok: false; why: 'quote' | 'auction' | 'feature'; err?: unknown }

/** 一轮加载的体检结果（计数必须可见：审计要求"逐项失败的计数/原因要可见"）。 */
interface LoadDiag {
  total: number
  /** 真失败（报价这一路）数量。>0 时渲染可重试的 ErrorBar。 */
  failed: number
  /** 无竞价逐点数据的只数（非故障，通常是时段问题）。 */
  noAuction: number
  /** 有逐点但特征不足的只数。 */
  noFeature: number
  /** 真失败的原因样本（第一个），给 ErrorBar 显示原文。 */
  reason: unknown
}

const REFRESH_MS = 15_000
/** 观察池上限（PRODUCT-DESIGN §7 预算：竞价时段 ×≤40 标的）。 */
const WATCH_CAP = 40

export function AuctionRadar({ onOpenStock, watchlist }: Props) {
  const [rows, setRows] = useState<RadarRow[]>([])
  const [loading, setLoading] = useState(true)
  const [msg, setMsg] = useState('')
  const [diag, setDiag] = useState<LoadDiag | null>(null)
  const [fatal, setFatal] = useState<unknown>(null)
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
      const found = await runPool<(typeof pool)[number], ItemOutcome>(
        pool,
        async (item): Promise<ItemOutcome> => {
          let q: Awaited<ReturnType<typeof fetchQuote>>
          try {
            q = await fetchQuote(item.market, item.code)
          } catch (e) {
            return { ok: false, why: 'quote', err: e }
          }
          // 报价空返回也是"这一路没取到数"，不能当作"今天没行情"默默跳过
          if (!q) return { ok: false, why: 'quote', err: new Error(`${item.market}${item.code} 报价空返回`) }

          let points: AuctionPoint[] = []
          let auctionErr: unknown = null
          try {
            const data = (await callToolJson('auction', { market: item.market, code: item.code })) as any
            points = Array.isArray(data)
              ? (data as AuctionPoint[])
              : Array.isArray(data && data.items)
                ? (data.items as AuctionPoint[])
                : []
          } catch (e) {
            // auction 无数据（未到竞价时段/该票当日无逐点）会走到这里：**记住原因、继续算**，
            // 但不当作故障 —— 由调用方分桶计数后如实显示。旧版这里直接吞掉，才导致"空面板无原因"。
            auctionErr = e
          }
          if (points.length === 0) return { ok: false, why: 'auction', err: auctionErr }

          const a = analyzeAuction(points, Number(q.pre_close), Number(q.buy_price_limit))
          if (!a) return { ok: false, why: 'feature', err: auctionErr }
          const exp = prev?.expectations?.find((e) => e.symbol === `${item.market}${item.code}`)
          const verdict = judgeExpectation((exp && exp.state) || 'divergence', a, true)
          return {
            ok: true,
            row: { ...a, market: item.market, code: item.code, name: item.name, verdict, streak: 0, boardTrend: 'flat' },
          }
        },
        { concurrency: 4, signal: ac.signal },
      )

      // 分桶统计（runPool 会把 worker 抛出的项置 null；这里 worker 从不抛，null 只可能是取消）
      const ok: RadarRow[] = []
      let failed = 0
      let noAuction = 0
      let noFeature = 0
      let reason: unknown = null
      for (const r of found) {
        if (r === null) continue
        if (r.ok) {
          ok.push(r.row)
          continue
        }
        if (r.why === 'quote') {
          failed += 1
          if (reason === null) reason = r.err
        } else if (r.why === 'auction') {
          noAuction += 1
          if (reason === null) reason = r.err
        } else {
          noFeature += 1
        }
      }

      if (!ac.signal.aborted) {
        setRows(ok)
        setDiag({ total: pool.length, failed, noAuction, noFeature, reason })
        // 真失败：不留"完成"的假象（旧版无论挂多少只都会走到这里说"竞价特征就绪"）
        setMsg(failed === 0 ? '竞价特征就绪' : '')
        setFatal(null)
        if (failed === 0) window.setTimeout(() => setMsg(''), 2000)
      }
    } catch (e) {
      if (!ac.signal.aborted) {
        setFatal(e)
        setDiag(null)
        setMsg('')
      }
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

  const poolSize = Math.min(watchlist.length, WATCH_CAP)
  /** 非故障的"空桶"计数行：区分"取数挂了"与"9:15 前本来就没有逐点数据"。 */
  const partialLine =
    diag !== null && diag.failed === 0 && diag.noAuction + diag.noFeature > 0 ? (
      <div className="dc-flat mb-1.5 dc-t-data leading-snug">
        本轮 {diag.total} 只：无竞价逐点数据 {diag.noAuction} 只
        {diag.noFeature > 0 ? ` · 特征不足 ${diag.noFeature} 只` : ''}
        {diag.noAuction > 0 ? '（9:15 前、停牌或该票当日无逐点，都算这一类）' : ''}
      </div>
    ) : null

  return (
    <div>
      <div className="mb-1 flex items-center justify-between">
        <span className="dc-t-data font-medium text-slate-400">竞价雷达 · {poolSize} 只观察池</span>
        <button
          onClick={() => void load()}
          className="rounded p-0.5 text-slate-300 hover:bg-slate-100 hover:text-slate-500"
          title="刷新"
        >
          <RefreshCw className={`h-3 w-3 ${loading ? 'animate-spin' : ''}`} />
        </button>
      </div>

      {msg && <div className="mb-1.5 rounded bg-amber-50 px-2 py-1 dc-t-data text-amber-600">{msg}</div>}

      {/* 整体失败（不会走到这里的话，40 只全挂也会显示成"完成"） */}
      {fatal !== null && (
        <ErrorBar className="mb-1.5" error={fatal} onRetry={() => void load()} title="竞价雷达加载失败" />
      )}

      {/* 逐项失败：计数 + 首个原因 + 重试（旧版这里是彻底静默的空面板） */}
      {diag !== null && diag.failed > 0 && (
        <ErrorBar
          className="mb-1.5"
          error={diag.reason ?? toToolError('竞价特征取数失败（原因未记录）', null, 'quote')}
          onRetry={() => void load()}
          retryLabel="重试"
          title={`有 ${diag.failed}/${diag.total} 只取数失败`}
          extra={`成功 ${diag.total - diag.failed - diag.noAuction - diag.noFeature} 只 · 无竞价逐点 ${
            diag.noAuction
          } 只${diag.noFeature > 0 ? ` · 特征不足 ${diag.noFeature} 只` : ''}｜上面是第一条失败原因，其余多为同类。`}
          onDismiss={() => setDiag(null)}
        />
      )}

      {partialLine}

      {loading && rows.length === 0 && (
        <div className="py-6 text-center text-xs text-slate-300">9:15 后拉取竞价特征…</div>
      )}

      {/* 取到数但一只都没算出特征：也要说清是"没数据"还是"没到点"，别留一个说不出话的空面板 */}
      {!loading && rows.length === 0 && fatal === null && (diag === null || diag.failed === 0) && (
        <div className="py-4 text-center dc-t-data text-slate-300">
          当前没有可判定的竞价特征（逐点数据要在 9:15–9:25 之间才有）
        </div>
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
                  <span className="min-w-0 flex-1 truncate dc-t-note font-semibold text-slate-700">{r.name}</span>
                  <span className="shrink-0 font-mono dc-t-micro text-slate-300">{r.code}</span>
                </button>
                <span
                  className="shrink-0 rounded px-1.5 py-0.5 dc-t-micro font-medium"
                  style={{ color: vc, background: vc + '1a' }}
                >
                  {verdictLabel(r.verdict)}
                </span>
              </div>
              <div className="mt-0.5 flex flex-wrap gap-x-2 gap-y-0.5 dc-t-micro text-slate-400">
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
