/**
 * tests/hotkeys.test.ts —— 键盘判别式的单元测试（审计 UX-PLAN I4 + V6）。
 *
 * 为什么值得测：审计里的快捷键盘缺陷**全是"静默"的** ——
 *   · 左栏收起时按 j/k 照样换标的并强制切工作台（`.dc-rail[hidden]` 只是显示隐藏、组件仍挂载），
 *     零视觉反馈，在复盘页误按会把正在填的次日清单草稿顶掉；
 *   · Esc 一次关三样（搜索面板 + 诊断面板 + 当时的工具抽屉），只想收面板却把正在用的页面关了；
 *   · ⌘K 面板开着时反而关不掉（焦点在面板 input 里被 editable 守卫早退）；
 *   · 搜索失败被 `catch → setHits([])` 吞成"无匹配"（这条在 AppShell 侧，纯函数测不到）。
 * 这些都不会抛异常、不会报错，只会"按下去没反应"或"按下去动了别的东西"——
 * 只能靠把**规则本身**写成可执行契约来防回归。
 *
 * 注：`lib/hotkeys.ts` 只 import 了 `./selection`（模块级读 localStorage 的代码在 try/catch 里），
 * 因此本文件在无浏览器环境下可直接跑（与 `tests/selection.test.ts` 同一手法）。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  dispatchWatchMove,
  needsPreventDefault,
  resolveHotkey,
  subscribeWatchMove,
  type HotkeyAction,
  type HotkeyContext,
} from '../src/lib/hotkeys.ts'
import { PRIMARY_VIEWS } from '../src/lib/selection.ts'

/**
 * 构造上下文：只写关心的字段，其余取"日常态"（不在输入框、焦点不在左栏、无弹层、左栏可见）。
 * 默认 `leftRail: true` 是因为 j/k 的**唯一作用域判据**就是它 —— 默认可见才能让
 * "左栏收起 → 无效"那条测试真的在测那条规则，而不是在测默认值。
 */
function ctx(over: Partial<HotkeyContext>): HotkeyContext {
  return {
    key: '',
    meta: false,
    ctrl: false,
    alt: false,
    editable: false,
    inRail: false,
    paletteOpen: false,
    diagOpen: false,
    leftRail: true,
    view: 'war',
    ...over,
  }
}

const eq = (actual: HotkeyAction | null, expected: HotkeyAction | null, why: string) =>
  assert.deepEqual(actual, expected, why)

// ─────────────────────────── ⌘K：开关与"输入框内也能关" ───────────────────────────

test('★ ⌘K 面板已打开时，⌘K 必须能关掉它 —— 即使焦点就在面板输入框里', () => {
  // 真实运行时就是这个上下文：面板打开 → SearchPalette 立刻 focus 自己的 input
  // → isEditableTarget(e.target) === true。原实现被 hooks 里的 editable 守卫早退，
  // 于是"打开了就关不掉"（审计原文点名的缺陷）。
  const runtime: Partial<HotkeyContext> = { paletteOpen: true, editable: true, key: 'k', meta: true }
  eq(resolveHotkey(ctx(runtime)), { type: 'closePalette' }, '输入框内 ⌘K 应关闭面板')
  eq(resolveHotkey(ctx({ ...runtime, meta: false, ctrl: true })), { type: 'closePalette' }, 'Ctrl+K 等价')
  eq(resolveHotkey(ctx({ ...runtime, key: 'K' })), { type: 'closePalette' }, '大写 K 也认（Shift+⌘K）')
})

test('⌘K 打开面板：不在输入框里才开（不抢宿主会话输入框）', () => {
  eq(resolveHotkey(ctx({ key: 'k', meta: true })), { type: 'openPalette' }, '普通位置 ⌘K 打开')
  eq(resolveHotkey(ctx({ key: 'k', ctrl: true })), { type: 'openPalette' }, 'Windows/Linux Ctrl+K 打开')
  eq(resolveHotkey(ctx({ key: 'k', meta: true, editable: true })), null, '输入框内 ⌘K 不抢按键（只允许"关"）')
})

test('/ 也开面板，但同样让位给输入框', () => {
  eq(resolveHotkey(ctx({ key: '/' })), { type: 'openPalette' }, '/ 打开面板')
  eq(resolveHotkey(ctx({ key: '/', editable: true })), null, '输入框内 / 是打字')
})

test('Alt 组合一律不管（macOS 上 ⌥ 是输入特殊字符用的）', () => {
  eq(resolveHotkey(ctx({ key: 'k', alt: true })), null, 'Alt+K 不触发')
  eq(resolveHotkey(ctx({ key: 'a', alt: true })), null, 'Alt+A 不触发')
  // ⌥⌘ 同时按：保持原实现的优先级（先看 ⌘/Ctrl），行为不变
  eq(resolveHotkey(ctx({ key: 'k', meta: true, alt: true })), { type: 'openPalette' }, '原优先级不变')
})

