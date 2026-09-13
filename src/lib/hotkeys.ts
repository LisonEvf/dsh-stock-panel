/**
 * src/lib/hotkeys.ts — 键盘动作的**纯函数判别式**（审计 UX-PLAN I4 / V6）。
 *
 * ## 为什么要有这个文件
 *
 * 审计原文（`AppShell.tsx:175-217`）指出的问题不是"快捷键写错了"，而是
 * **快捷键逻辑长在组件里、只能靠人手点**：
 *   - `j/k` 是全局绑定且**不判作用域**（`WatchList.tsx:114-131`）—— 左栏收起时
 *     （`.dc-rail[hidden]` 只是 display 隐藏，组件仍挂载）按 j/k 照样换标的并强制切到看盘，
 *     **零视觉反馈**；在复盘页误按会把手填的次日清单草稿顶掉；
 *   - `Esc` **一次关三样**（`AppShell.tsx:184-189` 无条件全关 palette + 诊断面板 + 工具抽屉），
 *     用户想关搜索面板，结果连正在用的工具页一起关了；
 *   - ⌘K 面板已开时**无法用 ⌘K 再关**（焦点在面板 input 里，被 `isEditableTarget` 守卫早退）；
 *   - 分支顺序、`editable` 让位、"面板开着时其余键让路"这些规则**散在 if 链里**，
 *     改一处就悄悄改掉另一处（正是"静默失效"的温床）。
 *
 * 所以这里把「按键 + 纯数据上下文 → 动作」抽成一个**无副作用、无 DOM、无 React 的纯函数**，
 * 由 `tests/hotkeys.test.ts` 逐条钉死契约；`AppShell` 只剩"解析 → 分发"。
 *
 * ## 动作表（先匹配先返回，顺序即优先级）
 *
 * | # | 条件                                                       | 动作                                    |
 * |---|------------------------------------------------------------|-----------------------------------------|
 * | 1 | `⌘/Ctrl + K` 且**面板已开**                                | `closePalette`（**输入框内也成立**）    |
 * | 1 | `⌘/Ctrl + K` 且面板未开、焦点不在可编辑控件                 | `openPalette`                           |
 * | 1 | `⌘/Ctrl + K` 且面板未开、焦点在可编辑控件                   | `null`（不抢宿主会话输入框）            |
 * | 2 | 带 `Alt`                                                   | `null`（macOS 上 ⌥ 是输入特殊字符）     |
 * | 3 | `Escape`                                                   | `closeTop`：只关**最上层**一页         |
 * | 4 | 面板（palette）开着、其余任意键                             | `null`（面板内的 ↑↓/Enter 归输入框管）  |
 * | 5 | 焦点在可编辑控件                                            | `null`（打字优先）                      |
 * | 6 | `/`                                                        | `openPalette`                           |
 * | 7 | `1`–`9`                                                    | `setView`（`PRIMARY_VIEWS[n-1]`）       |
 * | 8 | `j` / `↓`（`↓` 仅当焦点在左栏内）                           | `watchMove +1`（**左栏收起时 `null`**） |
 * | 9 | `k` / `↑`（`↑` 仅当焦点在左栏内）                           | `watchMove -1`（**左栏收起时 `null`**） |
 * | 10| `a`                                                        | `askAi`                                 |
 * | 11| `[` / `]`                                                  | `toggleLeftRail` / `toggleRightRail`    |
 * | 12| 其它                                                       | `null`                                  |
 *
 * 三条"为什么这样排"的说明：
 *
 * 1. **⌘K 的 editable 是不对称的**（表 1 行）："关"必须在输入框内也能用 —— 面板打开时焦点
 *    就在面板的 input 里，否则用户**永远关不掉**（审计原文点名）；但"开"仍然让位给输入框，
 *    因为宿主会话输入框也是 input，从输入框里开我们的面板等于抢按键。
 * 2. **`Escape` 只关最上层**（表 3 行）：层级 = palette > 诊断面板（两层都是
 *    `role="dialog"` + `aria-modal` 的模态）。A6 之前还有第三层"工具抽屉"——
 *    抽屉拆平之后主区就是一级入口本身，**不再是可关的层**（关掉它等于"关掉当前页面"，
 *    没有意义），所以那一层连同 `t` 键一起下线。
 * 3. **`↑/↓` 比 `j/k` 多一个 `inRail` 条件**（表 8/9 行）：`j/k` 是既有的全局肌肉记忆
 *    （页脚提示"j/k 移动"），保留；但 ↑↓ 是**页面滚动**的通用键，一旦全局就会把主区的
 *    滚动抢走（用户读复盘正文按 ↓，结果标的被换掉 + 被强制切到工作台）。所以 ↑↓ 只在
 *    焦点已经落在左栏内时生效 —— 而 `j/k` 移动后**会把真实焦点搬到新行上**，
 *    于是"用 j/k 走一遍，再用 ↑↓ 微调"依然连续可用。
 */
