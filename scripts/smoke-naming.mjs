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
  assert(
    payload.collect?.newsEnabled === true && typeof payload.collect?.newsPages === 'number',
    '快讯源开关与翻页上限随能力回传（它是唯一会出网到非通达信的素材源，口径必须可见）',
  )
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
    route: { provider: 'smoke-provider', model: 'smoke-model' }, news: false,
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
    // news: false 同 [4b]① —— 不传就会真的出网抓快讯，这条"离线冒烟"会退化成 20s+ 的网络用例
    { callTool: ct2, llm: halluc.llm, route: { provider: 'smoke-provider', model: 'smoke-model' }, news: false, today: AS_OF },
    { classId: 6, windowDays: 9 },
  )
  assert(r2.ok === true && r2.result.verdict !== 'named', `编造引文 → 不得 named（实际 ${r2.result.verdict}）`)
  assert(r2.result.theme === null, '降级后不得保留主题名')
  assert(r2.result.degradedReason === 'guard_rejected', '成因 = 被护栏拒')
}

// ── 4b) 归因口径：逐源状态 + 系统成因（不把"按设计跳过"写成"采集失败"）──
console.log('[4b] 归因口径：逐源状态 / 系统成因模板')
{
  mod.clearNamingCache()
  // ① as_of = 今日：四个源都应给出状态，且都没有失败
  //
  // news: false 必须显式传：下面两条断言要求的是「被**调用方**显式关闭」。
  // 漏传时快讯源会真的出网（本脚本自称"离线冒烟"，实测会抓 1000+ 条快讯、耗时 30s+），
  // 且状态变成 no_material → 两条断言必红；而如果改用 DSH_STOCK_PANEL_NEWS=0 关闭，
  // 又会让 [2] 的 collect.newsEnabled === true 不成立 —— 两条断言互斥，没有任何配置能全绿。
  const { callTool } = makeCallTool()
  const out = await mod.nameClass(
    {
      callTool,
      llm: makeLlm(goodPayload).llm,
      route: { provider: 'smoke-provider', model: 'smoke-model' },
      news: false,
      today: AS_OF,
    },
    { classId: 6 },
  )
  assert(out.ok === true, '命名成功返回')
  const st = out.result.sourceStatus ?? []
  assert(
    st.length === mod.NAMING_SOURCES.length,
    `逐源状态应与素材源清单一一对应（实际 ${st.length} / 清单 ${mod.NAMING_SOURCES.length}）`,
  )
  assert(typeof out.result.causeNote === 'string' && out.result.causeNote.length > 0, '系统成因非空')
  assert(!st.some((s) => s.status === 'failed'), '本次没有任何源失败')
  assert(!out.result.causeNote.includes('**采集失败**'), `没有失败源时不得给出失败归因：${out.result.causeNote}`)
  // 快讯源在离线冒烟里被显式关闭 → 必须如实记「按设计跳过」，而不是静默缺席（缺一个源也是一种归因错误）
  const news = st.find((s) => s.source === 'news_flash')
  assert(news !== undefined, '快讯源也要有状态（不许静默缺席）')
  assert(news?.status === 'skipped_by_design', '离线冒烟里快讯源被显式关闭 → 按设计跳过')
  assert(String(news?.detail ?? '').includes('显式关闭'), `关闭原因要写清（实际：${news?.detail}）`)

  // ② as_of ≠ 今日：实时源必须是「按设计跳过」，而不是失败
  mod.clearNamingCache()
  const { callTool: ct3 } = makeCallTool()
  const hist = await mod.nameClass(
    {
      callTool: ct3,
      llm: makeLlm(goodPayload).llm,
      route: { provider: 'smoke-provider', model: 'smoke-model' }, news: false,
      today: '2099-01-01',
    },
    { classId: 6 },
  )
  assert(hist.ok === true, '历史 as_of 也能给出结论（素材不足则如实降级）')
  const bySource = new Map((hist.result.sourceStatus ?? []).map((s) => [s.source, s]))
  assert(bySource.get('unusual')?.status === 'skipped_by_design', '实时源按设计跳过')
  assert(bySource.get('market_monitor')?.status === 'skipped_by_design', '实时源按设计跳过')
  assert(bySource.get('kline')?.status !== 'failed', '未抛错的源不得标成失败')
  assert(hist.result.causeNote.includes('按设计跳过'), `成因要写清设计取舍：${hist.result.causeNote}`)
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

// ── 6) 批量命名（类列表默认路径：打开即命名归类 + 按强度排序 + 涨幅/涨停数）──
console.log('[6] 批量命名：分组命名 + 分组护栏 + 整批 memo')
{
  mod.clearNamingCache()
  const BATCH_AS_OF = '2026-09-11'
  const MEMBERS_BY_CLASS = {
    2: [
      { market: 'SZ', code: '300308', name: '中际旭创', chg_pct: 4.03 },
      { market: 'SZ', code: '300502', name: '新易盛', chg_pct: 2.94 },
    ],
    3: [
      { market: 'SH', code: '600519', name: '贵州茅台', chg_pct: -1.2 },
      { market: 'SH', code: '601318', name: '中国平安', chg_pct: 0.4 },
    ],
  }
  const calls = []
  const batchCallTool = async (name, args) => {
    calls.push(name)
    switch (name) {
      case 'hist_concept_classes':
        // 强度刻意乱序：批量必须按强度降序挑目标（最猛的班先有名字）
        return {
          ok: true,
          as_of: BATCH_AS_OF,
          meta: { as_of: BATCH_AS_OF, window: 90, min_corr: 0.6, pool_n: 200, n_classes: 3 },
          classes: [
            { class_id: 3, size: 2, mean_intra_corr: 0.7, strong_density: 1, weak_chain: false, strength: 1.2 },
            { class_id: 2, size: 2, mean_intra_corr: 0.6675, strong_density: 1, weak_chain: false, strength: 12.4 },
            { class_id: 1, size: 6, mean_intra_corr: 0.01, strong_density: 0.02, weak_chain: true, strength: 0.1 },
          ],
        }
      case 'hist_concept_class':
        return {
          ok: true,
          as_of: BATCH_AS_OF,
          meta: { as_of: BATCH_AS_OF, n_classes: 3 },
          class: { class_id: Number(args.class_id), size: 2 },
          members: MEMBERS_BY_CLASS[Number(args.class_id)] ?? [],
        }
      case 'belong_board':
        return args.code === '300308' || args.code === '300502'
          ? [{ board_type: '4', board_name: 'CPO概念' }]
          : [{ board_type: '12', board_name: '酿酒行业' }]
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
  const batchPayload = {
    results: [
      { class_id: 2, ...goodPayload },
      {
        class_id: 3,
        verdict: 'named',
        theme: '白酒',
        confidence: 0.6,
        // 跨组借证据：这句引文只存在于第 2 组语料 → 第 3 组必须被护栏拒
        evidence: [{ stock: '600519 贵州茅台', quote: 'CPO概念', ts: `${BATCH_AS_OF} 15:00` }],
        reasoning: '借用邻组证据',
      },
    ],
  }
  const llm = makeLlm(batchPayload)
  const rt = {
    callTool: batchCallTool,
    llm: llm.llm,
    route: { provider: 'smoke-provider', model: 'smoke-model' }, news: false,
    today: BATCH_AS_OF,
  }
  const out = await mod.nameClasses(rt, {})
  assert(out.ok === true, '批量返回成功')
  assert(out.llmCalls === 1, `两组一批 → 一次模型调用（实际 ${out.llmCalls}）`)
  assert(out.targetCount === 2, '弱链类不进目标（零额外调用）')
  const byId = new Map(out.entries.map((e) => [e.classId, e]))
  assert(byId.get(1)?.skipReason === 'weak_chain', '弱链伪类如实标注跳过原因')
  assert(byId.get(2)?.naming?.theme === '光模块', `第 2 组 named（${byId.get(2)?.naming?.theme}）`)
  assert(byId.get(3)?.naming?.verdict !== 'named', '跨组借证据的第 3 组不得 named')
  assert(byId.get(3)?.naming?.degradedReason === 'guard_rejected', '成因 = 被护栏拒')
  assert(byId.get(2)?.members?.length === 2, '成员随结论一起回传（界面零二次取数）')
  assert(
    calls.filter((c) => c === 'hist_concept_class').length === 2,
    '逐类取成员（引擎快照已缓存 → 纯 CPU）',
  )

  const again = await mod.nameClasses(rt, {})
  assert(again.ok === true && again.memoHit === true, '同口径第二次命中整批 memo')
  assert(again.llmCalls === 0 && llm.calls() === 1, '命中 memo 不再调模型')
  const added = calls.slice(calls.length - 1)
  assert(added[0] === 'hist_concept_classes', '命中 memo 时只再读一次类表（不再采集素材）')

  const forced = await mod.nameClasses(rt, { refresh: true })
  assert(forced.ok === true && forced.llmCalls === 1 && llm.calls() === 2, 'refresh 必须真的重算')
}

console.log(failures === 0 ? '\n[smoke-naming] 全部通过 ✅' : `\n[smoke-naming] ${failures} 项失败 ❌`)
process.exit(failures === 0 ? 0 : 1)
