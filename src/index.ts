/**
 * @lisonevf/dsh-stock-panel — host 半入口（Cordis fiber）。
 *
 * 由 `dsh.bundle.patch`（cordis.patch.yml）在宿主启动时加载，把本插件注册成
 * Cordis entry。host 半只做业务侧三件事：
 *
 *   1. 暴露插件元数据（视图槽 / 视图 id / 排序）给宿主与 browser 半；
 *   2. 注册内置 TDX 桥接路由（POST /api/stock-panel/call，进程内 node-tdx 直连）；
 *   3. 注册对话行情工具（ctx.tools，当前对话助手可直接取数分析）。
 *
 * **host 半不再触碰宿主的任何文件。** v1.1 及以前这里会同步运行 ui-layout 布局
 * 补丁引擎（self-heal 打「stock 第四列」并落 pristine 备份）；v1.2 起界面注入
 * 全部改走官方槽位（browser 半注册 `conversation.view`），补丁引擎、锚点表、
 * CLI 与 `$DSH_HOME/patches` 备份均已删除。
 *
 * 真正的 React UI 由 browser 半（src/client.ts）通过官方
 * `conversation.view` 槽在浏览器端渲染。
 */
import { getOwnPropertySafe, registerEmbeddedTdxBridge, type HostCtx } from './host-util'
import { registerStockTools } from './host-tools'
import { registerBuildInfoRoute } from './host/build-info'
import { disposeTdxClient } from './host/tdx-data'
import { aiAvailability, registerAiBridge, resolveAiRuntime, type AiRuntime } from './host-ai'

/** 本插件注册的会话视图身份（与 src/client.ts 的 VIEW_* 常量保持一致）。 */
export const VIEW_SLOT = 'conversation.view'
export const VIEW_ID = 'stock-panel'
export const VIEW_ORDER = 6

/** 插件契约（host 半暴露给 browser 半和宿主）。 */
export interface StockPanelContract {
  /** 视图宿主槽位（ui-conversation 声明）。 */
  readonly viewSlot: 'conversation.view'
  /** 视图 id（被 ui-conversation 持久化为会话首选视图）。 */
  readonly viewId: 'stock-panel'
  /** 视图标签页排序键。 */
  readonly viewOrder: number
}

/**
 * Cordis entry 元数据（loader 按此装配 fiber）：
 *   - name：entry 名（patch insert 引用的包名）
 *   - inject：声明需要的运行时服务 → ctx.webServer / ctx.tools 才会被注入
 *     （注册 /api/stock-panel/call 内置 TDX 桥接路由与对话工具的前提；缺了它
 *     getOwnPropertySafe 永远拿到 undefined，桥接静默不注册）。
 */
export const name = '@lisonevf/dsh-stock-panel'
export const inject = ['webServer', 'tools']

/** host 半插件体。ctx 由 Cordis host 运行时注入。 */
export function apply(ctx: HostCtx): (() => void) | void {
  // 暴露插件元数据给宿主和 browser 半。
  ctx.provide('stock-panel-host', {
    name: '@lisonevf/dsh-stock-panel',
    viewSlot: VIEW_SLOT,
    viewId: VIEW_ID,
    viewOrder: VIEW_ORDER,
  })

  // 内置 TDX 桥接：host 半在服务端进程内用 node-tdx 直连 TDX（无远端 MCP、
  // 无外部进程）。browser 半通过同源 route 调用：
  // 路由：POST /api/stock-panel/call  body: {"tool": name, "args": {...}}
  // 注意：ctx.webServer 是 Cordis 服务，未注入时访问会抛异常，用 getOwnPropertySafe 安全访问。
  const ws = getOwnPropertySafe(ctx, 'webServer')
  if (ws) {
    registerEmbeddedTdxBridge(ws as NonNullable<HostCtx['webServer']>)
    // 构建信息（版本 + 构建 id）：浏览器据此检出「跑着旧构建」。
    registerBuildInfoRoute(ws as NonNullable<HostCtx['webServer']>)
  }

  // 对话行情工具（chat 联动，零 FastAPI）：当前对话助手可直接调用取数分析。
  // ctx.tools 经 inject 声明就绪；仍做安全兜底，失败不影响桥接。
  registerStockTools(getOwnPropertySafe(ctx, 'tools') as HostCtx['tools'] | undefined)

  // 一键问模型（AI 视角）：host 半直调官方 ctx.llm，把结构化结论回给视图。
  // llm / agentDefaultModel **刻意不列进 inject**——它们是可选增强，缺了只是按钮置灰，
  // 不该拖累 TDX 桥接与对话工具的加载（见 host-ai.ts 顶部说明）。
  const aiRuntimeOf = (): AiRuntime => resolveAiRuntime(ctx)
  if (ws) {
    registerAiBridge(ws as NonNullable<HostCtx['webServer']>, aiRuntimeOf)
    const avail = aiAvailability(aiRuntimeOf())
    if (avail.available) {
      console.log(`[stock-panel] AI 直调可用：${avail.provider}/${avail.model}`)
    } else {
      console.log(`[stock-panel] AI 直调不可用（${avail.reason}）——面板「AI 研判」按钮将置灰，不影响行情。`)
    }
  }

  // 卸载（fiber dispose / 进程退出 / 插件被移除）：释放内置 TDX 长连接。
  // 宿主文件已无任何改动需要回滚。
  return () => {
    disposeTdxClient().catch(() => undefined)
  }
}

/** 暴露给 browser 半的 host 服务实现（供后续服务端代理场景使用）。 */
export const hostService = {
  name: '@lisonevf/dsh-stock-panel',
  viewSlot: VIEW_SLOT,
  viewId: VIEW_ID,
  viewOrder: VIEW_ORDER,
}

// 内置 TDX 服务导出（脚本/冒烟/诊断复用同一实现）。
export { callEmbeddedTool, tdxEmbeddedDiagnostics, disposeTdxClient } from './host/tdx-data'

// AI 直调导出（诊断/脚本复用）。
export { runAiTask, aiAvailability, resolveAiRuntime, registerAiBridge } from './host-ai'
// 构建信息导出（诊断/脚本复用）。
export { hostBuildInfo, registerBuildInfoRoute } from './host/build-info'
// AI 契约（prompt 组装 / 容错解析 / 上下文裁剪）导出：供 scripts/smoke-ai-contract.mjs 离线回归。
export { buildAiPrompt, parseAiResult, extractJsonObject, contextBytes, shrinkContext } from './lib/ai-contract'
