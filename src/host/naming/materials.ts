/**
 * src/host/naming/materials.ts —— 素材归一（A2b，移植自 `cluster-namer/news/opentdx_zt.py` 的纯函数部分）。
 *
 * 三类数据 → 素材条目：
 *   1. 异动（`unusual`）→ desc + time + value
 *   2. 封板状态（由日K推导：一字板 / 连板 / 换手板）—— 参考实现读 ChangeUpType，本站数据层没有该字段，
 *      用 `lib/indicators` 从日K推（同一口径，见 `countStreak`/`isOneWordLimitUp`）
 *   3. 所属板块（`belong_board`）→ **概念**进「当日题材线索」，**行业**另立一条（官方花名册口径）
 *
 * ⚠️ 非叙事板块词黑名单必须保留：真实数据里出现过把「含可转债」当成共同主题的归纳 ——
 * 那是**股本/交易属性**，不是"它们今天为什么一起动"。这类词进语料，模型一定会拿它当答案。
 *
 * 板块类型在本站数据层是**数字码**（TDX `board_type`），与参考实现的字符串口径不同：
 * 3=地区 / 4=概念 / 5=风格 / 12=行业（见 `lib/ladder.ts` 的 `boardTypeLabel`）。
 */
import type { MaterialItem, MaterialKind } from './types'

/** TDX 板块类型码。 */
export const BOARD_TYPE = {
  region: '3',
  concept: '4',
  style: '5',
  industry: '12',
} as const

/** 数字码 → 中文标签（与 `lib/ladder.ts` 同一张表，host 半不能 import 浏览器模块）。 */
export function boardTypeLabel(code: string | number | undefined | null): string {
  switch (String(code ?? '')) {
    case BOARD_TYPE.region:
      return '地区'
    case BOARD_TYPE.concept:
      return '概念'
    case BOARD_TYPE.style:
      return '风格'
    case BOARD_TYPE.industry:
      return '行业'
    default:
      return ''
  }
}

/**
 * 非叙事板块词黑名单：出现在「概念」分类里，但描述的是股本/交易/资金属性。
 * 逐字移植自参考实现（真实踩过「含可转债」被当成主题）。
 */
export const NON_NARRATIVE_BOARD_WORDS: ReadonlySet<string> = new Set([
  '含可转债', '含B股', '含H股', '含GDR', '含D股',
  '融资融券', '转融券标的', '深股通', '沪股通', '陆股通',
  'MSCI成份', '富时罗素', '标普道琼斯', '同花顺漂亮100', '茅指数', '宁组合',
  '专项贷款', '自由现金流', '低市盈率', '高股息', '破净股', '绩优股',
  '私募重仓', '机构重仓', '基金重仓', 'QFII重仓', '社保重仓', '券商重仓',
  '大盘股', '中盘股', '小盘股', '权重股', '非周期股', '周期股',
  '预盈预增', '预亏预减', '摘帽概念', 'ST板块', '次新股', '注册制次新股',
  '昨日涨停', '昨日连板', '昨日触板', '举牌', '股权转让', '员工持股',
])

/** 该板块名能否作为「叙事线索」（而非股本/资金属性）。 */
export function isNarrativeBoard(name: string | undefined | null): boolean {
  const n = String(name ?? '').trim()
  if (!n || NON_NARRATIVE_BOARD_WORDS.has(n)) return false
  // 兜底：带明显属性后缀的也挡掉
  return !['重仓', '成份', '标的', '预增', '预减'].some((tag) => n.includes(tag))
}

/** `belong_board` 工具返回的一行（字段按不可信处理）。 */
export interface BelongBoardRow {
  board_type?: string | number
  /**
   * 真实数据层的板块名字段（`src/lib/stock-data.ts` 的 `BelongBoardRow` 与
   * `lib/ladder.ts` 用的是同一个）。
   *
   * ⚠️ **这个字段名曾经取错，代价是整个命名链路瘫痪**（2026-09-14 修复）：
   * 旧代码读的是 `board_name ?? name` —— 两个都不存在，于是**每一行都解析成空**，
   * `belong_board` 这个源 100% 产出 0 条素材（界面显示「无产出」）。
   * 后果不是"少一类素材"：提示词第 0 条明写「没有快讯时用板块标签兜底」，
   * 而板块标签是**唯一一个任何 as_of 都采得到的源**（异动/监控只有当日实时列表，
   * 封板素材只在有涨停时产出）。它一空，非交易日的类就必然 `insufficient` ——
   * 实测 9 个类全部显示「素材不足」，一个名字都给不出来。
   *
   * 为什么单测没抓住：`tests/naming-pipeline.test.ts` 的假工具返回的是
   * `{ board_type, board_name }` —— **假数据照着错代码写**，两边一起错就永远自洽。
   * 所以现在假数据一律用真字段名，并有 `tests/naming-materials.test.ts` 钉住。
   */
  board_symbol_name?: string
  /** 兼容旧形态/远端 Python MCP 的口径（保留兜底，不当作主字段）。 */
  board_name?: string
  name?: string
  [k: string]: unknown
}

