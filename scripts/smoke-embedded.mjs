#!/usr/bin/env node
/**
 * smoke-embedded.mjs — 内置 TDX 服务（embedded）真机冒烟。
 *
 * **覆盖面**：数据层行情工具**全部**（`EMBEDDED_TOOL_NAMES` 里除 4 个 HIST 之外的全部 15 个；
 * HIST 四个由 `smoke-concept-classes.mjs` 覆盖）。数量从唯一定义源数出来，不写死 ——
 * 此前这里只跑 12 个、README 却写"19 工具冒烟"，两边长期不一致。
 *
 * **断言重点**（都是实测踩过的坑）：
 *   - quote/board_members 行含 total_shares（股单位，>1e8）与 code；
 *   - kline datetime 为本地 ISO（无 Z/毫秒）；tick_chart time 为 HH:mm:ss；
 *   - belong_board/capital_flow 已去 {data} 包层；symbol_info 含 price_decimals；
 *   - **排序契约**：`count > 页大小(80)` 时 DESC 必须全局降序 —— node-tdx 曾用
 *     `unshift` 拼页导致页序反转（全 A 榜 DESC 取回升序，"选股筛选"第一屏给最弱命中）；
 *   - **参数白名单**：未知 sort_type 必须报错，不得静默回落成涨幅榜。
 *
 * 需要先 `pnpm build`（引擎从 lib/index.js 导入）+ 能连到 TDX。用法：node scripts/smoke-embedded.mjs
 */
import { fileURLToPath, pathToFileURL } from 'node:url'

const engine = await import(pathToFileURL(fileURLToPath(new URL('../lib/index.js', import.meta.url))).href)
const { callEmbeddedTool, disposeTdxClient, EMBEDDED_TOOL_NAMES } = engine

/** 涨跌幅（%）；无效报价返回 null。 */
function pctOf(r) {
  const c = Number(r.close)
  const p = Number(r.pre_close)
  if (!(c > 0) || !(p > 0)) return null
  return ((c - p) / p) * 100
}

/** 顺序违规的最大幅度（pp）；只比有效报价行，容差 1e-6，同值浮点噪声不算违规。 */
function maxOrderViolation(rows, dir) {
  const p = rows.map(pctOf).filter((x) => x !== null)
  let max = 0
  for (let i = 1; i < p.length; i++) {
    const delta = dir === 'desc' ? p[i] - p[i - 1] : p[i - 1] - p[i]
    if (delta > 1e-6) max = Math.max(max, delta)
  }
  return max
}

