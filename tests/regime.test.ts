/**
 * tests/regime.test.ts —— 情绪温度计的单元测试（B4）。
 *
 * 为什么必须锁住它：温度计是方法论里的**仓位总闸**（`BAND_CAP` 直接决定总仓上限），
 * 而它的输入里有几条"强制规则"（退潮/分歧压温、高位缩量过热）：
 * 这些规则一旦被后来的重构改掉，界面上的数字仍然"看起来正常"，但闸门已经错了。
 * 单元测试在这里的作用是**把规则写成可执行的契约**。
 *
 * 运行：`node scripts/unit.test.mjs`（用 node:test，无测试框架依赖）。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { BAND_CAP, bandLabel, computeRegime, type RegimeInputs } from '../src/lib/regime.ts'

/** 中性基准输入（各字段都给"不高不低"的值），便于只改一项做对照。 */
const BASE: RegimeInputs = {
  limitUp: 40,
  limitDown: 5,
  maxStreak: 3,
  promoteRate: 0.4,
  brokenRate: 0.3,
  firstBoardPremium: 1,
  upRatio: 0.5,
  amountYi: 9000,
  amountYiPct: 0.5,
}

test('BAND_CAP：仓位总闸档位是契约（方法论 §6.2）', () => {
  assert.equal(BAND_CAP.ice, 0.2, '冰点 ≤2 成')
  assert.equal(BAND_CAP.cold, 0.3, '低温 ≤3 成')
  assert.equal(BAND_CAP.warm, 0.6, '常温 3-6 成')
  assert.equal(BAND_CAP.hot, 0.6, '高温 6 成封顶')
  assert.equal(BAND_CAP.overheat, 0.3, '过热只减不加 → 0.3')
})

test('温度落在 0–100 且带档位与 ≤3 条 drivers', () => {
  const r = computeRegime(BASE)
  assert.ok(r.temperature >= 0 && r.temperature <= 100, `温度在区间内（${r.temperature}）`)
  assert.ok(['ice', 'cold', 'warm', 'hot', 'overheat'].includes(r.band), `档位合法（${r.band}）`)
  assert.ok(r.drivers.length <= 3, `drivers ≤3（实际 ${r.drivers.length}）`)
  assert.equal(new Set(r.drivers).size, r.drivers.length, 'drivers 已去重')
})

test('★ 强制规则：晋级率 <25% 或 炸板率 >50% → 温度被压到 ≤45（退潮/分歧）', () => {
  const bust: RegimeInputs = { ...BASE, limitUp: 90, maxStreak: 6, promoteRate: 0.1, brokenRate: 0.1, upRatio: 0.8 }
  const r1 = computeRegime(bust)
  assert.ok(r1.temperature <= 45, `晋级率 10% → 温度 ≤45（实际 ${r1.temperature}）`)
  assert.ok(r1.drivers.includes('晋级率<25%'), `drivers 点名原因（${r1.drivers.join('/')}）`)

  const broken: RegimeInputs = { ...BASE, limitUp: 90, maxStreak: 6, promoteRate: 0.6, brokenRate: 0.8, upRatio: 0.8 }
  const r2 = computeRegime(broken)
  assert.ok(r2.temperature <= 45, `炸板率 80% → 温度 ≤45（实际 ${r2.temperature}）`)
  // drivers 必须点名**具体**原因，而不是只给泛化结论（否则用户不知道看什么）
  assert.ok(r2.drivers.includes('炸板率>50%'), `drivers 点名炸板（${r2.drivers.join('/')}）`)
  assert.ok(r2.drivers.length <= 3, `drivers 仍 ≤3（${r2.drivers.join('/')}）`)
})

test('★ 过热：高位（≥5 板）+ 广度好 + 缩量 → 强制 overheat 档', () => {
  const r = computeRegime({ ...BASE, maxStreak: 5, upRatio: 0.8, amountYiPct: 0.1 })
  assert.equal(r.band, 'overheat', `高位缩量 → ${r.band}`)
  assert.ok(r.drivers.includes('高位缩量加速'), `drivers 说明过热原因（${r.drivers.join('/')}）`)
})

test('空数据（全 0 输入）不会因为「炸板率 0」被算成热：档位仍是低档', () => {
  // 这条是**行为记录**：公式里「炸板率低」会加分（(100-broken)*0.15），
  // 所以全 0 输入的温度不是 0 —— 界面上必须靠"无数据"提示兜住，不能指望公式。
  const r = computeRegime({
    limitUp: 0, limitDown: 0, maxStreak: 0, promoteRate: 0,
    brokenRate: 0, firstBoardPremium: 0, upRatio: 0, amountYi: 0, amountYiPct: 0,
  })
  assert.ok(r.temperature > 0, `全 0 输入温度 >0（实际 ${r.temperature}）—— 空数据需 UI 侧判空`)
  assert.ok(['ice', 'cold'].includes(r.band), `仍落在低档（${r.band}）`)
})

test('方向性：热度上升时温度单调不减（同口径对照）', () => {
  const cold = computeRegime({ ...BASE, limitUp: 10, maxStreak: 1, promoteRate: 0.2, upRatio: 0.3, amountYiPct: 0.2 })
  const warm = computeRegime(BASE)
  const hot = computeRegime({ ...BASE, limitUp: 100, maxStreak: 6, promoteRate: 0.6, upRatio: 0.75, amountYiPct: 0.9 })
  assert.ok(cold.temperature <= warm.temperature, `低温 ≤ 中温（${cold.temperature} ≤ ${warm.temperature}）`)
  assert.ok(warm.temperature <= hot.temperature, `中温 ≤ 高温（${warm.temperature} ≤ ${hot.temperature}）`)
})

test('bandLabel 覆盖全部档位（界面文案不出现英文枚举）', () => {
  for (const b of ['ice', 'cold', 'warm', 'hot', 'overheat'] as const) {
    const label = bandLabel(b)
    assert.ok(label.length > 0 && !label.includes(b), `${b} → ${label}`)
  }
})
