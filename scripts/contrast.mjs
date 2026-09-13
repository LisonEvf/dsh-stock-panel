// scripts/contrast.mjs — 对比度清单（B2 令牌收口的护栏）。
//
// 为什么需要：本插件的配色不是自己定的，而是**映射宿主的 `--dsw-alias-*` 语义别名**，
// 所以"某个灰是不是读得清"取决于宿主当前的值，代码里看不出来。实测就吃过两次：
//   · 宿主**亮色**的 layer-1/2/3 全是 #ffffff → 插件把 layer-3 当"进度槽底/标签底"用时
//     与容器 1.00:1，整条进度槽直接消失；
//   · 宿主亮色 caption = #adb2b8 → 插件 9 类 10px 小字只有 2.13:1。
//
// 做法（离线、零依赖）：
//   1. 从 `src/index.css.txt` 解析 `--dc-*` 的定义（含 color-mix / var 兜底）；
//   2. 用下面 HOST 表里的宿主真值把 `--dsw-alias-*` 代进去（真值来源见注释）；
//   3. 对"前景 token × 背景 token"的固定组合算 WCAG 对比度；
//   4. `--check` 时低于阈值即非零退出（阈值可被 `--min-text` / `--min-ui` 覆盖）。
//
// ⚠️ HOST 表是**宿主快照**：取自 `@deepseek-ai/dsh-web-frontend` 的 `index-*.css`
// 与 `dsh-client-ui-theme/lib/client.js`（2026-09-12）。宿主改主题时同步这张表，
// 否则本脚本会失真（失真方向是"偏乐观"，所以同步很重要）。

import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const ROOT = resolve(import.meta.dirname, '..')

/** 宿主主题真值快照（亮色 / 暗色）。 */
const HOST = {
  light: {
    'bg-base': '#ffffff',
    'bg-layer-1': '#ffffff',
    'bg-layer-2': '#ffffff',
    'bg-layer-3': '#ffffff',
    'label-primary': '#0f172a',
    'label-secondary': '#475569',
    'label-tertiary': '#81858c',
    'label-caption': '#adb2b8',
    'border-l1': '#e2e8f0',
    'border-l2': '#cbd5e1',
    'state-warn-primary': '#d97706',
    'state-error-primary': '#dc2626',
    'state-success-primary': '#16a34a',
    primary: '#0f172a',
    foreground: '#ffffff',
  },
  dark: {
    'bg-base': '#151517',
    'bg-layer-1': '#232324',
    'bg-layer-2': '#2c2c2e',
    'bg-layer-3': '#353638',
    'label-primary': '#f9fafb',
    'label-secondary': '#cfd3d6',
    'label-tertiary': '#adb2b8',
    'label-caption': '#81858c',
    'border-l1': '#3a3a3c',
    'border-l2': '#4a4a4c',
    'state-warn-primary': '#e0a352',
    'state-error-primary': '#e26060',
    'state-success-primary': '#45b57c',
    primary: '#f9fafb',
    foreground: '#151517',
  },
}

/** 要检查的（前景 token, 背景 token, 阈值类别）组合。 */
const PAIRS = [
  ['text', 'layer-1', 'text'],
  ['text-2', 'layer-1', 'text'],
  ['text-3', 'layer-1', 'text'],
  ['dim', 'layer-1', 'text'],
  ['text', 'layer-2', 'text'],
  ['text-3', 'layer-2', 'text'],
  ['dim', 'layer-2', 'text'],
  ['up', 'layer-1', 'text'],
  ['down', 'layer-1', 'text'],
  ['warn', 'layer-1', 'text'],
  ['danger', 'layer-1', 'text'],
  ['success', 'layer-1', 'text'],
  // 注意：`accent`（品牌填充色）不在此列 —— 它用于按钮/填充，对比度要按"按钮底 vs 按钮字"判，
  // 不是"面板底 vs 品牌色"。文字场景用的是 `info`。
  ['info', 'layer-1', 'text'],
  ['track', 'layer-1', 'ui'],
  ['border', 'layer-1', 'ui'],
]

// ── 解析 ────────────────────────────────────────────────────────────────────

