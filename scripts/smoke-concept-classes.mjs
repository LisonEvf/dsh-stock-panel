// scripts/smoke-concept-classes.mjs —— 「自挖板块」类列表的**接线**离线冒烟（真引擎 + 假行情）
//
// 用法：
//   pnpm build && node scripts/smoke-concept-classes.mjs
//
// 为什么单独一个脚本（而不是放 tests/）：本脚本要 import **host 半的引擎**（vendor 的 HistEngine），
// 而 vendor 依赖 iconv-lite（CJS，`require('buffer')`）—— 单元测试的 esbuild ESM 打包器装不下它
// （`scripts/unit.mjs` 的约定是"测试只 import 相对路径与 node:*"）。冒烟脚本跑的是**构建产物**
// `lib/index.js`，在真 Node 里解析依赖，所以能直接验证：
//   1. 每行类都带 **成员 / 均涨幅 / 涨停数 / 强度**（用户要的三个数，且强度 = 均涨幅 + 6×涨停数）；
//   2. 涨停判定用 `buy_price_limit`（收盘 = 涨停价 → 计入；涨停价 0 = 无涨跌幅限制 → 不计入）；
//   3. 全A快照**只拉一次**（引擎重建与补数共用 60s memo —— 那是 ≥2MB 的一份数据）；
//   4. 第二次调用命中引擎快照：不再重取日K、不再重拉快照。
//
// 手法：数据钩子（日K / 全A成交额榜 / 名称兜底）全换成假数据，引擎与聚类是真的。

import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const HOST_BUNDLE = join(ROOT, 'lib', 'index.js')

let failures = 0
function assert(cond, msg) {
  if (cond) console.log(`  ✅ ${msg}`)
  else {
    failures += 1
    console.error(`  ❌ ${msg}`)
  }
}

const AS_OF = '2026-09-11'
const BARS = 40
const WINDOW = 20

/** 40 个连续日期（末位 = as_of）。 */
function dateList() {
  const out = []
  const end = new Date(`${AS_OF}T00:00:00`)
  for (let i = BARS - 1; i >= 0; i--) {
    const d = new Date(end.getTime())
    d.setDate(d.getDate() - i)
    out.push(
      `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`,
    )
  }
  return out
}
const DATES = dateList()

/** 确定性伪随机收益（同 seed → 同序列，冒烟可复现）。 */
function returns(seed, n, vol = 0.02) {
  let s = seed >>> 0
  const out = []
  for (let i = 0; i < n; i++) {
    s = (s * 1664525 + 1013904223) >>> 0
    out.push(((s / 2 ** 32) * 2 - 1) * vol)
  }
  return out
}

function closesFrom(rets) {
  const out = []
  let p = 10
  for (const r of rets) {
    p = p * (1 + r)
    out.push(Math.round(p * 100) / 100)
  }
  return out
}

/** 12 只票：A 组 3 只共用一条序列、B 组 2 只共用另一条、其余 7 只各自独立（孤立票）。 */
const UNIVERSE = (() => {
  const sA = returns(11, BARS)
  const sB = returns(22, BARS)
  const list = [
    { market: 0, code: '300001', name: '甲一', rets: sA, limit: 'close' }, // 封板
    { market: 0, code: '300002', name: '甲二', rets: sA, limit: 'none' }, // 无涨跌幅限制
    { market: 0, code: '300003', name: '甲三', rets: sA, limit: 'above' },
    { market: 1, code: '600001', name: '乙一', rets: sB, limit: 'above' },
    { market: 1, code: '600002', name: '乙二', rets: sB, limit: 'above' },
  ]
  for (let i = 1; i <= 7; i++) list.push({ market: 0, code: `00000${i}`, name: `独${i}`, rets: returns(100 + i, BARS), limit: 'above' })
  return list.map((s) => ({ ...s, closes: closesFrom(s.rets) }))
})()

/** 假数据钩子 + 调用计数。 */
function fakeTdx() {
  const calls = { kline: 0, board: 0 }
  const fn = {
    async stockKline(_mkt, code) {
      calls.kline += 1
      const s = UNIVERSE.find((x) => x.code === code)
      if (s === undefined) return []
      return DATES.map((d, i) => ({ datetime: new Date(`${d}T00:00:00`), close: s.closes[i] }))
    },
    async stockBoardMembers() {
      calls.board += 1
      return UNIVERSE.map((s, i) => {
        const close = s.closes[s.closes.length - 1]
        const preClose = s.closes[s.closes.length - 2]
        return {
          market: s.market,
          code: s.code,
          name: s.name,
          close,
          pre_close: preClose,
          // 引擎的池子筛选用它（amount>0 且 pre_close>0），少了它整池会被滤空
          amount: 1e9 - i * 1e7,
          buy_price_limit: s.limit === 'close' ? close : s.limit === 'above' ? Math.round(close * 1.1 * 100) / 100 : 0,
        }
      })
    },
    async stockQuotesFields() {
      return []
    },
  }
  return { fn, calls }
}

