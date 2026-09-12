/**
 * tests/naming-pipeline.test.ts —— A2b-② 命名全链路（采集 → 模型 → 护栏 → 缓存）离线测试。
 *
 * 依赖全部注入（`callTool` / `llm` / `route` / `ensureToday`），所以这里不发一次网络请求、
 * 不碰 TDX、不调真模型，却能把**接线后的整条链路**跑通 —— 这正是当初把依赖设计成参数的目的。
 *
 * 本文件锁的是接线层的契约（护栏本身的细则在 naming-guard.test.ts）：
 *   ① 实时源的时间性：as_of ≠ 当前交易日时**不得**采异动/监控（否则等于给历史结论造当天证据）；
 *   ② 弱链伪类拒绝命名，且**不产生 LLM 调用**；
 *   ③ 缓存命中不产生第二次 LLM 调用；指纹变化 / refresh 则必须重算；
 *   ④ 模型不可用 / 输出畸形 / 幻觉引文 → 结构化降级，且素材照采（好看清"素材有、模型没有"）。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { nameClass, namingAvailability, namingCacheStats, clearNamingCache, type NamingRuntime } from '../src/host/naming/run.ts'
import type { NameClassOutcome, NameClassSuccess } from '../src/host/naming/run.ts'
import { collectMaterials, filterMarketRows, limitUpTypeOf, toCandles } from '../src/host/naming/collect.ts'

const AS_OF = '2026-09-11'
const TODAY = '2026-09-11'

const MEMBERS = [
  { market: 'SZ', code: '300308', name: '中际旭创', chg_pct: 4.03 },
  { market: 'SZ', code: '300502', name: '新易盛', chg_pct: 2.94 },
]

/** 日K：末两根 10 → 12（创业板 20% 涨停）→ 1 连板（换手板）。 */
function candles(): Array<Record<string, unknown>> {
  return [
    { date: '2026-09-09', open: 9.9, high: 10.1, low: 9.8, close: 10, volume: 1000 },
    { date: '2026-09-10', open: 10, high: 10.2, low: 9.9, close: 10, volume: 1000 },
    { date: '2026-09-11', open: 10.5, high: 12, low: 10.4, close: 12, volume: 3000 },
  ]
}

/** 记录调用次数的假工具层。 */
function fakeTools(opts: { weakChain?: boolean; classOk?: boolean; throwOnClass?: boolean } = {}) {
  const calls: string[] = []
  const callTool = async (name: string, args: Record<string, unknown>): Promise<unknown> => {
    calls.push(name)
    switch (name) {
      case 'hist_concept_class':
        if (opts.throwOnClass) throw new Error('embedded TDX unavailable')
        if (opts.classOk === false) return { ok: false, error: '可用池 <10 只，无法共聚' }
        return {
          ok: true,
          as_of: AS_OF,
          meta: { as_of: AS_OF, window: 90, min_corr: 0.6, pool_n: 200, n_classes: 10 },
          class: { class_id: 6, size: 2, mean_intra_corr: 0.6675, strong_density: 1 },
          members: MEMBERS,
        }
      case 'hist_concept_classes':
        return {
          ok: true,
          as_of: AS_OF,
          classes: [{ class_id: 6, size: 2, weak_chain: Boolean(opts.weakChain) }],
        }
      case 'belong_board':
        return [
          { board_type: '4', board_name: 'CPO概念' },
          { board_type: '12', board_name: '通信设备' },
          { board_type: '4', board_name: '含可转债' },
        ]
      case 'kline':
        return candles()
      case 'unusual':
        return [
          { code: '300308', name: '中际旭创', time: '10:03', desc: '加速拉升', value: 6.2 },
          { code: '600000', name: '别人的票', time: '10:05', desc: '加速拉升', value: 3 },
        ]
      case 'market_monitor':
        return [{ code: '300502', name: '新易盛', time: '10:10', desc: '大单净流入', value: 1200 }]
      default:
        throw new Error(`未预期的工具调用：${name}`)
    }
  }
  return { callTool, calls }
}
/** 假模型：把 payload 分块吐出来，模仿流式正文。 */
function fakeLlm(payload: unknown, opts: { throws?: string } = {}) {
  let calls = 0
  const llm: NamingRuntime['llm'] = {
    // eslint-disable-next-line require-yield
    stream() {
      calls += 1
      const text = typeof payload === 'string' ? payload : JSON.stringify(payload)
      async function* gen() {
        if (opts.throws) throw new Error(opts.throws)
        for (const part of text.match(/.{1,40}/gs) ?? []) {
          yield { type: 'text-delta', text: part }
        }
        yield { type: 'finish', reason: { kind: 'stop' } }
      }
      return gen()
    },
  }
  return { llm, calls: () => calls }
}

