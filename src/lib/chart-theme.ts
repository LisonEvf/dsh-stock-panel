/**
 * src/lib/chart-theme.ts — 图表主题的**唯一来源**（lightweight-charts 专用）。
 *
 * 为什么要有这个文件（UX-PLAN §V2 / §V-d，都是实测/审计证据）：
 *   1. 三个图表组件各复制一份 `createChart` 参数，已经漂移 —— 量副图 margins 一处 0.85、
 *      一处 0.8；分时那边连加载遮罩都没有；
 *   2. 图表零主题响应：全仓 `MutationObserver` 0 命中。lightweight-charts 把颜色画进
 *      canvas，解析不了 `var(--dc-*)`，所以宿主切明暗后图上还是旧色；
 *   3. 亮色下轴色 `#94a3b8` 对白底只有 2.57:1（10px 轴文字基本看不清），
 *      十字线数值标签更糟（见 `chartColors()` 里 `crosshairLabelBg` 的说明）；
 *   4. 量柱 `rgba(199,64,64,.45)` 在暗底（#232324）合成后约 1.84:1 ≈ 不可见
 *      （实测"发灰像禁用态"）。
 *
 * 分工（与 lib/theme-colors.ts 的边界）：
 *   · `theme-colors` 负责"按语义名取**具体色值**"（带缓存 + 主题变化清缓存）；
 *   · 本文件负责"把色值拼成 lightweight-charts 的参数/序列颜色"，并订阅宿主主题变化。
 *   canvas 一律用具体色值，`var(--dc-*)` 只出现在 DOM 层（遮罩、图例条）。
 *
 * 组件侧用法：
 *   const chart = createChart(el, { ...baseChartOptions(), width, height })
 *   const candle = chart.addCandlestickSeries(candleSeriesOptions())
 *   const vol = addVolumeSeries(chart)
 *   const fitter = createRangeFitter(chart)              // 数据变化后 fitter.sync(根数)
 *   const unsub = subscribeChartTheme(chart, (t) => {    // 主题变化 → 重画序列
 *     candle.applyOptions(t.candle)
 *     重设量柱数据（逐柱着色必须重 setData）
 *   })
 *   // 卸载：先 unsub() 再 chart.remove()
 */

import type { CSSProperties } from 'react'
import {
  ColorType,
  type CandlestickSeriesPartialOptions,
  type ChartOptions,
  type DeepPartial,
  type IChartApi,
  type ISeriesApi,
  type LineSeriesPartialOptions,
  type PriceScaleMargins,
} from 'lightweight-charts'
import { fmtBigNum } from '@/lib/format'
import {
  clearThemeColorCache,
  subscribeThemeChange,
  themeColor,
  themeRgb,
  type SemanticColor,
} from '@/lib/theme-colors'

/* ───────────────────────── 常量：三个图表组件共用一份 ───────────────────────── */

/** 量副图叠加价格轴的 id（原来 KlineChart / IndexChart / StockIntraday 各写一次 'vol'）。 */
export const VOLUME_SCALE_ID = 'vol'

/**
 * 量副图在价格轴上的占比 —— **统一常量**。
 * 证据：KlineChart 写 0.85、StockIntraday 写 0.8，同一个副图两套高度。
 * 取 0.8：量柱拿到下方 20%（0.85 只剩 15%），配合下面的高不透明度才看得出涨跌。
 */
export const VOLUME_SCALE_MARGINS: PriceScaleMargins = { top: 0.8, bottom: 0 }

/** MA 周期（原来两处各写一份 `[5, 10, 20]`）。 */
export const MA_PERIODS = [5, 10, 20] as const

/**
 * MA 均线配色：这是**分类色**（三条线互不相同即可），不是涨跌语义色，
 * 所以固定不随明暗切换 —— 语义色才需要 themeColor 收口。
 */
const MA_COLORS: Record<number, string | undefined> = {
  5: '#f59e0b',
  10: '#3b82f6',
  20: '#a855f7',
}
const MA_FALLBACK_COLOR = '#94a3b8'

/**
 * 分时（现价 / 均价）线色：蓝、琥珀，同样是分类色。
 * 放在这里是为了让 IndexChart 与 StockIntraday 共用一份，别再各写一份字面量。
 */
