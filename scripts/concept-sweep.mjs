// scripts/concept-sweep.mjs —— 自挖概念（HIST）**参数校准**扫描器（A2a 的取证工具）
//
// 为什么需要它：`docs/ROADMAP.md` A2 的前置门槛是「默认参数输出退化」——
// 实测默认值（pool_n=200 / window=60 / min_corr=0.45）在 as_of=2026-09-11 给出
// 7 类（1 个 141 只「弱链」mean_intra_corr≈0.027 + 6 个 2–3 只小类、42 只孤立），
// 直接上 UI 会误导。要决定「默认用什么参数、弱链怎么过滤、能不能上 UI」，
// 必须把参数空间**真实跑一遍**并留下可复现的账（禁止凭直觉调参）。
//
// 用法：
//   node scripts/concept-sweep.mjs                     # 默认矩阵（min_corr × window）
//   node scripts/concept-sweep.mjs --pool 100,200,300   # 追加 pool_n 维度
//   node scripts/concept-sweep.mjs --asof 2026-09-11
//   node scripts/concept-sweep.mjs --json out.json      # 落盘原始结果
//
// 依赖真机行情（走本插件的内置 TDX 引擎，与前端同一条链路：host 半 callEmbeddedTool）。

import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

const args = process.argv.slice(2)
function argOf(name, fallback) {
  const i = args.indexOf(`--${name}`)
  return i >= 0 && args[i + 1] !== undefined ? args[i + 1] : fallback
}

const ASOF = argOf('asof', undefined) // undefined = 引擎自选最新交易日
const POOLS = String(argOf('pool', '200')).split(',').map((s) => Number(s.trim())).filter(Number.isFinite)
const WINDOWS = String(argOf('window', '60,90')).split(',').map((s) => Number(s.trim())).filter(Number.isFinite)
const MINCORRS = String(argOf('mincorr', '0.3,0.45,0.6')).split(',').map((s) => Number(s.trim())).filter(Number.isFinite)
const JSON_OUT = argOf('json', undefined)

const HOST = pathToFileURL(join(import.meta.dirname, '..', 'lib', 'index.js')).href
const { callEmbeddedTool } = await import(HOST)

/** 跑一次并抽取判据指标。 */
async function probe({ pool, window, minCorr }) {
  const started = Date.now()
  const classes = await callEmbeddedTool('hist_concept_classes', {
    pool_n: pool,
    window,
    min_corr: minCorr,
    top_members: 0,
    ...(ASOF !== undefined ? { as_of: ASOF } : {}),
  })
  const ms = Date.now() - started
  const items = Array.isArray(classes?.classes) ? classes.classes : []
  const sizes = items.map((c) => Number(c.size) || 0).sort((a, b) => b - a)
  const weak = items.filter((c) => c.weak_chain === true)
  const strong = items.filter((c) => c.weak_chain !== true)
  const paired = items.filter((c) => (Number(c.size) || 0) <= 3)
  const corrs = items.map((c) => Number(c.mean_intra_corr)).filter(Number.isFinite)
  const usable = items.filter((c) => c.weak_chain !== true && (Number(c.size) || 0) >= 3)
  return {
    pool,
    window,
    minCorr,
    asOf: classes?.as_of ?? '?',
    ms,
    nClasses: items.length,
    nWeak: weak.length,
    nStrong: strong.length,
    nPaired: paired.length,
    nUsable: usable.length,
    isolated: Number(classes?.isolated_n) || 0,
    maxSize: sizes[0] ?? 0,
    medianSize: sizes.length ? sizes[Math.floor(sizes.length / 2)] : 0,
    meanCorr: corrs.length ? corrs.reduce((a, b) => a + b, 0) / corrs.length : 0,
    bigWeakShare: items.length
      ? items.filter((c) => c.weak_chain === true && (Number(c.size) || 0) > 20).length / items.length
      : 0,
    sizes,
  }
}

const rows = []
const total = POOLS.length * WINDOWS.length * MINCORRS.length
console.log(
  `[concept-sweep] as_of=${ASOF ?? '最新'} · pool=${POOLS.join('/')} × window=${WINDOWS.join('/')} × min_corr=${MINCORRS.join('/')} = ${total} 组`,
)
let i = 0
for (const pool of POOLS) {
  for (const window of WINDOWS) {
    for (const minCorr of MINCORRS) {
      i += 1
      try {
        const r = await probe({ pool, window, minCorr })
        rows.push(r)
        console.log(
          `  [${i}/${total}] pool=${r.pool} w=${r.window} ρ=${r.minCorr} → 类 ${r.nClasses}（弱链 ${r.nWeak} · 可用 ${r.nUsable} · ≤3 只 ${r.nPaired}）`
          + ` 孤立 ${r.isolated} 最大 ${r.maxSize} 中位 ${r.medianSize} 均相关 ${r.meanCorr.toFixed(3)} · ${r.ms}ms`,
        )
      } catch (err) {
        console.error(`  [${i}/${total}] pool=${pool} w=${window} ρ=${minCorr} 失败：${err?.message ?? err}`)
      }
    }
  }
}

if (rows.length === 0) {
  console.error('[concept-sweep] 全部失败 —— 检查内置 TDX 是否可用（pnpm build 后、行情源可达）')
  process.exit(1)
}

// 结论表：按「可用类数」与「弱链占比」挑默认值
console.log('\n=== 汇总（按可用类数降序；弱链 = weak_chain）===')
console.log('| pool | window | min_corr | 类数 | 弱链 | 可用(≥3只且非弱链) | ≤3只 | 孤立 | 最大 | 中位 | 均类内相关 |')
console.log('| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |')
for (const r of [...rows].sort((a, b) => b.nUsable - a.nUsable || a.nWeak - b.nWeak)) {
  console.log(
    `| ${r.pool} | ${r.window} | ${r.minCorr} | ${r.nClasses} | ${r.nWeak} | **${r.nUsable}** | ${r.nPaired} | ${r.isolated} | ${r.maxSize} | ${r.medianSize} | ${r.meanCorr.toFixed(3)} |`,
  )
}

const best = [...rows].sort((a, b) => b.nUsable - a.nUsable || a.nWeak - b.nWeak)[0]
console.log(
  `\n[concept-sweep] 可用类最多的参数：pool=${best.pool} window=${best.window} min_corr=${best.minCorr}`
  + `（可用 ${best.nUsable} 类 / 弱链 ${best.nWeak} / 孤立 ${best.isolated}）`,
)
console.log('[concept-sweep] 注意：类多 ≠ 好 —— 还要看「跨日稳定性」与「与官方板块的重合度」（见 docs/CONCEPT-CALIBRATION.md）')

if (JSON_OUT !== undefined) {
  writeFileSync(JSON_OUT, JSON.stringify(rows, null, 2))
  console.log(`[concept-sweep] 原始结果已写入 ${JSON_OUT}`)
}
