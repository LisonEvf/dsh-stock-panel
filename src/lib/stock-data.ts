/**
 * 股票数据适配层（M5 版）：通过 MCP 工具获取数据，转换成前端组件所需格式。
 *
 * 数据源：默认本机 opentdx JSON 网关（http://127.0.0.1:8017/call，见 gateway/README.md），
 * 网关不可达自动回退远端 MCP（192.168.31.196:8007/mcp）；由 mcp.ts invokeTool 统一分发。
 *
 * 工具返回约定（已实测）：
 *   - quote / kline / tick_chart / unusual / market_monitor / board_members
 *     的 text content 是一个 JSON 数组（或单个对象），本层统一 toArray 处理。
 *   - market 字段为数值：0=SZ, 1=SH, 2=BJ（见 lib/symbol.ts）。
 *   - 涨跌幅不在响应里，一律由 close/pre_close 推算。
 */

import { invokeTool, type McpCallResult } from './mcp'
import { marketIdToTag, type MarketTag } from './symbol'

// ===== 原始行类型（与服务端字段一致） =====

/** 实时报价行（股票与指数通用）。 */
export interface QuoteRow {
  market: number
  code: string
  name?: string
  pre_close: number
  open: number
  high: number
  low: number
  close: number
  vol?: number
  vol_ratio?: number
  amount?: number
  total_shares?: number
  float_shares?: number
  turnover?: number
  buy_price_limit?: number
  sell_price_limit?: number
  total_market_cap_ab?: number
  pe_dynamic?: number
  main_net_amount?: number
  [key: string]: any
}

/** K 线行（日/分钟通用）。 */
export interface McpKlineRow {
  datetime: string
  open: number
  high: number
  low: number
  close: number
  vol?: number
  volume?: number
  amount?: number
  [key: string]: any
}

/** 分时行（tick_chart）。 */
export interface TickRow {
  time: string
  price: number
  avg: number
  vol: number
  momentum?: number
}

/** 市场异动行（unusual / market_monitor 同构）。 */
export interface UnusualRow {
  index?: number
  market: number
  code: string
  name?: string
  time?: string
  desc?: string
  value?: string
  unusual_type?: number
  v1?: number
  v2?: number
  v3?: number
  v4?: number
  flag?: number
}

/** 所属板块行（belong_board）：板块自带当日涨停/跌停数与板块指数。 */
export interface BelongBoardRow {
  board_type?: string
  market?: number | string
  board_symbol?: string
  board_symbol_name?: string
  close?: number
  pre_close?: number
  涨停数?: number | string
  跌停数?: number | string
  最相似?: string
  [key: string]: any
}

/** 从 MCP 工具结果中提取文本 JSON。 */
function extractText(result: McpCallResult): string | null {
  const text = result.content
    ?.filter((c) => c.type === 'text' && c.text)
    .map((c) => c.text)
    .join('\n')
    ?.trim()
  return text || null
}

/**
 * 兼容 fastmcp「结构化输出」形态（实测 opentdx 3.4.0：有数据时 content[].text
 * 与 structuredContent 并存；空结果/部分工具仅返回 structuredContent，此时
 * content 为空数组）。取数统一顺序：content 文本 → structuredContent。
 * 服务端 structuredContent 结构为 `{ result: [...] | {...} | null }`。
 */
function extractStructured(result: McpCallResult): any | null {
  const sc = (result as { structuredContent?: unknown }).structuredContent
  if (sc == null) return null
  if (typeof sc !== 'object') return sc
  const boxed = sc as { result?: unknown }
  if ('result' in boxed) return boxed.result ?? null
  return sc
}

/**
 * 归一化为数组（兼容三种输入）：
 *   - 已解析的数组（callToolJson 的主返回形态）→ 原样返回；
 *   - JSON 字符串（工具 text 直读）→ JSON.parse 后再分形；
 *   - 对象 {rows|data|items: [...]} / 单对象 → rows/data/items 或包一层。
 * ⚠️ 历史坑：曾对已解析数组再 JSON.parse（数组会被字符串化成 "a,b" 而解析失败
 * → 静默返回空，整层数据在网关传输下全空）。2026-09-06 冒烟复现后修复。
 */
function toArray(input: unknown): any[] {
  if (input == null) return []
  if (Array.isArray(input)) return input
  let data: any = input
  if (typeof input === 'string') {
    if (!input.trim()) return []
    try {
      data = JSON.parse(input)
    } catch {
      return []
    }
  }
  if (Array.isArray(data)) return data
  if (data && Array.isArray(data.rows)) return data.rows
  if (data && Array.isArray(data.data)) return data.data
  if (data && Array.isArray(data.items)) return data.items
  if (data && typeof data === 'object') return [data]
  return []
}