/** 合规的模型输出：引文逐字来自采集到的素材。 */
function goodPayload() {
  return {
    verdict: 'named',
    theme: '光模块',
    confidence: 0.8,
    alternatives: ['CPO'],
    evidence: [
      { stock: '300308 中际旭创', quote: 'CPO概念', ts: `${AS_OF} 15:00` },
      { stock: '300502 新易盛', quote: 'CPO概念', ts: `${AS_OF} 15:00` },
    ],
    reasoning: '两只票的概念板块同时指向 CPO，且当日均有封板/放量信号。',
  }
}

function runtime(over: Partial<NamingRuntime> = {}, toolOpts: Parameters<typeof fakeTools>[0] = {}, llm = fakeLlm(goodPayload())): {
  rt: NamingRuntime
  calls: string[]
  llmCalls: () => number
} {
  const { callTool, calls } = fakeTools(toolOpts)
  const rt: NamingRuntime = {
    callTool,
    llm: llm.llm,
    route: { provider: 'test-provider', model: 'test-model' },
    today: TODAY,
    ...over,
  }
  return { rt, calls, llmCalls: llm.calls }
}

/** 断言成功结果（失败时把拒绝原因打出来，便于定位）。 */
function expectOk(out: NameClassOutcome): NameClassSuccess {
  assert.equal(out.ok, true, `期望成功，实际被拒：${JSON.stringify(out)}`)
  return out as NameClassSuccess
}

test.beforeEach(() => clearNamingCache())

// ===== ① 实时源的时间性 =====

test('★ as_of = 当前交易日 → 异动/监控可用，且只留本类成员的行', async () => {
  const { rt, calls } = runtime()
  const out = expectOk(await nameClass(rt, { classId: 6 }))
  assert.ok(calls.includes('unusual'), 'as_of 与今日相同 → 应采异动')
  assert.ok(calls.includes('market_monitor'), '也应采主力监控')
  // 别人家的票（600000）不得混进素材
  const stocks = new Set(out.result.evidence.map((e) => e.stock))
  assert.ok(![...stocks].some((s) => s.includes('600000')), '非成员素材不得进入证据')
  assert.ok(out.sourcesUsed.includes('unusual'))
  assert.equal(out.result.verdict, 'named')
  assert.equal(out.result.theme, '光模块')
  assert.ok(out.result.evidenceScore >= 0.6, `证据分过门（${out.result.evidenceScore}）`)
})

test('★ as_of ≠ 当前交易日 → 不采实时源，并如实交代（不做历史回放）', async () => {
  const { rt, calls } = runtime({ today: '2026-09-12' })
  const out = expectOk(await nameClass(rt, { classId: 6 }))
  assert.ok(!calls.includes('unusual'), '历史 as_of 不得采当日实时异动')
  assert.ok(!calls.includes('market_monitor'), '历史 as_of 不得采当日主力监控')
  assert.ok(out.result.missingSources.includes('unusual'))
  assert.ok(out.result.missingSources.includes('market_monitor'))
  assert.ok(
    out.collectNotes.some((n) => n.includes('不做历史回放')),
    `必须解释为什么没采（${out.collectNotes.join(' | ')}）`,
  )
  assert.ok(out.sourcesUsed.includes('kline'), '可回放的封板状态仍要采')
  assert.ok(
    out.collectNotes.some((n) => n.includes('当前快照')),
    '板块归属是当前快照 → 必须标注口径偏差',
  )
})

