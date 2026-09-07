/**
 * 时段任务描述（N8 目标强化：mission.ts）。
 *
 * 依据 WATCH-METHODOLOGY §8.1「固定时间表」+ §5「盘中只答 Q1-Q3」+ §4/§3 产出，
 * 把「作战」页在**每个时段应该完成的一件事**翻译成显式目标：
 *   竞价  → 逐条判定昨日预期（对照矩阵）；
 *   验证窗(9:30-10:00) → 确认弱转强候选是否放量持续；
 *   盘中主段 → 只答 Q1/Q2/Q3（每问必须落一个答案）；
 *   尾盘动作点(14:30+) → 给每笔持仓今日结论；
 *   复盘/盘前/休市 → 补齐并存档次日预期清单。
 *
 * 纯函数：输入 = 时段 + 当日任务进度，输出 = 目标文案/检查清单/进度/倒计时锚点。
 * 不依赖组件与存储，便于单测与后续在复盘页复用。
 */

import type { SessionPhase } from './session-clock'

/** 当日运行任务进度（WarPage 由 dayrun + positions + review-store 汇总后传入）。 */
export interface MissionInput {
  phase: SessionPhase
  /** 当天时刻（ms），用于细分 9:30-15:00 内的验证窗/主段/尾盘与倒计时。 */
  now: number
  /** 昨日预期清单条数（竞价对照对象）。 */
  expectationsTotal: number
  /** 今日已判定条数（dayrun.verdicts 命中昨日预期的数量）。 */
  expectationsJudged: number
  /** Q1/Q2 是否已答。 */
  q1: boolean
  q2: boolean
  /** Q3：持仓逐只已给动作的数量 / 是否空仓观望。 */
  q3AnsweredPositions: number
  positionCount: number
  q3Idle: boolean
  /** 今日复盘是否已存档（复盘时段完成标准）。 */
  hasTodayReview: boolean
}

export interface MissionCheck {
  label: string
  done: boolean
}

export interface Mission {
  phase: SessionPhase
  /** 时段标题（如「竞价对照」「盘中三问」）。 */
  title: string
  /** 一句话目标（用户当前该完成的事）。 */
  goal: string
  /** 完成标准（检查清单）。 */
  checks: MissionCheck[]
  /** 进度（null = 不显示数字进度）。 */
  progress: { done: number; total: number } | null
  /** 附加提示（验证窗/纪律提醒等，弱提示）。 */
  hint?: string
  /** 缺基准等需要留意的状态（如昨日没写清单）。 */
  warn?: string
  /** 倒计时锚点（{ at: 当天时刻 ms, label }）。 */
  anchor?: { at: number; label: string }
  /** 视觉语气：todo=进行中 / done=已完成 / warn=需处理。 */
  tone: 'todo' | 'done' | 'warn'
}

// ===== 盘中窗口细分（分钟刻度） =====
const M_OPEN = 9 * 60 + 30 // 9:30
const M_VERIFY_END = 10 * 60 // 10:00 验证窗结束
const M_TAIL = 14 * 60 + 30 // 14:30 尾盘动作点
const M_AUCTION_END = 9 * 60 + 25 // 9:25

export type TradingWindow = 'preOpenWindow' | 'main' | 'tail'

/** 盘中窗口（分钟粒度）。 */
export function tradingWindow(minutesOfDay: number): TradingWindow {
  if (minutesOfDay < M_VERIFY_END && minutesOfDay >= M_OPEN) return 'preOpenWindow'
  if (minutesOfDay >= M_TAIL) return 'tail'
  return 'main'
}

/** 当天 HH:MM → 当天 ms 时间戳。 */
export function anchorAt(now: number, h: number, m: number): number {
  const d = new Date(now)
  d.setHours(h, m, 0, 0)
  return d.getTime()
}

/** 倒计时文本（min 级；≤0 返回 null）。 */
export function countdownText(now: number, at: number): string | null {
  const ms = at - now
  if (ms <= 0) return null
  const min = Math.ceil(ms / 60000)
  if (min >= 60) return `剩 ${Math.floor(min / 60)} 小时`
  return `剩 ${min} 分`
}

/**
 * 构建当前时段任务（核心）。所有完成度都由输入聚合，组件只做呈现。
 */
