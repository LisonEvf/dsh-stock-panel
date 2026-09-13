/**
 * src/panel/AppShell.tsx — 盯盘台骨架（**按看盘流程 + 板块平铺**的导航 + 状态带 + 键盘）。
 *
 * ## 一级导航 = 方法论两阶段 + 各个板块（A6：抽屉拆平）
 *
 * 依据 `WATCH-METHODOLOGY.md` §8 的固定时间表与 `PRODUCT-DESIGN.md` §6e：
 *
 *   [复盘]  15:10–次日 9:15  七步复盘 → 写下「次日预期清单」(≤5)
 *   [作战]  9:15–15:00       竞价 → 验证窗 → 盘中 → 尾盘（页内按时段自动切换）
 *   [行情] [自挖板块] [选股筛选] [监控规则] [外盘]  各自一整页，与复盘/作战**同级**
 *
 * **时段驱动**：真实阶段跨过边界（9:15 / 15:10 …）时自动切到对应入口；
 * 用户手动点过导航后本次会话不再自动跟随（不打断正在做的事）。
 *
 * **默认入口 = 行情**（`selection.ts` 的 `DEFAULT_VIEW`，用户决策）：
 * 无落盘状态时首帧就停在「行情」——它是任何时段都成立的第一眼（总览 + 指数 + 涨停梯队），
 * 不必先猜"现在几点"。阶段入口一键可达（`1`/`2`），时段边界仍会自动跟随（见上一条）。
 *
 * 「工作台」（原「看盘」）**不在导航栏上**：它是"点左栏任一行 / 任意页面点股票"落到的
 * 默认主区（`openStockAndWatch` → `ui.view === 'watch'`），由 `views/ViewHost.tsx` 渲染。
 * 「自选盘」「个股明细」两个整页已下线 —— 自选与个股都在左栏常驻列表里，点行即看。
 *
 * ```
 * ┌ 状态带：阶段│[复盘][作战][行情][自挖板块][选股筛选][监控规则][外盘]│指数│广度│情绪│[问模型][⌘K] ┐
 * ├──────────┬──────────────────────────────────┬────────────────────┤
 * │ 左栏列表  │ 主区：一级入口对应的整页（ViewHost）│ 右栏 AI 研判        │
 * └──────────┴──────────────────────────────────┴────────────────────┘
 * ```
 */
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { AlertTriangle, Search, Compass, Stethoscope } from 'lucide-react'
import { AlertWatcher } from '@/components/AlertWatcher'
import { getHits, markAllRead, subscribeAlerts, unreadCount } from '@/lib/alerts'
import { searchInstruments, type SearchHit } from '@/lib/market'
import { dispatchWatchMove, needsPreventDefault, resolveHotkey } from '@/lib/hotkeys'
import {
  ALL_VIEWS,
  isEditableTarget,
  openStockAndWatch,
  selectionSymbol,
  setView,
  updateUi,
  useSelection,
  useUi,
  type PrimaryView,
} from '@/lib/selection'
import { currentStage, STAGES, type Stage } from '@/lib/stage'
import { useAvailableHeight, useChromeHealth, useContainerWidth, useHotkeys } from './hooks'
import { CLIENT_BUILD_ID, CLIENT_VERSION, hardReload, isStaleBuild, useBuildInfo } from '@/lib/build-info'
import { hostStateInfo, subscribeHostState } from '@/lib/host-state'
import { enterWorkbenchChrome } from '@/lib/host-chrome'
import { DiagnosticsPanel } from './DiagnosticsPanel'
import { StatusStrip } from './StatusStrip'
import { WatchList } from './WatchList'
import { AiPanel } from './AiPanel'
import { useAiVerdict } from './use-ai'
import { ViewHost } from '@/views/ViewHost'

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
  /** 子系统诊断面板（B5-③）：静默故障的集中排查入口。 */
  const [diagOpen, setDiagOpen] = useState(false)
  const [toasts, setToasts] = useState<Toast[]>([])
  const [alertUnread, setAlertUnread] = useState(() => unreadCount())
  const [, setClockTick] = useState(0)

  /**
   * 宿主会话列外壳适配（`lib/host-chrome.ts`）。
   *
   * 挂载这件事本身**就是**判据：ui-conversation 只渲染当前选中的视图条目（`only: active.id`），
   * 所以「本组件挂载」⟺「A股工作台 标签被选中」。此刻给 `<body>` 打标记，CSS 才能把
   * 两件事限定在本视图内：藏掉宿主那两条**贯穿全屏高度**的「正文栏宽度」拖拽条
   * （它们压在工作台面板左右边缘、一路压到底，把点击/拖拽都吃掉了），
   * 以及**不要底部对话框**（工作台是盯盘台；要打字切上方「对话」标签）。
   * 卸载时标记自动摘掉，切回「对话」一切照旧。
   *
   * 用 `useLayoutEffect`（不是 `useEffect`）：标记必须在**首次绘制前**打上 —— 宿主那两条拖拽条
   * 比本面板先存在（它们属于 ConversationRoot，不随视图切换重挂），被动 effect 会晚一帧，
   * 切标签时能看到它们闪一下。
   */
  useLayoutEffect(() => enterWorkbenchChrome(), [])

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
    if (manualRef.current) return
    const want = entryOfStage(stage)
    if (ui.view !== want) setView(want)
  }, [stage, ui.view])

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

  // 持久化状态（A1）：host 域可用 →「持久化 host」；否则「本地存储」+ 悬浮给出原因。
  const [hostState, setHostState] = useState(() => hostStateInfo())
  useEffect(() => subscribeHostState(() => setHostState(hostStateInfo())), [])

  // ── 骨架尺寸：一律按**容器实测宽度**决策，不用视口断点 ────────────────────
  //     DSH 里「视口宽、容器窄」是常态（左侧会话栏 + 右侧 AI 栏同开时，
  //     1920 视口的面板可用宽度可能只有 600）。行情页已按这条路修过，这里把它
  //     提升为骨架级约定：栏位显隐、列流列数、状态带分档都看容器。
  const shellRef = useRef<HTMLDivElement>(null)
  const mainRef = useRef<HTMLElement>(null)
  const stripHostRef = useRef<HTMLDivElement>(null)
  const shellWidth = useContainerWidth(shellRef)
  const mainWidth = useContainerWidth(mainRef)
  /**
   * 面板高度**必须封顶在宿主给的可视区之内**。
   *
   * 实测根因（真机控制台取证，2026-09-12）：宿主会话列本身是滚动容器
   * （`*_scrollBody`，clientHeight 851），而本面板长到 983–1006px（比它高）→
   * 宿主持续把它往下滚（scrollTop 318→341→364，每 3s +23px，随复盘数据陆续装载而增长）
   * → 面板顶边跑到视口上方 242px，**状态带被顶出可视区**，看起来像"界面少了一块"。
   *
   * 根因是".dsh-stock { height: 100% }"在宿主给不出确定高度时退化成 auto（内容撑高）。
   * 这里按最近的滚动容器实测可用高度来封顶：面板不再溢出 → 宿主就没得可滚。
   */
  const shellHeight = useAvailableHeight(shellRef, { min: 360, gap: 0 })
  /** 容器窄：右栏默认收起（否则主区被压成一条）；用户手动展开后本会话不再干预。 */
  const narrow = shellWidth > 0 && shellWidth < 900
  /** 容器极窄：左栏也默认收起。 */
  const tiny = shellWidth > 0 && shellWidth < 620

  // 半渲染自检（实测故障：DOM 在、画面不在）→ 顶部给硬刷新入口。
  const layoutBroken = useChromeHealth(stripHostRef)

  /**
   * 几何自检：URL 带 `dshPanelDebug=1` 时打印骨架各段的实测矩形。
   *
   * 为什么留着它：宿主容器（会话列是滚动容器）、裁切、宽度分配这类问题
   * **在 DOM/a11y 树里看不出来**，只能靠数字定位（实测就是靠它发现"面板被宿主
   * 滚出视口 242px"）。默认静默，不污染正常使用时的控制台。
   */
  useEffect(() => {
    if (typeof window === 'undefined') return
    if (!window.location.search.includes('dshPanelDebug')) return
    const dump = () => {
      const box = (sel: string) => {
        const el = document.querySelector(sel)
        if (el === null) return null
        const r = el.getBoundingClientRect()
        const overflow = el.scrollWidth > el.clientWidth + 1 ? `/${el.scrollWidth}` : ''
        return { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width) + overflow }
      }
      const strip = document.querySelector('.dc-strip')
      // 关键规则的**实际生效值**（排查"CSS 到底有没有到页面"这类问题）：
      // 只看文件不够 —— 宿主注入是幂等的（同 id 不重复注入），HMR 之后页面可能留着旧样式。
      const navItem = document.querySelector('.dc-nav-item')
      const styleEl = document.getElementById('dsh-stock-panel-css')
      const styleText = styleEl?.textContent ?? ''
      console.info(
        '[stock-panel] 几何 ' +
          JSON.stringify({
            tier: strip?.className ?? null,
            strip: box('.dc-strip'),
            grow: box('.dc-strip-grow'),
            tails: box('.dc-strip-tails'),
            railL: box('.dc-rail--left'),
            railR: box('.dc-rail--right'),
            视口: { w: window.innerWidth, h: window.innerHeight },
            navItem: navItem === null ? null : {
              w: Math.round(navItem.getBoundingClientRect().width),
              padding: window.getComputedStyle(navItem).padding,
              fontSize: window.getComputedStyle(navItem).fontSize,
            },
            stripDisplay: strip === null ? null : window.getComputedStyle(strip).display,
            cssLoaded: {
              len: styleText.length,
              hasNavRule: styleText.includes('.dc-nav-item'),
              hasTrack: styleText.includes('--dc-track'),
              hasUnit: styleText.includes('.dc-unit'),
              hasGlobalButton: /(^|[},])button\s*\{/.test(styleText),
            },
          }),
      )
    }
    const t0 = window.setTimeout(dump, 1500)
    // 数据装载完（快照/指数到位）后布局会变，所以要持续采样 —— 一次性快照会误导。
    // budget-ignore：只在 ?dshPanelDebug=1 时生效的测量代码，不发请求
    const timer = window.setInterval(dump, 5000)
    return () => {
      window.clearTimeout(t0)
      window.clearInterval(timer)
    }
  }, [])

  const autoCollapsedRef = useRef(false)
  useEffect(() => {
    if (!narrow || autoCollapsedRef.current) return
    autoCollapsedRef.current = true
    if (ui.rightRail) updateUi({ rightRail: false })
  }, [narrow, ui.rightRail])

  const autoLeftCollapsedRef = useRef(false)
  useEffect(() => {
    if (!tiny || autoLeftCollapsedRef.current) return
    autoLeftCollapsedRef.current = true
    if (ui.leftRail) updateUi({ leftRail: false })
  }, [tiny, ui.leftRail])

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

  /**
   * 弹层焦点回归（审计 UX-PLAN V6）。
   *
   * 为什么"记录"必须发生在**事件里**而不是 `useEffect` 里：SearchPalette 自己挂载时就会
   * `inputRef.current.focus()`，而 React 的 effect 顺序是**子先父后** —— 父组件的 effect 跑到时
   * 焦点已经在面板 input 上了，记下来的是它自己（关闭后"回归"到输入框，等于没回归）。
   */
  const returnFocusRef = useRef<HTMLElement | null>(null)
  const rememberFocus = () => {
    const el = document.activeElement
    returnFocusRef.current = el instanceof HTMLElement ? el : null
  }
  const restoreFocus = () => {
    const back = returnFocusRef.current
    returnFocusRef.current = null
    // 返回点可能已随状态变化卸载（例如点了"监控规则"跳走），所以先确认它还挂在文档上。
    if (back !== null && back.isConnected) back.focus()
  }

  /** 打开 ⌘K 面板（记下"从哪来的"，关闭时把焦点还回去）。 */
  const openPalette = () => {
    rememberFocus()
    setPaletteOpen(true)
  }
  const closePalette = () => {
    setPaletteOpen(false)
    restoreFocus()
  }
  /** 打开子系统诊断面板（同样要还焦点）。 */
  const openDiag = () => {
    rememberFocus()
    setDiagOpen(true)
  }
  const closeDiag = () => {
    setDiagOpen(false)
    restoreFocus()
  }

  /**
   * 全局键盘：**解析（纯函数）→ 分发**（审计 UX-PLAN I4）。
   *
   * 为什么不再写 if 链：原来这一段（审计原文 `AppShell.tsx:175-217`）把修饰键、作用域、
   * editable 让位、Esc 的层级全揉在一个箭头函数里，只能靠人去点，于是出了"Esc 一次关三样"、
   * "⌘K 面板开着时反而关不掉"这类**静默**缺陷。现在判定全在 `lib/hotkeys.ts:resolveHotkey`
   * （纯数据进、动作出，有 `tests/hotkeys.test.ts` 逐条钉住），这里只把动作落到 store 上。
   */
  useHotkeys(
    (e) => {
      const target = e.target
      const action = resolveHotkey({
        key: e.key,
        meta: e.metaKey,
        ctrl: e.ctrlKey,
        alt: e.altKey,
        editable: isEditableTarget(target),
        // ↑↓ 只在"焦点已经在左栏里"时才移动光标：否则会把主区的滚动抢走（见 hotkeys.ts 文件头说明 3）。
        inRail: target instanceof HTMLElement && target.closest('.dc-rail--left') !== null,
        paletteOpen,
        diagOpen,
        leftRail: ui.leftRail,
        view: ui.view,
      })
      if (action === null) return
      if (needsPreventDefault(action)) e.preventDefault()
      switch (action.type) {
        case 'openPalette':
          openPalette()
          return
        case 'closePalette':
          closePalette()
          return
        case 'closeTop':
          // Esc **只关最上层**一页：palette > 诊断面板。
          // 原来这里无条件三样一起关（审计原文 AppShell.tsx:184-189）：用户只想收起搜索面板，
          // 结果连诊断面板一起没了。
          if (action.layer === 'palette') closePalette()
          else closeDiag()
          return
        case 'watchMove':
          // 左栏收起时 resolveHotkey 返回的就是 null（审计 I4 首条缺陷的守卫只此一处），
          // 这里只负责把 ±1 派发给左栏；光标/焦点/滚动都归 WatchList 自己管。
          dispatchWatchMove(action.delta)
          return
        case 'setView':
          pickView(action.view)
          return
        case 'askAi':
          askAi()
          return
        case 'toggleLeftRail':
          updateUi({ leftRail: !ui.leftRail })
          return
        case 'toggleRightRail':
          updateUi({ rightRail: !ui.rightRail })
          return
      }
    },
    // 刻意放行可编辑控件：⌘K 面板打开时焦点就在面板的 input 里，若这里一律早退，
    // 用户**永远关不掉面板**（审计原文点名）。放行之后由 resolveHotkey 逐键判定。
    { allowInEditable: true },
  )

  return (
    <div
      className={`dc-shell${narrow ? ' is-w-narrow' : ''}${tiny ? ' is-w-min' : ''}`}
      ref={shellRef}
      style={shellHeight > 0 ? { height: shellHeight } : undefined}
    >
      {/* 半渲染自检：状态带/栏位没画出来（DOM 却在）时给出唯一出路——硬刷新 */}
      {layoutBroken ? (
        <div className="dc-layout-warn" role="status">
          <AlertTriangle size={12} />
          <span>
            界面未完整渲染（状态带/栏位缺失）—— 通常是浏览器还跑着旧构建。请硬刷新（Ctrl+Shift+R）。
          </span>
          <button
            type="button"
            className="dc-btn dc-btn--accent dc-btn--icon"
            onClick={() => hardReload(build.data?.buildId)}
          >
            硬刷新
          </button>
        </div>
      ) : null}

      <div className="dc-strip-host" ref={stripHostRef}>
        <StatusStrip
          onOpenSearch={openPalette}
          onAskAi={askAi}
          aiBusy={ai.busy}
          stage={stage}
          onPickStage={() => pickView(entryOfStage(stage))}
          onPickView={pickView}
        />
      </div>

      <div className="dc-body">
        {/* 左栏：盯盘列表（任何一级入口都在——"随手看一眼"不能断流；
            它同时是自选 / 个股的入口：点行即看） */}
        <aside className="dc-rail dc-rail--left" hidden={!ui.leftRail}>
          <WatchList />
        </aside>

        {/* 主区：当前一级入口对应的整页（工作台也包括在内，见 ViewHost）。
            列流档位按**主区实测宽度**给（左右栏都开时主区可能只有 ~1148px）：
            ≥1450 → 4 列 · ≥1100 → 3 列 · ≥780 → 2 列 · 否则 1 列。
            1100 这个阈值是从 1180 收下来的：实测 2048 宽窗口只拿到 1148px 主区，
            原阈值会让宽屏用户只看到 2 列（复盘七步因此被压成两列）。 */}
        <main
          className={`dc-main${
            mainWidth >= 1450
              ? ' dc-main--flow4'
              : mainWidth >= 1100
                ? ' dc-main--flow3'
                : mainWidth >= 780
                  ? ' dc-main--flow2'
                  : ''
          }`}
          ref={mainRef}
        >
          <ViewHost />
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
          {sel !== null ? ` · ${sel.market}${sel.code}` : ''}
        </span>
        <span style={{ flex: 1 }} />
        <button
          type="button"
          className="dc-btn dc-btn--ghost dc-btn--icon"
          title="子系统诊断（构建/持久化/数据链路/缓存/AI 与 HIST）"
          onClick={openDiag}
        >
          <Stethoscope size={12} />
        </button>
        <span
          className="dc-ai-note"
          title={
            hostState.availability === 'available'
              ? `数据持久化在 host 侧（DSH 存储子系统 stock_panel 域），浏览器 localStorage 仅作镜像。记录数：${Object.entries(
                  hostState.counts ?? {},
                )
                  .map(([k, v]) => `${k}=${v}`)
                  .join(' ')}`
              : hostState.availability === 'unknown'
                ? '正在接入 host 侧持久化…'
                : `${hostState.reason || 'host 侧持久化不可用'}（数据仍保存在浏览器 localStorage，清缓存会丢）`
          }
        >
          持久化：{hostState.availability === 'available' ? 'host' : hostState.availability === 'unknown' ? '接入中' : '本地'}
        </span>
        {staleBuild ? (
          <button
            type="button"
            className="dc-tag dc-tag--danger dc-tag--action"
            title={`构建产物与运行实例不一致：本页 build ${CLIENT_BUILD_ID} · 服务端 build ${build.data?.buildId ?? '?'}。\n点击会带 build 参数重新加载（绕过 HTTP 缓存）—— 只调 location.reload() 会命中缓存、拿不到新 bundle（v1.4 实测）。\n若加载后仍提示，说明 host 半是重启前的构建 —— 需要重启 dsh web。`}
            onClick={() => hardReload(build.data?.buildId)}
          >
            已更新到 {build.data?.buildId ?? '新版'} · 点此加载
          </button>
        ) : null}
        <span
          className="dc-ai-note"
          title={`插件 v${CLIENT_VERSION} · 本页 build ${CLIENT_BUILD_ID}${build.data ? ` · 服务端 build ${build.data.buildId}` : ''}（构建 id = src 内容哈希）`}
        >
          v{CLIENT_VERSION} · {CLIENT_BUILD_ID}
        </span>
        <span>⌘K 搜索 · 1-7 入口 · j/k 移动 · a 问模型 · [ ] 收栏</span>
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
          onClose={closePalette}
          onPickView={(id) => {
            pickView(id)
            closePalette()
          }}
        />
      ) : null}

      {diagOpen ? (
        // 弹层语义（审计 V6：全仓只有 2 处 ARIA、弹层无 role/aria-modal）。
        // 诊断面板的实现由别人维护，这里用一层 wrapper 补语义、不动它本身：
        // wrapper 在 `.dc-shell`（flex column、无 gap）里是零高度流内子项，
        // 且 `.dc-palette-mask` 是 absolute —— 定位上下文仍是 `.dc-shell`，布局零影响。
        <div role="dialog" aria-modal="true" aria-label="子系统诊断">
          <DiagnosticsPanel
            onClose={closeDiag}
            {...(build.data?.buildId !== undefined ? { serverBuildId: build.data.buildId } : {})}
          />
        </div>
      ) : null}

      {alertUnread > 0 ? (
        <button
          type="button"
          className="dc-alert-badge"
          title={`监控命中未读 ${alertUnread} 条（点击打开监控规则）`}
          onClick={() => {
            markAllRead()
            pickView('alerts')
          }}
        >
          {alertUnread > 99 ? '99+' : alertUnread}
        </button>
      ) : null}
    </div>
  )
}

