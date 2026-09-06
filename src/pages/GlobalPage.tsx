/**
 * 扩展市场页（M10：GlobalPage，Tab「外盘」）。
 *
 * 依据 MIGRATION-PLAN §5 M10：goods_quotes / goods_kline / goods_varieties。
 *   - 美股 / 港股：预设标的 chips → 选中后报价摘要 + K 线（复用 KlineChart，无 MA）；
 *   - 期货：goods_varieties（多市场合并）「今日异动快览」列表（仅报价，无图——
 *     期货合约行情的市场编码未在工具侧稳定，点选跳图留待复验）。
 *
 * 周末/非 A 股交易时段该数据源通常仍可用（实测 HK/US 正常）。
 */

import { useEffect, useMemo, useRef, useState } from 'react'
import { Globe } from 'lucide-react'
import { KlineChart } from '@/components/KlineChart'
import type { KlineRow } from '@/lib/api'
import type { McpKlineRow, QuoteRow } from '@/lib/stock-data'
import {
  fetchGoodsKlines,
  fetchGoodsQuote,
  fetchGoodsVarieties,
  type GoodsVarietyRow,
} from '@/lib/stock-data'
import { runPool } from '@/lib/pool'

const UP = '#c74040'
const DOWN = '#2d9b65'

type MarketKey = 'us' | 'hk' | 'futures'

interface MarketDef {
  key: MarketKey
  label: string
  mcpMarket: string
  symbols: { code: string; name: string }[]
}

const MARKETS: MarketDef[] = [
  {
    key: 'us',
    label: '美股',
    mcpMarket: 'US_STOCK',
    symbols: [
      { code: 'TSLA', name: '特斯拉' },
      { code: 'NVDA', name: '英伟达' },
      { code: 'AAPL', name: '苹果' },
      { code: 'MSFT', name: '微软' },
      { code: 'META', name: 'Meta' },
      { code: 'AMD', name: '超威' },
      { code: 'PLTR', name: 'Palantir' },
      { code: 'BABA', name: '阿里巴巴' },
    ],
  },
  {
    key: 'hk',
    label: '港股',
    mcpMarket: 'HK_MAIN_BOARD',
    symbols: [
      { code: '00700', name: '腾讯控股' },
      { code: '09988', name: '阿里巴巴' },
      { code: '03690', name: '美团' },
      { code: '01810', name: '小米集团' },
      { code: '09618', name: '京东集团' },
      { code: '01024', name: '快手' },
      { code: '00941', name: '中国移动' },
    ],
  },
  { key: 'futures', label: '期货', mcpMarket: '', symbols: [] },
]

/** 期货品种 market_id 探测集合（服务端未提供映射文档，逐一拉取合并展示）。 */
const FUTURES_IDS = [1, 2, 3, 4, 5, 6]

function toKlineRows(rows: McpKlineRow[]): KlineRow[] {
  return rows
    .filter((r) => Number.isFinite(r.close))
    .map((r) => ({
      date: String(r.datetime).slice(0, 10),
      open: Number(r.open),
      high: Number(r.high),
      low: Number(r.low),
      close: Number(r.close),
      volume: Number(r.vol ?? r.volume ?? 0),
      amount: Number(r.amount ?? 0),
    }))
}

