/**
 * tests/host-chrome.test.ts —— 宿主外壳适配层的单元测试。
 *
 * 为什么值得测：这一层的**声明在 TS、生效在 CSS**，中间隔着两个字符串（body 标记名、
 * 宿主钩子名）。任何一边改错，表现都是"静默无效"——拖拽条还在、输入框还在，
 * 而控制台一片安静（CSS 选择器不匹配从来不会报错）。所以这里钉两件事：
 *
 *   ① 标记语义：进/出成对、可重入（StrictMode 的挂载-清理-再挂载不会把标记摘飞）；
 *   ② **声明与 CSS 不许漂移**：`src/index.css.txt` §9 的两条规则必须由本模块导出的常量
 *      拼得出来（改标记名而忘改 CSS = 立刻红灯）。这正是"改了没生效"最容易发生的地方。
 *
 * 无浏览器环境：`host-chrome.ts` 全程 `typeof document` + 空值守卫，在 Node 里 import 不会炸
 * （与 `selection.ts` 同款约定）。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  WORKBENCH_ATTR,
  enterWorkbenchChrome,
  hostChromeInfo,
} from '../src/lib/host-chrome.ts'

const CSS = readFileSync(join(process.cwd(), 'src', 'index.css.txt'), 'utf8')

test('★ 标记名是"工作台挂载"，且必须是 data-* 属性（CSS 靠它限定作用域）', () => {
  assert.equal(WORKBENCH_ATTR, 'data-dc-workbench')
  assert.ok(WORKBENCH_ATTR.startsWith('data-'), 'data-* 属性才不会被宿主的类名规则误伤')
})

test('进入/离开成对，可重入：StrictMode 的挂载-清理-再挂载不会互相摘掉', () => {
  // 计数归零才算退出：两个实例同时挂载时，先清理的那一个不该把标记摘走。
  const a = enterWorkbenchChrome()
  const b = enterWorkbenchChrome()
  a()
  b()
  const c = enterWorkbenchChrome()
  const d = enterWorkbenchChrome()
  d()
  c()
  assert.ok(true, '以上序列都不应抛（真机行为由 hostChromeInfo 报出）')
})

test('无 DOM 环境下不抛，且诊断如实报 dom:false（不假装生效）', () => {
  const info = hostChromeInfo()
  assert.equal(info.dom, false, 'Node 里没有 DOM —— 诊断必须说"看不到 DOM"，不能编一个"已生效"')
  assert.equal(typeof info.mounted, 'boolean')
})

test('★ CSS 契约：两条规则都必须由 WORKBENCH_ATTR 拼得出（改名忘改 CSS = 静默失效）', () => {
  const rules: Array<[string, string]> = [
    // ① 藏掉宿主的「正文栏宽度」拖拽条 —— 用户报的"对话框两端那两条全高拖拽条"
    ['data-width-handle', '正文栏宽度拖拽条'],
    // ② 藏掉底部对话输入框 —— 工作台是盯盘台，输入框整块让给主区
    ['data-composer-seat', '底部对话输入框'],
  ]
  for (const [hook, what] of rules) {
    const selector = `body[${WORKBENCH_ATTR}] [${hook}]`
    assert.ok(
      CSS.includes(selector),
      `index.css.txt 必须含「${selector}」（${what}）：少了它工作台里那东西会回来`,
    )
    assert.match(
      CSS,
      new RegExp(`${escapeRe(selector)}\\s*\\{[^}]*display:\\s*none`),
      `${selector} 的规则体必须是 display:none`,
    )
    assert.ok(
      !selector.includes('.dsh-stock'),
      `${selector} 不能限定在 .dsh-stock 内（宿主元素在插件之外，这样一条都匹配不上）`,
    )
  }
})

test('CSS 契约：作用域只认标记本身，不许再挂第二个开关（曾是"对话框开关"的两态属性）', () => {
  // 用户决策：工作台里直接不要对话框，不给开关。若有人把两态属性加回来，
  // 这里会失败 —— 提醒他"默认隐藏 + 一个按钮"是上一次被否掉的方案。
  assert.ok(
    !CSS.includes('[data-dc-composer'),
    '不再需要 data-dc-composer 两态开关：工作台里输入框一律不显示',
  )
})

/** 转义成字面量正则（选择器里有 `[` `]` 等元字符）。 */
function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
