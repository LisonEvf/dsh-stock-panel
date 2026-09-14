// acceptance/probe-war-materials-live.mjs —— 「作战思路」**素材链路的真机取证**（真数据源 + 假模型）。
//
// 为什么必须有这一条（与 probe-structure-live.mjs 同一个理由）：
// 「以其他板块为基础」这句承诺的载体是 `lib/war-plan-collect.ts` —— 它要去行情、自挖板块、
// 选股、复盘、竞价、持仓/自选各取一块，压成 ≤24KB 交给模型。**离线单测喂的是手工素材**，
// 证明不了"真数据下这条路走得通"：字段名漂了、引擎没数据、竞价时段没到、预设无命中 ——
// 这几种情况单测全绿而线上等于什么都没给模型（naming 那条线就栽在"假数据照着错代码写"）。
//
// 手法：把 client 侧的采集链（TS 源码）用 esbuild 打进一个临时入口在 Node 里跑，
// 只把两处"浏览器才有的东西"换成真的/假的：
//   · `fetch('/api/stock-panel/call')` → 转发到**构建产物 lib/index.js 的 `callEmbeddedTool`**
//     （与生产完全同一条内置 TDX 数据链）；
//   · LLM 不参与（本脚本只验素材与护栏，模型输出与结论无关，可复现可重跑）。
//
// 看四件事：
//   ① **素材块到位**：板块榜（方向名池）/ 自挖类 / 涨停梯队 / 选股候选 / 事件流 / 复盘存档 / 持仓；
//   ② **缺口如实记录**：取不到的块必须在 `missing` 里，而不是静默为空；
//   ③ **上下文体积**在 24KB（`AI_CONTEXT_MAX_BYTES`）以内；
//   ④ **护栏对真素材有效**：故意喂一份越界思路（素材外的票 + 自造的板块名 + 编造的引文），
//      断言被剔除/标注且白名单规模正确。
//
// 用法：pnpm build && node acceptance/probe-war-materials-live.mjs
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { spawnSync } from 'node:child_process'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const HOST_BUNDLE = join(ROOT, 'lib', 'index.js')
if (!existsSync(HOST_BUNDLE)) {
  console.error('[war-materials] 缺 lib/index.js —— 先跑 pnpm build')
  process.exit(1)
}

let failures = 0
const check = (cond, msg, extra = '') => {
  if (cond) console.log(`  ✅ ${msg}${extra ? '：' + extra : ''}`)
  else {
    failures += 1
    console.error(`  ❌ ${msg}${extra ? '：' + extra : ''}`)
  }
}

/* ── 1) 生成临时入口（TS → esbuild → Node ESM）────────────────────────────── */

