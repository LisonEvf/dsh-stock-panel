/**
 * src/lib/host-chrome.ts — 宿主「会话列外壳」适配层（工作台视图专用）。
 *
 * ## 它解决的是哪一个具体毛病
 *
 * 工作台视图里，**底部对话框（宿主 composer）两端各有一条贯穿全屏高度的拖拽条**：
 * 鼠标扫过去光标变 `col-resize`，按住一拖，面板两边的东西开始缩——点按钮、点列表行
 * 常常被它吃掉。实测定位（DSH `dsh-client-ui-conversation` 的 ConversationRoot）：
 *
 *   `.wSkVaW_widthHandle{ position:absolute; top:0; bottom:0; z-index:8; cursor:col-resize;
 *                         width:min(40px, calc((100% - var(--dsh-chat-content-width))/2 - 48px)) }`
 *   `[data-side=left]  { right: calc(50% + var(--dsh-chat-content-width)/2 + 24px) }`
 *   `[data-side=right] { left:  calc(50% + var(--dsh-chat-content-width)/2 + 24px) }`
 *
 * 它的本意是"拖**正文栏**宽度"（对称改 `--dsh-chat-user-width`），位置在**居中正文列两侧的留白**里
 * —— 在「对话」页里正好落在正文外的空白上，合理。但工作台是**满宽**面板：那两条 40px 的带子
 * 就压在面板的左右边缘，而且 `top:0;bottom:0` 一路压到底，正好是**底部对话框两端**。
 * 更糟的是宿主渲染它时**不看当前选中的是哪个视图**（只判 `phase === 'active'`），
 * 所以切到「A股工作台」它也照样在。
 *
 * ## 处置（用户决策）：工作台里**这两样都不要**
 *
 *   ① 那两条拖拽条 —— 工作台里没有正文栏，它拖的是「对话」页的正文宽度（落盘键
 *      `dsh.conversation.contentWidth`），在这里纯属挡路；
 *   ② 底部对话输入框 —— 工作台是**盯盘台**，占着最下面一整条只为"顺便能打字"不划算。
 *      要打字就切上方「对话」标签（那里输入框原样俱在）；插件自己发出的 prompt 走
 *      `inputActions.setDraft + submit`，**不依赖输入框可见**（见 `PanelApp` 的对话通道）。
 *
 * 做法：**只读观察宿主 + 在自己的样式里命中**，宿主文件一个字节都不改
 * （v1.2 起本插件的纪律：只走官方槽位，不做发行物补丁）。两个事实撑起这个做法：
 *
 *   1. **挂载 ⟺ 选中**：ui-renderer 渲染 `conversation.view` 时按 `only: active.id` 过滤条目
 *      （`list.filter(item => item.id === opts.only)`），所以本面板只在「A股工作台」标签
 *      被选中时挂载 —— body 上的标记天然就是"当前视图是不是工作台"，「对话」页完全不受影响。
 *   2. **宿主自己有先例**：它在"composer 悬浮"场景就是直接 `display:none` 掉那两条拖拽条
 *      （`.wSkVaW_root:has([data-conversation-composer-overlay]) .wSkVaW_widthHandle`）——
 *      同一个处置，不是我们发明的例外。
 *   3. **改名只退化、不炸**：CSS 依赖宿主两个钩子（`[data-width-handle]`、`[data-composer-seat]`）。
 *      DSH 哪天改名，结果是"什么都没隐藏"（回到今天的样子），不会有异常；
 *      `hostChromeInfo()` 会把实况报出来，一眼看得出是钩子失效了。
 */

/** `<body>` 标记：工作台视图挂载中（CSS 用它把宿主外壳的改写限定在本视图内）。 */
export const WORKBENCH_ATTR = 'data-dc-workbench'

/** 取 `<body>`（无 DOM 环境返回 null —— 单测在 Node 里跑）。 */
function body(): HTMLElement | null {
  if (typeof document === 'undefined') return null
  return document.body ?? null
}

/**
 * 视图挂载计数。
 *
 * 用计数而不是布尔：React 18 的 StrictMode 会把 effect 走一遍「挂载 → 清理 → 再挂载」，
 * 布尔量在那次清理里会把标记摘掉、再挂回去（这中间 CSS 会闪一下）。计数保证
 * 「归零才摘」，且与"两个实例同时活着"这种意外也相容。
 */
let mounted = 0

/**
 * 进入工作台视图：给 `<body>` 打标记（`host-chrome.ts` 文件头解释了为什么用标记而不是
 * 直接写宿主元素）。返回值是清理函数，直接交给 `useLayoutEffect`（挂载时同步打、卸载时摘）。
 */
export function enterWorkbenchChrome(): () => void {
  mounted += 1
  const el = body()
  if (el !== null) el.setAttribute(WORKBENCH_ATTR, '')
  return () => {
    mounted = Math.max(0, mounted - 1)
    if (mounted > 0) return
    const node = body()
    if (node !== null) node.removeAttribute(WORKBENCH_ATTR)
  }
}

/**
 * 外壳适配的**实况**（诊断用，不轮询；`window.__STOCK_PANEL__.chrome()`）。
 *
 * 只读宿主 DOM，用于回答"到底生效了没有"这类问题：标记有没有打上、宿主那两条宽度拖拽条
 * 还剩几条（`hidden` = 被我们藏掉的条数）、底部对话框元素在不在、还占多高。
 * 这些量在截图上都看不出来（`display:none` 与"本来就没有"长得一样），只能靠数字区分。
 */
export function hostChromeInfo(): Record<string, unknown> {
  const el = body()
  if (el === null) return { mounted: mounted > 0, dom: false }
  const handles = Array.from(document.querySelectorAll<HTMLElement>('[data-width-handle]'))
  const seat = document.querySelector<HTMLElement>('[data-composer-seat]')
  return {
    mounted: mounted > 0,
    /** 视图挂载标记（CSS 的作用域开关）。 */
    workbenchAttr: el.getAttribute(WORKBENCH_ATTR) !== null,
    /** 对话输入框座位的实际显示状态（工作台里应为 display:none → 高度 0）。 */
    composerSeat:
      seat === null
        ? 'missing'
        : `${window.getComputedStyle(seat).display} · ${Math.round(seat.getBoundingClientRect().height)}px`,
    /** 宿主「正文栏宽度」拖拽条：total = 还挂着几条，hidden = 其中被藏掉的。 */
    widthHandles: {
      total: handles.length,
      hidden: handles.filter((h) => window.getComputedStyle(h).display === 'none').length,
    },
  }
}
