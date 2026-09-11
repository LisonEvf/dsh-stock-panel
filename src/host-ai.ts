/**
 * src/host-ai.ts — host 半「一键问模型」桥接（官方 ctx.llm 直调）。
 *
 * 链路：browser POST /api/stock-panel/ai {task, context, ask}
 *   → 本模块用 `ctx.agentDefaultModel.currentSelection()` 取当前默认模型路由
 *   → `ctx.llm.stream({provider, model, system, messages})` 直调
 *   → 收集 text-delta → 校验成结构化 JSON（src/lib/ai-contract.ts）
 *   → 回 {ok, text, json, meta, reasoning}
 *
 * 设计取舍：
 *   - **不把 llm / agentDefaultModel 列进 inject**：它们是可选增强，缺了就返回
 *     `kind:'no-model'` 让按钮优雅置灰；列进 inject 会让整个插件（含 TDX 桥接与
 *     对话工具）在无 LLM 的部署里根本不加载。用 `ctx.get(name)` 安全访问。
 *   - **数据由前端传入**：模型看到的正是用户屏幕上那份（含 http 数据源模式），
 *     且不产生第二次回源等待；超过 `AI_CONTEXT_MAX_BYTES` 直接报错而不是悄悄截断。
 *   - **模型原文永远回传**：结构化解析失败时视图仍能显示模型说了什么，不丢信息。
 */
import {
  AI_CONTEXT_MAX_BYTES,
  buildAiPrompt,
  contextBytes,
  parseAiResult,
  shrinkContext,
  type AiCallMeta,
  type AiTaskKind,
  type AiTaskRequest,
  type AiTaskResponse,
} from './lib/ai-contract'
import { AI_CALL_ROUTE } from './lib/endpoints'

/** 本插件在消息来源里的标识（Message.source.plugin）。 */
const PLUGIN_ID = '@lisonevf/dsh-stock-panel'
/** 单次调用超时（推理模型较慢，给足 90s）。 */
const AI_TIMEOUT_MS = 90_000
/**
 * 输出上限：**必须覆盖「思考 + 正文」**——这是真机实测才暴露的坑。
 *
 * 2026-09-11 真机验证：部署默认模型 `deepseek-v4-flash` 且推理等级 High，
 * `maxTokens` 是 reasoning 与可见正文的**共享预算**。原值 1600 时：
 *   - 2 根日 K 的小上下文 → 思考 ~1.2k 字符 + 正文正常，ok；
 *   - 60 根日 K（≈6.9KB，真实工作台量级）→ 模型把 1600 全烧在思考上，
 *     `finish.kind === 'max-tokens'` 且**正文 0 字**，整个任务失败。
 * 放宽到 6000 后同样上下文正常返回（上限只是"允许"，不会白生成）。
 */
const AI_MAX_TOKENS = 6000

/** 模型流式块（只声明本模块消费的两种）。 */
interface StreamChunkLike {
  type?: string
  text?: string
  reason?: { kind?: string; failure?: { message?: string } }
}

/** ctx.llm 的最小形状（本地声明，不依赖宿主包类型）。 */
interface MinimalLlm {
  stream(options: {
    provider: string
    model: string
    messages: unknown[]
    system?: string
    maxTokens?: number
    signal?: AbortSignal
  }): AsyncIterable<StreamChunkLike>
}

/** ctx.agentDefaultModel 的最小形状。 */
interface MinimalDefaultModel {
  currentSelection(): { provider?: string; model?: string; reasoningEffort?: string }
}

/** host 半 AI 运行时依赖（由 index.ts 探测后注入）。 */
export interface AiRuntime {
  llm?: MinimalLlm
  defaultModel?: MinimalDefaultModel
  /** 兜底路由（宿主既无 llm 服务也无默认模型时使用；留空则功能置灰）。 */
  fallback?: { provider: string; model: string }
}

/** 从 Cordis ctx 安全取服务（未注入/不存在都返回 undefined，不抛异常）。 */
export function pickService(ctx: unknown, name: string): unknown {
  if (ctx === null || ctx === undefined) return undefined
  // 1) ctx.get(name) 是官方安全取法（不要求 inject 声明）
  try {
    const get = (ctx as { get?: (k: string) => unknown }).get
    if (typeof get === 'function') {
      const svc = get.call(ctx, name)
      if (svc !== undefined && svc !== null) return svc
    }
  } catch {
    /* 落到属性读取 */
  }
  // 2) 属性直读兜底
  try {
    const svc = (ctx as Record<string, unknown>)[name]
    return svc ?? undefined
  } catch {
    return undefined
  }
}

