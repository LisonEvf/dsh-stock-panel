// acceptance/probe-concept-page.mjs —— 「自挖板块」页的定向取证（隔离 headless Chrome + CDP）。
//
// 和 shots.mjs 同一套手法（自签本机 cookie + 隔离 profile），但只做一件事：
// 切到「自挖板块」，把**这一页的 DOM 事实**与**明/暗两套截图**取回来。
//
// 为什么单独一个脚本：shots.mjs 要跑 20+ 张图（含行情/复盘/外盘，约 3 分钟），
// 而在改这一页时需要的证据只有四样：
//   ① 一级入口「自挖板块」能切进去且无 console 报错；
//   ② 每行的 DOM 里 名称/来源标签/指标/成员/动作 都在（量的是**结构**，不是像素）；
//   ③ 关键元素的**计算样式**确实取了 token（暗色下必须变色 —— 收口前用的是固定色阶，不变）；
//   ④ 明/暗两张图，供人眼复核层级与留白。
//
// 用法：node acceptance/probe-concept-page.mjs [appUrl] [outDir] [tag]
import { spawn } from 'node:child_process'
import { mkdtempSync, writeFileSync, rmSync, readFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHash, createHmac } from 'node:crypto'

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
const PORT = Number(process.env.DSH_SHOT_PORT ?? 9337)
const APP = process.argv[2] ?? 'http://127.0.0.1:3080'
const OUT = process.argv[3] ?? 'acceptance/shots'
const TAG = process.argv[4] ?? 'concept'
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

