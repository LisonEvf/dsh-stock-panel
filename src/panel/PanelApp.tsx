/**
 * 工作台面板壳（M5→M6）：顶部 Tab 导航 + 视图切换。
 *
 * Tab：市场总览 / 涨停梯队 / 指数 / 自选行情 / 个股。
 * 跨视图事件：市场·梯队·自选页点击某只股票 → 切到「个股」Tab 加载标的；
 * 市场页点击指数芯片 → 切到「指数」Tab 并选中该指数。
 */

import { useCallback, useRef, useState } from 'react'
import { MarketOverview } from '@/pages/MarketOverview'
import { LadderPage } from '@/pages/LadderPage'
import { IndicesPage } from '@/pages/IndicesPage'
import { WatchlistPage } from '@/pages/WatchlistPage'
import { StockDetailPage } from '@/pages/StockDetailPage'
import { WarPage } from '@/pages/WarPage'
import { ReviewPage } from '@/pages/ReviewPage'
import type { MarketTag } from '@/lib/symbol'

export type PanelTab = 'market' | 'ladder' | 'indices' | 'watchlist' | 'stock' | 'war' | 'review'

export interface OpenStock {
  market: MarketTag
  code: string
  name: string
}

const TABS: { key: PanelTab; label: string }[] = [
  { key: 'market', label: '市场' },
  { key: 'ladder', label: '梯队' },
  { key: 'indices', label: '指数' },
  { key: 'watchlist', label: '自选' },
  { key: 'stock', label: '个股' },
  { key: 'war', label: '作战' },
  { key: 'review', label: '复盘' },
]

export function PanelApp() {
  const [tab, setTab] = useState<PanelTab>('market')
  const [stock, setStock] = useState<OpenStock | null>(null)
  const [indexFocus, setIndexFocus] = useState<{ market: MarketTag; code: string; name: string } | null>(null)
  // 记录离开「个股」前的 Tab，供详情页 ‹ 返回
  const prevTabRef = useRef<PanelTab>('market')
  const prevTab = prevTabRef.current
  if (tab !== 'stock') {
    prevTabRef.current = tab
  }

  const openStock = useCallback((s: OpenStock) => {
    setStock(s)
    setTab('stock')
  }, [])

  const openIndex = useCallback((m: MarketTag, code: string, name: string) => {
    setIndexFocus({ market: m, code, name })
    setTab('indices')
  }, [])

  const goBackFromStock = useCallback(() => {
    setTab(prevTab === 'stock' ? 'market' : prevTab)
  }, [prevTab])

  return (
    <div className="flex h-full min-h-0 w-full flex-col bg-white text-slate-800">
      {/* Tab 导航（窄列可横向滚动，永不溢出） */}
      <div className="ds-no-scrollbar flex shrink-0 items-center overflow-x-auto border-b border-slate-200 px-1.5 pt-1">
        {TABS.map((t) => {
          const active = tab === t.key
          return (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={`relative shrink-0 whitespace-nowrap px-2 pb-1.5 pt-1 text-[12px] font-medium transition-colors ${
                active ? 'text-emerald-600' : 'text-slate-400 hover:text-slate-600'
              }`}
            >
              {t.label}
              {active && <span className="absolute inset-x-1 bottom-0 h-0.5 rounded-full bg-emerald-500" />}
            </button>
          )
        })}
      </div>

      {/* 视图 */}
      <div className="min-h-0 flex-1 overflow-hidden">
        {tab === 'market' && <MarketOverview onOpenStock={openStock} onOpenIndex={openIndex} />}
        {tab === 'ladder' && <LadderPage onOpenStock={openStock} />}
        {tab === 'indices' && <IndicesPage key={indexFocus ? `${indexFocus.market}${indexFocus.code}` : 'default'} initial={indexFocus} />}
        {tab === 'watchlist' && <WatchlistPage onOpenStock={openStock} />}
        {tab === 'stock' &&
          (stock ? (
            <StockDetailPage key={`${stock.market}${stock.code}`} open={stock} onBack={goBackFromStock} />
          ) : (
            <div className="flex h-full flex-col items-center justify-center gap-2 px-6 text-center">
              <div className="text-3xl">📌</div>
              <div className="text-xs text-slate-400">尚未选择标的</div>
              <div className="text-[11px] leading-relaxed text-slate-300">
                在「市场」「梯队」或「自选」点击任意股票即可打开个股分析
              </div>
            </div>
          ))}
        {tab === 'war' && <WarPage onOpenStock={openStock} />}
        {tab === 'review' && <ReviewPage onOpenStock={openStock} />}
      </div>
    </div>
  )
}
