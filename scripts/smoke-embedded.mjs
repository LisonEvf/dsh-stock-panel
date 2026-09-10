#!/usr/bin/env node
/**
 * smoke-embedded.mjs — 内置 TDX 服务（embedded）冒烟。
 *
 * 对内置 TDX 的 12 类工具逐一调用并断言基本形态（15 个行情工具现已全部内置）：
 *   - quote/board_members 行含 total_shares（股单位，>1e8）与 code；
 *   - kline datetime 为本地 ISO（无 Z/毫秒）；
 *   - tick_chart time 为 HH:mm:ss；
 *   - belong_board/capital_flow 已去 {data} 包层；
 *   - symbol_info 含 price_decimals；server_info 含 server_time；
 *   - goods_varieties 返回解码后的品种列表（name/price/change_pct 字段）。
 *
 * 需要先 `pnpm build`（引擎从 lib/index.js 导入）。用法：node scripts/smoke-embedded.mjs
 */
import { fileURLToPath, pathToFileURL } from 'node:url'

const engine = await import(pathToFileURL(fileURLToPath(new URL('../lib/index.js', import.meta.url))).href)
const { callEmbeddedTool, disposeTdxClient } = engine

const cases = [
  { name: 'quote', args: { market: 'SZ', code: '000001' }, check: (d) => Array.isArray(d) && d[0] && d[0].code === '000001' && d[0].total_shares > 1e8 && d[0].pre_iopv !== undefined },
  { name: 'kline', args: { market: 'SZ', code: '000001', count: 3 }, check: (d) => Array.isArray(d) && d.length > 0 && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/.test(String(d[0].datetime)) },
  { name: 'tick_chart', args: { market: 'SZ', code: '000001' }, check: (d) => Array.isArray(d) && d.every((r) => r.time == null || /^\d{2}:\d{2}:\d{2}$/.test(String(r.time))) },
  { name: 'board_members', args: { board_symbol: 'A', count: 2 }, check: (d) => Array.isArray(d) && d.length === 2 },
  { name: 'belong_board', args: { market: 'SZ', code: '000001' }, check: (d) => Array.isArray(d) && d.length > 0 && d[0].board_symbol_name != null },
  { name: 'capital_flow', args: { market: 'SZ', code: '000001' }, check: (d) => !!d && typeof d === 'object' && !Array.isArray(d) && d['今日主力净流入'] !== undefined },
  { name: 'symbol_info', args: { market: 'SZ', code: '000001' }, check: (d) => !!d && d.price_decimals === 2 && d.per_hand > 0 },
  { name: 'server_info', args: {}, check: (d) => !!d && /^\d{2}:\d{2}:\d{2}$/.test(String(d.server_time ?? '')) },
  { name: 'auction', args: { market: 'SZ', code: '000001' }, check: (d) => !!d && Array.isArray(d.items) },
  { name: 'goods_quotes', args: { market: 'US_STOCK', code: 'TSLA' }, check: (d) => Array.isArray(d) && d[0] && d[0].code === 'TSLA' },
  { name: 'goods_kline', args: { market: 'HK_MAIN_BOARD', code: '00700', count: 3 }, check: (d) => Array.isArray(d) && d.length > 0 },
  { name: 'goods_varieties', args: { market_id: 1, count: 3 }, check: (d) => Array.isArray(d) && d.every((r) => r.name != null && 'price' in r && 'change_pct' in r) },
]

let failed = 0
console.log('[smoke-embedded] 内置 TDX 服务冒烟开始')
for (const c of cases) {
  try {
    const d = await callEmbeddedTool(c.name, c.args)
    const ok = c.check(d)
    console.log(`  [${ok ? 'PASS' : 'FAIL'}] ${c.name}`)
    if (!ok) failed++
  } catch (e) {
    console.log(`  [FAIL] ${c.name} threw ${e.constructor.name}: ${e.message}`)
    failed++
  }
}
await disposeTdxClient()
console.log(failed ? `\n[smoke-embedded] RESULT: ${failed} 项失败` : '\n[smoke-embedded] RESULT: ALL PASSED')
process.exit(failed ? 1 : 0)
