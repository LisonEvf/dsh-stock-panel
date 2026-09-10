#!/usr/bin/env node
/**
 * update-opentdx.mjs — 刷新内置 node-tdx（opentdx JS 客户端）vendor 产物。
 *
 * node-tdx 以「构建产物 vendor」方式内置进 host 半（src/host/vendor/opentdx.js），
 * 避免发布物运行时依赖 git/外部源码。升级流程：
 *   1. 更新下方 GIT_REF（commit/tag），跑本脚本；
 *   2. 重新构建：pnpm build；
 *   3. 跑 src/host 适配层冒烟（quote/kline/tick/… 与远端 MCP 对照），
 *      必要时按实拆 diff 更新 src/host/tdx-data.ts 的归一化规则；
 *   4. 提交 vendor 两个文件与 LICENSE。
 *
 * 用法：node scripts/update-opentdx.mjs [--ref <commit|tag>]
 * 需要 git 与 npm（联网）。
 */
import { execFileSync } from 'node:child_process'
import { cpSync, mkdirSync, rmSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const args = process.argv.slice(2)
const refArg = args.indexOf('--ref') !== -1 ? args[args.indexOf('--ref') + 1] : undefined
const GIT_REF = refArg ?? 'b8f6e07f11d846d38c53dcdb0d1082394b02c585' // LisonEvf/node-tdx（远端兜底 ref）
const REPO = 'https://github.com/LisonEvf/node-tdx.git'

const here = fileURLToPath(new URL('..', import.meta.url))
const vendorDir = join(here, 'src', 'host', 'vendor')
// 本地克隆（TRADE/node-tdx）优先：保持与本地源码同步（含未推送的解析器修复）。
const localRepo = join(here, '..', '..', 'node-tdx')
const useLocal = existsSync(join(localRepo, 'package.json'))
const work = useLocal ? localRepo : join(tmpdir(), `opentdx-update-${Date.now()}`)

try {
  if (useLocal) {
    console.log(`[update-opentdx] 使用本地克隆 ${work}`)
  } else {
    execFileSync('git', ['clone', '--depth', '1', REPO, work], { stdio: 'inherit' })
    execFileSync('git', ['-C', work, 'checkout', GIT_REF], { stdio: 'inherit' })
  }
  execFileSync('npm', ['install', '--no-audit', '--no-fund'], { cwd: work, stdio: 'inherit' })
  execFileSync('npm', ['run', 'build'], { cwd: work, stdio: 'inherit' })

  const dist = join(work, 'dist', 'index.js')
  if (!existsSync(dist)) throw new Error('dist/index.js 未生成')
  mkdirSync(vendorDir, { recursive: true })
  cpSync(dist, join(vendorDir, 'opentdx.js'))
  cpSync(join(work, 'LICENSE'), join(vendorDir, 'opentdx-LICENSE.txt'))
  const src = useLocal ? '本地 TRADE/node-tdx' : GIT_REF
  console.log(`[update-opentdx] vendored ${src} -> src/host/vendor/opentdx.js`)
  console.log('[update-opentdx] 重新跑 pnpm build 并按适配层冒烟核对字段契约')
} finally {
  if (!useLocal) rmSync(work, { recursive: true, force: true })
}