// ─────────────────────────────── Esc：只关最上层 ───────────────────────────────

test('★ Esc 只关最上层一页：层级 palette > 诊断面板（A6 起没有第三层了）', () => {
  const all = { key: 'Escape', paletteOpen: true, diagOpen: true, editable: true }
  eq(resolveHotkey(ctx(all)), { type: 'closeTop', layer: 'palette' }, '两样都开 → 只关面板')

  // 面板关掉之后的真实现场：焦点仍在面板 input 里（editable）→ 下一次 Esc 关诊断面板
  eq(
    resolveHotkey(ctx({ ...all, paletteOpen: false })),
    { type: 'closeTop', layer: 'diag' },
    '面板已关 → 关诊断面板',
  )
  eq(
    resolveHotkey(ctx({ ...all, paletteOpen: false, diagOpen: false })),
    null,
    '没有弹层了 → 不管（主区页面不是"可关的层"：关掉它等于关掉当前页面）',
  )
})

test('Esc：没有任何弹层时返回 null（不吞输入框里的 Esc）', () => {
  eq(resolveHotkey(ctx({ key: 'Escape' })), null, '无弹层 → 不管')
  eq(resolveHotkey(ctx({ key: 'Escape', editable: true })), null, '输入框里的 Esc 让给宿主（如取消输入）')
  // 诊断面板是模态：焦点在它内部（例如点过它的按钮）时 Esc 依然要能关
  eq(resolveHotkey(ctx({ key: 'Escape', diagOpen: true, editable: true })), { type: 'closeTop', layer: 'diag' })
})

// ─────────────────────── j/k：作用域（左栏收起时必须无效）───────────────────────

test('★ 左栏收起时 j/k 无效（修掉"收起后按 j/k 仍换标的 + 强制切工作台"）', () => {
  eq(resolveHotkey(ctx({ key: 'j', leftRail: false })), null, '收起时 j 不动光标')
  eq(resolveHotkey(ctx({ key: 'k', leftRail: false })), null, '收起时 k 不动光标')
  eq(resolveHotkey(ctx({ key: 'ArrowDown', leftRail: false, inRail: true })), null, '收起时 ↓ 也不动')
  eq(resolveHotkey(ctx({ key: 'ArrowUp', leftRail: false, inRail: true })), null, '收起时 ↑ 也不动')
})

test('左栏可见时 j/k 移动光标（保留既有全局语义）', () => {
  eq(resolveHotkey(ctx({ key: 'j' })), { type: 'watchMove', delta: 1 }, 'j = +1')
  eq(resolveHotkey(ctx({ key: 'k' })), { type: 'watchMove', delta: -1 }, 'k = -1')
})

test('↑/↓ 只在焦点已经在左栏内时才移动光标（不抢主区滚动）', () => {
  eq(resolveHotkey(ctx({ key: 'ArrowDown', inRail: true })), { type: 'watchMove', delta: 1 }, '左栏内 ↓ = +1')
  eq(resolveHotkey(ctx({ key: 'ArrowUp', inRail: true })), { type: 'watchMove', delta: -1 }, '左栏内 ↑ = -1')
  eq(resolveHotkey(ctx({ key: 'ArrowDown', inRail: false })), null, '焦点不在左栏 → 交给页面滚动')
  eq(resolveHotkey(ctx({ key: 'ArrowUp', inRail: false })), null, '焦点不在左栏 → 交给页面滚动')
})

test('打字优先：输入框内的 j/k 是文本，不是光标移动', () => {
  eq(resolveHotkey(ctx({ key: 'j', editable: true })), null, '复盘草稿里打 j 不该换标的')
  eq(resolveHotkey(ctx({ key: 'k', editable: true })), null, '同上')
  eq(resolveHotkey(ctx({ key: 'ArrowDown', editable: true, inRail: true })), null, '输入框里 ↓ 让给输入法/宿主')
})

test('面板开着时其余快捷键一律让路（j/k 也不会穿透到背后的列表）', () => {
  eq(resolveHotkey(ctx({ key: 'j', paletteOpen: true })), null, '面板内的 j 是搜索词')
  eq(resolveHotkey(ctx({ key: 'ArrowDown', paletteOpen: true, inRail: true })), null, '面板内的 ↓ 归结果列表自己')
  eq(resolveHotkey(ctx({ key: 'q', paletteOpen: true })), null, '面板内的字母都是搜索词')
  eq(resolveHotkey(ctx({ key: '1', paletteOpen: true })), null, '面板内的 1 是搜索词')
})

// ───────────────────────── 1-7 / a / [ ]：既有语义不变 ─────────────────────────

