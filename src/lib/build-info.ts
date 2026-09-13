/**
 * src/lib/build-info.ts — 构建可见性（browser 半）。
 *
 * 本模块解决「构建产物 ≠ 运行实例」：浏览器加载的是**上次刷新时**的 bundle，
 * 改完源码只 build 不重启/不刷新时，界面会静默跑旧代码（实测踩过）。
 *
 * 做法：构建期两条链注入同一个 `__PANEL_BUILD_ID__`（src 内容哈希，确定性）；
 * host 半经 `GET /api/stock-panel/build` 返回后端侧的 id；本模块把两者对比：
 *   - 一致      → 运行态与构建态同步；
 *   - 不一致    → 服务端已重建，当前页面是旧的 → 提示硬刷新（AppShell 底部）。
 */
import { useSwr } from './cache'
import { BUILD_INFO_ROUTE } from './endpoints'

/** 本 bundle 的版本号（构建期注入 = package.json version）。 */
export const CLIENT_VERSION = __PANEL_VERSION__
/** 本 bundle 的构建 id（构建期注入 = src 内容哈希前 8 位）。 */
export const CLIENT_BUILD_ID = __PANEL_BUILD_ID__

/** host 半报告的构建信息。 */
export interface BuildInfo {
  version: string
  buildId: string
}

/** 拉取 host 侧的构建信息（无缓存开关：no-store，避免拿到旧的）。 */
export async function fetchBuildInfo(): Promise<BuildInfo> {
  const res = await fetch(BUILD_INFO_ROUTE, { headers: { Accept: 'application/json' }, cache: 'no-store' })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  const data = (await res.json()) as Partial<BuildInfo>
  return { version: String(data.version ?? '?'), buildId: String(data.buildId ?? '?') }
}

/** 订阅 host 构建信息（60s 轮询；面板挂载时才有请求）。 */
export function useBuildInfo() {
  return useSwr('swr:buildinfo', fetchBuildInfo, { ttl: 30_000, refreshInterval: 60_000 })
}

/** 当前页面是否跑着旧构建（服务端 id 与本 bundle id 不一致）。 */
export function isStaleBuild(info: BuildInfo | null | undefined): boolean {
  if (info === null || info === undefined) return false
  return info.buildId !== CLIENT_BUILD_ID && info.buildId !== '?'
}

/**
 * 硬刷新：带**变化的 build 参数**重新加载，绕过 HTTP 缓存。
 *
 * 为什么不能只调 `location.reload()`（v1.4 及以前就是这么写的，实测无效）：
 * client.js 的 URL 固定不变，`reload()` 会命中磁盘缓存 → 页面继续跑旧 bundle。
 * 实测（2026-09-12）：点「构建已更新 · 点此刷新」后页内 build 仍是旧的
 * （`ef950715`），服务端已是 `3873ab9c`；同一次操作后还出现过半渲染态
 * （见 `panel/hooks.ts` 的 `useChromeHealth`）。
 *
 * 这里只**追加查询参数**、不动路径与既有参数（宿主的鉴权/路由不受影响）：
 * 参数取服务端 build id —— 它变化 ⇒ 新 URL ⇒ 必然缓存未命中。
 */
export function hardReload(serverBuildId?: string | null): void {
  if (typeof window === 'undefined') return
  const tag = serverBuildId !== undefined && serverBuildId !== null && serverBuildId !== '' ? serverBuildId : CLIENT_BUILD_ID
  try {
    const url = new URL(window.location.href)
    url.searchParams.set('dshPanelBuild', tag)
    window.location.replace(url.toString())
  } catch {
    window.location.reload()
  }
}

