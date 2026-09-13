/**
 * 交易日时钟（N1：session-clock.ts）。
 *
 * 依据 PRODUCT-DESIGN §3「时段感知」：交易日时钟（server_info）驱动视图自动切换：
 *   竞价(9:15-9:25) / 盘中(9:25-15:00) / 复盘(15:10 后) 对应呈现。
 *
 * 数据源：server_info MCP 工具（交易日/时段）。本地用 Date 计算时段，
 * server_info 用于确认「今日是否交易日」与校准时区。
 *
 * 时段划分（WATCH-METHODOLOGY §8 固定时间表）：
 *   - preopen / 竞价：9:15-9:25
 *   - morning: 9:30-11:30
 *   - afternoon: 13:00-15:00
 *   - trading: 9:30-15:00 合称盘中
 *   - review: 15:10 后（收盘复盘）
 *   - closed：非交易时段（含非交易日）
 */

export type SessionPhase =
  | 'closed' // 非交易日或盘外
  | 'auction' // 集合竞价 9:15-9:25
  | 'trading' // 盘中 9:30-15:00
  | 'review' // 收盘复盘 15:10 后
  | 'premarket' // 盘前 9:00-9:15

export interface ServerInfo {
  /** 当前交易日 YYYY-MM-DD，或 null（非交易日）。 */
  tradeDate?: string
  /** 当前时段（服务端口径）。 */
  phase?: string
  /** 是否开盘。 */
  is_open?: boolean
  /** ⚠️ 实测 server_info 字段（opentdx 3.4.0）：today / last_trading_day / server_time… */
  today?: unknown
  last_trading_day?: unknown
  server_time?: unknown
  [key: string]: unknown
}

const str10 = (v: unknown): string => (typeof v === 'string' ? v.slice(0, 10) : '')
/** 周末判定。导出给 `stage.ts` 的 `currentStage` 做交易日兜底（见那里的 bug 说明）。 */
export const isWeekend = (d: Date): boolean => d.getDay() === 0 || d.getDay() === 6

function localDateKey(d: Date): string {
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  return `${d.getFullYear()}-${m}-${dd}`
}

/** 从 Date 计算时段（本地，依赖 server_info 确认交易日）。 */
export function phaseFromDate(d: Date, isTradeDay?: boolean): SessionPhase {
  const h = d.getHours()
  const m = d.getMinutes()
  const minutes = h * 60 + m
  // 非交易日 → 一律 closed
  if (!isTradeDay) return 'closed'
  if (minutes < 9 * 60) return 'closed' // 凌晨
  if (minutes < 9 * 60 + 15) return 'premarket' // 9:00-9:15
  if (minutes < 9 * 60 + 25) return 'auction' // 9:15-9:25 竞价
  if (minutes < 9 * 60 + 30) return 'premarket' // 9:25-9:30 空档
  if (minutes <= 15 * 60) return 'trading' // 9:30-15:00 盘中
  if (minutes < 15 * 60 + 10) return 'review' // 15:00-15:10 收盘后
  return 'review' // 15:10 后复盘
}

/** 时段文本。 */
export function phaseLabel(p: SessionPhase): string {
  switch (p) {
    case 'closed': return '休市'
    case 'premarket': return '盘前'
    case 'auction': return '竞价'
    case 'trading': return '盘中'
    case 'review': return '复盘'
  }
}

/** 时段图标（emoji，供头部显示）。 */
export function phaseIcon(p: SessionPhase): string {
  switch (p) {
    case 'closed': return '💤'
    case 'premarket': return '🌙'
    case 'auction': return '📢'
    case 'trading': return '📈'
    case 'review': return '📊'
  }
}

/**
 * 会话时钟状态（供 React 组件轮询用）。
 * 由上层每 60s 调用 refresh 更新。
 */
export interface SessionClock {
  now: number // Date.now()
  phase: SessionPhase
  isTradeDay: boolean
  tradeDate?: string
  serverInfo?: ServerInfo
}

/** 由 server_info + 本地时间构造时钟状态。 */
export function buildClock(info: ServerInfo | null, d: Date = new Date()): SessionClock {
  // 实测 server_info 提供 today(服务器当前日期)/last_trading_day(最近交易日)。
  // 交易日判定（近似）：工作日视为交易日，周末一律休市；
  // ⚠️ 工作日节假日（如国庆中的周中休市）未细化，待协议冒烟后按 flags 精确化。
  const isTradeDay = !isWeekend(d)
  const todayRaw = info ? str10(info.today) : ''
  const lastRaw = info ? str10(info.last_trading_day) : ''
  const tradeDate = /^\d{4}-\d{2}-\d{2}$/.test(todayRaw) ? todayRaw : lastRaw || localDateKey(d)
  return {
    now: d.getTime(),
    phase: phaseFromDate(d, isTradeDay),
    isTradeDay,
    tradeDate,
    serverInfo: info ?? undefined,
  }
}
