/**
 * 统一工具分发（数据层单一入口）。
 *
 * ⚠️ 传输层（2026-09 重构，见 lib/endpoints.ts 单一配置源）：
 *   - 'embedded'（默认）—— 浏览器 POST 同源路由 /api/stock-panel/call，host 半在
 *     dsh web 进程内用 node-tdx 直连 TDX（src/host/tdx-data.ts），无外部进程；
 *     业务错误 / 连接不可用 / 非 JSON 均如实上抛，**不再回退远端源**。
 *   - 'http'（遗留）—— 外部 opentdx JSON 网关（gateway/），不可达如实上抛。
 *
 * 远端 MCP（192.168.31.196:8007/mcp）已移除：内置 node-tdx 覆盖全部 15 个行情
 * 工具（含 goods_varieties），无需远端兜底。
 *
 * 模式由 __DSH_TDX_TRANSPORT__ / DSH_TDX_TRANSPORT 覆盖。
 */

import {
  EMBEDDED_CALL_ROUTE,
  getHttpGatewayEndpoint,
  getTransportMode,
  type TdxTransportMode,
} from './endpoints'
import { gatewayCall, TdxGatewayUnavailableError } from './gateway'

export interface McpCallResult {
  content?: Array<{ type: string; text?: string }>
  isError?: boolean
  structuredContent?: unknown
  [key: string]: unknown
}

export { getTransportMode, type TdxTransportMode }

/* ─────────────────────── 错误分类：把 host 的 kind 贯通到前端 ─────────────────────── */

/**
 * 工具调用错误的 kind（审计 UX-PLAN I3）。
 *
 * ## 为什么要有它
 * `src/host-util.ts:86-99` 明明按 `TdxToolError / UnsupportedToolError / TdxUnavailableError`
 * 把失败分成了 `business / unsupported / unavailable` 三类塞进响应体，但本文件此前
 * （旧 `src/lib/mcp.ts:68-70`）只写了一句：
 *
 *     throw new Error(`${name}: ${body?.error ?? '未知错误'}`)
 *
 * —— kind 被丢在传输层。于是「未知工具」（前端调了 host 未注册的工具名，重启 dsh web 就好）
 * 与「数据源离线」（得去查行情源/网络）在界面上是**同一个红字**，用户拿不到不同建议。
 * 现在 kind 随错误一起上抛，界面（components/ErrorBar.tsx）才有资格给不同处置。
 *
 * ## 取值
 * host 三种 + 客户端自己的一种：
 *   · `business`    业务/参数错误（host `kind: 'business'`）
 *   · `unsupported` 未知工具名（host `kind: 'unsupported'`）
 *   · `unavailable` 连接不可用 / 桥接不可达 / 响应非 JSON（host `kind: 'unavailable'` + 传输层）
 *   · `timeout`     客户端自己判的超时。host 从不说 timeout：它那侧没有超时，
 *                   是浏览器侧 AbortController 先把请求掐了（见下方 embeddedCall）。
 */
export const MCP_ERROR_KINDS = ['business', 'unsupported', 'unavailable', 'timeout'] as const
export type McpErrorKind = (typeof MCP_ERROR_KINDS)[number]

/** 判定任意值是否是合法 kind（host 是另一份构建，不能靠类型断言信它）。 */
export function isMcpErrorKind(v: unknown): v is McpErrorKind {
  return typeof v === 'string' && (MCP_ERROR_KINDS as readonly string[]).includes(v)
}

/**
 * 带 kind 的取数错误。**向后兼容**（这是刻意的）：
 *   · 仍是 `instanceof Error`，`.message` 的格式与旧代码逐字相同（`${name}: ${error}`），
 *     所以 `(e as Error).message`、`lib/cache.ts` 的 `errMsg()`、既有 catch 全部照常工作；
 *   · 只是**多挂了一个 `kind` 字段**（等价于 `Object.assign(new Error(msg), { kind })`，
 *     这里用子类是为了顺带带上 tool 名，便于诊断）；
 *   · `kind` 允许为 `null`：host 是独立构建，老版本可能压根不回 kind ——
 *     这种情况下**不臆造分类**，交给界面按消息特征兜底（`mcpErrorKind()` 返回 null）。
 */
export class McpToolError extends Error {
  /** 分类；`null` = host 没给（旧 host 半），界面按消息特征兜底。 */
  readonly kind: McpErrorKind | null
  /** 触发失败的工具名（诊断用）。 */
  readonly tool: string

  constructor(message: string, kind: McpErrorKind | null, tool: string) {
    super(message)
    this.name = 'McpToolError'
    this.kind = kind
    this.tool = tool
  }
}

/** 类型守卫：本模块抛出的带 kind 错误。 */
export function isMcpToolError(err: unknown): err is McpToolError {
  return err instanceof McpToolError
}

