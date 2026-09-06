/**
 * 竞价强度分析（N2：auction-analysis.ts）。
 *
 * 依据 WATCH-METHODOLOGY §4「竞价与开盘」与 PRODUCT-DESIGN §5.1 骨架，
 * 把 auction 工具返回的逐点 matched/unmatched 时序提炼成竞价强度特征，
 * 再与昨日预期对照（对照矩阵 §4.4）输出判定，并用陷阱规则（§4.3）过滤。
 *
 * ⚠️ 数据源约束（PRODUCT-DESIGN §2.3）：
 *   - unmatched 正负号语义（买单/卖单未匹配方向）未定论，实现前须协议冒烟实测；
 *   - matched 单位（手/股）与涨停价判定（price≈buy_price_limit 需 pre_close×1.1/1.2 对齐）；
 *   - 9:15-9:20 可撤（诱多区），9:20-9:25 不可撤（真实意图区），9:24:30-9:25:00 冲刺区。
 */

/** 竞价逐点数据（auction 工具返回，字段待冒烟确认）。 */
export interface AuctionPoint {
  time: string // '09:15:00' 或时间戳
  price?: number
  matched?: number
  unmatched?: number
  [key: string]: unknown
}

export interface AuctionFeatures {
  /** 竞价末端价 vs 昨收（即预期开盘幅 %）。 */
  openPct: number
  /** 末端价贴近涨停价。 */
  nearLimit: boolean
  /** 9:20→9:25 matched 累积斜率（真实意图段）。 */
  slope920_925: number
  /** 9:24:30-9:25:00 冲刺方向。 */
  climaxDir: 'buy' | 'sell' | 'none'
  /** 竞价总匹配量（可对比昨日同期/个股历史分位）。 */
  matchedTotal: number
  /** 9:15-9:20 大量挂单后撤单跳水（诱多特征）。 */
  fakeBigThenDrop: boolean
}

/**
 * 分析竞价（PRODUCT-DESIGN §5.1 骨架）。
 * 要点：
 *   1) 末端 3 点 price → openPct/nearLimit；
 *   2) 线性拟合 9:20 后 matched 斜率；
 *   3) 最后 5 点：matched 加速 & price 上抬 ⇒ climaxDir='buy'；
 *      price 回落且 unmatched 走负 ⇒ 'sell'；
 *   4) fakeBigThenDrop：9:15-9:20 matched 峰 - 9:20 后回落幅度 > 40%
 *
 * ⚠️ 实现前先冒烟验证 unmatched 正负语义与点位抽样。
 */
export function analyzeAuction(
  items: AuctionPoint[],
  prevClose: number,
  buyPriceLimit?: number
): AuctionFeatures | null {
  if (!items || items.length < 3 || prevClose <= 0) return null

  // 取 price/matched/unmatched 有值的点
  const pts = items.filter((p) => p.price != null && isFinite(p.price))
  if (pts.length < 3) return null

  const end = pts.slice(-3)
  const lastPrice = end[end.length - 1].price as number
  const openPct = ((lastPrice - prevClose) / prevClose) * 100

  // nearLimit：末价贴近涨停价（容差 0.3%）
  const nearLimit = buyPriceLimit && buyPriceLimit > 0
    ? Math.abs(lastPrice - buyPriceLimit) / buyPriceLimit < 0.003
    : false

  // matched 斜率（9:20 后 = 真实意图段）：线性拟合 matched vs 索引
  const slope920_925 = linearSlope(pts.map((p) => (p.matched ?? 0) as number))

  // 冲刺方向：最后 5 点
  const last5 = pts.slice(-5)
  const matchedSeq = last5.map((p) => (p.matched ?? 0) as number)
  const priceSeq = last5.map((p) => (p.price as number))
  const matchedRising = matchedSeq[matchedSeq.length - 1] > matchedSeq[0]
  const priceRising = priceSeq[priceSeq.length - 1] > priceSeq[0]
  // unmatched 走负（卖盘未匹配增加）→ 出货
  const unmatchedNeg = last5.some((p) => (p.unmatched ?? 0) < 0)
  let climaxDir: 'buy' | 'sell' | 'none' = 'none'
  if (matchedRising && priceRising) climaxDir = 'buy'
  else if (priceSeq[priceSeq.length - 1] < priceSeq[0] || unmatchedNeg) climaxDir = 'sell'
  else climaxDir = 'none'

  // fakeBigThenDrop：9:15-9:20 matched 峰 - 9:20 后回落幅度 > 40%
  const allMatched = pts.map((p) => (p.matched ?? 0) as number)
  const peak = Math.max(...allMatched)
  const after920 = pts.slice(Math.floor(pts.length * 0.4)).map((p) => (p.matched ?? 0) as number)
  const afterPeak = after920.length ? Math.max(...after920) : peak
  const fakeBigThenDrop = peak > 0 && (peak - afterPeak) / peak > 0.4

  return { openPct, nearLimit, slope920_925, climaxDir, matchedTotal: allMatched.reduce((a, b) => a + b, 0), fakeBigThenDrop }
}

