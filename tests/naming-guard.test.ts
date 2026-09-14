/**
 * tests/naming-guard.test.ts —— A2b 命名护栏的单元测试（离线，不调 LLM、不连行情）。
 *
 * 为什么这一块必须有测试：护栏是**唯一**能挡住"模型编造共同主题"的环节。
 * 它坏掉的表现不是报错，而是报告里多出一句看起来很合理、却没有任何证据支撑的命名 ——
 * 人是不会去逐字核对引文的。因此这里把 ROADMAP A2b 的验收锚点写成可执行契约：
 *   ① 引文可反查：编造引文的负样本必须降级（不允许 named）；
 *   ② 窗口外的证据不计入门控（负样本可复现）；
 *   ③ 降级成因必须分层（不允许出现「素材不足 + 成因 none」）；
 *   ④ 指纹随口径变化（缓存不得跨口径复用）；
 * 以及「自报置信度不参与门控」这条容易被"顺手加上去"的立场。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  DEFAULT_NAMING_GUARD,
  groupByStock,
  materialText,
  tsDate,
  windowContains,
  windowDates,
  windowStart,
  type MaterialCorpus,
  type MaterialItem,
  type MaterialWindow,
} from '../src/host/naming/types.ts'
import { applyGuards, computeEvidenceScore, degradedResult, findQuoteItem, normalizeTheme, verifyQuote } from '../src/host/naming/guard.ts'
import { buildUserPrompt, NAMING_BATCH_SYSTEM_PROMPT, NAMING_SYSTEM_PROMPT } from '../src/host/naming/prompt.ts'
import { parseLlmJson, repair } from '../src/host/naming/parse.ts'
import { namingFingerprint, NAMING_PROMPT_VERSION } from '../src/host/naming/fingerprint.ts'
import {
  applyQuota,
  boardTypeLabel,
  boardsToMaterials,
  dedupMaterials,
  isNarrativeBoard,
  splitBoards,
  textSimilarity,
  truncateMaterials,
  unusualToMaterial,
} from '../src/host/naming/materials.ts'

const WINDOW: MaterialWindow = { end: '2026-09-11', days: 3 }

/** 与护栏内部同一套四舍五入（比率字段会被 round4 后再上报）。 */
function round4(n: number): number {
  return Math.round(n * 1e4) / 1e4
}

function item(patch: Partial<MaterialItem> & { stock: string; title: string }): MaterialItem {
  return {
    key: patch.key ?? 'SZ000001',
    source: patch.source ?? 'unusual',
    ts: patch.ts ?? '2026-09-11 10:03',
    snippet: patch.snippet ?? '',
    kind: patch.kind ?? 'unusual',
    ...patch,
  }
}

function corpus(items: MaterialItem[], missingSources: string[] = []): MaterialCorpus {
  return { items, missingSources, failedStocks: [] }
}

/** 三个成员的类（成员标注与素材 stock 同口径）。 */
const MEMBERS = ['300308 中际旭创', '002281 光迅科技', '600487 亨通光电']

/** 一份"素材齐全"的语料：三票都有概念板块 + 两票有异动。 */
function goodCorpus(): MaterialCorpus {
  return corpus([
    item({ stock: MEMBERS[0], key: 'SZ300308', title: '所属板块', snippet: 'CPO概念、光通信', kind: 'board_concept', ts: '2026-09-11 15:00', source: 'belong_board' }),
    item({ stock: MEMBERS[1], key: 'SZ002281', title: '所属板块', snippet: 'CPO概念、光模块', kind: 'board_concept', ts: '2026-09-11 15:00', source: 'belong_board' }),
    item({ stock: MEMBERS[2], key: 'SH600487', title: '所属板块', snippet: 'CPO概念、海缆', kind: 'board_concept', ts: '2026-09-11 15:00', source: 'belong_board' }),
    item({ stock: MEMBERS[0], key: 'SZ300308', title: '加速拉升', snippet: '异动数值=6.2' }),
    item({ stock: MEMBERS[1], key: 'SZ002281', title: '封涨停板', snippet: '异动数值=10.0' }),
  ])
}

/** 一份"合规"的模型输出：三票的板块引文都逐字来自语料。 */
function goodRaw() {
  return {
    verdict: 'named',
    theme: 'CPO',
    confidence: 0.82,
    alternatives: ['光模块', '光通信'],
    evidence: [
      { stock: MEMBERS[0], source: 'belong_board', quote: 'CPO概念、光通信', ts: '2026-09-11 15:00' },
      { stock: MEMBERS[1], source: 'belong_board', quote: 'CPO概念、光模块', ts: '2026-09-11 15:00' },
      { stock: MEMBERS[2], source: 'belong_board', quote: 'CPO概念、海缆', ts: '2026-09-11 15:00' },
    ],
    reasoning: '三票当日概念板块同时指向 CPO，且两只封板/拉升。',
  }
}

