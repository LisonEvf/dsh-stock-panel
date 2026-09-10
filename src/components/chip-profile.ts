/**
 * 筹码分布叠加层（lightweight-charts v4 custom series primitive）。
 *
 * 把 ChipsResult.bins（价格→相对筹码量）画在 K 线主图**右侧**、与价格轴精确对齐：
 *   - y 映射用所挂 series 的 priceToCoordinate（随缩放/平移自动对齐）；
 *   - 逐像素行聚合筹码量（200 档在有限画布高度下合并到像素行，避免细条重叠）；
 *   - 每行宽度 ∝ 该价位筹码密度；颜色按现价分界：≤现价=获利(红) / >现价=套牢(绿)。
 *
 * 用法：KlineChart 在渲染日K后对蜡烛 series 调 attachPrimitive；数据变化时
 * detach 旧的并 attach 新的（最简单可靠的刷新方式）。
 *
 * 类型说明：pane renderer 的 draw(target) 参数官方类型来自 fancy-canvas（未直接
 * 安装在 pnpm 根），本文件用 any 弱化，画布 API 仍按官方形状调用。
 */

import type {
  ISeriesPrimitive,
  ISeriesPrimitivePaneView,
  ISeriesPrimitivePaneRenderer,
  SeriesAttachedParameter,
  Time,
} from 'lightweight-charts'
import type { ChipsResult } from '@/lib/chips'

type PriceToY = (price: number) => number | null

class ChipPaneRenderer implements ISeriesPrimitivePaneRenderer {
  private bins: { price: number; weight: number }[] = []
  private currentPrice = 0
  private toY: PriceToY | null = null

  setData(chips: ChipsResult): void {
    this.bins = chips.bins
    this.currentPrice = chips.currentPrice
  }

  setConverter(fn: PriceToY): void {
    this.toY = fn
  }

  draw(target: any): void {
    const toY = this.toY
    const media = target?.useMediaCoordinateSpace
    if (typeof media !== 'function' || !toY || !this.bins.length) return
    media((scope: { context: CanvasRenderingContext2D; mediaSize: { width: number; height: number } }) => {
      const ctx = scope.context
      const w = scope.mediaSize.width
      const h = scope.mediaSize.height

      // 合并到像素行（y 取整），同行的量相加、价取量加权均值
      const rowMap = new Map<number, { weight: number; priceAcc: number }>()
      for (const b of this.bins) {
        const y = toY(b.price)
        if (y == null || !Number.isFinite(y)) continue
        const k = Math.round(y)
        if (k < -1 || k > h + 1) continue
        const e = rowMap.get(k) ?? { weight: 0, priceAcc: 0 }
        e.weight += b.weight
        e.priceAcc += b.price * b.weight
        rowMap.set(k, e)
      }
      const rows: { y: number; weight: number; price: number }[] = []
      for (const [y, e] of rowMap) {
        if (e.weight > 0) rows.push({ y, weight: e.weight, price: e.priceAcc / e.weight })
      }
      if (!rows.length) return
      rows.sort((a, b) => a.y - b.y)

      let maxW = 0
      for (const r of rows) if (r.weight > maxW) maxW = r.weight
      if (maxW <= 0) return

      const right = w - 3
      const maxBar = Math.max(30, Math.min(58, Math.round(w * 0.16)))

      for (const r of rows) {
        const norm = r.weight / maxW
        const barW = Math.max(1, norm * maxBar)
        const isProfit = r.price <= this.currentPrice
        const base = isProfit ? [199, 64, 64] : [45, 155, 101]
        const alpha = 0.3 + 0.45 * norm
        const grad = ctx.createLinearGradient(right - barW, 0, right, 0)
        grad.addColorStop(0, `rgba(${base[0]},${base[1]},${base[2]},${alpha * 0.3})`)
        grad.addColorStop(1, `rgba(${base[0]},${base[1]},${base[2]},${alpha})`)
        ctx.fillStyle = grad
        ctx.fillRect(right - barW, r.y - 0.5, barW, 1.5)
      }

      // 现价分界细线
      const yCur = toY(this.currentPrice)
      if (yCur != null && Number.isFinite(yCur)) {
        ctx.fillStyle = 'rgba(100,116,139,0.35)'
        ctx.fillRect(0, yCur - 0.5, w, 1)
      }
    })
  }
}

class ChipPaneView implements ISeriesPrimitivePaneView {
  private readonly _renderer: ChipPaneRenderer
  constructor(renderer: ChipPaneRenderer) {
    this._renderer = renderer
  }
  renderer(): ISeriesPrimitivePaneRenderer {
    return this._renderer
  }
}

/**
 * custom series primitive：attach 到蜡烛 series 后，在绘图层把筹码画在主图右侧。
 * 通过 attached(param) 拿到 series（priceToCoordinate）与 requestUpdate。
 */
export class ChipProfilePrimitive implements ISeriesPrimitive<Time> {
  private readonly renderer: ChipPaneRenderer
  private readonly view: ChipPaneView

  constructor(chips: ChipsResult) {
    this.renderer = new ChipPaneRenderer()
    this.renderer.setData(chips)
    this.view = new ChipPaneView(this.renderer)
  }

  attached(param: SeriesAttachedParameter<Time>): void {
    const series = param.series
    this.renderer.setConverter((price) => series.priceToCoordinate(price))
    param.requestUpdate()
  }

  detached(): void {
    this.renderer.setConverter(() => null)
  }

  paneViews(): readonly ISeriesPrimitivePaneView[] {
    return [this.view]
  }

  updateAllViews(): void {
    /* 无自持坐标，全部在 draw 时经 priceToCoordinate 现算，无需更新 */
  }
}
