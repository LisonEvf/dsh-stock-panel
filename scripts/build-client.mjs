// build-client.mjs
//
// 单独构建 client 半（dsh.client 浏览器端 bundle），输出单文件 CJS 并自注册。
//
// 注意：rolldown beta 的顶层 format 选项不生效，必须放在 output.format。

import { build } from 'rolldown'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import postcss from 'postcss'
import tailwindcss from 'tailwindcss'
import autoprefixer from 'autoprefixer'

const __dirname = fileURLToPath(new URL('.', import.meta.url))
const root = resolve(__dirname, '..')
const clientEntry = resolve(root, 'src/client.ts')
const outClient = resolve(root, 'lib/client.js')

/** 解析 tsconfig 的 @/* -> src/*，自动补扩展名。 */
function alias() {
  const exts = ['', '.ts', '.tsx', '.js', '.jsx', '.mjs', '.json']
  return {
    name: 'tsconfig-alias',
    async resolveId(source, importer) {
      if (source.startsWith('@/')) {
        const base = resolve(root, 'src', source.slice(2))
        for (const ext of exts) {
          const c = base + ext
          if (existsSync(c)) return c
        }
        for (const ext of exts) {
          const c = resolve(base, 'index' + ext)
          if (existsSync(c)) return c
        }
      }
      return null
    },
  }
}

/**
 * 编译插件样式：把 src/index.css.txt（@tailwind 指令 + .dsh-stock 组件样式）
 * 用 Tailwind + Autoprefixer 编译成纯 CSS，先落盘为真实的 .mjs 模块
 * （lib/.generated/panel-css.mjs，内容为 `export default "<css>"`），再让
 * `import './index.css'` 解析到它。
 *
 * 为什么不直接在 resolveId/load 里虚拟化：rolldown 对 .css.txt 等未知扩展名
 * 或 \0 虚拟 id 的 load 结果处理不可靠（asset 管线会把返回的代码再包一层
 * 字符串，或直接给空对象）。真实文件是最稳的路径。
 *
 * ⚠️ corePlugins.preflight 关闭：插件样式必须作用域隔离，不能把 Tailwind
 * preflight 的全局 reset 灌进 dsh shell（会打乱宿主 UI）。
 */
const RAW_CSS = resolve(root, 'src/index.css.txt')
const GEN_DIR = resolve(root, 'lib/.generated')
const GEN_CSS = resolve(GEN_DIR, 'panel-css.mjs')

/** 编译一次并写入生成的 CSS 模块文件。 */
async function compileStockCss() {
  const raw = readFileSync(RAW_CSS, 'utf8')
  const result = await postcss([
    tailwindcss({
      // 内容扫描相对 repo 根（脚本在 repo 根执行）
      content: [resolve(root, 'src/**/*.{ts,tsx}')],
      corePlugins: { preflight: false },
      theme: { extend: {} },
    }),
    autoprefixer(),
  ]).process(raw, { from: undefined })
  const css = result.css
  console.log(`[build-client] compiled stock css: ${css.length} chars`)
  mkdirSync(GEN_DIR, { recursive: true })
  writeFileSync(GEN_CSS, `export default ${JSON.stringify(css)}\n`, 'utf8')
  return css
}

/** 把 .css 导入解析到生成的 .mjs 文件。 */
function cssToGenerated() {
  return {
    name: 'stock-css-to-generated',
    enforce: 'pre',
    async resolveId(source) {
      if (!source.endsWith('.css')) return null
      return GEN_CSS
    },
  }
}

/** dsh.client 自注册包装器 + ESM export 修正。 */
function dshClientSelfRegister() {
  return {
    name: 'dsh-client-self-register',
    enforce: 'post',
    renderChunk(code) {
      let transformed = code
        .replace(/export\s*\{\s*apply\s*\}\s*;?/g, 'exports.apply = apply;')
        .replace(/export\s*\{\s*apply as (\w+)\s*\}\s*;?/g, 'exports. = apply;')
      // 注意：不声明 react / runtime external —— 它们由 bundler 内联为 const，
      // 在 factory 内再声明同名变量会 "Identifier already been declared"。
      const wrapper = "window.__ModuleLoader__.load({\n" +
        "  id: \"@lisonevf/dsh-stock-panel\",\n" +
        "  // patch-layout 版：client 半注册 `stock` / `stock.preview` 槽，\n" +
        "  // 由宿主启动时的布局补丁引擎（src/layout-patch.ts）新增主布局第四列。\n" +
        "  factory: (require) => {\n" +
        "    var module = { exports: {} };\n" +
        "    var exports = module.exports;\n" +
        "    Object.defineProperty(exports, Symbol.toStringTag, { value: \"Module\" });\n" +
        "    //#region build output\n" +
        transformed + "\n" +
        "    //#endregion\n" +
        "    exports.inject = [\"slots\"];\n" +
        "    return module.exports;\n" +
        "  }\n" +
        "});\n"
      return { code: wrapper, map: null }
    },
  }
}

try {
  // 1) 先编译样式并写盘（真实文件，避开 rolldown 的 asset/虚拟模块坑）
  await compileStockCss()

  // 2) 再跑 rolldown：client.ts 里的 `import './index.css'` 会被
  //    cssToGenerated 指向真实存在的 GEN_CSS。
  await build({
    input: [clientEntry],
    platform: 'browser',
    target: 'es2020',
    external: ['react', 'react/jsx-runtime', 'react-dom', 'react-dom/client', '@deepseek-ai/cordis', '@deepseek-ai/dsh-client-runtime'],
    plugins: [alias(), cssToGenerated(), dshClientSelfRegister()],
    output: {
      file: outClient,
      sourcemap: true,
      inlineDynamicImports: true,
      format: 'cjs',
      exports: 'named',
    },
  })
  console.log('[build-client] done -> lib/client.js')
} finally {
  // 3) 清理生成的样式模块文件（lib/ 由 tsdown clean 管，这里顺手删掉）。
  try { rmSync(GEN_DIR, { recursive: true, force: true }) } catch { /* ignore */ }
}
