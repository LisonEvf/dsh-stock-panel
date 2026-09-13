/**
 * src/host/naming/news.ts —— 板块级快讯素材源（新浪财经 7×24）。
 *
 * ## 为什么要有这个源
 *
 * A2b 之后「自挖模块素材不足」的根因不是模型偷懒，而是**手里只有一种素材**：
 * 通达信厂商概念标签。实测命名理由 89% 是「与已有 XX 一致」——那是复述花名册，
 * 而项目立论恰恰是「花名册里没有的东西，查花名册查不到」（见 `cluster-namer/docs/12`）。
 *
 * 补源要补**同一层级**的源：共动是**板块级**现象，需要板块级原因。
 * 另一条路（个股公告）已被对照实验否掉：富集倍数 5 天 1.30x / 10 天 0.95x，在噪声内。
 *
 * ## 时间性（本模块最需要说清的一件事）
 *
 * 快讯接口**只有滚动最新列表，没有历史查询** —— 表面上看它和 `unusual` 同病：
 * 不能用于历史 as_of。但两者有一个决定性差别：
 *
 *   · `unusual` / `market_monitor` **只有"当前这一份"列表**，翻页也翻不出过去 → 只能按设计跳过；
 *   · 快讯**每条带真实时间戳**，翻页能翻到过去 —— 实测（`scripts/news-source-probe.mjs`：
 *     2026-09-12 23:52 拉 30 页 × 100 条 = 3000 条）覆盖 **2026-09-10 21:02 → 09-12 23:52**，
 *     跨度 50.8 小时、每页约 1.69 小时；**上一个交易日 09-11 的完整交易时段在第 17–23 页**。
 *
 * 所以本源的判据不是"as_of 是不是今天"，而是"**请求的时间窗是否落在可回溯范围内**"：
 * 落得进 → 正常采（历史 as_of 也能采，因为正文时间戳是当天真实的）；
 * 落不进 → 记 `skipped_by_design` 并写明"超出可回溯范围、不做回放"。
 * 更早的日期要靠按日存档（本批未做，见 CHANGELOG「仍未做」）。
 *
 * ## 去噪与分层（阈值全部来自实测，不是直觉）
 *
 * 实测 3000 条：`国际` 标签占 **38.2%**（凌晨更是清一色英伟达/FAA/苏丹炼油厂）→ 默认丢弃，
 * 除非它带 A 股代码。交易时段（09:15–15:05）09-11 共 541 条，其中带 `ext.stocks` 59.9%、
 * 带 A 股代码 26.4%。
 *
 * 分四层（`classifyFlash`），阈值来自 `scripts/news-source-probe.mjs` 的对照：
 *
 *   | 层 | 判据 | 用途 |
 *   | --- | --- | --- |
 *   | `announce` | 点名成员 **且** 含事件词 | 命名依据（最强） |
 *   | `anchor` | 点名成员（代码或股名） | 命名依据 |
 *   | `digest` | 盘面派生汇总（收评/成交额榜/资金榜/指数成分股快照） | **不进语料**，只计数 |
 *   | `none` | 无成员锚点 | 丢弃 |
 *
 * ⚠️ **两条反直觉的实测结论，改动前务必先读**：
 *
 * 1. **"代码+股名双重确认"不能当门槛**（参考实现里它用来挡 `ext.stocks` 的错误关联）。
 *    实测我方 5 条成员命中里有 2 条是"仅 ext 代码"：
 *    「【沐曦股份等在上海新设咨询管理公司】」——成员名是 `沐曦股份-U`，正文只写简称 `沐曦股份`，
 *    按股名匹配**一条都匹配不上**。所以代码命中同样算数，双重确认只用来**加权**，不用来排除。
 *    （短名撞车风险也已量过：成员里 ≤3 字的短名 7 个，交易时段内无 ext 代码确认的误命中 **0 次**。）
 *
 * 2. **盘面派生汇总必须排除**：实测"仅股名"命中里 6/8 条是
 *    「A股收评」「沪深两市成交额…中际旭创居首」「主力资金净流入…」「港股午评」「科创50成分股跌幅达3%」。
 *    这些**点名了成员，但复述的是我们自己就有的数据**（成员涨跌幅已在 prompt 里），
 *    而且会把**结果当原因** —— 一个"因科创50下跌而共动"的主题是循环论证。
 *    它们不是"素材不足"，是"素材层级不对"，所以只计数、不进语料。
 */
