/**
 * 情绪温度计（N5：regime.ts）。
 *
 * 依据 WATCH-METHODOLOGY §6「把「感觉」变成刻度」与 PRODUCT-DESIGN §5.2 骨架，
 * 把涨停/跌停/晋级率/炸板率/首板溢价/广度等分散原料聚合成 0-100 温度 + 分档，
 * 作为「仓位总闸」（先定总仓上限 G，再用凯利定单票，谁严取谁）。
 *
 * 证据级：D 级经验阈值（机构 B 级只支持「用这些量分层的合理性」）。
 * 阈值全部做成可配置初值 + 自校准，禁止当常数用（STRATEGY-RESEARCH 顶部警告）。
 */

export interface RegimeInputs {
  /** 涨停家数（非 ST）。 */
  limitUp: number
  /** 跌停家数。 */
  limitDown: number
  /** 最高连板数。 */
  maxStreak: number
  /** 晋级率 = 昨日涨停今日仍涨停 / 昨日涨停数（0-1）。 */
  promoteRate: number
  /** 炸板率 = 炸板数 / 曾涨停数（0-1）。 */
  brokenRate: number
  /** 首板次日平均溢价（%）。 */
  firstBoardPremium: number
  /** 上涨家数占比（0-1）。 */
  upRatio: number
  /** 两市成交额（亿）。 */
  amountYi: number
  /** 成交额分位（0-1，自身历史）。缺省 0。 */
  amountYiPct?: number
}

export type RegimeBand = 'ice' | 'cold' | 'warm' | 'hot' | 'overheat'

export interface Regime {
  /** 温度 0-100。 */
  temperature: number
  /** 分档。 */
  band: RegimeBand
  /** 拉高/压低温度的驱动项（≤3 条），供人工复核而非只看一个数字。 */
  drivers: string[]
}

/**
 * 温度 → 仓位总闸 G（总仓上限，0-1）。
 * WATCH-METHODOLOGY §6.2 表格固化。阈值可配置，此处为默认初值。
 */
export const BAND_CAP: Record<RegimeBand, number> = {
  ice: 0.2, // 冰点：空仓或 ≤2 成轻仓试错
  cold: 0.3, // 低温/启动：≤3 成，只做主线龙头试错
  warm: 0.6, // 常温/发酵：3-6 成，主线内操作
  hot: 0.6, // 高温/高潮：6 成封顶，防高潮末段
  overheat: 0.3, // 沸点/过热：只减不加
}

/**
 * 计算温度计（PRODUCT-DESIGN §5.2 骨架）。
 * 各输入先做阈值分段打分（0-100 加权），特别规则：
 *   - promoteRate<0.25 或 brokenRate>0.5 ⇒ 温度强制 ≤ 45（退潮/分歧）
 *   - maxStreak>=5 且缩量加速（upRatio 高但 amount 降）⇒ 触发 overheat 标记
 * drivers 记录拉高/压低项（≤3），供人工复核。
 *
 * 注：不再接受 `caps` 入参 —— 档位上限是**展示/仓位闸门**（`BAND_CAP`，见 `sizing.ts`）
 * 的事，温度计只负责算温度。留一个没人用的入参只会让人以为温度受它影响。
 */
export function computeRegime(i: RegimeInputs): Regime {
  const drivers: string[] = []
  /**
   * **强制规则**触发的原因（压温 / 过热）。
   *
   * 为什么单列：drivers 最终只保留 3 条，而"温度被强制压低/抬高"是最该让人看见的信息——
   * 单元测试（`tests/regime.test.ts`）抓到过：涨得再热的市场里一旦触发退潮压温，
   * 「退潮/分歧压温」会被「涨停≥80 家」这类普通项挤掉，界面就只剩下数字、看不出为什么。
   * 因此这些原因优先保留。
   */
  const forced: string[] = []
  let score = 0

  // 涨停家数（0-100：0 家=0 分，≥80 家=100 分）
  const upScore = Math.min(100, Math.max(0, i.limitUp / 0.8))
  score += upScore * 0.18
  if (i.limitUp >= 80) drivers.push('涨停≥80 家')
  else if (i.limitUp <= 20) drivers.push('涨停≤20 家')

  // 晋级率（越高越热）
  const promoteScore = Math.min(100, i.promoteRate * 100)
  score += promoteScore * 0.18
  if (i.promoteRate >= 0.5) drivers.push('晋级率≥50%')
  else if (i.promoteRate < 0.25) drivers.push('晋级率<25%')

  // 炸板率（越高越冷，反向）
  const brokenScore = Math.min(100, i.brokenRate * 100)
  score += (100 - brokenScore) * 0.15
  if (i.brokenRate > 0.5) drivers.push('炸板率>50%')

  // 首板溢价（越高越热）
  const premScore = Math.min(100, Math.max(0, (i.firstBoardPremium + 5) / 10) * 100)
  score += premScore * 0.12
  if (i.firstBoardPremium > 3) drivers.push('首板溢价>3%')
  else if (i.firstBoardPremium < 0) drivers.push('首板溢价<0')

  // 上涨家数占比
  score += i.upRatio * 100 * 0.14

  // 成交额分位（增量资金）
  const amtPct = i.amountYiPct ?? 0
  score += amtPct * 100 * 0.1
  if (amtPct > 0.7) drivers.push('成交额分位>70%')

  // 最高连板（空间高度）
  score += Math.min(100, i.maxStreak / 6 * 100) * 0.13
  if (i.maxStreak >= 5) drivers.push('最高板≥5')

  // 特别规则：退潮/分歧强制压温
  if (i.promoteRate < 0.25 || i.brokenRate > 0.5) {
    score = Math.min(45, score)
    // 点名**具体**触发条件（哪个指标把温度压下去的），而不是只给泛化结论：
    // 「退潮/分歧压温」不提原因，用户没法判断该看什么。两个条件都不满足时不会有这条分支。
    if (i.promoteRate < 0.25) forced.push('晋级率<25%')
    if (i.brokenRate > 0.5) forced.push('炸板率>50%')
    if (forced.length === 0) forced.push('退潮/分歧压温')
  }

  // 过热检测：高位缩量滞涨
  let overheat = false
  if (i.maxStreak >= 5 && i.upRatio > 0.6 && (i.amountYiPct ?? 0) < 0.3) {
    overheat = true
    forced.push('高位缩量加速')
  }

  score = Math.max(0, Math.min(100, score))
  const band: RegimeBand = overheat ? 'overheat'
    : score >= 90 ? 'overheat'
    : score >= 70 ? 'hot'
    : score >= 45 ? 'warm'
    : score >= 20 ? 'cold'
    : 'ice'

  // drivers = 强制原因优先，其次普通项；去重并截断 ≤3
  const seen = new Set<string>()
  const uniq = [...forced, ...drivers]
    .filter((d) => { if (seen.has(d)) return false; seen.add(d); return true })
    .slice(0, 3)

  return { temperature: Math.round(score), band, drivers: uniq }
}

/** 温度档文本。 */
export function bandLabel(b: RegimeBand): string {
  switch (b) {
    case 'ice': return '冰点'
    case 'cold': return '低温'
    case 'warm': return '常温'
    case 'hot': return '高温'
    case 'overheat': return '过热'
  }
}

/** 温度 → 颜色（红涨绿跌，过热橙）。 */
export function bandColor(b: RegimeBand): string {
  switch (b) {
    case 'ice':
    case 'cold': return '#2d9b65' // 绿：冷
    case 'warm': return '#c74040' // 红：温
    case 'hot':
    case 'overheat': return '#e85910' // 红/橙：热
    default: return '#c74040'
  }
}
