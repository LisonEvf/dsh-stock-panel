// scripts/news-source-probe.mjs —— 快讯源（新浪财经 7×24）取证：可用性 / 时间性 / 命中率
//
// 为什么需要它：A2b 之后的缺口是「自挖模块素材不足」——命名手里只有通达信厂商标签这一种素材，
// 于是理由 89% 是「与已有 XX 一致」（复述花名册）。补源要补**同一层级**的源：
// 共动是板块级现象，需要板块级原因（`cluster-namer/docs/12` 的对照实验：个股公告富集仅
// 0.95~1.30x，统计上不成立）。本脚本在动工之前先回答三个决定设计的问题：
//
//   ① **可用性**：接口是否可达、字段是否够用（时间戳 / 正文 / 真实 docurl / 关联个股）；
//   ② **时间性**：翻页能回溯多久 —— 这决定「要不要按日存档」。若只能回溯几十小时，
//      收盘后再拉就永远拿不到当天盘中的快讯，历史 as_of 更是无从谈起；
//   ③ **命中率**：交易时段内的快讯是否真的点名了我们自挖类的成员 —— 若不命中，接了也是白接。
//
// ⚠️ 两条必须自己先防住的假象（第一版就踩了）：
//   · **不能拿"非交易时段"的窗口算命中率**：周五收盘后 + 周六全天拉 1000 条，
//     成员命中必然是 0 —— 那不是源的锅，是窗口里根本没有 A 股盘面。所以要**按日切片**，
//     把「交易时段（09:15–15:05）」与「非交易时段」分开算。
//   · **成员表要取全**：`hist_concept_classes` 回传的成员被 `MEMBER_CAP` 截到每类 20 只，
//     大类的尾部成员会漏出比对集（少算命中）。这里逐类调 `hist_concept_class` 取全量。
//
// 用法：
//   node scripts/news-source-probe.mjs                  # 24 页 × 100 条（约 3 天）
//   node scripts/news-source-probe.mjs --pages 40       # 翻更远，看回溯极限
//   node scripts/news-source-probe.mjs --json out.json  # 落盘原始条目
//
// 依赖：本机出网（Node 内置 fetch）+ 内置 TDX（取自挖类成员与成交额榜做对照）。

import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

const args = process.argv.slice(2)
function argOf(name, fallback) {
  const i = args.indexOf(`--${name}`)
  return i >= 0 && args[i + 1] !== undefined ? args[i + 1] : fallback
}

const PAGES = Math.max(1, Number(argOf('pages', '24')))
const PAGE_SIZE = Math.max(1, Number(argOf('page-size', '100')))
const POOL = Number(argOf('pool', '200'))
const WINDOW = Number(argOf('window', '90'))
const MINCORR = Number(argOf('mincorr', '0.6'))
const ASOF = argOf('asof', undefined)
const JSON_OUT = argOf('json', undefined)

const FEED_URL = 'https://zhibo.sina.com.cn/api/zhibo/feed'
const HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36',
  Referer: 'https://finance.sina.com.cn/7x24/',
}

/** A 股代码形态（含 8/9 开头的北交所）。 */
const A_CODE = /^(0|3|6|8|9)\d{5}$/
/** A 股连续竞价时段（首尾各放宽 15 分钟，容集合竞价与尾盘异动）。 */
const SESSION_FROM = '09:15'
const SESSION_TO = '15:05'

/**
 * 名称/正文归一：去空白（含全角空格）+ 全角字母数字转半角 + 转大写。
 *
 * 为什么必须做：通达信给的三字名是**补空格**的（`万 科Ａ`、`深天马Ａ`），且字母是全角；
 * 而快讯正文写的是 `万科A`。不做归一会**一条都匹配不上**，且不会报错。
 */
function norm(s) {
  return String(s ?? '')
    .replace(/[\s\u3000]/g, '')
    .replace(/[Ａ-Ｚａ-ｚ０-９]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xfee0))
    .toUpperCase()
}

async function fetchPage(page) {
  const url = `${FEED_URL}?page=${page}&page_size=${PAGE_SIZE}&zhibo_id=152&tag_id=0&dire=f&dpc=1`
  const res = await fetch(url, { headers: HEADERS, signal: AbortSignal.timeout(20_000) })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  const j = await res.json()
  const list = j?.result?.data?.feed?.list ?? []
  return list.map((it) => {
    let ex = {}
    try {
      ex = JSON.parse(String(it?.ext ?? '') || '{}')
    } catch {
      ex = {}
    }
    return {
      id: String(it?.id ?? it?.commentid ?? ''),
      ts: String(it?.create_time ?? ''),
      text: String(it?.rich_text ?? it?.text ?? '').trim(),
      tags: (it?.tag ?? []).map((t) => String(t?.name ?? '')).filter(Boolean),
      stocks: (ex?.stocks ?? []).map((s) => String(s?.symbol ?? s?.code ?? '')).filter(Boolean),
      docurl: String(ex?.docurl ?? ''),
    }
  })
}

