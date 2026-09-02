import { useEffect, useState } from 'react'
import { Star, Trash2, ChevronRight } from 'lucide-react'
import { api, type WatchlistEntry } from '@/lib/api'

interface Props {
  symbols: string[]
  onRemove: (symbol: string) => void
  onClear: () => void
}

/** 自选股列表：从后端拉取，支持移除/清空 */
export function Watchlist({ symbols, onRemove, onClear }: Props) {
  const [items, setItems] = useState<WatchlistEntry[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const res = await api.watchlistList()
        if (cancelled) return
        setItems(res.symbols)
      } catch {
        /* ignore */
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [])

  const handleRemove = async (symbol: string) => {
    await api.watchlistRemove(symbol)
    onRemove(symbol)
    setItems(prev => prev.filter(s => s.symbol !== symbol))
  }

  const handleClear = async () => {
    await api.watchlistClear()
    onClear()
    setItems([])
  }

  return (
    <div className="flex flex-col">
      <div className="mb-2 flex items-center justify-between">
        <h3 className="text-xs font-medium text-slate-500">自选股 ({items.length})</h3>
        {items.length > 0 && (
          <button onClick={handleClear} className="text-[10px] text-slate-400 hover:text-red-500">清空</button>
        )}
      </div>

      {loading ? (
        <div className="text-xs text-slate-400 py-2">加载中…</div>
      ) : items.length === 0 ? (
        <div className="text-xs text-slate-400 py-2">暂无自选，在图表区点击 ⭐ 添加</div>
      ) : (
        <ul className="space-y-1">
          {items.map((item) => (
            <li key={item.symbol} className="flex items-center justify-between rounded bg-slate-50 px-2 py-1">
              <div className="flex items-center gap-1.5 min-w-0">
                <Star className="h-3 w-3 shrink-0 text-yellow-500" />
                <span className="font-mono text-xs text-slate-700">{item.symbol}</span>
                {item.name && <span className="truncate text-[10px] text-slate-400">{item.name}</span>}
              </div>
              <div className="flex items-center gap-1">
                <ChevronRight className="h-3 w-3 text-slate-300" />
                <button
                  onClick={() => handleRemove(item.symbol)}
                  className="p-0.5 text-slate-300 hover:text-red-500"
                  title="移出自选"
                >
                  <Trash2 className="h-3 w-3" />
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
