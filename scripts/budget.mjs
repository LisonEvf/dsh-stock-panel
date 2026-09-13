// scripts/budget.mjs — 请求预算棘轮（B3-⑤ 的落地版）。
//
// 为什么需要：本插件的最大风险不是"某个页面慢"，而是**轮询叠加**——
// 同一个缓存 key 被多个订阅者各起一个定时器、聚合页的节拍器只是"再叠一层"、
// 某个列表页一次性打出几十个并发。这类问题在 code review 里看不出来，
// 只有把「次/分」与「同一 key 的定时器数」变成可比较的数字才能守住。
//
// 做法（静态解析，不跑浏览器、不联网）：
//   1. 扫 src/**/*.{ts,tsx}，抓两类轮询声明：
//        - `useSwr(key, fetcher, { refreshInterval: N })`
//        - `setInterval(fn, N)` / `window.setInterval(fn, N)`
//   2. 算出指标：声明点数量、次/分（60000/N 求和）、同一 key 的最大定时器数、涉及文件数；
//   3. 与基线 `scripts/budget-baseline.json` 比较：
//        - 默认：打印现状表（人类可读）
//        - --check：任一指标**变差**即非零退出（变好不受限，棘轮只降不升）
//        - --update：把当前值写回基线（明确改预算时才用，改完请在 PR 里说明原因）
//
// 已知的粗糙处（刻意保留，避免过度工程）：
//   - 动态间隔（如 `tactMs`）不计入次/分，只计一个声明点；
//   - 「次/分」是上界而非实测（可见性门控、缓存命中、节拍器替代都会减少实际请求）；
//   - 同一个 key 的多个订阅者若间隔相同，实际会被 in-flight 去重合并一部分，
//     但定时器本身仍在跑（这就是要守的东西）。
//
// 用法：node scripts/budget.mjs [--check|--update] [--json]

import { readFileSync, writeFileSync, existsSync, readdirSync, statSync } from 'node:fs'
import { join, resolve, relative } from 'node:path'
import { pathToFileURL } from 'node:url'

const ROOT = resolve(import.meta.dirname, '..')
const SRC = join(ROOT, 'src')
const BASELINE = join(ROOT, 'scripts', 'budget-baseline.json')

/** 递归收集 .ts/.tsx 文件（跳过 host/vendor 里的第三方产物）。 */
function collect(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const abs = join(dir, name)
    const st = statSync(abs)
    if (st.isDirectory()) {
      if (name === 'vendor' || name === 'node_modules') continue
      collect(abs, out)
    } else if (/\.(ts|tsx)$/.test(name)) {
      out.push(abs)
    }
  }
  return out
}

/** 把 `15_000` / `30000` / `60 * 1000` 之类的简单字面量估成毫秒数；估不出返回 null。 */
function literalMs(expr) {
  const cleaned = expr.replace(/_/g, '').trim()
  if (/^\d+$/.test(cleaned)) return Number(cleaned)
  const m = cleaned.match(/^(\d+)\s*\*\s*(\d+)$/)
  if (m) return Number(m[1]) * Number(m[2])
  return null
}

/** 从参数串里取 `xxx: <expr>` 的值（简化解析：只处理顶层逗号，够用且不引依赖）。 */
function propExpr(args, key) {
  const re = new RegExp(`${key}\\s*:\\s*([^,}]+)`)
  const m = args.match(re)
  return m ? m[1].trim() : null
}

/**
 * 去掉注释但**保留行号**（注释内容替换成等长空白、换行原样保留）。
 *
 * 为什么必须做：第一版扫描器直接正则匹配原文，结果把注释里写的
 * "仍是唯一一个 setInterval(TICK_MS)"（AlertWatcher 的说明文字）也算成一个轮询声明点，
 * 触发棘轮误报。契约检查针对代码，不针对散文。
 */
function stripCommentsKeepLines(text) {
  let out = ''
  let i = 0
  const n = text.length
  while (i < n) {
    const two = text.slice(i, i + 2)
    if (two === '//') {
      while (i < n && text[i] !== '\n') {
        out += ' '
        i += 1
      }
      continue
    }
    if (two === '/*') {
      out += '  '
      i += 2
      while (i < n && text.slice(i, i + 2) !== '*/') {
        out += text[i] === '\n' ? '\n' : ' '
        i += 1
      }
      out += '  '
      i += 2
      continue
    }
    out += text[i]
    i += 1
  }
  return out
}

