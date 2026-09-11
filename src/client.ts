/**
 * dsh.client bundle entry（A股量化工作台 — 官方 slot 版）。
 *
 * 导出契约（`window.__ModuleLoader__.load`：id / inject / apply）：
 *   - `name` / `inject`：插件标识与所需运行时服务（loader 据此注入 ctx.slots）；
 *   - `apply`：Cordis 插件体 `(ctx) => void`，在 fiber materialize 时注册视图。
 *
 * ## 注入方式：只用官方槽位，不改宿主任何文件
 *
 *   - `conversation.view`（ui-conversation 声明，kind: list / scope: session）：
 *     会话页「对话 / 轨迹」旁的视图标签页，选中时占满会话列的内容区
 *     （ui-conversation 的 `viewArea`，`renderSlot("conversation.view", …, {only: active.id})`）。
 *   - `ctx.slots.inject(slot, cb)`：**声明感知**注册——等待声明出现后再注册，
 *     并随该声明的生命周期（HMR 替换 / 重新声明 / teardown）自动装卸。
 *     这是官方推荐的跨包填充方式（ui-sidebar / ui-attachment / ui-settings-* 同款）。
 *
 * ## 与 v1.1 及以前的关键区别（已移除）
 *
 *   旧版对编译后的 `dsh-client-ui-layout` bundle 做字节级字符串替换，自造 `stock`
 *   第四列（sidebar | center | details | stock）以换取「与对话并排」的布局。代价：
 *   修改的是宿主发行物——DSH 每次重编译 ui-layout 都可能锚点失配，且必须用 pristine
 *   备份回滚。v1.2 起全部界面注入改走官方 slot，布局补丁引擎、锚点表、CLI 与
 *   `$DSH_HOME/patches` 备份一并删除。
 *
 * ## 官方契约下的形态约束
 *
 *   并排布局在官方契约内不可得：ui-layout 只声明
 *   `sidebar / conversation / details / shell.overlay`，前三者均被 single 占位。
 *   因此本版是**视图标签页**形态：切到「A股工作台」即占满会话区，切回「对话」
 *   继续聊天；标签切换会卸载/重挂本面板，故面板自身的 Tab/标的选择经
 *   localStorage 持久化（见 panel/PanelApp.tsx），避免回来时丢失标的。
 */
// @ts-ignore - 构建期由 scripts/build-client.mjs 的 css-as-string 插件
// 把 src/index.css.txt（Tailwind + .dsh-stock 组件样式）编译为 CSS 字符串。
import panelCss from './index.css'
// 工作台面板壳（市场/梯队/选股/指数/外盘/自选/个股/作战/复盘/监控 十 Tab）。
import { PanelApp } from './panel/PanelApp'
// 运行时诊断句柄（浏览器控制台可直接调用）。
import { getDataSource } from './lib/api'
import { invokeTool } from './lib/mcp'
import { getTransportMode, endpointDiagnostics, AI_CALL_ROUTE } from './lib/endpoints'
import { getWatchlist } from './lib/watchlist-store'
import { hostStateInfo, initHostState } from './lib/host-state'
import { createElement } from 'react'

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
 * 本插件注册的视图身份（写进文档与 host 半元数据，避免散落字面量）。
 * 注意：`VIEW_ID` 会被 ui-conversation 持久化为「当前会话首选的视图」，
 * 改名等同于让用户的选择回退到默认「对话」。
 */
export const VIEW_SLOT = 'conversation.view'
export const VIEW_ID = 'stock-panel'
export const VIEW_LABEL = 'A股工作台'
/** 标签页顺序：升序；「对话」= 0、「轨迹」= 10，故 6 落在两者之间（GAL视窗 = 5 之后）。 */
export const VIEW_ORDER = 6

/**
 * 运行时由 dsh.client 注入的 client 根 ctx 的**最小本地契约**。
 *
 * 只声明本插件实际用到的两个方法，不 import 任何 DSH 内部包类型
 * （`@deepseek-ai/dsh-client-ui-slots` 不在 npm 上，无法作为类型依赖解析）。
 */
interface SlotEntryOptions {
  /** 目标槽位名（必须与注册时传入的槽名一致）。 */
  name: string
  /** 槽内条目标识（list 槽内唯一；conversation.view 用它作为视图 id）。 */
  id: string
  /** list 槽内的升序排序键。 */
  order?: number
  /** 标签文本解析器（ui-conversation 用在视图 Tab 上）。 */
  label?: () => string
}

interface SlotRegistryLike {
  /** 向已声明的槽位注册一个条目，返回幂等卸载函数。 */
  register(options: SlotEntryOptions, component: (props?: unknown) => unknown): () => void
  /** 等待槽位声明后执行填充；返回随声明生命周期自动调用的清理函数。 */
  inject(name: string, callback: () => (() => void) | void): () => void
}

interface DshClientCtx {
  slots: SlotRegistryLike
}

/** dsh.client 包契约：声明本插件需要的运行时服务（loader 据此注入 ctx.slots 等）。 */
export const inject = ['slots']

