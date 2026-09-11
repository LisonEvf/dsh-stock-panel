/**
 * src/panel/AppShell.tsx — 盯盘台骨架（**按看盘流程组织**的三段式 + 状态带 + 键盘）。
 *
 * ## 一级导航 = 方法论的两个阶段 + 一个自由看盘
 *
 * 依据 `WATCH-METHODOLOGY.md` §8 的固定时间表与 `PRODUCT-DESIGN.md` §3.1：
 *
 *   [复盘]  15:10–次日 9:15  七步复盘 → 写下「次日预期清单」(≤5)
 *   [作战]  9:15–15:00       竞价 → 验证窗 → 盘中 → 尾盘（页内按时段自动切换）
 *   [看盘]  任意时段          自由查看（左列表 + 主图 + AI），不属于流程
 *
 * **时段驱动**：真实阶段跨过边界（9:15 / 15:10 …）时自动切到对应入口；
 * 用户手动点过导航后本次会话不再自动跟随（不打断正在做的事）。
 * 其余功能全部收进「工具」抽屉（`views/ToolHost.tsx`）：一键可达，但不占一级导航。
 *
 * ```
 * ┌ 状态带：阶段│[复盘][作战][看盘]│[工具]│指数│广度│情绪│[问模型][⌘K] ┐
 * ├──────────┬──────────────────────────────────┬────────────────────┤
 * │ 左栏列表  │ 主区：阶段头 + 阶段内容 / 工具页    │ 右栏 AI 研判        │
 * └──────────┴──────────────────────────────────┴────────────────────┘
 * ```
 */
import { useEffect, useRef, useState } from 'react'
import { Search, Wrench } from 'lucide-react'
import { AlertWatcher } from '@/components/AlertWatcher'
import { getHits, markAllRead, subscribeAlerts, unreadCount } from '@/lib/alerts'
import { searchInstruments, type SearchHit } from '@/lib/market'
import {
  PRIMARY_VIEWS,
  SUB_VIEWS,
  TOOL_VIEWS,
  closeTool,
  openStockAndWatch,
  selectionSymbol,
  setSubView,
  setTool,
  setView,
  updateUi,
  useSelection,
  useUi,
  type PrimaryView,
} from '@/lib/selection'
import { currentStage, STAGES, type Stage } from '@/lib/stage'
import { useMediaQuery, useHotkeys } from './hooks'
import { CLIENT_BUILD_ID, CLIENT_VERSION, isStaleBuild, useBuildInfo } from '@/lib/build-info'
import { StatusStrip } from './StatusStrip'
import { WatchList } from './WatchList'
import { AiPanel } from './AiPanel'
import { useAiVerdict } from './use-ai'
import { WatchView } from '@/views/WatchView'
import { StageReviewView } from '@/views/StageReviewView'
import { StageWarView } from '@/views/StageWarView'
import { ToolHost } from '@/views/ToolHost'
import { StockDetailPage } from '@/pages/StockDetailPage'
import { WatchlistPage } from '@/pages/WatchlistPage'

/** 对话通道（由 client.ts 从 conversation.view 的槽位 props 注入）。 */
export interface ChatBridge {
  available: boolean
  reason?: string
  /** 把 prompt 写进对话输入框并发送（不切换视图）。 */
  send: (prompt: string) => void
}

interface Props {
  chat: ChatBridge
}

interface Toast {
  id: string
  text: string
}

/** 阶段 → 一级入口（复盘时段去复盘，其余时段都去作战）。 */
function entryOfStage(stage: Stage): PrimaryView {
  return STAGES[stage].entry === 'review' ? 'review' : 'war'
}

