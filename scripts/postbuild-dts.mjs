// postbuild-dts.mjs
//
// 补齐 package.json `exports` 引用的入口类型声明文件。
//
// 背景：
//   - index 半用 tsdown 构建，dts 输出为 lib/index-*.d.ts 分片，
//     按 package.json `exports["."]` 约定补齐 lib/types/index.d.ts。
//   - client 半用 esbuild 直接构建（scripts/build-client.mjs），
//     输出单文件 CJS lib/client.js，无 .d.ts。
//
//   因此这里生成两个入口 .d.ts：
//     lib/types/index.d.ts        -> 重新导出 index 片段的符号
//     lib/types/client/index.d.ts -> client 半的薄壳类型（apply + inject）

import { mkdirSync, writeFileSync, readdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const libDir = resolve(root, 'lib')
const typesDir = resolve(libDir, 'types')

/** 为 index 入口生成 lib/types/index.d.ts 薄壳。 */
function writeIndexDts() {
  const entries = readdirSync(libDir)
  const match = entries.find((f) => f.startsWith('index-') && f.endsWith('.d.ts'))
  if (!match) {
    throw new Error(
      '[postbuild-dts] 未在 lib/ 找到 index 的分片 .d.ts（需要 tsdown 先生成 JS 产物）'
    )
  }
  const body = `export * from "./${match}";\n`
  const content =
    '// 由 scripts/postbuild-dts.mjs 自动生成，勿手改。\n' +
    '// 薄壳：把 tsdown 生成的分片 .d.ts 重新导出为 exports 约定的入口路径。\n\n' +
    body
  const out = resolve(typesDir, 'index.d.ts')
  mkdirSync(typesDir, { recursive: true })
  writeFileSync(out, content, 'utf8')
  console.log(`[postbuild-dts] wrote ${out.replace(root + '\\', '').split('\\').join('/')}`)
}

/** 为 client 半生成 lib/types/client/index.d.ts 薄壳类型。 */
function writeClientDts() {
  const clientDts = `// 由 scripts/postbuild-dts.mjs 自动生成，勿手改。
// client 半由 esbuild 构建（无 .d.ts），这里声明 dsh.client 包契约面。

/** 运行时由 @deepseek-ai/dsh-client-runtime 提供的 ctx。 */
export type DshClientCtx = any;

/** dsh.client 包契约：apply 注册 UI，inject 声明所需 service 名。 */
export interface ClientPluginModule {
  apply: (ctx: DshClientCtx) => void
  inject: string[]
}

export declare const apply: (ctx: DshClientCtx) => void
export declare const inject: string[]
`
  const out = resolve(typesDir, 'client', 'index.d.ts')
  mkdirSync(resolve(typesDir, 'client'), { recursive: true })
  writeFileSync(out, clientDts, 'utf8')
  console.log(`[postbuild-dts] wrote ${out.replace(root + '\\', '').split('\\').join('/')}`)
}

writeIndexDts()
writeClientDts()
console.log('[postbuild-dts] done')
