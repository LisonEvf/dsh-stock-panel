/**
 * tests/state-tables.test.ts —— 「用户可见数据必须落 host 域」的**结构守卫**。
 *
 * 背景（2026-09-12 实测）：README 声称"用户可见的本地资产都迁到 host 侧，仍留在
 * localStorage 的只有 UI 偏好"，但**监控规则与命中记录**（`alerts.ts`）只写 localStorage、
 * 没有任何 syncTable —— 盘前设好的规则清一次缓存就没了。问题不在于漏了一个 store，
 * 而在于**没有任何机制阻止下一个 store 被漏掉**：迁表靠人肉记得。
 *
 * 本测试把这条纪律变成机检：
 *   1. `src/**` 里出现的每一个 `dsh-stock-panel:*` 存储键，必须在 `STATE_TABLES` 里声明
 *      （或落在**显式列出**的遗留键白名单里，且写明理由）；
 *   2. `stock-panel:*` 前缀是"本机界面状态"（视图/栏显隐/当前标的），刻意不迁移 ——
 *      单独成一类，防止有人把数据也塞进去；
 *   3. 表名与存储键一一对应、不重复。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { STATE_TABLES, STATE_TABLE_MAP, keyOfRecord } from '../src/lib/state-tables'

/** 测试运行时 cwd = 仓库根（scripts/unit.mjs 用 spawnSync 在本目录执行）。 */
const ROOT = process.cwd()
const SRC = join(ROOT, 'src')

/**
 * 遗留键白名单：**只读迁移**用，不再写入。
 * 加进这里必须写清"为什么不是数据表"。
 */
const LEGACY_KEYS: Record<string, string> = {
  'dsh-stock-panel:review:v2': 'v2 复盘存档：仅在新键缺失时迁移读取，写库只写 v3',
}

/** UI 偏好前缀：本机界面状态（视图/栏显隐/K 线区间/当前标的），刻意不迁 host。 */
const UI_PREFIX = 'stock-panel:'

/** 递归扫描 src 下的字面量存储键。 */
function collectStorageKeys(): Map<string, string[]> {
  const found = new Map<string, string[]>()
  const walk = (dir: string): void => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, e.name)
      if (e.isDirectory()) {
        walk(p)
        continue
      }
      if (!/\.tsx?$/.test(e.name)) continue
      const src = readFileSync(p, 'utf8')
      for (const m of src.matchAll(/'(dsh-stock-panel:[^']*)'|'(stock-panel:[^']*)'/g)) {
        const key = m[1] ?? m[2]
        if (key === undefined) continue
        const where = found.get(key) ?? []
        where.push(p.slice(SRC.length + 1))
        found.set(key, where)
      }
    }
  }
  walk(SRC)
  return found
}

const keys = collectStorageKeys()
const declared = new Set(STATE_TABLES.map((t) => t.storageKey))

test('扫描到的存储键：每个 dsh-stock-panel:* 要么是数据表、要么在遗留白名单里', () => {
  const undeclared: string[] = []
  for (const [key, where] of keys) {
    if (!key.startsWith('dsh-stock-panel:')) continue
    if (declared.has(key)) continue
    if (LEGACY_KEYS[key] !== undefined) continue
    undeclared.push(`${key}（出现在 ${where.join('、')}）`)
  }
  assert.deepEqual(
    undeclared,
    [],
    `以下存储键既不是数据表也不是显式遗留键 —— 要么把表加进 STATE_TABLES 并 syncTable，要么写进 LEGACY_KEYS 说明理由：\n  ${undeclared.join('\n  ')}`,
  )
})

test('监控规则与命中记录必须已迁到 host 域（本轮修复的回归点）', () => {
  assert.ok(declared.has('dsh-stock-panel:alerts:rules:v1'), '规则表 storageKey 已声明')
  assert.ok(declared.has('dsh-stock-panel:alerts:hits:v1'), '命中表 storageKey 已声明')
  assert.equal(STATE_TABLE_MAP.get('alert_rules')?.shape, 'array')
  assert.equal(STATE_TABLE_MAP.get('alert_hits')?.shape, 'array')
})

test('表名唯一、存储键唯一、每条都能取到记录键', () => {
  const tables = STATE_TABLES.map((t) => t.table)
  const storageKeys = STATE_TABLES.map((t) => t.storageKey)
  assert.equal(new Set(tables).size, tables.length, 'table 名不得重复')
  assert.equal(new Set(storageKeys).size, storageKeys.length, 'storageKey 不得重复')
  for (const t of STATE_TABLES) {
    assert.ok(t.label.length > 0, `${t.table} 缺 label（诊断面板要显示）`)
    // keyOfRecord 必须能对典型记录取到键，否则 hydrate/sync 会静默跳过整表
    const sample =
      t.table === 'watchlist' || t.table === 'viewed'
        ? { market: 'SH', code: '600519' }
        : t.table === 'positions'
          ? { symbol: 'SH600519' }
          : t.table === 'tradelog'
            ? { id: 'x1' }
            : t.table === 'alert_rules' || t.table === 'alert_hits'
              ? { id: 'x1' }
              : t.table === 'verdicts'
                ? { day: '2026-09-12', symbol: 'SH600519' }
                : t.table === 'events'
                  ? { key: 'k1' }
                  : { day: '2026-09-12' }
    assert.notEqual(keyOfRecord(t.table, sample), null, `${t.table} 的记录键取不到`)
  }
})

test('UI 偏好键不与数据表冲突（前缀分离）', () => {
  for (const [key] of keys) {
    if (key.startsWith(UI_PREFIX)) {
      assert.equal(declared.has(key), false, `${key} 是 UI 偏好，不该同时是数据表`)
    }
  }
})
