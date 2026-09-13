/**
 * tests/tdx-dispatch.test.ts —— 适配层分发契约（注入假 client，**不触网**）。
 *
 * 这一层是"工具契约"的落点：参数白名单、排序契约、缺省值语义。假 `fn` 让这些断言
 * 可以在 CI 里跑（真机冒烟 smoke-embedded 需要行情，跑不了就把契约裸露在风险里）。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { dispatch, TdxToolError, UnsupportedToolError } from '../src/host/tdx-data'

/** 造一个记录调用的假 client。 */
function fakeFn(over: Record<string, unknown> = {}) {
  const calls: Array<{ method: string; args: unknown[] }> = []
  const base: Record<string, unknown> = {
    stockBoardMembers: async (...args: unknown[]) => {
      calls.push({ method: 'stockBoardMembers', args })
      return []
    },
    stockQuotesFields: async (...args: unknown[]) => {
      calls.push({ method: 'stockQuotesFields', args })
      return []
    },
    stockKline: async (...args: unknown[]) => {
      calls.push({ method: 'stockKline', args })
      return []
    },
    goodsVarieties: async (...args: unknown[]) => {
      calls.push({ method: 'goodsVarieties', args })
      return []
    },
    goodsKline: async (...args: unknown[]) => {
      calls.push({ method: 'goodsKline', args })
      return []
    },
    serverInfo: async () => {
      calls.push({ method: 'serverInfo', args: [] })
      return null
    },
  }
  return { fn: { ...base, ...over }, calls }
}

const row = (code: string, pct: number) => ({ code, name: code, pre_close: 100, close: 100 * (1 + pct / 100) })

test('board_members：排序键/方向按白名单转成枚举值传给数据层', async () => {
  const { fn, calls } = fakeFn()
  await dispatch(fn, 'board_members', { board_symbol: 'A', count: 6000, sort_type: 'CHANGE_PCT', sort_order: 'DESC' })
  const call = calls.find((c) => c.method === 'stockBoardMembers')
  assert.ok(call, '必须调用 stockBoardMembers')
  assert.equal(call.args[0], 6, "board_symbol 'A' → Category.A = 6（全 A 列表）")
  assert.equal(call.args[1], 6000)
  assert.equal(call.args[2], 14, 'CHANGE_PCT = 14')
  assert.equal(call.args[3], 1, 'DESC = 1')
})

test('board_members：数据层页序被反转时，适配层仍返回降序（契约兜底）', async () => {
  const buggy = [row('B2', 3), row('B1', 2), row('A2', 10), row('A1', 5)]
  const { fn } = fakeFn({ stockBoardMembers: async () => buggy })
  const out = (await dispatch(fn, 'board_members', { board_symbol: 'A', count: 6000, sort_type: 'CHANGE_PCT', sort_order: 'DESC' })) as Array<{ code: string }>
  assert.deepEqual(out.map((r) => r.code), ['A2', 'A1', 'B2', 'B1'])
})

test('board_members：未知 sort_type 直接报错，不再静默回落成涨幅榜', async () => {
  const { fn, calls } = fakeFn()
  await assert.rejects(
    () => dispatch(fn, 'board_members', { board_symbol: 'A', count: 50, sort_type: 'AMOUNT' }),
    (err: unknown) => {
      assert.ok(err instanceof TdxToolError, '必须是业务错（kind=business），不是静默成功')
      assert.match((err as Error).message, /invalid sort_type: "AMOUNT"/)
      assert.match((err as Error).message, /TOTAL_AMOUNT/, '错误信息要给出正确的枚举名')
      return true
    },
  )
  assert.equal(calls.length, 0, '参数不合法时不该发起数据层调用')
})

test('board_members：未知 sort_order 同样报错', async () => {
  const { fn } = fakeFn()
  await assert.rejects(() => dispatch(fn, 'board_members', { board_symbol: 'A', sort_order: 'UP' }), /invalid sort_order: "UP"/)
})

test('board_members：缺省 count 用 50，越界 count 报错', async () => {
  const { fn, calls } = fakeFn()
  await dispatch(fn, 'board_members', { board_symbol: 'A' })
  assert.equal(calls[0].args[1], 50)
  await assert.rejects(() => dispatch(fn, 'board_members', { board_symbol: 'A', count: 0 }), /invalid count: 0/)
})

test('goods_varieties：market_id 缺失/为 0 一律报错（旧实现会静默变 0 号并在服务端挂死）', async () => {
  const { fn, calls } = fakeFn()
  await assert.rejects(() => dispatch(fn, 'goods_varieties', {}), /missing market_id/)
  await assert.rejects(() => dispatch(fn, 'goods_varieties', { market_id: 0 }), /invalid market_id: 0/)
  assert.equal(calls.length, 0)
  await dispatch(fn, 'goods_varieties', { market_id: 1 })
  assert.deepEqual(calls[0].args, [1, 0, 20])
})

test('goods_kline：market 走扩展市场枚举，period 未知即报错', async () => {
  const { fn, calls } = fakeFn()
  await dispatch(fn, 'goods_kline', { market: 'US_STOCK', code: 'TSLA', period: 'DAILY', count: 3 })
  assert.equal(calls[0].method, 'goodsKline')
  assert.equal(calls[0].args[0], 74, 'US_STOCK = 74')
  assert.equal(calls[0].args[4], 3)
  await assert.rejects(() => dispatch(fn, 'goods_kline', { market: 'US_STOCK', code: 'TSLA', period: 'H1' }), /invalid period: "H1"/)
})

test('quote：缺 market 时如实报错（不猜默认市场）', async () => {
  const { fn, calls } = fakeFn()
  await assert.rejects(() => dispatch(fn, 'quote', { code: '300903' }), /invalid market/)
  assert.equal(calls.length, 0)
})

test('quote：合法参数透传，并做万股→股归一化', async () => {
  const { fn, calls } = fakeFn({
    stockQuotesFields: async (...args: unknown[]) => {
      calls.push({ method: 'stockQuotesFields', args })
      return [{ code: '300903', total_shares: 43538.66 }]
    },
  })
  const out = (await dispatch(fn, 'quote', { market: 'sz', code: '300903' })) as Array<Record<string, unknown>>
  assert.equal(calls[0].args[0][0][0], 0, 'SZ = 0')
  // ×10000 会带浮点尾差（435386600.00000006），取整后比较
  assert.equal(Math.round(Number(out[0].total_shares)), 435386600, '万股 → 股（×10000）')
})

test('未知工具名：抛 UnsupportedToolError（供路由映射 kind=unsupported）', async () => {
  const { fn } = fakeFn()
  await assert.rejects(() => dispatch(fn, 'no_such_tool', {}), UnsupportedToolError)
})