/** 从 index.css.txt 里抓出 `.dsh-stock{…}` 与暗色覆盖块里的 `--dc-*` 定义。 */
export function parsePluginTokens() {
  const css = readFileSync(join(ROOT, 'src', 'index.css.txt'), 'utf8')
  const grab = (block) => {
    const out = {}
    for (const m of block.matchAll(/(--dc-[a-z0-9-]+)\s*:\s*([^;]+);/g)) out[m[1]] = m[2].trim()
    return out
  }
  const base = css.match(/\.dsh-stock\s*\{([\s\S]*?)\n\}/)
  const dark = css.match(/body\[data-ds-dark-theme\]\s*\.dsh-stock\s*\{([\s\S]*?)\n\}/)
  const lightTokens = base === null ? {} : grab(base[1])
  const darkTokens = dark === null ? {} : grab(dark[1])
  // 暗色块只覆盖少数 token，其余继承亮色定义
  return { light: lightTokens, dark: { ...lightTokens, ...darkTokens } }
}

/** 把宿主别名代进 `var(--dsw-alias-x, fallback)`。 */
function substituteHost(value, host) {
  return value.replace(/var\(--dsw-alias-([a-z0-9-]+)(?:\s*,\s*([^)]+))?\)/g, (_, name, fallback) => {
    const hit = host[name]
    if (hit !== undefined) return hit
    return fallback !== undefined ? substituteHost(fallback.trim(), host) : '#000000'
  })
}

/** 解析 color-mix(in srgb, A p%, B) —— 只支持本插件用到的这一种形态。 */
function resolveMix(value, host, tokens) {
  const m = value.match(/color-mix\(in srgb,\s*(.+?)\s+([\d.]+)%\s*,\s*(.+?)\)$/)
  if (m === null) return null
  const a = resolveColor(m[1], host, tokens)
  const b = resolveColor(m[3], host, tokens)
  const p = Number(m[2]) / 100
  if (a === null || b === null) return null
  return mix(a, b, p)
}

function resolveColor(raw, host, tokens, seen = new Set()) {
  let value = raw.trim()
  // 嵌套的 var(--dc-x)
  const varHit = value.match(/^var\((--dc-[a-z0-9-]+)(?:\s*,\s*([^)]+))?\)$/)
  if (varHit !== null) {
    const name = varHit[1]
    if (seen.has(name)) return null
    seen.add(name)
    const def = tokens[name]
    if (def !== undefined) return resolveColor(def, host, tokens, seen)
    return varHit[2] !== undefined ? resolveColor(varHit[2], host, tokens, seen) : null
  }
  if (value.startsWith('color-mix')) {
    const mixed = resolveMix(value, host, tokens)
    if (mixed !== null) return mixed
  }
  value = substituteHost(value, host)
  // 半透明（rgba/transparent 混出来的）→ 与白底合成，仅用于近似比较
  const rgb = parseColor(value)
  return rgb
}

function parseColor(value) {
  const hex = value.match(/^#([0-9a-f]{6})$/i)
  if (hex !== null) {
    const n = parseInt(hex[1], 16)
    return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255, a: 1 }
  }
  const rgba = value.match(/rgba?\(([^)]+)\)/i)
  if (rgba !== null) {
    const parts = rgba[1].split(/[,\s/]+/).filter((x) => x !== '')
    return {
      r: Number(parts[0]),
      g: Number(parts[1]),
      b: Number(parts[2]),
      a: parts[3] === undefined ? 1 : Number(parts[3]),
    }
  }
  if (value === 'transparent') return { r: 0, g: 0, b: 0, a: 0 }
  return null
}

/**
 * CSS `color-mix(in srgb, …)` 的**预乘 alpha**插值（W3C 规范）：
 *   alpha = a.a*p + b.a*(1-p)
 *   rgb   = (a.rgb*a.a*p + b.rgb*b.a*(1-p)) / alpha
 * 第一版写成朴素的 `a*p + b*(1-p)`，于是 `color-mix(text 12%, transparent)`
 * 被当成"已经变暗的实色"，再与背景合成一次 → 算出的对比度偏低（1.01 假阳性）。
 */
