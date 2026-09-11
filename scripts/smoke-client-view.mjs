// scripts/smoke-client-view.mjs —— client 半「官方视图注册」离线冒烟（无需 DSH 宿主）
//
// 用法：
//   pnpm build && node scripts/smoke-client-view.mjs
//
// 目的：把「界面注入走官方槽位」这条契约变成可回归的断言。v1.2 起本插件不再对宿主
// bundle 做任何字节级补丁，视图注册是唯一注入点，因此它在 CI 里值得有一个门禁。
//
// 做法：在 Node 里加载构建产物 lib/client.js（浏览器 bundle 只是
// `window.__ModuleLoader__.load({ id, factory })` 的 CJS 包装），桩掉 window/document/
// localStorage，再喂一个假的 ctx.slots，断言：
//   1. bundle 契约：load id / inject = ['slots'] / apply 是函数；
//   2. 只向官方 `conversation.view` 注册一个条目（name/id/order/label 全对）；
//   3. 不再向已废弃的自造槽 `stock` 注册任何内容（回归护栏）；
//   4. 诊断句柄 window.__STOCK_PANEL__.viewRegistered === true；
//   5. 契约缺失（ctx 无 slots / slots 无 inject）时**不抛异常**（GUI boot 不受影响）。
//
// 注：不渲染 React 组件、不发任何网络请求——只验证注册契约与降级行为。

import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const CLIENT = join(ROOT, 'lib', 'client.js')
/** 版本号唯一来源：package.json（bundle 里的 __PANEL_VERSION__ 由构建期注入）。 */
const pkgVersion = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')).version

let failures = 0

/** 断言：记录失败但不中断（跑完全部用例后统一退出码）。 */
function assert(cond, msg) {
  if (cond) {
    console.log(`  ✅ ${msg}`)
  } else {
    failures += 1
    console.error(`  ❌ ${msg}`)
  }
}

/** 桩掉浏览器全局（bundle 内部对这些访问都带 typeof/ try 守卫，但仍需存在）。 */
function stubBrowserGlobals() {
  const store = new Map()
  globalThis.window = { __ModuleLoader__: { load: (o) => { registered = o } } }
  globalThis.document = {
    getElementById: () => null,
    querySelector: () => null,
    createElement: () => ({ setAttribute() {}, style: {}, textContent: '', appendChild() {} }),
    head: { appendChild() {} },
  }
  globalThis.localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
  }
  globalThis.fetch = async () => {
    throw new Error('smoke-client-view: 不发网络请求')
  }
}

let registered = null

function main() {
  if (!existsSync(CLIENT)) {
    console.error(`[smoke-client-view] 缺 ${CLIENT} —— 先跑 pnpm build`)
    process.exit(1)
  }

  stubBrowserGlobals()

  // bundle 是 CJS 包装：加载即调用 window.__ModuleLoader__.load({ id, factory })。
  const require = createRequire(join(ROOT, 'noop.cjs'))
  require(CLIENT)
  if (registered === null) {
    console.error('[smoke-client-view] __ModuleLoader__.load 未被调用（bundle 形状变了？）')
    process.exit(1)
  }
  const mod = registered.factory(require)

  console.log('[1] bundle 契约')
  assert(registered.id === '@lisonevf/dsh-stock-panel', `load id = ${registered.id}`)
  assert(
    Array.isArray(mod.inject) && mod.inject.length === 1 && mod.inject[0] === 'slots',
    `inject = ${JSON.stringify(mod.inject)}（只需 'slots'：注册是声明感知的，无需保序声明）`,
  )
  assert(typeof mod.apply === 'function', 'apply 是函数')

  console.log('[2] 注册行为（只走官方槽位）')
  const seen = { injects: [], registers: [] }
  const ctx = {
    slots: {
      inject(name, cb) {
        seen.injects.push(name)
        return cb()
      },
      register(opts, comp) {
        seen.registers.push({ opts, comp })
        return () => {}
      },
    },
  }
  mod.apply(ctx)

  assert(
    seen.injects.length === 1 && seen.injects[0] === 'conversation.view',
    `slots.inject 目标 = ${JSON.stringify(seen.injects)}`,
  )
  assert(seen.registers.length === 1, `注册条目数 = ${seen.registers.length}`)
  const { opts, comp } = seen.registers[0] ?? { opts: {}, comp: null }
  assert(opts.name === 'conversation.view', `条目 name = ${opts.name}`)
  assert(opts.id === 'stock-panel', `条目 id = ${opts.id}（会被宿主持久化为会话首选视图）`)
  assert(opts.order === 6, `条目 order = ${opts.order}（「对话」=0 与「轨迹」=10 之间）`)
  assert(
    typeof opts.label === 'function' && opts.label() === 'A股工作台',
    `条目 label = ${typeof opts.label === 'function' ? opts.label() : '(非函数)'}`,
  )
  assert(typeof comp === 'function', '条目的组件是函数')
  assert(
    !seen.registers.some((r) => r.opts.name === 'stock'),
    '未向已废弃的自造槽 `stock` 注册（回归护栏）',
  )

  console.log('[3] 运行时诊断句柄')
  const diag = globalThis.window.__STOCK_PANEL__
  assert(diag?.viewRegistered === true, `__STOCK_PANEL__.viewRegistered = ${diag?.viewRegistered}`)
  assert(
    diag?.view === 'conversation.view' && diag?.viewId === 'stock-panel',
    `__STOCK_PANEL__ view/viewId = ${diag?.view}/${diag?.viewId}`,
  )
  assert(!diag?.viewError, `viewError 为空（实际：${diag?.viewError}）`)
  assert(
    typeof diag?.version === 'string' && /^\d+\.\d+\.\d+/.test(diag.version),
    `version 是语义化版本串 = ${diag?.version}`,
  )
  assert(
    diag?.version === pkgVersion,
    `version 与 package.json 一致（bundle=${diag?.version} pkg=${pkgVersion}）`,
  )
  assert(
    typeof diag?.buildId === 'string' && /^[0-9a-f]{8}$/.test(diag.buildId),
    `buildId 是 8 位构建哈希 = ${diag?.buildId}（构建可见性 / 旧 bundle 检出依赖它）`,
  )
  assert(diag?.ai === '/api/stock-panel/ai', `AI 路由已暴露 = ${diag?.ai}`)

  console.log('[4] 契约缺失时优雅降级（不得抛异常）')
  for (const [label, badCtx] of [['ctx.slots 无 inject', { slots: {} }], ['ctx 为空', {}]]) {
    let threw = false
    try {
      mod.apply(badCtx)
    } catch {
      threw = true
    }
    assert(!threw, `${label} → 不抛异常（GUI boot 不受影响）`)
  }

  if (failures > 0) {
    console.error(`[smoke-client-view] ${failures} 项断言失败`)
    process.exit(1)
  }
  console.log('[smoke-client-view] 全部通过 ✅')
}

main()
