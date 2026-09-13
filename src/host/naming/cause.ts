/**
 * src/host/naming/cause.ts —— 素材状态的**归因**：把逐源状态翻译成给人看的原因。
 *
 * ## 为什么单独一个模块，而且必须模板化
 * 原来的做法是把 `missingSources: string[]` 交给模型，由模型在 `reasoning` 里解释
 * "为什么没命名"。于是模型看到"缺失源 belong_board/kline/..."就写成
 * 「等源**采集失败**」—— 而真实状态是：两个源**按设计跳过**（as_of ≠ 当前交易日）、
 * 两个源**调用成功但没有产出**、零个源失败。
 *
 * 归因是**事实陈述**，不该由被审计的对象（模型）来写；它是可计算的，就必须算出来。
 * 所以：`SourceReport` 是唯一真源 → 本模块用**确定性模板**产出 `causeNote` 与
 * `degradedReason` → UI 分开显示"系统归因"与"模型说明"。
 *
 * 兼容性：旧语料只带 `missingSources`（没有逐源状态）时，退回旧口径并**如实标注
 * "来源信息不足"**，不猜。
 */
import type { DegradedReason, SourceReport, SourceStatus } from './types'
import { SOURCE_STATUS_LABEL } from './types'

/** 逐源状态计数（批量头条按它聚合）。 */
export interface SourceStatusCounts {
  used: number
  skipped_by_design: number
  no_material: number
  failed: number
}

/** 数一数每类状态各几个源。 */
export function countSourceStatus(sources: readonly SourceReport[] | undefined): SourceStatusCounts {
  const out: SourceStatusCounts = { used: 0, skipped_by_design: 0, no_material: 0, failed: 0 }
  for (const s of sources ?? []) out[s.status] += 1
  return out
}

/** 源的展示名（文案里不出现英文键名）。 */
const SOURCE_LABEL: Record<string, string> = {
  unusual: '市场异动',
  market_monitor: '主力监控',
  belong_board: '板块归属',
  kline: '封板状态(日K)',
  // 板块级快讯（新浪 7×24）：本站唯一能解释"为什么一起动"的源
  news_flash: '板块级快讯',
}

function labelOf(source: string): string {
  return SOURCE_LABEL[source] ?? source
}

/**
 * 由采集事实生成**确定性**成因文案（进 UI 的"系统归因"、也进模型提示词作为事实背景）。
 *
 * @param sources 逐源状态（可能为空 = 旧语料/未采集）
 * @param itemCount 采纳的素材条数
 * @param memberCount 本组成员数（0/未知时不提百分比）
 */
export function describeMaterialCause(
  sources: readonly SourceReport[] | undefined,
  itemCount: number,
  memberCount = 0,
): string {
  if (!sources || sources.length === 0) {
    return itemCount === 0
      ? '本次采集没有产出任何素材（逐源状态未记录：旧语料或采集未执行）'
      : `本次采集共 ${itemCount} 条素材（逐源状态未记录）`
  }
  const parts: string[] = []
  const skipped = sources.filter((s) => s.status === 'skipped_by_design')
  const failed = sources.filter((s) => s.status === 'failed')
  const noMat = sources.filter((s) => s.status === 'no_material')
  const used = sources.filter((s) => s.status === 'used')

  if (used.length > 0) {
    parts.push(`已采用：${used.map((s) => `${labelOf(s.source)} ${s.produced} 条`).join('、')}`)
  }
  if (skipped.length > 0) {
    // 同一原因常常适用于多个源（例如两个实时源共享同一个 as_of 口径）→ 去重，别重复念一遍
    const details = [...new Set(skipped.map((s) => s.detail))]
    parts.push(`按设计跳过：${skipped.map((s) => labelOf(s.source)).join('、')}（${details.join('；')}）`)
  }
  if (noMat.length > 0) {
    parts.push(`无产出：${noMat.map((s) => `${labelOf(s.source)}（${s.detail}）`).join('；')}`)
  }
  if (failed.length > 0) {
    parts.push(`**采集失败**：${failed.map((s) => `${labelOf(s.source)}（${s.detail}）`).join('；')}`)
  }

  const head =
    itemCount === 0
      ? `本组${memberCount > 0 ? ` ${memberCount} 只成员` : ''}未采到任何可用素材`
      : `本组共 ${itemCount} 条素材`
  return `${head}：${parts.join('；')}`
}

/** 降级判定的输入。 */
export interface DegradedInput {
  sources?: readonly SourceReport[] | undefined
  itemCount: number
  /** 有多少成员票完全没有素材（partial_material 判据）。 */
  missingMemberCount: number
  /** 旧语料的"缺失源"（无逐源状态时的回退依据）。 */
  legacyMissingSources?: readonly string[]
}

/**
 * 定降级成因（**按采集事实定**，不看模型怎么解释）。
 *
 * 优先级：采集失败 > 实时源按设计跳过（且无产出） > 窗口内本来就没素材 >
 * 部分成员无素材 > 模型判不足。前两者是"我们的数据边界"，中间两者是"市场事实"，
 * 最后一个才是"模型判断"—— 复盘的处置完全不同，不能混。
 */
export function pickDegradedReason(input: DegradedInput): DegradedReason {
  const sources = input.sources
  const counts = countSourceStatus(sources)

  // 有逐源状态：按事实定档
  if (sources && sources.length > 0) {
    if (counts.failed > 0) return 'source_failed'
    if (input.itemCount === 0) {
      if (counts.skipped_by_design > 0) return 'source_skipped'
      return 'no_material'
    }
    if (input.missingMemberCount > 0) return 'partial_material'
    if (counts.skipped_by_design > 0) return 'source_skipped'
    // 素材齐全、成员齐、源也齐 → 只能是模型自己判的不足
    return 'llm_insufficient'
  }

  // 旧语料：退回原口径（不假装知道得更细）
  if (input.itemCount === 0) return 'no_material'
  if (input.missingMemberCount > 0) return 'partial_material'
  if ((input.legacyMissingSources?.length ?? 0) > 0) return 'source_failed'
  return 'llm_insufficient'
}

/** 状态 → 一句话（诊断/冒烟断言用）。 */
export function sourceStatusLine(s: SourceReport): string {
  return `${labelOf(s.source)}=${SOURCE_STATUS_LABEL[s.status]}${s.produced > 0 ? `(${s.produced})` : ''}`
}

/** 便捷：某状态是否有源。 */
export function hasStatus(sources: readonly SourceReport[] | undefined, status: SourceStatus): boolean {
  return (sources ?? []).some((s) => s.status === status)
}
