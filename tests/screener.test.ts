/**
 * tests/screener.test.ts —— 选股引擎（快照条件 + 客户端信号）的单元测试（B4）。
 *
 * 为什么必须锁住它：筛选是"看得见结果、看不见漏掉"的典型 —— 条件写错不会报错，
 * 只会让候选池悄悄少几只（或混进 ST）。这里锁三件事：
 *   1. `matchScreen` 每个条件的**边界与方向**（区间闭区间、成交额/市值按亿换算、板块前缀归属）；
 *   2. `screenRows` 保序 + 上限（结果顺序即"来源顺序"，不应被内部重排）；
 *   3. `detectSignal` 的窗口语义（**近 3 根内**成立即命中）与量能前置条件
 *      —— 用构造序列验证"金叉发生在更早则不算信号"，这是最容易被改坏的一条。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { PRESETS, SIGNAL_META, boardOf, detectSignal, matchScreen, presetCond, screenRows, type ScreenCond } from '../src/lib/screener.ts'
import type { AShareRow, McpKlineRow } from '../src/lib/stock-data.ts'

/** 只给 `matchScreen` 会用到的字段（测试不参与 tsc，断言由运行结果保证）。 */
function row(patch: Partial<AShareRow> & { code: string } = { code: '600000' }): AShareRow {
  return {
    market: 'SH',
    name: '测试股',
    pct: 0,
    turnover: 1,
    vol_ratio: 1,
    amount: 1e8, // 1 亿
    total_market_cap_ab: 100e8, // 100 亿
    close: 10,
    ...patch,
  } as unknown as AShareRow
}

test('boardOf：按代码前缀归属板块（含北交所 92 段与创业板 301 段）', () => {
  assert.equal(boardOf('688001'), 'kcb')
  assert.equal(boardOf('300001'), 'cyb')
  assert.equal(boardOf('301001'), 'cyb')
  assert.equal(boardOf('600000'), 'main_sh')
  assert.equal(boardOf('601988'), 'main_sh')
  assert.equal(boardOf('430001'), 'bj')
  assert.equal(boardOf('830001'), 'bj')
  assert.equal(boardOf('870001'), 'bj')
  assert.equal(boardOf('920001'), 'bj')
  assert.equal(boardOf('000001'), 'main_sz')
  assert.equal(boardOf('002594'), 'main_sz')
})

test('matchScreen：区间是闭区间，方向不能反', () => {
  const r = row({ pct: 5 })
  assert.equal(matchScreen(r, { pctMin: 5 }), true, '下界含等于')
  assert.equal(matchScreen(r, { pctMax: 5 }), true, '上界含等于')
  assert.equal(matchScreen(r, { pctMin: 5.1 }), false)
  assert.equal(matchScreen(r, { pctMax: 4.9 }), false)
  assert.equal(matchScreen(r, {}), true, '无条件 → 全通过')
})

test('matchScreen：成交额/市值按「亿」换算', () => {
  const r = row({ amount: 3e8, total_market_cap_ab: 120e8 })
  assert.equal(matchScreen(r, { amountMinYi: 3 }), true, '3 亿 = 3 亿')
  assert.equal(matchScreen(r, { amountMinYi: 3.1 }), false)
  assert.equal(matchScreen(r, { capMinYi: 100, capMaxYi: 120 }), true)
  assert.equal(matchScreen(r, { capMaxYi: 119.9 }), false, '市值上界')
  assert.equal(matchScreen(r, { capMinYi: 121 }), false, '市值下界')
})

