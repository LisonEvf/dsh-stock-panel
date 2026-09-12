// scripts/smoke-naming.mjs —— A2b 命名桥接的离线冒烟（无需 DSH 宿主、不连 TDX、不调真模型）
//
// 用法：
//   pnpm build && node scripts/smoke-naming.mjs
//
// 目的：`tests/naming-*.test.ts` 验的是 **src 源码**；本脚本验的是**构建产物** lib/index.js ——
// 两者会分叉（打包目标、tree-shaking、node 内置依赖都会在这里暴露）。断言：
//   1. 命名路由已注册（exact + /api/stock-panel/naming）；
//   2. GET 回的是「能力 + 口径」：模型名、提示词版本、默认参数（window/min_corr/pool_n）、
//      护栏阈值、采集预算、缓存规模 —— 这些必须由 host 半给出，界面不各自硬编码；
//   3. POST 参数校验：classId 缺失/非正数 → 400（不猜默认值）；
//   4. **全链路**（注入假工具 + 假模型）：合规引文 → named；编造引文 → no_common + guard_rejected；
//      第二次同口径调用命中缓存（不再调模型）—— 缓存与护栏都是"构建产物里真的生效"；
//   5. 弱链伪类 → 拒绝命名且**零模型调用**。

import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const HOST_BUNDLE = join(ROOT, 'lib', 'index.js')
const ROUTE = '/api/stock-panel/naming'

let failures = 0
function assert(cond, msg) {
  if (cond) console.log(`  ✅ ${msg}`)
  else {
    failures += 1
    console.error(`  ❌ ${msg}`)
  }
}

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

const AS_OF = '2026-09-11'
const MEMBERS = [
  { market: 'SZ', code: '300308', name: '中际旭创', chg_pct: 4.03 },
  { market: 'SZ', code: '300502', name: '新易盛', chg_pct: 2.94 },
]

/** 假工具层：hist_concept_* / belong_board / kline / unusual。 */
function makeCallTool(opts = {}) {
  const calls = []
  const callTool = async (name, args) => {
    calls.push({ name, args })
    switch (name) {
      case 'hist_concept_class':
        return {
          ok: true,
          as_of: AS_OF,
          meta: { as_of: AS_OF, window: 90, min_corr: 0.6, pool_n: 200, n_classes: 10 },
          class: { class_id: 6, size: 2, mean_intra_corr: 0.6675 },
          members: MEMBERS,
        }
      case 'hist_concept_classes':
        return { ok: true, as_of: AS_OF, classes: [{ class_id: 6, size: 2, weak_chain: Boolean(opts.weakChain) }] }
      case 'belong_board':
        return [
          { board_type: '4', board_name: 'CPO概念' },
          { board_type: '12', board_name: '通信设备' },
        ]
      case 'kline':
        return [
          { date: '2026-09-10', open: 10, high: 10.2, low: 9.9, close: 10, volume: 1000 },
          { date: '2026-09-11', open: 10.5, high: 12, low: 10.4, close: 12, volume: 3000 },
        ]
      case 'unusual':
        return [{ code: '300308', name: '中际旭创', time: '10:03', desc: '加速拉升', value: 6.2 }]
      case 'market_monitor':
        return []
      default:
        throw new Error(`未预期的工具调用：${name}`)
    }
  }
  return { callTool, calls }
}

/** 假模型（流式吐 JSON）。 */
function makeLlm(payload) {
  let calls = 0
  return {
    calls: () => calls,
    llm: {
      stream() {
        calls += 1
        const text = typeof payload === 'string' ? payload : JSON.stringify(payload)
        return (async function* () {
          for (const part of text.match(/.{1,40}/gs) ?? []) yield { type: 'text-delta', text: part }
          yield { type: 'finish', reason: { kind: 'stop' } }
        })()
      },
    },
  }
}

const goodPayload = {
  verdict: 'named',
  theme: '光模块',
  confidence: 0.8,
  alternatives: ['CPO'],
  evidence: [
    { stock: '300308 中际旭创', quote: 'CPO概念', ts: `${AS_OF} 15:00` },
    { stock: '300502 新易盛', quote: 'CPO概念', ts: `${AS_OF} 15:00` },
  ],
  reasoning: '两票概念板块同时指向 CPO。',
}

const mod = await import(pathToFileURL(HOST_BUNDLE).href)

// ── 1) 路由注册 ──
const routes = []
const fakeCtx = {
  provide() {},
  webServer: {
    register(route) {
      routes.push(route)
      return () => {}
    },
  },
  tools: { register: () => () => {} },
  llm: makeLlm(goodPayload).llm,
  agentDefaultModel: { currentSelection: () => ({ provider: 'smoke-provider', model: 'smoke-model' }) },
}
mod.apply(fakeCtx)

