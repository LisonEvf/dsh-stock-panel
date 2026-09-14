/**
 * src/pages/MarketPage.tsx —— 行情聚合页：**一屏仪表盘**。
 *
 * ## 重排的由来（2026-09-14 真机测量，不是审美偏好）
 *
 * 收口前是「总览(4) | 指数(5) | 梯队(3)」三块并排，但真机容器只有 **780px**（左右栏都开），
 * 于是降到 2 列、栅格只有两行 395px。逐块量「内容高 vs 可视高」：
 *
 *   市场总览：内容 1391 / 可视 363 → **藏 74%**；涨停梯队：2174 / 363 → **藏 83%**；
 *   指数：363 / 363 → 0%（图自适应，唯一排对的块）。
 *
 * 也就是说"一屏看完"当时只对指数成立 —— 另外两块各是一个独立滚动条，你看到的是一道缝；
 * 而同一个数在页面上出现两三遍（总览 2×2、梯队 2×2、状态带各一份），
 * 实测整页 innerText 里「涨停」出现 **19 次**。
 *
 * ## 现在的组合（按"内容该占多少"分配，不是按"当初三块各一份"）
 *
 * ```
 * 页头（节拍 / 刷新 / 预算与轮询状态，一行）
 * 环境带（6 格 KPI + 涨跌分布条）—— 两个 2×2 的并集，同一个数只出现一次
 * 主行：指数（含图，左）│ 涨停梯队（右）
 * 底行：榜单（4 张，2×2）│ 市场异动
 * ```
 *
 * 各行高度由内容决定（环境带/底行固定档），主行吃剩余（图表自适应）。
 *
 * ## ⚠️ 请求预算纪律（本页最大的风险：涨停梯队**单轮 ≤177 次工具调用**）
 *
 *   1. **全页只有一个节拍器**：15/20/30/60s 或暂停，由 `tick` 驱动各块强制验证 ——
 *      否则同一份指数数据会被两个订阅者各拉一遍（`useSwr` 的 in-flight 去重只在同时发起时生效）；
 *   2. **块可折叠**：折叠即卸载 → 该块轮询立刻停止（默认全展开）；
 *   3. **离开视野停轮询**：窄屏退化态下只让可见块轮询；
 *   4. **数据归属只有一处**：全 A / 异动 / 指数由本页持有（环境带与榜单要的是同一份全 A），
 *      涨停梯队的连板统计只由 `LadderPage` 算，通过 `onStats` 上报 ——
 *      页面**不重算**，避免把最贵的那段逻辑抄第二份。
 *   5. 涨停梯队即使被更快节拍驱动也走自己的 30s 共享缓存 → 实际仍 ~30s 一轮。
 */
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { RefreshCw, Pause, Play, ChevronDown, ChevronRight, LayoutGrid } from 'lucide-react'
import { IndicesPage } from './IndicesPage'
import { LadderPage } from './LadderPage'
import { MarketKpiBar, type LadderStats } from '@/components/MarketKpiBar'
import { MarketBoards, UnusualFeed } from '@/components/MarketBoards'
import { useAvailableHeight, useContainerWidth } from '@/panel/hooks'
import { openStockAndWatch, useUi, type Selection } from '@/lib/selection'
import { usePollGate, isPollAllowed, notePollSkipped } from '@/lib/poll-gate'
import { useSwr, swrKey } from '@/lib/cache'
import {
  computeBreadth,
  computeDistribution,
  ensureSearchIndex,
  fetchAllA,
  fetchUnusualAll,
  INDEX_LIST,
  type AShareRow,
  type UnusualItem,
} from '@/lib/market'
import { StateView } from '@/components/StateView'

/** 可调节拍（0 = 暂停自动刷新，仍可手动刷新）。 */
const TACT_OPTIONS: Array<{ ms: number; label: string; hint: string }> = [
  { ms: 15_000, label: '15s', hint: '最激进：三块全在跑时的请求量约为 30s 档的两倍' },
  { ms: 20_000, label: '20s', hint: '较激进：接近原先「市场总览」单独使用的节奏' },
  { ms: 30_000, label: '30s', hint: '默认：聚合页多块同时在跑，取更省的节奏（涨停梯队本来就是 30s 一轮）' },
  { ms: 60_000, label: '60s', hint: '最省：只看大方向' },
  { ms: 0, label: '暂停', hint: '停止自动刷新（切到别的页签 / 后台标签页也会自动停）' },
]

