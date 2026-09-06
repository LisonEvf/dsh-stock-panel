#!/usr/bin/env node
/**
 * check-bundle-size.mjs — client.js 体积护栏（M11，CI 用）。
 *
 * 说明：lib/client.js 为未压缩产物（保留可调试性，wrapper 不做 minify）。
 * 阈值默认 600KB（env CLIENT_MAX_KB 可覆盖）。当前 ~520KB 出头；
 * 若超限：优先做「页面级动态 import」拆分或外部化（见 README §发布治理）。
 */
import { existsSync, statSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const file = join(resolve(__dirname, '..'), 'lib', 'client.js')
const maxKb = Number(process.env.CLIENT_MAX_KB ?? 600)

if (!existsSync(file)) {
  console.error('[check-bundle] 缺 lib/client.js —— 请先 pnpm build')
  process.exit(1)
}
const kb = statSync(file).size / 1024
console.log(`[check-bundle] lib/client.js = ${kb.toFixed(1)} KB（护栏 ${maxKb} KB）`)
if (kb > maxKb) {
  console.error(`[check-bundle] ✗ 超限 ${(kb - maxKb).toFixed(1)} KB —— 需拆分/瘦身`)
  process.exit(1)
}
console.log('[check-bundle] ✓ 通过')