/** 自挖类全量成员（逐类取，避免 MEMBER_CAP 截断造成的少算）。 */
async function loadClasses(host) {
  const { callEmbeddedTool } = await import(host)
  const tuning = { pool_n: POOL, window: WINDOW, min_corr: MINCORR, ...(ASOF !== undefined ? { as_of: ASOF } : {}) }
  const res = await callEmbeddedTool('hist_concept_classes', { ...tuning, top_members: 0 })
  const heads = (res?.classes ?? []).filter((c) => c.weak_chain !== true)
  const classes = []
  for (const c of heads) {
    const d = await callEmbeddedTool('hist_concept_class', { ...tuning, class_id: c.class_id })
    classes.push({ class_id: c.class_id, size: c.size, members: (d?.members ?? []).map((m) => ({ code: String(m.code), name: String(m.name) })) })
  }
  return { asOf: res?.as_of ?? '?', isolated: Number(res?.isolated_n) || 0, classes }
}

/** 成交额榜前 N（≈ 引擎池的近似：引擎只再剔 ST/历史不足）。 */
async function loadPool(host) {
  const { callEmbeddedTool } = await import(host)
  const rows = await callEmbeddedTool('board_members', {
    board_symbol: 'A',
    count: POOL,
    // 成交额排序字段是 `TOTAL_AMOUNT`（`AMOUNT` 不在允许集里，会被数据层直接拒）
    sort_type: 'TOTAL_AMOUNT',
    sort_order: 'DESC',
  })
  return (Array.isArray(rows) ? rows : []).map((r) => ({ code: String(r.code ?? ''), name: String(r.name ?? '') }))
}

const bump = (m, k) => m.set(k, (m.get(k) ?? 0) + 1)
const HOST = pathToFileURL(join(import.meta.dirname, '..', 'lib', 'index.js')).href

console.log(`[news-probe] 拉 ${PAGES} 页 × ${PAGE_SIZE} 条 · 自挖类 pool=${POOL} w=${WINDOW} ρ=${MINCORR}`)
const items = []
for (let p = 1; p <= PAGES; p += 1) {
  let rows = []
  try {
    rows = await fetchPage(p)
  } catch (err) {
    console.error(`  第 ${p} 页失败：${err?.message ?? err}`)
    break
  }
  if (rows.length === 0) {
    console.log(`  第 ${p} 页空 —— 回溯到底`)
    break
  }
  const ts = rows.map((r) => r.ts).filter(Boolean).sort()
  console.log(`  [${p}] ${rows.length} 条 · ${ts[0]} → ${ts[ts.length - 1]}`)
  items.push(...rows)
}

if (items.length === 0) {
  console.error('[news-probe] 一条都没取到 —— 检查出网（该源无需鉴权，实测应 200）')
  process.exit(1)
}

const tagHist = new Map()
let withUrl = 0
let withStocks = 0
let aCode = 0
for (const it of items) {
  for (const t of it.tags.length ? it.tags : ['(无标签)']) bump(tagHist, t)
  if (A_CODE.test(it.stocks.map((s) => s.replace(/^(sh|sz|bj)/i, ''))[0] ?? '')) aCode += 1
  if (it.docurl) withUrl += 1
  if (it.stocks.length > 0) withStocks += 1
}
const allTs = items.map((i) => i.ts).filter(Boolean).sort()

console.log('\n=== ① 可用性 ===')
console.log(`条目 ${items.length} 条 · 带真实 docurl ${withUrl} · 带 ext.stocks ${withStocks} · 关联到 A 股代码 ${aCode}`)
console.log('标签分布（前 12）：')
const tagRows = [...tagHist].sort((a, b) => b[1] - a[1])
for (const [k, v] of tagRows.slice(0, 12)) console.log(`  ${k} ${v}（${((v / items.length) * 100).toFixed(1)}%）`)

console.log('\n=== ② 时间性（决定要不要按日存档）===')
console.log(`本次拉到的窗口：${allTs[0]} → ${allTs[allTs.length - 1]}（${items.length} 条 / ${PAGES} 页）`)
const hours = (new Date(allTs[allTs.length - 1].replace(/-/g, '/')) - new Date(allTs[0].replace(/-/g, '/'))) / 3.6e6
console.log(`跨度 ${hours.toFixed(1)} 小时 → 每页约 ${(hours / PAGES).toFixed(2)} 小时；一个交易日 ≈ ${(24 / (hours / PAGES)).toFixed(0)} 页`)