type SectionId = 'indices' | 'ladder' | 'boards' | 'unusual'

/**
 * 页面级兜底的观察窗（ms）。
 *
 * 为什么需要（审计结论）：各块**各自**有兜底，但"全都取不到数"这件事**没有任何地方表达** ——
 * 用户看到的是几块各自的小字提示，得自己在脑子里拼出"今天数据源不可达"。
 *
 * 为什么不违反"全页只有一个节拍器"：这里不是在加第二个**轮询**，而是只在
 * ① 首屏装配 ② 手动"刷新全部" 之后各起一个**一次性**观察窗；判定用的是现成信号
 * （本页拉到的数据时间戳），没有新增任何请求。`scripts/budget.mjs` 的棘轮只统计
 * `setInterval` / `useSwr(refreshInterval)` 声明点，一次性 setTimeout 不计入（也不该计入）。
 */
const ASSEMBLY_GRACE_MS = 12_000

interface SectionMeta {
  id: SectionId
  label: string
  hint: string
}

const SECTIONS: SectionMeta[] = [
  { id: 'indices', label: '指数', hint: '9 大指数 · 切换条 + 摘要 + 日K/分时' },
  { id: 'ladder', label: '涨停梯队', hint: '连板梯队 + 板块热度（最贵：单轮 ≤177 次调用）' },
  { id: 'boards', label: '榜单', hint: '涨幅 / 跌幅 / 成交额 / 换手率' },
  /* 提示句要**短**：块头里标题 + 提示 + 时间戳 + 刷新挤在 ~260–380px 内，
     长句会被截成「沪深北三市场...」（实测）。完整口径进 title。 */
  { id: 'unusual', label: '市场异动', hint: '沪深北 · 倒序' },
]

/**
 * 块可见性：宽屏全可见 → 都在跑（本页意图）；窄屏退化态只让可见块轮询。
 * `mounted` 只增不减，避免滚动/折叠来回反复挂载重取。
 */
function useSection() {
  const ref = useRef<HTMLElement>(null)
  const [active, setActive] = useState(true)
  const [mounted, setMounted] = useState(true)

  useEffect(() => {
    const el = ref.current
    if (!el || typeof IntersectionObserver === 'undefined') return
    const io = new IntersectionObserver(
      (entries) => {
        const visible = entries.some((e) => e.isIntersecting)
        setActive(visible)
        if (visible) setMounted(true)
      },
      { rootMargin: '240px 0px' },
    )
    io.observe(el)
    return () => io.disconnect()
  }, [])

  return { ref, active, mounted }
}

