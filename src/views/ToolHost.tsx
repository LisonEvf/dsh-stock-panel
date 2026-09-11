/**
 * src/views/ToolHost.tsx — **工具单页**（A4：一张页面放下全部工具，取代旧的"抽屉切页"）。
 *
 * 为什么改成单页：`PRODUCT-DESIGN.md` §6d.2 的决策是「工具合并在一个页面上表达」——
 * 抽屉的毛病是"切页即失忆"：用户想看指数与涨停梯队的关系，只能在两组数据间来回切。
 * 现在**全部区块的标题与说明**都摊在同一页上（锚点导航 + ⌘K 直达），信息架构一眼可见。
 *
 * ⚠️ 但**只挂载当前展开的区块**，这是硬约束不是偷懒：
 *   市场总览 20s / 指数 15s / 涨停梯队 30s（**单轮 ≤177 次工具调用**）/ 自选盘 12s /
 *   监控 / 选股 / 个股明细 / 外盘各有自己的轮询与服务端计算。
 *   8 个一起挂 = 请求预算直接打爆（见 `docs/ARCHITECTURE.md` §3.1）。
 *   所以：区块标题常驻、内容按需挂载（点标题展开；离开即卸载 → 轮询随之停止）。
 *
 * 外盘（`secondary`）按决策**弱化**：排在最后、标题标注「次要」、默认不展开。
 */
import { X, ChevronRight } from 'lucide-react'
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

/** 渲染某个工具区块（只有当前展开的那个会被调用）。 */
function renderTool(id: string, sel: ReturnType<typeof useSelection>) {
  switch (id) {
    case 'overview':
      return (
        <MarketOverview
          onOpenStock={openStockAndWatch}
          onOpenIndex={(market, code, name) => setSelection({ market, code, name })}
        />
      )
    case 'indices':
      return <IndicesPage initial={null} />
    case 'ladder':
      return <LadderPage onOpenStock={openStockAndWatch} />
    case 'scout':
      return <ScoutPage onOpenStock={openStockAndWatch} />
    case 'watchlist':
      return <WatchlistPage onOpenStock={openStockAndWatch} />
    case 'alerts':
      return <AlertsPage />
    case 'detail':
      return <StockDetailPage open={sel} />
    case 'global':
      return <GlobalPage />
    default:
      return null
  }
}

export function ToolHost() {
  const ui = useUi()
  const sel = useSelection()
  const active = ui.tool ?? TOOL_VIEWS[0].id
  const activeEntry = TOOL_VIEWS.find((t) => t.id === active)

  return (
    <div className="dc-view">
      {/* 锚点导航：全部区块都在这一行（点=展开并切到该区块） */}
      <div className="dc-subnav">
        <span className="dc-toolgroup-label">工具</span>
        {TOOL_VIEWS.map((t) => (
          <button
            key={t.id}
            type="button"
            title={t.hint}
            className={`dc-subnav-item${active === t.id ? ' is-on' : ''}`}
            onClick={() => setTool(t.id)}
          >
            {t.label}
            {t.secondary === true ? <span className="dc-tag" style={{ marginLeft: 4 }}>次要</span> : null}
          </button>
        ))}
        <span style={{ flex: 1 }} />
        <span className="dc-ai-note">一张页面放下全部工具 · 只展开当前区块</span>
        <button type="button" className="dc-btn dc-btn--icon" title="返回当前阶段（Esc）" onClick={() => closeTool()}>
          <X size={12} />
        </button>
      </div>

      <div className="dc-view dc-scroll">
        <div className="dc-page-head">
          <strong>{activeEntry?.label ?? ''}</strong>
          <span className="dc-ai-note">{activeEntry?.hint ?? ''}</span>
        </div>
        <div className="dc-tool-body">{renderTool(active, sel)}</div>

        {/* 其余区块的标题常驻（信息架构可见），内容按需展开 */}
        <div className="dc-tool-more">
          <div className="dc-row-hint">全部工具（点击展开；未展开的区块不挂载、不轮询）</div>
          {TOOL_VIEWS.filter((t) => t.id !== active).map((t) => (
            <button key={t.id} type="button" className="dc-tool-entry" title={t.hint} onClick={() => setTool(t.id)}>
              <ChevronRight size={11} />
              <span className="dc-tool-entry-label">
                {t.label}
                {t.secondary === true ? <span className="dc-tag" style={{ marginLeft: 6 }}>次要</span> : null}
              </span>
              <span className="dc-tool-entry-hint">{t.hint}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
