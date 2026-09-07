/**
 * 复盘模式页（N1：ReviewPage）。
 *
 * 依据 WATCH-METHODOLOGY §3「收盘复盘」与 PRODUCT-DESIGN §4.1「页面块」：
 *   1. 今日盘眼：指数/广度/成交额 + 温度计刻度 + 主线一句话；
 *   2. 自动回顾区：涨停梯队精简条形 + 跌停/大面统计 + 炸板事件清单；
 *   3. 预期清单编辑器（≤5 张，7 字段，可一键从今日涨停池加入龙头）；
 *   4. 存档：写入当日 ReviewSnapshot（review-store，localStorage 按日追加）。
 *
 * 数据：loadLadder（涨停池+板块热度）、fetchAllA/computeBreadth（广度）、
 *   fetchIndexQuotes（指数）、regime（温度计）、event-stream（炸板事件）。
 * 复盘一次性装配 + 手动刷新；不 30s 轮询（PRODUCT-DESIGN §7 预算）。
 */

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { ClipboardList, Flame, Plus, RefreshCw, Save, X } from 'lucide-react'
import { loadLadder, type LadderSnapshot, type LadderStock } from '@/lib/ladder'
import { fetchAllA, computeBreadth, fetchIndexQuotes, type AShareRow, type Breadth, type IndexQuote } from '@/lib/market'
import { computeRegime, bandLabel, bandColor, type Regime, type RegimeInputs } from '@/lib/regime'
import { getEvents, subscribeEvents, type EventItem } from '@/lib/event-stream'
import {
  getPrevSnapshot,
  getReview,
  saveReview,
  today,
  type ExpectItem,
  type MainLine,
  type ReviewSnapshot,
  type WindFlagRef,
  type WindFlagTag,
} from '@/lib/review-store'
import {
  buildLimitUpPool,
  computePrevDayMetrics,
  computePrevPoolPerf,
  indexTodayRows,
  listPrevPoolBigLosers,
} from '@/lib/review-metrics'
import {
  classifyStrength,
  computeStrengthBatch,
  selectLowBoardCandidates,
  strongKindColor,
  strongKindLabel,
  type LowBoardCandidate,
  type StrengthRow,
  type StrongKind,
} from '@/lib/strength'
import {
  PrevPoolPerfBlock,
  SurgeBoardsBlock,
  AmountTopBlock,
  LossBlock,
  WindFlagBlock,
  type WindFlagCandidate,
} from '@/components/ReviewPanels'
import { fmtBigNum } from '@/lib/format'
import { inferMarket, type MarketTag } from '@/lib/symbol'
import { watchAddSymbol } from '@/lib/watchlist-store'
import type { OpenStock } from '@/panel/PanelApp'

const UP = '#c74040'
const DOWN = '#2d9b65'

/** 统一输入/下拉样式（与 WatchlistPage 搜索框一致的紧凑风）。 */
const FIELD_CLS =
  'w-full min-w-0 rounded border border-slate-200 bg-white px-1 py-0.5 text-[10px] text-slate-700 outline-none placeholder:text-slate-300 focus:border-emerald-400'

const STATE_OPTS: { v: ExpectItem['state']; l: string }[] = [
  { v: 'strong', l: '强一致' },
  { v: 'divergence', l: '分歧' },
  { v: 'weak2strong', l: '弱转强' },
  { v: 'highRisk', l: '高位风险' },
  { v: 'recession', l: '退潮' },
  { v: 'newLow', l: '低位启动' },
]
const LEVEL_OPTS: { v: ExpectItem['tags']['level']; l: string }[] = [
  { v: 'low', l: '低位' },
  { v: 'mid', l: '中位' },
  { v: 'high', l: '高位' },
]
const ROLE_OPTS: { v: ExpectItem['tags']['role']; l: string }[] = [
  { v: 'leader', l: '龙头' },
  { v: 'follower', l: '跟风' },
  { v: 'catchup', l: '补涨' },
]

/** 复盘七步引导（视觉暗示：按序完成 = 一天复盘闭环）。 */
const STEPS: { id: string; label: string; hint: string }[] = [
  { id: 'mood', label: '情绪', hint: '涨停/跌停/昨日涨停表现——先看天气再看衣服' },
  { id: 'tier', label: '梯队', hint: '最高板 + 中间档是否断层（资金敢不敢接力）' },
  { id: 'board', label: '板块', hint: '涨停潮 ≥3 的板块 = 资金阵地' },
  { id: 'money', label: '资金', hint: '成交额前 20 大票涨跌（机构/存量博弈）' },
  { id: 'loss', label: '亏钱', hint: '昨日涨停今日大跌/跌停 = 雷区，记共性' },
  { id: 'flag', label: '风向标', hint: '5-8 只有特点的票，明日观察它们强弱' },
  { id: 'plan', label: '计划', hint: '明日交易计划：板块跟踪/竞价信号出手/信号收手' },
]

interface Props {
  onOpenStock: (s: OpenStock) => void
}

function uid(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8)
}