function run(raw: unknown, opts: { corpus?: MaterialCorpus; guard?: Partial<typeof DEFAULT_NAMING_GUARD>; sourceFailed?: boolean } = {}) {
  const c = opts.corpus ?? goodCorpus()
  return applyGuards({
    raw: raw as never,
    classId: 7,
    asOf: WINDOW.end,
    memberLabels: MEMBERS,
    corpus: c,
    window: WINDOW,
    cfg: { ...DEFAULT_NAMING_GUARD, ...opts.guard },
    modelVersion: 'test-model',
    fingerprint: 'fp-test',
    ...(opts.sourceFailed !== undefined ? { sourceFailed: opts.sourceFailed } : {}),
  })
}

// ===== ① 引文可反查 =====

test('引文逐字反查：合规引文通过，短引文与编造引文不通过', () => {
  const it = item({ stock: MEMBERS[0], title: '所属板块', snippet: 'CPO概念、光通信' })
  assert.equal(verifyQuote('CPO概念、光通信', it), true)
  assert.equal(verifyQuote('CPO概念', it), true, '子串也算（模型常只抄一半）')
  assert.equal(verifyQuote('CPO', it), false, `短于 ${4} 字不构成证据`)
  assert.equal(verifyQuote('三家公司同日公告 CPO 扩产计划', it), false, '编造引文必须不通过')
  assert.equal(verifyQuote('', it), false)
})

test('引文归一：素材用空格、prompt 渲染成 " / "，模型照抄 " / " 不得判成幻觉', () => {
  const it = item({ stock: MEMBERS[0], title: '加速拉升', snippet: '异动数值=6.2' })
  assert.equal(materialText(it), '加速拉升 异动数值=6.2')
  // 真实踩过的 bug：不做分隔符归一，这条合规引文会被判幻觉
  assert.equal(verifyQuote('加速拉升 / 异动数值=6.2', it), true, '"/" 与空白归一后应通过')
  assert.equal(findQuoteItem(MEMBERS[0], '加速拉升 / 异动数值=6.2', goodCorpus(), WINDOW)?.stock, MEMBERS[0])
})

test('★ 同一段引文同时存在于窗口内外 → 认窗口内那条（不冤枉降级）', () => {
  // 「所属板块」每天重新生成、内容可能一字不差：同一文本两条素材
  const both = corpus([
    item({ stock: MEMBERS[0], title: '所属板块', snippet: 'CPO概念、光通信', ts: '2026-09-01 15:00', source: 'belong_board' }),
    item({ stock: MEMBERS[0], title: '所属板块', snippet: 'CPO概念、光通信', ts: '2026-09-11 15:00', source: 'belong_board' }),
  ])
  const hit = findQuoteItem(MEMBERS[0], 'CPO概念、光通信', both, WINDOW)
  assert.equal(hit?.ts, '2026-09-11 15:00', '必须认窗口内那条（否则合规证据会被时间窗挡掉）')
  const r = run(
    { verdict: 'named', theme: 'CPO', evidence: [
      { stock: MEMBERS[0], quote: 'CPO概念、光通信' },
      { stock: MEMBERS[1], quote: 'CPO概念、光模块' },
    ] },
    { corpus: corpus([...both.items, ...goodCorpus().items]) },
  )
  assert.equal(r.evidenceCount, 2, '两条都算窗口内')
})

test('★ A2b①：编造引文的负样本必须降级（不得 named）', () => {
  const raw = goodRaw()
  raw.evidence = [
    { stock: MEMBERS[0], source: 'belong_board', quote: '三家公司同日公告 CPO 扩产计划', ts: '2026-09-11 15:00' },
    { stock: MEMBERS[1], source: 'belong_board', quote: '共同中标国家算力枢纽项目', ts: '2026-09-11 15:00' },
  ] as never
  const r = run(raw)
  assert.notEqual(r.verdict, 'named', `编造引文 → 不得 named（实际 ${r.verdict}）`)
  assert.equal(r.evidence.length, 0, '全部证据被丢弃')
  assert.equal(r.theme, null, '降级后不得保留半个主题名（否则会被误引）')
  assert.equal(r.degradedReason, 'guard_rejected', '成因是"被护栏拒"，不是"没素材"')
  assert.ok(r.guardNotes.some((n) => n.includes('判幻觉')), `台账里要留痕（${r.guardNotes.join(' | ')}）`)
})

test('★ 反查失败但素材本身为空 → 成因必须是 no_material（而不是 guard_rejected）', () => {
  const r = run({ ...goodRaw(), evidence: [{ stock: MEMBERS[0], quote: '编造的内容在这里' }] }, { corpus: corpus([]) })
  assert.equal(r.verdict, 'insufficient')
  assert.equal(r.degradedReason, 'no_material', '完全没素材时不得说成"被护栏拒"')
})

