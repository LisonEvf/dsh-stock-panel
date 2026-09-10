/**
 * 筹码分布（成本分布）计算（前端 L0/L1 版）。
 *
 * 模型：历史衰减换手 —— 每日新增筹码按当日价格区间分布，逐日按换手率等比稀释；
 * 统计窗口 = 从最新向前累计换手 300%（≈流通盘换 3 遍，旧筹码自然衰减 <5%），
 * 不设固定天数（用户口径：按换手累积自适应）。
 *
 * 精度分层：
 *   L0（dayk）：历史 + 当日都用「日K 三角分布」（低点—高点区间、峰在 (开+收)/2），
 *              纯本地算，零网络；
 *   L1（tick） ：当日改用逐笔成交的真实价格分布形状，按「覆盖度」与三角分布加权
 *              混合后再锚定当日量 —— 覆盖度低不夸大精度（实测当前网关逐笔覆盖度
 *              ~1%，逐笔只能修形状不能当全量）。
 *
 * 单位不变量：形状（比例）与覆盖度（Σ逐笔vol / 当日日K vol）均与 vol 单位无关；
 * 历史衰减只用日K自带 turnover（%）/ float_shares；逐笔方向（bs_flag 0/1/2）
 * 与统计无关，天然规避协议语义未定项。
 */

import type { KlineRow } from './api'
import type { TransactionRow } from './stock-data'

/** 价格档（升序；weight 为相对筹码量）。 */
export interface ChipBin {
  price: number
  weight: number
}

export interface ChipStats {
  /** 获利比例 %（现价以下筹码占比，含现价档内线性比例）。 */
  profitPct: number
  /** 加权平均持仓成本。 */
  avgCost: number
  /** 90% 成本区间下沿（筹码量 5% 分位）。 */
  costLow: number
  /** 90% 成本区间上沿（95% 分位）。 */
  costHigh: number
  /** 现价在成本区间的相对位置 0~1（0=贴下沿 1=贴上沿）。 */
  pricePos: number
  /** 90% 成本区间宽度 / 平均成本（集中度，越小越集中）。 */
  concentration: number
}

export type ChipsMode = 'dayk' | 'tick'

export interface ChipsResult {
  bins: ChipBin[]
  stats: ChipStats
  /** dayk=纯日K；tick=当日逐笔修正（覆盖度≥5% 才升级）。 */
  mode: ChipsMode
  /** 参与计算的日数。 */
  windowDays: number
  /** 累计换手（300% 封顶，小数）。 */
  cumTurnover: number
  /** 当日逐笔覆盖度 0..1（Σ逐笔vol/当日日K vol），无逐笔为 0。 */
  coverage: number
  /** 现价锚。 */
  currentPrice: number
  /** true=已达 300% 换手截断；false=历史不足截断（只影响微尾）。 */
  windowComplete: boolean
}

export const CHIPS_MAX_CUM_TURNOVER = 3 // 300%
/** 当日逐笔升级为 tick 模式的最低覆盖度（过低视为不可信）。 */
export const CHIPS_TICK_MIN_COVERAGE = 0.05
const BIN_COUNT = 200

/** 单日换手率（小数）。日K turnover 为 % 优先；回退 volume/float_shares。 */
export function dayTurnover(r: KlineRow): number {
  const t = Number(r.turnover)
  if (Number.isFinite(t) && t > 0) return Math.min(t / 100, 1)
  const fs = Number(r.float_shares)
  const v = Number(r.volume ?? 0)
  if (Number.isFinite(fs) && fs > 0 && v > 0) return Math.min(v / fs, 1)
  return NaN
}

/** 单日成交量（单位与逐笔一致即可，仅用于相对量与覆盖度分子分母）。 */
function dayVolume(r: KlineRow): number {
  const v = Number(r.volume ?? 0)
  if (Number.isFinite(v) && v > 0) return v
  const amt = Number(r.amount ?? 0)
  const mid = (Number(r.open) + Number(r.close)) / 2
  if (Number.isFinite(amt) && amt > 0 && Number.isFinite(mid) && mid > 0) return amt / mid
  return NaN
}

/** 三角分布 CDF：[a,b] 峰在 c（默认开收中点），总面积 1。 */
function triCdf(x: number, a: number, c: number, b: number): number {
  if (b <= a) return x >= b ? 1 : 0
  if (c <= a || c >= b) c = (a + b) / 2
  if (x <= a) return 0
  if (x >= b) return 1
  if (x <= c) return ((x - a) * (x - a)) / ((b - a) * (c - a))
  return 1 - ((b - x) * (b - x)) / ((b - a) * (b - c))
}