/** 线性拟合斜率（y vs 0..n-1）。 */
function linearSlope(y: number[]): number {
  const n = y.length
  if (n < 2) return 0
  let sx = 0, sy = 0, sxx = 0, sxy = 0
  for (let i = 0; i < n; i++) {
    sx += i; sy += y[i]; sxx += i * i; sxy += i * y[i]
  }
  const denom = n * sxx - sx * sx
  if (Math.abs(denom) < 1e-9) return 0
  return (n * sxy - sx * sy) / denom
}

/** 对照矩阵判定（PRODUCT-DESIGN §5.1，与 WATCH-METHODOLOGY §4.4 同构）。 */
export type Verdict =
  | 'beatExpect' // 超预期：强一致 + 竞价更强
  | 'confirm' // 符合预期
  | 'falsify' // 证伪：强一致但竞价弱
  | 'weak2strong' // 弱转强：分歧 + 竞价强
  | 'weak2weak' // 符合退潮：分歧继续弱
  | 'trap' // 陷阱：高位竞价高开（骗局三）

import type { ExpectItem } from './review-store'

export function judgeExpectation(
  expState: ExpectItem['state'],
  a: AuctionFeatures,
  boardOk?: boolean
): Verdict {
  const ok = boardOk ?? true
  if (expState === 'strong' && a.openPct >= 3 && ok) return 'beatExpect'
  if (expState === 'strong' && (a.openPct < 0 || a.climaxDir === 'sell')) return 'falsify'
  // 分歧/弱转强候选/低位启动：竞价走强 → 弱转强兑现候选
  if (
    (expState === 'divergence' || expState === 'weak2strong' || expState === 'newLow') &&
    a.slope920_925 > 0 &&
    a.climaxDir === 'buy'
  ) {
    return 'weak2strong'
  }
  // 高位风险/退潮：贴涨停高开 → 陷阱候选（骗局三）
  if ((expState === 'highRisk' || expState === 'recession') && a.nearLimit) return 'trap'
  if (a.openPct < 0 && a.climaxDir === 'sell') return 'weak2weak'
  return 'confirm'
}

/**
 * 陷阱二次过滤（WATCH-METHODOLOGY §4.3 三件套）：
 *   高位(≥4板) + 竞价高开 + (板块涨停数环比降 | 无龙头共振) + 开盘 10min 无承接
 * → 标 'trap'。
 */
export function isFalseStrong(
  a: AuctionFeatures,
  opts: {
    streak: number // 连板数
    boardLimitUpTrend: 'up' | 'down' | 'flat' // 板块涨停数环比
    hasLeaderResonance: boolean // 是否有龙头共振
    noFollow10min?: boolean // 开盘 10min 无承接
  }
): boolean {
  if (opts.streak < 4) return false
  if (a.openPct < 3) return false
  const boardBad = opts.boardLimitUpTrend === 'down' || !opts.hasLeaderResonance
  if (!boardBad) return false
  return !!opts.noFollow10min // 无承接才判陷阱（开盘数据可得后）
}

/** 判定文本（供徽标）。 */
export function verdictLabel(v: Verdict): string {
  switch (v) {
    case 'beatExpect': return '超预期'
    case 'confirm': return '符合'
    case 'falsify': return '证伪'
    case 'weak2strong': return '弱转强'
    case 'weak2weak': return '继续弱'
    case 'trap': return '陷阱'
  }
}

/** 判定颜色（徽标）。 */
export function verdictColor(v: Verdict): string {
  switch (v) {
    case 'beatExpect':
    case 'weak2strong': return '#c74040' // 红：强
    case 'falsify':
    case 'weak2weak': return '#2d9b65' // 绿：弱
    case 'trap': return '#e85910' // 橙：陷阱
    default: return '#94a3b8' // 灰：符合
  }
}
