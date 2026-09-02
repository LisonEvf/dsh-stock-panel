import { useEffect, useRef, useState } from 'react'
import { Search, X } from 'lucide-react'
import { api } from '@/lib/api'

interface SearchResult {
  symbol: string
  name: string
  code: string
}

interface Props {
  onSelect: (symbol: string) => void
  initialSymbol?: string
}

/** 标的搜索下拉：输入关键字 → 后端搜索 → 点击选中 */
export function InstrumentSearch({ onSelect, initialSymbol }: Props) {
  const [query, setQuery] = useState(initialSymbol ?? '')
  const [results, setResults] = useState<SearchResult[]>([])
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)

  // 点击外部关闭
  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [])

  // 防抖搜索
  useEffect(() => {
    const q = query.trim()
    if (q.length < 1) { setResults([]); setOpen(false); return }
    setLoading(true)
    const timer = setTimeout(async () => {
      try {
        const res = await api.instrumentSearch(q, 10)
        setResults(res.results)
        setOpen(true)
      } catch {
        setResults([])
      } finally {
        setLoading(false)
      }
    }, 300)
    return () => clearTimeout(timer)
  }, [query])

  const handleSelect = (symbol: string) => {
    onSelect(symbol)
    setOpen(false)
  }

  return (
    <div ref={containerRef} className="relative w-48">
      <div className="relative">
        <Search className="pointer-events-none absolute left-2 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onFocus={() => results.length > 0 && setOpen(true)}
          className="w-full rounded-md border border-slate-300 py-1 pl-8 pr-8 text-sm font-mono focus:border-emerald-500 focus:outline-none"
          placeholder="搜索代码/名称"
          autoComplete="off"
        />
        {query && (
          <button
            onClick={() => { setQuery(''); setResults([]); setOpen(false) }}
            className="absolute right-1 top-1/2 -translate-y-1/2 rounded p-0.5 text-slate-400 hover:text-slate-600"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        )}
      </div>

      {open && (results.length > 0 || loading) && (
        <div className="absolute z-50 mt-1 max-h-64 w-full overflow-auto rounded-md border border-slate-200 bg-white py-1 shadow-lg">
          {loading ? (
            <div className="px-3 py-2 text-xs text-slate-400">搜索中…</div>
          ) : (
            results.map((r, i) => (
              <button
                key={i}
                onClick={() => handleSelect(r.symbol)}
                className="flex w-full items-center justify-between px-3 py-2 text-left text-sm hover:bg-emerald-50"
              >
                <span className="font-mono text-slate-700">{r.symbol}</span>
                <span className="text-slate-500">{r.name || r.code}</span>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  )
}
