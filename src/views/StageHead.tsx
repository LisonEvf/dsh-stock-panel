/**
 * src/views/StageHead.tsx — 阶段头：**先摆出本阶段必须回答的问题**，再看数据。
 *
 * 方法论 §0「信息要少而准」与 §8「每个时段只回答该时段必须回答的几个问题」
 * 落到 UI 上就是这一条：阶段头把方法论原文的问题清单摊在页面顶部，
 * 用户不必记得流程——页面替他记得。右侧显示本阶段唯一的输出物。
 *
 * 数据来源：`src/lib/stage.ts`（与 WATCH-METHODOLOGY §3–§5 一一对应）。
 */
import { ArrowRight, CircleDot } from 'lucide-react'
import { STAGES, type Stage } from '@/lib/stage'

interface Props {
  stage: Stage
  /** 阶段覆盖选择器（点击切到别的阶段看；不改变真实时钟）。 */
  onPick?: (s: Stage) => void
  /** 可选：阶段相关的额外状态（如"验证窗"提示）。 */
  note?: string
}

export function StageHead({ stage, onPick, note }: Props) {
  const info = STAGES[stage]
  return (
    <div className="dc-stagehead">
      <div className="dc-stagehead-top">
        <span className="dc-stagehead-chip">
          <CircleDot size={10} />
          {info.label}
        </span>
        <span className="dc-num dc-flat">{info.window}</span>
        {onPick !== undefined ? (
          <span className="dc-stagehead-picks">
            {(Object.keys(STAGES) as Stage[]).map((s) => (
              <button
                key={s}
                type="button"
                className={`dc-chip${s === stage ? ' is-on' : ''}`}
                title={`${STAGES[s].window} · ${STAGES[s].output}`}
                onClick={() => onPick(s)}
              >
                {STAGES[s].label}
              </button>
            ))}
          </span>
        ) : null}
        <span style={{ flex: 1 }} />
        {note !== undefined && note !== '' ? <span className="dc-stagehead-note">{note}</span> : null}
        <span className="dc-stagehead-out" title="本阶段唯一的输出物">
          <ArrowRight size={10} />
          {info.output}
        </span>
      </div>
      <ul className="dc-stagehead-qs">
        {info.questions.map((q, i) => (
          <li key={i}>{q}</li>
        ))}
      </ul>
    </div>
  )
}