interface DayMeta {
  i: number
  decay: number
  mass: number
  open: number
  high: number
  low: number
  close: number
}

/**
 * 核心：把窗口内每日筹码按「日分布函数」摊进档位并逐日衰减。
 * profileOf(meta, lo, step) → number[]：当日量在各档的比例（合计≈1）。
 */
function core(
  rows: KlineRow[],
  endIndex: number,
  currentPrice: number,
  profileOf: (m: DayMeta, lo: number, step: number) => number[],
  maxCumTurnover: number,
): { acc: number[]; lo: number; step: number; binCount: number; windowDays: number; cum: number; complete: boolean } {
  const n = rows.length
  const end = Math.max(0, Math.min(n - 1, endIndex))

  // 1) 窗口：最新→旧，累计换手 300% 截断
  const metas: DayMeta[] = []
  let cum = 0
  let survival = 1
  let complete = false
  for (let i = end; i >= 0; i--) {
    const r = rows[i]
    const t = dayTurnover(r)
    const mass = dayVolume(r)
    const open = Number(r.open)
    const close = Number(r.close)
    const high = Number(r.high)
    const low = Number(r.low)
    if (!Number.isFinite(mass) || !Number.isFinite(open) || !Number.isFinite(close) || high < low || !Number.isFinite(high) || !Number.isFinite(low)) {
      break
    }
    const tSafe = Number.isFinite(t) ? t : 0
    metas.push({ i, decay: survival, mass, open, high, low, close })
    if (tSafe > 0) cum += tSafe
    survival *= 1 - tSafe
    if (cum >= maxCumTurnover) {
      complete = true
      break
    }
  }
  if (!metas.length) throw new Error('日K数据不足以计算筹码')

  // 2) 档位范围
  let lo = Infinity
  let hi = -Infinity
  for (const m of metas) {
    if (m.low < lo) lo = m.low
    if (m.high > hi) hi = m.high
  }
  if (Number.isFinite(currentPrice) && currentPrice > 0) {
    if (currentPrice < lo) lo = currentPrice
    if (currentPrice > hi) hi = currentPrice
  }
  if (!(hi > lo)) {
    const c = currentPrice || metas[0].close || 1
    lo = c * 0.98
    hi = c * 1.02
  }
  const binCount = BIN_COUNT
  const step = (hi - lo) / binCount

  // 3) 累加
  const acc = new Array<number>(binCount).fill(0)
  for (const m of metas) {
    const profile = profileOf(m, lo, step)
    const contribution = m.mass * m.decay
    for (let k = 0; k < binCount; k++) {
      const f = profile[k] ?? 0
      if (f > 0) acc[k] += contribution * f
    }
  }
  return { acc, lo, step, binCount, windowDays: metas.length, cum, complete }
}

/** 当日三角分布（一字板退化为单档）。 */
function triProfile(m: DayMeta, lo: number, step: number, binCount: number): number[] {
  const out = new Array<number>(binCount).fill(0)
  if (m.high <= m.low) {
    const k = Math.min(binCount - 1, Math.max(0, Math.floor((m.close - lo) / step)))
    out[k] = 1
    return out
  }
  const c = Math.min(m.high, Math.max(m.low, (m.open + m.close) / 2))
  for (let k = 0; k < binCount; k++) {
    out[k] = triCdf(lo + (k + 1) * step, m.low, c, m.high) - triCdf(lo + k * step, m.low, c, m.high)
  }
  return out
}

/** L0：纯日K 三角分布（零网络）。rows 升序，endIndex 默认最后一根。 */
export function computeChipsFromRows(
  rows: KlineRow[],
  endIndex: number,
  currentPrice: number,
  maxCumTurnover = CHIPS_MAX_CUM_TURNOVER,
): ChipsResult {
  const binCount = BIN_COUNT
  const { acc, lo, step, windowDays, cum, complete } = core(
    rows,
    endIndex,
    currentPrice,
    (m, _lo, _step) => triProfile(m, _lo, _step, binCount),
    maxCumTurnover,
  )
  return finalize(acc, lo, step, currentPrice, windowDays, cum, complete, 'dayk', 0)
}

/**
 * L1：当日逐笔修正（ticks 属于 rows[endIndex] 日）。
 * 当日分布 = coverage×真实逐笔形状 + (1−coverage)×三角形状；
 * 覆盖度 <5% 时退回 L0（不夸大精度）。覆盖度分母=当日日K量，单位自洽。
 */