import type { MaterialItem, NamingMember } from './types'

/** 素材源标识（进指纹，必须是稳定常量）。 */
export const SOURCE_NEWS = 'news_flash'

/** 快讯接口（无需鉴权；实测 200）。 */
export const NEWS_FEED_URL = 'https://zhibo.sina.com.cn/api/zhibo/feed'

/** 浏览器 UA + Referer：缺 Referer 时该接口会拒绝。 */
const NEWS_HEADERS: Record<string, string> = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36',
  Referer: 'https://finance.sina.com.cn/7x24/',
}

export const DEFAULT_NEWS = {
  /** 翻页上限。实测 24 页 ≈ 40 小时，足够覆盖"上一个交易日的完整交易时段"。 */
  pages: 24,
  pageSize: 100,
  timeoutMs: 20_000,
  /**
   * 正向标签白名单：**默认关闭**（空数组）。
   *
   * 参考实现有它（`['公司','宏观','市场','政策','A股','行业']`），用来给"全市场 5000 个股票名"
   * 的匹配循环减负。我们不需要：本源的匹配对象只有**本组几十只成员**，一页 100 条 × 几十个名字
   * 的字符串包含判断是微不足道的开销；而正向过滤**只会误伤**。实测（09-11 交易时段）：
   * 会被它滤掉的成员命中 **0 条**、成交额榜命中仅 1 条（还是条无关的纪检新闻）。
   * 保留这个旋钮是为了需要时能收紧，不是因为它有用。
   */
  keepTags: [] as string[],
  /**
   * 丢弃这些标签（除非该条带 A 股代码）。实测盘中 541 条里「国际」占 **160 条（29.6%）**，
   * 且这 160 条命中成员 **0 次**；但其中 13 条带 A 股代码（那类仍可能相关，按参考实现保留）。
   */
  dropTags: ['国际'] as string[],
} as const

/** A 股代码形态（含 8/9 开头的北交所）。 */
const A_CODE_RE = /^(0|3|6|8|9)\d{5}$/

/** 事件词：与"公司/行业发生了什么事"直接相关（不含"涨停/上涨"这类价格事实）。 */
export const EVENT_KEYWORDS: readonly string[] = [
  '公告', '披露', '中标', '合同', '订单', '签约', '战略合作', '协议',
  '减持', '增持', '回购', '增资', '定增', '发行', '重组', '收购', '并购', '股权激励',
  '业绩预告', '业绩快报', '业绩说明会', '预增', '预减', '扭亏',
  '涨价', '提价', '降价', '扩产', '投产', '试产', '量产', '停产', '复产', '获批', '核准',
  '成立', '新设', '注册', '专利', '入选', '试点', '许可', '备案', '环评',
  '问询', '立案', '处罚', '减持计划', '解禁', '分红', '派息', '合作', '供货',
]

/**
 * 盘面派生汇总的标记词。
 *
 * 判据是"这条快讯的内容是否**结构性罗列**我们已有的行情数据"：收评/午评、成交额榜、
 * 主力资金榜、指数成分股快照都是。刻意**不含** `涨超`/`涨停` —— 真实的板块级事件快讯
 * 常常写「均涨超4%」（实测那条「军工板块持续走高…国科军工均涨超4%」正是好素材）。
 */
export const DIGEST_MARKERS: readonly string[] = [
  '收评', '午评', '早盘综述', '盘面', '成交额', '两市', '沪深两市',
  '主力资金', '净流入', '净流出', '净买入', '净卖出', '资金流向', '龙虎榜',
  '涨幅达', '跌幅达', '成分股', '居首', '居前',
]

/** 一条快讯（字段按不可信处理后的归一形态）。 */
export interface NewsFlash {
  id: string
  /** `YYYY-MM-DD HH:mm:ss`（接口给的本地时间）。 */
  ts: string
  text: string
  tags: string[]
  /** `ext.stocks` 里的关联代码（已剥掉 sh/sz/bj 前缀）。 */
  stocks: string[]
  /** 真实原文链接（实测 2894/3000 条带 `docurl`）。 */
  url: string
}

