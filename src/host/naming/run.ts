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
import { buildBatchPrompt, buildUserPrompt, NAMING_BATCH_SYSTEM_PROMPT, NAMING_SYSTEM_PROMPT } from './prompt'
import { extractBatchResults, parseLlmJson } from './parse'
import { hasStatus } from './cause'
import { namingFingerprint, NAMING_BATCH_PROMPT_VERSION, NAMING_PROMPT_VERSION } from './fingerprint'
import { collectMaterials, DEFAULT_COLLECT, SOURCE_BOARD, SOURCE_KLINE, SOURCE_MONITOR, SOURCE_UNUSUAL, type CollectResult } from './collect'
import { SOURCE_NEWS, type NewsFetchDeps } from './news'

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
  /**
   * 板块级快讯源依赖（见 `collect.ts` 的 `CollectDeps.news`）。
   * 不传 = 生产默认（用全局 fetch 抓新浪 7×24）；`false` = 关闭（离线测试必须传）。
   */
  news?: NewsFetchDeps | false | undefined
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
    { callTool: rt.callTool, today, news: rt.news },
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
    sourceFailed: hasStatus(collect.corpus.sources, 'failed'),
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
export const NAMING_SOURCES = [SOURCE_UNUSUAL, SOURCE_MONITOR, SOURCE_BOARD, SOURCE_KLINE, SOURCE_NEWS] as const
/** 采集参数（导出便于冒烟断言）。 */
export { DEFAULT_COLLECT }

// ─────────────────────────── 批量命名（类列表默认路径） ───────────────────────────

/**
 * ## 为什么要有批量
 *
 * 类列表是"打开就要看到名字"的界面。逐类命名 = 9–10 次模型请求，用户点一次就烧一遍预算；
 * 而且逐类问时模型看不到彼此的区别（把"铜"和"铝"两组都叫"有色金属"）。
 *
 * ## 三条纪律
 *
 * 1. **采集只做一次**：所有目标的成员合成一个并集采一次素材，再按成员把语料切回各组 ——
 *    逐类采集会把市场级列表（异动/监控）重复拉 N 遍；
 * 2. **按成员数分批**：单次 prompt 的规模由 `maxMembersPerCall` 兜住（批次只影响请求次数，
 *    不影响任何一组的口径 —— 护栏逐组独立执行）；
 * 3. **命中缓存就一次模型都不调**：整批结果另有 memo（`batchMemo`），
 *    重复打开页面 = 0 采集 + 0 模型调用。
 *
 * 与单类路径共用同一张 per-class 缓存（键含**批量**提示词版本，所以两种问法的结论不会互相当成缓存）。
 */
export interface NameClassesArgs {
  /** 指定要命名的类（缺省 = 引擎给的全部可采信类，按强度降序取前 `maxClasses` 个）。 */
  classIds?: number[] | undefined
  asOf?: string | undefined
  window?: number | undefined
  minCorr?: number | undefined
  poolN?: number | undefined
  windowDays?: number | undefined
  refresh?: boolean | undefined
  /** 本次最多命名几个类（默认 12；引擎给的可采信类通常 ~10）。 */
  maxClasses?: number | undefined
  /** 单次模型调用最多覆盖多少只成员（默认 24）。 */
  maxMembersPerCall?: number | undefined
}

/** 批量结果里的一组。 */
export interface NameClassesEntry {
  classId: number
  size: number
  memberCount: number
  /** 成员（界面直接渲染，含当日涨幅）。 */
  members: NamingMember[]
  /** 该组的命名结论；null = 本轮没算它（弱链/超上限/引擎没这类）。 */
  naming: NamingResult | null
  /** 没算的原因（`naming === null` 时有值）。 */
  skipReason?: 'weak_chain' | 'over_cap' | 'not_found'
  /** 是否命中缓存（命中 = 这一组没有发生模型调用）。 */
  cached: boolean
}

export type NameClassesOutcome =
  | {
      ok: true
      asOf: string
      entries: NameClassesEntry[]
      effective: { asOf: string; window: number; minCorr: number; poolN: number; nClasses: number }
      collectNotes: string[]
      sourcesUsed: string[]
      /** 本次真的发起了几次模型调用（0 = 全部命中缓存/memo）。 */
      llmCalls: number
      /** 参与本轮的目标类数。 */
      targetCount: number
      /** 整批是否直接命中 memo（0 采集 + 0 模型调用）。 */
      memoHit: boolean
      notes: string[]
    }
  | { ok: false; reason: 'tdx_unavailable' | 'no_classes'; note: string }

export const DEFAULT_BATCH = { maxClasses: 12, maxMembersPerCall: 24, maxCharsPerMember: 800 } as const

