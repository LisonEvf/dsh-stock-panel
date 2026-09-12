/**
 * tests/review-metrics.test.ts —— 复盘实算指标的单元测试（B4）。
 *
 * 为什么必须锁住它：温度计的三项输入（晋级率 / 首板溢价 / 炸板率）在 v3 之前是
 * **近似初值**，现在由本模块从「昨日涨停池 + 今日全 A 快照 + 事件流」实算。
 * 这里最危险的不是算错，而是**该返回 null 时返回了一个数** —— 那会让界面把
 * 「没有证据」显示成「实测 0%」，比近似初值更误导。所以本文件的重点：
 *   · 无证据 → null（不是 0）；
 *   · 分母与样本口径（首板只统计 streak=1 且已知的；炸板率分母是"曾涨停"并集）。
 *
 * 测试直接构造 Map / 行对象，不发任何网络请求（纯函数）。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  buildLimitUpPool,
  computePrevDayMetrics,
  computePrevPoolPerf,
  indexTodayRows,
  listPrevPoolBigLosers,
  type TodayRow,
} from '../src/lib/review-metrics.ts'
import type { LimitUpPoolItem } from '../src/lib/review-store.ts'
import type { AShareRow } from '../src/lib/stock-data.ts'

/**
 * 构造全 A 行。`AShareRow` 字段很多，而 `indexTodayRows` 只用到 5 个；
 * 这里刻意只给用得到的字段（测试不参与 tsc，断言由运行结果保证）。
 */
function aRow(market: 'SH' | 'SZ', code: string, pct: number, close: number, upLimit = 0, downLimit = 0): AShareRow {
  return { market, code, name: code, pct, close, buy_price_limit: upLimit, sell_price_limit: downLimit } as unknown as AShareRow
}

function poolItem(symbol: string, streak: number, streakKnown = true, name = symbol): LimitUpPoolItem {
  return { symbol, name, streak, streakKnown }
}

test('buildLimitUpPool：symbol 带市场前缀，且保留 streakKnown（未知连板不能当成 1）', () => {
  const pool = buildLimitUpPool([
    { market: 'SH', code: '600000', name: '浦发', streak: 1, streakKnown: true },
    { market: 'SZ', code: '000001', name: '平安', streak: 0, streakKnown: false },
  ])
  assert.deepEqual(pool.map((p) => p.symbol), ['SH600000', 'SZ000001'])
  assert.equal(pool[0].streak, 1)
  assert.equal(pool[0].streakKnown, true)
  assert.equal(pool[1].streakKnown, false, 'streakKnown=false 必须原样带下去')
})

test('indexTodayRows：按 `${market}${code}` 索引，涨跌停用「触及涨跌停价」同口径判定', () => {
  const idx = indexTodayRows([
    aRow('SH', '600000', 10, 11, 11, 9), // 封涨停
    aRow('SZ', '000001', -10, 9, 11, 9), // 跌停
    aRow('SH', '600001', 3, 10.5, 11, 9), // 普通上涨（未触板）
    aRow('SH', '600002', 3, 10.5, 0, 0), // 无涨跌停价（数据缺）→ 不得误判为涨停
  ])
  assert.equal(idx.size, 4)
  assert.deepEqual(idx.get('SH600000'), { pct: 10, atLimit: true, atLimitDown: false })
  assert.deepEqual(idx.get('SZ000001'), { pct: -10, atLimit: false, atLimitDown: true })
  assert.deepEqual(idx.get('SH600001'), { pct: 3, atLimit: false, atLimitDown: false })
  assert.deepEqual(idx.get('SH600002'), { pct: 3, atLimit: false, atLimitDown: false }, '限价为 0 时不得判成涨停')
})

test('空池 / 无样本：三项实算全部返回 null（不是 0）', () => {
  const calc = computePrevDayMetrics({
    prevPool: undefined,
    todayPoolSymbols: new Set(),
    todayRow: new Map(),
    todayBreakSymbols: new Set(),
    hasCaptureToday: true,
  })
  assert.equal(calc.prevPoolSize, 0)
  assert.equal(calc.promoteRate, null, '没有昨日池 → 晋级率无证据')
  assert.equal(calc.firstBoardPremium, null, '没有首板样本 → 溢价无证据')
  assert.equal(calc.brokenRate, null, '没有曾涨停样本（并集为空）→ 炸板率无证据')
})

