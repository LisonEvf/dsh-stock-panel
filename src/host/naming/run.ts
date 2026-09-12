/**
 * src/host/naming/run.ts —— 命名编排（A2b-②，移植自 `cluster-namer/pipeline.py` 的主链路）。
 *
 * 链路：[1] 取类的成员 → [2][3] 采素材并归一 → [4] 模型归纳 → [5] 护栏 → 缓存。
 * 参考实现里 [6] 差异对照（官方花名册）与 [7] 报告落盘**不在 v0 范围**（ROADMAP A2b 已定）。
 *
 * 三条硬规则（都是被真实 bug 逼出来的，照搬）：
 *   1. **弱链伪类不命名**：`weak_chain=true` 的类在本地校准里类内相关只有 0.008（≈噪声），
 *      给它起名字等于给噪声编故事。直接拒绝，并把原因回给 UI（不是静默返回空）。
 *   2. **缓存带指纹**：换模型/窗口/源集合/提示词/阈值即失效（`fingerprint.ts`）。
 *   3. **缓存只在此进程内存里**：命名是"当天这一次会话"的产物，跨进程持久化要新增一张表 +
 *      版本迁移；在拿到真实使用反馈前不引入这个复杂度。命中时不产生第二次 LLM 调用
 *      （ROADMAP A2b 验收锚点 ④ 说的就是这个）。
 *
 * 依赖全部注入（`callTool` / `llm` / `route`），所以整条链路可以在离线单测里跑通。
 */
import { DEFAULT_NAMING_GUARD, type NamingGuardConfig, type NamingMember, type NamingResult, type MaterialWindow } from './types'
import { applyGuards, degradedResult } from './guard'
import { buildUserPrompt, NAMING_SYSTEM_PROMPT } from './prompt'
import { parseLlmJson } from './parse'
import { namingFingerprint, NAMING_PROMPT_VERSION } from './fingerprint'
import { collectMaterials, DEFAULT_COLLECT, SOURCE_BOARD, SOURCE_KLINE, SOURCE_MONITOR, SOURCE_UNUSUAL, type CollectResult } from './collect'

/** 最小 LLM 形状（与 host-ai 的 MinimalLlm 同构；此处本地声明避免循环依赖）。 */
export interface NamingLlm {
  stream(options: {
    provider: string
    model: string
    messages: unknown[]
    system?: string
    maxTokens?: number
    signal?: AbortSignal
  }): AsyncIterable<{ type?: string; text?: string; reason?: { kind?: string; failure?: { message?: string } } }>
}

/** 命名运行时依赖。 */
export interface NamingRuntime {
  callTool: (name: string, args: Record<string, unknown>) => Promise<unknown>
  /** LLM（缺省 = 不可用 → 结果降级为 `llm_unavailable`，不是抛异常）。 */
  llm?: NamingLlm | undefined
  /** 模型路由（缺省 = 不可用）。 */
  route?: { provider: string; model: string } | undefined
  /** 当前交易日（YYYY-MM-DD）；未知时实时源不采。 */
  today?: string | undefined
  /**
   * 惰性刷新当前交易日（host 半用 `server_info` 取）。
   * 为什么单独给一个异步钩子：`today` 决定"实时源能否代表 as_of"，而取它要发一次数据层调用；
   * 编织进同步的 runtime 对象会让首次请求必然拿到 undefined（于是白白少采一类素材）。
   */
  ensureToday?: (() => Promise<string | undefined>) | undefined
  /** 护栏阈值（默认 `DEFAULT_NAMING_GUARD`）。 */
  guard?: NamingGuardConfig | undefined
}

/** 默认聚类参数（= `docs/CONCEPT-CALIBRATION.md` 的推荐值：0.6 / 90 / 200）。 */
export const DEFAULT_NAMING_PARAMS = {
  window: 90,
  minCorr: 0.6,
  poolN: 200,
  windowDays: 5,
} as const

export interface NameClassArgs {
  classId: number
  /** 想要的 as_of（引擎可能按数据可用性回退，结果里以引擎返回的为准）。 */
  asOf?: string | undefined
  window?: number | undefined
  minCorr?: number | undefined
  poolN?: number | undefined
  /** 素材时间窗天数（自然日）。 */
  windowDays?: number | undefined
  /** 忽略缓存重算。 */
  refresh?: boolean | undefined
}

