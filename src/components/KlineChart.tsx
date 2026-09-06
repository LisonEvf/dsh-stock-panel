import { useEffect, useRef, useState } from 'react'
import {
  createChart,
  ColorType,
  type IChartApi,
  type ISeriesApi,
  type LineData,
} from 'lightweight-charts'
import { api, type KlineRow } from '@/lib/api'

// A 股语义配色（MIGRATION-PLAN §7.2）：红涨 #c74040 / 绿跌 #2d9b65
const UP = '#c74040'
const DOWN = '#2d9b65'
const MA_COLORS: { n: number; color: string }[] = [
  { n: 5, color: '#f59e0b' },
  { n: 10, color: '#3b82f6' },
  { n: 20, color: '#a855f7' },
]

/** 把 KlineRow 转成 lightweight-charts v4 需要的格式。 */
function toSeriesData(rows: KlineRow[]) {
  const candlestick: { time: string; open: number; high: number; low: number; close: number }[] = []
  const volume: { time: string; value: number; color: string }[] = []
  for (const r of rows) {
    const time = (typeof r.date === 'string' ? r.date.slice(0, 10) : String(r.date)) as string
    const open = Number(r.open)
    const high = Number(r.high)
    const low = Number(r.low)
    const close = Number(r.close)
    if ([open, high, low, close].some((n) => Number.isNaN(n))) continue
    candlestick.push({ time, open, high, low, close })
    const vol = Number(r.volume ?? 0)
    if (!Number.isNaN(vol)) {
      const isUp = close >= open
      volume.push({ time, value: vol, color: isUp ? 'rgba(199,64,64,0.45)' : 'rgba(45,155,101,0.45)' })
    }
  }
  return { candlestick, volume }
}

/** MA(n)：不足 n 根时该点为 null。 */
function maValues(rows: KlineRow[], n: number): (LineData | null)[] {
  return rows.map((r, i) => {
    if (i < n - 1) return null
    let sum = 0
    for (let j = i - n + 1; j <= i; j++) sum += Number(rows[j].close) || 0
    const time = (typeof r.date === 'string' ? r.date.slice(0, 10) : String(r.date)) as string
    return { time, value: sum / n }
  })
}

interface Props {
  symbol: string
  height?: number
  className?: string
  /**
   * 受控数据：由父级一次性拉取后传入（避免组件内部重复请求）。
   * 传入（含空数组）时组件不再自行拉取；不传时退回组件内自取近 6 个月。
   */
  rows?: KlineRow[]
  /** MA5/10/20 均线叠加开关（M9）。 */
  showMA?: boolean
  onCross?: (row: KlineRow | null) => void
}