const mod = await import(pathToFileURL(HOST_BUNDLE).href)
assert(typeof mod.callHistTool === 'function', 'host 半导出了 callHistTool（脚本/诊断复用同一实现）')

const ARGS = { as_of: AS_OF, window: WINDOW, min_corr: 0.6, pool_n: 200, top_members: 5 }

console.log('[1] 类列表接线：成员 / 均涨幅 / 涨停数 / 强度')
{
  const { fn, calls } = fakeTdx()
  const res = await mod.callHistTool(fn, 'hist_concept_classes', ARGS)
  assert(res?.ok === true, `引擎返回 ok（实际 ${JSON.stringify(res).slice(0, 160)}）`)
  const classes = Array.isArray(res?.classes) ? res.classes : []
  assert(classes.length >= 2, `切出至少两类（实际 ${classes.length}）`)
  const usable = classes.filter((c) => c.weak_chain !== true)
  assert(usable.length >= 2, `两类可采信（实际 ${usable.length}）`)

  let checked = 0
  const needKeys = ['market', 'code', 'name', 'chg_pct', 'limit_up', 'corr']
  for (const c of usable) {
    const members = Array.isArray(c.members) ? c.members : []
    // 字段名是**引擎/MCP 的 snake_case 口径**：前端按它解析，透传内部 camelCase 会让界面静默全灭
    const keysOk = members.every((m) => needKeys.every((k) => k in m))
    const ok =
      members.length === Number(c.size) &&
      keysOk &&
      Number(c.known_n) === members.filter((m) => typeof m.chg_pct === 'number').length &&
      Math.abs(Number(c.strength) - (Number(c.chg_mean) + 6 * Number(c.limit_up_n))) < 1e-9 &&
      Number(c.limit_up_n) === members.filter((m) => m.limit_up === true).length &&
      members.every((m) => ['SH', 'SZ', 'BJ'].includes(m.market) && String(m.code).length === 6)
    if (!ok) {
      console.error(`     类 #${c.class_id} 明细：${JSON.stringify(c).slice(0, 320)}`)
    }
    assert(ok, `#${c.class_id}：成员 ${members.length}/${c.size} · 均涨幅 ${c.chg_mean} · 涨停 ${c.limit_up_n} · 强度 ${c.strength}`)
    checked += 1
  }
  assert(checked >= 2, '至少校验了两类的完整字段')

  const classA = usable.find((c) => (c.members ?? []).some((m) => m.code === '300001'))
  assert(classA !== undefined, '甲一（收盘 = 涨停价）出现在某个类里')
  assert(Number(classA?.limit_up_n) >= 1, '收盘触及涨停价的成员计入涨停数')
  assert((classA?.members ?? []).find((m) => m.code === '300001')?.limit_up === true, '封板的成员标 limit_up=true')
  assert((classA?.members ?? []).find((m) => m.code === '300002')?.limit_up === false, 'buy_price_limit=0（新股）不计入涨停')

  assert(calls.board === 1, `全A快照只拉一次（引擎 + 补数共用 memo，实际 ${calls.board}）`)
  assert(calls.kline >= 12, `逐票取日K（实际 ${calls.kline}）`)
}

console.log('[2] 第二次调用：引擎快照与快照 memo 双命中（不再取数）')
{
  const { fn, calls } = fakeTdx()
  await mod.callHistTool(fn, 'hist_concept_classes', ARGS)
  const afterFirst = { ...calls }
  const res = await mod.callHistTool(fn, 'hist_concept_classes', ARGS)
  assert(res?.ok === true, '第二次照常返回')
  assert(calls.board === afterFirst.board, '60s 内不重复拉全A快照（≥2MB）')
  assert(calls.kline === afterFirst.kline, '引擎快照命中 → 不再重取日K')
}

console.log('[3] 边界：不存在的类如实报错（不抛异常）')
{
  const { fn } = fakeTdx()
  const res = await mod.callHistTool(fn, 'hist_concept_class', { ...ARGS, class_id: 999 })
  assert(res?.ok === false, 'ok=false')
  assert(String(res?.error ?? '').includes('999'), `错误里带上 class_id（实际 ${String(res?.error)}）`)
}

console.log(failures === 0 ? '\n[smoke-concept-classes] 全部通过 ✅' : `\n[smoke-concept-classes] ${failures} 项失败 ❌`)
process.exit(failures === 0 ? 0 : 1)
