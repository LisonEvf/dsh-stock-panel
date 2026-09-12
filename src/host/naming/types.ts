/**
 * src/host/naming/types.ts —— 自挖类「命名」阶段的契约（A2b）。
 *
 * 口径来源：`cluster-namer`（Python 参考实现）的 `schema.py` / `guard.py` / `llm.py`，
 * 逐字段对齐，只做与本站数据层有关的适配（板块类型是数字码、异动是市场级列表）：
 *
 *   · **三态结论**：`named / no_common / insufficient` —— 「允许说没共性」是核心立场，
 *     「强行编一个主题」比「说不知道」危害大得多（参考实现 docs/04）；
 *   · **降级成因必须分层**（`degraded_reason`）：素材本来就没有 / 源失败 / LLM 不可用 /
 *     LLM 输出畸形 / LLM 判不足 / 部分成员无素材 / 被护栏拒。
 *     绝不允许出现「判定=素材不足、成因=none」这种无从归因的行；
 *   · **门控用可计算指标**（`evidence_score`），LLM 自报 `confidence` 只作展示排序 ——
 *     自报置信度不是一个可校准的概率（参考实现 docs/08 A5）。
 *
 * 命名不写进任何既有结论：它只是「市场今天把这几只票当成一个班」的一个候选标签，
 * 供人复盘时参考（ROADMAP A2b 验收锚点 ⑤）。
 */

/** 结论三态。 */
export type NamingVerdict = 'named' | 'no_common' | 'insufficient'

/** 降级成因（分层，不留 none）。 */
export type DegradedReason =
  | 'none' // 正常（named）
  | 'no_material' // 窗口内本来就没素材
  | 'source_failed' // 源采集失败
  | 'llm_unavailable' // LLM 不可用（宿主未挂载 / 调用失败）
  | 'llm_invalid_json' // LLM 输出无法解析
  | 'llm_insufficient' // 素材齐全，但模型判断不足以归纳
  | 'partial_material' // 部分成员票窗口内没有素材
  | 'guard_rejected' // 过了模型但被护栏拒（幻觉引文 / 证据不足 / 时间错位）

/** 素材类型。 */
export type MaterialKind =
  | 'unusual' // 异动（加速拉升/封涨停板/打开涨停…）
  | 'limit_up_type' // 封板状态（一字板/T字板/换手板/炸板…）
  | 'board_concept' // 概念板块（当日题材线索）
  | 'board_industry' // 行业板块（官方花名册口径，v0 不作对照，仅入语料供参照）

/** 归一后的素材条目（对应参考实现 `NewsItem`）。 */
export interface MaterialItem {
  /** 成员标注：`600000 浦发银行`（与命名结果里的 stock 字段同一口径）。 */
  stock: string
  /** 市场+代码，用于回查成员。 */
  key: string
  source: string
  /** `YYYY-MM-DD HH:mm`（日期部分是护栏的判定依据）。 */
  ts: string
  title: string
  snippet: string
  kind: MaterialKind
}

/** 素材文本（引文反查的比较对象）。 */
export function materialText(i: MaterialItem): string {
  return `${i.title} ${i.snippet}`.trim()
}

/** 通过反查的证据（对应参考实现 `Evidence`）。 */
export interface NamingEvidence {
  stock: string
  source: string
  /** 逐字取自素材的引文（已反查通过）。 */
  quote: string
  /** **来自素材**的时间戳（不信模型自报）。 */
  ts: string
  /** 是否落在素材时间窗内（窗口外的证据不计入门控）。 */
  inWindow: boolean
}

/** 类成员（对应参考实现 `Member`）。 */
export interface NamingMember {
  market: 'SH' | 'SZ' | 'BJ'
  code: string
  name: string
  /** 当日涨跌幅（%，可为空）。 */
  changePct?: number | null
}

export function memberKey(m: { market: string; code: string }): string {
  return `${m.market}${m.code}`
}

export function memberLabel(m: { code: string; name: string }): string {
  return `${m.code} ${m.name}`
}

/** 时间窗（对应参考实现 `DateWindow`；**按自然日**，与参考实现一致）。 */
export interface MaterialWindow {
  /** 窗口末日（= 类的 as_of）。 */
  end: string // YYYY-MM-DD
  /** 窗口天数（含末日）。 */
  days: number
}

