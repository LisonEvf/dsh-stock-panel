import { useState, type ReactNode } from 'react'
import { Settings2, RadioTower, Star } from 'lucide-react'
import type { KlineRow, FinancialMetricRecord } from '@/lib/api'
import { fmtPrice, fmtBigNum, fmtVolume } from '@/lib/format'
import { INFO_GROUPS, type ColumnConfig } from '@/lib/stock-info-fields'

const BULL = 'var(--dc-up)'
const BEAR = 'var(--dc-down)'

interface Props {
  symbol: string
  name?: string
  stockInfo?: { name?: string; total_shares?: number; float_shares?: number; ext?: Record<string, unknown> }
  rows: KlineRow[]
  fields: ColumnConfig[]
  onFieldsChange: (fields: ColumnConfig[]) => void
  financialMetrics?: FinancialMetricRecord
  onMonitor?: () => void
  inWatchlist?: boolean
  onToggleWatchlist?: () => void
}

/** 精简渲染扩展数据值（信息条专用） */
function renderExtInline(val: unknown, col: ColumnConfig, expanded: boolean, onToggle: () => void): ReactNode {
  if (val == null || (typeof val === 'number' && Number.isNaN(val))) return <span className="text-slate-400">—</span>
  if (typeof val === 'number') {
    const displayVal = Number.isInteger(val) ? fmtPrice(val, 0) : fmtPrice(val)
    return <span className="tabular-nums">{displayVal}</span>
  }
  if (typeof val === 'boolean') {
    return <span className={val ? 'text-red-600' : 'text-slate-400'}>{val ? '是' : '否'}</span>
  }
  const str = String(val)
  if (col.extDisplay?.displayMode === 'text') return <span>{str}</span>
  const sep = col.extDisplay?.separator?.trim() || null
  const tags = sep ? str.split(sep).map(s => s.trim()).filter(Boolean) : str.split(/[、,，;；\-]/).map(s => s.trim()).filter(Boolean)
  if (tags.length === 0) return <span className="text-slate-400">—</span>
  const maxTags = col.extDisplay?.maxTags ?? 0
  const showAll = maxTags <= 0 || expanded
  const sliced = showAll ? tags : tags.slice(0, maxTags)
  const overflow = tags.length - sliced.length
  return (
    <span className="inline-flex flex-wrap items-center gap-0.5">
      {sliced.map((tag, i) => (
        <span key={i} className="inline-block px-1 rounded dc-t-data leading-tight text-yellow-600 bg-yellow-500/10">{tag}</span>
      ))}
      {!showAll && overflow > 0 && (
        <button onClick={onToggle} className="inline-block px-1 rounded dc-t-data leading-tight text-blue-600 bg-blue-500/10">+{overflow}</button>
      )}
    </span>
  )
}

