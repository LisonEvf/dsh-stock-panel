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
  defaults?: NamingParams
  guard?: NamingGuardConfig
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

function num(v: unknown): number | undefined {
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