test('未知当前交易日 → 保守不采实时源（宁缺勿造）', async () => {
  const { rt, calls } = runtime({ today: undefined })
  await nameClass(rt, { classId: 6 })
  assert.ok(!calls.includes('unusual'))
})

test('实时列表按成员过滤（工具返回市场级列表，属于别人的行必须丢掉）', () => {
  const rows = [
    { code: '300308', desc: '加速拉升' },
    { code: '600000', desc: '加速拉升' },
    { code: '300502', desc: '封涨停板' },
    { desc: '没有代码的行' },
  ]
  assert.deepEqual(filterMarketRows(rows, new Set(['300308', '300502'])).map((r) => r.code), ['300308', '300502'])
  assert.deepEqual(filterMarketRows('不是数组', new Set(['300308'])), [])
})

test('封板状态由日K推导（本站没有 ChangeUpType 字段，用同一口径的连板统计替代）', () => {
  assert.equal(limitUpTypeOf(toCandles(candles()), '300308', '中际旭创'), '首板·换手板')
  // 一字板：开盘即涨停价
  const oneWord = candles()
  oneWord[2].open = 12
  assert.equal(limitUpTypeOf(toCandles(oneWord), '300308', '中际旭创'), '首板·一字板')
  // 连板：再来一根涨停
  const two = candles()
  two.push({ date: '2026-09-12', open: 13, high: 14.4, low: 13, close: 14.4, volume: 4000 })
  assert.equal(limitUpTypeOf(toCandles(two), '300308', '中际旭创'), '2连板·换手板', '连板要写出板数')
  // 未涨停 → 不产素材
  const flat = candles()
  flat[2].close = 10.5
  assert.equal(limitUpTypeOf(toCandles(flat), '300308', '中际旭创'), '')
  assert.equal(limitUpTypeOf([], '300308', '中际旭创'), '', '日K不足不猜')
  // 主板 10% 档：10 → 11 才是一板
  const main = [{ date: '2026-09-10', open: 10, high: 10, low: 10, close: 10 }, { date: '2026-09-11', open: 10.5, high: 11, low: 10.4, close: 11 }]
  assert.equal(limitUpTypeOf(toCandles(main), '600000', '浦发银行'), '首板·换手板', '主板按 10% 判定')
  assert.equal(limitUpTypeOf(toCandles(main), '300308', ''), '', '创业板 20% 档下 +10% 不算涨停')
})

test('toCandles：兼容 date/datetime、乱序输入要排好序、坏行丢弃', () => {
  const rows = [
    { datetime: '2026-09-11 00:00:00', open: 1, high: 1, low: 1, close: 2, volume: 5 },
    { date: '2026-09-10', open: 1, high: 1, low: 1, close: 1 },
    { date: '2026-09-09', close: 'not-a-number' },
    null,
  ]
  const got = toCandles(rows)
  assert.deepEqual(got.map((c) => c.date), ['2026-09-10', '2026-09-11'], '升序 + 丢弃坏行')
  assert.equal(toCandles(null).length, 0)
})

test('采集：源失败只记缺失，不抛断整类', async () => {
  const callTool = async (name: string): Promise<unknown> => {
    if (name === 'belong_board') throw new Error('源不可用')
    if (name === 'kline') return candles()
    if (name === 'hist_concept_class') throw new Error('不该被调到')
    return []
  }
  const out = await collectMaterials({ callTool, today: TODAY }, { asOf: AS_OF, members: MEMBERS.map((m) => ({ market: 'SZ' as const, code: m.code, name: m.name })), windowDays: 5 })
  assert.ok(out.corpus.missingSources.includes('belong_board'), '整源失败要记入 missingSources')
  assert.deepEqual(out.corpus.failedStocks.sort(), ['SZ300308', 'SZ300502'], '失败票要记名')
  assert.ok(out.corpus.items.length > 0, '其他源照常产出素材')
})

