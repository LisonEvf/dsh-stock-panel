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
import { gatewayCall } from './gateway'

export interface McpCallResult {
  content?: Array<{ type: string; text?: string }>
  isError?: boolean
  structuredContent?: unknown
  [key: string]: unknown
}

export { getTransportMode, type TdxTransportMode }

/** payload → McpCallResult（content/structuredContent 双形态，兼容现有适配层）。 */
function toMcpResult(data: unknown): McpCallResult {
  return {
    content: [{ type: 'text', text: JSON.stringify(data) }],
    structuredContent: { result: data },
  }
}

/**
 * 调用内置（进程内 TDX）桥接：POST /api/stock-panel/call {tool, args} → {ok, data}。
 * 失败（业务错误 / 连接不可用 / 非 JSON）直接抛 Error，不触发任何回退。
 */
async function embeddedCall(name: string, args: Record<string, unknown>, timeoutMs = 25_000): Promise<unknown> {
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
    if (ac.signal.aborted) throw new Error(`内置 TDX 请求超时(${timeoutMs}ms): ${name}`)
    throw new Error(`内置 TDX 桥接不可达: ${(err as Error).message}`)
  } finally {
    clearTimeout(timer)
  }
  let body: any
  try {
    body = await resp.json()
  } catch {
    throw new Error(`内置 TDX 响应非 JSON: ${name}`)
  }
  if (!body || body.ok !== true) {
    throw new Error(`${name}: ${body?.error ?? '未知错误'}`)
  }
  return body.data ?? null
}

/**
 * 统一工具调用入口（stock-data.ts / 页面轮询 / 诊断句柄都走这里）。
 * 返回 McpCallResult（content/structuredContent 双形态）；失败抛 Error。
 */
export async function invokeTool(
  name: string,
  args: Record<string, unknown> = {},
): Promise<McpCallResult> {
  const mode = getTransportMode()
  if (mode === 'http') {
    const data = await gatewayCall(name, args, undefined, getHttpGatewayEndpoint())
    return toMcpResult(data)
  }
  // 'embedded'（默认）：同源内置桥接，进程内 node-tdx 直连，无远端兜底。
  const data = await embeddedCall(name, args)
  return toMcpResult(data)
}