export function GlobalPage() {
  const [marketKey, setMarketKey] = useState<MarketKey>('us')
  const [sel, setSel] = useState<{ market: string; code: string; name: string } | null>(null)
  const [quote, setQuote] = useState<QuoteRow | null>(null)
  const [rows, setRows] = useState<KlineRow[]>([])
  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState('')

  // 期货合并列表（进入 futures 模式时拉一次）
  const [varieties, setVarieties] = useState<GoodsVarietyRow[]>([])
  const [varLoading, setVarLoading] = useState(false)
  const varLoadedRef = useRef(false)

  const market = MARKETS.find((m) => m.key === marketKey)!

  useEffect(() => {
    if (marketKey !== 'futures' || varLoadedRef.current) return
    varLoadedRef.current = true
    setVarLoading(true)
    void runPool(FUTURES_IDS, (id) => fetchGoodsVarieties(id, 60), { concurrency: 4 }).then((lists) => {
      const merged: GoodsVarietyRow[] = []
      for (const l of lists) if (l) merged.push(...l)
      setVarieties(merged)
      setVarLoading(false)
    })
  }, [marketKey])

  // 选中标的 → 报价 + K 线
  useEffect(() => {
    if (!sel || marketKey === 'futures') return
    let cancelled = false
    setLoading(true)
    setErr('')
    void Promise.allSettled([
      fetchGoodsQuote(sel.market, sel.code),
      fetchGoodsKlines(sel.market, sel.code, 'DAILY', 160),
    ]).then(([q, k]) => {
      if (cancelled) return
      setQuote(q.status === 'fulfilled' ? q.value : null)
      setRows(k.status === 'fulfilled' ? toKlineRows(k.value) : [])
      setLoading(false)
    })
    return () => {
      cancelled = true
    }
  }, [sel, marketKey])

  const futuresTop = useMemo(() => {
    const list = [...varieties].filter((v) => Number.isFinite(Number(v.change_pct)) && Number(v.price))
    list.sort((a, b) => Number(b.change_pct) - Number(a.change_pct))
    return list.slice(0, 40)
  }, [varieties])

  // 报价摘要：优先 goods_quotes；缺失（如网关侧美股 quote 空）回退 K 线末两收盘自算
  const summary = useMemo(() => {
    const qClose = quote ? Number(quote.close) : NaN
    if (Number.isFinite(qClose)) {
      const pre = Number(quote!.pre_close)
      return { last: qClose, pct: pre > 0 ? ((qClose - pre) / pre) * 100 : null, decimals: Number(quote!.decimal_point) || 2 }
    }
    if (rows.length >= 1) {
      const last = Number(rows[rows.length - 1].close)
      const pre = rows.length >= 2 ? Number(rows[rows.length - 2].close) : 0
      return { last, pct: pre > 0 ? ((last - pre) / pre) * 100 : null, decimals: 2 }
    }
    return null
  }, [quote, rows])

  return (
    <div className="h-full overflow-y-auto px-2.5 pb-3">
      <div className="ds-sticky-head -mx-2.5 mb-1.5 flex items-center justify-between border-b border-slate-100 px-2.5 pb-1.5 pt-2">
        <span className="flex items-center gap-1.5 text-[13px] font-semibold text-slate-800">
          <Globe className="h-3.5 w-3.5 text-emerald-500" />
          外盘 · 扩展市场
        </span>
      </div>

      {/* 市场切换 */}
      <div className="mb-1.5 flex gap-1">
        {MARKETS.map((m) => (
          <button
            key={m.key}
            onClick={() => {
              setMarketKey(m.key)
              if (m.key !== 'futures') setSel({ market: m.mcpMarket, code: m.symbols[0].code, name: m.symbols[0].name })
            }}
            className={`flex-1 rounded px-1 py-1 text-[11px] font-medium ${marketKey === m.key ? 'bg-emerald-500 text-white' : 'bg-slate-100 text-slate-400'}`}
          >
            {m.label}
          </button>
        ))}
      </div>

      {marketKey !== 'futures' && (
        <>
          {/* 预设标的 chips */}
          <div className="mb-1.5 grid grid-cols-2 gap-1">
            {market.symbols.map((s) => {
              const active = sel?.code === s.code
              return (
                <button
                  key={s.code}
                  onClick={() => setSel({ market: market.mcpMarket, code: s.code, name: s.name })}
                  className={`rounded border px-1.5 py-1 text-left ${active ? 'border-emerald-400 bg-emerald-50' : 'border-slate-100 bg-white hover:bg-emerald-50/50'}`}
                >
                  <div className="flex items-baseline gap-1">
                    <span className="min-w-0 flex-1 truncate text-[10px] font-medium text-slate-700">{s.name}</span>
                    <span className="font-mono text-[8px] text-slate-300">{s.code}</span>
                  </div>
                </button>
              )
            })}
          </div>

          {/* 报价摘要 + K 线 */}
          {err && <div className="mb-1.5 rounded bg-red-50 px-2 py-1 text-[10px] text-red-500">{err}</div>}
          {sel && (
            <div className="rounded-md border border-slate-100 bg-slate-50/60 px-2 py-1.5">
              <div className="mb-1 flex items-baseline justify-between gap-2">
                <span className="min-w-0 truncate text-[11px] font-medium text-slate-600">
                  {quote?.name || sel.name} <span className="font-mono text-[9px] text-slate-300">{sel.code}</span>
                </span>
                {summary && (
                  <span className="shrink-0 font-mono text-[13px] font-bold tabular-nums" style={{ color: (summary.pct ?? 0) > 0 ? UP : (summary.pct ?? 0) < 0 ? DOWN : '#94a3b8' }}>
                    {summary.last.toFixed(summary.decimals)}{' '}
                    {summary.pct != null ? `${summary.pct > 0 ? '+' : ''}${summary.pct.toFixed(2)}%` : '—'}
                  </span>
                )}
              </div>
              {loading && <div className="py-6 text-center text-[10px] text-slate-300">加载中…</div>}
              {!loading && rows.length > 0 && (
                <KlineChart symbol={`${sel.market}:${sel.code}`} height={220} rows={rows} showMA={false} />
              )}
              {!loading && !rows.length && (
                <div className="py-6 text-center text-[10px] text-slate-300">暂无 K 线数据（该市场/标的可能不可达）</div>
              )}
            </div>
          )}
        </>
      )}

      {marketKey === 'futures' && (
        <div className="rounded-md border border-slate-100 bg-slate-50/60 px-2 py-1.5">
          <div className="mb-1 flex items-center justify-between">
            <span className="text-[10px] font-medium text-slate-400">期货异动快览（多市场合并 · top 40）</span>
            {varLoading && <span className="text-[9px] text-slate-300">加载中…</span>}
          </div>
          {!varLoading && futuresTop.length === 0 && (
            <div className="py-2 text-center text-[10px] text-slate-300">暂无期货数据（数据源不可达）</div>
          )}
          {!varLoading && futuresTop.length > 0 && (
            <div className="space-y-0.5">
              <div className="grid grid-cols-[1fr_70px_56px] gap-1 px-1 text-[8px] text-slate-300">
                <span>合约</span>
                <span className="text-right">最新</span>
                <span className="text-right">涨跌%</span>
              </div>
              {futuresTop.map((v, i) => (
                <div key={`${v.name}-${i}`} className="grid grid-cols-[1fr_70px_56px] items-center gap-1 rounded px-1 py-0.5 font-mono text-[9px] tabular-nums odd:bg-white/70">
                  <span className="min-w-0 truncate text-slate-700">{v.name}</span>
                  <span className="text-right text-slate-500">{Number(v.price).toFixed(Number(v.price) > 1000 ? 0 : 1)}</span>
                  <span className="text-right" style={{ color: Number(v.change_pct) > 0 ? UP : Number(v.change_pct) < 0 ? DOWN : '#94a3b8' }}>
                    {Number(v.change_pct) > 0 ? '+' : ''}{Number(v.change_pct).toFixed(2)}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
