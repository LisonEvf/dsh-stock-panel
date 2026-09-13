// scripts/smoke-host-state.mjs —— host 半离线冒烟（无需 DSH 宿主）
//
// 用法：
//   pnpm build && node scripts/smoke-host-state.mjs
//
// 目的：host 半此前**没有任何离线覆盖**（唯一的 host 冒烟 smoke-embedded 需要真机行情）。
// 本脚本在 Node 里加载 lib/index.js，喂一个假 ctx，断言：
//   1. 三条同源路由都注册了（call / build / state），且都是 exact；
//   2. GET /api/stock-panel/build → { version: package.json, buildId: 8 位十六进制 }；
//   3. 持久化领域的 spec 契约正确：领域名合法（^[a-z][a-z0-9_]*$，不能有连字符）、
//      version=1、layout=per-record、9 张表（含 UX-B3 新增的 review_draft）且每张带 valueSchema.parse、global schema 拒绝 null；
//   4. GET /api/stock-panel/state → 全量快照（含全部表）；POST 写入后能被 GET 读到；
//   5. **降级**：宿主没挂 storageDomain 时，GET 返回 available:false + 原因，且 apply 不抛异常。
//
// 注：不触碰真实 TDX、不写任何文件（storageDomain 用内存假实现）。

import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const HOST_BUNDLE = join(ROOT, 'lib', 'index.js')
const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'))

let failures = 0
/** 断言：记录失败但不中断（跑完全部用例后统一退出码）。 */
function assert(cond, msg) {
  if (cond) {
    console.log(`  ✅ ${msg}`)
  } else {
    failures += 1
    console.error(`  ❌ ${msg}`)
  }
}

/** 假 res：收集 statusCode / 头 / body。 */
function makeRes() {
  const out = { statusCode: 0, headers: {}, body: '' }
  return {
    out,
    res: {
      set statusCode(v) {
        out.statusCode = v
      },
      get statusCode() {
        return out.statusCode
      },
      setHeader(k, v) {
        out.headers[k] = v
      },
      end(b) {
        out.body = b
      },
    },
  }
}

/** 假 req：GET 用 { method }；POST 附带 async-iterable body。 */
function makeReq(method, body) {
  const req = { method, headers: {} }
  if (body !== undefined) {
    const buf = Buffer.from(JSON.stringify(body), 'utf8')
    req[Symbol.asyncIterator] = async function* () {
      yield buf
    }
  }
  return req
}

/**
 * 内存版 storageDomain 假实现（严格按实测契约：open / table / global / close）。
 * @param {object} [recorder] 用于把 open 收到的 spec 回传出来做断言
 */
function makeFacility(recorder) {
  return {
    async open(spec) {
      if (recorder) recorder.spec = spec
      const tables = new Map()
      for (const name of Object.keys(spec.tables)) tables.set(name, new Map())
      let global = { ...spec.global.initial }
      return {
        name: spec.name,
        global: {
          get: () => global,
          set: async (v) => {
            global = v
          },
        },
        table(name) {
          const m = tables.get(name)
          if (m === undefined) throw new Error(`declares no table '${name}'`)
          return {
            get: (k) => m.get(k),
            entries: () => [...m.entries()][Symbol.iterator](),
            keys: () => [...m.keys()][Symbol.iterator](),
            get size() {
              return m.size
            },
            put: async (k, v) => {
              // 走一次 schema，确保 spec 里的 schema 真的可用
              spec.tables[name].valueSchema.parse(v)
              m.set(k, v)
            },
            delete: async (k) => m.delete(k),
          }
        },
        close: async () => {},
      }
    },
  }
}

/** 组装假 ctx（webServer 记录注册的路由）。 */
function makeCtx({ storageDomain }) {
  const routes = []
  const ctx = {
    provide() {},
    webServer: {
      register(route) {
        routes.push(route)
        return () => {}
      },
    },
    tools: { register: () => () => {} },
  }
  if (storageDomain !== undefined) ctx.storageDomain = storageDomain
  return { ctx, routes }
}