export const INTRADAY_PRICE_COLOR = '#2563eb'
export const INTRADAY_AVG_COLOR = 'rgba(245, 158, 11, 0.85)'

/* ───────────────────────── 颜色 ───────────────────────── */

/** 图表上所有非序列色（网格/轴/十字线/标签底/水印）。 */
export interface ChartColors {
  /** A 股语义色：涨（红）/跌（绿）/平 */
  up: string
  down: string
  flat: string
  /** 警示（模型止损/目标这类价位线用） */
  warn: string
  danger: string
  /** 网格线 */
  grid: string
  /** 价格轴/时间轴边框 */
  axisBorder: string
  /** 轴文字（价格刻度、日期刻度） */
  axisText: string
  /** 十字线本身 */
  crosshair: string
  /** 十字线数值标签底 */
  crosshairLabelBg: string
  /** 水印 */
  watermark: string
  /** 参考基线（分时昨收虚线） */
  baseline: string
  /** 量柱涨/跌 */
  volumeUp: string
  volumeDown: string
}

/** 主题 token + 透明度 → `rgba()`。
 *  必须走 JS 预乘：canvas 与 lightweight-charts 的 color 解析都吃不了 `color-mix()`。 */
export function themeAlpha(name: SemanticColor, alpha: number): string {
  const [r, g, b] = themeRgb(name)
  return `rgba(${r}, ${g}, ${b}, ${alpha})`
}

/** 量柱降明度系数 / 不透明度（见 volumeBarColors 的注释）。 */
const VOLUME_DIM = 0.9
const VOLUME_ALPHA = 0.85

function dimmedBar(name: SemanticColor): string {
  const [r, g, b] = themeRgb(name)
  const dim = (v: number) => Math.round(v * VOLUME_DIM)
  return `rgba(${dim(r)}, ${dim(g)}, ${dim(b)}, ${VOLUME_ALPHA})`
}

/**
 * 量柱涨跌色：**同色系降明度 + 高不透明度**，不再用 `.45` 那种淡到底的 alpha。
 *
 * 证据：旧值 `rgba(199,64,64,.45)` 在暗底合成后 ≈1.84:1，实测"量柱发灰像禁用态"。
 * 半透明是"同时降明度又降饱和"——把背景混进来，暗底尤其糊。
 * 做法：取主题语义色（暗色主题下 --dc-up 已是提亮过的 #e26060）乘 0.9 降明度，
 * 再按 alpha 0.85 预乘 → 合成后 亮底 4.4 / 4.5:1、暗底 3.1 / 4.0:1（涨/跌），
 * 都过 3:1 的非文本 UI 门槛，且与蜡烛保持同一色系（不会因为"量柱是另一个红"而误读）。
 * （比值口径 = 宿主真值 × 当前 --dc-* token，与 scripts/contrast.mjs 同一套算法。）
 */
export function volumeBarColors(): { up: string; down: string } {
  return { up: dimmedBar('up'), down: dimmedBar('down') }
}

/**
 * 一次取全图表用色（每次都现取，主题切换后有新值 —— theme-colors 负责缓存失效）。
 */
export function chartColors(): ChartColors {
  const volume = volumeBarColors()
  return {
    up: themeColor('up'),
    down: themeColor('down'),
    flat: themeColor('flat'),
    warn: themeColor('warn'),
    danger: themeColor('danger'),
    // 网格：旧值 rgba(148,163,184,.10) 在亮底约 1.04:1（等于没有网格线）→ 改用主题边框色
    grid: themeAlpha('border', 0.9),
    // 轴边框：旧值 rgba(148,163,184,.2) 亮底也只有 1.1:1
    axisBorder: themeColor('border-strong'),
    // 轴文字：旧值 #94a3b8 亮底 2.57:1 ✗（10px 小字读不清）；
    // --dc-text-2 亮色 = #475569 对白底 7.6:1 ✓、暗色 = 宿主 secondary #cfd3d6 对 #232324 约 10:1 ✓。
    axisText: themeColor('text-2'),
    // 十字线：旧值 rgba(148,163,184,.4) 亮底约 1.6:1（V2-6 验收要求轴与十字线 ≥4.5:1）。
    // 取 text-2 的 85%：亮底合成后 ≈5.1:1、暗底 ≈7.9:1（虚线，不会盖住 K 线）。
    crosshair: themeAlpha('text-2', 0.85),
    // 十字线数值标签底：轻量图表 v4 会按**标签底灰度**自动选黑/白前景
    // （dist 的 generateContrastColors：灰度 >160 用黑字，否则白字），
    // 所以底色必须是"极深或极浅"——取主题前景色：亮色 #0f172a 深底白字 17.9:1，
    // 暗色 #f9fafb 浅底黑字 20.1:1。中间灰（旧的 #64748b）只能落在 2.5–7:1 之间。
    crosshairLabelBg: themeColor('text'),
    watermark: themeAlpha('text-3', 0.18),
    baseline: themeColor('text-3'),
    volumeUp: volume.up,
    volumeDown: volume.down,
  }
}