/**
 * 正文/名称归一：去空白（含全角空格）+ 全角字母数字转半角 + 转大写。
 *
 * 为什么必须做：通达信给的三字名**补空格**（`万 科Ａ`、`深天马Ａ`）且字母全角，
 * 而快讯正文写 `万科A`。不归一会**一条都匹配不上**，且不报任何错。
 */
export function normForMatch(s: unknown): string {
  return String(s ?? '')
    .replace(/[\s\u3000]/g, '')
    .replace(/[Ａ-Ｚａ-ｚ０-９]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xfee0))
    .toUpperCase()
}

/** 剥掉市场前缀，保留 6 位代码。 */
function bareCode(raw: unknown): string {
  return String(raw ?? '').trim().replace(/^(sh|sz|bj)/i, '')
}

/** 抓取依赖（注入 fetch 以便离线单测；不传则用全局 fetch）。 */
export interface NewsFetchDeps {
  fetchImpl?: typeof fetch | undefined
  pages?: number | undefined
  pageSize?: number | undefined
  timeoutMs?: number | undefined
  /** 正向标签白名单（默认空 = 不过滤；理由见 `DEFAULT_NEWS.keepTags`）。 */
  keepTags?: string[] | undefined
  /** 丢弃标签（默认 `['国际']`；带 A 股代码的条目例外）。 */
  dropTags?: string[] | undefined
}

/**
 * 标签去噪。
 *
 * 规则（与参考实现一致，且实测过影响）：
 *   · 命中 `dropTags` **且不带 A 股代码** → 丢弃（「国际」实测占盘中 29.6%、命中成员 0 次）；
 *   · `keepTags` 非空时，须命中白名单或带 A 股代码，否则丢弃（默认关闭）。
 */
export function filterFlashTags(
  items: readonly NewsFlash[],
  keepTags: readonly string[] = DEFAULT_NEWS.keepTags,
  dropTags: readonly string[] = DEFAULT_NEWS.dropTags,
): NewsFlash[] {
  const keep = new Set(keepTags)
  const drop = new Set(dropTags)
  const out: NewsFlash[] = []
  for (const it of items) {
    const hasCode = it.stocks.length > 0
    if (!hasCode && drop.size > 0 && it.tags.some((t) => drop.has(t))) continue
    if (keep.size > 0 && !hasCode && !it.tags.some((t) => keep.has(t))) continue
    out.push(it)
  }
  return out
}

export interface NewsFetchResult {
  items: NewsFlash[]
  /** HTTP 成功取回的页数（**含空页**：空页是"接口到底"，不是失败）。 */
  pagesFetched: number
  /** 报错的页数。 */
  failedPages: number
  /** 第一页就失败时的错误消息（>1 页失败时只记最后一条）。 */
  lastError: string
  /**
   * 停止原因：
   *   `covered` 已翻到请求窗口起点（覆盖完整）· `page_cap` 翻到页数上限（**覆盖不完整**）
   *   · `empty` 接口翻到底 · `error` 某页报错中断。
   */
  stopReason: 'covered' | 'page_cap' | 'empty' | 'error'
}

/** 解析接口返回的一页（字段全部按不可信处理）。 */
export function parseFeedPage(json: unknown): NewsFlash[] {
  const list = (json as { result?: { data?: { feed?: { list?: unknown } } } } | null)?.result?.data?.feed?.list
  if (!Array.isArray(list)) return []
  const out: NewsFlash[] = []
  for (const raw of list) {
    if (raw === null || typeof raw !== 'object') continue
    const it = raw as Record<string, unknown>
    let ext: Record<string, unknown> = {}
    try {
      const parsed: unknown = JSON.parse(String(it.ext ?? '') || '{}')
      if (parsed !== null && typeof parsed === 'object') ext = parsed as Record<string, unknown>
    } catch {
      ext = {}
    }
    const text = String(it.rich_text ?? it.text ?? '').trim()
    if (text === '') continue
    const tagRaw = Array.isArray(it.tag) ? it.tag : []
    const stocksRaw = Array.isArray(ext.stocks) ? ext.stocks : []
    out.push({
      id: String(it.id ?? it.commentid ?? ''),
      ts: String(it.create_time ?? '').trim(),
      text,
      tags: tagRaw.map((t) => String((t as { name?: unknown } | null)?.name ?? '')).filter((s) => s !== ''),
      stocks: stocksRaw
        .map((s) => bareCode((s as { symbol?: unknown; code?: unknown } | null)?.symbol ?? (s as { code?: unknown } | null)?.code))
        .filter((c) => A_CODE_RE.test(c)),
      url: String(ext.docurl ?? '').trim(),
    })
  }
  return out
}

