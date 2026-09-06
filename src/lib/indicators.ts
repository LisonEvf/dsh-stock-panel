/**
 * 客户端指标工具（M6 起步：涨停判定 + 连板统计；M8 扩展 MA/EMA/MACD/RSI 等）。
 *
 * A 股涨跌停规则（按代码前缀 + ST 判定）：
 *   - 主板（60/00 开头）：10%；ST/*ST：5%
 *   - 创业板（300/301）：20%；科创板（688）：20%
 *   - 北交所（4/8/92 开头）：30%
 *   - 上市首日/次新无涨跌幅限制——连板统计对极端情形只做近似，以 close 触及
 *     当日前收的涨跌幅限制价为准。
 */

export interface CandleLike {
  /** 兼容 K 线行：stock-data 的 datetime 或后端 date 字段。 */
  datetime?: string
  date?: string
  open?: number
  high?: number
  low?: number
  close: number
}

/** 涨跌停幅度（小数制，0.1 = 10%）。 */
export function limitUpPct(code: string, name = ''): number {
  const c = code.replace(/\D/g, '').slice(-6)
  if (/ST/i.test(name)) return 0.05
  if (/^(300|301)/.test(c)) return 0.2
  if (/^688/.test(c)) return 0.2
  if (/^(4|8|92)/.test(c)) return 0.3
  return 0.1
}

/** 按前收计算当日涨停价（四舍五入到分）。 */
export function limitPriceOf(prevClose: number, code: string, name = ''): number {
  const pct = limitUpPct(code, name)
  return Math.round(prevClose * (1 + pct) * 100) / 100
}

/** 当日收盘是否封涨停（close 触及涨停价，容差半分）。 */
export function isLimitUpDay(prevClose: number, close: number, code: string, name = ''): boolean {
  const limit = limitPriceOf(prevClose, code, name)
  return Math.abs(close - limit) <= 0.005
}

/** 当日是否一字涨停（开盘即涨停价，即开盘价≈涨停价且当日封住）。 */
export function isOneWordLimitUp(prevClose: number, open: number | undefined, close: number, code: string, name = ''): boolean {
  if (open == null) return false
  if (!isLimitUpDay(prevClose, close, code, name)) return false
  const limit = limitPriceOf(prevClose, code, name)
  return Math.abs(open - limit) <= 0.005
}

export interface StreakResult {
  /** 连续涨停天数（含最新一根；0 = 最新一根未涨停）。 */
  streak: number
  /** 连续涨停的日期列表（旧→新，含最新）。 */
  dates: string[]
  /** 最新一根是否一字板。 */
  oneWord: boolean
  /** 最新一根涨停的封单力度估值：可用换手/金额由上层补充，这里返回封板价。 */
  limitPrice: number | null
}

/**
 * 统计连板数：rows 需为升序（旧→新）、末根为"当日"的日 K。
 * 从最新一根向前数连续涨停；超出窗口按窗口长度截断。
 */
export function countStreak(
  rows: CandleLike[],
  code: string,
  name = '',
): StreakResult {
  const empty: StreakResult = { streak: 0, dates: [], oneWord: false, limitPrice: null }
  if (rows.length < 2) return empty
  const last = rows[rows.length - 1]
  const prev = rows[rows.length - 2]
  const dateOf = (r: CandleLike): string =>
    r.date ? String(r.date).slice(0, 10) : r.datetime ? r.datetime.slice(0, 10) : ''

  // 从最新一根向前回溯：每根相对其前一根收盘涨停则计一板
  let streak = 0
  const dates: string[] = []
  let idx = rows.length - 1
  while (idx >= 1) {
    const cur = rows[idx]
    const prevDay = rows[idx - 1]
    if (!isLimitUpDay(prevDay.close, cur.close, code, name)) break
    streak++
    dates.push(dateOf(cur))
    idx--
  }
  if (streak === 0) return empty
  dates.reverse()
  const oneWord = isOneWordLimitUp(prev.close, last.open, last.close, code, name)
  return { streak, dates, oneWord, limitPrice: limitPriceOf(prev.close, code, name) }
}
