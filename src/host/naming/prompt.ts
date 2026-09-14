/**
 * src/host/naming/prompt.ts —— 命名用的提示词与语料渲染（A2b，移植自 `cluster-namer/llm.py`）。
 *
 * 提示词里的硬性规则**不是礼貌提醒**，而是与 `guard.ts` 一一对应的契约：
 * 每条规则背后都有一段代码在执行（no_common 允许 / 引文逐字 / insufficient 三态 /
 * confidence 不作门控）。改动提示词时必须同步改护栏，否则模型被要求做的事和实际被检查的事
 * 会对不上 —— 那是最难排查的一类"模型不听话"。
 */
import {
  groupByStock,
  windowStart,
  memberLabel,
  SOURCE_STATUS_LABEL,
  type MaterialCorpus,
  type MaterialWindow,
  type NamingMember,
} from './types'

/**
 * 语料里的源标签（给**模型**看的名字）。
 *
 * 为什么要渲染而不是直接打印源键名：系统提示第 0 条要求模型区分「快讯（原因）」与
 * 「板块归属（标签）」—— 渲染出来的名字必须与规则里的名字**逐字一致**，
 * 否则规则落不了地（模型看到的是 `news_flash` / `belong_board` 这种无意义英文串）。
 */
const CORPUS_SOURCE_LABEL: Record<string, string> = {
  news_flash: '快讯',
  belong_board: '板块归属',
  unusual: '异动',
  market_monitor: '主力监控',
  kline: '封板状态',
}

function corpusSourceLabel(source: string): string {
  return CORPUS_SOURCE_LABEL[source] ?? source
}

export const NAMING_SYSTEM_PROMPT = `你是 A 股题材归纳助手。给定一组当日共动的股票及其消息，判断共动是否有同一主题，并命名。
硬性规则：
0. 【素材优先级】素材分两种，来源字段会标明：
   · 「快讯」＝财经媒体 7×24 的**事件**（政策/行业/公司行动，带时间戳）——这是**原因**；
   · 「板块归属」＝厂商题材标签（官方花名册口径）——这只说明"曾经被贴过什么标签"，**不是原因**。
   有能解释共动的快讯事件时，**必须依据该事件命名**，reasoning 写清是哪个事件；
   窗口内没有相关快讯时，才用板块标签兜底，且 reasoning 末尾必须注明「（无事件依据，按板块标签归类）」。
   注意：快讯里结构性罗列行情数据的「盘面派生汇总」（收评/成交额榜/资金榜/指数成分股涨跌）
   已在采集阶段剔除，你不会看到它们 —— 它们复述的是已有行情，不是原因。
1. 找不到共同消息时，必须输出 verdict="no_common"，不得强行编造共性；
2. 每条 evidence 必须来自给定语料，quote 必须逐字取自语料，不得改写或虚构；
3. theme 是「共同敏感主题」的归纳，可用未在语料中出现的概括词（如"CPO"），但不得脱离语料捏造事实；
4. 素材不足（某票无消息/采集失败）时输出 verdict="insufficient"；
5. 输出严格 JSON，不输出任何 JSON 之外的内容。
6. confidence 是你对该归纳的主观把握（0~1），仅用于排序展示，系统不会据此下结论；
   系统会用「证据条数/覆盖票数/证据是否在时间窗内」等可计算指标重新门控。
7. 【theme 的形状】**2~8 个字的题材短名**（例：「存储芯片」「油运」「CPO」「人脑工程」「红利」）。
   不要写成句子或带「板块/概念/题材」后缀，不要在 theme 里写涨跌幅、股票名或"等"字列举；
   需要展开说明就写进 reasoning。走"板块标签兜底"这条路时，优先用**被多数成员共享**的那个
   官方行业/概念词（它可被复核：成员里有多少只挂着它，系统会自己数一遍）。`

export interface BuildPromptArgs {
  classId: number
  asOf: string
  members: NamingMember[]
  corpus: MaterialCorpus
  window: MaterialWindow
  /**
   * 是否把「行业板块」素材也渲染进语料。
   * 默认 true（参照实现把行业板块也放进去供模型参照）；v0 不做官方对照，
   * 但行业词常常正是归纳的共同项，屏蔽它会让命名质量明显下降。
   */
  includeIndustry?: boolean
}

