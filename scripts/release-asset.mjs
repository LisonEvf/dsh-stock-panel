#!/usr/bin/env node
/**
 * scripts/release-asset.mjs —— 发布当前版本：打成 tarball → 挂到 GitHub Release。
 *
 * ## 为什么发布走这里，而不是 npm registry
 *
 * 本插件的安装路径只有两条：**Release 资产 tarball**（推荐：一条命令、零配置、零凭证）与
 * **`github:...#main`**（跟主线走，需放行构建脚本）。tarball 路线之所以能"一键"，是因为
 * tarball 是**已构建产物** —— pnpm 直接落盘、不执行任何构建脚本，于是不需要凭证、不需要
 * allowBuilds。这条路要求 ① 每个发布版本都有对应的 Release 资产，② 资产内容 = 该 tag 的构建。
 * 本脚本把这两件事变成一条可复跑的命令。
 *
 * ## 用法
 *
 *   pnpm build && pnpm test && pnpm guard      # 门禁（脚本自己还会查产物与源码一致）
 *   git tag -a v1.6.1 -m "..." && git push origin v1.6.1
 *   GITHUB_TOKEN=<有 repo 权限的 PAT> node scripts/release-asset.mjs
 *
 *   --dry-run   只打包并打印（不碰远端），用于核对体积 / 文件名 / 一键命令
 *   --force     同名资产已存在时覆盖（默认**拒绝**：已发布的资产就是用户装的那一份，应当不可变）
 *
 * ## 两个必须知道的坑
 *
 * 1. **tag 要在远端**：Release 按 tag 找，本地 tag 没推上去就会建出一个空壳 release，而用户
 *    的一键命令指向的 tarball 并不存在。
 * 2. **收尾不要用 `process.exit()`**：在 Windows + Node 24 下，`fetch`（undici）还有挂着的句柄时
 *    `process.exit(N)` 会让进程以 libuv 断言崩溃（退出码 0xC0000409，而不是 1）。所以本脚本只设
 *    `process.exitCode`，让事件循环自然收尾。
 */
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdirSync, readFileSync, rmSync, statSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = join(import.meta.dirname, '..')
const args = process.argv.slice(2)
const DRY_RUN = args.includes('--dry-run')
const FORCE = args.includes('--force')
const REPO = process.env.GITHUB_REPOSITORY ?? 'LisonEvf/dsh-stock-panel'
const PKG = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'))
const VERSION = PKG.version
const TAG = `v${VERSION}`
const ASSET = `${PKG.name.replace('@', '').replace('/', '-')}-${VERSION}.tgz`
const OUT = join(ROOT, '.release')

/** 可预期的失败（用法/前置条件不满足）——不打堆栈，只给一句人话。 */
class ReleaseFail extends Error {}

const run = (cmd, cmdArgs) => execFileSync(cmd, cmdArgs, { cwd: ROOT, encoding: 'utf8', shell: process.platform === 'win32' })
const fail = (msg) => { throw new ReleaseFail(msg) }

