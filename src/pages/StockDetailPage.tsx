import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { api, type AiStockReport, type KlineRow } from '@/lib/api'
import { InstrumentSearch } from '@/components/InstrumentSearch'
import { KlineChart } from '@/components/KlineChart'
import { StockIntraday } from '@/components/StockIntraday'
import { StockTransactions } from '@/components/StockTransactions'
import { StockInfoBar } from '@/components/StockInfoBar'
import { PriceLevels } from '@/components/PriceLevels'
import { AiAnalysisHost } from '@/components/AiAnalysisHost'
import { AiReportCard } from '@/components/AiReportCard'
import { StockAuctionReview } from '@/components/StockAuctionReview'
import { StockCapitalFlow } from '@/components/StockCapitalFlow'
import type { ColumnConfig, LevelType, StockLevels } from '@/lib/stock-info-fields'
import { BUILTIN_INFO_FIELDS, loadInfoFields, saveInfoFields } from '@/lib/stock-info-fields'
import { fmtPrice } from '@/lib/format'
import { parseSymbol } from '@/lib/symbol'
import { fetchQuote, fetchTransactions } from '@/lib/stock-data'
import { useSwr, swrKey } from '@/lib/cache'
import { computeChipsFromRows, computeChipsWithTicks, type ChipsResult } from '@/lib/chips'
import { useWatchlist } from '@/lib/watchlist-store'
import type { OpenStock } from '@/panel/PanelApp'

/**
 * 股票工作台个股详情页（M9/W3 版）。
 *
 * 布局（自上而下，适配右侧窄列）：
 *   1. 顶栏：标的搜索 + 现价 + 加自选星标
 *   2. 信息条：自定义指标（市值/换手/振幅…）
 *   3. 图表卡：日K（区间：近3月/6月/1年/全部 + MA5/10/20 开关）｜ 分时（tick_chart）
 *   4. 竞价回顾（当日）+ 资金面板（当日/5 日，N7）+ 逐笔成交（折叠，M9）
 *   5. AI 四维分析（流式）+ 报告历史
 *
 * 数据源：日K/分时/逐笔/报价/搜索全部直连 MCP（api.ts 适配层，无后端可用）；
 * 关键价位（levels）仍依赖 FastAPI 后端（B 轨，MCP 模式隐藏）；AI 四维分析已改为
 * 「对话联动」（host 半注册 stock_quote/stock_kline 等工具，见 AiAnalysisHost）。
 */

/** 日 K 区间（天数为交易日根数；默认近6月 = 初始拉取根数一致，避免重复取数）。 */
const RANGES: { key: string; label: string; days: number }[] = [
  { key: '3月', label: '3月', days: 66 },
  { key: '6月', label: '6月', days: 120 },
  { key: '1年', label: '1年', days: 250 },
  { key: '全部', label: '全部', days: 1000 },
]

interface State {
  symbol: string
  name: string
  rows: KlineRow[]
  stockInfo?: { name?: string; total_shares?: number; float_shares?: number; ext?: Record<string, unknown> }
  levels: StockLevels | null
  fields: ColumnConfig[]
}

const EMPTY: State = { symbol: '', name: '', rows: [], levels: null, fields: BUILTIN_INFO_FIELDS }

interface Props {
  /** 由面板壳传入的要打开的标的（市场页/自选页点击）。 */
  open?: OpenStock | null
  /** 提供时显示 ‹ 返回（回上一个 Tab）。 */
  onBack?: () => void
}