/** 整批 memo：key = asOf:params:targets（只缓存**成功**的整批结果）。 */
const batchMemo = new Map<string, Extract<NameClassesOutcome, { ok: true }>>()
const BATCH_MEMO_MAX = 4

/** 清空命名缓存（含整批 memo；`clearCache` 走同一个入口）。 */
export function clearNamingCache(): void {
  cache.clear()
  batchMemo.clear()
}

/** 从并集语料里切出某一组的语料（批量采集 → 逐组护栏的关键一步）。 */
function corpusOf(corpus: CollectResult['corpus'], members: NamingMember[]): CollectResult['corpus'] {
  const labels = new Set(members.map((m) => `${m.code} ${m.name}`))
  const keys = new Set(members.map((m) => `${m.market}${m.code}`))
  return {
    items: corpus.items.filter((i) => labels.has(i.stock) || keys.has(i.key)),
    // 逐源状态**原样透传**：它描述的是"这次采集的事实"（是否按设计跳过、是否失败），
    // 与"这一组用了其中多少条"是两件事 —— 按组裁剪会把状态信息弄丢，
    // 于是每一组看起来都像"源缺失"（这正是原来的归因错误来源之一）。
    sources: corpus.sources,
    missingSources: corpus.missingSources,
    failedStocks: corpus.failedStocks.filter((k) => keys.has(k)),
  }
}

/** 给一组挂上"模型没给这一组结论"的降级结果（绝不替模型补一个结论）。 */
function missingEntry(
  classId: number,
  asOf: string,
  corpus: CollectResult['corpus'],
  window: MaterialWindow,
  modelVersion: string,
  fingerprint: string,
  note: string,
): NamingResult {
  return degradedResult({
    classId,
    asOf,
    corpus,
    window,
    modelVersion,
    fingerprint,
    reason: 'llm_invalid_json',
    note,
  })
}

/**
 * 批量命名：引擎里所有可采信的类，一次采集 + 少量模型调用，逐组过护栏。
 *
 * `rt.callTool('hist_concept_classes')` 拿到的已经是**补过强度**的类表
 * （`host/hist-data.ts` 的 enrichClasses），所以这里能按强度挑最强的先命名 ——
 * 预算有限时，把"最猛的班"先名字出来，比按 class_id 顺序有意义得多。
 */
