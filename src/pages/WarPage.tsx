/**
 * 盘中模式页（N4：WarPage）。
 *
 * 依据 WATCH-METHODOLOGY §5「盘中」与 PRODUCT-DESIGN §5.3「盘中模式页」：
 *   顶部：会话时钟（server_info）驱动时段标签 + 温度计档位；
 *   盘中模式：事件流（增量）+ 板块脉冲 + 局势归类（Q2）+ 持仓决策条（Q3）；
 *   竞价模式：竞价雷达（auction 特征化 + 对照矩阵 + 陷阱过滤）。
 *
 * 数据：event-stream（unusual×3+market_monitor×3，30s 增量）、
 *   board-pulse（热度板差分）、situation（局势归类）、
 *   auction（竞价逐点）、regime（温度计）。
 */

import { useCallback, useEffect, useReducer, useRef, useState } from 'react'
import { RefreshCw, Zap, Target, Activity } from 'lucide-react'
import { captureOnce, getEvents, isPostClose, type EventItem } from '@/lib/event-stream'
import { buildClock, phaseIcon, phaseLabel, type SessionPhase } from '@/lib/session-clock'
import { callToolJson } from '@/lib/stock-data'
import { detectBoardPulse, type HeatBoard, type BoardPulse } from '@/lib/board-pulse'
import { judgeSituation, situationLabel, situationColor, type Situation } from '@/lib/situation'
import { computeRegime, type Regime, bandLabel, bandColor } from '@/lib/regime'
import { loadLadder, type LadderSnapshot } from '@/lib/ladder'
import { fetchAllA, computeBreadth, type AShareRow } from '@/lib/market'
import { getLatestPlan, getReview, subscribeReview, today } from '@/lib/review-store'
import { getDayRun, subscribeDayRun } from '@/lib/dayrun'
import { getPositions, subscribePositions } from '@/lib/positions'
import { getWatchlist, subscribeWatchlist, type WatchItem } from '@/lib/watchlist-store'
import { AuctionRadar } from '@/components/AuctionRadar'
import { PositionDesk } from '@/components/PositionDesk'
import { SessionMission } from '@/components/SessionMission'
import { ExpectVerdictPanel } from '@/components/ExpectVerdictPanel'
import { QAnswers } from '@/components/QAnswers'
import type { MarketTag } from '@/lib/symbol'
import type { OpenStock } from '@/panel/PanelApp'

interface Props {
  onOpenStock: (s: OpenStock) => void
}

const CAPTURE_MS = 30_000

