// acceptance/e2e-gui.mjs —— 客户端半端到端验收：独立 Chrome（headless + CDP）+ 本机会话 cookie。
//
// 为什么不复用 browsermcp：该扩展在本机对新 tab 报 "No tab with given id"（click/press_key 都拿不到），
// 且没有 Runtime.evaluate —— 拿不到 window.__STOCK_PANEL__ 这类自检句柄。
// 本脚本自起一个隔离 Chrome（独立 user-data-dir + CDP + 自签本机 cookie），不影响用户正在用的浏览器。
//
// 用法：node acceptance/e2e-gui.mjs [appUrl] [outDir]
import { spawn } from 'node:child_process'
import { mkdtempSync, writeFileSync, rmSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHash, createHmac } from 'node:crypto'

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
const PORT = 9333
const APP = process.argv[2] ?? 'http://127.0.0.1:3080'
const OUT = process.argv[3] ?? 'acceptance'

// dsh web 要求带会话 cookie（未授权时首页只回 "dsh web authentication required"）。
// 本机 ~/.dsh/.credentials.yaml 存着 cookie 签名密钥，这里按官方算法自签一张，仅用于**本机**验收
//（cookie 的 audience 就是 127.0.0.1:3080，与官方 requestAuthority 一致）。
function localAuthCookie(authority) {
  const yaml = readFileSync(join(process.env.USERPROFILE ?? '', '.dsh', '.credentials.yaml'), 'utf8')
  const secret = Buffer.from(yaml.match(/secret:\s*([A-Za-z0-9_-]+)/)[1].replaceAll('-', '+').replaceAll('_', '/'), 'base64')
  const b64u = (buf) => Buffer.from(buf).toString('base64').replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/u, '')
  const name = 'dsh-auth-' + b64u(createHash('sha256').update(authority).digest())
  const now = Date.now()
  const body = b64u(Buffer.from(JSON.stringify({ version: 1, authority, issuedAt: now, expiresAt: now + 3600_000 }), 'utf8'))
  const value = 'v1.' + body + '.' + b64u(createHmac('sha256', secret).update(body).digest())
  return { name, value }
}

const profile = mkdtempSync(join(tmpdir(), 'dsh-e2e-'))
const chrome = spawn(CHROME, [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--disable-extensions', '--remote-debugging-port=' + PORT, '--user-data-dir=' + profile,
  '--window-size=1680,1000', 'about:blank',
], { stdio: 'ignore' })

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function cdpTarget() {
  for (let i = 0; i < 80; i++) {
    try {
      const list = await (await fetch('http://127.0.0.1:' + PORT + '/json/list')).json()
      const page = list.find((t) => t.type === 'page')
      if (page?.webSocketDebuggerUrl) return page
    } catch { /* not up yet */ }
    await sleep(500)
  }
  throw new Error('CDP 未就绪')
}
const target = await cdpTarget()
const ws = new WebSocket(target.webSocketDebuggerUrl)
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = () => rej(new Error('ws error')) })

