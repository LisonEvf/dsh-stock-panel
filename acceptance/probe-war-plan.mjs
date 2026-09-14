// acceptance/probe-war-plan.mjs —— 「作战思路」（v1.6 作战板块重做）的真机取证。
//
// 与 probe-market-page.mjs / probe-concept-page.mjs 同一套手法（隔离 headless Chrome + CDP），
// 但它验的是**本轮改动的三条命门**（离线单测覆盖不到的部分）：
//   ① 卡片在真机里真的挂上了，且休市/无素材时给的是**说明**而不是空白
//      （"没有可用的盘面素材 → 不自动生成，省模型预算" 这句必须看得见）；
//   ② 点「生成」后，**模型链路真的通**：POST /api/stock-panel/ai（task=war-plan）
//      → 落一份存档 → 卡片渲染出盘眼/方向/候选/落点（或如实说"素材不足"）；
//   ③ 卡片里的**透明度三件套**都在：素材规模（白名单几只票/几个方向）、护栏痕迹、
//      采纳痕迹 —— 缺一条，用户就没法判断这句话是模型读出来的还是编的。
//
// 用法：node acceptance/probe-war-plan.mjs [appUrl] [outDir] [tag]
import { spawn } from 'node:child_process'
import { mkdtempSync, writeFileSync, mkdirSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHash, createHmac } from 'node:crypto'

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
const PORT = Number(process.env.DSH_SHOT_PORT ?? 9341)
const APP = process.argv[2] ?? 'http://127.0.0.1:3080'
const OUT = process.argv[3] ?? 'acceptance/shots'
const TAG = process.argv[4] ?? 'warplan'
mkdirSync(OUT, { recursive: true })

function localAuthCookie(authority) {
  const yaml = readFileSync(join(process.env.USERPROFILE ?? '', '.dsh', '.credentials.yaml'), 'utf8')
  const secret = Buffer.from(yaml.match(/secret:\s*([A-Za-z0-9_-]+)/)[1].replaceAll('-', '+').replaceAll('_', '/'), 'base64')
  const b64u = (buf) => Buffer.from(buf).toString('base64').replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/u, '')
  const name = 'dsh-auth-' + b64u(createHash('sha256').update(authority).digest())
  const now = Date.now()
  const body = b64u(Buffer.from(JSON.stringify({ version: 1, authority, issuedAt: now, expiresAt: now + 3600_000 }), 'utf8'))
  return { name, value: 'v1.' + body + '.' + b64u(createHmac('sha256', secret).update(body).digest()) }
}

