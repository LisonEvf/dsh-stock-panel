// acceptance/compare.mjs —— 生成 before/after 并排对照图（用 headless Chrome 渲染一张 HTML 再截图）
import { spawn } from 'node:child_process'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
const PORT = 9336
const pairs = [
  ['行情 · 容器 1680（chrome 分层 + 卡片 + 数字对齐）', 'before-01-行情.png', 'after2-01-行情.png'],
  ['行情 · 容器 1280（单列退化态）', 'before-10-行情-窄屏1280.png', 'after2-10-行情-窄屏1280.png'],
  ['复盘 · 七步流程（左右栏分层）', 'before-02-复盘.png', 'after2-02-复盘.png'],
  ['自挖板块（图标按钮 24px 命中区）', 'before-07-自挖板块.png', 'after2-07-自挖板块.png'],
]
const dir = resolve('acceptance/shots')
const html = `<!doctype html><meta charset="utf-8"><style>
 body{margin:0;background:#0f172a;color:#e2e8f0;font:13px/1.5 -apple-system,"Segoe UI",sans-serif;padding:14px}
 h2{font-size:13px;margin:14px 0 6px;font-weight:600;color:#f8fafc}
 .row{display:grid;grid-template-columns:1fr 1fr;gap:10px}
 figure{margin:0}
 img{width:100%;display:block;border:1px solid #334155;border-radius:6px}
 figcaption{font-size:11px;color:#94a3b8;margin-top:3px}
</style>
${pairs.map(([title, b, a]) => `<h2>${title}</h2><div class="row">
 <figure><img src="file:///${dir.replace(/\\/g, '/')}/${b}"><figcaption>BEFORE</figcaption></figure>
 <figure><img src="file:///${dir.replace(/\\/g, '/')}/${a}"><figcaption>AFTER</figcaption></figure>
</div>`).join('')}`
const htmlPath = join(dir, 'compare.html')
writeFileSync(htmlPath, html, 'utf8')

const profile = mkdtempSync(join(tmpdir(), 'dsh-cmp-'))
const chrome = spawn(CHROME, ['--headless=new', '--disable-gpu', '--no-first-run', '--disable-extensions', '--remote-debugging-port=' + PORT, '--user-data-dir=' + profile, '--window-size=2000,2400', 'about:blank'], { stdio: 'ignore' })
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
let target = null
for (let i = 0; i < 60 && !target; i++) {
  try { const l = await (await fetch('http://127.0.0.1:' + PORT + '/json/list')).json(); target = l.find((t) => t.type === 'page') } catch { /* wait */ }
  if (!target) await sleep(500)
}
const ws = new WebSocket(target.webSocketDebuggerUrl)
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = () => rej(new Error('ws')) })
let id = 0
const pend = new Map()
ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.id === undefined) return; const p = pend.get(m.id); if (p) { pend.delete(m.id); m.error ? p.rej(new Error(JSON.stringify(m.error))) : p.res(m.result) } }
const send = (method, params = {}) => new Promise((res, rej) => { const i2 = ++id; pend.set(i2, { res, rej }); ws.send(JSON.stringify({ id: i2, method, params })); setTimeout(() => { if (pend.has(i2)) { pend.delete(i2); rej(new Error('timeout')) } }, 60000) })
await send('Page.enable')
await send('Emulation.setDeviceMetricsOverride', { width: 2000, height: 2600, deviceScaleFactor: 1, mobile: false })
await send('Page.navigate', { url: 'file:///' + htmlPath.replace(/\\/g, '/') })
await sleep(3500)
const shot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true })
writeFileSync(join(dir, 'compare-before-after.png'), Buffer.from(shot.data, 'base64'))
console.log('wrote ' + join(dir, 'compare-before-after.png'))
ws.close(); chrome.kill(); await sleep(400)
try { rmSync(profile, { recursive: true, force: true }) } catch {}
