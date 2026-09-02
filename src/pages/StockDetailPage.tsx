import { useEffect, useMemo, useState } from 'react'
import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query'
import { KlineChart } from '@/components/KlineChart'
import { IntradayChart } from '@/components/IntradayChart'
import { StockInfoBar } from '@/components/StockInfoBar'
import { PriceLevels } from '@/components/PriceLevels'
import { InstrumentSearch } from '@/components/InstrumentSearch'
import { Watchlist } from '@/components/Watchlist'
import { AiAnalysisHost } from '@/components/AiAnalysisHost'
import { AiReportCard } from '@/components/AiReportCard'
import { api, type AiStockReport, type KlineRow, type StockLevels, type WatchlistEntry } from '@/lib/api'
import { QK } from '@/lib/queryKeys'
import { loadInfoFields, type ColumnConfig, type LevelType } from '@/lib/stock-info-fields'

/**
 * 股票工作台详情面板。
 *
 * M3：日 K + 分时 + 信息条 + 关键价位 + 标的搜索 + 自选股管理。
 * 通过 api.ts 请求后端 OpenTDX 数据。后端保持不变。
 */

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 5_000, refetchOnWindowFocus: false },
  },
})

interface PanelProps {
  symbol?: string
}

function Panel({ symbol }: PanelProps) {
  const [selectedDate, setSelectedDate] = useState<string | null>(null)
  const [rows, setRows] = useState<KlineRow[]>([])
  const [fields, setFields] = useState<ColumnConfig[]>(loadInfoFields)
  const [activeTypes, setActiveTypes] = useState<Set<LevelType>>(new Set(['sr', 'pivot', 'keltner_s']))
  const [watchlist, setWatchlist] = useState<WatchlistEntry[]>([])
  const [showWatchlist, setShowWatchlist] = useState(false)
  const [reports, setReports] = useState<AiStockReport[]>([])

  const prevClose = useMemo(() => {
    if (selectedDate) {
      const idx = rows.findIndex(r => (r.date as string).slice(0, 10) === selectedDate)
      return idx > 0 ? rows[idx - 1].close : undefined
    }
    return rows.length >= 2 ? rows[rows.length - 2].close : undefined
  }, [rows, selectedDate])

  // 日 K
  const kline = useQuery({
    queryKey: QK.kline(symbol ?? '', getDefaultRange().start, getDefaultRange().end),
    queryFn: () => api.klineDaily(symbol ?? '', 250, getDefaultRange()),
    enabled: !!symbol,
    placeholderData: (prev) => prev,
  })

  // 关键价位
  const levels = useQuery({
    queryKey: QK.stockLevels(symbol ?? ''),
    queryFn: () => api.stockAnalysisLevels(symbol ?? '', 250),
    enabled: !!symbol,
  })

  // 自选股
  const wl = useQuery({
    queryKey: QK.watchlist,
    queryFn: () => api.watchlistList(),
  })

  // AI 分析报告历史
  const reportsQ = useQuery({
    queryKey: QK.analysisReports,
    queryFn: () => api.stockAnalysisReportsList(),
  })

  useEffect(() => {
    if (reportsQ.data) setReports(reportsQ.data.reports)
  }, [reportsQ.data])

  // 选中某日时自动加载该日分时
  const minute = useQuery({
    queryKey: QK.klineMinute(symbol ?? '', selectedDate ?? ''),
    queryFn: () => api.klineMinute(symbol ?? '', selectedDate ?? undefined),
    enabled: !!symbol && !!selectedDate,
  })

  useEffect(() => {
    setSelectedDate(null)
  }, [symbol])

  useEffect(() => {
    if (wl.data) setWatchlist(wl.data.symbols)
  }, [wl.data])

  const stockInfo = kline.data?.stock_info
  const displayName = stockInfo?.name ?? kline.data?.name
  const isWatched = !!symbol && watchlist.some(w => w.symbol === symbol)

  const toggleWatchlist = async () => {
    if (!symbol) return
    if (isWatched) {
      await api.watchlistRemove(symbol)
      setWatchlist(prev => prev.filter(w => w.symbol !== symbol))
    } else {
      await api.watchlistAdd(symbol)
      setWatchlist(prev => [...prev, { symbol, added_at: new Date().toISOString() }])
    }
  }

  if (!symbol) {
    return <div className="flex h-full items-center justify-center text-sm text-slate-400">请选择标的</div>
  }

  return (
    <div className="flex flex-col gap-3">
      {/* 信息条 */}
      <StockInfoBar
        symbol={symbol}
        name={displayName}
        stockInfo={stockInfo}
        rows={kline.data?.rows ?? []}
        fields={fields}
        onFieldsChange={setFields}
        onMonitor={() => alert('加监控功能待 M4 接入')}
        inWatchlist={isWatched}
        onToggleWatchlist={toggleWatchlist}
      />

      {/* 图表区 */}
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <KlineChart
            symbol={symbol}
            height={420}
            onDataChange={setRows}
            onCross={(r) => {
              const d = r?.date as string | undefined
              if (d) setSelectedDate(d.slice(0, 10))
            }}
          />
        </div>

        {/* 右侧：关键价位 + 自选股 */}
        <div className="lg:col-span-1 space-y-3">
          <div className="rounded-lg border border-slate-200 p-3">
            <h3 className="mb-2 text-sm font-medium text-slate-700">关键价位分析</h3>
            {levels.isLoading ? (
              <div className="text-xs text-slate-400 py-4">加载中…</div>
            ) : levels.isError ? (
              <div className="text-xs text-red-500 py-4">加载失败</div>
            ) : (
              <PriceLevels
                levels={levels.data?.levels as Record<LevelType, NonNullable<StockLevels['levels']>[LevelType]> ?? {}}
                close={levels.data?.close ?? (kline.data?.rows.length ? Number(kline.data.rows[kline.data.rows.length - 1].close) : null)}
                activeTypes={activeTypes}
                onToggleType={(t) => setActiveTypes(prev => {
                  const next = new Set(prev)
                  if (next.has(t)) { next.delete(t) } else { next.add(t) }
                  return next
                })}
              />
            )}
          </div>

          <div className="rounded-lg border border-slate-200 p-3">
            <button
              onClick={() => setShowWatchlist(v => !v)}
              className="flex w-full items-center justify-between text-sm font-medium text-slate-700"
            >
              <span>自选股 ({watchlist.length})</span>
              <span className="text-xs text-slate-400">{showWatchlist ? '收起' : '展开'}</span>
            </button>
            {showWatchlist && (
              <div className="mt-2">
                <Watchlist
                  symbols={watchlist.map(w => w.symbol)}
                  onRemove={(s) => setWatchlist(prev => prev.filter(w => w.symbol !== s))}
                  onClear={() => setWatchlist([])}
                />
              </div>
            )}
          </div>

          {/* AI 四维分析 */}
          <div className="rounded-lg border border-slate-200 p-3">
            <AiAnalysisHost
              symbol={symbol}
              name={displayName ?? ''}
              onReportAdded={(r) => setReports(prev => [r, ...prev])}
            />
          </div>
        </div>
      </div>

      {/* 分时图 */}
      {selectedDate && (
        <div className="rounded-lg border border-slate-200 p-3">
          <h3 className="mb-2 text-xs font-medium text-slate-500">分时 · {selectedDate}</h3>
          <IntradayChart symbol={symbol} date={selectedDate} height={240} prevClose={prevClose} />
          {minute.isLoading && <div className="text-xs text-slate-400 py-1">分时加载中…</div>}
        </div>
      )}

      {/* AI 分析报告历史 */}
      {reports.length > 0 && (
        <div className="space-y-2">
          <h3 className="text-xs font-medium text-slate-500">历史分析报告 ({reports.length})</h3>
          {reports.map((r) => (
            <AiReportCard key={r.id} report={r} onDelete={(id) => setReports(prev => prev.filter(x => x.id !== id))} />
          ))}
        </div>
      )}
    </div>
  )
}