test('命中票数/覆盖度：同一票的多条证据不能凑覆盖度', () => {
  const raw = {
    verdict: 'named',
    theme: 'CPO',
    evidence: [
      { stock: MEMBERS[0], quote: 'CPO概念、光通信' },
      { stock: MEMBERS[0], quote: '加速拉升' },
      { stock: MEMBERS[0], quote: '异动数值=6.2' },
    ],
  }
  const r = run(raw)
  assert.equal(r.evidence.length, 3, '三条证据都反查通过')
  assert.ok(Math.abs(r.evidenceCoverage - 1 / 3) < 1e-3, `覆盖度按**不同票**算（1/3，实际 ${r.evidenceCoverage}）`)
  assert.notEqual(r.verdict, 'named', '覆盖度 0.33 < 0.5 → 不得 named')
})

// ===== ② 时间窗 =====

test('★ A2b②：窗口外的证据不计入门控（负样本可复现）', () => {
  // 语料里放一条 8 天前的素材：文本**与窗口内那条不同**（否则会按"窗口内优先"命中当天的）
  const stale = corpus([
    ...goodCorpus().items,
    item({ stock: MEMBERS[2], key: 'SH600487', title: '所属板块', snippet: 'CPO概念、海缆扩产预期', ts: '2026-09-03 15:00', source: 'belong_board' }),
  ])
  const raw = goodRaw()
  raw.evidence = [
    { stock: MEMBERS[0], quote: 'CPO概念、光通信' },
    { stock: MEMBERS[1], quote: 'CPO概念、光模块' },
    { stock: MEMBERS[2], quote: 'CPO概念、海缆扩产预期', ts: '2026-09-03 15:00' },
  ] as never
  const r = run(raw, { corpus: stale })
  assert.equal(r.evidence.length, 3, '三条都反查通过（反查不管时间）')
  assert.equal(r.evidenceCount, 2, '但只有 2 条在窗口内 → 计入的是 2')
  assert.equal(r.evidenceInWindow, round4(2 / 3))
  assert.ok(r.guardNotes.some((n) => n.includes('A6')), `必须留痕说明被窗口挡掉（${r.guardNotes.join(' | ')}）`)

  // 完全靠窗口外证据支撑 → 不得 named
  const onlyStale = run(
    { verdict: 'named', theme: 'CPO', evidence: [{ stock: MEMBERS[2], quote: 'CPO概念、海缆扩产预期', ts: '2026-09-03 15:00' }] },
    { corpus: stale },
  )
  assert.notEqual(onlyStale.verdict, 'named', '窗口外证据不能支撑命名')
  assert.equal(onlyStale.evidenceCount, 0)
})

test('时间戳以素材为准：模型自报时间不同只记台账，不改判定依据', () => {
  const raw = goodRaw()
  raw.evidence = [
    { stock: MEMBERS[0], quote: 'CPO概念、光通信', ts: '2026-01-01 09:00' },
    { stock: MEMBERS[1], quote: 'CPO概念、光模块' },
    { stock: MEMBERS[2], quote: 'CPO概念、海缆' },
  ] as never
  const r = run(raw)
  assert.equal(r.verdict, 'named', '自报时间错不构成降级理由（证据本身在窗口内）')
  assert.ok(r.evidence.every((e) => e.ts.startsWith('2026-09-11')), '证据时间戳来自素材')
  assert.ok(r.guardNotes.some((n) => n.includes('自报时间戳与素材不一致')), '但要留痕')
})

test('窗口边界：含端点，且按自然日（与参考实现口径一致）', () => {
  assert.equal(windowStart(WINDOW), '2026-09-09')
  assert.deepEqual(windowDates(WINDOW), ['2026-09-09', '2026-09-10', '2026-09-11'])
  assert.equal(windowContains(WINDOW, '2026-09-09'), true)
  assert.equal(windowContains(WINDOW, '2026-09-11'), true)
  assert.equal(windowContains(WINDOW, '2026-09-08'), false)
  assert.equal(windowContains(WINDOW, '2026-09-12'), false)
  assert.equal(windowStart({ end: '2026-09-11', days: 1 }), '2026-09-11')
  assert.equal(tsDate('2026-09-11 10:03'), '2026-09-11')
  assert.equal(tsDate('不是时间'), null)
})

// ===== ③ 三态与成因分层 =====