const entry = `
import { callToolJson } from ${JSON.stringify(join(ROOT, 'src/lib/stock-data.ts'))}

/* ── 先把浏览器的两样东西补上（必须在任何取数之前）────────────────────────────
 * ① fetch('/api/stock-panel/call') → 转发到**构建产物**的内置 TDX 桥接
 *    （与生产同一条数据链；spawn 出来的子进程没有父进程的 stub，所以桩必须打在这里）；
 * ② localStorage：Node 里没有，未存档的 store 会走 try/catch 兜底（与隐私模式同路径）。 */
const hostMod = await import(${JSON.stringify(pathToFileURL(HOST_BUNDLE).href)})
const callEmbeddedTool = hostMod.callEmbeddedTool
if (typeof callEmbeddedTool !== 'function') {
  console.error('[war-materials] lib/index.js 没导出 callEmbeddedTool（host 半接口变了？）')
  process.exit(1)
}
const store = new Map()
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => { store.set(k, String(v)) },
  removeItem: (k) => { store.delete(k) },
}
const realFetch = globalThis.fetch
globalThis.fetch = async (url, init) => {
  if (String(url).includes('/api/stock-panel/call')) {
    const body = JSON.parse(String(init?.body ?? '{}'))
    try {
      const data = await callEmbeddedTool(body.tool, body.args ?? {})
      return new Response(JSON.stringify({ ok: true, data }), { status: 200, headers: { 'Content-Type': 'application/json' } })
    } catch (e) {
      return new Response(JSON.stringify({ ok: false, error: String(e?.message ?? e) }), { status: 200, headers: { 'Content-Type': 'application/json' } })
    }
  }
  return realFetch(url, init)
}

import { collectWarMaterials } from ${JSON.stringify(join(ROOT, 'src/lib/war-plan-collect.ts'))}
import { buildWarContext } from ${JSON.stringify(join(ROOT, 'src/lib/war-plan.ts'))}
import { guardWarPlan } from ${JSON.stringify(join(ROOT, 'src/lib/war-plan-guard.ts'))}
import { fetchAllA, computeBreadth } from ${JSON.stringify(join(ROOT, 'src/lib/market.ts'))}
import { loadLadder } from ${JSON.stringify(join(ROOT, 'src/lib/ladder.ts'))}
import { computeRegime } from ${JSON.stringify(join(ROOT, 'src/lib/regime.ts'))}
import { judgeSituation } from ${JSON.stringify(join(ROOT, 'src/lib/situation.ts'))}
import { captureOnce, getEvents } from ${JSON.stringify(join(ROOT, 'src/lib/event-stream.ts'))}
import { detectBoardPulse } from ${JSON.stringify(join(ROOT, 'src/lib/board-pulse.ts'))}
import { getPositions } from ${JSON.stringify(join(ROOT, 'src/lib/positions.ts'))}
import { getWatchlist } from ${JSON.stringify(join(ROOT, 'src/lib/watchlist-store.ts'))}
import { buildClock } from ${JSON.stringify(join(ROOT, 'src/lib/session-clock.ts'))}
import { stageOf, minuteOfDay } from ${JSON.stringify(join(ROOT, 'src/lib/stage.ts'))}

const day = new Date().toISOString().slice(0, 10)
const info = await callToolJson('server_info', {})
const clock = buildClock(info ?? null)
const stage = stageOf(clock.phase, minuteOfDay(new Date()))

let breadth = null
let ladder = null
let regime = null
let situation = null
let pulses = []
let allRows = null
let loadError = ''
try {
  await captureOnce()
  allRows = await fetchAllA(true)
  breadth = computeBreadth(allRows)
  ladder = await loadLadder(undefined, { force: true })
  const maxStreak = ladder.limitUp.reduce((m, s) => Math.max(m, s.streak), 0)
  const noMarket = breadth.up + breadth.down + ladder.limitUp.length + ladder.limitDownCount === 0
  regime = noMarket ? null : computeRegime({
    limitUp: ladder.limitUp.length, limitDown: ladder.limitDownCount, maxStreak,
    promoteRate: 0.4, brokenRate: 0.2, firstBoardPremium: 1.5,
    upRatio: breadth.up / Math.max(1, breadth.up + breadth.down),
    amountYi: breadth.amountSum / 1e8,
  })
  const heat = noMarket ? [] : ladder.boards.slice(0, 8).map((b) => ({ boardSymbol: b.boardSymbol, name: b.name }))
  pulses = await detectBoardPulse(heat, new Map(), undefined, 4)
  situation = regime === null ? null : judgeSituation({
    regime, events: getEvents(), pulses,
    oldLeaderAtLimit: ladder.limitUp.some((x) => x.streak >= 4), oldLeaderBroken: false,
    highStreakCount: ladder.limitUp.filter((x) => x.streak >= 4).length,
    lowNewLimitUp: ladder.limitUp.filter((x) => x.streak === 1).length, indexPct: 0,
    upRatio: breadth.up / Math.max(1, breadth.up + breadth.down), limitDown: ladder.limitDownCount,
    promoteRate: 0.4, brokenRate: 0.2, limitUp: ladder.limitUp.length,
  })
} catch (e) {
  loadError = String(e?.message ?? e)
}

const materials = await collectWarMaterials({
  day, stage, phase: clock.phase, clockText: '00:00', windowNote: 'probe',
  breadth, regime, situation, ladder, events: getEvents(), pulses,
  positions: getPositions(), watchlist: getWatchlist(), allRows,
})

const ctx = buildWarContext(materials)

/* 故意越界：素材外的票（工商银行）/ 自造的板块名 / 编造的引文 —— 护栏必须拦住并留痕 */
const outsideSymbol = 'SH601398'
const bogusSector = '人形机器人核心零部件'
const probePlan = {
  insufficient: false, reason: '', summary: 'probe', stance: 'attack',
  sectors: [
    { name: bogusSector, source: 'concept', score: 90, why: '编的', members: [outsideSymbol] },
  ],
  picks: [{ symbol: outsideSymbol, name: '工商银行', role: '编的', score: 99, reason: 'r', trigger: 't', stop: 's' }],
  q1: null, q2: null,
  actions: [{ symbol: outsideSymbol, action: 'clear', why: '编的' }],
  verdicts: [{ symbol: outsideSymbol, verdict: 'trap', why: '编的' }],
  avoid: [], evidence: ['主力资金净流入 9999.99 亿'],
  guard: { droppedSymbols: [], droppedSectors: [], ungrounded: [], grounded: 0, symbolPool: 0, sectorPool: 0 },
}
const guarded = guardWarPlan(probePlan, ctx)

console.log(JSON.stringify({
  day, phase: clock.phase, stage,
  loadError,
  counts: {
    boards: ctx.boards.length,
    sectorUniverse: ctx.sectorUniverse.length,
    ladder: ctx.ladder.length,
    concepts: ctx.concepts.length,
    conceptMembers: ctx.concepts.reduce((n, c) => n + c.members.length, 0),
    screened: ctx.screened.length,
    events: ctx.events.length,
    pulses: ctx.pulses.length,
    isolated: ctx.isolated.length,
    positions: ctx.positions.length,
    watchlist: ctx.watchlist.length,
    myPlanItems: ctx.myPlan ? ctx.myPlan.items.length : 0,
    auction: ctx.auction.length,
  },
  samples: {
    boards: ctx.boards.slice(0, 5).map((b) => b.name + '(' + b.limitUpCount + '板)'),
    sectorUniverse: ctx.sectorUniverse.slice(0, 5),
    ladder: ctx.ladder.slice(0, 3).map((s) => s.symbol + ' ' + s.name + ' ' + s.streak + '连板'),
    concepts: ctx.concepts.slice(0, 3).map((c) => '#' + c.id + ' n=' + c.size + ' 强度=' + c.strength + ' 成员=' + c.members.slice(0, 3).map((m) => m.name).join('/')),
    screened: ctx.screened.slice(0, 3).map((r) => r.symbol + ' ' + r.name + ' +' + r.pct + '%'),
    market: ctx.market,
  },
  missing: materials.missing,
  conceptsNote: materials.conceptsNote,
  ctxBytes: Buffer.byteLength(JSON.stringify(ctx), 'utf8'),
  guard: guarded.guard,
  keptSectors: guarded.sectors.map((s) => s.name),
  keptPicks: guarded.picks.map((p) => p.symbol),
  keptActions: guarded.actions.length,
  keptVerdicts: guarded.verdicts.length,
}, null, 2))
hostMod.disposeTdxClient?.()
`