/**
 * 假 ctx（含 cordis 的 ctx.inject），**模拟真实 cordis 的作用域语义**：
 * 服务挂在「被声明过依赖的那个 scoped ctx」上，**外层 ctx 上没有它**
 * —— 这正是真机第二轮踩到的坑（回调用外层 ctx → 永远读不到服务）。
 *
 * @param {{ onOuter?: object, onScoped?: object }} opts onOuter = 外层 ctx 可见的服务；onScoped = scoped ctx 可见的服务
 */
function makeCtxWithInject(opts = {}) {
  const routes = []
  const injectCalls = []
  const ctx = {
    provide() {},
    webServer: {
      register(route) {
        routes.push(route)
        return () => {}
      },
    },
    tools: { register: () => () => {} },
    inject(deps, cb) {
      injectCalls.push(deps)
      // 模拟 cordis：服务就绪后，用**一个新作用域**调用回调，服务只挂在该作用域上。
      const scoped = { ...ctx }
      if (opts.onScoped !== undefined) scoped.storageDomain = opts.onScoped
      return cb(scoped)
    },
  }
  if (opts.onOuter !== undefined) ctx.storageDomain = opts.onOuter
  return { ctx, routes, injectCalls }
}

/** 按 path 找已注册路由。 */
function routeOf(routes, path) {
  return routes.find((r) => r.path === path)
}

const moduleUrl = pathToFileURL(HOST_BUNDLE).href