test('★ A2b③：降级成因必须分层，任何 insufficient 都不允许留 none', () => {
  // 素材齐全但模型说 insufficient 且每票都有素材 → llm_insufficient
  const allHaveMaterial = run({ verdict: 'insufficient' }, { corpus: goodCorpus() })
  assert.equal(allHaveMaterial.verdict, 'insufficient')
  assert.equal(allHaveMaterial.degradedReason, 'llm_insufficient', '每票都有素材 → 是模型的判断不足')

  // 只有部分成员有素材 → partial_material，并点名缺谁
  const partial = corpus([item({ stock: MEMBERS[0], title: '加速拉升', snippet: '异动数值=6.2' })])
  const rPartial = run({ verdict: 'insufficient' }, { corpus: partial })
  assert.equal(rPartial.degradedReason, 'partial_material')
  assert.ok(rPartial.guardNotes.some((n) => n.includes(MEMBERS[1])), `要点名缺素材的票（${rPartial.guardNotes.join(' | ')}）`)

  // 源失败（采集层报坏）→ source_failed
  const rSource = run({ verdict: 'insufficient' }, { corpus: corpus(goodCorpus().items, ['unusual']), sourceFailed: true })
  assert.equal(rSource.degradedReason, 'source_failed')
  assert.deepEqual(rSource.missingSources, ['unusual'])

  // 结论字面量非法 → 降级 insufficient（不猜模型想说什么）
  const rBad = run({ verdict: 'probably_named', theme: 'CPO' })
  assert.equal(rBad.verdict, 'insufficient')
  assert.ok(rBad.guardNotes.some((n) => n.includes('verdict 非法')))
})

test('no_common 是**允许且必须保留**的结论（不是降级）', () => {
  const r = run({ verdict: 'no_common', theme: '无', reasoning: '各票有消息但不指向同一主题' })
  assert.equal(r.verdict, 'no_common')
  assert.equal(r.theme, null, 'no_common 不带主题名')
  assert.equal(r.degradedReason, 'none', '这是正常结论，不是降级')
  assert.equal(r.reasoning, '各票有消息但不指向同一主题')
})

test('★ 立场：模型自报 confidence 不参与门控（只留提示）', () => {
  const lowConf = run({ ...goodRaw(), confidence: 0.1 })
  assert.equal(lowConf.verdict, 'named', '置信度低不构成降级理由（工具不据此下结论）')
  assert.equal(lowConf.confidence, 0.1, '如实记录自报值供展示')
  assert.ok(lowConf.guardNotes.some((n) => n.includes('不参与降级')), '台账里说明它不参与判定')

  // 反过来：置信度很高但证据不足 → 仍然降级
  const highConf = run(
    { verdict: 'named', theme: 'CPO', confidence: 0.99, evidence: [{ stock: MEMBERS[0], quote: 'CPO概念、光通信' }] },
    { corpus: goodCorpus() },
  )
  assert.notEqual(highConf.verdict, 'named', '只有 1 条证据（<2）→ 高置信度也不能命名')
})

test('证据分公式与门槛是显式的（改权重必须改这条测试）', () => {
  assert.equal(computeEvidenceScore(0, 0, 0, 0), 0)
  assert.equal(computeEvidenceScore(3, 2, 1, 1), 1) // 满分
  // 只有覆盖度：0.40
  assert.equal(computeEvidenceScore(0, 0, 1, 0), 0.4)
  // 只有条数（3 条封顶）：0.15
  assert.equal(computeEvidenceScore(3, 0, 0, 0), 0.15)
  assert.equal(computeEvidenceScore(9, 0, 0, 0), 0.15, '条数在 3 条处封顶（防"堆证据"）')
  // 门槛本身可配：把证据分门槛抬到样本分之上 → 合规样本也会被降级
  // （两票证据：0.40*2/3 + 0.25*1 + 0.20*1 + 0.15*2/3 ≈ 0.8167）
  const twoMembers = { verdict: 'named', theme: 'CPO', evidence: [
    { stock: MEMBERS[0], quote: 'CPO概念、光通信' },
    { stock: MEMBERS[1], quote: 'CPO概念、光模块' },
  ] }
  assert.equal(run(twoMembers, { guard: { minEvidenceScore: 0.8 } }).verdict, 'named', '0.82 ≥ 0.8 → 过门')
  const strict = run(twoMembers, { guard: { minEvidenceScore: 0.9 } })
  assert.notEqual(strict.verdict, 'named', '抬高门槛后同一份素材被降级（门槛是可配的，不是硬编码真理）')
  assert.ok(strict.guardNotes.some((n) => n.includes('A5 可计算证据分')))
})

test('DEFAULT_NAMING_GUARD 是契约（要放松必须同时改这条测试）', () => {
  assert.deepEqual(DEFAULT_NAMING_GUARD, {
    minEvidenceItems: 2,
    minHitMembers: 2,
    minCoverage: 0.5,
    minEvidenceScore: 0.6,
    requireEvidence: true,
    enforceEvidenceWindow: true,
    minConfidence: 0.6,
  })
})

test('合规样本的完整字段（named 的全套输出，供 UI 直接渲染）', () => {
  const r = run(goodRaw())
  assert.equal(r.verdict, 'named')
  assert.equal(r.theme, 'CPO')
  assert.deepEqual(r.alternatives, ['光模块', '光通信'])
  assert.equal(r.evidenceCount, 3)
  assert.equal(r.evidenceCoverage, 1)
  assert.equal(r.evidenceInWindow, 1)
  assert.equal(r.degradedReason, 'none')
  assert.equal(r.materialCount, 5)
  assert.equal(r.windowDays, 3)
  assert.equal(r.modelVersion, 'test-model')
  assert.equal(r.fingerprint, 'fp-test')
  assert.ok(r.evidenceScore >= 0.6, `证据分过门（${r.evidenceScore}）`)
  // 每条证据都带出处，才能"可反查"
  for (const e of r.evidence) {
    assert.ok(e.source && e.ts && e.quote && e.stock, `证据字段齐全：${JSON.stringify(e)}`)
  }
})