test('matchScreen：换手/量比下限，以及 ST 剔除（大小写与 *ST 都要认）', () => {
  const r = row({ turnover: 2.5, vol_ratio: 1.8 })
  assert.equal(matchScreen(r, { turnoverMin: 2.5 }), true)
  assert.equal(matchScreen(r, { turnoverMin: 2.6 }), false)
  assert.equal(matchScreen(r, { volRatioMin: 1.8 }), true)
  assert.equal(matchScreen(r, { volRatioMin: 1.9 }), false)

  for (const name of ['ST 某某', '*ST某某', 'st某某', '某某ST']) {
    assert.equal(matchScreen(row({ name }), { noST: true }), false, `${name} 应被剔除`)
  }
  assert.equal(matchScreen(row({ name: '测试股' }), { noST: true }), true, '普通名称不受影响')
  assert.equal(matchScreen(row({ name: 'ST 某某' }), { noST: false }), true, '不勾选则保留 ST')
})

test('matchScreen：板块过滤（all 视为不过滤）', () => {
  assert.equal(matchScreen(row({ code: '300750' }), { board: 'cyb' }), true)
  assert.equal(matchScreen(row({ code: '300750' }), { board: 'kcb' }), false)
  assert.equal(matchScreen(row({ code: '300750' }), { board: 'all' }), true)
  assert.equal(matchScreen(row({ code: '600000' }), { board: undefined }), true)
})

test('screenRows：保持入参顺序并按 limit 截断', () => {
  const rows = [
    row({ code: '600001', pct: 1 }),
    row({ code: '600002', pct: 9 }),
    row({ code: '600003', pct: 5 }),
    row({ code: '600004', pct: 2 }),
  ]
  const got = screenRows(rows, { pctMin: 1.5 }, 2)
  assert.deepEqual(got.map((r) => r.code), ['600002', '600003'], '不重排（顺序 = 全A 来源顺序），只截断')
  assert.equal(screenRows(rows, { pctMin: 1.5 }).length, 3, '默认上限内全给')
  assert.equal(screenRows(rows, { pctMin: 1.5 }, 0).length, 0, 'limit=0 → 空')
})

test('PRESETS / presetCond：键唯一、条件可查、未知键返回 null', () => {
  const keys = PRESETS.map((p) => p.key)
  assert.equal(new Set(keys).size, keys.length, `预设键唯一（${keys.join('/')}）`)
  for (const p of PRESETS) {
    assert.ok(p.label.length > 0, `${p.key} 有中文标签`)
    assert.ok(p.hint.length > 0, `${p.key} 有说明`)
    assert.deepEqual(presetCond(p.key), p.cond, `${p.key} 可取回同一条件`)
  }
  assert.equal(presetCond('不存在的预设'), null)
})

// ===== 客户端信号 =====

/** 构造升序 K 线：closes/vols 一一对应，OHLC 用收盘价填充（信号只看 close 与 vol）。 */
function bars(closes: number[], vols: number[]): McpKlineRow[] {
  return closes.map((c, i) => ({ date: `d${i}`, open: c, high: c, low: c, close: c, vol: vols[i] ?? 0 } as McpKlineRow))
}

const FLAT = (n: number, v = 10) => new Array<number>(n).fill(v)
const VOLS = (n: number, v = 100) => new Array<number>(n).fill(v)

test('detectSignal：K 线不足 needBars 直接 false（不得偷偷外推）', () => {
  assert.equal(SIGNAL_META.ma_golden.needBars, 22)
  assert.equal(SIGNAL_META.ma60_break.needBars, 62)
  assert.equal(detectSignal(bars(FLAT(21), VOLS(21)), 'ma_golden'), false)
  assert.equal(detectSignal(bars(FLAT(61), VOLS(61)), 'ma60_break'), false)
  assert.equal(detectSignal([], 'ma_golden'), false)
})

