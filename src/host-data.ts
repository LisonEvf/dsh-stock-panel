/**
 * host 半行情数据客户端（对话工具用，Node 直连，零 FastAPI）。
 *
 * 数据源与面板同源：
 *   1) 本机 opentdx JSON 网关（默认 http://127.0.0.1:8017/call，POST {tool,args} → {ok,data}），
 *      env DSH_TDX_GATEWAY 可覆盖；
 *   2) 不可达/超时 → 远端 MCP（默认 http://192.168.31.196:8007/mcp，JSON-RPC+SSE），
 *      env DSH_MCP_ENDPOINT 可覆盖；会话（mcp-session-id）模块级缓存，失效自动重建。
 *
 * 返回 payload 与浏览器端 stock-data 同构（quote/kline/tick_chart/unusual），
 * 解析规则一致：数组 / {rows|data|items} / 单对象 → 数组或对象。
 *
 * ⚠️ 本模块只允许被 host 半（Node）代码使用；不得被 client 半 import。
 */

const REMOTE_MCP = 'http://192.168.31.196:8007/mcp'
const LOCAL_GW = 'http://127.0.0.1:8017'

function env(key: string): string | undefined {
  if (typeof process !== 'undefined' && process.env) return process.env[key]
  return undefined
}

// ===== 本机网关 =====

async function gatewayCall(name: string, args: Record<string, unknown>): Promise<unknown> {
  const ac = new AbortController()
  const timer = setTimeout(() => ac.abort(), 8000)
  try {
    const endpoint = env('DSH_TDX_GATEWAY') || LOCAL_GW
    const resp = await fetch(`${endpoint}/call`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tool: name, args }),
      signal: ac.signal,
    })
    if (!resp.ok) throw new Error(`gateway HTTP ${resp.status}`)
    const j = (await resp.json()) as { ok?: boolean; data?: unknown; error?: unknown; message?: unknown }
    if (!j || j.ok !== true) {
      throw new Error(`gateway ${name}: ${(j?.error ?? j?.message) ?? 'unknown'}`)
    }
    return j.data ?? null
  } finally {
    clearTimeout(timer)
  }
}

// ===== 远端 MCP（JSON-RPC over HTTP，SSE body） =====

interface Session {
  endpoint: string
  id: string | null
}

let session: Session = { endpoint: '', id: null }

/** 解析 MCP HTTP 响应体（SSE data: 行优先，纯 JSON 兜底，与 browser 端一致）。 */
function parseMcpBody(text: string): unknown {
  if (!text.trim()) return null
  const dataLines: string[] = []
  for (const raw of text.split('\n')) {
    const line = raw.replace(/\r$/, '').trim()
    if (line.startsWith('data:')) {
      const payload = line.slice(5).trim()
      if (payload) dataLines.push(payload)
    }
  }
  if (dataLines.length) {
    let last: unknown = null
    for (const payload of dataLines) {
      try {
        last = JSON.parse(payload)
      } catch {
        /* skip */
      }
    }
    if (last) return last
  }
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}

async function rpc(
  endpoint: string,
  payload: Record<string, unknown>,
  sid: string | null,
): Promise<{ msg: unknown; sessionId: string | null }> {
  const ac = new AbortController()
  const timer = setTimeout(() => ac.abort(), 15000)
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Accept: 'application/json, text/event-stream',
  }
  if (sid) headers['Mcp-Session-Id'] = sid
  try {
    const resp = await fetch(endpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify({ ...payload, sessionId: sid }),
      signal: ac.signal,
    })
    if (!resp.ok) throw new Error(`MCP HTTP ${resp.status}`)
    const sessionId = resp.headers.get('mcp-session-id') ?? resp.headers.get('Mcp-Session-Id')
    const msg = await parseMcpBody(await resp.text())
    return { msg, sessionId }
  } finally {
    clearTimeout(timer)
  }
}

async function ensureSession(endpoint: string): Promise<string | null> {
  if (session.endpoint === endpoint && session.id) return session.id
  const { msg, sessionId } = await rpc(endpoint, { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'dsh-stock-panel-host', version: '1.1.0' } } }, null)
  if ((msg as { error?: unknown })?.error) throw new Error('MCP initialize failed')
  await rpc(endpoint, { jsonrpc: '2.0', method: 'notifications/initialized' }, sessionId)
  session = { endpoint, id: sessionId }
  return sessionId
}