/** 通用工具调用：返回解析后的任意 JSON 数组/对象。 */
export async function callToolJson(name: string, args: Record<string, unknown>): Promise<any> {
  const result = await invokeTool(name, args)
  if (result.isError) {
    const msg = extractText(result) || '工具调用失败'
    throw new Error(`${name}: ${msg}`)
  }
  // 1) content[].text（服务端主格式）
  const text = extractText(result)
  if (text) {
    try {
      return JSON.parse(text)
    } catch {
      /* 文本非 JSON 时继续尝试 structuredContent */
    }
  }
  // 2) structuredContent 兜底（fastmcp wrap_result / 空结果形态）
  const sc = extractStructured(result)
  return sc ?? null
}

/** 调用 quote 工具 → 首个报价对象；无数据返回 null。 */
export async function fetchQuote(market: MarketTag, code: string): Promise<QuoteRow | null> {
  const data = await callToolJson('quote', { market, code })
  const rows = Array.isArray(data) ? data : data ? [data] : []
  return (rows[0] as QuoteRow) ?? null
}

/** 报价 → 涨跌幅（百分比数字，如 3.5 = +3.5%）。 */
export function quotePct(q: { close: number; pre_close: number }): number {
  if (!q || !q.pre_close) return 0
  return ((q.close - q.pre_close) / q.pre_close) * 100
}

/** 调用 kline 工具（升序，旧→新）。 */
export async function fetchKlineRows(
  market: MarketTag,
  code: string,
  period = 'DAILY',
  count = 10,
  start = 0,
): Promise<McpKlineRow[]> {
  const data = await callToolJson('kline', { market, code, period, count, start })
  return toArray(data) as McpKlineRow[]
}

/** 调用 tick_chart（分时）：date 为 YYYY-MM-DD 时查历史，缺省为实时/最近交易日。 */
export async function fetchTickRows(market: MarketTag, code: string, date?: string | null): Promise<TickRow[]> {
  const args: Record<string, unknown> = { market, code }
  if (date) args.query_date = date
  const data = await callToolJson('tick_chart', args)
  return toArray(data) as TickRow[]
}

/** 调用 unusual（市场异动）。 */
export async function fetchUnusual(market: MarketTag, count = 30): Promise<UnusualRow[]> {
  const data = await callToolJson('unusual', { market, count })
  return toArray(data) as UnusualRow[]
}

/** 调用 market_monitor（主力监控）。 */
export async function fetchMarketMonitor(market: MarketTag, count = 30): Promise<UnusualRow[]> {
  const data = await callToolJson('market_monitor', { market, count })
  return toArray(data) as UnusualRow[]
}

/** 调用 belong_board（个股所属板块，板块自带当日涨停/跌停数）。 */
export async function fetchBelongBoard(market: MarketTag, code: string): Promise<BelongBoardRow[]> {
  const data = await callToolJson('belong_board', { market, code })
  return toArray(data) as BelongBoardRow[]
}

/**
 * 调用 board_members（板块成分行情）。board_symbol 可用 "A"(全部A股) /
 * "SH" / "SZ" / "KCB" / "CYB" / 板块代码。
 * ⚠️ 服务端 sort_type 实测仅 CHANGE_PCT / VOLUME / CODE 等可用，AMOUNT 会报错
 * —— 需要按金额排序时传 count 取全量后在客户端自排。
 */
export async function fetchBoardMembers(
  boardSymbol: string,
  count = 6000,
  sortType = 'CHANGE_PCT',
  sortOrder: 'ASC' | 'DESC' | 'NONE' = 'DESC',
): Promise<QuoteRow[]> {
  const data = await callToolJson('board_members', {
    board_symbol: boardSymbol,
    count,
    sort_type: sortType,
    sort_order: sortOrder,
  })
  return toArray(data) as QuoteRow[]
}

/** 板块成分行情 → 带市场标签 + 涨跌幅的 A 股行。 */
export interface AShareRow {
  market: MarketTag
  code: string
  name: string
  pre_close: number
  open: number
  high: number
  low: number
  close: number
  change: number
  pct: number
  vol: number
  amount: number
  turnover: number
  vol_ratio: number
  buy_price_limit: number
  sell_price_limit: number
  total_market_cap_ab: number
  pe_dynamic: number
}