test('★ ma_golden：只认「近 3 根内」的 MA5 上穿 MA20', () => {
  // 30 根：前 29 根横盘 10，最后一根拉到 30 → MA5 在最后一根上穿 MA20
  const fresh = [...FLAT(29), 30]
  assert.equal(detectSignal(bars(fresh, VOLS(30)), 'ma_golden'), true, '最后一根金叉 → 命中')

  // 同样横盘后拉起，但拉起发生在更早（金叉落在 3 根窗口之外）→ 不命中
  const stale = [...FLAT(26), 30, 30, 30, 30]
  assert.equal(detectSignal(bars(stale, VOLS(30)), 'ma_golden'), false, '金叉在 4 根前 → 已过期，不算信号')

  // 纯横盘：MA5 == MA20 不构成"上穿"（严格大于）
  assert.equal(detectSignal(bars(FLAT(30), VOLS(30)), 'ma_golden'), false, 'MA5==MA20 不算金叉')
})

test('★ ma60_break：破 MA60 之外还必须放量（≥ 前 20 日均量 1.2 倍）', () => {
  // 70 根横盘 10，最后一根 20 → 收盘上穿 MA60
  const closes = [...FLAT(69), 20]
  const withVolume = VOLS(70)
  withVolume[69] = 200 // 2 倍量
  assert.equal(detectSignal(bars(closes, withVolume), 'ma60_break'), true, '破位 + 放量 → 命中')

  const noVolume = VOLS(70)
  noVolume[69] = 100 // 与均量持平（1.0 倍 < 1.2）
  assert.equal(detectSignal(bars(closes, noVolume), 'ma60_break'), false, '缩量破位不算信号')

  const borderline = VOLS(70)
  borderline[69] = 120 // 恰好 1.2 倍
  assert.equal(detectSignal(bars(closes, borderline), 'ma60_break'), true, '1.2 倍含等于')

  // 没有上穿 MA60（收盘仍在均线下）→ 即使巨量也不行
  const belowVols = VOLS(70)
  belowVols[69] = 1000
  assert.equal(detectSignal(bars(FLAT(70), belowVols), 'ma60_break'), false, '没破 MA60 → false')
})

test('★ 口径契约：金叉成立 ≠ 破位成立（破位还要求放量）', () => {
  // 最后一根从 10 拉到 30：MA5/MA20 与收盘/MA60 都在窗口内上穿，但量能与均量持平
  const closes = [...FLAT(69), 30]
  const rows = bars(closes, VOLS(70))
  assert.equal(detectSignal(rows, 'ma_golden'), true, '金叉只看均线关系 → 命中')
  assert.equal(detectSignal(rows, 'ma60_break'), false, '同一根 K 线，但没放量 → 破位不成立')
  assert.notEqual(detectSignal(rows, 'ma_golden'), detectSignal(rows, 'ma60_break'), '两者语义不同，不能互相顶替')

  // 补上量能后，同一份 K 线两个信号才都成立
  const vols = VOLS(70)
  vols[69] = 200
  assert.equal(detectSignal(bars(closes, vols), 'ma60_break'), true)
})

test('screenRows 的组合条件（预设级）在真实行上命中正确', () => {
  const cond: ScreenCond = { pctMin: 3, pctMax: 7, turnoverMin: 2, volRatioMin: 1.5, amountMinYi: 5, noST: true, board: 'cyb' }
  const rows = [
    row({ code: '300001', pct: 4, turnover: 3, vol_ratio: 2, amount: 8e8 }), // ✅ 全中
    row({ code: '300002', pct: 4, turnover: 3, vol_ratio: 2, amount: 8e8, name: 'ST退' }), // ❌ ST
    row({ code: '600003', pct: 4, turnover: 3, vol_ratio: 2, amount: 8e8 }), // ❌ 非创业板
    row({ code: '300004', pct: 4, turnover: 1, vol_ratio: 2, amount: 8e8 }), // ❌ 换手不足
    row({ code: '300005', pct: 8, turnover: 3, vol_ratio: 2, amount: 8e8 }), // ❌ 涨幅超上限
    row({ code: '300006', pct: 4, turnover: 3, vol_ratio: 2, amount: 4e8 }), // ❌ 成交额不足
  ]
  assert.deepEqual(screenRows(rows, cond).map((r) => r.code), ['300001'])
})
