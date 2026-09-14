/**
 * src/components/NamingResultPanel.tsx —— 命名结论的展示（个股卡与类列表共用）。
 *
 * 为什么单独抽出来：命名结果是**护栏的产物**，它的展示必须把护栏关心的事都摊开 ——
 * 三态结论、降级成因、可计算证据分、每条证据的出处与是否在时间窗内、素材缺失源、
 * 采集口径偏差。两处各写一份必然会漂（一边显示证据分、一边忘了成因），而"看起来差不多"
 * 的报告正是最容易让人误信的那种。
 *
 * 立场（写进注释免得以后被简化掉）：
 *   · 模型自报 confidence **只作展示**，门控是证据分；
 *   · `named` 才有主题名；降级后主题名一律为 null（不留半个名字给人误引）；
 *   · **模型主题名**与**结构标签**（官方行业/概念口径）必须分开显示、各自标来源 ——
 *     前者是"为什么一起动"，后者是"这个班像什么"，混在一处就会被互相冒充引用；
 *   · 明确区分「自挖类」与「官方概念/行业」，并声明不会改写用户的复盘结论。
 *
 * 颜色一律走 `--dc-*` token（`dc-t-*` 字号 + `dc-soft-*` 浅底 + `text-dc-*` 文字）：
 * 收口前用的是 tailwind 的 amber/slate/emerald 固定色阶，**不跟暗色主题** ——
 * 暗色下这张卡是一块浅底补丁，整页最刺眼的地方就是它。
 */
import { AlertTriangle } from 'lucide-react'
import { degradedLabel, verdictLabel, type ClassStructure, type NamingOutcome } from '@/lib/naming'
import { structureLine } from '@/host/naming/structure'
import { SOURCE_STATUS_LABEL, type SourceStatus } from '@/host/naming/types'

/** 状态色：失败要显眼，按设计跳过是"中性事实"（不是问题）。 */
const SOURCE_STATUS_TONE: Record<SourceStatus, string> = {
  used: 'dc-soft-ok text-dc-ok',
  skipped_by_design: 'dc-soft-neutral text-dc-text-3',
  no_material: 'dc-soft-warn text-dc-warn',
  failed: 'dc-soft-danger text-dc-bad',
}

interface Props {
  outcome: NamingOutcome
  onRefresh?: (() => void) | undefined
  refreshing?: boolean | undefined
  /**
   * 结构标签（官方行业/概念口径）。传进来只为了**对照**：
   * 让用户看到"这个班像什么"（官方分类学）与"模型说它为什么动"是两个答案。
   */
  structure?: ClassStructure | null | undefined
}

/** 拒绝原因 → 标题（动词必须准确：拒了 / 没法 / 不可用是三件事）。 */
function rejectHead(reason: string): string {
  switch (reason) {
    case 'weak_chain':
      return '拒绝命名（弱链伪类）：'
    case 'pseudo_class':
      return '拒绝命名（传递链可疑）：'
    case 'no_class':
      return '无法命名（引擎没给出这个类）：'
    default:
      return '引擎不可用：'
  }
}

