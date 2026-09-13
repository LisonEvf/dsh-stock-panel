// 数字 / 价格 / 涨跌幅 格式化（DSH 插件版，精简）

export function fmtPrice(v: number | null | undefined, digits = 2): string {
  if (v == null || Number.isNaN(v)) return '—'
  return v.toFixed(digits)
}

/**
 * 涨跌幅（**小数**，如 0.035 = +3.5%）→ "+3.50%"。
 *
 * ⚠️ 口径陷阱：行情链路里的 `quotePct()` / `AShareRow.pct` / `IndexQuote.pct`
 * 给的都是**百分数**（3.5 表示 +3.5%），喂给本函数会被再 ×100（-1.18% → -118%）。
 * 百分数入参请用 `@/lib/market` 的 `pctText()`。
 */
export function fmtPct(v: number | null | undefined, digits = 2): string {
  return fmtPctRatio(v, digits)
}

/** 小数口径 → "+3.50%"（`fmtPct` 的显式名字，避免口径搞混）。 */
export function fmtPctRatio(v: number | null | undefined, digits = 2): string {
  if (v == null || Number.isNaN(v)) return '—'
  const sign = v > 0 ? '+' : ''
  return `${sign}${(v * 100).toFixed(digits)}%`
}

/** 百分数口径 → "+3.50%"（入参已是 3.5）。与 `market.pctText` 同口径，供非行情路径复用。 */
export function fmtPctPercent(v: number | null | undefined, digits = 2): string {
  if (v == null || Number.isNaN(v)) return '—'
  const sign = v > 0 ? '+' : ''
  return `${sign}${v.toFixed(digits)}%`
}

export function fmtVolume(v: number | null | undefined): string {
  if (v == null || Number.isNaN(v)) return '—'
  if (v >= 1e8) return `${(v / 1e8).toFixed(2)}亿`
  if (v >= 1e4) return `${(v / 1e4).toFixed(2)}万`
  return v.toFixed(0)
}

/**
 * 金额（元）→ 万亿/亿/万 的**唯一入口**。
 *
 * 为什么必须只有一个入口：实测同一个数在两处显示成不同单位 ——
 * 状态带手算 `(x/1e8).toFixed(0)` 得到 `19870亿`，市场总览走本函数得到 `1.99万亿`，
 * 同屏可比性直接失效。任何"亿/万亿"都要走这里（禁止在组件里手算 1e8/1e12）。
 */
export function fmtAmount(v: number | null | undefined): string {
  if (v == null || Number.isNaN(v)) return '—'
  const sign = v < 0 ? '-' : ''
  const abs = Math.abs(v)
  if (abs >= 1_000_000_000_000) return `${sign}${(abs / 1_000_000_000_000).toFixed(2)}万亿`
  if (abs >= 100_000_000) return `${sign}${(abs / 100_000_000).toFixed(2)}亿`
  if (abs >= 10_000) return `${sign}${(abs / 10_000).toFixed(0)}万`
  return v.toFixed(0)
}

/** @deprecated 用 `fmtAmount`（同实现，保留旧名以免一次性改动过大）。 */
export function fmtBigNum(v: number | null | undefined): string {
  return fmtAmount(v)
}

export function fmtDate(s: string | Date | null | undefined): string {
  if (s == null) return '—'
  const d = typeof s === 'string' ? new Date(s) : s
  if (isNaN(d.getTime())) return String(s)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/**
 * A 股语义色 **class**（红涨绿跌）—— DOM 场景一律用类，别写色值：
 * 类名跟着 `--dc-*` token 走，自动跟随明暗主题。
 *
 * （canvas/图表需要具体色值时用 `@/lib/theme-colors` 的 `themeColor('up')`。）
 */
export function priceColorClass(v: number | null | undefined): string {
  if (v == null || Number.isNaN(v) || v === 0) return 'dc-flat'
  return v > 0 ? 'dc-up' : 'dc-down'
}

/** 同上，但接受"是否上涨"的布尔（有些链路只有方向没有幅度）。 */
export function upDownClass(up: boolean | null | undefined, flat = false): string {
  if (up == null || flat) return 'dc-flat'
  return up ? 'dc-up' : 'dc-down'
}