let msgId = 0
const pending = new Map()
const consoleMsgs = []
const exceptions = []
ws.onmessage = (ev) => {
  const msg = JSON.parse(ev.data)
  if (msg.id !== undefined) {
    const p = pending.get(msg.id)
    if (p) { pending.delete(msg.id); msg.error ? p.rej(new Error(JSON.stringify(msg.error))) : p.res(msg.result) }
    return
  }
  if (msg.method === 'Runtime.consoleAPICalled') {
    consoleMsgs.push({ type: msg.params.type, text: (msg.params.args ?? []).map((a) => a.value ?? a.description ?? a.type).join(' ').slice(0, 300) })
  } else if (msg.method === 'Runtime.exceptionThrown') {
    exceptions.push(String(msg.params.exceptionDetails?.exception?.description ?? msg.params.exceptionDetails?.text ?? '').slice(0, 600))
  } else if (msg.method === 'Network.responseReceived' && /\/api\/stock-panel\//.test(msg.params.response?.url ?? '')) {
    apiCalls.push({ url: msg.params.response.url.replace(/^https?:\/\/[^/]+/, ''), status: msg.params.response.status })
  }
}
const apiCalls = []
const send = (method, params = {}) => new Promise((res, rej) => {
  const id = ++msgId
  pending.set(id, { res, rej })
  ws.send(JSON.stringify({ id, method, params }))
  setTimeout(() => { if (pending.has(id)) { pending.delete(id); rej(new Error('timeout ' + method)) } }, 120000)
})
const evaluate = async (expr) => {
  const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true })
  if (r.exceptionDetails) throw new Error('eval 异常: ' + String(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text).slice(0, 300))
  return r.result?.value
}
const waitFor = async (expr, ms = 30000, step = 700) => {
  const deadline = Date.now() + ms
  while (Date.now() < deadline) { if (await evaluate(expr)) return true; await sleep(step) }
  return false
}
const results = []
const check = (name, ok, detail = '') => { results.push({ name, ok }); console.log((ok ? '  [PASS] ' : '  [FAIL] ') + name + (detail ? ' — ' + detail : '')) }

await send('Runtime.enable'); await send('Page.enable'); await send('Network.enable')
await send('Emulation.setDeviceMetricsOverride', { width: 1680, height: 1000, deviceScaleFactor: 1, mobile: false })

console.log('[e2e] 目标 ' + APP + '（隔离 Chrome headless）')
const authority = new URL(APP).host
const cookie = localAuthCookie(authority)
await send('Network.setCookie', { name: cookie.name, value: cookie.value, domain: '127.0.0.1', path: '/' })
await send('Page.navigate', { url: APP })
check('应用已加载（document.title 非空）', await waitFor('document.title.length > 0', 20000), await evaluate('document.title'))

// 客户端半自检句柄（README 的运行时自检契约）
check('window.__STOCK_PANEL__ 自检句柄存在', await waitFor('!!window.__STOCK_PANEL__', 20000))
const handle = await evaluate(`(() => {
  const h = window.__STOCK_PANEL__
  const t = typeof h.listTools === 'function' ? (h.listTools() || []) : []
  return { viewRegistered: h.viewRegistered, version: h.version, transport: h.transport(), tools: t.length,
           names: t.map(x => x.name ?? x) }
})()`)
check('viewRegistered = true', handle?.viewRegistered === true, String(handle?.viewRegistered))
check('版本回传', typeof handle?.version === 'string' && handle.version.length > 0, String(handle?.version))
check('传输层 = embedded', handle?.transport === 'embedded', String(handle?.transport))
check('内置工具清单 = 19', handle?.tools === 19, String(handle?.tools))

// 真机链路：面板内直接 callTool
const si = await evaluate(`(async () => {
  try { const r = await window.__STOCK_PANEL__.callTool('server_info', {}); return JSON.parse(JSON.stringify(r)) } catch (e) { return { error: String(e && e.message || e) } }
})()`)
const siText = Array.isArray(si?.content) ? (si.content[0]?.text ?? '') : JSON.stringify(si ?? '')
check('面板内 callTool(server_info) 真机联通', /"today"|server_time|sessions_1/.test(siText), siText.slice(0, 120))