test('降级兜底结果（LLM 不可用 / 输出畸形）字段自洽', () => {
  const base = {
    classId: 9,
    asOf: WINDOW.end,
    corpus: goodCorpus(),
    window: WINDOW,
    modelVersion: 'test-model',
    fingerprint: 'fp-x',
  }
  const r = degradedResult({ ...base, reason: 'llm_unavailable', note: 'LLM 不可用：宿主未挂载 ctx.llm' })
  assert.equal(r.verdict, 'insufficient')
  assert.equal(r.degradedReason, 'llm_unavailable')
  assert.equal(r.evidenceScore, 0)
  assert.equal(r.theme, null)
  assert.equal(r.materialCount, 5, '素材条数照实上报（好看清"素材有、模型没有"）')
  assert.ok(r.guardNotes[0].includes('宿主未挂载'))

  const r2 = degradedResult({ ...base, reason: 'llm_invalid_json', note: '模型输出无法解析：顶层不是对象' })
  assert.equal(r2.degradedReason, 'llm_invalid_json')
})

// ===== ④ 指纹 =====

test('★ A2b④：指纹随口径变化（模型 / 窗口 / 源集合 / 阈值 / 提示词）', () => {
  const base = {
    provider: 'host-ctx-llm',
    model: 'deepseek-v4-flash-vision-exp',
    clientVersion: 'v1',
    windowDays: 3,
    sources: ['unusual', 'belong_board', 'kline'],
    promptVersion: NAMING_PROMPT_VERSION,
    guard: { minCoverage: 0.5, minEvidenceScore: 0.6, minEvidenceItems: 2 },
  }
  const fp = namingFingerprint(base)
  assert.match(fp, /^[0-9a-f]{16}$/)

  // 同内容不同键序 / 不同源顺序 → 同一指纹（缓存应当命中）
  assert.equal(
    namingFingerprint({ ...base, sources: ['kline', 'belong_board', 'unusual'], guard: { minEvidenceScore: 0.6, minEvidenceItems: 2, minCoverage: 0.5 } }),
    fp,
    '键序/源顺序不应影响指纹',
  )

  // 任一口径变化 → 指纹必须变（否则会静默复用别的口径的结论）
  assert.notEqual(namingFingerprint({ ...base, model: 'other-model' }), fp, '换模型')
  assert.notEqual(namingFingerprint({ ...base, clientVersion: 'v2' }), fp, '换客户端版本')
  assert.notEqual(namingFingerprint({ ...base, windowDays: 5 }), fp, '换窗口')
  assert.notEqual(namingFingerprint({ ...base, sources: ['unusual'] }), fp, '换源集合')
  assert.notEqual(namingFingerprint({ ...base, promptVersion: 'a2b-3' }), fp, '换提示词')
  assert.notEqual(namingFingerprint({ ...base, guard: { ...base.guard, minEvidenceScore: 0.5 } }), fp, '换阈值')
})

// ===== 提示词与解析 =====

