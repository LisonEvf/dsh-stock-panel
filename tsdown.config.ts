import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { defineConfig } from 'tsdown'
// 构建标识的单一来源（版本号 + src 内容哈希）；client 半由 build-client.mjs 注入同一组值。
// @ts-ignore - 纯 JS 构建辅助，无需类型声明
import { computeBuildId, pluginVersion } from './scripts/build-id.mjs'

/** tsdown plugins 字段接受的 rolldown Plugin 结构（不直接 import rolldown 类型）。 */
interface CssPlugin {
  name: string
  enforce?: 'pre' | 'post'
  resolveId?(source: string, importer: string | undefined): Promise<string | null> | string | null
  load?(id: string): Promise<string | null> | string | null
  transform?(code: string, id: string): Promise<string | null> | string | null
}

/**
 * 注入构建期常量 __PANEL_VERSION__ / __PANEL_BUILD_ID__。
 *
 * 为什么不用 tsdown 的 `define`：本版 tsdown（0.13）不消费该字段——实测构建后
 * lib/index.js 里仍是裸的 `__PANEL_VERSION__`（运行时会 ReferenceError）。
 * 因此改成文本级注入：只处理 .ts/.tsx，且仅在源码真的引用占位符时改写。
 * client 半不受影响（esbuild 的 define 正常工作）。
 */
function injectBuildConsts(): CssPlugin {
  const version = JSON.stringify(pluginVersion())
  const buildId = JSON.stringify(computeBuildId())
  return {
    name: 'inject-build-consts',
    enforce: 'pre',
    transform(code, id) {
      if (!/\.(ts|tsx)$/.test(id)) return null
      if (!code.includes('__PANEL_VERSION__') && !code.includes('__PANEL_BUILD_ID__')) return null
      return code.replace(/__PANEL_VERSION__/g, version).replace(/__PANEL_BUILD_ID__/g, buildId)
    },
  }
}

/**
 * 把 .css 导入作为字符串内联。
 *
 * tsdown（基于 rolldown）1.2.x 已移除 CSS bundling 支持，且不支持 Vite 的 ?inline 后缀。
 * 策略：把 `*.css` 导入重定向到 `*.css.txt`，由本插件读取为字符串，
 * 从而完全绕过 CSS 处理管线。
 */
function cssAsString(): CssPlugin {
  return {
    name: 'css-as-string',
    enforce: 'pre',
    async resolveId(source, importer) {
      if (!source.endsWith('.css')) return null
      const abs = importer ? resolve(importer, '..', source) : resolve(process.cwd(), source)
      const txt = abs.replace(/\.css$/, '.css.txt')
      return txt
    },
    async load(id) {
      if (!id.endsWith('.css.txt')) return null
      const content = readFileSync(id, 'utf8')
      return `export default ${JSON.stringify(content)}\n`
    },
  }
}

export default defineConfig({
  entry: ['src/index.ts'],
  format: 'esm',
  // dts 产物由 tsdown 生成分片（lib/index-*.d.ts），
  // 入口 .d.ts（lib/types/index.d.ts 等）由 package.json 的 postbuild 脚本补齐。
  dts: true,
  sourcemap: true,
  clean: true,
  // platform 只接受 browser/node/neutral；web 插件用 browser。
  platform: 'browser',
  target: 'es2020',
  // 输出到 lib/，与 package.json 的 exports/files 约定一致。
  outDir: 'lib',
  plugins: [injectBuildConsts(), cssAsString()],
})
