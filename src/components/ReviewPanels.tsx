/**
 * 复盘七步法新增面板（N9：ReviewPanels）。
 *
 * 依据用户七步复盘心法（整体情绪→连板梯队→板块结构→资金流向→亏钱效应→
 * 风向标→明日计划）中数据可实算的部分，做纯展示组件（全部 props 驱动，
 * 无网络请求）：
 *
 *   ① PrevPoolPerfBlock  —— 昨日涨停整体表现（先看天气再看衣服）
 *   ③ SurgeBoardsBlock   —— 涨停潮板块（≥3 涨停 = 资金阵地）
 *   ④ AmountTopBlock     —— 成交额前 20 大票（涨幅榜给散户，成交额榜给猎人）
 *   ⑤ LossBlock          —— 亏钱效应（昨日涨停今日大跌/跌停 + 雷区共性备注）
 *   ⑥ WindFlagBlock      —— 风向标（5-8 只有特点的票，标记进明日观察）
 *
 * 颜色约定与全站一致：红=强/涨、绿=弱/跌、琥珀=待办/风险。
 */

import { useState } from 'react'
import { Check, ChevronDown, Flag, TrendingDown } from 'lucide-react'
import type { AShareRow } from '@/lib/stock-data'
import type { BoardStat } from '@/lib/ladder'
import type { PrevPoolPerf } from '@/lib/review-metrics'
import type { WindFlagRef, WindFlagTag } from '@/lib/review-store'
import { inferMarket, type MarketTag } from '@/lib/symbol'
import type { OpenStock } from '@/panel/PanelApp'

const UP = '#c74040'
const DOWN = '#2d9b65'
const AMBER = '#e85910'

/** 风向标类型（六步法第 6 步语义）+ 说明。 */
export const WIND_TAGS: { v: WindFlagTag; l: string; desc: string }[] = [
  { v: 'dayLeader', l: '日内龙头', desc: '率先涨停/领涨，打高度' },
  { v: 'rebound', l: '断板反包', desc: '断板后反包的弱转强' },
  { v: 'lowVolume', l: '低位放量', desc: '低位放量启动新突破' },
  { v: 'strongHold', l: '逆势抗跌', desc: '大盘跌它不跌' },
  { v: 'other', l: '其他', desc: '自定义观察' },
]

export function windTagLabel(t: WindFlagTag): string {
  return WIND_TAGS.find((x) => x.v === t)?.l ?? t
}

// ===== ① 昨日涨停整体表现 =====

export function PrevPoolPerfBlock({ perf }: { perf: PrevPoolPerf | null }) {
  if (!perf || perf.samples === 0) {
    return (
      <div className="mb-1.5 rounded-md border border-amber-100 bg-amber-50/50 px-2 py-1.5">
        <div className="text-[10px] font-medium text-amber-600">昨日涨停今日表现 · 暂无数据</div>
        <div className="mt-0.5 text-[9px] leading-snug text-slate-500">
          需上一交易日已存档复盘（涨停池建档 v3）。先完成上一日复盘并存档，本卡才有对照样本。
        </div>
      </div>
    )
  }
  const avg = perf.avgPct ?? 0
  const upColor = avg > 0 ? UP : avg < 0 ? DOWN : '#64748b'
  const verdict =
    avg > 0 && (perf.redRate ?? 0) > 0.5
      ? '昨涨停今日整体有溢价：资金接力意愿强、容错率高（行情好）'
      : avg <= -3
        ? '昨涨停今日普遍大跌：杀高位/退潮，追板=送人头（管住手）'
        : avg < 0
          ? '昨涨停今日偏弱：接力意愿一般，只做缩容龙头'
          : '昨涨停今日分化：看晋级与亏钱两侧，不追高'

  return (
    <div className="mb-1.5 rounded-md border border-slate-100 bg-slate-50/60 px-2 py-1.5">
      <div className="mb-1 text-[10px] font-semibold text-slate-500">昨日涨停整体表现（{perf.samples} 样本）· 先看天气再看衣服</div>
      <div className="flex items-baseline gap-2">
        <span className="font-mono text-[18px] font-bold leading-none tabular-nums" style={{ color: upColor }}>
          {avg > 0 ? '+' : ''}{avg.toFixed(2)}%
        </span>
        <span className="text-[9px] text-slate-400">红盘 {perf.redCount}/{perf.samples} · 晋级 {perf.againLimit} · 大面(≤-5%) {perf.bigLoseCount} · 跌停 {perf.limitDownCount}</span>
      </div>
      <div className="mt-1 rounded bg-white/70 px-1.5 py-0.5 text-[9px] leading-snug" style={{ color: avg >= 0 ? '#c74040' : '#2d9b65' }}>
        {verdict}
      </div>
    </div>
  )
}

