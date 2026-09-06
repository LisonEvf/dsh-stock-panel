import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { defineConfig } from 'tsdown'
import type { Plugin } from 'rolldown'

/**
 * 把 .css 导入作为字符串内联。
 *
 * rolldown 1.2.x 已移除 CSS bundling 支持，且不支持 Vite 的 ?inline 后缀。
 * 策略：把 `*.css` 导入重定向到 `*.css.txt`，由本插件读取为字符串，
 * 从而完全绕过 rolldown 的 CSS 处理管线。
 */
function cssAsString(): Plugin {
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
  // rolldown 的 platform 只接受 browser/node/neutral；web 插件用 browser。
  platform: 'browser',
  target: 'es2020',
  // 输出到 lib/，与 package.json 的 exports/files 约定一致。
  outDir: 'lib',
  plugins: [cssAsString()],
})
