/**
 * src/lib/gateway.ts — 遗留外部 opentdx JSON 网关客户端（'http' 传输模式专用）。
 *
 * 与 mcp.ts（embedded）同签名地提供 `gatewayCall(name, args)`：
 *   POST {gateway}/call  {"tool": name, "args": args}
 *   → {"ok": true, "data": <与内置工具一致的 JSON>}
 *
 * 默认传输已改为 **embedded**（host 半进程内 node-tdx，见 lib/endpoints.ts）；
 * 本模块仅服务显式 `__DSH_TDX_TRANSPORT__ = 'http'` 的遗留部署（外部 python
 * 网关或兼容 HTTP 服务），网关地址统一读 endpoints.getHttpGatewayEndpoint()。
 * 网关不可达时由 mcp.ts 的 invokeTool 如实上抛（不再回退任何远端源）。
 */
import { getHttpGatewayEndpoint } from './endpoints'

/** 网关端点（覆盖变量 __DSH_TDX_GATEWAY__ / DSH_TDX_GATEWAY → 默认 127.0.0.1:8017）。 */
export function getGatewayEndpoint(): string {
  return getHttpGatewayEndpoint()
}

/** 网关不可达/超时；业务错误抛普通 Error。 */
export class TdxGatewayUnavailableError extends Error {}

/** 探测网关健康（短超时，供诊断）。 */
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
 * 调用网关工具，返回与内置工具一致的 payload（list/dict/null）。
 * 传输层失败（网络/超时/非 200）抛 TdxGatewayUnavailableError；工具业务错误抛 Error。
 */
export async function gatewayCall(
  name: string,
  args: Record<string, unknown> = {},
  timeoutMs = 15_000,
  endpoint?: string,
): Promise<any> {
  const ac = new AbortController()
  const timer = setTimeout(() => ac.abort(), timeoutMs)
  let resp: Response
  try {
    resp = await fetch(`${endpoint ?? getGatewayEndpoint()}/call`, {
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
