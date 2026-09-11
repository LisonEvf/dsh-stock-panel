/**
 * src/views/ToolHost.tsx — **工具抽屉**：旧功能入口的集中地（不属于看盘流程）。
 *
 * 为什么要它：一级导航改按看盘流程组织（复盘/作战/看盘）之后，
 * 市场总览 / 指数 / 涨停梯队 / 外盘 / 选股筛选 / 自选盘 / 监控 / 个股明细
 * 这些页面不能消失——它们是**随手查证**的工具，而不是流程的一环。
 * 抽屉把它们从"占据一级导航"降级为"一键可达"，习惯不丢、流程不乱。
 *
 * 交互：顶部一行工具切换（按分组），右侧「返回阶段」关闭抽屉。
 */
import { X } from 'lucide-react'
import { MarketOverview } from '@/pages/MarketOverview'
import { IndicesPage } from '@/pages/IndicesPage'
import { LadderPage } from '@/pages/LadderPage'
import { GlobalPage } from '@/pages/GlobalPage'
import { ScoutPage } from '@/pages/ScoutPage'
import { WatchlistPage } from '@/pages/WatchlistPage'
import { AlertsPage } from '@/pages/AlertsPage'
import { StockDetailPage } from '@/pages/StockDetailPage'
import {
  closeTool,
  openStockAndWatch,
  setSelection,
  setTool,
  TOOL_VIEWS,
  useSelection,
  useUi,
} from '@/lib/selection'

const GROUPS = ['市场', '研究', '自选与监控', '个股'] as const

export function ToolHost() {
  const ui = useUi()
  const sel = useSelection()
  const current = TOOL_VIEWS.find((t) => t.id === ui.tool) ?? TOOL_VIEWS[0]
  const id = current.id

  return (
    <div className="dc-view">
      {/* 工具条：分组切换 + 返回阶段 */}
      <div className="dc-subnav">
        {GROUPS.map((g) => {
          const items = TOOL_VIEWS.filter((t) => t.group === g)
          if (items.length === 0) return null
          return (
            <span key={g} className="dc-toolgroup">
              <span className="dc-toolgroup-label">{g}</span>
              {items.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  title={t.hint}
                  className={`dc-subnav-item${id === t.id ? ' is-on' : ''}`}
                  onClick={() => setTool(t.id)}
                >
                  {t.label}
                </button>
              ))}
            </span>
          )
        })}
        <span style={{ flex: 1 }} />
        <span className="dc-ai-note">工具不属于看盘流程，随手查证用</span>
        <button type="button" className="dc-btn dc-btn--icon" title="返回当前阶段（Esc）" onClick={() => closeTool()}>
          <X size={12} />
        </button>
      </div>

      <div className="dc-view">
        {id === 'overview' ? (
          <MarketOverview
            onOpenStock={openStockAndWatch}
            onOpenIndex={(market, code, name) => setSelection({ market, code, name })}
          />
        ) : null}
        {id === 'indices' ? <IndicesPage initial={null} /> : null}
        {id === 'ladder' ? <LadderPage onOpenStock={openStockAndWatch} /> : null}
        {id === 'global' ? <GlobalPage /> : null}
        {id === 'scout' ? <ScoutPage onOpenStock={openStockAndWatch} /> : null}
        {id === 'watchlist' ? <WatchlistPage onOpenStock={openStockAndWatch} /> : null}
        {id === 'alerts' ? <AlertsPage /> : null}
        {id === 'detail' ? <StockDetailPage open={sel} /> : null}
      </div>
    </div>
  )
}
