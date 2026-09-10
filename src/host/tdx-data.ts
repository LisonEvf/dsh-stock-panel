/**
 * src/host/tdx-data.ts — 内置 TDX 数据服务（host 半进程内直连，替代外部 python 网关）。
 *
 * 在 dsh web 的 Node 进程内维护一个 node-tdx（opentdx）TdxClient 长连接，
 * 把 frontend 的 15 个行情工具翻译为 TDX 调用，并把输出归一化为与远端
 * opentdx-MCP（python）**逐字段一致**的契约。归一化规则基于 2026-09-08 实拆对比：
 *
 *   - quote / board_members 的 JS 输出是 PY 的超集，差异仅：total_shares /
 *     float_shares 单位（JS 万股 → PY 股，×10000）；pre_ipov 是 pre_iopv 的
 *     笔误字段，需重命名补齐。
 *   - kline / goods_kline / symbol_info 的 datetime/time 是 UTC ISO（.000Z），
 *     要转成 PY 的本地区间 ISO（YYYY-MM-DDTHH:mm:ss）。
 *   - tick_chart 的 time 是 "HH:mm"，PY 是 "HH:mm:ss"。
 *   - belong_board / capital_flow 的 JS 返回包了 {data: [...]}，PY 直接给内层。
 *   - symbol_info 缺 price_decimals/per_hand/trade_count/nav（PY 有）。
 *   - server_info 缺 server_time（由 ts1 推导）。
 *   - goods_quotes 走扩展客户端的全字段 getSymbolQuotes（与 PY COMMON 字段一致）。
 *   - goods_varieties（商品品种列表）已内置，node-tdx GoodsList 解析器按 python
 *     opentdx 同款启发式解码 price/volume/change_pct/h1/h2，字段契约一致。
 *
 * 本模块只允许被 host 半（Node）代码 import；浏览器端不得引用。
 */
import { TdxClient, Market, ExMarket, Period, Adjust, Category, SortType, SortOrder } from './vendor/opentdx.js'
import { hostEmbeddedEnabled } from '../lib/endpoints'
import { callHistTool } from './hist-data'

/** 业务参数错误（如实抛给调用方，不触发回退）。 */
export class TdxToolError extends Error {}
/** 传输不可用（未连接/断线/超时/不支持）→ 如实上抛（无远端兜底）。 */
export class TdxUnavailableError extends Error {}
/** 明确不支持的工具（未知工具名）→ 如实上抛（无远端兜底）。 */
export class UnsupportedToolError extends Error {}

// ── 单例 + 串行队列（TDX 长连接协议帧不允许并发交错） ──

let client: any = null
let clientPromise: Promise<any> | null = null
let queue: Promise<unknown> = Promise.resolve()
let lastError = ''

function mkt(s: unknown) {
  const name = String(s ?? '').toUpperCase()
  if (!(name in Market)) throw new TdxToolError(`invalid market: ${s}`)
  return Market[name]
}

function exMkt(s: unknown) {
  const name = String(s ?? '').toUpperCase()
  if (!(name in ExMarket)) throw new TdxToolError(`invalid ex market: ${s}`)
  return ExMarket[name]
}

function periodOf(s: unknown) {
  const name = String(s ?? 'DAILY').toUpperCase()
  if (!(name in Period)) throw new TdxToolError(`invalid period: ${s}`)
  return Period[name]
}

function adjustOf(s: unknown) {
  const name = String(s ?? 'NONE').toUpperCase()
  if (!(name in Adjust)) throw new TdxToolError(`invalid adjust: ${s}`)
  return Adjust[name]
}

async function getClient(): Promise<any> {
  if (client) return client
  if (!clientPromise) {
    clientPromise = (async () => {
      const c = new TdxClient({ heartbeat: true, autoRetry: true })
      await c.connect()
      client = c
      return c
    })()
  }
  try {
    return await clientPromise
  } catch (err) {
    clientPromise = null
    throw new TdxUnavailableError(`TDX connect failed: ${(err as Error).message}`)
  }
}

/** 让所有 TDX 调用串行（协议帧级互斥）。 */
function serial<T>(fn: () => Promise<T>): Promise<T> {
  const run = queue.then(fn, fn)
  queue = run.catch(() => undefined)
  return run
}

/** 主动断开（进程退出/插件卸载清理用）。 */
export async function disposeTdxClient(): Promise<void> {
  const c = client
  client = null
  clientPromise = null
  queue = Promise.resolve()
  if (c?.disconnect) {
    try { await c.disconnect() } catch { /* ignore */ }
  }
}

