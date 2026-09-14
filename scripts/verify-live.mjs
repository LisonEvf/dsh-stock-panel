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
//
// ⚠️ 基准是**本地工作树**（`computeBuildId()` 哈希 src/ + package.json）：对**非工作树**的实例
//    （从 Release 资产 tarball 装出来的那份）跑，构建 id **必然不一致** —— 装的是发布产物、不是你手上这份源码，
//    那是预期提示、不是故障；只有 `link:` / 本地 checkout 起的实例才该完全一致。同理，改过 package.json
//    （哪怕只改脚本名）也要重新 `pnpm build`，否则本脚本会一直提示「运行的是旧 host 半」——那是真的不一致，不是误报。

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { computeBuildId, pluginVersion } from './build-id.mjs'

const BASE = (process.argv[2] ?? 'http://127.0.0.1:3080').replace(/\/$/, '')
const ROOT = join(import.meta.dirname, '..')
const pkgVersion = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')).version
const localBuildId = computeBuildId()
/** 本仓库构建产物：用它导出的 STATE_TABLES 作为"表清单真源"（脚本不再写死张数）。 */
const engineModule = await import(pathToFileURL(join(ROOT, 'lib', 'index.js')).href).catch(() => ({}))

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
    // 与**本仓库声明的表**逐个对齐（此前写死 8 张：代码已 9 张 → 这条真机验收必红）
    const declared = (engineModule.STATE_TABLES ?? []).map((t) => t.table)
    const missing = declared.filter((t) => !names.includes(t))
    assert(
      declared.length > 0 && names.length === declared.length && missing.length === 0,
      `${declared.length} 张表都在（实际 ${names.length}：${names.join(',')}${missing.length ? ` · 缺 ${missing.join(',')}` : ''}）`,
    )
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

console.log('\n[4] 自挖板块命名桥接（A2b：口径 + 全链路一次真实命名）')
{
  const naming = await getJson('/api/stock-panel/naming')
  assert(naming.status === 200, `GET /api/stock-panel/naming → HTTP ${naming.status}`)
  const info = naming.body ?? {}
  assert(info.defaults?.window === 90 && info.defaults?.minCorr === 0.6, '默认参数 = 校准推荐值（90 / 0.6 / 200）')
  assert(typeof info.promptVersion === 'string' && info.promptVersion.length > 0, `提示词版本：${info.promptVersion}`)
  console.log(
    `  ℹ️ 命名能力：available=${info.available}${info.available ? `（${info.provider}/${info.model}）` : `｜${info.reason ?? ''}`} · 今日=${info.today ?? '未知'}`,
  )

  // 真实链路：取当日类列表 → 挑第一个非弱链类 → 让模型命名（这会真的调一次数据层与模型）
  const classes = await postJson('/api/stock-panel/call', {
    tool: 'hist_concept_classes',
    args: { window: 90, min_corr: 0.6, pool_n: 200, top_members: 3 },
  })
  // 桥接路由的信封是 {ok,data}（src/host-util.ts）—— 此前写的是 .json，
  // 于是 payload.classes 恒空、「可用类 0」→ 这条"真实命名"检查长期被静默跳过（还在 exit 0）。
  const payload = classes.body?.data ?? classes.body
  const usable = (payload?.classes ?? []).filter((c) => c.weak_chain !== true)
  console.log(`  ℹ️ 引擎：as_of=${payload?.as_of ?? '—'} · 类 ${payload?.classes?.length ?? 0} 个（可用 ${usable.length}） · 孤立 ${payload?.isolated_n ?? '—'}`)
  if (usable.length === 0) {
    console.log('  ℹ️ 当前没有可采信的类（可能非交易日 / 快照未就绪）——跳过真实命名')
  } else {
    const target = usable[0]
    const named = await postJson('/api/stock-panel/naming', { classId: target.class_id, asOf: payload?.as_of }, 120_000)
    const out = named.body ?? {}
    assert(named.status === 200, `POST 命名 类#${target.class_id} → HTTP ${named.status}`)
    if (out.ok === true) {
      const r = out.result ?? {}
      assert(
        r.fingerprint !== undefined && String(r.fingerprint).length === 16,
        `结果带口径指纹（${String(r.fingerprint).slice(0, 16)}）`,
      )
      assert(r.evidenceCount === 0 || r.evidence.every((e) => e.quote && e.ts && e.source), '每条证据都有出处（可反查）')
      if (r.verdict === 'named') assert(typeof r.theme === 'string' && r.theme.length > 0, `结论：named「${r.theme}」`)
      else assert(r.theme === null, `结论：${r.verdict}（降级成因 ${r.degradedReason}）→ 不带主题名`)
      console.log(
        `  ℹ️ 类#${target.class_id}（${target.size} 只 ${(target.top ?? []).slice(0, 3).join('/')}）→ ${r.verdict}` +
          `${r.theme ? `「${r.theme}」` : ''} · 证据分 ${r.evidenceScore} · 证据 ${r.evidenceCount}/${r.materialCount} 条` +
          `${r.degradedReason !== 'none' ? ` · 成因 ${r.degradedReason}` : ''}`,
      )
      if (out.collectNotes?.length) for (const n of out.collectNotes) console.log(`     · ${n}`)
      if (r.missingSources?.length) console.log(`     · 缺失源：${r.missingSources.join('、')}`)
    } else {
      console.log(`  ℹ️ 被拒（${out.reason}）：${out.note}`)
    }
  }
}

console.log('\n[5] 附带信息（不影响退出码）')
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
