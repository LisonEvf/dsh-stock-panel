#!/usr/bin/env node
/**
 * ux-density.mjs —— 版面密度与类型尺度的**可测契约**（2026-09-12 版面评审后引入）。
 *
 * ## 为什么需要
 * 评审实测：全仓字号 8px 94 处 / 9px 137 处 / 10px 157 处 / 11px 73 处 —— **≤10px 占 85%**，
 * 中文在 9px 下基本不可读（甚至出现过 7px）。这不是某一页写坏了：**字号只能就地写
 * `text-[9px]`，没有任何机制约束**，于是每次"这里放不下"都靠再把字号压小一档来"解决"，
 * 而真正的浪费在宽度上（一行 370px 只放 ~130px 内容，每行空 240px）。
 *
 * 所以本脚本守两件事：
 *   1. **类型尺度**：只允许四档 token（`dc-t-decision/data/note/micro`）+ tailwind 语义档
 *      （text-xs/sm/lg…）+ **少量的强调数字**（≥14px，逐个列白名单）；出现 <14px 的就地字号
 *      即判违约（棘轮 = 0，只降不升）。
 *   2. **宽度利用**：报告"两端对齐/自动推挤/固定窄列/居中限宽"这些**典型的宽度浪费手法**的
 *      分布（报告为主；`max-w-md` 这类把整页挤成中间一条的写法已在 ux-contract 里判失败）。
 *
 * 用法：
 *   node scripts/ux-density.mjs           # 报告（不判失败，除类型尺度外）
 *   node scripts/ux-density.mjs --check   # 判失败（进 CI / pnpm guard）
 */
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'

const ROOT = resolve(import.meta.dirname, '..')
const CHECK = process.argv.includes('--check')

/** 收集 src 下的源码（跳过 vendor）。 */
function srcFiles(dir = join(ROOT, 'src'), out = []) {
  for (const name of readdirSync(dir)) {
    const abs = join(dir, name)
    const st = statSync(abs)
    if (st.isDirectory()) {
      if (name === 'vendor' || name === 'node_modules') continue
      srcFiles(abs, out)
    } else if (/\.(ts|tsx)$/.test(name)) {
      out.push(relative(ROOT, abs).replace(/\\/g, '/'))
    }
  }
  return out
}

const files = srcFiles()
const read = (f) => readFileSync(join(ROOT, f), 'utf8')

/** 类型尺度四档 + tailwind 语义档。 */
const TIERS = ['dc-t-decision', 'dc-t-data', 'dc-t-note', 'dc-t-micro']
const SEMANTIC = ['text-xs', 'text-sm', 'text-base', 'text-lg', 'text-xl']
/** 允许的"就地字号"：只准比 decision 档更大（强调数字），且必须逐个列出理由。 */
const ARBITRARY_ALLOWED = {
  'text-[14px]': '梯队高度/摘要数字（decision 档以上的强调）',
  'text-[15px]': '个股现价（主数字）',
  'text-[16px]': '情绪温度计（一屏最显眼的那个数）',
  'text-[18px]': '昨日涨停今日表现（复盘①的核心结论数）',
  'text-[20px]': '工作台现价（右栏主数字）',
}

const count = (text, re) => (text.match(re) ?? []).length

let failed = 0
const fail = (msg) => {
  failed += 1
  console.error(`  ✗ ${msg}`)
}

// ── 1) 类型尺度 ──
console.log('[ux-density] 类型尺度（src/**/*.tsx）')
const tierCount = Object.fromEntries(TIERS.map((t) => [t, 0]))
const semCount = Object.fromEntries(SEMANTIC.map((t) => [t, 0]))
const arbitrary = new Map()
for (const f of files) {
  const text = read(f)
  for (const t of TIERS) tierCount[t] += count(text, new RegExp(`\\b${t}\\b`, 'g'))
  for (const t of SEMANTIC) {
    // text-sm 不该把 text-smth 也算进来：用词边界
    semCount[t] += count(text, new RegExp(`\\b${t}(?![\\w-])`, 'g'))
  }
  for (const m of text.matchAll(/text-\[(\d+(?:\.\d+)?)px\]/g)) {
    const key = `text-[${m[1]}px]`
    const cur = arbitrary.get(key) ?? { n: 0, files: new Set() }
    cur.n += 1
    cur.files.add(f)
    arbitrary.set(key, cur)
  }
}
for (const t of TIERS) console.log(`    ${t.padEnd(14)} ${tierCount[t]}`)
for (const t of SEMANTIC) console.log(`    ${t.padEnd(14)} ${semCount[t]}`)
const tierTotal = Object.values(tierCount).reduce((a, b) => a + b, 0)
console.log(`    （四档合计 ${tierTotal} 处；语义档合计 ${Object.values(semCount).reduce((a, b) => a + b, 0)} 处）`)

if (arbitrary.size === 0) {
  console.log('  ✔ 没有就地字号（全部走类型尺度 token 或语义档）')
} else {
  for (const [key, info] of [...arbitrary.entries()].sort()) {
    const px = Number(/\[(\d+(?:\.\d+)?)px\]/.exec(key)[1])
    if (ARBITRARY_ALLOWED[key] !== undefined) {
      console.log(`    ℹ️ ${key} × ${info.n}（白名单：${ARBITRARY_ALLOWED[key]}）`)
    } else if (px < 14) {
      fail(`${key} × ${info.n} 低于 14px 下限（涉及 ${[...info.files].slice(0, 3).join(', ')}）—— 请改用 dc-t-* token 或把信息放进 title`)
    } else {
      fail(`${key} × ${info.n} 是未登记的就地字号（要么改用 token，要么写进 ARBITRARY_ALLOWED 并说明理由）`)
    }
  }
}

// 每个 token 都要有定义（避免"用了名字、没定义样式"这种静默失效）
const css = read('src/index.css.txt')
for (const t of TIERS) {
  if (!css.includes(`.${t}`)) fail(`index.css.txt 缺 .${t} 定义`)
}
for (const v of ['--dc-fs-decision', '--dc-fs-data', '--dc-fs-note', '--dc-fs-micro']) {
  if (!css.includes(v)) fail(`index.css.txt 缺 ${v} token`)
}
// css 自身的字号也不许小于 11px
const cssSmall = [...css.matchAll(/font-size:\s*(\d+(?:\.\d+)?)px/g)].map((m) => Number(m[1])).filter((v) => v < 11)
if (cssSmall.length > 0) fail(`index.css.txt 有 ${cssSmall.length} 处 <11px 的 font-size`)

// ── 2) 宽度利用（报告）──
console.log('\n[ux-density] 宽度利用（报告；数值越低越好，重点看是否在增长）')
const waste = [
  ['justify-between（两端对齐，中间常空）', /\bjustify-between\b/g],
  ['ml-auto（把内容推到两端）', /\bml-auto\b/g],
  ['truncate（靠截断而不是给宽度）', /\btruncate\b/g],
  ['max-w-md/lg（居中限宽，主区会大块留白）', /\bmax-w-(md|lg)\b/g],
  ['w-1[0-9]\b（固定窄列，常在 12px 字号下不够）', /\bw-1[0-9]\b/g],
]
for (const [label, re] of waste) {
  let n = 0
  for (const f of files) n += count(read(f), re)
  console.log(`    ${label.padEnd(34)} ${n}`)
}

console.log(
  failed === 0
    ? `\n[ux-density] 全部通过 ✅（${CHECK ? '--check' : '报告'}）`
    : `\n[ux-density] ${failed} 项不通过`,
)
if (CHECK && failed > 0) process.exit(1)
