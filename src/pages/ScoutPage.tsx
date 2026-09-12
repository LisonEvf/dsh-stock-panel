/**
 * 轻量选股页（M8：ScoutPage，Tab「选股」）。
 *
 * 依据 MIGRATION-PLAN §5 M8 裁剪：
 *   1. 预设策略卡片（6 张）一键筛选 + 自定义条件（涨跌幅/量比/换手/成交额/市值/板块/剔 ST）；
 *   2. 结果表（≤60 行展示，点行开个股）；候选 ≤200 可再跑「信号分析」
 *      （MA5 上穿 MA20 金叉 / 放量上穿 MA60），命中行打徽标。
 *
 * 数据：fetchAllA（20s TTL 模块级共享缓存）+ lib/screener（纯逻辑）。
 */

import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react'
import { RefreshCw, Sparkles, Star, ExternalLink, X, Zap } from 'lucide-react'
import type { AShareRow } from '@/lib/stock-data'
import { fetchAllA } from '@/lib/market'
import {
  PRESETS,
  SIGNAL_META,
  matchScreen,
  runSignalOnCandidates,
  type ScreenCond,
  type SignalKind,
} from '@/lib/screener'
import type { OpenStock } from '@/panel/PanelApp'
// v1.3：一键让模型从筛选结果里挑票排序（AI 直调通道，结果回填本页参考区）
import { useAiTask } from '@/lib/ai-task'
import { compactRows, scoutRankOf } from '@/lib/ai'
import type { ScoutRank } from '@/lib/ai-contract'
import { AiRankList, type AiRankRow } from '@/components/AiRankList'
import { watchAddSymbol } from '@/lib/watchlist-store'
import type { MarketTag } from '@/lib/symbol'

const UP = '#c74040'
const DOWN = '#2d9b65'

const FIELD_CLS =
  'w-full min-w-0 rounded border border-slate-200 bg-white px-1 py-0.5 text-[10px] font-mono text-slate-700 outline-none focus:border-emerald-400'

