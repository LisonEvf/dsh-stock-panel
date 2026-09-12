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
 *   · 明确区分「自挖类」与「官方概念/行业」，并声明不会改写用户的复盘结论。
 */
import { AlertTriangle } from 'lucide-react'
import { degradedLabel, verdictLabel, type NamingOutcome } from '@/lib/naming'

interface Props {
  outcome: NamingOutcome
  onRefresh?: (() => void) | undefined
  refreshing?: boolean | undefined
}

export function NamingResultPanel({ outcome, onRefresh, refreshing }: Props) {
  if (outcome.ok === false) {
    const head =
      outcome.reason === 'weak_chain' ? '拒绝命名：' : outcome.reason === 'no_class' ? '无法命名：' : '引擎不可用：'
    return (
      <div className="mt-1 flex items-start gap-1 rounded bg-amber-50 px-1.5 py-1 text-[10px] text-amber-700">
        <AlertTriangle size={10} className="mt-px shrink-0" />
        <span>
          {head}
          {outcome.note}
        </span>
      </div>
    )
  }

  const r = outcome.result
  return (
    <div className="mt-1 rounded bg-white px-1.5 py-1" data-testid="naming-result">
      <div className="flex items-baseline gap-1">
        <span className="text-[9px] text-slate-400">模型归纳</span>
        <span className={`text-[12px] font-medium ${r.verdict === 'named' ? 'text-violet-700' : 'text-slate-500'}`}>
          {r.verdict === 'named' ? `「${r.theme}」` : verdictLabel(r.verdict)}
        </span>
        <span
          className="ml-auto font-mono text-[9px] text-slate-400"
          title="可计算证据分 = 0.40×覆盖度 + 0.25×命中票数 + 0.20×窗口内比例 + 0.15×条数（3 条封顶）；模型自报置信度只作展示，不参与门控"
        >
          证据分 {r.evidenceScore.toFixed(2)}
          {r.confidence !== null ? ` · 自报 ${r.confidence.toFixed(2)}` : ''}
        </span>
      </div>

      {(r.verdict !== 'named' || r.degradedReason !== 'none') && (
        <div className="mt-0.5 text-[9px] text-amber-600">
          成因：{degradedLabel(r.degradedReason) || r.degradedReason}
          {r.degradedReason === 'guard_rejected' && '（引文没能逐字对上素材，已丢弃）'}
        </div>
      )}

      {r.alternatives.length > 0 && <div className="mt-0.5 text-[9px] text-slate-400">备选：{r.alternatives.join('、')}</div>}
      {r.reasoning !== '' && <div className="mt-0.5 text-[10px] leading-snug text-slate-500">{r.reasoning}</div>}

      {r.evidence.length > 0 && (
        <ul className="mt-1 space-y-0.5">
          {r.evidence.map((e, i) => (
            <li key={`${e.stock}-${i}`} className="text-[9px] leading-snug text-slate-400">
              <span className="text-slate-500">{e.stock}</span>
              <span className="ml-1 rounded bg-slate-100 px-1 font-mono">{e.source}</span>
              <span className="ml-1 font-mono">{e.ts}</span>
              {!e.inWindow && <span className="ml-1 text-amber-500">窗口外（不计入门控）</span>}
              <div className="truncate text-slate-500" title={e.quote}>
                「{e.quote}」
              </div>
            </li>
          ))}
        </ul>
      )}

      <div className="mt-1 flex flex-wrap items-center gap-1 text-[9px] text-slate-400">
        <span>
          素材 {r.materialCount} 条 · 有效证据 {r.evidenceCount} 条 · 覆盖 {(r.evidenceCoverage * 100).toFixed(0)}%
        </span>
        {outcome.sourcesUsed.length > 0 && <span className="font-mono">来源 {outcome.sourcesUsed.join('/')}</span>}
        {r.missingSources.length > 0 && <span className="text-amber-500">缺失源 {r.missingSources.join('/')}</span>}
        {outcome.cached && <span>（缓存命中）</span>}
        {onRefresh !== undefined && (
          <button
            type="button"
            disabled={refreshing === true}
            onClick={onRefresh}
            title="忽略缓存重新命名（会真的再调一次模型）"
            className="ml-auto rounded px-1 py-0.5 text-[9px] text-slate-400 hover:bg-slate-50 disabled:opacity-40"
          >
            {refreshing === true ? '重算中…' : '重算'}
          </button>
        )}
      </div>

      {outcome.collectNotes.length > 0 && (
        <details className="mt-0.5">
          <summary className="cursor-pointer text-[9px] text-slate-400">采集说明（含口径偏差）</summary>
          <ul className="mt-0.5 space-y-0.5">
            {outcome.collectNotes.map((n, i) => (
              <li key={i} className="text-[9px] leading-snug text-slate-400">
                · {n}
              </li>
            ))}
          </ul>
        </details>
      )}

      <div className="mt-0.5 text-[9px] text-slate-300">
        自挖类 ≠ 官方概念/行业：这是「市场今天自己认定的班」的候选标签（as_of {r.asOf} · 模型 {r.modelVersion}），
        仅供复盘参考，不会改写你的结论。
      </div>
    </div>
  )
}