export async function nameClasses(rt: NamingRuntime, args: NameClassesArgs = {}): Promise<NameClassesOutcome> {
  const params = {
    window: args.window ?? DEFAULT_NAMING_PARAMS.window,
    minCorr: args.minCorr ?? DEFAULT_NAMING_PARAMS.minCorr,
    poolN: args.poolN ?? DEFAULT_NAMING_PARAMS.poolN,
  }
  const windowDays = args.windowDays ?? DEFAULT_NAMING_PARAMS.windowDays
  const guard = rt.guard ?? DEFAULT_NAMING_GUARD
  const maxClasses = args.maxClasses ?? DEFAULT_BATCH.maxClasses
  const maxMembersPerCall = args.maxMembersPerCall ?? DEFAULT_BATCH.maxMembersPerCall

  // ---- [1] 类表（已是补过强度的）----
  let list: Record<string, unknown>
  try {
    list = (await rt.callTool('hist_concept_classes', {
      ...(args.asOf !== undefined ? { as_of: args.asOf } : {}),
      window: params.window,
      min_corr: params.minCorr,
      pool_n: params.poolN,
      top_members: 1,
    })) as Record<string, unknown>
  } catch (err) {
    return { ok: false, reason: 'tdx_unavailable', note: (err as Error)?.message ?? String(err) }
  }
  if (list === null || typeof list !== 'object' || list.ok === false) {
    return { ok: false, reason: 'no_classes', note: String((list as { error?: unknown } | null)?.error ?? '引擎未返回类表') }
  }
  const asOf = String(list.as_of ?? (list.meta as Record<string, unknown> | undefined)?.as_of ?? args.asOf ?? '')
  const nClasses = Number((list.meta as Record<string, unknown> | undefined)?.n_classes ?? 0) || 0
  const rows = (Array.isArray(list.classes) ? list.classes : []) as Array<Record<string, unknown>>
  if (rows.length === 0) return { ok: false, reason: 'no_classes', note: `as_of=${asOf || '?'} 没有挖到任何类` }

  // ---- [2] 选目标：可采信（非弱链）→ 强度降序 ----
  const usable = rows.filter((c) => c.weak_chain !== true)
  if (usable.length === 0) return { ok: false, reason: 'no_classes', note: '全部类都是弱链伪类（不采信、也不命名）' }
  const want = args.classIds !== undefined ? new Set(args.classIds.map(Number)) : null
  const ordered = [...usable].sort((a, b) => Number(b.strength ?? 0) - Number(a.strength ?? 0))
  const picked = (want === null ? ordered : ordered.filter((c) => want.has(Number(c.class_id)))).slice(0, maxClasses)
  const entries: NameClassesEntry[] = []
  for (const c of rows) {
    const id = Number(c.class_id)
    const isWeak = c.weak_chain === true
    const inTarget = picked.some((p) => Number(p.class_id) === id)
    if (isWeak || !inTarget) {
      entries.push({
        classId: id,
        size: Number(c.size ?? 0) || 0,
        memberCount: 0,
        members: [],
        naming: null,
        skipReason: isWeak ? 'weak_chain' : 'over_cap',
        cached: false,
      })
    }
  }

  // ---- [3] 整批 memo：同口径重复打开 = 0 采集 + 0 模型调用 ----
  const memoKey = `${asOf}:${params.window}/${params.minCorr}/${params.poolN}:${windowDays}:${picked.map((c) => Number(c.class_id)).join(',')}`
  if (args.refresh !== true) {
    const hit = batchMemo.get(memoKey)
    if (hit !== undefined) {
      // `llmCalls` 是**本轮**发起次数：复用 memo 时是 0（页头据此显示"花了多少预算"）
      return { ...hit, memoHit: true, llmCalls: 0, entries: hit.entries.map((e) => ({ ...e, cached: true })) }
    }
  }

  // ---- [4] 各组取成员（引擎快照已缓存 → 纯 CPU）----
  const groups: Array<{ classId: number; size: number; members: NamingMember[] }> = []
  for (const c of picked) {
    const id = Number(c.class_id)
    let members: NamingMember[] = []
    try {
      const detail = (await rt.callTool('hist_concept_class', {
        class_id: id,
        ...(asOf !== '' ? { as_of: asOf } : {}),
        window: params.window,
        min_corr: params.minCorr,
        pool_n: params.poolN,
      })) as Record<string, unknown>
      if (detail !== null && typeof detail === 'object' && detail.ok !== false) {
        const rawMembers = Array.isArray(detail.members) ? (detail.members as ClassMemberRow[]) : []
        members = rawMembers.map(asMember).filter((m): m is NamingMember => m !== null)
      }
    } catch { /* 单类取成员失败 → 该组按"无成员"处理，后面如实降级 */ }
    // 成员顺序按当日涨幅降序：让模型先看到最强的票（也让界面顺序可读）
    members.sort((a, b) => (b.changePct ?? -999) - (a.changePct ?? -999))
    groups.push({ classId: id, size: Number(c.size ?? 0) || members.length, members })
  }

  // ---- [5] 采集一次（并集）----
  const union = groups.flatMap((g) => g.members)
  const today = rt.ensureToday !== undefined ? ((await rt.ensureToday()) ?? rt.today) : rt.today
  const collect: CollectResult = await collectMaterials(
    { callTool: rt.callTool, today, news: rt.news },
    {
      asOf,
      members: union,
      windowDays,
      maxChars: Math.min(Math.max(union.length, 8) * DEFAULT_BATCH.maxCharsPerMember, 40_000),
    },
  )

  // ---- [6] 指纹 + 逐组缓存检查（全命中 = 一次模型都不调）----
  const route = rt.route ?? { provider: 'none', model: 'none' }
  const fingerprint = namingFingerprint({
    provider: route.provider,
    model: route.model,
    clientVersion: rt.llm === undefined ? '' : 'ctx.llm',
    windowDays,
    sources: collect.sourcesUsed,
    promptVersion: NAMING_BATCH_PROMPT_VERSION,
    guard: {
      minEvidenceItems: guard.minEvidenceItems,
      minHitMembers: guard.minHitMembers,
      minCoverage: guard.minCoverage,
      minEvidenceScore: guard.minEvidenceScore,
      enforceEvidenceWindow: guard.enforceEvidenceWindow,
    },
  })
  const window: MaterialWindow = { end: asOf, days: windowDays }
  const effective = {
    asOf,
    window: params.window,
    minCorr: params.minCorr,
    poolN: params.poolN,
    nClasses,
    /** 批量下没有"某一类的类内相关"，用类表里可采信类的均值（无类时为 null）。 */
    meanIntraCorr:
      usable.length > 0
        ? Math.round((usable.reduce((s, c) => s + (Number(c.mean_intra_corr) || 0), 0) / usable.length) * 1e4) / 1e4
        : null,
  }
  const notes = [...collect.notes]
  const avail = namingAvailability(rt)
  let llmCalls = 0

  /** 逐组缓存命中检查：命中的组不进任何批次。 */
  const pending: typeof groups = []
  for (const g of groups) {
    const key = `${asOf}:${g.classId}:${fingerprint}`
    const hit = args.refresh === true ? undefined : cache.get(key)
    if (hit !== undefined) {
      entries.push({
        classId: g.classId,
        size: g.size,
        memberCount: g.members.length,
        members: g.members,
        naming: hit.result,
        cached: true,
      })
      continue
    }
    pending.push(g)
  }

  // ---- [7] 分批问模型 ----
  const chunks: Array<typeof groups> = []
  let cur: typeof groups = []
  let curMembers = 0
  for (const g of pending) {
    const n = Math.max(g.members.length, 1)
    if (cur.length > 0 && curMembers + n > maxMembersPerCall) {
      chunks.push(cur)
      cur = []
      curMembers = 0
    }
    cur.push(g)
    curMembers += n
  }
  if (cur.length > 0) chunks.push(cur)

  for (const chunk of chunks) {
    const chunkWindow = window
    const noteFor = (note: string): NamingResult[] =>
      chunk.map((g) =>
        missingEntry(
          g.classId,
          asOf,
          corpusOf(collect.corpus, g.members),
          chunkWindow,
          route.model,
          fingerprint,
          note,
        ),
      )
    let results: NamingResult[]
    if (!avail.available) {
      results = chunk.map((g) =>
        degradedResult({
          classId: g.classId,
          asOf,
          corpus: corpusOf(collect.corpus, g.members),
          window: chunkWindow,
          modelVersion: 'none',
          fingerprint,
          reason: 'llm_unavailable',
          note: `模型不可用：${avail.reason ?? '未知原因'}——素材已采好，可人工命名`,
        }),
      )
    } else {
      const prompt = buildBatchPrompt({
        asOf,
        groups: chunk.map((g) => ({ classId: g.classId, members: g.members, corpus: corpusOf(collect.corpus, g.members) })),
        window: chunkWindow,
      })
      const ac = new AbortController()
      const timer = setTimeout(() => ac.abort(), 120_000)
      let out: { text: string; error?: string; finishKind: string }
      try {
        llmCalls += 1
        out = await callNamingLlm(rt.llm as NamingLlm, route, NAMING_BATCH_SYSTEM_PROMPT, prompt, ac.signal)
      } finally {
        clearTimeout(timer)
      }
      if (out.error !== undefined) {
        results = noteFor(`模型调用失败：${out.error}`)
      } else {
        const parsed = parseLlmJson(out.text)
        const batch = extractBatchResults(parsed.raw)
        if (batch.error !== '' && batch.entries.length === 0) {
          results = noteFor(
            parsed.raw === null
              ? `模型输出无法解析：${parsed.error}｜原文(截断)：${out.text.slice(0, 400)}`
              : `批量输出缺少 results：${batch.error}｜原文(截断)：${out.text.slice(0, 400)}`,
          )
        } else {
          const byId = new Map(batch.entries.map((e) => [e.classId, e.raw]))
          results = chunk.map((g) => {
            const raw = byId.get(g.classId)
            const ownCorpus = corpusOf(collect.corpus, g.members)
            if (raw === undefined) {
              return missingEntry(
                g.classId,
                asOf,
                ownCorpus,
                chunkWindow,
                route.model,
                fingerprint,
                `模型没有给出第 ${g.classId} 组的结论（results 缺项）——不替它补结论`,
              )
            }
            return applyGuards({
              raw,
              classId: g.classId,
              asOf,
              memberLabels: g.members.map((m) => `${m.code} ${m.name}`),
              corpus: ownCorpus,
              window: chunkWindow,
              cfg: guard,
              modelVersion: route.model,
              fingerprint,
              sourceFailed: hasStatus(ownCorpus.sources, 'failed'),
            })
          })
        }
      }
    }
    // 写缓存 + 收进结果
    for (let i = 0; i < chunk.length; i++) {
      const g = chunk[i]
      const result: NamingResult = { ...results[i], fingerprint }
      cache.set(`${asOf}:${g.classId}:${fingerprint}`, {
        ok: true,
        result,
        members: g.members,
        effective,
        collectNotes: notes,
        sourcesUsed: collect.sourcesUsed,
        cached: false,
      })
      entries.push({
        classId: g.classId,
        size: g.size,
        memberCount: g.members.length,
        members: g.members,
        naming: result,
        cached: false,
      })
    }
  }

  const payload: Extract<NameClassesOutcome, { ok: true }> = {
    ok: true,
    asOf,
    entries: entries.sort((a, b) => a.classId - b.classId),
    effective,
    collectNotes: notes,
    sourcesUsed: collect.sourcesUsed,
    llmCalls,
    targetCount: groups.length,
    memoHit: false,
    notes,
  }
  // 只 memo 成功的整批（失败/降级也 memo 会让用户以为"就是没有"）
  if (args.refresh !== true) {
    batchMemo.set(memoKey, payload)
    if (batchMemo.size > BATCH_MEMO_MAX) {
      const oldest = batchMemo.keys().next().value
      if (oldest !== undefined) batchMemo.delete(oldest)
    }
  }
  return payload
}
