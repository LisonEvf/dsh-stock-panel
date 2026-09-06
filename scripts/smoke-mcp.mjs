// scripts/smoke-mcp.mjs —— 协议冒烟（MIGRATION-PLAN §7.3 模板）
//
// 用法：
//   node scripts/smoke-mcp.mjs [--endpoint http://host:port/mcp]
//   MCP_ENDPOINT=... node scripts/smoke-mcp.mjs
//
// 流程固定：initialize → (capture mcp-session-id) → notifications/initialized → tools/call。
// 解析：按 SSE `data: ` 行收集 JSON；失败回退整体 JSON.parse（与 src/lib/mcp.ts parseMcpBody 一致）。
// 目的（N2/N7 待定论字段）：
//   - server_info：today / last_trading_day / server_time 语义（session-clock buildClock 输入）
//   - auction：matched 单位、unmatched 正负方向（买卖未匹配）、点位抽样（是否 09:15-09:24:57 全段）
//   - capital_flow：中文字段键清单（含 “5日主力净流入” 等，N7 面板展示依据）
//   - unusual：盘后是否退化为 09:15 竞价快照（event-stream 只读提示依据）

const DEFAULT_ENDPOINT = 'http://192.168.31.196:8007/mcp'

function endpoint() {
  const arg = process.argv.find((a) => a.startsWith('--endpoint='))
  return (arg ? arg.split('=')[1] : process.env.MCP_ENDPOINT) || DEFAULT_ENDPOINT
}

/** 收集 SSE data 行 → JSON；整体 JSON 兜底。 */
function parseResp(text) {
  const jsons = []
  for (const line of text.split(/\r?\n/)) {
    if (!line.startsWith('data:')) continue
    const body = line.slice(5).trim()
    if (body) {
      try { jsons.push(JSON.parse(body)) } catch { /* 跳过非 JSON data 行 */ }
    }
  }
  if (jsons.length) return jsons
  return [JSON.parse(text)] // 整体 JSON 兜底
}

async function rpc(endpointUrl, sessionId, body) {
  const resp = await fetch(endpointUrl, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
      'mcp-protocol-version': '2024-11-05',
      ...(sessionId ? { 'mcp-session-id': sessionId } : {}),
    },
    body: JSON.stringify(body),
  })
  const sid = resp.headers.get('mcp-session-id') || undefined
  const text = await resp.text()
  let parsed
  try { parsed = parseResp(text) } catch { parsed = [{ error: 'parse failed' }] }
  return { sid, parsed, raw: text.slice(0, 600) }
}

function findResult(parsed) {
  for (const m of parsed) {
    if (m && m.result !== undefined) return m.result
    if (m && m.error) return { __error: m.error }
  }
  return null
}

function extractText(result) {
  if (!result || result.__error) return null
  // 兼容 fastmcp wrap_result：优先 structuredContent.result
  if (result.structuredContent && result.structuredContent.result !== undefined) {
    return typeof result.structuredContent.result === 'string'
      ? result.structuredContent.result
      : JSON.stringify(result.structuredContent.result)
  }
  const content = result.content
  if (Array.isArray(content)) {
    const text = content.filter((c) => c && c.type === 'text' && typeof c.text === 'string').map((c) => c.text).join('\n').trim()
    if (text) return text
  }
  return null
}

function toJson(text) {
  if (!text) return null
  try { return JSON.parse(text) } catch { return null }
}

async function call(endpointUrl, sessionId, name, args) {
  const { sid, parsed, raw } = await rpc(endpointUrl, sessionId, {
    jsonrpc: '2.0',
    id: Math.floor(Math.random() * 1e6),
    method: 'tools/call',
    params: { name, arguments: args },
  })
  const result = findResult(parsed)
  const data = toJson(extractText(result))
  const err =
    (result && result.__error)
      ? JSON.stringify(result.__error)
      : data === null
        ? `raw=${raw}` // 文本没解出来 → 直接吐原始响应便于人工核对结构
        : undefined
  return { sid: sid || sessionId, data, err }
}

