// acceptance/readme-shots.mjs —— README 用的**实机截图**采集（可复现，一条命令）。
//
// 与 acceptance/shots.mjs（UI 评审底图，多而全）的分工：本脚本只出 README 要用的那几张，
// 固定文件名、固定视口，产出直接可放进 docs/images/。
//
// 前置：**本机跑着最新构建的 dsh web**。千万别用那个"平时在用的"实例 ——
//   host 半是进程内加载的，改了代码不重启 = 截到旧界面（README §安装 里那条警告）。
//   稳妥做法是另起一个端口，截完就关：
//     pnpm build
//     dsh --profile web --port 3099 --no-open
//     node acceptance/readme-shots.mjs http://127.0.0.1:3099 acceptance/shots-readme
//   （换回 3080 也行，但先用 `node scripts/verify-live.mjs <url>` 确认 buildId 与源码一致。）
//
// 认证：headless Chrome 用 ~/.dsh/.credentials.yaml 里的 secret 自签本机 cookie（同 shots.mjs）。
// 截图里会出现真实会话/自选，属预期——这是"实机"的定义；要脱敏就别用日常 profile。
import { spawn } from 'node:child_process'
import { mkdtempSync, writeFileSync, rmSync, readFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHash, createHmac } from 'node:crypto'

const CHROME = process.env.DSH_CHROME ?? 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
const PORT = Number(process.env.DSH_SHOT_PORT ?? 9335)
const APP = process.argv[2] ?? 'http://127.0.0.1:3099'
const OUT = process.argv[3] ?? 'acceptance/shots-readme'
// 视口：行情页的列数按**容器**实测宽度分档（主区 ≥1120 → 三列，见 MarketPage.tsx），
// 而面板宽度 = 视口 − 宿主会话栏。默认 2200×1240 是为了一屏能落下"三列并排"的形态。
const W = Number(process.env.DSH_SHOT_W ?? 2200)
const H = Number(process.env.DSH_SHOT_H ?? 1240)
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