export function KlineChart({ symbol, height = 480, className, rows, showMA = false, onCross }: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const chartRef = useRef<IChartApi | null>(null)
  const candleRef = useRef<ISeriesApi<'Candlestick'> | null>(null)
  const volRef = useRef<ISeriesApi<'Histogram'> | null>(null)
  const maRef = useRef<Map<number, ISeriesApi<'Line'>> | null>(null)
  const [status, setStatus] = useState<'loading' | 'empty' | 'error' | 'ok'>('loading')
  const [error, setError] = useState<string>('')

  /** 按需创建/移除 MA 线（showMA 关时移除，避免残留叠加）。 */
  const syncMaSeries = (show: boolean) => {
    const chart = chartRef.current
    if (!chart) return
    if (show) {
      if (!maRef.current) {
        const m = new Map<number, ISeriesApi<'Line'>>()
        for (const { n, color } of MA_COLORS) {
          const line = chart.addLineSeries({
            color,
            lineWidth: 1,
            priceLineVisible: false,
            lastValueVisible: false,
            crosshairMarkerVisible: false,
          })
          m.set(n, line)
        }
        maRef.current = m
      }
    } else if (maRef.current) {
      for (const line of maRef.current.values()) {
        chart.removeSeries(line)
      }
      maRef.current = null
    }
  }

  // 首次装载：创建图表 + K 线 + 量柱（各只创建一次）。
  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const chart = createChart(el, {
      layout: {
        background: { type: ColorType.Solid, color: 'transparent' },
        textColor: '#94a3b8',
        fontSize: 10,
      },
      grid: {
        vertLines: { color: 'rgba(148,163,184,0.10)' },
        horzLines: { color: 'rgba(148,163,184,0.10)' },
      },
      width: el.clientWidth,
      height,
      rightPriceScale: { visible: true, borderColor: 'rgba(148,163,184,0.2)' },
      timeScale: { borderColor: 'rgba(148,163,184,0.2)' },
      crosshair: {
        vertLine: { color: 'rgba(148,163,184,0.4)', labelBackgroundColor: '#64748b' },
        horzLine: { color: 'rgba(148,163,184,0.4)', labelBackgroundColor: '#64748b' },
      },
    })
    chartRef.current = chart

    const candle = chart.addCandlestickSeries({
      upColor: UP,
      downColor: DOWN,
      borderUpColor: UP,
      borderDownColor: DOWN,
      wickUpColor: UP,
      wickDownColor: DOWN,
    })
    candleRef.current = candle

    const vol = chart.addHistogramSeries({
      priceScaleId: 'vol',
      lastValueVisible: false,
    })
    vol.priceScale().applyOptions({ scaleMargins: { top: 0.85, bottom: 0 } })
    volRef.current = vol

    if (onCross) {
      chart.subscribeCrosshairMove((param) => {
        const main = param.point ? param.seriesData.get(candle) : undefined
        if (!main) {
          onCross(null)
          return
        }
        const { time, open, high, low, close } = main as {
          time: string
          open: number
          high: number
          low: number
          close: number
        }
        onCross({ date: String(time).slice(0, 10), open, high, low, close } as KlineRow)
      })
    }

    const ro = new ResizeObserver(() => {
      chart.resize(el.clientWidth, height)
    })
    ro.observe(el)
    return () => {
      ro.disconnect()
      chart.remove()
      chartRef.current = null
      candleRef.current = null
      volRef.current = null
      maRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [height])

  // 数据渲染：受控 rows（优先）；未提供 rows 时退回组件内自取（兼容复用方）。
  useEffect(() => {
    if (!chartRef.current) return
    // showMA 变化（含首帧）→ 先同步 MA 线的存在性
    syncMaSeries(showMA)

    const render = (list: KlineRow[]) => {
      const { candlestick, volume } = toSeriesData(list)
      candleRef.current?.setData(candlestick)
      volRef.current?.setData(volume)
      if (showMA && maRef.current) {
        for (const { n } of MA_COLORS) {
          const line = maRef.current.get(n)
          if (line) {
            const data = maValues(list, n).filter((x): x is LineData => !!x)
            line.setData(data)
          }
        }
      }
      setStatus(list.length ? 'ok' : 'empty')
      setError('')
    }

    // 受控模式：父级已给数据，直接渲染，不再发请求。
    if (Array.isArray(rows)) {
      render(rows)
      return
    }

    // 自取模式（近 6 个月）：保留仅为组件可独立复用。
    if (!symbol) {
      setStatus('empty')
      return
    }
    let cancelled = false
    ;(async () => {
      try {
        const end = new Date()
        const start = new Date()
        start.setMonth(start.getMonth() - 6)
        const res = await api.klineDaily(symbol, 120, {
          start: start.toISOString().slice(0, 10),
          end: end.toISOString().slice(0, 10),
        })
        if (cancelled) return
        render(res.rows)
      } catch (e) {
        if (cancelled) return
        setError((e as Error).message)
        setStatus('error')
      }
    })()
    return () => {
      cancelled = true
    }
  }, [rows, symbol, showMA])

  return (
    <div className={className} ref={containerRef} style={{ height }}>
      {status === 'loading' && <div className="text-xs text-slate-400 py-3">K 加载中…</div>}
      {status === 'error' && <div className="text-xs text-red-400 py-2">{error || 'K 加载失败'}</div>}
      {status === 'empty' && (
        <div className="flex h-full items-center justify-center text-[11px] text-slate-300">暂无历史 K 线数据</div>
      )}
    </div>
  )
}