/**
 * 抓取快讯（滚动列表 + 翻页回放）。
 *
 * `sinceDate`（`YYYY-MM-DD`）= 请求窗口的起点：翻到"本页最旧一条已早于它"就停，
 * 避免为了一个 1 天的窗口白翻 24 页。翻到上限仍未到起点时 `stopReason='page_cap'`
 * —— **覆盖不完整这件事必须上报**，否则"窗口内没有相关快讯"会被读成"市场没有这事"。
 */
export async function fetchNewsFlashes(
  deps: NewsFetchDeps,
  sinceDate: string,
): Promise<NewsFetchResult> {
  const doFetch = deps.fetchImpl ?? fetch
  const pages = Math.max(1, Math.floor(deps.pages ?? DEFAULT_NEWS.pages))
  const pageSize = Math.max(1, Math.floor(deps.pageSize ?? DEFAULT_NEWS.pageSize))
  const timeoutMs = Math.max(1000, Math.floor(deps.timeoutMs ?? DEFAULT_NEWS.timeoutMs))
  const items: NewsFlash[] = []
  let pagesFetched = 0
  let failedPages = 0
  let lastError = ''
  let stopReason: NewsFetchResult['stopReason'] = 'page_cap'

  for (let page = 1; page <= pages; page += 1) {
    let rows: NewsFlash[]
    try {
      const url = `${NEWS_FEED_URL}?page=${page}&page_size=${pageSize}&zhibo_id=152&tag_id=0&dire=f&dpc=1`
      const res = await doFetch(url, { headers: NEWS_HEADERS, signal: AbortSignal.timeout(timeoutMs) })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      rows = parseFeedPage(await res.json())
      pagesFetched += 1
    } catch (err) {
      failedPages += 1
      lastError = (err as Error)?.message ?? String(err)
      stopReason = 'error'
      break
    }
    if (rows.length === 0) {
      stopReason = 'empty'
      break
    }
    items.push(
      ...filterFlashTags(
        rows,
        deps.keepTags ?? DEFAULT_NEWS.keepTags,
        deps.dropTags ?? DEFAULT_NEWS.dropTags,
      ),
    )
    const oldest = rows.map((r) => r.ts).filter((t) => t !== '').sort()[0] ?? ''
    if (oldest !== '' && oldest.slice(0, 10) <= sinceDate) {
      stopReason = 'covered'
      break
    }
  }
  return { items, pagesFetched, failedPages, lastError, stopReason }
}

/** 一条快讯对一个类的分层结论。 */
export type FlashLevel = 'announce' | 'anchor' | 'digest' | 'none'

export interface FlashHit {
  member: NamingMember
  /** 命中依据：`code`（ext 关联代码或正文代码）/ `name`（正文股名）/ `both`。 */
  via: 'code' | 'name' | 'both'
}

export interface FlashClassify {
  level: FlashLevel
  hits: FlashHit[]
  /** 人读依据（诊断/来源说明用）。 */
  reason: string
}

/** 成员索引：代码 → 成员；股名（归一）→ 成员。 */
export interface NewsMemberIndex {
  byCode: Map<string, NamingMember>
  byName: Map<string, NamingMember>
  size: number
}

