/**
 * A 股标的符号解析 / 归一化工具。
 *
 * 符号惯例（全站统一）：
 *   - 显示/存储用带市场前缀的字符串：`SH600519` / `SZ000001` / `BJ920289`
 *   - 接受输入形态：`SH600519`、`600519.SH`、`sz000001`、裸 6 位 `600519`、
 *     `000001`（裸码按规则推断市场）
 */

export type MarketTag = 'SH' | 'SZ' | 'BJ'

/** 服务端数值 market 字段 → 市场标签（0=SZ, 1=SH, 2=BJ，TDX 约定）。 */
export function marketIdToTag(id: number | string | undefined): MarketTag {
  const n = Number(id)
  if (n === 0) return 'SZ'
  if (n === 2) return 'BJ'
  return 'SH'
}

/** 市场标签 → 服务端数值 market。 */
export function marketTagToId(tag: MarketTag): number {
  if (tag === 'SZ') return 0
  if (tag === 'BJ') return 2
  return 1
}

export interface SymbolParts {
  market: MarketTag
  code: string
}

/** 裸 6 位 A 股代码 → 推断市场（沪深京）。指数等非股票标的请显式传市场。 */
export function inferMarket(code: string): MarketTag {
  const c = code.replace(/\D/g, '').slice(-6)
  if (/^[489]/.test(c)) return 'BJ' // 4xx/8xx/9xx(BJ)
  if (/^[235]/.test(c) || /^0/.test(c)) return 'SZ' // 0/2/3 开头 → 深市
  return 'SH' // 6 开头（含 688/689/600/601/603/605/900…）
}

/** 把任意形态符号解析为 { market, code }；解析失败返回 null。 */
export function parseSymbol(s: string): SymbolParts | null {
  if (!s) return null
  const str = s.trim().toUpperCase()
  // 前缀式：SH600519 / SZ000001 / BJ920289
  let m = str.match(/^(SH|SZ|BJ)(\d{4,6})/)
  if (m) return { market: m[1] as MarketTag, code: m[2] }
  // 后缀式：600519.SH / 000001.SZ / 920289.BJ
  m = str.match(/^(\d{4,6})\.(SH|SZ|BJ)$/)
  if (m) return { market: m[2] as MarketTag, code: m[1] }
  // 裸码
  m = str.match(/^(\d{4,6})$/)
  if (m) return { market: inferMarket(m[1]), code: m[1] }
  return null
}

/** market + code → 标准符号 `SH600519`。 */
export function toSymbol(market: MarketTag, code: string): string {
  return `${market}${code}`
}

/** 归一化任意符号 → 标准符号；失败返回原串。 */
export function normalizeSymbol(s: string): string {
  const p = parseSymbol(s)
  return p ? toSymbol(p.market, p.code) : s
}