/** 探测运行时依赖。 */
export function resolveAiRuntime(ctx: unknown, fallback?: AiRuntime['fallback']): AiRuntime {
  const llm = pickService(ctx, 'llm') as MinimalLlm | undefined
  const defaultModel = pickService(ctx, 'agentDefaultModel') as MinimalDefaultModel | undefined
  return {
    llm: llm !== undefined && typeof llm.stream === 'function' ? llm : undefined,
    defaultModel:
      defaultModel !== undefined && typeof defaultModel.currentSelection === 'function'
        ? defaultModel
        : undefined,
    ...(fallback !== undefined ? { fallback } : {}),
  }
}

/** 解析本次调用使用的模型路由（默认模型 → 兜底配置）。 */
export function resolveModelRoute(rt: AiRuntime): { provider: string; model: string } | null {
  try {
    const sel = rt.defaultModel?.currentSelection()
    if (sel !== undefined && typeof sel.provider === 'string' && sel.provider !== '' && typeof sel.model === 'string' && sel.model !== '') {
      return { provider: sel.provider, model: sel.model }
    }
  } catch {
    /* 落到兜底 */
  }
  if (rt.fallback !== undefined && rt.fallback.provider !== '' && rt.fallback.model !== '') {
    return { provider: rt.fallback.provider, model: rt.fallback.model }
  }
  return null
}

/** AI 能力当前是否可用（供诊断/按钮置灰）。 */
export function aiAvailability(rt: AiRuntime): { available: boolean; reason?: string; provider?: string; model?: string } {
  if (rt.llm === undefined) return { available: false, reason: 'ctx.llm 不可用（宿主未挂载 LLM 服务）' }
  const route = resolveModelRoute(rt)
  if (route === null) return { available: false, reason: '无默认模型路由（未挂载 dsh-agent-default-model 且无兜底配置）' }
  return { available: true, provider: route.provider, model: route.model }
}

/** 构造一条 hand-built user 消息（官方 Message 形状，本地声明，无宿主依赖）。 */
function userMessage(text: string): unknown {
  const rand = Math.floor(Math.random() * 16777215).toString(36)
  return {
    id: `ai-${Date.now().toString(36)}-${rand}`,
    role: 'user',
    content: [{ type: 'text', text }],
    source: { kind: 'plugin', plugin: PLUGIN_ID },
  }
}

/**
 * 单次模型调用（不抛异常）：收集正文/思考/结束原因。
 */
async function streamOnce(
  rt: AiRuntime,
  route: { provider: string; model: string },
  system: string,
  user: string,
  signal: AbortSignal,
): Promise<{ text: string; reasoning: string; finishKind: string; failureMessage: string; error?: string }> {
  let text = ''
  let reasoning = ''
  let finishKind = ''
  let failureMessage = ''
  try {
    const stream = rt.llm!.stream({
      provider: route.provider,
      model: route.model,
      system,
      messages: [userMessage(user)],
      maxTokens: AI_MAX_TOKENS,
      signal,
    })
    for await (const chunk of stream) {
      if (chunk === null || typeof chunk !== 'object') continue
      if (chunk.type === 'text-delta' && typeof chunk.text === 'string') {
        text += chunk.text
      } else if (chunk.type === 'reasoning-delta' && typeof chunk.text === 'string') {
        // 思考内容单独收集：不参与 JSON 解析，只作为透明度信息回传（截断）。
        if (reasoning.length < 4000) reasoning += chunk.text
      } else if (chunk.type === 'finish') {
        finishKind = chunk.reason?.kind ?? ''
        failureMessage = chunk.reason?.failure?.message ?? ''
      }
    }
  } catch (err) {
    return {
      text,
      reasoning,
      finishKind,
      failureMessage,
      error: (err as Error)?.message ?? String(err),
    }
  }
  return { text, reasoning, finishKind, failureMessage }
}

