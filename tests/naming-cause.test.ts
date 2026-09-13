/**
 * tests/naming-cause.test.ts —— 素材状态 → 归因（**模板化，不由模型书写**）。
 *
 * 事故背景（2026-09-12 周六实测）：自挖板块 9 组全部没有名字，证据卡写的是
 * 「belong_board、kline、market_monitor、unusual 等源**采集失败**」，头条写的是
 * 「9 组模型判为无共同主题或素材不足」。
 * 真实情况：两个实时源 **as_of≠当前交易日 → 按设计跳过**、两个源**调用成功但没有产出**
 * （窗口内没有涨停/没有可引用板块）、**零个源失败**。
 *
 * 三种成因的处置完全不同（改日期口径 / 接受市场事实 / 去修数据链路），
 * 混成一句就等于把用户往错误方向指。这里把"怎么说"钉死。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { countSourceStatus, describeMaterialCause, hasStatus, pickDegradedReason, sourceStatusLine } from '../src/host/naming/cause'
import type { SourceReport } from '../src/host/naming/types'

const S = (source: string, status: SourceReport['status'], produced = 0, detail = 'x'): SourceReport => ({
  source,
  status,
  produced,
  detail,
})

/** 周六那天的真实组合：两个按设计跳过 + 两个无产出 + 零失败。 */
const saturday = [
  S('unusual', 'skipped_by_design', 0, 'as_of=2026-09-11 ≠ 当前交易日 2026-09-12'),
  S('market_monitor', 'skipped_by_design', 0, 'as_of=2026-09-11 ≠ 当前交易日 2026-09-12'),
  S('belong_board', 'no_material', 0, '7 只票的板块归属都未产出可引用板块（非失败）'),
  S('kline', 'no_material', 0, '窗口内这 7 只票都没有封板 —— 这是市场事实，不是采集失败'),
]

test('成因文案：区分三种情形，且不得把"按设计跳过/无产出"写成"采集失败"', () => {
  const note = describeMaterialCause(saturday, 0, 7)
  assert.match(note, /按设计跳过/)
  assert.match(note, /无产出/)
  // 模板只在源码真的失败时才会打这个**加粗标记**（详情里出现"不是采集失败"这种否定句是允许的）
  assert.ok(!note.includes('**采集失败**'), `没有失败源时不得给出失败归因：${note}`)
  assert.match(note, /7 只成员/)
  // 两个实时源共享同一条原因 → 去重后只念一次
  assert.equal(note.match(/as_of=2026-09-11/g)?.length, 1, `同一原因不该重复：${note}`)
})

test('成因文案：真的有失败源时才写"采集失败"，并带原始错误', () => {
  const note = describeMaterialCause(
    [S('kline', 'failed', 0, '2 只票取日K失败：socket hang up'), ...saturday.slice(0, 3)],
    0,
    7,
  )
  assert.match(note, /采集失败/)
  assert.match(note, /socket hang up/)
})

test('成因文案：有素材时列出已采用与条数', () => {
  const note = describeMaterialCause([S('belong_board', 'used', 3, '3/3 只票产出板块归属'), S('kline', 'no_material', 0)], 3, 3)
  assert.match(note, /共 3 条素材/)
  assert.match(note, /已采用：板块归属 3 条/)
  assert.match(note, /无产出/)
})

test('旧语料（无逐源状态）如实说明信息不足，不编造细粒度归因', () => {
  const note = describeMaterialCause(undefined, 0)
  assert.match(note, /逐源状态未记录/)
})

test('降级成因按采集事实定档：失败 > 按设计跳过 > 没素材 > 部分成员 > 模型判不足', () => {
  assert.equal(
    pickDegradedReason({ sources: [S('kline', 'failed'), ...saturday], itemCount: 0, missingMemberCount: 7 }),
    'source_failed',
  )
  assert.equal(pickDegradedReason({ sources: saturday, itemCount: 0, missingMemberCount: 7 }), 'source_skipped')
  assert.equal(
    pickDegradedReason({ sources: [S('kline', 'no_material')], itemCount: 0, missingMemberCount: 7 }),
    'no_material',
  )
  assert.equal(
    pickDegradedReason({ sources: [S('kline', 'used', 2)], itemCount: 2, missingMemberCount: 3 }),
    'partial_material',
  )
  assert.equal(
    pickDegradedReason({ sources: [S('kline', 'used', 2)], itemCount: 2, missingMemberCount: 0 }),
    'llm_insufficient',
  )
})

test('旧语料回退口径：缺失源 → source_failed，否则照旧分层', () => {
  assert.equal(
    pickDegradedReason({ sources: undefined, itemCount: 3, missingMemberCount: 0, legacyMissingSources: ['kline'] }),
    'source_failed',
  )
  assert.equal(pickDegradedReason({ sources: undefined, itemCount: 3, missingMemberCount: 0 }), 'llm_insufficient')
  assert.equal(pickDegradedReason({ sources: undefined, itemCount: 0, missingMemberCount: 2 }), 'no_material')
})

test('计数与展示行（批量头条按它聚合）', () => {
  const counts = countSourceStatus(saturday)
  assert.deepEqual(counts, { used: 0, skipped_by_design: 2, no_material: 2, failed: 0 })
  assert.equal(hasStatus(saturday, 'failed'), false)
  assert.equal(hasStatus(saturday, 'skipped_by_design'), true)
  assert.equal(sourceStatusLine(S('unusual', 'skipped_by_design')), '市场异动=按设计跳过')
  assert.equal(sourceStatusLine(S('kline', 'used', 4)), '封板状态(日K)=已采用(4)')
})
