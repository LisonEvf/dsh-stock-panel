/**
 * 复盘次日实算指标（W2：review-metrics.ts，纯函数）。
 *
 * 依据 PRODUCT-DESIGN §4.2 / §5.2 与 WATCH-METHODOLOGY §6：
 * 温度计的晋级率 / 炸板率 / 首板溢价三项输入，此前为近似初值。v3 起复盘存档
 * 携带当日涨停池（review-store.limitUpPool），次日复盘用本模块**实算**：
 *
 *   - promoteRate      = 昨日涨停 ∩ 今日涨停 / 昨日涨停数
 *   - firstBoardPremium= 昨日首板（streak=1）今日平均涨跌幅（全 A 快照 pct）
 *   - brokenRate       = 今日盘中炸板（独立标的）/ 曾涨停（炸板 ∪ 最终涨停）
 *                        —— 仅当当日事件流有捕获证据时才可信，否则返回 null
 *
 * 任一输入缺证据（无昨日快照 / 休市无全 A / 事件未捕获）时返回 null，
 * 由调用方回落近似初值并显式标注口径（禁止假装精度）。
 *
 * 全部为纯函数，便于脱离浏览器单测/复核。
 */

import type { LimitUpPoolItem } from './review-store'
import type { AShareRow } from './stock-data'
import type { MarketTag } from './symbol'

/** 由今日涨停池（LadderStock 子集）建档。 */
export function buildLimitUpPool(
  items: { market: MarketTag; code: string; name: string; streak: number; streakKnown: boolean }[],
): LimitUpPoolItem[] {
  return items.map((s) => ({
    symbol: `${s.market}${s.code}`,
    name: s.name,
    streak: s.streak,
    streakKnown: s.streakKnown,
  }))
}

/** 全 A 今日行索引（symbol → pct/是否涨停），供首板溢价等按 code 查价。 */
export interface TodayRow {
  pct: number
  atLimit: boolean
}

/** 全 A 快照 → 按 `${market}${code}` 索引（涨停判定与 ladder 同口径：触及涨停价）。 */
export function indexTodayRows(rows: AShareRow[]): Map<string, TodayRow> {
  const m = new Map<string, TodayRow>()
  for (const r of rows) {
    const atLimit = r.buy_price_limit > 0 && Math.abs(r.close - r.buy_price_limit) < 1e-6
    m.set(`${r.market}${r.code}`, { pct: r.pct, atLimit })
  }
  return m
}

export interface PrevDayCalcArgs {
  /** 上一交易日快照的涨停池（v3 limitUpPool；v2 旧档为 undefined）。 */
  prevPool: LimitUpPoolItem[] | undefined
  /** 今日涨停池 symbol 集合（${market}${code}）。 */
  todayPoolSymbols: Set<string>
  /** 今日全 A 行索引（indexTodayRows）。 */
  todayRow: Map<string, TodayRow>
  /** 今日盘中炸板标的 symbol 集合（事件流 break/开板类，去重）。 */
  todayBreakSymbols: Set<string>
  /** 今日是否捕获到任何盘中事件（炸板率 0 与"未捕获"的判别依据）。 */
  hasCaptureToday: boolean
}

export interface PrevDayCalc {
  /** 实算值；null = 无证据（调用方回落近似并标注）。 */
  promoteRate: number | null
  firstBoardPremium: number | null
  brokenRate: number | null
  /** 用于 UI 标注的辅助量。 */
  prevPoolSize: number
  /** 昨日首板中今日有行情、参与溢价统计的只数。 */
  premiumSamples: number
  breakSamples: number
}

/**
 * 用上一交易日涨停池实算温度计三项输入。
 * 断言性约束：promoteRate/firstBoardPremium/brokenRate ∈ [0,1] / 溢价无上界（日常 <20%）。
 */
export function computePrevDayMetrics(args: PrevDayCalcArgs): PrevDayCalc {
  const pool = args.prevPool ?? []
  const prevPoolSize = pool.length

  // 1) 晋级率：昨日涨停今日仍涨停 / 昨日涨停
  let promoteRate: number | null = null
  if (pool.length > 0) {
    let still = 0
    for (const p of pool) {
      if (args.todayPoolSymbols.has(p.symbol)) still++
    }
    promoteRate = still / pool.length
  }

  // 2) 首板溢价：昨日首板（streak=1 且已知）今日平均涨跌幅
  let firstBoardPremium: number | null = null
  let premiumSamples = 0
  {
    const pcts: number[] = []
    for (const p of pool) {
      if (!p.streakKnown || p.streak !== 1) continue
      const row = args.todayRow.get(p.symbol)
      if (row) {
        pcts.push(row.pct)
        premiumSamples++
      }
    }
    if (premiumSamples > 0) {
      firstBoardPremium = pcts.reduce((a, b) => a + b, 0) / premiumSamples
    }
  }

  // 3) 炸板率：炸板标的 / 曾涨停（炸板 ∪ 最终涨停）
  let brokenRate: number | null = null
  let breakSamples = 0
  if (args.hasCaptureToday) {
    const union = new Set(args.todayPoolSymbols)
    for (const s of args.todayBreakSymbols) union.add(s)
    breakSamples = args.todayBreakSymbols.size
    if (union.size > 0) {
      brokenRate = args.todayBreakSymbols.size / union.size
    }
  }

  return { promoteRate, firstBoardPremium, brokenRate, prevPoolSize, premiumSamples, breakSamples }
}
