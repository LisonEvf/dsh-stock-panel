/**
 * 盘中三问必答卡（N8：QAnswers）。
 *
 * 依据 WATCH-METHODOLOGY §5「盘中只答 Q1-Q3」：把盘中该回答的三个问题做成
 * **必答卡**（每问必须落一个答案，答完有时间戳），答案写入 dayrun；
 * SessionMission 任务条据此显示「盘中三问 x/3 已完成」。
 *
 *   Q1 持续性：主线/持仓的持续性证据 增强 / 衰减 / 中性；
 *   Q2 局势：采纳系统 judgeSituation 归类或人工修正；
 *   Q3 动作：对每笔持仓给今日动作（持有/减/清/加仓试错）；空仓则勾「空仓观望」。
 *
 * 数据：dayrun（读写）+ positions（持仓数）+ situation（系统候选，由父级传入）。
 */

import { useEffect, useReducer } from 'react'
import { Check } from 'lucide-react'
import {
  getDayRun,
  setQ1,
  setQ2,
  setQ3Idle,
  setQ3Symbol,
  subscribeDayRun,
  today,
  type Q1Value,
  type Q3Action,
} from '@/lib/dayrun'
import { getPositions, subscribePositions } from '@/lib/positions'
import { situationLabel, type Situation } from '@/lib/situation'

interface Props {
  /** 系统局势候选（WarPage 每轮 judgeSituation 结果）；null = 暂无数据。 */
  autoSituation: Situation | null
}

const Q1_OPTS: { v: Q1Value; label: string; desc: string; color: string }[] = [
  { v: 'strengthen', label: '增强', desc: '放量/封板/共振', color: '#c74040' },
  { v: 'flat', label: '中性', desc: '证据不增减', color: '#64748b' },
  { v: 'weaken', label: '衰减', desc: '滞涨/缩量/破位', color: '#2d9b65' },
]

const Q3_OPTS: { v: Q3Action; label: string }[] = [
  { v: 'hold', label: '持有' },
  { v: 'reduce', label: '减仓' },
  { v: 'clear', label: '清仓/兑现' },
  { v: 'addTrial', label: '半仓试错' },
]

const SITUATIONS: Situation[] = ['normal', 'highLowSwitch', 'innerDivergence', 'newDirection', 'weightLift', 'recession']

