/**
 * tests/tool-args.test.ts —— 入参校验契约：**缺省可以给默认值，给了值就必须合法**。
 *
 * 这些断言对应的都是实测踩过的坑：
 *   - `sort_type: 'AMOUNT'`（枚举里叫 TOTAL_AMOUNT）静默回落 CHANGE_PCT，
 *     调用方拿到的是"涨幅榜"却以为是"成交额榜"；
 *   - `args` 被序列化成字符串后，每个字段都变 undefined，报错指向完全无关的地方
 *     （"invalid ex market: undefined"）；
 *   - `market_id` 缺失被 `|| 0` 静默变成市场号 0，而 0 号请求在服务端不返回 → 挂死连接。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { ToolArgError, enumNames, positiveInt, boundedInt, requireArgsObject, resolveEnum } from '../src/host/tool-args'

const Fake = { A: 1, B: 2, CHANGE_PCT: 14, TOTAL_AMOUNT: 10 } as Record<string, unknown>

test('resolveEnum：大小写/空白归一后查表成功', () => {
  assert.equal(resolveEnum(Fake, 'change_pct', { label: 'sort_type' }), 14)
  assert.equal(resolveEnum(Fake, ' TOTAL_AMOUNT ', { label: 'sort_type' }), 10)
})

test('resolveEnum：未知值报错（不静默回落），错误信息带原值与允许集合', () => {
  assert.throws(
    () => resolveEnum(Fake, 'AMOUNT', { label: 'sort_type', fallback: 14 }),
    (err: unknown) => {
      assert.ok(err instanceof ToolArgError)
      assert.match((err as Error).message, /invalid sort_type: "AMOUNT"/)
      assert.match((err as Error).message, /TOTAL_AMOUNT/) // 提示最接近的正确名字
      return true
    },
  )
})

test('resolveEnum：缺省值只在 undefined/null/空串 时生效，其它一律校验', () => {
  assert.equal(resolveEnum(Fake, undefined, { label: 'x', fallback: 1 }), 1)
  assert.equal(resolveEnum(Fake, null, { label: 'x', fallback: 1 }), 1)
  assert.equal(resolveEnum(Fake, '', { label: 'x', fallback: 1 }), 1)
  assert.throws(() => resolveEnum(Fake, 0, { label: 'x' }), /invalid x: 0/)
  assert.throws(() => resolveEnum(Fake, 'nope', { label: 'x' }), /invalid x: "nope"/)
})

test('resolveEnum：必填字段缺失时给出允许集合', () => {
  assert.throws(() => resolveEnum(Fake, undefined, { label: 'period' }), /missing period（允许：A\/B\/CHANGE_PCT\/TOTAL_AMOUNT）/)
})

test('requireArgsObject：非对象一律报错（含被字符串化的 args）', () => {
  assert.deepEqual(requireArgsObject(undefined), {})
  assert.deepEqual(requireArgsObject(null), {})
  assert.deepEqual(requireArgsObject({ a: 1 }), { a: 1 })
  assert.throws(() => requireArgsObject('market=US_STOCK', 'args'), /args 必须是对象（收到 string）/)
  assert.throws(() => requireArgsObject([1, 2], 'args'), /args 必须是对象（收到 array）/)
  assert.throws(() => requireArgsObject(7, 'args'), /args 必须是对象（收到 number）/)
})

test('positiveInt：缺失/0/负数/非整数都报错（禁止 || 0 这类静默兜底）', () => {
  assert.equal(positiveInt(3, { label: 'market_id' }), 3)
  assert.throws(() => positiveInt(undefined, { label: 'market_id' }), /missing market_id/)
  assert.throws(() => positiveInt(0, { label: 'market_id' }), /invalid market_id: 0/)
  assert.throws(() => positiveInt(-1, { label: 'market_id' }), /invalid market_id: -1/)
  assert.throws(() => positiveInt(1.5, { label: 'market_id' }), /invalid market_id: 1.5/)
  assert.throws(() => positiveInt(1000, { label: 'market_id', max: 999 }), /invalid market_id: 1000/)
  assert.equal(positiveInt(undefined, { label: 'market_id', fallback: 5 }), 5)
})

test('boundedInt：给出默认值，越界/非数字报错', () => {
  assert.equal(boundedInt(undefined, { label: 'count', fallback: 50 }), 50)
  assert.equal(boundedInt('60', { label: 'count', fallback: 50 }), 60)
  assert.throws(() => boundedInt(-1, { label: 'count', fallback: 50 }), /invalid count/)
  assert.throws(() => boundedInt('abc', { label: 'count', fallback: 50 }), /invalid count/)
})

test('enumNames：只取名字（过滤反向映射的数字键），排序稳定', () => {
  assert.deepEqual(enumNames(Fake), ['A', 'B', 'CHANGE_PCT', 'TOTAL_AMOUNT'])
})