async function main() {
  /** ① 产物必须与源码一致：挂一份过期构建上去 = 让用户装到旧界面（本仓踩过这个坑）。 */
  const fresh = run('node', ['scripts/build-client.mjs', '--check'])
  if (!/OK/.test(fresh)) fail('client 产物与源码不一致：先 `pnpm build` 再重跑')
  console.log('[release-asset] ① 产物新鲜度 ✅', fresh.trim().split('\n').pop())

  /** ② tag 必须在远端（见文件头"坑 1"）。 */
  let localTag = ''
  try {
    localTag = run('git', ['rev-parse', '--short', TAG]).trim()
  } catch {
    fail(`本地没有 tag ${TAG}：先 \`git tag -a ${TAG} -m "..."\` 并 push`)
  }
  if (run('git', ['ls-remote', '--tags', 'origin', TAG]).trim() === '') fail(`远端没有 tag ${TAG}：先 \`git push origin ${TAG}\``)
  const dirty = run('git', ['status', '--porcelain']).trim()
  if (dirty !== '') {
    console.warn('[release-asset] ⚠️ 工作区不干净，资产将包含未提交内容：\n  ' + dirty.split('\n').slice(0, 5).join('\n  '))
  }
  console.log(`[release-asset] ② tag ${TAG} → ${localTag}（远端已存在）`)

  /** ③ 打包（tarball 内容由 package.json 的 `files` 决定：cordis.patch.yml + lib/）。 */
  rmSync(OUT, { recursive: true, force: true })
  mkdirSync(OUT, { recursive: true })
  run('npm', ['pack', '--pack-destination', OUT])
  const tgz = join(OUT, ASSET)
  let buf
  try {
    buf = readFileSync(tgz)
  } catch {
    fail(`打包异常：没看到 ${OUT} 下的 ${ASSET}`)
  }
  const size = statSync(tgz).size
  const sha = createHash('sha256').update(buf).digest('hex')
  console.log(`[release-asset] ③ ${ASSET} · ${(size / 1024 / 1024).toFixed(2)} MB · sha256 ${sha.slice(0, 16)}…`)

  const URL = `https://github.com/${REPO}/releases/download/${TAG}/${ASSET}`
  const ONE_LINER = `dsh plugin --profile web add ${URL}`
  if (DRY_RUN) {
    console.log('[release-asset] --dry-run：不碰远端。将写入 Release 正文并给出的一键命令：')
    console.log('  ' + ONE_LINER)
    return
  }

  /** ④ 上传（凭证：环境变量优先，其次 gh CLI 的登录态）。 */
  const token = process.env.GITHUB_TOKEN ?? process.env.GH_TOKEN ?? (() => {
    try {
      return execFileSync('gh', ['auth', 'token'], { encoding: 'utf8', shell: process.platform === 'win32' }).trim()
    } catch {
      return ''
    }
  })()
  if (token === '') fail('没有可用的 GitHub 凭证：设 GITHUB_TOKEN（或 GH_TOKEN）为有 repo 权限的 PAT，或先 `gh auth login`')

  const api = (path, init = {}) => fetch(path.startsWith('http') ? path : `https://api.github.com${path}`, {
    ...init,
    headers: {
      Authorization: `token ${token}`,
      Accept: 'application/vnd.github+json',
      'User-Agent': 'dsh-release-asset',
      ...(init.headers ?? {}),
    },
  })
  const body = [
    `发布产物 \`${PKG.name}@${VERSION}\` —— **一条命令安装（零配置、零凭证）**：`,
    '',
    '```bash',
    ONE_LINER,
    '```',
    '',
    '- tarball 里已含构建产物（`lib/`），安装时不跑构建脚本；装完重启 `dsh web` + 硬刷新浏览器即出现「A股工作台」视图标签。',
    `- 校验：\`sha256 = ${sha}\`（${size} 字节）。`,
    `- 变更明细见仓库 \`CHANGELOG.md\` 的 \`[${VERSION}]\` 一节。`,
  ].join('\n')

  let rel = await (await api(`/repos/${REPO}/releases/tags/${TAG}`)).json()
  if (rel.id === undefined) {
    rel = await (await api(`/repos/${REPO}/releases`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tag_name: TAG, name: `${PKG.name} ${VERSION}`, body, draft: false, prerelease: false }),
    })).json()
    if (rel.id === undefined) fail('建 Release 失败：' + JSON.stringify(rel).slice(0, 300))
    console.log('[release-asset] ④ Release 已创建：' + rel.html_url)
  } else {
    console.log('[release-asset] ④ Release 已存在：' + rel.html_url)
  }

  const existing = (rel.assets ?? []).find((a) => a.name === ASSET)
  if (existing !== undefined) {
    if (!FORCE) {
      fail(`${TAG} 已经有资产 ${ASSET}（${existing.size} 字节）。已发布的资产就是用户装的那一份，默认不覆盖：\n` +
        `   · 新版本 → 升 \`package.json\` 版本，重新走定版流程（不要用同名覆盖旧版本）\n` +
        `   · 确认要重发同一版本 → 加 \`--force\``)
    }
    await api(`/repos/${REPO}/releases/assets/${existing.id}`, { method: 'DELETE' })
    console.log('[release-asset] 旧资产已删除（--force）：' + ASSET)
  }

  const up = await api(`https://uploads.github.com/repos/${REPO}/releases/${rel.id}/assets?name=${encodeURIComponent(ASSET)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/octet-stream' },
    body: buf,
  })
  const asset = await up.json()
  if (asset.browser_download_url === undefined) fail('上传资产失败：' + JSON.stringify(asset).slice(0, 300))
  console.log(`[release-asset] ⑤ 资产已上传：${asset.browser_download_url}（${asset.size} 字节）`)
  console.log('\n一键安装命令（可直接贴给用户）：\n  ' + ONE_LINER)
}

try {
  await main()
} catch (err) {
  if (err instanceof ReleaseFail) console.error(`[release-asset] ❌ ${err.message}`)
  else console.error('[release-asset] ❌ 未预期的错误：', err)
  process.exitCode = 1
}