/** 本地日期键（YYYY-MM-DD，事件 ts 所在日）。 */
function localDateKey(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

function eventOnDay(e: EventItem, day: string): boolean {
  return localDateKey(new Date(e.ts)) === day
}

/** 'SH600000' → { market, code }（预期清单/涨停池建档行的 symbol 格式）。 */
function splitSymbol(symbol: string): { market: MarketTag; code: string } | null {
  const m = symbol.match(/^(SH|SZ|BJ)(\d{6})$/)
  return m ? { market: m[1] as MarketTag, code: m[2] } : null
}

/** 强度类别 → 预期清单状态初值（W1：一键从差分行加预期）。 */
const KIND_STATE: Record<StrongKind, ExpectItem['state']> = {
  trueStrong: 'strong', // 真强 → 强一致
  inertia: 'highRisk', // 惯性假强 → 高位风险
  weakening: 'recession', // 转弱 → 退潮
  weak2strong: 'weak2strong', // 弱转强
  flat: 'divergence', // 平 → 分歧
}

export function ReviewPage({ onOpenStock }: Props) {
  const day = today()
  const [ladder, setLadder] = useState<LadderSnapshot | null>(null)
  const [breadth, setBreadth] = useState<Breadth | null>(null)
  const [indices, setIndices] = useState<IndexQuote[]>([])
  const [regime, setRegime] = useState<Regime | null>(null)
  const [events, setEvents] = useState<EventItem[]>([])
  const [expectations, setExpectations] = useState<ExpectItem[]>([])
  const [mainLine, setMainLine] = useState<MainLine[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [msg, setMsg] = useState('')
  const [savedAt, setSavedAt] = useState<number | null>(null)
  const [picking, setPicking] = useState(false)
  /** N9：全 A 行（成交额榜 / 昨涨停今表现输入）。 */
  const [rows, setRows] = useState<AShareRow[]>([])
  /** 温度计输入口径标注（实算 vs 近似），缺证据时透明提示。 */
  const [metricsNote, setMetricsNote] = useState('')
  /** N9：昨日涨停今日整体表现（复盘第一步：先看天气再看衣服）。 */
  const [prevPerf, setPrevPerf] = useState<ReturnType<typeof computePrevPoolPerf> | null>(null)
  /** N9：昨日涨停今日大面/跌停清单（复盘第五步：亏钱效应·雷区）。 */
  const [prevLosers, setPrevLosers] = useState<{ symbol: string; name: string; pct: number; atLimitDown: boolean }[]>([])
  /** N9：亏钱共性备注（第五步收尾：把共性记下来，存档）。 */
  const [riskNote, setRiskNote] = useState('')
  /** N9：今日标记风向标（第六步：≤8 只，存档供次日竞价对照）。 */
  const [windFlags, setWindFlags] = useState<WindFlagRef[]>([])
  /** N3 强度差分结果（观察池 = 今日池 ∪ 上一交易日池 ∪ 板块代表，≤120）。 */
  const [strength, setStrength] = useState<{ rows: StrengthRow[]; running: boolean; error: string }>({
    rows: [],
    running: false,
    error: '',
  })
  const strengthKeyRef = useRef('')
  const strengthAbortRef = useRef(false)
  const busyRef = useRef(false)
  const abortRef = useRef<AbortController | null>(null)

  // 事件流变更订阅（炸板清单跟随已捕获历史）
  useEffect(() => subscribeEvents(() => setEvents(getEvents())), [])

  const load = useCallback(async () => {
    if (busyRef.current) return
    busyRef.current = true
    if (abortRef.current) abortRef.current.abort()
    const ac = new AbortController()
    abortRef.current = ac
    setError('')
    try {
      const [l, idx, allRows] = await Promise.all([
        loadLadder(ac.signal),
        fetchIndexQuotes(),
        fetchAllA(),
      ])
      if (ac.signal.aborted) return
      const b = computeBreadth(allRows)
      const known = l.limitUp.filter((s) => s.streakKnown)
      const maxStreak = known.length ? Math.max(...known.map((s) => s.streak)) : 0
      // 无真实行情（数据源不可用/休市）→ 温度计与存档置空，避免占位公式误导
      const noMarket = b.up + b.down + l.limitUp.length + l.limitDownCount === 0
      if (noMarket) setError('行情源暂无数据（MCP 超时或休市）：涨停池 / 盘眼暂不可用，无法存档')

      // N5+：用上一交易日涨停池（v3 limitUpPool）实算晋级率/炸板率/首板溢价。
      // 事件流只统计当日捕获（事件库跨日累积，避免污染口径）。
      const prevSnap = getPrevSnapshot(day)
      const todayRow = indexTodayRows(allRows)
      // N9 七步法①：昨日涨停今日整体表现（先看天气再看衣服，接力意愿/杀高位）
      setPrevPerf(noMarket ? null : computePrevPoolPerf(prevSnap?.limitUpPool, todayRow))
      // N9 七步法⑤：亏钱效应样本（昨日涨停今日大面/跌停 → 雷区）
      setPrevLosers(noMarket ? [] : listPrevPoolBigLosers(prevSnap?.limitUpPool, todayRow, -5))
      const todayEv = getEvents().filter((e) => eventOnDay(e, day))
      const calc = noMarket
        ? null
        : computePrevDayMetrics({
            prevPool: prevSnap?.limitUpPool,
            todayPoolSymbols: new Set(l.limitUp.map((s) => `${s.market}${s.code}`)),
            todayRow,
            todayBreakSymbols: new Set(
              todayEv
                .filter((e) => e.kind === 'break' || /炸板|开板/.test(e.desc))
                .map((e) => `${e.market}${e.code}`),
            ),
            hasCaptureToday: todayEv.length > 0,
          })
      const inputs: RegimeInputs = {
        limitUp: l.limitUp.length,
        limitDown: l.limitDownCount,
        maxStreak,
        // 实算优先；无证据（无昨日存档/事件未捕获）回落近似初值，并由
        // metricsNote 显式标注口径，禁止假装精度（PRODUCT-DESIGN §2.3 纪律）。
        promoteRate: calc?.promoteRate ?? 0.4,
        brokenRate: calc?.brokenRate ?? 0.2,
        firstBoardPremium: calc?.firstBoardPremium ?? 1.5,
        upRatio: b.up / Math.max(1, b.up + b.down),
        amountYi: b.amountSum / 1e8,
      }
      // 口径标注（琥珀小字）：实算项给出样本量，缺证据项注明近似及原因
      if (calc) {
        const parts: string[] = []
        if (calc.promoteRate !== null)
          parts.push(`晋级率 ${(calc.promoteRate * 100).toFixed(0)}%（昨日池 ${calc.prevPoolSize}）`)
        else if (prevSnap) parts.push('晋级率近似：昨日存档无涨停池（v2 旧档）')
        else parts.push('晋级率近似：缺上一交易日存档')
        if (calc.brokenRate !== null)
          parts.push(`炸板率 ${(calc.brokenRate * 100).toFixed(0)}%（捕获 ${calc.breakSamples}）`)
        else parts.push('炸板率近似：当日盘中事件未捕获')
        if (calc.firstBoardPremium !== null)
          parts.push(`首板溢价 ${calc.firstBoardPremium >= 0 ? '+' : ''}${calc.firstBoardPremium.toFixed(2)}%（${calc.premiumSamples} 只）`)
        else parts.push('首板溢价近似：无昨日首板样本')
        setMetricsNote(parts.join(' · '))
      } else {
        setMetricsNote('')
      }
      setLadder(l)
      setBreadth(b)
      setIndices(idx)
      setRegime(noMarket ? null : computeRegime(inputs))
      setEvents(getEvents())
      // 主线建议：板块热度 TOP3（板块名 + 代表股符号）
      setMainLine(
        l.boards.slice(0, 3).map((b) => ({
          board: b.name,
          leader: b.repCode ? `${inferMarket(b.repCode)}${b.repCode}` : null,
        })),
      )
      // 已存过今日复盘 → 回填清单、亏钱共性、风向标与存档时间
      const prev = getReview(day)
      if (prev) {
        setExpectations(prev.expectations)
        setSavedAt(prev.savedAt)
        setRiskNote(prev.riskNote ?? '')
        setWindFlags(prev.windFlags ?? [])
      }
      setRows(allRows)
    } catch (e) {
      if (!ac.signal.aborted) setError((e as Error).message || '加载失败')
    } finally {
      busyRef.current = false
      setLoading(false)
    }
  }, [day])

  useEffect(() => {
    void load()
    return () => abortRef.current?.abort()
  }, [load])

  // N3：强度差分自动装配。观察池 = 今日涨停池 ∪ 上一交易日池 ∪ 板块代表（≤120），
  // 去重后并行拉 DAILY(5) 算 3 日动量差分/量比/连板 → 真强·惯性·转弱·弱转强分类。
  // 休市/无行情跳过；同类候选只跑一次（key 含 fetchedAt，手动刷新会重算）。
  useEffect(() => {
    if (!ladder || !breadth) return
    const noMarket = breadth.up + breadth.down + ladder.limitUp.length + ladder.limitDownCount === 0
    if (noMarket) return
    const seen = new Set<string>()
    const cands: { market: MarketTag; code: string; name: string }[] = []
    const push = (market: MarketTag, code: string, name: string) => {
      const sym = `${market}${code}`
      if (seen.has(sym) || cands.length >= 120) return
      seen.add(sym)
      cands.push({ market, code, name })
    }
    for (const s of ladder.limitUp) push(s.market, s.code, s.name)
    for (const p of getPrevSnapshot(day)?.limitUpPool ?? []) {
      const parts = splitSymbol(p.symbol)
      if (parts) push(parts.market, parts.code, p.name)
    }
    for (const b of ladder.boards) {
      if (b.repCode) push(inferMarket(b.repCode), b.repCode, b.rep)
    }
    if (cands.length === 0) return
    const key = `${ladder.fetchedAt}|${cands.map((c) => `${c.market}${c.code}`).join('|')}`
    if (key === strengthKeyRef.current) return
    strengthKeyRef.current = key
    strengthAbortRef.current = false
    setStrength((s) => ({ ...s, running: true, error: '' }))
    void computeStrengthBatch(cands, 6)
      .then((rows) => {
        if (strengthAbortRef.current) return
        setStrength({ rows, running: false, error: '' })
      })
      .catch((e) => {
        if (strengthAbortRef.current) return
        setStrength((s) => ({ ...s, running: false, error: (e as Error).message || '强度差分失败' }))
      })
    return () => {
      strengthAbortRef.current = true
    }
  }, [ladder, breadth, day])

  const dayEvents = useMemo(() => events.filter((e) => eventOnDay(e, day)), [events, day])
  const breakEvents = useMemo(
    () => dayEvents.filter((e) => e.kind === 'break' || /炸板|开板/.test(e.desc)).slice(0, 8),
    [dayEvents],
  )
  const limitDownEvents = useMemo(
    () => dayEvents.filter((e) => e.kind === 'limitDown').slice(0, 6),
    [dayEvents],
  )

  const tierCounts = useMemo(() => {
    const m = new Map<number, number>()
    for (const s of ladder?.limitUp ?? []) {
      if (!s.streakKnown) continue
      m.set(s.streak, (m.get(s.streak) ?? 0) + 1)
    }
    return [...m.entries()].sort((a, b) => b[0] - a[0])
  }, [ladder])
  const maxTier = Math.max(1, ...tierCounts.map(([, c]) => c))

  // 板块代表股 → 扩散占比（近似口径：代表股板块涨停数 / 全市场涨停数）。
  const boardConc = useMemo(() => {
    const m = new Map<string, number>()
    const total = ladder?.limitUp.length ?? 1
    for (const b of ladder?.boards ?? []) {
      if (b.repCode && total > 0) m.set(b.repCode, Math.min(1, b.limitUpCount / total))
    }
    return m
  }, [ladder])

  // 非"平"的强度行（按 真强→弱转强→惯性→转弱 排序，≤20 行）。
  const kindRows = useMemo(() => {
    const order: Record<string, number> = { trueStrong: 0, weak2strong: 1, inertia: 2, weakening: 3 }
    return strength.rows
      .map((row) => ({ row, kind: classifyStrength(row) }))
      .filter((x) => x.kind !== 'flat')
      .sort((a, b) => (order[a.kind] ?? 9) - (order[b.kind] ?? 9) || b.row.delta3 - a.row.delta3)
      .slice(0, 20)
  }, [strength.rows])

  // 低位首板候选（≤10；扩散占比近似，见上）。
  const lowBoards = useMemo(
    () => selectLowBoardCandidates(strength.rows, (code) => boardConc.get(code) ?? 0, 10),
    [strength.rows, boardConc],
  )

  // N9 六步法⑥：风向标候选 = 涨停池（含连板/一字）+ 强度弱转强 + 低位首板（≤16，去重）。
  const windCandidates = useMemo<WindFlagCandidate[]>(() => {
    const seen = new Set<string>()
    const out: WindFlagCandidate[] = []
    const push = (c: WindFlagCandidate) => {
      const sym = `${c.market}${c.code}`
      if (seen.has(sym) || out.length >= 16) return
      seen.add(sym)
      out.push(c)
    }
    for (const s of ladder?.limitUp.slice(0, 12) ?? []) {
      push({
        market: s.market,
        code: s.code,
        name: s.name,
        streak: s.streak,
        hint: s.streakKnown ? (s.oneWord ? `${s.streak}板·一字` : `${s.streak}板`) : '涨停',
      })
    }
    // 断板反包/弱转强（强度差分 weak2strong）
    for (const { row, kind } of kindRows) {
      if (kind === 'weak2strong') push({ market: row.market, code: row.code, name: row.name, streak: row.streak, hint: '断板反包·弱转强' })
    }
    // 低位放量启动
    for (const lb of lowBoards.slice(0, 5)) {
      push({ market: lb.row.market, code: lb.row.code, name: lb.row.name, streak: lb.row.streak, hint: '低位放量' })
    }
    return out
  }, [ladder, kindRows, lowBoards])

  /** 标记风向标（≤8，去重；同步加入自选便于次日竞价对照）。 */
  const markWind = (c: WindFlagCandidate, tag: WindFlagTag) => {
    if (windFlags.length >= 8) return
    const symbol = `${c.market}${c.code}`
    if (windFlags.some((f) => f.symbol === symbol)) return
    watchAddSymbol(symbol, c.name)
    setWindFlags((prev) => [...prev, { symbol, name: c.name, tag }])
  }
  const unmarkWind = (symbol: string) => {
    setWindFlags((prev) => prev.filter((f) => f.symbol !== symbol))
  }

  /** 连板梯队断层（六步法②：中间档缺失 = 资金不敢接力）。 */
  const tierGaps = useMemo(() => {
    if (tierCounts.length === 0) return { max: 0, gaps: [] as number[] }
    const map = new Map(tierCounts)
    const max = Math.max(...tierCounts.map(([n]) => n))
    const gaps: number[] = []
    for (let n = 2; n < max; n++) if (!map.has(n)) gaps.push(n)
    return { max, gaps }
  }, [tierCounts])

  /**
   * 预期清单新增（本地草稿，存档时统一写入 review-store）。
   * 涨停池/强度行/低位首板共用；state 可由强度类别推导覆盖。
   */
  const addExpFrom = (
    spec: { market: MarketTag; code: string; name: string; streak: number },
    state?: ExpectItem['state'],
  ) => {
    if (expectations.length >= 5) return
    const symbol = `${spec.market}${spec.code}`
    if (expectations.some((e) => e.symbol === symbol)) return
    setExpectations((prev) => [
      ...prev,
      {
        id: uid(),
        symbol,
        name: spec.name,
        tags: {
          themeDay: 1,
          level: spec.streak >= 4 ? 'high' : spec.streak >= 2 ? 'mid' : 'low',
          role: spec.streak >= 3 ? 'leader' : 'catchup',
        },
        state: state ?? (spec.streak >= 4 ? 'highRisk' : spec.streak >= 3 ? 'strong' : 'divergence'),
        scenario: '',
        auctionOK: '',
        failIf: '',
        reason: '',
      },
    ])
    setPicking(false)
  }
  const addExpectation = (s: LadderStock) => addExpFrom(s)
  /** N3：从强度差分行一键加入（state 按强度类别定初值）。 */
  const addFromRow = (row: StrengthRow, kind: StrongKind) =>
    addExpFrom({ market: row.market, code: row.code, name: row.name, streak: row.streak }, KIND_STATE[kind])

  const updateExp = (id: string, patch: Partial<ExpectItem>) => {
    setExpectations((prev) => prev.map((e) => (e.id === id ? { ...e, ...patch } : e)))
  }
  const removeExp = (id: string) => {
    setExpectations((prev) => prev.filter((e) => e.id !== id))
  }

  /** 存档：装配当日 ReviewSnapshot 并写入 review-store。 */
  const save = () => {
    if (!breadth || !regime || !ladder) {
      setMsg('数据未就绪，无法存档')
      return
    }
    const notable = [
      ...limitDownEvents.map((e) => `${e.time} ${e.name} 跌停`),
      ...breakEvents.map((e) => `${e.time} ${e.name} 炸板`),
    ].slice(0, 12)
    const snap: ReviewSnapshot = {
      day,
      savedAt: Date.now(),
      breadth: {
        up: breadth.up,
        down: breadth.down,
        limitUp: breadth.limitUp,
        limitDown: breadth.limitDown,
        amountYi: breadth.amountSum / 1e8,
      },
      regime,
      mainLine,
      expectations,
      notable,
      // v3：涨停池建档（供次日实算晋级率/首板溢价与竞价对照底座）
      limitUpPool: buildLimitUpPool(ladder.limitUp),
      // v3.1：亏钱共性备注 + 风向标（七步复盘第 5/6 步输出，供次日竞价对照）
      riskNote: riskNote.trim() || undefined,
      windFlags: windFlags.length > 0 ? windFlags : undefined,
    }
    saveReview(snap)
    setSavedAt(snap.savedAt)
    setMsg(`已存档 ${day} 复盘（预期 ${expectations.length}/5 · 风向标 ${windFlags.length}/8）`)
    setTimeout(() => setMsg(''), 3000)
  }

  const openEvent = (e: EventItem) => onOpenStock({ market: e.market, code: e.code, name: e.name })

  return (
    <div className="h-full overflow-y-auto px-2.5 pb-3">
      {/* 吸顶头部 */}
      <div className="ds-sticky-head -mx-2.5 mb-1.5 flex items-center justify-between border-b border-slate-100 px-2.5 pb-1.5 pt-2">
        <span className="flex items-center gap-1.5 text-[13px] font-semibold text-slate-800">
          <ClipboardList className="h-3.5 w-3.5 text-emerald-500" />
          复盘 · {day.slice(5)}
        </span>
        <div className="flex items-center gap-2">
          {savedAt && <span className="text-[9px] text-slate-300">已存 {new Date(savedAt).toLocaleTimeString('zh-CN', { hour12: false })}</span>}
          <button
            onClick={() => { setLoading(true); void load() }}
            className="rounded p-0.5 text-slate-300 hover:bg-slate-100 hover:text-slate-500"
            title="刷新数据"
          >
            <RefreshCw className={`h-3 w-3 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      {error && <div className="mb-1.5 rounded bg-red-50 px-2 py-1.5 text-[11px] text-red-500">{error}</div>}
      {msg && <div className="mb-1.5 rounded bg-emerald-50 px-2 py-1 text-[10px] text-emerald-600">{msg}</div>}
      {loading && !ladder && <div className="py-8 text-center text-xs text-slate-300">复盘数据装配中（涨停池 K 线较慢）…</div>}

      {/* 七步复盘引导条：按序完成 = 一天的复盘闭环（视觉暗示流程目标） */}
      <div className="ds-no-scrollbar mb-1.5 flex items-center gap-1 overflow-x-auto rounded-md border border-slate-100 bg-white/70 px-1.5 py-1">
        {STEPS.map((s, i) => (
          <div key={s.id} className="flex shrink-0 items-center gap-1">
            {i > 0 && <span className="text-[8px] text-slate-200">›</span>}
            <span
              className={`whitespace-nowrap rounded px-1.5 py-0.5 text-[9px] font-medium ${s.id === 'plan' ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-500'}`}
              title={s.hint}
            >
              {i + 1} {s.label}
            </span>
          </div>
        ))}
      </div>

      {breadth && regime && (
        <>
          {/* ① 整体情绪：温度计 + 广度（先看天气再看衣服） */}
          <div className="mb-1.5 rounded-md border border-slate-100 bg-slate-50/60 px-2 py-1.5">
            <div className="mb-1 text-[10px] font-medium text-slate-400">① 整体情绪 · 今日盘眼</div>
            <div className="mb-1 flex items-center gap-1.5">
              <span className="font-mono text-[16px] font-bold leading-none tabular-nums" style={{ color: bandColor(regime.band) }}>
                {regime.temperature}
              </span>
              <span className="rounded bg-slate-200 px-1 text-[8px] text-slate-600">{bandLabel(regime.band)}</span>
              <span className="ml-auto text-[9px] text-slate-400">涨停 {breadth.limitUp} · 跌停 {breadth.limitDown} · 额 {fmtBigNum(breadth.amountSum)}</span>
            </div>
            {regime.drivers.length > 0 && (
              <div className="mb-1 flex flex-wrap gap-1">
                {regime.drivers.map((d) => (
                  <span key={d} className="rounded bg-white px-1 py-px text-[8px] text-slate-500">{d}</span>
                ))}
              </div>
            )}
            {/* 温度计输入口径：实算 vs 近似（N5+ 透明化） */}
            {metricsNote && (
              <div className="mb-1 rounded bg-amber-50/80 px-1 py-0.5 text-[8px] leading-relaxed text-amber-700/90">
                {metricsNote}
              </div>
            )}
            {/* 指数行 */}
            <div className="ds-no-scrollbar flex items-center gap-1.5 overflow-x-auto pb-0.5">
              {indices.slice(0, 6).map((ix) => (
                <button
                  key={`${ix.market}${ix.code}`}
                  onClick={() => onOpenStock({ market: ix.market, code: ix.code, name: ix.name })}
                  className="flex shrink-0 items-center gap-1 rounded bg-white px-1.5 py-0.5 hover:bg-emerald-50"
                  title={ix.name}
                >
                  <span className="text-[9px] text-slate-400">{ix.name.replace('指数', '')}</span>
                  <span className="font-mono text-[9px] tabular-nums" style={{ color: ix.pct > 0 ? UP : ix.pct < 0 ? DOWN : '#94a3b8' }}>
                    {ix.pct > 0 ? '+' : ''}{ix.pct.toFixed(2)}%
                  </span>
                </button>
              ))}
            </div>
            {/* 主线一句话 */}
            {mainLine.length > 0 && (
              <div className="mt-1 flex items-start gap-1 text-[10px] leading-relaxed text-slate-600">
                <span className="shrink-0 rounded bg-red-50 px-1 text-[8px] font-medium text-red-500">主线</span>
                <span>{mainLine.map((m) => m.board).join(' / ')}</span>
              </div>
            )}
          </div>

          {/* ①b 昨日涨停整体表现：昨日涨停今天赚还是亏（杀高位 vs 有溢价） */}
          <PrevPoolPerfBlock perf={prevPerf} />

          {/* ② 连板梯队：最高板是天花板，中间档不能断层 */}
          {tierCounts.length > 0 && (
            <div className="mb-1.5 rounded-md border border-slate-100 bg-slate-50/60 px-2 py-1.5">
              <div className="mb-1 flex items-center justify-between">
                <span className="flex items-center gap-1 text-[10px] font-medium text-slate-400">
                  <Flame className="h-3 w-3 text-red-500" />② 连板梯队（{breadth.up > 0 ? `${ladder?.limitUp.length ?? 0} 只` : '—'}）
                </span>
                <span className="text-[9px] text-slate-300">上涨 {breadth.up} · 下跌 {breadth.down} · 大面(≤-3%) {breadth.strongDown}</span>
              </div>
              <div className="space-y-1">
                {tierCounts.map(([n, c]) => (
                  <div key={n} className="grid grid-cols-[34px_1fr_26px] items-center gap-1.5">
                    <span className={`font-mono text-[10px] font-bold ${n >= 5 ? 'text-red-500' : n >= 3 ? 'text-amber-500' : 'text-slate-500'}`}>{n}板</span>
                    <div className="h-1 overflow-hidden rounded-full bg-slate-200/70">
                      <div className="h-full rounded-full" style={{ width: `${Math.max(6, (c / maxTier) * 100)}%`, background: n >= 3 ? 'rgba(199,64,64,0.7)' : 'rgba(148,163,184,0.6)' }} />
                    </div>
                    <span className="text-right font-mono text-[10px] text-slate-500">{c}</span>
                  </div>
                ))}
              </div>
              {tierGaps.max > 0 && tierGaps.gaps.length > 0 ? (
                <div className="mt-1 rounded bg-amber-50 px-1.5 py-0.5 text-[9px] leading-snug text-amber-600">
                  ⚠️ 梯队断层：{tierGaps.gaps.map((n) => `${n}板`).join(' / ')} 无承接 → 资金不敢接力，高位股随时崩
                </div>
              ) : (
                <div className="mt-1 text-[8px] text-slate-300">
                  {tierGaps.max > 0 ? `最高 ${tierGaps.max} 板 · 梯队完整（1~${tierGaps.max} 板均有承接）` : '—'}
                </div>
              )}
            </div>
          )}

          {/* ③ 板块结构：涨停潮 ≥3 = 资金阵地（涨停是单兵，板块才是阵地） */}
          <SurgeBoardsBlock boards={ladder?.boards ?? []} onOpenStock={onOpenStock} />

          {/* ④ 资金流向：成交额前 20 大票涨跌（涨幅榜给散户，成交额榜给猎人） */}
          <AmountTopBlock rows={rows} onOpenStock={onOpenStock} />

          {/* N3（复盘引用面）：强度差分 + 低位首板候选（候选池 = 今日池 ∪ 上一交易日池 ∪ 板块代表；供 ⑥ 风向标与 ⑦ 计划取材） */}
          {strength.running && (
            <div className="mb-1.5 rounded-md border border-slate-100 bg-slate-50/60 px-2 py-1.5 text-[10px] text-slate-400">
              强度差分分析中…（候选池 ≤120 只 · DAILY(5) · 约 10–40s）
            </div>
          )}
          {!strength.running && strength.error && (
            <div className="mb-1.5 rounded-md border border-amber-200 bg-amber-50/70 px-2 py-1 text-[10px] text-amber-600">
              {strength.error}
            </div>
          )}
          {!strength.running && strength.rows.length > 0 && (
            <>
              <div className="mb-1.5 rounded-md border border-slate-100 bg-slate-50/60 px-2 py-1.5">
                <div className="mb-1 flex items-center justify-between">
                  <span className="text-[10px] font-medium text-slate-400">
                    强弱甄别 · 候选池（{strength.rows.length} 只已算）
                  </span>
                  <span className="text-[8px] text-slate-300" title="真强=放量封板·动能增强；惯性=Δ3&lt;0 的假强；转弱=高位放量滞涨">
                    真强 vs 惯性 · 剔"平"
                  </span>
                </div>
                <div className="space-y-0.5">
                  {kindRows.map(({ row, kind }) => (
                    <div key={row.symbol} className="flex items-center gap-1 rounded bg-white px-1 py-0.5">
                      <button
                        onClick={() => onOpenStock({ market: row.market, code: row.code, name: row.name })}
                        className="min-w-0 flex-1 truncate text-left text-[11px] text-slate-700 hover:text-emerald-600"
                        title={`${row.name} ${row.code} · 5日累计 ${row.cum5.toFixed(1)}% · Δ3 ${row.delta3 > 0 ? '+' : ''}${row.delta3.toFixed(1)} · 量比 ${row.volRatio.toFixed(2)}`}
                      >
                        {row.name}
                      </button>
                      <span className="shrink-0 font-mono text-[8px] text-slate-300">{row.code.slice(-4)}</span>
                      <span
                        className="shrink-0 rounded px-1 text-[8px] font-medium"
                        style={{ color: strongKindColor(kind), backgroundColor: `${strongKindColor(kind)}1a` }}
                      >
                        {strongKindLabel(kind)}
                      </span>
                      <span className="shrink-0 font-mono text-[8px] tabular-nums text-slate-400">
                        {row.pct_today > 0 ? '+' : ''}{row.pct_today.toFixed(1)}%
                      </span>
                      <button
                        onClick={() => addFromRow(row, kind)}
                        className="shrink-0 rounded px-1 text-[10px] leading-none text-emerald-500 hover:bg-emerald-50"
                        title="加入预期清单"
                      >
                        ＋
                      </button>
                    </div>
                  ))}
                </div>
              </div>

              {lowBoards.length > 0 && (
                <div className="mb-1.5 rounded-md border border-slate-100 bg-emerald-50/40 px-2 py-1.5">
                  <div className="mb-1 flex items-center justify-between">
                    <span className="text-[10px] font-medium text-slate-400">
                      低位首板候选（低位新方向 · 观察池）
                    </span>
                    <span className="text-[8px] text-slate-300" title="综合分：首板 · 量比健康(1.5~5) · 位置低(cum5) · 动能增强 · 板块扩散">
                      量比健康 · 位置低 · 扩散
                    </span>
                  </div>
                  <div className="space-y-0.5">
                    {lowBoards.map((c) => (
                      <div key={c.row.symbol} className="flex items-center gap-1 rounded bg-white px-1 py-0.5">
                        <button
                          onClick={() => onOpenStock({ market: c.row.market, code: c.row.code, name: c.row.name })}
                          className="min-w-0 flex-1 truncate text-left text-[11px] text-slate-700 hover:text-emerald-600"
                          title={`${c.row.name} ${c.row.code} · 量比 ${c.row.volRatio.toFixed(2)} · 5日累计 ${c.row.cum5.toFixed(1)}% · Δ3 ${c.row.delta3 > 0 ? '+' : ''}${c.row.delta3.toFixed(1)}`}
                        >
                          {c.row.name}
                        </button>
                        <span className="shrink-0 font-mono text-[8px] text-slate-300">{c.row.code.slice(-4)}</span>
                        <span className="shrink-0 font-mono text-[8px] tabular-nums text-slate-400">
                          量比 {c.row.volRatio.toFixed(2)}
                        </span>
                        <span className="shrink-0 rounded bg-emerald-100 px-1 font-mono text-[8px] font-semibold text-emerald-600">
                          {c.score.toFixed(0)}
                        </span>
                        <button
                          onClick={() => addFromRow(c.row, classifyStrength(c.row))}
                          className="shrink-0 rounded px-1 text-[10px] leading-none text-emerald-500 hover:bg-emerald-50"
                          title="加入预期清单"
                        >
                          ＋
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}

          {limitDownEvents.length > 0 && (
            <div className="mb-1.5 rounded-md border border-slate-100 bg-green-50/50 px-2 py-1.5">
              <div className="mb-1 text-[10px] font-medium text-slate-400">跌停事件（已捕获）</div>
              <ul className="space-y-0.5">
                {limitDownEvents.map((e) => (
                  <li key={e.key}>
                    <button onClick={() => openEvent(e)} className="flex w-full items-center gap-1 rounded px-1 py-0.5 text-left hover:bg-white">
                      <span className="min-w-0 flex-1 truncate text-[11px] text-slate-600">{e.name}</span>
                      <span className="font-mono text-[9px] text-slate-300">{e.time}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {breakEvents.length > 0 && (
            <div className="mb-1.5 rounded-md border border-slate-100 bg-amber-50/50 px-2 py-1.5">
              <div className="mb-1 text-[10px] font-medium text-slate-400">炸板清单（盘中已捕获，收盘只读）</div>
              <ul className="space-y-0.5">
                {breakEvents.map((e) => (
                  <li key={e.key}>
                    <button onClick={() => openEvent(e)} className="flex w-full items-center gap-1 rounded px-1 py-0.5 text-left hover:bg-white">
                      <span className="min-w-0 flex-1 truncate text-[11px] text-slate-600">{e.name} {e.desc}</span>
                      <span className="font-mono text-[9px] text-slate-300">{e.time}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </>
      )}

      {/* ⑤ 亏钱效应：昨日涨停今日大面/跌停 = 雷区样本 + 共性记录（盯亏钱效应会冷静） */}
      <LossBlock samples={prevLosers} riskNote={riskNote} onRiskNote={setRiskNote} />

      {/* ⑥ 风向标：把今天有特点的票标记进明日观察（≤8，强则板块强） */}
      <WindFlagBlock
        candidates={windCandidates}
        marked={windFlags}
        onMark={markWind}
        onUnmark={unmarkWind}
        onOpenStock={onOpenStock}
      />

      {/* ⑦ 明日交易计划：预期清单（≤5；板块跟踪 / 竞价信号出手 / 信号收手） */}
      <div className="mb-1.5 rounded-md border border-slate-100 bg-slate-50/60 px-2 py-1.5">
        <div className="mb-1 flex items-center justify-between">
          <span className="text-[10px] font-medium text-slate-400">⑦ 明日交易计划 · 预期清单 · {expectations.length}/5</span>
          <button
            onClick={() => setPicking((v) => !v)}
            className="flex items-center gap-0.5 rounded bg-emerald-500 px-1.5 py-0.5 text-[9px] font-medium text-white hover:bg-emerald-600"
          >
            <Plus className="h-2.5 w-2.5" />从涨停池加入
          </button>
        </div>

        {picking && ladder && (
          <div className="mb-1.5 max-h-40 overflow-y-auto rounded border border-slate-100 bg-white py-0.5">
            {ladder.limitUp.slice(0, 15).map((s) => {
              const already = expectations.some((e) => e.symbol === `${s.market}${s.code}`)
              return (
                <button
                  key={`${s.market}${s.code}`}
                  disabled={already || expectations.length >= 5}
                  onClick={() => addExpectation(s)}
                  className="flex w-full items-center gap-1.5 px-1.5 py-1 text-left hover:bg-emerald-50 disabled:opacity-40"
                >
                  <span className="min-w-0 flex-1 truncate text-[11px] text-slate-700">{s.name}</span>
                  {s.streakKnown && s.streak > 1 && (
                    <span className="shrink-0 rounded bg-red-50 px-1 font-mono text-[8px] text-red-500">{s.streak}板</span>
                  )}
                  <span className="shrink-0 font-mono text-[8px] text-slate-300">{s.code}</span>
                  {already && <span className="shrink-0 text-[8px] text-emerald-500">已加入</span>}
                </button>
              )
            })}
          </div>
        )}

        {expectations.length === 0 && !picking && (
          <div className="py-2 text-center text-[10px] text-slate-300">从今日涨停池加入龙头，或暂无预期</div>
        )}

        <div className="space-y-1.5">
          {expectations.map((exp) => (
            <div key={exp.id} className="rounded-md border border-slate-100 bg-white px-1.5 py-1">
              <div className="mb-1 flex items-center gap-1">
                <span className="min-w-0 flex-1 truncate text-[11px] font-semibold text-slate-700">{exp.name}</span>
                <span className="rounded bg-slate-100 px-1 font-mono text-[8px] text-slate-400">{exp.symbol}</span>
                <button onClick={() => removeExp(exp.id)} className="text-slate-200 hover:text-red-500">
                  <X className="h-3 w-3" />
                </button>
              </div>
              <div className="mb-1 grid grid-cols-4 gap-1">
                <Field label="状态">
                  <select
                    value={exp.state}
                    onChange={(e) => updateExp(exp.id, { state: e.target.value as ExpectItem['state'] })}
                    className={FIELD_CLS}
                  >
                    {STATE_OPTS.map((o) => (
                      <option key={o.v} value={o.v}>{o.l}</option>
                    ))}
                  </select>
                </Field>
                <Field label="题材天">
                  <input
                    type="number"
                    min={1}
                    max={30}
                    value={exp.tags.themeDay ?? 1}
                    onChange={(e) => updateExp(exp.id, { tags: { ...exp.tags, themeDay: Math.max(1, Number(e.target.value) || 1) } })}
                    className={FIELD_CLS}
                  />
                </Field>
                <Field label="层级">
                  <select
                    value={exp.tags.level}
                    onChange={(e) => updateExp(exp.id, { tags: { ...exp.tags, level: e.target.value as ExpectItem['tags']['level'] } })}
                    className={FIELD_CLS}
                  >
                    {LEVEL_OPTS.map((o) => (
                      <option key={o.v} value={o.v}>{o.l}</option>
                    ))}
                  </select>
                </Field>
                <Field label="角色">
                  <select
                    value={exp.tags.role}
                    onChange={(e) => updateExp(exp.id, { tags: { ...exp.tags, role: e.target.value as ExpectItem['tags']['role'] } })}
                    className={FIELD_CLS}
                  >
                    {ROLE_OPTS.map((o) => (
                      <option key={o.v} value={o.v}>{o.l}</option>
                    ))}
                  </select>
                </Field>
              </div>
              <TextRow
                label="剧本"
                value={exp.scenario}
                maxLen={40}
                placeholder="明日最可能路径（如：加速一致/高开分歧…）"
                onChange={(v) => updateExp(exp.id, { scenario: v })}
              />
              <TextRow
                label="竞价条件"
                value={exp.auctionOK}
                maxLen={60}
                placeholder="可量化，如：高开3%+竞价量>昨日20%"
                onChange={(v) => updateExp(exp.id, { auctionOK: v })}
              />
              <TextRow
                label="失败条件"
                value={exp.failIf}
                maxLen={60}
                placeholder="出现即放弃（断板/破位/板块退潮…）"
                onChange={(v) => updateExp(exp.id, { failIf: v })}
              />
              <TextRow
                label="理由"
                value={exp.reason}
                maxLen={80}
                placeholder="一句话含量价证据，不允许纯叙事"
                onChange={(v) => updateExp(exp.id, { reason: v })}
              />
            </div>
          ))}
        </div>
      </div>

      {/* ④ 存档 */}
      <button
        onClick={save}
        disabled={!breadth || !regime || loading}
        className="flex w-full items-center justify-center gap-1.5 rounded-md bg-emerald-600 py-1.5 text-[12px] font-semibold text-white hover:bg-emerald-700 disabled:opacity-40"
      >
        <Save className="h-3.5 w-3.5" />完成七步复盘 · 存档今日
      </button>
      <div className="mt-1 text-center text-[9px] text-slate-300">
        预期清单 ≤5 · 风向标 ≤8 · 存档按日覆盖 · 供次日竞价对照（保存后刷新不丢）
      </div>
    </div>
  )
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block min-w-0">
      <div className="mb-0.5 text-[8px] text-slate-300">{label}</div>
      {children}
    </label>
  )
}

function TextRow({
  label, value, maxLen, placeholder, onChange,
}: {
  label: string
  value: string
  maxLen: number
  placeholder?: string
  onChange: (v: string) => void
}) {
  return (
    <label className="mb-1 block">
      <div className="mb-0.5 text-[8px] text-slate-300">{label}</div>
      <input
        value={value}
        maxLength={maxLen}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        className={FIELD_CLS}
      />
    </label>
  )
}
