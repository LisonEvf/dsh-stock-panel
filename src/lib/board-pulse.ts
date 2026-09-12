/**
 * 板块资金脉冲（N4：board-pulse.ts）。
 *
 * 依据 WATCH-METHODOLOGY §5.1「观察口径」与 PRODUCT-DESIGN §3.2 P3 管道：
 *   - 热度板集合(≤8) 每轮 board_members(count≤100, CHANGE_PCT desc)；
 *   - 每轮差分 → 涨停数 δ、板块内均涨幅 δ、成交额占比 δ > 阈值
 *     (默认 涨停+1 或 均涨幅>+1.5pp) → pulse 事件。
 *
 * 数据源约束（PRODUCT-DESIGN §2.3）：board_members 的 sort_type=AMOUNT 报错，
 * 按金额需客户端自排。
 */

import { fetchBoardMembers, type QuoteRow } from './stock-data'
import { runPool } from './pool'

export interface BoardPulse {
  board: string // 板块代码
  name: string
  /** 本轮涨停数（由成分行情算）。 */
  limitUp: number
  /** 本轮均涨幅（%）。 */
  avgPct: number
  /** 成交额占比（0-1）。 */
  amountShare: number
  /** 与上轮差分后仅保留 δ 显著者。 */
  deltaLimitUp: number
  deltaAvgPct: number
  leader: { code: string; name: string; pct: number } | null
}

/** 热度板（来自 ladder.top 或全 A 聚合）。 */
export interface HeatBoard {
  boardSymbol: string
  name: string
}

/** 脉冲判定阈值。 */
export interface PulseThresholds {
  /** 涨停数增量阈值。 */
  deltaLimitUp: number
  /** 均涨幅增量阈值（pp）。 */
  deltaAvgPct: number
}

export const DEFAULT_PULSE_THRESHOLDS: PulseThresholds = {
  deltaLimitUp: 1,
  deltaAvgPct: 1.5,
}

/**
 * 从 board_members 成分行情算板块统计（涨停数 / 均涨幅 / 成交额占比）。
 */
export function computeBoardStats(
  rows: QuoteRow[],
  buyLimitPct: (code: string, name: string) => number = defaultBuyLimitPct
): { limitUp: number; avgPct: number; amountShare: number } {
  if (!rows.length) return { limitUp: 0, avgPct: 0, amountShare: 0 }
  let limitUp = 0
  let pctSum = 0
  let amountSum = 0
  for (const r of rows) {
    const close = Number(r.close)
    const preClose = Number(r.pre_close)
    if (!close || !preClose || preClose <= 0) continue
    const pct = ((close - preClose) / preClose) * 100
    pctSum += pct
    amountSum += Number(r.amount ?? 0)
    // 涨停判定：涨幅 ≥ 涨停幅度 - 0.3pp
    const lim = buyLimitPct(String(r.code), r.name || '')
    if (pct >= lim - 0.3) limitUp++
  }
  return {
    limitUp,
    avgPct: pctSum / rows.length,
    amountShare: amountSum,
  }
}

/** 默认涨停幅度（主板 10%，创业/科创 20%，北交 30%）。 */
function defaultBuyLimitPct(code: string): number {
  const c = code.replace(/\D/g, '').slice(-6)
  if (/^(300|301|688)/.test(c)) return 0.2
  if (/^(4|8|92)/.test(c)) return 0.3
  return 0.1
}

/**
 * 一轮板块脉冲检测。
 * 输入：本轮热度板 + 上轮统计快照。
 * 返回 δ 显著的热度板（脉冲事件）。
 */
export async function detectBoardPulse(
  heatBoards: HeatBoard[],
  prevStats: Map<string, { limitUp: number; avgPct: number; amountShare: number }>,
  thresholds: PulseThresholds = DEFAULT_PULSE_THRESHOLDS,
  concurrency = 4
): Promise<BoardPulse[]> {
  if (!heatBoards.length) return []
  const results = await runPool(heatBoards, async (b) => {
    try {
      const rows = await fetchBoardMembers(b.boardSymbol, 100, 'CHANGE_PCT', 'DESC')
      const stats = computeBoardStats(rows)
      const prev = prevStats.get(b.boardSymbol)
      const deltaLimitUp = prev ? stats.limitUp - prev.limitUp : stats.limitUp
      const deltaAvgPct = prev ? stats.avgPct - prev.avgPct : stats.avgPct
      // 显著：涨停数增量或均涨幅增量超阈值
      const significant = Math.abs(deltaLimitUp) >= thresholds.deltaLimitUp ||
        Math.abs(deltaAvgPct) >= thresholds.deltaAvgPct
      if (!significant) return null
      // 龙头：涨幅最大的成分
      const sorted = rows
        .map((r) => ({ code: String(r.code), name: r.name || String(r.code), pct: 0 }))
        .sort((a, b) => b.pct - a.pct)
      const leader = sorted[0] ?? null
      return {
        board: b.boardSymbol,
        name: b.name,
        limitUp: stats.limitUp,
        avgPct: stats.avgPct,
        amountShare: stats.amountShare,
        deltaLimitUp,
        deltaAvgPct,
        leader,
      } as BoardPulse
    } catch {
      return null
    }
  }, { concurrency })
  return results.filter((p): p is BoardPulse => !!p)
}
