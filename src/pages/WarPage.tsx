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
import {
  buildClock,
  phaseIcon,
  phaseLabel,
  type ServerInfo,
  type SessionClock,
  type SessionPhase,
} from '@/lib/session-clock'
import { minuteOfDay, stageOf, STAGES, type Stage } from '@/lib/stage'
import { setView, updateUi } from '@/lib/selection'
import { StateView, classifyStateError } from '@/components/StateView'
import { callToolJson } from '@/lib/stock-data'
import { detectBoardPulse, type HeatBoard, type BoardPulse } from '@/lib/board-pulse'
import { judgeSituation, situationLabel, situationColor, type Situation } from '@/lib/situation'
import { computeRegime, type Regime, bandLabel, bandColor } from '@/lib/regime'
import { loadLadder } from '@/lib/ladder'
import { fetchAllA, computeBreadth } from '@/lib/market'
import { getLatestPlan, getReview, subscribeReview, today } from '@/lib/review-store'
import { getDayRun, subscribeDayRun } from '@/lib/dayrun'
import { getPositions, subscribePositions } from '@/lib/positions'
import { getWatchlist, subscribeWatchlist, type WatchItem } from '@/lib/watchlist-store'
import { AuctionRadar } from '@/components/AuctionRadar'
import { PositionDesk } from '@/components/PositionDesk'
import { SessionMission } from '@/components/SessionMission'
import { ExpectVerdictPanel } from '@/components/ExpectVerdictPanel'
import { QAnswers } from '@/components/QAnswers'
import type { OpenStock } from '@/panel/PanelApp'

interface Props {
  onOpenStock: (s: OpenStock) => void
}

const CAPTURE_MS = 30_000

/* ═══════════════ 静默期（非交易时段）辅助：下一时段 / 此刻该做什么 ═══════════════
 *
 * 背景（审计点 5，真机实测）：**周六 12:30 进作战页只有 3 张小卡 + 整屏空白** ——
 * 页面既没说"今天为什么空"，也没说"下一个时段几点"，更没给"此刻该做什么"的出口。
 * 下面三个纯函数就是这三句话的来源。都不发请求、不改轮询节拍。
 */

/** 时间表（分钟刻度），与 lib/session-clock 的时段划分保持同一口径。 */
const M_AUCTION_START = 9 * 60 + 15 // 9:15 集合竞价开始
const M_OPEN = 9 * 60 + 30 // 9:30 开盘

const WEEKDAYS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六']

interface NextSession {
  /** 时段名（如「集合竞价（9:15–9:25）」）。 */
  label: string
  /** 具体钟点（如「周一 09:15」）。 */
  clock: string
  /** 倒计时（如「约 20 小时 45 分后」）。 */
  away: string
}

/**
 * 下一个「值得等」的时段。
 *
 * 为什么自己算：静默期界面要回答的是"**下一个**时段几点"，而 `buildClock` 只回答
 * "**当前**是什么时段"（审计点 5 缺的就是前者）。判定用本地时钟 + 交易日标记：
 *   · 交易日且未到 9:15（凌晨/早盘前）→ 今日 9:15 集合竞价；
 *   · 交易日且 9:15–9:30（竞价刚结束的空档）→ 今日 9:30 开盘；
 *   · 其余（收盘后 / 非交易日）→ 次一工作日的 9:15 集合竞价。
 * ⚠️ 已知近似：**法定节假日不由本地时钟感知**（`buildClock` 的 isTradeDay 同样只判周末），
 *    所以节假日会被算成"下一个工作日"——界面上如实标注"节假日按工作日近似"，
 *    不假装精确。
 */
