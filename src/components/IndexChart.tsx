/**
 * 指数图表（M5）：lightweight-charts 实现，适配窄列。
 *
 * 两种模式（右上角切换）：
 *   - 日K：K 线 + MA5/10/20 + 成交量（A 股配色：红涨绿跌）
 *   - 分时：价格线 + 均价线 + 昨收虚线（基线日期取最近一根日 K 的交易日）
 *
 * 数据直连 MCP：kline(DAILY) / tick_chart。
 */

import { useEffect, useRef, useState } from 'react'
import {
  createChart,
  ColorType,
  LineStyle,
  type IChartApi,
  type ISeriesApi,
  type UTCTimestamp,
} from 'lightweight-charts'
import { fetchKlineRows, fetchTickRows, type McpKlineRow, type TickRow } from '@/lib/stock-data'
import { fmtBigNum } from '@/lib/format'
import type { MarketTag } from '@/lib/symbol'

const UP = '#c74040'
const DOWN = '#2d9b65'
const MA_COLORS: Record<string, string> = { 5: '#f59e0b', 10: '#3b82f6', 20: '#a855f7' }

export type IndexChartMode = 'day' | 'min'

/** 副图量/额切换（成交额补充）。 */
type SubMetric = 'vol' | 'amount'

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

export function IndexChart({ market, code, name, height = 320 }: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const chartRef = useRef<IChartApi | null>(null)
  const klineCacheRef = useRef<{ key: string; rows: McpKlineRow[] } | null>(null)
  const [mode, setMode] = useState<IndexChartMode>('day')
  const [metric, setMetric] = useState<SubMetric>('vol')
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
        const cacheKey = `${market}:${code}`
        let klines = klineCacheRef.current?.key === cacheKey ? klineCacheRef.current.rows : null
        if (!klines) {
          klines = await fetchKlineRows(market, code, 'DAILY', 160)
          if (cancelled) return
          klineCacheRef.current = { key: cacheKey, rows: klines }
        }
        if (mode === 'day') {
          if (!klines.length) {
            setStatus('empty')
            return
          }
          const candle = chart.addCandlestickSeries({
            upColor: UP,
            downColor: DOWN,
            borderUpColor: UP,
            borderDownColor: DOWN,
            wickUpColor: UP,
            wickDownColor: DOWN,
          })
          candle.setData(
            klines
              .filter((r) => Number.isFinite(r.open) && Number.isFinite(r.close))
              .map((r) => ({
                time: fmtDay(r.datetime),
                open: r.open,
                high: r.high,
                low: r.low,
                close: r.close,
              })),
          )
          for (const n of [5, 10, 20]) {
            const line = chart.addLineSeries({
              color: MA_COLORS[n],
              lineWidth: 1,
              priceLineVisible: false,
              lastValueVisible: false,
              crosshairMarkerVisible: false,
            })
            line.setData(maValues(klines, n).filter((x): x is { time: string; value: number } => !!x))
          }
          const vols: { time: string; value: number; color: string }[] = []
          for (const r of klines) {
            const v = metric === 'amount' ? Number(r.amount ?? 0) : Number(r.vol ?? r.volume ?? 0)
            if (!Number.isFinite(v)) continue
            vols.push({
              time: fmtDay(r.datetime),
              value: v,
              color: r.close >= r.open ? 'rgba(199,64,64,0.45)' : 'rgba(45,155,101,0.45)',
            })
          }
          if (vols.length) {
            const vol = chart.addHistogramSeries({
              priceScaleId: 'vol',
              lastValueVisible: false,
              priceFormat: { type: 'custom', formatter: fmtBigNum, minMove: 0.01 },
            })
            vol.priceScale().applyOptions({ scaleMargins: { top: 0.85, bottom: 0 } })
            vol.setData(vols)
          }
          setStatus('ok')
          return
        }
        // 分时模式：基线日期 = 最近一根日 K 的交易日；昨收 = 前一交易日收盘
        if (!klines.length) {
          setStatus('empty')
          return
        }
        const baseDate = fmtDay(klines[klines.length - 1].datetime)
        const prevClose = klines.length >= 2 ? klines[klines.length - 2].close : klines[0].close
        const ticks: TickRow[] = await fetchTickRows(market, code, null)
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
          const ts = (dayMs + h * 3600_000 + m * 60_000 + (s || 0) * 1000) / 1000
          priceData.push({ time: ts as UTCTimestamp, value: t.price })
          if (Number.isFinite(t.avg)) avgData.push({ time: ts as UTCTimestamp, value: t.avg })
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
        price.createPriceLine({
          price: prevClose,
          color: '#94a3b8',
          lineWidth: 1,
          lineStyle: LineStyle.Dashed,
          axisLabelVisible: true,
          title: '昨收',
        })
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
  }, [market, code, mode, metric, height, name])

  const btn = (m: IndexChartMode, label: string) => (
    <button
      onClick={() => setMode(m)}
      className={`rounded px-2 py-0.5 text-[10px] font-medium transition-colors ${
        mode === m ? 'bg-emerald-500 text-white' : 'bg-slate-100 text-slate-400 hover:text-slate-600'
      }`}
    >
      {label}
    </button>
  )

  const metricBtn = (m: SubMetric, label: string) => (
    <button
      onClick={() => setMetric(m)}
      className={`rounded px-1.5 py-0.5 text-[9px] font-medium ${
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
      <div ref={containerRef} style={{ height, position: 'relative' }}>
        {status === 'loading' && (
          <div className="absolute inset-0 flex items-center justify-center bg-white/70 text-[11px] text-slate-300">
            {mode === 'day' ? 'K 线加载中…' : '分时加载中…'}
          </div>
        )}
        {status === 'empty' && (
          <div className="absolute inset-0 flex items-center justify-center text-[11px] text-slate-300">
            暂无数据
          </div>
        )}
        {status === 'error' && (
          <div className="absolute inset-0 flex items-center justify-center px-4 text-center text-[11px] text-red-400">
            {error || '加载失败'}
          </div>
        )}
      </div>
    </div>
  )
}

export type { ISeriesApi }