async function remoteMcpCall(name: string, args: Record<string, unknown>): Promise<unknown> {
  const endpoint = env('DSH_MCP_ENDPOINT') || REMOTE_MCP
  const tryCall = async (): Promise<unknown> => {
    const sid = await ensureSession(endpoint)
    const { msg } = await rpc(endpoint, { jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name, arguments: args } }, sid)
    const m = msg as { error?: { message?: string }; result?: unknown } | null
    if (m?.error) throw new Error(`MCP ${name}: ${m.error.message ?? 'error'}`)
    return m?.result ?? null
  }
  try {
    return await tryCall()
  } catch (err) {
    // 会话失效（session not found）→ 重建一次
    const msgText = (err as Error).message ?? ''
    if (/session not found/i.test(msgText) || /-32600/.test(msgText)) {
      session = { endpoint: '', id: null }
      return await tryCall()
    }
    throw err
  }
}

// ===== 统一分发 + payload 解析 =====

/** 从工具结果取文本 JSON（content 文本优先，structuredContent.result 兜底）。 */
function extractPayload(raw: unknown): unknown {
  const r = raw as { content?: Array<{ type?: string; text?: string }>; structuredContent?: unknown } | null
  if (!r) return null
  const text = r.content
    ?.filter((c) => c.type === 'text' && c.text)
    .map((c) => c.text)
    .join('\n')
    ?.trim()
  if (text) {
    try {
      return JSON.parse(text)
    } catch {
      /* fall through */
    }
  }
  const sc = r.structuredContent
  if (sc && typeof sc === 'object' && 'result' in (sc as object)) {
    return (sc as { result?: unknown }).result ?? null
  }
  return sc ?? null
}

function toList<T = unknown>(input: unknown): T[] {
  if (input == null) return []
  if (Array.isArray(input)) return input as T[]
  if (typeof input === 'string') {
    if (!input.trim()) return []
    try {
      const d = JSON.parse(input)
      return toList<T>(d)
    } catch {
      return []
    }
  }
  const obj = input as { rows?: unknown; data?: unknown; items?: unknown }
  if (Array.isArray(obj.rows)) return obj.rows as T[]
  if (Array.isArray(obj.data)) return obj.data as T[]
  if (Array.isArray(obj.items)) return obj.items as T[]
  if (typeof input === 'object') return [input as T]
  return []
}

/** 统一调用：网关 → 远端 MCP 兜底；返回与面板一致的工具 payload。 */
export async function hostToolCall(name: string, args: Record<string, unknown>): Promise<unknown> {
  try {
    return await gatewayCall(name, args)
  } catch (gwErr) {
    try {
      const raw = await remoteMcpCall(name, args)
      const payload = extractPayload(raw)
      if (payload == null && (raw as { isError?: boolean })?.isError) {
        throw new Error(String(gwErr instanceof Error ? gwErr.message : gwErr))
      }
      return payload ?? null
    } catch (mcpErr) {
      throw new Error(`行情源不可达（网关+远端 MCP）: ${(mcpErr as Error).message}`)
    }
  }
}

// ===== 对话工具用的公开取数函数（返回数组/对象，失败抛错） =====

export interface HostQuote {
  market: number
  code: string
  name?: string
  close: number
  pre_close: number
  open: number
  high: number
  low: number
  vol?: number
  vol_ratio?: number
  amount?: number
  turnover?: number
  [key: string]: unknown
}

export async function hostQuote(market: string, code: string): Promise<HostQuote> {
  const payload = await hostToolCall('quote', { market, code })
  const rows = toList(payload)
  if (!rows.length) throw new Error(`${market}${code} 暂无报价`)
  return rows[0] as HostQuote
}

export async function hostKline(market: string, code: string, count = 60): Promise<Record<string, unknown>[]> {
  const payload = await hostToolCall('kline', { market, code, period: 'DAILY', count })
  return toList<Record<string, unknown>>(payload)
}

export async function hostTick(market: string, code: string): Promise<Record<string, unknown>[]> {
  const payload = await hostToolCall('tick_chart', { market, code })
  return toList<Record<string, unknown>>(payload)
}

export async function hostUnusual(market: string, count = 20): Promise<Record<string, unknown>[]> {
  const payload = await hostToolCall('unusual', { market, count })
  return toList<Record<string, unknown>>(payload)
}
