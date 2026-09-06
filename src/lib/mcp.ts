/**
 * MCP over HTTP 客户端（JSON-RPC 2.0 + SSE / JSON）。
 *
 * 数据桥接：browser 半 POST 到同源路由 /api/stock-panel/mcp，
 * 由 host 半（src/index.ts 的 registerMcpBridge）转发到远端 MCP 服务器
 * （默认 http://192.168.31.196:8007/mcp）。host 半在服务端发起请求，
 * 无 CORS 问题，也无需 FastAPI 后端。
 *
 * 可通过全局变量 __DSH_MCP_ENDPOINT__ 覆盖远端 MCP 服务器地址。
 *
 * ⚠️ 响应解析：远端 opentdx MCP 服务器对 tools/* 请求始终以
 * `text/event-stream`（event: message / data: {...}）返回，个别实现也可能
 * 返回纯 JSON。旧版客户端用 `resp.json()` 直接解析，SSE 首帧必然抛错被
 * catch 吞掉，导致所有工具调用静默返回空。本版统一走 parseMcpBody：
 * 先按 SSE 逐行解析，解析不出再退回纯 JSON，二者都兼容。
 *
 * JSON-RPC 2.0 MCP over HTTP 流程：
 *   1. POST /api/stock-panel/mcp  body: initialize  → sessionId
 *   2. POST ...  body: notifications/initialized
 *   3. POST ...  body: tools/list   → 工具列表
 *   4. POST ...  body: tools/call    → 调用工具（带 sessionId）
 */

export interface McpTool {
  name: string
  description?: string
  inputSchema?: unknown
}

export interface McpCallResult {
  content?: Array<{ type: string; text?: string }>
  isError?: boolean
  [key: string]: unknown
}

/** 桥接路由（同源，由 host 半转发到远端 MCP 服务器）。 */
const BRIDGE_ROUTE = '/api/stock-panel/mcp'

/** 可通过全局变量 __DSH_MCP_ENDPOINT__ 覆盖远端 MCP 服务器地址（仅用于日志）。 */
export function getMcpEndpoint(): string {
  if (typeof window !== 'undefined' && (window as any).__DSH_MCP_ENDPOINT__) {
    return (window as any).__DSH_MCP_ENDPOINT__
  }
  return 'http://192.168.31.196:8007/mcp'
}

/**
 * 解析 MCP HTTP 响应体为 JSON-RPC 结果对象。
 *
 * 兼容两种 body：
 *  - SSE：`event: message\ndata: {...}\n\n`（远端主格式，可能分多条 data）
 *  - 纯 JSON：`{"jsonrpc":"2.0","result":{...}}`
 * 返回首个解析出的完整消息对象（含 id / result / error）。
 */
export async function parseMcpBody(resp: Response): Promise<any> {
  const text = await resp.text()
  if (!text.trim()) return null
  // 1) SSE：逐行收集 data: 载荷
  const dataLines: string[] = []
  for (const raw of text.split('\n')) {
    const line = raw.replace(/\r$/, '').trim()
    if (line.startsWith('data:')) {
      const payload = line.slice(5).trim()
      if (payload) dataLines.push(payload)
    }
  }
  if (dataLines.length > 0) {
    let last: any = null
    for (const payload of dataLines) {
      try {
        last = JSON.parse(payload)
      } catch {
        /* 跳过非 JSON data 行 */
      }
    }
    if (last) return last
  }
  // 2) 纯 JSON 兜底
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}

/** 从 JSON-RPC 消息中取 result；错误时抛 Error。 */
export function unwrapResult(msg: any): any {
  if (!msg) throw new Error('MCP 无响应')
  if (msg.error) {
    const detail = msg.error.message ?? JSON.stringify(msg.error)
    throw new Error(`MCP error: ${detail}`)
  }
  return msg.result
}

/** MCP 客户端：维护会话，调用工具。 */
export class McpClient {
  private endpoint: string
  private sessionId: string | null = null
  private initialized = false
  private initPromise: Promise<void> | null = null

