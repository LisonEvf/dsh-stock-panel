/**
 * src/lib/stage.ts — 盯盘**阶段模型**：把「交易日时间轴」变成一级导航。
 *
 * 依据 `WATCH-METHODOLOGY.md` §8 的固定时间表与 §3–§5 的流程：
 *
 *   15:10–16:00  收盘复盘 → 写下「次日预期清单」(≤5)        §3
 *   次日 9:15–9:25 竞价     → 拿清单做「预期 × 竞价对照」    §4
 *   9:30–10:00    验证窗    → 竞价结论验证（高开承接/低开收复）§4 末
 *   9:30–15:00    盘中      → 只答 Q1 持续性 / Q2 局势 / Q3 动作 §5
 *   14:30–15:00   尾盘      → 唯一动作点：兑现 / 换股 / 定仓   §5.4
 *
 * 本模块只做一件事：把宿主的 `SessionPhase`（+ 本地分钟数）映射成**阶段**，
 * 并给出「本阶段必须回答的问题 / 唯一输出」。UI 由此实现
 * **时段自动切换 + 手动覆盖**（用户想看哪一阶段就看哪一阶段，但默认服从流程）。
 */
import { isWeekend, phaseFromDate, type SessionPhase } from './session-clock'

/** 四个方法论阶段。 */
export type Stage = 'review' | 'auction' | 'intraday' | 'tail'

/** 阶段元信息（问题清单直接来自方法论正文，不自行发明）。 */
export interface StageInfo {
  id: Stage
  /** 导航标签。 */
  label: string
  /** 时间窗（展示用）。 */
  window: string
  /**
   * 本阶段必须回答的问题（WATCH-METHODOLOGY 原文口径）。
   * UI 把它显示在阶段头上——**先看问题，再看数据**，这是"少而准"的落点。
   */
  questions: string[]
  /** 本阶段唯一的输出物（方法论要求写下/做出的东西）。 */
  output: string
  /** 该阶段归属的一级入口（复盘 / 作战）。 */
  entry: 'review' | 'war'
}

export const STAGES: Record<Stage, StageInfo> = {
  review: {
    id: 'review',
    label: '复盘',
    window: '15:10–次日 9:15',
    questions: [
      '今天市场情绪几度？（温度计 + 广度 + 成交额分位）',
      '主线是哪条、龙头是谁？（板块涨停数 + 连板高度 + 梯队是否断层）',
      '谁在赚钱、谁在亏钱？（昨日涨停今日表现 / 大面样本）',
      '明天我要盯谁、满足什么算兑现、什么算证伪？',
    ],
    output: '次日预期清单 ≤5 条（7 字段）+ 存档',
    entry: 'review',
  },
  auction: {
    id: 'auction',
    label: '竞价',
    window: '9:15–9:30',
    questions: [
      '昨日预期的对象，竞价是更强还是更弱？（预期 × 竞价对照）',
      '有没有「逆预期」的标的？（弱转强 / 证伪 / 陷阱）',
      '主线是否同步？（板块整体竞价方向，而非单票绝对值）',
    ],
    output: '每条预期的判定：超预期 / 证伪 / 弱转强候选 / 陷阱',
    entry: 'war',
  },
  intraday: {
    id: 'intraday',
    label: '盘中',
    window: '9:30–14:30（9:30–10:00 为竞价结论验证窗）',
    questions: [
      'Q1 当前主线/持仓的持续性证据在增强还是衰减？',
      'Q2 有没有局势变化正在发生？（高低切 / 退潮 / 新方向）',
      'Q3 对持仓与候选，今天该做的动作是什么？',
    ],
    output: 'Q1–Q3 的明确答案（写在卡上，不留在感觉里）',
    entry: 'war',
  },
  tail: {
    id: 'tail',
    label: '尾盘',
    window: '14:30–15:00',
    questions: [
      '持仓的持续性证据是否衰减？（衰减即兑现）',
      '有没有「次日预期更好」的换股对象？',
      '收盘前仓位定性：留什么、清什么、留多少？',
    ],
    output: '兑现 / 换股 / 定仓（T+1 之下只有这个窗口是动作点）',
    entry: 'war',
  },
}

/** 阶段顺序（导航/自动高亮用）。 */
export const STAGE_ORDER: Stage[] = ['review', 'auction', 'intraday', 'tail']

/** 本地时间 → 当日分钟数（0–1439）。 */
export function minuteOfDay(d: Date = new Date()): number {
  return d.getHours() * 60 + d.getMinutes()
}

/**
 * 由「时段 + 分钟数」判定当前阶段。
 *
 * 注意：`review` 时段（15:10 后）与 `premarket`（9:00–9:15）都归「复盘」——
 * 方法论 §3 明确「次日开盘前复盘仍有效」，两者做的是同一件事（写/改清单）。
 */
export function stageOf(phase: SessionPhase, minutes: number): Stage {
  if (phase === 'auction') return 'auction'
  if (phase === 'trading') {
    // 尾盘 14:30 后是方法论唯一的动作点，单列为阶段
    return minutes >= 14 * 60 + 30 ? 'tail' : 'intraday'
  }
  // closed / review / premarket → 复盘（盘前与盘后都是"写清单"的时段）
  return 'review'
}

/**
 * 当前阶段（默认按本地时钟）。
 *
 * ⚠️ 实测 bug（2026-09-12 发现并修复）：原实现是 `stageOf(phaseFromDate(d), …)`，
 * 而 `phaseFromDate` 在 `isTradeDay` 未传时**一律返回 'closed'**（见其实现第一行），
 * 于是 `stageOf('closed', …)` 恒等于 `'review'` —— `currentStage()` **永远返回复盘**，
 * 「跨 9:15 自动切到作战 / 跨 15:10 切回复盘」这套时段跟随**整个是死的**。
 *
 * 现在：`isTradeDay` 显式可选，缺省时退到**本地周末判定**（与 `buildClock` 的
 * `isTradeDay = !isWeekend(d)` 同口径）；有服务端交易日历时由调用方传入（更准，
 * 能识节假日）。节假日仍按工作日近似，属已知限制。
 */
export function currentStage(d: Date = new Date(), isTradeDay?: boolean): Stage {
  const tradeDay = isTradeDay ?? !isWeekend(d)
  return stageOf(phaseFromDate(d, tradeDay), minuteOfDay(d))
}

/**
 * 手动覆盖是否仍有效：用户手选的阶段一旦**不再是真实阶段**就自动让位，
 * 避免"我以为在看盘中，其实已经收盘了"这类静默错位。
 */
export function resolveStage(real: Stage, override: Stage | null): Stage {
  return override !== null && override === real ? override : real
}
