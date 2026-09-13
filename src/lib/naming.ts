/**
 * src/lib/naming.ts —— 自挖板块（A2b）的客户端数据层。
 *
 * 两条链路，**刻意分开**：
 *   1. **个股视角（主视角）**：`hist_concept_query`（走已有的 /api/stock-panel/call 内置桥接）
 *      → 这只票属于哪个共动类、最近共动的邻居是谁、相关度多少。
 *      校准结论（`docs/CONCEPT-CALIBRATION.md`）：调好参数后 191 只里仍有 132 只孤立，
 *      所以「今天市场把哪些票当成同一个班」对**具体一只票**最有信息量。
 *   2. **类命名（可选增强）**：POST /api/stock-panel/naming → 让 host 半用 ctx.llm 归纳共同主题。
 *      它可能不可用（无模型）、可能被护栏拒（编造引文）——**都要如实显示原因**，不静默降级。
 *
 * 类型直接从 host 半 `import type`（编译期擦除，不进客户端 bundle），保证两端契约同源。
 */
import { NAMING_ROUTE } from './endpoints'
import { callToolJson } from './stock-data'
import type { NamingResult, NamingGuardConfig } from '@/host/naming/types'

/** 默认聚类参数（host 半在 GET 里给出；这里的值只是首屏兜底）。 */
export const NAMING_PARAMS_FALLBACK = { window: 90, minCorr: 0.6, poolN: 200, windowDays: 5 } as const

export interface NamingParams {
  window: number
  minCorr: number
  poolN: number
  windowDays: number
}

export interface NamingAvailability {
  ok: boolean
  available: boolean
  reason?: string
  provider?: string
  model?: string
  promptVersion?: string
  /** 批量提示词版本（与单类分开：两种问法的结论不共享缓存）。 */
  batchPromptVersion?: string
  defaults?: NamingParams
  guard?: NamingGuardConfig
  /** 批量预算（host 半给出，界面不硬编码）。 */
  batch?: { maxClasses: number; maxMembersPerCall: number }
  cache?: number
  today?: string | null
}

/** 共动邻居（hist_concept_query 的 top-k）。 */
export interface ConceptNeighbor {
  market: string
  code: string
  name: string
  corr: number
  sameClass: boolean
  chgPct?: number | null
}

/** 个股视角的自挖概念结果。 */
export interface StockConcept {
  ok: boolean
  asOf: string
  /** 所属类；null = 孤立票（今天没有稳定的同伴）。 */
  classId: number | null
  classSize: number | null
  intraCorr: number | null
  /** 该票是否在候选池内（成交额榜外 → 不参与聚类，结论不适用）。 */
  inPool: boolean
  /**
   * 弱链伪类标记：`hist_concept_query` 不返回它（只有类列表返回），
   * 因此这里是 null；真正的弱链拒绝由命名接口在命名时给出（`reason: 'weak_chain'`）。
   */
  weakChain: boolean | null
  neighbors: ConceptNeighbor[]
  params: NamingParams
  /** 引擎/参数说明（孤立票、池外、引擎不可用等）。 */
  notes: string[]
}

/** 命名结果（host 半原样回传；拒绝时 `ok:false` + reason）。 */
export type NamingOutcome =
  | {
      ok: true
      result: NamingResult
      members: Array<{ market: string; code: string; name: string; changePct?: number | null }>
      effective: { asOf: string; window: number; minCorr: number; poolN: number; nClasses: number; meanIntraCorr: number | null }
      collectNotes: string[]
      sourcesUsed: string[]
      cached: boolean
    }
  | { ok: false; reason: 'weak_chain' | 'no_class' | 'tdx_unavailable'; classId: number; asOf?: string; note: string }

/**
 * 数值归一：**缺失一律 undefined**。
 *
 * `Number(null)` / `Number('')` 都是 0 —— 直接 `Number()` 会把"没有数据"变成"平盘 0%"，
 * 而这类错误在界面上完全看不出来（只表现为强度/涨幅偏低）。所以先把缺失挡在最前面。
 */
function num(v: unknown): number | undefined {
  if (v === null || v === undefined || v === '') return undefined
  const n = Number(v)
  return Number.isFinite(n) ? n : undefined
}

function str(v: unknown): string {
  return typeof v === 'string' ? v : ''
}

