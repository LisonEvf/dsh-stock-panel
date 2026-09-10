/**
 * 个股分时图（W3/M9）：lightweight-charts，纯 MCP 数据（tick_chart）。
 *
 * 与指数页分时同款视觉（价格蓝线 + 均价橙线 + 昨收灰虚线），
 * 基线日期由父级传入（通常 = 最近一根日 K 的交易日）：当日实时（盘中）或
 * 历史交易日（收盘后/休市回看）均通过 query_date=baseDate 取数。
 *
 * 懒加载缓存（useSwr）：分时 + 竞价数据走 SWR 缓存，命中旧数据立即绘制（秒开），
 * 后台验证失败会自动下线过期数据并重试一次，避免把过期分时当实时行情展示。
 */

import { useEffect, useRef, useState } from 'react'
import {
  createChart,
  ColorType,
  LineStyle,
  type IChartApi,
  type UTCTimestamp,
} from 'lightweight-charts'
import { fetchAuctionSeries, fetchTickRows } from '@/lib/stock-data'
import { useSwr, swrKey } from '@/lib/cache'
import { fmtBigNum } from '@/lib/format'
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
  const [hasAuction, setHasAuction] = useState(false)

  // SWR 缓存：命中旧数据立即绘制，后台验证失败自动下线重试（避免以假乱真）。
  const ticksSwr = useSwr(swrKey.tick(market, code, baseDate), () => fetchTickRows(market, code, baseDate), {
    ttl: 60_000,
  })
  const auctionSwr = useSwr(swrKey.auction(market, code), () => fetchAuctionSeries(market, code), {
    ttl: 60_000,
  })
  const ticks = ticksSwr.data ?? []
  const auction = auctionSwr.data ?? []

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
      rightPriceScale: { borderColor: 'rgba(148,163,184,0.2)' },
      timeScale: { borderColor: 'rgba(148,163,184,0.2)', timeVisible: true, secondsVisible: false },
      crosshair: {
        vertLine: { color: 'rgba(148,163,184,0.4)', labelBackgroundColor: '#64748b' },
        horzLine: { color: 'rgba(148,163,184,0.4)', labelBackgroundColor: '#64748b' },
      },
    })

    const ro = new ResizeObserver(() => {
      chart.resize(el.clientWidth, height)
    })
    ro.observe(el)

    let localHasAuction = false
    if (ticks.length) {
      const dayMs = new Date(`${baseDate}T00:00:00`).getTime()
      const priceData: { time: UTCTimestamp; value: number }[] = []
      const avgData: { time: UTCTimestamp; value: number }[] = []
      const volBars: { time: UTCTimestamp; value: number; color: string }[] = []
      for (const t of ticks) {
        const [h, m, s] = t.time.split(':').map(Number)
        if (!Number.isFinite(h)) continue
        const ts = ((dayMs + h * 3600_000 + m * 60_000 + (s || 0) * 1000) / 1000) as UTCTimestamp
        priceData.push({ time: ts, value: t.price })
        if (Number.isFinite(t.avg)) avgData.push({ time: ts, value: t.avg })
        const v = Number(t.vol ?? 0)
        if (Number.isFinite(v)) {
          volBars.push({
            time: ts,
            value: v,
            color: t.price >= prevClose ? 'rgba(199,64,64,0.45)' : 'rgba(45,155,101,0.45)',
          })
        }
      }
      // 竞价 9:15–9:25 逐点 price 曲线，叠加在分时最左侧（配量不以柱形混入，避免秒级/分钟级分辨率挤爆量柱）。
      const auctionPrice: { time: UTCTimestamp; value: number }[] = []
      for (const a of auction) {
        const [h, m, s] = (a.time || '').split(':').map(Number)
        if (!Number.isFinite(h)) continue
        const ts = ((dayMs + h * 3600_000 + m * 60_000 + (s || 0) * 1000) / 1000) as UTCTimestamp
        if (typeof a.price === 'number') auctionPrice.push({ time: ts, value: a.price })
      }
      const price = chart.addLineSeries({
        color: '#2563eb',
        lineWidth: 2,
        priceLineVisible: false,
        crosshairMarkerRadius: 2,
      })
      price.setData(priceData)
      if (auctionPrice.length) {
        const auctionCurve = chart.addLineSeries({
          color: 'rgba(168,85,247,0.95)',
          lineWidth: 1,
          lineStyle: LineStyle.Dashed,
          priceLineVisible: false,
          lastValueVisible: false,
          crosshairMarkerVisible: false,
        })
        auctionCurve.setData(auctionPrice)
      }
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
      if (volBars.length) {
        const vol = chart.addHistogramSeries({
          priceScaleId: 'vol',
          lastValueVisible: false,
          priceFormat: { type: 'custom', formatter: fmtBigNum, minMove: 0.01 },
        })
        vol.priceScale().applyOptions({ scaleMargins: { top: 0.8, bottom: 0 } })
        vol.setData(volBars)
      }
      localHasAuction = auctionPrice.length > 0
    }
    setHasAuction(localHasAuction)

    return () => {
      ro.disconnect()
      chart.remove()
    }
  }, [market, code, baseDate, prevClose, height, ticks, auction])

  const status = ticksSwr.status
  // error 时展示失败信息（后台验证失败会自动下线过期数据，绝不用旧的冒充实时）。
  const errorText = ticksSwr.error

  return (
    <div className="w-full">
      {hasAuction && (
        <div className="mb-1 flex items-center gap-2 text-[9px] text-slate-400">
          <span className="text-[#2563eb]">— 价</span>
          <span className="text-[#f59e0b]">— 均</span>
          <span className="text-[#a855f7]">⌁ 竞价(9:15-9:25)</span>
          <span className="text-slate-400">┄ 昨收</span>
        </div>
      )}
      <div ref={containerRef} style={{ height, position: 'relative' }}>
        {status === 'loading' && (
          <div className="absolute inset-0 flex items-center justify-center text-[11px] text-slate-300">
            分时加载中…
          </div>
        )}
        {status === 'success' && ticks.length === 0 && (
          <div className="absolute inset-0 flex items-center justify-center text-[11px] text-slate-300">
            {baseDate} 暂无分时数据（休市/源空）
          </div>
        )}
        {status === 'error' && (
          <div className="absolute inset-0 flex items-center justify-center px-4 text-center text-[11px] text-red-400">
            {errorText || '分时加载失败'}
          </div>
        )}
      </div>
    </div>
  )
}