/** 插件契约类型（供宿主在类型层面消费，运行时无副作用）。 */
export interface StockPanelContract {
  /** 视图宿主槽位（ui-conversation 声明）。 */
  readonly viewSlot: 'conversation.view'
  /** 视图 id（被 ui-conversation 持久化为会话首选视图）。 */
  readonly viewId: 'stock-panel'
  /** 视图标签页排序键。 */
  readonly viewOrder: number
}

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

/**
 * 工作台视图根组件（`conversation.view` 条目）。
 *
 * 外层 `.dsh-stock` 是样式作用域与尺寸容器（撑满 ui-conversation 分配的
 * `viewArea`），内部是 PanelApp → AppShell（三段式骨架）。
 *
 * 槽位 props 原样透传给 PanelApp：里面只用两个标准面——
 *   - `inputActions`（setDraft/submit）→ 右栏「深入对话」一键注入当前对话；
 *   - `useInput` → 检测输入框是否已有草稿（避免覆盖用户正在写的内容）。
 * 其余 props（useSession / openView / …）当前不用，透传不消费。
 */
export function StockPanel(props: unknown) {
  return createElement(
    'div',
    { className: 'dsh-stock' },
    createElement(PanelApp, props as Record<string, unknown>),
  )
}

/**
 * 插件体。ctx 由 dsh.client 运行时注入。
 *
 * 只做两件事：注入样式 + 借 `slots.inject` 向 `conversation.view` 注册视图条目。
 * 不注册任何其他槽、不触碰宿主文件、不假设 boot 顺序（声明感知注册天然免疫时序问题）。
 */
export function apply(ctx: DshClientCtx): void {
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

  // 诊断句柄：浏览器控制台输入 window.__STOCK_PANEL__ 可查看/触发数据链路。
  if (typeof window !== 'undefined') {
    const panel = (window as any).__STOCK_PANEL__
    ;(window as any).__STOCK_PANEL__ = {
      version: __PANEL_VERSION__,
      buildId: __PANEL_BUILD_ID__,
      view: VIEW_SLOT,
      viewId: VIEW_ID,
      ai: AI_CALL_ROUTE,
      dataSource: () => getDataSource(),
      transport: () => getTransportMode(),
      endpoints: () => endpointDiagnostics(),
      listTools: () => EMBEDDED_TOOLS,
      callTool: (name: string, args: Record<string, unknown>) => invokeTool(name, args),
      watchlist: () => getWatchlist(),
      /** host 侧持久化状态（availability/reason/counts）——排查「数据到底存哪了」。 */
      hostState: () => hostStateInfo(),
      /** 手动重跑一次 host 持久化接入（诊断用）。 */
      reinitHostState: () => initHostState(),
      ...(panel && typeof panel === 'object' ? panel : {}),
    }
  }

  // A1：接入 host 侧持久化（异步，不阻塞视图注册）。
  // 域是权威、localStorage 是镜像：拉取成功会用权威数据覆盖镜像并通知各 store 重载；
  // 宿主机没挂存储子系统 / 路由不可达时降级为纯 localStorage（不抛、不提示错误弹窗）。
  void initHostState()

  const slots = ctx?.slots
  if (!slots || typeof slots.inject !== 'function') {
    // 契约缺失（宿主过旧 / inject 声明未生效）：只告警，绝不让 GUI boot 崩掉。
    if (typeof console !== 'undefined') {
      console.warn('[stock-panel] ctx.slots.inject 不可用，跳过视图注册（GUI 不受影响）。')
    }
    setViewDiag(false, 'ctx.slots.inject unavailable')
    return
  }

  if (typeof console !== 'undefined') {
    console.log(`[stock-panel] apply called, injecting ${VIEW_SLOT} → ${VIEW_ID}`)
  }

  // 声明感知注册：ui-conversation 会自行声明 conversation.view（其 apply 可能晚于
  // 本插件），slots.inject 在声明出现时回调；声明消失/重声明时自动重跑或卸载。
  slots.inject(VIEW_SLOT, () => {
    let dispose: (() => void) | null = null
    try {
      dispose = slots.register(
        {
          name: VIEW_SLOT,
          id: VIEW_ID,
          order: VIEW_ORDER,
          label: () => VIEW_LABEL,
        },
        StockPanel,
      )
      setViewDiag(true, undefined)
      if (typeof console !== 'undefined') {
        console.log(`[stock-panel] 视图「${VIEW_LABEL}」已注册（${VIEW_SLOT}#${VIEW_ID}）。`)
      }
    } catch (err) {
      // 注册失败不中断启动：留待声明恢复后 inject 再次回调。
      setViewDiag(false, String((err as Error)?.message ?? err))
      if (typeof console !== 'undefined') {
        console.warn('[stock-panel] 视图注册失败（不影响 GUI 启动，将在声明恢复后重试）：', err)
      }
      return
    }
    return () => {
      if (dispose !== null) dispose()
      setViewDiag(false, undefined)
    }
  })
}

/** 写运行时诊断字段（供 window.__STOCK_PANEL__ 排查）。 */
function setViewDiag(registered: boolean, error: string | undefined): void {
  if (typeof window === 'undefined') return
  const panel = (window as any).__STOCK_PANEL__
  ;(window as any).__STOCK_PANEL__ = {
    ...(panel && typeof panel === 'object' ? panel : {}),
    viewRegistered: registered,
    viewError: error,
  }
}
