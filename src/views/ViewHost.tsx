/**
 * src/views/ViewHost.tsx — 主区**按一级入口渲染当前页**（A6：取代旧的「工具单页」`ToolHost`）。
 *
 * ## 为什么从"工具单页"改回"一入口一页"
 *
 * A4 把 8 个功能塞进一张工具单页（区块标题常驻、只挂载当前区块），代价是一个中间层：
 * 用户要先点「工具」、再在页面里找区块。A6 把入口**平铺**到一级导航后这条约束自动成立 ——
 * 一次只有一个一级入口，React 只挂载它，切走即卸载。于是中间层没有存在理由了：
 * 每个页面自己的页头（"行情聚合面板"「监控 · N 条生效规则」）就是它的标题，
 * 导航项的悬停说明（`PRIMARY_VIEWS[].hint`）就是它的说明。
 *
 * ## 挂载纪律（不许改成"全部挂载 + display 隐藏"）
 *
 * 行情 20s / 指数 15s / 涨停梯队 30s（**单轮 ≤177 次工具调用**）/ 选股 / 监控各有自己的轮询；
 * `display:none` 只是看不见，**轮询照跑**，只有卸载才会停（见 `docs/ARCHITECTURE.md` §3.1）。
 * 所以这里是 `switch` + 单页返回，不是一排 `hidden` 容器。
 *
 * ## 工作台（`watch`）也走同一个 switch
 *
 * 它不上导航栏（见 `lib/selection.ts` 的 `WORKBENCH_VIEW`），但**点左栏任一行、
 * 或任意页面点股票都会落到这里**（`openStockAndWatch`），所以它必须在这里有分支 ——
 * 否则用户一点股票，主区就空了。
 */
import { MarketPage } from '@/pages/MarketPage'
import { GlobalPage } from '@/pages/GlobalPage'
import { ScoutPage } from '@/pages/ScoutPage'
import { AlertsPage } from '@/pages/AlertsPage'
import { ConceptClassesCard } from '@/components/ConceptClassesCard'
import { StageReviewView } from '@/views/StageReviewView'
import { StageWarView } from '@/views/StageWarView'
import { WatchView } from '@/views/WatchView'
import { openStockAndWatch, useUi, type PrimaryView } from '@/lib/selection'

/** 一级入口 → 页面（每个分支都是"整页"，不是区块）。 */
function pageOf(view: PrimaryView) {
  switch (view) {
    case 'review':
      return <StageReviewView />
    case 'war':
      return <StageWarView />
    case 'market':
      // A4 合并页（市场总览 + 指数 + 涨停梯队）：页内三块各自"滚到才轮询"，见 MarketPage 头注释
      return <MarketPage onOpenStock={openStockAndWatch} />
    case 'concept':
      // A2b 自挖板块：只有它是当前入口时才挂载（请求预算约束见文件头）
      return (
        <ConceptClassesCard
          onOpenStock={(market, code, name) => openStockAndWatch({ market, code, name })}
        />
      )
    case 'scout':
      return <ScoutPage onOpenStock={openStockAndWatch} />
    case 'alerts':
      return <AlertsPage />
    case 'global':
      return <GlobalPage />
    case 'watch':
      // 工作台：点股票就到这里（报价头 + 图 + 资金/逐笔/竞价）
      return <WatchView />
    default:
      /**
       * 理论上到不了这里：`PrimaryView` 是穷尽联合，落盘值也已过 `viewIdOf()` 校验。
       * 但真到了（比如以后新增入口却漏了分支）**不能给一片空白** ——
       * 空白是"静默失效"，把缺失的值念出来才是可诊断的（本项目的既有立场）。
       */
      return (
        <div className="dc-empty">
          <div className="dc-empty-mark">🧭</div>
          <div>这个入口还没有对应的页面：{String(view)}</div>
          <div className="dc-ai-note">按 ⌘K 选一个入口；这一行请直接贴进问题反馈（PrimaryView 分支缺失）。</div>
        </div>
      )
  }
}

export function ViewHost() {
  const ui = useUi()
  return (
    <div className="dc-view dc-scroll">
      <div className="dc-view-body">{pageOf(ui.view)}</div>
    </div>
  )
}
