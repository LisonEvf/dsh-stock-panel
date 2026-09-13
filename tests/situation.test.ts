/**
 * tests/situation.test.ts —— 局势归类（Q2）的单元测试（B4）。
 *
 * 为什么必须锁住它：`judgeSituation` 的输出直接写进决策条（「退潮：空仓优先」这类
 * 行动指令），而它是**优先级瀑布**——把 `recession` 判成 `weightLift` 不会报错，
 * 只会让人在最该空仓的一天继续做多。因此这里的核心不是"每个分支能命中"，
 * 而是"**冲突时谁赢**"。
 *
 * 另有一条行为契约：局势归类**不看温度档位**（`input.regime` 不参与判定），
 * 温度计只负责仓位闸门。这条以前是"解构了却没用"的误导性代码，现已清除并锁死。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { judgeSituation, situationColor, situationLabel, type Situation, type SituationInput } from '../src/lib/situation.ts'
import { computeRegime, type Regime } from '../src/lib/regime.ts'
import type { EventItem } from '../src/lib/event-stream.ts'
import type { BoardPulse } from '../src/lib/board-pulse.ts'

/** 真实温度对象（判定不应依赖它，但类型上要求给一个）。 */
function regime(temperature: number): Regime {
  const r = computeRegime({
    limitUp: temperature,
    limitDown: 0,
    maxStreak: 1,
    promoteRate: 1,
    brokenRate: 0,
    firstBoardPremium: 1,
    upRatio: 0.5,
    amountYi: 5000,
    amountYiPct: 0.5,
  })
  return r
}

function event(kind: EventItem['kind'], name = '某票'): EventItem {
  return { key: `${name}-${kind}`, ts: 0, market: 'SH', code: '600000', name, desc: kind, kind, time: '10:00:00', value: '' }
}

function pulse(deltaLimitUp: number): BoardPulse {
  return {
    board: '881001',
    boardSymbol: '881001',
    name: '某板块',
    limitUp: 3,
    avgPct: 2,
    amountShare: 0.05,
    deltaLimitUp,
    deltaAvgPct: 1,
    leader: null,
  }
}

/** 中性基准：既不退潮、也不切换、也不新方向。 */
function input(patch: Partial<SituationInput> = {}): SituationInput {
  return {
    regime: regime(50),
    events: [],
    pulses: [],
    oldLeaderAtLimit: true,
    oldLeaderBroken: false,
    highStreakCount: 2,
    lowNewLimitUp: 0,
    indexPct: 0,
    upRatio: 0.5,
    limitDown: 0,
    promoteRate: 0.5,
    brokenRate: 0.2,
    limitUp: 40,
    ...patch,
  }
}

test('中性输入 → normal（基准本身不能误判）', () => {
  assert.equal(judgeSituation(input()), 'normal')
})

test('★ 退潮优先级最高：同时满足高低切/新方向条件时仍判退潮', () => {
  const s = judgeSituation(
    input({
      limitDown: 20,
      promoteRate: 0.1,
      brokenRate: 0.8,
      // 下面这些同时成立会命中 highLowSwitch / newDirection，必须被 recession 压住
      oldLeaderBroken: true,
      lowNewLimitUp: 8,
      indexPct: 0.2,
      events: [event('surge', 'A'), event('surge', 'B'), event('surge', 'C')],
    }),
  )
  assert.equal(s, 'recession')
})

test('退潮三个条件必须同时满足（缺一个就不算退潮）', () => {
  assert.notEqual(judgeSituation(input({ limitDown: 20, promoteRate: 0.1, brokenRate: 0.2 })), 'recession', '炸板率不飙升')
  assert.notEqual(judgeSituation(input({ limitDown: 3, promoteRate: 0.1, brokenRate: 0.8 })), 'recession', '跌停不够多')
  assert.notEqual(judgeSituation(input({ limitDown: 20, promoteRate: 0.5, brokenRate: 0.8 })), 'recession', '晋级率没骤降')
  // 边界：跌停恰好 10 / 晋级率恰好 0.25 都不触发（严格比较）
  assert.notEqual(judgeSituation(input({ limitDown: 10, promoteRate: 0.25, brokenRate: 0.51 })), 'recession', '边界取不到')
})