/**
 * 读任意错误的 kind（判定函数，给界面用）。
 *
 * 之所以既认 `instanceof` 又认鸭子类型：子类跨打包边界（client bundle / 宿主 bundle /
 * 动态 import）时 `instanceof` 可能失配，而 kind 字符串不会。读不到就返回 `null`，
 * 由调用方走消息兜底 —— **不猜**。
 */
export function mcpErrorKind(err: unknown): McpErrorKind | null {
  if (err instanceof McpToolError) return err.kind
  if (typeof err === 'object' && err !== null) {
    const k = (err as { kind?: unknown }).kind
    if (isMcpErrorKind(k)) return k
  }
  return null
}

/** 构造一个带 kind 的取数错误（给页面在"多条失败需要聚合成一条"时使用）。 */
export function toToolError(message: string, kind: McpErrorKind | null, tool: string): McpToolError {
  return new McpToolError(message, kind, tool)
}

/** payload → McpCallResult（content/structuredContent 双形态，兼容现有适配层）。 */
function toMcpResult(data: unknown): McpCallResult {
  return {
    content: [{ type: 'text', text: JSON.stringify(data) }],
    structuredContent: { result: data },
  }
}

/**
 * 调用内置（进程内 TDX）桥接：POST /api/stock-panel/call {tool, args} → {ok, data}。
 * 失败（业务错误 / 连接不可用 / 非 JSON）直接抛带 `kind` 的 McpToolError，不触发任何回退。
 *
 * 超时**按工具给**：HIST 自挖概念工具首次调用要建快照（拉数百只 K 线，README 自述"冷启动数秒"），
 * 25s 会把它掐掉；普通行情工具 25s 已经绰绰有余（host 侧另有 8s 单次超时兜底）。
 */
const HIST_TOOL_TIMEOUT_MS = 60_000

async function embeddedCall(
  name: string,
  args: Record<string, unknown>,
  timeoutMs = name.startsWith('hist_concept_') ? HIST_TOOL_TIMEOUT_MS : 25_000,
): Promise<unknown> {
  const ac = new AbortController()
  const timer = setTimeout(() => ac.abort(), timeoutMs)
  let resp: Response
  try {
    resp = await fetch(EMBEDDED_CALL_ROUTE, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tool: name, args }),
      signal: ac.signal,
    })
  } catch (err) {
    // 浏览器侧超时：host 不知道这次失败（它那侧没有超时），所以 kind 由客户端判定。
    if (ac.signal.aborted) throw new McpToolError(`内置 TDX 请求超时(${timeoutMs}ms): ${name}`, 'timeout', name)
    throw new McpToolError(`内置 TDX 桥接不可达: ${(err as Error).message}`, 'unavailable', name)
  } finally {
    clearTimeout(timer)
  }
  let body: any
  try {
    body = await resp.json()
  } catch {
    // 有响应但不是 JSON：多半是路由没注册被别的兜底接走了 → 归"数据源不可达"（可以去查桥接）
    throw new McpToolError(`内置 TDX 响应非 JSON: ${name}`, 'unavailable', name)
  }
  if (!body || body.ok !== true) {
    // ★ I3 的核心一行：host 的 kind（business / unsupported / unavailable）从此不再被丢弃。
    //   认不出就传 null（旧 host 半不回 kind），让界面按消息特征兜底，不臆造分类。
    const kind = isMcpErrorKind(body?.kind) ? body.kind : null
    throw new McpToolError(`${name}: ${body?.error ?? '未知错误'}`, kind, name)
  }
  return body.data ?? null
}

/**
 * 遗留 http 网关错误 → 带 kind 的错误。
 * `TdxGatewayUnavailableError` 是传输层失败（网关不可达/超时/非 200），其余是工具业务错误。
 */
function fromGatewayError(name: string, err: unknown): McpToolError {
  if (err instanceof McpToolError) return err
  if (err instanceof TdxGatewayUnavailableError) {
    return new McpToolError(err.message, err.kind, name)
  }
  return new McpToolError(err instanceof Error ? err.message : String(err), 'business', name)
}

/**
 * 统一工具调用入口（stock-data.ts / 页面轮询 / 诊断句柄都走这里）。
 * 返回 McpCallResult（content/structuredContent 双形态）；失败抛带 `kind` 的 McpToolError。
 */
export async function invokeTool(
  name: string,
  args: Record<string, unknown> = {},
): Promise<McpCallResult> {
  const mode = getTransportMode()
  if (mode === 'http') {
    let data: unknown
    try {
      data = await gatewayCall(name, args, undefined, getHttpGatewayEndpoint())
    } catch (err) {
      throw fromGatewayError(name, err)
    }
    return toMcpResult(data)
  }
  // 'embedded'（默认）：同源内置桥接，进程内 node-tdx 直连，无远端兜底。
  const data = await embeddedCall(name, args)
  return toMcpResult(data)
}
