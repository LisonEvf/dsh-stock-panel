/**
 * src/lib/concept-strength.ts —— 自挖类的「强度」口径（host/client 共用，**纯函数**）。
 *
 * ## 为什么单独立一个口径模块
 *
 * 类列表要干三件事：**按强度排序**、行内显示**涨幅**与**涨停数**、并让用户看懂排序凭什么。
 * 三件事必须是**同一个口径**——排序用的数和显示的数不是一回事时，用户会看到
 * "排在前面的均涨幅更低"这种无法解释的列表，然后不再相信这个页面的任何数字。
 * 所以：host 半算好（`host/hist-data.ts` 用引擎成员 + 全A快照），client 只负责渲染与排序，
 * 且计算本身是这里的纯函数 —— 能在 `tests/concept-strength.test.ts` 里逐条钉住。
 *
 * ## 口径（都用**当日**行情，与 K 线窗口无关）
 *
 * | 字段 | 口径 |
 * | --- | --- |
 * | `chgMean` | 成员当日涨跌幅的均值（缺失值不计入，另给 `knownN` 告知"几只算过"） |
 * | `chgMax` | 成员当日最大涨幅（"这个班的龙头跑了多少"） |
 * | `upN` | 上涨只数（含涨停） |
 * | `limitUpN` | **涨停只数**：收盘价触及涨停价（`buy_price_limit` 精确判定，与状态带广度同法） |
 * | `strength` | `chgMean + STRENGTH_LIMIT_UP_WEIGHT × limitUpN` |
 *
 * ## 强度分为什么长这样
 *
 * 盯盘时"这个班猛不猛"由两件事决定：**整体在涨**（均涨幅）与**有没有封板**（涨停数）。
 * 涨停在当日是最强的单点信号，所以每只涨停在均涨幅**之外再加 6 个点**（不是取代那只票的涨幅）：
 *
 *   · 2 只票「1 只涨停（+10%）+ 1 只平」→ 5 + 6 = **11 分**，排在「2 只都 +7%」（7 分）之前；
 *   · 但「全员 +12%」这种普涨大阳线（12 分）又能反超它 —— 权重不是"涨停压倒一切"。
 *
 * 权重是**可调常数**（不是"看起来合理的小数"）：改它必须同时改本注释与
 * `tests/concept-strength.test.ts` 的断言，否则就是偷偷改了排序语义。
 *
 * 缺失值一律**如实留空**（`knownN < n` 时在界面标注"仅 N/M 只算过"），不拿 0 顶替 ——
 * 停牌/无数据被当成"平盘"会让强度虚低，那是最难发现的一类错误。
 *
 * 数值**只存原值**（不做四舍五入）：精度是展示层的事（界面统一 `toFixed(2)`），
 * 在这里预先取整会让"显示的数"与"排序用的数"变成两个东西 —— 正是本文件开头要避免的事。
 */

/** 成员行的当日事实（host 半由引擎成员 + 全A快照组装）。 */
export interface ConceptMemberStat {
  market: string
  code: string
  name: string
  /** 当日涨跌幅（%，null = 没有数据，不按 0 处理）。 */
  chgPct: number | null
  /** 是否涨停（见 `isLimitUpClose`）。 */
  limitUp: boolean
}

/** 类级强度聚合（进类列表 payload，UI 直接渲染）。 */
export interface ConceptAggregate {
  /** 成员总数（引擎给的类规模）。 */
  n: number
  /** 有当日涨跌幅的成员只数（< n 时界面必须标注）。 */
  knownN: number
  /** 均涨幅（%）；一只都没数据时为 null。 */
  chgMean: number | null
  /** 最大涨幅（%）。 */
  chgMax: number | null
  /** 上涨只数。 */
  upN: number
  /** 涨停只数。 */
  limitUpN: number
  /** 强度分（越大越强，用于排序与展示）。 */
  strength: number
}

/** 每只涨停在强度分里折算几个百分点（见文件头"强度分为什么长这样"）。 */
export const STRENGTH_LIMIT_UP_WEIGHT = 6

/** 涨停价的浮点容差：价来自 TDX float32，等值比较必须带容差。 */
const PRICE_EPS = 5e-3

/**
 * 涨停判定：**收盘价触及涨停价**。
 *
 * 为什么必须用 `buy_price_limit` 而不是"涨幅 ≥9.8%"：各板幅度不同（主板 10 / 创业科创 20 /
 * 北交所 30 / ST 5），阈值法必然误判一批。与状态带广度用的是同一条规则
 * （`lib/market.ts` 的 `computeBreadth`）。
 *
 * 为什么**不做**阈值兜底：`buy_price_limit = 0` 出现在新股/无涨跌幅限制的票上
 * （实测：上市首日的票涨停价为 0），那些票本来就"没有涨停"这个概念 ——
 * 兜底会把一只涨 400% 的新股算成涨停，凭空造出一个最强的班。
 */
export function isLimitUpClose(close: unknown, buyPriceLimit: unknown): boolean {
  const c = Number(close)
  const lim = Number(buyPriceLimit)
  if (!Number.isFinite(c) || !Number.isFinite(lim) || lim <= 0 || c <= 0) return false
  return Math.abs(c - lim) <= PRICE_EPS
}