test('1-7 按 PRIMARY_VIEWS 的顺序切一级入口（顺序即约定）', () => {
  assert.deepEqual(
    PRIMARY_VIEWS.map((v) => v.id),
    ['review', 'war', 'market', 'concept', 'scout', 'alerts', 'global'],
    'PRIMARY_VIEWS 顺序变了就等于偷偷改了 1-7 的键位',
  )
  eq(resolveHotkey(ctx({ key: '1' })), { type: 'setView', view: 'review' }, '1 = 复盘')
  eq(resolveHotkey(ctx({ key: '2' })), { type: 'setView', view: 'war' }, '2 = 作战')
  eq(resolveHotkey(ctx({ key: '3' })), { type: 'setView', view: 'market' }, '3 = 行情')
  eq(resolveHotkey(ctx({ key: '7' })), { type: 'setView', view: 'global' }, '7 = 外盘')
  // 工作台（原来的「看盘」）**不在导航栏上**，所以没有键位 —— 它靠点左栏任一行进入
  assert.ok(
    !PRIMARY_VIEWS.some((v) => v.id === 'watch'),
    '工作台不得回到 PRIMARY_VIEWS：否则 1-7 的键位与状态带都会多出一项',
  )
  // view 是契约字段：传当前视图不得影响解析结果
  eq(resolveHotkey(ctx({ key: '3', view: 'market' })), { type: 'setView', view: 'market' }, '与当前视图无关')
})

test('越界/非数字按键不切页', () => {
  eq(resolveHotkey(ctx({ key: '0' })), null, '0 无意义')
  eq(resolveHotkey(ctx({ key: '8' })), null, '第 8 个入口不存在')
  eq(resolveHotkey(ctx({ key: '9' })), null, '越界数字')
  eq(resolveHotkey(ctx({ key: 'x' })), null, '普通字母')
  eq(resolveHotkey(ctx({ key: 'Enter' })), null, 'Enter 不管（归组件自己）')
  eq(resolveHotkey(ctx({ key: ' ' })), null, '空格不管（归组件自己）')
  // 非 ASCII 数字不算（`Number('١') === 1` 会凭空多出一批没写在提示里的键位）
  eq(resolveHotkey(ctx({ key: '١' })), null, '阿拉伯-印度数字不认')
})

test('a / [ / ] 语义保持；t 已随工具抽屉一起下线', () => {
  eq(resolveHotkey(ctx({ key: 'a' })), { type: 'askAi' }, 'a = 一键问模型')
  eq(resolveHotkey(ctx({ key: '[' })), { type: 'toggleLeftRail' }, '[ = 左栏')
  eq(resolveHotkey(ctx({ key: ']' })), { type: 'toggleRightRail' }, '] = 右栏')
  // A6：没有"工具抽屉"这一层了，所以 t 不再是快捷键（普通字母一律放行给页面/宿主）
  eq(resolveHotkey(ctx({ key: 't' })), null, 't 不再切页（工作台靠点左栏进）')
  // 输入框里这些键都得让位（否则在草稿里打 "a" 会去调模型）
  for (const key of ['t', 'a', '[', ']']) {
    eq(resolveHotkey(ctx({ key, editable: true })), null, `输入框内的 ${key} 是打字`)
  }
})

// ───────────────────────── preventDefault：不能被顺手删掉 ─────────────────────────

test('需要拦默认行为的动作有明确清单（少了会同时开两样搜索 / 页面乱滚）', () => {
  assert.equal(needsPreventDefault({ type: 'openPalette' }), true, '⌘K 不拦会同时开宿主搜索')
  assert.equal(needsPreventDefault({ type: 'closePalette' }), true, '同理')
  assert.equal(needsPreventDefault({ type: 'askAi' }), true, 'a 的默认行为要拦')
  assert.equal(needsPreventDefault({ type: 'watchMove', delta: 1 }), true, '↑↓ 不拦会滚动页面')
  assert.equal(needsPreventDefault({ type: 'closeTop', layer: 'palette' }), false, 'Esc 无默认行为')
  assert.equal(needsPreventDefault({ type: 'setView', view: 'war' }), false)
  assert.equal(needsPreventDefault({ type: 'toggleLeftRail' }), false)
  assert.equal(needsPreventDefault({ type: 'toggleRightRail' }), false)
})

// ───────────────────────── 跨组件广播：无 window 也不能炸 ─────────────────────────

test('左栏移动的广播在无 DOM 环境（本测试进程 / SSR）下安全空转', () => {
  // 这两个函数只被 AppShell/WatchList 在浏览器里用；在 Node 里 import 与调用都不该抛，
  // 否则测试与任何 SSR 预渲染路径都会直接挂掉。
  assert.doesNotThrow(() => dispatchWatchMove(1), '无 window 时派发是空操作')
  const off = subscribeWatchMove(() => {})
  assert.equal(typeof off, 'function', '订阅永远返回退订函数（可直接当 useEffect 清理）')
  assert.doesNotThrow(() => off(), '退订可安全调用')
})