const profile = mkdtempSync(join(tmpdir(), 'dsh-readme-shot-'))
const chrome = spawn(CHROME, [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--disable-extensions', '--remote-debugging-port=' + PORT, '--user-data-dir=' + profile,
  '--window-size=' + W + ',' + H, 'about:blank',
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
  setTimeout(() => { if (pending.has(id)) { pending.delete(id); rej(new Error('timeout ' + method)) } }, 180000)
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
/** 面板（插件根）几何：用于把截图裁到"插件本体 + 视图标签行"，不把宿主会话栏带进 README。 */
const panelBox = () => evaluate(`(() => {
  const p = document.querySelector('.dsh-stock')
  if (!p) return null
  const r = p.getBoundingClientRect()
  const tab = Array.from(document.querySelectorAll('[role=tab]')).find(t => (t.textContent || '').includes('A股工作台'))
  const top = tab ? Math.min(r.top, tab.getBoundingClientRect().top - 6) : r.top
  return {
    x: Math.max(0, Math.round(r.left)), y: Math.max(0, Math.round(top)),
    width: Math.round(r.width), height: Math.round(Math.min(window.innerHeight, r.bottom) - top),
  }
})()`)
/** 截当前视口；`clip` 给定时只截该矩形（cover 口径：README 里不要宿主外壳）。
 *  第二参数给选择器时只截该元素（做"特写"用，例如右栏 AI 决策卡）。 */
const shot = async (name, selector) => {
  let clip = await panelBox()
  let beyond = false
  if (selector) {
    const r = await evaluate(`(() => {
      const el = document.querySelector(${JSON.stringify(selector)})
      if (!el) return null
      const b = el.getBoundingClientRect()
      return { x: Math.max(0, Math.round(b.left)), y: Math.max(0, Math.round(b.top)), width: Math.round(b.width), height: Math.round(b.height) }
    })()`)
    if (r && r.width > 120 && r.height > 120) { clip = r; beyond = true }
    else console.log('  ⚠️ 找不到 `' + selector + '`（退回整面板截图）')
  }
  const params = { format: 'png' }
  const minW = selector ? 120 : 400
  const minH = selector ? 120 : 300
  if (clip && clip.width > minW && clip.height > minH) params.clip = { ...clip, scale: 1 }
  if (beyond) params.captureBeyondViewport = true
  const r = await send('Page.captureScreenshot', params)
  writeFileSync(join(OUT, name + '.png'), Buffer.from(r.data, 'base64'))
  console.log('  📸 ' + name + '.png' + (params.clip ? '  [clip ' + clip.width + '×' + clip.height + ']' : '  [full viewport]'))
}
/** 行情页的并排列数（按同排**数据块**数判定）——用来确认"一屏并排聚合"真的成立，而不是以为成立。
 *  2026-09-14 重排后：栅格是 `.dc-mkt-grid`，第一行是横跨整行的环境带（`.dc-mkt-kpi`），
 *  要数的是它**下面**那一行的块（指数 / 涨停梯队 / 榜单）。 */
const marketCols = () => evaluate(`(() => {
  const grid = document.querySelector('.dc-mkt-grid')
  if (!grid) return 'not-a-market-grid(可能是单列布局)'
  const kids = Array.from(grid.children).filter(k => !k.classList.contains('dc-mkt-kpi'))
  if (!kids.length) return 'no-blocks'
  const top0 = Math.round(kids[0].getBoundingClientRect().top)
  const sameRow = kids.filter(k => Math.abs(Math.round(k.getBoundingClientRect().top) - top0) < 8)
  const names = sameRow.map(k => (k.querySelector('.dc-mkt-block-title span')?.textContent || '?').trim()).join('+')
  return sameRow.length + ' 列 / 共 ' + kids.length + ' 块（' + names + '）'
})()`)
const clickByText = (text) => evaluate(`(() => {
  const el = Array.from(document.querySelectorAll('a,button,[role=tab],[role=link]')).find(x => (x.textContent || '').trim() === '${text}')
  if (!el) return 'not-found'
  el.click(); return 'ok'
})()`)
/** 点一级入口并等页面真的换过来（等主区出现该入口的标志性文案）。 */
const gotoTab = async (name, marker, timeout = 45000) => {
  const r = await clickByText(name)
  if (r !== 'ok') throw new Error('导航里找不到入口：' + name)
  await waitFor(`document.body.innerText.includes(${JSON.stringify(marker)})`, timeout)
  await sleep(2500)
}
const showFps = () => evaluate(`(async () => {
  const p = document.querySelector('.dsh-stock')
  if (p) { p.style.transform = 'translateZ(0)'; void p.offsetHeight; p.style.transform = '' }
  await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))
  return 'ok'
})()`)

await send('Runtime.enable'); await send('Page.enable'); await send('Network.enable')
await send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: 1, mobile: false })
const authority = new URL(APP).host
const cookie = localAuthCookie(authority)
await send('Network.setCookie', { name: cookie.name, value: cookie.value, domain: '127.0.0.1', path: '/' })
await send('Page.navigate', { url: APP })
if (!await waitFor('!!window.__STOCK_PANEL__', 30000)) throw new Error('插件未加载：window.__STOCK_PANEL__ 不存在（profile 里装了吗？）')
console.log('  版本: ' + await evaluate('window.__STOCK_PANEL__.version') + ' · transport: ' + await evaluate('window.__STOCK_PANEL__.transport()'))