async function main() {
  if (!existsSync(HOST_BUNDLE)) {
    console.error(`[smoke-host-state] 缺 ${HOST_BUNDLE} —— 先 pnpm build`)
    process.exit(1)
  }

  console.log('[1] 路由注册（假 ctx + 假 storageDomain）')
  const recorder = {}
  const modA = await import(moduleUrl + '?case=a')
  const a = makeCtx({ storageDomain: makeFacility(recorder) })
  modA.apply(a.ctx)
  const callRoute = routeOf(a.routes, '/api/stock-panel/call')
  const buildRoute = routeOf(a.routes, '/api/stock-panel/build')
  const stateRoute = routeOf(a.routes, '/api/stock-panel/state')
  assert(callRoute !== undefined, 'TDX 桥接路由已注册（/api/stock-panel/call）')
  assert(buildRoute !== undefined, '构建信息路由已注册（/api/stock-panel/build）')
  assert(stateRoute !== undefined, '持久化路由已注册（/api/stock-panel/state）')
  assert(
    [callRoute, buildRoute, stateRoute].every((r) => r?.kind === 'exact'),
    '三条路由均为 exact 匹配',
  )

  console.log('[2] GET /api/stock-panel/build')
  {
    const { res, out } = makeRes()
    await buildRoute.handler(makeReq('GET'), res)
    const body = JSON.parse(out.body)
    assert(out.statusCode === 200, `HTTP 200（实际 ${out.statusCode}）`)
    assert(body.version === pkg.version, `version = package.json（${body.version}）`)
    assert(/^[0-9a-f]{8}$/.test(body.buildId), `buildId 是 8 位十六进制（${body.buildId}）`)
  }

  console.log('[3] 持久化领域的 spec 契约')
  /** 声明的表清单（块 [3]/[4] 共用：块内 let 会掉进块作用域，之前就在这里踩过）。 */
  let declaredTables = []
  {
    const spec = recorder.spec
    assert(spec !== undefined, 'facility.open 被调用（说明域已初始化）')
    const UNIT_NAME_RE = /^[a-z][a-z0-9_]*$/
    assert(UNIT_NAME_RE.test(spec.name), `领域名合法且无连字符（'${spec.name}'）`)
    assert(spec.version === 1, `领域版本固定为 1（${spec.version}）—— 避免 version-mismatch 无迁移`)
    assert(spec.layout === 'per-record', `layout = per-record（${spec.layout}）`)
    assert(spec.invalidRecords === 'backup-and-skip', '单条坏记录不阻塞整域打开')
    const tables = Object.keys(spec.tables)
    // 表清单**从唯一定义源核对**（不再写死 9）：声明表 ↔ spec 表必须一一对应，
    // 少了会漏迁、多了会开出没人写的空表。脚本此前硬编码 9/8，实测已与代码漂移过。
    declaredTables = (modA.STATE_TABLES ?? []).map((t) => t.table)
    assert(declaredTables.length > 0, `lib/index.js 导出 STATE_TABLES（${declaredTables.length} 张）`)
    assert(
      tables.length === declaredTables.length && declaredTables.every((t) => tables.includes(t)),
      `spec 表 = STATE_TABLES（spec ${tables.length} / 声明 ${declaredTables.length}：${tables.join(',')}）`,
    )
    assert(
      tables.every((t) => typeof spec.tables[t].valueSchema?.parse === 'function'),
      '每张表都带 valueSchema.parse（子系统逐条校验要用）',
    )
    assert(
      spec.global?.schema?.safeParse(null).success === false,
      'global schema 拒绝 null（null 是介质「从未写入」哨兵，契约要求拒绝）',
    )
    assert(typeof spec.global?.initial?.schemaVersion === 'number', 'global 带 schemaVersion（自有迁移用）')
  }

  console.log('[4] GET / POST /api/stock-panel/state')
  {
    const { res, out } = makeRes()
    await stateRoute.handler(makeReq('GET'), res)
    const snap = JSON.parse(out.body)
    assert(out.statusCode === 200, `GET HTTP 200（实际 ${out.statusCode}）`)
    assert(snap.available === true, `可用（available=${snap.available}）`)
    assert(snap.domain === 'stock_panel', `域 = stock_panel（${snap.domain}）`)
    assert(
      snap.tables && Object.keys(snap.tables).length === declaredTables.length,
      `快照含全部 ${declaredTables.length} 张表（实际 ${Object.keys(snap.tables ?? {}).length}）`,
    )

    const put = { table: 'watchlist', key: 'SH600519', value: { market: 'SH', code: '600519', name: '贵州茅台' } }
    const pr = makeRes()
    await stateRoute.handler(makeReq('POST', put), pr.res)
    const pbody = JSON.parse(pr.out.body)
    assert(pbody.ok === true && pbody.written === 1, `POST 写入成功（written=${pbody.written}）`)

    const g2 = makeRes()
    await stateRoute.handler(makeReq('GET'), g2.res)
    const snap2 = JSON.parse(g2.out.body)
    assert(
      snap2.tables.watchlist?.['SH600519']?.name === '贵州茅台',
      'GET 能读回刚写入的记录（写→读闭环）',
    )

    const bad = makeRes()
    await stateRoute.handler(makeReq('POST', { table: 'nope', key: 'x', value: { a: 1 } }), bad.res)
    const badBody = JSON.parse(bad.out.body)
    assert(badBody.ok === false && /未声明/.test(badBody.error), `未声明的表被拒（${badBody.error}）`)

    const del = makeRes()
    await stateRoute.handler(makeReq('POST', { table: 'watchlist', key: 'SH600519', delete: true }), del.res)
    assert(JSON.parse(del.out.body).deleted === 1, 'DELETE 语义（delete:true）生效')
  }

  console.log('[5] 降级：宿主未挂 storageDomain（不得崩溃，且如实说明）')
  {
    const modB = await import(moduleUrl + '?case=b')
    const b = makeCtx({})
    let threw = false
    try {
      modB.apply(b.ctx)
    } catch {
      threw = true
    }
    assert(!threw, 'apply 不抛异常（GUI/行情链路不受影响）')
    const stateRouteB = routeOf(b.routes, '/api/stock-panel/state')
    assert(stateRouteB !== undefined, '降级时路由仍注册（前端可据此显示原因）')
    const { res, out } = makeRes()
    await stateRouteB.handler(makeReq('GET'), res)
    const snap = JSON.parse(out.body)
    assert(snap.available === false, `如实地报不可用（available=${snap.available}）`)
    assert(typeof snap.reason === 'string' && snap.reason.length > 0, `给出原因（${snap.reason}）`)
  }

  // ⚠️ 回归用例：**真机实测踩到的 bug** —— 存储服务晚于 apply 挂载时，
  // 旧实现把「不可用」永久缓存，导致运行实例一直报告 ctx.storageDomain 不可用。
  console.log('[6] 服务晚到：apply 时没有 storageDomain，之后才挂上 → 请求时应自愈')
  {
    const modC = await import(moduleUrl + '?case=c')
    const c = makeCtx({})
    modC.apply(c.ctx)
    const stateRouteC = routeOf(c.routes, '/api/stock-panel/state')
    const before = makeRes()
    await stateRouteC.handler(makeReq('GET'), before.res)
    assert(
      JSON.parse(before.out.body).available === false,
      '服务未挂时如实报不可用（第一次请求）',
    )
    // 服务此刻挂上（模拟 cordis 稍后完成挂载）
    c.ctx.storageDomain = makeFacility({})
    const after = makeRes()
    await stateRouteC.handler(makeReq('GET'), after.res)
    const snapAfter = JSON.parse(after.out.body)
    assert(
      snapAfter.available === true,
      `服务挂上后**无需重启**即自愈（available=${snapAfter.available}）—— 不可用结论不再被永久缓存`,
    )
    assert(
      snapAfter.facilitySource === 'ctx.storageDomain',
      `诊断里能看到服务来源（${snapAfter.facilitySource}）`,
    )
  }

  console.log('[7] 服务挂载在 hub 上（ctx.storage.domain）时也能解析')
  {
    const modD = await import(moduleUrl + '?case=d')
    const d = makeCtx({})
    d.ctx.storage = { domain: makeFacility({}) } // 文档：与 ctx.storageDomain 同一个对象
    modD.apply(d.ctx)
    const route = routeOf(d.routes, '/api/stock-panel/state')
    const { res, out } = makeRes()
    await route.handler(makeReq('GET'), res)
    const snap = JSON.parse(out.body)
    assert(snap.available === true, `hub 路径可解析（available=${snap.available}）`)
    assert(snap.facilitySource === 'ctx.storage.domain', `来源=${snap.facilitySource}`)
  }

  console.log('[8] 声明式注入：apply 会向 cordis 声明 storageDomain，并用 scoped ctx 打开领域')
  {
    const modE = await import(moduleUrl + '?case=e')
    // 关键：服务**只挂在 scoped ctx 上**（真实 cordis 语义）——外层 ctx 上没有它。
    // 若实现回调用外层 ctx，本用例必然失败（这正是真机第二轮踩到的坑）。
    const e = makeCtxWithInject({ onScoped: makeFacility({}) })
    modE.apply(e.ctx)
    assert(
      e.injectCalls.some((deps) => Array.isArray(deps) && deps.includes('storageDomain')),
      `ctx.inject 声明了 storageDomain（实际：${JSON.stringify(e.injectCalls)}）`,
    )
    const route = routeOf(e.routes, '/api/stock-panel/state')
    const { res, out } = makeRes()
    await route.handler(makeReq('GET'), res)
    const snap = JSON.parse(out.body)
    assert(
      snap.available === true,
      `只挂在 scoped ctx 上的服务也能用（available=${snap.available}）—— 回调用外层 ctx 就会失败`,
    )
    assert(snap.facilitySource === 'ctx.storageDomain', `来源=${snap.facilitySource}`)
  }

  console.log('[9] 真机取证增强：不可用时必须交代 inject 声明与回调触发情况')
  {
    const modF = await import(moduleUrl + '?case=f')
    const f = makeCtxWithInject({ onScoped: undefined }) // 服务始终不存在
    modF.apply(f.ctx)
    const route = routeOf(f.routes, '/api/stock-panel/state')
    const { res, out } = makeRes()
    await route.handler(makeReq('GET'), res)
    const snap = JSON.parse(out.body)
    assert(snap.available === false, '服务不存在时如实报不可用')
    assert(
      typeof snap.reason === 'string' && snap.reason.includes('inject 已声明=是') && snap.reason.includes('回调已触发='),
      `原因里带取证字段（${snap.reason}）`,
    )
  }

  if (failures > 0) {
    console.error(`[smoke-host-state] ${failures} 项断言失败`)
    process.exit(1)
  }
  console.log('[smoke-host-state] 全部通过 ✅')
}

await main()
