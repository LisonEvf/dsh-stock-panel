import { useMemo } from 'react'
import type { PriceLevel, LevelType } from '@/lib/stock-info-fields'
import { fmtPrice } from '@/lib/format'

/** 价位组元数据（颜色/标签，与后端 levels.py 对齐） */
export const LEVEL_GROUPS: { key: LevelType; label: string; color: string }[] = [
  { key: 'sr', label: '压力支撑', color: '#F97316' },
  { key: 'pivot', label: '枢轴点', color: '#8B5CF6' },
  { key: 'extreme', label: '前高前低', color: '#EAB308' },
  { key: 'boll', label: '布林带', color: '#F97316' },
  { key: 'keltner_s', label: 'Keltner短期', color: '#06B6D4' },
  { key: 'keltner_m', label: 'Keltner中期', color: '#22D3EE' },
  { key: 'keltner_l', label: 'Keltner长期', color: '#67E8F9' },
  { key: 'atr_stop', label: 'ATR止损', color: '#EF4444' },
  { key: 'gap', label: '缺口位', color: '#EC4899' },
  { key: 'fib', label: '斐波那契', color: '#F59E0B' },
  { key: 'round', label: '整数关口', color: '#71717A' },
]

interface Props {
  levels: Record<LevelType, PriceLevel[]>
  close: number | null
  activeTypes?: Set<LevelType>
  onToggleType?: (t: LevelType) => void
}

/** 关键价位面板：按组显示压力/支撑位，标注与现价关系 */
export function PriceLevels({ levels, close, activeTypes, onToggleType }: Props) {
  const grouped = useMemo(() => {
    const result: { group: typeof LEVEL_GROUPS[0]; items: PriceLevel[] }[] = []
    for (const g of LEVEL_GROUPS) {
      const items = (levels[g.key] ?? []).slice(0, 3)
      if (items.length) result.push({ group: g, items })
    }
    return result
  }, [levels])

  if (grouped.length === 0) {
    return <div className="text-xs text-slate-400 py-4">暂无关键价位数据</div>
  }

  return (
    <div className="space-y-3">
      {grouped.map(({ group, items }) => {
        const active = !activeTypes || activeTypes.has(group.key)
        return (
          <div key={group.key} className={active ? '' : 'opacity-50'}>
            <div className="mb-1 flex items-center gap-2">
              <span className="dc-t-note font-medium" style={{ color: group.color }}>{group.label}</span>
              {onToggleType && (
                <button onClick={() => onToggleType(group.key)} className="dc-t-data text-slate-400 hover:text-slate-600">
                  {active ? '收起' : '展开'}
                </button>
              )}
            </div>
            <div className="grid grid-cols-2 gap-x-4 gap-y-1 dc-t-note">
              {items.map((p, i) => {
                const isResistance = p.side === 'resistance'
                const isSupport = p.side === 'support'
                const closeVal = close ?? 0
                const diffNum = closeVal ? p.value - closeVal : 0
                const diffPct = closeVal !== 0 ? (diffNum / closeVal) * 100 : 0
                return (
                  <div key={i} className="flex items-center justify-between">
                    <span className={isResistance ? 'text-red-500' : isSupport ? 'text-green-500' : 'text-slate-500'}>
                      {p.label}
                    </span>
                    <span className="tabular-nums text-slate-700">
                      {fmtPrice(p.value)}
                      <span className={`ml-1 dc-t-data ${diffNum > 0 ? 'text-red-400' : 'text-green-400'}`}>
                        {diffNum > 0 ? '+' : ''}{diffPct.toFixed(1)}%
                      </span>
                    </span>
                  </div>
                )
              })}
            </div>
          </div>
        )
      })}
      {close != null && (
        <div className="pt-1 dc-t-note text-slate-500 border-t border-slate-100">
          现价 {fmtPrice(close)}
        </div>
      )}
    </div>
  )
}
