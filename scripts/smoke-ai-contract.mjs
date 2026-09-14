// scripts/smoke-ai-contract.mjs —— AI 直调链路的离线契约冒烟（无需宿主/网络/真模型）
//
// 用法：
//   pnpm build && node scripts/smoke-ai-contract.mjs
//
// 覆盖三件事（这三件都是「线上才会暴露、但可以离线断言」的）：
//   1. **prompt 组装**：任务模板 + 数据 + 追加要求都进了 prompt，且明确要求只输出 JSON；
//   2. **容错解析**：围栏代码块 / 前后夹话 / 嵌套一层 / 越界分数 / 非法符号 /
//      非数组字段 —— 都必须要么归一成合法结构，要么返回 null（绝不抛异常）；
//   3. **调用链路**：用假的 ctx.llm 跑 runAiTask，验证
//      text-delta 拼接 → 解析 → meta；以及「无 llm / 无默认路由 / 模型抛错 /
//      只回思考不回正文 / 上下文超限」五种失败都转成结构化 {ok:false,kind}。
//
// 不依赖真模型：断言的是**契约**（我们自己的解析与降级），不是模型质量。

import { existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const ENTRY = join(ROOT, 'lib', 'index.js')

let failures = 0
function assert(cond, msg) {
  if (cond) console.log(`  ✅ ${msg}`)
  else {
    failures += 1
    console.error(`  ❌ ${msg}`)
  }
}

/**
 * 假模型：按脚本吐出 text/reasoning delta 与 finish，或直接抛错。
 * 传数组 = 每次调用依次用不同脚本（用于断言「自愈重试」的第二次调用）。
 */
function fakeLlm(scriptOrScripts) {
  const scripts = Array.isArray(scriptOrScripts) ? scriptOrScripts : [scriptOrScripts]
  const calls = []
  return {
    calls,
    stream(options) {
      calls.push(options)
      const script = scripts[Math.min(calls.length - 1, scripts.length - 1)]
      if (script.throwError !== undefined) {
        return (async function* () {
          throw new Error(script.throwError)
        })()
      }
      return (async function* () {
        for (const t of script.text ?? []) yield { type: 'text-delta', index: 0, text: t }
        for (const t of script.reasoning ?? []) yield { type: 'reasoning-delta', index: 1, text: t }
        yield { type: 'finish', reason: script.finish ?? { kind: 'stop' } }
      })()
    },
  }
}

/** 造一个「60 根日 K」量级的上下文（自愈重试的触发场景）。 */
function bigKlineContext(rows = 60) {
  const dailyKline = []
  for (let i = 0; i < rows; i++) {
    dailyKline.push({ d: `2026-08-${String((i % 28) + 1).padStart(2, '0')}`, o: 100 + i, h: 102 + i, l: 99 + i, c: 101 + i, v: 30000 + i })
  }
  return { symbol: 'SH600519', name: '贵州茅台', dailyKline }
}

async function main() {
  if (!existsSync(ENTRY)) {
    console.error(`[smoke-ai-contract] 缺 ${ENTRY} —— 先跑 pnpm build`)
    process.exit(1)
  }
  const mod = await import(pathToFileUrl(ENTRY))
  const { buildAiPrompt, parseAiResult, contextBytes, runAiTask, aiAvailability, resolveAiRuntime, shrinkContext } = mod

  console.log('[1] prompt 组装')
  const p = buildAiPrompt('stock-verdict', { symbol: 'SH600519', quote: { close: 1680 } }, '只看 3 天')
  assert(typeof p.system === 'string' && p.system.includes('JSON'), 'system 里明确要求只输出 JSON')
  assert(p.user.includes('SH600519') && p.user.includes('1680'), 'user 里带了标的与数据')
  assert(p.user.includes('只看 3 天'), '追加要求进了 prompt')
  assert(p.user.includes('"stance"') && p.user.includes('"levels"'), 'stock-verdict 的形状说明在 prompt 里')
  const p2 = buildAiPrompt('review-plan', { breadth: { up: 3000 } })
  assert(p2.user.includes('"items"'), 'review-plan 的形状说明在 prompt 里')
  assert(
    p2.user.includes('myExpectations') && p2.user.includes('原样复用'),
    'review-plan 明确要求「先给用户自己的 myExpectations 打分并复用其 text」',
  )
  const p3 = buildAiPrompt('scout-rank', { candidates: [] })
  assert(p3.user.includes('"picks"'), 'scout-rank 的形状说明在 prompt 里')
  assert(p3.user.includes('不要新增候选之外的票'), 'scout-rank 明确禁止编造候选外的票')
  const p4 = buildAiPrompt('war-plan', { sectorUniverse: ['机器人概念'], ladder: [] })
  assert(p4.user.includes('"sectors"') && p4.user.includes('"verdicts"'), 'war-plan 的形状说明在 prompt 里')
  assert(p4.user.includes('sectorUniverse') && p4.user.includes('逐字'), 'war-plan 明确要求方向名逐字取自素材')
  assert(p4.user.includes('insufficient'), 'war-plan 允许并给出了「证据不足」这一正确回答的形状')

  console.log('[2] 容错解析')
  const clean = '{"stance":"bullish","score":72,"oneLine":"放量突破","thesis":["量比2.1"],"risks":["高位"],"levels":{"support":1600,"stop":1580},"watch":["开盘承接"]}'
  const v1 = parseAiResult('stock-verdict', clean)
  assert(v1?.stance === 'bullish' && v1.score === 72, '干净 JSON 直接解析')

  const fenced = '```json\n' + clean + '\n```'
  assert(parseAiResult('stock-verdict', fenced)?.score === 72, 'markdown 围栏被剥离')

  const chatty = '好的，我的结论如下：\n' + clean + '\n以上仅供参考。'
  assert(parseAiResult('stock-verdict', chatty)?.score === 72, '前后夹话时按花括号配平取对象')

  const quoted = '{"result":' + clean + '}'
  assert(parseAiResult('stock-verdict', quoted)?.oneLine === '放量突破', '包一层 result/data 也能取到内层')

  const messy = '{"stance":"看多","score":180,"oneLine":"  ","thesis":["a","a","",1,"b"],"risks":"不是数组","levels":{"support":"1600","stop":-5},"watch":[]}'
  const v2 = parseAiResult('stock-verdict', messy)
  assert(v2 !== null, '脏数据仍能归一（不返回 null）')
  assert(v2.score === 100, `越界 score 被夹取到 100（实际 ${v2?.score}）`)
  assert(v2.stance === 'neutral', '非法 stance 回落 neutral')
  assert(v2.thesis.length === 2 && v2.thesis[0] === 'a', 'thesis 去重去空去非字符串')
  assert(Array.isArray(v2.risks) && v2.risks.length === 0, '非数组字段回落空数组')
  assert(v2.levels?.support === 1600 && v2.levels?.stop === undefined, '字符串数字可接受、负价位被丢弃')

  assert(parseAiResult('stock-verdict', '完全不是 JSON 的一段话') === null, '纯文本返回 null（调用方保留原文）')
  assert(parseAiResult('stock-verdict', '') === null, '空串返回 null')

  const review = parseAiResult(
    'review-plan',
    '{"summary":"缩量分歧","items":[{"text":"低位补涨","score":"80","reason":"主线内"},{"text":"a","score":10,"reason":"b"},{"text":"","score":90,"reason":"c"},{"text":"d","score":95,"reason":"e"},{"text":"f","score":99,"reason":"g"},{"text":"超出上限","score":100,"reason":"h"}]}',
  )
  assert(review !== null && review.items.length === 5, 'items 截断到 5 条上限')
  assert(review.items[0].score >= review.items[1].score, 'items 按 score 降序')
  assert(review.items.every((i) => i.text !== ''), '空 text 条目被剔除')

  const rank = parseAiResult(
    'scout-rank',
    '{"summary":"s","picks":[{"symbol":"600519","score":90,"reason":"r"},{"symbol":"不是代码","score":88,"reason":"r"},{"symbol":"SZ000001","name":"平安银行","score":"70","reason":"r"}]}',
  )
  assert(rank !== null && rank.picks.length === 2, '非法 symbol 条目被剔除')
  assert(rank.picks[0].symbol === 'SH600519', '纯 6 位代码补全市场前缀（6→SH）')
  assert(rank.picks[1].symbol === 'SZ000001', '带前缀符号原样保留')
  assert(rank.picks[0].score === 90 && rank.picks[1].score === 70, '字符串分数被转成数字')

  // v1.6 作战思路：素材不足是**合法结论**（不能被当成解析失败吞掉），
  // 而"越界点名"由 host 半护栏剔除（这里只验契约层的形状归一）。
  const insufficient = parseAiResult('war-plan', '{"insufficient":true,"reason":"行情取数失败，不给思路"}')
  assert(insufficient !== null && insufficient.insufficient === true, 'insufficient 结论被保留（不是解析失败）')
  assert(insufficient.sectors.length === 0 && insufficient.picks.length === 0, '不足结论不带任何方向与候选')
  const war = parseAiResult(
    'war-plan',
    '{"summary":"机器人共振","stance":"进攻","sectors":[{"name":"机器人概念","source":"瞎写","score":"80","members":["002747","nope"]}],'
      + '"picks":[{"symbol":"002747","score":150,"role":"主攻"}],"q1":{"value":"增强"},"q2":{"value":"bogus"},'
      + '"actions":[{"symbol":"300750","action":"加仓"}],"verdicts":[{"symbol":"002747","verdict":"乱写"}],"avoid":"不追高","evidence":"涨停 23 家"}',
  )
  assert(war !== null && war.insufficient === false, '有内容的回包能归一')
  assert(war.stance === 'wait' && war.q1.value === 'flat' && war.q2.value === 'normal', '非法枚举回落安全值')
  assert(war.sectors[0].members.length === 1 && war.sectors[0].members[0] === 'SZ002747', '成员里的垃圾符号被剔除')
  assert(war.picks[0].symbol === 'SZ002747' && war.picks[0].score === 100, '符号补前缀 + 分数夹取')
  assert(war.actions[0].action === 'hold' && war.verdicts[0].verdict === 'confirm', '动作/判定回落安全值')
  assert(war.avoid.length === 1 && war.evidence.length === 1, 'avoid/evidence 写成裸字符串也认')
  assert(war.guard.symbolPool === 0 && war.guard.droppedSymbols.length === 0, '契约层不做白名单（护栏在 host 半，见 guardWarPlan）')

  console.log('[3] 调用链路（假模型）')
  const rt = {
    llm: fakeLlm({ text: ['{"stance":"bear', 'ish","score":30,"oneLine":"破位",', '"thesis":["跌破MA20"],"risks":[],"watch":[]}'], reasoning: ['先看趋势…'] }),
    defaultModel: { currentSelection: () => ({ provider: 'deepseek', model: 'deepseek-chat' }) },
  }
  const ok = await runAiTask(rt, { task: 'stock-verdict', context: { symbol: 'SH600519' } })
  assert(ok.ok === true, '正常回包 ok=true')
  assert(ok.json?.stance === 'bearish' && ok.json?.score === 30, '分片 text-delta 被拼成完整 JSON 并解析')
  assert(ok.meta?.provider === 'deepseek' && ok.meta?.model === 'deepseek-chat', 'meta 记录实际路由')
  assert(typeof ok.reasoning === 'string' && ok.reasoning.includes('趋势'), '思考内容单独回传（不参与解析）')
  assert(rt.llm.calls[0].messages.length === 1 && rt.llm.calls[0].messages[0].role === 'user', '请求带一条 user 消息')
  assert(rt.llm.calls[0].messages[0].source?.kind === 'plugin', '消息 source 标为 plugin（官方 Message 形状）')
  assert(rt.llm.calls[0].system.length > 0 && rt.llm.calls[0].maxTokens > 0, 'system 与 maxTokens 都传了')

  const rtBadJson = { llm: fakeLlm({ text: ['模型说了很多话但没有 JSON'] }), defaultModel: rt.defaultModel }
  const badJson = await runAiTask(rtBadJson, { task: 'stock-verdict', context: {} })
  assert(badJson.ok === true && badJson.json === undefined && badJson.text === '模型说了很多话但没有 JSON',
    '非 JSON 回包：ok=true 但无 json，原文保留（视图兜底显示）')

  // ── 作战思路（war-plan）：host 半是**唯一**执行素材护栏的地方，必须离线钉住 ──
  // 「以其他板块为基础」这条纪律如果只写在 prompt 里，就等于没有。这里用假模型故意越界：
  // 点名素材外的票、自造板块名、编一条查不到出处的引文 —— 断言它们被剔除并回传在 guard 里。
  const warCtx = {
    day: '2026-09-14',
    sectorUniverse: ['机器人概念'],
    boards: [{ name: '机器人概念', limitUpCount: 23 }],
    ladder: [{ symbol: 'SZ002747', name: '埃斯顿', streak: 2 }],
    watchlist: [{ symbol: 'SH600519', name: '贵州茅台' }],
    concepts: [{ id: 3, members: [{ symbol: 'SZ002747', pct: 10.01 }] }],
    missing: [],
  }
  const warScript = {
    text: [JSON.stringify({
      summary: '机器人概念 5 家涨停',
      stance: 'attack',
      sectors: [
        { name: '机器人概念', source: 'board', score: 80, why: '板块 5 家涨停', members: ['SZ002747', 'SH601398'] },
        { name: '人形机器人核心零部件', source: 'concept', score: 90, why: '听起来很专业', members: [] },
      ],
      picks: [
        { symbol: 'SZ002747', role: '主攻', score: 85, reason: 'r', trigger: '高开 3%', stop: '破 5 日线' },
        { symbol: 'SH601398', role: '编的', score: 99, reason: 'r', trigger: 't', stop: 's' },
      ],
      actions: [{ symbol: 'SH601398', action: 'clear', why: '编的' }],
      verdicts: [{ symbol: 'SH601398', verdict: 'trap', why: '编的' }],
      evidence: ['涨停 23 家', '主力净流入 88.88 亿'],
    })],
  }
  const rtWar = { llm: fakeLlm(warScript), defaultModel: rt.defaultModel }
  const warRun = await runAiTask(rtWar, { task: 'war-plan', context: warCtx })
  assert(warRun.ok === true && typeof warRun.json === 'object', 'war-plan 是已知任务（whitelist 放开）')
  assert(warRun.json.sectors.length === 1 && warRun.json.sectors[0].name === '机器人概念', '自造板块名被剔除')
  assert(warRun.json.sectors[0].members.length === 1, '方向成员过票白名单')
  assert(warRun.json.picks.length === 1 && warRun.json.picks[0].symbol === 'SZ002747', '素材外的候选被剔除')
  assert(warRun.json.actions.length === 0 && warRun.json.verdicts.length === 0, '素材外的持仓动作/竞价判定被剔除')
  assert(warRun.json.guard.droppedSymbols.length === 4 && warRun.json.guard.droppedSectors.length === 1,
    `越界点名全部留痕（实际 ${warRun.json.guard.droppedSymbols.length} 票 / ${warRun.json.guard.droppedSectors.length} 方向）`)
  assert(warRun.json.guard.grounded === 1 && warRun.json.guard.ungrounded.length === 1,
    '引文反查：编造的数字被标未落地，真实数字计入可反查')
  assert(warRun.json.guard.symbolPool === 2 && warRun.json.guard.sectorPool === 1, '白名单规模回传（界面显示"可点名几只票"）')
  assert(typeof warRun.meta?.contextBytes === 'number' && warRun.meta.contextBytes > 0,
    'meta 回传上下文体积（客户端因此不必引 ai-contract 的值）')

  const rtNoLlm = { defaultModel: rt.defaultModel }
  const noLlm = await runAiTask(rtNoLlm, { task: 'stock-verdict', context: {} })
  assert(noLlm.ok === false && noLlm.kind === 'no-model', '无 ctx.llm → kind=no-model')

  const rtNoRoute = { llm: fakeLlm({ text: ['{}'] }) }
  const noRoute = await runAiTask(rtNoRoute, { task: 'stock-verdict', context: {} })
  assert(noRoute.ok === false && noRoute.kind === 'no-model', '无默认路由 → kind=no-model')

  const rtThrow = { llm: fakeLlm({ throwError: 'provider 401' }), defaultModel: rt.defaultModel }
  const thrown = await runAiTask(rtThrow, { task: 'stock-verdict', context: {} })
  assert(thrown.ok === false && thrown.kind === 'llm-error' && thrown.error.includes('401'), '模型抛错 → kind=llm-error 且带原因')

  const rtEmpty = {
    llm: fakeLlm({ text: [], reasoning: ['我先把 60 根日 K 全部推理一遍…'], finish: { kind: 'max-tokens' } }),
    defaultModel: rt.defaultModel,
  }
  const empty = await runAiTask(rtEmpty, { task: 'stock-verdict', context: {} })
  assert(
    empty.ok === false && empty.kind === 'llm-error' && empty.error.includes('输出预算'),
    '只回思考/被截断 → 报错说明预算用尽在思考上（而非静默空结果）',
  )
  assert(empty.reasoning === '我先把 60 根日 K 全部推理一遍…', '失败时也回传思考内容（不留空白失败框）')
  // 真机踩坑回归（2026-09-11）：maxTokens 是 reasoning + 正文的共享预算；
  // 给 1600 时「60 根日 K」的上下文会 0 正文直接失败。守住「不能回退到过小的值」。
  assert(
    rtEmpty.llm.calls[0].maxTokens >= 4000,
    `maxTokens 必须覆盖思考+正文（实际 ${rtEmpty.llm.calls[0].maxTokens}，护栏 4000）`,
  )

  // 不可裁剪的超限：顶层只有嵌套字符串（shrinkContext 只看顶层数组/字符串）
  const rtBig = { llm: fakeLlm({ text: ['{}'] }), defaultModel: rt.defaultModel }
  const big = await runAiTask(rtBig, { task: 'stock-verdict', context: { blob: { nested: 'x'.repeat(30000) } } })
  assert(big.ok === false && big.kind === 'context-too-large', '上下文超上限且无可裁剪字段 → kind=context-too-large')
  assert(big.error.includes('无可继续裁剪'), `错误说明含「无可继续裁剪」（实际：${big.error}）`)
  assert(rtBig.llm.calls.length === 0, '超限在打模型之前就被拦住（不浪费一次调用）')

  console.log('[3b] 自愈重试（真机踩坑回归：推理模型把输出预算烧在思考上）')
  const good = '{"stance":"bullish","score":66,"oneLine":"放量突破","thesis":["量比2.1"],"risks":["高位"],"watch":["开盘承接"]}'
  const rtHeal = {
    llm: fakeLlm([
      { text: [], reasoning: ['（第一次：把 60 根日 K 全推理一遍，预算烧光）'], finish: { kind: 'max-tokens' } },
      { text: [good], finish: { kind: 'stop' } },
    ]),
    defaultModel: rt.defaultModel,
  }
  const heal = await runAiTask(rtHeal, { task: 'stock-verdict', context: bigKlineContext(60) })
  assert(heal.ok === true && heal.json?.score === 66, '首次「只回思考」→ 自动裁剪上下文重试后成功')
  assert(rtHeal.llm.calls.length === 2, `确实发起了第二次调用（实际 ${rtHeal.llm.calls.length} 次）`)
  assert(
    Array.isArray(heal.meta?.shrunk) && heal.meta.shrunk.length === 1,
    `meta.shrunk 记录了裁剪说明：${JSON.stringify(heal.meta?.shrunk)}`,
  )
  assert(heal.meta?.attempts === 2, `meta.attempts = ${heal.meta?.attempts}`)
  const firstPrompt = rtHeal.llm.calls[0].messages[0].content[0].text
  const secondPrompt = rtHeal.llm.calls[1].messages[0].content[0].text
  assert(secondPrompt.length < firstPrompt.length, `第二次 prompt 确实更小（${firstPrompt.length} → ${secondPrompt.length} 字符）`)
  assert(secondPrompt.includes('2026-08-'), '裁剪后仍是真实数据（保留尾部日 K，不是空上下文）')
  assert(heal.reasoning === undefined || typeof heal.reasoning === 'string', '成功回包不因重试而串味')

  const rtHopeless = {
    llm: fakeLlm({ text: [], reasoning: ['想'], finish: { kind: 'max-tokens' } }),
    defaultModel: rt.defaultModel,
  }
  const hopeless = await runAiTask(rtHopeless, { task: 'stock-verdict', context: bigKlineContext(60) })
  assert(
    hopeless.ok === false && hopeless.error.includes('仍不足'),
    `裁到底仍无正文 → 明确说明「已自动裁剪仍不足」（实际：${hopeless.error}）`,
  )
  assert(
    Array.isArray(hopeless.meta?.shrunk) && hopeless.meta.shrunk.length >= 2,
    `失败回包也带上裁剪记录，便于排查：${JSON.stringify(hopeless.meta?.shrunk)}`,
  )
  assert(rtHopeless.llm.calls.length === 3, `最多尝试 3 次后停止（实际 ${rtHopeless.llm.calls.length} 次，不能无限重试）`)

  const rtHuge = { llm: fakeLlm({ text: [good], finish: { kind: 'stop' } }), defaultModel: rt.defaultModel }
  const hugeCandidates = []
  for (let i = 0; i < 900; i++) hugeCandidates.push({ symbol: `SH${600000 + i}`, name: `候选${i}`, pct: 1.23, reason: '量比放大' })
  const huge = await runAiTask(rtHuge, { task: 'scout-rank', context: { candidates: hugeCandidates } })
  assert(huge.ok === true, '超过 24KB 上限但可裁剪 → 自动裁剪后继续（不是直接失败）')
  assert(
    Array.isArray(huge.meta?.shrunk) && huge.meta.shrunk.length >= 1,
    `超限自愈也记录说明：${JSON.stringify(huge.meta?.shrunk)}`,
  )

  console.log('[3c] shrinkContext 单测')
  const tailShrunk = shrinkContext({ dailyKline: bigKlineContext(60).dailyKline })
  assert(tailShrunk?.note.includes('尾部最新'), `时间序列留尾部：${tailShrunk?.note}`)
  const headShrunk = shrinkContext({ candidates: Array.from({ length: 40 }, (_, i) => ({ i })) })
  assert(headShrunk?.note.includes('头部'), `排序列表留头部：${headShrunk?.note}`)
  assert(shrinkContext({ a: 1, b: 'short' }) === null, '无可裁剪字段 → null（由调用方给出明确错误）')
  assert(shrinkContext(null) === null, 'null 上下文不抛异常')

  const badTask = await runAiTask(rt, { task: 'nope', context: {} })
  assert(badTask.ok === false && badTask.kind === 'bad-request', '未知任务 → kind=bad-request')
  assert(rt.llm.calls.length === 1, '校验失败的任务不会打模型（只留第 1 次的调用记录）')

  console.log('[4] 可用性探测')
  const availNoLlm = aiAvailability(resolveAiRuntime({}, undefined))
  assert(availNoLlm.available === false && typeof availNoLlm.reason === 'string', 'resolveAiRuntime({}) → 不可用并给原因')
  const availOk = aiAvailability({
    llm: fakeLlm({ text: ['{}'] }),
    defaultModel: { currentSelection: () => ({ provider: 'p', model: 'm' }) },
  })
  assert(availOk.available === true && availOk.provider === 'p' && availOk.model === 'm', '有 llm + 默认路由 → 可用且报出路由')
  const availFallback = aiAvailability({ llm: fakeLlm({ text: ['{}'] }), fallback: { provider: 'fb', model: 'fm' } })
  assert(availFallback.available === true && availFallback.model === 'fm', '无默认模型时用兜底路由')
  const fakeCtx = { get: (k) => (k === 'llm' ? fakeLlm({ text: ['{}'] }) : undefined), agentDefaultModel: { currentSelection: () => ({ provider: 'via-prop', model: 'm2' }) } }
  const viaGet = aiAvailability(resolveAiRuntime(fakeCtx, undefined))
  assert(viaGet.available === true, 'ctx.get("llm") 与属性直读两条访问路径都能取到服务')

  console.log('[5] 上下文计量')
  // JSON.stringify({a:'中'}, null, 1) => '{\n "a": "中"\n}'：12 个 ASCII 字符 + 1 个 CJK
  // 字符 → 12 + 3 = 15 字节（用于守住「中文按 3 字节估算」的口径）。
  assert(contextBytes({ a: '中' }) === 15, `中文按 3 字节计（实际 ${contextBytes({ a: '中' })}）`)
  assert(contextBytes({ a: '😀' }) === 16, `4 字节字符（代理对）按 4 字节计（实际 ${contextBytes({ a: '😀' })}）`)
  assert(contextBytes(null) > 0, 'contextBytes 对 null 不抛异常')

  if (failures > 0) {
    console.error(`[smoke-ai-contract] ${failures} 项断言失败`)
    process.exit(1)
  }
  console.log('[smoke-ai-contract] 全部通过 ✅')
}

function pathToFileUrl(p) {
  return new URL('file://' + p.replace(/\\/g, '/')).href
}

main().catch((err) => {
  console.error('[smoke-ai-contract] 失败:', err?.stack ?? err)
  process.exit(1)
})
