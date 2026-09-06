/**
 * 仓位管理：凯利为纲（N6：sizing.ts）。
 *
 * 依据 WATCH-METHODOLOGY §7「仓位管理：凯利为纲」与 PRODUCT-DESIGN §5.4 骨架，
 * 把「分数凯利 + 温度计总仓闸门 + 事件护栏」三条线取最严者，算出单票名义仓位。
 *
 * 核心原则（研究收敛结论）：
 *   1. 只有可验证的正期望才配仓位，无 edge 即空仓（Kelly f*=0 是正确答案）；
 *   2. 用分数凯利（满凯利的 1/4~1/2）；
 *   3. p̂/b̂ 必须来自自统计（交易日志按信号分类，持有期口径），不用主观信心；
 *   4. A 股 T+1 修正：结果统计一律用「持有至次一可卖日」口径；
 *      计划止损按可执行最坏退出折算（×1.5~2，跌停卖不出/隔夜跳空）；
 *   5. 事件护栏硬性封顶（不随公式妥协）。
 */

import { BAND_CAP, type RegimeBand } from './regime'

/** 凯利计算输入。 */
export interface KellyArgs {
  /** 持有期口径的胜率 p̂（0-1）。 */
  p: number
  /** 盈亏比 b̂（均盈/均亏，>0）。 */
  b: number
  /** 分数凯利比例（默认 1/2，可降到 1/4）。 */
  fraction: number
  /** 温度计总仓闸门 G（0-1）。 */
  gateCap: number
  /** 计划止损幅（%）。 */
  stopLossPct: number
}

/**
 * 单票凯利仓位（%）。
 *   满凯利 f* = (b·p − q) / b = p − q/b（q=1−p）；仅当 p·b > q（正期望）才下注，否则 0（空仓）
 *   byKelly = f* × fraction × 100
 *   byStop  = 单笔风险预算换算：名义仓位(%) = 风险预算(账户%) / 止损幅(%) × 100
 *             —— 方法论 §7 事件护栏：单笔风险 ≤ 账户 2%（T+1/跌停/跳空按可执行最坏退出折算）
 * 取 min(byKelly, byStop, 单票封顶 10%)。
 * ⚠️ gateCap（温度计总仓闸门）在单票函数内不参与——它约束总暴露，由
 * finalPosition / 上层「仓位总闸」另行处理。
 */
export function kellyPosition(args: KellyArgs): number {
  const { p, b, fraction, stopLossPct } = args
  const q = 1 - p
  // 满凯利 f*（等价的期望判据：p·b > q 才为正期望）
  const fStar = b > 0 ? p - q / b : 0
  if (fStar <= 0) return 0
  // 分数凯利（%）
  const byKelly = fStar * fraction * 100

  // 单笔风险预算（账户 %）：2% 为事件护栏默认值
  const RISK_PER_TRADE = 2
  const byStop = (RISK_PER_TRADE / Math.max(1, stopLossPct)) * 100

  // 硬封顶单票 ≤10%（新手 ≤5%，由上层传 gateCap 时体现）
  return Math.min(byKelly, byStop, 10)
}

/**
 * 由温度计档位算总仓闸门 G（0-1）。WATCH-METHODOLOGY §6.2。
 */
export function gateFromBand(band: RegimeBand): number {
  return BAND_CAP[band]
}

/**
 * 事件护栏硬性封顶（不随公式妥协）。
 * 返回是否通过护栏；未通过给出原因。
 */
export interface GuardResult {
  ok: boolean
  reason?: string
}

export function checkGuards(input: {
  /** 单票仓位 %（已算）。 */
  positionPct: number
  /** 单票是否新手（≤5% 封顶）。 */
  isNewbie?: boolean
  /** 单板块合计仓位 %。 */
  boardTotalPct: number
  /** 同日已开独立逻辑数。 */
  todayLogicCount: number
  /** 最坏情景：两跌停亏损占账户 %。 */
  worstTwoLimitDownPct: number
  /** 账户当前回撤 %。 */
  drawdownPct: number
}): GuardResult {
  const maxSingle = input.isNewbie ? 5 : 10
  if (input.positionPct > maxSingle) {
    return { ok: false, reason: `单票 ${input.positionPct.toFixed(1)}% 超 ${maxSingle}% 封顶` }
  }
  if (input.boardTotalPct > 30) {
    return { ok: false, reason: `单板块合计 ${input.boardTotalPct.toFixed(1)}% 超 30%` }
  }
  if (input.todayLogicCount > 4) {
    return { ok: false, reason: `同日 ${input.todayLogicCount} 个独立逻辑超 4` }
  }
  if (input.worstTwoLimitDownPct > 10) {
    return { ok: false, reason: `两跌停最坏 ${input.worstTwoLimitDownPct.toFixed(1)}% 超 10%` }
  }
  if (input.drawdownPct >= 25) {
    return { ok: false, reason: `回撤 ${input.drawdownPct.toFixed(1)}% 强制停手` }
  }
  if (input.drawdownPct >= 15) {
    return { ok: false, reason: `回撤 ${input.drawdownPct.toFixed(1)}% 降半仓` }
  }
  return { ok: true }
}

/**
 * 综合：温度计闸门 + 凯利 + 护栏，算出最终单票仓位。
 * 取凯利与闸门的较小值，再过护栏；护栏不通过则按原因降仓或空仓。
 */
export function finalPosition(args: KellyArgs & {
  band: RegimeBand
  isNewbie?: boolean
  drawdownPct: number
  boardTotalPct: number
  todayLogicCount: number
  worstTwoLimitDownPct: number
}): { positionPct: number; guards: GuardResult[] } {
  const gate = gateFromBand(args.band as RegimeBand)
  const adjusted = { ...args, gateCap: gate }
  let pos = kellyPosition(adjusted)
  // 温度计总仓闸门（总暴露上限；单票 10% 封顶下通常不生效，语义护栏保留）
  pos = Math.min(pos, gate * 100)

  // 护栏检查
  const guards: GuardResult[] = []
  const g = checkGuards({
    positionPct: pos,
    isNewbie: args.isNewbie,
    boardTotalPct: args.boardTotalPct,
    todayLogicCount: args.todayLogicCount,
    worstTwoLimitDownPct: args.worstTwoLimitDownPct,
    drawdownPct: args.drawdownPct,
  })
  if (!g.ok) guards.push(g)

  // 若护栏不通过：降仓到合规（简单处理：回撤 15%+ 降半仓）
  if (args.drawdownPct >= 15 && args.drawdownPct < 25) {
    pos = Math.min(pos, gate * 0.5 * 100 * 0.5)
  }

  return { positionPct: pos, guards }
}

/** 需要 RegimeBand 输入，补充到 finalPosition。 */
export interface FinalPositionArgs extends KellyArgs {
  band: RegimeBand
  isNewbie?: boolean
  drawdownPct: number
  boardTotalPct: number
  todayLogicCount: number
  worstTwoLimitDownPct: number
}
