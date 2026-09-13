import { useCallback, useEffect, useRef, useState } from 'react'
import {
  createChart,
  LineStyle,
  type IChartApi,
  type IPriceLine,
  type ISeriesApi,
  type LineData,
} from 'lightweight-charts'
import { api, type KlineRow } from '@/lib/api'
import { fmtPrice } from '@/lib/format'
import type { ChipsResult } from '@/lib/chips'
import { ChipProfilePrimitive } from '@/components/chip-profile'
import {
  CHART_OVERLAY_CLASS,
  CHART_OVERLAY_STYLE,
  MA_PERIODS,
  PRICE_LINE_TOKENS,
  addVolumeSeries,
  baseChartOptions,
  candleSeriesOptions,
  createRangeFitter,
  maLineOptions,
  priceLineColor,
  subscribeChartTheme,
  volumeBarColors,
  type PriceLineTone,
  type RangeFitter,
} from '@/lib/chart-theme'

/**
 * 图上价位线（v1.3：模型研判结果回填视图的落点）。
 * tone 只决定颜色语义，取值与 AI 结论里的角色对应（色值统一在 chart-theme）。
 */
export interface PriceLineSpec {
  price: number
  label: string
  tone?: PriceLineTone
}

/* ── 价位线标签防碰撞的两个阈值（UX-PLAN §V2-2 的硬要求） ── */

/**
 * 标签之间的最小像素间距 = 标签高度。
 * 10px 字号 + 上下各 `2/12 * fontSize` 的 padding（库内部算法）≈ 13.3px，取 16 留 2–3px 缝。
 * 证据：实测"支撑 86.00 与止损 84.00 直接叠死"。
 */
const PRICE_LABEL_MIN_GAP_PX = 16

/**
 * 合并标签的字符上限。
 * 验收要求 `压力(模型) 92.66 / 目标(模型) 96.63` 能完整显示（31 字符）→ 取 32；
 * 再长说明这一簇把 3–4 条价位全合并了，退化成"首 … 尾"（否则标签会被绘图区裁掉）。
 */
const PRICE_TITLE_MAX_CHARS = 32

/**
 * 同簇内谁挂标签：止损是风控硬线，最不该被合并掉；压力/支撑是当前决策位；
 * 目标是"到了就好"的一档，最先让位。
 */
const TONE_WEIGHT: Record<PriceLineTone, number> = { danger: 0, up: 1, down: 2, warn: 3 }

/** 副图量/额切换（M9 补充：成交额）。 */
export type SubMetric = 'vol' | 'amount'

/** 带像素坐标的价位线（y 为 null = 价格轴还没算出区间，不参与聚簇）。 */
interface PriceLineItem {
  spec: PriceLineSpec
  price: number
  tone: PriceLineTone
  y: number | null
}

/**
 * 价位线聚簇：y 像素距离 < minGapPx 的相邻价位线合成一簇。
 *
 * 用**传递合并**（86 / 85 / 84 三线两两相邻 → 同簇）：只比较相邻两条的话，
 * A-B 与 B-C 各自"合法"，三个标签照样叠在一起 —— 这正是实测的叠死形态。
 */
function clusterPriceLines(items: PriceLineItem[], minGapPx: number): PriceLineItem[][] {
  // 拿不到像素坐标的（价格轴还没算出区间 / 价位在可视区外）各自成簇：不参与合并，也不影响别人
  const clusters: PriceLineItem[][] = items.filter((it) => it.y === null).map((it) => [it])
  const measured = items
    .filter((it): it is PriceLineItem & { y: number } => it.y !== null)
    .sort((a, b) => a.y - b.y)

  let run: (PriceLineItem & { y: number })[] = []
  for (const it of measured) {
    const prev = run[run.length - 1]
    if (prev !== undefined && it.y - prev.y < minGapPx) {
      run.push(it)
    } else {
      if (run.length > 0) clusters.push(run)
      run = [it]
    }
  }
  if (run.length > 0) clusters.push(run)
  return clusters
}

