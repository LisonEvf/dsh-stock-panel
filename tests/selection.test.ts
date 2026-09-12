/**
 * tests/selection.test.ts —— 导航/工具页状态层的单元测试（B4 扩面）。
 *
 * 为什么值得测：A4 把「市场总览 / 指数 / 涨停梯队」三页合并成单页 `market` 之后，
 * 老用户落盘的 `tool` 值仍是旧 id。如果归一出错，表现是**"工具页打不开"且没有任何报错**
 * （`setTool` 校验失败会静默返回原状态）—— 静默失效正是本项目最想避免的一类问题。
 * 这里把「旧 id 必须就地映射、非法 id 必须拒绝」写成可执行契约。
 *
 * 注：`selection.ts` 在模块加载时会读 localStorage（浏览器 API）。在 Node 里读不到会走
 * 异常分支返回默认状态 —— 所以本文件能在无浏览器环境下直接 import。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { LEGACY_TOOL_IDS, TOOL_VIEWS, toolIdOf } from '../src/lib/selection.ts'

test('TOOL_VIEWS：id 唯一、字段齐全、外盘仍是次要区块', () => {
  const ids = TOOL_VIEWS.map((t) => t.id)
  assert.equal(new Set(ids).size, ids.length, `工具 id 唯一（${ids.join('/')}）`)
  for (const t of TOOL_VIEWS) {
    assert.ok(t.label.length > 0 && t.hint.length > 0, `${t.id} 有标签与说明`)
    assert.ok(['市场', '研究', '自选与监控', '个股'].includes(t.group), `${t.id} 分组合法（${t.group}）`)
  }
  const secondary = TOOL_VIEWS.filter((t) => t.secondary === true).map((t) => t.id)
  assert.deepEqual(secondary, ['global'], '只有外盘是次要（A4 弱化决策）')
  assert.equal(TOOL_VIEWS[TOOL_VIEWS.length - 1].id, 'global', '次要区块排在最后')
})

test('★ A4 合并：三页合成一页 market，旧 id 全部就地映射（老用户不掉页）', () => {
  assert.deepEqual(LEGACY_TOOL_IDS, { overview: 'market', indices: 'market', ladder: 'market' })
  for (const legacy of ['overview', 'indices', 'ladder']) {
    assert.equal(toolIdOf(legacy), 'market', `旧 id ${legacy} → market`)
  }
  assert.ok(
    TOOL_VIEWS.some((t) => t.id === 'market'),
    'market 必须在 TOOL_VIEWS 里（否则映射结果会被二次校验丢掉）',
  )
  // 合并后的三个旧 id 不得再作为独立区块存在（否则用户会看到重复入口）
  for (const legacy of ['overview', 'indices', 'ladder']) {
    assert.ok(!TOOL_VIEWS.some((t) => t.id === legacy), `旧区块 ${legacy} 应已下线`)
  }
})

test('toolIdOf：现行 id 原样通过，非法/缺失一律 null（不猜、不落到第一项）', () => {
  assert.equal(toolIdOf('market'), 'market')
  assert.equal(toolIdOf('concept'), 'concept')
  assert.equal(toolIdOf('global'), 'global')
  assert.equal(toolIdOf('不存在的工具'), null)
  assert.equal(toolIdOf(''), null)
  assert.equal(toolIdOf(null), null)
  assert.equal(toolIdOf(undefined), null)
  assert.equal(toolIdOf(42), null)
  // 映射的**目标**也必须是合法 id：否则等于把旧值换成一个同样打不开的值
  for (const target of Object.values(LEGACY_TOOL_IDS)) {
    assert.ok(TOOL_VIEWS.some((t) => t.id === target), `映射目标 ${target} 是合法工具 id`)
  }
})