export function AppShell({ chat }: Props) {
  const ui = useUi()
  const sel = useSelection()
  const symbol = selectionSymbol(sel)
  const [paletteOpen, setPaletteOpen] = useState(false)
  const [toasts, setToasts] = useState<Toast[]>([])
  const [alertUnread, setAlertUnread] = useState(() => unreadCount())
  const [, setClockTick] = useState(0)

  // 当前真实阶段（每 30s 重算；只有跨过 9:15 / 14:30 / 15:10 这类边界才会变）
  const stage = currentStage()
  const stageRef = useRef(stage)
  /** 用户是否手动选过导航（选过就不再自动跟随，避免打断）。 */
  const manualRef = useRef(false)

  useEffect(() => {
    const timer = window.setInterval(() => setClockTick((x) => x + 1), 30_000)
    return () => window.clearInterval(timer)
  }, [])

  // 时段驱动：阶段变化时切到对应入口（首帧只记录，不强切已持久化的偏好）
  useEffect(() => {
    if (stageRef.current === stage) return
    stageRef.current = stage
    if (manualRef.current || ui.tool !== null) return
    const want = entryOfStage(stage)
    if (ui.view !== want) setView(want)
  }, [stage, ui.view, ui.tool])

  // 右栏 AI 运行器：状态带按钮与右栏卡片共用同一状态。
  const ai = useAiVerdict({
    symbol,
    name: sel?.name ?? '',
    market: sel?.market ?? null,
    code: sel?.code ?? null,
    days: ui.klineDays,
  })

  // 构建可见性：服务端 build id 与本 bundle 不一致 = 页面跑着旧构建（改完代码未硬刷新）。
  const build = useBuildInfo()
  const staleBuild = isStaleBuild(build.data)

  // 窄屏首帧自动收起右栏（用户手动展开后本会话不再干预）。
  const wide = useMediaQuery('(min-width: 1120px)')
  const autoCollapsedRef = useRef(false)
  useEffect(() => {
    if (!wide && !autoCollapsedRef.current) {
      autoCollapsedRef.current = true
      if (ui.rightRail) updateUi({ rightRail: false })
    }
  }, [wide, ui.rightRail])

  // 监控命中 → 徽标 + 底部 Toast
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
      window.setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== toast.id)), 6000)
    })
    return off
  }, [])

  /** 一键问模型：无标的时提示（走 Toast，不弹窗）。 */
  const askAi = () => {
    if (symbol === null) {
      setToasts((prev) => [...prev.slice(-2), { id: `ask-${Date.now()}`, text: '先在左栏选一只票，再一键问模型' }])
      return
    }
    void ai.run()
  }

  /** 切一级入口（记为手动操作，本会话停止自动跟随阶段）。 */
  const pickView = (v: PrimaryView) => {
    manualRef.current = true
    setView(v)
  }

  useHotkeys((e) => {
    if (e.metaKey || e.ctrlKey) {
      if (e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setPaletteOpen((v) => !v)
      }
      return
    }
    if (e.altKey) return
    if (e.key === 'Escape') {
      setPaletteOpen(false)
      if (ui.tool !== null) closeTool()
      return
    }
    if (paletteOpen) return
    if (e.key === '/') {
      e.preventDefault()
      setPaletteOpen(true)
      return
    }
    if (e.key >= '1' && e.key <= String(PRIMARY_VIEWS.length)) {
      const v = PRIMARY_VIEWS[Number(e.key) - 1]
      if (v !== undefined) pickView(v.id)
      return
    }
    if (e.key === 't') {
      setTool(ui.tool === null ? TOOL_VIEWS[0].id : null)
      return
    }
    if (e.key === 'a') {
      e.preventDefault()
      askAi()
      return
    }
    if (e.key === '[') {
      updateUi({ leftRail: !ui.leftRail })
      return
    }
    if (e.key === ']') {
      updateUi({ rightRail: !ui.rightRail })
    }
  })

  const currentView = ui.view
  const subs = SUB_VIEWS[currentView]
  const sub = ui.sub[currentView]
  const toolLabel = ui.tool === null ? null : (TOOL_VIEWS.find((t) => t.id === ui.tool)?.label ?? ui.tool)

  return (
    <div className="dc-shell">
      <StatusStrip
        onOpenSearch={() => setPaletteOpen(true)}
        onAskAi={askAi}
        aiBusy={ai.busy}
        stage={stage}
        onPickStage={() => {
          setTool(null)
          pickView(entryOfStage(stage))
        }}
        onPickView={pickView}
      />

      <div className="dc-body">
        {/* 左栏：盯盘列表（任何阶段/工具页都在——"随手看一眼"不能断流） */}
        <aside className="dc-rail dc-rail--left" hidden={!ui.leftRail}>
          <WatchList />
        </aside>

        {/* 主区：工具抽屉打开时由工具页接管，否则显示当前阶段/看盘 */}
        <main className="dc-main">
          {ui.tool !== null ? (
            <ToolHost />
          ) : (
            <>
              {subs.length > 1 ? (
                <div className="dc-subnav">
                  {subs.map((s) => (
                    <button
                      key={s.id}
                      type="button"
                      className={`dc-subnav-item${sub === s.id ? ' is-on' : ''}`}
                      onClick={() => setSubView(currentView, s.id)}
                    >
                      {s.label}
                    </button>
                  ))}
                </div>
              ) : null}

              {currentView === 'review' ? <StageReviewView /> : null}
              {currentView === 'war' ? <StageWarView /> : null}
              {currentView === 'watch' ? <WatchArea sub={sub} /> : null}
            </>
          )}
        </main>

        {/* 右栏：AI 研判（常驻，不打断看盘） */}
        <aside className="dc-rail dc-rail--right" hidden={!ui.rightRail}>
          <AiPanel symbol={symbol} name={sel?.name ?? ''} days={ui.klineDays} ai={ai} chat={chat} />
        </aside>
      </div>

      {/* 底栏：当前状态 + 构建可见性 + 快捷键 */}
      <div className="dc-foot">
        <span>
          阶段 {STAGES[stage].label}（{STAGES[stage].window}）
          {toolLabel !== null ? ` · 工具：${toolLabel}` : ''}
          {sel !== null ? ` · ${sel.market}${sel.code}` : ''}
        </span>
        <span style={{ flex: 1 }} />
        {staleBuild ? (
          <button
            type="button"
            className="dc-tag"
            style={{ background: 'var(--dc-danger)', color: '#fff', cursor: 'pointer', border: 'none' }}
            title={`服务端已是新构建（build ${build.data?.buildId ?? '?'}），当前页面仍是 build ${CLIENT_BUILD_ID}。点击重新加载页面。`}
            onClick={() => window.location.reload()}
          >
            有新构建 · 点此刷新
          </button>
        ) : null}
        <span
          className="dc-ai-note"
          title={`插件 v${CLIENT_VERSION} · 本页 build ${CLIENT_BUILD_ID}${build.data ? ` · 服务端 build ${build.data.buildId}` : ''}（构建 id = src 内容哈希）`}
        >
          v{CLIENT_VERSION} · {CLIENT_BUILD_ID}
        </span>
        <span>⌘K 搜索 · 1-3 阶段/看盘 · t 工具 · j/k 移动 · a 问模型 · [ ] 收栏</span>
      </div>

      {/* 常驻监控（任意视图生效） */}
      <AlertWatcher />

      {toasts.length > 0 ? (
        <div className="dc-toasts">
          {toasts.map((t) => (
            <div key={t.id} className="dc-toast">
              <span className="dc-tag" style={{ background: 'var(--dc-danger)', color: '#fff' }}>
                监控
              </span>
              <span className="dc-toast-text">{t.text}</span>
              <button
                type="button"
                className="dc-btn dc-btn--ghost dc-btn--icon"
                onClick={() => setToasts((prev) => prev.filter((x) => x.id !== t.id))}
              >
                ×
              </button>
            </div>
          ))}
        </div>
      ) : null}

      {paletteOpen ? (
        <SearchPalette
          onClose={() => setPaletteOpen(false)}
          onPickTool={(id) => {
            setTool(id)
            setPaletteOpen(false)
          }}
        />
      ) : null}

      {alertUnread > 0 ? (
        <button
          type="button"
          className="dc-alert-badge"
          title={`监控命中未读 ${alertUnread} 条（点击打开监控规则）`}
          onClick={() => {
            markAllRead()
            setTool('alerts')
          }}
        >
          {alertUnread > 99 ? '99+' : alertUnread}
        </button>
      ) : null}
    </div>
  )
}

