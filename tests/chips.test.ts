/**
 * tests/chips.test.ts —— 筹码分布（成本分布）的单元测试（B4）。
 *
 * 为什么必须锁住它：筹码是**纯数值模型**，错了界面照样画出一张漂亮的分布图 ——
 * 没有任何"看起来不对"的提示。这里锁三类**不变量**（与具体数据无关，任何输入都必须成立）：
 *   1. 形状：档位价格升序、权重全正、`bins` 不含空档；
 *   2. 口径：获利比例 ∈ [0,100]、`costLow ≤ avgCost ≤ costHigh`、现价回填一致；
 *   3. 窗口：累计换手 300% 截断（`windowComplete`），历史不足时窗口 = 可用日数。
 * 以及一条**降级契约**：逐笔覆盖度 <5% 必须退回 L0（不许拿 1% 的逐笔去"修形状"）。
 *
 * 另有一条 B4 单测确定的边界：`limit`/窗口类入参越界时不得静默产出 NaN。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  CHIPS_MAX_CUM_TURNOVER,
  CHIPS_TICK_MIN_COVERAGE,
  computeChipsFromRows,
  computeChipsWithTicks,
  dayTurnover,
  type ChipsResult,
} from '../src/lib/chips.ts'
import type { KlineRow } from '../src/lib/api.ts'
import type { TransactionRow } from '../src/lib/stock-data.ts'

/** 单根日K（筹码只用 OHLC/volume/turnover）。 */
function k(open: number, high: number, low: number, close: number, volume = 1_000_000, turnover = 1): KlineRow {
  return { date: '2026-01-01', open, high, low, close, volume, turnover } as KlineRow
}

/** 生成 n 根"温和波动"日K：绕 base 正弦摆动，换手给定。 */
function series(n: number, base = 10, turnover = 1, volume = 1_000_000): KlineRow[] {
  const rows: KlineRow[] = []
  for (let i = 0; i < n; i++) {
    const mid = base + Math.sin(i / 4) * 0.6
    rows.push(k(mid - 0.2, mid + 0.3, mid - 0.3, mid + 0.1, volume, turnover))
  }
  return rows
}

/** 对任意结果都必须成立的不变量（集中一处，避免每个用例各写一遍漏掉）。 */
function assertInvariants(r: ChipsResult, label: string) {
  assert.ok(r.bins.length > 0, `${label}：至少一档`)
  for (let i = 1; i < r.bins.length; i++) {
    assert.ok(r.bins[i].price > r.bins[i - 1].price, `${label}：档位价格严格升序（第 ${i} 档）`)
  }
  for (const b of r.bins) assert.ok(b.weight > 0, `${label}：权重均为正（price=${b.price}）`)
  const s = r.stats
  assert.ok(Number.isFinite(s.profitPct) && s.profitPct >= 0 && s.profitPct <= 100, `${label}：获利比例 ∈ [0,100]（${s.profitPct}）`)
  assert.ok(Number.isFinite(s.avgCost) && s.avgCost > 0, `${label}：平均成本为正（${s.avgCost}）`)
  assert.ok(s.costLow <= s.costHigh, `${label}：成本下沿 ≤ 上沿（${s.costLow} / ${s.costHigh}）`)
  assert.ok(s.avgCost >= s.costLow - 1e-9 && s.avgCost <= s.costHigh + 1e-9, `${label}：平均成本落在成本区间内（${s.avgCost} ∈ [${s.costLow}, ${s.costHigh}]）`)
  assert.ok(s.concentration >= 0 && Number.isFinite(s.concentration), `${label}：集中度非负有限（${s.concentration}）`)
  assert.ok(r.windowDays >= 1 && r.windowDays <= 400, `${label}：窗口日数合理（${r.windowDays}）`)
  assert.ok(r.cumTurnover >= 0 && r.cumTurnover <= CHIPS_MAX_CUM_TURNOVER + 1e-9, `${label}：累计换手 ≤ 300%（${r.cumTurnover}）`)
  assert.ok(Number.isFinite(r.currentPrice) && r.currentPrice > 0, `${label}：现价锚为正（${r.currentPrice}）`)
}