/**
 * ⌘K 搜索面板：本地全 A 索引 + **一级入口直达**（↑↓ 选择，回车/点击 = 设当前标的或切入口）。
 *
 * 「一级入口直达」搜的是 `ALL_VIEWS`（含不上导航栏的工作台）—— 导航栏上看得见的入口
 * 按 `1-7` 也能到，工作台则只有这里与"点左栏任一行"两条路，所以在面板里必须可搜到。
 *
 * 审计 UX-PLAN V6 的三处修：
 *   1. 结果列表原来**只能拿第一条**（`AppShell.tsx:459-462` 只看 `tools[0]`/`hits[0]`）——
 *      第 2 条以后的票在界面上看得见却选不中。现在 ↑↓ 移动 + `aria-activedescendant` 跟随；
 *   2. 搜索失败原来被 `catch → setHits([])`（`AppShell.tsx:425-427`）吞成"无匹配"
 *      （`AppShell.tsx:492`）—— 用户以为"没有这只票"。现在**失败与无匹配分开渲染**，
 *      失败给可重试的错误行；
 *   3. 面板本身补 `role="dialog"` + `aria-modal`；关闭与焦点回归由 `AppShell` 的
 *      `closePalette` 统一负责（Esc 也不在这里处理：一次 Esc 只该被处理一次）。
 */