/**
 * 取板块名：**真字段优先**，兜底字段次之。
 *
 * 为什么允许三种：内置 TDX 与远端 Python MCP 的历史口径不同（后者给 `board_name`），
 * 而这是"少一个源"与"多认一个字段"的不对称 —— 认多了最多是命名素材更全，
 * 认少了就是本文件头部写的整条链路瘫痪。所以宁可宽进。
 */
export function boardNameOf(row: BelongBoardRow): string {
  return String(row.board_symbol_name ?? row.board_name ?? row.name ?? '').trim()
}

/** 从 belong_board 行里取概念板块（叙事过滤后）与行业板块。 */
export function splitBoards(rows: BelongBoardRow[]): { concepts: string[]; industries: string[] } {
  const concepts: string[] = []
  const industries: string[] = []
  for (const row of rows) {
    const name = boardNameOf(row)
    if (!name) continue
    const label = boardTypeLabel(row.board_type)
    if (label === '概念') {
      if (isNarrativeBoard(name)) concepts.push(name)
    } else if (label === '行业') {
      industries.push(name)
    }
  }
  return { concepts, industries }
}

/**
 * `belong_board` 的**契约漂移**检测：接口好、数据有，但本地一行都解析不出来。
 *
 * 为什么必须单独判一次（2026-09-14 的教训）：那天 `boardNameOf` 读错了字段名
 * （`board_name` vs 真字段 `board_symbol_name`），于是每只票都"产出 0 条"，
 * 而当时的归因文案把它写成「板块归属都未产出可引用板块（非失败）」—— **读起来像市场事实**，
 * 实际是本地契约漂移。这条判据把两者分开，且只在**确实漂移**时报错（不是"这只票只有地区/风格板块"
 * 这种正常情况：那种行有名字、也有可识别的类型码，所以不会命中）。
 *
 * 返回 '' = 没漂移；否则返回人读原因（进 sourceStatus.detail 与 notes）。
 */
export function boardContractDrift(rows: BelongBoardRow[]): string {
  if (rows.length === 0) return ''
  const named = rows.filter((r) => boardNameOf(r) !== '').length
  if (named === 0) {
    return `接口返回 ${rows.length} 行，但没有一行能解析出板块名（真字段是 board_symbol_name；本地读的是 board_name/name）`
  }
  const typed = rows.filter((r) => boardTypeLabel(r.board_type) !== '').length
  if (typed === 0) {
    return `接口返回 ${rows.length} 行且有板块名，但没有一行带可识别的 board_type（期望 3 地区/4 概念/5 风格/12 行业）`
  }
  return ''
}

/** `unusual` 工具返回的一行。 */
export interface UnusualRow {
  code?: string
  name?: string
  time?: string
  desc?: string
  value?: string | number
  [k: string]: unknown
}

/** 把一条异动行转成素材（date 为交易日 YYYY-MM-DD）。 */
export function unusualToMaterial(
  row: UnusualRow,
  stockLabel: string,
  key: string,
  date: string,
  source = 'unusual',
): MaterialItem | null {
  const desc = String(row.desc ?? '').trim()
  if (!desc) return null
  const time = String(row.time ?? '').trim()
  const value = row.value == null ? '' : String(row.value)
  return {
    stock: stockLabel,
    key,
    source,
    ts: `${date} ${time}`.trim(),
    title: desc,
    snippet: value ? `异动数值=${value}` : '',
    kind: 'unusual',
  }
}

/** 把「封板状态」转成素材（由日K推导的结果传入）。 */
export function limitUpTypeToMaterial(
  stockLabel: string,
  key: string,
  date: string,
  upType: string,
  source = 'kline',
): MaterialItem | null {
  const t = String(upType ?? '').trim()
  if (!t) return null
  return { stock: stockLabel, key, source, ts: `${date} 15:00`, title: '封板状态', snippet: t, kind: 'limit_up_type' }
}