test('★ 口径契约：「抓到 0 家炸板」与「没抓到」必须能区分', () => {
  // 有捕获证据、且当日确有 2 家曾涨停但无一炸板 → 这是**可信的 0**
  const realZero = computePrevDayMetrics({
    prevPool: [poolItem('SH600000', 1)],
    todayPoolSymbols: new Set(['SH600001', 'SH600002']),
    todayRow: new Map(),
    todayBreakSymbols: new Set(),
    hasCaptureToday: true,
  })
  assert.equal(realZero.brokenRate, 0, '有曾涨停样本 + 无炸板 → 0（可信）')
  assert.equal(realZero.breakSamples, 0)
})

test('晋级率 = 昨日涨停中今日仍涨停的比例', () => {
  const prev = [poolItem('SH600000', 1), poolItem('SH600001', 1), poolItem('SH600002', 2), poolItem('SH600003', 1)]
  const calc = computePrevDayMetrics({
    prevPool: prev,
    todayPoolSymbols: new Set(['SH600000', 'SH600002']), // 2/4
    todayRow: new Map(),
    todayBreakSymbols: new Set(),
    hasCaptureToday: false,
  })
  assert.equal(calc.promoteRate, 0.5)
  assert.equal(calc.prevPoolSize, 4)
})

test('首板溢价：只统计「昨日首板且连板数已知」的样本，且必须有今日行情', () => {
  const prev = [
    poolItem('SH600000', 1), // 首板，有今日行 → 计
    poolItem('SH600001', 1), // 首板，有今日行 → 计
    poolItem('SH600002', 1), // 首板，但今日无行情（停牌）→ 不计
    poolItem('SH600003', 2), // 二板 → 不计入首板溢价
    poolItem('SH600004', 1, false), // 连板数未知 → 不计入（不能假设它是首板）
  ]
  const todayRow = new Map<string, TodayRow>([
    ['SH600000', { pct: 6, atLimit: true, atLimitDown: false }],
    ['SH600001', { pct: -2, atLimit: false, atLimitDown: false }],
    ['SH600003', { pct: 100, atLimit: true, atLimitDown: false }], // 若被误计入，均值会明显跑偏
    ['SH600004', { pct: 100, atLimit: true, atLimitDown: false }],
  ])
  const calc = computePrevDayMetrics({
    prevPool: prev,
    todayPoolSymbols: new Set(),
    todayRow,
    todayBreakSymbols: new Set(),
    hasCaptureToday: false,
  })
  assert.equal(calc.premiumSamples, 2, '样本只 2 只')
  assert.equal(calc.firstBoardPremium, 2, '(6 + -2)/2 = 2 —— 二板与未知连板未混入')
})

test('炸板率：分母是「曾涨停」并集（炸板 ∪ 最终涨停），且必须当日有捕获证据', () => {
  const args = {
    prevPool: [poolItem('SH600000', 1)],
    todayPoolSymbols: new Set(['SH600000', 'SH600001', 'SH600002']), // 最终 3 家涨停
    todayRow: new Map<string, TodayRow>(),
    todayBreakSymbols: new Set(['SH600002', 'SH600003', 'SH600004']), // 3 家炸板（SH600002 回封）
    hasCaptureToday: true,
  }
  const calc = computePrevDayMetrics(args)
  assert.equal(calc.breakSamples, 3)
  // 并集 = {600000,600001,600002,600003,600004} = 5 → 3/5
  assert.equal(calc.brokenRate, 0.6)

  const noCapture = computePrevDayMetrics({ ...args, hasCaptureToday: false })
  assert.equal(noCapture.brokenRate, null, '未捕获事件 → 无证据（0 与"没抓到"必须能区分）')
})

test('computePrevPoolPerf：整体情绪与亏钱效应（平均涨幅 / 红盘率 / 晋级 / 大跌 / 跌停）', () => {
  const pool = [
    poolItem('SH600000', 1, true, 'A'),
    poolItem('SH600001', 1, true, 'B'),
    poolItem('SH600002', 1, true, 'C'),
    poolItem('SH600003', 1, true, 'D'),
    poolItem('SH600004', 1, true, 'E'), // 今日无行情（停牌）
  ]
  const todayRow = new Map<string, TodayRow>([
    ['SH600000', { pct: 10, atLimit: true, atLimitDown: false }], // 晋级
    ['SH600001', { pct: 1, atLimit: false, atLimitDown: false }], // 红盘
    ['SH600002', { pct: -6, atLimit: false, atLimitDown: false }], // 大跌
    ['SH600003', { pct: -10, atLimit: false, atLimitDown: true }], // 跌停
  ])
  const perf = computePrevPoolPerf(pool, todayRow)
  assert.equal(perf.samples, 4, '停牌那只不参与（分母用 samples，不是 pool.length）')
  assert.equal(perf.avgPct, (10 + 1 - 6 - 10) / 4)
  assert.equal(perf.redCount, 2)
  assert.equal(perf.redRate, 0.5)
  assert.equal(perf.againLimit, 1)
  assert.equal(perf.bigLoseCount, 2, '≤-5% 计 2 只（-6 与 -10）')
  assert.equal(perf.limitDownCount, 1)
})

