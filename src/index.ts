/**
 * @lisonevf/dsh-stock-panel — host 半入口（Cordis fiber）。
 *
 * 由 `dsh.bundle.patch`（cordis.patch.yml）在宿主启动时加载，把本插件注册成
 * Cordis entry。host 半做三件事：
 *
 *   1. 暴露插件元数据（slot / order）给宿主与 browser 半；
 *   2. **同步**检测 ui-layout 布局补丁是否缺失，缺失就内嵌重打
 *      （src/layout-patch.ts 引擎随 lib/ 发布，无外置脚本依赖）——
 *      保证 `dsh plugin --profile web add` 后下次启动零操作自动出现 stock 列；
 *   3. 注册 MCP 桥接路由（POST /api/stock-panel/mcp）。
 *
 * 真正的 React UI 由 browser 半（src/client.ts）通过补丁新增的
 * `stock` / `stock.preview` 槽在浏览器端渲染。
 *
 * 关于布局补丁：当前项目原本用 `shell.overlay` 浮层实现右侧面板（固定宽度、
 * 不占主布局、无法与对话区并排）。本版本对编译后的 ui-layout bundle 做精确、
 * 幂等的字符串替换，新增第四列（sidebar | stock | center | details）并把对话区
 * 改造成「左对话 + 右 stock 预览」的 split 布局。DSH 升级会覆盖 bundle、让补丁
 * 失效，于是插件启动时同步自动重打（锚点失配时中止不写、只告警，绝不破坏
 * bundle）；插件卸载时若 pristine 备份存在则还原 bundle。
 */
import { applyLayoutPatch, ensureLayoutPatchAtBoot, layoutPatchState, revertLayoutPatch, revertLayoutPatchIfNeeded } from './layout-patch'
import { getOwnPropertySafe, registerMcpBridge, type HostCtx } from './host-util'
import { registerStockTools } from './host-tools'

/** 插件契约（host 半暴露给 browser 半和宿主）。 */
export interface StockPanelContract {
  /** stock 列（主布局第四列）注册的 slot 名。 */
  readonly slot: 'stock'
  /** stock.preview 子槽名（对话区右侧 split）。 */
  readonly previewSlot: 'stock.preview'
  /** 插件在主布局中的排序。 */
  readonly order: number
}

/**
 * Cordis entry 元数据（与 kb 插件同款契约，loader 按此装配 fiber）：
 *   - name：entry 名（patch insert 引用的包名）
 *   - inject：声明需要的运行时服务 → ctx.webServer 才会被注入
 *     （注册 /api/stock-panel/mcp 桥接路由的前提；缺了它 getOwnPropertySafe
 *     永远拿到 undefined，桥接静默不注册）。
 */
export const name = '@lisonevf/dsh-stock-panel'
export const inject = ['webServer', 'tools']

/** host 半插件体。ctx 由 Cordis host 运行时注入。 */
export function apply(ctx: HostCtx): (() => void) | void {
  // 启动自愈：同步打 ui-layout stock 列补丁（幂等、绝不抛异常、锚点失配中止不写）。
  // 放在 apply 内同步执行，确保任何后续 fiber（含 client-modules 组合浏览器图、
  // 静态服务首响应）读到的都是补丁后的字节——不需要再等一次刷新。
  ensureLayoutPatchAtBoot()

  // 暴露插件元数据给宿主和 browser 半。
  ctx.provide('stock-panel-host', {
    name: '@lisonevf/dsh-stock-panel',
    slot: 'stock',
    previewSlot: 'stock.preview',
    order: 100,
  })

  // MCP 桥接：host 半在服务端直连远端 MCP 服务器（192.168.31.196:8007/mcp），
  // 避免浏览器跨域（CORS）问题。browser 半通过同源 route 调用。
  // 路由：POST /api/stock-panel/mcp  body: JSON-RPC 2.0 MCP 请求
  // 响应：SSE 流（event: message / data: {...}）
  // 注意：ctx.webServer 是 Cordis 服务，未注入时访问会抛异常，用 getOwnPropertySafe 安全访问。
  const ws = getOwnPropertySafe(ctx, 'webServer')
  if (ws) {
    registerMcpBridge(ws as NonNullable<HostCtx['webServer']>)
  }

  // 对话行情工具（chat 联动，零 FastAPI）：当前对话助手可直接调用取数分析。
  // ctx.tools 经 inject 声明就绪；仍做安全兜底，失败不影响布局/桥接。
  registerStockTools(getOwnPropertySafe(ctx, 'tools') as HostCtx['tools'] | undefined)

  // 卸载（fiber dispose / 进程退出 / 插件被移除）时还原 ui-layout，
  // 避免共享 junction 上的 bundle 残留空 stock 列。已有 pristine 备份且
  // bundle 处于已打补丁状态才会写回；下次启动（插件仍在）会自动重打。
  return () => {
    revertLayoutPatchIfNeeded()
  }
}

// 布局补丁引擎转发导出：scripts/patch-layout.mjs CLI 与诊断直接复用同一份实现。
export { applyLayoutPatch, ensureLayoutPatchAtBoot, layoutPatchState, revertLayoutPatch, revertLayoutPatchIfNeeded }
export { SUPPORTED_UI_LAYOUT_VERSION, PATCHED_MARKERS } from './layout-patch'

/** 暴露给 browser 半的 host 服务实现（供后续服务端代理场景使用）。 */
export const hostService = {
  name: '@lisonevf/dsh-stock-panel',
  slot: 'stock',
  previewSlot: 'stock.preview',
  order: 100,
}
