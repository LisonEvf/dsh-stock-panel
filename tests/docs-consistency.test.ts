/**
 * tests/docs-consistency.test.ts —— 文档里的**数字**必须与代码一致。
 *
 * 背景（2026-09-12 审计）：README 自称"唯一真源"，但实测有 11 处与工作树不符，
 * 其中一半是**数字**：表数（文档 8 / 代码 9）、体积护栏（文档 650 / ARCHITECTURE 600）、
 * 命名断言（41 / 实测 46）、"19 工具冒烟"（脚本只跑 12）、CI 门禁条数……
 * 数字散落在叙述里就会各写一遍，然后各自漂移。
 *
 * 本测试把关键数字变成**从代码算出来再比对**：文档改了措辞会被要求同步这里，
 * 代码改了数量则直接红灯 —— 而不是等到某个验收脚本真机跑挂（verify-live 就断言过 8 张表）。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { EMBEDDED_TOOLS, CONVERSATION_TOOLS } from '../src/lib/tool-names'
import { STATE_TABLES } from '../src/lib/state-tables'

const ROOT = process.cwd()
const README = readFileSync(join(ROOT, 'README.md'), 'utf8')

/** 取 README 里所有匹配的捕获组（找不到就报"文档该给出这个数字"）。 */
function captures(pattern: RegExp, label: string): string[] {
  const out = [...README.matchAll(pattern)].map((m) => m[1])
  assert.ok(out.length > 0, `README 缺少「${label}」的表述（若改了措辞，请同步本测试的模式）`)
  return out
}

test('README 的「N 张表」与 STATE_TABLES 一致', () => {
  const nums = captures(/(\d+)\s*张表/g, 'N 张表').map(Number)
  for (const n of nums) assert.equal(n, STATE_TABLES.length, `README 写 ${n} 张表，代码是 ${STATE_TABLES.length} 张`)
})

test('README 的内置工具数 / 对话工具数与单源清单一致', () => {
  for (const n of captures(/\*\*(\d+) 个工具\*\*/g, '**N 个工具**').map(Number)) {
    assert.equal(n, EMBEDDED_TOOLS.length)
  }
  for (const n of captures(/\*\*(\d+) 个对话工具\*\*/g, '**N 个对话工具**').map(Number)) {
    assert.equal(n, CONVERSATION_TOOLS.length)
  }
})

test('README 的体积护栏与 check-bundle-size.mjs 的默认值一致', () => {
  const script = readFileSync(join(ROOT, 'scripts', 'check-bundle-size.mjs'), 'utf8')
  const limit = Number(script.match(/CLIENT_MAX_KB[\s\S]{0,80}?\?\?\s*(\d+)/)?.[1] ?? script.match(/\?\?\s*(\d+)/)?.[1])
  assert.ok(Number.isFinite(limit), 'check-bundle-size.mjs 里应能找到默认护栏（?? N）')
  for (const n of captures(/体积护栏（(\d+)KB）/g, '体积护栏（NKB）').map(Number)) {
    assert.equal(n, limit, `README 写 ${n}KB，脚本默认 ${limit}KB`)
  }
})

test('README 的单测文件数与 tests/*.test.ts 实际数量一致', () => {
  const files = readdirSync(join(ROOT, 'tests')).filter((f) => f.endsWith('.test.ts'))
  for (const n of captures(/单元测试（[^）]*?(\d+)\s*文件/g, '单元测试（… N 文件）').map(Number)) {
    assert.equal(n, files.length, `README 写 ${n} 个测试文件，实际 ${files.length} 个`)
  }
})

test('README 的命名断言数与 naming 测试里的用例数一致', () => {
  const namingFiles = readdirSync(join(ROOT, 'tests')).filter((f) => f.includes('naming') && f.endsWith('.test.ts'))
  let count = 0
  for (const f of namingFiles) {
    const src = readFileSync(join(ROOT, 'tests', f), 'utf8')
    count += [...src.matchAll(/^\s*test\(/gm)].length
  }
  assert.ok(count > 0, 'naming 测试文件里应能数到用例')
  for (const n of captures(/（(\d+)\s*条命名相关断言/g, '（N 条命名相关断言）').map(Number)) {
    assert.equal(n, count, `README 写 ${n} 条命名断言，实际 ${count} 条`)
  }
})