function mix(a, b, p) {
  const alpha = a.a * p + b.a * (1 - p)
  if (alpha === 0) return { r: 0, g: 0, b: 0, a: 0 }
  return {
    r: Math.round((a.r * a.a * p + b.r * b.a * (1 - p)) / alpha),
    g: Math.round((a.g * a.a * p + b.g * b.a * (1 - p)) / alpha),
    b: Math.round((a.b * a.a * p + b.b * b.a * (1 - p)) / alpha),
    a: alpha,
  }
}

/** 相对亮度（WCAG 2.1）。 */
function luminance(c) {
  const f = (v) => {
    const s = v / 255
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b)
}

/** 把带 alpha 的前景合到不透明背景上（source-over）。 */
function over(fg, bg) {
  const a = fg.a
  return {
    r: Math.round(fg.r * a + bg.r * (1 - a)),
    g: Math.round(fg.g * a + bg.g * (1 - a)),
    b: Math.round(fg.b * a + bg.b * (1 - a)),
    a: 1,
  }
}

/** 对比度（前景若带 alpha，先与背景合成）。 */
export function contrast(fg, bg) {
  const base = bg.a < 1 ? over(bg, { r: 255, g: 255, b: 255, a: 1 }) : bg
  const front = fg.a < 1 ? over(fg, base) : fg
  const l1 = luminance(front)
  const l2 = luminance(base)
  const [hi, lo] = l1 > l2 ? [l1, l2] : [l2, l1]
  return (hi + 0.05) / (lo + 0.05)
}

// ── 主流程 ──────────────────────────────────────────────────────────────────

function argValue(flag, dflt) {
  const i = process.argv.indexOf(flag)
  return i >= 0 && process.argv[i + 1] !== undefined ? Number(process.argv[i + 1]) : dflt
}

function main() {
  const check = process.argv.includes('--check')
  const minText = argValue('--min-text', 4.5)
  const minUi = argValue('--min-ui', 1.2)
  const { light, dark } = parsePluginTokens()
  const rows = []
  let violations = 0

  for (const mode of ['light', 'dark']) {
    const tokens = mode === 'light' ? light : dark
    const host = HOST[mode]
    for (const [fgName, bgName, kind] of PAIRS) {
      const fgRaw = tokens[`--dc-${fgName}`]
      const bgRaw = tokens[`--dc-${bgName}`]
      if (fgRaw === undefined || bgRaw === undefined) continue
      const fg = resolveColor(fgRaw, host, tokens)
      const bg = resolveColor(bgRaw, host, tokens)
      if (fg === null || bg === null) {
        rows.push({ mode, fgName, bgName, ratio: NaN, kind, note: '无法解析' })
        continue
      }
      const ratio = contrast(fg, bg)
      const min = kind === 'text' ? minText : minUi
      const ok = ratio >= min
      if (!ok) violations += 1
      rows.push({ mode, fgName, bgName, ratio, kind, ok })
    }
  }

  console.log('[contrast] 前景 token × 背景 token（宿主真值快照见脚本头部注释）')
  for (const r of rows) {
    const ratio = Number.isNaN(r.ratio) ? '  ?  ' : r.ratio.toFixed(2).padStart(5)
    const flag = r.ok === undefined ? ' ? ' : r.ok ? ' ✔ ' : ' ✗ '
    console.log(`  ${flag}${r.mode.padEnd(5)} dc-${r.fgName.padEnd(8)} on dc-${r.bgName.padEnd(8)} ${ratio}  (${r.kind})${r.note === undefined ? '' : ' ' + r.note}`)
  }

  if (check && violations > 0) {
    console.error(`\n[contrast] ${violations} 项低于阈值（文字 ≥${minText}:1，UI 元素 ≥${minUi}:1）`)
    console.error('  修法：调 src/index.css.txt 的 --dc-* 映射（例如朝 --dsw-alias-label-primary 混一档），')
    console.error('  不要改组件里的类名——那会重新散出色值。')
    process.exit(1)
  }
  console.log(check ? '\n[contrast] 全部达标 ✅' : '')
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main()
}
