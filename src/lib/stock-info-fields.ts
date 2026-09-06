/**
 * 个股日K信息条指标自定义配置（DSH 插件版，精简）。
 * 内置指标注册表 + 分组，持久化到 localStorage。
 */

export type LevelType = 'sr' | 'pivot' | 'extreme' | 'boll' | 'keltner_s' | 'keltner_m' | 'keltner_l' | 'atr_stop' | 'gap' | 'fib' | 'round'

export interface PriceLevel {
  value: number
  label: string
  type: LevelType
  side: 'resistance' | 'support' | 'neutral'
  strength?: 'strong' | 'medium' | 'weak'
  rank?: number
}

export interface LevelSeries {
  boll?: { upper: (number | null)[]; lower: (number | null)[]; mid?: (number | null)[] }
  keltner_s?: { upper: (number | null)[]; lower: (number | null)[] }
  keltner_m?: { upper: (number | null)[]; lower: (number | null)[] }
  keltner_l?: { upper: (number | null)[]; lower: (number | null)[] }
  atr?: { stop_loss: (number | null)[]; take_profit: (number | null)[] }
}

export interface StockLevels {
  levels: Record<LevelType, PriceLevel[]>
  close: number | null
  summary: string
  symbol: string
  dates?: string[]
  series?: LevelSeries
}

// ===== ColumnConfig 模型（信息条指标）=====

export interface ColumnConfig {
  id: string
  source: { type: 'builtin'; key: string } | { type: 'ext'; configId: string; fieldName: string }
  label: string
  visible: boolean
  standalone?: boolean
  align?: 'left' | 'right'
  extDisplay?: { displayMode?: 'text' | 'tag'; separator?: string; maxTags?: number; hiddenIndices?: number[] }
}

export interface ColumnGroup {
  id: string
  label: string
  icon: string
  keys: string[]
}

export const BUILTIN_INFO_FIELDS: ColumnConfig[] = [
  { id: 'builtin:market_cap', source: { type: 'builtin', key: 'market_cap' }, label: '市值', visible: true, align: 'left' },
  { id: 'builtin:float_market_cap', source: { type: 'builtin', key: 'float_market_cap' }, label: '流通值', visible: true, align: 'left' },
  { id: 'builtin:turnover', source: { type: 'builtin', key: 'turnover' }, label: '换手', visible: true, align: 'left' },
  { id: 'builtin:volume', source: { type: 'builtin', key: 'volume' }, label: '成交量', visible: false, align: 'left' },
  { id: 'builtin:amplitude', source: { type: 'builtin', key: 'amplitude' }, label: '振幅', visible: false, align: 'left' },
  { id: 'builtin:open', source: { type: 'builtin', key: 'open' }, label: '开盘', visible: false, align: 'left' },
  { id: 'builtin:high', source: { type: 'builtin', key: 'high' }, label: '最高', visible: false, align: 'left' },
  { id: 'builtin:low', source: { type: 'builtin', key: 'low' }, label: '最低', visible: false, align: 'left' },
  { id: 'builtin:eps', source: { type: 'builtin', key: 'eps' }, label: 'EPS', visible: false, align: 'left' },
  { id: 'builtin:bps', source: { type: 'builtin', key: 'bps' }, label: 'BPS', visible: false, align: 'left' },
  { id: 'builtin:roe', source: { type: 'builtin', key: 'roe' }, label: 'ROE', visible: false, align: 'left' },
  { id: 'builtin:pe_ttm', source: { type: 'builtin', key: 'pe_ttm' }, label: 'PE', visible: false, align: 'left' },
  { id: 'builtin:pb', source: { type: 'builtin', key: 'pb' }, label: 'PB', visible: false, align: 'left' },
  { id: 'builtin:gross_margin', source: { type: 'builtin', key: 'gross_margin' }, label: '毛利率', visible: false, align: 'left' },
  { id: 'builtin:net_margin', source: { type: 'builtin', key: 'net_margin' }, label: '净利率', visible: false, align: 'left' },
  { id: 'builtin:debt_ratio', source: { type: 'builtin', key: 'debt_ratio' }, label: '负债率', visible: false, align: 'left' },
  { id: 'builtin:revenue_yoy', source: { type: 'builtin', key: 'revenue_yoy' }, label: '营收增速', visible: false, align: 'left' },
  { id: 'builtin:net_income_yoy', source: { type: 'builtin', key: 'net_income_yoy' }, label: '净利增速', visible: false, align: 'left' },
]

export const INFO_GROUPS: ColumnGroup[] = [
  { id: 'scale', label: '规模', icon: '🏦', keys: ['market_cap', 'float_market_cap'] },
  { id: 'volume', label: '成交', icon: '📊', keys: ['turnover', 'volume', 'amplitude'] },
  { id: 'quote', label: '行情', icon: '📈', keys: ['open', 'high', 'low'] },
  { id: 'finance', label: '财务', icon: '📋', keys: ['eps', 'bps', 'roe', 'pe_ttm', 'pb', 'gross_margin', 'net_margin', 'debt_ratio', 'revenue_yoy', 'net_income_yoy'] },
]

// ===== localStorage 持久化 =====

function getStorage(): Storage | null {
  try { return window.localStorage } catch { return null }
}

export function loadInfoFields(): ColumnConfig[] {
  const st = getStorage()
  if (st) {
    const saved = st.getItem('stock-info-bar-fields')
    if (saved) {
      try {
        const parsed = JSON.parse(saved) as ColumnConfig[]
        if (parsed.length > 0) return mergeFields(parsed)
      } catch { /* ignore */ }
    }
  }
  return [...BUILTIN_INFO_FIELDS]
}

export function saveInfoFields(columns: ColumnConfig[]): void {
  const st = getStorage()
  if (st) {
    try { st.setItem('stock-info-bar-fields', JSON.stringify(columns)) } catch { /* ignore */ }
  }
}

function mergeFields(saved: ColumnConfig[]): ColumnConfig[] {
  // 简单合并：保留用户配置，补齐缺失的默认项
  const result = [...saved]
  for (const def of BUILTIN_INFO_FIELDS) {
    if (!result.some(f => f.id === def.id)) result.push(def)
  }
  return result
}