/** 最多向模型发起几次调用（首次 + 自愈重试）。 */
const AI_MAX_ATTEMPTS = 3
/**
 * 最多裁剪几次上下文。与 {@link AI_MAX_ATTEMPTS} **分开计数**：
 * 超大上下文需要连裁两档才达标，若共用一个计数器，会把重试额度吃掉。
 */
const AI_MAX_SHRINKS = 3

/**
 * 执行一次 AI 任务（不抛异常，全部失败都转成 `{ok:false, kind, error}`）。
 *
 * **自愈重试**：真机实测发现，推理模型会把 `maxTokens` 全部烧在 reasoning 上，
 * 上下文一大就「思考够了、正文 0 字」（finish=max-tokens）；上下文还可能直接超过
 * 24KB 上限。两种情况都先尝试 `shrinkContext()` 裁一档再继续，裁剪说明回传在
 * `meta.shrunk` 里并由 UI 显式展示——**不是静默改小模型看到的数据**。
 */
export async function runAiTask(rt: AiRuntime, req: AiTaskRequest): Promise<AiTaskResponse> {
  const task = req?.task
  if (task !== 'stock-verdict' && task !== 'review-plan' && task !== 'scout-rank') {
    return { ok: false, kind: 'bad-request', error: `未知任务：${String(task)}` }
  }
  if (rt.llm === undefined) {
    return { ok: false, kind: 'no-model', error: '宿主未提供 LLM 服务（ctx.llm）' }
  }
  const route = resolveModelRoute(rt)
  if (route === null) {
    return { ok: false, kind: 'no-model', error: '没有可用的默认模型路由' }
  }

  const started = Date.now()
  const ac = new AbortController()
  const timer = setTimeout(() => ac.abort(), AI_TIMEOUT_MS)
  const shrunk: string[] = []
  let context = req.context
  let attempt = 0 // 已发起的模型调用次数
  let shrinks = 0 // 已执行的裁剪次数

  /** 组装 meta（裁过/重试过都如实记录）。 */
  const metaOf = (): AiCallMeta => ({
    provider: route.provider,
    model: route.model,
    ms: Date.now() - started,
    ...(shrunk.length > 0 ? { shrunk: [...shrunk] } : {}),
    ...(attempt > 1 ? { attempts: attempt } : {}),
  })

  /** 裁一档上下文；返回 false 表示无法再裁（调用方据此给出明确错误）。 */
  const tryShrink = (): boolean => {
    if (shrinks >= AI_MAX_SHRINKS) return false
    const before = contextBytes(context)
    const cut = shrinkContext(context)
    if (cut === null || contextBytes(cut.context) >= before) return false
    context = cut.context
    shrunk.push(cut.note)
    shrinks += 1
    return true
  }

  try {
    for (;;) {
      const bytes = contextBytes(context)
      // ① 超限：先裁（裁不动才报错，保持「不悄悄截断」的诚实性）
      if (bytes > AI_CONTEXT_MAX_BYTES) {
        if (tryShrink()) continue
        return {
          ok: false,
          kind: 'context-too-large',
          error: `上下文 ${Math.round(bytes / 1024)}KB 超过上限 ${Math.round(AI_CONTEXT_MAX_BYTES / 1024)}KB，且已无可继续裁剪的字段`,
          meta: metaOf(),
        }
      }
      // ② 模型调用次数用尽却仍未产出（仅在重试路径可能到达）
      if (attempt >= AI_MAX_ATTEMPTS) {
        return {
          ok: false,
          kind: 'llm-error',
          error:
            `模型连续 ${attempt} 次未返回正文（上下文 ${Math.round(bytes / 1024)}KB` +
            `${shrunk.length > 0 ? `，已自动裁剪 ${shrunk.length} 次仍不足` : ''}）` +
            '——可减少上下文（如缩短 K 线窗口）或降低推理等级后重试',
          meta: metaOf(),
        }
      }

      attempt += 1
      const { system, user } = buildAiPrompt(task as AiTaskKind, context, req.ask)
      const out = await streamOnce(rt, route, system, user, ac.signal)

      if (out.error !== undefined) {
        return {
          ok: false,
          kind: 'llm-error',
          error: ac.signal.aborted
            ? `模型调用超时（${Math.round(AI_TIMEOUT_MS / 1000)}s）`
            : `模型调用失败：${out.error}`,
          meta: metaOf(),
          ...(out.reasoning !== '' ? { reasoning: out.reasoning } : {}),
        } as AiTaskResponse & { reasoning?: string }
      }

      if (out.text.trim() === '') {
        // 只回思考不回正文：能裁就再试一次
        if (out.finishKind === 'max-tokens' && !ac.signal.aborted && tryShrink()) continue
        return {
          ok: false,
          kind: 'llm-error',
          error:
            out.finishKind === 'max-tokens'
              ? `模型把输出预算用尽在思考上（未产生正文）——上下文 ${Math.round(bytes / 1024)}KB 偏大或推理等级偏高${shrunk.length > 0 ? '，已自动裁剪仍不足' : ''}`
              : out.failureMessage !== ''
                ? `模型请求失败：${out.failureMessage}`
                : `模型没有返回正文（finish=${out.finishKind || 'unknown'}）`,
          meta: metaOf(),
          ...(out.reasoning !== '' ? { reasoning: out.reasoning } : {}),
        } as AiTaskResponse & { reasoning?: string }
      }

      const json = parseAiResult(task as AiTaskKind, out.text)
      return {
        ok: true,
        task: task as AiTaskKind,
        text: out.text,
        ...(json !== null ? { json } : {}),
        meta: metaOf(),
        ...(out.reasoning !== '' ? { reasoning: out.reasoning } : {}),
      } as AiTaskResponse & { reasoning?: string }
    }
  } finally {
    clearTimeout(timer)
  }
}