function nextSession(now: Date, isTradeDay: boolean): NextSession {
  const minutes = minuteOfDay(now)
  let target: Date
  let label: string
  if (isTradeDay && minutes < M_AUCTION_START) {
    target = atClock(now, 9, 15)
    label = '集合竞价（9:15–9:25）'
  } else if (isTradeDay && minutes < M_OPEN) {
    target = atClock(now, 9, 30)
    label = '开盘（9:30）'
  } else {
    const d = new Date(now)
    // 周末跳过（节假日近似，见函数注释）
    do {
      d.setDate(d.getDate() + 1)
    } while (d.getDay() === 0 || d.getDay() === 6)
    target = atClock(d, 9, 15)
    label = '集合竞价（9:15–9:25）'
  }
  const sameDay = target.getFullYear() === now.getFullYear() && target.getMonth() === now.getMonth() && target.getDate() === now.getDate()
  return {
    label,
    clock: `${sameDay ? '今日' : WEEKDAYS[target.getDay()]} ${hhmm(target)}`,
    away: awayText(target.getTime() - now.getTime()),
  }
}

function atClock(d: Date, h: number, m: number): Date {
  const x = new Date(d)
  x.setHours(h, m, 0, 0)
  return x
}

function hhmm(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0')
  return `${p(d.getHours())}:${p(d.getMinutes())}`
}

/** 倒计时文本（分钟粒度，够回答"大概几点"；每轮轮询会重算一次）。 */
function awayText(ms: number): string {
  const total = Math.max(1, Math.round(ms / 60_000))
  if (total < 60) return `约 ${total} 分钟后`
  const h = Math.floor(total / 60)
  const m = total % 60
  return m === 0 ? `约 ${h} 小时后` : `约 ${h} 小时 ${m} 分后`
}

interface SilentTask {
  label: string
  hint: string
  onClick: () => void
}

/**
 * 「此刻该做的 2–3 件事」——**每一件都必须能一跳到位**（审计点 5 的第三句话）。
 * 跳转只用 `@/lib/selection` 的 `setView` / `updateUi`：作战页不该自己造导航。
 * （A6：没有"工具页"这一层了，所以这里的目标要么是一级入口，要么是左栏的分组。）
 */
function silentTasks(input: {
  hasTodayReview: boolean
  planCount: number
  watchCount: number
  positionCount: number
  onDesk: () => void
}): SilentTask[] {
  const tasks: SilentTask[] = [
    input.hasTodayReview
      ? {
          label: '复核次日预期清单（今日复盘已存档）',
          hint: `当前 ${input.planCount} 条：每条要能判"兑现 / 证伪"`,
          onClick: () => setView('review'),
        }
      : {
          label: '写今日复盘 + 次日预期清单',
          hint:
            input.planCount > 0
              ? `已有 ${input.planCount} 条预期：补齐失败条件再存档`
              : '复盘页七步，最后落到 ≤5 条预期（明日竞价的对照基准）',
          onClick: () => setView('review'),
        },
    input.watchCount === 0
      ? {
          label: '建自选观察池',
          hint: '自选为空：竞价时没有可对照的风向标（打开左栏「自选」分组，用 ★ 加票）',
          // A6：「自选盘」整页已下线 —— 自选的入口就是左栏那个分组，所以这里是"展开左栏 + 切到自选"。
          onClick: () => updateUi({ leftRail: true, leftGroup: 'watch' }),
        }
      : {
          label: `看自选风向标（${input.watchCount} 只）`,
          hint: '自由看盘：主图 + 右栏 AI 研判',
          onClick: () => setView('watch'),
        },
    input.positionCount > 0
      ? {
          label: `核对持仓台账（${input.positionCount} 笔）`,
          hint: '休市期把成本 / 止损 / 失败条件补全（页面下方持仓决策台）',
          onClick: input.onDesk,
        }
      : { label: '体检监控规则', hint: '把过期的价格/关键词规则关掉，开盘少受噪音打扰', onClick: () => setView('alerts') },
  ]
  return tasks.slice(0, 3)
}