// 一级入口：先保证有一个会话（空态没有视图标签栏），再切到插件视图
const hasTabs = await waitFor('document.querySelectorAll("[role=tab]").length > 0', 8000)
if (!hasTabs) {
  // 空态（没打开任何会话）时视图标签栏不存在 —— 展开工作区后点一个**会话**行
  //（工作区节点带 aria-expanded，会话节点没有；这是两者唯一的区别）。
  const opened = await evaluate(`(async () => {
    const sleep = (ms) => new Promise(r => setTimeout(r, ms))
    const tree = document.querySelector('[role=tree]')
    if (!tree) return 'no-tree'
    for (const el of Array.from(tree.querySelectorAll('[role=treeitem]'))) {
      if (el.getAttribute('aria-expanded') === 'false') { el.click(); await sleep(500) }
    }
    await sleep(1200)
    const items = Array.from(tree.querySelectorAll('[role=treeitem]'))
    const convs = items.filter(el => el.getAttribute('aria-expanded') === null && (el.textContent || '').trim().length > 3)
    const pick = convs.find(el => /移除工作台|自挖模块素材不足|真实模拟用户|tickflow-stock-panel/.test(el.textContent || '')) ?? convs[0]
    if (!pick) return 'no-conversation'
    pick.click()
    return 'clicked:' + (pick.textContent || '').trim().slice(0, 26)
  })()`)
  console.log('  ℹ️ 空态无会话 → 打开侧栏会话：' + opened)
}
const hasTabs2 = await waitFor('document.querySelectorAll("[role=tab]").length > 0', 40000)
check('对话视图标签栏可见', hasTabs2)
const tabs = await evaluate('Array.from(document.querySelectorAll("[role=tab]")).map(t => t.textContent.trim())')
check('插件视图「A股工作台」已注册', Array.isArray(tabs) && tabs.includes('A股工作台'), JSON.stringify(tabs))

const clicked = await evaluate(`(() => {
  const tab = Array.from(document.querySelectorAll('[role=tab]')).find(t => t.textContent.trim() === 'A股工作台')
  if (!tab) return 'no-tab'
  tab.click(); return 'clicked'
})()`)
check('切到「A股工作台」', clicked === 'clicked', String(clicked))

const rendered = await waitFor('document.body.innerText.includes("自挖板块") && document.body.innerText.includes("选股筛选")', 45000)
const dom = await evaluate(`(() => {
  const txt = (document.body.innerText || '').replace(/\s+/g, ' ')
  return { chars: txt.length,
    nav: ['复盘','作战','行情','自挖板块','选股筛选','监控规则','外盘'].filter(n => txt.includes(n)),
    canvas: document.querySelectorAll('canvas').length,
    tables: document.querySelectorAll('table').length,
    buttons: document.querySelectorAll('button').length,
    sample: txt.slice(0, 400) }
})()`)
check('面板渲染出内容', rendered && dom.chars > 500, 'innerText ' + dom.chars + ' 字')
check('一级导航 7 项都在', dom.nav.length === 7, JSON.stringify(dom.nav))
// 注：这里不断言 canvas —— 图表是在首屏数据回来后异步挂载的，紧跟渲染断言等于赌时序。
// 图表挂载由下面"行情页首屏数据落地"之后的检查负责（那时 canvas 才应该 >0）。

// 数据链路：等首屏数据落地（行情页三块 + 图表画布）
const loaded = await waitFor('document.body.innerText.includes("加载中") === false || document.querySelectorAll("canvas").length > 0', 45000)
const dom2 = await evaluate(`(() => ({
  canvas: document.querySelectorAll('canvas').length,
  stillLoading: (document.body.innerText.match(/加载[^\\s]{0,6}/g) || []).slice(0, 6),
  tables: document.querySelectorAll('table').length,
  rows: document.querySelectorAll('[role=row], tr').length,
}))()`)
check('行情页首屏数据落地（不再"加载中"或图表已挂载）', loaded && (dom2.canvas > 0 || dom2.stillLoading.length === 0),
  'canvas=' + dom2.canvas + ' 残留加载态=' + JSON.stringify(dom2.stillLoading))
check('图表画布已挂载（canvas）', dom2.canvas > 0, 'canvas=' + dom2.canvas)
check('面板发起了数据层请求（/api/stock-panel/*）', apiCalls.length > 0, apiCalls.length + ' 次：' + JSON.stringify(apiCalls.slice(0, 6)))