export function computeChipsWithTicks(
  rows: KlineRow[],
  endIndex: number,
  ticks: TransactionRow[],
  currentPrice: number,
  maxCumTurnover = CHIPS_MAX_CUM_TURNOVER,
): ChipsResult {
  const n = rows.length
  const end = Math.max(0, Math.min(n - 1, endIndex))
  if (!ticks || ticks.length < 50) return computeChipsFromRows(rows, endIndex, currentPrice, maxCumTurnover)

  const dayRow = rows[end]
  const dayVol = dayVolume(dayRow)
  let sumTick = 0
  for (const t of ticks) {
    const v = Number(t.vol ?? 0)
    if (Number.isFinite(v) && v > 0) sumTick += v
  }
  const coverage = dayVol > 0 ? Math.min(1, sumTick / dayVol) : 0
  if (!(coverage >= CHIPS_TICK_MIN_COVERAGE)) return computeChipsFromRows(rows, endIndex, currentPrice, maxCumTurnover)

  const binCount = BIN_COUNT
  const { acc, lo, step, windowDays, cum, complete } = core(
    rows,
    endIndex,
    currentPrice,
    (m, l, s) => {
      const tri = triProfile(m, l, s, binCount)
      if (m.i !== end) return tri // 只有最新日升级
      // 当日真实逐笔形状
      const tick = new Array<number>(binCount).fill(0)
      for (const t of ticks) {
        const p = Number(t.price)
        const v = Number(t.vol ?? 0)
        if (!Number.isFinite(p) || !Number.isFinite(v) || v <= 0) continue
        const k = Math.min(binCount - 1, Math.max(0, Math.floor((p - l) / s)))
        tick[k] += v
      }
      const tickSum = tick.reduce((s2, x) => s2 + x, 0)
      if (!(tickSum > 0)) return tri
      const triSum = tri.reduce((s2, x) => s2 + x, 0) || 1
      for (let k = 0; k < binCount; k++) {
        tick[k] /= tickSum
        tri[k] /= triSum
        tick[k] = coverage * tick[k] + (1 - coverage) * tri[k]
      }
      return tick
    },
    maxCumTurnover,
  )
  return finalize(acc, lo, step, currentPrice, windowDays, cum, complete, 'tick', coverage)
}

function finalize(
  acc: number[],
  lo: number,
  step: number,
  currentPrice: number,
  windowDays: number,
  cum: number,
  complete: boolean,
  mode: ChipsMode,
  coverage: number,
): ChipsResult {
  const bins: ChipBin[] = []
  for (let k = 0; k < acc.length; k++) {
    if (acc[k] > 0) bins.push({ price: lo + (k + 0.5) * step, weight: acc[k] })
  }
  const price = Number.isFinite(currentPrice) && currentPrice > 0 ? currentPrice : (bins[bins.length - 1]?.price ?? 1)
  const total = bins.reduce((s, b) => s + b.weight, 0)
  if (!(total > 0) || !bins.length) {
    const p = price
    return {
      bins: [{ price: p, weight: 1 }],
      stats: { profitPct: 100, avgCost: p, costLow: p, costHigh: p, pricePos: 1, concentration: 0 },
      mode,
      windowDays,
      cumTurnover: cum,
      coverage,
      currentPrice: p,
      windowComplete: complete,
    }
  }

  const quantile = (q: number): number => {
    const target = total * q
    let s = 0
    for (let k = 0; k < bins.length; k++) {
      s += bins[k].weight
      if (s >= target) return bins[k].price
    }
    return bins[bins.length - 1].price
  }

  // 获利盘：中心 ≤ 现价的整档 + 现价所在档的线性部分
  let profit = 0
  for (const b of bins) if (b.price <= price) profit += b.weight
  const idx = bins.findIndex((b) => b.price > price)
  if (idx >= 0) {
    const b = bins[idx]
    const binLow = b.price - step / 2
    if (price > binLow) {
      profit += b.weight * Math.min(1, Math.max(0, (price - binLow) / step))
    }
  }
  const profitPct = (Math.min(total, profit) / total) * 100
  const avgCost = bins.reduce((s, b) => s + b.price * b.weight, 0) / total
  const costLow = quantile(0.05)
  const costHigh = quantile(0.95)
  const pricePos = costHigh > costLow ? (price - costLow) / (costHigh - costLow) : 1
  const concentration = avgCost > 0 ? (costHigh - costLow) / avgCost : 0

  return {
    bins,
    stats: { profitPct, avgCost, costLow, costHigh, pricePos, concentration },
    mode,
    windowDays,
    cumTurnover: cum,
    coverage,
    currentPrice: price,
    windowComplete: complete,
  }
}