/** HH:MM 时间戳。 */
function hm(ts: number): string {
  const d = new Date(ts)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

export function QAnswers({ autoSituation }: Props) {
  const [, force] = useReducer((x: number) => x + 1, 0)
  useEffect(() => subscribeDayRun(force), [])
  useEffect(() => subscribePositions(force), [])

  const day = today()
  const run = getDayRun(day)
  const positions = getPositions()

  const q3AnsweredPos = positions.filter((p) => run?.q3?.bySymbol[p.symbol]).length
  const q3Complete = positions.length === 0 ? !!run?.q3?.idle : q3AnsweredPos >= positions.length

  return (
    <div className="mb-1.5 space-y-1">
      {/* ===== Q1 持续性 ===== */}
      <div className="rounded-md border border-slate-100 bg-slate-50/60 px-2 py-1.5">
        <div className="flex items-center gap-1">
          <span className="text-[10px] font-semibold text-slate-500">Q1 持续性</span>
          {run?.q1 ? (
            <span className="ml-auto flex items-center gap-0.5 text-[8px] text-emerald-600">
              <Check className="h-2.5 w-2.5" />已答 {hm(run.q1.at)}
            </span>
          ) : (
            <span className="ml-auto rounded bg-amber-100 px-1 py-px text-[8px] text-amber-600">未答</span>
          )}
        </div>
        <div className="mt-0.5 text-[8px] text-slate-400">主线/持仓的持续性证据在增强还是衰减？</div>
        <div className="mt-1 flex flex-wrap gap-1">
          {Q1_OPTS.map((o) => {
            const active = run?.q1?.value === o.v
            return (
              <button
                key={o.v}
                onClick={() => setQ1(day, o.v)}
                title={o.desc}
                className="flex-1 rounded border px-1 py-0.5 text-center text-[9px] font-medium transition-colors"
                style={
                  active
                    ? { color: '#fff', background: o.color, borderColor: o.color }
                    : { color: o.color, borderColor: o.color + '44', background: o.color + '08' }
                }
              >
                {o.label}
              </button>
            )
          })}
        </div>
      </div>

      {/* ===== Q2 局势 ===== */}
      <div className="rounded-md border border-slate-100 bg-slate-50/60 px-2 py-1.5">
        <div className="flex items-center gap-1">
          <span className="text-[10px] font-semibold text-slate-500">Q2 局势</span>
          {run?.q2 ? (
            <span className="ml-auto flex items-center gap-0.5 text-[8px] text-emerald-600">
              <Check className="h-2.5 w-2.5" />已确认 {hm(run.q2.at)}
            </span>
          ) : (
            <span className="ml-auto rounded bg-amber-100 px-1 py-px text-[8px] text-amber-600">未答</span>
          )}
        </div>
        <div className="mt-0.5 text-[8px] text-slate-400">有没有局势变化（高低切/退潮/新方向）正在发生？</div>
        <div className="mt-1 flex flex-wrap gap-1">
          {SITUATIONS.map((s) => {
            const active = run?.q2?.situation === s
            const isAuto = autoSituation === s
            const label = s === 'normal' ? '正常' : s === 'highLowSwitch' ? '高低切' : s === 'innerDivergence' ? '主线内分歧' : s === 'newDirection' ? '新方向' : s === 'weightLift' ? '权重行情' : '退潮'
            return (
              <button
                key={s}
                onClick={() => setQ2(day, s, isAuto ? 'auto' : 'manual')}
                title={situationLabel(s)}
                className={`rounded border px-1 py-0.5 text-[9px] font-medium transition-colors ${active ? 'bg-slate-700 text-white' : 'text-slate-600 hover:bg-slate-100'}`}
                style={active ? {} : { borderColor: '#cbd5e1', background: isAuto && !run?.q2 ? '#f1f5f9' : undefined }}
              >
                {isAuto && !run?.q2 && <span className="mr-0.5 text-[7px] text-emerald-500">系统→</span>}
                {label}
              </button>
            )
          })}
        </div>
      </div>

      {/* ===== Q3 动作 ===== */}
      <div className="rounded-md border border-slate-100 bg-slate-50/60 px-2 py-1.5">
        <div className="flex items-center gap-1">
          <span className="text-[10px] font-semibold text-slate-500">Q3 动作</span>
          {q3Complete ? (
            <span className="ml-auto flex items-center gap-0.5 text-[8px] text-emerald-600">
              <Check className="h-2.5 w-2.5" />已答
            </span>
          ) : (
            <span className="ml-auto rounded bg-amber-100 px-1 py-px text-[8px] text-amber-600">未答</span>
          )}
        </div>
        <div className="mt-0.5 text-[8px] text-slate-400">对持仓与候选，今天该做的动作是什么？（尾盘才定去留）</div>
        {positions.length === 0 ? (
          <button
            onClick={() => setQ3Idle(day, !run?.q3?.idle)}
            className={`mt-1 w-full rounded border px-1 py-1 text-[9px] font-medium transition-colors ${
              run?.q3?.idle ? 'bg-slate-700 text-white' : 'text-slate-500 hover:bg-slate-100'
            }`}
            style={!run?.q3?.idle ? { borderColor: '#cbd5e1' } : {}}
          >
            {run?.q3?.idle ? '✓ 已确认：空仓观望（无动作也是决策）' : '空仓观望（无动作）'}
          </button>
        ) : (
          <ul className="mt-1 space-y-1">
            {positions.map((p) => {
              const cur = run?.q3?.bySymbol[p.symbol]
              return (
                <li key={p.symbol} className="rounded bg-white px-1.5 py-1">
                  <div className="flex items-center justify-between gap-1">
                    <span className="min-w-0 flex-1 truncate text-[10px] font-medium text-slate-600">
                      {p.name}
                      <span className="ml-1 font-mono text-[8px] text-slate-300">{p.code}</span>
                    </span>
                    <span className="shrink-0 font-mono text-[8px] text-slate-300">{p.shares}股</span>
                  </div>
                  <div className="mt-0.5 flex flex-wrap gap-0.5">
                    {Q3_OPTS.map((o) => {
                      const active = cur?.action === o.v
                      return (
                        <button
                          key={o.v}
                          onClick={() => setQ3Symbol(day, p.symbol, o.v)}
                          className={`rounded border px-1 py-px text-[8px] font-medium transition-colors ${
                            active ? 'bg-slate-700 text-white' : 'text-slate-500 hover:bg-slate-100'
                          }`}
                          style={!active ? { borderColor: '#e2e8f0' } : {}}
                        >
                          {o.label}
                        </button>
                      )
                    })}
                  </div>
                </li>
              )
            })}
          </ul>
        )}
      </div>
    </div>
  )
}
