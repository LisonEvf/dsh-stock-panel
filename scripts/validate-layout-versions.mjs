#!/usr/bin/env node
/**
 * validate-layout-versions.mjs — ui-layout 补丁规则多版本回归验证器（开发/CI 用）。
 *
 * 对一组 ui-layout 版本逐一：
 *   1. 从 npm 拉取 pristine 构建产物（或用本地已解包目录 --dir）；
 *   2. 复制到临时文件（绝不触碰真实安装 bundle）；
 *   3. 用 lib/index.js 里的自适应引擎打补丁；
 *   4. 断言注入产物（结构自检），输出通过/失败表。
 *
 * 用法：
 *   node scripts/validate-layout-versions.mjs                      # 默认验证已验证区间
 *   node scripts/validate-layout-versions.mjs 0.1.3-alpha.2 ...    # 指定版本
 *   node scripts/validate-layout-versions.mjs --dir C:\tmp\uil-0.1.3-alpha.2
 *
 * 需要先 `pnpm build`（引擎从 lib/index.js 导入）。
 * 退出码：全部通过 0，任一失败 1。
 */
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath, pathToFileURL } from 'node:url'

const PKG = '@deepseek-ai/dsh-client-ui-layout'
const DEFAULT_VERSIONS = ['0.1.1-rc.2', '0.1.2-alpha.5', '0.1.2-rc.1']

const args = process.argv.slice(2)
const dirModeIdx = args.indexOf('--dir')

function loadEngine() {
  const engineUrl = pathToFileURL(fileURLToPath(new URL('../lib/index.js', import.meta.url))).href
  return import(engineUrl)
}

/** 逐项结构断言（与版本无关的语义产物）。 */
const POST_CHECKS = [
  ['grid has stock track', /gridTemplateColumns:\s*`\$\{cols\.sidebar\}px\s+minmax\(0,\s*1fr\)\s+\$\{cols\.details\}px\s+\$\{cols\.stock\}px`/],
  ['renderSlot("stock") present', /renderSlot\("stock"/],
  ['computeColumns takes 4 params', /function\s+computeColumns\(viewport,\s*sidebar,\s*stock,\s*details\)/],
  ['setStock store action present', /setStock:\s*\(d,\s*px\)\s*=>\s*\{\s*d\.stock\s*=\s*clampWidth\(px,\s*200,\s*420\)/],
  ['apply.children stock slot registered', /"stock":\s*\{\s*kind:\s*"single",\s*scope:\s*"root"\s*\}/],
  ['conversationSeat classMap entry', /"conversationSeat":\s*"[A-Za-z0-9_-]+"/],
  ['stockCol css rule injected', /\.[A-Za-z0-9_-]+stockCol\s*\{[^}]*border-right:[^}]*\}/],
  ['data-stock-collapsed marker', /"data-stock-collapsed":\s*cols\.stock\s*===\s*0/],
  ['css-module classMap has stockCol', /"stockCol":\s*"[A-Za-z0-9_-]+"/],
  ['stock drag handle css duplicated', /\[data-side=stock\]:after/],
]

function runChecks(text) {
  const results = []
  for (const [label, re] of POST_CHECKS) {
    results.push({ label, ok: re.test(text) })
  }
  return results
}

function fetchPristine(version, workRoot) {
  // 参数是已解包的本地目录（`<dir>/package/lib/client.js` 或 `<dir>/lib/client.js`）时直接复用。
  const candidates = [
    join(version, 'package', 'lib', 'client.js'),
    join(version, 'lib', 'client.js'),
  ]
  const local = candidates.find((c) => existsSync(c))
  if (local) {
    const root = local.slice(0, -'lib/client.js'.length)
    const manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
    return { clientJs: local, versionInfo: manifest.version ?? version }
  }
  const dir = join(workRoot, `pkg-${version}`)
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true })
    const pack = spawnSync('npm', ['pack', `${PKG}@${version}`, '--pack-destination', dir], {
      encoding: 'utf8',
    })
    if (pack.status !== 0) throw new Error(`npm pack ${version} failed: ${pack.stderr || pack.error}`)
    const tarball = pack.stdout.trim().split('\n').pop()
    const tar = spawnSync('tar', ['-xzf', join(dir, tarball), '-C', dir], { encoding: 'utf8' })
    if (tar.status !== 0) throw new Error(`tar extract ${version} failed: ${tar.stderr || tar.error}`)
  }
  const clientJs = join(dir, 'package', 'lib', 'client.js')
  if (!existsSync(clientJs)) throw new Error(`no lib/client.js in ${PKG}@${version}`)
  const versionInfo = JSON.parse(readFileSync(join(dir, 'package', 'package.json'), 'utf8')).version ?? version
  return { clientJs, versionInfo }
}

const engine = await loadEngine()
const { applyLayoutPatch } = engine

const versions = dirModeIdx !== -1 ? [args[dirModeIdx + 1]] : args.length ? args : DEFAULT_VERSIONS
// 净化 \\?\ 扩展路径前缀（rolldown 打包的 node:fs realpathSync 处理不了）。
const rawTmp = tmpdir()
const osTmp = rawTmp.startsWith('\\\\?\\\\') ? rawTmp.slice(4) : rawTmp
const root = mkdirSync(join(osTmp, `uilayout-validate-${Date.now()}`), { recursive: true })
const workHome = join(root, 'dshhome')
let failed = false

try {
  for (let idx = 0; idx < versions.length; idx++) {
    const version = versions[idx]
    let pristine
    try {
      pristine = fetchPristine(version, root)
    } catch (err) {
      console.error(`\n[${version}] SKIP — fetch failed: ${err.message}`)
      failed = true
      continue
    }
    const work = join(root, `work-${idx}.js`)
    cpSync(pristine.clientJs, work)
    let result
    try {
      result = applyLayoutPatch({ target: work, dshHome: workHome })
    } catch (err) {
      console.error(`[apply threw] target=${work}\ndshHome=${workHome}\nworkExists=${existsSync(work)}\nroot=${root}`)
      throw err
    }
    console.log(`\n=== ${PKG}@${version} (installed pkg version: ${pristine.versionInfo}) ===`)
    console.log(`status: ${result.status}${result.variant ? ` (variant ${result.variant})` : ''}`)
    if (result.failures && result.failures.length) {
      console.log('failures:')
      for (const f of result.failures.slice(0, 30)) console.log(`  ${f}`)
    }
    if (result.status === 'patched') {
      const text = readFileSync(work, 'utf8')
      const checks = runChecks(text)
      for (const c of checks) {
        console.log(`  [${c.ok ? 'PASS' : 'FAIL'}] ${c.label}`)
        if (!c.ok) failed = true
      }
    } else if (result.status !== 'already-patched') {
      failed = true
    }
  }
} finally {
  rmSync(root, { recursive: true, force: true })
}

console.log(failed ? '\nRESULT: FAILED' : '\nRESULT: ALL PASSED')
process.exit(failed ? 1 : 0)
