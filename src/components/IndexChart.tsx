/**
 * 指数图表（M5）：lightweight-charts 实现，适配窄列。
 *
 * 两种模式（右上角切换）：
 *   - 日K：K 线 + MA5/10/20 + 成交量（A 股配色：红涨绿跌）
 *   - 分时：价格线 + 均价线 + 昨收虚线（基线日期取最近一根日 K 的交易日）
 *
 * 数据直连 MCP：kline(DAILY) / tick_chart。
 *
 * 主题：图表参数与色值**只从 `lib/chart-theme` 来**（本文件不再内联 createChart 主题参数，
 * 也不再写色值常量），宿主切明暗时由 `subscribeChartTheme` 触发按新色重画。
 * 可视范围在每次数据到位后按**实际根数**定尺，不允许出现大片空白。
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import {
  createChart,
  LineStyle,
  type IChartApi,
  type IPriceLine,
  type ISeriesApi,
  type UTCTimestamp,
} from 'lightweight-charts'
import { fetchKlineRows, fetchTickRows, type McpKlineRow, type TickRow } from '@/lib/stock-data'
import type { MarketTag } from '@/lib/symbol'
import {
  CHART_OVERLAY_CLASS,
  CHART_OVERLAY_STYLE,
  INTRADAY_AVG_COLOR,
  INTRADAY_PRICE_COLOR,
  MA_PERIODS,
  addVolumeSeries,
  baseChartOptions,
  candleSeriesOptions,
  chartColors,
  createRangeFitter,
  maLineOptions,
  subscribeChartTheme,
  volumeBarColors,
  type RangeFitter,
} from '@/lib/chart-theme'

export type IndexChartMode = 'day' | 'min'

/** 副图量/额切换（成交额补充）。 */
type SubMetric = 'vol' | 'amount'

/**
 * 一屏数据的"未染色"形态。
 * 为什么存形态而不是直接存序列数据：量柱是**逐柱着色**，切主题必须重 `setData`，
 * 所以颜色留到绘制时现取（`paint`），这里只存与主题无关的原值。
 */
type ChartShape =
  | {
      kind: 'day'
      candles: { time: string; open: number; high: number; low: number; close: number }[]
      ma: Map<number, { time: string; value: number }[]>
      vols: { time: string; value: number; isUp: boolean }[]
    }
  | {
      kind: 'min'
      price: { time: UTCTimestamp; value: number }[]
      avg: { time: UTCTimestamp; value: number }[]
    }

interface Props {
  market: MarketTag
  code: string
  name: string
  height?: number
}

function fmtDay(dt: string): string {
  return dt.slice(0, 10)
}

/** 计算 MA(n)：不足 n 根时该点为 null。 */
function maValues(rows: McpKlineRow[], n: number): ({ time: string; value: number } | null)[] {
  return rows.map((_, i) => {
    if (i < n - 1) return null
    let sum = 0
    for (let j = i - n + 1; j <= i; j++) sum += rows[j].close
    return { time: fmtDay(rows[i].datetime), value: sum / n }
  })
}

/** 日 K 形态：蜡烛 + MA + 量柱（量柱只记涨跌，颜色由主题决定）。 */
function buildDayShape(klines: McpKlineRow[], metric: SubMetric): ChartShape {
  const candles = klines
    .filter((r) => Number.isFinite(r.open) && Number.isFinite(r.close))
    .map((r) => ({ time: fmtDay(r.datetime), open: r.open, high: r.high, low: r.low, close: r.close }))
  const ma = new Map<number, { time: string; value: number }[]>()
  for (const n of MA_PERIODS) {
    ma.set(n, maValues(klines, n).filter((x): x is { time: string; value: number } => x !== null))
  }
  const vols: { time: string; value: number; isUp: boolean }[] = []
  for (const r of klines) {
    const v = metric === 'amount' ? Number(r.amount ?? 0) : Number(r.vol ?? r.volume ?? 0)
    if (!Number.isFinite(v)) continue
    vols.push({ time: fmtDay(r.datetime), value: v, isUp: r.close >= r.open })
  }
  return { kind: 'day', candles, ma, vols }
}

/** 分时形态：现价/均价折线（昨收虚线在数据到位后单独挂）。 */
function buildMinShape(ticks: TickRow[], baseDate: string): ChartShape {
  const dayMs = new Date(`${baseDate}T00:00:00`).getTime()
  const price: { time: UTCTimestamp; value: number }[] = []
  const avg: { time: UTCTimestamp; value: number }[] = []
  for (const t of ticks) {
    const [h, m, s] = t.time.split(':').map(Number)
    if (!Number.isFinite(h)) continue
    const ts = (dayMs + h * 3600_000 + m * 60_000 + (s || 0) * 1000) / 1000
    price.push({ time: ts as UTCTimestamp, value: t.price })
    if (Number.isFinite(t.avg)) avg.push({ time: ts as UTCTimestamp, value: t.avg })
  }
  return { kind: 'min', price, avg }
}

