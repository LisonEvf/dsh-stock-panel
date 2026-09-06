// 数字 / 价格 / 涨跌幅 格式化（DSH 插件版，精简）

export function fmtPrice(v: number | null | undefined, digits = 2): string {
  if (v == null || Number.isNaN(v)) return '—'
  return v.toFixed(digits)
}

export function fmtPct(v: number | null | undefined, digits = 2): string {
  if (v == null || Number.isNaN(v)) return '—'
  const sign = v > 0 ? '+' : ''
  return `${sign}${(v * 100).toFixed(digits)}%`
}

export function fmtVolume(v: number | null | undefined): string {
  if (v == null || Number.isNaN(v)) return '—'
  if (v >= 1e8) return `${(v / 1e8).toFixed(2)}亿`
  if (v >= 1e4) return `${(v / 1e4).toFixed(2)}万`
  return v.toFixed(0)
}

export function fmtBigNum(v: number | null | undefined): string {
  if (v == null || Number.isNaN(v)) return '—'
  const sign = v < 0 ? '-' : ''
  const abs = Math.abs(v)
  if (abs >= 1_000_000_000_000) return `${sign}${(abs / 1_000_000_000_000).toFixed(2)}万亿`
  if (abs >= 100_000_000) return `${sign}${(abs / 100_000_000).toFixed(2)}亿`
  if (abs >= 10_000) return `${sign}${(abs / 10_000).toFixed(0)}万`
  return v.toFixed(0)
}

export function fmtDate(s: string | Date | null | undefined): string {
  if (s == null) return '—'
  const d = typeof s === 'string' ? new Date(s) : s
  if (isNaN(d.getTime())) return String(s)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

// A 股语义色:红涨绿跌
export function priceColorClass(v: number | null | undefined): string {
  if (v == null || Number.isNaN(v) || v === 0) return 'text-slate-400'
  return v > 0 ? 'text-red-600' : 'text-green-600'
}