// 打开一个会话 → 切到「A股工作台」视图标签（视图条目只在会话页存在）
const opened = await evaluate(`(async () => {
  const sleep = (ms) => new Promise(r => setTimeout(r, ms))
  const tree = document.querySelector('[role=tree]')
  if (!tree) return 'no-tree'
  for (const el of Array.from(tree.querySelectorAll('[role=treeitem]'))) {
    if (el.getAttribute('aria-expanded') === 'false') { el.click(); await sleep(450) }
  }
  await sleep(800)
  const convs = Array.from(tree.querySelectorAll('[role=treeitem]')).filter(el => el.getAttribute('aria-expanded') === null && (el.textContent || '').trim().length > 3)
  const pick = convs[0]
  if (!pick) return 'no-conversation'
  pick.click(); return 'clicked:' + (pick.textContent || '').trim().slice(0, 20)
})()`)
console.log('  打开会话: ' + opened)
await waitFor('Array.from(document.querySelectorAll("[role=tab]")).some(t => (t.textContent||"").includes("A股工作台"))', 30000)
await clickByText('A股工作台')
if (!await waitFor('document.body.innerText.includes("自挖板块")', 60000)) throw new Error('工作台未出现（视图标签切换失败？）')
await sleep(3000)

/** 自检：截图前把"该在的东西在不在"打成一行日志（看不见图也要能判断这张图能不能用）。
 *  第二参数：表达式字符串（交给 CDP 求值），或一个返回 Promise 的探针函数（如 `marketCols`）。 */
const verify = async (label, probe) => console.log('  ✔ ' + label + ': ' + (typeof probe === 'function' ? await probe() : await evaluate(probe)))

// ① 行情：一屏并排聚合（默认入口）
await gotoTab('行情', '涨停梯队', 60000)
await sleep(8000)
await showFps()
await verify('行情页并排', marketCols)
await verify('四个块与图', `['指数','涨停梯队','榜单','市场异动'].filter(x => document.body.innerText.includes(x)).join('+')`)
await verify('环境带(6 格)', `document.querySelectorAll('.dc-kpi-cell').length + ' 格'`)
await shot('01-market')

// ② 复盘：七步流程
await gotoTab('复盘', '复盘')
await sleep(4000)
await verify('复盘步骤数(②-⑦)', `(document.body.innerText.match(/[②③④⑤⑥⑦]/g) || []).length`)
await shot('02-review')

// ③ 作战：第一屏 = 模型给的作战思路（v1.6 起；卡片在 `.dc-war-plan`）
await gotoTab('作战', '盘')
await waitFor('!!document.querySelector(".dc-war-plan")', 30000)
await sleep(4000)
await verify('作战思路卡', `(() => {
  const c = document.querySelector('.dc-war-plan')
  if (!c) return '(卡片不在)'
  const t = c.innerText || ''
  // 三态要分开报：'空态' 不等于 '没渲染'（休市/无素材时那才是正确回答）
  const state = /模型正在读其他板块的素材/.test(t) ? '采集中'
    : /本时段还没有作战思路|素材不足|模型不可用/.test(t) ? '空态(说明在场)'
    : '有内容'
  const rows = (s) => c.querySelectorAll(s).length
  return state
    + ' · 方向 ' + rows('.dc-war-plan-sectors .dc-rank-row') + ' 个'
    + ' · 候选 ' + rows('.dc-war-plan-picks .dc-rank-row') + ' 只'
    + ' · 按钮 ' + JSON.stringify(Array.from(c.querySelectorAll('button')).map((b) => (b.textContent || '').trim()).filter((x) => x !== '').slice(0, 4))
})()`)
await verify('透明度三件套', `(() => {
  const c = document.querySelector('.dc-war-plan'); if (!c) return '(缺卡片)'
  const t = c.innerText
  return ['可点名', '剔除', '采纳', '保留'].filter((x) => t.includes(x)).join('+') || '(无痕迹)'
})()`)
await verify('作战时段词', `['竞价','验证窗','盘中','尾盘','休市'].filter(x => document.body.innerText.includes(x)).join('+')`)
await shot('03-war')