// ===== ② 弱链伪类 =====

test('★ 弱链伪类拒绝命名，且不产生任何 LLM 调用', async () => {
  const llm = fakeLlm(goodPayload())
  const { rt, calls } = runtime({}, { weakChain: true }, llm)
  const out = await nameClass(rt, { classId: 6 })
  assert.equal(out.ok, false)
  assert.equal((out as { reason: string }).reason, 'weak_chain')
  assert.ok((out as { note: string }).note.includes('不采信'))
  assert.equal(llm.calls(), 0, '拒绝时必须没有发生模型调用（不浪费预算）')
  assert.ok(!calls.includes('belong_board'), '连素材都不必采')
})

test('类不存在 / 工具不可用 → 结构化拒绝（不抛异常）', async () => {
  const pooled = await nameClass(runtime({}, { classOk: false }).rt, { classId: 6 })
  assert.equal(pooled.ok, false)
  assert.equal((pooled as { reason: string }).reason, 'no_class')
  assert.ok((pooled as { note: string }).note.includes('可用池'), '要把引擎原文带回来（否则无法排查）')

  const down = await nameClass(runtime({}, { throwOnClass: true }).rt, { classId: 6 })
  assert.equal(down.ok, false)
  assert.equal((down as { reason: string }).reason, 'tdx_unavailable')
})

// ===== ③ 缓存与指纹 =====

test('★ 缓存命中不产生第二次 LLM 调用；refresh / 指纹变化必须重算', async () => {
  const llm = fakeLlm(goodPayload())
  const { rt } = runtime({}, {}, llm)

  const first = expectOk(await nameClass(rt, { classId: 6 }))
  assert.equal(first.cached, false)
  assert.equal(llm.calls(), 1)

  const second = expectOk(await nameClass(rt, { classId: 6 }))
  assert.equal(second.cached, true, '同口径第二次必须命中缓存')
  assert.equal(llm.calls(), 1, '命中缓存 → 不得再调模型')
  assert.equal(namingCacheStats().size, 1)

  const forced = expectOk(await nameClass(rt, { classId: 6, refresh: true }))
  assert.equal(forced.cached, false, 'refresh 必须绕过缓存')
  assert.equal(llm.calls(), 2)

  // 换模型 → 指纹变 → 缓存未命中（否则会复用别的口径的结论）
  const other = fakeLlm(goodPayload())
  const rtOther: NamingRuntime = { ...rt, route: { provider: 'test-provider', model: 'another-model' }, llm: other.llm }
  const third = expectOk(await nameClass(rtOther, { classId: 6 }))
  assert.equal(third.cached, false, '换模型必须视为未命中')
  assert.equal(other.calls(), 1)
  assert.notEqual(third.result.fingerprint, first.result.fingerprint, '指纹必须随模型变化')

  // 换聚类参数（windowDays）同样换指纹
  const fourth = expectOk(await nameClass(rt, { classId: 6, windowDays: 7 }))
  assert.equal(fourth.cached, false, '换素材窗口必须视为未命中')
  assert.equal(fourth.result.windowDays, 7)
})

// ===== ④ 降级路径 =====

test('模型不可用 → 素材照采、结论降级为 llm_unavailable（不是白屏也不是抛错）', async () => {
  const { rt } = runtime({ llm: undefined, route: undefined })
  const out = expectOk(await nameClass(rt, { classId: 6 }))
  assert.equal(out.result.verdict, 'insufficient')
  assert.equal(out.result.degradedReason, 'llm_unavailable')
  assert.ok(out.result.materialCount > 0, '素材还是要采（好看清"素材有、模型没有"）')
  assert.ok(out.result.guardNotes[0].includes('模型不可用'))
  const avail = namingAvailability(rt)
  assert.equal(avail.available, false)
  assert.ok((avail.reason ?? '').includes('ctx.llm'))
})