function SearchPalette({
  onClose,
  onPickView,
}: {
  onClose: () => void
  onPickView: (id: PrimaryView) => void
}) {
  const [q, setQ] = useState('')
  const [hits, setHits] = useState<SearchHit[]>([])
  const [busy, setBusy] = useState(false)
  /** 搜索**失败**的原因（null = 没有失败）。与"无匹配"严格分开，见文件头第 2 条。 */
  const [error, setError] = useState<string | null>(null)
  /** 重试计数：只作为搜索 effect 的触发源（`searchInstruments` 是纯查表的，重试即重跑）。 */
  const [retryTick, setRetryTick] = useState(0)
  /** ↑↓ 选中的项（0 = 第一项，与旧实现"回车先给工具"的优先级一致）。 */
  const [cursor, setCursor] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  useEffect(() => {
    const query = q.trim()
    if (query === '') {
      setHits([])
      setError(null)
      return
    }
    let alive = true
    setBusy(true)
    setError(null)
    const timer = window.setTimeout(() => {
      void searchInstruments(query, 20)
        .then((list) => {
          if (alive) setHits(list)
        })
        .catch((err: unknown) => {
          if (!alive) return
          // 清掉上一轮命中：否则"失败"会和另一条查询的结果同屏显示，更容易读错。
          setHits([])
          setError(err instanceof Error && err.message !== '' ? err.message : String(err))
        })
        .finally(() => {
          if (alive) setBusy(false)
        })
    }, 120)
    return () => {
      alive = false
      window.clearTimeout(timer)
    }
  }, [q, retryTick])

  // 查询一变就重选第一项：否则光标停在上一条查询的第 5 项上，回车打开的是"别的东西"。
  useEffect(() => {
    setCursor(0)
  }, [q])

  const pick = (h: SearchHit) => {
    openStockAndWatch({ market: h.market, code: h.code, name: h.name })
    onClose()
  }

  const query = q.trim().toLowerCase()
  const entries =
    query === ''
      ? []
      : ALL_VIEWS.filter((v) => v.label.toLowerCase().includes(query) || v.hint.toLowerCase().includes(query))

  /** 可选中项：入口在前、标的在后（保持旧实现的优先顺序）。 */
  const options: Array<() => void> = [
    ...entries.map((v) => () => onPickView(v.id)),
    ...hits.map((h) => () => pick(h)),
  ]
  const optionCount = options.length
  /** 高亮项（列表变短时把光标夹回范围内；无结果 = -1）。 */
  const active = optionCount === 0 ? -1 : Math.min(cursor, optionCount - 1)
  const optionId = (i: number) => `dc-palette-opt-${i}`
  const moveCursor = (delta: number) => {
    if (optionCount === 0) return
    setCursor((c) => Math.min(optionCount - 1, Math.max(0, Math.min(Math.max(c, 0), optionCount - 1) + delta)))
  }

  return (
    <div className="dc-palette-mask" onClick={onClose}>
      <div
        className="dc-palette"
        role="dialog"
        aria-modal="true"
        aria-label="搜索标的或功能"
        onClick={(e) => e.stopPropagation()}
      >
        <input
          ref={inputRef}
          className="dc-palette-input"
          placeholder="搜索代码 / 名称，或输入入口名（如 行情 / 选股 / 监控 / 工作台）"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          // 焦点始终留在输入框（还能继续打字），靠 aria-activedescendant 让读屏念出高亮项
          // —— 这是列表里"高亮当前项"的无障碍等价物（焦点不能真的搬进列表）。
          role="combobox"
          aria-expanded={optionCount > 0}
          aria-controls="dc-palette-list"
          aria-autocomplete="list"
          aria-activedescendant={active >= 0 ? optionId(active) : undefined}
          onKeyDown={(e) => {
            // ↑↓/Enter 在面板内是"选择"，所以归输入框自己处理（全局解析器此时一律返回 null）。
            if (e.key === 'ArrowDown') {
              e.preventDefault()
              moveCursor(1)
              return
            }
            if (e.key === 'ArrowUp') {
              e.preventDefault()
              moveCursor(-1)
              return
            }
            if (e.key === 'Enter') {
              options[active]?.()
            }
            // Esc 刻意**不在这里**处理：面板关闭 + 焦点回归统一由 resolveHotkey 的 closeTop 负责。
            // 两处都关 = 同一次 Esc 关两样，正是"一次关三样"的同类隐患。
          }}
        />
        {/*
          状态行（搜索中 / 失败 / 无匹配）放在 listbox **外面**，两个原因：
            ① `role="listbox"` 的直接子元素只允许 option / group（ARIA 1.2）——
               把带"重试"按钮的错误行塞进去是硬违规；
            ② 错误行不该被列表滚走：搜索源挂掉时它是唯一能解释"为什么什么都没有"的东西。
        */}
        {busy && optionCount === 0 ? (
          <div className="dc-row-hint" role="status">
            搜索中…
          </div>
        ) : null}
        {/* ★ 失败 ≠ 无匹配：失败时给原因 + 重试（role="alert" 会被读屏立刻念出来），
            并且**不显示"无匹配"** —— 原来 `catch → setHits([])` 把"搜索源挂了"说成
            "没这只票"，用户会去别处找、白白怀疑自己的输入。 */}
        {!busy && error !== null ? (
          <div className="dc-row-hint" role="alert">
            {/* 颜色挂在**子 span** 上：`.dc-row-hint`（index.css.txt:765）在 `.dc-bad`（:637）
                之后、特异性又相同，直接写 `className="dc-row-hint dc-bad"` 会被 hint 的
                `color: var(--dc-dim)` 吃掉 —— 错误行会长得和"无匹配"一模一样（这正是要修的那个坑）。 */}
            <span className="dc-bad">搜索失败：{error}</span>
            <button type="button" className="dc-btn dc-btn--ghost" onClick={() => setRetryTick((x) => x + 1)}>
              重试
            </button>
          </div>
        ) : null}
        {!busy && error === null && query !== '' && optionCount === 0 ? (
          <div className="dc-row-hint" role="status">
            无匹配
          </div>
        ) : null}
        <div className="dc-palette-list dc-scroll" id="dc-palette-list" role="listbox" aria-label="搜索结果">
          {entries.length > 0 ? (
            // 入口与标的是两组结果：用 role="group" + aria-label 把分组名交给读屏
            // （视觉上的"入口"那行是装饰，所以 aria-hidden）。
            <div role="group" aria-label="一级入口">
              <div className="dc-row-hint" aria-hidden="true">
                入口
              </div>
              {entries.map((v, i) => (
                <div
                  key={v.id}
                  id={optionId(i)}
                  role="option"
                  aria-selected={i === active}
                  className={`dc-row${i === active ? ' is-active' : ''}`}
                  onClick={() => onPickView(v.id)}
                  onMouseEnter={() => setCursor(i)}
                >
                  <div className="dc-row-main">
                    <span className="dc-row-name">
                      <Compass size={11} /> {v.label}
                    </span>
                    <span className="dc-row-sub">{v.hint}</span>
                  </div>
                </div>
              ))}
            </div>
          ) : null}
          {hits.map((h, i) => {
            const index = entries.length + i
            return (
              <div
                key={h.symbol}
                id={optionId(index)}
                role="option"
                aria-selected={index === active}
                className={`dc-row${index === active ? ' is-active' : ''}`}
                onClick={() => pick(h)}
                onMouseEnter={() => setCursor(index)}
              >
                <div className="dc-row-main">
                  <span className="dc-row-name">{h.name}</span>
                  <span className="dc-row-sub">{h.symbol}</span>
                </div>
                <Search size={12} style={{ opacity: 0.4 }} />
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

/** 视图类型再导出（供未来扩展）。 */
export type { PrimaryView }