const profile = mkdtempSync(join(tmpdir(), 'dsh-probe-'))
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
  setTimeout(() => { if (pending.has(id)) { pending.delete(id); rej(new Error('timeout ' + method)) } }, 120000)
})
const evaluate = async (expr) => {
  const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true })
  if (r.exceptionDetails) throw new Error('eval 异常: ' + String(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text).slice(0, 300))
  return r.result?.value
}
const waitFor = async (expr, ms = 30000, step = 600) => {
  const deadline = Date.now() + ms
  while (Date.now() < deadline) { if (await evaluate(expr)) return true; await sleep(step) }
  return false
}
let seq = 0
const shot = async (name, full = false) => {
  const file = join(OUT, TAG + '-' + String(++seq).padStart(2, '0') + '-' + name + '.png')
  const r = await send('Page.captureScreenshot', full ? { format: 'png', captureBeyondViewport: true } : { format: 'png' })
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
await waitFor('document.querySelectorAll("[role=tab]").length > 0', 8000)

// 打开一个会话（空态下侧栏没有会话就没有对话视图）
const opened = await evaluate(`(async () => {
  const sleep = (ms) => new Promise(r => setTimeout(r, ms))
  const tree = document.querySelector('[role=tree]')
  if (!tree) return 'no-tree'
  for (const el of Array.from(tree.querySelectorAll('[role=treeitem]'))) {
    if (el.getAttribute('aria-expanded') === 'false') { el.click(); await sleep(450) }
  }
  await sleep(900)
  const convs = Array.from(tree.querySelectorAll('[role=treeitem]')).filter(el => el.getAttribute('aria-expanded') === null && (el.textContent || '').trim().length > 3)
  const pick = convs[0]
  if (!pick) return 'no-conversation'
  pick.click(); return 'clicked'
})()`)
console.log('open session: ' + opened)
await waitFor('document.querySelectorAll("[role=tab]").length > 0', 30000)
console.log('切到 A股工作台：' + (await clickByText('A股工作台')))
await waitFor('document.body.innerText.includes("自挖板块")', 45000)
console.log('切到 自挖板块：' + (await clickByText('自挖板块')))
// 等命名（或它的失败说明）落地：结构标签/模型主题/未命名 三种都算"落地"
await waitFor(
  'document.body.innerText.includes("个类") && !!document.querySelector(".dc-cc-card")',
  90000,
)
await sleep(3000)

const facts = await evaluate(`(() => {
  const cards = Array.from(document.querySelectorAll('.dc-cc-card'))
  const first = cards[0]
  const txt = (el) => el ? (el.textContent || '').replace(/\\s+/g, ' ').trim() : null
  const css = (el, prop) => el ? getComputedStyle(el)[prop] : null
  return {
    cards: cards.length,
    summary: txt(document.querySelector('.dc-cc-summary')),
    firstCard: txt(first),
    firstCardChildren: first ? Array.from(first.children).map(c => ({ cls: c.className, text: txt(c)?.slice(0, 120) })) : [],
    names: Array.from(document.querySelectorAll('.dc-cc-name')).slice(0, 12).map(txt),
    srcChips: Array.from(document.querySelectorAll('.dc-cc-src')).slice(0, 12).map(txt),
    metrics: Array.from(document.querySelectorAll('.dc-cc-card')).slice(0, 3).map(c =>
      Array.from(c.querySelectorAll('.dc-cc-metric')).map(m => txt(m))),
    chips: Array.from(document.querySelectorAll('.dc-cc-card')).slice(0, 2).map(c =>
      Array.from(c.querySelectorAll('.dc-cc-chip')).slice(0, 6).map(txt)),
    strongColor: css(document.querySelector('.dc-cc-strength'), 'color'),
    barBg: css(document.querySelector('.dc-cc-bar'), 'backgroundColor'),
    cardBg: css(first, 'backgroundColor'),
    cardBorder: css(first, 'borderTopColor'),
    /* 面/胶囊是否有"面"（亮色下全白 = 层级塌陷，是 2026-09-14 评审的主缺陷）：
       逐元素取实际背景色，判断是否还有 #ffffff 一片。 */
    surfaces: (() => {
      const sel = (s, prop) => { const el = document.querySelector(s); return el ? getComputedStyle(el)[prop] : null }
      return ['.dc-cc-card', '.dc-cc-summary', '.dc-cc-iso', '.dc-cc-chip', '.dc-cc-src', '.dc-cc-act', '.dc-cc-chip-param']
        .map((s) => ({ sel: s, bg: sel(s, 'backgroundColor') }))
    })(),
    /* chip 里"名字"能拿到多少像素：收口前实测只剩 16px（≈1 个汉字），
       而 11px 的涨幅占 37px —— 这条量的是"点一只票"这个页面目标是否真的成立。 */
    chipWidths: Array.from(document.querySelectorAll('.dc-cc-card')).slice(0, 2).map(c =>
      Array.from(c.querySelectorAll('.dc-cc-chip')).slice(0, 6).map(ch => {
        const name = ch.querySelector('span')
        const pct = ch.querySelector('em')
        return { chip: Math.round(ch.getBoundingClientRect().width), name: name ? Math.round(name.getBoundingClientRect().width) : null, pct: pct ? Math.round(pct.getBoundingClientRect().width) : null, text: (name?.textContent || '').trim() }
      })),
    /* 汇总条与页头各占几行（孤儿行的代理指标：行数越少越好） */
    summaryLines: (() => { const el = document.querySelector('.dc-cc-summary'); if (!el) return null; const h = el.getBoundingClientRect().height; return { height: Math.round(h), approxLines: Math.round(h / 17) } })(),
    headHeight: (() => { const el = document.querySelector('.dc-cc-head'); return el ? Math.round(el.getBoundingClientRect().height) : null })(),
    firstCardLineTops: first ? ['dc-cc-strength', 'dc-cc-name', 'dc-cc-rankno'].map(cls => {
      const el = first.querySelector('.' + cls)
      return el ? { cls, top: Math.round(el.getBoundingClientRect().top) } : { cls, top: null }
    }) : [],
    /* 中列三个块（名称/指标/成员）的左边缘必须同一条竖线：
       评审实测"指标行整行缩进 28px"，看着像缩进错乱（量它一眼就能定案）。 */
    mainLeftEdges: first ? ['.dc-cc-names', '.dc-cc-metrics', '.dc-cc-members', '.dc-cc-actions'].map(cls => {
      const el = first.querySelector(cls)
      return el ? { cls, left: Math.round(el.getBoundingClientRect().left) } : { cls, left: null }
    }) : [],
    /* 强度条：轨道宽 + 每行的填充宽（评审实测 54px 轨道上 44/41/40 不可辨 → 已改标尺） */
    bars: Array.from(document.querySelectorAll('.dc-cc-card')).map(c => {
      const track = c.querySelector('.dc-cc-bar')
      const fill = c.querySelector('.dc-cc-bar > i')
      return { track: track ? Math.round(track.getBoundingClientRect().width) : null, fill: fill ? Math.round(fill.getBoundingClientRect().width) : null }
    }),
    summaryRects: (() => {
      const el = document.querySelector('.dc-cc-summary')
      if (!el) return null
      return Array.from(el.children).map(ch => {
        const r = ch.getBoundingClientRect()
        return { cls: ch.className, x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) }
      })
    })(),
    moreBtn: txt(document.querySelector('.dc-cc-more')),
    foot: txt(document.querySelector('.dc-cc-foot summary')),
    iso: txt(document.querySelector('.dc-cc-iso-head')),
  }
})()`)
console.log('[facts] ' + JSON.stringify(facts, null, 2))
await shot('自挖板块-亮色')
await shot('自挖板块-亮色-整页', true)

// 暗色：宿主把主题写成 body[data-ds-dark-theme]（验证 --dc-* 映射是否真的生效）
await evaluate(`(() => { document.body.setAttribute('data-ds-dark-theme', ''); return 'dark' })()`)
await sleep(1500)
await evaluate(`(async () => {
  const p = document.querySelector('.dsh-stock')
  if (p) { p.style.transform = 'translateZ(0)'; void p.offsetHeight; p.style.transform = '' }
  await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))
})()`)
await sleep(1500)
const darkFacts = await evaluate(`(() => {
  const css = (sel, prop) => { const el = document.querySelector(sel); return el ? getComputedStyle(el)[prop] : null }
  return {
    bodyBg: getComputedStyle(document.body).backgroundColor,
    cardBg: css('.dc-cc-card', 'backgroundColor'),
    cardBorder: css('.dc-cc-card', 'borderTopColor'),
    text: css('.dc-cc-name', 'color'),
    dim: css('.dc-cc-metric span', 'color'),
    strong: css('.dc-cc-strength', 'color'),
    chipBg: css('.dc-cc-chip', 'backgroundColor'),
  }
})()`)
console.log('[dark] ' + JSON.stringify(darkFacts))
await shot('自挖板块-暗色')
await evaluate(`(() => { document.body.removeAttribute('data-ds-dark-theme'); return 'light' })()`)
await sleep(800)

console.log('[console errors] ' + (consoleErrors.length === 0 ? '无' : JSON.stringify(consoleErrors.slice(0, 8), null, 2)))
ws.close(); chrome.kill(); await sleep(400)
try { rmSync(profile, { recursive: true, force: true }) } catch {}
process.exit(0)