console.log('\n=== ③ 命中率（按「交易时段 / 非交易时段」切片）===')
const cls = await loadClasses(HOST)
const pool = await loadPool(HOST)
console.log(`自挖类 as_of=${cls.asOf} · 非弱链 ${cls.classes.length} 类 · 孤立 ${cls.isolated} 只 · 成交额榜 ${pool.length} 只`)
const memberNames = new Set()
const memberCodes = new Set()
for (const c of cls.classes) {
  for (const m of c.members) {
    if (norm(m.name).length >= 2) memberNames.add(norm(m.name))
    memberCodes.add(m.code)
  }
}
/** 一条快讯命中了哪些成员（按股名 / 关联代码）。 */
function hitsOf(it) {
  const t = norm(it.text)
  const byName = cls.classes.flatMap((c) =>
    c.members.filter((m) => norm(m.name).length >= 2 && t.includes(norm(m.name))).map((m) => `${m.code} ${m.name}`),
  )
  const byCode = it.stocks.map((s) => s.replace(/^(sh|sz|bj)/i, '')).filter((c) => memberCodes.has(c))
  const poolHit = pool.filter((p) => (norm(p.name).length >= 2 && t.includes(norm(p.name))) || t.includes(p.code))
  return { member: [...new Set([...byName, ...byCode])], pool: poolHit }
}

/** 是否是交易时段的快讯（只看钟点，不看是不是真交易日 —— 周末同样切片，好做对照）。 */
function inSession(ts) {
  const hm = String(ts).slice(11, 16)
  return hm >= SESSION_FROM && hm <= SESSION_TO
}

const byDay = new Map()
const memberSample = []
for (const it of items) {
  const day = String(it.ts).slice(0, 10)
  if (!byDay.has(day)) byDay.set(day, { all: 0, sess: 0, sessA: 0, member: 0, pool: 0, memSample: [] })
  const d = byDay.get(day)
  d.all += 1
  const { member, pool: pHit } = hitsOf(it)
  const sess = inSession(it.ts)
  if (sess) {
    d.sess += 1
    const codes = it.stocks.map((s) => s.replace(/^(sh|sz|bj)/i, '')).filter((c) => A_CODE.test(c))
    if (codes.length || pHit.length) d.sessA += 1
    if (member.length > 0) {
      d.member += 1
      if (memberSample.length < 8) memberSample.push({ ts: it.ts, tags: it.tags, hit: member, text: it.text.slice(0, 100) })
    }
    if (pHit.length > 0) d.pool += 1
  }
}
console.log('按日切片（sess = 09:15–15:05 的快讯；member/pool 只在 sess 内计）：')
console.log('| 日期 | 全部 | 交易时段 | 时段内带A股锚点 | 命中池内票 | 命中本类成员 |')
console.log('| --- | --- | --- | --- | --- | --- |')
for (const [day, d] of [...byDay].sort()) {
  console.log(`| ${day} | ${d.all} | ${d.sess} | ${d.sessA} | ${d.pool} | **${d.member}** |`)
}
const sessAll = [...byDay.values()].reduce((s, d) => s + d.sess, 0)
const sessMember = [...byDay.values()].reduce((s, d) => s + d.member, 0)
const sessPool = [...byDay.values()].reduce((s, d) => s + d.pool, 0)
console.log(`\n交易时段合计 ${sessAll} 条 → 命中池内票 ${sessPool} 条 · 命中本类成员 ${sessMember} 条`)
for (const s of memberSample) console.log(`  · ${s.ts} [${s.tags.join(',')}] 命中 ${s.hit.join('、')} :: ${s.text}`)
if (memberSample.length === 0) console.log('  （交易时段内一条都没命中本类成员）')

console.log('\n=== 结论口径 ===')
console.log('• 命中率只在**交易时段切片**里读；跨日比命中数是错的（非交易时段没有 A 股盘面）。')
console.log('• 回溯跨度若小于「一个交易日 + 盘后」，则不归档就永远拿不到当天盘中快讯 ⇒ 必须按日存档。')
console.log('• 四层证据强度（announce/anchor/theme/none）的阈值要按上面的命中样例定，别凭直觉。')

if (JSON_OUT !== undefined) {
  writeFileSync(
    JSON_OUT,
    JSON.stringify({ items, cls: { as_of: cls.asOf, classes: cls.classes }, pool }, null, 2),
  )
  console.log(`[news-probe] 原始结果已写入 ${JSON_OUT}`)
}

// TDX 长连接会占住事件循环 —— 不显式退出会让脚本"跑完但不结束"（实测被 CI/管道卡 5 分钟）
process.exit(0)