/** 扫描一个文件里的所有轮询声明。 */
function scanFile(abs) {
  const raw = readFileSync(abs, 'utf8')
  // 匹配看「去注释」的代码；豁免标注 `budget-ignore` 本身写在注释里，
  // 所以两者都要留 —— stripCommentsKeepLines 保持长度与行号一致，下标可直接复用。
  const text = stripCommentsKeepLines(raw)
  const rel = relative(ROOT, abs).replace(/\\/g, '/')
  const sites = []

  // setInterval（含 window.setInterval）
  const setIntervalRe = /setInterval\s*\(/g
  let m
  while ((m = setIntervalRe.exec(text)) !== null) {
    const line = text.slice(0, m.index).split('\n').length
    // 取到匹配括号的实参串（粗略：向后找 240 字符内的最后一个逗号参数）
    const tail = text.slice(m.index, m.index + 400)
    // 显式豁免：纯 UI/测量定时器（不发请求）在**上下几行内**标注 `budget-ignore`。
    // 不加标注的一律计入——宁可误报，也不要悄悄放过一个真的轮询。
    const around = raw.slice(Math.max(0, m.index - 400), m.index + 400)
    if (around.includes('budget-ignore')) continue
    const nums = tail.match(/,\s*([0-9_]+(?:\s*\*\s*[0-9_]+)?)\s*\)/)
    const ms = nums ? literalMs(nums[1]) : null
    sites.push({ file: rel, line, kind: 'setInterval', ms, key: null })
  }

  // useSwr(..., { refreshInterval: N })
  const useSwrRe = /useSwr\s*(?:<[^>]*>)?\s*\(/g
  while ((m = useSwrRe.exec(text)) !== null) {
    const line = text.slice(0, m.index).split('\n').length
    const tail = text.slice(m.index, m.index + 600)
    const ri = propExpr(tail, 'refreshInterval')
    const ms = ri === null ? null : literalMs(ri)
    if (ri === null) continue
    // key：第一个实参（形如 swrKey.indices() / 'swr:buildinfo'）
    const firstArg = tail.slice(tail.indexOf('(') + 1).split(',')[0].trim()
    sites.push({ file: rel, line, kind: 'useSwr', ms, key: firstArg.replace(/^['"]|['"]$/g, '') })
  }

  return sites
}

/** 汇总指标。 */
export function measure() {
  const files = collect(SRC)
  const sites = files.flatMap(scanFile)
  const perKey = new Map()
  for (const s of sites) {
    if (s.kind !== 'useSwr' || s.key === null) continue
    perKey.set(s.key, (perKey.get(s.key) ?? 0) + 1)
  }
  const perMinute = sites.reduce((sum, s) => (s.ms && s.ms > 0 ? sum + 60_000 / s.ms : sum), 0)
  const maxTimersPerKey = perKey.size === 0 ? 0 : Math.max(...perKey.values())
  return {
    metrics: {
      pollSites: sites.length,
      requestsPerMinuteUpperBound: Math.round(perMinute),
      maxTimersPerKey,
      filesWithPolling: new Set(sites.map((s) => s.file)).size,
    },
    /** 同一 key 被多处订阅（预算头号风险，单独列出） */
    sharedKeys: [...perKey.entries()].filter(([, n]) => n > 1).map(([key, n]) => ({ key, timers: n })),
    sites: sites.slice().sort((a, b) => (a.ms ?? 1e9) - (b.ms ?? 1e9)),
  }
}

function loadBaseline() {
  if (!existsSync(BASELINE)) return null
  try {
    return JSON.parse(readFileSync(BASELINE, 'utf8'))
  } catch {
    return null
  }
}

function printReport({ metrics, sharedKeys, sites }) {
  console.log('[budget] 轮询声明（按间隔升序）：')
  for (const s of sites) {
    const iv = s.ms === null ? '动态' : `${s.ms / 1000}s`
    console.log(`  ${iv.padStart(5)}  ${s.kind.padEnd(11)} ${s.file}:${s.line}${s.key ? `  key=${s.key}` : ''}`)
  }
  console.log('')
  console.log('[budget] 指标：')
  for (const [k, v] of Object.entries(metrics)) console.log(`  ${k} = ${v}`)
  if (sharedKeys.length > 0) {
    console.log('')
    console.log('[budget] 同一缓存 key 的多个定时器（预算头号风险）：')
    for (const s of sharedKeys) console.log(`  ${s.timers}× ${s.key}`)
  }
}

function main() {
  const check = process.argv.includes('--check')
  const update = process.argv.includes('--update')
  const json = process.argv.includes('--json')
  const current = measure()

  if (json) console.log(JSON.stringify(current, null, 2))
  else printReport(current)

  if (update) {
    writeFileSync(
      BASELINE,
      JSON.stringify({ note: 'budget 基线：只降不升。改大必须在 PR 里说明原因。', ...current.metrics }, null, 2) + '\n',
      'utf8',
    )
    console.log(`\n[budget] 基线已更新 → ${relative(ROOT, BASELINE)}`)
    return
  }

  if (!check) return

  const baseline = loadBaseline()
  if (baseline === null) {
    console.error('\n[budget] --check 需要基线：先跑 node scripts/budget.mjs --update')
    process.exit(1)
  }
  const worse = []
  for (const [key, value] of Object.entries(current.metrics)) {
    const base = baseline[key]
    if (typeof base === 'number' && value > base) worse.push(`${key}: ${base} → ${value}`)
  }
  if (worse.length > 0) {
    console.error('\n[budget] 请求预算变差（棘轮只降不升）：')
    for (const w of worse) console.error(`  ✗ ${w}`)
    console.error('  改大确实有意为之：node scripts/budget.mjs --update，并在 PR 说明理由。')
    process.exit(1)
  }
  console.log('\n[budget] OK：请求预算未变差 ✅')
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main()
}