const profile = mkdtempSync(join(tmpdir(), 'dsh-war-'))
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
const consoleErrors = []
ws.onmessage = (ev) => {
  const msg = JSON.parse(ev.data)
  if (msg.method === 'Runtime.consoleAPICalled' && msg.params?.type === 'error') {
    consoleErrors.push((msg.params.args ?? []).map((a) => String(a.value ?? a.description ?? '')).join(' '))
  }
  if (msg.method === 'Runtime.exceptionThrown') {
    consoleErrors.push('exception: ' + String(msg.params?.exceptionDetails?.exception?.description ?? '').slice(0, 200))
  }
  if (msg.id === undefined) return
  const p = pending.get(msg.id)
  if (p) { pending.delete(msg.id); msg.error ? p.rej(new Error(JSON.stringify(msg.error))) : p.res(msg.result) }
}
const send = (method, params = {}) => new Promise((res, rej) => {
  const id = ++msgId
  pending.set(id, { res, rej })
  ws.send(JSON.stringify({ id, method, params }))
  setTimeout(() => { if (pending.has(id)) { pending.delete(id); rej(new Error('timeout ' + method)) } }, 180000)
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
let seq = 0
const shot = async (name) => {
  const file = join(OUT, TAG + '-' + String(++seq).padStart(2, '0') + '-' + name + '.png')
  const r = await send('Page.captureScreenshot', { format: 'png' })
  writeFileSync(file, Buffer.from(r.data, 'base64'))
  console.log('  📸 ' + file)
}
const clickByText = (text) => evaluate(`(() => {
  const el = Array.from(document.querySelectorAll('a,button,[role=tab],[role=link]')).find(x => (x.textContent || '').trim() === '${text}')
  if (!el) return 'not-found'
  el.click(); return 'ok'
})()`)
/** 点卡片里某个文本的按钮（前缀匹配：按钮文本带图标与动态词，如「重算」「生成」）。 */
const clickInCard = (re) => evaluate(`(() => {
  const card = document.querySelector('.dc-war-plan')
  if (!card) return 'no-card'
  const el = Array.from(card.querySelectorAll('button')).find(x => /${re}/.test((x.textContent || '').trim()))
  if (!el) return 'not-found'
  el.click(); return 'ok'
})()`)

/** 卡片的结构化读数（探针的核心：不是"看到文字"，而是"哪些段渲染出来了"）。 */
const readCard = () => evaluate(`(() => {
  const txt = (el) => el ? (el.textContent || '').replace(/\\s+/g, ' ').trim() : null
  const card = document.querySelector('.dc-war-plan')
  if (!card) return { present: false }
  const seg = (sel) => { const el = card.querySelector(sel); return el ? (txt(el) || '').slice(0, 400) : null }
  return {
    present: true,
    head: seg('.dc-war-plan-head'),
    full: (txt(card) || '').slice(0, 2000),
    sectors: seg('.dc-war-plan-sectors'),
    sectorRows: card.querySelectorAll('.dc-war-plan-sectors .dc-rank-row').length,
    picks: seg('.dc-war-plan-picks'),
    pickRows: card.querySelectorAll('.dc-war-plan-picks .dc-rank-row').length,
    drops: seg('.dc-war-plan-drops'),
    dropRows: card.querySelectorAll('.dc-war-plan-drops li').length,
    evidence: seg('.dc-war-plan-evidence'),
    guard: seg('.dc-war-plan-guard'),
    /* 三态的分辨：StateView 的三种形态各有自己的锚点文本，混在一起会看不出是哪种 */
    state: /模型正在读其他板块的素材/.test(card.innerText) ? 'loading'
      : /重试/.test(card.innerText) && !/生成作战思路/.test(card.innerText) ? 'error'
      : /本时段还没有作战思路|素材不足|模型不可用/.test(card.innerText) ? 'empty'
      : 'content',
    buttons: Array.from(card.querySelectorAll('button')).map((b) => (b.textContent || '').trim()).filter((t) => t !== ''),
    rank: card.querySelectorAll('.dc-rank-row').length,
  }
})()`)

await send('Runtime.enable'); await send('Page.enable'); await send('Network.enable')
await send('Emulation.setDeviceMetricsOverride', { width: 1680, height: 1000, deviceScaleFactor: 1, mobile: false })
await send('Network.setCookie', { name: localAuthCookie(new URL(APP).host).name, value: localAuthCookie(new URL(APP).host).value, domain: '127.0.0.1', path: '/' })
await send('Page.navigate', { url: APP })
await waitFor('!!window.__STOCK_PANEL__', 25000)
await waitFor('document.querySelectorAll("[role=tab]").length > 0', 8000)

const opened = await evaluate(`(async () => {
  const sleep = (ms) => new Promise(r => setTimeout(r, ms))
  const tree = document.querySelector('[role=tree]')
  if (!tree) return 'no-tree'
  for (const el of Array.from(tree.querySelectorAll('[role=treeitem]'))) {
    if (el.getAttribute('aria-expanded') === 'false') { el.click(); await sleep(450) }
  }
  await sleep(900)
  const convs = Array.from(tree.querySelectorAll('[role=treeitem]')).filter(el => el.getAttribute('aria-expanded') === null && (el.textContent || '').trim().length > 3)
  if (!convs[0]) return 'no-conversation'
  convs[0].click(); return 'clicked'
})()`)
console.log('open session: ' + opened)
await waitFor('document.querySelectorAll("[role=tab]").length > 0', 30000)
console.log('切到 A股工作台：' + (await clickByText('A股工作台')))
await waitFor('document.body.innerText.includes("作战")', 45000)
console.log('切到 作战：' + (await clickByText('作战')))
await waitFor('!!document.querySelector(".dc-war-plan")', 30000)
await sleep(4000)

console.log('\n[1] 首屏（休市 / 无素材时该说什么）')
await sleep(6000)
const first = await readCard()
console.log('  卡片在场 = ' + first.present + ' · 状态 = ' + first.state + ' · 按钮 = ' + JSON.stringify(first.buttons))
console.log('  头部：' + (first.head ?? ''))
console.log('  正文：' + (first.full ?? '').slice(0, 400))
console.log('  AI 可用性：' + JSON.stringify(await evaluate(`fetch('/api/stock-panel/ai').then(r => r.json()).catch(e => String(e))`)))
await shot('first-screen')

console.log('\n[2] 等自动生成收敛（≤180s；采集 + 一次模型调用）')
const autoDone = await waitFor(
  `(() => { const c = document.querySelector('.dc-war-plan'); if (!c) return false; const t = c.innerText || ''; return !t.includes('模型正在读其他板块的素材') && !t.includes('本时段还没有作战思路') })()`,
  180000,
  1500,
)
console.log('  自动生成收敛：' + autoDone)
const auto = await readCard()
console.log('  状态 = ' + auto.state + ' · 整卡文本：\n    ' + (auto.full ?? '').replaceAll('\n', '\n    ').slice(0, 1200))
await shot('auto-result')

console.log('\n[3] 手动点「重算」（force 路径：越过时段缓存再跑一次）')
const gen = await clickInCard('重算|生成')
console.log('  点按钮：' + gen)
const manualDone = await waitFor(
  `(() => { const c = document.querySelector('.dc-war-plan'); if (!c) return false; const t = c.innerText || ''; return !t.includes('模型正在读其他板块的素材') && (t.includes('落点') || t.includes('素材不足') || t.includes('重试')) })()`,
  180000,
  1500,
)
console.log('  收敛：' + manualDone)
await sleep(2500)
const after = await readCard()
console.log('  状态 = ' + after.state + ' · 按钮 = ' + JSON.stringify(after.buttons))
console.log('  头部：' + (after.head ?? ''))
console.log('  方向段：' + (after.sectors ?? 'null') + '（行 ' + after.sectorRows + '）')
console.log('  候选段：' + (after.picks ?? 'null') + '（行 ' + after.pickRows + '）')
console.log('  落点段：' + (after.drops ?? 'null') + '（行 ' + after.dropRows + '）')
console.log('  证据段：' + (after.evidence ?? 'null'))
console.log('  护栏段：' + (after.guard ?? 'null'))
console.log('  整卡 rank 行数 = ' + after.rank)
await shot('after-generate')

console.log('\n[4] 透明度三件套 + 手动覆盖入口')
const facts = await evaluate(`(() => {
  const txt = (s) => { const el = document.querySelector(s); return el ? (el.textContent || '').replace(/\\s+/g, ' ').trim().slice(0, 300) : null }
  const card = document.querySelector('.dc-war-plan')
  const body = (card?.innerText || '')
  return {
    whitelistShown: /可点名 \\d+ 只票/.test(body),
    guardShown: /已剔除|引文可反查|素材缺口/.test(body),
    adoptionShown: /写入 \\d+ 项|已按默认写进当日记录/.test(body),
    qCardsCollapsed: /人工覆盖三问/.test(document.body.innerText),
    qCardsMounted: document.body.innerText.includes('Q1 持续性'),
    silenceNote: /不自动生成|已有时段内的思路|本时段第一次打开/.test(body),
    storage: (() => { try { return Object.keys(JSON.parse(localStorage.getItem('dsh-stock-panel:war-plan:v1') || '{}')).length } catch { return 'parse-error' } })(),
    head: txt('.dc-war-plan-head'),
  }
})()`)
console.log('  ' + JSON.stringify(facts, null, 2))
console.log('  console 错误 ' + consoleErrors.length + ' 条' + (consoleErrors.length ? '：' + consoleErrors.slice(0, 3).join(' | ') : ''))
await send('Page.captureScreenshot', { format: 'png' }).then((r) => writeFileSync(join(OUT, TAG + '-full.png'), Buffer.from(r.data, 'base64')))

ws.close()
chrome.kill()
console.log('\n[probe-war-plan] 完成（截图在 ' + OUT + '）')
