/**
 * 逐笔成交面板（W3/M9）：transaction 最近 N 条，折叠区块。
 *
 * 字段实测（2026-09-04 数据）：time HH:MM:SS / price / vol / trade_count / bs_flag。
 * ⚠️ bs_flag（1=主动买/0=主动卖）与 vol 单位（手/股）语义待盘中复验 ——
 * 顶部悬浮标注口径，避免把不确定的语义当事实（PRODUCT-DESIGN §2.3 纪律）。
 */

import { useMemo, useState } from 'react'
import { ChevronDown, ChevronRight } from 'lucide-react'
import { fetchTransactions, type TransactionRow } from '@/lib/stock-data'
import { useSwr, swrKey } from '@/lib/cache'
import type { MarketTag } from '@/lib/symbol'

const BUY = '#c74040'
const SELL = '#2d9b65'

function timeSortKey(t: string): number {
  const m = t.match(/(\d{1,2}):(\d{2})(?::(\d{2}))?/)
  if (!m) return 0
  return Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3] ?? 0)
}

function toDisplay(rows: TransactionRow[]): { time: string; price: number; vol: number; count: number; dir: 'buy' | 'sell' | 'unknown' }[] {
  const list: { time: string; price: number; vol: number; count: number; dir: 'buy' | 'sell' | 'unknown' }[] = []
  for (const r of rows) {
    const time = String(r.time ?? '').trim()
    const price = Number(r.price)
    if (!time || !Number.isFinite(price)) continue
    const flag = Number(r.bs_flag)
    list.push({
      time,
      price,
      vol: Number(r.vol ?? 0),
      count: Number(r.trade_count ?? 0),
      dir: flag === 1 ? 'buy' : flag === 0 ? 'sell' : 'unknown',
    })
  }
  list.sort((a, b) => timeSortKey(b.time) - timeSortKey(a.time))
  return list
}

interface Props {
  market: MarketTag
  code: string
}

export function StockTransactions({ market, code }: Props) {
  const [open, setOpen] = useState(false)

  // 懒加载缓存：展开时才取数；命中缓存立即展示（秒开），后台验证失败会下线重试。
  const txSwr = useSwr(swrKey.transactions(market, code), () => fetchTransactions(market, code, 60), {
    ttl: 60_000,
    enabled: open,
  })
  const raw = txSwr.data ?? []
  const rows = useMemo(() => toDisplay(raw), [raw])
  const loading = txSwr.status === 'loading'
  const error = txSwr.error

  return (
    <div className="rounded-md border border-slate-100 bg-white">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-1 px-2 py-1 text-left"
        title="逐笔成交 · 方向/单位语义待盘中复验"
      >
        {open ? (
          <ChevronDown className="h-3 w-3 shrink-0 text-slate-300" />
        ) : (
          <ChevronRight className="h-3 w-3 shrink-0 text-slate-300" />
        )}
        <span className="text-[10px] font-medium text-slate-500">逐笔成交</span>
        {rows.length > 0 && (
          <span className="ml-auto font-mono text-[9px] text-slate-300">最新 {rows.length} 条</span>
        )}
      </button>
      {open && (
        <div className="border-t border-slate-100 px-1.5 py-1">
          {loading && <div className="py-2 text-center text-[10px] text-slate-300">逐笔加载中…</div>}
          {!loading && error && <div className="py-1 text-[10px] text-red-400">{error}</div>}
          {!loading && !error && rows.length === 0 && (
            <div className="py-2 text-center text-[10px] text-slate-300">暂无逐笔数据（休市/源空）</div>
          )}
          {!loading && rows.length > 0 && (
            <div className="ds-no-scrollbar max-h-44 overflow-y-auto">
              <div className="mb-0.5 grid grid-cols-[52px_1fr_52px_40px_28px] items-center gap-1 px-1 text-[8px] text-slate-300">
                <span>时间</span>
                <span className="text-right">价格</span>
                <span className="text-right">量</span>
                <span className="text-right">笔</span>
                <span className="text-right">向</span>
              </div>
              <div className="space-y-px">
                {rows.map((r, i) => (
                  <div
                    key={`${r.time}-${i}`}
                    className="grid grid-cols-[52px_1fr_52px_40px_28px] items-center gap-1 rounded px-1 py-px font-mono text-[9px] tabular-nums odd:bg-slate-50/60"
                  >
                    <span className="text-slate-400">{r.time}</span>
                    <span className="text-right" style={{ color: r.dir === 'buy' ? BUY : r.dir === 'sell' ? SELL : '#334155' }}>
                      {r.price.toFixed(2)}
                    </span>
                    <span className="text-right text-slate-500">{r.vol > 0 ? r.vol.toLocaleString() : '—'}</span>
                    <span className="text-right text-slate-400">{r.count || '—'}</span>
                    <span className="text-right" style={{ color: r.dir === 'buy' ? BUY : r.dir === 'sell' ? SELL : '#94a3b8' }}>
                      {r.dir === 'buy' ? '买' : r.dir === 'sell' ? '卖' : '·'}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