/** 拒绝原因（不是 NamingResult：这些情况压根不该产生"结论"）。 */
export type NameClassRejection =
  | { ok: false; reason: 'weak_chain'; classId: number; asOf: string; note: string }
  | { ok: false; reason: 'no_class'; classId: number; asOf: string; note: string }
  | { ok: false; reason: 'tdx_unavailable'; classId: number; note: string }

export interface NameClassSuccess {
  ok: true
  result: NamingResult
  /** 成员票（UI 直接渲染，不用二次取数）。 */
  members: NamingMember[]
  /** 引擎返回的实际 as_of 与生效参数（UI 必须展示：同票不同参数所属类不同，不标=不可复现）。 */
  effective: { asOf: string; window: number; minCorr: number; poolN: number; nClasses: number; meanIntraCorr: number | null }
  /** 采集说明（含口径偏差）。 */
  collectNotes: string[]
  /** 素材来源。 */
  sourcesUsed: string[]
  /** 是否命中缓存（命中 = 没有发生 LLM 调用）。 */
  cached: boolean
}

export type NameClassOutcome = NameClassSuccess | NameClassRejection

/** 进程内命名缓存：key = asOf:classId:fingerprint。 */
const cache = new Map<string, NameClassSuccess>()

/** 缓存统计（诊断用）。 */
export function namingCacheStats(): { size: number; keys: string[] } {
  return { size: cache.size, keys: [...cache.keys()] }
}

export function clearNamingCache(): void {
  cache.clear()
}

/** 引擎返回的类成员行（字段按不可信处理）。 */
interface ClassMemberRow {
  market?: unknown
  code?: unknown
  name?: unknown
  chg_pct?: unknown
}

function asMember(row: ClassMemberRow): NamingMember | null {
  const market = String(row.market ?? '').toUpperCase()
  const code = String(row.code ?? '').trim()
  const name = String(row.name ?? '').trim()
  if ((market !== 'SH' && market !== 'SZ' && market !== 'BJ') || !code) return null
  const pct = Number(row.chg_pct)
  return { market: market as NamingMember['market'], code, name: name || code, changePct: Number.isFinite(pct) ? pct : null }
}

/** 单次模型调用：只收集正文（思考内容丢弃——命名任务不看过程）。 */
async function callNamingLlm(
  llm: NamingLlm,
  route: { provider: string; model: string },
  system: string,
  user: string,
  signal: AbortSignal,
): Promise<{ text: string; error?: string; finishKind: string }> {
  let text = ''
  let finishKind = ''
  try {
    const stream = llm.stream({
      provider: route.provider,
      model: route.model,
      system,
      messages: [
        {
          id: `naming-${Date.now().toString(36)}`,
          role: 'user',
          content: [{ type: 'text', text: user }],
          source: { kind: 'plugin', plugin: '@lisonevf/dsh-stock-panel' },
        },
      ],
      maxTokens: 4000,
      signal,
    })
    for await (const chunk of stream) {
      if (chunk === null || typeof chunk !== 'object') continue
      if (chunk.type === 'text-delta' && typeof chunk.text === 'string') text += chunk.text
      else if (chunk.type === 'finish') finishKind = chunk.reason?.kind ?? ''
    }
  } catch (err) {
    return { text, finishKind, error: (err as Error)?.message ?? String(err) }
  }
  return { text, finishKind }
}

/** 命名是否可用（UI 据此置灰按钮并给出原因）。 */
export function namingAvailability(rt: NamingRuntime): { available: boolean; reason?: string; provider?: string; model?: string } {
  if (rt.llm === undefined) return { available: false, reason: 'ctx.llm 不可用（宿主未挂载 LLM 服务）' }
  if (rt.route === undefined) return { available: false, reason: '无默认模型路由（未挂载 dsh-agent-default-model 且无兜底配置）' }
  return { available: true, provider: rt.route.provider, model: rt.route.model }
}