/** 把板块归属转成素材（概念 / 行业各一条，与参考实现一致）。 */
export function boardsToMaterials(
  stockLabel: string,
  key: string,
  date: string,
  boards: { concepts: string[]; industries: string[] },
  source = 'belong_board',
): MaterialItem[] {
  const out: MaterialItem[] = []
  if (boards.concepts.length > 0) {
    out.push({
      stock: stockLabel,
      key,
      source,
      ts: `${date} 15:00`,
      title: '所属板块',
      snippet: boards.concepts.join('、'),
      kind: 'board_concept' as MaterialKind,
    })
  }
  if (boards.industries.length > 0) {
    out.push({
      stock: stockLabel,
      key,
      source,
      ts: `${date} 15:00`,
      title: '行业板块',
      snippet: boards.industries.join('、'),
      kind: 'board_industry' as MaterialKind,
    })
  }
  return out
}

/**
 * 同票同源相似文本去重（参考实现用 difflib 相似度 0.9）。
 *
 * host 半不引第三方库：用**字符二元组 Dice 系数**近似 difflib.ratio ——
 * 对异动这类短文本足够，且**只会少去重、不会误删**（误删会让模型看不到素材，更危险）。
 */
export function dedupMaterials<T extends { stock: string; source: string; title: string; snippet: string }>(
  items: T[],
  threshold = 0.9,
): T[] {
  const kept: T[] = []
  for (const item of items) {
    const text = `${item.title}${item.snippet}`
    const dup = kept.some((k) => {
      if (k.stock !== item.stock || k.source !== item.source) return false
      return textSimilarity(text, `${k.title}${k.snippet}`) >= threshold
    })
    if (!dup) kept.push(item)
  }
  return kept
}

/** 字符二元组 Dice 系数（0~1）：完全包含时接近 1，长度差大时低。 */
export function textSimilarity(a: string, b: string): number {
  const norm = (s: string) => s.replace(/\s+/g, '').toLowerCase()
  const x = norm(a)
  const y = norm(b)
  if (!x || !y) return x === y ? 1 : 0
  if (x === y) return 1
  const grams = (s: string): Map<string, number> => {
    const m = new Map<string, number>()
    if (s.length < 2) {
      m.set(s, 1)
      return m
    }
    for (let i = 0; i < s.length - 1; i++) {
      const g = s.slice(i, i + 2)
      m.set(g, (m.get(g) ?? 0) + 1)
    }
    return m
  }
  const ga = grams(x)
  const gb = grams(y)
  let inter = 0
  let total = 0
  for (const [g, n] of ga) {
    total += n
    const other = gb.get(g)
    if (other) inter += Math.min(n, other)
  }
  for (const n of gb.values()) total += n
  return (2 * inter) / total
}

/** 每票每源最多 N 条，按时间倒序保留最新（参考实现 `apply_quota`）。 */
export function applyQuota<T extends { stock: string; source: string; ts: string }>(items: T[], perStock: number): T[] {
  const buckets = new Map<string, T[]>()
  for (const item of items) {
    const k = `${item.stock}\u0000${item.source}`
    const arr = buckets.get(k)
    if (arr) arr.push(item)
    else buckets.set(k, [item])
  }
  const out: T[] = []
  for (const bucket of buckets.values()) {
    bucket.sort((a, b) => (a.ts < b.ts ? 1 : a.ts > b.ts ? -1 : 0))
    out.push(...bucket.slice(0, Math.max(perStock, 0)))
  }
  return out
}

/** 全类语料字符上限，超限按时间倒序截断（参考实现按 token 粗估，这里直接按字符）。 */
export function truncateMaterials<T extends { stock: string; ts: string; title: string; snippet: string }>(
  items: T[],
  maxChars: number,
): T[] {
  let budget = maxChars
  const kept: T[] = []
  const sorted = [...items].sort((a, b) => (a.ts < b.ts ? 1 : a.ts > b.ts ? -1 : 0))
  for (const item of sorted) {
    const cost = Math.max((item.title + item.snippet).length, 1)
    if (budget - cost < 0 && kept.length > 0) break
    budget -= cost
    kept.push(item)
  }
  kept.sort((a, b) => (a.stock === b.stock ? (a.ts < b.ts ? -1 : a.ts > b.ts ? 1 : 0) : a.stock < b.stock ? -1 : 1))
  return kept
}
