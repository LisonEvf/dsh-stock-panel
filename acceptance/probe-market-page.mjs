// acceptance/probe-market-page.mjs —— 「行情」聚合页的定向取证（隔离 headless Chrome + CDP）。
//
// 与 probe-concept-page.mjs 同一套手法，但量的是**聚合排版**：
//   ① 栅格实际列数（按容器实测宽度 3/2/1）与每块的矩形（宽高比 = 排版是否均衡）；
//   ② 每块「内容高 vs 可视高」—— 差得越多说明这块在 380px 里疯狂内部滚动；
//   ③ 块内首屏能看到几行（榜单/梯队/异动的可见行数）；
//   ④ 页头几行、有没有孤儿换行；
//   ⑤ 明/暗两套计算样式（这一页是否跟随主题 token —— 收口前它整套用的是 tailwind 固定色阶）；
//   ⑥ 三块之间**重复出现的同一件事**（涨停数在总览、梯队各出现一次；指数条在总览/指数各一次）。
//
// 用法：node acceptance/probe-market-page.mjs [appUrl] [outDir] [tag]
import { spawn } from 'node:child_process'
import { mkdtempSync, writeFileSync, rmSync, readFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHash, createHmac } from 'node:crypto'

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
const PORT = Number(process.env.DSH_SHOT_PORT ?? 9339)
const APP = process.argv[2] ?? 'http://127.0.0.1:3080'
const OUT = process.argv[3] ?? 'acceptance/shots'
const TAG = process.argv[4] ?? 'market'
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

const profile = mkdtempSync(join(tmpdir(), 'dsh-mkt-'))
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

await send('Runtime.enable'); await send('Page.enable'); await send('Network.enable')
await send('Emulation.setDeviceMetricsOverride', { width: Number(process.env.DSH_SHOT_W ?? 1680), height: Number(process.env.DSH_SHOT_H ?? 1000), deviceScaleFactor: 1, mobile: false })
const authority = new URL(APP).host
const cookie = localAuthCookie(authority)
await send('Network.setCookie', { name: cookie.name, value: cookie.value, domain: '127.0.0.1', path: '/' })
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
await waitFor('document.body.innerText.includes("行情")', 45000)
console.log('切到 行情：' + (await clickByText('行情')))
// 等三块出数（行情/指数/梯队任一有内容；「加载中」消失更可靠）
await waitFor('document.body.innerText.includes("成交") && !document.body.innerText.includes("加载指数…")', 60000)
await sleep(6000)

const facts = await evaluate(`(() => {
  const txt = (el) => el ? (el.textContent || '').replace(/\\s+/g, ' ').trim() : null
  const rect = (el) => { if (!el) return null; const r = el.getBoundingClientRect(); return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) } }
  const sections = Array.from(document.querySelectorAll('section'))
  // 栅格 = 三块 section 的父节点
  const grid = sections[0]?.parentElement ?? null
  const gridRect = rect(grid)
  const cols = grid ? getComputedStyle(grid).gridTemplateColumns.split(' ').length : null
  return {
    viewport: { w: window.innerWidth, h: window.innerHeight },
    grid: { rect: gridRect, display: grid ? getComputedStyle(grid).display : null, cols, rows: grid ? getComputedStyle(grid).gridTemplateRows : null },
    pageScroll: { docH: document.documentElement.scrollHeight, viewH: window.innerHeight },
    blocks: sections.map((s) => {
      const head = s.children[0]
      const scroller = s.children[1] ?? null
      return {
        title: txt(head)?.slice(0, 40),
        rect: rect(s),
        headRect: rect(head),
        // 内容高 vs 可视高：差得越多 = 这块在疯狂内部滚动
        scrollH: scroller ? scroller.scrollHeight : null,
        clientH: scroller ? scroller.clientHeight : null,
        hiddenPct: scroller ? Math.round((1 - scroller.clientHeight / Math.max(scroller.scrollHeight, 1)) * 100) : null,
        stats: Array.from(s.querySelectorAll('div')).filter(d => /涨 \\/ 平 \\/ 跌|涨停 \\/ 跌停|强势|两市成交|最高连板|≥2板/.test(d.textContent || '') && d.children.length === 0).length,
        rankRows: s.querySelectorAll('li > button').length,
      }
    }),
    headerText: txt(document.querySelector('.dc-view-body')?.firstElementChild?.firstElementChild),
    /* 新组合的**内容计数**：KPI 格 / 榜单张数与行数 / 异动条数 / 梯队 chips。
       这些是"重排之后信息还在不在"的硬证据（布局对了但内容丢了才是真事故）。 */
    counts: {
      kpiCells: document.querySelectorAll('.dc-kpi-cell').length,
      kpiTexts: Array.from(document.querySelectorAll('.dc-kpi-cell')).map(txt),
      distSegments: document.querySelectorAll('.dc-kpi-dist-bar > i').length,
      boards: document.querySelectorAll('.dc-board').length,
      boardRows: document.querySelectorAll('.dc-board-row').length,
      unusualRows: document.querySelectorAll('.dc-unusual-row').length,
      tierChips: document.querySelectorAll('.dc-tier-chip').length,
      heatRows: document.querySelectorAll('.dc-heat-row').length,
      indexChips: document.querySelectorAll('.dc-index-strip-inline > button').length,
    },
    // 主题跟随：这一页的关键面是否走 token（暗色下必须变）
    colors: (() => {
      const sel = (s, prop) => { const el = document.querySelector(s); return el ? getComputedStyle(el)[prop] : null }
      return {
        blockBg: sel('section', 'backgroundColor'),
        blockBorder: sel('section', 'borderTopColor'),
        panelBg: sel('.dsh-stock', 'backgroundColor'),
        innerCardBg: sel('section div[class*="rounded"]', 'backgroundColor'),
      }
    })(),
    duplicated: document.body.innerText.match(/涨停/g)?.length ?? 0,
  }
})()`)
console.log('[facts] ' + JSON.stringify(facts, null, 2))
await shot('行情-亮色')