export function MarketPage({ onOpenStock }: { onOpenStock?: (s: Selection) => void }) {
  const [tactMs, setTactMs] = useState(30_000)
  const [tick, setTick] = useState(0)
  const [lastTickAt, setLastTickAt] = useState<number | null>(null)
  /**
   * 「指数」块跟随顶部状态带的指数点击。
   *
   * 为什么要有这条联动：状态带的指数格 tooltip 一直写着「点击打开『行情』页的指数区块」，
   * 而它其实只做了 `setView('market')` + 设当前标的 —— **指数块并不跟随**
   * （点击前显示哪个指数，点击后还是哪个）。这里把两边接上：
   * 只认 9 大指数清单里的标的（点个股不该把这个块变成"个股图"，它的标题是「指数」）。
   */
  const ui = useUi()
  const sel = ui.selection
  const focusIndex = useMemo(() => {
    if (sel === null) return null
    const meta = INDEX_LIST.find((i) => i.code === sel.code && i.market === sel.market)
    return meta === undefined ? null : { market: sel.market, code: sel.code, name: sel.name }
  }, [sel])
  /** 每块自己的刷新计数（与全局 tick 相加后传给子块：任一变化都会触发该块强制验证）。 */
  const [localTick, setLocalTick] = useState<Record<SectionId, number>>({
    indices: 0,
    ladder: 0,
    boards: 0,
    unusual: 0,
  })
  /** 每块自己的数据时间戳（子块 `onUpdatedAt` 回传 / 本页取数后自行写入）。 */
  const [blockAt, setBlockAt] = useState<Partial<Record<SectionId, number>>>({})
  const [collapsed, setCollapsed] = useState<Record<SectionId, boolean>>({
    indices: false,
    ladder: false,
    boards: false,
    unusual: false,
  })
  /** 涨停梯队的环境数字（由块上报；页面不重算，见文件头第 4 条）。 */
  const [ladderStats, setLadderStats] = useState<LadderStats | null>(null)

  const indices = useSection()
  const ladder = useSection()
  const boards = useSection()
  const unusualSec = useSection()
  /** 栅格自己既是「列数」的测量对象，也是「可用高度」的测量对象。 */
  const gridRef = useRef<HTMLDivElement>(null)
  const containerWidth = useContainerWidth(gridRef)
  const availableHeight = useAvailableHeight(gridRef, { min: 520 })
  const sections = useMemo<Record<SectionId, ReturnType<typeof useSection>>>(
    () => ({ indices, ladder, boards, unusual: unusualSec }),
    [indices, ladder, boards, unusualSec],
  )

  /* ── 页面持有的三条数据（环境带 + 榜单 + 异动）──────────────────────────
   * 为什么由页面持有而不是各块自己拉：环境带与榜单要的是**同一份全 A**，
   * 两处各写一个 useSwr（即使 key 相同）也会把"刷新时谁驱动谁"搞乱；
   * 由页面持有后，折叠任何一块都不会影响环境带的数字。
   *
   * `refreshInterval: 0`（**不是** `enabled:false`）让缓存层不起定时器，刷新率由本页节拍器独占。
   * 这里有个坑值得记下来：`enabled:false` 会让 useSwr 的调度 effect 直接 return，
   * 于是连 `refresh()` 也不生效（它只是 bump 一个 nonce）—— 手动刷新会静默失灵。
   * 所以"只关定时器"要用 `refreshInterval: 0`。
   */
  const allASwr = useSwr(swrKey.allA(), () => fetchAllA(), { ttl: 6_000, refreshInterval: 0 })
  const unusualSwr = useSwr(swrKey.unusualAll(), () => fetchUnusualAll(40), { ttl: 6_000, refreshInterval: 0 })
  const rows = useMemo<AShareRow[]>(() => allASwr.data ?? [], [allASwr.data])
  const unusual = useMemo<UnusualItem[]>(() => unusualSwr.data ?? [], [unusualSwr.data])
  const breadth = useMemo(() => (rows.length > 0 ? computeBreadth(rows) : null), [rows])
  const dist = useMemo(() => (rows.length > 0 ? computeDistribution(rows) : null), [rows])

  const refreshRows = allASwr.refresh
  const refreshUnusual = unusualSwr.refresh
  /** 榜单/异动数据的刷新时间（本页持有，故自己写进 blockAt）。 */
  const rowsAt = allASwr.updatedAt
  const unusualAt = unusualSwr.updatedAt
  useEffect(() => {
    if (rowsAt === undefined) return
    setBlockAt((s) => (s.boards === rowsAt ? s : { ...s, boards: rowsAt }))
  }, [rowsAt])
  useEffect(() => {
    if (unusualAt === undefined) return
    setBlockAt((s) => (s.unusual === unusualAt ? s : { ...s, unusual: unusualAt }))
  }, [unusualAt])

  // 首屏由 useSwr 的挂载调度负责取数（命中新鲜缓存则秒开、不重复请求）；
  // 此后全部由节拍器驱动 —— 这里**不**再补一次手动 refresh，否则挂载时会取两遍。

  // 预热本地搜索索引（行情页已拉全 A，搜索零成本；懒加载不阻塞首屏）
  useEffect(() => {
    void ensureSearchIndex().catch(() => undefined)
  }, [])

  // 全页唯一节拍器（标签页隐藏时跳过本轮，与 cache.ts 的轮询纪律一致）
  useEffect(() => {
    if (tactMs <= 0) return
    const timer = window.setInterval(() => {
      if (typeof document !== 'undefined' && document.hidden) return
      // 休市闸门：节拍器一拍就会驱动所有块强制验证 —— 非交易时段不推它，
      // 否则"轮询闸门"只是挡住了 cache 的定时器，节拍器照样把请求打出去。
      if (!isPollAllowed()) {
        notePollSkipped()
        return
      }
      setTick((v) => v + 1)
      setLastTickAt(Date.now())
    }, tactMs)
    return () => window.clearInterval(timer)
  }, [tactMs])

  // 节拍驱动本页持有的两条数据（榜单与异动属于它）
  useEffect(() => {
    if (tick === 0) return
    if (!collapsed.boards && boards.active) refreshRows()
    if (!collapsed.unusual && unusualSec.active) refreshUnusual()
  }, [tick, collapsed.boards, collapsed.unusual, boards.active, unusualSec.active, refreshRows, refreshUnusual])

  const refreshAll = useCallback(() => {
    setTick((v) => v + 1)
    setLastTickAt(Date.now())
  }, [])

  /* ── 页面级兜底：全都不可达（审计点名的缺口） ─────────────────────────
   * 判定只用**已有**信号：块仅在成功取数后回传 `onUpdatedAt` → `blockAt`。
   * 因此"本块有过时间戳" ⇔ "本块至少成功取过一次数"，不需要再加探针请求。
   * 只看「展开且在视野内」的块：窄屏退化态下不可见的块 `enabled=false`，
   * 压根没发请求，把它们算作"不可达"是误报。
   */
  const [probeSeq, setProbeSeq] = useState(0)
  const [graceExpired, setGraceExpired] = useState(false)
  const expectedBlocks = (['indices', 'ladder', 'boards', 'unusual'] as SectionId[]).filter(
    (id) => !collapsed[id] && sections[id].active,
  )
  const expectedCount = expectedBlocks.length
  const reportedCount = expectedBlocks.filter((id) => blockAt[id] !== undefined).length

  useEffect(() => {
    // 没有"该取数的块"（全折叠/全不在视野），或已经有一块成功 → 无从判定，撤掉兜底
    if (expectedCount === 0 || reportedCount > 0) {
      setGraceExpired(false)
      return
    }
    const t = window.setTimeout(() => setGraceExpired(true), ASSEMBLY_GRACE_MS)
    return () => window.clearTimeout(t)
  }, [expectedCount, reportedCount, probeSeq])

  /** 全都回报不到数据（页面级结论）。 */
  const pageUnreachable = expectedCount > 0 && reportedCount === 0 && graceExpired
  /** 「刷新全部」：重开观察窗 + 驱动节拍器（不给第二套刷新路径，仍走 refreshAll）。 */
  const retryAll = useCallback(() => {
    setGraceExpired(false)
    setProbeSeq((v) => v + 1)
    refreshAll()
  }, [refreshAll])

  const refreshOne = useCallback(
    (id: SectionId) => {
      setLocalTick((s) => ({ ...s, [id]: s[id] + 1 }))
      if (id === 'boards') refreshRows()
      if (id === 'unusual') refreshUnusual()
    },
    [refreshRows, refreshUnusual],
  )

  const toggle = useCallback((id: SectionId) => {
    setCollapsed((c) => ({ ...c, [id]: !c[id] }))
  }, [])

  const openStock = onOpenStock ?? openStockAndWatch
  /** 休市闸门状态（非交易时段定时轮询被挡，头部如实说明）。 */
  const gate = usePollGate()
  const activeCount = (['indices', 'ladder', 'boards', 'unusual'] as SectionId[]).filter(
    (id) => !collapsed[id] && sections[id].active,
  ).length
  const hhmmss = (at: number | undefined) =>
    at === undefined ? '—' : new Date(at).toLocaleTimeString('zh-CN', { hour12: false })

  // 按容器实测宽度决定列数（不用视口断点，见文件头注释）
  const cols = containerWidth >= 1120 ? 3 : containerWidth >= 760 ? 2 : 1
  const gridClass = cols === 1 ? 'dc-mkt-grid is-1col' : `dc-mkt-grid is-${cols}col`
  // 高度：量「到最近滚动容器可视底边」的可用空间，而不是 calc(100vh - 216px) ——
  // 宿主头部高度/字号（可调 12–17px）/提示条都会变，硬减一个常数换个环境必然错位。
  const gridStyle =
    cols === 1 ? undefined : { height: availableHeight > 0 ? `${availableHeight}px` : undefined, minHeight: 520 }

  /** 一个块的外壳：标题栏（本块时间 / 刷新本块 / 折叠）+ 内部滚动区。 */
  const renderBlock = (meta: SectionMeta, body: ReactNode, extra?: ReactNode) => {
    const sec = sections[meta.id]
    const isCollapsed = collapsed[meta.id]
    return (
      <section
        key={meta.id}
        ref={sec.ref}
        className={`dc-mkt-block dc-mkt-${meta.id}${cols === 1 ? ' is-flow' : ''}`}
      >
        <div className="dc-mkt-block-head">
          <button
            type="button"
            onClick={() => toggle(meta.id)}
            title={isCollapsed ? '展开（展开后恢复轮询）' : '折叠（折叠即停止该块轮询，省请求）'}
            className="dc-mkt-block-title"
          >
            {isCollapsed ? <ChevronRight size={11} /> : <ChevronDown size={11} />}
            <span className="truncate">{meta.label}</span>
          </button>
          <span className="dc-mkt-block-hint" title={meta.hint}>
            {meta.hint}
          </span>
          <span className="dc-mkt-block-tail">
            {extra}
            <span className="font-mono dc-t-micro text-dc-dim" title="本块最近一次成功取数时间">
              {hhmmss(blockAt[meta.id])}
            </span>
            <button
              type="button"
              onClick={() => refreshOne(meta.id)}
              title="只刷新这一块（强制验证；涨停梯队仍受其 30s 缓存约束）"
              className="rounded-dc-sm p-0.5 text-dc-text-3 hover:bg-dc-layer-3"
            >
              <RefreshCw size={11} />
            </button>
          </span>
        </div>
        {!isCollapsed && <div className="dc-mkt-block-body">{sec.mounted ? body : null}</div>}
      </section>
    )
  }

  /** 榜单/异动是**本页持有数据**的块，错误与空态也在这里说（与指数/梯队各自内部的措辞同源）。 */
  const boardsError = allASwr.error
  const unusualError = unusualSwr.error

  return (
    <div className="dc-mkt">
      {/* 顶栏：节拍 + 全局刷新 + 预算提示（聚合页必须让请求代价可见）。
          **不换行**（`flex-nowrap` + 提示句可截断）：换行会把这一行拆成两行、
          且第二行左侧空 570px（实测）—— 省下的是 ~28px 的竖向空间，而那正是主行要的。 */}
      <div className="flex items-center gap-2">
        <span className="flex flex-none items-center gap-1 dc-t-data font-semibold text-dc-text">
          <LayoutGrid size={12} className="text-dc-info" />
          行情
        </span>
        <span
          className="dc-t-micro min-w-0 flex-1 truncate text-dc-text-3"
          title="环境 / 指数 / 涨停梯队 / 榜单 / 市场异动 一屏读完 · 全页共用一个节拍器（无第二个定时器）· 折叠某块即停止它的轮询"
        >
          一屏读完 · 全页共用一个节拍器
        </span>
        <span className="flex flex-none items-center gap-1">
          <span className="dc-t-micro text-dc-text-3" title="节拍：驱动所有展开中的块">
            节拍
          </span>
          {TACT_OPTIONS.map((o) => (
            <button
              key={o.ms}
              type="button"
              title={o.hint}
              onClick={() => setTactMs(o.ms)}
              className={`rounded-dc-sm px-1 py-px font-mono dc-t-micro ${
                tactMs === o.ms ? 'dc-soft-info text-dc-info' : 'text-dc-text-3 hover:bg-dc-layer-3'
              }`}
            >
              {o.label}
            </button>
          ))}
          <button
            type="button"
            onClick={refreshAll}
            title="立即刷新全部展开中的块"
            className="dc-btn dc-btn--ghost dc-t-micro px-1.5 py-0.5"
          >
            <RefreshCw size={10} />
            刷新
          </button>
          {tactMs <= 0 ? (
            <span className="flex items-center gap-0.5 dc-t-micro text-dc-warn">
              <Pause size={9} /> 已暂停
            </span>
          ) : (
            <span className="flex items-center gap-0.5 font-mono dc-t-micro text-dc-text-3">
              <Play size={9} /> {tactMs / 1000}s
            </span>
          )}
          <span className="font-mono dc-t-micro text-dc-dim" title="上次自动刷新（所有展开块一起）">
            {lastTickAt === null ? '' : `· ${hhmmss(lastTickAt)}`}
          </span>
          {/* 休市闸门：非交易时段行情不会变，定时轮询已被挡下（手动刷新仍可用）。
              这里如实说明原因，而不是继续显示"轮询中"让人以为还在取数。 */}
          {gate.allowed ? (
            <span className="dc-t-micro text-dc-text-3">轮询中 {activeCount}/4</span>
          ) : (
            <span className="dc-t-micro text-dc-warn" title={gate.reason}>
              休市 · 已暂停定时轮询（手动刷新可用）
            </span>
          )}
        </span>
      </div>

      {/* 页面级兜底：全都取不到数时，把"今天数据源不可达"说成一句话并给出唯一出口。
          用紧凑形态而不是替换整块栅格：各块自己的错误/空态仍由块内负责，
          这里只补"页面级结论 + 刷新全部"——避免同一件事在页面上说两遍。 */}
      {pageUnreachable && (
        <StateView
          kind="error"
          compact
          kindLabel="数据源不可达"
          title={expectedCount >= 4 ? '四块都没取到数据' : `当前展开的 ${expectedCount} 块都没取到数据`}
          hint={`观察窗 ${ASSEMBLY_GRACE_MS / 1000}s 内没有任何一块回报数据（各块内部的提示见对应区块）`}
          reason="指数 / 涨停梯队 / 榜单 / 异动：展开中的块在观察窗内均无成功取数（单次超时或数据源离线）"
          retryLabel="刷新全部"
          onRetry={retryAll}
        />
      )}

      {/* 聚合栅格：按容器实测宽度 3/2/1 列；≥2 列时整页不滚动、各块内部滚动 */}
      <div ref={gridRef} className={gridClass} style={gridStyle}>
        {/* 环境带（全宽）：两个 2×2 的并集 —— 同一个数在一屏里只出现一次 */}
        <div className="dc-mkt-kpi">
          <MarketKpiBar breadth={breadth} dist={dist} ladder={ladderStats} loading={allASwr.isLoading && rows.length === 0} />
        </div>

        {renderBlock(
          SECTIONS[0],
          <IndicesPage
            embedded
            initial={focusIndex}
            enabled={!collapsed.indices && indices.active}
            tick={tick + localTick.indices}
            /* ⚠️ pollMs={0} 必须传：本块自带 15s 定时器，不关掉就等于**页面上有两个节拍器**，
               而页头写着"全页共用一个节拍器"（审计项 I-b 就是这么来的：
               旧代码三块都没关自带定时器 —— 实际是 4 个定时器同时在跑，声明与实际不符）。 */
            pollMs={0}
            onUpdatedAt={(at) => setBlockAt((s) => (s.indices === at ? s : { ...s, indices: at }))}
          />,
        )}
        {renderBlock(
          SECTIONS[1],
          <LadderPage
            onOpenStock={openStock}
            enabled={!collapsed.ladder && ladder.active}
            tick={tick + localTick.ladder}
            /* 同上：本块自带 30s 定时器（它最贵，单轮 ≤177 次工具调用） */
            pollMs={0}
            onUpdatedAt={(at) => setBlockAt((s) => (s.ladder === at ? s : { ...s, ladder: at }))}
            onStats={setLadderStats}
          />,
        )}

        {renderBlock(
          SECTIONS[2],
          <>
            {boardsError !== undefined && boardsError !== '' && (
              <div className="mb-1.5 rounded-dc-sm dc-soft-danger px-2 py-1 dc-t-note text-dc-bad">{boardsError}</div>
            )}
            {rows.length > 0 ? (
              <MarketBoards
                rows={rows}
                onOpenStock={(market, code, name) => openStock({ market, code, name })}
              />
            ) : (
              !allASwr.isLoading && (
                <div className="rounded-dc-sm border border-dashed border-dc-border px-2 py-3 text-center dc-t-data text-dc-dim">
                  行情源暂无全 A 数据（非交易时段或数据源未连接；节拍器仍会重试）
                </div>
              )
            )}
          </>,
          <span className="dc-t-micro text-dc-dim" title="榜单口径：全 A 快照按当日涨幅 / 成交额 / 换手率排序">
            全 A
          </span>,
        )}

        {renderBlock(
          SECTIONS[3],
          <>
            {unusualError !== undefined && unusualError !== '' && (
              <div className="mb-1.5 rounded-dc-sm dc-soft-danger px-2 py-1 dc-t-note text-dc-bad">{unusualError}</div>
            )}
            {unusual.length > 0 ? (
              <UnusualFeed
                items={unusual}
                onOpenStock={(market, code, name) => openStock({ market, code, name })}
              />
            ) : (
              !unusualSwr.isLoading && (
                <div className="rounded-dc-sm border border-dashed border-dc-border px-2 py-3 text-center dc-t-data text-dc-dim">
                  异动列表为空（休市 / 数据源未连接，或当前确实没有异动）
                </div>
              )
            )}
          </>,
          <span className="dc-t-micro text-dc-dim" title="沪深北三市场异动合并、按时间倒序；这里只显示前 8 条（下一轮刷新会自动更新）">
            前 8 条
          </span>,
        )}
      </div>
    </div>
  )
}
