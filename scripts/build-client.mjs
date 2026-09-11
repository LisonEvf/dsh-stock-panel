// 生成器：src/client.ts → lib/client.js（bundle 产物，随插件分发）。
// 契约：--check 模式在内存生成后与已提交 lib/client.js 逐字节比对，不一致非零退出——
// 手改生成物禁止（改 src/ 源码，勿改 lib/client.js）。
// 官方 __ModuleLoader__.load 契约：factory 返回 { name, inject, apply }，client 内核
// 挂载时调用 apply(ctx)。'react' 保持 external —— 运行时经 loader 模块表（平台种子）
// 解析，与宿主渲染器共享同一 React 实例（hooks 才能正常工作）。
// JSX 用经典转换（React.createElement），只依赖 'react' 一个外部模块。
//
// CSS 处理：src/client.ts 的 `import panelCss from './index.css'` 由 esbuild 插件
// 解析为虚拟模块，load 阶段用 postcss+tailwind+autoprefixer 编译 src/index.css.txt
// （@tailwind 指令源文件）为纯 CSS 字符串，包装为 `export default "<css>"`。
//
// 依赖：esbuild（devDependency，提供 JS API + 平台二进制）。

import { readFileSync, writeFileSync, unlinkSync, mkdirSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { computeBuildId, pluginVersion } from './build-id.mjs'

const ROOT = resolve(import.meta.dirname, '..')
const ENTRY = join(ROOT, 'src', 'client.ts')
const OUTPUT = join(ROOT, 'lib', 'client.js')
const PLUGIN_ID = '@lisonevf/dsh-stock-panel'

/** esbuild 是否可用（devDependency 已安装即可）。 */
export async function esbuildAvailable() {
  try {
    await import('esbuild')
    return true
  } catch {
    return false
  }
}

/**
 * CSS 插件：把 .css 导入解析为虚拟模块，load 阶段用 postcss+tailwind
 * 编译 src/index.css.txt（@tailwind 指令源文件）为纯 CSS 字符串。
 * 无需外部预步骤——esbuild 构建时一次性完成 Tailwind 展开。
 *
 * 编译产物会**压缩**后再内联：整份 CSS 是以字符串形式躺进 client.js 的，
 * 不压缩等于把注释/缩进/换行一并塞进 bundle（v1.3 重排样式后这一项接近 40KB）。
 * 压缩器刻意保守：跳过引号内内容，只做注释剥离/空白折叠/分隔符周围去空白。
 */
async function compileTailwindCss() {
  const { default: postcss } = await import('postcss')
  const { default: tailwindcss } = await import('tailwindcss')
  const { default: autoprefixer } = await import('autoprefixer')
  const source = readFileSync(join(ROOT, 'src', 'index.css.txt'), 'utf8')
  const result = await postcss([
    tailwindcss(join(ROOT, 'tailwind.config.js')),
    autoprefixer,
  ]).process(source, { from: join(ROOT, 'src', 'index.css.txt'), to: undefined, map: false })
  return minifyCss(result.css)
}

/**
 * 保守 CSS 压缩（不引入 cssnano 依赖）：
 *   1. 剥离 /* … *​/ 注释（引号内的 /* 不动）；
 *   2. 折叠空白（换行/多空格 → 单空格），引号字符串原样保留；
 *   3. 去掉 `{ } ; : , > + ~` 周围的空白（`:` 仅在非选择器伪类处安全，
 *      这里只处理 `{`/`}`/`;`/`,` 与前导缩进，避免误伤 `:hover`）。
 * 目标是把「人类可读」换成「省字节」，语义等价。
 */
export function minifyCss(css) {
  let out = ''
  let i = 0
  const n = css.length
  while (i < n) {
    const ch = css[i]
    // 注释
    if (ch === '/' && css[i + 1] === '*') {
      const end = css.indexOf('*/', i + 2)
      i = end === -1 ? n : end + 2
      continue
    }
    // 字符串（单/双引号）
    if (ch === '"' || ch === "'") {
      const quote = ch
      out += ch
      i += 1
      while (i < n) {
        const c = css[i]
        out += c
        i += 1
        if (c === '\\') {
          if (i < n) {
            out += css[i]
            i += 1
          }
          continue
        }
        if (c === quote) break
      }
      continue
    }
    // 空白：折叠成单个空格，但紧跟分隔符时直接丢弃
    if (ch === ' ' || ch === '\n' || ch === '\t' || ch === '\r' || ch === '\f') {
      let j = i
      while (j < n && ' \n\t\r\f'.includes(css[j])) j += 1
      const prev = out[out.length - 1]
      const next = css[j]
      const dropBefore = prev === undefined || '{;,}'.includes(prev)
      const dropAfter = next === undefined || '{;,}'.includes(next)
      if (!dropBefore && !dropAfter) out += ' '
      i = j
      continue
    }
    out += ch
    i += 1
  }
  // 结尾多余分号
  return out.replace(/;}/g, '}').trim()
}

