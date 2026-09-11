// scripts/verify-state-domain.mjs —— 用**宿主真实的存储栈**校验本插件手搓的领域 spec。
//
// 为什么需要它：`src/host/state.ts` 刻意**不 import** `@deepseek-ai/dsh-storage-domain`
// （公开 npm 上只有 0.0.1-rc.1，宿主跑 0.1.2-rc.1），而是手搓 spec + 极简 schema。
// 手搓契约的风险只能用**真实现跑一遍**来排除 —— 用假实现验证不算验证。
//
// 做法：直接加载 DSH 安装目录里的四个包，用真 cordis Context 按 base profile 的方式装配
// （storage 枢纽 → storage-json 后端 → storage-domain 领域层），然后用插件的
// `buildStateSpec()` 打开 `stock_panel` 领域，断言：
//   1. spec 能被真实 `open()` 接受（无 defineDomain 校验、无 invalid-record）；
//   2. 8 张表都在，写入 → 关闭 → 重新打开（**换进程也还在**，即落盘不是内存）；
//   3. 介质上真的按 per-record 布局落了文件；
//   4. 版本策略成立：同一领域用 version=2 再开 → 按契约被拒（version-mismatch），
//      所以「版本固定为 1」不是口号而是必须。
//
// 用法（依赖本机 DSH 安装）：node scripts/verify-state-domain.mjs
// 注意：**不进 CI**（CI 里没有 DSH 安装），属于真机/本机校验脚本。