/** 一簇的合并标签文案：`压力(模型) 92.66 / 目标(模型) 96.63`（高价在前，与图上从上到下一致）。 */
function clusterTitle(cluster: PriceLineItem[]): string {
  const parts = [...cluster].sort((a, b) => b.price - a.price).map((it) => `${it.spec.label} ${fmtPrice(it.price)}`)
  if (parts.length === 1) return parts[0]
  const merged = parts.join(' / ')
  return merged.length <= PRICE_TITLE_MAX_CHARS ? merged : `${parts[0]} … ${parts[parts.length - 1]}`
}

/** 蜡烛数据的指纹（根数 + 首末日期）：给 RangeFitter 判"是不是同一份数据"。 */
function candleSignature(candles: { time: string }[]): string {
  const first = candles[0]
  const last = candles[candles.length - 1]
  return `${candles.length}:${first?.time ?? ''}:${last?.time ?? ''}`
}

/** 把 KlineRow 转成 lightweight-charts v4 需要的格式（量柱按主题色着色）。 */
function toSeriesData(rows: KlineRow[], metric: SubMetric) {
  const volume = volumeBarColors()
  const candlestick: { time: string; open: number; high: number; low: number; close: number }[] = []
  const bars: { time: string; value: number; color: string }[] = []
  for (const r of rows) {
    const time = (typeof r.date === 'string' ? r.date.slice(0, 10) : String(r.date)) as string
    const open = Number(r.open)
    const high = Number(r.high)
    const low = Number(r.low)
    const close = Number(r.close)
    if ([open, high, low, close].some((n) => Number.isNaN(n))) continue
    candlestick.push({ time, open, high, low, close })
    const raw = metric === 'amount' ? r.amount : r.volume
    const val = Number(raw ?? 0)
    if (!Number.isNaN(val)) {
      const isUp = close >= open
      bars.push({ time, value: val, color: isUp ? volume.up : volume.down })
    }
  }
  return { candlestick, bars }
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
  /** 固定像素高度；传 'auto' 则撑满容器（宽视图主图用）。 */
  height?: number | 'auto'
  className?: string
  /**
   * 受控数据：由父级一次性拉取后传入（避免组件内部重复请求）。
   * 传入（含空数组）时组件不再自行拉取；不传时退回组件内自取近 6 个月。
   */
  rows?: KlineRow[]
  /** MA5/10/20 均线叠加开关（M9）。 */
  showMA?: boolean
  onCross?: (row: KlineRow | null) => void
  /** 筹码分布（L0/L1 由父级算好传入；null 不显示）。 */
  chips?: ChipsResult | null
  /** 筹码逐笔升级仍在取数中。 */
  chipsLoading?: boolean
  /**
   * 图上价位线（模型研判的支撑/压力/止损/目标）。
   * 传空数组即清除；价格非法/≤0 的条目自动忽略。
   */
  priceLines?: PriceLineSpec[]
}

/**
 * K 线图：主题参数/色值全部来自 `lib/chart-theme`（本文件不再出现任何图表色值），
 * 主题切换由 `subscribeChartTheme` 驱动重绘。
 */