function cssAsString() {
  let cached = null
  return {
    name: 'css-as-string',
    setup(b) {
      b.onResolve({ filter: /\.css$/ }, () => ({ path: 'panel-css', namespace: 'css' }))
      b.onLoad({ filter: /^panel-css$/, namespace: 'css' }, async () => {
        if (cached === null) {
          cached = await compileTailwindCss()
        }
        return { contents: 'export default ' + JSON.stringify(cached), loader: 'js' }
      })
    },
  }
}

/** esbuild 构建配置（单次 build 与 watch context 共用）。 */
function buildConfig(outfile) {
  return {
    entryPoints: [ENTRY],
    bundle: true,
    format: 'cjs',
    platform: 'browser',
    target: 'es2020',
    external: ['react'],
    jsx: 'transform',
    jsxFactory: 'React.createElement',
    jsxFragment: 'React.Fragment',
    // 构建期常量：与 host 半（tsdown.config.ts）注入同一组值，
    // 浏览器据此与 GET /api/stock-panel/build 对比，检出「跑着旧构建」。
    define: {
      __PANEL_VERSION__: JSON.stringify(pluginVersion()),
      __PANEL_BUILD_ID__: JSON.stringify(computeBuildId()),
    },
    outfile,
    plugins: [cssAsString()],
  }
}

/** 组装 __ModuleLoader__.load 包装后的最终字节。 */
function wrap(body) {
  return Buffer.from(
    'window.__ModuleLoader__.load({\n'
    + '\tid: ' + JSON.stringify(PLUGIN_ID) + ',\n'
    + '\tfactory: (require) => {\n'
    + '\t\tvar module = { exports: {} };\n'
    + '\t\tvar exports = module.exports;\n'
    + body.replace(/\n$/, '')
    + '\n\t\treturn module.exports;\n'
    + '\t}\n'
    + '});\n',
  )
}

/**
 * 生成 client.js（官方 __ModuleLoader__.load 契约）。
 * @param {{ check?: boolean }} opts
 * @returns {{ ok: boolean, errors?: string[], skipped?: string }}
 */
export async function generate({ check = false } = {}) {
  if (!(await esbuildAvailable())) {
    return { ok: true, skipped: 'esbuild 不可用：项目内 pnpm install 安装 devDependencies' }
  }
  const { build } = await import('esbuild')

  const tmpOut = OUTPUT + '.tmp'
  await build(buildConfig(tmpOut))
  const body = readFileSync(tmpOut, 'utf8')
  try { unlinkSync(tmpOut) } catch {}

  const code = wrap(body)

  if (!check) {
    mkdirSync(join(ROOT, 'lib'), { recursive: true })
    writeFileSync(OUTPUT, code)
    return { ok: true }
  }
  let committed = null
  try {
    committed = readFileSync(OUTPUT)
  } catch {
    return { ok: false, errors: [OUTPUT + ' 不存在：运行 node scripts/build-client.mjs 生成'] }
  }
  if (Buffer.compare(committed, code) !== 0) {
    return { ok: false, errors: ['client.js 与生成器输出不一致：运行 node scripts/build-client.mjs 重新生成（手改生成物禁止）'] }
  }
  return { ok: true }
}

/**
 * 监听模式：esbuild watch context，src/ 下 TS/TSX/CSS 变更时自动重打包。
 * @returns {Promise<void>}
 */
export async function watch() {
  if (!(await esbuildAvailable())) {
    console.log('[build-client] SKIP：esbuild 不可用')
    return
  }
  const { context } = await import('esbuild')
  const finalCtx = await context({
    ...buildConfig(OUTPUT + '.tmp'),
    onEnd(result) {
      if (result.errors.length === 0) {
        const body = readFileSync(OUTPUT + '.tmp', 'utf8')
        mkdirSync(join(ROOT, 'lib'), { recursive: true })
        writeFileSync(OUTPUT, wrap(body))
        console.log('[build-client] rebuilt → lib/client.js')
      } else {
        for (const e of result.errors) console.error('[build-client]', e.text)
      }
    },
  })
  await finalCtx.watch()
  console.log('[build-client] watching src/ …（Ctrl+C 停止）')
}

// CLI 入口（被 import 时不执行）。
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const check = process.argv.includes('--check')
  const watchMode = process.argv.includes('--watch')
  if (watchMode) {
    await watch()
  } else {
    const result = await generate({ check })
    if (result.skipped !== undefined) {
      console.log('[build-client] SKIP：' + result.skipped)
      process.exit(0)
    }
    if (!result.ok) {
      for (const e of result.errors ?? []) console.error('[build-client] ' + e)
      process.exit(1)
    }
    console.log(check ? '[build-client] client.js 新鲜（--check OK）' : '[build-client] client.js 已生成')
  }
}
