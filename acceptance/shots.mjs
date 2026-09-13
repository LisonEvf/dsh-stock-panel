// acceptance/shots.mjs —— 真实渲染截图采集（隔离 headless Chrome + CDP + 自签本机 cookie）。
// 用途：UI 设计评审的"真机底图"——按入口逐个切页并截图，另含窄/宽两种容器宽度。
// 用法：node acceptance/shots.mjs [appUrl] [outDir] [tag]
import { spawn } from 'node:child_process'
import { mkdtempSync, writeFileSync, rmSync, readFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHash, createHmac } from 'node:crypto'

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
const PORT = Number(process.env.DSH_SHOT_PORT ?? 9334)
const APP = process.argv[2] ?? 'http://127.0.0.1:3080'
const OUT = process.argv[3] ?? 'acceptance/shots'
const TAG = process.argv[4] ?? 'before'
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

const profile = mkdtempSync(join(tmpdir(), 'dsh-shot-'))
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
ws.onmessage = (ev) => {
  const msg = JSON.parse(ev.data)
  if (msg.id === undefined) return
  const p = pending.get(msg.id)
  if (p) { pending.delete(msg.id); msg.error ? p.rej(new Error(JSON.stringify(msg.error))) : p.res(msg.result) }
}
const send = (method, params = {}) => new Promise((res, rej) => {
  const id = ++msgId
  pending.set(id, { res, rej })
  ws.send(JSON.stringify({ id, method, params }))
  setTimeout(() => { if (pending.has(id)) { pending.delete(id); rej(new Error('timeout ' + method)) } }, 120000)
})
const evaluate = async (expr) => {
  const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true })
  if (r.exceptionDetails) throw new Error('eval 异常: ' + String(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text).slice(0, 200))
  return r.result?.value
}
const waitFor = async (expr, ms = 30000, step = 600) => {
  const deadline = Date.now() + ms
  while (Date.now() < deadline) { if (await evaluate(expr)) return true; await sleep(step) }
  return false
}
let shotSeq = 0
const shot = async (name) => {
  const file = join(OUT, TAG + '-' + String(++shotSeq).padStart(2, '0') + '-' + name + '.png')
  const r = await send('Page.captureScreenshot', { format: 'png' })
  writeFileSync(file, Buffer.from(r.data, 'base64'))
  console.log('  📸 ' + file)
}
const clickByText = (text) => evaluate(`(() => {
  const el = Array.from(document.querySelectorAll('a,button,[role=tab],[role=link]')).find(x => (x.textContent || '').trim() === '${text}')
  if (!el) return 'not-found'
  el.click(); return 'ok'
})()`)

await send('Runtime.enable'); await send('Page.enable'); await send('Network.enable')
await send('Emulation.setDeviceMetricsOverride', { width: 1680, height: 1000, deviceScaleFactor: 1, mobile: false })
const authority = new URL(APP).host
const cookie = localAuthCookie(authority)
await send('Network.setCookie', { name: cookie.name, value: cookie.value, domain: '127.0.0.1', path: '/' })
await send('Page.navigate', { url: APP })
await waitFor('!!window.__STOCK_PANEL__', 25000)
await waitFor('document.querySelectorAll("[role=tab]").length > 0', 6000)
const opened = await evaluate(`(async () => {
  const sleep = (ms) => new Promise(r => setTimeout(r, ms))
  const tree = document.querySelector('[role=tree]')
  if (!tree) return 'no-tree'
  for (const el of Array.from(tree.querySelectorAll('[role=treeitem]'))) {
    if (el.getAttribute('aria-expanded') === 'false') { el.click(); await sleep(450) }
  }
  await sleep(1000)
  const convs = Array.from(tree.querySelectorAll('[role=treeitem]')).filter(el => el.getAttribute('aria-expanded') === null && (el.textContent || '').trim().length > 3)
  const pick = convs.find(el => /移除工作台|自挖模块素材不足|真实模拟用户/.test(el.textContent || '')) ?? convs[0]
  if (!pick) return 'no-conversation'
  pick.click(); return 'clicked'
})()`)
console.log('open session: ' + opened)
await waitFor('document.querySelectorAll("[role=tab]").length > 0', 30000)
await clickByText('A股工作台')
await waitFor('document.body.innerText.includes("自挖板块")', 45000)
await sleep(2000)