console.log('[1] 路由注册')
const namingRoute = routes.find((r) => r.path === ROUTE)
assert(namingRoute !== undefined, `已注册 ${ROUTE}`)
assert(namingRoute?.kind === 'exact', '注册为 exact 路由')

// ── 2) GET：能力 + 口径 ──
console.log('[2] GET 能力与口径')
{
  const { res, out } = makeRes()
  await namingRoute.handler(makeReq('GET'), res)
  const payload = JSON.parse(out.body)
  assert(out.statusCode === 200, 'HTTP 200')
  assert(payload.ok === true, 'ok=true')
  assert(payload.available === true, `模型可用（${payload.provider}/${payload.model}）`)
  assert(typeof payload.promptVersion === 'string' && payload.promptVersion.length > 0, `提示词版本回传（${payload.promptVersion}）`)
  assert(
    payload.defaults?.window === 90 && payload.defaults?.minCorr === 0.6 && payload.defaults?.poolN === 200,
    '默认参数 = 校准推荐值（window 90 / min_corr 0.6 / pool_n 200）',
  )
  assert(payload.guard?.minEvidenceScore === 0.6 && payload.guard?.minCoverage === 0.5, '护栏阈值随能力一起回传')
  assert(payload.guard?.enforceEvidenceWindow === true, 'A6 时间窗护栏默认开启')
  assert(typeof payload.collect?.maxChars === 'number', '采集预算回传')
}

// ── 3) POST 参数校验 ──
console.log('[3] POST 参数校验')
for (const [body, label] of [
  [{}, '缺少 classId'],
  [{ classId: 0 }, 'classId=0'],
  [{ classId: 'abc' }, 'classId 非数字'],
]) {
  const { res, out } = makeRes()
  await namingRoute.handler(makeReq('POST', body), res)
  assert(out.statusCode === 400, `${label} → 400（不猜默认值）`)
}

// ── 4) 全链路（假工具 + 假模型）──
console.log('[4] 全链路：采集 → 模型 → 护栏 → 缓存')
{
  mod.clearNamingCache()
  const llm = makeLlm(goodPayload)
  const { callTool, calls } = makeCallTool()
  const rt = {
    callTool,
    llm: llm.llm,
    route: { provider: 'smoke-provider', model: 'smoke-model' },
    today: AS_OF,
  }
  const out = await mod.nameClass(rt, { classId: 6 })
  assert(out.ok === true, '命名成功返回')
  assert(out.result.verdict === 'named' && out.result.theme === '光模块', `结论 named「${out.result.theme}」`)
  assert(out.result.evidenceCount === 2 && out.result.evidenceCoverage === 1, '两条有效证据、覆盖度 100%')
  assert(out.result.evidenceScore >= 0.6, `证据分过门（${out.result.evidenceScore}）`)
  assert(out.result.degradedReason === 'none', '无降级')
  assert(calls.some((c) => c.name === 'unusual'), 'as_of = 今日 → 采了实时异动')
  assert(out.sourcesUsed.includes('belong_board') && out.sourcesUsed.includes('kline'), '板块与日K都采到')

  const again = await mod.nameClass(rt, { classId: 6 })
  assert(again.cached === true && llm.calls() === 1, '同口径第二次命中缓存（模型只调一次）')

  // 幻觉引文
  const halluc = makeLlm({
    verdict: 'named',
    theme: '光模块',
    confidence: 0.99,
    evidence: [{ stock: '300308 中际旭创', quote: '两公司同日公告共建 1.6T 产线' }],
    reasoning: '编造',
  })
  const { callTool: ct2 } = makeCallTool()
  const r2 = await mod.nameClass(
    { callTool: ct2, llm: halluc.llm, route: { provider: 'smoke-provider', model: 'smoke-model' }, today: AS_OF },
    { classId: 6, windowDays: 9 },
  )
  assert(r2.ok === true && r2.result.verdict !== 'named', `编造引文 → 不得 named（实际 ${r2.result.verdict}）`)
  assert(r2.result.theme === null, '降级后不得保留主题名')
  assert(r2.result.degradedReason === 'guard_rejected', '成因 = 被护栏拒')
}

// ── 5) 弱链伪类拒绝 ──
console.log('[5] 弱链伪类拒绝命名')
{
  const llm = makeLlm(goodPayload)
  const { callTool } = makeCallTool({ weakChain: true })
  const out = await mod.nameClass(
    { callTool, llm: llm.llm, route: { provider: 'smoke-provider', model: 'smoke-model' }, today: AS_OF },
    { classId: 6, windowDays: 11 },
  )
  assert(out.ok === false && out.reason === 'weak_chain', '拒绝并说明原因')
  assert(llm.calls() === 0, '拒绝时零模型调用（不浪费预算）')
}

console.log(failures === 0 ? '\n[smoke-naming] 全部通过 ✅' : `\n[smoke-naming] ${failures} 项失败 ❌`)
process.exit(failures === 0 ? 0 : 1)
