/**
 * tests/tool-names.test.ts —— 工具清单**唯一真源**的守卫。
 *
 * 为什么值得一条测试：工具名此前散在 5 处，实测漂移成 19/15/8/12 四种口径
 * （README 说"19 工具冒烟"、smoke-embedded 只跑 12 个）。数字一散开就必然对不上，
 * 所以这里把"确实是几个、确实是哪些"钉死；新增工具时这条测试会强制你同时想清楚
 * 它属于数据层还是对话面。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  CONVERSATION_TOOLS,
  CONVERSATION_TOOL_NAMES,
  EMBEDDED_TOOLS,
  EMBEDDED_TOOL_NAMES,
  EXTENDED_MARKET_TOOLS,
  isEmbeddedTool,
  isExtendedMarketTool,
} from '../src/lib/tool-names'

test('数据层工具 = 19 个（行情 15 + HIST 4），名字唯一', () => {
  assert.equal(EMBEDDED_TOOL_NAMES.length, 19)
  assert.equal(new Set(EMBEDDED_TOOL_NAMES).size, 19, '名字不得重复')
  const hist = EMBEDDED_TOOL_NAMES.filter((n) => n.startsWith('hist_concept_'))
  assert.equal(hist.length, 4)
  assert.equal(EMBEDDED_TOOL_NAMES.length - hist.length, 15)
})

test('每个工具都有非空描述（诊断面板/工具清单直接展示它）', () => {
  for (const t of EMBEDDED_TOOLS) {
    assert.ok(t.description.length > 4, `${t.name} 缺描述`)
  }
})

test('扩展市场工具是数据层工具的子集，且恰好 3 个', () => {
  assert.equal(EXTENDED_MARKET_TOOLS.length, 3)
  for (const n of EXTENDED_MARKET_TOOLS) {
    assert.ok(EMBEDDED_TOOL_NAMES.includes(n), `${n} 必须也是数据层工具`)
    assert.equal(isExtendedMarketTool(n), true)
  }
  assert.equal(isExtendedMarketTool('quote'), false)
})

test('对话工具 = 8 个（行情 4 + HIST 4），与数据层清单是两个集合', () => {
  assert.equal(CONVERSATION_TOOL_NAMES.length, 8)
  assert.equal(new Set(CONVERSATION_TOOL_NAMES).size, 8)
  for (const n of ['stock_quote', 'stock_kline', 'stock_tick', 'stock_unusual']) {
    assert.ok(CONVERSATION_TOOL_NAMES.includes(n))
    assert.equal(EMBEDDED_TOOL_NAMES.includes(n), false, '对话工具名不应出现在数据层清单里')
  }
  for (const n of CONVERSATION_TOOL_NAMES.filter((x) => x.startsWith('hist_concept_'))) {
    assert.ok(EMBEDDED_TOOL_NAMES.includes(n), 'HIST 四个工具两边同名（同一实现、两种入口）')
  }
})

test('名字判定函数按名精确匹配', () => {
  assert.equal(isEmbeddedTool('kline'), true)
  assert.equal(isEmbeddedTool('kline '), false)
  assert.equal(isEmbeddedTool(''), false)
  assert.equal(isEmbeddedTool(undefined), false)
})