const scenes = ['行情', '复盘', '作战', '选股筛选', '监控规则', '外盘', '自挖板块']
for (const s of scenes) {
  const r = await clickByText(s)
  await sleep(s === '行情' || s === '外盘' ? 12000 : 6000)
  if (s === '自挖板块') await waitFor('document.body.innerText.includes("模型调用") || document.body.innerText.includes("个类")', 60000)
  await shot(s + (r === 'ok' ? '' : '-NOTFOUND'))
  // 每个入口的"整页"截图：整页高度（便于看留白与纵向节奏）
  const full = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true })
  writeFileSync(join(OUT, TAG + '-' + String(shotSeq).padStart(2, '0') + '-' + s + '-full.png'), Buffer.from(full.data, 'base64'))
}

// 工作台：点左栏自选行 → 个股详情（含 K 线）
await clickByText('行情')
await sleep(6000)
const picked = await evaluate(`(() => {
  const el = Array.from(document.querySelectorAll('*')).find(x => x.children.length === 0 && /SZ30|SH60|SZ00|SH68/.test(x.textContent || ''))
  if (!el) return 'no-row'
  const row = el.closest('[role=button],button,li,tr,div')
  if (!row) return 'no-row'
  row.click(); return 'clicked:' + (row.textContent || '').trim().slice(0, 20)
})()`)
console.log('open stock: ' + picked)
await sleep(9000)
await shot('工作台-个股')

// 宽容器（模拟左栏收起 / 更大屏）：看三栏并排是否成立
await send('Emulation.setDeviceMetricsOverride', { width: 2560, height: 1440, deviceScaleFactor: 1, mobile: false })
await sleep(2500)
await clickByText('行情')
await sleep(9000)
await shot('行情-宽屏2560')
await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false })
await sleep(2500)
await shot('行情-窄屏1280')

// 悬停态：鼠标移到一级导航与左栏行上（看 hover/active 反馈）
await send('Emulation.setDeviceMetricsOverride', { width: 1680, height: 1000, deviceScaleFactor: 1, mobile: false })
await sleep(2000)
const box = await evaluate(`(() => {
  const el = Array.from(document.querySelectorAll('a,button')).find(x => (x.textContent || '').trim() === '自挖板块')
  if (!el) return null
  const r = el.getBoundingClientRect()
  return { x: r.x + r.width / 2, y: r.y + r.height / 2 }
})()`)
if (box) {
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: box.x, y: box.y })
  await sleep(900)
  await shot('导航-hover')
}
// 暗色主题：宿主把主题写成 body[data-ds-dark-theme]，这里直接打标记复现（验证 --dc-* 映射与阴影降级）
await clickByText('行情')
await sleep(8000)
await evaluate(`(() => { document.body.setAttribute('data-ds-dark-theme', ''); return 'dark' })()`)
await sleep(4000)
const darkProof = await evaluate(`(() => {
  const p = document.querySelector('.dsh-stock')
  return { bodyBg: getComputedStyle(document.body).backgroundColor, panelBg: p ? getComputedStyle(p).backgroundColor : null, attr: document.body.hasAttribute('data-ds-dark-theme') }
})()`)
console.log('  dark proof: ' + JSON.stringify(darkProof))
// headless 合成器有时不重绘（改了 CSS 变量但帧没重建）——强制一次布局+绘制
await evaluate(`(async () => {
  const p = document.querySelector('.dsh-stock')
  if (p) { p.style.transform = 'translateZ(0)'; void p.offsetHeight; p.style.transform = '' }
  await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))
  return getComputedStyle(document.body).backgroundColor
})()`)
await sleep(2000)
await shot('行情-暗色')
await clickByText('复盘')
await sleep(6000)
await shot('复盘-暗色')
await evaluate(`(() => { document.body.removeAttribute('data-ds-dark-theme'); return 'light' })()`)
await sleep(1500)

console.log('done: ' + shotSeq + ' 张')
ws.close(); chrome.kill(); await sleep(400)
try { rmSync(profile, { recursive: true, force: true }) } catch {}
process.exit(0)
