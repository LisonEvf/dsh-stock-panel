/**
 * src/lib/gateway.ts — 本机 opentdx JSON 网关客户端。
 *
 * 与 mcp.ts（远端 MCP/JSON-RPC+SSE）同签名地提供 `gatewayCall(name, args)`：
 *   POST http://127.0.0.1:8017/call  {"tool": name, "args": args}
 *   → {"ok": true, "data": <与远端 MCP 工具一致的 JSON>}
 *
 * 用途：frontend-dsh 默认行情传输从「远端 MCP(192.168.31.196:8007)」切到
 * 本机直连 opentdx 的网关（见 gateway/README.md），去掉 LAN 一跳与 MCP
 * 会话/SSE 开销；网关不可达时由 mcp.ts 的 invokeTool 自动回退远端 MCP。
 */

/** 网关默认端点；可用 window.__DSH_TDX_GATEWAY__ 覆盖。 */
export function getGatewayEndpoint(): string {
  if (typeof window !== 'undefined' && (window as any).__DSH_TDX_GATEWAY__) {
    return String((window as any).__DSH_TDX_GATEWAY__)
  }
  return 'http://127.0.0.1:8017'
}

/** 网关不可达/超时（可触发 MCP 回退）；业务错误抛普通 Error。 */
export class TdxGatewayUnavailableError extends Error {}

/** 探测网关健康（短超时，供 invokeTool 回退判定与诊断）。 */
export async function gatewayHealth(endpoint?: string, timeoutMs = 1500): Promise<boolean> {
  const ac = new AbortController()
  const timer = setTimeout(() => ac.abort(), timeoutMs)
  try {
    const resp = await fetch(`${endpoint ?? getGatewayEndpoint()}/healthz`, { signal: ac.signal })
    if (!resp.ok) return false
    const body = await resp.json().catch(() => null)
    return Boolean(body && body.ok === true)
  } catch {
    return false
  } finally {
    clearTimeout(timer)
  }
}

/**
 * 调用网关工具，返回与远端 MCP 工具一致的 payload（list/dict/null）。
 * 传输层失败（网络/超时/非 200）抛 TdxGatewayUnavailableError；工具业务错误抛 Error。
 */
export async function gatewayCall(
  name: string,
  args: Record<string, unknown> = {},
  timeoutMs = 15_000,
): Promise<any> {
  const ac = new AbortController()
  const timer = setTimeout(() => ac.abort(), timeoutMs)
  let resp: Response
  try {
    resp = await fetch(`${getGatewayEndpoint()}/call`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tool: name, args }),
      signal: ac.signal,
    })
  } catch (err) {
    if (ac.signal.aborted) {
      throw new TdxGatewayUnavailableError(`tdx 网关请求超时(${timeoutMs}ms): ${name}`)
    }
    const reason = err instanceof Error ? err.message : String(err)
    throw new TdxGatewayUnavailableError(`tdx 网关不可达: ${reason}`)
  } finally {
    clearTimeout(timer)
  }
  if (!resp.ok) {
    throw new TdxGatewayUnavailableError(`tdx 网关 HTTP ${resp.status} ${resp.statusText}`)
  }
  let body: any
  try {
    body = await resp.json()
  } catch {
    throw new TdxGatewayUnavailableError(`tdx 网关响应非 JSON: ${name}`)
  }
  if (!body || body.ok !== true) {
    const detail = (body && (body.error ?? body.message)) || '未知错误'
    throw new Error(`tdx ${name}: ${detail}`)
  }
  return body.data ?? null
}
