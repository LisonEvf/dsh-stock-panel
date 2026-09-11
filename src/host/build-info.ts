/**
 * src/host/build-info.ts — 构建信息路由（host 半）。
 *
 * 解决一个实测踩过的坑：**构建产物 ≠ 运行实例**。改完源码只 `pnpm build`、
 * 没有重启/硬刷新时，浏览器里跑的还是旧 bundle，而界面毫无提示
 * （实测：仓库已是 v1.4 流程导航，浏览器仍显示 v1.3 的四入口）。
 *
 * 机制：两条构建链（tsdown / esbuild）注入**同一个** `__PANEL_BUILD_ID__`
 * （= src 内容哈希，见 `scripts/build-id.mjs`）。本路由把 host 侧的 id 暴露给浏览器，
 * 浏览器把自己的 id 与之对比：
 *   - 一致 → 正常；
 *   - 不一致 → 服务端已是新构建，当前页面是旧的 → UI 提示「硬刷新」。
 *
 * 为什么不读文件算哈希：内置 host 半打包后拿不到可靠的包路径（平台/安装方式各异），
 * 而构建期注入是确定性的、零 IO 的。
 */
import { BUILD_INFO_ROUTE } from '../lib/endpoints'

/** 与 host-util.ts 的 webServer 形状一致（避免循环依赖只留结构类型）。 */
interface WebServerLike {
  register: (route: {
    kind: 'exact' | 'prefix'
    path: string
    handler: (req: unknown, res: unknown) => void | Promise<void>
  }) => () => void
}

/** 注册 GET /api/stock-panel/build → { version, buildId }。 */
export function registerBuildInfoRoute(webServer: WebServerLike): void {
  try {
    webServer.register({
      kind: 'exact',
      path: BUILD_INFO_ROUTE,
      handler: (_req, res) => {
        const resW = res as {
          statusCode?: number
          setHeader?: (k: string, v: string) => void
          end: (b: string) => void
        }
        if (resW.setHeader) {
          resW.statusCode = 200
          resW.setHeader('Content-Type', 'application/json')
          resW.setHeader('Cache-Control', 'no-store')
        }
        resW.end(JSON.stringify({ version: __PANEL_VERSION__, buildId: __PANEL_BUILD_ID__ }))
      },
    })
    console.log(
      `[stock-panel] build info route registered at ${BUILD_INFO_ROUTE}（v${__PANEL_VERSION__} · ${__PANEL_BUILD_ID__}）`,
    )
  } catch (err) {
    console.warn('[stock-panel] build info route registration failed:', err)
  }
}

/** 当前后端构建信息（诊断/日志复用）。 */
export function hostBuildInfo(): { version: string; buildId: string } {
  return { version: __PANEL_VERSION__, buildId: __PANEL_BUILD_ID__ }
}