/** 看盘入口的三个二级形态：工作台（新）/ 明细（旧全功能页）/ 自选盘（表格）。 */
function WatchArea({ sub }: { sub: string }) {
  const sel = useSelection()
  if (sub === 'detail') return <StockDetailPage open={sel} />
  if (sub === 'watchlist') return <WatchlistPage onOpenStock={openStockAndWatch} />
  return <WatchView />
}

/** ⌘K 搜索面板：本地全 A 索引 + 工具直达（回车/点击 = 设当前标的或打开工具）。 */
function SearchPalette({
  onClose,
  onPickTool,
}: {
  onClose: () => void
  onPickTool: (id: string) => void
}) {
  const [q, setQ] = useState('')
  const [hits, setHits] = useState<SearchHit[]>([])
  const [busy, setBusy] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  useEffect(() => {
    const query = q.trim()
    if (query === '') {
      setHits([])
      return
    }
    let alive = true
    setBusy(true)
    const timer = window.setTimeout(() => {
      void searchInstruments(query, 20)
        .then((list) => {
          if (alive) setHits(list)
        })
        .catch(() => {
          if (alive) setHits([])
        })
        .finally(() => {
          if (alive) setBusy(false)
        })
    }, 120)
    return () => {
      alive = false
      window.clearTimeout(timer)
    }
  }, [q])

  const pick = (h: SearchHit) => {
    openStockAndWatch({ market: h.market, code: h.code, name: h.name })
    onClose()
  }

  const query = q.trim().toLowerCase()
  const tools =
    query === ''
      ? []
      : TOOL_VIEWS.filter((t) => t.label.toLowerCase().includes(query) || t.hint.toLowerCase().includes(query))

  return (
    <div className="dc-palette-mask" onClick={onClose}>
      <div className="dc-palette" onClick={(e) => e.stopPropagation()}>
        <input
          ref={inputRef}
          className="dc-palette-input"
          placeholder="搜索代码 / 名称，或输入功能名（如 指数 / 选股 / 监控）"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              if (tools[0] !== undefined) onPickTool(tools[0].id)
              else if (hits[0] !== undefined) pick(hits[0])
            }
            if (e.key === 'Escape') onClose()
          }}
        />
        <div className="dc-palette-list dc-scroll">
          {busy && hits.length === 0 && tools.length === 0 ? <div className="dc-row-hint">搜索中…</div> : null}
          {tools.length > 0 ? (
            <>
              <div className="dc-row-hint">工具</div>
              {tools.map((t) => (
                <div key={t.id} className="dc-row" onClick={() => onPickTool(t.id)}>
                  <div className="dc-row-main">
                    <span className="dc-row-name">
                      <Wrench size={11} /> {t.label}
                    </span>
                    <span className="dc-row-sub">{t.hint}</span>
                  </div>
                </div>
              ))}
            </>
          ) : null}
          {hits.map((h) => (
            <div key={h.symbol} className="dc-row" onClick={() => pick(h)}>
              <div className="dc-row-main">
                <span className="dc-row-name">{h.name}</span>
                <span className="dc-row-sub">{h.symbol}</span>
              </div>
              <Search size={12} style={{ opacity: 0.4 }} />
            </div>
          ))}
          {!busy && query !== '' && hits.length === 0 && tools.length === 0 ? <div className="dc-row-hint">无匹配</div> : null}
        </div>
      </div>
    </div>
  )
}

/** 视图类型再导出（供未来扩展）。 */
export type { PrimaryView }