await evaluate(`(() => { document.body.setAttribute('data-ds-dark-theme', ''); return 'dark' })()`)
await sleep(1200)
await evaluate(`(async () => {
  const p = document.querySelector('.dsh-stock')
  if (p) { p.style.transform = 'translateZ(0)'; void p.offsetHeight; p.style.transform = '' }
  await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))
})()`)
await sleep(1500)
const dark = await evaluate(`(() => {
  const sel = (s, prop) => { const el = document.querySelector(s); return el ? getComputedStyle(el)[prop] : null }
  return {
    panelBg: sel('.dsh-stock', 'backgroundColor'),
    blockBg: sel('section', 'backgroundColor'),
    blockBorder: sel('section', 'borderTopColor'),
    innerCardBg: sel('section div[class*="rounded"]', 'backgroundColor'),
    innerCardBorder: sel('section div[class*="rounded"]', 'borderTopColor'),
    bodyText: sel('section', 'color'),
    /* 日K/分时 分段控件的选中态：暗色下这一处曾经是**近白药丸 + 白字**（全屏唯一成片近白像素），
       换成 .dc-seg 的选中态后必须是"强调色文字 + 半透明底"，与主题一致。 */
    segOn: (() => {
      const el = document.querySelector('.dc-seg-btn.is-on')
      if (!el) return null
      return { bg: getComputedStyle(el).backgroundColor, color: getComputedStyle(el).color, text: (el.textContent || '').trim() }
    })(),
    // 涨/跌/其他 三种异动胶囊（"其他"曾用琥珀，亮色只有 ~2.9:1）
    unusualKinds: Array.from(document.querySelectorAll('.dc-unusual-kind')).slice(0, 6).map((el) => ({
      text: (el.textContent || '').trim(),
      isOther: el.classList.contains('is-other'),
      color: getComputedStyle(el).color,
      bg: getComputedStyle(el).backgroundColor,
    })),
    // KPI 第一格的"今天偏涨/偏跌"强调边
    kpiTone: sel('.dc-kpi-cell', 'borderLeftColor'),
  }
})()`)
console.log('[dark] ' + JSON.stringify(dark))
await shot('行情-暗色')
await evaluate(`(() => { document.body.removeAttribute('data-ds-dark-theme'); return 'light' })()`)
await sleep(600)

console.log('[console errors] ' + (consoleErrors.length === 0 ? '无' : JSON.stringify(consoleErrors.slice(0, 8), null, 2)))

// ── 交互接线：点榜单行 / 点梯队 chip 是否真的落到工作台（新组件的 onClick 是最容易断的一环）──
const clickProbe = async (sel, label) => {
  const info = await evaluate(`(() => {
    const el = document.querySelector('${sel}')
    if (!el) return { ok: false, why: 'not-found' }
    const text = (el.textContent || '').trim()
    // 票名从 title 取（title 的第一段就是 "名称 市场代码｜…"）—— 从 innerText 取会误抓类别胶囊
    const title = el.getAttribute('title') || ''
    el.click()
    return { ok: true, text, title }
  })()`)
  if (!info.ok) {
    console.log(`  ❌ ${label}：元素不存在（${sel}）`)
    return
  }
  await sleep(2500)
  // 工作台挂载的判据：报价头出现 + 正文里能找到刚点的那只票的名字
  const name = (info.title.split(' ')[0] || info.text).slice(0, 4)
  const after = await evaluate(`(() => ({
    hasQuoteHead: !!document.querySelector('.dc-quote-head'),
    hasName: document.body.innerText.includes(${JSON.stringify(name)}),
  }))()`)
  console.log(
    `  ${after.hasQuoteHead && after.hasName ? '✅' : '❌'} ${label}：点了「${info.text.slice(0, 24)}」→ ` +
      `报价头=${after.hasQuoteHead ? '有' : '无'}·名字命中「${name}」=${after.hasName}`,
  )
  // 回到行情页继续下一项
  await clickByText('行情')
  await sleep(2500)
}

await clickProbe('.dc-board-row', '榜单行 → 工作台')
await clickProbe('.dc-tier-chip', '梯队 chip → 工作台')
await clickProbe('.dc-unusual-row', '异动行 → 工作台')

ws.close(); chrome.kill(); await sleep(400)
try { rmSync(profile, { recursive: true, force: true }) } catch {}
process.exit(0)