test('computePrevPoolPerf：空池或全部无行情 → 全 0 + avgPct=null（不返回 NaN）', () => {
  const empty = computePrevPoolPerf(undefined, new Map())
  assert.deepEqual(empty, { samples: 0, avgPct: null, redCount: 0, redRate: null, againLimit: 0, bigLoseCount: 0, limitDownCount: 0 })
  const noQuote = computePrevPoolPerf([poolItem('SH600000', 1)], new Map())
  assert.equal(noQuote.samples, 0)
  assert.equal(noQuote.avgPct, null, '样本 0 时不得出现 NaN 或 0')
  assert.equal(noQuote.redRate, null)
})

test('亏钱效应样本：跌停必收录（哪怕跌幅不足阈值），按跌幅升序', () => {
  const pool = [poolItem('SH600000', 1, true, '股0'), poolItem('SH600001', 1, true, '股1'), poolItem('SH600002', 1, true, '股2')]
  const todayRow = new Map<string, TodayRow>([
    ['SH600000', { pct: -6, atLimit: false, atLimitDown: false }], // 大跌
    ['SH600001', { pct: -3, atLimit: false, atLimitDown: true }], // 跌停但跌幅不到 -5%
    ['SH600002', { pct: 0, atLimit: false, atLimitDown: false }], // 平盘 → 不收
  ])
  const losers = listPrevPoolBigLosers(pool, todayRow)
  assert.deepEqual(losers.map((l) => l.symbol), ['SH600000', 'SH600001'], '跌停必收录 + 按跌幅升序（最惨在前）')
  assert.equal(losers[1].atLimitDown, true, '跌停标记带出去供界面配色')

  // 阈值可覆盖：收紧到 -8 后只剩跌停那只
  const strict = listPrevPoolBigLosers(pool, todayRow, -8)
  assert.deepEqual(strict.map((l) => l.symbol), ['SH600001'])
})

test('亏钱效应样本：最多 20 条（保留最惨的 20 只，截断较温和的）', () => {
  // 25 只昨日涨停：i=0 最惨（-7.4%），i=24 最温和（-5.0%）
  const pool = Array.from({ length: 25 }, (_, i) => poolItem(`SH6000${String(i).padStart(2, '0')}`, 1, true, `股${i}`))
  const todayRow = new Map<string, TodayRow>()
  for (let i = 0; i < 25; i++) {
    todayRow.set(`SH6000${String(i).padStart(2, '0')}`, { pct: -(7.4 - i * 0.1), atLimit: false, atLimitDown: false })
  }
  const losers = listPrevPoolBigLosers(pool, todayRow)
  assert.equal(losers.length, 20, '上限 20 条')
  assert.equal(losers[0].symbol, 'SH600000', '第一行是最惨的（-7.4%）')
  assert.equal(losers[0].pct, -7.4)
  for (let i = 1; i < losers.length; i++) assert.ok(losers[i - 1].pct <= losers[i].pct, '全程升序（最惨在前）')
  assert.ok(losers.every((l) => l.pct <= -5.49), '被截断的是最温和的那几只（≥ -5.4%）')
  assert.ok(Math.abs(losers[19].pct - -5.5) < 1e-9, `第 20 行是 -5.5%（实际 ${losers[19].pct}）`)
})

test('★ 口径契约：三项实算结果都在合法区间（晋级率/炸板率 ∈ [0,1]）', () => {
  const prev = Array.from({ length: 7 }, (_, i) => poolItem(`SH6000${String(i).padStart(2, '0')}`, 1, true))
  const calc = computePrevDayMetrics({
    prevPool: prev,
    todayPoolSymbols: new Set(prev.slice(0, 3).map((p) => p.symbol)),
    todayRow: new Map(),
    todayBreakSymbols: new Set(['SH600100', 'SH600101']),
    hasCaptureToday: true,
  })
  assert.ok(calc.promoteRate !== null && calc.promoteRate >= 0 && calc.promoteRate <= 1, `晋级率 ${String(calc.promoteRate)}`)
  assert.ok(calc.brokenRate !== null && calc.brokenRate >= 0 && calc.brokenRate <= 1, `炸板率 ${String(calc.brokenRate)}`)
})
