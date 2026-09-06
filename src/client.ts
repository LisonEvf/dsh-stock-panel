/**
 * dsh.client bundle entry（A股量化工作台 — patch-layout 版）。
 *
 * 导出两个符号：
 *   - 默认导出（index）：供 host 扫描 `exports["./client"]` 时拿到的插件体
 *     （Cordis `apply` + 契约类型）；
 *   - `./client` 行：同上，是"插件包即其包的 client 半"。
 *
 * Cordis 约定：插件体是一个函数 `(ctx) => void`，在 fiber materialize 时执行，
 * 向运行时注册 slot / 服务 / 契约。
 *
 * 与旧版（shell.overlay 浮层）的关键区别：
 *   旧版用固定 520px 浮层贴在页面右侧（z-index 顶格、不占主布局、无法与
 *   对话区并排）。本版改用 workbench 同款思路——宿主启动时把 patch-layout.mjs
 *   打进 ui-layout bundle，新增最右列（sidebar | center | details | stock），
 *   对话区用 conversationSeat 包裹后仍在 center 列。本 client 半只做一件事：
 *   把 StockPanel 挂进 `stock` 这一个新 slot。
 *
 * 注册用 `ctx.slots.register`（additive，不替换任何已有 UI）。
 */
// 这些类型由 DSH 宿主在运行时注入，构建时通过 @ts-ignore 绕过本地缺类型。
// @ts-ignore - 运行时由 dsh.client 提供
import type { SlotRegistryLike } from '@deepseek-ai/dsh-client-ui-slots'
// @ts-ignore - 运行时由 dsh.client 提供
import type { DshClientCtx } from '@deepseek-ai/dsh-client-runtime'
import { createElement, useState } from 'react'
// @ts-ignore - 构建期由 scripts/build-client.mjs 的 stock-css-compile 插件
// 把 src/index.css.txt（Tailwind + .dsh-stock 组件样式）编译为 CSS 字符串。
import panelCss from './index.css'
// 工作台面板壳（M5：市场/指数/自选/个股 四 Tab）。
import { PanelApp } from './panel/PanelApp'
// 运行时诊断句柄（浏览器控制台可直接调用）。
import { getDataSource } from './lib/api'
import { getMcp } from './lib/mcp'
import { getWatchlist } from './lib/watchlist-store'

/**
 * 把编译好的插件样式注入 <head>（仅一次）。
 * 无样式时 Tailwind 工具类与 .dsh-stock 布局规则全部失效，面板会裸奔。
 */
let stylesInjected = false
function injectPanelStyles(): void {
  if (stylesInjected) return
  stylesInjected = true
  try {
    if (typeof document === 'undefined') return
    if (document.getElementById('dsh-stock-panel-css')) return
    const style = document.createElement('style')
    style.id = 'dsh-stock-panel-css'
    style.textContent = panelCss
    document.head.appendChild(style)
  } catch (err) {
    if (typeof console !== 'undefined') {
      console.warn('[stock-panel] failed to inject styles:', err)
    }
  }
}

/** 插件契约类型（供宿主在类型层面消费，运行时无副作用）。 */
export interface StockPanelContract {
  /** stock 列（主布局最右列，details 右侧）注册的 slot 名。 */
  readonly slot: 'stock'
  /** stock.preview 子槽名（对话区右侧 split）。 */
  readonly previewSlot: 'stock.preview'
}

/** stock 列的宽度（px）——由 ui-layout 的 computeColumns 决定，这里仅文档化。 */
export const STOCK_COL_MIN = 200
export const STOCK_COL_MAX = 420

/**
 * StockPanel：主布局第四列的根组件。
 *
 * 不再用 fixed 定位浮层，而是填满 ui-layout 分配的 stock 列空间
 * （className 由 patch-layout 注入为 `pI_x6G_stockCol`）。顶部工具栏显示
 * 标题 + 收起按钮，主体异步加载 StockDetailPage（与旧版相同的懒加载策略）。
 */
export function StockPanel() {
  const [collapsed, setCollapsed] = useState(false)

  if (collapsed) {
    // 收起态：只在列内显示一个展开按钮，不占多余横向空间。
    return createElement(
      'div',
      {
        className: 'dsh-stock',
        style: { alignItems: 'center', justifyContent: 'center' },
      },
      createElement(
        'button',
        {
          onClick: () => setCollapsed(false),
          title: '展开 A股量化工作台',
          style: {
            writingMode: 'vertical-rl',
            border: 'none',
            background: 'transparent',
            cursor: 'pointer',
            fontSize: 12,
            color: 'var(--ds-muted)',
            padding: '8px 4px',
          },
        },
        '📈 工作台',
      ),
    )
  }

  return createElement(
    'div',
    { className: 'dsh-stock' },
    // 工具栏
    createElement(
      'div',
      { className: 'ds-toolbar' },
      createElement(
        'div',
        { className: 'ds-title' },
        createElement('span', null, '📈 A股量化工作台'),
      ),
      createElement(
        'button',
        {
          className: 'ds-close',
          onClick: () => setCollapsed(true),
          title: '收起',
        },
        '⟩',
      ),
    ),
    // 主体（M5 面板壳：市场/指数/自选/个股）
    createElement('div', { className: 'ds-body' }, createElement(PanelApp)),
  )
}

/**
 * 插件体。ctx 由 dsh.client 运行时注入。
 *
 * 只注册一个 additive slot：
 *   - `stock`：主布局最右列（由 patch-layout 新增，落在 details 列右侧）。
 *
 * 工作台不再放入对话区右侧的 split（stock.preview），避免与对话争宽度、
 * 压垮输入框所在区域。
 */
export function apply(ctx: DshClientCtx): void {
  const slots = ctx.slots as SlotRegistryLike

  // 注入插件样式（Tailwind 工具类 + .dsh-stock 组件规则）。
  injectPanelStyles()

  // MCP 数据源配置：前端直连远端 MCP 服务器（默认 192.168.31.196:8007/mcp），
  // 无需 FastAPI 后端。可通过全局变量覆盖：
  //   window.__DSH_MCP_ENDPOINT__  → 自定义端点
  //   window.__DSH_DATA_SOURCE__   → 'mcp' | 'http'
  if (typeof window !== 'undefined') {
    ;(window as any).__DSH_DATA_SOURCE__ = (window as any).__DSH_DATA_SOURCE__ || 'mcp'
  }

  if (typeof console !== 'undefined') {
    console.log('[stock-panel] apply called, slot: stock')
  }

  // 诊断句柄：浏览器控制台输入 window.__STOCK_PANEL__ 可查看/触发数据链路。
  if (typeof window !== 'undefined') {
    const panel = (window as any).__STOCK_PANEL__
    ;(window as any).__STOCK_PANEL__ = {
      version: '0.3.5-m5',
      dataSource: () => getDataSource(),
      listTools: () => getMcp().listTools(),
      callTool: (name: string, args: Record<string, unknown>) => getMcp().callTool(name, args),
      watchlist: () => getWatchlist(),
      ...(panel && typeof panel === 'object' ? panel : {}),
    }
  }

  // 主布局最右列。width 由 ui-layout 的 computeColumns 决定，经 props 传入。
  slots.register({
    name: 'stock',
    id: 'stock-panel',
    priority: 100,
  }, () => createElement(StockPanel))
}