import { existsSync, mkdtempSync, readdirSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

const DSH_NM =
  process.env.DSH_PACKAGES_DIR ??
  'C:/Users/Lison/AppData/Roaming/npm/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai'

let failures = 0
function assert(cond, msg) {
  if (cond) {
    console.log(`  ✅ ${msg}`)
  } else {
    failures += 1
    console.error(`  ❌ ${msg}`)
  }
}

const pkgUrl = (name) => pathToFileURL(join(DSH_NM, name, 'lib', 'index.js')).href

async function main() {
  if (!existsSync(join(DSH_NM, 'dsh-storage-domain'))) {
    console.error(`[verify-state-domain] 找不到 DSH 包目录：${DSH_NM}（可用 DSH_PACKAGES_DIR 覆盖）`)
    process.exit(1)
  }

  const { Context } = await import(pkgUrl('cordis'))
  const storageMod = await import(pkgUrl('dsh-storage'))
  const jsonMod = await import(pkgUrl('dsh-storage-json'))
  const domainMod = await import(pkgUrl('dsh-storage-domain'))
  const myMod = await import(pathToFileURL(join(import.meta.dirname, '..', 'lib', 'index.js')).href)

  const root = mkdtempSync(join(tmpdir(), 'stock-panel-domain-'))
  console.log(`[verify-state-domain] 介质目录：${root}`)

  /** 按 base profile 的方式装配真实存储栈。 */
  async function mountStack() {
    const ctx = new Context()
    await ctx.plugin(storageMod.default ?? storageMod)
    await ctx.plugin(jsonMod, { root })
    await ctx.plugin(domainMod, { backend: 'json' })
    return ctx
  }

  const spec = myMod.buildStateSpec !== undefined
    ? myMod.buildStateSpec()
    : undefined
  // buildStateSpec 未经由 index.ts 再导出时，从 host/state 模块直取（同一 bundle 内）。
  const specFinal = spec ?? (await importSpecFromBundle())

  console.log('[1] 真实 storage-domain 接受手搓 spec')
  const ctx = await mountStack()
  let domain = null
  try {
    domain = await ctx.storageDomain.open(specFinal)
    assert(true, 'open() 成功（spec 字段与 defineDomain 输出同构，未被校验拒绝）')
  } catch (err) {
    assert(false, `open() 失败：${err?.message ?? err}`)
  }
  if (domain === null) {
    console.error('[verify-state-domain] 无法继续（领域未打开）')
    process.exit(1)
  }
  assert(domain.name === 'stock_panel', `领域名 = ${domain.name}`)
  assert(
    typeof domain.table('watchlist').put === 'function',
    '表句柄可用（watchlist.put 是函数）',
  )

  console.log('[2] 8 张表 + 写入/读取')
  const tables = [
    'watchlist', 'review', 'dayrun', 'positions', 'tradelog', 'verdicts', 'events', 'viewed',
  ]
  const missing = tables.filter((t) => {
    try {
      domain.table(t)
      return false
    } catch {
      return true
    }
  })
  assert(missing.length === 0, `8 张表都已声明（缺失：${missing.join(',') || '无'}）`)

  await domain.table('watchlist').put('SH600519', { market: 'SH', code: '600519', name: '贵州茅台' })
  // 事件流的自然键含 ':' 与中文 → per-record 介质**必须**拒绝它（这正是 host 层要做 base64url 的原因）。
  const eventKey = 'SH-600519-10:03-封涨停板'
  let rawRejected = false
  let rawReason = ''
  try {
    await domain.table('events').put(eventKey, { key: eventKey, ts: Date.now() })
  } catch (err) {
    rawRejected = true
    rawReason = err?.message ?? String(err)
  }
  assert(
    rawRejected,
    `per-record 介质拒绝非路径安全键（${rawReason.slice(0, 80)}…）→ 印证必须编码`,
  )
  const encoded = myMod.encodeStateKey(eventKey)
  assert(/^[a-zA-Z0-9_-]+$/.test(encoded), `base64url 编码后路径安全：${encoded}`)
  await domain.table('events').put(encoded, {
    key: eventKey, ts: Date.now(), market: 'SH', code: '600519', name: '贵州茅台',
    desc: '封涨停板', kind: 'limitUp', time: '10:03:00', value: '',
  })
  assert(
    decodeRoundTrip(myMod, encoded) === eventKey,
    '编码/解码可逆（客户端看到的始终是自然键）',
  )
  assert(domain.table('watchlist').get('SH600519')?.name === '贵州茅台', '读回 watchlist 记录')
  await domain.global.set({ schemaVersion: 1, migratedFromLocalStorage: true, updatedAt: Date.now() })
  assert(domain.global.get().migratedFromLocalStorage === true, 'global 写入/读取正常')

  console.log('[3] 介质布局（per-record 落盘）')
  const files = readdirSync(root, { recursive: true }).map(String)
  assert(files.length > 0, `介质上落了文件：${files.slice(0, 4).join(' | ')}${files.length > 4 ? ' …' : ''}`)
  const totalBytes = files
    .map((f) => {
      try {
        return statSync(join(root, f)).size
      } catch {
        return 0
      }
    })
    .reduce((a, b) => a + b, 0)
  assert(totalBytes > 0, `介质总字节 ${totalBytes}`)

  console.log('[4] 落盘持久性（关闭 → 重新打开）')
  await domain.close()
  const ctx2 = await mountStack()
  const domain2 = await ctx2.storageDomain.open(specFinal)
  assert(
    domain2.table('watchlist').get('SH600519')?.name === '贵州茅台',
    '重新打开后记录仍在（说明确实落盘，不是进程内内存）',
  )
  assert(domain2.global.get().migratedFromLocalStorage === true, 'global 也持久化了')

  console.log('[5] 版本策略：version 必须是 1（实测语义：不一致 = 静默丢记录）')
  await domain2.close()
  const ctx3 = await mountStack()
  let bumpedSize = -1
  let bumpError = ''
  try {
    const domain3 = await ctx3.storageDomain.open({ ...specFinal, version: 2 })
    bumpedSize = domain3.table('watchlist').size
  } catch (err) {
    bumpError = err?.message ?? String(err)
  }
  assert(
    bumpedSize === 0,
    bumpError === ''
      ? `version=2 打开**不报错**，但旧记录被静默丢弃（watchlist size=${bumpedSize}）`
      : `version=2 打开抛错（${bumpError}）`,
  )
  assert(
    bumpedSize === 0,
    '⚠️ 结论：version 绝不能随手上调（静默丢数据）—— 日常演进走 global.schemaVersion',
  )

  console.log('[6] 逃生口：compatibleVersions 让旧版本记录继续可读')
  const ctx4 = await mountStack()
  const domain4 = await ctx4.storageDomain.open({ ...specFinal, version: 2, compatibleVersions: [1] })
  assert(
    domain4.table('watchlist').get('SH600519')?.name === '贵州茅台',
    '声明 compatibleVersions:[1] 后，用 version=2 打开仍能读到 version=1 的记录',
  )
  await domain4.close()

  rmSync(root, { recursive: true, force: true })

  if (failures > 0) {
    console.error(`[verify-state-domain] ${failures} 项断言失败`)
    process.exit(1)
  }
  console.log('[verify-state-domain] 全部通过 ✅（真实存储栈）')
}

/** 兜底：buildStateSpec 未被再导出时，明确报错而不是静默跳过。 */
async function importSpecFromBundle() {
  const url = pathToFileURL(join(import.meta.dirname, '..', 'lib', 'index.js')).href
  const mod = await import(url)
  if (typeof mod.buildStateSpec === 'function') return mod.buildStateSpec()
  throw new Error('lib/index.js 未导出 buildStateSpec（src/host/state.ts 需 export 它）')
}

/** 键编解码往返（断言 host 层对客户端透明）。 */
function decodeRoundTrip(mod, encoded) {
  return mod.decodeStateKey(encoded)
}

await main()