test('dayTurnover：优先用日K turnover(%)，缺失回退 volume/float_shares，且都封顶 100%', () => {
  assert.equal(dayTurnover(k(10, 10, 10, 10, 1e6, 25)), 0.25, 'turnover 是百分数 → 25% = 0.25')
  assert.equal(dayTurnover(k(10, 10, 10, 10, 1e6, 250)), 1, '单日换手 >100% 视为满换手（封顶）')
  // turnover 缺失 → volume / float_shares
  const fallback = { date: 'd', open: 10, high: 10, low: 10, close: 10, volume: 2000, float_shares: 10000 } as KlineRow
  assert.equal(dayTurnover(fallback), 0.2, '2000 / 10000 = 0.2')
  // 两者都没有 → NaN（调用方必须自己决定怎么处理，不得当成 0 换手）
  assert.ok(Number.isNaN(dayTurnover({ date: 'd', open: 10, high: 10, low: 10, close: 10 } as KlineRow)), '无换手信息 → NaN')
})

test('★ 不变量：任何正常输入下形状/口径都成立（60 日日K）', () => {
  const rows = series(60)
  for (const price of [9.5, 10.1, 10.6, 20]) {
    assertInvariants(computeChipsFromRows(rows, rows.length - 1, price), `现价 ${price}`)
  }
})

test('★ 窗口契约：累计换手达 300% 截断（windowComplete=true），不足则用满历史', () => {
  const fast = series(120, 10, 6) // 每日 6% → 50 日即 300%
  const rFast = computeChipsFromRows(fast, fast.length - 1, 10.1)
  assert.equal(rFast.windowComplete, true, '够 300% → 标记已完成')
  assert.ok(rFast.cumTurnover >= CHIPS_MAX_CUM_TURNOVER, `累计换手已达到上限（${rFast.cumTurnover}）`)
  assert.ok(rFast.windowDays < 120, `窗口被截断（只用了 ${rFast.windowDays} 日）`)
  assertInvariants(rFast, '快速换手')

  const slow = series(60, 10, 1) // 每日 1% → 60 日仅 60%
  const rSlow = computeChipsFromRows(slow, slow.length - 1, 10.1)
  assert.equal(rSlow.windowComplete, false, '历史不足 300% → 未完成（只影响微尾）')
  assert.equal(rSlow.windowDays, 60, '用满全部可用历史')
  assert.ok(Math.abs(rSlow.cumTurnover - 0.6) < 1e-9, `累计换手 = 60 日 × 1%（实际 ${rSlow.cumTurnover}）`)
})

test('endIndex 生效：只看截断点之前的历史（复盘"当时"的筹码）', () => {
  const rows = series(80)
  const full = computeChipsFromRows(rows, rows.length - 1, 10.1)
  const half = computeChipsFromRows(rows, 39, 10.1)
  assert.ok(half.windowDays <= 40, `endIndex=39 → 最多 40 日（实际 ${half.windowDays}）`)
  assert.notEqual(half.windowDays, full.windowDays, '截断点不同 → 窗口不同')
  assertInvariants(half, 'endIndex=39')
  // 越界 endIndex 必须被夹到合法范围，而不是抛异常/产出 NaN
  assertInvariants(computeChipsFromRows(rows, 9999, 10.1), 'endIndex 越界(大)')
  assertInvariants(computeChipsFromRows(rows, -5, 10.1), 'endIndex 越界(小)')
})

test('一字板（high===low）：退化为单档，获利比例 100%、集中度 0', () => {
  // 全部交易日都是一字（且价格相同）→ 有效区间退化，走兜底区间 + 每日单档
  const rows = [k(10, 10, 10, 10, 1e6, 5), k(10, 10, 10, 10, 1e6, 5), k(10, 10, 10, 10, 1e6, 5)]
  const r = computeChipsFromRows(rows, rows.length - 1, 10)
  assertInvariants(r, '一字板')
  assert.equal(r.bins.length, 1, `全部筹码压在单档（实际 ${r.bins.length}）`)
  assert.equal(r.stats.profitPct, 100, '现价 = 唯一成本档 → 全部获利')
  assert.equal(r.stats.concentration, 0, '区间宽度 0 → 集中度 0')
  assert.equal(r.stats.costLow, r.stats.costHigh, '成本上下沿重合')
})

test('混合序列：一字板日只贡献一档，普通日贡献一段区间（不会互相污染）', () => {
  const rows = [k(10, 10.5, 9.9, 10.2, 1e6, 5), k(10.2, 10.2, 10.2, 10.2, 1e6, 5)]
  const r = computeChipsFromRows(rows, 1, 10.2)
  assertInvariants(r, '混合序列')
  assert.ok(r.bins.length > 2, `普通日把区间撑开（实际 ${r.bins.length} 档）`)
})

