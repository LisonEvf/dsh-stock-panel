/**
 * 当日运行记录（N8 目标强化：dayrun.ts）。
 *
 * 依据 WATCH-METHODOLOGY §5「盘中只答 Q1-Q3」与 §8「固定时间表」：
 * 把「作战」页每天要完成的事情（竞价对照逐条判定、盘中三问 Q1-Q3、尾盘动作点）
 * 落成**按日存档的任务状态**，供 SessionMission 任务条读进度、次日复盘引用。
 *
 * localStorage key: dsh-stock-panel:dayrun:v1（按日数组，新→旧，上限 60 日）。
 * 模块级内存态 + 变更通知（复用 watchlist-store / positions.ts 模式）。
 */

import type { Situation } from './situation'
import type { Verdict } from './auction-analysis'
import { onHostHydrated, syncTable } from './host-state'

/** Q1 持续性证据方向（WATCH-METHODOLOGY §5 Q1）。 */
export type Q1Value = 'strengthen' | 'weaken' | 'flat'

/** Q3 对某标的的动作（WATCH-METHODOLOGY §5.4 / §8）。 */
export type Q3Action = 'hold' | 'reduce' | 'clear' | 'addTrial'

/** Q3 单标的记录。 */
export interface Q3Entry {
  action: Q3Action
  at: number
}

/** 当日运行记录（一天一份，全部字段可选：没答的即为未完成）。 */
export interface DayRun {
  day: string // '2026-09-07'
  /** Q1：持续性证据增强/衰减/中性。 */
  q1?: { value: Q1Value; at: number }
  /** Q2：局势确认（系统给候选，人确认/修正，WATCH-METHODOLOGY §5 Q2）。 */
  q2?: { situation: Situation; from: 'auto' | 'manual'; at: number }
  /** Q3：动作（对持仓逐只给结论；空仓时用 idle 表示「空仓观望」）。 */
  q3?: { bySymbol: Record<string, Q3Entry>; idle: boolean; at: number }
  /** 竞价对照判定写回：symbol → 判定（PRODUCT-DESIGN §5.1 对照矩阵）。 */
  verdicts: Record<string, { verdict: Verdict; at: number }>
}

const STORAGE_KEY = 'dsh-stock-panel:dayrun:v1'
const MAX_DAYS = 60

let runs: DayRun[] = load()
const listeners = new Set<() => void>()

function load(): DayRun[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const arr = JSON.parse(raw) as DayRun[]
    if (!Array.isArray(arr)) return []
    return arr
      .filter((r) => r && typeof r.day === 'string' && r.verdicts)
      .sort((a, b) => (a.day < b.day ? 1 : -1))
      .slice(0, MAX_DAYS)
  } catch {
    return []
  }
}

function persist(): void {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(runs)) } catch { /* 隐私模式等忽略 */ }
  // A1：host 域同步（增量；不可用时自动 no-op）。
  syncTable('dayrun', runs)
}

function notify(): void {
  for (const fn of listeners) { try { fn() } catch { /* ignore */ } }
}

function upsert(next: DayRun): DayRun {
  runs = [next, ...runs.filter((r) => r.day !== next.day)]
    .sort((a, b) => (a.day < b.day ? 1 : -1))
    .slice(0, MAX_DAYS)
  persist()
  notify()
  return next
}

export function subscribeDayRun(fn: () => void): () => void {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

/** 某日运行记录（无则 null，调用方按未完成处理）。 */
export function getDayRun(day: string): DayRun | null {
  return runs.find((r) => r.day === day) ?? null
}

/** 历史全部（新→旧）。 */
export function getDayRuns(): DayRun[] {
  return runs.slice()
}

/** 取或建当日记录（返回最新快照）。 */
export function ensureDayRun(day: string): DayRun {
  const cur = getDayRun(day)
  if (cur) return cur
  return upsert({ day, verdicts: {} })
}

/** 答 Q1。 */
export function setQ1(day: string, value: Q1Value): DayRun {
  const run = ensureDayRun(day)
  return upsert({ ...run, q1: { value, at: Date.now() } })
}

/** 确认/修正 Q2 局势。 */
export function setQ2(day: string, situation: Situation, from: 'auto' | 'manual'): DayRun {
  const run = ensureDayRun(day)
  return upsert({ ...run, q2: { situation, from, at: Date.now() } })
}

/** Q3：给某标的记一个动作（重复点击同一动作视为「再确认」，更新时间）。 */
export function setQ3Symbol(day: string, symbol: string, action: Q3Action): DayRun {
  const run = ensureDayRun(day)
  const prev = run.q3 ?? { bySymbol: {}, idle: false, at: Date.now() }
  const bySymbol = { ...prev.bySymbol, [symbol]: { action, at: Date.now() } }
  return upsert({ ...run, q3: { bySymbol, idle: prev.idle, at: Date.now() } })
}

/** Q3：空仓观望标记（idle=true 视为 Q3 已完成：无动作也是一种决策）。 */
export function setQ3Idle(day: string, idle: boolean): DayRun {
  const run = ensureDayRun(day)
  const prev = run.q3 ?? { bySymbol: {}, idle: false, at: Date.now() }
  return upsert({ ...run, q3: { bySymbol: prev.bySymbol, idle, at: Date.now() } })
}

/** 竞价对照：写回某预期的判定。 */
export function setVerdict(day: string, symbol: string, verdict: Verdict): DayRun {
  const run = ensureDayRun(day)
  return upsert({
    ...run,
    verdicts: { ...run.verdicts, [symbol]: { verdict, at: Date.now() } },
  })
}

/** 清除某预期的判定（判错了可重判）。 */
export function unsetVerdict(day: string, symbol: string): DayRun {
  const run = getDayRun(day)
  if (!run || !run.verdicts[symbol]) return run ?? { day, verdicts: {} }
  const verdicts = { ...run.verdicts }
  delete verdicts[symbol]
  return upsert({ ...run, verdicts })
}

/** 当前交易日字符串（与复盘/竞价口径一致：本地日期）。 */
export function today(): string {
  const d = new Date()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  return `${d.getFullYear()}-${m}-${dd}`
}

// A1：host 域数据落地后，用权威版本重载并通知 UI。
onHostHydrated(() => {
  runs = load()
  notify()
})