test('提示词把硬性规则写全（与护栏一一对应，改一处必须改另一处）', () => {
  for (const key of ['no_common', '逐字取自语料', 'insufficient', '严格 JSON', '不会据此下结论', '重新门控']) {
    assert.ok(NAMING_SYSTEM_PROMPT.includes(key), `系统提示词必须包含「${key}」`)
  }
  // 第 0 条（素材优先级）：提示词要求"事件优先、标签兜底"，护栏侧用 guardNotes 独立核对同一件事
  for (const key of ['【素材优先级】', '快讯', '无事件依据，按板块标签归类']) {
    assert.ok(NAMING_SYSTEM_PROMPT.includes(key), `系统提示词必须包含「${key}」（第 0 条素材优先级）`)
  }
  assert.ok(NAMING_BATCH_SYSTEM_PROMPT.includes('【素材优先级】'), '批量提示词同样要有第 0 条')
  // theme 的形状（2026-09-14 追加）：模型写句子当主题名会把整行的宽度吃掉，
  // 而**护栏只做归一、不做改写**（半截/改写过的名字更容易被误引）—— 约束必须落在提示词里。
  for (const key of ['题材短名', '不要写成句子', '被多数成员共享']) {
    assert.ok(NAMING_SYSTEM_PROMPT.includes(key), `单类提示词必须包含「${key}」（theme 形状）`)
  }
  for (const key of ['题材短名', '不要为了统一风格而互相模仿']) {
    assert.ok(NAMING_BATCH_SYSTEM_PROMPT.includes(key), `批量提示词必须包含「${key}」`)
  }
  const prompt = buildUserPrompt({ classId: 7, asOf: WINDOW.end, members: [
    { market: 'SZ', code: '300308', name: '中际旭创', changePct: 6.2 },
    { market: 'SZ', code: '002281', name: '光迅科技', changePct: null },
    { market: 'SZ', code: '000063', name: '中兴通讯', changePct: -1.5 }, // 语料里没有它的素材
  ], corpus: goodCorpus(), window: WINDOW })
  assert.ok(prompt.includes('下面 3 只股票在 2026-09-11 当日同涨同跌'), '成员数量与 as_of 必须写进 prompt')
  assert.ok(prompt.includes('- 300308 中际旭创  +6.20%'), `成员行带涨跌幅（实际：\n${prompt}）`)
  assert.ok(prompt.includes('- 002281 光迅科技'), '涨跌幅缺失时不留空串尾巴')
  assert.ok(prompt.includes('时间窗 2026-09-09 ~ 2026-09-11，共 3 天'), '窗口必须显式写出（否则模型不知道时间关系）')
  assert.ok(prompt.includes('=== 300308 中际旭创 ==='), '按票分块渲染素材')
  // 源名必须渲染成**与规则同名**的中文标签：直接印 `belong_board`/`news_flash` 这种键名，
  // 第 0 条就落不了地（模型分不出哪个是"快讯"）
  assert.ok(prompt.includes('[板块归属 2026-09-11 15:00] 所属板块 / CPO概念、光通信'), '素材行格式 = " / " 分隔（护栏已做归一）')
  assert.ok(!prompt.includes('[belong_board'), '不得把内部源键名直接渲染给模型')
  assert.ok(prompt.includes('（窗口内无素材）'), '没有素材的成员必须显式标注，不能静默留白')
  assert.ok(prompt.includes('"verdict": "named|no_common|insufficient"'), '输出 schema 必须写在 prompt 里')
})

test('快讯素材在 prompt 里渲染成「快讯」（与第 0 条规则同名，且全文进语料供逐字引文）', () => {
  const body = '【军工板块持续走高 银河电子、博云新材双双涨停】午后军工板块持续走高，国科军工均涨超4%。'
  const prompt = buildUserPrompt({
    classId: 7,
    asOf: WINDOW.end,
    members: [{ market: 'SH', code: '688543', name: '国科军工', changePct: 4.5 }],
    corpus: {
      items: [{
        stock: '688543 国科军工',
        key: 'SH688543',
        source: 'news_flash',
        ts: '2026-09-11 13:53',
        title: '军工板块持续走高 银河电子、博云新材双双涨停',
        snippet: body,
        kind: 'news_flash',
      }],
      missingSources: [],
      failedStocks: [],
    },
    window: WINDOW,
  })
  assert.ok(prompt.includes('[快讯 2026-09-11 13:53]'), `快讯行必须带「快讯」标签（实际：\n${prompt}）`)
  assert.ok(prompt.includes('国科军工均涨超4%'), '正文全文进语料，模型才能逐字引用')
})

test('提示词：缺失源要显式告知模型（否则它会把"没抓到"当成"没有题材"）', () => {
  const prompt = buildUserPrompt({
    classId: 7,
    asOf: WINDOW.end,
    members: [{ market: 'SZ', code: '300308', name: '中际旭创' }],
    corpus: corpus([], ['unusual']),
    window: WINDOW,
  })
  assert.ok(prompt.includes('【采集缺失的源】unusual'))
})

test('parseLlmJson：分级降级解析（围栏 / 前缀 / 尾逗号 / 缺括号 / 非对象）', () => {
  assert.deepEqual(parseLlmJson('{"verdict":"named"}').raw, { verdict: 'named' })
  assert.equal(parseLlmJson('```json\n{"verdict":"named"}\n```').raw?.verdict, 'named', '剥围栏')
  assert.equal(parseLlmJson('好的，结果如下：\n{"verdict":"named"}').raw?.verdict, 'named', '剥前缀寒暄')
  assert.equal(parseLlmJson('{"verdict":"named",}').raw?.verdict, 'named', '去尾逗号')
  assert.equal(parseLlmJson('{"verdict":"named"').raw?.verdict, 'named', '补未闭合的 }')
  assert.equal(parseLlmJson('[1,2,3]').raw, null, '顶层是数组 → 失败')
  assert.ok(parseLlmJson('[1,2,3]').error.includes('顶层不是对象'), `失败原因要说清（实际 ${parseLlmJson('[1,2,3]').error}）`)
  assert.equal(parseLlmJson('').raw, null)
  assert.equal(parseLlmJson('').error, '空响应')
  assert.equal(parseLlmJson('完全不是 JSON').raw, null)
  assert.ok(parseLlmJson('完全不是 JSON').error.startsWith('JSON 解析失败'), '失败必须给出原因（供台账与坏样本）')
  // 修复只做结构性修补，不改写字段内容
  assert.equal(repair('{"a":1,}'), '{"a":1}')
  assert.equal(JSON.parse(repair('{"a":[1,2')).a.length, 2, '截断在数组里也要按括号栈补成合法 JSON')
  assert.equal(JSON.parse(repair('{"a":{"b":1')).a.b, 1, '嵌套对象截断')
  assert.deepEqual(JSON.parse(repair('{"a":"未闭合的字符串')).a, '未闭合的字符串', '字符串截断补引号')
  assert.equal(repair('{"a":1,}').includes(','), false, '尾逗号去掉后不再回头加回来')
})