// ── 归一化工具 ──

function pad2(n: number): string { return String(n).padStart(2, '0') }

/** UTC ISO(.000Z) 或 Date → 本地区间 ISO（去掉毫秒与 Z），对齐 python 输出。 */
function toLocalIso(value: unknown): unknown {
  const d = value instanceof Date ? value : typeof value === 'string' ? new Date(value) : null
  if (!d || Number.isNaN(d.getTime())) return value
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}T${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`
}

/** time "HH:mm" → "HH:mm:ss"。 */
function padTime(value: unknown): unknown {
  if (typeof value !== 'string') return value
  if (/^\d{2}:\d{2}$/.test(value)) return `${value}:00`
  return value
}

function isoDateOf(s: unknown): Date | undefined {
  if (typeof s !== 'string' || !s) return undefined
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (!m) return undefined
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
}

/** A 股 quote/板块行归一化：股本单位 万股→股、pre_ipov 笔误补齐。 */
function normalizeQuoteRow(row: Record<string, unknown>): Record<string, unknown> {
  for (const k of ['total_shares', 'float_shares']) {
    const v = Number(row[k])
    if (Number.isFinite(v) && v > 0 && v < 1e9) row[k] = v * 10000 // 万股 → 股
  }
  if (row.pre_ipov !== undefined && row.pre_iopv === undefined) row.pre_iopv = row.pre_ipov
  return row
}

function normalizeRows(rows: unknown, normalize: (r: Record<string, unknown>) => Record<string, unknown> = (r) => r): unknown {
  if (Array.isArray(rows)) return rows.map((r) => normalize(r as Record<string, unknown>))
  return rows
}

function normalizeKlineRows(rows: unknown): unknown {
  if (!Array.isArray(rows)) return rows
  return rows.map((r) => {
    const row = { ...(r as Record<string, unknown>) }
    if (row.datetime !== undefined) row.datetime = toLocalIso(row.datetime)
    return row
  })
}

function normalizeTickRows(rows: unknown): unknown {
  if (!Array.isArray(rows)) return rows
  return rows.map((r) => {
    const row = { ...(r as Record<string, unknown>) }
    if (row.time !== undefined) row.time = padTime(row.time)
    return row
  })
}

function unwrapData(x: unknown): unknown {
  // belong_board / capital_flow 的 JS 输出形如 { data: <array|dict>, query_info, ext }，
  // python opentdx 直接给内层（数组或字典）。
  if (x && typeof x === 'object' && !Array.isArray(x)) {
    const data = (x as { data?: unknown }).data
    if (Array.isArray(data) || (data != null && typeof data === 'object')) return data
  }
  return x
}

// ── 15 工具分发 ──

const A_SHARE_MARKETS = new Set(['SZ', 'SH', 'BJ'])

export async function callEmbeddedTool(name: string, args: Record<string, unknown>): Promise<unknown> {
  if (!hostEmbeddedEnabled()) throw new TdxUnavailableError('embedded TDX disabled (DSH_TDX_EMBEDDED=0)')
  const fn = await getClient()
  return serial(async () => {
    try {
      return await dispatch(fn, name, args ?? {})
    } catch (err) {
      if (err instanceof TdxToolError || err instanceof UnsupportedToolError) throw err
      if (err instanceof TdxUnavailableError) throw err
      const msg = (err as Error)?.message ?? String(err)
      lastError = msg
      // 连接被重置/超时等传输级失败 → 视为不可用（下个请求会自动重连/回退）
      if (/connect|ECONN|socket|timeout|reset/i.test(msg)) throw new TdxUnavailableError(msg)
      throw new TdxToolError(`${name}: ${msg}`)
    }
  })
}

async function dispatch(fn: any, name: string, args: Record<string, unknown>): Promise<unknown> {
  const market = (args.market ?? '').toString().toUpperCase()
  const code = String(args.code ?? '')

  switch (name) {
    case 'quote': {
      if (!A_SHARE_MARKETS.has(market)) throw new TdxToolError(`quote: invalid market ${args.market}`)
      const rows = await fn.stockQuotesFields([[mkt(market), code]])
      return normalizeRows(rows, normalizeQuoteRow)
    }
    case 'kline': {
      const rows = await fn.stockKline(
        mkt(market), code, periodOf(args.period), Number(args.start ?? 0) || 0,
        Number(args.count ?? 10), 1, adjustOf(args.adjust),
      )
      return normalizeKlineRows(rows)
    }
    case 'tick_chart': {
      const d = args.query_date ? isoDateOf(args.query_date) : undefined
      const rows = await fn.stockTickChart(mkt(market), code, d)
      return normalizeTickRows(rows)
    }
    case 'transaction': {
      const d = args.query_date ? isoDateOf(args.query_date) : undefined
      const rows = await fn.stockTransaction(mkt(market), code, d)
      const count = Number(args.count ?? 0)
      const sliced = Array.isArray(rows) && count > 0 ? rows.slice(0, count) : rows
      return normalizeTickRows(sliced)
    }
    case 'auction':
      return fn.stockAuction(mkt(market), code) // JS 已返回 {market, code, items}
    case 'unusual':
      return fn.stockUnusual(mkt(market), 0, Number(args.count ?? 10))
    case 'market_monitor':
      return fn.stockMarketMonitor(mkt(market), 0, Number(args.count ?? 10))
    case 'board_members': {
      const raw = String(args.board_symbol ?? '881001')
      const special = raw.toUpperCase()
      const board = special in Category && !/^\d+$/.test(raw) ? Category[special] : raw
      const rows = await fn.stockBoardMembers(
        board, Number(args.count ?? 50) || 50,
        String(args.sort_type ?? 'CHANGE_PCT').toUpperCase() in SortType ? SortType[String(args.sort_type).toUpperCase()] : SortType.CHANGE_PCT,
        String(args.sort_order ?? 'DESC').toUpperCase() in SortOrder ? SortOrder[String(args.sort_order).toUpperCase()] : SortOrder.DESC,
      )
      return normalizeRows(rows, normalizeQuoteRow)
    }
    case 'belong_board': {
      const rows = await fn.stockBelongBoard(mkt(market), code)
      return unwrapData(rows)
    }
    case 'capital_flow': {
      const flow = await fn.stockCapitalFlow(mkt(market), code)
      return unwrapData(flow)
    }
    case 'symbol_info': {
      const info = (await fn.stockSymbolInfo(mkt(market), code)) as Record<string, unknown> | null
      if (!info) return null
      const out = { ...info }
      if (out.time !== undefined) out.time = toLocalIso(out.time)
      // A 股价格小数位恒为 2；python 端独立字段（decimal 另有所指），不从中推导。
      if (out.price_decimals === undefined) out.price_decimals = 2
      if (out.per_hand === undefined) out.per_hand = 100
      if (out.trade_count === undefined) out.trade_count = 0
      if (out.nav === undefined) out.nav = 0
      return out
    }
    case 'server_info': {
      const info = (await fn.serverInfo()) as Record<string, unknown> | null
      if (!info) return null
      const out = { ...info }
      if (out.server_time === undefined && typeof out.ts1 === 'number') {
        const v = out.ts1
        out.server_time = `${pad2(Math.floor(v / 10000))}:${pad2(Math.floor(v / 100) % 100)}:${pad2(v % 100)}`
      }
      return out
    }
    // ── 扩展市场 ──
    case 'goods_quotes': {
      const ex = exMkt(args.market)
      // 扩展客户端的全字段报价（含 name/量比/股本等），与 python opentdx COMMON 字段对齐
      const rows = await fn.exQuotationClient.getSymbolQuotes([[ex, code]])
      return normalizeRows(rows, normalizeQuoteRow)
    }
    case 'goods_kline': {
      const rows = await fn.goodsKline(exMkt(args.market), code, periodOf(args.period), 0, Number(args.count ?? 10), 1)
      return normalizeKlineRows(rows)
    }
    case 'goods_varieties':
      // 商品品种列表（期货/期权合约）：market_id 为商品市场号（int，如 1=大商所）。
      // node-tdx goodsVarieties 与 python opentdx goods_varieties 输出字段一致。
      return fn.goodsVarieties(Number(args.market_id) || 0, 0, Number(args.count) || 20)
    // ── HIST 自挖概念引擎（进程内 HistEngine，替代远端 Python MCP） ──
    case 'hist_concept_query':
    case 'hist_concept_classes':
    case 'hist_concept_class':
    case 'hist_concept_status':
      return callHistTool(fn, name, args)
    default:
      throw new UnsupportedToolError(`unknown tool: ${name}`)
  }
}

/** 诊断：当前内置服务状态。 */
export function tdxEmbeddedDiagnostics(): Record<string, unknown> {
  return {
    enabled: hostEmbeddedEnabled(),
    connected: Boolean(client),
    lastError: lastError || undefined,
  }
}
