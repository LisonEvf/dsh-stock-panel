/**
 * 个股分时图（W3/M9）：lightweight-charts，纯 MCP 数据（tick_chart）。
 *
 * 与指数页分时同款视觉（价格蓝线 + 均价橙线 + 昨收灰虚线），
 * 基线日期由父级传入（通常 = 最近一根日 K 的交易日）：当日实时（盘中）或
 * 历史交易日（收盘后/休市回看）均通过 query_date=baseDate 取数。
 */

import { useEffect, useRef, useState } from 'react'
import {
  createChart,
  ColorType,
  LineStyle,
  type IChartApi,
  type UTCTimestamp,
} from 'lightweight-charts'
import { fetchTickRows } from '@/lib/stock-data'
import type { MarketTag } from '@/lib/symbol'

interface Props {
  market: MarketTag
  code: string
  /** 分时基线日期（YYYY-MM-DD，交易日）。 */
  baseDate: string
  /** 昨收（虚线锚点）。 */
  prevClose: number
  height?: number
}

export function StockIntraday({ market, code, baseDate, prevClose, height = 300 }: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const chartRef = useRef<IChartApi | null>(null)
  const [status, setStatus] = useState<'loading' | 'ok' | 'error' | 'empty'>('loading')
  const [error, setError] = useState('')

  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    let cancelled = false
    setStatus('loading')

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
      rightPriceScale: { borderColor: 'rgba(148,163,184,0.2)' },
      timeScale: { borderColor: 'rgba(148,163,184,0.2)', timeVisible: true, secondsVisible: false },
      crosshair: {
        vertLine: { color: 'rgba(148,163,184,0.4)', labelBackgroundColor: '#64748b' },
        horzLine: { color: 'rgba(148,163,184,0.4)', labelBackgroundColor: '#64748b' },
      },
    })
    chartRef.current = chart

    const ro = new ResizeObserver(() => {
      if (chartRef.current) chartRef.current.resize(el.clientWidth, height)
    })
    ro.observe(el)

    void (async () => {
      try {
        const ticks = await fetchTickRows(market, code, baseDate)
        if (cancelled) return
        if (!ticks.length) {
          setStatus('empty')
          return
        }
        const dayMs = new Date(`${baseDate}T00:00:00`).getTime()
        const priceData: { time: UTCTimestamp; value: number }[] = []
        const avgData: { time: UTCTimestamp; value: number }[] = []
        for (const t of ticks) {
          const [h, m, s] = t.time.split(':').map(Number)
          if (!Number.isFinite(h)) continue
          const ts = ((dayMs + h * 3600_000 + m * 60_000 + (s || 0) * 1000) / 1000) as UTCTimestamp
          priceData.push({ time: ts, value: t.price })
          if (Number.isFinite(t.avg)) avgData.push({ time: ts, value: t.avg })
        }
        if (!priceData.length) {
          setStatus('empty')
          return
        }
        const price = chart.addLineSeries({
          color: '#2563eb',
          lineWidth: 2,
          priceLineVisible: false,
          crosshairMarkerRadius: 2,
        })
        price.setData(priceData)
        if (avgData.length) {
          const avg = chart.addLineSeries({
            color: 'rgba(245,158,11,0.85)',
            lineWidth: 1,
            priceLineVisible: false,
            crosshairMarkerVisible: false,
          })
          avg.setData(avgData)
        }
        if (Number.isFinite(prevClose) && prevClose > 0) {
          price.createPriceLine({
            price: prevClose,
            color: '#94a3b8',
            lineWidth: 1,
            lineStyle: LineStyle.Dashed,
            axisLabelVisible: true,
            title: '昨收',
          })
        }
        setStatus('ok')
      } catch (e) {
        if (!cancelled) {
          setError((e as Error).message)
          setStatus('error')
        }
      }
    })()

    return () => {
      cancelled = true
      ro.disconnect()
      chart.remove()
      chartRef.current = null
    }
  }, [market, code, baseDate, prevClose, height])

  return (
    <div ref={containerRef} style={{ height, position: 'relative' }}>
      {status === 'loading' && (
        <div className="absolute inset-0 flex items-center justify-center text-[11px] text-slate-300">
          分时加载中…
        </div>
      )}
      {status === 'empty' && (
        <div className="absolute inset-0 flex items-center justify-center text-[11px] text-slate-300">
          {baseDate} 暂无分时数据（休市/源空）
        </div>
      )}
      {status === 'error' && (
        <div className="absolute inset-0 flex items-center justify-center px-4 text-center text-[11px] text-red-400">
          {error || '分时加载失败'}
        </div>
      )}
    </div>
  )
}