export function WarPage({ onOpenStock }: Props) {
  const [phase, setPhase] = useState<SessionPhase>('closed')
  const [events, setEvents] = useState<EventItem[]>([])
  const [pulses, setPulses] = useState<BoardPulse[]>([])
  const [situation, setSituation] = useState<Situation>('normal')
  const [regime, setRegime] = useState<Regime | null>(null)
  const [watchlist, setWatchlist] = useState<WatchItem[]>(() => getWatchlist())
  const [loading, setLoading] = useState(true)
  const [msg, setMsg] = useState('')
  const busyRef = useRef(false)
  const abortRef = useRef<AbortController | null>(null)
  // 当日任务进度变更（dayrun 判定/Q 卡、持仓、复盘存档）→ 触发任务条重算
  const [, force] = useReducer((x: number) => x + 1, 0)

  // 自选订阅（竞价观察池；变更时静默更新，不打断盘中轮询）
  useEffect(() => subscribeWatchlist(() => setWatchlist(getWatchlist())), [])
  // N8：任务进度订阅（判定写回 / Q 卡答案 / 持仓变化 / 今日复盘存档）
  useEffect(() => subscribeDayRun(force), [])
  useEffect(() => subscribePositions(force), [])
  useEffect(() => subscribeReview(force), [])

  /** 竞价窗口（9:15–9:25）展示竞价雷达。 */
  const showRadar = phase === 'auction'

  // N8：当日任务进度（SessionMission 输入）
  const day = today()
  const plan = getLatestPlan(day)
  const planExpectations = plan?.expectations ?? []
  const run = getDayRun(day)
  const positions = getPositions()
  const judgedCount = planExpectations.filter((e) => run?.verdicts[e.symbol]).length
  const q3Answered = positions.filter((p) => run?.q3?.bySymbol[p.symbol]).length
  const missionProps = {
    phase,
    expectationsTotal: planExpectations.length,
    expectationsJudged: judgedCount,
    q1: !!run?.q1,
    q2: !!run?.q2,
    q3AnsweredPositions: q3Answered,
    positionCount: positions.length,
    q3Idle: !!run?.q3?.idle,
    hasTodayReview: !!getReview(day),
  }

  const load = useCallback(async (force = false) => {
    if (busyRef.current) return
    busyRef.current = true
    if (abortRef.current) abortRef.current.abort()
    const ac = new AbortController()
    abortRef.current = ac
    try {
      // 会话时段：server_info 驱动（失败则维持当前 phase，不影响主体加载）
      let curPhase = phase
      try {
        const info = await callToolJson('server_info', {})
        curPhase = buildClock(info ?? null).phase
        if (!ac.signal.aborted) setPhase(curPhase)
      } catch { /* 忽略：沿用上一时段 */ }

      // 休市/周末：避免每 30s 向数据源发起全量请求（不可用时造成 15s 超时风暴）；
      // 手动刷新（force）仍允许查看最近交易日快照
      if (curPhase === 'closed' && !force) {
        setLoading(false)
        setMsg('休市时段：切「复盘」页做复盘 · 手动刷新可看最近交易日快照')
        setTimeout(() => setMsg(''), 3000)
        return
      }

      const added = await captureOnce(ac.signal)
      setEvents(getEvents())
      const allRows = await fetchAllA(true)
      const breadth = computeBreadth(allRows)
      const ladder = await loadLadder(ac.signal)
      const maxStreak = ladder.limitUp.reduce((m, s) => Math.max(m, s.streak), 0)
      // 无真实行情（数据源不可用）→ 温度计/局势置空，避免占位公式给出误导数值
      const noMarket = breadth.up + breadth.down + ladder.limitUp.length + ladder.limitDownCount === 0
      const r: Regime | null = noMarket
        ? null
        : computeRegime({
            limitUp: ladder.limitUp.length,
            limitDown: ladder.limitDownCount,
            maxStreak,
            promoteRate: 0.4,
            brokenRate: 0.2,
            firstBoardPremium: 1.5,
            upRatio: breadth.up / Math.max(1, breadth.up + breadth.down),
            amountYi: breadth.amountSum / 1e8,
          })
      setRegime(r)
      const heat: HeatBoard[] = noMarket ? [] : ladder.boards.slice(0, 8).map((b) => ({ boardSymbol: b.boardSymbol, name: b.name }))
      const newPulses = await detectBoardPulse(heat, new Map(), undefined, 4)
      setPulses(newPulses)
      const s: Situation = r
        ? judgeSituation({
            regime: r,
            events: getEvents(),
            pulses: newPulses,
            oldLeaderAtLimit: ladder.limitUp.some((x) => x.streak >= 4),
            oldLeaderBroken: false,
            highStreakCount: ladder.limitUp.filter((x) => x.streak >= 4).length,
            lowNewLimitUp: ladder.limitUp.filter((x) => x.streak === 1).length,
            indexPct: 0,
            upRatio: breadth.up / Math.max(1, breadth.up + breadth.down),
            limitDown: ladder.limitDownCount,
            promoteRate: 0.4,
            brokenRate: 0.2,
            limitUp: ladder.limitUp.length,
          })
        : 'normal'
      setSituation(s)
      if (added) setMsg('+' + added + ' 条事件')
      setTimeout(() => setMsg(''), 2000)
    } catch (e) {
      if (!ac.signal.aborted) setMsg('加载失败：' + (e as Error).message)
    } finally {
      busyRef.current = false
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
    const timer = window.setInterval(() => void load(), CAPTURE_MS)
    return () => { window.clearInterval(timer); abortRef.current && abortRef.current.abort() }
  }, [load])

  const isPost = isPostClose(phase)

  return (
    <div className="h-full overflow-y-auto px-2.5 pb-3">
      <div className="-mx-2.5 mb-1.5 border-b border-slate-100 px-2.5 pb-1.5 pt-2">
        <div className="flex items-center justify-between">
          <span className="flex items-center gap-1.5 text-[13px] font-semibold text-slate-800">
            <Activity className="h-3.5 w-3.5 text-emerald-500" />作战
          </span>
          <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-500">
            {phaseIcon(phase)} {phaseLabel(phase)}
          </span>
        </div>
        {regime && (
          <div className="mt-1.5 flex items-center gap-2">
            <span className="text-[9px] text-slate-400">温度计</span>
            <span className="font-mono text-[12px] font-bold tabular-nums" style={{ color: bandColor(regime.band) }}>{regime.temperature}</span>
            <span className="rounded bg-slate-200 px-1 text-[8px] text-slate-600">{bandLabel(regime.band)}</span>
            <span className="ml-auto rounded px-1.5 py-0.5 text-[9px] font-medium text-white" style={{ background: situationColor(situation) }}>{situationLabel(situation)}</span>
          </div>
        )}
        {!regime && !loading && (
          <div className="mt-1 text-[9px] text-slate-300">温度计暂无数据（行情源不可用 / 休市）</div>
        )}
      </div>

      {msg && <div className="mb-1.5 rounded bg-amber-50 px-2 py-1 text-[10px] text-amber-600">{msg}</div>}
      {loading && !events.length && <div className="py-8 text-center text-xs text-slate-300">盘中数据加载中…</div>}

      {/* N8 时段任务条：每个时段该完成的唯一目标 + 检查清单 + 倒计时 */}
      <SessionMission {...missionProps} />

      {/* N8 昨日预期 × 今日竞价判定（竞价/盘前展示，逐条写回 dayrun） */}
      {(phase === 'auction' || phase === 'premarket') && (
        <ExpectVerdictPanel day={day} />
      )}

      {/* N8 竞价雷达：仅竞价时段（9:15–9:25）展示，与昨日预期对照 */}
      {showRadar && (
        <div className="mb-1.5 rounded-md border border-slate-100 bg-slate-50/60 px-2 py-1.5">
          <AuctionRadar onOpenStock={onOpenStock} watchlist={watchlist} />
        </div>
      )}

      {/* N8 盘中三问必答卡：盘中只答 Q1-Q3（系统局势候选仅在温度计有数据时提供） */}
      {phase === 'trading' && <QAnswers autoSituation={regime ? situation : null} />}

      <div className="mb-1.5 rounded-md border border-slate-100 bg-slate-50/60 px-2 py-1.5">
        <div className="mb-1 text-[10px] font-medium text-slate-400">局势</div>
        <div className="text-[11px] leading-relaxed text-slate-600">{situationLabel(situation)}</div>
      </div>

      {pulses.length > 0 && (
        <div className="mb-1.5 rounded-md border border-slate-100 bg-slate-50/60 px-2 py-1.5">
          <div className="mb-1 flex items-center gap-1 text-[10px] font-medium text-slate-400">
            <Zap className="h-3 w-3 text-amber-500" />板块脉冲
          </div>
          <ul className="space-y-0.5">
            {pulses.slice(0, 5).map((p) => (
              <li key={p.board} className="flex items-center justify-between rounded px-1 py-0.5 bg-white">
                <span className="min-w-0 flex-1 truncate text-[11px] text-slate-600">{p.name}</span>
                <span className="shrink-0 font-mono text-[9px] text-red-500">+{p.deltaLimitUp} 板</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="mb-1.5 rounded-md border border-slate-100 bg-slate-50/60 px-2 py-1.5">
        <div className="mb-1 flex items-center justify-between">
          <span className="flex items-center gap-1 text-[10px] font-medium text-slate-400">
            <Target className="h-3 w-3 text-red-500" />事件流 · {events.length} 条
          </span>
          <button onClick={() => void load(true)} className="rounded p-0.5 text-slate-300 hover:bg-slate-100 hover:text-slate-500" title="强制刷新（休市时也可拉最近交易日快照）">
            <RefreshCw className="h-3 w-3" />
          </button>
        </div>
        {isPost && <div className="mb-1 rounded bg-amber-50 px-1.5 py-0.5 text-[8px] text-amber-600">⚠️ 收盘后事件流只读（unusual 退化为竞价快照）</div>}
        <ul className="space-y-0.5 max-h-32 overflow-y-auto">
          {events.slice(0, 30).map((e) => (
            <li key={e.key} onClick={() => onOpenStock({ market: e.market, code: e.code, name: e.name })} className="flex cursor-pointer items-center gap-1 rounded px-1 py-0.5 hover:bg-white">
              <span className={'shrink-0 rounded px-1 text-[8px] font-medium ' + eventColor(e.kind)}>{kindLabel(e.kind)}</span>
              <span className="min-w-0 flex-1 truncate text-[10px] text-slate-600">{e.name}</span>
              <span className="shrink-0 font-mono text-[8px] text-slate-300">{e.time}</span>
            </li>
          ))}
        </ul>
      </div>

      {/* N6 持仓决策台：加仓/平仓(记日志)/自统计/凯利建议 */}
      <PositionDesk band={regime ? regime.band : null} />
    </div>
  )
}

function eventColor(kind: EventItem['kind']): string {
  switch (kind) {
    case 'limitUp': return 'text-red-600 bg-red-50'
    case 'limitDown': return 'text-green-600 bg-green-50'
    case 'break': return 'text-amber-600 bg-amber-50'
    case 'surge': return 'text-red-600 bg-red-50'
    case 'bigOrder': return 'text-blue-600 bg-blue-50'
    default: return 'text-slate-600 bg-slate-50'
  }
}

function kindLabel(kind: EventItem['kind']): string {
  switch (kind) {
    case 'limitUp': return '涨停'
    case 'limitDown': return '跌停'
    case 'break': return '炸板'
    case 'surge': return '拉升'
    case 'bigOrder': return '大单'
    default: return kind
  }
}
