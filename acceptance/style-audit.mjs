// acceptance/style-audit.mjs —— 真机样式审计：在真浏览器里读 computedStyle，产出可核对的设计事实。
// 用法：node acceptance/style-audit.mjs [appUrl] [outJson]
import { spawn } from 'node:child_process'
import { mkdtempSync, writeFileSync, rmSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHash, createHmac } from 'node:crypto'

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
const PORT = Number(process.env.DSH_AUDIT_PORT ?? 9335)
const APP = process.argv[2] ?? 'http://127.0.0.1:3080'
const OUTJSON = process.argv[3] ?? 'acceptance/71-style-audit.json'

function localAuthCookie(authority) {
  const yaml = readFileSync(join(process.env.USERPROFILE ?? '', '.dsh', '.credentials.yaml'), 'utf8')
  const secret = Buffer.from(yaml.match(/secret:\s*([A-Za-z0-9_-]+)/)[1].replaceAll('-', '+').replaceAll('_', '/'), 'base64')
  const b64u = (buf) => Buffer.from(buf).toString('base64').replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/u, '')
  const name = 'dsh-auth-' + b64u(createHash('sha256').update(authority).digest())
  const now = Date.now()
  const body = b64u(Buffer.from(JSON.stringify({ version: 1, authority, issuedAt: now, expiresAt: now + 3600_000 }), 'utf8'))
  return { name, value: 'v1.' + body + '.' + b64u(createHmac('sha256', secret).update(body).digest()) }
}
const profile = mkdtempSync(join(tmpdir(), 'dsh-audit-'))
const chrome = spawn(CHROME, ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check', '--disable-extensions', '--remote-debugging-port=' + PORT, '--user-data-dir=' + profile, '--window-size=1680,1000', 'about:blank'], { stdio: 'ignore' })
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
async function cdpTarget() {
  for (let i = 0; i < 80; i++) {
    try {
      const list = await (await fetch('http://127.0.0.1:' + PORT + '/json/list')).json()
      const page = list.find((t) => t.type === 'page')
      if (page?.webSocketDebuggerUrl) return page
    } catch { /* wait */ }
    await sleep(500)
  }
  throw new Error('CDP 未就绪')
}
const target = await cdpTarget()
const ws = new WebSocket(target.webSocketDebuggerUrl)
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = () => rej(new Error('ws error')) })
let msgId = 0
const pending = new Map()
ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.id === undefined) return; const p = pending.get(m.id); if (p) { pending.delete(m.id); m.error ? p.rej(new Error(JSON.stringify(m.error))) : p.res(m.result) } }
const send = (method, params = {}) => new Promise((res, rej) => { const id = ++msgId; pending.set(id, { res, rej }); ws.send(JSON.stringify({ id, method, params })); setTimeout(() => { if (pending.has(id)) { pending.delete(id); rej(new Error('timeout ' + method)) } }, 120000) })
const evaluate = async (expr) => { const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true }); if (r.exceptionDetails) throw new Error('eval: ' + String(r.exceptionDetails.exception?.description).slice(0, 200)); return r.result?.value }
const waitFor = async (expr, ms = 30000, step = 600) => { const d = Date.now() + ms; while (Date.now() < d) { if (await evaluate(expr)) return true; await sleep(step) } return false }

await send('Runtime.enable'); await send('Page.enable'); await send('Network.enable')
await send('Emulation.setDeviceMetricsOverride', { width: 1680, height: 1000, deviceScaleFactor: 1, mobile: false })
const cookie = localAuthCookie(new URL(APP).host)
await send('Network.setCookie', { name: cookie.name, value: cookie.value, domain: '127.0.0.1', path: '/' })
await send('Page.navigate', { url: APP })
await waitFor('!!window.__STOCK_PANEL__', 25000)
await evaluate(`(async () => {
  const sleep = (ms) => new Promise(r => setTimeout(r, ms))
  const tree = document.querySelector('[role=tree]')
  for (const el of Array.from(tree.querySelectorAll('[role=treeitem]'))) if (el.getAttribute('aria-expanded') === 'false') { el.click(); await sleep(400) }
  await sleep(900)
  const convs = Array.from(tree.querySelectorAll('[role=treeitem]')).filter(el => el.getAttribute('aria-expanded') === null && (el.textContent || '').trim().length > 3)
  const pick = convs.find(el => /移除工作台|自挖模块素材不足/.test(el.textContent || '')) ?? convs[0]
  pick?.click()
})()`)
await waitFor('document.querySelectorAll("[role=tab]").length > 0', 30000)
await evaluate(`(() => { const t = Array.from(document.querySelectorAll('[role=tab]')).find(x => x.textContent.trim() === 'A股工作台'); t && t.click() })()`)
await waitFor('document.body.innerText.includes("自挖板块")', 45000)
await sleep(3000)

const AUDIT = readFileSync(join(import.meta.dirname, 'audit-inpage.js'), 'utf8')
const audit = await evaluate(AUDIT)
writeFileSync(OUTJSON, JSON.stringify(audit, null, 2), 'utf8')
console.log(JSON.stringify(audit, null, 2).slice(0, 4000))
ws.close(); chrome.kill(); await sleep(300)
try { rmSync(profile, { recursive: true, force: true }) } catch {}
process.exit(0)