// ===== 素材归一 =====

test('板块类型码：12=行业 / 4=概念 / 5=风格 / 3=地区（与 lib/ladder.ts 同表）', () => {
  assert.equal(boardTypeLabel('12'), '行业')
  assert.equal(boardTypeLabel(4), '概念')
  assert.equal(boardTypeLabel('5'), '风格')
  assert.equal(boardTypeLabel('3'), '地区')
  assert.equal(boardTypeLabel(undefined), '')
})

test('★ 非叙事板块词黑名单：属性词不得作为题材线索（真实踩过「含可转债」）', () => {
  for (const w of ['含可转债', '融资融券', '沪股通', '昨日涨停', '次新股', '机构重仓', '破净股']) {
    assert.equal(isNarrativeBoard(w), false, `${w} 是股本/资金属性，不是题材`)
  }
  for (const w of ['CPO概念', '光通信', '固态电池', '低空经济']) {
    assert.equal(isNarrativeBoard(w), true, `${w} 是叙事线索`)
  }
  assert.equal(isNarrativeBoard('某某重仓'), false, '带"重仓"后缀的也挡掉')
  assert.equal(isNarrativeBoard('沪深300成份'), false, '带"成份"后缀的也挡掉')
  assert.equal(isNarrativeBoard(''), false)
  assert.equal(isNarrativeBoard(null), false)

  // 端到端：含可转债被过滤，行业照常保留
  const split = splitBoards([
    { board_type: '4', board_name: '含可转债' },
    { board_type: '4', board_name: '光通信' },
    { board_type: '12', board_name: '通信设备' },
    { board_type: '3', board_name: '江苏' },
    { board_type: '5', board_name: '高送转' },
  ])
  assert.deepEqual(split.concepts, ['光通信'], '概念里只留叙事词')
  assert.deepEqual(split.industries, ['通信设备'], '行业单独成组（官方花名册口径）')
})

test('素材构造：异动 / 封板状态 / 板块各按自己的形状进语料', () => {
  const u = unusualToMaterial({ desc: '加速拉升', time: '10:03', value: 6.2 }, MEMBERS[0], 'SZ300308', '2026-09-11')
  assert.deepEqual(u, {
    stock: MEMBERS[0], key: 'SZ300308', source: 'unusual', ts: '2026-09-11 10:03',
    title: '加速拉升', snippet: '异动数值=6.2', kind: 'unusual',
  })
  assert.equal(unusualToMaterial({ time: '10:03' }, MEMBERS[0], 'SZ300308', '2026-09-11'), null, '无 desc 的异动丢弃')

  const mats = boardsToMaterials(MEMBERS[1], 'SZ002281', '2026-09-11', { concepts: ['CPO概念'], industries: ['通信设备'] })
  assert.equal(mats.length, 2)
  assert.equal(mats[0].kind, 'board_concept')
  assert.equal(mats[0].title, '所属板块')
  assert.equal(mats[0].snippet, 'CPO概念')
  assert.equal(mats[1].kind, 'board_industry')
  assert.equal(mats[1].title, '行业板块', '两类板块必须分成两条素材（命名线索取概念，官方对照取行业）')
  assert.deepEqual(boardsToMaterials(MEMBERS[1], 'SZ002281', '2026-09-11', { concepts: [], industries: [] }), [], '都没有 → 不产空素材')
})