  constructor(endpoint?: string) {
    this.endpoint = endpoint ?? getMcpEndpoint()
  }

  /** 初始化会话（幂等、并发安全）。 */
  initialize(): Promise<void> {
    if (this.initialized) return Promise.resolve()
    if (!this.initPromise) {
      this.initPromise = this.doInitialize().catch((err) => {
        this.initPromise = null
        throw err
      })
    }
    return this.initPromise
  }

  private async doInitialize(): Promise<void> {
    const resp = await this.rawCall({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: { name: 'dsh-stock-panel', version: '1.0' },
      },
    })
    // 从响应头取会话 ID（大小写不敏感）
    this.sessionId = resp.headers.get('mcp-session-id') ?? resp.headers.get('Mcp-Session-Id') ?? null
    const msg = await parseMcpBody(resp)
    unwrapResult(msg)
    // 通知初始化完成
    await this.rawCall({
      jsonrpc: '2.0',
      method: 'notifications/initialized',
    })
    this.initialized = true
  }

  /** 列出工具。 */
  async listTools(): Promise<McpTool[]> {
    if (!this.initialized) await this.initialize()
    const resp = await this.rawCall({
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/list',
      params: {},
    })
    const msg = await parseMcpBody(resp)
    const result = unwrapResult(msg)
    return (result?.tools as McpTool[]) ?? []
  }

  /** 判断错误是否属于「会话失效」（远端会话被回收/过期）。 */
  private isSessionError(err: unknown): boolean {
    const msg = (err as Error)?.message ?? ''
    return /session not found/i.test(msg) || /-32600/.test(msg)
  }

  /** 丢弃失效会话并重建（初始化幂等并发安全）。 */
  private async rebuildSession(): Promise<void> {
    this.sessionId = null
    this.initialized = false
    this.initPromise = null
    await this.initialize()
  }

  /** 调用工具，返回 result（含 content / isError）。会话失效时自动重建并重试一次。 */
  async callTool(name: string, args: Record<string, unknown> = {}): Promise<McpCallResult> {
    let retried = false
    for (;;) {
      if (!this.initialized) await this.initialize()
      try {
        const resp = await this.rawCall({
          jsonrpc: '2.0',
          id: 3,
          method: 'tools/call',
          params: { name, arguments: args },
        })
        const msg = await parseMcpBody(resp)
        const result = unwrapResult(msg)
        return (result ?? {}) as McpCallResult
      } catch (err) {
        // 远端会话被回收（实测 opentdx 服务器会话会偶发过期/被挤掉）：
        // 重建会话重试一次，避免整页轮询从此全部失败直到刷新。
        if (!retried && this.isSessionError(err)) {
          retried = true
          await this.rebuildSession().catch(() => undefined)
          continue
        }
        throw err
      }
    }
  }

  /** 原始 JSON-RPC 请求，走 host 半桥接路由。默认 15s 超时，防单请求卡死轮询。 */
  private async rawCall(payload: unknown, timeoutMs = 15_000): Promise<Response> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
    }
    if (this.sessionId) {
      headers['Mcp-Session-Id'] = this.sessionId
    }
    const ac = new AbortController()
    const timer = setTimeout(() => ac.abort(), timeoutMs)
    try {
      const resp = await fetch(BRIDGE_ROUTE, {
        method: 'POST',
        headers,
        body: JSON.stringify({ ...(payload as object), sessionId: this.sessionId }),
        signal: ac.signal,
      })
      if (!resp.ok) {
        throw new Error(`MCP request failed: ${resp.status} ${resp.statusText}`)
      }
      return resp
    } catch (err) {
      if (ac.signal.aborted) {
        throw new Error(`MCP 请求超时(${timeoutMs}ms): ${(payload as any)?.method ?? ''}`)
      }
      throw err
    } finally {
      clearTimeout(timer)
    }
  }
}

/** 全局单例。 */
let client: McpClient | null = null

export function getMcp(): McpClient {
  if (!client) client = new McpClient()
  return client
}