/** GET：命名能力与生效口径（界面据此决定按钮可用态与参数显示）。 */
export async function fetchNamingAvailability(): Promise<NamingAvailability> {
  const res = await fetch(NAMING_ROUTE, { method: 'GET' })
  if (!res.ok) throw new Error(`命名能力探测失败：HTTP ${res.status}`)
  return (await res.json()) as NamingAvailability
}

/** POST：给一个类命名。`refresh=true` 绕过 host 侧缓存（会真的再调一次模型）。 */
export async function requestNaming(args: {
  classId: number
  asOf?: string
  params?: Partial<NamingParams>
  refresh?: boolean
}): Promise<NamingOutcome> {
  const res = await fetch(NAMING_ROUTE, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      classId: args.classId,
      ...(args.asOf !== undefined ? { asOf: args.asOf } : {}),
      ...(args.params ?? {}),
      ...(args.refresh === true ? { refresh: true } : {}),
    }),
  })
  const text = await res.text()
  let parsed: unknown = null
  try {
    parsed = text ? JSON.parse(text) : null
  } catch {
    throw new Error(`命名接口返回非 JSON（HTTP ${res.status}）：${text.slice(0, 200)}`)
  }
  if (parsed === null || typeof parsed !== 'object') throw new Error(`命名接口返回空（HTTP ${res.status}）`)
  const obj = parsed as Record<string, unknown>
  if (obj.ok === false && typeof obj.error === 'string' && obj.reason === undefined) {
    throw new Error(obj.error)
  }
  return obj as unknown as NamingOutcome
}

/**
 * 个股视角：这只票所属的共动类 + 最近共动的邻居。
 *
 * 引擎可能返回 `ok:false`（可用池不足，例如非交易日快照未就绪）——
 * 这里**不抛异常**，而是返回 `ok:false` + notes，让界面显示"引擎当前不可用/池子不足"，
 * 而不是把整块渲染成空白（历史教训：静默 null 最难排查）。
 */
export async function fetchStockConcept(
  market: 'SZ' | 'SH',
  code: string,
  params: NamingParams = NAMING_PARAMS_FALLBACK,
): Promise<StockConcept> {
  const raw = (await callToolJson('hist_concept_query', {
    market,
    code,
    topk: 8,
    window: params.window,
    min_corr: params.minCorr,
    pool_n: params.poolN,
  })) as Record<string, unknown> | null

  const notes: string[] = []
  if (raw === null || raw.ok === false) {
    const err = str((raw as { error?: unknown } | null)?.error) || '引擎未返回结果'
    return {
      ok: false,
      asOf: str((raw as { as_of?: unknown } | null)?.as_of),
      classId: null,
      classSize: null,
      intraCorr: null,
      inPool: false,
      weakChain: null,
      neighbors: [],
      params,
      notes: [err],
    }
  }

  const asOf = str(raw.as_of) || str((raw.meta as Record<string, unknown> | undefined)?.as_of)
  const cls = raw.class as Record<string, unknown> | null | undefined
  const classId = cls && cls.class_id !== undefined ? Number(cls.class_id) : null
  const classSize = cls && cls.size !== undefined ? Number(cls.size) : null
  const intraCorr = cls && cls.mean_intra_corr !== undefined ? Number(cls.mean_intra_corr) : null
  const inPool = raw.in_pool === undefined ? true : Boolean(raw.in_pool)
  if (!inPool) {
    notes.push('该票不在候选池内（全 A 成交额榜外）——聚类结论对它不适用，仅供参考')
  }
  if (classId === null) notes.push('今日无稳定共动同伴（孤立票）：这本身就是信息——它今天没有"班"')

  // 注意字段名是 `peers`（不是 neighbors）：引擎输出的原样字段，不要凭印象改
  const rawNeighbors = Array.isArray(raw.peers) ? raw.peers : []
  const neighbors: ConceptNeighbor[] = []
  for (const n of rawNeighbors as Array<Record<string, unknown>>) {
    const m = str(n.market).toUpperCase()
    if (m !== 'SZ' && m !== 'SH') continue
    neighbors.push({
      market: m,
      code: str(n.code),
      name: str(n.name),
      corr: num(n.corr) ?? 0,
      sameClass: Boolean(n.same_class),
      chgPct: n.chg_pct === undefined ? null : num(n.chg_pct) ?? null,
    })
  }
  return { ok: true, asOf, classId, classSize, intraCorr, inPool, weakChain: null, neighbors, params, notes }
}

/** 命名结论的中文标签（三态 + 降级成因，界面统一口径）。 */
export function verdictLabel(v: string): string {
  switch (v) {
    case 'named':
      return '已命名'
    case 'no_common':
      return '无共同主题'
    default:
      return '素材不足'
  }
}