test('去重 / 配额 / 截断：只少去重不误删，配额按票按源，截断保留最新', () => {
  const a = item({ stock: MEMBERS[0], title: '加速拉升', snippet: '异动数值=6.2' })
  const dup = item({ stock: MEMBERS[0], title: '加速拉升 ', snippet: ' 异动数值=6.2' })
  const other = item({ stock: MEMBERS[0], title: '封涨停板', snippet: '异动数值=10.0' })
  const otherStock = item({ stock: MEMBERS[1], title: '加速拉升', snippet: '异动数值=6.2' })
  const deduped = dedupMaterials([a, dup, other, otherStock])
  assert.deepEqual(deduped.map((i) => i.title + i.stock), ['加速拉升' + MEMBERS[0], '封涨停板' + MEMBERS[0], '加速拉升' + MEMBERS[1]])

  // 阈值真的在用：只差一个数字（相似度 ≈0.95 > 0.9）**仍算重复** —— 这是刻意保留参考实现
  // （difflib ratio 0.9）的语义：同一票同一动作的重复推送本来就该合并；要保留它们只能下调阈值。
  assert.equal(textSimilarity('加速拉升 异动数值=6.2', '加速拉升  异动数值=6.2'), 1, '空白归一后完全相同 → 1')
  assert.equal(textSimilarity('', ''), 1)
  assert.equal(textSimilarity('加速拉升', ''), 0)
  assert.ok(textSimilarity('加速拉升', '封涨停板') < 0.9, '不同异动类型不得被当作重复')
  const near = item({ stock: MEMBERS[0], title: '加速拉升', snippet: '异动数值=6.3' })
  assert.equal(dedupMaterials([a, near]).length, 1, '只差数值 → 视为重复（参考实现同义）')
  assert.ok(textSimilarity('加速拉升异动数值=6.2', '加速拉升异动数值=6.3') < 0.99)
  assert.equal(dedupMaterials([a, near], 0.99).length, 2, '阈值收紧到 0.99 后不再合并（阈值确实在用）')

  const many = [
    item({ stock: MEMBERS[0], title: 't1', ts: '2026-09-11 09:31' }),
    item({ stock: MEMBERS[0], title: 't2', ts: '2026-09-11 10:31' }),
    item({ stock: MEMBERS[0], title: 't3', ts: '2026-09-11 14:31' }),
    item({ stock: MEMBERS[1], title: 't4', ts: '2026-09-11 09:31' }),
  ]
  const quota = applyQuota(many, 2)
  assert.equal(quota.length, 3, '每票每源最多 2 条（4 → 3）')
  assert.deepEqual(quota.filter((i) => i.stock === MEMBERS[0]).map((i) => i.title), ['t3', 't2'], '按时间倒序保留最新')

  const truncated = truncateMaterials(many, 4)
  assert.ok(truncated.length < many.length, '超预算要截断')
  assert.ok(truncated.some((i) => i.ts === '2026-09-11 14:31'), '保留最新的（模型先看最新）')
  assert.ok(truncated.every((i) => i.title.length >= 2), '截断不会产出残缺条目')
})

test('素材分组：同票多条归一组（prompt 渲染与覆盖度计算都依赖它）', () => {
  const g = groupByStock(goodCorpus().items)
  assert.equal(g.size, 3)
  assert.equal(g.get(MEMBERS[0])?.length, 2)
  assert.equal(g.get(MEMBERS[2])?.length, 1)
})

// ───────────────────────── 主题名归一（护栏的一部分，不是展示层修饰） ─────────────────────────

test('主题名归一：脱引号、去空白、去「板块/概念」这类通用后缀（不改写词本身）', () => {
  assert.equal(normalizeTheme('「CPO」'), 'CPO')
  assert.equal(normalizeTheme('【光模块】'), '光模块')
  assert.equal(normalizeTheme('“培育钻石”'), '培育钻石')
  assert.equal(normalizeTheme('有色金属板块'), '有色金属')
  assert.equal(normalizeTheme('存储芯片概念'), '存储芯片')
  assert.equal(normalizeTheme('  光 模 块  '), '光模块', '模型偶尔会写进空格，展示时要抹掉')
  // 不改写内容：长句子照旧保留（那是模型真的这么归纳的，只提示、不替它改）
  const long = '银行、电力、白酒等红利资产同步走强'
  assert.equal(normalizeTheme(long), long)
  // 只有引号/后缀、没有实词 → 空（调用方按"named 但 theme 为空"降级）
  assert.equal(normalizeTheme('「」'), '')
  assert.equal(normalizeTheme('板块'), '板块', '不许把两个字的名字削成一个字')
  assert.equal(normalizeTheme(null), '')
})

test('★ 归一后的主题名：引号不再进结果，且改动会留痕（guardNotes 记录原始串）', () => {
  const r = run({ ...goodRaw(), theme: '「CPO」' })
  assert.equal(r.verdict, 'named')
  assert.equal(r.theme, 'CPO', '模型包了书名号/引号也要脱掉（否则界面上会显示成「「CPO」」）')
  assert.ok(
    r.guardNotes.some((n) => n.includes('主题名已归一')),
    `归一必须留痕（可追溯改了什么）：${r.guardNotes.join(' | ')}`,
  )
  // 没改动时不留备注（否则"有备注"就不再是信号）
  const clean = run(goodRaw())
  assert.ok(!clean.guardNotes.some((n) => n.includes('主题名已归一')))
})

test('过长主题名：只提示、不截断（半截名字比长名字更容易被误引）', () => {
  const r = run({ ...goodRaw(), theme: '银行、电力、白酒等红利资产同步走强' })
  assert.equal(r.theme, '银行、电力、白酒等红利资产同步走强', '按原样保留')
  assert.ok(r.guardNotes.some((n) => n.includes('偏长')), '但要标注（这是可改进的信号）')
})
