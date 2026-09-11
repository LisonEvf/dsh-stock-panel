// scripts/bundle-report.mjs —— client bundle 成分报告（B2「减重」的决策依据）
//
// 为什么需要它：`check-bundle-size.mjs` 只告诉你**总量**，不告诉你**该减哪里**。
// 本脚本用 esbuild 的 metafile 把 lib/client.js 按输入模块拆分，并给出三类汇总：
//   1. 我们的 src/** 代码；
//   2. 第三方依赖（lightweight-charts / lucide-react / …）—— 只能靠换/砍依赖；
//   3. 内联 CSS 字符串（tailwind 产物，构建期压缩）。
// 同时报告「未压缩 / minify / gzip」三种口径，供判断「是否值得为体积放弃可调试性」。
//
// 用法：
//   node scripts/bundle-report.mjs            # 明细（top 25）+ 三类汇总
//   node scripts/bundle-report.mjs --minify   # 额外给出压缩后体积
//   node scripts/bundle-report.mjs --dirs     # 只按目录汇总（src/lib、src/pages …）

import { gzipSync } from 'node:zlib'
import { build } from 'esbuild'
import { pluginCssStub } from './bundle-css-stub.mjs'

const ROOT = process.cwd()
const wantMinify = process.argv.includes('--minify')
const dirsOnly = process.argv.includes('--dirs')

function kb(bytes) {
  return `${(bytes / 1024).toFixed(1)} KB`
}

/** 归类：src 代码 / 依赖 / CSS 内联。 */
function classify(path) {
  if (path.startsWith('src/')) return 'src（我们的代码）'
  if (path.includes('index.css')) return 'CSS 内联（tailwind 产物）'
  if (path.includes('node_modules/')) {
    const m = /node_modules\/((?:@[^/]+\/)?[^/]+)/.exec(path)
    return `依赖：${m ? m[1] : '未知'}`
  }
  return '其它'
}

/** 按目录汇总 src 代码（找「哪一页最重」）。 */
function dirOf(path) {
  if (!path.startsWith('src/')) return classify(path)
  const parts = path.split('/')
  return parts.length >= 3 ? `src/${parts[1]}/` : `src/${parts[1]}`
}

async function analyze() {
  const result = await build({
    entryPoints: [`${ROOT}/src/client.ts`],
    bundle: true,
    write: false,
    metafile: true,
    format: 'cjs',
    platform: 'browser',
    target: 'es2020',
    external: ['react'],
    jsx: 'transform',
    jsxFactory: 'React.createElement',
    jsxFragment: 'React.Fragment',
    logLevel: 'error',
    define: { __PANEL_VERSION__: '"0.0.0"', __PANEL_BUILD_ID__: '"00000000"' },
    plugins: [pluginCssStub()],
  })
  return result
}

const result = await analyze()
const out = result.metafile.outputs[Object.keys(result.metafile.outputs)[0]]
const bytes = result.outputFiles[0].contents.length
const rows = Object.entries(out.inputs)
  .map(([path, v]) => ({ path, bytes: v.bytesInOutput }))
  .sort((a, b) => b.bytes - a.bytes)
const total = rows.reduce((s, r) => s + r.bytes, 0)

console.log(`[bundle-report] client.js 未压缩 ≈ ${kb(bytes)}（模块归属合计 ${kb(total)}，含内联 CSS）`)
console.log(`[bundle-report] 模块数 ${rows.length}`)

console.log('\n=== 三类汇总 ===')
const byClass = new Map()
for (const r of rows) {
  const k = classify(r.path)
  byClass.set(k, (byClass.get(k) ?? 0) + r.bytes)
}
for (const [k, v] of [...byClass.entries()].sort((a, b) => b[1] - a[1])) {
  console.log(`  ${kb(v).padStart(10)}  ${((100 * v) / total).toFixed(1).padStart(5)}%  ${k}`)
}

console.log('\n=== 按目录（src 内部）===')
const byDir = new Map()
for (const r of rows) {
  const k = dirOf(r.path)
  byDir.set(k, (byDir.get(k) ?? 0) + r.bytes)
}
for (const [k, v] of [...byDir.entries()].sort((a, b) => b[1] - a[1]).slice(0, 16)) {
  console.log(`  ${kb(v).padStart(10)}  ${((100 * v) / total).toFixed(1).padStart(5)}%  ${k}`)
}

if (!dirsOnly) {
  console.log('\n=== 单文件 top 25（减重的直接目标）===')
  for (const r of rows.slice(0, 25)) {
    console.log(`  ${kb(r.bytes).padStart(10)}  ${((100 * r.bytes) / total).toFixed(1).padStart(5)}%  ${r.path}`)
  }
}

if (wantMinify) {
  const min = await build({
    entryPoints: [`${ROOT}/src/client.ts`],
    bundle: true,
    write: false,
    minify: true,
    format: 'cjs',
    platform: 'browser',
    target: 'es2020',
    external: ['react'],
    jsx: 'transform',
    jsxFactory: 'React.createElement',
    jsxFragment: 'React.Fragment',
    logLevel: 'error',
    define: { __PANEL_VERSION__: '"0.0.0"', __PANEL_BUILD_ID__: '"00000000"' },
    plugins: [pluginCssStub()],
  })
  const rawBytes = result.outputFiles[0].contents.length
  const minBytes = min.outputFiles[0].contents.length
  console.log('\n=== 压缩口径（同一份输入）===')
  console.log(`  未压缩        ${kb(rawBytes)}`)
  console.log(`  minify        ${kb(minBytes)}（${((100 * minBytes) / rawBytes).toFixed(1)}%）`)
  console.log(`  gzip(未压缩)  ${kb(gzipSync(result.outputFiles[0].contents).length)}`)
  console.log(`  gzip(minify)  ${kb(gzipSync(min.outputFiles[0].contents).length)}`)
}