/* ───────────────────────── 价位线色调（模型价位） ───────────────────────── */

/** 价位线语义色调（与 AI 研判里的角色对应）。 */
export type PriceLineTone = 'up' | 'down' | 'warn' | 'danger'

/**
 * 色调 → 语义 token：**唯一一份映射**。
 * 图表 canvas 用 `priceLineColor()`（具体色值），DOM 图例条用 `var(--dc-${token})`
 * 拼出变量名 —— 两边不会各写一份色板（V2-5 要改"模型价位用专属色"时也只改这里）。
 */
export const PRICE_LINE_TOKENS: Record<PriceLineTone, SemanticColor> = {
  up: 'up',
  down: 'down',
  warn: 'warn',
  danger: 'danger',
}

/** 价位线色调 → 具体色值（canvas 用）。 */
export function priceLineColor(tone: PriceLineTone): string {
  return themeColor(PRICE_LINE_TOKENS[tone])
}

/* ───────────────────────── 序列 ───────────────────────── */

/** 蜡烛序列配色（红涨绿跌，全部走 token）。主题变化时用 `candle.applyOptions(theme.candle)` 重套。 */
export function candleSeriesOptions(colors: ChartColors = chartColors()): CandlestickSeriesPartialOptions {
  return {
    upColor: colors.up,
    downColor: colors.down,
    borderUpColor: colors.up,
    borderDownColor: colors.down,
    wickUpColor: colors.up,
    wickDownColor: colors.down,
  }
}

/** MA 均线序列参数（三处创建 MA 线共用）。 */
export function maLineOptions(period: number): LineSeriesPartialOptions {
  return {
    color: MA_COLORS[period] ?? MA_FALLBACK_COLOR,
    lineWidth: 1,
    priceLineVisible: false,
    lastValueVisible: false,
    crosshairMarkerVisible: false,
  }
}

/**
 * 量副图序列：`priceScaleId`、`scaleMargins`、成交量单位格式三件套只在这里定义一次
 * （原来两个组件各写一份，高度还漂移成 0.85 / 0.8）。
 */
export function addVolumeSeries(chart: IChartApi): ISeriesApi<'Histogram'> {
  const series = chart.addHistogramSeries({
    priceScaleId: VOLUME_SCALE_ID,
    lastValueVisible: false,
    priceFormat: { type: 'custom', formatter: fmtBigNum, minMove: 0.01 },
  })
  series.priceScale().applyOptions({ scaleMargins: { ...VOLUME_SCALE_MARGINS } })
  return series
}

/* ───────────────────────── 图表参数 ───────────────────────── */

/** 按图表用途微调的参数（主题参数本身不带选项）。 */
export interface ChartThemeOptions {
  /** 分时图要显示"时分"；日 K 保持默认（X 轴只显示日期，少占一行） */
  timeVisible?: boolean
  /** 右侧留白（根数）。默认 0：可视区间由 createRangeFitter 按根数定尺 */
  rightOffset?: number
}