import { PRIMARY_VIEWS, type PrimaryView } from './selection'

/** 左栏「移动光标」的跨组件广播事件名（AppShell 解析出动作 → WatchList 执行）。 */
export const WATCH_MOVE_EVENT = 'dc:watch-move'

/**
 * 判别式输入：**全是纯数据**（没有 DOM 事件、没有 React 状态），
 * 这样测试可以逐条构造，不需要浏览器。
 */
export interface HotkeyContext {
  /** `KeyboardEvent.key`（原样传入，大小写敏感交给本函数处理）。 */
  key: string
  /** `event.metaKey`（macOS ⌘）。 */
  meta?: boolean
  /** `event.ctrlKey`（Windows/Linux Ctrl）。 */
  ctrl?: boolean
  /** `event.altKey`。 */
  alt?: boolean
  /** 事件目标是否是可编辑控件（调用方用 `isEditableTarget(e.target)` 判定后传入）。 */
  editable?: boolean
  /** 焦点是否**在左栏内**（只有 ↑↓ 读它，避免抢主区滚动）。 */
  inRail?: boolean
  /** ⌘K 搜索面板是否已打开。 */
  paletteOpen?: boolean
  /** 子系统诊断面板是否已打开。 */
  diagOpen?: boolean
  /** 左栏是否可见（`ui.leftRail`）。**j/k 的唯一作用域判据**。 */
  leftRail?: boolean
  /** 当前一级视图。动作表目前不消费它，但保留在契约里：调用方必须显式传当前视图，
   *  将来加"同视图不再切/按视图改键位"这类规则时不必再改签名与全部测试。 */
  view?: PrimaryView
}

/** 判别式输出：AppShell 只对这张表做分发，不再自己写 if 链。 */
export type HotkeyAction =
  | { type: 'openPalette' }
  | { type: 'closePalette' }
  /** `Esc`：**只关最上层**一页（层级 palette > diag）。 */
  | { type: 'closeTop'; layer: 'palette' | 'diag' }
  /** 左栏列表移动光标（±1）。 */
  | { type: 'watchMove'; delta: 1 | -1 }
  | { type: 'setView'; view: PrimaryView }
  | { type: 'askAi' }
  | { type: 'toggleLeftRail' }
  | { type: 'toggleRightRail' }

/** Esc 的层序：越靠前越"上层"（先关它）。 */
const TOP_LAYERS = ['palette', 'diag'] as const

/**
 * 按键 + 上下文 → 动作（纯函数，无副作用）。
 *
 * 契约见文件头的动作表；`null` = 这一键不归快捷键管（不拦默认行为）。
 */
