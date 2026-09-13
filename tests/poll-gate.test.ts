/**
 * tests/poll-gate.test.ts —— 休市闸门的判据与状态机。
 *
 * 背景（2026-09-12 实测）：周六下午，作战页写着"休市期不发起全量行情请求"，
 * 而行情页同时按 30s 节拍轮询三块（涨停梯队单轮 ≤177 次工具调用）、
 * 监控规则每 12s 轮一次报价 —— 同一份"休市"事实被三处各解释一遍。
 * 判据收口到 `lib/poll-gate.ts` 之后，这里把"什么时候该停、什么时候不该停"钉死。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  POLL_GATE_EXEMPT_KEYS,
  computePollGate,
  isPollAllowed,
  isPollGateExempt,
  notePollSkipped,
  pollGate,
  pollSkippedTicks,
  resetPollGate,
  setPollGate,
  subscribePollGate,
} from '../src/lib/poll-gate'

test('盘中 / 竞价：放行', () => {
  assert.equal(computePollGate({ isTradeDay: true, phase: 'trading' }).allowed, true)
  assert.equal(computePollGate({ isTradeDay: true, phase: 'auction' }).allowed, true)
})

test('非交易日：停（理由要说清是"非交易日"而不是"没数据"）', () => {
  const g = computePollGate({ isTradeDay: false, phase: 'closed' })
  assert.equal(g.allowed, false)
  assert.match(g.reason, /非交易日/)
})

test('交易日盘前/午休/收盘后：停（定盘了就不必每 30s 再问一遍）', () => {
  for (const phase of ['premarket', 'lunch', 'closed', 'review']) {
    const g = computePollGate({ isTradeDay: true, phase })
    assert.equal(g.allowed, false, `${phase} 应停`)
    assert.match(g.reason, new RegExp(phase))
  }
})

test('时钟未知：保守放行（宁可多几次请求，也不要因为拿不到时钟把面板变成死图）', () => {
  const g = computePollGate(null)
  assert.equal(g.allowed, true)
  assert.match(g.reason, /未知/)
})

test('会话时钟自身豁免闸门（否则闸门永远没有重开的依据）', () => {
  assert.ok(POLL_GATE_EXEMPT_KEYS.includes('swr:serverclock'))
  assert.equal(isPollGateExempt('swr:serverclock'), true)
  assert.equal(isPollGateExempt('swr:mkt:allA'), false)
})

test('状态机：变化才通知、退订后不再通知、跳过轮次可累计、开盘自动恢复', () => {
  resetPollGate()
  assert.equal(isPollAllowed(), true, '初始放行（时钟未知）')

  const seen: boolean[] = []
  const stop = subscribePollGate(() => seen.push(isPollAllowed()))

  const closed = computePollGate({ isTradeDay: false, phase: 'closed' })
  setPollGate(closed)
  setPollGate(closed) // 同值：不应重复通知
  assert.equal(seen.length, 1, '同值不重复通知')
  assert.equal(isPollAllowed(), false)
  assert.match(pollGate().reason, /非交易日/)

  const before = pollSkippedTicks()
  notePollSkipped()
  notePollSkipped()
  assert.equal(pollSkippedTicks(), before + 2, '被挡下的轮次要能记账（诊断面板展示）')

  setPollGate(computePollGate({ isTradeDay: true, phase: 'trading' }))
  assert.equal(isPollAllowed(), true, '开盘后自动恢复（定时器一直没停）')
  assert.equal(seen.length, 2)

  stop()
  setPollGate(closed)
  assert.equal(seen.length, 2, '退订后不再通知')

  resetPollGate()
  assert.equal(pollSkippedTicks(), 0)
  assert.equal(isPollAllowed(), true)
})
