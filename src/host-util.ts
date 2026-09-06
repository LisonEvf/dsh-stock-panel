/**
 * src/host-util.ts — host 半运行时工具：Cordis ctx 类型 + MCP 桥接路由。
 *
 * MCP 桥接：host 半在服务端直连远端 MCP 服务器，避免浏览器跨域（CORS）。
 * browser 半 POST JSON-RPC 2.0 请求到同源路由 /api/stock-panel/mcp，
 * host 半转发并把 SSE 响应原样回传（host 侧发起请求无 CORS 限制）。
 */

/** host 半可用的 Cordis ctx 形状（仅列出本插件用到的面）。 */
export interface HostCtx {
  /** 注册一个 host 服务，暴露插件元数据。 */
  provide: (name: string, impl: unknown) => void
  /** 浏览器 HTTP 载体（dsh-host-webserver）。用于注册 MCP 桥接路由。 */
  webServer?: {
    register: (route: {
      kind: 'exact' | 'prefix'
      path: string
      handler: (req: unknown, res: unknown) => void | Promise<void>
    }) => () => void
  }
  /** 工具注册表（dsh-tools，web 预设恒有）。对话行情工具经它注册。 */
  tools?: {
    register: (definition: unknown) => () => void
  }
}

/** 安全获取 ctx 属性，未注入时返回 undefined 而非抛异常。 */
export function getOwnPropertySafe(obj: unknown, key: string): unknown {
  try {
    return (obj as Record<string, unknown>)[key]
  } catch {
    return undefined
  }
}

/**
 * 在 ctx.webServer 上注册 MCP 桥接路由。
 *
 * browser 半 POST 一个 JSON-RPC 2.0 MCP 请求到此路由，host 半转发到远端
 * MCP 服务器，把 SSE 响应原样回传。
 */
export function registerMcpBridge(webServer: {
  register: (route: {
    kind: 'exact' | 'prefix'
    path: string
    handler: (req: unknown, res: unknown) => void | Promise<void>
  }) => () => void
}): void {
  try {
    const endpoint = 'http://192.168.31.196:8007/mcp'

    webServer.register({
      kind: 'exact',
      path: '/api/stock-panel/mcp',
      handler: async (req, res) => {
        try {
          const body = await readBody(req)
          const resp = await fetch(endpoint, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Accept: 'application/json, text/event-stream',
              ...(body.sessionId ? { 'Mcp-Session-Id': body.sessionId } : {}),
            },
            body: JSON.stringify(body.payload),
          })
          // 透传会话 ID（若有）
          const sessionId = resp.headers.get('mcp-session-id')
          const resW = res as {
            setHeader?: (k: string, v: string) => void
            end: (b: string) => void
            statusCode?: number
          }
          if (sessionId && resW.setHeader) {
            resW.setHeader('Mcp-Session-Id', sessionId)
          }
          if (resW.setHeader) {
            resW.setHeader('Content-Type', 'text/event-stream')
            resW.setHeader('Cache-Control', 'no-cache')
            resW.setHeader('Connection', 'keep-alive')
          }
          resW.end(await resp.text())
        } catch (err) {
          const resW = res as {
            setHeader?: (k: string, v: string) => void
            end: (b: string) => void
            statusCode?: number
          }
          if (resW.setHeader) {
            resW.statusCode = 500
            resW.setHeader('Content-Type', 'application/json')
          }
          resW.end(
            JSON.stringify({
              jsonrpc: '2.0',
              id: 'bridge-error',
              error: { code: -32603, message: (err as Error).message },
            }),
          )
        }
      },
    })
    console.log('[stock-panel] MCP bridge registered at /api/stock-panel/mcp ->', endpoint)
  } catch (err) {
    console.warn('[stock-panel] MCP bridge registration failed:', err)
  }
}

/** 读取 HTTP 请求体（JSON）。 */
async function readBody(req: unknown): Promise<{ payload: unknown; sessionId?: string }> {
  const chunks: Uint8Array[] = []
  let size = 0
  // IncomingMessage 既是 ReadableStream 也是 AsyncIterable
  const stream = req as AsyncIterable<Uint8Array>
  for await (const chunk of stream) {
    chunks.push(chunk)
    size += chunk.byteLength
  }
  const all = new Uint8Array(size)
  let offset = 0
  for (const chunk of chunks) {
    all.set(chunk, offset)
    offset += chunk.byteLength
  }
  const raw = new TextDecoder().decode(all)
  let payload: unknown
  try {
    payload = raw ? JSON.parse(raw) : {}
  } catch {
    payload = {}
  }
  // 会话 ID 从请求头或请求体获取
  const headers = (req as { headers?: Record<string, string> }).headers ?? {}
  const sessionId = headers['mcp-session-id'] ?? (payload as { sessionId?: string })?.sessionId
  return { payload, sessionId }
}