function getDefaultRange(): { start: string; end: string } {
  const end = new Date()
  const start = new Date()
  start.setMonth(start.getMonth() - 6)
  return { start: start.toISOString().slice(0, 10), end: end.toISOString().slice(0, 10) }
}

/** 标的搜索（M3：后端搜索下拉） */
function SymbolSearch({ symbol, onSymbolChange }: { symbol: string; onSymbolChange: (s: string) => void }) {
  return (
    <InstrumentSearch
      initialSymbol={symbol}
      onSelect={(s) => onSymbolChange(s)}
    />
  )
}

/** 外层包装：注入 QueryClient */
export function StockDetailPage(props: PanelProps) {
  const [symbol, setSymbol] = useState(props.symbol ?? '')

  useEffect(() => {
    setSymbol(props.symbol ?? '')
  }, [props.symbol])

  return (
    <QueryClientProvider client={queryClient}>
      <div data-symbol-target="" data-symbol={symbol} className="dsh-plugin h-full w-full overflow-auto">
        <div className="mx-auto min-h-full max-w-6xl flex-col p-4" style={{ display: 'flex' }}>
          <header className="mb-2 flex items-center gap-3 border-b border-slate-200 pb-3">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" className="text-emerald-600">
              <path d="M3 17l6-6 4 4 8-8" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
              <path d="M21 7v6h-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            <div>
              <h1 className="text-base font-semibold">A股量化工作台</h1>
              <p className="text-xs text-slate-500">M3 · 日 K + 分时 + 信息条 + 关键价位 + 自选</p>
            </div>
            {symbol && (
              <span className="rounded bg-slate-100 px-2 py-0.5 text-xs font-mono text-slate-600">{symbol}</span>
            )}
          </header>
          <main className="flex-1">
            <div className="mb-2 flex items-center gap-3">
              <span className="text-xs text-slate-400">标的：</span>
              <SymbolSearch symbol={symbol} onSymbolChange={setSymbol} />
            </div>
            <Panel symbol={symbol} />
          </main>
        </div>
      </div>
    </QueryClientProvider>
  )
}