/** 降级成因中文标签（必须分层显示，否则复盘时无从归因）。 */
export function degradedLabel(reason: string): string {
  switch (reason) {
    case 'no_material':
      return '窗口内没有素材'
    case 'source_skipped':
      return '实时源按设计跳过（as_of 不是当前交易日，不做历史回放）'
    case 'partial_material':
      return '部分成员无素材'
    case 'source_failed':
      return '数据源采集失败'
    case 'llm_unavailable':
      return '模型不可用'
    case 'llm_invalid_json':
      return '模型输出无法解析'
    case 'llm_insufficient':
      return '模型判断依据不足'
    case 'guard_rejected':
      return '证据未通过护栏（含编造引文）'
    default:
      return ''
  }
}

// ─────────────────────────── 类列表（含强度口径） ───────────────────────────

/**
 * 一个类成员（host 半已判好涨停，前端不再自己算 —— 涨停要 `buy_price_limit` 精确判定，
 * 而那张全A快照在 host 侧；前端重算必然与状态带广度漂）。
 */
export interface ConceptMemberRow {
  market: string
  code: string
  name: string
  /** 当日涨跌幅（%，null = 无数据）。 */
  chgPct: number | null
  /** 当日涨停（收盘触及涨停价）。 */
  limitUp: boolean
  /** 与类内其它成员的当日涨幅平均相关（结构指标，不是当日强弱）。 */
  corr: number | null
}

/** 类列表的一行：**结构指标（引擎）+ 当日强弱（host 聚合）**。 */
export interface ConceptClassRow {
  classId: number
  size: number
  intraCorr: number
  strongDensity: number
  weakChain: boolean
  top: string[]
  members: ConceptMemberRow[]
  /** 有当日涨跌幅的成员只数（< size 时界面要标注"仅 N/M 只算过"）。 */
  knownN: number
  chgMean: number | null
  chgMax: number | null
  upN: number
  limitUpN: number
  /** 强度分（口径见 `lib/concept-strength.ts`：均涨幅 + 6×涨停数）。 */
  strength: number
}

export interface ConceptClassesPayload {
  ok: boolean
  asOf: string
  classes: ConceptClassRow[]
  isolatedN: number
  isolatedTop: Array<{ market: string; code: string; name: string; chgPct: number | null; limitUp: boolean }>
  notes: string[]
  params: NamingParams
}

/** 拉类列表（`hist_concept_classes` 已经过 host 半补强度；失败不抛，返回 ok:false + 原因）。 */
export async function fetchConceptClasses(
  params: NamingParams = NAMING_PARAMS_FALLBACK,
  topMembers = 5,
): Promise<ConceptClassesPayload> {
  const raw = (await callToolJson('hist_concept_classes', {
    window: params.window,
    min_corr: params.minCorr,
    pool_n: params.poolN,
    top_members: topMembers,
  })) as Record<string, unknown> | null
  if (raw === null || raw.ok === false) {
    return {
      ok: false,
      asOf: str((raw as { as_of?: unknown } | null)?.as_of),
      classes: [],
      isolatedN: 0,
      isolatedTop: [],
      notes: [str((raw as { error?: unknown } | null)?.error) || '引擎未返回结果'],
      params,
    }
  }
  const classes: ConceptClassRow[] = []
  for (const c of (Array.isArray(raw.classes) ? raw.classes : []) as Array<Record<string, unknown>>) {
    const members: ConceptMemberRow[] = []
    for (const m of (Array.isArray(c.members) ? c.members : []) as Array<Record<string, unknown>>) {
      members.push({
        market: str(m.market).toUpperCase() || 'SZ',
        code: str(m.code),
        name: str(m.name),
        chgPct: num(m.chg_pct) ?? null,
        limitUp: m.limit_up === true,
        corr: num(m.corr) ?? null,
      })
    }
    classes.push({
      classId: Number(c.class_id),
      size: num(c.size) ?? members.length,
      intraCorr: num(c.mean_intra_corr) ?? 0,
      strongDensity: num(c.strong_density) ?? 0,
      weakChain: Boolean(c.weak_chain),
      top: (Array.isArray(c.top) ? c.top : []).map((t) => String(t)),
      members,
      knownN: num(c.known_n) ?? members.filter((m) => m.chgPct !== null).length,
      chgMean: num(c.chg_mean) ?? null,
      chgMax: num(c.chg_max) ?? null,
      upN: num(c.up_n) ?? 0,
      limitUpN: num(c.limit_up_n) ?? members.filter((m) => m.limitUp).length,
      strength: num(c.strength) ?? 0,
    })
  }
  const isolatedTop: ConceptClassesPayload['isolatedTop'] = []
  for (const s of (Array.isArray(raw.isolated_top) ? raw.isolated_top : []) as Array<Record<string, unknown>>) {
    isolatedTop.push({
      market: str(s.market).toUpperCase(),
      code: str(s.code),
      name: str(s.name),
      chgPct: num(s.chg_pct) ?? null,
      limitUp: s.limit_up === true,
    })
  }
  const meta = (raw.meta ?? {}) as Record<string, unknown>
  return {
    ok: true,
    asOf: str(raw.as_of) || str(meta.as_of),
    classes,
    isolatedN: num(raw.isolated_n) ?? 0,
    isolatedTop,
    notes: [],
    params,
  }
}

