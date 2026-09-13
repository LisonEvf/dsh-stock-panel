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
import { EMBEDDED_TOOL_NAMES, isExtendedMarketTool } from '../lib/tool-names'
import { boundedInt, positiveInt, requireArgsObject, resolveEnum } from './tool-args'
import { createSerialQueue, QueueTimeoutError } from './serial-queue'
import { orderBoardRows } from './board-order'

/** 业务参数错误（如实抛给调用方，不触发回退）。 */
export class TdxToolError extends Error {}
/** 传输不可用（未连接/断线/超时/不支持）→ 如实上抛（无远端兜底）。 */
export class TdxUnavailableError extends Error {}
/** 明确不支持的工具（未知工具名）→ 如实上抛（无远端兜底）。 */
export class UnsupportedToolError extends Error {}

/** 参数错误统一映射成业务错（保持既有 kind='business' 契约）。 */
function argError(message: string): Error {
  return new TdxToolError(message)
}

// ── 单例 + 串行队列（TDX 长连接协议帧不允许并发交错） ──
//
// 分链原则：**按连接分**（A 股 7709 / 扩展市场 7727）。2026-09-12 实测过一次
// `goods_varieties`（扩展市场）挂死后，连 `quote`/`server_info` 都一起 10s+ 无响应 ——
// 同一条链上的死请求会把整个面板拖住，直到重启 dsh web。分链 + 单次超时 + 重连，
// 三者缺一不可（原因与设计见 src/host/serial-queue.ts 头部）。

let client: any = null
let clientPromise: Promise<any> | null = null
let lastError = ''

/** 传输通道：a = A 股行情（7709），ex = 扩展市场（7727）。 */
export type TdxTransport = 'a' | 'ex'

function intEnv(name: string, fallback: number): number {
  const raw = typeof process !== 'undefined' ? process.env?.[name] : undefined
  const n = Number(raw)
  return Number.isFinite(n) && n > 0 ? Math.trunc(n) : fallback
}

/** 单次调用超时：A 股 8s（行情工具最慢的涨停梯队单轮也就数秒）；扩展市场 12s。 */
const TIMEOUT_MS: Record<TdxTransport, number> = {
  a: intEnv('DSH_TDX_TIMEOUT_MS', 8_000),
  ex: intEnv('DSH_TDX_EX_TIMEOUT_MS', 12_000),
}

/**
 * HIST 自挖概念工具的**单独预算**：首次调用要建快照（拉数百只 K 线），实测超过 8s。
 *
 * 超时是"防挂死"的闸门，不是"催命符"：慢而正常的调用不该被砍掉 —— 实测第一次把
 * `hist_concept_classes` 砍在 8s 上（冷启动建快照），自挖板块会直接不可用。
 * 仍然有限：真挂死时 90s 后同样丢连接重连，不会像从前那样永久堵死队列。
 */
const HIST_TIMEOUT_MS = intEnv('DSH_TDX_HIST_TIMEOUT_MS', 90_000)

/** 某工具走哪条链时的超时预算。 */
function timeoutOf(name: string, which: TdxTransport): number {
  return name.startsWith('hist_concept_') ? HIST_TIMEOUT_MS : TIMEOUT_MS[which]
}

/** 重连计数（诊断面板展示"自愈过几次"）。 */
const reconnects: Record<TdxTransport | 'all', number> = { a: 0, ex: 0, all: 0 }

/** 单条连接正在重建中的 promise（避免并发重连打架）。 */
const connecting: Partial<Record<TdxTransport, Promise<void>>> = {}

/** 队列内的任务：`dispatch` 在链上执行，超时由链负责（见 serial-queue.ts）。 */
const queues: Record<TdxTransport, ReturnType<typeof createSerialQueue>> = {
  a: createSerialQueue({
    label: 'A股行情(7709)',
    timeoutMs: TIMEOUT_MS.a,
    onTimeout: () => { scheduleRecovery('a') },
  }),
  ex: createSerialQueue({
    label: '扩展市场(7727)',
    timeoutMs: TIMEOUT_MS.ex,
    onTimeout: () => { scheduleRecovery('ex') },
  }),
}

/** 工具名 → 传输通道。 */
export function transportOf(name: string): TdxTransport {
  return isExtendedMarketTool(name) ? 'ex' : 'a'
}

function mkt(s: unknown) {
  return resolveEnum(Market, s, { label: 'market', makeError: argError })
}

function exMkt(s: unknown) {
  return resolveEnum(ExMarket, s, { label: 'ex market', makeError: argError })
}

function periodOf(s: unknown) {
  return resolveEnum(Period, s, { label: 'period', fallback: Period.DAILY, makeError: argError })
}