/** HTTP 载体形状（与 host-util 的 webServer 形状一致）。 */
type WebServerLike = {
  register: (route: {
    kind: 'exact' | 'prefix'
    path: string
    handler: (req: unknown, res: unknown) => void | Promise<void>
  }) => () => void
}

/**
 * 注册 AI 桥接路由。`getRuntime` 在每次请求时求值——宿主服务可能晚于本插件就绪，
 * 惰性解析避免注册期拿不到 `ctx.llm`。
 */
export function registerAiBridge(webServer: WebServerLike, getRuntime: () => AiRuntime): void {
  try {
    webServer.register({
      kind: 'exact',
      path: AI_CALL_ROUTE,
      handler: async (req, res) => {
        const w = res as {
          setHeader?: (k: string, v: string) => void
          end: (b: string) => void
          statusCode?: number
        }
        const send = (status: number, payload: unknown) => {
          if (w.setHeader) {
            w.statusCode = status
            w.setHeader('Content-Type', 'application/json')
          }
          w.end(JSON.stringify(payload))
        }
        try {
          // GET：探测 AI 能力（客户端据此决定按钮可用态/提示文案）。
          if ((req as { method?: string })?.method === 'GET') {
            const rt = getRuntime()
            const avail = aiAvailability(rt)
            send(200, { ok: true, ...avail })
            return
          }
          const raw = await readJsonBody(req)
          const body = raw as Partial<AiTaskRequest>
          if (body === null || typeof body !== 'object' || typeof body.task !== 'string') {
            send(400, { ok: false, kind: 'bad-request', error: 'body 需要 {"task":"...","context":{...}}' })
            return
          }
          const result = await runAiTask(getRuntime(), {
            task: body.task as AiTaskKind,
            context: body.context,
            ...(typeof body.ask === 'string' ? { ask: body.ask } : {}),
          })
          send(200, result)
        } catch (err) {
          send(500, { ok: false, kind: 'llm-error', error: (err as Error)?.message ?? String(err) })
        }
      },
    })
    console.log(`[stock-panel] AI bridge registered at ${AI_CALL_ROUTE}`)
  } catch (err) {
    console.warn('[stock-panel] AI bridge registration failed:', err)
  }
}

/** 读取并解析请求体（含体积上限保护）。 */
async function readJsonBody(req: unknown): Promise<unknown> {
  const chunks: Uint8Array[] = []
  let size = 0
  const maxBytes = 512 * 1024
  for await (const chunk of req as AsyncIterable<Uint8Array>) {
    chunks.push(chunk)
    size += chunk.byteLength
    if (size > maxBytes) throw new Error('请求体过大')
  }
  const all = new Uint8Array(size)
  let offset = 0
  for (const chunk of chunks) {
    all.set(chunk, offset)
    offset += chunk.byteLength
  }
  const raw = new TextDecoder().decode(all)
  return raw === '' ? {} : JSON.parse(raw)
}
