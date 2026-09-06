/**
 * 复盘模式页（N1：ReviewPage）。
 *
 * 依据 WATCH-METHODOLOGY §3「收盘复盘」与 PRODUCT-DESIGN §4.1「页面块」：
 *   1. 今日盘眼：指数/广度/成交额 + 温度计刻度 + 主线一句话；
 *   2. 自动回顾区：涨停梯队精简条形 + 跌停/大面统计 + 炸板事件清单；
 *   3. 预期清单编辑器（≤5 张，7 字段，可一键从今日涨停池加入龙头）；
 *   4. 存档：写入当日 ReviewSnapshot（review-store，localStorage 按日追加）。
 *
 * 数据：loadLadder（涨停池+板块热度）、fetchAllA/computeBreadth（广度）、
 *   fetchIndexQuotes（指数）、regime（温度计）、event-stream（炸板事件）。
 * 复盘一次性装配 + 手动刷新；不 30s 轮询（PRODUCT-DESIGN §7 预算）。
 */

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { ClipboardList, Flame, Plus, RefreshCw, Save, X } from 'lucide-react'
import { loadLadder, type LadderSnapshot, type LadderStock } from '@/lib/ladder'
import { fetchAllA, computeBreadth, fetchIndexQuotes, type Breadth, type IndexQuote } from '@/lib/market'
import { computeRegime, bandLabel, bandColor, type Regime, type RegimeInputs } from '@/lib/regime'
import { getEvents, subscribeEvents, type EventItem } from '@/lib/event-stream'
import {
  getReview,
  saveReview,
  today,
  type ExpectItem,
  type MainLine,
  type ReviewSnapshot,
} from '@/lib/review-store'
import { fmtBigNum } from '@/lib/format'
import { inferMarket } from '@/lib/symbol'
import type { OpenStock } from '@/panel/PanelApp'

const UP = '#c74040'
const DOWN = '#2d9b65'

/** 统一输入/下拉样式（与 WatchlistPage 搜索框一致的紧凑风）。 */
const FIELD_CLS =
  'w-full min-w-0 rounded border border-slate-200 bg-white px-1 py-0.5 text-[10px] text-slate-700 outline-none placeholder:text-slate-300 focus:border-emerald-400'

const STATE_OPTS: { v: ExpectItem['state']; l: string }[] = [
  { v: 'strong', l: '强一致' },
  { v: 'divergence', l: '分歧' },
  { v: 'weak2strong', l: '弱转强' },
  { v: 'highRisk', l: '高位风险' },
  { v: 'recession', l: '退潮' },
  { v: 'newLow', l: '低位启动' },
]
const LEVEL_OPTS: { v: ExpectItem['tags']['level']; l: string }[] = [
  { v: 'low', l: '低位' },
  { v: 'mid', l: '中位' },
  { v: 'high', l: '高位' },
]
const ROLE_OPTS: { v: ExpectItem['tags']['role']; l: string }[] = [
  { v: 'leader', l: '龙头' },
  { v: 'follower', l: '跟风' },
  { v: 'catchup', l: '补涨' },
]

interface Props {
  onOpenStock: (s: OpenStock) => void
}

function uid(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8)
}

