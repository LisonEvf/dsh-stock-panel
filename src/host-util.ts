/**
 * src/host-util.ts — host 半运行时工具：Cordis ctx 类型 + 内置 TDX 桥接路由。
 *
 * 内置 TDX 桥接：browser 半 POST 同源路由 /api/stock-panel/call，host 半在
 * dsh web 进程内用 node-tdx 直连 TDX（src/host/tdx-data.ts），返回 JSON。
 * 远端 MCP 桥接（/api/stock-panel/mcp）已移除，无兜底。
 */

import { callEmbeddedTool, TdxToolError, TdxUnavailableError, UnsupportedToolError } from './host/tdx-data'
import { EMBEDDED_CALL_ROUTE } from './lib/endpoints'

/** host 半可用的 Cordis ctx 形状（仅列出本插件用到的面）。 */
export interface HostCtx {
  /** 注册一个 host 服务，暴露插件元数据。 */
  provide: (name: string, impl: unknown) => void
  /** 浏览器 HTTP 载体（dsh-host-webserver）。用于注册内置 TDX 桥接路由。 */
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
 * 在 ctx.webServer 上注册内置 TDX 桥接路由（进程内 node-tdx 直连）。
 *
 * 浏览器 POST /api/stock-panel/call {tool, args} → 本路由进程内调用内置
 * TDX 服务并返回 {ok:true,data}；失败返回 {ok:false, kind, error}：
 *   kind = 'business'    业务/参数错误（如实上抛）
 *   kind = 'unsupported' 未知工具名
 *   kind = 'unavailable' 连接不可用/禁用
 */
export function registerEmbeddedTdxBridge(webServer: {
  register: (route: {
    kind: 'exact' | 'prefix'
    path: string
    handler: (req: unknown, res: unknown) => void | Promise<void>
  }) => () => void
}): void {
  try {
    webServer.register({
      kind: 'exact',
      path: EMBEDDED_CALL_ROUTE,
      handler: async (req, res) => {
        const resW = res as {
          setHeader?: (k: string, v: string) => void
          end: (b: string) => void
          statusCode?: number
        }
        const send = (status: number, payload: unknown) => {
          if (resW.setHeader) {
            resW.statusCode = status
            resW.setHeader('Content-Type', 'application/json')
          }
          resW.end(JSON.stringify(payload))
        }
        try {
          const body = await readBody(req)
          const payload = body.payload as { tool?: string; args?: Record<string, unknown> }
          if (!payload || typeof payload.tool !== 'string') {
            send(400, { ok: false, kind: 'business', error: 'body must be {"tool": "...", "args": {...}}' })
            return
          }
          const data = await callEmbeddedTool(payload.tool, payload.args ?? {})
          send(200, { ok: true, data: data ?? null })
        } catch (err) {
          if (err instanceof TdxToolError) {
            send(200, { ok: false, kind: 'business', error: err.message })
          } else if (err instanceof UnsupportedToolError) {
            send(200, { ok: false, kind: 'unsupported', error: err.message })
          } else if (err instanceof TdxUnavailableError) {
            send(200, { ok: false, kind: 'unavailable', error: err.message })
          } else {
            send(500, { ok: false, kind: 'unavailable', error: (err as Error)?.message ?? String(err) })
          }
        }
      },
    })
    console.log(`[stock-panel] embedded TDX bridge registered at ${EMBEDDED_CALL_ROUTE}`)
  } catch (err) {
    console.warn('[stock-panel] embedded TDX bridge registration failed:', err)
  }
}

/** 读取 HTTP 请求体（JSON）。host 半各路由共用。 */
export async function readBody(req: unknown): Promise<{ payload: unknown; sessionId?: string }> {
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
  // 会话 ID 从请求头或请求体获取（保留字段以备未来桥接协议，当前无远端会话）
  const headers = (req as { headers?: Record<string, string> }).headers ?? {}
  const sessionId = headers['mcp-session-id'] ?? (payload as { sessionId?: string })?.sessionId
  return { payload, sessionId }
}