/** 一屏数据的指纹（模式 + 点数 + 首末时间）：给 RangeFitter 判"是不是同一份数据"。 */
function shapeSignature(shape: ChartShape): string {
  if (shape.kind === 'day') {
    const first = shape.candles[0]
    const last = shape.candles[shape.candles.length - 1]
    return `day:${shape.candles.length}:${first?.time ?? ''}:${last?.time ?? ''}`
  }
  const first = shape.price[0]
  const last = shape.price[shape.price.length - 1]
  return `min:${shape.price.length}:${first?.time ?? ''}:${last?.time ?? ''}`
}

export function IndexChart({ market, code, name, height = 320 }: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const chartRef = useRef<IChartApi | null>(null)
  const candleRef = useRef<ISeriesApi<'Candlestick'> | null>(null)
  const volRef = useRef<ISeriesApi<'Histogram'> | null>(null)
  const maRef = useRef<Map<number, ISeriesApi<'Line'>> | null>(null)
  const priceRef = useRef<ISeriesApi<'Line'> | null>(null)
  const avgRef = useRef<ISeriesApi<'Line'> | null>(null)
  const baselineRef = useRef<IPriceLine | null>(null)
  const fitterRef = useRef<RangeFitter | null>(null)
  /** 当前屏幕上的数据形态：主题切换时按新色重画。 */
  const shapeRef = useRef<ChartShape | null>(null)
  const klineCacheRef = useRef<{ key: string; rows: McpKlineRow[] } | null>(null)
  const [mode, setMode] = useState<IndexChartMode>('day')
  const [metric, setMetric] = useState<SubMetric>('vol')
  const [status, setStatus] = useState<'loading' | 'ok' | 'error' | 'empty'>('loading')
  const [error, setError] = useState('')

  /** 把一屏数据画上去：配色现取主题，所以主题切换后重跑一次就能换色。 */
  const paint = useCallback((shape: ChartShape) => {
    if (shape.kind === 'day') {
      candleRef.current?.setData(shape.candles)
      for (const [n, data] of shape.ma) maRef.current?.get(n)?.setData(data)
      const vol = volRef.current
      if (vol) {
        const c = volumeBarColors()
        vol.setData(shape.vols.map((v) => ({ time: v.time, value: v.value, color: v.isUp ? c.up : c.down })))
      }
    } else {
      priceRef.current?.setData(shape.price)
      avgRef.current?.setData(shape.avg)
      baselineRef.current?.applyOptions({ color: chartColors().baseline })
    }
    shapeRef.current = shape
    // 可视范围：按**实际点数**定尺（日K/分时来回切、区间变化后都不留大片空白）
    const bars = shape.kind === 'day' ? shape.candles.length : shape.price.length
    fitterRef.current?.sync(bars, shapeSignature(shape))
    setStatus(bars > 0 ? 'ok' : 'empty')
    setError('')
  }, [])

  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    let cancelled = false
    setStatus('loading')
    setError('')

    // 主题参数只从 chart-theme 来（分时模式要显示"时分"，日 K 保持默认）
    const chart = createChart(el, {
      ...baseChartOptions({ timeVisible: mode === 'min' }),
      width: el.clientWidth,
      height,
    })
    chartRef.current = chart
    fitterRef.current = createRangeFitter(chart)

    // 先按模式把序列骨架建好：paint 只负责填数据与配色，省掉"数据到了才建序列"的分支
    if (mode === 'day') {
      candleRef.current = chart.addCandlestickSeries(candleSeriesOptions())
      const ma = new Map<number, ISeriesApi<'Line'>>()
      for (const n of MA_PERIODS) ma.set(n, chart.addLineSeries(maLineOptions(n)))
      maRef.current = ma
      volRef.current = addVolumeSeries(chart)
    } else {
      priceRef.current = chart.addLineSeries({
        color: INTRADAY_PRICE_COLOR,
        lineWidth: 2,
        priceLineVisible: false,
        crosshairMarkerRadius: 2,
      })
      avgRef.current = chart.addLineSeries({
        color: INTRADAY_AVG_COLOR,
        lineWidth: 1,
        priceLineVisible: false,
        crosshairMarkerVisible: false,
      })
    }

    const ro = new ResizeObserver(() => {
      chart.resize(el.clientWidth, height)
      // 首帧宽度可能是 0（面板还没布局）→ 定尺留着 pending，宽度真实后补一次
      fitterRef.current?.onResize()
    })
    ro.observe(el)

    // 宿主切明暗 → 重套图表参数（网格/轴/十字线/标签底）+ 按新色重画序列
    const unsubTheme = subscribeChartTheme(
      chart,
      (theme) => {
        candleRef.current?.applyOptions(theme.candle)
        const shape = shapeRef.current
        if (shape !== null) paint(shape)
      },
      { timeVisible: mode === 'min' },
    )

    void (async () => {
      try {
        const cacheKey = `${market}:${code}`
        let klines = klineCacheRef.current?.key === cacheKey ? klineCacheRef.current.rows : null
        if (!klines) {
          klines = await fetchKlineRows(market, code, 'DAILY', 160)
          if (cancelled) return
          klineCacheRef.current = { key: cacheKey, rows: klines }
        }
        if (!klines.length) {
          setStatus('empty')
          return
        }
        if (mode === 'day') {
          paint(buildDayShape(klines, metric))
          return
        }
        // 分时模式：基线日期 = 最近一根日 K 的交易日；昨收 = 前一交易日收盘
        const baseDate = fmtDay(klines[klines.length - 1].datetime)
        const prevClose = klines.length >= 2 ? klines[klines.length - 2].close : klines[0].close
        const ticks: TickRow[] = await fetchTickRows(market, code, null)
        if (cancelled) return
        if (!ticks.length) {
          setStatus('empty')
          return
        }
        paint(buildMinShape(ticks, baseDate))
        // 昨收虚线：颜色取自主题 token（主题切换时由 paint 重套）
        if (Number.isFinite(prevClose) && prevClose > 0 && priceRef.current) {
          baselineRef.current = priceRef.current.createPriceLine({
            price: prevClose,
            color: chartColors().baseline,
            lineWidth: 1,
            lineStyle: LineStyle.Dashed,
            axisLabelVisible: true,
            title: '昨收',
          })
        }
      } catch (e) {
        if (!cancelled) {
          setError((e as Error).message)
          setStatus('error')
        }
      }
    })()

    return () => {
      cancelled = true
      // 顺序要紧：先退订主题再销毁图表（否则回调会打到已销毁的 chart 上）
      unsubTheme()
      ro.disconnect()
      chart.remove()
      chartRef.current = null
      candleRef.current = null
      volRef.current = null
      maRef.current = null
      priceRef.current = null
      avgRef.current = null
      baselineRef.current = null
      fitterRef.current = null
      shapeRef.current = null
    }
  }, [market, code, mode, metric, height, paint])

  const btn = (m: IndexChartMode, label: string) => (
    <button
      onClick={() => setMode(m)}
      className={`rounded px-2 py-0.5 dc-t-data font-medium transition-colors ${
        mode === m ? 'bg-emerald-500 text-white' : 'bg-slate-100 text-slate-400 hover:text-slate-600'
      }`}
    >
      {label}
    </button>
  )

  const metricBtn = (m: SubMetric, label: string) => (
    <button
      onClick={() => setMetric(m)}
      className={`rounded px-1.5 py-0.5 dc-t-micro font-medium ${
        metric === m ? 'bg-blue-50 text-blue-500' : 'text-slate-300 hover:bg-white hover:text-slate-500'
      }`}
    >
      {label}
    </button>
  )

  return (
    <div className="w-full">
      <div className="mb-1 flex items-center justify-end gap-1">
        {btn('day', '日K')}
        {btn('min', '分时')}
        {mode === 'day' && (
          <>
            <span className="mx-0.5 h-3 w-px bg-slate-200" />
            {metricBtn('vol', '量')}
            {metricBtn('amount', '额')}
          </>
        )}
      </div>
      {/* 画布容器：三态遮罩与 K 线同款（同一份 chart-theme 常量），不再出现"空白画布" */}
      <div
        ref={containerRef}
        style={{ height, position: 'relative' }}
        role="img"
        aria-label={`${name || code} ${mode === 'day' ? '日K' : '分时'}`}
      >
        {status === 'loading' && (
          <div className={CHART_OVERLAY_CLASS} style={CHART_OVERLAY_STYLE} aria-live="polite">
            {mode === 'day' ? 'K 线加载中…' : '分时加载中…'}
          </div>
        )}
        {status === 'empty' && (
          <div className={CHART_OVERLAY_CLASS} style={CHART_OVERLAY_STYLE}>
            暂无数据
          </div>
        )}
        {status === 'error' && (
          <div className={CHART_OVERLAY_CLASS} style={{ ...CHART_OVERLAY_STYLE, color: 'var(--dc-danger)' }} aria-live="polite">
            {error || '加载失败'}
          </div>
        )}
      </div>
    </div>
  )
}

export type { ISeriesApi }