function optionsFromColors(colors: ChartColors, opts: ChartThemeOptions): DeepPartial<ChartOptions> {
  return {
    layout: {
      // 透明底：底色由宿主的容器决定（亮/暗都对），图表自己不再糊一层白
      background: { type: ColorType.Solid, color: 'transparent' },
      textColor: colors.axisText,
      fontSize: 10,
    },
    grid: {
      vertLines: { color: colors.grid },
      horzLines: { color: colors.grid },
    },
    crosshair: {
      vertLine: { color: colors.crosshair, labelBackgroundColor: colors.crosshairLabelBg },
      horzLine: { color: colors.crosshair, labelBackgroundColor: colors.crosshairLabelBg },
    },
    rightPriceScale: {
      visible: true,
      borderColor: colors.axisBorder,
    },
    timeScale: {
      borderColor: colors.axisBorder,
      timeVisible: opts.timeVisible ?? false,
      secondsVisible: false,
      rightOffset: opts.rightOffset ?? 0,
    },
    localization: { locale: 'zh-CN' },
    // 注意：这里**不带** width/height —— 尺寸只在 createChart 时给。
    // 若带进来，主题重套（applyOptions）会把尺寸写死，ResizeObserver 的 resize 立刻被覆盖。
  }
}

/**
 * `createChart` 的公共参数（三个图表组件共用，禁止再各写一份 grid/layout）。
 * 尺寸由调用方补：`createChart(el, { ...baseChartOptions(), width, height })`
 */
export function baseChartOptions(opts: ChartThemeOptions = {}): DeepPartial<ChartOptions> {
  return optionsFromColors(chartColors(), opts)
}

/** 主题变化后需要重画的序列颜色（调用方拿去 applyOptions / 重 setData）。 */
export interface ChartSeriesTheme {
  /** 图表级非序列色（网格/轴/十字线/标签底/量柱色） */
  colors: ChartColors
  /** 蜡烛序列（candle.applyOptions(theme.candle)） */
  candle: CandlestickSeriesPartialOptions
  /** 量柱涨跌色（histogram 是逐柱着色 → 必须按新色重 setData） */
  volume: { up: string; down: string }
}

/**
 * 把公共主题参数套到**已存在**的图表上，并返回需要重画的序列颜色。
 * 主题切换（`subscribeChartTheme`）与首帧都可调用；不含尺寸，反复调用安全。
 */
export function applyChartTheme(chart: IChartApi, opts: ChartThemeOptions = {}): ChartSeriesTheme {
  const colors = chartColors()
  chart.applyOptions(optionsFromColors(colors, opts))
  return { colors, candle: candleSeriesOptions(colors), volume: volumeBarColors() }
}

/**
 * 订阅宿主主题变化（`body[data-ds-dark-theme]`）→ 重套图表参数 + 通知调用方重画序列。
 * 返回取消订阅函数，**组件卸载时必须调用**（否则 MutationObserver 会把已销毁的图表留在回调里）。
 */
export function subscribeChartTheme(
  chart: IChartApi,
  onApplied?: (theme: ChartSeriesTheme) => void,
  opts: ChartThemeOptions = {},
): () => void {
  return subscribeThemeChange(() => {
    // 先清 theme-colors 的缓存再取色：两个 MutationObserver 都挂在 body 上，
    // 触发顺序不该成为"读到旧色"的理由（切主题是低频事件，多一次 getComputedStyle 不值一提）。
    clearThemeColorCache()
    try {
      const theme = applyChartTheme(chart, opts)
      onApplied?.(theme)
    } catch {
      /* 图表已被销毁（卸载与切主题撞在同一帧）：忽略即可 */
    }
  })
}

/* ───────────────────────── 可视范围 ───────────────────────── */

/** 可视范围适配器（见 createRangeFitter）。 */
export interface RangeFitter {
  /**
   * 数据变化后调用：记录根数并定尺。
   * @param bars 实际根数
   * @param signature 数据指纹（模式 + 根数 + 首末时间）。指纹相同就**不**重新定尺：
   *   父级重渲染、切 MA、切主题都会重跑绘制，但不该把用户已经缩放/平移的图重置回全览；
   *   而换标的、切区间（3月/6月/1年）指纹必然不同 → 一定重定尺（不留大片空白）。
   */
  sync(bars: number, signature?: string): void
  /** 容器尺寸变化后调用（在 chart.resize 之后）：宽度从 0 变成真实值时补一次定尺。 */
  onResize(): void
}

