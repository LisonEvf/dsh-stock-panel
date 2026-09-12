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
  type MaterialCorpus,
  type MaterialWindow,
  type NamingMember,
} from './types'

export const NAMING_SYSTEM_PROMPT = `你是 A 股题材归纳助手。给定一组当日共动的股票及其消息，判断共动是否有同一主题，并命名。
硬性规则：
1. 找不到共同消息时，必须输出 verdict="no_common"，不得强行编造共性；
2. 每条 evidence 必须来自给定语料，quote 必须逐字取自语料，不得改写或虚构；
3. theme 是「共同敏感主题」的归纳，可用未在语料中出现的概括词（如"CPO"），但不得脱离语料捏造事实；
4. 素材不足（某票无消息/采集失败）时输出 verdict="insufficient"；
5. 输出严格 JSON，不输出任何 JSON 之外的内容。
6. confidence 是你对该归纳的主观把握（0~1），仅用于排序展示，系统不会据此下结论；
   系统会用「证据条数/覆盖票数/证据是否在时间窗内」等可计算指标重新门控。`

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
      lines.push(`[${item.source} ${item.ts}] ${body}`)
    }
  }
  if (corpus.missingSources.length > 0) {
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
