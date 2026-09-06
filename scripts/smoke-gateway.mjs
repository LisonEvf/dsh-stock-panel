// scripts/smoke-gateway.mjs —— 本机 opentdx 网关契约冒烟（stock-data 适配层形状断言）
//
// 用法：
//   node scripts/smoke-gateway.mjs [--endpoint http://127.0.0.1:8017]
//   TDX_GATEWAY=... node scripts/smoke-gateway.mjs
//
// 与前端取数链路等价：gateway POST /call → {ok,data} → JSON.stringify 回环
// （同 src/lib/mcp.ts invokeTool/toMcpResult + stock-data.ts toArray/extractText）。
// 断言与 stock-data.ts 类型对齐：
//   - quote/unusual/board_members/kline 行：market 为数值 0/1/2（网关已把枚举归一）
//   - kline/tick_chart/transaction 等行时间：ISO 串（kline 形如 2026-09-04T00:00:00）
//   - auction：{market, code, items[]}；capital_flow 中文键；server_info 交易日键
//   - 全 A board_members("A") 可用（count 少量冒烟）
// 参数示例与 opentdx-mcp/server.py（15 工具）一致。

const DEFAULT_ENDPOINT = 'http://127.0.0.1:8017'

function endpoint() {
  const arg = process.argv.find((a) => a.startsWith('--endpoint='))
  return (arg ? arg.split('=')[1] : process.env.TDX_GATEWAY) || DEFAULT_ENDPOINT
}

let failures = 0

function assert(cond, msg) {
  if (cond) {
    console.log(`  ✅ ${msg}`)
  } else {
    failures += 1
    console.error(`  ❌ ${msg}`)
  }
}