/**
 * 可视范围适配：把逻辑区间钉在"恰好覆盖全部数据"上。
 *
 * 证据（UX-PLAN §L3）：120 根数据时蜡烛只占绘图区右侧 40–60%，左侧一大片空白 ——
 * `setData` 不会重置时间轴的逻辑区间，"1年(250 根) → 3月(60 根)"切完还停在旧宽度上。
 *
 * 为什么不用 `fitContent()`：定尺在库内部就是 `barSpacing = 可用宽度 / 区间长度`，
 * 宽度为 0 时（首帧 `height='auto'` 还在量高、或面板在未激活的 tab 里）算出的是 0，
 * 会被钳到 `minBarSpacing`（默认 0.5）—— 之后即使 ResizeObserver 把宽度改成真实值也不会重算，
 * 于是 120 根数据在 800px 里只占左边一小撮／整片空白。那正是"大面积空白"的成因之一。
 * 所以这里按**根数**定尺（`-0.5 ~ bars-0.5` 正好贴住数据两端，左右都不留空），
 * 并且在宽度还不可用时留一个 pending，用下一帧 / onResize 补上。
 */
export function createRangeFitter(chart: IChartApi): RangeFitter {
  let bars = 0
  let signature: string | null = null
  let pending = false
  let raf: number | null = null

  const apply = (): void => {
    if (bars <= 0 || !pending) return
    let width = 0
    try {
      width = chart.timeScale().width()
    } catch {
      return /* 图表已销毁 */
    }
    // 宽度还是 0：留着 pending（此时定尺必然算错）。
    // 时间轴的宽度是图表在**自己的布局阶段**写进去的，首帧/隐藏 tab 里读到 0 很正常。
    if (width <= 0) return
    try {
      chart.timeScale().setVisibleLogicalRange({ from: -0.5, to: bars - 0.5 })
      pending = false
    } catch {
      /* 图表已销毁等情况忽略 */
    }
  }

  /** 这一帧还没定成尺 → 下一帧再试（图表自己那帧绘制之后，宽度/高度才是真的）。 */
  const applyNextFrame = (): void => {
    if (raf !== null) cancelAnimationFrame(raf)
    raf = requestAnimationFrame(() => {
      raf = null
      apply()
    })
  }

  return {
    sync(next: number, sig?: string) {
      if (next <= 0) {
        bars = 0
        signature = null
        pending = false
        return
      }
      if (sig !== undefined && sig === signature) {
        // 同一份数据（父级只是换了个新数组/切了 MA/切了主题）→ 保住用户的缩放与平移，
        // 但若上一次因为"宽度还是 0"没定成尺，这里要把它补上
        if (pending) applyNextFrame()
        return
      }
      bars = next
      signature = sig ?? null
      pending = true
      apply()
      if (pending) applyNextFrame()
    },
    onResize() {
      apply()
      if (pending) applyNextFrame()
    },
  }
}

/* ───────────────────────── 三态遮罩（加载 / 空 / 错误） ───────────────────────── */

/**
 * 图表三态遮罩的统一外观。
 *
 * 为什么放进主题文件：K 线与分时两边的"有没有遮罩/遮罩长什么样"已经漂移
 * （K 线只有一行内联小字，分时是 `bg-white/70` 的白块），而它是**纯视觉**约定。
 * 这里走 CSS 变量（DOM 层不受 canvas 限制）→ 自动跟随明暗主题。
 * z-10 是必需的：lightweight-charts 的 canvas 是挂载后 **append** 进来的，
 * 在 DOM 顺序上位于 React 子节点之后，不抬 z-index 就会被画布盖住（＝"空白画布"）。
 */
export const CHART_OVERLAY_CLASS =
  'absolute inset-0 z-10 flex items-center justify-center px-4 text-center dc-t-note'

/** 配套样式：铺满画布的半透明底 + 次级文字色（亮/暗都可读）。 */
export const CHART_OVERLAY_STYLE: CSSProperties = {
  background: 'color-mix(in srgb, var(--dc-layer-1) 72%, transparent)',
  color: 'var(--dc-text-3)',
}
