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
import { invokeTool } from './lib/mcp'
import { getTransportMode, endpointDiagnostics } from './lib/endpoints'
import { getWatchlist } from './lib/watchlist-store'

/** 内置 node-tdx 覆盖的全部行情工具（与 python opentdx-mcp 15 工具契约一致）。 */
const EMBEDDED_TOOLS: Array<{ name: string; description: string }> = [
  { name: 'quote', description: '获取股票实时报价（含 OHLC/成交量/成交额/量比等）' },
  { name: 'kline', description: '获取 A 股 K 线（升序，旧→新）' },
  { name: 'tick_chart', description: '获取分时图' },
  { name: 'transaction', description: '获取逐笔成交' },
  { name: 'auction', description: '获取集合竞价数据' },
  { name: 'unusual', description: '获取市场异动数据' },
  { name: 'board_members', description: '获取板块成分股行情（含排序）' },
  { name: 'capital_flow', description: '获取个股资金流向' },
  { name: 'symbol_info', description: '获取个股简要特征' },
  { name: 'belong_board', description: '查询个股所属板块列表' },
  { name: 'market_monitor', description: '获取主力监控数据' },
  { name: 'server_info', description: '获取服务器交易日、交易时段与状态参数' },
  { name: 'goods_quotes', description: '获取扩展市场报价（期货/港股/美股）' },
  { name: 'goods_kline', description: '获取扩展市场 K 线' },
  { name: 'goods_varieties', description: '获取商品品种列表（期货/期权合约）' },
  { name: 'hist_concept_query', description: '查一只票的 HIST 自挖概念（所在共动类 + 最近共动邻居）' },
  { name: 'hist_concept_classes', description: '当天全部 HIST 自挖类概要（类id/大小/类内相关/强边密度）' },
  { name: 'hist_concept_class', description: '查看某个 HIST 自挖类的完整成员表' },
  { name: 'hist_concept_status', description: 'HIST 自挖概念引擎状态' },
]

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

  // 行情传输配置（单一配置源 src/lib/endpoints.ts，默认 embedded 进程内直连）：
  //   window.__DSH_TDX_TRANSPORT__ → 'embedded'(默认, host 半内置 node-tdx)
  //                               | 'http'(遗留外部网关)
  //   window.__DSH_TDX_GATEWAY__     → 'http' 模式的网关端点（默认 127.0.0.1:8017）
  //   window.__DSH_DATA_SOURCE__     → api.ts 后端特性开关：'mcp' | 'http'（见 lib/api.ts）
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
      version: '1.1.0-slot-guard',
      dataSource: () => getDataSource(),
      transport: () => getTransportMode(),
      endpoints: () => endpointDiagnostics(),
      listTools: () => EMBEDDED_TOOLS,
      callTool: (name: string, args: Record<string, unknown>) => invokeTool(name, args),
      watchlist: () => getWatchlist(),
      ...(panel && typeof panel === 'object' ? panel : {}),
    }
  }

  // 主布局最右列。width 由 ui-layout 的 computeColumns 决定，经 props 传入。
  //
  // 守护注册（0.1.2-rc.1 槽位校验 + 时序兜底）：
  //   1) 若 ui-layout 模块为 pristine（client-modules 快照早于 host 布局补丁的
  //      「干净首启」场景），root children 表未声明 'stock' —— 直接注册会抛
  //      `slot "stock" is not declared ...` 并拖垮整个 GUI boot；
  //   2) 即便磁盘已补丁，本 client 行在浏览器 boot 图里的 apply 顺序仍可能早于
  //      ui-layout（其 apply 才把 root children 声明进注册表）。
  // 处理：try 注册失败 → 不中断启动，按退避重试若干次（ui-layout apply 后 stock
  // 槽即被声明，重试必然成功；slot 注册表是响应式的，迟到注册也会让空列即时填充）。
  // 全部重试失败（仅 pristine 场景）才告警降级，留待下一次重启由 host 落盘补丁生效。
  const registerStock = () => {
    slots.register({
      name: 'stock',
      id: 'stock-panel',
      priority: 100,
    }, () => createElement(StockPanel))
    if (typeof window !== 'undefined') {
      ;(window as any).__STOCK_PANEL__ = {
        ...(window as any).__STOCK_PANEL__,
        slotRegistered: true,
        slotError: undefined,
      }
    }
  }
  const tryRegister = (attempt: number): void => {
    try {
      registerStock()
      if (typeof console !== 'undefined') {
        console.log(`[stock-panel] stock slot registered (attempt ${attempt + 1})`)
      }
    } catch (err) {
      const remaining = RETRY_DELAYS.length - attempt - 1
      if (remaining > 0 && typeof setTimeout !== 'undefined') {
        const delay = RETRY_DELAYS[attempt] ?? 500
        if (typeof console !== 'undefined') {
          console.warn(
            `[stock-panel] stock slot 尚未声明（attempt ${attempt + 1}，${delay}ms 后重试，剩 ${remaining} 次）。` +
              '原因：ui-layout 的 root children 声明晚于本插件 apply。',
            err,
          )
        }
        setTimeout(() => tryRegister(attempt + 1), delay)
      } else {
        // pristine ui-layout 且 host 补丁尚未随本 boot 落盘时的最终降级（不崩 GUI）。
        if (typeof console !== 'undefined') {
          console.warn(
            '[stock-panel] stock slot 未声明且重试耗尽，本 boot 跳过注册（不影响 GUI 启动）。' +
              'host 已把布局补丁落盘，下一次重启 dsh web 后 stock 列即出现。',
            err,
          )
        }
        if (typeof window !== 'undefined') {
          ;(window as any).__STOCK_PANEL__ = {
            ...(window as any).__STOCK_PANEL__,
            slotRegistered: false,
            slotError: String((err as Error)?.message ?? err),
          }
        }
      }
    }
  }
  tryRegister(0)
}

/** 注册重试退避（ms）。首个 0 立即再试一次以覆盖“仅差一个微任务”的窗口。 */
const RETRY_DELAYS = [0, 150, 500, 1500, 4000]
