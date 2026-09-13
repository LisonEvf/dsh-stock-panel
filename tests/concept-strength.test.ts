/**
 * tests/concept-strength.test.ts —— 自挖类「强度」口径的单元测试。
 *
 * 为什么值得测：这个口径同时喂**排序**与**显示**（`ConceptClassesCard`），
 * 而它错起来完全静默 —— 排序还能排、数字还在显示，只是"排在前面的涨幅更低"或
 * "涨停数永远 0"。更麻烦的是它决定"哪个班最猛"，直接影响盯盘注意力。
 *
 * 本文件钉三类东西：
 *   ① 涨停判定必须是 `buy_price_limit` 精确法（阈值法/兜底会把新股算成涨停）；
 *   ② 缺失值不按 0 处理（停牌被当成平盘 = 强度虚低，最难发现）；
 *   ③ 强度公式与并列顺序是**契约**（改权重必须同时改这里）。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  STRENGTH_LIMIT_UP_WEIGHT,
  aggregateConcept,
  compareByStrength,
  isLimitUpClose,
  marketTagOf,
  memberStatsOf,
  strengthFormulaText,
  type ConceptMemberStat,
} from '../src/lib/concept-strength.ts'

function m(code: string, chgPct: number | null, limitUp = false): ConceptMemberStat {
  return { market: 'SZ', code, name: code, chgPct, limitUp }
}

// ─────────────────────────── ① 涨停判定 ───────────────────────────

test('★ 涨停 = 收盘触及涨停价（精确法），且只在涨停价有效时成立', () => {
  assert.equal(isLimitUpClose(27.92, 27.92), true, '收盘 = 涨停价 → 涨停')
  assert.equal(isLimitUpClose(27.9199, 27.92), true, '半个 tick 内的浮点误差也算涨停（价来自 TDX float32）')
  assert.equal(isLimitUpClose(27.91, 27.92), false, '差一个 tick（未封板）→ 不是涨停')
  assert.equal(isLimitUpClose(20.0, 18.0), false, '超过涨停价也不该算（数据异常时宁可不认）')
})

test('★ 无涨跌幅限制的票（buy_price_limit=0）不得算涨停 —— 不做阈值兜底', () => {
  // 实测：上市首日的票涨停价字段是 0，而它当天可能涨 180%。
  // 若用"涨幅 ≥9.8%"兜底，就会凭空造出一个"最强班"。
  assert.equal(isLimitUpClose(397.0, 0), false, '涨停价为 0 → 不计入涨停')
  assert.equal(isLimitUpClose(397.0, undefined), false, '字段缺失 → 不计入')
  assert.equal(isLimitUpClose(null, 27.92), false, '收盘缺失 → 不计入')
  assert.equal(isLimitUpClose(NaN, NaN), false, 'NaN 不得被当作相等')
})

// ─────────────────────────── ② 聚合 ───────────────────────────

test('★ 均涨幅 / 最大涨幅 / 上涨数 / 涨停数 / 强度分', () => {
  const agg = aggregateConcept([m('a', 10, true), m('b', 6), m('c', -2)])
  assert.equal(agg.n, 3)
  assert.equal(agg.knownN, 3)
  assert.equal(agg.chgMean, (10 + 6 - 2) / 3, '均涨幅 = 成员均值（保留原值，取整交给展示层）')
  assert.equal(agg.chgMax, 10)
  assert.equal(agg.upN, 2, '上涨只数（含涨停）')
  assert.equal(agg.limitUpN, 1)
  assert.equal(agg.strength, (10 + 6 - 2) / 3 + STRENGTH_LIMIT_UP_WEIGHT * 1, '强度 = 均涨幅 + 6×涨停数')
})

test('★ 缺失值不按 0 处理：只算有行情的成员，并如实上报已知只数', () => {
  const agg = aggregateConcept([m('a', 8, true), m('b', null), m('c', null)])
  assert.equal(agg.n, 3, '规模仍是 3')
  assert.equal(agg.knownN, 1, '只有 1 只有当日行情（界面必须标注"仅 1/3 只算过"）')
  assert.equal(agg.chgMean, 8, '均值只按有行情的算（把停牌当 0 会把强度压下去）')
  assert.equal(agg.limitUpN, 1)
  assert.equal(agg.strength, 8 + STRENGTH_LIMIT_UP_WEIGHT)
})

test('整类都没有当日行情 → 均涨幅为 null，但仍按涨停数给强度（不留 null 排序键）', () => {
  const agg = aggregateConcept([m('a', null), m('b', null)])
  assert.equal(agg.chgMean, null)
  assert.equal(agg.chgMax, null)
  assert.equal(agg.knownN, 0)
  assert.equal(agg.strength, 0)
  assert.equal(aggregateConcept([]).strength, 0, '空类不得抛异常')
})

test('★ 强度分是与用户约定好的公式（权重改动必须同时改这里）', () => {
  assert.equal(STRENGTH_LIMIT_UP_WEIGHT, 6, '每只涨停按 6 个点折算（改它 = 改排序语义）')
  assert.ok(strengthFormulaText().includes('6×涨停数'), '界面 tooltip 与公式同源')
  // 每只涨停是在**均涨幅之外**再加 6 个点：2 只票「1 只涨停(+10%) + 1 只平」= 5 + 6 = 11
  const oneBoard = aggregateConcept([m('a', 10, true), m('b', 0)])
  assert.equal(oneBoard.strength, 11)
  // 1 个板（11）排在「全员 +7%」（7）之前
  assert.ok(oneBoard.strength > aggregateConcept([m('a', 7), m('b', 7)]).strength, '一个板强于普涨 7%')
  // 但普涨大阳线（12）能反超它 —— 权重不是"涨停压倒一切"
  assert.ok(aggregateConcept([m('a', 12), m('b', 12)]).strength > oneBoard.strength, '普涨 12% 反超单个板')
  // 两个板本身就是当日最强的形态
  const twoBoards = aggregateConcept([m('a', 10, true), m('b', 10, true)])
  assert.ok(twoBoards.strength > aggregateConcept([m('a', 5), m('b', 5)]).strength, '两个板强于普涨 5%')
})

// ─────────────────────────── ③ 排序 ───────────────────────────

test('★ 强度降序；并列时看结构（强边密度 → 类内相关 → 规模 → classId）', () => {
  const rows = [
    { classId: 1, strength: 5, strongDensity: 0.5, intraCorr: 0.7, size: 3 },
    { classId: 2, strength: 9, strongDensity: 0.2, intraCorr: 0.6, size: 9 },
    { classId: 3, strength: 5, strongDensity: 1.0, intraCorr: 0.65, size: 2 },
    { classId: 4, strength: 5, strongDensity: 0.5, intraCorr: 0.7, size: 8 },
  ]
  const sorted = [...rows].sort(compareByStrength).map((r) => r.classId)
  assert.deepEqual(sorted, [2, 3, 4, 1], '强度优先；同强度先看强边密度，再看规模')
})

test('排序是稳定的：完全同口径时按 classId 升序（不随输入顺序抖）', () => {
  const a = { classId: 7, strength: 3, strongDensity: 1, intraCorr: 0.5, size: 2 }
  const b = { classId: 5, strength: 3, strongDensity: 1, intraCorr: 0.5, size: 2 }
  assert.deepEqual([a, b].sort(compareByStrength).map((x) => x.classId), [5, 7])
  assert.deepEqual([b, a].sort(compareByStrength).map((x) => x.classId), [5, 7])
})

// ─────────────────────── ④ 成员事实装配（引擎行 + 快照行情） ───────────────────────

test('★ 引擎成员行 + 全A快照 → 成员事实（市场码归一是两套编码的接缝）', () => {
  const rows = [
    { market: 0, code: '300308', name: '中际旭创', chg_pct: 4.03, mean_corr_to_class: 0.7 },
    { market: 1, code: '600519', name: '贵州茅台', chg_pct: -1.2, mean_corr_to_class: 0.66 },
    { market: 2, code: '920268', name: '百迈科', chg_pct: 18.75, mean_corr_to_class: null },
  ]
  // 快照行情：300308 封板（收盘 = 涨停价）；600519 未封；920268 没有涨停价字段（新股）
  const quotes: Record<string, Record<string, unknown>> = {
    '300308': { close: 27.92, buy_price_limit: 27.92 },
    '600519': { close: 1400, buy_price_limit: 1540 },
  }
  const stats = memberStatsOf(rows, (code) => quotes[code])
  assert.deepEqual(
    stats.map((s) => s.market),
    ['SZ', 'SH', 'BJ'],
    '引擎的 0/1/2 必须归一成 SZ/SH/BJ（错一个就会显示错市场、点开错票）',
  )
  assert.equal(stats[0].limitUp, true, '收盘 = 涨停价 → 涨停')
  assert.equal(stats[1].limitUp, false, '未封板')
  assert.equal(stats[2].limitUp, false, '没有涨停价字段（新股）→ 不计涨停')
  assert.equal(stats[0].corr, 0.7)
  assert.equal(stats[2].corr, null, '相关度缺失如实留空（不当 0）')
  assert.equal(stats[1].chgPct, -1.2, '跌幅如实保留（不做绝对值）')
})

test('装配成员事实：坏行/缺字段不得打断整类（工具输出不保证）', () => {
  const rows = [
    { market: 0, code: '', name: '没有代码的行' },
    null as unknown as Record<string, unknown>,
    { market: 0, code: '000001', name: '', chg_pct: 'abc' },
  ]
  const stats = memberStatsOf(rows, () => undefined)
  assert.equal(stats.length, 1, '没有代码的行被丢掉')
  assert.equal(stats[0].name, '000001', '名称缺失回退成代码（不显示空白）')
  assert.equal(stats[0].chgPct, null, '涨跌幅非数字 → null（不当成 0）')
})

test('市场码归一：认不出来的一律 SZ（不猜别的市场）', () => {
  assert.equal(marketTagOf(0), 'SZ')
  assert.equal(marketTagOf(1), 'SH')
  assert.equal(marketTagOf(2), 'BJ')
  assert.equal(marketTagOf('sh'), 'SH', '字符串编码也认（大小写不敏感）')
  assert.equal(marketTagOf(9), 'SZ')
  assert.equal(marketTagOf(undefined), 'SZ')
})
