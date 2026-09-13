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
import { aggregateConcept, isLimitUpClose, memberStatsOf, type ConceptMemberStat } from '../lib/concept-strength'

let engine: any = null

/**
 * 全A成交额榜快照的**进程内 memo**（60s）。
 *
 * 为什么必须有：这张榜是 ≥2MB 的一次拉取，而它有两个消费者 ——
 * 引擎重建（`snapshotA` 钩子）与「类强度聚合」（要 `buy_price_limit` 判涨停）。
 * 不做 memo 就是同一份数据每个请求拉两遍，正好踩在本仓库最忌讳的那条
 * （「全 A 快照不重复拉」，见 `docs/ARCHITECTURE.md` §3.1）。
 * 60s 远小于引擎自身的快照 TTL（3600s），所以不会改变聚类的口径。
 */
const SNAP_TTL_MS = 60_000
let snapMemo: { at: number; rows: Array<Record<string, any>>; byCode: Map<string, Record<string, any>> } | null = null

async function snapshotMemo(fn: any): Promise<NonNullable<typeof snapMemo>> {
  const now = Date.now()
  if (snapMemo !== null && now - snapMemo.at < SNAP_TTL_MS) return snapMemo
  const rows = ((await fn.stockBoardMembers(Category.A, 6000, SortType.CODE, SortOrder.ASC)) || []) as Array<
    Record<string, any>
  >
  const byCode = new Map<string, Record<string, any>>()
  for (const r of rows) {
    const code = String(r?.code ?? '')
    if (code !== '') byCode.set(code, r)
  }
  snapMemo = { at: now, rows, byCode }
  return snapMemo
}

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
  const memo = await snapshotMemo(fn)
  const out: Array<Record<string, any>> = []
  for (const r of memo.rows) {
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

/** 每个类最多回传多少只成员（类本身很小，这个上限只是防御性护栏）。 */
const MEMBER_CAP = 20

/**
 * 给 `hist_concept_classes` 的每个类补「成员 / 涨幅 / 涨停数 / 强度」。
 *
 * 为什么补在 host 半而不是前端：
 *   1. **涨停必须精确判定**（`buy_price_limit`），那张全A快照只有 host 半有；
 *   2. 补完的强度是**排序与显示的共同来源**（口径见 `lib/concept-strength.ts`）；
 *   3. 类列表只给 `top`（成员名）时，前端连"哪只涨停了"都看不出来，只能再逐类调一次。
 *
 * 成本：每类一次 `classMembers`（引擎快照已缓存 → 纯 CPU，不产生网络请求），
 * 加一次与引擎**共用**的全A快照（60s memo）。
 * 弱链伪类不补（界面本来就不采信它，少发无用调用）。
 */
async function enrichClasses(
  fn: any,
  eng: any,
  res: any,
  p: { asOf?: string | undefined; window?: number | undefined; minCorr?: number | undefined; poolN?: number | undefined },
): Promise<any> {
  if (res === null || typeof res !== 'object' || res.ok === false) return res
  const list = Array.isArray(res.classes) ? res.classes : []
  if (list.length === 0) return res
  const memo = await snapshotMemo(fn)
  const out: any[] = []
  for (const c of list) {
    if (c === null || typeof c !== 'object' || c.weak_chain === true) {
      out.push(c)
      continue
    }
    const classId = Number(c.class_id)
    let members: Array<ConceptMemberStat & { corr: number | null }> = []
    try {
      const detail = await eng.classMembers(classId, p.asOf, false, p.window, p.minCorr, p.poolN)
      if (detail !== null && typeof detail === 'object' && detail.ok !== false) {
        const rows = (Array.isArray(detail.members) ? detail.members : []) as Array<Record<string, unknown>>
        // 纯函数在 lib/concept-strength.ts（市场编码归一 + 涨停判定 + 原值保留），单测逐条钉住
        members = memberStatsOf(rows, (code) => memo.byCode.get(code))
      }
    } catch { /* 单类补数失败不拖垮整张表：该类的强度按"没有成员"处理，界面显示仅 N/M 只 */ }
    const agg = aggregateConcept(members)
    out.push({
      ...c,
      size: Number.isFinite(Number(c.size)) ? Number(c.size) : members.length,
      /**
       * 成员按**引擎/MCP 的 snake_case 口径**回传（`chg_pct` / `limit_up` / `corr`）。
       *
       * 为什么不能直接把内部对象丢出去：内部成员是 TS 的 camelCase 形状
       * （`chgPct`/`limitUp`），而前端按 snake_case 解析 —— 直接透传的结果是
       * **界面上一片"—"、涨停标记全灭，且不报任何错**（本批就是靠
       * `scripts/smoke-concept-classes.mjs` 的字段断言才发现的）。
       */
      members: members.slice(0, MEMBER_CAP).map((m) => ({
        market: m.market,
        code: m.code,
        name: m.name,
        chg_pct: m.chgPct,
        limit_up: m.limitUp,
        corr: m.corr,
      })),
      n: agg.n,
      known_n: agg.knownN,
      chg_mean: agg.chgMean,
      chg_max: agg.chgMax,
      up_n: agg.upN,
      limit_up_n: agg.limitUpN,
      strength: agg.strength,
    })
  }
  // 孤立票也补一个"是否涨停"：界面把它们和类成员并排比较时，口径必须一致
  const isolatedTop = Array.isArray(res.isolated_top)
    ? res.isolated_top.map((s: Record<string, any>) => {
        const quote = memo.byCode.get(String(s?.code ?? ''))
        return { ...s, limit_up: isLimitUpClose(quote?.close, quote?.buy_price_limit) }
      })
    : res.isolated_top
  return { ...res, classes: out, isolated_top: isolatedTop }
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
    case 'hist_concept_classes': {
      const p = {
        asOf: typeof args.as_of === 'string' ? args.as_of : undefined,
        window: num(args.window),
        minCorr: num(args.min_corr),
        poolN: num(args.pool_n),
      }
      const res = await eng.classes(p.asOf, Boolean(args.refresh), num(args.top_members) ?? 5, p.window, p.minCorr, p.poolN)
      return enrichClasses(fn, eng, res, p)
    }
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
