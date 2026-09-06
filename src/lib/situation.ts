/**
 * 局势归类（N4：situation.ts）。
 *
 * 依据 WATCH-METHODOLOGY §5.2「局势变化归类」与 PRODUCT-DESIGN §5.3 骨架，
 * 把观察（温度计 + 事件流 + 板块脉冲 + 老龙头状态）翻译成局面，供决策条 Q2 使用。
 *
 *   | 观察到的信号组合 | 局势归类 |
 *   | --- | --- |
 *   | 高位龙头断板/炸板 + 低位批量放量涨停 + 指数平稳 | highLowSwitch（高低切） |
 *   | 主线内龙头分歧但板块涨停数仍增 | innerDivergence（轮动补涨） |
 *   | 陌生板块集体放量涨停 + 出现首板梯队 | newDirection（新方向启动） |
 *   | 指数上涨但涨停少、权重护盘 | weightLift（赚指数） |
 *   | 跌停增多 + 晋级率骤降 + 炸板率飙升 | recession（退潮） |
 */

import type { Regime } from './regime'
import type { EventItem } from './event-stream'
import type { BoardPulse } from './board-pulse'

export type Situation =
  | 'highLowSwitch' // 高低切
  | 'innerDivergence' // 主线内分歧（轮动补涨）
  | 'newDirection' // 新方向启动
  | 'weightLift' // 权重行情/赚指数
  | 'recession' // 退潮
  | 'normal' // 正常

export interface SituationInput {
  regime: Regime
  events: EventItem[]
  pulses: BoardPulse[]
  /** 老龙头（昨日高位标的）当日是否仍封板。 */
  oldLeaderAtLimit: boolean
  /** 老龙头是否断板/炸板。 */
  oldLeaderBroken: boolean
  /** 高位（≥4板）标的数。 */
  highStreakCount: number
  /** 低位首板（当日新涨停、低位置）数。 */
  lowNewLimitUp: number
  /** 指数涨跌幅（%）。 */
  indexPct: number
  /** 上涨家数占比（0-1）。 */
  upRatio: number
  /** 全市场跌停家数（Regime 不含原始聚合，由调用方传入）。 */
  limitDown: number
  /** 晋级率（0-1）。 */
  promoteRate: number
  /** 炸板率（0-1）。 */
  brokenRate: number
  /** 全市场涨停家数。 */
  limitUp: number
}

/** 局势文本（供决策条）。 */
export function situationLabel(s: Situation): string {
  switch (s) {
    case 'highLowSwitch': return '高低切进行中：老龙头兑现，低位新方向观察'
    case 'innerDivergence': return '主线内分歧（轮动补涨）：主线未死，做低位补涨或等龙头回封'
    case 'newDirection': return '新方向启动：记入观察，第 1 天只记录；与清单共振才参与'
    case 'weightLift': return '权重行情/赚指数：情绪不支持超短，降低仓位与出手频次'
    case 'recession': return '退潮：空仓优先；持仓按失败条件坚决离场，不博弈反抽'
    default: return '正常：按清单与温度计操作'
  }
}

/** 局势颜色。 */
export function situationColor(s: Situation): string {
  switch (s) {
    case 'recession': return '#2d9b65' // 绿：回避
    case 'highLowSwitch':
    case 'newDirection': return '#c74040' // 红：变化
    case 'weightLift': return '#e85910' // 橙：谨慎
    case 'innerDivergence': return '#c74040'
    default: return '#94a3b8'
  }
}

/**
 * 判断局势（PRODUCT-DESIGN §5.3 规则表）。
 * 优先级：recession > highLowSwitch > newDirection > weightLift > innerDivergence > normal
 */
export function judgeSituation(input: SituationInput): Situation {
  const { regime, oldLeaderAtLimit, oldLeaderBroken, lowNewLimitUp, indexPct, upRatio } = input

  // 退潮：跌停增多 + 晋级率骤降 + 炸板率飙升
  if (input.limitDown >= 10 && input.promoteRate < 0.25 && input.brokenRate > 0.5) {
    return 'recession'
  }
  // 高低切：高位龙头断板 + 低位批量放量涨停 + 指数平稳
  if (oldLeaderBroken && lowNewLimitUp >= 3 && Math.abs(indexPct) < 1) {
    return 'highLowSwitch'
  }
  // 新方向：陌生板块集体 surge(≥3) + 无昨日主线共振
  const surgeCount = input.events.filter((e) => e.kind === 'surge').length
  const hasNewDirection = surgeCount >= 3 && input.pulses.length === 0
  if (hasNewDirection) return 'newDirection'
  // 权重行情：指数涨但涨停少、广度差
  if (indexPct > 0 && input.limitUp < 20 && upRatio < 0.5) {
    return 'weightLift'
  }
  // 主线内分歧：龙头分歧但板块涨停数仍增
  if (!oldLeaderAtLimit && input.pulses.some((p) => p.deltaLimitUp > 0)) {
    return 'innerDivergence'
  }
  return 'normal'
}
