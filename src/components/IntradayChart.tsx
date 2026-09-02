import { useEffect, useRef, useState } from 'react'
import { createChart, ColorType, type IChartApi } from 'lightweight-charts'
import { api, type MinuteKlineRow } from '@/lib/api'

interface Props {
  symbol: string
  date: string | null
  height?: number
  prevClose?: number
  className?: string
}

/** 分时图：价格曲线 + 均价线（v4.2.3 API） */
export function IntradayChart({ symbol, date, height = 320, prevClose, className }: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const chartRef = useRef<IChartApi | null>(null)
  const [status, setStatus] = useState<'loading' | 'empty' | 'error' | 'ok'>('loading')
  const [error, setError] = useState<string>('')

  useEffect(() => {
    if (!symbol || !date) return
    let cancelled = false
    ;(async () => {
      try {
        const res = await api.klineMinute(symbol, date)
        if (cancelled) return
        const rows = res.rows
        const price: { time: string; value: number }[] = []
        const avg: { time: string; value: number }[] = []
        let cum = 0
        let cumVol = 0
        for (const r of rows) {
          const t = (typeof r.datetime === 'string' ? r.datetime.slice(11, 16) : String(r.datetime))
          const close = Number(r.close)
          if (Number.isNaN(close)) continue
          price.push({ time: t, value: close })
          cum += close * Number(r.volume ?? 0)
          cumVol += Number(r.volume ?? 0)
          avg.push({ time: t, value: cumVol > 0 ? cum / cumVol : close })
        }
        if (cancelled) return
        const chart = chartRef.current
        if (chart) {
          chart.remove()
        }
        const el = containerRef.current
        if (!el) return
        const c = createChart(el, {
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
          rightPriceScale: { borderColor: 'rgba(148,163,184,0.2)' },
        })
        c.addLineSeries({ color: '#3b82f6', lineWidth: 2 }).setData(price)
        c.addLineSeries({ color: 'rgba(245,158,11,0.7)', lineWidth: 1, priceScaleId: 'avg' }).setData(avg)
        chartRef.current = c
        setStatus(rows.length ? 'ok' : 'empty')
      } catch (e) {
        if (cancelled) return
        setError((e as Error).message)
        setStatus('error')
      }
    })()
    return () => { cancelled = true }
  }, [symbol, date, prevClose])

  return (
    <div className={className} ref={containerRef} style={{ height }}>
      {status === 'loading' && <div className="text-xs text-muted py-2">分时加载中…</div>}
      {status === 'error' && <div className="text-xs text-danger py-2">{error}</div>}
      {status === 'empty' && (
        <div className="flex h-full items-center justify-center text-xs text-muted">该日暂无分时数据</div>
      )}
    </div>
  )
}

export type { MinuteKlineRow }