export function NamingResultPanel({ outcome, onRefresh, refreshing, structure }: Props) {
  if (outcome.ok === false) {
    return (
      <div className="mt-1 flex items-start gap-1 rounded-dc-sm dc-soft-warn px-1.5 py-1 dc-t-data text-dc-warn">
        <AlertTriangle size={11} className="mt-px shrink-0" />
        <span>
          {rejectHead(outcome.reason)}
          {outcome.note}
        </span>
      </div>
    )
  }

  const r = outcome.result
  return (
    <div className="mt-1 rounded-dc-sm bg-dc-layer-1 px-1.5 py-1" data-testid="naming-result">
      <div className="flex flex-wrap items-baseline gap-1.5">
        <span className="dc-t-micro text-dc-text-3">模型主题</span>
        <span className={`dc-t-data font-medium ${r.verdict === 'named' ? 'text-dc-up' : 'text-dc-text-2'}`}>
          {r.verdict === 'named' ? `「${r.theme}」` : verdictLabel(r.verdict)}
        </span>
        {/* 结构标签放在主题名**旁边**并各自标来源：这是这一页最容易混淆的一对概念 */}
        {structure != null && structure.label !== '' && (
          <span className="dc-t-micro text-dc-dim" title={structure.note}>
            结构标签（官方{structure.basis === 'concept' ? '概念' : '行业'}口径）：
            <span className="text-dc-text-2">{structureLine(structure)}</span>
          </span>
        )}
        <span
          className="ml-auto font-mono dc-t-micro text-dc-text-3"
          title="可计算证据分 = 0.40×覆盖度 + 0.25×命中票数 + 0.20×窗口内比例 + 0.15×条数（3 条封顶）；模型自报置信度只作展示，不参与门控"
        >
          证据分 {r.evidenceScore.toFixed(2)}
          {r.confidence !== null ? ` · 自报 ${r.confidence.toFixed(2)}` : ''}
        </span>
      </div>

      {(r.verdict !== 'named' || r.degradedReason !== 'none') && (
        <div className="mt-0.5 dc-t-micro text-dc-warn">
          成因：{degradedLabel(r.degradedReason) || r.degradedReason}
          {r.degradedReason === 'guard_rejected' && '（引文没能逐字对上素材，已丢弃）'}
        </div>
      )}

      {/* 素材来源状态：**逐源四态**（已采用 / 按设计跳过 / 无产出 / 采集失败）。
          为什么不能只写一句"缺失源"：三种完全不同的情形（按设计跳过、没产出、真失败）
          处置方式不同，混成一句会让用户和模型都把"没产出"读成"采集失败"（实测事故）。 */}
      {r.sourceStatus.length > 0 && (
        <div className="mt-1 rounded-dc-sm bg-dc-layer-2 px-1.5 py-1">
          <div className="dc-t-micro font-medium text-dc-text-3">素材来源（系统归因）</div>
          <ul className="mt-0.5 space-y-0.5">
            {r.sourceStatus.map((s) => (
              <li key={s.source} className="dc-t-micro leading-snug">
                <span className={`mr-1 rounded-dc-sm px-1 font-mono ${SOURCE_STATUS_TONE[s.status]}`}>
                  {SOURCE_STATUS_LABEL[s.status]}
                </span>
                <span className="font-mono text-dc-text-3">{s.source}</span>
                <span className="text-dc-dim">· {s.detail}</span>
              </li>
            ))}
          </ul>
          {r.causeNote !== '' && <div className="mt-0.5 dc-t-micro leading-snug text-dc-text-3">{r.causeNote}</div>}
        </div>
      )}

      {r.alternatives.length > 0 && <div className="mt-0.5 dc-t-micro text-dc-dim">备选：{r.alternatives.join('、')}</div>}
      {r.reasoning !== '' && (
        <div className="mt-0.5 dc-t-data leading-snug text-dc-text-2">
          <span className="dc-t-micro text-dc-dim">模型说明（模型自述，非系统归因）</span>
          <div>{r.reasoning}</div>
        </div>
      )}

      {r.evidence.length > 0 && (
        <ul className="mt-1 space-y-0.5">
          {r.evidence.map((e, i) => (
            <li key={`${e.stock}-${i}`} className="dc-t-micro leading-snug text-dc-dim">
              <span className="text-dc-text-2">{e.stock}</span>
              <span className="ml-1 rounded-dc-sm dc-soft-neutral px-1 font-mono">{e.source}</span>
              <span className="ml-1 font-mono">{e.ts}</span>
              {!e.inWindow && <span className="ml-1 text-dc-warn">窗口外（不计入门控）</span>}
              <div className="truncate text-dc-text-2" title={e.quote}>
                「{e.quote}」
              </div>
            </li>
          ))}
        </ul>
      )}

      <div className="mt-1 flex flex-wrap items-center gap-2 dc-t-micro text-dc-dim">
        <span>
          素材 {r.materialCount} 条 · 有效证据 {r.evidenceCount} 条 · 覆盖 {(r.evidenceCoverage * 100).toFixed(0)}%
        </span>
        {outcome.sourcesUsed.length > 0 && <span className="font-mono">来源 {outcome.sourcesUsed.join('/')}</span>}
        {r.missingSources.length > 0 && <span className="text-dc-warn">缺失源 {r.missingSources.join('/')}</span>}
        {outcome.cached && <span>（缓存命中）</span>}
        {onRefresh !== undefined && (
          <button
            type="button"
            disabled={refreshing === true}
            onClick={onRefresh}
            title="忽略缓存重新命名（会真的再调一次模型）"
            className="ml-auto rounded-dc-sm px-1 py-0.5 dc-t-micro text-dc-text-3 hover:bg-dc-layer-3 disabled:opacity-40"
          >
            {refreshing === true ? '重算中…' : '重算'}
          </button>
        )}
      </div>

      {outcome.collectNotes.length > 0 && (
        <details className="mt-0.5">
          <summary className="cursor-pointer dc-t-micro text-dc-dim">采集说明（含口径偏差）</summary>
          <ul className="mt-0.5 space-y-0.5">
            {outcome.collectNotes.map((n, i) => (
              <li key={i} className="dc-t-micro leading-snug text-dc-dim">
                · {n}
              </li>
            ))}
          </ul>
        </details>
      )}

      <div className="mt-0.5 dc-t-micro text-dc-dim">
        自挖类 ≠ 官方概念/行业：这是「市场今天自己认定的班」的候选标签（as_of {r.asOf} · 模型 {r.modelVersion}），
        仅供复盘参考，不会改写你的结论。
      </div>
    </div>
  )
}
