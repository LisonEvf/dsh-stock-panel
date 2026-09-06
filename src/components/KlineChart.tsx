import { useEffect, useRef, useState } from 'react'
import {
  createChart,
  ColorType,
  type IChartApi,
  type ISeriesApi,
} from 'lightweight-charts'
import { api, type KlineRow } from '@/lib/api'

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
      volume.push({ time, value: vol, color: isUp ? 'rgba(38,166,154,0.5)' : 'rgba(239,83,80,0.5)' })
    }
  }
  return { candlestick, volume }
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
  onCross?: (row: KlineRow | null) => void
}

export function KlineChart({ symbol, height = 480, className, rows, onCross }: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const chartRef = useRef<IChartApi | null>(null)
  const candleRef = useRef<ISeriesApi<'Candlestick'> | null>(null)
  const volRef = useRef<ISeriesApi<'Histogram'> | null>(null)
  const [status, setStatus] = useState<'loading' | 'empty' | 'error' | 'ok'>('loading')
  const [error, setError] = useState<string>('')

  // 首次装载：创建图表 + K 线 + 量柱（各只创建一次）。
  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const chart = createChart(el, {
      layout: {
        background: { type: ColorType.Solid, color: 'transparent' },
        textColor: '#64748b',
      },
      grid: {
        vertLines: { color: 'rgba(148,163,184,0.12)' },
        horzLines: { color: 'rgba(148,163,184,0.12)' },
      },
      width: el.clientWidth,
      height,
      rightPriceScale: { visible: true, borderColor: 'rgba(148,163,184,0.2)' },
    })
    chartRef.current = chart

    const candle = chart.addCandlestickSeries({
      upColor: '#26a69a',
      downColor: '#ef5350',
      borderUpColor: '#26a69a',
      borderDownColor: '#ef5350',
      wickUpColor: '#26a69a',
      wickDownColor: '#ef5350',
    })
    candleRef.current = candle

    const vol = chart.addHistogramSeries({
      color: '#94a3b8',
      priceScaleId: 'vol',
    })
    vol.priceScale().applyOptions({ scaleMargins: { top: 0.85, bottom: 0.05 } })
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
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [height])

  // 数据渲染：受控 rows（优先）；未提供 rows 时退回组件内自取（兼容复用方）。
  useEffect(() => {
    if (!chartRef.current) return

    const render = (list: KlineRow[]) => {
      const { candlestick, volume } = toSeriesData(list)
      candleRef.current?.setData(candlestick)
      volRef.current?.setData(volume)
      setStatus(list.length ? 'ok' : 'empty')
      setError('')
    }

    // 受控模式：父级已给数据，直接渲染，不再发请求。
    if (Array.isArray(rows)) {
      render(rows)
      return
    }

    // 自取模式（近 6 个月）：目前仅 StockDetailPage 使用且已改受控，
    // 保留此路径仅为组件可独立复用。
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
  }, [rows, symbol])

  return (
    <div className={className} ref={containerRef} style={{ height }}>
      {status === 'loading' && <div className="text-sm text-muted py-4">K 加载中…</div>}
      {status === 'error' && <div className="text-sm text-danger py-2">{error || 'K 加载失败'}</div>}
      {status === 'empty' && (
        <div className="flex h-full items-center justify-center text-sm text-muted">暂无历史 K 线数据</div>
      )}
    </div>
  )
}