// ===== ③ 涨停潮板块 =====

export function SurgeBoardsBlock({ boards, onOpenStock }: { boards: BoardStat[]; onOpenStock: (s: OpenStock) => void }) {
  const surge = boards.filter((b) => b.limitUpCount >= 3).slice(0, 8)
  return (
    <div className="mb-1.5 rounded-md border border-slate-100 bg-slate-50/60 px-2 py-1.5">
      <div className="mb-1 flex items-center justify-between">
        <span className="text-[10px] font-medium text-slate-400">③ 板块结构 · 涨停潮 ≥3（资金阵地）</span>
        <span className="text-[8px] text-slate-300" title="板块内领涨龙头可直接点开">单兵是涨停，板块才是阵地</span>
      </div>
      {surge.length === 0 ? (
        <div className="rounded bg-white/60 px-1.5 py-1 text-[9px] text-slate-400">
          无板块涨停潮（≥3 只）——资金没形成阵地，超短降级做或空仓
        </div>
      ) : (
        <ul className="space-y-0.5">
          {surge.map((b) => (
            <li key={b.boardSymbol} className="flex items-center gap-1.5 rounded bg-white px-1.5 py-1">
              <span className="min-w-0 flex-1 truncate text-[11px] font-medium text-slate-700">{b.name}</span>
              <span className="shrink-0 rounded bg-red-50 px-1 font-mono text-[8px] font-bold text-red-500">{b.limitUpCount} 涨停</span>
              <span className="shrink-0 font-mono text-[8px] tabular-nums" style={{ color: b.pct > 0 ? UP : b.pct < 0 ? DOWN : '#94a3b8' }}>
                {b.pct > 0 ? '+' : ''}{b.pct.toFixed(1)}%
              </span>
              <button
                onClick={() => b.repCode && onOpenStock({ market: inferMarket(b.repCode), code: b.repCode, name: b.rep })}
                className="shrink-0 rounded bg-slate-100 px-1 text-[8px] text-slate-500 hover:bg-slate-200"
                title={`${b.rep} · 领涨龙头`}
              >
                龙头 {b.rep.slice(0, 4)}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

// ===== ④ 成交额前 20 大票 =====

export interface AmountTopRow {
  market: MarketTag
  code: string
  name: string
  pct: number
  amount: number
}

export function topAmountRows(rows: AShareRow[], n = 20): AmountTopRow[] {
  return rows
    .filter((r) => r.amount > 0)
    .sort((a, b) => b.amount - a.amount)
    .slice(0, n)
    .map((r) => ({ market: r.market, code: r.code, name: r.name, pct: r.pct, amount: r.amount }))
}

export function AmountTopBlock({ rows, onOpenStock }: { rows: AShareRow[]; onOpenStock: (s: OpenStock) => void }) {
  const top = topAmountRows(rows, 20)
  if (top.length === 0) {
    return (
      <div className="mb-1.5 rounded-md border border-slate-100 bg-slate-50/60 px-2 py-1.5">
        <div className="mb-0.5 text-[10px] font-medium text-slate-400">成交额前 20 · 大票资金</div>
        <div className="text-[9px] text-slate-400">无行情数据（休市 / 数据源不可用）</div>
      </div>
    )
  }
  const up = top.filter((t) => t.pct > 0).length
  const down = top.filter((t) => t.pct < 0).length
  const verdict =
    up >= 14 ? '大票多数上涨：机构进场、增量资金（大票赚指数，情绪暖）'
      : down >= 14 ? '大票普遍下跌：存量博弈，只看小票题材'
        : '大票分化：机构谨慎，别把大票当情绪风向'
  return (
    <div className="mb-1.5 rounded-md border border-slate-100 bg-slate-50/60 px-2 py-1.5">
      <div className="mb-1 flex items-center justify-between">
        <span className="text-[10px] font-medium text-slate-400">④ 资金流向 · 成交额前 20 大票</span>
        <span className="font-mono text-[9px] tabular-nums text-slate-500">
          涨 <span style={{ color: UP }}>{up}</span> · 跌 <span style={{ color: DOWN }}>{down}</span>
        </span>
      </div>
      <ul className="space-y-0.5">
        {top.slice(0, 10).map((t) => (
          <li key={`${t.market}${t.code}`}>
            <button
              onClick={() => onOpenStock({ market: t.market, code: t.code, name: t.name })}
              className="flex w-full items-center gap-1.5 rounded px-1 py-0.5 text-left hover:bg-white"
            >
              <span className="min-w-0 flex-1 truncate text-[11px] text-slate-600">{t.name}</span>
              <span className="shrink-0 font-mono text-[8px] tabular-nums" style={{ color: t.pct > 0 ? UP : t.pct < 0 ? DOWN : '#94a3b8' }}>
                {t.pct > 0 ? '+' : ''}{t.pct.toFixed(1)}%
              </span>
              <span className="shrink-0 font-mono text-[8px] text-slate-300">{(t.amount / 1e8).toFixed(0)}亿</span>
            </button>
          </li>
        ))}
      </ul>
      <div className="mt-1 rounded bg-white/70 px-1.5 py-0.5 text-[9px] leading-snug text-slate-500">{verdict}</div>
      <div className="mt-0.5 text-[8px] text-slate-300">⚠️ 龙虎榜（机构/游资席位）不在当前 MCP 数据源，本卡以成交额榜替代；资金细节可点个股看资金流</div>
    </div>
  )
}

// ===== ⑤ 亏钱效应 =====

export interface LossSample {
  symbol: string
  name: string
  pct: number
  atLimitDown: boolean
}

export function LossBlock({
  samples,
  riskNote,
  onRiskNote,
}: {
  samples: LossSample[]
  riskNote: string
  onRiskNote: (v: string) => void
}) {
  return (
    <div className="mb-1.5 rounded-md border border-slate-100 bg-green-50/40 px-2 py-1.5">
      <div className="mb-1 flex items-center gap-1">
        <TrendingDown className="h-3 w-3 text-green-600" />
        <span className="text-[10px] font-medium text-slate-400">⑤ 亏钱效应 · 昨日涨停今日大面/跌停（雷区样本）</span>
      </div>
      {samples.length === 0 ? (
        <div className="rounded bg-white/60 px-1.5 py-1 text-[9px] text-slate-400">
          无样本（需昨日存档；或昨涨停今日无大跌——亏钱效应收敛，才是该出手的时候）
        </div>
      ) : (
        <ul className="space-y-0.5">
          {samples.slice(0, 10).map((s) => (
            <li key={s.symbol} className="flex items-center gap-1.5 rounded bg-white px-1.5 py-0.5">
              <span className="min-w-0 flex-1 truncate text-[10px] text-slate-600">{s.name}</span>
              <span className="shrink-0 rounded bg-green-600 px-1 py-px text-[8px] font-medium text-white">{s.atLimitDown ? '今跌停' : '大面'}</span>
              <span className="shrink-0 font-mono text-[9px] tabular-nums" style={{ color: s.pct > 0 ? UP : DOWN }}>
                {s.pct > 0 ? '+' : ''}{s.pct.toFixed(1)}%
              </span>
            </li>
          ))}
        </ul>
      )}
      <label className="mt-1 block">
        <div className="mb-0.5 text-[8px] text-slate-300">共性记录（高位补跌 / 板块退潮 / 业绩雷…；写下来=明天的回避清单）</div>
        <textarea
          value={riskNote}
          onChange={(e) => onRiskNote(e.target.value)}
          rows={2}
          maxLength={200}
          placeholder="例：跌停多为高位 3 板以上补跌 + 昨日涨停今日跌停 3 只 → 明日禁追高位、禁碰该板块"
          className="w-full resize-none rounded border border-slate-200 bg-white px-1.5 py-1 text-[10px] text-slate-700 outline-none placeholder:text-slate-300 focus:border-emerald-400"
        />
      </label>
      <div className="mt-0.5 text-[8px] text-slate-300">盯着赚钱效应会冲动，盯着亏钱效应会冷静；扩散期管住手，收敛期才出手</div>
    </div>
  )
}

// ===== ⑥ 风向标标记 =====

export interface WindFlagCandidate {
  market: MarketTag
  code: string
  name: string
  streak: number
  hint: string // 特点描述（如 5板/日内首板/弱转强）
}

export function WindFlagBlock({
  candidates,
  marked,
  onMark,
  onUnmark,
  onOpenStock,
}: {
  candidates: WindFlagCandidate[]
  marked: WindFlagRef[]
  onMark: (c: WindFlagCandidate, tag: WindFlagTag) => void
  onUnmark: (symbol: string) => void
  onOpenStock: (s: OpenStock) => void
}) {
  const [open, setOpen] = useState<string | null>(null)
  const markedSymbols = new Set(marked.map((m) => m.symbol))
  return (
    <div className="mb-1.5 rounded-md border border-slate-100 bg-slate-50/60 px-2 py-1.5">
      <div className="mb-1 flex items-center justify-between">
        <span className="flex items-center gap-1 text-[10px] font-medium text-slate-400">
          <Flag className="h-3 w-3 text-red-500" />⑥ 风向标 · 明日观察（{marked.length}/8）
        </span>
        <span className="text-[8px] text-slate-300">自选池不是股票池，是你的风向标</span>
      </div>

      {/* 已标记 */}
      {marked.length > 0 && (
        <div className="mb-1.5 flex flex-wrap gap-0.5">
          {marked.map((m) => (
            <span key={m.symbol} className="flex items-center gap-0.5 rounded bg-red-50 px-1 py-px text-[8px] text-red-600">
              {m.name}
              <span className="font-mono text-[7px] opacity-70">{windTagLabel(m.tag)}</span>
              <button onClick={() => onUnmark(m.symbol)} className="text-red-300 hover:text-red-600" title="取消标记">×</button>
            </span>
          ))}
        </div>
      )}

      {/* 候选列表（今日有特点的票） */}
      {candidates.length === 0 ? (
        <div className="rounded bg-white/60 px-1.5 py-1 text-[9px] text-slate-400">无候选（无行情 / 数据源不可用）</div>
      ) : (
        <ul className="space-y-0.5">
          {candidates.map((c) => {
            const sym = `${c.market}${c.code}`
            const already = markedSymbols.has(sym)
            return (
              <li key={sym} className="rounded bg-white px-1.5 py-1">
                <div className="flex items-center gap-1.5">
                  <button
                    onClick={() => onOpenStock({ market: c.market, code: c.code, name: c.name })}
                    className="min-w-0 flex-1 truncate text-left text-[11px] text-slate-700 hover:text-emerald-600"
                    title={`${c.name} ${c.code} · ${c.hint}`}
                  >
                    {c.name}
                    <span className="ml-1 font-mono text-[8px] text-slate-300">{c.code.slice(-4)}</span>
                  </button>
                  <span className="shrink-0 rounded bg-slate-100 px-1 text-[8px] text-slate-500">{c.hint}</span>
                  {already ? (
                    <button onClick={() => onUnmark(sym)} className="shrink-0 text-[8px] text-emerald-600 hover:text-red-500" title="取消风向标">
                      <Check className="h-3 w-3" />已标
                    </button>
                  ) : (
                    <button
                      onClick={() => setOpen(open === sym ? null : sym)}
                      disabled={marked.length >= 8}
                      className="flex shrink-0 items-center gap-0.5 rounded bg-slate-100 px-1 py-0.5 text-[8px] text-slate-600 hover:bg-slate-200 disabled:opacity-40"
                      title={marked.length >= 8 ? '风向标已达 8 只上限' : '标记为风向标'}
                    >
                      <Flag className="h-2.5 w-2.5" />标
                      <ChevronDown className="h-2 w-2" />
                    </button>
                  )}
                </div>
                {open === sym && !already && (
                  <div className="mt-1 flex flex-wrap gap-0.5">
                    {WIND_TAGS.map((t) => (
                      <button
                        key={t.v}
                        onClick={() => { onMark(c, t.v); setOpen(null) }}
                        className="rounded border border-slate-200 bg-white px-1 py-px text-[8px] text-slate-600 hover:bg-emerald-50 hover:text-emerald-600"
                        title={t.desc}
                      >
                        {t.l}
                      </button>
                    ))}
                  </div>
                )}
              </li>
            )
          })}
        </ul>
      )}
      <div className="mt-1 text-[8px] leading-snug text-slate-300">
        有特点 = 率先涨停的日内龙头 · 断板反包的弱转强 · 低位放量新突破 · 逆势抗跌强势股。它们强板块就强，弱板块就弱。
      </div>
    </div>
  )
}
