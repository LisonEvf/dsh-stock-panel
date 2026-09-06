import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { api, type AiStockReport, type KlineRow } from '@/lib/api'
import { InstrumentSearch } from '@/components/InstrumentSearch'
import { KlineChart } from '@/components/KlineChart'
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
import { fetchQuote } from '@/lib/stock-data'
import { useWatchlist } from '@/lib/watchlist-store'
import type { OpenStock } from '@/panel/PanelApp'

/**
 * 股票工作台个股详情页（N7 版）。
 *
 * 布局（自上而下，适配右侧窄列）：
 *   1. 顶栏：标的搜索 + 现价 + 加自选星标
 *   2. 信息条：自定义指标（市值/换手/振幅…）
 *   3. 日 K 图（lightweight-charts；受控 rows，由本页一次性拉取）
 *   4. 竞价回顾（当日）+ 资金面板（当日/5 日，N7）
 *   5. AI 四维分析（流式）+ 报告历史
 *
 * 数据源（api.ts 适配层）：日 K/报价/搜索默认走 MCP 数据源（无后端可用）；
 * 关键价位（levels）与 AI 四维分析仍依赖 FastAPI 后端（B 轨）——MCP 模式下
 * 价位区块隐藏、AI 区块报错提示，均为预期降级。
 */

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

  // N7：个股级竞价回顾 / 资金面板的标的
  const symParts = useMemo(() => (state.symbol ? parseSymbol(state.symbol) : null), [state.symbol])

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

        {/* 日 K 图 */}
        {state.symbol && (
          <div className="mt-1.5 rounded-lg border border-slate-100 bg-slate-50/40 p-1.5">
            {loading ? (
              <div className="flex h-64 items-center justify-center text-sm text-slate-400">K 加载中…</div>
            ) : (
              <KlineChart
                symbol={state.symbol}
                height={300}
                rows={state.rows}
              />
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

        {/* N7：竞价回顾（当日）+ 资金面板（当日/5日，仅方向确认） */}
        {symParts && (
          <div className="mt-2.5 space-y-1.5">
            <StockAuctionReview key={state.symbol} market={symParts.market} code={symParts.code} />
            <StockCapitalFlow key={state.symbol} market={symParts.market} code={symParts.code} />
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