test('高低切：老龙头断板 + 低位批量涨停 + 指数平稳', () => {
  assert.equal(judgeSituation(input({ oldLeaderBroken: true, lowNewLimitUp: 3, indexPct: 0.5 })), 'highLowSwitch')
  assert.notEqual(judgeSituation(input({ oldLeaderBroken: true, lowNewLimitUp: 2, indexPct: 0.5 })), 'highLowSwitch', '低位只 2 只不够批量')
  assert.notEqual(judgeSituation(input({ oldLeaderBroken: true, lowNewLimitUp: 5, indexPct: 2 })), 'highLowSwitch', '指数已不平稳（|pct|≥1）')
  assert.notEqual(judgeSituation(input({ oldLeaderBroken: false, lowNewLimitUp: 5, indexPct: 0.2 })), 'highLowSwitch', '龙头没断板')
})

test('新方向：陌生板块集体拉升（surge≥3）且无昨日主线脉冲', () => {
  const surge3 = [event('surge', 'A'), event('surge', 'B'), event('surge', 'C')]
  assert.equal(judgeSituation(input({ events: surge3 })), 'newDirection')
  assert.notEqual(judgeSituation(input({ events: [event('surge', 'A'), event('surge', 'B')] })), 'newDirection', '只 2 条 surge 不够')
  assert.notEqual(judgeSituation(input({ events: surge3, pulses: [pulse(1)] })), 'newDirection', '有主线脉冲 → 不是"陌生"方向')
  // 事件类型不匹配（涨停/大单）不算新方向
  assert.notEqual(judgeSituation(input({ events: [event('limitUp', 'A'), event('limitUp', 'B'), event('bigOrder', 'C')] })), 'newDirection')
})

test('权重行情：指数涨但涨停少、广度差', () => {
  assert.equal(judgeSituation(input({ indexPct: 1.2, limitUp: 10, upRatio: 0.3 })), 'weightLift')
  assert.notEqual(judgeSituation(input({ indexPct: 1.2, limitUp: 30, upRatio: 0.3 })), 'weightLift', '涨停不少 → 不算赚指数')
  assert.notEqual(judgeSituation(input({ indexPct: -1.2, limitUp: 10, upRatio: 0.3 })), 'weightLift', '指数在跌')
  assert.notEqual(judgeSituation(input({ indexPct: 1.2, limitUp: 10, upRatio: 0.6 })), 'weightLift', '广度不差')
})

test('主线内分歧：龙头没封住但板块涨停数仍在增', () => {
  assert.equal(judgeSituation(input({ oldLeaderAtLimit: false, pulses: [pulse(1)] })), 'innerDivergence')
  assert.notEqual(judgeSituation(input({ oldLeaderAtLimit: true, pulses: [pulse(2)] })), 'innerDivergence', '龙头仍封板')
  assert.notEqual(judgeSituation(input({ oldLeaderAtLimit: false, pulses: [pulse(0)] })), 'innerDivergence', '板块涨停数没增')
  assert.notEqual(judgeSituation(input({ oldLeaderAtLimit: false, pulses: [pulse(-1)] })), 'innerDivergence', '板块在缩')
})

test('★ 行为契约：局势归类不看温度档位（同一观察量、不同温度 → 同一局势）', () => {
  const obs = { limitDown: 20, promoteRate: 0.1, brokenRate: 0.8 }
  const cold = judgeSituation(input({ ...obs, regime: regime(1) }))
  const hot = judgeSituation(input({ ...obs, regime: regime(100) }))
  assert.equal(cold, hot, `温度不参与判定（${cold} / ${hot}）`)
  assert.equal(cold, 'recession')
})

test('标签与颜色覆盖全部局势（不出现英文枚举）', () => {
  const all: Situation[] = ['recession', 'highLowSwitch', 'newDirection', 'weightLift', 'innerDivergence', 'normal']
  for (const s of all) {
    const label = situationLabel(s)
    assert.ok(label.length > 0 && !label.includes(s), `${s} → ${label}`)
    // B2 令牌收口：颜色由字面量 hex 改为**语义 token**（`var(--dc-up)` 等），
    // 这样明暗主题自动跟随、也不会再出现"两套红"。契约本身不变：每个局势都必须有色。
    assert.match(situationColor(s), /^(#[0-9a-f]{6}|var\(--dc-[a-z-]+\))$/i, `${s} 颜色为语义色`)
  }
  assert.equal(new Set(all.map(situationLabel)).size, all.length, '标签互不相同')
  // A 股语义：退潮=绿（回避），新方向/高低切=红（变化）
  assert.notEqual(situationColor('recession'), situationColor('highLowSwitch'))
})
