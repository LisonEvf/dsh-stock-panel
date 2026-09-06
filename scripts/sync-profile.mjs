#!/usr/bin/env node
/**
 * sync-profile.mjs — 把本地构建产物同步到 DSH profile 安装副本（M11）。
 *
 * 依据 MIGRATION-PLAN §11.5 清单固化为脚本：
 *   package.json（非硬链接，必须拷）· lib/index.js|map · lib/client.js|map · lib/*.d.ts
 *   · cordis.patch.yml（存在则一并同步，避免只读 store/链接漂移）。
 *
 * 用法：
 *   node scripts/sync-profile.mjs            # 默认 profile: web
 *   node scripts/sync-profile.mjs --profile work
 *   DSH_HOME=D:\\xxx node scripts/sync-profile.mjs   # 覆盖 ~/.dsh
 */
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { cpSync, existsSync, mkdirSync, readdirSync, realpathSync, statSync } from 'node:fs'

const __dirname = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(__dirname, '..')
const args = process.argv.slice(2)
const profile = args.indexOf('--profile') >= 0 ? args[args.indexOf('--profile') + 1] : 'web'
const dshHome = process.env.DSH_HOME || join(homedir(), '.dsh')
const profileDir = join(dshHome, 'profiles', profile)
const installDir = join(profileDir, 'node_modules', '@lisonevf', 'dsh-stock-panel')

if (!existsSync(profileDir)) {
  console.error(`[sync-profile] profile 目录不存在: ${profileDir}`)
  console.error(`  请先执行: dsh plugin --profile ${profile} add ${repoRoot}`)
  process.exit(1)
}

// 安装即本仓库（file:/link: 直连源码目录）→ 无需同步
try {
  const same = realpathSync(installDir) === realpathSync(repoRoot)
  if (same) {
    console.log(`[sync-profile] 安装即本仓库源码目录（${repoRoot}），无需同步。`)
    console.log('[sync-profile] 提示：仓库内改动只需 pnpm build，重启 dsh web 生效。')
    process.exit(0)
  }
} catch {
  /* installDir 不存在 → 继续按拷贝流程（会因缺目录报错提示） */
}

const files = ['package.json', 'cordis.patch.yml']
const libDir = join(repoRoot, 'lib')
if (!existsSync(libDir)) {
  console.error('[sync-profile] 请先 pnpm build（缺 lib/）')
  process.exit(1)
}

/** 拷贝文件/递归目录；目标不存在则创建父目录。 */
function syncOne(src, dest) {
  const rel = src.replace(libDir + '\\', '').replace(libDir + '/', '')
  mkdirSync(dirname(dest), { recursive: true })
  cpSync(src, dest, { recursive: true, force: true })
  console.log(`  → ${rel}`)
}

console.log(`[sync-profile] ${repoRoot} → ${installDir}`)
for (const f of files) {
  const src = join(repoRoot, f)
  if (!existsSync(src)) continue
  mkdirSync(installDir, { recursive: true })
  cpSync(src, join(installDir, f), { force: true })
  console.log(`  → ${f}`)
}

// lib/ 全量同步（保持 .generated 之外的构建产物一致）
const entries = readdirSync(libDir)
for (const e of entries) {
  const src = join(libDir, e)
  if (e === '.generated') continue
  if (statSync(src).isDirectory()) {
    for (const f of readdirSync(src)) syncOne(join(src, f), join(installDir, 'lib', e, f))
  } else {
    syncOne(src, join(installDir, 'lib', e))
  }
}

console.log('[sync-profile] done. 重启 dsh web（bundle rev 启动时重算）并在浏览器硬刷新。')