export function KlineChart({ symbol, height = 480, className, rows, showMA = false, onCross, chips = null, chipsLoading = false, priceLines }: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const chartRef = useRef<IChartApi | null>(null)
  const candleRef = useRef<ISeriesApi<'Candlestick'> | null>(null)
  const volRef = useRef<ISeriesApi<'Histogram'> | null>(null)
  const maRef = useRef<Map<number, ISeriesApi<'Line'>> | null>(null)
  const chipPrimRef = useRef<ChipProfilePrimitive | null>(null)
  /** 可视范围适配器：数据/区间变化后按**实际根数**定尺（见 chart-theme 的 createRangeFitter）。 */
  const fitterRef = useRef<RangeFitter | null>(null)
  /** 当前挂在 K 线上的价位线（每次同步先全撤再重建，避免残留）。 */
  const priceLinesRef = useRef<IPriceLine[]>([])
  /** 最近一次画上去的数据：宿主切主题时按新色重画（量柱是逐柱着色，必须重 setData）。 */
  const lastRowsRef = useRef<KlineRow[] | null>(null)
  /** 价位线重排的下一帧句柄（setData 之后价格轴要等下一次绘制才重算区间）。 */
  const rafRef = useRef<number | null>(null)
  /** onCross 存 ref：中继回调不进图表创建 effect 的依赖，避免父级每渲染一次就重建整张图。 */
  const onCrossRef = useRef(onCross)
  onCrossRef.current = onCross

  const [status, setStatus] = useState<'loading' | 'empty' | 'error' | 'ok'>('loading')
  const [error, setError] = useState<string>('')
  const [metric, setMetric] = useState<SubMetric>('vol')
  const [chipsOn, setChipsOn] = useState(true)

  /** 最新价位线规格（用 ref 供同步函数读取，避免每次渲染重建回调）。 */
  const priceLinesDataRef = useRef<PriceLineSpec[]>([])
  priceLinesDataRef.current = priceLines ?? []
  /** 内容指纹：内容不变就不重跑同步。 */
  const priceLineKey = JSON.stringify(
    (priceLines ?? []).filter((l) => Number.isFinite(l.price) && l.price > 0),
  )

  /**
   * 把价位线同步到 K 线系列（先全撤再重建，避免残留）+ 标签防碰撞。
   *
   * 策略（UX-PLAN §V2-2：同一条线不能出现两个互相覆盖的标签、且不得盖住 Y 轴刻度）：
   *   ① 每条价位线只创建一次 → 同一条线不可能有两个标签；
   *   ② 按**像素间距**聚簇（< PRICE_LABEL_MIN_GAP_PX 归为一簇），每簇只有"更重要"的
   *      那条挂标题，文案是整簇的合并结果（`压力 92.66 / 目标 96.63`）；
   *   ③ 轴标签（axisLabelVisible）**一律关闭** —— 4 个标签原本会把右侧价格轴刻度盖住；
   *      价位数值改由"线上合并标签 + 图下方价位图例条"给出，信息不丢。
   */
  const syncPriceLines = useCallback(() => {
    const candle = candleRef.current
    if (!candle) return
    for (const line of priceLinesRef.current) {
      try {
        candle.removePriceLine(line)
      } catch {
        /* 图表已销毁等情况忽略 */
      }
    }
    priceLinesRef.current = []

    const items: PriceLineItem[] = []
    for (const spec of priceLinesDataRef.current) {
      if (!Number.isFinite(spec.price) || spec.price <= 0) continue
      const y = candle.priceToCoordinate(spec.price)
      items.push({
        spec,
        price: spec.price,
        tone: spec.tone ?? 'warn',
        y: typeof y === 'number' && Number.isFinite(y) ? y : null,
      })
    }
    if (items.length === 0) return

    for (const cluster of clusterPriceLines(items, PRICE_LABEL_MIN_GAP_PX)) {
      const anchor = cluster.reduce(
        (best, it) => (TONE_WEIGHT[it.tone] < TONE_WEIGHT[best.tone] ? it : best),
        cluster[0],
      )
      const title = clusterTitle(cluster)
      for (const it of cluster) {
        priceLinesRef.current.push(
          candle.createPriceLine({
            price: it.price,
            color: priceLineColor(it.tone),
            lineWidth: 1,
            lineStyle: LineStyle.Dashed,
            axisLabelVisible: false,
            title: it === anchor ? title : '',
          }),
        )
      }
    }
  }, [])

  /**
   * 立刻同步一次价位线，并在**接下来两帧**各再同步一次。
   *
   * 为什么要等帧：① `setData` 之后价格轴的区间要等图表自己的绘制帧才重算（同一 tick 里
   * `priceToCoordinate` 可能拿到空区间/旧区间）；② 首帧容器还没布局，价格轴高度为 0 时
   * 一律返回 null → 那样每条件都会"各自成簇"，等于没防碰撞。多排一帧一定落在图表绘制之后。
   */
  const syncPriceLinesSoon = useCallback(() => {
    syncPriceLines()
    if (rafRef.current !== null) cancelAnimationFrame(rafRef.current)
    let frames = 2
    const step = () => {
      syncPriceLines()
      frames -= 1
      rafRef.current = frames > 0 ? requestAnimationFrame(step) : null
    }
    rafRef.current = requestAnimationFrame(step)
  }, [syncPriceLines])

  /** 按需创建/移除 MA 线（showMA 关时移除，避免残留叠加）。 */
  const syncMaSeries = useCallback((show: boolean) => {
    const chart = chartRef.current
    if (!chart) return
    if (show) {
      if (!maRef.current) {
        const m = new Map<number, ISeriesApi<'Line'>>()
        for (const n of MA_PERIODS) m.set(n, chart.addLineSeries(maLineOptions(n)))
        maRef.current = m
      }
    } else if (maRef.current) {
      for (const line of maRef.current.values()) chart.removeSeries(line)
      maRef.current = null
    }
  }, [])

  /** 把一份数据画上去（数据、区间、主题任一变化都会重跑）。 */
  const renderRows = useCallback(
    (list: KlineRow[]) => {
      const { candlestick, bars } = toSeriesData(list, metric)
      candleRef.current?.setData(candlestick)
      volRef.current?.setData(bars)
      if (showMA && maRef.current) {
        for (const n of MA_PERIODS) {
          const line = maRef.current.get(n)
          if (line) line.setData(maValues(list, n).filter((x): x is LineData => x !== null))
        }
      }
      lastRowsRef.current = list
      // 可视范围：按**实际根数**定尺 ——「3月/6月/1年」切换后不留大片空白（UX-PLAN §V2-1）。
      // 指纹相同（同一份数据只是重画）则不重定尺，否则切主题/切 MA 会把用户的缩放重置掉。
      fitterRef.current?.sync(candlestick.length, candleSignature(candlestick))
      // 价位线也要重排：价格轴区间变了，聚簇的像素间距跟着变
      syncPriceLinesSoon()
      setStatus(list.length > 0 ? 'ok' : 'empty')
      setError('')
    },
    [metric, showMA, syncPriceLinesSoon],
  )

  // 首次装载：创建图表 + K 线 + 量柱（各只创建一次）。主题参数只从 chart-theme 来。
  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    /**
     * 实际高度：'auto' 时量**容器**（宽视图主图撑满剩余空间）。
     * 容器在 'auto' 模式下是 flex 拉伸出来的（见 JSX），所以 clientHeight 就是可用高度；
     * 固定高度模式直接返回传入值。
     */
    const measure = () => (height === 'auto' ? Math.max(240, el.clientHeight || 0) : height)
    const chart = createChart(el, { ...baseChartOptions(), width: el.clientWidth, height: measure() })
    chartRef.current = chart
    fitterRef.current = createRangeFitter(chart)

    const candle = chart.addCandlestickSeries(candleSeriesOptions())
    candleRef.current = candle
    volRef.current = addVolumeSeries(chart)

    chart.subscribeCrosshairMove((param) => {
      const handler = onCrossRef.current
      if (!handler) return
      const main = param.point ? param.seriesData.get(candle) : undefined
      if (!main) {
        handler(null)
        return
      }
      const { time, open, high, low, close } = main as {
        time: string
        open: number
        high: number
        low: number
        close: number
      }
      handler({ date: String(time).slice(0, 10), open, high, low, close })
    })

    const ro = new ResizeObserver(() => {
      chart.resize(el.clientWidth, measure())
      // 宽度变化后要再定尺一次：首帧宽度可能为 0（height='auto' 正在量高），那时定的尺会留空白
      fitterRef.current?.onResize()
      // 价位线也要重排：聚簇阈值是**像素**，画布高度一变，同一个价格差对应的像素距离就变了
      syncPriceLinesSoon()
    })
    ro.observe(el)
    return () => {
      ro.disconnect()
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current)
        rafRef.current = null
      }
      chart.remove()
      chartRef.current = null
      candleRef.current = null
      volRef.current = null
      maRef.current = null
      chipPrimRef.current = null
      priceLinesRef.current = []
      fitterRef.current = null
      lastRowsRef.current = null
    }
  }, [height, syncPriceLinesSoon])

  // 主题响应：宿主切明暗 → 重套图表参数（网格/轴/十字线/标签底）+ 按新色重画序列。
  // 声明在图表创建 effect 之后：那时 chartRef 才就绪。
  useEffect(() => {
    const chart = chartRef.current
    if (!chart) return
    return subscribeChartTheme(chart, (theme) => {
      candleRef.current?.applyOptions(theme.candle)
      // 量柱逐柱着色 + 价位线色取自 token：重跑一次渲染（内部会重排标签）就都刷新了
      if (lastRowsRef.current !== null) renderRows(lastRowsRef.current)
      else syncPriceLinesSoon()
    })
  }, [height, renderRows, syncPriceLinesSoon])

  // 价位线同步：内容指纹变化或图表重建（height）后各跑一次。
  // 数据变化走 renderRows（那里已经同步过），所以这里不依赖 rows。
  useEffect(() => {
    syncPriceLinesSoon()
  }, [priceLineKey, height, syncPriceLinesSoon])

  // 数据渲染：受控 rows（优先）；未提供 rows 时退回组件内自取（兼容复用方）。
  useEffect(() => {
    if (!chartRef.current) return
    // showMA 变化（含首帧）→ 先同步 MA 线的存在性
    syncMaSeries(showMA)

    // 受控模式：父级已给数据，直接渲染，不再发请求。
    if (Array.isArray(rows)) {
      renderRows(rows)
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
        setStatus('loading')
        const end = new Date()
        const start = new Date()
        start.setMonth(start.getMonth() - 6)
        const res = await api.klineDaily(symbol, 120, {
          start: start.toISOString().slice(0, 10),
          end: end.toISOString().slice(0, 10),
        })
        if (cancelled) return
        renderRows(res.rows)
      } catch (e) {
        if (cancelled) return
        setError((e as Error).message)
        setStatus('error')
      }
    })()
    return () => {
      cancelled = true
    }
  }, [rows, symbol, showMA, renderRows, syncMaSeries])

  // 筹码叠加：chips/开关/换区间变化时重建 primitive（detach→attach 是最可靠的刷新方式）。
  useEffect(() => {
    const candle = candleRef.current
    if (!candle) return
    if (chipPrimRef.current) {
      try {
        candle.detachPrimitive(chipPrimRef.current)
      } catch {
        /* 图表已重建时忽略 */
      }
      chipPrimRef.current = null
    }
    if (chips && chipsOn) {
      const prim = new ChipProfilePrimitive(chips)
      candle.attachPrimitive(prim)
      chipPrimRef.current = prim
    }
  }, [chips, chipsOn, rows])

  const hasAmount = Array.isArray(rows) && rows.some((r) => Number(r.amount ?? 0) > 0)
  /** 合法价位线（图例条与图上的线同源）。 */
  const validPriceLines = (priceLines ?? []).filter((l) => Number.isFinite(l.price) && l.price > 0)

  const metricBtn = (m: SubMetric, label: string) => (
    <button
      onClick={() => setMetric(m)}
      className={`rounded px-1.5 py-px dc-t-micro font-medium ${
        metric === m ? 'bg-emerald-100 text-emerald-600' : 'text-slate-300 hover:bg-white hover:text-slate-500'
      }`}
    >
      {label}
    </button>
  )

  const s = chips?.stats
  return (
    // height='auto' 时根节点要是 flex column：画布容器得**撑满**根节点的剩余高度。
    // 只靠"量自己"量不出来 —— 容器 height:auto 时它的高度正是图表自己撑出来的（锁死在 240）。
    <div className={`${className ?? ''}${height === 'auto' ? ' flex flex-col' : ''}`}>
      {(hasAmount || chips) && (
        <div className="mb-1 flex items-center justify-end gap-0.5">
          {hasAmount && (
            <>
              {metricBtn('vol', '量')}
              {metricBtn('amount', '额')}
            </>
          )}
          {hasAmount && chips && <span className="mx-0.5 h-3 w-px bg-slate-200" />}
          {chips && (
            <button
              onClick={() => setChipsOn((v) => !v)}
              title="筹码分布开关"
              className={`rounded px-1.5 py-px dc-t-micro font-medium ${
                chipsOn ? 'bg-violet-100 text-violet-600' : 'text-slate-300 hover:bg-white hover:text-slate-500'
              }`}
            >
              筹{chipsOn ? '开' : '关'}
            </button>
          )}
        </div>
      )}
      {/* 画布容器：遮罩是 absolute 定位（原先是普通流内小字，会把 'auto' 的高度量高） */}
      <div
        ref={containerRef}
        style={
          height === 'auto'
            ? { position: 'relative', flex: '1 1 auto', minHeight: 240 }
            : { height, flex: 'none', position: 'relative' }
        }
      >
        {status === 'loading' && (
          <div className={CHART_OVERLAY_CLASS} style={CHART_OVERLAY_STYLE} aria-live="polite">
            K 线加载中…
          </div>
        )}
        {status === 'error' && (
          <div className={CHART_OVERLAY_CLASS} style={{ ...CHART_OVERLAY_STYLE, color: 'var(--dc-danger)' }} aria-live="polite">
            {error || 'K 线加载失败'}
          </div>
        )}
        {status === 'empty' && (
          <div className={CHART_OVERLAY_CLASS} style={CHART_OVERLAY_STYLE}>
            暂无历史 K 线数据
          </div>
        )}
      </div>
      {/* 价位图例条：价位线的轴标签已关闭（不得盖住价格轴刻度），数值在这里给出，信息不丢 */}
      {validPriceLines.length > 0 && status === 'ok' && (
        <div
          className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 dc-t-micro leading-tight"
          title="模型价位（已画到图上；同一高度只保留一个合并标签）"
        >
          <span style={{ color: 'var(--dc-text-3)' }}>模型价位</span>
          {[...validPriceLines]
            .sort((a, b) => b.price - a.price)
            .map((l, i) => {
              const token = PRICE_LINE_TOKENS[l.tone ?? 'warn']
              return (
                <span key={`${l.label}-${i}`} className="inline-flex items-center gap-0.5">
                  <i className="inline-block h-1.5 w-1.5 rounded-full" style={{ background: `var(--dc-${token})` }} />
                  <span style={{ color: 'var(--dc-text-3)' }}>{l.label}</span>
                  <b className="font-mono tabular-nums" style={{ color: `var(--dc-${token})` }}>
                    {fmtPrice(l.price)}
                  </b>
                </span>
              )
            })}
        </div>
      )}
      {chips && chipsOn && s && status === 'ok' && (
        <div
          className="mt-1 flex items-center gap-x-2 gap-y-0.5 overflow-hidden whitespace-nowrap dc-t-micro leading-tight text-slate-400"
          title={`筹码窗口 ${chips.windowDays} 日 · 累计换手 ${(chips.cumTurnover * 100).toFixed(0)}% · ${
            chips.windowComplete ? '已达 300% 换手截断' : '历史不足 300% 换手（按现有K线）'
          }`}
        >
          <span className="text-slate-500">筹码</span>
          <span>
            获利 <b className="font-semibold text-dc-up">{s.profitPct.toFixed(0)}%</b>
          </span>
          <span>
            均本 <b className="font-mono text-slate-600">{s.avgCost.toFixed(2)}</b>
          </span>
          <span>
            90%带
            <b className="font-mono text-slate-600">
              {s.costLow.toFixed(2)}–{s.costHigh.toFixed(2)}
            </b>
          </span>
          <span>
            集中 <b className="font-mono text-slate-600">{(s.concentration * 100).toFixed(0)}%</b>
          </span>
          <span className="ml-auto text-slate-300">
            {chipsLoading && !chips.mode.includes('tick') && <span className="mr-1 text-slate-300">逐笔升级中…</span>}
            {chips.mode === 'tick' ? (
              <span className="text-violet-500">逐笔精算·覆盖{(chips.coverage * 100).toFixed(0)}%</span>
            ) : (
              <span>日K近似</span>
            )}
          </span>
        </div>
      )}
    </div>
  )
}