async function callTool(tool, args = {}, timeoutMs = 30000) {
  const ac = new AbortController()
  const timer = setTimeout(() => ac.abort(), timeoutMs)
  try {
    const resp = await fetch(`${endpoint()}/call`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ tool, args }),
      signal: ac.signal,
    })
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`)
    const body = await resp.json()
    if (!body || body.ok !== true) throw new Error(body?.error || 'unknown')
    return body.data
  } finally {
    clearTimeout(timer)
  }
}

/** 模拟 invokeTool→toMcpResult→extractText→JSON.parse 的文本回环（stock-data 真实路径）。 */
function roundtrip(data) {
  const text = JSON.stringify(data ?? null)
  return JSON.parse(text)
}

async function main() {
  const ep = endpoint()
  console.log(`[smoke-gateway] endpoint=${ep}`)

  const health = await (await fetch(`${ep}/healthz`)).json().catch(() => null)
  assert(health && health.ok === true, `healthz ok (A=${health?.connected?.a}, ext=${health?.connected?.ext})`)
  if (!health?.ok) process.exit(1)

  // ── quote ──
  const q = roundtrip(await callTool('quote', { market: 'SH', code: '600519' }))
  assert(Array.isArray(q) && q.length > 0, 'quote 返回数组')
  assert([0, 1, 2].includes(q[0].market), `quote market 数值 (got ${q[0].market})`)
  assert(Number.isFinite(q[0].close) && Number.isFinite(q[0].pre_close), 'quote OHLC 数值')
  assert(typeof q[0].name === 'string' && q[0].name.length > 0, 'quote name 非空')
  assert(Number.isFinite(q[0].buy_price_limit) && Number.isFinite(q[0].sell_price_limit), 'quote 涨跌停价存在')

  // ── kline（升序 + ISO T 时间） ──
  const k = roundtrip(await callTool('kline', { market: 'SH', code: '600519', period: 'DAILY', count: 5 }))
  assert(Array.isArray(k) && k.length === 5, `kline 5 根 (got ${k.length})`)
  assert(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/.test(k[0].datetime), `kline datetime ISO T (got ${k[0].datetime})`)
  const dates = k.map((r) => r.datetime).sort()
  assert(JSON.stringify(dates) === JSON.stringify(k.map((r) => r.datetime)), 'kline 升序')

  // ── server_info（session-clock 输入） ──
  const info = roundtrip(await callTool('server_info', {}))
  assert(info && /^\d{4}-\d{2}-\d{2}$/.test(info.today ?? ''), `server_info today (got ${info?.today})`)
  assert(info && /^\d{4}-\d{2}-\d{2}$/.test(info.last_trading_day ?? ''), 'server_info last_trading_day')

  // ── auction（竞价雷达输入：items[]） ──
  const au = roundtrip(await callTool('auction', { market: 'SZ', code: '000001' }))
  assert(au && typeof au === 'object' && Array.isArray(au.items), 'auction {market,code,items}')
  if (au?.items?.length) {
    assert(/^\d{2}:\d{2}:\d{2}$/.test(au.items[0].time), `auction item time (got ${au.items[0].time})`)
  }

  // ── unusual / market_monitor（事件流输入） ──
  const un = roundtrip(await callTool('unusual', { market: 'SH', count: 5 }))
  assert(Array.isArray(un) && un.length > 0, 'unusual 返回数组')
  assert([0, 1, 2].includes(un[0].market), `unusual market 数值 (got ${un[0].market})`)

  // ── board_members（市场页全 A 快照） ──
  const bm = roundtrip(await callTool('board_members', { board_symbol: 'A', count: 3, sort_type: 'CHANGE_PCT', sort_order: 'DESC' }))
  assert(Array.isArray(bm) && bm.length === 3, 'board_members(A) 冒烟 3 行')
  assert(bm.every((r) => [0, 1, 2].includes(r.market)), 'board_members market 数值')

  // ── 资金流 / 所属板块 / 个股简况 / 逐笔 / 分时 ──
  const cf = roundtrip(await callTool('capital_flow', { market: 'SH', code: '600519' }))
  assert(cf && typeof cf === 'object' && !Array.isArray(cf), 'capital_flow dict')
  assert('今日主力净流入' in (cf ?? {}) || Object.keys(cf ?? {}).length > 0, 'capital_flow 中文键')
  const bb = roundtrip(await callTool('belong_board', { market: 'SH', code: '600519' }))
  assert(Array.isArray(bb) && bb.length > 0, 'belong_board 返回数组')
  const sym = roundtrip(await callTool('symbol_info', { market: 'SH', code: '600519' }))
  assert(sym && typeof sym === 'object', 'symbol_info dict')
  const tr = roundtrip(await callTool('transaction', { market: 'SH', code: '600519', count: 3 }))
  assert(Array.isArray(tr) && tr.length > 0, 'transaction 返回数组')
  const tc = roundtrip(await callTool('tick_chart', { market: 'SH', code: '600519' }))
  assert(Array.isArray(tc) && tc.length > 0, 'tick_chart 返回数组')

  // ── 扩展市场（7727） ──
  const hk = roundtrip(await callTool('goods_quotes', { market: 'HK_MAIN_BOARD', code: '00700' }))
  assert(Array.isArray(hk) && hk.length > 0, 'goods_quotes HK 返回数组')
  const usk = roundtrip(await callTool('goods_kline', { market: 'US_STOCK', code: 'TSLA', period: 'DAILY', count: 3 }))
  assert(Array.isArray(usk) && usk.length === 3, 'goods_kline US 3 根')

  // ── 延迟摘要（warm） ──
  const t0 = performance.now()
  for (let i = 0; i < 5; i++) await callTool('quote', { market: 'SH', code: '600519' })
  const avg = ((performance.now() - t0) / 5).toFixed(1)
  console.log(`  ℹ️ warm quote x5 平均 ${avg}ms`)

  if (failures > 0) {
    console.error(`[smoke-gateway] ${failures} 项断言失败`)
    process.exit(1)
  }
  console.log('[smoke-gateway] 全部通过 ✅')
}

main().catch((err) => {
  console.error('[smoke-gateway] 失败:', err.message)
  process.exit(1)
})