export function ReviewPage({ onOpenStock }: Props) {
  const day = today()
  const [ladder, setLadder] = useState<LadderSnapshot | null>(null)
  const [breadth, setBreadth] = useState<Breadth | null>(null)
  const [indices, setIndices] = useState<IndexQuote[]>([])
  const [regime, setRegime] = useState<Regime | null>(null)
  const [events, setEvents] = useState<EventItem[]>([])
  const [expectations, setExpectations] = useState<ExpectItem[]>([])
  const [mainLine, setMainLine] = useState<MainLine[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [msg, setMsg] = useState('')
  const [savedAt, setSavedAt] = useState<number | null>(null)
  const [picking, setPicking] = useState(false)
  const busyRef = useRef(false)
  const abortRef = useRef<AbortController | null>(null)

  // 事件流变更订阅（炸板清单跟随已捕获历史）
  useEffect(() => subscribeEvents(() => setEvents(getEvents())), [])

  const load = useCallback(async () => {
    if (busyRef.current) return
    busyRef.current = true
    if (abortRef.current) abortRef.current.abort()
    const ac = new AbortController()
    abortRef.current = ac
    setError('')
    try {
      const [l, idx, allRows] = await Promise.all([
        loadLadder(ac.signal),
        fetchIndexQuotes(),
        fetchAllA(),
      ])
      if (ac.signal.aborted) return
      const b = computeBreadth(allRows)
      const known = l.limitUp.filter((s) => s.streakKnown)
      const maxStreak = known.length ? Math.max(...known.map((s) => s.streak)) : 0
      const inputs: RegimeInputs = {
        limitUp: l.limitUp.length,
        limitDown: l.limitDownCount,
        maxStreak,
        // 晋级率/炸板率/首板溢价需昨日快照（N1 尚未建档）：沿用盘中骨架的近似初值
        promoteRate: 0.4,
        brokenRate: 0.2,
        firstBoardPremium: 1.5,
        upRatio: b.up / Math.max(1, b.up + b.down),
        amountYi: b.amountSum / 1e8,
      }
      setLadder(l)
      setBreadth(b)
      setIndices(idx)
      // 无真实行情（数据源不可用/休市）→ 温度计与存档置空，避免占位公式误导
      const noMarket = b.up + b.down + l.limitUp.length + l.limitDownCount === 0
      if (noMarket) setError('行情源暂无数据（MCP 超时或休市）：涨停池 / 盘眼暂不可用，无法存档')
      setRegime(noMarket ? null : computeRegime(inputs))
      setEvents(getEvents())
      // 主线建议：板块热度 TOP3（板块名 + 代表股符号）
      setMainLine(
        l.boards.slice(0, 3).map((b) => ({
          board: b.name,
          leader: b.repCode ? `${inferMarket(b.repCode)}${b.repCode}` : null,
        })),
      )
      // 已存过今日复盘 → 回填清单与存档时间
      const prev = getReview(day)
      if (prev) {
        setExpectations(prev.expectations)
        setSavedAt(prev.savedAt)
      }
    } catch (e) {
      if (!ac.signal.aborted) setError((e as Error).message || '加载失败')
    } finally {
      busyRef.current = false
      setLoading(false)
    }
  }, [day])

  useEffect(() => {
    void load()
    return () => abortRef.current?.abort()
  }, [load])

  const breakEvents = useMemo(
    () => events.filter((e) => e.kind === 'break' || /炸板|开板/.test(e.desc)).slice(0, 8),
    [events],
  )
  const limitDownEvents = useMemo(
    () => events.filter((e) => e.kind === 'limitDown').slice(0, 6),
    [events],
  )

  const tierCounts = useMemo(() => {
    const m = new Map<number, number>()
    for (const s of ladder?.limitUp ?? []) {
      if (!s.streakKnown) continue
      m.set(s.streak, (m.get(s.streak) ?? 0) + 1)
    }
    return [...m.entries()].sort((a, b) => b[0] - a[0])
  }, [ladder])
  const maxTier = Math.max(1, ...tierCounts.map(([, c]) => c))

  /** 预期清单新增/编辑/删除（本地草稿，存档时统一写入 review-store）。 */
  const addExpectation = (s: LadderStock) => {
    if (expectations.length >= 5) return
    const symbol = `${s.market}${s.code}`
    if (expectations.some((e) => e.symbol === symbol)) return
    setExpectations((prev) => [
      ...prev,
      {
        id: uid(),
        symbol,
        name: s.name,
        tags: {
          themeDay: 1,
          level: s.streak >= 4 ? 'high' : s.streak >= 2 ? 'mid' : 'low',
          role: s.streak >= 3 ? 'leader' : 'catchup',
        },
        state: s.streak >= 4 ? 'highRisk' : s.streak >= 3 ? 'strong' : 'divergence',
        scenario: '',
        auctionOK: '',
        failIf: '',
        reason: '',
      },
    ])
    setPicking(false)
  }

  const updateExp = (id: string, patch: Partial<ExpectItem>) => {
    setExpectations((prev) => prev.map((e) => (e.id === id ? { ...e, ...patch } : e)))
  }
  const removeExp = (id: string) => {
    setExpectations((prev) => prev.filter((e) => e.id !== id))
  }

  /** 存档：装配当日 ReviewSnapshot 并写入 review-store。 */
  const save = () => {
    if (!breadth || !regime || !ladder) {
      setMsg('数据未就绪，无法存档')
      return
    }
    const notable = [
      ...limitDownEvents.map((e) => `${e.time} ${e.name} 跌停`),
      ...breakEvents.map((e) => `${e.time} ${e.name} 炸板`),
    ].slice(0, 12)
    const snap: ReviewSnapshot = {
      day,
      savedAt: Date.now(),
      breadth: {
        up: breadth.up,
        down: breadth.down,
        limitUp: breadth.limitUp,
        limitDown: breadth.limitDown,
        amountYi: breadth.amountSum / 1e8,
      },
      regime,
      mainLine,
      expectations,
      notable,
    }
    saveReview(snap)
    setSavedAt(snap.savedAt)
    setMsg(`已存档 ${day} 复盘（${expectations.length}/5 条预期）`)
    setTimeout(() => setMsg(''), 3000)
  }

  const openEvent = (e: EventItem) => onOpenStock({ market: e.market, code: e.code, name: e.name })

  return (
    <div className="h-full overflow-y-auto px-2.5 pb-3">
      {/* 吸顶头部 */}
      <div className="ds-sticky-head -mx-2.5 mb-1.5 flex items-center justify-between border-b border-slate-100 px-2.5 pb-1.5 pt-2">
        <span className="flex items-center gap-1.5 text-[13px] font-semibold text-slate-800">
          <ClipboardList className="h-3.5 w-3.5 text-emerald-500" />
          复盘 · {day.slice(5)}
        </span>
        <div className="flex items-center gap-2">
          {savedAt && <span className="text-[9px] text-slate-300">已存 {new Date(savedAt).toLocaleTimeString('zh-CN', { hour12: false })}</span>}
          <button
            onClick={() => { setLoading(true); void load() }}
            className="rounded p-0.5 text-slate-300 hover:bg-slate-100 hover:text-slate-500"
            title="刷新数据"
          >
            <RefreshCw className={`h-3 w-3 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      {error && <div className="mb-1.5 rounded bg-red-50 px-2 py-1.5 text-[11px] text-red-500">{error}</div>}
      {msg && <div className="mb-1.5 rounded bg-emerald-50 px-2 py-1 text-[10px] text-emerald-600">{msg}</div>}
      {loading && !ladder && <div className="py-8 text-center text-xs text-slate-300">复盘数据装配中（涨停池 K 线较慢）…</div>}

      {breadth && regime && (
        <>
          {/* ① 今日盘眼 */}
          <div className="mb-1.5 rounded-md border border-slate-100 bg-slate-50/60 px-2 py-1.5">
            <div className="mb-1 text-[10px] font-medium text-slate-400">今日盘眼</div>
            <div className="mb-1 flex items-center gap-1.5">
              <span className="font-mono text-[16px] font-bold leading-none tabular-nums" style={{ color: bandColor(regime.band) }}>
                {regime.temperature}
              </span>
              <span className="rounded bg-slate-200 px-1 text-[8px] text-slate-600">{bandLabel(regime.band)}</span>
              <span className="ml-auto text-[9px] text-slate-400">涨停 {breadth.limitUp} · 跌停 {breadth.limitDown} · 额 {fmtBigNum(breadth.amountSum)}</span>
            </div>
            {regime.drivers.length > 0 && (
              <div className="mb-1 flex flex-wrap gap-1">
                {regime.drivers.map((d) => (
                  <span key={d} className="rounded bg-white px-1 py-px text-[8px] text-slate-500">{d}</span>
                ))}
              </div>
            )}
            {/* 指数行 */}
            <div className="ds-no-scrollbar flex items-center gap-1.5 overflow-x-auto pb-0.5">
              {indices.slice(0, 6).map((ix) => (
                <button
                  key={`${ix.market}${ix.code}`}
                  onClick={() => onOpenStock({ market: ix.market, code: ix.code, name: ix.name })}
                  className="flex shrink-0 items-center gap-1 rounded bg-white px-1.5 py-0.5 hover:bg-emerald-50"
                  title={ix.name}
                >
                  <span className="text-[9px] text-slate-400">{ix.name.replace('指数', '')}</span>
                  <span className="font-mono text-[9px] tabular-nums" style={{ color: ix.pct > 0 ? UP : ix.pct < 0 ? DOWN : '#94a3b8' }}>
                    {ix.pct > 0 ? '+' : ''}{ix.pct.toFixed(2)}%
                  </span>
                </button>
              ))}
            </div>
            {/* 主线一句话 */}
            {mainLine.length > 0 && (
              <div className="mt-1 flex items-start gap-1 text-[10px] leading-relaxed text-slate-600">
                <span className="shrink-0 rounded bg-red-50 px-1 text-[8px] font-medium text-red-500">主线</span>
                <span>{mainLine.map((m) => m.board).join(' / ')}</span>
              </div>
            )}
          </div>

          {/* ② 自动回顾：梯队 + 广度 + 炸板/大面 */}
          {tierCounts.length > 0 && (
            <div className="mb-1.5 rounded-md border border-slate-100 bg-slate-50/60 px-2 py-1.5">
              <div className="mb-1 flex items-center justify-between">
                <span className="flex items-center gap-1 text-[10px] font-medium text-slate-400">
                  <Flame className="h-3 w-3 text-red-500" />涨停梯队（{breadth.up > 0 ? `${ladder?.limitUp.length ?? 0} 只` : '—'}）
                </span>
                <span className="text-[9px] text-slate-300">上涨 {breadth.up} · 下跌 {breadth.down} · 大面(≤-3%) {breadth.strongDown}</span>
              </div>
              <div className="space-y-1">
                {tierCounts.map(([n, c]) => (
                  <div key={n} className="grid grid-cols-[34px_1fr_26px] items-center gap-1.5">
                    <span className={`font-mono text-[10px] font-bold ${n >= 5 ? 'text-red-500' : n >= 3 ? 'text-amber-500' : 'text-slate-500'}`}>{n}板</span>
                    <div className="h-1 overflow-hidden rounded-full bg-slate-200/70">
                      <div className="h-full rounded-full" style={{ width: `${Math.max(6, (c / maxTier) * 100)}%`, background: n >= 3 ? 'rgba(199,64,64,0.7)' : 'rgba(148,163,184,0.6)' }} />
                    </div>
                    <span className="text-right font-mono text-[10px] text-slate-500">{c}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {limitDownEvents.length > 0 && (
            <div className="mb-1.5 rounded-md border border-slate-100 bg-green-50/50 px-2 py-1.5">
              <div className="mb-1 text-[10px] font-medium text-slate-400">跌停事件（已捕获）</div>
              <ul className="space-y-0.5">
                {limitDownEvents.map((e) => (
                  <li key={e.key}>
                    <button onClick={() => openEvent(e)} className="flex w-full items-center gap-1 rounded px-1 py-0.5 text-left hover:bg-white">
                      <span className="min-w-0 flex-1 truncate text-[11px] text-slate-600">{e.name}</span>
                      <span className="font-mono text-[9px] text-slate-300">{e.time}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {breakEvents.length > 0 && (
            <div className="mb-1.5 rounded-md border border-slate-100 bg-amber-50/50 px-2 py-1.5">
              <div className="mb-1 text-[10px] font-medium text-slate-400">炸板清单（盘中已捕获，收盘只读）</div>
              <ul className="space-y-0.5">
                {breakEvents.map((e) => (
                  <li key={e.key}>
                    <button onClick={() => openEvent(e)} className="flex w-full items-center gap-1 rounded px-1 py-0.5 text-left hover:bg-white">
                      <span className="min-w-0 flex-1 truncate text-[11px] text-slate-600">{e.name} {e.desc}</span>
                      <span className="font-mono text-[9px] text-slate-300">{e.time}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </>
      )}

      {/* ③ 预期清单编辑器（≤5） */}
      <div className="mb-1.5 rounded-md border border-slate-100 bg-slate-50/60 px-2 py-1.5">
        <div className="mb-1 flex items-center justify-between">
          <span className="text-[10px] font-medium text-slate-400">预期清单 · {expectations.length}/5</span>
          <button
            onClick={() => setPicking((v) => !v)}
            className="flex items-center gap-0.5 rounded bg-emerald-500 px-1.5 py-0.5 text-[9px] font-medium text-white hover:bg-emerald-600"
          >
            <Plus className="h-2.5 w-2.5" />从涨停池加入
          </button>
        </div>

        {picking && ladder && (
          <div className="mb-1.5 max-h-40 overflow-y-auto rounded border border-slate-100 bg-white py-0.5">
            {ladder.limitUp.slice(0, 15).map((s) => {
              const already = expectations.some((e) => e.symbol === `${s.market}${s.code}`)
              return (
                <button
                  key={`${s.market}${s.code}`}
                  disabled={already || expectations.length >= 5}
                  onClick={() => addExpectation(s)}
                  className="flex w-full items-center gap-1.5 px-1.5 py-1 text-left hover:bg-emerald-50 disabled:opacity-40"
                >
                  <span className="min-w-0 flex-1 truncate text-[11px] text-slate-700">{s.name}</span>
                  {s.streakKnown && s.streak > 1 && (
                    <span className="shrink-0 rounded bg-red-50 px-1 font-mono text-[8px] text-red-500">{s.streak}板</span>
                  )}
                  <span className="shrink-0 font-mono text-[8px] text-slate-300">{s.code}</span>
                  {already && <span className="shrink-0 text-[8px] text-emerald-500">已加入</span>}
                </button>
              )
            })}
          </div>
        )}

        {expectations.length === 0 && !picking && (
          <div className="py-2 text-center text-[10px] text-slate-300">从今日涨停池加入龙头，或暂无预期</div>
        )}

        <div className="space-y-1.5">
          {expectations.map((exp) => (
            <div key={exp.id} className="rounded-md border border-slate-100 bg-white px-1.5 py-1">
              <div className="mb-1 flex items-center gap-1">
                <span className="min-w-0 flex-1 truncate text-[11px] font-semibold text-slate-700">{exp.name}</span>
                <span className="rounded bg-slate-100 px-1 font-mono text-[8px] text-slate-400">{exp.symbol}</span>
                <button onClick={() => removeExp(exp.id)} className="text-slate-200 hover:text-red-500">
                  <X className="h-3 w-3" />
                </button>
              </div>
              <div className="mb-1 grid grid-cols-4 gap-1">
                <Field label="状态">
                  <select
                    value={exp.state}
                    onChange={(e) => updateExp(exp.id, { state: e.target.value as ExpectItem['state'] })}
                    className={FIELD_CLS}
                  >
                    {STATE_OPTS.map((o) => (
                      <option key={o.v} value={o.v}>{o.l}</option>
                    ))}
                  </select>
                </Field>
                <Field label="题材天">
                  <input
                    type="number"
                    min={1}
                    max={30}
                    value={exp.tags.themeDay ?? 1}
                    onChange={(e) => updateExp(exp.id, { tags: { ...exp.tags, themeDay: Math.max(1, Number(e.target.value) || 1) } })}
                    className={FIELD_CLS}
                  />
                </Field>
                <Field label="层级">
                  <select
                    value={exp.tags.level}
                    onChange={(e) => updateExp(exp.id, { tags: { ...exp.tags, level: e.target.value as ExpectItem['tags']['level'] } })}
                    className={FIELD_CLS}
                  >
                    {LEVEL_OPTS.map((o) => (
                      <option key={o.v} value={o.v}>{o.l}</option>
                    ))}
                  </select>
                </Field>
                <Field label="角色">
                  <select
                    value={exp.tags.role}
                    onChange={(e) => updateExp(exp.id, { tags: { ...exp.tags, role: e.target.value as ExpectItem['tags']['role'] } })}
                    className={FIELD_CLS}
                  >
                    {ROLE_OPTS.map((o) => (
                      <option key={o.v} value={o.v}>{o.l}</option>
                    ))}
                  </select>
                </Field>
              </div>
              <TextRow
                label="剧本"
                value={exp.scenario}
                maxLen={40}
                placeholder="明日最可能路径（如：加速一致/高开分歧…）"
                onChange={(v) => updateExp(exp.id, { scenario: v })}
              />
              <TextRow
                label="竞价条件"
                value={exp.auctionOK}
                maxLen={60}
                placeholder="可量化，如：高开3%+竞价量>昨日20%"
                onChange={(v) => updateExp(exp.id, { auctionOK: v })}
              />
              <TextRow
                label="失败条件"
                value={exp.failIf}
                maxLen={60}
                placeholder="出现即放弃（断板/破位/板块退潮…）"
                onChange={(v) => updateExp(exp.id, { failIf: v })}
              />
              <TextRow
                label="理由"
                value={exp.reason}
                maxLen={80}
                placeholder="一句话含量价证据，不允许纯叙事"
                onChange={(v) => updateExp(exp.id, { reason: v })}
              />
            </div>
          ))}
        </div>
      </div>

      {/* ④ 存档 */}
      <button
        onClick={save}
        disabled={!breadth || !regime || loading}
        className="flex w-full items-center justify-center gap-1.5 rounded-md bg-emerald-600 py-1.5 text-[12px] font-semibold text-white hover:bg-emerald-700 disabled:opacity-40"
      >
        <Save className="h-3.5 w-3.5" />存档今日复盘
      </button>
      <div className="mt-1 text-center text-[9px] text-slate-300">
        预期清单 ≤5 · 存档按日覆盖 · 供次日竞价对照（保存后刷新不丢）
      </div>
    </div>
  )
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block min-w-0">
      <div className="mb-0.5 text-[8px] text-slate-300">{label}</div>
      {children}
    </label>
  )
}

function TextRow({
  label, value, maxLen, placeholder, onChange,
}: {
  label: string
  value: string
  maxLen: number
  placeholder?: string
  onChange: (v: string) => void
}) {
  return (
    <label className="mb-1 block">
      <div className="mb-0.5 text-[8px] text-slate-300">{label}</div>
      <input
        value={value}
        maxLength={maxLen}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        className={FIELD_CLS}
      />
    </label>
  )
}