export const NAMING_BATCH_SYSTEM_PROMPT = `你是 A 股题材归纳助手。给定若干组「当日共动的股票」及各组消息，逐组判断该组共动是否有同一主题，并给每组命名。
硬性规则：
0. 【素材优先级】素材分两种，来源字段会标明：
   · 「快讯」＝财经媒体 7×24 的**事件**（政策/行业/公司行动，带时间戳）——这是**原因**；
   · 「板块归属」＝厂商题材标签（官方花名册口径）——这只说明"曾经被贴过什么标签"，**不是原因**。
   某组有能解释共动的快讯事件时，该组**必须依据该事件命名**，reasoning 写清是哪个事件；
   该组窗口内没有相关快讯时，才用板块标签兜底，且 reasoning 末尾必须注明「（无事件依据，按板块标签归类）」。
   注意：快讯里结构性罗列行情数据的「盘面派生汇总」（收评/成交额榜/资金榜/指数成分股涨跌）
   已在采集阶段剔除，你不会看到它们 —— 它们复述的是已有行情，不是原因。
1. 逐组**独立**判断：组与组之间不得互相借证据，也不得因为"两组看起来像同一题材"就合并结论；
2. 某组找不到共同消息时，该组必须输出 verdict="no_common"，不得强行编造共性；
3. 每组的每条 evidence.quote 必须**逐字取自该组**的语料，不得改写、虚构，也不得引用别组的句子；
4. theme 是「共同敏感主题」的归纳，可用未在语料中出现的概括词（如"CPO"），但不得脱离语料捏造事实；
5. 某组素材不足（成员无消息/采集失败）时，该组输出 verdict="insufficient"；
6. 输出严格 JSON（单个对象，results 数组），不要输出任何 JSON 之外的文本；
7. confidence 是你对该组归纳的主观把握（0~1），仅用于排序展示；系统会用可计算指标
   （证据条数/覆盖票数/证据是否在时间窗内）逐组重新门控。
8. 【每组 theme 的形状】**2~8 个字的题材短名**（例：「存储芯片」「油运」「CPO」「红利」）。
   不要写成句子或带「板块/概念/题材」后缀，不要在 theme 里写涨跌幅、股票名或"等"字列举；
   需要展开说明就写进该组的 reasoning。走"板块标签兜底"这条路时，优先用**被该组多数成员共享**
   的那个官方行业/概念词（它可被复核：组里有多少只挂着它，系统会自己数一遍）。
   各组之间**不要为了统一风格而互相模仿**：两组一个是"铜"一个是"铝"就照实分开写。`

/** 一组待命名的类（batch 用）。 */
export interface BatchGroup {
  classId: number
  members: NamingMember[]
  corpus: MaterialCorpus
}

export interface BuildBatchPromptArgs {
  asOf: string
  groups: BatchGroup[]
  window: MaterialWindow
  includeIndustry?: boolean
}

/**
 * 组装**批量**命名 prompt（多组一次问完）。
 *
 * 为什么批量：类列表面向"打开就要看到名字"，逐类调用等于 9–10 次模型请求；
 * 一次问完既省预算，也让模型能看到彼此的区别（"这组是铜、那组是铝"，逐类问时它更容易
 * 把两组都叫成"有色金属"）。代价是 prompt 更长，所以调用方按成员数分批（见 `run.ts` 的
 * `maxMembersPerCall`）—— 批次边界只影响请求次数，不影响任何一组的口径。
 */