const cases = [
  { name: 'quote', args: { market: 'SZ', code: '000001' }, check: (d) => Array.isArray(d) && d[0] && d[0].code === '000001' && d[0].total_shares > 1e8 && d[0].pre_iopv !== undefined },
  { name: 'kline', args: { market: 'SZ', code: '000001', count: 3 }, check: (d) => Array.isArray(d) && d.length > 0 && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/.test(String(d[0].datetime)) },
  { name: 'tick_chart', args: { market: 'SZ', code: '000001' }, check: (d) => Array.isArray(d) && d.every((r) => r.time == null || /^\d{2}:\d{2}:\d{2}$/.test(String(r.time))) },
  { name: 'transaction', args: { market: 'SZ', code: '000001', count: 5 }, check: (d) => Array.isArray(d) && d.every((r) => r.time == null || /^\d{2}:\d{2}:\d{2}$/.test(String(r.time))) },
  { name: 'unusual', args: { market: 'SZ', count: 5 }, check: (d) => Array.isArray(d) },
  { name: 'market_monitor', args: { market: 'SZ', count: 5 }, check: (d) => Array.isArray(d) },
  { name: 'board_members', args: { board_symbol: 'A', count: 2 }, check: (d) => Array.isArray(d) && d.length === 2 },
  { name: 'belong_board', args: { market: 'SZ', code: '000001' }, check: (d) => Array.isArray(d) && d.length > 0 && d[0].board_symbol_name != null },
  { name: 'capital_flow', args: { market: 'SZ', code: '000001' }, check: (d) => !!d && typeof d === 'object' && !Array.isArray(d) && d['今日主力净流入'] !== undefined },
  { name: 'symbol_info', args: { market: 'SZ', code: '000001' }, check: (d) => !!d && d.price_decimals === 2 && d.per_hand > 0 },
  { name: 'server_info', args: {}, check: (d) => !!d && /^\d{2}:\d{2}:\d{2}$/.test(String(d.server_time ?? '')) },
  { name: 'auction', args: { market: 'SZ', code: '000001' }, check: (d) => !!d && Array.isArray(d.items) },
  { name: 'goods_quotes', args: { market: 'US_STOCK', code: 'TSLA' }, check: (d) => Array.isArray(d) && d[0] && d[0].code === 'TSLA' },
  { name: 'goods_kline', args: { market: 'HK_MAIN_BOARD', code: '00700', count: 3 }, check: (d) => Array.isArray(d) && d.length > 0 },
  { name: 'goods_varieties', args: { market_id: 1, count: 3 }, check: (d) => Array.isArray(d) && d.every((r) => r.name != null && 'price' in r && 'change_pct' in r) },
  // ── 排序契约（跨页：count > 80 才会走到分页拼接）──
  {
    name: 'board_members',
    label: '排序契约 DESC 跨页（count=200）',
    args: { board_symbol: 'A', count: 200, sort_type: 'CHANGE_PCT', sort_order: 'DESC' },
    check: (d) => Array.isArray(d) && d.length === 200 && maxOrderViolation(d, 'desc') < 0.01,
  },
  {
    name: 'board_members',
    label: '排序契约 ASC 跨页（count=200）',
    args: { board_symbol: 'A', count: 200, sort_type: 'CHANGE_PCT', sort_order: 'ASC' },
    check: (d) => Array.isArray(d) && d.length === 200 && maxOrderViolation(d, 'asc') < 0.01,
  },
]

let failed = 0
console.log('[smoke-embedded] 内置 TDX 服务冒烟开始')
if (Array.isArray(EMBEDDED_TOOL_NAMES)) {
  const covered = new Set(cases.map((c) => c.name))
  const hist = EMBEDDED_TOOL_NAMES.filter((n) => n.startsWith('hist_concept_'))
  const missing = EMBEDDED_TOOL_NAMES.filter((n) => !hist.includes(n) && !covered.has(n))
  console.log(`  覆盖面：数据层 ${EMBEDDED_TOOL_NAMES.length} 个 = 本脚本 ${covered.size} 个行情 + ${hist.length} 个 HIST（由 smoke-concept-classes 覆盖）`)
  if (missing.length > 0) {
    console.log(`  [FAIL] 未被任何冒烟覆盖的工具：${missing.join('、')}`)
    failed++
  }
} else {
  console.log('  [FAIL] lib/index.js 未导出 EMBEDDED_TOOL_NAMES —— 覆盖面无法核对（工具清单必须单源可查）')
  failed++
}
for (const c of cases) {
  const label = c.label ?? c.name
  try {
    const d = await callEmbeddedTool(c.name, c.args)
    const ok = c.check(d)
    console.log(`  [${ok ? 'PASS' : 'FAIL'}] ${label}`)
    if (!ok) failed++
  } catch (e) {
    console.log(`  [FAIL] ${label} threw ${e.constructor.name}: ${e.message}`)
    failed++
  }
}

// 参数白名单：未知 sort_type 必须报错（旧实现静默回落 CHANGE_PCT，把"成交额榜"变成"涨幅榜"）
try {
  await callEmbeddedTool('board_members', { board_symbol: 'A', count: 5, sort_type: 'AMOUNT' })
  console.log('  [FAIL] 未知 sort_type 未被拒绝（静默回落）')
  failed++
} catch (e) {
  const ok = /invalid sort_type/.test(String(e.message))
  console.log(`  [${ok ? 'PASS' : 'FAIL'}] 未知 sort_type 如实报错：${e.message.slice(0, 80)}`)
  if (!ok) failed++
}

await disposeTdxClient()
console.log(failed ? `\n[smoke-embedded] RESULT: ${failed} 项失败` : '\n[smoke-embedded] RESULT: ALL PASSED')
process.exit(failed ? 1 : 0)