function summarize(label, obj) {
  if (obj === null) { console.log(`\n===== ${label} =====\n(null / 无文本)`); return }
  console.log(`\n===== ${label} =====`)
  if (Array.isArray(obj)) {
    if (!obj.length) { console.log('array[0]（空）'); return }
    console.log(`array[${obj.length}] first:`, JSON.stringify(obj[0], null, 0).slice(0, 400))
    return
  }
  console.log(JSON.stringify(obj, null, 0).slice(0, 800))
}

function show(label, res) {
  summarize(label, res.data)
  if (res.err) console.log('  ! ' + String(res.err).slice(0, 700))
}

async function main() {
  const ep = endpoint()
  console.log('endpoint:', ep)
  // 1) initialize
  const init = await rpc(ep, undefined, {
    jsonrpc: '2.0',
    id: 1,
    method: 'initialize',
    params: {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: { name: 'stock-panel-smoke', version: '1.0' },
    },
  })
  const sessionId = init.sid
  console.log('session-id:', sessionId || '(none)')
  // 2) initialized 通知（服务端无需响应）
  if (sessionId) {
    await rpc(ep, sessionId, { jsonrpc: '2.0', method: 'notifications/initialized', params: {} }).catch(() => {})
  }
  // 2.5) 工具清单核对（参数/输出 schema）
  {
    const { parsed } = await rpc(ep, sessionId, { jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} })
    const res = findResult(parsed)
    const tools = res && res.tools
    if (Array.isArray(tools)) {
      console.log(`tools: ${tools.length}`)
      for (const t of tools.slice(0, 12)) {
        const argNames = t.inputSchema && t.inputSchema.properties ? Object.keys(t.inputSchema.properties).join(',') : ''
        const hasOut = !!(t.outputSchema || (t.outputSchema === undefined && false))
        console.log(`  - ${t.name} (args: ${argNames})${hasOut ? ' outputSchema: yes' : ''}`)
      }
    } else {
      console.log('tools/list: 未解析到工具表', JSON.stringify(res || parsed).slice(0, 300))
    }
  }
  // 3) 逐工具冒烟
  const si = await call(ep, sessionId, 'server_info', {})
  show('server_info', si)
  const q = await call(ep, sessionId, 'quote', { market: 'SH', code: '603138' })
  show('quote SH603138', q)
  const au = await call(ep, sessionId, 'auction', { market: 'SH', code: '603138' })
  const auItems = au.data && au.data.items
  if (Array.isArray(auItems) && auItems.length) {
    console.log(`auction items=${auItems.length} first=${auItems[0].time} last=${auItems[auItems.length - 1].time}`)
    const neg = auItems.filter((p) => (p.unmatched ?? 0) < 0).length
    const pos = auItems.filter((p) => (p.unmatched ?? 0) > 0).length
    console.log(`unmatched: +${pos} / -${neg} (${auItems.length})  → 正负号是否同时存在（方向语义冒烟）`)
    console.log('matched sample:', auItems[0].matched, auItems[Math.floor(auItems.length / 2)].matched, auItems[auItems.length - 1].matched, '(单位疑似手/股，需与当日量对比)')
  } else {
    show('auction SH603138', au)
  }
  const cf = await call(ep, sessionId, 'capital_flow', { market: 'SH', code: '603138' })
  console.log('capital_flow keys:', cf.data ? Object.keys(cf.data) : cf.err || '(null)')
  const un = await call(ep, sessionId, 'unusual', { market: 'SH', count: 5 })
  const unArr = Array.isArray(un.data) ? un.data : un.data && un.data.rows ? un.data.rows : null
  if (unArr && unArr.length) console.log(`unusual[${unArr.length}] first time=${unArr[0].time} desc=${unArr[0].desc} (盘后若恒为 09:15 → 事件流只读提示依据)`)
  else show('unusual SH', un)
  console.log('\n冒烟完成 ✅（字段语义请人工对照上述输出）')
}

main().catch((e) => {
  console.error('冒烟失败：', e && e.message ? e.message : e)
  process.exit(1)
})
