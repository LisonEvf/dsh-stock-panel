/**
 * tests/stage.test.ts — 阶段模型的**回归契约**（B2 期间发现并修复的真 bug）。
 *
 * 背景：`currentStage()` 原来把 `phaseFromDate(d)` 的第二个参数 `isTradeDay` 漏了，
 * 而 `phaseFromDate` 在 `isTradeDay` 未传时**一律返回 'closed'** →
 * `stageOf('closed') = 'review'` → **当前阶段恒等于复盘**，
 * 「跨 9:15 自动切作战、跨 15:10 切回复盘」这套时段跟随整个是死的（而且不会报错）。
 *
 * 这组断言把「交易日 × 时刻 → 阶段」钉死，任何人再改 stage/clock 都必须先过这里。
 */
import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { currentStage, stageOf, STAGES } from '../src/lib/stage.ts'

/** 构造本地时间（月份从 0 计）。2026-09-09 是**周三**、09-12 是**周六**。 */
const at = (y: number, mo: number, d: number, h: number, mi: number) => new Date(y, mo - 1, d, h, mi)

test('工作日：时刻 → 阶段（时段跟随的骨架）', () => {
  const wed = (h: number, mi: number) => currentStage(at(2026, 9, 9, h, mi))
  assert.equal(wed(8, 0), 'review', '9:00 前是复盘（写清单时段）')
  assert.equal(wed(9, 20), 'auction', '9:15–9:25 竞价')
  assert.equal(wed(9, 27), 'review', '9:25–9:30 空档暂归复盘')
  assert.equal(wed(10, 0), 'intraday', '★ 盘中（原 bug 会错判成复盘）')
  assert.equal(wed(14, 0), 'intraday', '14:30 前仍是盘中')
  assert.equal(wed(14, 40), 'tail', '★ 14:30 后是尾盘（唯一动作点）')
  assert.equal(wed(15, 5), 'review', '15:00–15:10 收盘后回到复盘')
  assert.equal(wed(20, 0), 'review', '15:10 之后复盘')
})

test('周末：一律复盘（不按盘中误判）', () => {
  const sat = (h: number, mi: number) => currentStage(at(2026, 9, 12, h, mi))
  assert.equal(sat(10, 0), 'review')
  assert.equal(sat(14, 40), 'review')
  assert.equal(sat(20, 0), 'review')
})

test('显式传入交易日（服务端日历时优先用它，能识节假日）', () => {
  // 周三但被标为非交易日（例如国庆假期）→ 复盘
  assert.equal(currentStage(at(2026, 9, 9, 10, 0), false), 'review')
  // 周六但被标为交易日（调休上班）→ 按盘中
  assert.equal(currentStage(at(2026, 9, 12, 10, 0), true), 'intraday')
})

test('stageOf 的分支与 STAGES 元信息一致', () => {
  assert.equal(stageOf('auction', 0), 'auction')
  assert.equal(stageOf('premarket', 0), 'review')
  assert.equal(stageOf('closed', 0), 'review')
  assert.equal(stageOf('review', 0), 'review')
  assert.equal(stageOf('trading', 14 * 60 + 29), 'intraday')
  assert.equal(stageOf('trading', 14 * 60 + 30), 'tail')
  for (const key of ['review', 'auction', 'intraday', 'tail'] as const) {
    const info = STAGES[key]
    assert.equal(info.id, key, `${key} 元信息 id 必须自洽`)
    assert.ok(info.questions.length > 0, `${key} 必须有问题清单`)
    assert.ok(info.output.length > 0, `${key} 必须有唯一输出物`)
  }
})