export function resolveHotkey(ctx: HotkeyContext): HotkeyAction | null {
  const paletteOpen = ctx.paletteOpen === true
  const diagOpen = ctx.diagOpen === true
  const editable = ctx.editable === true
  const leftRail = ctx.leftRail === true
  const inRail = ctx.inRail === true

  // ── 1. ⌘/Ctrl + K：面板开关（唯一"在输入框内也生效"的键，见文件头说明 1）────────
  if ((ctx.meta === true || ctx.ctrl === true) && ctx.key.toLowerCase() === 'k') {
    if (paletteOpen) return { type: 'closePalette' }
    return editable ? null : { type: 'openPalette' }
  }

  // 其余修饰键组合一律不管（⌥ 在 macOS 上是输入特殊字符用的）。
  if (ctx.alt === true) return null

  // ── 2. Esc：只关最上层（见文件头说明 2）──────────────────────────────────────
  if (ctx.key === 'Escape') {
    for (const layer of TOP_LAYERS) {
      if (layer === 'palette' && paletteOpen) return { type: 'closeTop', layer }
      if (layer === 'diag' && diagOpen) return { type: 'closeTop', layer }
    }
    return null
  }

  // ── 4. 面板开着时，其余快捷键一律让路（面板内的 ↑↓/Enter 由输入框自己处理）──────
  if (paletteOpen) return null

  // ── 5. 打字优先：焦点在输入框里时不抢任何字母/数字键 ──────────────────────────
  if (editable) return null

  // ── 6. / ：快速打开面板（与 ⌘K 同义，只是不需要修饰键）───────────────────────
  if (ctx.key === '/') return { type: 'openPalette' }

  // ── 7. 1-9：一级入口（越界/非 ASCII 数字一律不认）──────────────────────────
  // 顺序即 PRIMARY_VIEWS 的顺序，与页脚提示"1-7 入口"一致。
  // 刻意用 `/^[1-9]$/` 而不是 `Number(key)`：后者会把全角/阿拉伯-印度数字也算成数字
  // （`Number('١') === 1`），凭空多出一批"没写在提示里的键位"。
  if (/^[1-9]$/.test(ctx.key)) {
    const target = PRIMARY_VIEWS[Number(ctx.key) - 1]
    if (target !== undefined) return { type: 'setView', view: target.id }
  }

  // ── 8/9. 左栏移动：j/k 全局；↑↓ 只在左栏内（见文件头说明 3）──────────────────
  const isDown = ctx.key === 'j' || (ctx.key === 'ArrowDown' && inRail)
  const isUp = ctx.key === 'k' || (ctx.key === 'ArrowUp' && inRail)
  if (isDown || isUp) {
    // ★ 左栏收起时返回 null：修掉"收起时按 j/k 仍换标的并强制切到看盘"（审计 I4 首条）。
    if (!leftRail) return null
    return { type: 'watchMove', delta: isDown ? 1 : -1 }
  }

  // ── 10-12. 问模型 / 左右栏 ─────────────────────────────────────────────────
  // （A6 之前这里还有 `t` = 开/关工具抽屉：抽屉拆平后主区就是一级入口本身，`t` 随之下线。）
  if (ctx.key === 'a') return { type: 'askAi' }
  if (ctx.key === '[') return { type: 'toggleLeftRail' }
  if (ctx.key === ']') return { type: 'toggleRightRail' }
  return null
}

/**
 * 该动作是否需要 `preventDefault()`。
 *
 * 为什么独立成一个函数：这三类键**浏览器/宿主自己有默认行为**，不拦会出事故 ——
 *   - `⌘K`/`/`：宿主与浏览器各自有搜索/快速查找（不拦会同时开两样）；
 *   - `a`：某些宿主里是"全选/输入法"相关动作；
 *   - `j/k`/`↑↓`：↑↓ 不拦会滚动页面（移动光标的同时页面乱跑）。
 * 放在纯模块里，测试可以一起钉住，避免以后有人"顺手"删掉 preventDefault。
 */
export function needsPreventDefault(action: HotkeyAction): boolean {
  switch (action.type) {
    case 'openPalette':
    case 'closePalette':
    case 'askAi':
    case 'watchMove':
      return true
    default:
      return false
  }
}

/**
 * 广播"左栏光标移动"。
 *
 * 为什么用事件而不是把 `move` 递出去：`resolveHotkey` 判 `j/k` 需要知道左栏是否可见，
 * 这个状态在 AppShell（`ui.leftRail`）；而"光标落在第几行 + 真实焦点 + 滚动"是
 * WatchList 的内部状态（依赖它自己那份 rows）。两边都不该知道对方的细节，
 * 于是中间只过一条**带 delta 的窄消息**。
 */
export function dispatchWatchMove(delta: number): void {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new CustomEvent<number>(WATCH_MOVE_EVENT, { detail: delta }))
}

/** 订阅"左栏光标移动"（返回退订函数，可直接作为 `useEffect` 的清理）。 */
export function subscribeWatchMove(fn: (delta: number) => void): () => void {
  if (typeof window === 'undefined') return () => {}
  const onMove = (e: Event) => {
    const detail = (e as CustomEvent<number>).detail
    if (typeof detail === 'number' && detail !== 0) fn(detail)
  }
  window.addEventListener(WATCH_MOVE_EVENT, onMove)
  return () => window.removeEventListener(WATCH_MOVE_EVENT, onMove)
}