test('★ 降级契约：逐笔不足或覆盖度 <5% → 退回 L0（mode=dayk）', () => {
  const rows = series(40)
  const price = 10.1
  const L0 = computeChipsFromRows(rows, rows.length - 1, price)

  // 逐笔太少（<50 笔）→ 直接 L0
  const few = Array.from({ length: 10 }, () => ({ time: '10:00', price, vol: 1000 } as unknown as TransactionRow))
  assert.equal(computeChipsWithTicks(rows, rows.length - 1, few, price).mode, 'dayk', '逐笔 <50 笔 → L0')

  // 逐笔够多但覆盖度只有 1%（当日量 100 万股，逐笔合计 1 万股）
  const tiny = Array.from({ length: 100 }, () => ({ time: '10:00', price, vol: 100 } as unknown as TransactionRow))
  const rTiny = computeChipsWithTicks(rows, rows.length - 1, tiny, price)
  assert.equal(rTiny.mode, 'dayk', '覆盖度 1% < 5% → 不升级（不夸大精度）')
  assert.equal(rTiny.coverage, 0, '退回 L0 时 coverage 归 0（口径：本结果不含逐笔）')
  assert.equal(rTiny.bins.length, L0.bins.length, '与 L0 形状一致')

  // 覆盖度 ≥5% → 升级 tick
  const enough = Array.from({ length: 100 }, () => ({ time: '10:00', price, vol: 10_000 } as unknown as TransactionRow))
  const rTick = computeChipsWithTicks(rows, rows.length - 1, enough, price)
  assert.equal(rTick.mode, 'tick', `覆盖度 ${rTick.coverage} ≥ ${CHIPS_TICK_MIN_COVERAGE} → 升级 tick`)
  assert.ok(rTick.coverage >= CHIPS_TICK_MIN_COVERAGE, `coverage 如实上报（${rTick.coverage}）`)
  assertInvariants(rTick, 'tick 模式')
})

test('★ 覆盖度边界：恰好 5% 升级、略低则退回（阈值是可配常量而非魔法数）', () => {
  assert.equal(CHIPS_TICK_MIN_COVERAGE, 0.05)
  const rows = series(40)
  const price = 10.1
  const dayVol = 1_000_000 // series() 的 volume
  const mk = (total: number) =>
    Array.from({ length: 100 }, () => ({ time: '10:00', price, vol: total / 100 } as unknown as TransactionRow))
  assert.equal(computeChipsWithTicks(rows, rows.length - 1, mk(dayVol * 0.049), price).mode, 'dayk', '4.9% → L0')
  assert.equal(computeChipsWithTicks(rows, rows.length - 1, mk(dayVol * 0.05), price).mode, 'tick', '5.0% → tick')
})

test('无有效日K → 抛错（不得返回空图让人以为"筹码很少"）', () => {
  assert.throws(() => computeChipsFromRows([], 0, 10), /日K数据不足以计算筹码/)
  // OHLC 缺失（NaN）的日K不参与，全部无效 → 同样抛错
  const bad = [{ date: 'd', open: NaN, high: NaN, low: NaN, close: NaN, volume: 1e6, turnover: 1 } as KlineRow]
  assert.throws(() => computeChipsFromRows(bad, 0, 10), /日K数据不足以计算筹码/)
})

test('成本区间宽度与集中度方向一致（分布越散 → 集中度越大）', () => {
  const tight = Array.from({ length: 30 }, () => k(10, 10.05, 9.95, 10, 1e6, 5)) // 极窄区间
  const wide = Array.from({ length: 30 }, (_, i) => k(10, 10 + i * 0.5, 10 - i * 0.5, 10, 1e6, 5)) // 越走越宽
  const rt = computeChipsFromRows(tight, tight.length - 1, 10)
  const rw = computeChipsFromRows(wide, wide.length - 1, 10)
  assert.ok(rw.stats.concentration > rt.stats.concentration, `宽分布集中度更大（${rw.stats.concentration} > ${rt.stats.concentration}）`)
  assert.ok(rw.stats.costHigh - rw.stats.costLow > rt.stats.costHigh - rt.stats.costLow, '90% 成本区间更宽')
})
