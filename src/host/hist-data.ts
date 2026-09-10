/**
 * src/host/hist-data.ts — 内置 HIST 自挖概念引擎（进程内 node-tdx HistEngine）。
 *
 * 把 opentdx-mcp 的 hist_concept_* 四个工具译制为进程内实现，替代远端 Python MCP：
 *   - 数据钩子：fetchQfq = QFQ 日线分页；snapshotA = 全A成交额榜快照；nameHook = 名称兜底；
 *   - 引擎：node-tdx 的 HistEngine（K线残差共动 → 无监督聚类，纯 JS 路径）。
 *
 * 本模块只允许被 host 半（Node）代码 import；引擎在首次调用时惰性建单例，
 * 快照带 TTL（默认 3600s）自动重建。所有取数都发生在 tdx-data.ts 的 serial()
 * 串行队列上下文内（由 callEmbeddedTool 包裹），不会与其它工具调用交错。
 */
import { HistEngine, Market, Period, Adjust, SortType, SortOrder, Category } from './vendor/opentdx.js'
import { TdxUnavailableError } from './tdx-data'

let engine: any = null

/** 名称兜底：榜单外/未命名票走 quotes_fields。 */
async function nameHook(fn: any, market: string, code: string): Promise<string | null> {
  try {
    const q = await fn.stockQuotesFields([[Market[market], code]])
    if (q && q[0] && q[0].name) return String(q[0].name)
  } catch { /* ignore */ }
  return null
}

/** Date/字符串 → 本地 'YYYY-MM-DD'（raw kline 的 datetime 是 Date 对象）。 */
function dateStr(v: unknown): string {
  if (v == null) return ''
  const d = v instanceof Date ? v : new Date(String(v))
  if (isNaN(d.getTime())) return ''
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/** QFQ 日线分页钩子：返回 [beg, as_of] 内升序去重的 [date_str, close]。 */
async function fetchQfq(fn: any, market: string, code: string, beg: string, asOf: string): Promise<Array<[string, number]>> {
  const mkt = Market[market]
  const rows: Array<Record<string, any>> = []
  let start = 0
  const page = 800
  for (;;) {
    const batch = (await fn.stockKline(mkt, code, Period.DAILY, start, page, 1, Adjust.QFQ)) || []
    if (!batch.length) break
    rows.push(...batch)
    const dates = batch.map((r: any) => dateStr(r.datetime)).filter(Boolean).sort()
    const oldest = dates[0] ?? ''
    if (oldest < beg || batch.length < page) break
    start += page
    if (start > 6000) break
  }
  const sorted = rows.sort((a, b) => dateStr(a.datetime).localeCompare(dateStr(b.datetime)))
  const seen = new Set<string>()
  const out: Array<[string, number]> = []
  for (const r of sorted) {
    const d = dateStr(r.datetime)
    const cl = r.close
    if (!d || seen.has(d) || cl == null) continue
    if (d < beg || d > asOf) continue
    seen.add(d)
    out.push([d, Number(cl)])
  }
  return out
}

/** 全A快照钩子：全A成交额榜（CODE 升序）+ chg_pct，market 归一化为 int。 */
async function snapshotA(fn: any): Promise<Array<Record<string, any>>> {
  const rows = (await fn.stockBoardMembers(Category.A, 6000, SortType.CODE, SortOrder.ASC)) || []
  const out: Array<Record<string, any>> = []
  for (const r of rows) {
    const mv = Number(r.market)
    let chg: number | null = null
    try {
      const cl = Number(r.close || 0)
      const pc = Number(r.pre_close || 0)
      if (pc > 0) chg = Math.round(((cl - pc) / pc) * 10000) / 100
    } catch { /* ignore */ }
    out.push({ ...r, market: mv, chg_pct: chg })
  }
  return out
}

function getEngine(fn: any): any {
  if (!engine) {
    engine = new HistEngine(
      (m: string, c: string, b: string, a: string) => fetchQfq(fn, m, c, b, a),
      () => snapshotA(fn),
      undefined,
      (m: string, c: string) => nameHook(fn, m, c),
      (msg: string) => console.log(msg),
    )
  }
  return engine
}

function num(v: unknown): number | undefined {
  if (v == null || v === '') return undefined
  const n = Number(v)
  return Number.isFinite(n) ? n : undefined
}

/**
 * 调用内置 HIST 引擎（hist_concept_query / hist_concept_classes /
 * hist_concept_class / hist_concept_status），返回与远端 MCP 同构的 dict。
 */
export async function callHistTool(fn: any, name: string, args: Record<string, unknown>): Promise<unknown> {
  const eng = getEngine(fn)
  switch (name) {
    case 'hist_concept_query': {
      const market = String(args.market ?? '').toUpperCase()
      if (market !== 'SZ' && market !== 'SH') throw new Error(`hist_concept_query: invalid market ${args.market}`)
      return eng.queryStock(
        market, String(args.code ?? ''),
        num(args.topk) ?? 8,
        typeof args.as_of === 'string' ? args.as_of : undefined,
        Boolean(args.refresh),
        num(args.window), num(args.min_corr), num(args.pool_n),
        true,
      )
    }
    case 'hist_concept_classes':
      return eng.classes(
        typeof args.as_of === 'string' ? args.as_of : undefined,
        Boolean(args.refresh),
        num(args.top_members) ?? 5,
        num(args.window), num(args.min_corr), num(args.pool_n),
      )
    case 'hist_concept_class':
      return eng.classMembers(
        Number(args.class_id) || 0,
        typeof args.as_of === 'string' ? args.as_of : undefined,
        Boolean(args.refresh),
        num(args.window), num(args.min_corr), num(args.pool_n),
      )
    case 'hist_concept_status':
      return eng.status()
    default:
      throw new TdxUnavailableError(`unknown hist tool: ${name}`)
  }
}