test('模型调用抛错 → llm_unavailable，并把原因带回来', async () => {
  const llm = fakeLlm({}, { throws: '模型超时' })
  const { rt } = runtime({}, {}, llm)
  const out = expectOk(await nameClass(rt, { classId: 6 }))
  assert.equal(out.result.degradedReason, 'llm_unavailable')
  assert.ok(out.result.guardNotes[0].includes('模型超时'))
})

test('模型输出畸形 JSON → llm_invalid_json，且保留原文片段供抽查', async () => {
  const llm = fakeLlm('我觉得这几只票是光模块，但我不打算给 JSON')
  const { rt } = runtime({}, {}, llm)
  const out = expectOk(await nameClass(rt, { classId: 6 }))
  assert.equal(out.result.degradedReason, 'llm_invalid_json')
  assert.ok(out.result.guardNotes[0].includes('无法解析'))
  assert.ok(out.result.guardNotes[0].includes('我觉得这几只票是光模块'), '原文必须留痕（否则无从抽查）')
  assert.equal(out.result.theme, null, '解析失败不得带出任何主题名')
})

test('★ 幻觉引文 → 被护栏拒（no_common + guard_rejected），主题名不得外泄', async () => {
  const llm = fakeLlm({
    verdict: 'named',
    theme: '光模块',
    confidence: 0.95,
    evidence: [
      { stock: '300308 中际旭创', quote: '两家公司同日公告共建 1.6T 光模块产线', ts: `${AS_OF} 15:00` },
      { stock: '300502 新易盛', quote: '同日获得海外大额订单', ts: `${AS_OF} 15:00` },
    ],
    reasoning: '编造的推理',
  })
  const { rt } = runtime({}, {}, llm)
  const out = expectOk(await nameClass(rt, { classId: 6 }))
  assert.notEqual(out.result.verdict, 'named')
  assert.equal(out.result.theme, null)
  assert.equal(out.result.degradedReason, 'guard_rejected')
  assert.equal(out.result.evidenceCount, 0)
  assert.equal(out.result.evidence.length, 0, '幻觉引文不得留在结果里')
})

test('有效素材（含行业板块）会写进 prompt，且输出 schema 一并给出', async () => {
  let seen = ''
  const llm: NamingRuntime['llm'] = {
    // eslint-disable-next-line require-yield
    stream(options: { messages: unknown[] }) {
      seen = JSON.stringify(options.messages)
      async function* gen() {
        yield { type: 'text-delta', text: JSON.stringify(goodPayload()) }
      }
      return gen()
    },
  }
  const { rt } = runtime({}, {}, { llm, calls: () => 1 })
  expectOk(await nameClass(rt, { classId: 6 }))
  assert.ok(seen.includes('【成员票与当日表现】'))
  assert.ok(seen.includes('300308 中际旭创'))
  assert.ok(seen.includes(`时间窗`), 'prompt 必须写出素材时间窗')
  assert.ok(seen.includes('CPO概念'), '板块素材必须进 prompt')
  assert.ok(seen.includes('通信设备'), '行业板块也进 prompt（模型归纳常用到它）')
  assert.ok(seen.includes('严格输出如下 JSON'))
})

test('有效口径回传（UI 必须展示 as_of 与四个参数）', async () => {
  const { rt } = runtime()
  const out = expectOk(await nameClass(rt, { classId: 6, window: 90, minCorr: 0.6, poolN: 200 }))
  assert.deepEqual(out.effective, {
    asOf: AS_OF,
    window: 90,
    minCorr: 0.6,
    poolN: 200,
    nClasses: 10,
    meanIntraCorr: 0.6675,
  })
  assert.equal(out.members.length, 2)
  assert.equal(out.result.asOf, AS_OF)
  assert.equal(out.result.fingerprint.length, 16)
  assert.ok(out.result.materialCount > 0, `素材条数要上报（实际 ${out.result.materialCount}）`)
})
