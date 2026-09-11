#!/usr/bin/env node
/**
 * check-bundle-size.mjs — client.js 体积护栏（M11，CI 用）。
 *
 * 说明：client.js **默认 minify**（B2 决策，2026-09-12）；同时产出 `lib/client.js.map`
 * 补偿可调试性 —— 宿主 client-modules 层会读取该 map 并校验为 Source Map v3，
 * 再盖章自己的组合 map URL（map 缺失不影响插件执行）。逃生阀：`CLIENT_MINIFY=0`。
 * 阈值默认 600KB（env CLIENT_MAX_KB 可覆盖）。
 *
 * 体积账：
 *   665KB   1.1.x 基线（窄列版：10 个页面全内联，未压缩）
 *   ≈687KB  1.2.0（官方 conversation.view 化）
 *   ≈757KB  1.3.0（宽视图重排：三段式骨架 + 盯盘工作区 + AI 双通道 + 跟随 DSH 主题）
 *           其中 CSS 字符串 45.6KB（压缩前 ≈69KB，minifyCss 已回收 23KB）
 *   796.7KB 1.4.0 合并发布（+ 构建可见性 / ladder 共享缓存 / B6 修复）
 *   814.0KB 1.4.0+A1（host 侧持久化）→ 当时阈值 820 → 840KB（余量只剩 2%）
 *   825.8KB 1.4.0+B5③（诊断面板）
 *   **530.8KB 1.4.0+B2（开启 minify；−35.7%）→ 阈值 840 → 600KB（余量 69KB）**
 *
 * 成分（`node scripts/bundle-report.mjs`，未压缩口径 822.5KB）：
 *   lightweight-charts 216.8KB(26%) · src/pages 175.9KB(22%；ReviewPage 单文件 51.8KB)
 *   · src/components 136KB(17%) · src/lib 125.7KB(16%) · 内联 CSS 44.6KB(5.5%)
 *   压缩口径：minify 527.4KB（64.1%）· gzip(未压缩) 179.8KB · gzip(minify) 141.8KB
 * 结论：体积大头是「我们的代码 + 图表库」，不是可随手砍的零碎 —— 先用 minify 拿回
 * 35% 的确定收益；后续减重靠 A5（token 迁移、退役旧页面）与死代码清理。
 *
 * ⚠️ 逃生阀 `CLIENT_MINIFY=0` 下体积会**超护栏**（≈825.8KB）：这是预期行为，护栏卡的是
 * 「随包分发的体积」。本地要读产物时用 `CLIENT_MAX_KB=900 CLIENT_MINIFY=0 pnpm build`。
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
const maxKb = Number(process.env.CLIENT_MAX_KB ?? 600)

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
