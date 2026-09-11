// scripts/verify-live.mjs —— 对**运行中的** dsh web 做实机端到端验收（A1 + 构建可见性）
//
// 为什么需要它：插件的 host 半是**进程内**加载的，改完必须重启 `dsh web` 才生效，
// 而「重启后到底好了没」不该靠人肉开 DevTools 抄命令。本脚本把验收锚点变成一条命令：
//
//   node scripts/verify-live.mjs                 # 默认 http://127.0.0.1:3080
//   node scripts/verify-live.mjs http://127.0.0.1:3099
//
// 检查项：
//   ① host 半新鲜度：GET /api/stock-panel/build 的 buildId 是否等于**当前源码**算出的 buildId
//      （不等 = 进程里跑的是重启前的旧 host 半 → 提示重启）
//   ② 持久化可用性：GET /api/stock-panel/state → available:true + 8 张表 + 服务来源
//   ③ 写→读→删闭环：往 viewed 表写一条 canary，读回来，再删掉（真域、真介质）
//   ④ AI 与行情链路：/api/stock-panel/ai 的可用性、/api/stock-panel/call 的 server_info（信息项）
//
// 退出码：①②③ 全过 = 0；否则 1（④ 只是信息项，不影响退出码）。

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { computeBuildId, pluginVersion } from './build-id.mjs'

const BASE = (process.argv[2] ?? 'http://127.0.0.1:3080').replace(/\/$/, '')
const ROOT = join(import.meta.dirname, '..')
const pkgVersion = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')).version
const localBuildId = computeBuildId()

let failures = 0
function assert(cond, msg) {
  if (cond) {
    console.log(`  ✅ ${msg}`)
  } else {
    failures += 1
    console.error(`  ❌ ${msg}`)
  }
}

async function getJson(path, timeoutMs = 8000) {
  const ac = new AbortController()
  const t = setTimeout(() => ac.abort(), timeoutMs)
  try {
    const res = await fetch(BASE + path, { headers: { Accept: 'application/json' }, signal: ac.signal })
    const text = await res.text()
    let body = null
    try {
      body = JSON.parse(text)
    } catch {
      body = { raw: text.slice(0, 200) }
    }
    return { status: res.status, body }
  } catch (err) {
    return { status: 0, body: null, error: err?.message ?? String(err) }
  } finally {
    clearTimeout(t)
  }
}

async function postJson(path, payload, timeoutMs = 15000) {
  const ac = new AbortController()
  const t = setTimeout(() => ac.abort(), timeoutMs)
  try {
    const res = await fetch(BASE + path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(payload),
      signal: ac.signal,
    })
    const text = await res.text()
    let body = null
    try {
      body = JSON.parse(text)
    } catch {
      body = { raw: text.slice(0, 200) }
    }
    return { status: res.status, body }
  } catch (err) {
    return { status: 0, body: null, error: err?.message ?? String(err) }
  } finally {
    clearTimeout(t)
  }
}

console.log(`[verify-live] 目标 ${BASE}`)
console.log(`[verify-live] 当前源码：v${pluginVersion()} · build ${localBuildId}\n`)

console.log('[1] host 半新鲜度（host 是进程内加载的，改完必须重启 dsh web）')
const build = await getJson('/api/stock-panel/build')
if (build.status !== 200) {
  if (build.status === 404) {
    assert(false, `GET /api/stock-panel/build → 404：进程里的 host 半**没有**该路由 → 请重启 dsh web`)
  } else {
    assert(false, `GET /api/stock-panel/build 失败：HTTP ${build.status} ${build.error ?? JSON.stringify(build.body)}`)
  }
} else {
  assert(build.body?.version === pkgVersion, `版本一致（运行 ${build.body?.version} / 源码 ${pkgVersion}）`)
  assert(
    build.body?.buildId === localBuildId,
    build.body?.buildId === localBuildId
      ? `构建 id 一致（${localBuildId}）→ 进程跑的是当前源码`
      : `构建 id 不一致（运行 ${build.body?.buildId} / 源码 ${localBuildId}）→ 请重启 dsh web`,
  )
}

console.log('\n[2] 持久化可用性（A1）')
const state = await getJson('/api/stock-panel/state')
let stateTables = null
if (state.status !== 200) {
  assert(false, `GET /api/stock-panel/state → HTTP ${state.status}：host 半未含该路由（重启后应出现）`)
} else {
  const b = state.body ?? {}
  assert(b.ok === true, `响应 ok=${b.ok}`)
  if (b.available !== true) {
    assert(false, `available=${b.available} —— 原因：${b.reason ?? '（未给出）'}`)
    assert(
      false,
      `服务来源：${b.facilitySource ?? '（未给出）'}（若为「服务可能晚于 apply 挂载」，说明仍在旧实现上，重启即修）`,
    )
  } else {
    stateTables = b.tables ?? {}
    assert(true, `available=true · 服务来源 ${b.facilitySource ?? '?'}`)
    const names = Object.keys(stateTables)
    assert(names.length === 8, `8 张表都在（实际 ${names.length}：${names.join(',')}）`)
    const counts = b.counts ?? {}
    console.log(
      `  ℹ️ 各表记录数：${Object.entries(counts)
        .map(([k, v]) => `${k}=${v}`)
        .join('  ')}`,
    )
    console.log(`  ℹ️ 已从 localStorage 首迁：${b.migratedFromLocalStorage === true ? '是' : '否（域为空且本地有数据时会自动上传）'}`)
  }
}

console.log('\n[3] 写→读→删闭环（真域、真介质）')
if (stateTables === null) {
  assert(false, '持久化不可用，跳过闭环检查（见 [2]）')
} else {
  const key = 'SZ999999'
  const canary = { market: 'SZ', code: '999999', name: 'verify-live canary', at: Date.now(), hits: 1 }
  const put = await postJson('/api/stock-panel/state', { table: 'viewed', key, value: canary })
  assert(put.body?.ok === true && put.body?.written === 1, `写入 viewed/${key}（written=${put.body?.written}）`)
  const after = await getJson('/api/stock-panel/state')
  const readBack = after.body?.tables?.viewed?.[key]
  assert(readBack?.name === canary.name, `读回同一条记录（name=${readBack?.name}）`)
  const del = await postJson('/api/stock-panel/state', { table: 'viewed', key, delete: true })
  assert(del.body?.deleted === 1, `删除 canary（deleted=${del.body?.deleted}）`)
  const final = await getJson('/api/stock-panel/state')
  assert(final.body?.tables?.viewed?.[key] === undefined, '删除后快照里不再有 canary（不留脏数据）')
}

console.log('\n[4] 附带信息（不影响退出码）')
const ai = await getJson('/api/stock-panel/ai')
console.log(`  ℹ️ AI：HTTP ${ai.status} ${JSON.stringify(ai.body)?.slice(0, 160) ?? ai.error}`)
const call = await postJson('/api/stock-panel/call', { tool: 'server_info', args: {} })
console.log(
  `  ℹ️ 行情（server_info）：HTTP ${call.status} ${JSON.stringify(call.body)?.slice(0, 200) ?? call.error}`,
)

if (failures > 0) {
  console.error(`\n[verify-live] ${failures} 项未通过`)
  console.error('[verify-live] 提示：host 半改动必须重启 `dsh web`；client 半改动只需浏览器硬刷新。')
  process.exit(1)
}
console.log('\n[verify-live] 实机验收全部通过 ✅')