export function buildMemberIndex(members: readonly NamingMember[]): NewsMemberIndex {
  const byCode = new Map<string, NamingMember>()
  const byName = new Map<string, NamingMember>()
  for (const m of members) {
    const code = bareCode(m.code)
    if (code !== '') byCode.set(code, m)
    const n = normForMatch(m.name)
    // 单字名不进索引：一个汉字撞车概率太高，宁可少算命中也不放进噪声
    if (n.length >= 2) byName.set(n, m)
  }
  return { byCode, byName, size: byCode.size }
}

/**
 * 给一条快讯分层。
 *
 * 先判 `digest`（盘面派生汇总）：即使它点名了成员也不进语料 —— 它复述的是我们已有的数据，
 * 而且会把"结果"当"原因"（详见文件头）。
 */
export function classifyFlash(flash: NewsFlash, index: NewsMemberIndex): FlashClassify {
  const text = normForMatch(flash.text)
  const hits = new Map<string, FlashHit>()
  for (const code of flash.stocks) {
    const m = index.byCode.get(code)
    if (m === undefined) continue
    hits.set(m.code, { member: m, via: 'code' })
  }
  for (const [name, m] of index.byName) {
    if (!text.includes(name)) continue
    const cur = hits.get(m.code)
    hits.set(m.code, { member: m, via: cur === undefined ? 'name' : 'both' })
  }
  const hitList = [...hits.values()]
  if (hitList.length === 0) return { level: 'none', hits: [], reason: '' }

  const digest = DIGEST_MARKERS.find((k) => text.includes(normForMatch(k)))
  if (digest !== undefined) {
    return { level: 'digest', hits: hitList, reason: `盘面派生汇总（含「${digest}」）` }
  }
  const ev = EVENT_KEYWORDS.find((k) => text.includes(normForMatch(k)))
  const who = hitList.map((h) => `${h.member.code}${h.via === 'both' ? '(码+名)' : h.via === 'code' ? '(码)' : '(名)'}`)
  return ev === undefined
    ? { level: 'anchor', hits: hitList, reason: `点名成员 ${who.join('、')}` }
    : { level: 'announce', hits: hitList, reason: `事件词「${ev}」+ 点名成员 ${who.join('、')}` }
}

/** 正文标题：`【…】` 内为标题，否则取前 24 字（与参考实现的 `title` 同口径）。 */
export function flashTitle(text: string): string {
  const t = text.trim()
  if (t.startsWith('【')) {
    const end = t.indexOf('】')
    if (end > 0 && end < 40) return t.slice(1, end)
  }
  return t.slice(0, 24)
}

/** `YYYY-MM-DD HH:mm:ss` → `YYYY-MM-DD HH:mm`（素材 ts 的统一精度）。 */
export function flashTs(ts: string): string {
  const m = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2})/.exec(String(ts ?? '').trim())
  return m === null ? '' : `${m[1]} ${m[2]}`
}

/** `YYYY-MM-DD HH:mm:ss` → `YYYY-MM-DD`（时间窗切片与可回溯范围判定用）。 */
export function flashDate(ts: string): string {
  const t = String(ts ?? '').trim()
  return /^\d{4}-\d{2}-\d{2}/.test(t) ? t.slice(0, 10) : ''
}

/**
 * 一条快讯 → 素材条目（**按命中的成员各一条**）。
 *
 * 为什么按成员拆：本站语料的组织方式是"每票各有哪些素材"（`groupByStock`），
 * 护栏的覆盖度/命中票数也都以成员为单位；一条快讯同时点名 3 只成员，
 * 对那 3 只票各自都是一条可用素材（引文反查也按成员分组去找）。
 */
export function flashToMaterials(flash: NewsFlash, hits: readonly FlashHit[]): MaterialItem[] {
  const out: MaterialItem[] = []
  const ts = flashTs(flash.ts)
  if (ts === '') return out
  const title = flashTitle(flash.text)
  for (const h of hits) {
    out.push({
      stock: `${h.member.code} ${h.member.name}`,
      key: `${h.member.market}${h.member.code}`,
      source: SOURCE_NEWS,
      ts,
      title,
      // 正文全文进语料：护栏要求引文**逐字**取自素材，截断会让合规引文被判成幻觉
      snippet: flash.text,
      kind: 'news_flash',
    })
  }
  return out
}