// ─────────────────────────── 批量命名（类列表默认路径） ───────────────────────────

/** 批量结果里的一组。 */
export interface BatchNamingEntry {
  classId: number
  size: number
  memberCount: number
  members: Array<{ market: string; code: string; name: string; changePct?: number | null }>
  /** 该组的命名结论；null = 本轮没算它（弱链/超上限）。 */
  naming: NamingResult | null
  skipReason?: 'weak_chain' | 'over_cap' | 'not_found'
  cached: boolean
}

export type BatchNamingOutcome =
  | {
      ok: true
      asOf: string
      entries: BatchNamingEntry[]
      effective: { asOf: string; window: number; minCorr: number; poolN: number; nClasses: number; meanIntraCorr: number | null }
      collectNotes: string[]
      sourcesUsed: string[]
      /** 本次真的发起了几次模型调用（0 = 全部命中缓存）。 */
      llmCalls: number
      targetCount: number
      /** 整批直接命中 memo（0 采集 + 0 模型调用）。 */
      memoHit: boolean
      notes: string[]
    }
  | { ok: false; reason: 'tdx_unavailable' | 'no_classes'; note: string }

/**
 * 批量命名（打开类列表时的默认动作）。
 *
 * 与单类的差别只有"问法与批次"：**护栏、缓存、弱链拒绝逐组独立执行**，
 * 所以批量不会让任何一组的结论变松。`refresh=true` 才绕过缓存与整批 memo
 * （会真的再调模型）。
 */
export async function requestBatchNaming(args: {
  classIds?: number[]
  asOf?: string
  params?: Partial<NamingParams>
  refresh?: boolean
} = {}): Promise<BatchNamingOutcome> {
  const res = await fetch(NAMING_ROUTE, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      ...(args.classIds !== undefined ? { classIds: args.classIds } : { all: true }),
      ...(args.asOf !== undefined ? { asOf: args.asOf } : {}),
      ...(args.params ?? {}),
      ...(args.refresh === true ? { refresh: true } : {}),
    }),
  })
  const text = await res.text()
  let parsed: unknown = null
  try {
    parsed = text ? JSON.parse(text) : null
  } catch {
    throw new Error(`批量命名返回非 JSON（HTTP ${res.status}）：${text.slice(0, 200)}`)
  }
  if (parsed === null || typeof parsed !== 'object') throw new Error(`批量命名返回空（HTTP ${res.status}）`)
  const obj = parsed as Record<string, unknown>
  if (obj.ok === false && typeof obj.error === 'string' && obj.reason === undefined) throw new Error(obj.error)
  return obj as unknown as BatchNamingOutcome
}

/**
 * 把批量里的一组包成 `NamingOutcome`，直接喂给 `NamingResultPanel`。
 *
 * 为什么要这层转换：单类与批量的**结论结构必须一致**（三态/证据分/降级成因），
 * 否则展示层会分叉成两套（一处显示证据分、一处忘了成因），而"看起来差不多"的报告
 * 正是最容易让人误信的那种。
 */
export function entryOutcome(batch: BatchNamingOutcome & { ok: true }, entry: BatchNamingEntry): NamingOutcome | null {
  if (entry.naming === null) return null
  return {
    ok: true,
    result: entry.naming,
    members: entry.members,
    effective: batch.effective,
    collectNotes: batch.collectNotes,
    sourcesUsed: batch.sourcesUsed,
    cached: entry.cached,
  }
}