export function WarPage({ onOpenStock }: Props) {
  const [phase, setPhase] = useState<SessionPhase>('closed')
  const [events, setEvents] = useState<EventItem[]>([])
  const [pulses, setPulses] = useState<BoardPulse[]>([])
  const [situation, setSituation] = useState<Situation>('normal')
  const [regime, setRegime] = useState<Regime | null>(null)
  const [watchlist, setWatchlist] = useState<WatchItem[]>(() => getWatchlist())
  const [loading, setLoading] = useState(true)
  const [msg, setMsg] = useState('')
  /**
   * 会话时钟快照（server_info 驱动）+ 失败原因。
   *
   * 为什么要单独存 `clock`/`clockErr`：原实现只在成功时 `setPhase`，失败就"沿用上一时段"
   * ——于是 server_info 超时时页面表现成"当前时段 = 初始值 closed"，整页看起来正常但全是空的
   * （正是审计点 4「UI 从不区分超时与空」的成因）。现在失败会**回退到本地时钟**并把原因
   * 留在界面上，让"不知道现在几点"变成看得见的状态。
   */
  const [clock, setClock] = useState<SessionClock | null>(null)
  const [clockErr, setClockErr] = useState('')
  const [phaseKnown, setPhaseKnown] = useState(false)
  /** 主体取数失败（原始原因）—— 以前只用一行 3s 后自动消失的 msg 表达。 */
  const [loadErr, setLoadErr] = useState('')
  /** 静默期有内容时，是否展开"此刻该做什么"（默认收起，把画面让给三张卡）。 */
  const [silentOpen, setSilentOpen] = useState(false)
  const busyRef = useRef(false)
  const abortRef = useRef<AbortController | null>(null)
  /** 三张卡（局势 / 事件流 / 持仓决策台）锚点：静默期"核对持仓台账"直接滚过去。 */
  const cardsRef = useRef<HTMLDivElement>(null)
  /**
   * 上一时段（server_info 取不到时的回退值）。
   *
   * 为什么用 ref 而不是直接读 `phase`：`load` 内部会 `setPhase`，若把 `phase` 写进
   * 它的依赖数组，每次取时段都会换掉 `load` 的身份 → 依赖 `load` 的定时轮询会被重建。
   * 这里只需要"看一眼当前值"，不需要它触发重算。
   */
  const phaseRef = useRef<SessionPhase>('closed')
  // 当日任务进度变更（dayrun 判定/Q 卡、持仓、复盘存档）→ 触发任务条重算
  const [, force] = useReducer((x: number) => x + 1, 0)

  // 自选订阅（竞价观察池；变更时静默更新，不打断盘中轮询）
  useEffect(() => subscribeWatchlist(() => setWatchlist(getWatchlist())), [])
  // 时段快照给 load 用（见 phaseRef 注释）
  useEffect(() => {
    phaseRef.current = phase
  }, [phase])
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
      // 会话时段：server_info 驱动。取不到**不等于休市** —— 回退本地时钟（工作日近似），
      // 并把失败原因留给界面（见 clockErr 的注释）。
      let curPhase = phaseRef.current
      try {
        const info = (await callToolJson('server_info', {})) as ServerInfo | null
        const c = buildClock(info ?? null)
        curPhase = c.phase
        phaseRef.current = curPhase
        if (!ac.signal.aborted) {
          setClock(c)
          setClockErr('')
          setPhase(curPhase)
          setPhaseKnown(true)
        }
      } catch (e) {
        const c = buildClock(null)
        curPhase = c.phase
        phaseRef.current = curPhase
        if (!ac.signal.aborted) {
          setClock(c)
          setClockErr((e as Error)?.message ?? 'server_info 取数失败')
          setPhase(curPhase)
          setPhaseKnown(true)
        }
      }

      // 休市/周末：避免每 30s 向数据源发起全量请求（不可用时造成 15s 超时风暴）；
      // 手动刷新（force）仍允许查看最近交易日快照。
      // 注意：这里**不再**用 3s 后消失的 msg 说这句话 —— 静默期面板会把
      // "为什么空 / 下一个时段 / 此刻该做什么"一次讲清楚，不需要第二处重复文案。
      if (curPhase === 'closed' && !force) {
        setLoading(false)
        return
      }

      const added = await captureOnce(ac.signal)
      setEvents(getEvents())
      const allRows = await fetchAllA(true)
      const breadth = computeBreadth(allRows)
      const ladder = await loadLadder(ac.signal, { force })
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
      setLoadErr('')
      setTimeout(() => setMsg(''), 2000)
    } catch (e) {
      // 失败必须留下"可诊断的痕迹"：原文进 loadErr（界面渲染成错误态 + 重试），
      // 而不是塞进一个 2s 后自动消失的 toast。
      if (!ac.signal.aborted) setLoadErr((e as Error)?.message ?? '盘中数据加载失败')
    } finally {
      busyRef.current = false
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
    const timer = window.setInterval(() => {
      // 后台标签页不跑重轮（一轮 ≤177 次工具调用，B3）
      if (document.hidden) return
      void load()
    }, CAPTURE_MS)
    return () => { window.clearInterval(timer); abortRef.current && abortRef.current.abort() }
  }, [load])

  const isPost = isPostClose(phase)

  /* ── 静默期（非交易时段）界面的判定与文案（审计点 5） ─────────────────────
   * 判定：时段已知 **且** 当前是 `closed`（非交易日 / 交易日盘外）或 `review`（收盘后）
   * —— 这两个时段作战页本来就没有盘中数据可取。
   * 方法论阶段用 `stageOf(phase, 分钟)` 而**不是** `currentStage()`：
   *   `currentStage()` 内部调 `phaseFromDate(d)` 时没传 isTradeDay（lib/stage.ts:117），
   *   于是恒得 'closed' → 恒返回 'review'；用 buildClock 拿到的 phase 才对得上真实时段。
   * 这是 lib 侧的事（本次不动 lib/），这里按"用现成纯函数、不依赖坏掉的包装"处理。
   */
  const now = new Date()
  const isTradeDay: boolean | null = clock === null ? null : clock.isTradeDay
  const isSilentPhase = phaseKnown && (phase === 'closed' || phase === 'review')
  const hasContent = events.length > 0 || regime !== null
  const stage: Stage = stageOf(phase, minuteOfDay(now))
  const stageInfo = STAGES[stage]
  // isTradeDay 未知（server_info 不可达）时按交易日近似：工作日的 9:15 比"下周一"更可能对
  const nextRun = nextSession(now, isTradeDay !== false)
  const silentTitle = !phaseKnown
    ? '正在确认当前时段…'
    : isTradeDay === false
      ? `${phaseIcon(phase)} 非交易日（${WEEKDAYS[now.getDay()]}）· 休市`
      : `${phaseIcon(phase)} 交易日 · ${phaseLabel(phase)}（此刻没有盘中数据可取）`
  const silentTaskList = silentTasks({
    hasTodayReview: !!getReview(day),
    planCount: planExpectations.length,
    watchCount: watchlist.length,
    positionCount: positions.length,
    onDesk: () => cardsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' }),
  })
  const clockErrInfo = clockErr !== '' ? classifyStateError(clockErr, '时段服务取数失败') : null
  const loadErrInfo = loadErr !== '' ? classifyStateError(loadErr, '盘中数据加载失败') : null

  return (
    <div className="h-full overflow-y-auto px-2.5 pb-3">
      <div className="-mx-2.5 mb-1.5 border-b border-slate-100 px-2.5 pb-1.5 pt-2">
        <div className="flex items-center justify-between">
          <span className="flex items-center gap-1.5 text-sm font-semibold text-slate-800">
            <Activity className="h-3.5 w-3.5 text-emerald-500" />作战
          </span>
          <span className="rounded bg-slate-100 px-1.5 py-0.5 dc-t-data font-medium text-slate-500">
            {phaseIcon(phase)} {phaseLabel(phase)}
          </span>
        </div>
        {regime && (
          <div className="mt-1.5 flex items-center gap-2">
            <span className="dc-t-micro text-slate-400">温度计</span>
            <span className="font-mono dc-t-data font-bold tabular-nums" style={{ color: bandColor(regime.band) }}>{regime.temperature}</span>
            <span className="rounded bg-slate-200 px-1 dc-t-micro text-slate-600">{bandLabel(regime.band)}</span>
            <span className="ml-auto rounded px-1.5 py-0.5 dc-t-micro font-medium text-white" style={{ background: situationColor(situation) }}>{situationLabel(situation)}</span>
          </div>
        )}
        {!regime && !loading && (
          // 区分两种"空"（审计点 4：UI 从不区分超时/不可达与空）
          <div className="mt-1 dc-t-micro text-slate-300">
            {isSilentPhase
              ? '温度计暂无数据（当前非交易时段：休市期不发起全量行情请求）'
              : '温度计暂无数据（行情源不可达：广度 / 涨停梯队全部取数失败，不是"今天没有涨停"）'}
          </div>
        )}
      </div>

      {msg && <div className="mb-1.5 rounded bg-amber-50 px-2 py-1 dc-t-data text-amber-600">{msg}</div>}

      {/* 时段服务取不到 ≠ 休市：把"不知道现在几点"变成看得见的状态 */}
      {clockErrInfo !== null && (
        <StateView
          kind="error"
          compact
          className="mb-1.5"
          kindLabel={clockErrInfo.kindLabel}
          title="时段服务不可达（已按本地时钟近似）"
          hint="时段与「下一时段」判断可能有偏差；行情取数不受影响"
          reason={clockErrInfo.reason}
          onRetry={() => void load(true)}
        />
      )}

      {/* 主体取数失败：页面级错误态 + 重试（以前只有一行 2s 后自动消失的提示） */}
      {loadErrInfo !== null && (
        <StateView
          kind="error"
          compact={hasContent}
          className="mb-1.5"
          kindLabel={loadErrInfo.kindLabel}
          title={loadErrInfo.title}
          hint={hasContent ? '页面保留上一次成功的数据；30s 后自动重试' : '本轮没有任何数据可取；点重试立即再拉一次'}
          reason={loadErrInfo.reason}
          onRetry={() => void load(true)}
        />
      )}

      {/* 加载态：**固定高度骨架**（审计点名的真实问题：迟到插入的区块把已填表单顶下去） */}
      {loading && !hasContent && loadErrInfo === null && (
        <StateView
          className="mb-1.5"
          kind="loading"
          rows={5}
          title="盘中数据加载中…"
          hint="事件流 / 广度 / 涨停梯队 / 温度计"
        />
      )}

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

      {/* ── 静默期（非交易时段）界面：审计点 5 ────────────────────────────────
          真机实测：周六 12:30 进作战页只有 3 张小卡 + 整屏空白。这里补齐三句话：
            ① 现在是什么时段 / 今天是不是交易日；
            ② 下一个时段是什么、大概几点（含倒计时）；
            ③ 此刻该做的 2–3 件事（每件一跳到位）。
          布局取舍：**有内容时（例如手动拉了最近交易日快照）收成一行摘要**，
          把画面让给三张卡；只有真的没内容时才铺开整块（否则就是那个"整屏空白"）。 */}
      {isSilentPhase && !hasContent && (
        <StateView
          className="mb-1.5"
          kind="empty"
          title={silentTitle}
          hint={
            <>
              下一时段：{nextRun.label} · {nextRun.clock}（{nextRun.away}）
              <br />
              方法论阶段：{stageInfo.label}（{stageInfo.window}）→ 本阶段产出：{stageInfo.output}
              <br />
              休市期不发起全量行情请求（省掉每轮上百次工具调用）；节假日按工作日近似，不做精确判断。
            </>
          }
          actions={silentTaskList}
          action={{ label: '拉取最近交易日快照', onClick: () => void load(true) }}
        />
      )}
      {isSilentPhase && hasContent && (
        <>
          <StateView
            className="mb-1.5"
            kind="empty"
            compact
            title={silentTitle}
            hint={`下一时段：${nextRun.label} · ${nextRun.clock}（${nextRun.away}）· 以下为最近交易日快照`}
            action={{
              label: silentOpen ? '收起该做什么' : '此刻该做什么',
              onClick: () => setSilentOpen((v) => !v),
            }}
          />
          {silentOpen && (
            <StateView
              className="mb-1.5"
              kind="empty"
              title={`${stageInfo.label}阶段该做的事`}
              hint={`${stageInfo.window} · 产出：${stageInfo.output}`}
              actions={silentTaskList}
            />
          )}
        </>
      )}

      {/* 宽屏列流：把"该看的"并排展开；上方"该答的"（时段任务/竞价判定/三问卡）保持整行 */}
      <div ref={cardsRef} className="dc-flow">
      <div className="mb-1.5 rounded-md border border-slate-100 bg-slate-50/60 px-2 py-1.5">
        <div className="mb-1 dc-t-data font-medium text-slate-400">局势</div>
        <div className="dc-t-note leading-relaxed text-slate-600">{situationLabel(situation)}</div>
      </div>

      {pulses.length > 0 && (
        <div className="mb-1.5 rounded-md border border-slate-100 bg-slate-50/60 px-2 py-1.5">
          <div className="mb-1 flex items-center gap-1 dc-t-data font-medium text-slate-400">
            <Zap className="h-3 w-3 text-amber-500" />板块脉冲
          </div>
          <ul className="space-y-0.5">
            {pulses.slice(0, 5).map((p) => (
              <li key={p.board} className="flex items-center justify-between rounded px-1 py-0.5 bg-white">
                <span className="min-w-0 flex-1 truncate dc-t-note text-slate-600">{p.name}</span>
                <span className="shrink-0 font-mono dc-t-micro text-red-500">+{p.deltaLimitUp} 板</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="mb-1.5 rounded-md border border-slate-100 bg-slate-50/60 px-2 py-1.5">
        <div className="mb-1 flex items-center justify-between">
          <span className="flex items-center gap-1 dc-t-data font-medium text-slate-400">
            <Target className="h-3 w-3 text-red-500" />事件流 · {events.length} 条
          </span>
          <button onClick={() => void load(true)} className="rounded p-0.5 text-slate-300 hover:bg-slate-100 hover:text-slate-500" title="强制刷新（休市时也可拉最近交易日快照）">
            <RefreshCw className="h-3 w-3" />
          </button>
        </div>
        {isPost && <div className="mb-1 rounded bg-amber-50 px-1.5 py-0.5 dc-t-micro text-amber-600">⚠️ 收盘后事件流只读（unusual 退化为竞价快照）</div>}
        {events.length === 0 && (
          // 事件流为空也要说明「为什么空」：休市不产生增量 ≠ 数据源不可达 ≠ 确实没异动
          <StateView
            className="mb-1"
            kind="empty"
            compact
            title="暂无事件"
            hint={
              isSilentPhase
                ? '非交易时段不产生异动增量（可用本卡右上角刷新拉最近交易日快照）'
                : '30s 增量扫描中：未命中异动、或数据源取数失败都会为空（顶部有红色提示时即为取数失败）'
            }
          />
        )}
        <ul className="space-y-0.5 max-h-32 overflow-y-auto">
          {events.slice(0, 30).map((e) => (
            <li key={e.key} onClick={() => onOpenStock({ market: e.market, code: e.code, name: e.name })} className="flex cursor-pointer items-center gap-1 rounded px-1 py-0.5 hover:bg-white">
              <span className={'shrink-0 rounded px-1 dc-t-micro font-medium ' + eventColor(e.kind)}>{kindLabel(e.kind)}</span>
              <span className="min-w-0 flex-1 truncate dc-t-data text-slate-600">{e.name}</span>
              <span className="shrink-0 font-mono dc-t-micro text-slate-300">{e.time}</span>
            </li>
          ))}
        </ul>
      </div>

      {/* N6 持仓决策台：加仓/平仓(记日志)/自统计/凯利建议 */}
      <PositionDesk band={regime ? regime.band : null} />
      </div>
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