export function StockInfoBar({ symbol, name, stockInfo, rows, fields, onFieldsChange, financialMetrics, onMonitor, inWatchlist, onToggleWatchlist }: Props) {
  const [customizerOpen, setCustomizerOpen] = useState(false)
  const [expandedExt, setExpandedExt] = useState<Set<string>>(new Set())

  const toggleExtExpand = (key: string) => {
    setExpandedExt(prev => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  if (rows.length === 0) return null

  const latest = rows[rows.length - 1]
  const prev = rows.length >= 2 ? rows[rows.length - 2] : null
  const close = Number(latest.close)
  const chg = prev ? close - Number(prev.close) : 0
  const chgPct = prev ? chg / Number(prev.close) * 100 : 0
  const isUp = chg >= 0
  const clr = isUp ? BULL : BEAR

  const totalShares = stockInfo?.total_shares
  const floatShares = stockInfo?.float_shares
  const marketCap = totalShares ? close * totalShares : null
  const floatMarketCap = floatShares ? close * floatShares : null
  const turnoverRate = floatShares && latest.volume
    ? (Number(latest.volume) * 100 / floatShares * 100)
    : null

  const displayName = stockInfo?.name ?? name ?? ''

  const computeBuiltinValue = (key: string): string | null => {
    switch (key) {
      case 'market_cap':       return marketCap != null ? fmtBigNum(marketCap) : null
      case 'float_market_cap': return floatMarketCap != null ? fmtBigNum(floatMarketCap) : null
      case 'turnover':         return turnoverRate != null ? `${turnoverRate.toFixed(2)}%` : null
      case 'volume':           return latest.volume != null ? fmtVolume(Number(latest.volume)) : null
      case 'amplitude': {
        const prevClose = prev ? Number(prev.close) : null
        if (prevClose == null || prevClose === 0) return null
        const hi = Number(latest.high)
        const lo = Number(latest.low)
        return `${((hi - lo) / prevClose * 100).toFixed(2)}%`
      }
      case 'open': return fmtPrice(Number(latest.open))
      case 'high': return fmtPrice(Number(latest.high))
      case 'low':  return fmtPrice(Number(latest.low))
      case 'eps':         return financialMetrics?.eps_basic != null ? fmtPrice(financialMetrics.eps_basic) : null
      case 'bps':         return financialMetrics?.bps != null ? fmtPrice(financialMetrics.bps) : null
      case 'roe':         return financialMetrics?.roe != null ? `${financialMetrics.roe.toFixed(2)}%` : null
      case 'gross_margin':return financialMetrics?.gross_margin != null ? `${financialMetrics.gross_margin.toFixed(2)}%` : null
      case 'net_margin':  return financialMetrics?.net_margin != null ? `${financialMetrics.net_margin.toFixed(2)}%` : null
      case 'debt_ratio':  return financialMetrics?.debt_to_asset_ratio != null ? `${financialMetrics.debt_to_asset_ratio.toFixed(2)}%` : null
      case 'revenue_yoy': return financialMetrics?.revenue_yoy != null ? `${financialMetrics.revenue_yoy.toFixed(2)}%` : null
      case 'net_income_yoy': return financialMetrics?.net_income_yoy != null ? `${financialMetrics.net_income_yoy.toFixed(2)}%` : null
      case 'pe_ttm': {
        const eps = financialMetrics?.eps_basic
        return eps && eps !== 0 ? fmtPrice(close / eps) : null
      }
      case 'pb': {
        const bps = financialMetrics?.bps
        return bps && bps !== 0 ? fmtPrice(close / bps) : null
      }
      default: return null
    }
  }

  const visibleFields = fields.filter(f => f.visible)
  const inlineFields = visibleFields.filter(f => !f.standalone)
  const standaloneFields = visibleFields.filter(f => f.standalone)

  const toggleField = (id: string) => {
    onFieldsChange(fields.map(f => f.id === id ? { ...f, visible: !f.visible } : f))
  }

  const renderField = (f: ColumnConfig): ReactNode => {
    if (f.source.type === 'ext') {
      const { configId, fieldName } = f.source
      const val = stockInfo?.ext?.[`${configId}__${fieldName}`]
      if (val == null || (typeof val === 'number' && Number.isNaN(val))) return null
      const cellKey = `${symbol}::${f.id}`
      return (
        <span key={f.id} className="inline-flex items-center gap-1">
          <span>{f.label}</span>
          <span className="text-slate-600">{renderExtInline(val, f, expandedExt.has(cellKey), () => toggleExtExpand(cellKey))}</span>
        </span>
      )
    }
    const value = computeBuiltinValue(f.source.type === 'builtin' ? f.source.key : '')
    if (value == null) return null
    // 审计：这一处原本是 `<span onClick>`（键盘不可达，10 处同类问题之一）。
    // 改成真正的 button：Tab 可达、Enter/Space 可触发、读屏能报出"按钮"。
    // 视觉上用 `inline` 保持原有行内排版（button 默认是 inline-block，会撑出行高差）。
    return (
      <button
        key={f.id}
        type="button"
        className="inline cursor-pointer text-left hover:text-slate-900"
        onClick={() => toggleField(f.id)}
      >
        {f.label} <span className="text-slate-600">{value}</span>
      </button>
    )
  }

  return (
    <div className="px-2 pb-3 font-mono dc-t-data select-none space-y-1">
      {/* Row 1: code, name, price, change */}
      <div className="flex items-baseline gap-x-3 flex-wrap">
        <span className="text-slate-900 font-bold text-sm tracking-wide">{symbol}</span>
        <span className="text-slate-600 font-medium">{displayName}</span>
        <span style={{ color: clr }} className="text-lg font-bold tabular-nums">{fmtPrice(close)}</span>
        <span style={{ color: clr }} className="tabular-nums">{isUp ? '+' : ''}{fmtPrice(chg)}</span>
        <span style={{ color: clr }} className="tabular-nums">{isUp ? '+' : ''}{fmtPrice(chgPct)}%</span>
        <div className="ml-auto self-center flex items-center gap-1">
          {onToggleWatchlist && (
            <button onClick={onToggleWatchlist} className={`p-1 rounded-btn transition-colors cursor-pointer ${inWatchlist ? 'text-yellow-500' : 'text-slate-400 hover:text-slate-700'}`} title={inWatchlist ? '移出自选' : '加自选'}>
              <Star className="h-3.5 w-3.5" />
            </button>
          )}
          {onMonitor && (
            <button onClick={onMonitor} className="p-1 rounded-btn text-amber-500 hover:bg-amber-500/10 transition-colors cursor-pointer" title="加监控">
              <RadioTower className="h-3.5 w-3.5" />
            </button>
          )}
          <button onClick={() => setCustomizerOpen(true)} className="p-1 rounded-btn text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors" title="自定义信息条">
            <Settings2 className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      {/* Row 2: 普通指标。
          用 auto-fit 等宽网格：字段是**用户可配**的（10 个上下），flex-wrap 会让"量比 1.33"
          这类短字段后面的位置随内容长度漂移；网格让同类指标在各种票之间纵向对齐，
          也自动按可用宽度决定列数（主区 1148px 时一屏 8–9 列，不必缩字号）。 */}
      {inlineFields.length > 0 && (
        <div
          className="grid items-baseline gap-x-4 gap-y-1 dc-t-note text-slate-500"
          style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(11ch, 1fr))' }}
        >
          {inlineFields.map(renderField)}
        </div>
      )}

      {standaloneFields.length > 0 && (
        <div className="space-y-1">
          {standaloneFields.map(f => {
            const node = renderField(f)
            if (node == null) return null
            return <div key={f.id} className="flex items-center gap-x-4 dc-t-note flex-wrap text-slate-500">{node}</div>
          })}
        </div>
      )}

      {customizerOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={() => setCustomizerOpen(false)}>
          <div className="w-72 rounded-lg bg-white p-4 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <h3 className="mb-3 text-sm font-semibold text-slate-800">信息条指标</h3>
            {INFO_GROUPS.map(group => (
              <div key={group.id} className="mb-3">
                <div className="mb-1 text-xs font-medium text-slate-500">{group.icon} {group.label}</div>
                <div className="flex flex-wrap gap-1">
                  {fields.filter(f => f.source.type === 'builtin' && group.keys.includes(f.source.key)).map(f => (
                    <button
                      key={f.id}
                      onClick={() => toggleField(f.id)}
                      className={`rounded px-2 py-0.5 dc-t-note transition-colors ${f.visible ? 'bg-blue-500/10 text-blue-600' : 'bg-slate-100 text-slate-400'}`}
                    >
                      {f.label}
                    </button>
                  ))}
                </div>
              </div>
            ))}
            <button onClick={() => setCustomizerOpen(false)} className="mt-2 w-full rounded-md bg-slate-800 py-1.5 text-xs text-white">完成</button>
          </div>
        </div>
      )}
    </div>
  )
}