/** 把服务端 quote 行归一化为 AShareRow（跳过无效行）。 */
export function toAShareRow(raw: QuoteRow): AShareRow | null {
  const close = Number(raw.close)
  const preClose = Number(raw.pre_close)
  if (!raw.code || !Number.isFinite(close) || !Number.isFinite(preClose) || preClose <= 0) {
    return null
  }
  return {
    market: marketIdToTag(raw.market),
    code: String(raw.code),
    name: raw.name || String(raw.code),
    pre_close: preClose,
    open: Number(raw.open) || close,
    high: Number(raw.high) || close,
    low: Number(raw.low) || close,
    close,
    change: close - preClose,
    pct: ((close - preClose) / preClose) * 100,
    vol: Number(raw.vol ?? 0),
    amount: Number(raw.amount ?? 0),
    turnover: Number(raw.turnover ?? 0),
    vol_ratio: Number(raw.vol_ratio ?? 0),
    buy_price_limit: Number(raw.buy_price_limit ?? 0),
    sell_price_limit: Number(raw.sell_price_limit ?? 0),
    total_market_cap_ab: Number(raw.total_market_cap_ab ?? 0),
    pe_dynamic: Number(raw.pe_dynamic ?? 0),
  }
}

// ===== N7：资金流 / 竞价序列适配 =====

/** 资金流行（capital_flow，中文键实测于 2026-09-05：今日/5日主力·散户净流入等）。 */
export interface CapitalFlowRow {
  今日主力净流入?: number
  今日散户净流入?: number
  '5日主力净流入'?: number
  '5日超大单净额'?: number
  '5日主买'?: number
  '5日主卖'?: number
  [key: string]: any
}

/** 竞价逐点行（auction items：time/price/matched/unmatched）。 */
export interface AuctionSeriesPoint {
  time: string
  price?: number
  matched?: number
  unmatched?: number
  [key: string]: any
}

/** 调用 capital_flow 工具 → 资金流对象（失败/无数据返回 null）。 */
export async function fetchCapitalFlow(market: MarketTag, code: string): Promise<CapitalFlowRow | null> {
  try {
    const d = await callToolJson('capital_flow', { market, code })
    if (d && typeof d === 'object' && !Array.isArray(d)) return d as CapitalFlowRow
    return null
  } catch {
    return null
  }
}

/** 调用 auction 工具 → 当日竞价逐点序列（盘后仍可回看当日竞价；失败返回空）。 */
export async function fetchAuctionSeries(market: MarketTag, code: string): Promise<AuctionSeriesPoint[]> {
  try {
    const d = await callToolJson('auction', { market, code })
    if (d && typeof d === 'object' && !Array.isArray(d)) {
      const items = (d as { items?: unknown }).items
      if (Array.isArray(items)) return items as AuctionSeriesPoint[]
    }
    return []
  } catch {
    return []
  }
}

/**
 * 逐笔成交行（transaction，实测字段：time HH:MM:SS / price / vol / trade_count / bs_flag）。
 * ⚠️ bs_flag 语义（1=主动买/外盘 or 0=主动卖）与 vol 单位（手/股）待盘中复验，
 * UI 先按 1=买 0=卖 呈现并标注口径。
 */
export interface TransactionRow {
  time?: string
  price?: number
  vol?: number
  trade_count?: number
  bs_flag?: number
  [key: string]: any
}

/** 调用 transaction（逐笔成交）：query_date 为 YYYY-MM-DD 时查历史，缺省最近交易日。 */
export async function fetchTransactions(
  market: MarketTag,
  code: string,
  count = 200,
  date?: string | null,
): Promise<TransactionRow[]> {
  const args: Record<string, unknown> = { market, code, count }
  if (date) args.query_date = date
  const data = await callToolJson('transaction', args)
  return toArray(data) as TransactionRow[]
}

// ===== M10：扩展市场（goods_quotes / goods_kline / goods_varieties） =====

/** 商品行情行（goods_varieties：期货合约列表，change_pct 为涨跌幅%）。 */
export interface GoodsVarietyRow {
  name?: string
  price?: number
  change_pct?: number
  [key: string]: any
}

/** 调用 goods_quotes（扩展市场报价：market 如 US_STOCK / HK_MAIN_BOARD / CFFEX_FUTURES）。 */
export async function fetchGoodsQuote(market: string, code: string): Promise<QuoteRow | null> {
  const data = await callToolJson('goods_quotes', { market, code })
  const rows = Array.isArray(data) ? data : data ? [data] : []
  return (rows[0] as QuoteRow) ?? null
}

/** 调用 goods_kline（扩展市场 K 线）。 */
export async function fetchGoodsKlines(
  market: string,
  code: string,
  period = 'DAILY',
  count = 160,
): Promise<McpKlineRow[]> {
  const data = await callToolJson('goods_kline', { market, code, period, count })
  return toArray(data) as McpKlineRow[]
}

/** 调用 goods_varieties（期货/期权合约列表）。 */
export async function fetchGoodsVarieties(marketId: number, count = 60): Promise<GoodsVarietyRow[]> {
  const data = await callToolJson('goods_varieties', { market_id: marketId, count })
  return toArray(data) as GoodsVarietyRow[]
}