const buildDir = mkdtempSync(join(tmpdir(), 'war-probe-'))
const entryFile = join(buildDir, 'entry.ts')
const outFile = join(buildDir, 'entry.mjs')
writeFileSync(entryFile, entry, 'utf8')

const esbuild = await import('esbuild')
try {
  await esbuild.build({
    entryPoints: [entryFile],
    outfile: outFile,
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'node20',
    // vendored node-tdx 的 CJS 依赖链（见 scripts/unit.mjs 的同款处理）
    // host 产物是**运行时**才 import 的（动态 import 字面量会被 esbuild 当依赖解析）→ external
    external: ['iconv-lite', pathToFileURL(HOST_BUNDLE).href],
    logLevel: 'error',
  })
} catch (err) {
  console.error('[war-materials] 打包失败：' + (err?.message ?? err))
  process.exit(1)
}

/* ── 2) 跑采集（临时入口内部已把 fetch 与 localStorage 补齐）────────────────── */

const started = Date.now()
const run = spawnSync(process.execPath, [outFile], { encoding: 'utf8', timeout: 900_000, maxBuffer: 32 * 1024 * 1024, env: { ...process.env, DSH_TDX_TRANSPORT: 'embedded' } })
rmSync(buildDir, { recursive: true, force: true })

if (run.status !== 0) {
  console.error('[war-materials] 采集脚本失败：\n' + (run.stderr || run.stdout || '').slice(0, 4000))
  process.exit(1)
}
const raw = run.stdout.slice(run.stdout.indexOf('{'))
let out
try {
  out = JSON.parse(raw)
} catch {
  console.error('[war-materials] 输出无法解析：\n' + run.stdout.slice(0, 4000))
  process.exit(1)
}

