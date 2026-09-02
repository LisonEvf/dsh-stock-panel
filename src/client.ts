/**
 * dsh.client bundle entry.
 *
 * 导出两个符号：
 *  - 默认导出（index）：供 host 扫描 `exports["./client"]` 时拿到的插件体
 *    （Cordis `apply` + 契约类型）。
 *  - `./client` 行：同上，是"插件包即其包的 client 半"。
 *
 * Cordis 约定：插件体是一个函数 `(ctx) => void`，在 fiber materialize 时执行，
 * 向运行时注册 slot / 服务 / 契约。这里我们只注册一个 details slot，
 * 渲染"股票工作台"面板容器。
 */
// 这些类型由 DSH 宿主在运行时注入，构建时通过 @ts-ignore 绕过本地缺类型。
// @ts-ignore - 运行时由 dsh.client 提供
import type { SlotRegistryLike } from '@deepseek-ai/dsh-client-ui-slots'
// @ts-ignore - 运行时由 dsh.client 提供
import type { DshClientCtx } from '@deepseek-ai/dsh-client-runtime'

/** 插件契约类型（供宿主在类型层面消费，运行时无副作用）。 */
export interface StockPanelContract {
  /** details 面板注册的 slot 名。 */
  readonly slot: 'stock-panel.detail'
}

/**
 * 插件体。ctx 由 dsh.client 运行时注入（runtime + ui-slots + ui-details）。
 * 注册一个 details slot，其渲染函数返回股票工作台面板容器。
 */
export function apply(ctx: DshClientCtx): void {
  const slots = ctx.slots as SlotRegistryLike
  slots.register('stock-panel.detail', {
    title: '股票工作台',
    priority: 500,
    render: () => import('./pages/StockDetailPage').then(m => m.StockDetailPage),
  })
}