export function ScoutPage({ onOpenStock }: { onOpenStock: (s: OpenStock) => void }) {
  const [cond, setCond] = useState<ScreenCond>({ noST: true, volRatioMin: 2, pctMin: 2, pctMax: 8 })
  const [presetKey, setPresetKey] = useState<string>('')
  const [results, setResults] = useState<AShareRow[]>([])
  const [total, setTotal] = useState(0)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [ranAt, setRanAt] = useState<number | null>(null)

  // 信号分析
  const [signalKind, setSignalKind] = useState<SignalKind | null>(null)
  const [sigRunning, setSigRunning] = useState(false)
  const [sigProgress, setSigProgress] = useState({ done: 0, total: 0 })
  const [sigHits, setSigHits] = useState<Set<string>>(new Set())
  const aliveRef = useRef(true)
  const sigAbortRef = useRef(false)

  useEffect(() => {
    aliveRef.current = true
    return () => {
      aliveRef.current = false
      sigAbortRef.current = true
    }
  }, [])

  const run = useCallback(async (c: ScreenCond = cond) => {
    if (busy) return
    setBusy(true)
    setErr('')
    setSignalKind(null)
    setSigHits(new Set())
    try {
      const all = await fetchAllA()
      if (!aliveRef.current) return
      const matched: AShareRow[] = []
      for (const r of all) {
        if (matchScreen(r, c)) matched.push(r)
        if (matched.length >= 200) break
      }
      const countTotal = all.reduce((n, r) => (matchScreen(r, c) ? n + 1 : n), 0)
      setTotal(countTotal)
      setResults(matched)
      setRanAt(Date.now())
    } catch (e) {
      if (aliveRef.current) setErr((e as Error).message || '筛选失败')
    } finally {
      if (aliveRef.current) setBusy(false)
    }
  }, [cond, busy])

  /**
   * 应用预设：cond 覆盖为预设值并立即用**显式 cond** 筛选。
   * 必须定义在 run 之后 —— 这里显式传 p.cond 而不是依赖 cond 状态，
   * 否则 setCond 尚未落地时会用旧条件筛出错的结果。
   */
  const applyPreset = useCallback((key: string) => {
    const p = PRESETS.find((x) => x.key === key)
    if (!p) return
    setPresetKey(key)
    setCond(p.cond)
    setSignalKind(null)
    setSigHits(new Set())
    void run(p.cond)
  }, [run])

  const setNum = (field: keyof ScreenCond) => (e: ChangeEvent<HTMLInputElement>) => {
    const v = e.target.value
    setPresetKey('')
    setCond((prev) => ({
      ...prev,
      [field]: v === '' ? undefined : Number(v),
    }))
  }

  const toggleFlag = (field: 'noST', on: boolean) => {
    setPresetKey('')
    setCond((prev) => ({ ...prev, [field]: on }))
  }

  /** 信号分析：对候选（≤200）拉 kline 算客户端信号。 */
  const runSignals = useCallback(async () => {
    if (!results.length || sigRunning) return
    const cands = results.slice(0, 200).map((r) => ({ market: r.market, code: r.code, name: r.name }))
    const kind: SignalKind = 'ma_golden'
    setSignalKind(kind)
    setSigRunning(true)
    setSigProgress({ done: 0, total: cands.length })
    sigAbortRef.current = false
    const hits = await runSignalOnCandidates(cands, kind, 8, (done, total) => {
      if (aliveRef.current) setSigProgress({ done, total })
    })
    if (aliveRef.current) {
      setSigHits(hits)
      setSigRunning(false)
    }
  }, [results, sigRunning])

  const display = useMemo(() => results.slice(0, 60), [results])
  const isHit = (r: AShareRow) => sigHits.has(`${r.market}${r.code}`)

  // ── v1.3：AI 候选排序（一键让模型从筛选结果里挑「最有持续性」的 3-5 只） ──
  const aiRank = useAiTask('scout-rank')
  const [rank, setRank] = useState<ScoutRank | null>(null)
  const [rankRaw, setRankRaw] = useState('')

  const runAiRank = useCallback(async () => {
    if (results.length === 0) return
    const res = await aiRank.run({
      conditions: cond,
      preset: presetKey || null,
      screenedCount: results.length,
      total: total,
      signalHits: [...sigHits].slice(0, 30),
      candidates: compactRows(
        results.slice(0, 40) as unknown as Array<Record<string, unknown>>,
        ['market', 'code', 'name', 'pct', 'vol_ratio', 'turnover', 'amount', 'close', 'buy_price_limit'],
        40,
      ),
    })
    if (res === null) return
    if (!res.ok) {
      setRank(null)
      setRankRaw(res.text ?? '')
      return
    }
    setRank(scoutRankOf(res))
    setRankRaw(res.text ?? '')
  }, [aiRank, results, cond, presetKey, total, sigHits])

  /** 模型点名 → 名次映射（用于在筛选结果表里给命中的行打 AI 徽标）。 */
  const rankOf = useMemo(() => {
    const map = new Map<string, number>()
    rank?.picks.forEach((p, i) => map.set(p.symbol, i + 1))
    return map
  }, [rank])

  const rankRows: AiRankRow[] = useMemo(() => {
    if (rank === null) return []
    return rank.picks.map((p, i) => ({
      key: `${i}-${p.symbol}`,
      rank: i + 1,
      title: p.name ?? p.symbol,
      subtitle: p.symbol,
      score: p.score,
      reason: p.reason,
      actions: (
        <>
          <button
            type="button"
            className="dc-btn dc-btn--accent dc-btn--icon"
            title="打开（切到盯盘工作台）"
            onClick={() => onOpenStock({ market: p.symbol.slice(0, 2) as MarketTag, code: p.symbol.slice(2), name: p.name ?? p.symbol })}
          >
            <ExternalLink size={11} />
          </button>
          <button
            type="button"
            className="dc-btn dc-btn--icon"
            title="加入自选"
            onClick={() => watchAddSymbol(p.symbol, p.name)}
          >
            <Star size={11} />
          </button>
        </>
      ),
    }))
  }, [rank, onOpenStock])

  return (
    <div className="h-full overflow-y-auto px-2.5 pb-3">
      <div className="ds-sticky-head -mx-2.5 mb-1.5 flex items-center justify-between border-b border-slate-100 px-2.5 pb-1.5 pt-2">
        <span className="flex items-center gap-1.5 text-[13px] font-semibold text-slate-800">
          <Zap className="h-3.5 w-3.5 text-emerald-500" />
          选股 · 快照筛选
        </span>
        <div className="flex items-center gap-2">
          {ranAt && <span className="text-[9px] text-slate-300">{new Date(ranAt).toLocaleTimeString('zh-CN', { hour12: false })}</span>}
          {/* v1.3：一键让模型从筛选结果里挑「最有持续性」的 3-5 只并给理由 */}
          <button
            onClick={() => void runAiRank()}
            disabled={aiRank.busy || results.length === 0 || aiRank.availability?.available === false}
            title={
              aiRank.availability?.available === false
                ? `不可用：${aiRank.availability.reason ?? ''}`
                : results.length === 0
                  ? '先跑一次筛选'
                  : `让模型从当前 ${Math.min(40, results.length)} 只候选里挑 3-5 只（放量/非高位/主线内）并给理由`
            }
            className="flex items-center gap-0.5 rounded border border-emerald-200 px-1.5 py-0.5 text-[10px] font-medium text-emerald-600 hover:bg-emerald-50 disabled:opacity-40"
          >
            {aiRank.busy ? <RefreshCw className="h-2.5 w-2.5 animate-spin" /> : <Sparkles className="h-2.5 w-2.5" />}
            AI 排序
          </button>
          <button
            onClick={() => void run()}
            className="flex items-center gap-0.5 rounded bg-emerald-500 px-1.5 py-0.5 text-[10px] font-medium text-white hover:bg-emerald-600 disabled:opacity-40"
            disabled={busy}
          >
            <RefreshCw className={`h-2.5 w-2.5 ${busy ? 'animate-spin' : ''}`} />
            筛选
          </button>
        </div>
      </div>

      {err && <div className="mb-1.5 rounded bg-red-50 px-2 py-1 text-[10px] text-red-500">{err}</div>}

      {/* AI 排序结果（参考区：点「打开」跳工作台，点「★」加自选） */}
      {rank !== null || aiRank.status === 'error' || aiRank.busy ? (
        <div className="mb-1.5 rounded-md border border-emerald-100 bg-white px-2 py-1.5">
          <div className="mb-1 flex items-center gap-1">
            <Sparkles className="h-2.5 w-2.5 text-emerald-500" />
            <span className="text-[10px] font-medium text-slate-500">AI 候选排序（参考）</span>
            {rank?.summary ? <span className="min-w-0 flex-1 truncate text-[10px] text-slate-400">· {rank.summary}</span> : <span className="flex-1" />}
            {aiRank.meta ? <span className="shrink-0 font-mono text-[8px] text-slate-300">{(aiRank.meta.ms / 1000).toFixed(1)}s</span> : null}
            <button
              type="button"
              onClick={() => { setRank(null); setRankRaw(''); aiRank.reset() }}
              className="shrink-0 text-slate-300 hover:text-slate-500"
            >
              <X className="h-2.5 w-2.5" />
            </button>
          </div>
          {aiRank.busy ? <div className="py-1 text-[10px] text-slate-400">模型正在挑票…</div> : null}
          {aiRank.status === 'error' ? <div className="py-1 text-[10px] text-red-500">{aiRank.error}</div> : null}
          {aiRank.meta?.shrunk !== undefined && aiRank.meta.shrunk.length > 0 ? (
            <div className="dc-ai-note" title={aiRank.meta.shrunk.join('；')}>
              ⚠ 上下文过大，已自动裁剪后重试：{aiRank.meta.shrunk[aiRank.meta.shrunk.length - 1]}
            </div>
          ) : null}
          {rank !== null ? <AiRankList rows={rankRows} /> : null}
          {rank === null && !aiRank.busy && rankRaw !== '' ? <div className="dc-ai-raw mt-1">{rankRaw}</div> : null}
        </div>
      ) : null}

      {/* ① 预设策略卡片 */}
      <div className="mb-1.5 rounded-md border border-slate-100 bg-slate-50/60 px-2 py-1.5">
        <div className="mb-1 text-[10px] font-medium text-slate-400">预设策略（点选即筛）</div>
        <div className="grid grid-cols-2 gap-1">
          {PRESETS.map((p) => (
            <button
              key={p.key}
              onClick={() => applyPreset(p.key)}
              title={p.hint}
              className={`rounded border px-1.5 py-1 text-left ${presetKey === p.key ? 'border-emerald-400 bg-emerald-50' : 'border-slate-100 bg-white hover:bg-emerald-50/50'}`}
            >
              <div className="text-[10px] font-medium text-slate-700">{p.label}</div>
              <div className="mt-0.5 truncate text-[8px] text-slate-400">{p.hint}</div>
            </button>
          ))}
        </div>
      </div>

      {/* ② 自定义条件 */}
      <div className="mb-1.5 rounded-md border border-slate-100 bg-slate-50/60 px-2 py-1.5">
        <div className="mb-1 flex items-center justify-between">
          <span className="text-[10px] font-medium text-slate-400">自定义条件</span>
          <label className="flex items-center gap-1 text-[9px] text-slate-500">
            <input type="checkbox" checked={!!cond.noST} onChange={(e) => toggleFlag('noST', e.target.checked)} />
            剔 ST
          </label>
        </div>
        <div className="grid grid-cols-4 gap-1">
          <label className="block">
            <div className="mb-0.5 text-[8px] text-slate-300">涨幅% ≥</div>
            <input value={cond.pctMin ?? ''} onChange={setNum('pctMin')} placeholder="0" className={FIELD_CLS} />
          </label>
          <label className="block">
            <div className="mb-0.5 text-[8px] text-slate-300">涨幅% ≤</div>
            <input value={cond.pctMax ?? ''} onChange={setNum('pctMax')} placeholder="10" className={FIELD_CLS} />
          </label>
          <label className="block">
            <div className="mb-0.5 text-[8px] text-slate-300">量比 ≥</div>
            <input value={cond.volRatioMin ?? ''} onChange={setNum('volRatioMin')} placeholder="1" className={FIELD_CLS} />
          </label>
          <label className="block">
            <div className="mb-0.5 text-[8px] text-slate-300">换手% ≥</div>
            <input value={cond.turnoverMin ?? ''} onChange={setNum('turnoverMin')} placeholder="1" className={FIELD_CLS} />
          </label>
          <label className="block">
            <div className="mb-0.5 text-[8px] text-slate-300">额亿 ≥</div>
            <input value={cond.amountMinYi ?? ''} onChange={setNum('amountMinYi')} placeholder="1" className={FIELD_CLS} />
          </label>
          <label className="block">
            <div className="mb-0.5 text-[8px] text-slate-300">市值亿 ≤</div>
            <input value={cond.capMaxYi ?? ''} onChange={setNum('capMaxYi')} placeholder="不限" className={FIELD_CLS} />
          </label>
          <label className="col-span-2 block">
            <div className="mb-0.5 text-[8px] text-slate-300">板块</div>
            <select
              value={cond.board ?? 'all'}
              onChange={(e) => {
                setPresetKey('')
                setCond((prev) => ({ ...prev, board: (e.target.value || 'all') as ScreenCond['board'] }))
              }}
              className={FIELD_CLS}
            >
              <option value="all">全部</option>
              <option value="main_sh">沪主板</option>
              <option value="main_sz">深主板</option>
              <option value="cyb">创业板</option>
              <option value="kcb">科创板</option>
              <option value="bj">北交所</option>
            </select>
          </label>
        </div>
      </div>

      {/* ③ 结果区 */}
      <div className="rounded-md border border-slate-100 bg-slate-50/60 px-2 py-1.5">
        <div className="mb-1 flex items-center justify-between">
          <span className="text-[10px] font-medium text-slate-400">
            结果 · 命中 {total}（展示 {display.length}）
          </span>
          <div className="flex items-center gap-1.5">
            {signalKind && !sigRunning && (
              <span className="rounded bg-blue-50 px-1 text-[8px] text-blue-500">{SIGNAL_META[signalKind].label} 命中 {sigHits.size}</span>
            )}
            {sigRunning && (
              <span className="text-[9px] text-slate-400">
                信号分析中 {sigProgress.done}/{sigProgress.total}…
              </span>
            )}
            {results.length > 0 && !sigRunning && (
              <button
                onClick={() => void runSignals()}
                disabled={busy}
                className="rounded bg-blue-500 px-1.5 py-0.5 text-[9px] font-medium text-white hover:bg-blue-600 disabled:opacity-40"
                title={`对候选 ${Math.min(200, results.length)} 只拉 DAILY(80) 算 MA5 上穿 MA20（约 10-40s）`}
              >
                {SIGNAL_META.ma_golden.label}分析
              </button>
            )}
          </div>
        </div>

        {busy && <div className="py-2 text-center text-[10px] text-slate-300">全 A 快照读取/筛选中…</div>}
        {!busy && !err && total === 0 && (
          <div className="py-2 text-center text-[10px] text-slate-300">
            暂无命中（数据源休市/空返回时同样成立；先点「筛选」或选预设）
          </div>
        )}

        {!busy && display.length > 0 && (
          <div className="space-y-0.5">
            <div className="grid grid-cols-[1fr_42px_44px_38px_44px] gap-1 px-1 pb-0.5 text-[8px] text-slate-300">
              <span>名称</span>
              <span className="text-right">涨幅</span>
              <span className="text-right">换手%</span>
              <span className="text-right">量比</span>
              <span className="text-right">额亿</span>
            </div>
            {display.map((r) => (
              <div
                key={`${r.market}${r.code}`}
                className={`grid grid-cols-[1fr_42px_44px_38px_44px] items-center gap-1 rounded px-1 py-0.5 font-mono text-[9px] tabular-nums odd:bg-white/70 ${isHit(r) ? 'bg-amber-50' : ''}`}
              >
                <button
                  onClick={() => onOpenStock({ market: r.market, code: r.code, name: r.name })}
                  className="flex min-w-0 items-center gap-1 text-left"
                >
                  <span className="min-w-0 truncate text-slate-700 hover:text-emerald-600">{r.name}</span>
                  {isHit(r) && (
                    <span className="shrink-0 rounded bg-amber-400 px-0.5 text-[7px] font-bold text-white">{SIGNAL_META.ma_golden.label}</span>
                  )}
                  {rankOf.get(`${r.market}${r.code}`) !== undefined && (
                    <span
                      className="shrink-0 rounded bg-emerald-500 px-0.5 text-[7px] font-bold text-white"
                      title={`模型把这只排在第 ${rankOf.get(`${r.market}${r.code}`)} 位`}
                    >
                      AI#{rankOf.get(`${r.market}${r.code}`)}
                    </span>
                  )}
                </button>
                <span className="text-right" style={{ color: r.pct > 0 ? UP : r.pct < 0 ? DOWN : '#94a3b8' }}>
                  {r.pct > 0 ? '+' : ''}{r.pct.toFixed(2)}
                </span>
                <span className="text-right text-slate-500">{r.turnover ? r.turnover.toFixed(1) : '—'}</span>
                <span className="text-right text-slate-500">{r.vol_ratio ? r.vol_ratio.toFixed(2) : '—'}</span>
                <span className="text-right text-slate-400">{(r.amount / 1e8).toFixed(1)}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
