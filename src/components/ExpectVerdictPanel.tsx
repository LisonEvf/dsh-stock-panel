/**
 * 预期清单 × 今日竞价判定写回（N8：ExpectVerdictPanel）。
 *
 * 依据 WATCH-METHODOLOGY §4.4「预期 × 竞价对照矩阵」：竞价时段把最近一份复盘
 * （getLatestPlan = 今日盘前计划 ?? 上一复盘）里的**预期清单**逐条摆出来，用户
 * 对照今日竞价逐条点选判定（超预期/证伪/弱转强/陷阱…），判定写入 dayrun.verdicts
 * （当日运行记录），供 SessionMission 计进度、盘后复盘引用。
 *
 * 数据：review-store（ReviewSnapshot.expectations）+ dayrun（判定写回）。
 * 无网络请求。空清单时给纪律引导（没有可对照清单 → 竞价默认不参与）。
 */

import { useEffect, useReducer } from 'react'
import { Check, RotateCcw } from 'lucide-react'
import {
  getDayRun,
  setVerdict,
  subscribeDayRun,
  unsetVerdict,
} from '@/lib/dayrun'
import { getLatestPlan, subscribeReview, type ExpectItem } from '@/lib/review-store'
import { verdictColor, verdictLabel, type Verdict } from '@/lib/auction-analysis'

interface Props {
  /** 今日日期（YYYY-MM-DD，判定写回按此日归档）。 */
  day: string
}

/** 预期清单条目的「昨日状态」徽标（WATCH-METHODOLOGY §3.3 状态字段）。 */
function expectStateBadge(s: ExpectItem['state']): { label: string; color: string; bg: string } {
  switch (s) {
    case 'strong': return { label: '强一致', color: 'var(--dc-up)', bg: 'var(--dc-up-soft)' }
    case 'divergence': return { label: '分歧', color: '#e85910', bg: '#e859101a' }
    case 'weak2strong': return { label: '弱转强候选', color: 'var(--dc-up)', bg: 'var(--dc-up-soft)' }
    case 'highRisk': return { label: '高位风险', color: '#e85910', bg: '#e859101a' }
    case 'recession': return { label: '退潮', color: 'var(--dc-down)', bg: 'var(--dc-down-soft)' }
    default: return { label: '低位启动', color: 'var(--dc-up)', bg: 'var(--dc-up-soft)' }
  }
}

const ALL_VERDICTS: Verdict[] = ['beatExpect', 'confirm', 'falsify', 'weak2strong', 'weak2weak', 'trap']

export function ExpectVerdictPanel({ day }: Props) {
  const [, force] = useReducer((x: number) => x + 1, 0)
  useEffect(() => subscribeDayRun(force), [])
  useEffect(() => subscribeReview(force), [])

  const prev = getLatestPlan(day)
  const expectations = prev?.expectations ?? []
  const judged = getDayRun(day)?.verdicts ?? {}

  if (expectations.length === 0) {
    return (
      <div className="mb-1.5 rounded-md border border-amber-100 bg-amber-50/50 px-2 py-2">
        <div className="dc-t-data font-medium text-amber-600">还没有可对照的预期清单</div>
        <div className="mt-0.5 dc-t-micro leading-snug text-slate-500">
          竞价无对照基准 → 按纪律默认只看不买（清单外一律不参与）。先在「复盘」页写 3-5 条预期，竞价才有判定对象。
        </div>
      </div>
    )
  }

  const judgedCount = expectations.filter((e) => judged[e.symbol]).length

  return (
    <div className="mb-1.5 rounded-md border border-slate-100 bg-slate-50/60 px-2 py-1.5">
      <div className="mb-1 flex items-center justify-between">
        <span className="dc-t-data font-medium text-slate-400">
          预期对照 × 今日竞价判定
        </span>
        <span className={`rounded px-1 py-px font-mono dc-t-micro font-bold tabular-nums ${judgedCount === expectations.length ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'}`}>
          {judgedCount}/{expectations.length} 已判定
        </span>
      </div>

      <ul className="space-y-1">
        {expectations.map((e) => {
          const badge = expectStateBadge(e.state)
          const cur = judged[e.symbol]
          return (
            <li key={e.id} className="rounded-md border border-slate-100 bg-white px-1.5 py-1">
              {/* 行 1：名称 + 昨日状态 + 剧本 */}
              <div className="flex items-center gap-1">
                <span className="min-w-0 flex-1 truncate dc-t-note font-semibold text-slate-700">
                  {e.name}
                  <span className="ml-1 font-mono dc-t-micro font-normal text-slate-300">{e.symbol.slice(2)}</span>
                </span>
                <span className="shrink-0 rounded px-1 py-px dc-t-micro font-medium" style={{ color: badge.color, background: badge.bg }}>
                  {badge.label}
                </span>
              </div>
              <div className="mt-0.5 truncate dc-t-micro text-slate-400" title={`剧本：${e.scenario}`}>
                剧本 {e.scenario}
                {e.auctionOK && <span className="ml-1.5 text-slate-300">竞价 OK：{e.auctionOK}</span>}
                {e.failIf && <span className="ml-1.5 text-amber-500/80">失败：{e.failIf}</span>}
              </div>

              {/* 行 2：判定 chips（点选即写回；重复点已选中的项取消） */}
              <div className="mt-1 flex flex-wrap items-center gap-0.5">
                {ALL_VERDICTS.map((v) => {
                  const active = cur?.verdict === v
                  const c = verdictColor(v)
                  return (
                    <button
                      key={v}
                      onClick={() => (active ? unsetVerdict(day, e.symbol) : setVerdict(day, e.symbol, v))}
                      className="rounded border px-1 py-px dc-t-micro font-medium transition-colors"
                      style={
                        active
                          ? { color: '#fff', background: c, borderColor: c }
                          : { color: c, borderColor: c + '55', background: c + '0d' }
                      }
                      title={`${v === cur?.verdict ? '取消判定' : '判定为'}「${verdictLabel(v)}」`}
                    >
                      {active && <Check className="mr-0.5 inline h-2 w-2" />}
                      {verdictLabel(v)}
                    </button>
                  )
                })}
                {cur && (
                  <button
                    onClick={() => unsetVerdict(day, e.symbol)}
                    className="ml-auto rounded p-0.5 text-slate-300 hover:text-slate-500"
                    title="重置判定"
                  >
                    <RotateCcw className="h-2.5 w-2.5" />
                  </button>
                )}
              </div>
            </li>
          )
        })}
      </ul>
      <div className="mt-1 dc-t-micro leading-snug text-slate-400">
        对照规则（§4.4）：强一致+竞价更强=超预期｜强一致+低开/开板=证伪→放弃｜分歧+放量=弱转强候选｜高位高开无共振=陷阱。
      </div>
    </div>
  )
}