export function buildBatchPrompt(args: BuildBatchPromptArgs): string {
  const lines: string[] = []
  const total = args.groups.reduce((s, g) => s + g.members.length, 0)
  lines.push(`【任务】下面 ${args.groups.length} 组股票（共 ${total} 只）在 ${args.asOf} 当日同涨同跌（K 线残差共动，非人为分组）。`)
  lines.push('        请**逐组**判断它们是否因为同一主题/题材而共动，并给出命名。')
  const start = windowStart(args.window)
  for (const g of args.groups) {
    lines.push('')
    lines.push(`========== 第 ${g.classId} 组（${g.members.length} 只） ==========`)
    lines.push('【成员票与当日表现】')
    for (const m of g.members) {
      const pct = m.changePct == null ? '' : `${m.changePct >= 0 ? '+' : ''}${m.changePct.toFixed(2)}%`
      lines.push(`- ${memberLabel(m)}  ${pct}`.trimEnd())
    }
    lines.push(`【本组素材（时间窗 ${start} ~ ${args.window.end}，共 ${args.window.days} 天）】`)
    const byStock = groupByStock(g.corpus.items)
    for (const m of g.members) {
      const label = memberLabel(m)
      lines.push(`=== ${label} ===`)
      const items = (byStock.get(label) ?? []).filter(
        (i) => args.includeIndustry !== false || i.kind !== 'board_industry',
      )
      if (items.length === 0) lines.push('（窗口内无素材）')
      for (const item of items) {
        const body = item.snippet ? `${item.title} / ${item.snippet}` : item.title
        lines.push(`[${corpusSourceLabel(item.source)} ${item.ts}] ${body}`)
      }
    }
    if (g.corpus.sources && g.corpus.sources.length > 0) {
      // 逐源状态**照事实给**（不再给含混的"缺失源"）：否则模型会把"按设计跳过"
      // 写成"采集失败"，而这段文字会被用户当成系统归因读（见 cause.ts 头部）。
      lines.push('【本组素材来源状态（系统事实，不需要你解释）】')
      for (const s of g.corpus.sources) lines.push(`- ${SOURCE_STATUS_LABEL[s.status]}：${s.source}（${s.detail}）`)
    } else if (g.corpus.missingSources.length > 0) {
      lines.push(`【本组采集缺失的源】${g.corpus.missingSources.join(', ')}`)
    }
  }
  lines.push('')
  lines.push('【输出要求】')
  lines.push('严格输出如下 JSON，不要输出任何 JSON 之外的文本；results 必须**每组一项**，class_id 与上面一致：')
  lines.push(
    '{"results":[{"class_id": 2, "verdict": "named|no_common|insufficient", "theme": "主题名或null", "confidence": 0.0,' +
      ' "alternatives": ["备选1"],' +
      ' "evidence": [{"stock": "代码 名称", "source": "来源", "quote": "逐字取自语料", "ts": "素材时间戳"}],' +
      ' "reasoning": "一句话说明时间关系与归纳依据"}]}',
  )
  return lines.join('\n')
}

/** 组装 user prompt（成员票 + 各自素材 + 输出要求）。 */
export function buildUserPrompt(args: BuildPromptArgs): string {
  const { members, corpus, window } = args
  const lines: string[] = []
  lines.push(`【任务】下面 ${members.length} 只股票在 ${args.asOf} 当日同涨同跌（K 线残差共动，非人为分组），`)
  lines.push('        请判断它们是否因为同一主题/题材而共动，并给出命名。')
  lines.push('')
  lines.push('【成员票与当日表现】')
  for (const m of members) {
    const pct = m.changePct == null ? '' : `${m.changePct >= 0 ? '+' : ''}${m.changePct.toFixed(2)}%`
    lines.push(`- ${memberLabel(m)}  ${pct}`.trimEnd())
  }
  lines.push('')
  const start = windowStart(window)
  lines.push(`【各自近期素材（时间窗 ${start} ~ ${window.end}，共 ${window.days} 天）】`)
  const byStock = groupByStock(corpus.items)
  for (const m of members) {
    const label = memberLabel(m)
    lines.push(`=== ${label} ===`)
    const items = (byStock.get(label) ?? []).filter(
      (i) => args.includeIndustry !== false || i.kind !== 'board_industry',
    )
    if (items.length === 0) lines.push('（窗口内无素材）')
    for (const item of items) {
      const body = item.snippet ? `${item.title} / ${item.snippet}` : item.title
      lines.push(`[${corpusSourceLabel(item.source)} ${item.ts}] ${body}`)
    }
  }
  if (corpus.sources && corpus.sources.length > 0) {
    lines.push('')
    lines.push('【素材来源状态（系统事实，不需要你解释）】')
    for (const s of corpus.sources) lines.push(`- ${SOURCE_STATUS_LABEL[s.status]}：${s.source}（${s.detail}）`)
    lines.push('若因此无法归纳，直接给 verdict="insufficient" 即可，不要猜测或解释缺失原因。')
  } else if (corpus.missingSources.length > 0) {
    lines.push('')
    lines.push(`【采集缺失的源】${corpus.missingSources.join(', ')}`)
  }
  lines.push('')
  lines.push('【输出要求】')
  lines.push('严格输出如下 JSON，不要输出任何 JSON 之外的文本：')
  lines.push(
    '{"verdict": "named|no_common|insufficient", "theme": "主题名或null", "confidence": 0.0,' +
      ' "alternatives": ["备选1"],' +
      ' "evidence": [{"stock": "代码 名称", "source": "来源", "quote": "逐字取自语料", "ts": "素材时间戳"}],' +
      ' "reasoning": "一句话说明时间关系与归纳依据"}',
  )
  return lines.join('\n')
}