/** 按成员当日事实聚合出类级强度（数值保持原值，取整是展示层的事）。 */
export function aggregateConcept(members: ConceptMemberStat[]): ConceptAggregate {
  const known = members.filter((m) => m.chgPct !== null && Number.isFinite(m.chgPct))
  const pcts = known.map((m) => m.chgPct as number)
  const limitUpN = members.filter((m) => m.limitUp).length
  const chgMean = pcts.length > 0 ? pcts.reduce((a, b) => a + b, 0) / pcts.length : null
  const chgMax = pcts.length > 0 ? Math.max(...pcts) : null
  return {
    n: members.length,
    knownN: pcts.length,
    chgMean,
    chgMax,
    upN: pcts.filter((p) => p > 0).length,
    limitUpN,
    // 均涨幅缺失（整类无数据）时只用涨停数计分：宁可给出"只有板"的强度，也不要 null 排序键
    strength: (chgMean ?? 0) + STRENGTH_LIMIT_UP_WEIGHT * limitUpN,
  }
}

/**
 * 数值归一：**缺失一律 null**。
 *
 * 为什么单独写：`Number(null)` 是 0、`Number('')` 也是 0 —— 直接 `Number()` 会把
 * "没有数据"悄悄变成"平盘 0%"，于是停牌票把强度分往下拽，而且界面上看不出任何异常。
 * 这正是本文件开头强调的那类错误，所以判定必须在最前面拦住它。
 */
function numOrNull(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

/**
 * 引擎成员行 + 全A快照行情 → 成员事实（**纯函数**，字段一律按不可信处理）。
 *
 * 为什么把它抽到这里而不是留在 host：
 *   1. 这是"当日强弱"这条链路上**最容易悄悄错**的一段（市场码 0/1/2 与 SH/SZ/BJ 两套编码、
 *      float32 价格、涨停价缺失）；错的表现只是"涨停数偏小"，不报错；
 *   2. 抽成纯函数就能在 `tests/concept-strength.test.ts` 里逐条钉住，不必起 TDX 引擎。
 *
 * `quoteOf` 返回该代码在全A快照里的原始行（要 `close` 与 `buy_price_limit`）。
 */
export function memberStatsOf(
  rows: ReadonlyArray<Record<string, unknown>>,
  quoteOf: (code: string) => Record<string, unknown> | undefined,
): Array<ConceptMemberStat & { corr: number | null }> {
  const out: Array<ConceptMemberStat & { corr: number | null }> = []
  for (const row of rows) {
    if (row === null || typeof row !== 'object') continue
    const code = String(row.code ?? '').trim()
    if (code === '') continue
    const quote = quoteOf(code)
    out.push({
      market: marketTagOf(row.market),
      code,
      name: String(row.name ?? '') || code,
      chgPct: numOrNull(row.chg_pct),
      limitUp: isLimitUpClose(quote?.close, quote?.buy_price_limit),
      corr: numOrNull(row.mean_corr_to_class),
    })
  }
  return out
}

/**
 * 市场编码归一：引擎用 `0/1/2`（SZ/SH/BJ），界面与命名链路用 `'SZ'/'SH'/'BJ'`。
 * 认不出来的一律当 `SZ`（与引擎默认一致），**不猜**成别的市场。
 */
export function marketTagOf(v: unknown): string {
  if (typeof v === 'string') {
    const s = v.trim().toUpperCase()
    if (s === 'SH' || s === 'SZ' || s === 'BJ') return s
  }
  const n = Number(v)
  if (n === 1) return 'SH'
  if (n === 2) return 'BJ'
  return 'SZ'
}

/** 排序所需的最小形状（类行）。 */
export interface StrengthSortable {
  classId: number
  strength: number
  /** 强边密度（类内强边占比）——并列时的第一顺位依据：结构越紧，越像"一个班"。 */
  strongDensity?: number
  /** 类内平均相关。 */
  intraCorr?: number
  /** 类规模。 */
  size?: number
}

/**
 * 强度降序排序（并列时：强边密度 → 类内相关 → 规模 → classId）。
 *
 * 为什么并列要看结构：两只票同涨也可以只是"市场一起涨"。强边密度高说明类内**互相**相关，
 * 那才是"同一个班"；所以强度相同时优先结构更紧的类，而不是回到引擎给的分量顺序。
 */
export function compareByStrength(a: StrengthSortable, b: StrengthSortable): number {
  if (b.strength !== a.strength) return b.strength - a.strength
  const sd = (b.strongDensity ?? 0) - (a.strongDensity ?? 0)
  if (Math.abs(sd) > 1e-9) return sd
  const ic = (b.intraCorr ?? 0) - (a.intraCorr ?? 0)
  if (Math.abs(ic) > 1e-9) return ic
  const sz = (b.size ?? 0) - (a.size ?? 0)
  if (sz !== 0) return sz
  return a.classId - b.classId
}

/** 强度分的中文解释（界面 tooltip 与文档共用一份文案，避免两处漂）。 */
export function strengthFormulaText(): string {
  return `强度 = 均涨幅% + ${STRENGTH_LIMIT_UP_WEIGHT}×涨停数（每只涨停按 ${STRENGTH_LIMIT_UP_WEIGHT} 个点折算；并列时看强边密度 → 类内相关 → 规模）`
}
