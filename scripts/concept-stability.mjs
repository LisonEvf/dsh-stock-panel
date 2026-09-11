// scripts/concept-stability.mjs —— 自挖概念（HIST）**跨日稳定性**取证（A2a 第二件）
//
// 为什么需要：参数扫描（concept-sweep.mjs）只能回答「当天切出几类」，
// 而 UI 要展示的是「这条主线还在不在」——**类必须跨日可辨认**才有产品价值。
// 本脚本对若干交易日各跑一次聚类，然后用「最佳匹配 Jaccard」衡量：
//   对 A 日的每个类，找 B 日与之成员交并比最高的类，看它的 Jaccard 分布。
//   Jaccard 高 = 类在跨日延续（可用于「题材第几天」）；低 = 每天重组（不可用）。
//
// 用法：node scripts/concept-stability.mjs --asof 2026-09-09,2026-09-10,2026-09-11
//       [--window 90] [--mincorr 0.6] [--pool 200] [--json out.json]

import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

const args = process.argv.slice(2)
function argOf(name, fallback) {
  const i = args.indexOf(`--${name}`)
  return i >= 0 && args[i + 1] !== undefined ? args[i + 1] : fallback
}

const ASOFS = String(argOf('asof', '2026-09-11')).split(',').map((s) => s.trim()).filter(Boolean)
const WINDOW = Number(argOf('window', '90'))
const MINCORR = Number(argOf('mincorr', '0.6'))
const POOL = Number(argOf('pool', '200'))
const JSON_OUT = argOf('json', undefined)

const { callEmbeddedTool } = await import(pathToFileURL(join(import.meta.dirname, '..', 'lib', 'index.js')).href)

/**
 * 取某日的「类 → 成员集合」。
 *
 * ⚠️ 只发**一次**调用（`top_members` 内联成员）：引擎的快照按 (as_of, 参数) 缓存，
 * 但**换 as_of / 换参数都会触发重建**（实测冷启动 7–8s，之后同参数 30–50ms）。
 * 早期实现逐类调 `hist_concept_class`，等于每个类都重建一次 → 3 天 × N 类直接跑爆超时。
 * 类规模在这些参数下 ≤60，所以 top_members=60 足以覆盖。
 */
async function classesOf(asOf) {
  const res = await callEmbeddedTool('hist_concept_classes', {
    pool_n: POOL,
    window: WINDOW,
    min_corr: MINCORR,
    top_members: 60,
    as_of: asOf,
  })
  const out = []
  for (const c of Array.isArray(res?.classes) ? res.classes : []) {
    if (c.weak_chain === true) continue
    // ⚠️ 字段是 `top`（**名字**数组），不是 members 对象数组 —— 取错字段会得到空集，
    // 而空集算 Jaccard 恒为 0，会伪装成"每天重组"（实测踩过）。
    const list = Array.isArray(c.top) ? c.top : []
    const set = new Set(list.map((v) => (typeof v === 'string' ? v : `${v?.market ?? ''}${v?.code ?? ''}`)).filter((s) => s.length > 1))
    out.push({
      asOf,
      classId: c.class_id,
      size: Number(c.size) || set.size,
      meanCorr: Number(c.mean_intra_corr) || 0,
      top: list.slice(0, 6),
      set,
    })
  }
  return { asOf: res?.as_of ?? asOf, classes: out, isolated: Number(res?.isolated_n) || 0 }
}

/** Jaccard：交集 / 并集。 */
function jaccard(a, b) {
  let inter = 0
  for (const x of a) if (b.has(x)) inter += 1
  const union = a.size + b.size - inter
  return union === 0 ? 0 : inter / union
}

console.log(
  `[concept-stability] as_of=${ASOFS.join(' → ')} · pool=${POOL} window=${WINDOW} min_corr=${MINCORR}（只用非弱链类）`,
)

const days = []
for (const asOf of ASOFS) {
  try {
    const d = await classesOf(asOf)
    days.push(d)
    console.log(`  ${asOf}: 引擎 as_of=${d.asOf} · 非弱链类 ${d.classes.length} 个，孤立 ${d.isolated}`)
    for (const c of d.classes) {
      console.log(`     类#${c.classId}（${c.size} 只，相关 ${c.meanCorr.toFixed(3)}）：${c.top.join('、')}`)
    }
  } catch (err) {
    console.error(`  ${asOf}: 失败 ${err?.message ?? err}`)
  }
}

const report = []
for (let i = 1; i < days.length; i += 1) {
  const prev = days[i - 1]
  const cur = days[i]
  console.log(`\n=== ${prev.asOf} → ${cur.asOf}（每个前日类的最佳匹配）===`)
  if (prev.classes.length === 0) {
    console.log('  前日无可用类（参数过松/过紧或数据缺失）→ 无法评估跨日延续')
    continue
  }
  const rows = []
  for (const c of prev.classes) {
    let best = null
    for (const c2 of cur.classes) {
      const j = jaccard(c.set, c2.set)
      if (best === null || j > best.j) best = { j, c2 }
    }
    const j = best?.j ?? 0
    rows.push({ prevClass: c.classId, size: c.size, bestClass: best?.c2.classId ?? null, jaccard: j })
    console.log(
      `  前日类#${c.classId}（${c.size} 只）→ 今日类#${best?.c2.classId ?? '—'}（${best?.c2.size ?? 0} 只） Jaccard=${j.toFixed(2)}`
      + (j >= 0.5 ? ' ✅ 延续' : j >= 0.3 ? ' 🟡 部分延续' : ' ❌ 重组'),
    )
  }
  const avg = rows.reduce((s, r) => s + r.jaccard, 0) / rows.length
  const good = rows.filter((r) => r.jaccard >= 0.5).length
  console.log(`  平均 Jaccard=${avg.toFixed(2)}；延续(≥0.5) ${good}/${rows.length}`)
  report.push({ from: prev.asOf, to: cur.asOf, avgJaccard: avg, continued: good, total: rows.length, rows })
}

console.log('\n=== 判定依据 ===')
console.log('  · 平均 Jaccard ≥0.5：类跨日可辨认 → 「题材第几天 / 延续性」可用于 UI')
console.log('  · 0.3–0.5：部分延续 → UI 只能展示「当日共动」，不能声称延续')
console.log('  · <0.3：每天重组 → UI 只做「今天的邻居」，不做类叙事（并考虑提高 min_corr 或改看个股邻居）')

if (JSON_OUT !== undefined) {
  writeFileSync(JSON_OUT, JSON.stringify({ params: { POOL, WINDOW, MINCORR }, days: days.map((d) => ({ asOf: d.asOf, classes: d.classes.map((c) => ({ classId: c.classId, size: c.size, meanCorr: c.meanCorr })), isolated: d.isolated })), report }, null, 2))
  console.log(`[concept-stability] 原始结果已写入 ${JSON_OUT}`)
}
