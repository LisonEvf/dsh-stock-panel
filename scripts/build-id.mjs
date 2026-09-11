// scripts/build-id.mjs —— 构建标识（版本号 + 内容哈希）的单一来源。
//
// 为什么需要它：插件是「构建产物 + 浏览器加载」两段式，改完代码只 build 不刷新时，
// 浏览器里跑的仍是旧 bundle，而界面没有任何提示（实测踩过：仓库已是 v1.4 流程导航，
// 浏览器还跑着 v1.3 的四入口）。所以让**两条构建链注入同一个 id**：
//   - host 半（tsdown）与 client 半（esbuild）都 define __PANEL_VERSION__ / __PANEL_BUILD_ID__；
//   - host 半经 GET /api/stock-panel/build 暴露 backend 侧的 id；
//   - 浏览器把自己的 id 与服务端的对比 → 不一致就提示「有新构建，硬刷新」。
//
// id 刻意是**确定性**的（src 全量内容 + package.json 的 sha256 前 8 位）：
//   · 源码没变 → 重新构建 id 不变 → `build-client --check` 仍能逐字节比对；
//   · 源码变了 → id 变 → 运行态与构建态不一致可被检出。
import { createHash } from 'node:crypto'
import { readFileSync, readdirSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'

const ROOT = resolve(import.meta.dirname, '..')

/** 参与哈希的目录（相对仓库根）。 */
const HASH_DIRS = ['src']
/** 额外的单文件（版本号在这里，改版本号也算新构建）。 */
const HASH_FILES = ['package.json']
/** 跳过的目录名 —— **仅在仓库根目录这一层生效**。（若按目录名全局匹配，
 *  `src/lib/` 会被 'lib' 误伤，导致 `src/lib/**` 的改动不影响构建 id —— 实测踩过。） */
const SKIP_DIRS = new Set(['node_modules', 'lib', 'dist', '.git'])

/** 递归收集文件绝对路径。 */
function walk(dir, out) {
  let entries
  try {
    entries = readdirSync(dir, { withFileTypes: true })
  } catch {
    return out
  }
  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (dir === ROOT && SKIP_DIRS.has(entry.name)) continue
      walk(join(dir, entry.name), out)
    } else if (entry.isFile()) {
      out.push(join(dir, entry.name))
    }
  }
  return out
}

/**
 * 计算构建标识。
 * @returns {string} 8 位十六进制（src 全量内容 + package.json 的 sha256 前缀）
 */
export function computeBuildId() {
  const files = []
  for (const dir of HASH_DIRS) walk(join(ROOT, dir), files)
  for (const f of HASH_FILES) files.push(join(ROOT, f))
  const rel = files
    .map((f) => relative(ROOT, f).replace(/\\/g, '/'))
    .sort()
  const hash = createHash('sha256')
  for (const r of rel) {
    hash.update(r)
    hash.update('\0')
    hash.update(readFileSync(join(ROOT, r)))
    hash.update('\0')
  }
  return hash.digest('hex').slice(0, 8)
}

/** 插件版本号（唯一来源：package.json）。 */
export function pluginVersion() {
  const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'))
  return String(pkg.version ?? '0.0.0')
}

/** CLI：`node scripts/build-id.mjs` 打印当前 id（诊断/文档用）。 */
if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, '/').split('/').pop() ?? '')) {
  console.log(`version=${pluginVersion()} buildId=${computeBuildId()}`)
}
