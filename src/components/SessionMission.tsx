/**
 * 时段任务条（N8：SessionMission）。
 *
 * 依据 WATCH-METHODOLOGY §8.1「固定时间表」：把方法论的「每个时段只答该答的问题」
 * 变成作战页顶部一条显式的「今日目标」——标题 / 一句话目标 / 完成检查清单 /
 * 进度 / 时段锚点倒计时。用户不用自己回忆"现在该干嘛"，打开作战页第一眼即得。
 *
 * 纯呈现组件：任务内容由 lib/mission.ts buildMission 推导，本组件只做 1s 心跳
 * 刷新倒计时与按语气(todo/done/warn)着色。不发起任何数据请求。
 */

import { useEffect, useMemo, useState } from 'react'
import { Check, Circle, ListChecks, Timer } from 'lucide-react'
import { buildMission, countdownText, type MissionInput } from '@/lib/mission'
import { phaseIcon } from '@/lib/session-clock'

type Props = Omit<MissionInput, 'now'>

/** 语气 → 容器/文字配色（todo=进行中 / done=已完成 / warn=缺基准需处理）。 */
function toneStyle(tone: 'todo' | 'done' | 'warn'): { box: string; bar: string; chip: string; label: string } {
  switch (tone) {
    case 'done': return { box: 'border-emerald-200 bg-emerald-50/50', bar: 'bg-emerald-400', chip: 'bg-emerald-100 text-emerald-700', label: 'text-emerald-600' }
    case 'warn': return { box: 'border-amber-200 bg-amber-50/60', bar: 'bg-amber-400', chip: 'bg-amber-100 text-amber-700', label: 'text-amber-600' }
    default: return { box: 'border-slate-200 bg-slate-50/70', bar: 'bg-slate-400', chip: 'bg-slate-200/80 text-slate-600', label: 'text-slate-500' }
  }
}

export function SessionMission(props: Props) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(t)
  }, [])

  const m = useMemo(() => buildMission({ ...props, now }), [props, now])
  const ts = toneStyle(m.tone)
  const cd = m.anchor && m.anchor.at > now ? countdownText(now, m.anchor.at) : null
  const p = m.progress

  return (
    <div className={`mb-1.5 overflow-hidden rounded-md border ${ts.box}`}>
      <div className="flex">
        <div className={`w-1 shrink-0 ${ts.bar}`} />
        <div className="min-w-0 flex-1 px-2 py-1.5">
          {/* 行 1：时段标题 + 倒计时/进度 */}
          <div className="flex items-center gap-1.5">
            <ListChecks className="h-3 w-3 shrink-0 text-slate-400" />
            <span className={`truncate text-[11px] font-semibold ${ts.label}`}>
              {phaseIcon(m.phase)} {m.title}
            </span>
            <span className="ml-auto flex shrink-0 items-center gap-1">
              {p && p.total > 0 && (
                <span className={`rounded px-1 py-px font-mono text-[8px] font-bold tabular-nums ${ts.chip}`}>
                  {p.done}/{p.total}
                </span>
              )}
              {cd && m.anchor && (
                <span className="flex shrink-0 items-center gap-0.5 rounded bg-white/70 px-1 py-px font-mono text-[8px] text-slate-500" title={m.anchor.label}>
                  <Timer className="h-2.5 w-2.5" />
                  {cd}
                </span>
              )}
            </span>
          </div>

          {/* 行 2：一句话目标 */}
          <div className="mt-0.5 text-[10px] leading-snug text-slate-600">{m.goal}</div>

          {/* 行 3：完成检查清单 */}
          {m.checks.length > 0 && (
            <ul className="mt-1 space-y-0.5">
              {m.checks.map((c) => (
                <li key={c.label} className="flex items-start gap-1">
                  {c.done
                    ? <Check className="mt-px h-2.5 w-2.5 shrink-0 text-emerald-500" />
                    : <Circle className="mt-px h-2.5 w-2.5 shrink-0 text-slate-300" />}
                  <span className={`min-w-0 flex-1 text-[9px] leading-snug ${c.done ? 'text-slate-500 line-through decoration-slate-300' : 'text-slate-600'}`}>
                    {c.label}
                  </span>
                </li>
              ))}
            </ul>
          )}

          {/* 提示 / 警告（弱提示） */}
          {m.warn && <div className="mt-1 rounded bg-white/60 px-1.5 py-0.5 text-[9px] leading-snug text-amber-600">⚠ {m.warn}</div>}
          {m.hint && !m.warn && <div className="mt-1 text-[8px] leading-snug text-slate-400">💡 {m.hint}</div>}
        </div>
      </div>
    </div>
  )
}