export function windowStart(w: MaterialWindow): string {
  const d = parseDate(w.end)
  if (!d) return w.end
  d.setDate(d.getDate() - Math.max(w.days - 1, 0))
  return fmtDate(d)
}

export function windowDates(w: MaterialWindow): string[] {
  const d = parseDate(w.end)
  if (!d) return []
  const n = Math.max(w.days, 1)
  const out: string[] = []
  for (let i = n - 1; i >= 0; i--) {
    const x = new Date(d.getTime())
    x.setDate(x.getDate() - i)
    out.push(fmtDate(x))
  }
  return out
}

export function windowContains(w: MaterialWindow, isoDate: string): boolean {
  const s = windowStart(w)
  return isoDate >= s && isoDate <= w.end
}

/** 本地日历日的 YYYY-MM-DD（与 as_of 同口径，避免 UTC 偏移）。 */
export function fmtDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export function parseDate(iso: string | undefined | null): Date | null {
  if (!iso) return null
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso).trim())
  if (!m) return null
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
  return Number.isNaN(d.getTime()) ? null : d
}

/** 时间戳 → 日期部分（`YYYY-MM-DD HH:mm` → `YYYY-MM-DD`）。 */
export function tsDate(ts: string | undefined | null): string | null {
  if (!ts) return null
  const head = String(ts).trim().split(/\s+/)[0]
  return parseDate(head) ? head : null
}

/** 护栏阈值（对应参考实现 `GuardConfig`；全部可配，不得硬编码为"真理"）。 */
export interface NamingGuardConfig {
  /** `named` 至少要这么多**有效**证据条。 */
  minEvidenceItems: number
  /** `named` 至少要命中这么多**不同**票。 */
  minHitMembers: number
  /** `named` 的最低覆盖度（命中票数 / 成员数）。 */
  minCoverage: number
  /** 可计算证据分下限（真正的门控）。 */
  minEvidenceScore: number
  /** 是否要求 `named` 必须有有效证据。 */
  requireEvidence: boolean
  /** 是否把窗口外证据排除出门控。 */
  enforceEvidenceWindow: boolean
  /** LLM 自报置信度**只作提示**，不参与降级（保留字段便于对照）。 */
  minConfidence: number
}

export const DEFAULT_NAMING_GUARD: NamingGuardConfig = {
  minEvidenceItems: 2,
  minHitMembers: 2,
  minCoverage: 0.5,
  minEvidenceScore: 0.6,
  requireEvidence: true,
  enforceEvidenceWindow: true,
  minConfidence: 0.6,
}

/** 命名结果（对应参考实现 `NamingResult`）。 */
export interface NamingResult {
  classId: number
  asOf: string
  verdict: NamingVerdict
  /** 仅 `named` 时非空。 */
  theme: string | null
  /** 模型自报置信度：只用于展示/排序。 */
  confidence: number | null
  evidenceScore: number
  evidenceCoverage: number
  evidenceInWindow: number
  evidenceCount: number
  alternatives: string[]
  evidence: NamingEvidence[]
  reasoning: string
  missingSources: string[]
  degradedReason: DegradedReason
  guardNotes: string[]
  /** 缓存指纹（换模型/窗口/源集合即失效）。 */
  fingerprint: string
  modelVersion: string
  windowDays: number
  /** 素材条数（含未通过反查的）——用于诊断"到底是没素材还是没证据"。 */
  materialCount: number
  cached?: boolean
}

/** 语料（对应参考实现 `Corpus`）。 */
export interface MaterialCorpus {
  items: MaterialItem[]
  /** 采集失败的源名（去重排序）。 */
  missingSources: string[]
  /** 采集失败的成员 key（去重排序）。 */
  failedStocks: string[]
}

export const EMPTY_CORPUS: MaterialCorpus = { items: [], missingSources: [], failedStocks: [] }

/** 素材按成员分组（key = `${code} ${name}`，与 `stock` 字段同口径）。 */
export function groupByStock(items: MaterialItem[]): Map<string, MaterialItem[]> {
  const m = new Map<string, MaterialItem[]>()
  for (const it of items) {
    const arr = m.get(it.stock)
    if (arr) arr.push(it)
    else m.set(it.stock, [it])
  }
  return m
}
