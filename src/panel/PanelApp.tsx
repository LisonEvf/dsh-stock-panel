/**
 * 工作台面板壳（M5→M9）：顶部 Tab 导航 + 视图切换。
 *
 * Tab：市场 / 梯队 / 指数 / 自选 / 个股 / 作战 / 复盘 / 监控（M7）。
 * 跨视图事件：市场·梯队·自选页点击某只股票 → 切到「个股」Tab 加载标的；
 * 市场页点击指数芯片 → 切到「指数」Tab 并选中该指数。
 * 根节点挂载：常驻 AlertWatcher（监控规则后台判定）+ 命中 Toast 浮层。
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { MarketOverview } from '@/pages/MarketOverview'
import { LadderPage } from '@/pages/LadderPage'
import { ScoutPage } from '@/pages/ScoutPage'
import { IndicesPage } from '@/pages/IndicesPage'
import { GlobalPage } from '@/pages/GlobalPage'
import { WatchlistPage } from '@/pages/WatchlistPage'
import { StockDetailPage } from '@/pages/StockDetailPage'
import { WarPage } from '@/pages/WarPage'
import { ReviewPage } from '@/pages/ReviewPage'
import { AlertsPage } from '@/pages/AlertsPage'
import { AlertWatcher } from '@/components/AlertWatcher'
import { getHits, markAllRead, subscribeAlerts, unreadCount } from '@/lib/alerts'
import type { MarketTag } from '@/lib/symbol'

export type PanelTab =
  | 'market' | 'ladder' | 'scout' | 'indices' | 'global' | 'watchlist' | 'stock' | 'war' | 'review' | 'alerts'

export interface OpenStock {
  market: MarketTag
  code: string
  name: string
}

const TABS: { key: PanelTab; label: string }[] = [
  { key: 'market', label: '市场' },
  { key: 'ladder', label: '梯队' },
  { key: 'scout', label: '选股' },
  { key: 'indices', label: '指数' },
  { key: 'global', label: '外盘' },
  { key: 'watchlist', label: '自选' },
  { key: 'stock', label: '个股' },
  { key: 'war', label: '作战' },
  { key: 'review', label: '复盘' },
  { key: 'alerts', label: '监控' },
]

interface Toast {
  id: string
  text: string
}

export function PanelApp() {
  const [tab, setTab] = useState<PanelTab>('market')
  const [stock, setStock] = useState<OpenStock | null>(null)
  const [indexFocus, setIndexFocus] = useState<{ market: MarketTag; code: string; name: string } | null>(null)
  const [alertUnread, setAlertUnread] = useState(() => unreadCount())
  const [toasts, setToasts] = useState<Toast[]>([])
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

  const selectTab = useCallback((t: PanelTab) => {
    setTab(t)
    if (t === 'alerts') markAllRead() // 进入监控页即清未读（订阅回调会同步徽标）
  }, [])

  // 监控命中 → 徽标未读数 + 浮层 Toast（只弹“本会话内新增”的命中，冷启动不弹历史）
  const topHitRef = useRef('')
  const bootedRef = useRef(false)
  useEffect(() => {
    const off = subscribeAlerts(() => {
      setAlertUnread(unreadCount())
      const hits = getHits()
      const top = hits.length ? hits[0] : null
      if (!top || top.id === topHitRef.current) return
      topHitRef.current = top.id
      if (!bootedRef.current) {
        bootedRef.current = true
        return
      }
      const toast: Toast = { id: top.id, text: top.message }
      setToasts((prev) => [...prev.slice(-2), toast])
      setTimeout(() => {
        setToasts((prev) => prev.filter((t) => t.id !== toast.id))
      }, 6000)
    })
    return off
  }, [])

  return (
    <div className="relative flex h-full min-h-0 w-full flex-col bg-white text-slate-800">
      {/* 常驻监控 Watcher（任意 Tab 生效） */}
      <AlertWatcher />
      {/* Tab 导航（窄列可横向滚动，永不溢出） */}
      <div className="ds-no-scrollbar flex shrink-0 items-center overflow-x-auto border-b border-slate-200 px-1.5 pt-1">
        {TABS.map((t) => {
          const active = tab === t.key
          return (
            <button
              key={t.key}
              onClick={() => selectTab(t.key)}
              className={`relative shrink-0 whitespace-nowrap px-2 pb-1.5 pt-1 text-[12px] font-medium transition-colors ${
                active ? 'text-emerald-600' : 'text-slate-400 hover:text-slate-600'
              }`}
            >
              {t.label}
              {t.key === 'alerts' && alertUnread > 0 && !active && (
                <span className="absolute -right-0.5 -top-0.5 flex h-3.5 min-w-3.5 items-center justify-center rounded-full bg-red-500 px-0.5 font-mono text-[8px] font-bold leading-none text-white">
                  {alertUnread > 99 ? '99+' : alertUnread}
                </span>
              )}
              {active && <span className="absolute inset-x-1 bottom-0 h-0.5 rounded-full bg-emerald-500" />}
            </button>
          )
        })}
      </div>

      {/* 视图 */}
      <div className="min-h-0 flex-1 overflow-hidden">
        {tab === 'market' && <MarketOverview onOpenStock={openStock} onOpenIndex={openIndex} />}
        {tab === 'ladder' && <LadderPage onOpenStock={openStock} />}
        {tab === 'scout' && <ScoutPage onOpenStock={openStock} />}
        {tab === 'indices' && <IndicesPage key={indexFocus ? `${indexFocus.market}${indexFocus.code}` : 'default'} initial={indexFocus} />}
        {tab === 'global' && <GlobalPage />}
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
        {tab === 'alerts' && <AlertsPage />}
      </div>

      {/* 命中 Toast 浮层（底部） */}
      {toasts.length > 0 && (
        <div className="pointer-events-none absolute inset-x-1 bottom-1 z-40 space-y-1">
          {toasts.map((t) => (
            <div
              key={t.id}
              className="pointer-events-auto flex items-start gap-1.5 rounded-md border border-amber-200 bg-amber-50 px-2 py-1.5 shadow-md"
            >
              <span className="mt-px shrink-0 rounded bg-red-500 px-1 text-[8px] font-bold text-white">监控</span>
              <span className="min-w-0 flex-1 text-[11px] leading-snug text-slate-700">{t.text}</span>
              <button
                onClick={() => setToasts((prev) => prev.filter((x) => x.id !== t.id))}
                className="shrink-0 text-slate-300 hover:text-slate-500"
              >
                ×
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