// 一级入口逐个挂载（A6 平铺导航）——每个入口点开后必须真的换出内容、且不炸控制台。
// 自挖板块会真的触发批量命名（调模型），放最后并给足时间。
const ENTRIES = ['复盘', '作战', '行情', '选股筛选', '监控规则', '外盘', '自挖板块']
console.log('\n[e2e] 一级入口逐个挂载：')
for (const entry of ENTRIES) {
  const errBefore = exceptions.length + consoleMsgs.filter((m) => m.type === 'error').length
  const clickedEntry = await evaluate(`(() => {
    const el = Array.from(document.querySelectorAll('a,button,[role=tab],[role=link]'))
      .find(x => (x.textContent || '').trim() === '${entry}')
    if (!el) return 'not-found'
    el.click(); return 'ok'
  })()`)
  if (clickedEntry !== 'ok') { check('入口「' + entry + '」可达', false, clickedEntry); continue }
  await sleep(entry === '自挖板块' ? 12000 : 6000)
  if (entry === '自挖板块') {
    await waitFor('document.body.innerText.includes("模型调用") || document.body.innerText.includes("个类") || document.body.innerText.includes("无语料")', 100000)
  }
  const info = await evaluate(`(() => {
    const txt = (document.body.innerText || '').replace(/\\s+/g, ' ')
    const m = txt.match(/本次模型调用[^ ]* [^ ]* [^ ]* [^ ]*/)
    return { chars: txt.length, canvas: document.querySelectorAll('canvas').length, tables: document.querySelectorAll('table').length,
             model: m ? m[0] : null, snippet: txt.slice(txt.indexOf('复盘 2026') >= 0 ? txt.indexOf('复盘 2026') : 0, 260) }
  })()`)
  const errAfter = exceptions.length + consoleMsgs.filter((m) => m.type === 'error').length
  const marker = ['复盘', '作战', '行情', '自挖板块', '选股筛选', '监控规则', '外盘'].filter((n) => info.snippet.includes(n))
  check('入口「' + entry + '」挂载且无新增报错', errAfter === errBefore && info.chars > 400,
    'chars=' + info.chars + ' canvas=' + info.canvas + ' table=' + info.tables + ' 新增报错=' + (errAfter - errBefore) + (info.model ? ' · ' + info.model : ''))
  console.log('      片段：' + String(info.snippet).slice(0, 150))
}

console.log('[e2e] 数据层调用明细：' + JSON.stringify(apiCalls))

// 探针模式：DSH_E2E_PROBE=<JS 表达式> —— 打印结果后退出（排查用）
if (process.env.DSH_E2E_PROBE) {
  const out = await evaluate(process.env.DSH_E2E_PROBE)
  console.log('[probe] ' + JSON.stringify(out, null, 2))
  ws.close(); chrome.kill(); await sleep(300)
  try { rmSync(profile, { recursive: true, force: true }) } catch {}
  process.exit(0)
}

try {
  const shot = await send('Page.captureScreenshot', { format: 'png' })
  writeFileSync(join(OUT, 'e2e-panel.png'), Buffer.from(shot.data, 'base64'))
  console.log('  ℹ️ 截图：' + join(OUT, 'e2e-panel.png'))
} catch (e) { console.log('  ℹ️ 截图失败：' + e.message) }

check('无未捕获异常', exceptions.length === 0, exceptions.slice(0, 2).join(' | '))
check('无 console.error', consoleMsgs.filter((m) => m.type === 'error').length === 0,
  consoleMsgs.filter((m) => m.type === 'error').slice(0, 3).map((e) => e.text).join(' | '))

console.log('\n[e2e] 面板文案抽样：' + String(dom.sample).slice(0, 240))
console.log('[e2e] 控制台摘要：')
for (const m of consoleMsgs.slice(0, 20)) console.log('    [' + m.type + '] ' + m.text)
if (exceptions.length) { console.log('[e2e] 未捕获异常：'); for (const e of exceptions.slice(0, 5)) console.log('    ' + e) }

const failed = results.filter((r) => !r.ok).length
console.log('\n[e2e] ' + (failed ? failed + ' 项未通过' : '全部通过 ✅') + '（共 ' + results.length + ' 项）')
ws.close(); chrome.kill(); await sleep(500)
try { rmSync(profile, { recursive: true, force: true }) } catch {}
process.exit(failed ? 1 : 0)
