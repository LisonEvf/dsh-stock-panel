#!/usr/bin/env node
/**
 * check-bundle-size.mjs — client.js 体积护栏（M11，CI 用）。
 *
 * 说明：lib/client.js 为未压缩产物（保留可调试性，wrapper 不做 minify）；
 * 内联的 CSS 字符串已在构建期压缩（scripts/build-client.mjs 的 minifyCss）。
 * 阈值默认 820KB（env CLIENT_MAX_KB 可覆盖）。
 *
 * 体积账（2026-09-08 实测）：
 *   665KB  1.1.x 基线（窄列版：10 个页面全内联）
 *   ≈687KB 1.2.0（官方 conversation.view 化）
 *   ≈757KB 1.3.0（宽视图重排：三段式骨架 + 盯盘工作区 + AI 双通道 + 跟随 DSH 主题）
 *         其中 CSS 字符串 45.6KB（压缩前 ≈69KB，minifyCss 已回收 23KB）
 *
 * 为什么不能靠"拆分"瘦身：插件契约要求 client bundle 是**单模块**（flat module
 * graph，见 README §技术要点），esbuild 无法 code splitting —— 视图不能动态 import。
 * 因此唯一有效杠杆是**减少内联代码**：
 *   1. 退役被新骨架取代的旧页面（StockDetailPage / WatchlistPage 等），逐个删除；
 *   2. 迁移页面到 --dc-* token 后删掉 index.css.txt 的过渡重映射层；
 *   3. 控制新依赖（lucide 已按需 tree-shake；不要再引入图表库/动效库）。
 * 护栏的作用是拦住"顺手引入大依赖"，而不是限制正常功能增长——但每次上调阈值
 * 都要在这里留一行账。
 */
import { existsSync, statSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const file = join(resolve(__dirname, '..'), 'lib', 'client.js')
const maxKb = Number(process.env.CLIENT_MAX_KB ?? 820)

if (!existsSync(file)) {
  console.error('[check-bundle] 缺 lib/client.js —— 请先 pnpm build')
  process.exit(1)
}
const kb = statSync(file).size / 1024
console.log(`[check-bundle] lib/client.js = ${kb.toFixed(1)} KB（护栏 ${maxKb} KB）`)
if (kb > maxKb) {
  console.error(`[check-bundle] ✗ 超限 ${(kb - maxKb).toFixed(1)} KB —— 见本文件顶部的体积账与瘦身杠杆`)
  process.exit(1)
}
console.log('[check-bundle] ✓ 通过')