export function StockDetailPage({ open, onBack }: Props) {
  const [state, setState] = useState<State>({ ...EMPTY, fields: loadInfoFields() })
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [reports, setReports] = useState<AiStockReport[]>([])
  const cancelledRef = useRef(false)
  const { items: watchlist, toggle: toggleWatch, isWatched } = useWatchlist()

  // M9：图表卡状态（模式 / 区间 / MA 开关 / 区间取数忙）
  const [chartMode, setChartMode] = useState<'day' | 'min'>('day')
  const [rangeKey, setRangeKey] = useState('6月')
  const [showMA, setShowMA] = useState(true)
  const [chartBusy, setChartBusy] = useState(false)
  /** 当前 rows 对应根数（初始 120=近6月；与 RANGES 对齐避免重复取数）。 */
  const rowsDaysRef = useRef(120)

  // 持久化信息条字段偏好
  useEffect(() => {
    saveInfoFields(state.fields)
  }, [state.fields])

  // 组件卸载时取消未完成的加载
  useEffect(() => {
    cancelledRef.current = false
    return () => {
      cancelledRef.current = true
    }
  }, [])

  const loadSymbol = useCallback((symbol: string, fallbackName?: string) => {
    if (!symbol) return
    setLoading(true)
    setError('')
    setChartMode('day')
    setRangeKey('6月')
    setShowMA(true)
    setChartBusy(false)
    rowsDaysRef.current = 120
    const p = parseSymbol(symbol)
    const full = p ? `${p.market}${p.code}` : symbol
    Promise.allSettled([
      api.klineDaily(full, 120),
      api.stockAnalysisLevels(full, 120),
      p ? fetchQuote(p.market, p.code) : Promise.resolve(null),
    ]).then(([kRes, lRes, qRes]) => {
      if (cancelledRef.current) return
      const rows: KlineRow[] =
        kRes.status === 'fulfilled' ? (kRes.value as { rows: KlineRow[] }).rows : []
      const levels =
        lRes.status === 'fulfilled' ? (lRes.value as StockLevels) : null
      if (!rows.length) {
        setError('暂无该标的 K 线数据')
      }
      const quoteName = qRes.status === 'fulfilled' && qRes.value ? qRes.value.name : undefined
      const lastRowName = rows.length ? (rows[rows.length - 1].name ?? undefined) : undefined
      setState((s) => ({
        ...s,
        symbol: full,
        name: quoteName || fallbackName || lastRowName || s.name || full,
        rows,
        stockInfo:
          kRes.status === 'fulfilled'
            ? (kRes.value as { stock_info?: State['stockInfo'] }).stock_info
            : undefined,
        levels,
      }))
      setLoading(false)
    })
  }, [])

  // open 变化 → 加载标的
  useEffect(() => {
    if (open?.code) {
      loadSymbol(`${open.market}${open.code}`, open.name)
    }
  }, [open, loadSymbol])

  const handleSelect = useCallback(
    (symbol: string) => {
      loadSymbol(symbol)
    },
    [loadSymbol],
  )

  const latestClose = useMemo(() => {
    const latest = state.rows[state.rows.length - 1]
    return latest ? Number(latest.close) : 0
  }, [state.rows])

  // M9：日 K 区间切换 → 按需重取（根数与当前 rows 一致则跳过；失败保留旧数据）。
  useEffect(() => {
    if (!state.symbol || chartMode !== 'day') return
    const cfg = RANGES.find((r) => r.key === rangeKey)
    if (!cfg || cfg.days === rowsDaysRef.current) {
      setChartBusy(false)
      return
    }
    let cancelled = false
    setChartBusy(true)
    api
      .klineDaily(state.symbol, cfg.days)
      .then((res) => {
        if (cancelled) return
        const next = (res as { rows: KlineRow[] }).rows
        rowsDaysRef.current = cfg.days
        setState((s) => ({ ...s, rows: next }))
      })
      .catch(() => {
        /* 数据源异常：保留旧区间数据，不打断浏览 */
      })
      .finally(() => {
        if (!cancelled) setChartBusy(false)
      })
    return () => {
      cancelled = true
    }
  }, [state.symbol, chartMode, rangeKey])

  // 分时基线：最近一根日 K 的交易日 + 前一交易日收盘（昨收虚线）。
  const minBase = useMemo(() => {
    if (state.rows.length < 1) return null
    const last = state.rows[state.rows.length - 1]
    const prev = state.rows.length >= 2 ? state.rows[state.rows.length - 2] : null
    return {
      baseDate: String(last.date).slice(0, 10),
      prevClose: prev ? Number(prev.close) || 0 : 0,
    }
  }, [state.rows])

  // N7：个股级竞价回顾 / 资金面板的标的
  const symParts = useMemo(() => (state.symbol ? parseSymbol(state.symbol) : null), [state.symbol])

  // ===== 筹码分布（L0 日K 秒算 → L1 当日逐笔异步升级）=====
  const chipEndDate = useMemo(
    () => (state.rows.length ? String(state.rows[state.rows.length - 1].date).slice(0, 10) : ''),
    [state.rows],
  )
  const chipTicksKey =
    chartMode === 'day' && symParts && state.rows.length && chipEndDate && latestClose > 0
      ? swrKey.chipsTicks(symParts.market, symParts.code, chipEndDate)
      : ''
  const chipTicksSwr = useSwr(
    chipTicksKey || 'swr:chips:off',
    () =>
      symParts ? fetchTransactions(symParts.market, symParts.code, 4000) : Promise.resolve([]),
    { ttl: 60_000, enabled: chipTicksKey !== '' },
  )
  /** L0：纯日K 三角衰减（秒出，覆盖度不足/逐笔未回时即为最终值）。 */
  const chipsBase = useMemo<ChipsResult | null>(() => {
    if (chartMode !== 'day' || !state.rows.length || latestClose <= 0) return null
    try {
      return computeChipsFromRows(state.rows, state.rows.length - 1, latestClose)
    } catch {
      return null
    }
  }, [chartMode, state.rows, latestClose])
  /** L1：当日逐笔修正；逐笔未回/过少则回落 L0。 */
  const chips = useMemo<ChipsResult | null>(() => {
    if (!chipsBase || chipTicksKey === '') return chipsBase
    const ticks = chipTicksSwr.data
    if (!ticks || ticks.length < 50) return chipsBase
    try {
      return computeChipsWithTicks(state.rows, state.rows.length - 1, ticks, latestClose)
    } catch {
      return chipsBase
    }
  }, [chipsBase, chipTicksSwr.data, state.rows, latestClose, chipTicksKey])

  const activeLevelTypes = useMemo(() => {
    if (!state.levels) return new Set<LevelType>()
    return new Set<LevelType>(Object.keys(state.levels.levels) as LevelType[])
  }, [state.levels])

  const watched = state.symbol ? isWatchedByParts(state.symbol) : false
  function isWatchedByParts(symbol: string): boolean {
    const p = parseSymbol(symbol)
    return p ? isWatched(p.market, p.code) : false
  }

  const handleStar = useCallback(() => {
    if (!state.symbol) return
    const p = parseSymbol(state.symbol)
    if (p) toggleWatch({ market: p.market, code: p.code, name: state.name || p.code })
  }, [state.symbol, state.name, toggleWatch])

  const handleReportAdded = useCallback((report: AiStockReport) => {
    setReports((prev) => [report, ...prev])
  }, [])

  const handleReportDelete = useCallback((id: string) => {
    setReports((prev) => prev.filter((r) => r.id !== id))
  }, [])

  const handleFieldsChange = useCallback((fields: ColumnConfig[]) => {
    setState((s) => ({ ...s, fields }))
  }, [])

  // 空态：还没有标的（理论上由壳层拦截，这里兜底）
  if (!state.symbol && !loading && !open?.code) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 bg-white px-6 text-center">
        <div className="text-3xl">🔍</div>
        <div className="text-xs text-slate-400">搜索或从市场/自选选择一个标的</div>
      </div>
    )
  }

  return (
    <div className="flex h-full w-full flex-col overflow-hidden bg-white text-slate-800">
      <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-3">
        {/* 顶栏（吸顶）：返回 + 搜索 + 星标 / 名称 + 现价 */}
        <div className="ds-sticky-head -mx-3 mb-1.5 flex flex-col gap-1 border-b border-slate-100 px-3 pb-2 pt-2">
          <div className="flex items-center gap-1.5">
            {onBack && (
              <button
                onClick={onBack}
                className="flex h-6 w-6 shrink-0 items-center justify-center rounded text-slate-400 hover:bg-slate-100 hover:text-slate-600"
                title="返回"
              >
                ‹
              </button>
            )}
            <div className="min-w-0 flex-1">
              <InstrumentSearch onSelect={handleSelect} initialSymbol={state.symbol} className="w-full" />
            </div>
            {state.symbol && (
              <button
                onClick={handleStar}
                className={`flex h-6 w-6 shrink-0 items-center justify-center rounded text-sm ${watched ? 'text-yellow-500' : 'text-slate-300 hover:bg-slate-100 hover:text-slate-500'}`}
                title={watched ? '移出自选' : '加自选'}
              >
                ⭐
              </button>
            )}
          </div>
          {(state.name || latestClose > 0) && (
            <div className="flex items-baseline justify-between gap-2">
              <span className="min-w-0 truncate text-[12px] font-medium text-slate-500">
                {state.name}
                {state.symbol && <span className="ml-1 font-mono text-[10px] text-slate-300">{state.symbol}</span>}
              </span>
              {latestClose > 0 && (
                <span className="shrink-0 text-[15px] font-bold tabular-nums text-red-600">{fmtPrice(latestClose)}</span>
              )}
            </div>
          )}
        </div>

        {error && <div className="mb-1.5 rounded bg-red-50 px-3 py-2 text-xs text-red-500">{error}</div>}

        {/* 信息条 */}
        {state.rows.length > 0 && (
          <StockInfoBar
            symbol={state.symbol}
            name={state.name}
            stockInfo={state.stockInfo}
            rows={state.rows}
            fields={state.fields}
            onFieldsChange={handleFieldsChange}
            inWatchlist={watched}
            onToggleWatchlist={handleStar}
          />
        )}

        {/* M9：图表卡（日K：区间 + MA 开关；分时） */}
        {state.symbol && (
          <div className="mt-1.5 rounded-lg border border-slate-100 bg-slate-50/40 p-1.5">
            <div className="mb-1 flex items-center gap-1">
              <button
                onClick={() => setChartMode('day')}
                className={`rounded px-1.5 py-0.5 text-[9px] font-medium ${chartMode === 'day' ? 'bg-emerald-500 text-white' : 'bg-white text-slate-400'}`}
              >
                日K
              </button>
              <button
                onClick={() => setChartMode('min')}
                disabled={!minBase}
                className={`rounded px-1.5 py-0.5 text-[9px] font-medium ${chartMode === 'min' ? 'bg-emerald-500 text-white' : 'bg-white text-slate-400 disabled:opacity-40'}`}
                title={minBase ? '当日/最近交易日分时' : '暂无日K数据，分时不可用'}
              >
                分时
              </button>
              {chartMode === 'day' && (
                <button
                  onClick={() => setShowMA((v) => !v)}
                  className={`ml-auto rounded px-1.5 py-0.5 text-[9px] font-medium ${showMA ? 'bg-blue-50 text-blue-500' : 'bg-white text-slate-300'}`}
                  title="MA5/10/20 均线叠加开关"
                >
                  MA {showMA ? '开' : '关'}
                </button>
              )}
            </div>
            {chartMode === 'day' && (
              <div className="mb-1 flex items-center gap-0.5">
                {RANGES.map((r) => (
                  <button
                    key={r.key}
                    onClick={() => setRangeKey(r.key)}
                    className={`rounded px-1 py-px font-mono text-[9px] ${rangeKey === r.key ? 'bg-emerald-100 text-emerald-600' : 'text-slate-400 hover:bg-white'}`}
                  >
                    {r.label}
                  </button>
                ))}
                {chartBusy && <span className="ml-auto text-[9px] text-slate-300">取数中…</span>}
              </div>
            )}
            {loading && !state.rows.length ? (
              <div className="flex h-64 items-center justify-center text-sm text-slate-400">K 加载中…</div>
            ) : chartMode === 'day' ? (
              state.rows.length ? (
                <KlineChart
                  symbol={state.symbol}
                  height={280}
                  rows={state.rows}
                  showMA={showMA}
                  chips={chips}
                  chipsLoading={chipTicksSwr.status === 'loading'}
                />
              ) : (
                <div className="flex h-64 items-center justify-center text-[11px] text-slate-300">暂无历史 K 线数据</div>
              )
            ) : minBase && symParts ? (
              <StockIntraday
                key={state.symbol}
                market={symParts.market}
                code={symParts.code}
                baseDate={minBase.baseDate}
                prevClose={minBase.prevClose}
                height={280}
              />
            ) : (
              <div className="flex h-64 items-center justify-center text-[11px] text-slate-300">暂无日K数据，分时不可用</div>
            )}
          </div>
        )}

        {/* 关键价位 */}
        {state.levels && (
          <div className="mt-2.5">
            <h3 className="mb-1.5 text-xs font-medium text-slate-500">关键价位</h3>
            <PriceLevels levels={state.levels.levels} close={latestClose} activeTypes={activeLevelTypes} />
          </div>
        )}

        {/* N7/M9：竞价回顾（当日）+ 资金面板（当日/5日）+ 逐笔成交（折叠） */}
        {symParts && (
          <div className="mt-2.5 space-y-1.5">
            <StockAuctionReview key={state.symbol} market={symParts.market} code={symParts.code} />
            <StockCapitalFlow key={state.symbol} market={symParts.market} code={symParts.code} />
            <StockTransactions key={state.symbol} market={symParts.market} code={symParts.code} />
          </div>
        )}

        {/* AI 四维分析 */}
        {state.symbol && (
          <div className="mt-2.5">
            <AiAnalysisHost symbol={state.symbol} name={state.name} onReportAdded={handleReportAdded} />
          </div>
        )}

        {/* 报告历史 */}
        {reports.length > 0 && (
          <div className="mt-2.5 space-y-2">
            <h3 className="text-xs font-medium text-slate-500">分析报告</h3>
            {reports.map((r) => (
              <AiReportCard key={r.id} report={r} onDelete={handleReportDelete} />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