/**
 * 给一个自挖类命名。
 *
 * 任何一步失败都**返回结构化结果**而不是抛异常：命名是可选增强，
 * 它坏掉不该让「个股视角」整块白屏（同 AI 直调的立场）。
 */
export async function nameClass(rt: NamingRuntime, args: NameClassArgs): Promise<NameClassOutcome> {
  const params = {
    window: args.window ?? DEFAULT_NAMING_PARAMS.window,
    minCorr: args.minCorr ?? DEFAULT_NAMING_PARAMS.minCorr,
    poolN: args.poolN ?? DEFAULT_NAMING_PARAMS.poolN,
  }
  const windowDays = args.windowDays ?? DEFAULT_NAMING_PARAMS.windowDays
  const guard = rt.guard ?? DEFAULT_NAMING_GUARD

  // ---- [1] 类的成员 ----
  let detail: Record<string, unknown>
  try {
    detail = (await rt.callTool('hist_concept_class', {
      class_id: args.classId,
      ...(args.asOf !== undefined ? { as_of: args.asOf } : {}),
      window: params.window,
      min_corr: params.minCorr,
      pool_n: params.poolN,
    })) as Record<string, unknown>
  } catch (err) {
    return { ok: false, reason: 'tdx_unavailable', classId: args.classId, note: (err as Error)?.message ?? String(err) }
  }
  if (detail === null || typeof detail !== 'object' || detail.ok === false) {
    const note = String((detail as { error?: unknown } | null)?.error ?? '引擎未返回该类')
    return { ok: false, reason: 'no_class', classId: args.classId, asOf: String(args.asOf ?? ''), note }
  }
  const rawMembers = Array.isArray(detail.members) ? (detail.members as ClassMemberRow[]) : []
  const members = rawMembers.map(asMember).filter((m): m is NamingMember => m !== null)
  if (members.length === 0) {
    return { ok: false, reason: 'no_class', classId: args.classId, asOf: String(args.asOf ?? ''), note: '该类没有可用成员（引擎返回空）' }
  }
  const meta = (detail.meta ?? {}) as Record<string, unknown>
  const asOf = String(detail.as_of ?? meta.as_of ?? args.asOf ?? '')
  if (!asOf) {
    return { ok: false, reason: 'no_class', classId: args.classId, asOf: '', note: '引擎未给出 as_of（无法标注口径，拒绝命名）' }
  }

  // ---- [1b] 弱链伪类：拒绝命名（校准结论：类内相关 ≈0.008，不采信）----
  const weak = await weakChainOf(rt, args.classId, asOf, params)
  if (weak === true) {
    return {
      ok: false,
      reason: 'weak_chain',
      classId: args.classId,
      asOf,
      note: '该类是阈值图弱链伪类（类内相关远低于阈值）——校准结论：不采信，也不命名',
    }
  }

  // ---- [2][3] 采集 + 归一 ----
  const today = rt.ensureToday !== undefined ? ((await rt.ensureToday()) ?? rt.today) : rt.today
  const collect: CollectResult = await collectMaterials(
    { callTool: rt.callTool, today },
    { asOf, members, windowDays },
  )

  // ---- 指纹 + 缓存 ----
  const route = rt.route ?? { provider: 'none', model: 'none' }
  const fingerprint = namingFingerprint({
    provider: route.provider,
    model: route.model,
    clientVersion: rt.llm === undefined ? '' : 'ctx.llm',
    windowDays,
    sources: collect.sourcesUsed,
    promptVersion: NAMING_PROMPT_VERSION,
    guard: {
      minEvidenceItems: guard.minEvidenceItems,
      minHitMembers: guard.minHitMembers,
      minCoverage: guard.minCoverage,
      minEvidenceScore: guard.minEvidenceScore,
      enforceEvidenceWindow: guard.enforceEvidenceWindow,
    },
  })
  const cacheKey = `${asOf}:${args.classId}:${fingerprint}`
  if (args.refresh !== true) {
    const hit = cache.get(cacheKey)
    if (hit !== undefined) return { ...hit, cached: true }
  }

  const window: MaterialWindow = { end: asOf, days: windowDays }
  const effective = {
    asOf,
    window: params.window,
    minCorr: params.minCorr,
    poolN: params.poolN,
    nClasses: Number(meta.n_classes ?? 0) || 0,
    meanIntraCorr: Number.isFinite(Number(detail.class ? (detail.class as Record<string, unknown>).mean_intra_corr : NaN))
      ? Number((detail.class as Record<string, unknown>).mean_intra_corr)
      : null,
  }
  const notes = [...collect.notes]

  /** 组装成功结果（统一走缓存写入，避免漏写）。 */
  const finish = (result: NamingResult): NameClassSuccess => {
    const payload: NameClassSuccess = {
      ok: true,
      result: { ...result, fingerprint },
      members,
      effective,
      collectNotes: notes,
      sourcesUsed: collect.sourcesUsed,
      cached: false,
    }
    cache.set(cacheKey, payload)
    return payload
  }

  // ---- [4] 模型归纳 ----
  const avail = namingAvailability(rt)
  if (!avail.available) {
    return finish(
      degradedResult({
        classId: args.classId,
        asOf,
        corpus: collect.corpus,
        window,
        modelVersion: 'none',
        fingerprint,
        reason: 'llm_unavailable',
        note: `模型不可用：${avail.reason ?? '未知原因'}——素材已采好，可人工命名`,
      }),
    )
  }

  const prompt = buildUserPrompt({ classId: args.classId, asOf, members, corpus: collect.corpus, window })
  const ac = new AbortController()
  const timer = setTimeout(() => ac.abort(), 90_000)
  let out: { text: string; error?: string; finishKind: string }
  try {
    out = await callNamingLlm(rt.llm as NamingLlm, route, NAMING_SYSTEM_PROMPT, prompt, ac.signal)
  } finally {
    clearTimeout(timer)
  }
  if (out.error !== undefined) {
    return finish(
      degradedResult({
        classId: args.classId,
        asOf,
        corpus: collect.corpus,
        window,
        modelVersion: route.model,
        fingerprint,
        reason: 'llm_unavailable',
        note: `模型调用失败：${out.error}`,
      }),
    )
  }

  const parsed = parseLlmJson(out.text)
  if (parsed.raw === null) {
    // 原文必须保留（供人抽查"模型到底说了什么"），但**不**据此下结论
    return finish(
      degradedResult({
        classId: args.classId,
        asOf,
        corpus: collect.corpus,
        window,
        modelVersion: route.model,
        fingerprint,
        reason: 'llm_invalid_json',
        note: `模型输出无法解析：${parsed.error}｜原文(截断)：${out.text.slice(0, 500)}`,
      }),
    )
  }

  // ---- [5] 护栏 ----
  const result = applyGuards({
    raw: parsed.raw,
    classId: args.classId,
    asOf,
    memberLabels: members.map((m) => `${m.code} ${m.name}`),
    corpus: collect.corpus,
    window,
    cfg: guard,
    modelVersion: route.model,
    fingerprint,
    sourceFailed: collect.corpus.missingSources.length > 0,
  })
  return finish(result)
}

/** 该类的 weak_chain 标记（取不到就当作"未知"→ 不拦，由证据门槛兜）。 */
async function weakChainOf(
  rt: NamingRuntime,
  classId: number,
  asOf: string,
  params: { window: number; minCorr: number; poolN: number },
): Promise<boolean | null> {
  try {
    const list = (await rt.callTool('hist_concept_classes', {
      as_of: asOf,
      window: params.window,
      min_corr: params.minCorr,
      pool_n: params.poolN,
      top_members: 1,
    })) as { classes?: Array<{ class_id?: unknown; weak_chain?: unknown }> } | null
    const hit = (list?.classes ?? []).find((c) => Number(c.class_id) === classId)
    return hit === undefined ? null : Boolean(hit.weak_chain)
  } catch {
    return null
  }
}

/** 素材源清单（进指纹与诊断，导出便于冒烟断言）。 */
export const NAMING_SOURCES = [SOURCE_UNUSUAL, SOURCE_MONITOR, SOURCE_BOARD, SOURCE_KLINE] as const
/** 采集参数（导出便于冒烟断言）。 */
export { DEFAULT_COLLECT }