console.log(`\n[1] 采集（真数据源，用时 ${((Date.now() - started) / 1000).toFixed(1)}s）`)
console.log(`  ${out.day} · ${out.phase} / ${out.stage}${out.loadError ? ' · 行情装载失败：' + out.loadError : ''}`)
const c = out.counts
for (const [k, v] of Object.entries(c)) console.log(`    ${k.padEnd(16)} ${v}`)
console.log('  市场素材：' + JSON.stringify(out.samples.market))
console.log('  方向名池（前 5）：' + JSON.stringify(out.samples.sectorUniverse))
console.log('  板块榜（前 5）：' + JSON.stringify(out.samples.boards))
console.log('  涨停梯队（前 3）：' + JSON.stringify(out.samples.ladder))
console.log('  自挖类（前 3）：' + JSON.stringify(out.samples.concepts, null, 0))
console.log('  选股候选（前 3）：' + JSON.stringify(out.samples.screened))
console.log('  自挖板块素材口径：' + out.conceptsNote)
console.log('  上下文体积：' + (out.ctxBytes / 1024).toFixed(1) + ' KB')
if (out.missing.length > 0) console.log('  素材缺口：\n    - ' + out.missing.join('\n    - '))

console.log('\n[2] 断言：素材块到位 / 缺口如实 / 体积合规')
check(out.loadError === '', '行情装载无异常', out.loadError)
check(c.ladder > 0, '涨停梯队有票', `${c.ladder} 只`)
check(c.sectorUniverse > 0, '方向名池非空（护栏的"允许说什么"来自行情板块榜）', `${c.sectorUniverse} 个`)
check(c.concepts > 0 || out.missing.some((m) => m.includes('自挖板块')), '自挖类到位，或**如实记录**了缺口')
check(c.conceptMembers > 0 || c.concepts === 0, '自挖类带了成员（共动证据）', `${c.conceptMembers} 个成员位`)
check(c.screened > 0 || out.missing.some((m) => m.includes('选股筛选')), '选股候选到位或如实记录缺口', `${c.screened} 只`)
check(out.ctxBytes <= 24000, '上下文体积在上限内（AI_CONTEXT_MAX_BYTES=24KB）', `${(out.ctxBytes / 1024).toFixed(1)}KB`)
check(c.positions >= 0 && c.watchlist >= 0, '持仓/自选已读（0 条也是事实）')

console.log('\n[3] 断言：护栏对**真素材**有效（故意越界：素材外票 + 自造板块名 + 编造引文）')
check(out.keptSectors.length === 0, '自造板块名被剔除', JSON.stringify(out.keptSectors))
check(out.keptPicks.length === 0, '素材外的候选被剔除')
check(out.keptActions === 0 && out.keptVerdicts === 0, '素材外的持仓动作/竞价判定被剔除')
check(out.guard.droppedSectors.length === 1, '剔除留痕：方向 1 条', JSON.stringify(out.guard.droppedSectors))
check(out.guard.droppedSymbols.length === 3, '剔除留痕：点名 3 处（候选/动作/判定）', JSON.stringify(out.guard.droppedSymbols))
check(out.guard.ungrounded.length === 1 && out.guard.grounded === 0, '编造的引文被标未落地', JSON.stringify(out.guard.ungrounded))
check(out.guard.symbolPool > 0, '白名单规模正确回传（界面显示"可点名 N 只票"）', `票 ${out.guard.symbolPool} / 方向 ${out.guard.sectorPool}`)

console.log(
  failures === 0
    ? '\n[war-materials] 全部通过 ✅（真数据源 + 假模型；模型质量不在本脚本断言范围）'
    : `\n[war-materials] ${failures} 项未通过`,
)
process.exit(failures === 0 ? 0 : 1)
