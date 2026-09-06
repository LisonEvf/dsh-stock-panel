#!/usr/bin/env node
/**
 * patch-layout.mjs — ui-layout stock 列补丁 CLI（薄封装，引擎在 lib/index.js）。
 *
 * 补丁引擎与锚点表已内嵌进 `src/layout-patch.ts`（随 lib/ 发布），本脚本只是
 * 手动运维 / 调试入口，宿主在启动时会**同步自动**执行同一份引擎
 * （`ensureLayoutPatchAtBoot`），因此 `dsh plugin --profile web add` 后无需
 * 手动运行本脚本。
 *
 * 用法：
 *   node scripts/patch-layout.mjs [--target <abs path to client.js>] [--force]
 *   node scripts/patch-layout.mjs --check          # 查看当前补丁状态
 *   node scripts/patch-layout.mjs --unpatch        # 用 pristine 备份还原 bundle
 *
 * 默认 target 解析 profile junction：
 *   <DSH_HOME>/profiles/node_modules/@deepseek-ai/dsh-client-ui-layout/lib/client.js
 * pristine 备份目录：<DSH_HOME>/patches/layout.backup/client.js.orig
 */
import { existsSync } from 'node:fs'
import { fileURLToPath, pathToFileURL } from 'node:url'

// 引擎从构建产物 lib/index.js 导出（需先 `pnpm build`）。
let engine
try {
  const engineUrl = pathToFileURL(fileURLToPath(new URL('../lib/index.js', import.meta.url))).href
  engine = await import(engineUrl)
} catch (err) {
  console.error('[patch-layout] failed to load lib/index.js — run `pnpm build` first.', err?.message ?? err)
  process.exit(1)
}
const { applyLayoutPatch, revertLayoutPatch, layoutPatchState } = engine

const args = process.argv.slice(2)
const targetArg = args.includes('--target') ? args[args.indexOf('--target') + 1] : undefined
const force = args.includes('--force')
const wantUnpatch = args.includes('--unpatch')
const wantCheck = args.includes('--check')

function printState() {
  const state = layoutPatchState()
  console.log(`[patch-layout] target:          ${state.clientPath}`)
  console.log(`[patch-layout] exists:          ${state.exists}`)
  console.log(`[patch-layout] patched:         ${state.patched === null ? 'unknown' : state.patched}`)
  console.log(`[patch-layout] ui-layout ver:   ${state.version ?? '(unreadable)'}`)
  console.log(`[patch-layout] expected ver:    ${state.expectedVersion}`)
  console.log(`[patch-layout] pristine backup: ${state.backupExists}`)
}

function fail(message) {
  console.error(message)
  process.exit(1)
}

if (wantCheck) {
  printState()
  process.exit(0)
}

if (targetArg && !existsSync(targetArg)) {
  fail(`[patch-layout] target not found: ${targetArg}\n[patch-layout] is DSH_HOME correct, or pass --target <abs path>?`)
}

if (wantUnpatch) {
  const result = revertLayoutPatch({ target: targetArg, force })
  switch (result.status) {
    case 'reverted':
      console.log(`[patch-layout] reverted to pristine bundle: ${result.target}`)
      process.exit(0)
    case 'already-clean':
      console.log(`[patch-layout] bundle not patched (${result.target}) — nothing to do.`)
      process.exit(0)
    case 'no-target':
      fail(`[patch-layout] target not found: ${result.target}`)
      break
    case 'no-backup':
      fail(`[patch-layout] no pristine backup at <DSH_HOME>/patches/layout.backup/client.js.orig — cannot revert.`)
      break
    default:
      fail(`[patch-layout] revert failed: ${JSON.stringify(result)}`)
  }
}

const result = applyLayoutPatch({ target: targetArg, force })
switch (result.status) {
  case 'already-patched':
    console.log(`[patch-layout] already patched (${result.target}) — nothing to do.`)
    process.exit(0)
  case 'patched':
    console.log(`[patch-layout] patched: ${result.target}`)
    console.log(`[patch-layout] build variant: ${result.variant}`)
    console.log('[patch-layout] verified: stockCol class, setStock action, stock slot render.')
    console.log('[patch-layout] pristine backup: <DSH_HOME>/patches/layout.backup/client.js.orig')
    console.log('[patch-layout] restart dsh web to serve the new bundle rev (or it self-heals on next boot).')
    process.exit(0)
  case 'no-target':
    fail(`[patch-layout] target not found: ${result.target}\n[patch-layout] this plugin expects the ui-layout bundle that carries sidebar/center/details columns.`)
    break
  case 'failed':
    console.error('[patch-layout] ABORTED — the bundle matches no known build variant:')
    for (const failure of result.failures ?? []) console.error(`  ${failure}`)
    console.error('[patch-layout] the dsh version may have changed; update the anchors in src/layout-patch.ts (see SUPPORTED_UI_LAYOUT_VERSION).')
    process.exit(1)
    break
  default:
    fail(`[patch-layout] unexpected result: ${JSON.stringify(result)}`)
}