// ④ 自挖板块：共动类 + 模型命名 + 结构标签 + 强度（打开即批量命名：真机实测 35s 左右出名字，
//    冷启动更久；三态都要认 —— 命名说「素材不足」也是正确回答，脚本不该因此假红）
await gotoTab('自挖板块', '调用', 120000)
await waitFor('/(模型主题|官方行业|官方概念|素材不足)/.test(document.body.innerText)', 180000, 1500)
await sleep(3000)
// 预算行 2026-09-14 起改写为「调用 N 次 · 复用上一轮」；两代文案都认，避免脚本假红
await verify('命名预算行', `(document.body.innerText.match(/(调用\\s*\\d+\\s*次|本次模型调用[^\\n]*)/) || ['(缺)'])[0]`)
await verify('类行(强度/涨停数)', `(document.body.innerText.match(/涨停\\s*\\d+/) ? '有涨停数' : '(未出现涨停数列)')`)
await verify('名称来源标签', `['模型主题','官方行业','官方概念'].filter(x => document.body.innerText.includes(x)).join('+') || '(无来源标签)'`)
await shot('04-concept')

// ⑤ 工作台：点左栏任一行 → 个股页（K 线 + 资金/逐笔 + 右栏 AI）
await gotoTab('行情', '涨停梯队', 60000)
const picked = await evaluate(`(() => {
  const el = Array.from(document.querySelectorAll('*')).find(x => x.children.length === 0 && /SZ30|SH60|SZ00|SH68|SZ00/.test(x.textContent || ''))
  if (!el) return 'no-row'
  const row = el.closest('[role=button],button,li,tr,div')
  if (!row) return 'no-row'
  row.click(); return 'clicked:' + (row.textContent || '').trim().slice(0, 20)
})()`)
console.log('  选中标的: ' + picked)
await waitFor('!!document.querySelector("canvas")', 25000)
await sleep(9000)
await showFps()
await verify('个股头/图表', `['日K','分时'].filter(x => document.body.innerText.includes(x)).join('+') + ' · 标的: ' + ((document.body.innerText.match(/(SH|SZ)\\d{6}/) || ['(未识别)'])[0])`)
await shot('05-stock')

// ⑥ AI 决策卡**特写**（右栏一块，文字才看得清）——工作台整页已在 ⑤；有存档就直接用，不为一张图重复调模型
const cardText = () => evaluate(`(document.querySelector('.dc-verdict') || {}).innerText ? document.querySelector('.dc-verdict').innerText.replace(/\\s+/g, ' ').slice(0, 70) : '(无结论卡)'`)
const hasCard = await evaluate(`!!document.querySelector('.dc-verdict')`)
if (hasCard) {
  console.log('  ℹ️ 右栏已有研判存档 → 直接截图（不重复调模型）')
} else {
  // 按钮文案随状态变：无存档=「一键研判」、有存档=「重新研判」
  let clicked = null
  for (const n of ['一键研判', '重新研判']) if (await clickByText(n) === 'ok') { clicked = n; break }
  if (clicked) console.log('  点击「' + clicked + '」（真模型一次）')
  else console.log('  ⚠️ 右栏没有可点的研判按钮（模型不可用时置灰／右栏被收起）')
  if (clicked) await waitFor('!!document.querySelector(".dc-verdict")', 120000, 2000)
}
await sleep(1500)
await showFps()
await verify('结论卡', cardText)
await shot('06-ai', '.dc-rail--right')

// ⑦ 选股筛选 / 监控规则：两个"随时可用"的整页
await gotoTab('选股筛选', '选股')
await sleep(6000)
await verify('选股页', `(document.body.innerText.match(/(快照筛选|MA|AI)/g) || []).join('+') || '(空)'`)
await shot('07-scout')
await gotoTab('监控规则', '监控')
await sleep(5000)
await verify('监控页', `['价格','涨跌幅','关键词','命中'].filter(x => document.body.innerText.includes(x)).join('+')`)
await shot('08-alerts')

console.log('done → ' + OUT)
ws.close(); chrome.kill(); await sleep(400)
try { rmSync(profile, { recursive: true, force: true }) } catch {}
process.exit(0)
