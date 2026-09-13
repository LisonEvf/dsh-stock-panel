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
import { fetchKlineRows, type AShareRow } from '@/lib/stock-data'
import { fetchAllA } from '@/lib/market'
import {
  PRESETS,
  SIGNAL_META,
  detectSignal,
  matchScreen,
  type ScreenCond,
  type SignalKind,
} from '@/lib/screener'
import { runPool } from '@/lib/pool'
import { toToolError } from '@/lib/mcp'
import type { OpenStock } from '@/panel/PanelApp'
// v1.3：一键让模型从筛选结果里挑票排序（AI 直调通道，结果回填本页参考区）
import { useAiTask } from '@/lib/ai-task'
import { compactRows, scoutRankOf } from '@/lib/ai'
import type { ScoutRank } from '@/lib/ai-contract'
import { AiRankList, type AiRankRow } from '@/components/AiRankList'
import { ErrorBar } from '@/components/ErrorBar'
import { watchAddSymbol } from '@/lib/watchlist-store'
import type { MarketTag } from '@/lib/symbol'
import { fmtAmount } from '@/lib/format'

const UP = 'var(--dc-up)'
const DOWN = 'var(--dc-down)'

/** 信号分析的单次 kline 请求根数（MA60 需要 ≥62 根；与旧 runSignalOnCandidates 同口径）。 */
const SIG_BARS = 80
/** 并发（与旧 runSignalOnCandidates 默认一致）。 */
const SIG_CONCURRENCY = 8
/** 进度回调节流：200 只逐只 setState 会把整页重渲 200 次（旧实现就是逐只回写）。 */
const SIG_PROGRESS_THROTTLE_MS = 200

