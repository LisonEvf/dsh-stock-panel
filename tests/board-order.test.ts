/**
 * tests/board-order.test.ts —— `board_members` 排序契约的本地复算。
 *
 * 背景：node-tdx 多页取数用 `unshift` 拼页，`count > 80` 时页序被反转（2026-09-12 实测：
 * count=160 → 前 80 行是"榜尾"）。全 A 快照走 count=6000，于是"选股筛选"第一屏给出的
 * 是最弱的命中。上游已修，这里锁住适配层的兜底口径：接口写着"含排序"就得自证。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { LOCALLY_SORTABLE_KEYS, orderBoardRows } from '../src/host/board-order'

/** 造一行（pct 由 close/pre_close 推出）。 */
function row(code: string, pct: number, extra: Record<string, unknown> = {}) {
  return { code, pre_close: 100, close: 100 * (1 + pct / 100), ...extra }
}

/** 模拟"页序被反转"的数据层输出：块内降序、块间颠倒。 */
const reversedPages = [
  row('B2', 3),
  row('B1', 2),
  row('A2', 10),
  row('A1', 5),
]

test('DESC：即使数据层页序被反转，也要按涨幅降序返回（否则最弱命中排在最前）', () => {
  const out = orderBoardRows(reversedPages, 'CHANGE_PCT', 'DESC')
  assert.equal(out.enforced, true)
  assert.deepEqual(out.rows.map((r) => r.code), ['A2', 'A1', 'B2', 'B1'])
})

test('ASC：升序', () => {
  const out = orderBoardRows(reversedPages, 'CHANGE_PCT', 'ASC')
  assert.deepEqual(out.rows.map((r) => r.code), ['B1', 'B2', 'A1', 'A2'])
})

test('NONE：不排序（enforced=false，顺序保持数据层输出）', () => {
  const out = orderBoardRows(reversedPages, 'CHANGE_PCT', 'NONE')
  assert.equal(out.enforced, false)
  assert.deepEqual(out.rows.map((r) => r.code), ['B2', 'B1', 'A2', 'A1'])
})

test('无本地可复算字段的排序键：如实标注 enforced=false（不假装排过）', () => {
  const out = orderBoardRows(reversedPages, 'LOCKED_AMOUNT', 'DESC')
  assert.equal(out.enforced, false)
  assert.match(out.reason ?? '', /无本地可复算字段/)
  assert.equal(out.rows.length, 4)
})

test('金额/成交量/代码键各自可用；缺失值排到末尾；同值按代码确定', () => {
  const rows = [
    { code: 'X', amount: 5, vol: 10 },
    { code: 'Y', amount: 50, vol: 1 },
    { code: 'Z' }, // 无 amount/vol
    { code: 'W', amount: 5, vol: 3 },
  ]
  assert.deepEqual(orderBoardRows(rows, 'TOTAL_AMOUNT', 'DESC').rows.map((r) => r.code), ['Y', 'W', 'X', 'Z'])
  assert.deepEqual(orderBoardRows(rows, 'VOLUME', 'DESC').rows.map((r) => r.code), ['X', 'W', 'Y', 'Z'])
  assert.deepEqual(orderBoardRows(rows, 'CODE', 'ASC').rows.map((r) => r.code), ['W', 'X', 'Y', 'Z'])
  // 缺失值在 ASC 时也排末尾
  assert.deepEqual(orderBoardRows(rows, 'TOTAL_AMOUNT', 'ASC').rows.map((r) => r.code), ['W', 'X', 'Y', 'Z'])
})

test('非数组输入：返回空数组并说明原因（不抛，调用方按空处理）', () => {
  const out = orderBoardRows(null, 'CHANGE_PCT', 'DESC')
  assert.deepEqual(out.rows, [])
  assert.equal(out.enforced, false)
})

test('可复算键清单包含 UI 实际用到的键', () => {
  for (const k of ['CHANGE_PCT', 'TOTAL_AMOUNT', 'VOLUME', 'CODE', 'ACTIVITY']) {
    assert.ok(LOCALLY_SORTABLE_KEYS.includes(k), `${k} 应在可复算清单里`)
  }
})
