/**
 * src/components/AiRankList.tsx — AI 排序结果列表（复盘预期清单 / 选股候选共用）。
 *
 * 只负责「把模型给出的有序条目画成可读、可操作的一列」：
 *   名次 + 标题 + 副标题 + 把握分条 + 理由 + 行内动作（由调用方给）。
 *
 * 设计立场：**AI 结果不自动覆盖用户的草稿**。这里永远是「参考 + 逐条采纳」，
 * 用户点「加入」才写进本地草稿；已在清单里的条目显示标注而不是重复添加。
 */
import type { ReactNode } from 'react'

export interface AiRankRow {
  key: string
  rank: number
  title: string
  subtitle?: string
  /** 0-100 把握分。 */
  score: number
  reason: string
  /** 行内动作（加入清单 / 打开 / 加自选…）。 */
  actions?: ReactNode
  /** 状态标注（例如「已在清单」）。 */
  note?: string
}

interface Props {
  rows: AiRankRow[]
  /** 无结果时的说明。 */
  empty?: string
}

export function AiRankList({ rows, empty = '模型没有给出可用条目' }: Props) {
  if (rows.length === 0) {
    return <div className="dc-ai-note">{empty}</div>
  }
  return (
    <div className="dc-rank">
      {rows.map((r) => (
        <div className="dc-rank-row" key={r.key}>
          <span className="dc-rank-no dc-num">{r.rank}</span>
          <div className="dc-rank-main">
            <div className="dc-rank-head">
              <span className="dc-rank-title">{r.title}</span>
              {r.subtitle !== undefined && r.subtitle !== '' ? (
                <span className="dc-rank-sub dc-num">{r.subtitle}</span>
              ) : null}
              {r.note !== undefined && r.note !== '' ? <span className="dc-tag">{r.note}</span> : null}
            </div>
            <div className="dc-rank-score" title={`把握分 ${r.score}/100`}>
              <i style={{ width: `${Math.max(0, Math.min(100, r.score))}%` }} />
            </div>
            <div className="dc-rank-reason">{r.reason}</div>
          </div>
          <span className="dc-rank-score-val dc-num">{r.score}</span>
          {r.actions !== undefined ? <div className="dc-rank-actions">{r.actions}</div> : null}
        </div>
      ))}
    </div>
  )
}