const FIELD_CLS =
  'w-full min-w-0 rounded border border-slate-200 bg-white px-1 py-0.5 dc-t-data font-mono text-slate-700 outline-none focus:border-emerald-400'

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
  /**
   * I3：信号分析的"失败可见"。旧实现逐只 `catch { return null }` 全吞掉 ——
   * 200 只**全部**取数失败时界面照样显示"完成"，用户看到的是"一个信号都没有"这个
   * 完全错误的结论。这里把失败计数与首个原因留下来渲染。
   */
  const [sigFail, setSigFail] = useState<{ failed: number; total: number; reason: unknown } | null>(null)
  /** 被用户取消（或切页卸载）而提前结束：结果只覆盖已算完的部分，必须说清。 */
  const [sigCancelled, setSigCancelled] = useState(false)
  const aliveRef = useRef(true)
  /**
   * 真中止句柄（不是文案上的"已取消"）：旧版 `sigAbortRef = useRef(false)` 只是个
   * **没人读**的布尔位，200 只 × kline 的池子最坏 ~10 分钟，用户点了取消也照样跑完。
   */
  const sigAbortRef = useRef<AbortController | null>(null)
  /**
   * 轮次号：每次开跑 +1。收尾时若号已变（用户重新筛选 / 又点了重跑），这一轮的结果就**作废**，
   * 绝不回写状态 —— 否则旧轮的 done/失败数会把新轮覆盖掉（候选集都不是同一份了）。
   */
  const sigRunRef = useRef(0)

  useEffect(() => {
    aliveRef.current = true
    return () => {
      aliveRef.current = false
      // 卸载即中止 + 作废：页面都走了还继续打 200 次 kline 是纯浪费（也违反预算纪律）
      sigAbortRef.current?.abort()
      sigRunRef.current += 1
    }
  }, [])

  const run = useCallback(async (c: ScreenCond = cond) => {
    if (busy) return
    setBusy(true)
    setErr('')
    setSignalKind(null)
    setSigHits(new Set())
    setSigFail(null)
    setSigCancelled(false)
    // 候选集要变了 → 正在跑的信号分析作废：中止 + 让它的收尾不再回写（那一轮的数字已无意义），
    // 同时把 sigRunning 放掉（否则按钮会一直卡在"分析中"，用户再也点不动）。
    sigAbortRef.current?.abort()
    sigAbortRef.current = null
    sigRunRef.current += 1
    setSigRunning(false)
    setSigProgress({ done: 0, total: 0 })
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

  /**
   * 信号分析：对候选（≤200）逐只拉 kline 算客户端信号。
   *
   * ── I3 补齐了四件旧实现没有的事 ──
   *   1. **可取消**：真 AbortController 交给 runPool 的 `signal`（排队项立刻不再发起请求），
   *      worker 每次拿到结果后再查一次 aborted，取消后不再计入命中。残留：**已发出的
   *      ≤8 个 fetch 无法中断** —— `fetchKlineRows`/`lib/stock-data.ts` 不暴露 signal 且
   *      不在本次改动范围；所以"取消"的最坏收尾是**单只 kline 的耗时（秒级）**，
   *      而不是整个 200 只（旧版最坏 ~10 分钟且完全不可中断）。
   *   2. **进度可见**：done/total + 百分比 + 进度条 + 实时命中数（节流回写，不让 200 只
   *      逐只重渲整页）。
   *   3. **失败可见**：逐只失败计数 + 首个原因（旧版全吞）。
   *   4. **可重试**：失败条/取消条上都有"重跑"。旧版 `runSignalOnCandidates` 没有任何
   *      失败出口，用户只能靠再点一次按钮撞运气。
   */
  const runSignals = useCallback(async () => {
    if (!results.length || sigRunning) return
    const cands = results.slice(0, 200).map((r) => ({ market: r.market, code: r.code, name: r.name }))
    const kind: SignalKind = 'ma_golden'
    const ac = new AbortController()
    const runId = sigRunRef.current + 1
    sigRunRef.current = runId
    sigAbortRef.current = ac
    setSignalKind(kind)
    setSigRunning(true)
    setSigCancelled(false)
    setSigFail(null)
    setSigHits(new Set())
    setSigProgress({ done: 0, total: cands.length })

    let done = 0
    let failed = 0
    let firstReason: unknown = null
    let lastPush = 0
    const hits = new Set<string>()
    const push = (force: boolean): void => {
      const now = Date.now()
      if (!force && now - lastPush < SIG_PROGRESS_THROTTLE_MS) return
      lastPush = now
      if (!aliveRef.current) return
      setSigProgress({ done, total: cands.length })
      setSigHits(new Set(hits))
    }

    await runPool(
      cands,
      async (c) => {
        // 第二道闸：已在跑的 worker 见 abort 立刻放手，不再多打一只票的请求
        if (ac.signal.aborted) return null
        try {
          const rows = await fetchKlineRows(c.market, c.code, 'DAILY', SIG_BARS)
          // 取消那一刻之后回来的结果不再计入（否则"取消"会继续改变命中集，等于没取消）
          if (ac.signal.aborted) return null
          if (detectSignal(rows, kind)) hits.add(`${c.market}${c.code}`)
        } catch (e) {
          // 失败不再静默：记数 + 留首个原因，跑完如实显示
          if (firstReason === null) firstReason = e
          failed += 1
        } finally {
          done += 1
          push(false)
        }
        return null
      },
      { concurrency: SIG_CONCURRENCY, signal: ac.signal },
    )

    // 陈旧轮次保护：期间又开了新的一轮（重新筛选 / 再点重跑）→ 这一轮作废，一个字都不回写。
    if (sigRunRef.current !== runId) return
    sigAbortRef.current = null
    if (!aliveRef.current) return
    push(true)
    setSigRunning(false)
    setSigCancelled(ac.signal.aborted)
    setSigFail(failed > 0 ? { failed, total: cands.length, reason: firstReason } : null)
  }, [results, sigRunning])

  /**
   * 取消：只发中止信号，**不做乐观的"已取消"显示**。
   * 原因：在途的 ≤8 个请求还会回来，取消瞬间显示"完成 N 只"是假的；
   * 等 runSignals 收尾时按真实 done/total 写回。
   */
  const cancelSignals = useCallback(() => {
    sigAbortRef.current?.abort()
  }, [])

  const sigPct = sigProgress.total > 0 ? Math.round((sigProgress.done / sigProgress.total) * 100) : 0

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
        <span className="flex items-center gap-1.5 text-sm font-semibold text-slate-800">
          <Zap className="h-3.5 w-3.5 text-emerald-500" />
          选股 · 快照筛选
        </span>
        <div className="flex items-center gap-2">
          {ranAt && <span className="dc-t-micro text-slate-300">{new Date(ranAt).toLocaleTimeString('zh-CN', { hour12: false })}</span>}
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
            className="flex items-center gap-0.5 rounded border border-emerald-200 px-1.5 py-0.5 dc-t-data font-medium text-emerald-600 hover:bg-emerald-50 disabled:opacity-40"
          >
            {aiRank.busy ? <RefreshCw className="h-2.5 w-2.5 animate-spin" /> : <Sparkles className="h-2.5 w-2.5" />}
            AI 排序
          </button>
          <button
            onClick={() => void run()}
            className="flex items-center gap-0.5 rounded bg-emerald-500 px-1.5 py-0.5 dc-t-data font-medium text-white hover:bg-emerald-600 disabled:opacity-40"
            disabled={busy}
          >
            <RefreshCw className={`h-2.5 w-2.5 ${busy ? 'animate-spin' : ''}`} />
            筛选
          </button>
        </div>
      </div>

      {/* 筛选失败：给分类 + 原因 + 重试（旧版只有一行红字，没有出路） */}
      {err !== '' && (
        <ErrorBar className="mb-1.5" error={err} onRetry={() => void run()} title="筛选失败" retryLabel="重试筛选" />
      )}

      {/* AI 排序结果（参考区：点「打开」跳工作台，点「★」加自选） */}
      {rank !== null || aiRank.status === 'error' || aiRank.busy ? (
        <div className="mb-1.5 rounded-md border border-emerald-100 bg-white px-2 py-1.5">
          <div className="mb-1 flex items-center gap-1">
            <Sparkles className="h-2.5 w-2.5 text-emerald-500" />
            <span className="dc-t-data font-medium text-slate-500">AI 候选排序（参考）</span>
            {rank?.summary ? <span className="min-w-0 flex-1 truncate dc-t-data text-slate-400">· {rank.summary}</span> : <span className="flex-1" />}
            {aiRank.meta ? <span className="shrink-0 font-mono dc-t-micro text-slate-300">{(aiRank.meta.ms / 1000).toFixed(1)}s</span> : null}
            <button
              type="button"
              onClick={() => { setRank(null); setRankRaw(''); aiRank.reset() }}
              className="shrink-0 text-slate-300 hover:text-slate-500"
            >
              <X className="h-2.5 w-2.5" />
            </button>
          </div>
          {aiRank.busy ? <div className="py-1 dc-t-data text-slate-400">模型正在挑票…</div> : null}
          {aiRank.status === 'error' ? <div className="py-1 dc-t-data text-red-500">{aiRank.error}</div> : null}
          {aiRank.meta?.shrunk !== undefined && aiRank.meta.shrunk.length > 0 ? (
            <div className="dc-ai-note" title={aiRank.meta.shrunk.join('；')}>
              ⚠ 上下文过大，已自动裁剪后重试：{aiRank.meta.shrunk[aiRank.meta.shrunk.length - 1]}
            </div>
          ) : null}
          {rank !== null ? <AiRankList rows={rankRows} /> : null}
          {rank === null && !aiRank.busy && rankRaw !== '' ? <div className="dc-ai-raw mt-1">{rankRaw}</div> : null}
        </div>
      ) : null}

      {/* ① 预设策略（一行一张：条件写在名称右侧同一行）
          此前是 2 列 × 2 行/张（名称一行 + 8px 条件一行，还被 truncate 截掉）——
          卡片宽 ~565px 而内容只占 ~300px：**宽度浪费 + 8px 截断**两头不讨好。
          改成 3 列 × 单行：内容一行显示全、卡高减半，省下的纵向空间留给结果表。 */}
      <div className="mb-1.5 rounded-md border border-slate-100 bg-slate-50/60 px-2 py-1.5">
        <div className="mb-1 dc-t-data font-medium text-slate-400">预设策略（点选即筛）</div>
        <div className="grid grid-cols-3 gap-1">
          {PRESETS.map((p) => (
            <button
              key={p.key}
              onClick={() => applyPreset(p.key)}
              title={p.hint}
              className={`flex min-w-0 items-baseline gap-1 rounded border px-1.5 py-1 text-left ${presetKey === p.key ? 'border-emerald-400 bg-emerald-50' : 'border-slate-100 bg-white hover:bg-emerald-50/50'}`}
            >
              <span className="shrink-0 dc-t-data font-medium text-slate-700">{p.label}</span>
              <span className="min-w-0 flex-1 truncate dc-t-note text-slate-400">{p.hint}</span>
            </button>
          ))}
        </div>
      </div>

      {/* ② 自定义条件 */}
      <div className="mb-1.5 rounded-md border border-slate-100 bg-slate-50/60 px-2 py-1.5">
        <div className="mb-1 flex items-center justify-between">
          <span className="dc-t-data font-medium text-slate-400">自定义条件</span>
          <label className="flex items-center gap-1 dc-t-micro text-slate-500">
            <input type="checkbox" checked={!!cond.noST} onChange={(e) => toggleFlag('noST', e.target.checked)} />
            剔 ST
          </label>
        </div>
        <div className="grid grid-cols-4 gap-1">
          <label className="block">
            <div className="mb-0.5 dc-t-micro text-slate-300">涨幅% ≥</div>
            <input value={cond.pctMin ?? ''} onChange={setNum('pctMin')} placeholder="0" className={FIELD_CLS} />
          </label>
          <label className="block">
            <div className="mb-0.5 dc-t-micro text-slate-300">涨幅% ≤</div>
            <input value={cond.pctMax ?? ''} onChange={setNum('pctMax')} placeholder="10" className={FIELD_CLS} />
          </label>
          <label className="block">
            <div className="mb-0.5 dc-t-micro text-slate-300">量比 ≥</div>
            <input value={cond.volRatioMin ?? ''} onChange={setNum('volRatioMin')} placeholder="1" className={FIELD_CLS} />
          </label>
          <label className="block">
            <div className="mb-0.5 dc-t-micro text-slate-300">换手% ≥</div>
            <input value={cond.turnoverMin ?? ''} onChange={setNum('turnoverMin')} placeholder="1" className={FIELD_CLS} />
          </label>
          <label className="block">
            <div className="mb-0.5 dc-t-micro text-slate-300">额亿 ≥</div>
            <input value={cond.amountMinYi ?? ''} onChange={setNum('amountMinYi')} placeholder="1" className={FIELD_CLS} />
          </label>
          <label className="block">
            <div className="mb-0.5 dc-t-micro text-slate-300">市值亿 ≤</div>
            <input value={cond.capMaxYi ?? ''} onChange={setNum('capMaxYi')} placeholder="不限" className={FIELD_CLS} />
          </label>
          <label className="col-span-2 block">
            <div className="mb-0.5 dc-t-micro text-slate-300">板块</div>
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
          <span className="dc-t-data font-medium text-slate-400">
            结果 · 命中 {total}（展示 {display.length}）
          </span>
          <div className="flex items-center gap-1.5">
            {signalKind && !sigRunning && (
              <span className="rounded bg-blue-50 px-1 dc-t-micro text-blue-500">{SIGNAL_META[signalKind].label} 命中 {sigHits.size}</span>
            )}
            {/* 进度可见：done/total + 百分比 + 实时命中数（照 I3：最坏 10 分钟的运行不能只有转圈） */}
            {sigRunning && (
              <>
                <span className="dc-t-micro text-slate-400" title="逐只拉 DAILY(80) 算 MA5 上穿 MA20">
                  信号分析 {sigProgress.done}/{sigProgress.total}（{sigPct}%）· 命中 {sigHits.size}
                </span>
                <button
                  type="button"
                  onClick={cancelSignals}
                  className="rounded border border-slate-200 px-1.5 py-0.5 dc-t-micro text-slate-500 hover:bg-slate-50"
                  title="立刻停止（排队中的候选不再发起请求；已在途的几只会在几秒内收尾）"
                >
                  取消
                </button>
              </>
            )}
            {results.length > 0 && !sigRunning && (
              <button
                onClick={() => void runSignals()}
                disabled={busy}
                className="rounded bg-blue-500 px-1.5 py-0.5 dc-t-micro font-medium text-white hover:bg-blue-600 disabled:opacity-40"
                title={`对候选 ${Math.min(200, results.length)} 只拉 DAILY(${SIG_BARS}) 算 MA5 上穿 MA20（约 10-40s，期间可取消）`}
              >
                {SIGNAL_META.ma_golden.label}
                {sigFail !== null || sigCancelled ? '重跑' : '分析'}
              </button>
            )}
          </div>
        </div>

        {/* 进度条：一个数字不够，"还剩多久"要看得到（宽度 = done/total） */}
        {sigRunning && (
          <div className="mb-1 h-1 w-full overflow-hidden rounded" style={{ background: 'var(--dc-track)' }}>
            <div className="h-1 rounded" style={{ width: `${sigPct}%`, background: 'var(--dc-accent)' }} />
          </div>
        )}

        {/* 逐只失败可见（I3）：旧版全吞 → 200 只全挂也显示"完成"，用户以为"没有信号" */}
        {sigFail !== null && (
          <ErrorBar
            className="mb-1.5"
            error={sigFail.reason ?? toToolError('信号分析失败（原因未记录）', null, 'kline')}
            onRetry={() => void runSignals()}
            retryLabel="重跑分析"
            title={`有 ${sigFail.failed}/${sigFail.total} 只取数失败`}
            extra={`命中的 ${sigHits.size} 只已标在下方结果里；失败的那些是"没算出来"，不等于"没有信号"。`}
          />
        )}

        {/* 取消也要说清结论边界：命中集只覆盖已算完的部分 */}
        {sigFail === null && sigCancelled && (
          <ErrorBar
            className="mb-1.5"
            error={`已取消：只算到 ${sigProgress.done}/${sigProgress.total} 只`}
            onRetry={() => void runSignals()}
            retryLabel="重新分析"
            title="信号分析已取消"
            kind="business"
            extra={`命中 ${sigHits.size} 只只覆盖已算完的 ${sigProgress.done} 只，不是全量结论。`}
          />
        )}

        {busy && <div className="py-2 text-center dc-t-data text-slate-300">全 A 快照读取/筛选中…</div>}
        {!busy && !err && total === 0 && (
          <div className="py-2 text-center dc-t-data text-slate-300">
            暂无命中（数据源休市/空返回时同样成立；先点「筛选」或选预设）
          </div>
        )}

        {!busy && display.length > 0 && (
          <div className="space-y-0.5">
            <div className="grid grid-cols-[1fr_42px_44px_38px_44px] gap-1 px-1 pb-0.5 dc-t-micro text-slate-300">
              <span>名称</span>
              <span className="text-right">涨幅</span>
              <span className="text-right">换手%</span>
              <span className="text-right">量比</span>
              <span className="text-right">额亿</span>
            </div>
            {display.map((r) => (
              <div
                key={`${r.market}${r.code}`}
                className={`grid grid-cols-[1fr_42px_44px_38px_44px] items-center gap-1 rounded px-1 py-0.5 font-mono dc-t-micro tabular-nums odd:bg-white/70 ${isHit(r) ? 'bg-amber-50' : ''}`}
              >
                <button
                  onClick={() => onOpenStock({ market: r.market, code: r.code, name: r.name })}
                  className="flex min-w-0 items-center gap-1 text-left"
                >
                  <span className="min-w-0 truncate text-slate-700 hover:text-emerald-600">{r.name}</span>
                  {isHit(r) && (
                    <span className="shrink-0 rounded bg-amber-400 px-0.5 dc-t-micro font-bold text-white">{SIGNAL_META.ma_golden.label}</span>
                  )}
                  {rankOf.get(`${r.market}${r.code}`) !== undefined && (
                    <span
                      className="shrink-0 rounded bg-emerald-500 px-0.5 dc-t-micro font-bold text-white"
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
                {/* 成交额列：表头已标"亿"，但数值直接显示会与其它页面的"万亿"口径冲突 →
                    这里保留原始数值口径，单位判断交给 fmtAmount（表头同步标注）。 */}
                <span className="text-right text-slate-400">{fmtAmount(r.amount)}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
