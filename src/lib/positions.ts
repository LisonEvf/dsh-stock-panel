/**
 * 持仓管理 + 交易日志自统计（N6：positions.ts）。
 *
 * 依据 WATCH-METHODOLOGY §7「仓位管理」与 PRODUCT-DESIGN §5.4 骨架：
 *   - positions.ts：持仓记录（localStorage），关联当日预期、失败条件；
 *   - 交易日志：每笔平仓后记录（信号类型 / 结果 / 持有期）→ p̂/b̂ 滚动统计
 *     （≥50 样本才启用建议仓位，样本不足显示「无证据，空仓」）。
 */

import type { ExpectItem } from './review-store'
import { onHostHydrated, syncTable } from './host-state'

// ===== 持仓 =====

export interface PositionPlan {
  stopLoss: number // 止损价
  failIf: string // 失败条件（复盘时已写）
  target?: number // 目标价
  note: string
}

export interface Position {
  symbol: string // 'SH603138'
  market: 'SH' | 'SZ' | 'BJ'
  code: string
  name: string
  entryDate: string // '2026-09-04'
  entryPrice: number
  shares: number
  plan: PositionPlan // 失败条件复盘时已写
  /** 关联当日预期状态（可选）。 */
  expectState?: ExpectItem['state']
}

// ===== 交易日志（持有期口径）=====

export type SignalKind =
  | 'trueStrong' // 真强打板
  | 'weak2strong' // 弱转强低吸
  | 'lowBoard' // 低位首板
  | 'leader' // 龙头
  | 'catchup' // 补涨
  | 'other'

export interface TradeLog {
  id: string
  symbol: string
  name: string
  signal: SignalKind
  entryDate: string
  exitDate: string // 平仓日（持有期口径：持有至次一可卖日）
  entryPrice: number
  exitPrice: number
  shares: number
  /** 持有期收益率（%）。 */
  pnlPct: number
  /** 是否盈利。 */
  profit: boolean
  /** 备注。 */
  note?: string
}

const POS_KEY = 'dsh-stock-panel:positions:v1'
const LOG_KEY = 'dsh-stock-panel:tradelog:v1'

let positions: Position[] = loadPos()
let log: TradeLog[] = loadLog()
const listeners = new Set<() => void>()

function loadPos(): Position[] {
  try {
    const raw = localStorage.getItem(POS_KEY)
    if (!raw) return []
    const arr = JSON.parse(raw) as Position[]
    return Array.isArray(arr) ? arr : []
  } catch {
    return []
  }
}

function loadLog(): TradeLog[] {
  try {
    const raw = localStorage.getItem(LOG_KEY)
    if (!raw) return []
    const arr = JSON.parse(raw) as TradeLog[]
    return Array.isArray(arr) ? arr : []
  } catch {
    return []
  }
}

function persistPos(): void {
  try { localStorage.setItem(POS_KEY, JSON.stringify(positions)) } catch { /* ignore */ }
  syncTable('positions', positions)
}

function persistLog(): void {
  try { localStorage.setItem(LOG_KEY, JSON.stringify(log)) } catch { /* ignore */ }
  syncTable('tradelog', log)
}

function notify(): void {
  for (const fn of listeners) { try { fn() } catch { /* ignore */ } }
}

export function subscribePositions(fn: () => void): () => void {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

// ===== 持仓操作 =====

export function getPositions(): Position[] {
  return positions.slice()
}

export function addPosition(p: Position): Position[] {
  if (positions.some((x) => x.symbol === p.symbol)) return positions
  positions = [...positions, p]
  persistPos()
  notify()
  return positions.slice()
}

export function removePosition(symbol: string): Position[] {
  positions = positions.filter((x) => x.symbol !== symbol)
  persistPos()
  notify()
  return positions.slice()
}

export function updatePosition(symbol: string, patch: Partial<Position>): Position[] {
  const p = positions.find((x) => x.symbol === symbol)
  if (p) Object.assign(p, patch)
  persistPos()
  notify()
  return positions.slice()
}

/**
 * 平仓并记录交易日志（持有期口径）。
 * 返回新增的日志条目。
 */
export function closePosition(
  symbol: string,
  exitPrice: number,
  exitDate: string,
  signal: SignalKind,
  note?: string
): TradeLog | null {
  const p = positions.find((x) => x.symbol === symbol)
  if (!p) return null
  const pnlPct = ((exitPrice - p.entryPrice) / p.entryPrice) * 100
  const trade: TradeLog = {
    id: Date.now().toString(36) + Math.random().toString(36).slice(2, 8),
    symbol: p.symbol,
    name: p.name,
    signal,
    entryDate: p.entryDate,
    exitDate,
    entryPrice: p.entryPrice,
    exitPrice,
    shares: p.shares,
    pnlPct,
    profit: pnlPct > 0,
    note,
  }
  log = [trade, ...log]
  positions = positions.filter((x) => x.symbol !== symbol)
  persistLog()
  persistPos()
  notify()
  return trade
}

// ===== 自统计 p̂/b̂（凯利输入）=====

export interface StatsResult {
  count: number // 样本数
  winCount: number // 盈利笔数
  p: number // 胜率 = 盈利笔 / 总笔
  avgWin: number // 均盈（%）
  avgLoss: number // 均亏（%，绝对值）
  b: number // 盈亏比 = 均盈 / 均亏
  hasEvidence: boolean // 样本 ≥50 才有统计意义
}

/**
 * 按信号类型统计持有期结果（WATCH-METHODOLOGY §7.1-3）。
 * 样本 <50 视为无证据（hasEvidence=false），凯利返回 0（空仓）。
 */
export function computeStats(signal?: SignalKind): StatsResult {
  const items = signal ? log.filter((t) => t.signal === signal) : log
  const count = items.length
  const winCount = items.filter((t) => t.profit).length
  const p = count > 0 ? winCount / count : 0
  const wins = items.filter((t) => t.profit).map((t) => t.pnlPct)
  const losses = items.filter((t) => !t.profit).map((t) => Math.abs(t.pnlPct))
  const avgWin = wins.length ? wins.reduce((a, b) => a + b, 0) / wins.length : 0
  const avgLoss = losses.length ? losses.reduce((a, b) => a + b, 0) / losses.length : 0
  const b = avgLoss > 0 ? avgWin / avgLoss : 0
  return {
    count,
    winCount,
    p,
    avgWin,
    avgLoss,
    b,
    hasEvidence: count >= 50,
  }
}

/** 统计文本（供复盘页显示）。 */
export function statsLabel(s: StatsResult): string {
  if (!s.hasEvidence) return `无证据（${s.count} 样本），空仓`
  return `胜率 ${(s.p * 100).toFixed(0)}% · 盈亏比 ${s.b.toFixed(2)} · ${s.count} 样本`
}

// A1：host 域数据落地后，用权威版本重载（持仓 + 交易日志两张表）。
onHostHydrated(() => {
  positions = loadPos()
  log = loadLog()
  notify()
})