export function buildMission(i: MissionInput): Mission {
  const d = new Date(i.now)
  const minutes = d.getHours() * 60 + d.getMinutes()

  switch (i.phase) {
    case 'premarket': {
      // 盘前 9:00-9:15 与 9:25-9:30 空档
      const preAuction = minutes < M_AUCTION_END
      return {
        phase: i.phase,
        title: '盘前准备',
        goal: '确认预期清单已就绪（今日竞价逐条对照用）',
        checks: [{ label: '预期清单已存档（今日竞价对照基准）', done: i.expectationsTotal > 0 }],
        progress: i.expectationsTotal > 0 ? { done: 1, total: 1 } : null,
        warn: i.expectationsTotal === 0 ? '没有可对照的预期清单 → 竞价默认不参与，先到复盘页补齐' : undefined,
        anchor: preAuction
          ? { at: anchorAt(i.now, 9, 15), label: '竞价开始' }
          : { at: anchorAt(i.now, 9, 30), label: '开盘' },
        tone: i.expectationsTotal > 0 ? 'todo' : 'warn',
      }
    }

    case 'auction': {
      const total = i.expectationsTotal
      const allJudged = total > 0 && i.expectationsJudged >= total
      return {
        phase: i.phase,
        title: '竞价对照',
        goal:
          total > 0
            ? `对照 ${total} 条预期，逐条判定：超预期 / 证伪 / 弱转强 / 陷阱`
            : '没有预期清单 → 竞价只记录，不参与',
        checks: [{ label: total > 0 ? `逐条判定（${i.expectationsJudged}/${total}）` : '确认无清单：默认不参与', done: allJudged || total === 0 }],
        progress: total > 0 ? { done: i.expectationsJudged, total } : null,
        hint: '判定区在上方「预期对照 × 今日竞价」；9:25 定格后进验证窗',
        anchor: { at: anchorAt(i.now, 9, 25), label: '竞价定格' },
        tone: allJudged ? 'done' : total === 0 ? 'warn' : 'todo',
      }
    }

    case 'trading': {
      const win = tradingWindow(minutes)
      const q3Done =
        i.positionCount === 0 ? i.q3Idle : i.q3AnsweredPositions >= i.positionCount
      const answered = (i.q1 ? 1 : 0) + (i.q2 ? 1 : 0) + (q3Done ? 1 : 0)
      const all = answered === 3
      const checks: MissionCheck[] = [
        { label: 'Q1 持续性：增强 / 衰减 / 中性', done: i.q1 },
        { label: 'Q2 局势：确认系统归类', done: i.q2 },
        {
          label: i.positionCount > 0
            ? `Q3 持仓动作（${i.q3AnsweredPositions}/${i.positionCount}）`
            : 'Q3 空仓观望（无动作也是决策）',
          done: q3Done,
        },
      ]
      if (win === 'preOpenWindow') {
        return {
          phase: i.phase,
          title: '开盘验证窗 · 9:30-10:00',
          goal: '验证弱转强/超预期候选是否放量持续；10:00 前不做清单外追高',
          checks,
          progress: { done: answered, total: 3 },
          hint: '答完三问即完成本时段任务；Q1-Q3 卡在本页',
          anchor: { at: anchorAt(i.now, 10, 0), label: '验证窗结束' },
          tone: all ? 'done' : 'todo',
        }
      }
      if (win === 'tail') {
        return {
          phase: i.phase,
          title: '尾盘动作点 · 14:30-15:00',
          goal: '给每笔持仓今日结论（兑现 / 持有 / 换股），收盘前完成仓位定性',
          checks,
          progress: { done: answered, total: 3 },
          hint: '尾盘是唯一动作点：止损/失败条件触发即走，不重新辩论',
          anchor: { at: anchorAt(i.now, 15, 0), label: '收盘' },
          tone: all ? 'done' : 'warn',
        }
      }
      return {
        phase: i.phase,
        title: '盘中三问',
        goal: '只答 Q1-Q3：持续性增减？有无局势变化？该做什么？',
        checks,
        progress: { done: answered, total: 3 },
        hint: '清单外的一律不看不买；页面其余画面仅为回答三问服务',
        tone: all ? 'done' : 'todo',
      }
    }

    case 'review': {
      return {
        phase: i.phase,
        title: '收盘复盘',
        goal: '完成今日复盘并存档（≤5 条预期，供明日竞价对照）',
        checks: [{ label: '今日复盘已存档', done: i.hasTodayReview }],
        progress: i.hasTodayReview ? { done: 1, total: 1 } : null,
        hint: '复盘页可引用今日三问答案与强度差分观察池；「作战」页的逐条判定也会归档在当日记录里',
        tone: i.hasTodayReview ? 'done' : 'warn',
      }
    }

    case 'closed':
    default: {
      return {
        phase: 'closed',
        title: '休市 / 等待下一交易日',
        goal: '整理预期清单、维护持仓与交易日志（复盘页随时可用）',
        checks: [{ label: '有可用的预期清单（下一交易日竞价对照基准）', done: i.expectationsTotal > 0 }],
        progress: null,
        tone: 'todo',
      }
    }
  }
}
