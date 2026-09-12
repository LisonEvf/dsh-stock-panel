// scripts/unit.mjs —— 单元测试运行器（B4）
//
// 为什么自己写一个 runner：本仓库**刻意不引入测试框架**（`node:test` 是 Node 内置的，
// 而测试文件是 TS —— 需要一个转译步骤）。这里复用已有的 devDependency `esbuild`
// 把 `tests/**/*.test.ts` 打成一个 Node ESM 文件再执行，零新增依赖、零配置。
//
// 用法：
//   node scripts/unit.mjs            # 跑全部
//   node scripts/unit.mjs indicators # 只跑文件名包含 indicators 的
//
// 约定：测试用 `import { test } from 'node:test'` + `node:assert/strict`；
//       测试文件放 `tests/**/*.test.ts`，通过相对路径直接 import `src/**` 的源码。
// 注意：测试文件**不在 tsconfig 的 include(src) 里**，所以 `tsc --noEmit` 不检查它们
//       （断言正确性由运行结果保证；类型错误会被 esbuild 直接暴露为语法/解析错误）。

import { mkdirSync, readdirSync, rmSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { spawnSync } from 'node:child_process'

const ROOT = process.cwd()
const TESTS_DIR = join(ROOT, 'tests')
const OUT_DIR = join(ROOT, '.unit-build')
const filter = process.argv[2]

/** 递归收集 *.test.ts。 */
function collect(dir, out = []) {
  let entries
  try {
    entries = readdirSync(dir, { withFileTypes: true })
  } catch {
    return out
  }
  for (const e of entries) {
    const p = join(dir, e.name)
    if (e.isDirectory()) collect(p, out)
    else if (e.isFile() && e.name.endsWith('.test.ts')) out.push(p)
  }
  return out
}

const files = collect(TESTS_DIR)
  .filter((f) => filter === undefined || f.includes(filter))
  .sort()

if (files.length === 0) {
  console.error(filter === undefined ? '[unit] tests/ 下没有 *.test.ts' : `[unit] 没有匹配 "${filter}" 的测试`)
  process.exit(1)
}

let { build } = {}
try {
  ;({ build } = await import('esbuild'))
} catch {
  console.error('[unit] esbuild 不可用 —— 先 pnpm install（devDependencies）')
  process.exit(1)
}

rmSync(OUT_DIR, { recursive: true, force: true })
mkdirSync(OUT_DIR, { recursive: true })

let failed = 0
for (const file of files) {
  const outFile = join(OUT_DIR, relative(TESTS_DIR, file).replace(/[\\/]/g, '_').replace(/\.ts$/, '.mjs'))
  try {
    await build({
      entryPoints: [file],
      outfile: outFile,
      bundle: true,
      platform: 'node',
      format: 'esm',
      target: 'node20',
      // `node:*` 由 platform:node 自动置为 external；我们的源码只 import 相对路径与 node:*
      logLevel: 'error',
    })
  } catch (err) {
    failed += 1
    console.error(`✗ ${relative(ROOT, file)} 打包失败：${err?.message ?? err}`)
    continue
  }
  const r = spawnSync(process.execPath, [outFile], { stdio: 'inherit' })
  if (r.status !== 0) failed += 1
}

rmSync(OUT_DIR, { recursive: true, force: true })

if (failed > 0) {
  console.error(`[unit] ${failed}/${files.length} 个测试文件未通过`)
  process.exit(1)
}
console.log(`[unit] 全部通过 ✅（${files.length} 个测试文件）`)

/** 供诊断用：确认 tests 目录存在。 */
void statSync