function adjustOf(s: unknown) {
  return resolveEnum(Adjust, s, { label: 'adjust', fallback: Adjust.NONE, makeError: argError })
}

/**
 * 排序键/方向：**未知值一律报错**（旧实现静默回落 CHANGE_PCT/DESC，
 * 于是 `sort_type:'AMOUNT'` 会悄悄给出按涨幅排的数据 —— 见 tool-args.ts 头部）。
 *
 * 同时给出**规范名**（数字枚举的反向映射）：适配层要用它做本地复算排序
 * （board-order.ts），所以名字必须来自枚举本身，不能来自用户输入的大小写变体。
 */
function sortOf(args: Record<string, unknown>): {
  type: number
  typeName: string
  order: number
  orderName: string
} {
  const type = resolveEnum(SortType, args.sort_type, {
    label: 'sort_type',
    fallback: SortType.CHANGE_PCT,
    makeError: argError,
  })
  const order = resolveEnum(SortOrder, args.sort_order, {
    label: 'sort_order',
    fallback: SortOrder.DESC,
    makeError: argError,
  })
  return {
    type,
    typeName: String((SortType as Record<number, unknown>)[type] ?? ''),
    order,
    orderName: String((SortOrder as Record<number, unknown>)[order] ?? ''),
  }
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

/** 取某条连接的子客户端（node-tdx 的 TdxClient 内部持有两条连接）。 */
function subClientOf(c: any, which: TdxTransport): any {
  return which === 'a' ? c?.qClient?.() : c?.eqClient?.()
}

/**
 * 确保某条连接可用（**重连后单独补连**用）。
 *
 * 为什么需要它：`TdxClient.connect()` 一次性连两条连接。我们为了"一条挂住不连坐"，
 * 重连时只把**那一条**子连接断掉置空（见 resetConnection），于是下次用到它时必须
 * 自己补一次 connect/login —— 否则会得到"not connected"这种二次故障。
 */
async function ensureTransport(which: TdxTransport): Promise<void> {
  const c = await getClient()
  const sub = subClientOf(c, which)
  if (!sub || sub.isConnected) return
  const pending = connecting[which]
  if (pending) return pending
  const task = (async () => {
    try {
      await sub.connect()
      await sub.login?.()
    } finally {
      delete connecting[which]
    }
  })()
  connecting[which] = task
  return task
}

/** 断开并丢弃某一条子连接（下次用到时由 ensureTransport 重连）。 */
async function resetConnection(which: TdxTransport): Promise<void> {
  const c = client
  if (!c) return
  const field = which === 'a' ? '_quotationClient' : '_exQuotationClient'
  const sub = c[field]
  try {
    if (sub?.isConnected && sub.disconnect) {
      // 卡死的 socket 连断链也可能不返回：给它 2s，超时就当断掉了
      await Promise.race([
        Promise.resolve(sub.disconnect()).catch(() => undefined),
        new Promise((r) => setTimeout(r, 2_000)),
      ])
    }
  } catch {
    /* 断链失败也要继续置空 */
  }
  try {
    c[field] = null
  } catch {
    /* 只读属性等：忽略 */
  }
}

/**
 * 自愈：超时后**先丢这条链 + 丢这条连接**，下次调用自动重连。
 *
 * 为什么这么激进（而不是"再等等看"）：卡住的 socket 不会自己好 —— 实测挂死 20 分钟
 * 依然全部超时，而新连接只要 216ms。丢掉重连的代价远小于"整个面板不能取数"。
 * 连续两次超时则连整个 client 一起重建（可能是更上层的状态坏了）。
 * 用 setTimeout(0) 排到链外，避免在链内的 finally 里做网络动作造成自锁。
 */
function scheduleRecovery(which: TdxTransport): void {
  setTimeout(() => {
    void (async () => {
      try {
        const consecutive = queues[which].stats().consecutiveTimeouts
        await resetConnection(which)
        queues[which].reset()
        reconnects[which] += 1
        if (consecutive >= 2) {
          await disposeTdxClient()
          reconnects.all += 1
        }
        console.warn(
          `[stock-panel] TDX ${which === 'a' ? 'A股' : '扩展市场'} 连接超时 → 已丢弃重连（连续 ${consecutive} 次）`,
        )
      } catch (err) {
        console.warn('[stock-panel] TDX 自愈失败：', (err as Error)?.message ?? err)
      }
    })()
  }, 0)
}

/** 主动断开（进程退出/插件卸载清理用）。 */
export async function disposeTdxClient(): Promise<void> {
  const c = client
  client = null
  clientPromise = null
  queues.a.reset()
  queues.ex.reset()
  delete connecting.a
  delete connecting.ex
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
  // 工具名白名单：未知工具在**碰网络之前**就拒掉（旧实现要先建连再抛，纯粹浪费一次连接预算）
  if (!EMBEDDED_TOOL_NAMES.includes(name)) {
    throw new UnsupportedToolError(
      `unknown tool: ${name}（内置 ${EMBEDDED_TOOL_NAMES.length} 个：${EMBEDDED_TOOL_NAMES.join('/')}）`,
    )
  }
  const safeArgs = requireArgsObject(args, 'args') as Record<string, unknown>
  const which = transportOf(name)
  try {
    await ensureTransport(which)
  } catch (err) {
    throw new TdxUnavailableError(`TDX connect failed: ${(err as Error)?.message ?? String(err)}`)
  }
  const fn = await getClient()
  const task = async (): Promise<unknown> => {
    try {
      return await dispatch(fn, name, safeArgs)
    } catch (err) {
      if (err instanceof TdxToolError || err instanceof UnsupportedToolError) throw err
      if (err instanceof TdxUnavailableError) throw err
      const msg = (err as Error)?.message ?? String(err)
      lastError = msg
      // 连接被重置/超时等传输级失败 → 视为不可用（该连接已被自愈逻辑丢弃，下个请求会重连）
      if (/connect|ECONN|socket|timeout|reset/i.test(msg)) throw new TdxUnavailableError(msg)
      throw new TdxToolError(`${name}: ${msg}`)
    }
  }
  try {
    return await queues[which].run(task, { timeoutMs: timeoutOf(name, which) })
  } catch (err) {
    // 单次调用超时：如实上抛（并已由队列回调触发丢弃重连），而不是让调用方无限等
    if (err instanceof QueueTimeoutError) {
      lastError = err.message
      throw new TdxUnavailableError(`${err.message} —— 已丢弃该连接并自动重连，请重试`)
    }
    throw err
  }
}

/**
 * 工具分发（**导出以便离线单测**：注入假 fn 即可覆盖参数校验与排序契约，不触网）。
 */
export async function dispatch(fn: any, name: string, args: Record<string, unknown>): Promise<unknown> {
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
      // 排序键/方向先过白名单（未知值报错，不再静默回落 CHANGE_PCT/DESC）
      const sort = sortOf(args)
      const count = boundedInt(args.count, { label: 'count', min: 1, max: 20_000, fallback: 50 })
      const rows = await fn.stockBoardMembers(
        board, count,
        sort.type,
        sort.order,
      )
      const normalized = normalizeRows(rows, normalizeQuoteRow)
      // 契约兜底：文档写着"含排序"，就不该依赖下游是否守约（node-tdx 多页拼接曾把页序反过来，
      // 导致全 A 榜单整体升序 —— 见 board-order.ts 头部实测）。本地能复算的键一律重排一遍。
      const ordered = orderBoardRows(normalized, sort.typeName, sort.orderName)
      if (!ordered.enforced && sort.orderName !== 'NONE') {
        console.warn(`[stock-panel] board_members 排序未本地复算：${ordered.reason ?? '未知'}`)
      }
      return ordered.rows
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
      const rows = await fn.goodsKline(
        exMkt(args.market), code, periodOf(args.period), 0,
        boundedInt(args.count, { label: 'count', min: 1, max: 2_000, fallback: 10 }), 1,
      )
      return normalizeKlineRows(rows)
    }
    case 'goods_varieties':
      // 商品品种列表（期货/期权合约）：market_id 为商品市场号（int，如 1=大商所）。
      // ⚠️ 必须校验：旧实现 `Number(args.market_id) || 0` 会把"没给/给错"静默变成市场号 0，
      // 而 0 号在扩展市场服务端**不返回**（实测 35s+ 无响应）→ 挂住整条连接（含 A 股）。
      // 这类"缺省值恰好是非法值"的写法，是本次事故链的起点之一。
      return fn.goodsVarieties(
        positiveInt(args.market_id, { label: 'market_id', min: 1, max: 999, makeError: argError }),
        0,
        boundedInt(args.count, { label: 'count', min: 1, max: 600, fallback: 20 }),
      )
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

/** 诊断：当前内置服务状态（连接 + 每条链的排队/超时/自愈计数）。 */
export function tdxEmbeddedDiagnostics(): Record<string, unknown> {
  return {
    enabled: hostEmbeddedEnabled(),
    connected: Boolean(client),
    lastError: lastError || undefined,
    reconnects: { ...reconnects },
    queues: { a: queues.a.stats(), ex: queues.ex.stats() },
  }
}
