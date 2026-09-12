/**
 * tests/indicators.test.ts —— 涨停/连板判定的单元测试（B4）。
 *
 * 为什么优先测这两个：`countStreak` 是「涨停梯队 / 温度计 / 预期清单状态」的共同地基，
 * 它错一天，复盘与作战页的所有空间维度都跟着错；而涨跌停幅度是**按代码前缀 + ST 分档**的，
 * 创业板 20%、北交 30%、ST 5% 这些分档平时不显眼，但一个分档写错就会把 20cm 板算成非涨停。
 *
 * 运行：`node scripts/unit.mjs`（用 node:test，无测试框架依赖）。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  countStreak,
  isLimitUpDay,
  isOneWordLimitUp,
  limitPriceOf,
  limitUpPct,
  type CandleLike,
} from '../src/lib/indicators.ts'

test('涨跌停幅度：按代码前缀与 ST 分档', () => {
  assert.equal(limitUpPct('600519'), 0.1, '沪主板 10%')
  assert.equal(limitUpPct('000001'), 0.1, '深主板 10%')
  assert.equal(limitUpPct('300750'), 0.2, '创业板 20%')
  assert.equal(limitUpPct('301029'), 0.2, '创业板 301 段 20%')
  assert.equal(limitUpPct('688111'), 0.2, '科创板 20%')
  assert.equal(limitUpPct('830799'), 0.3, '北交所 8 段 30%')
  assert.equal(limitUpPct('430047'), 0.3, '北交所 4 段 30%')
  assert.equal(limitUpPct('600519', 'ST 某某'), 0.05, 'ST 5%（优先于代码分档）')
  assert.equal(limitUpPct('300999', '*ST 创业'), 0.05, 'ST 优先级高于创业板 20%')
  assert.equal(limitUpPct('SH600519'), 0.1, '带市场前缀也能取到 6 位数字')
})

test('涨停价：四舍五入到分', () => {
  assert.equal(limitPriceOf(10, '600519'), 11, '10 × 1.1 = 11')
  assert.equal(limitPriceOf(9.99, '600519'), 10.99, '9.99 × 1.1 = 10.989 → 10.99')
  assert.equal(limitPriceOf(10, '300750'), 12, '创业板 20% → 12')
  assert.equal(limitPriceOf(10, '600519', 'ST 股'), 10.5, 'ST → 10.5')
})

test('isLimitUpDay：touch 判定（半分容差），未触及不算', () => {
  assert.equal(isLimitUpDay(10, 11, '600519'), true, '收盘 = 涨停价 → 涨停')
  assert.equal(isLimitUpDay(10, 10.99, '600519'), false, '差一分 → 不算涨停（不能把"接近"当涨停）')
  // 容差 0.005 的实际用途是吸收浮点噪声（真实价格只有两位小数），
  // 例如 9.99×1.1 = 10.989000000000001 → 四舍五入到 10.99 后与收盘价相等。
  assert.equal(isLimitUpDay(9.99, 10.99, '600519'), true, '浮点噪声不应影响封板判定')
  assert.equal(isLimitUpDay(10, 12, '300750'), true, '创业板 20cm')
  assert.equal(isLimitUpDay(10, 11, '830799'), false, '北交 30%：11 不是涨停价（13）')
})

test('isOneWordLimitUp：开盘即涨停价才是一字板', () => {
  assert.equal(isOneWordLimitUp(10, 11, 11, '600519'), true, '开=收=涨停 → 一字板')
  assert.equal(isOneWordLimitUp(10, 10.5, 11, '600519'), false, '低开高走封板 → 不是一字板')
  assert.equal(isOneWordLimitUp(10, undefined, 11, '600519'), false, '缺开盘价 → 判不出（不猜）')
  assert.equal(isOneWordLimitUp(10, 11, 10.9, '600519'), false, '开盘涨停但收盘没封住 → 不是一字板')
})

/** 造一串「每天都涨停」的升序日 K（旧→新）。 */
function limitUpSeries(code: string, days: number, base = 10): CandleLike[] {
  const pct = limitUpPct(code)
  const rows: CandleLike[] = [{ date: '2026-01-01', close: base }]
  let close = base
  for (let d = 1; d <= days; d += 1) {
    close = Math.round(close * (1 + pct) * 100) / 100
    rows.push({ date: `2026-01-${String(d + 1).padStart(2, '0')}`, open: close, close })
  }
  return rows
}

test('countStreak：连板数、日期升序、一字板标记', () => {
  const rows = limitUpSeries('600519', 3)
  const r = countStreak(rows, '600519')
  assert.equal(r.streak, 3, '3 连板')
  assert.equal(r.dates.length, 3, '日期数 = 连板数')
  assert.deepEqual([...r.dates], [...r.dates].sort(), '日期为升序（旧→新）')
  assert.equal(r.dates[r.dates.length - 1], '2026-01-04', '最后一个是当日')
  assert.equal(r.oneWord, true, '每天开=收=涨停 → 一字板')
  assert.equal(typeof r.limitPrice, 'number', '给出涨停价')
})

test('countStreak：最新一根未涨停 → 连板 0（不给"昨天的板"充数）', () => {
  const rows = limitUpSeries('600519', 2)
  rows.push({ date: '2026-01-05', open: 12.2, close: 12.0 }) // 开板
  const r = countStreak(rows, '600519')
  assert.equal(r.streak, 0)
  assert.deepEqual(r.dates, [])
})

test('countStreak：数据不足与容错', () => {
  assert.equal(countStreak([], '600519').streak, 0, '空数组')
  assert.equal(countStreak([{ close: 10 }], '600519').streak, 0, '仅一根 → 无法判定')
  const rows = limitUpSeries('300750', 2) // 20cm
  assert.equal(countStreak(rows, '300750').streak, 2, '创业板 20cm 连板同样成立')
})
