/**
 * src/pages/MarketPage.tsx —— 行情聚合面板：市场总览 + 指数 + 涨停梯队 **在一屏里并排聚合**（A4 合并）。
 *
 * 设计意图（用户决策）：不是把三块**竖着摞**成一条长页，而是**在一个面板里聚合成宽屏仪表盘** ——
 * 三块各占一列、各自内部滚动、整页不滚动：盯盘时眼睛不用上下翻，横向一眼扫完
 * 「大盘状态 / 指数走势 / 钱在哪些板」。
 *
 * 布局（12 栅格）：
 *   ≥1280px：总览(4) | 指数(5) | 梯队(3)   ← 指数最宽，因为它含 K 线/分时图
 *   ≥1024px：两列（总览 | 指数 / 梯队）
 *   窄屏    ：单列（退化态；此时靠 IntersectionObserver 只让可见块轮询）
 *
 * ⚠️ 请求预算纪律（聚合面板最大的风险，涨停梯队**单轮 ≤177 次工具调用**）：
 *   1. **全页只有一个节拍器**：15/20/30/60s 或暂停，由 `tick` 驱动各块强制验证 ——
 *      否则同一份指数数据会被两个订阅者各拉一遍（`useSwr` 的 in-flight 去重只在同时发起时生效）；
 *   2. **块可折叠**：折叠即卸载 → 该块轮询立刻停止（默认全展开；只想看指数时收掉另两块）；
 *   3. **离开视野停轮询**：窄屏退化态下只让可见块轮询（宽屏三列全可见时三块同时在跑，
 *      这正是本页的意图，因此默认节拍取 30s 而不是 20s，并在页头把代价写清楚）；
 *   4. 涨停梯队即使被更快节拍驱动也走自己的 30s 共享缓存 → 实际仍 ~30s 一轮。
 *
 * 每个块自带：本块刷新时间 + 单块刷新按钮（只刷这一块）+ 折叠开关。
 */
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { RefreshCw, Pause, Play, ChevronDown, ChevronRight, LayoutGrid } from 'lucide-react'
import { MarketOverview } from './MarketOverview'
import { IndicesPage } from './IndicesPage'
import { LadderPage } from './LadderPage'
import { useAvailableHeight, useContainerWidth } from '@/panel/hooks'
import { openStockAndWatch, type Selection } from '@/lib/selection'
import { usePollGate, isPollAllowed, notePollSkipped } from '@/lib/poll-gate'
import type { MarketTag } from '@/lib/symbol'
import { StateView } from '@/components/StateView'

/** 可调节拍（0 = 暂停自动刷新，仍可手动刷新）。 */
const TACT_OPTIONS: Array<{ ms: number; label: string; hint: string }> = [
  { ms: 15_000, label: '15s', hint: '最激进：三块全在跑时的请求量约为 30s 档的两倍' },
  { ms: 20_000, label: '20s', hint: '较激进：接近原先「市场总览」单独使用的节奏' },
  { ms: 30_000, label: '30s', hint: '默认：聚合面板三块同时在跑，取更省的节奏（涨停梯队本来就是 30s 一轮）' },
  { ms: 60_000, label: '60s', hint: '最省：只看大方向' },
  { ms: 0, label: '暂停', hint: '停止自动刷新（切到别的页签 / 后台标签页也会自动停）' },
]

type SectionId = 'overview' | 'indices' | 'ladder'

/**
 * 页面级兜底的观察窗（ms）。
 *
 * 为什么需要（审计结论）：本页三块**各自**有兜底，但"三块全都取不到数"这件事
 * **没有任何地方表达**（原话：MarketPage 自身零兜底）—— 用户看到的是三块各自的
 * 小字提示，得自己在脑子里拼出"今天数据源不可达"这个结论。
 *
 * 为什么不违反"全页只有一个节拍器"：这里不是在加第二个**轮询**，而是只在
 * ① 首屏装配 ② 手动"刷新全部" 之后各起一个**一次性**观察窗；而且判定用的是
 * 现成的信号（子页面只在成功时回传 `onUpdatedAt`），没有新增任何请求。
 * `scripts/budget.mjs` 的棘轮只统计 `setInterval` / `useSwr(refreshInterval)` 声明点，
 * 一次性 setTimeout 不计入（也不该计入：它不产生周期流量）。
 */
const ASSEMBLY_GRACE_MS = 12_000

interface SectionMeta {
  id: SectionId
  label: string
  hint: string
}

const SECTIONS: SectionMeta[] = [
  { id: 'overview', label: '市场总览', hint: '涨跌分布 / 榜单 / 异动速递' },
  { id: 'indices', label: '指数', hint: '9 大指数：切换条 + 摘要 + 日K/分时' },
  { id: 'ladder', label: '涨停梯队', hint: '连板梯队 + 板块热度（单轮 ≤177 次工具调用）' },
]

/**
 * 三列时的栅格跨度（12 栅格）：指数最宽——它是唯一含图表的块。
 * 两列时：总览 | 指数 在第一行，梯队横跨整行（它内容最长，独占一行才读得顺）。
 */
const SPAN_3COL: Record<SectionId, string> = {
  overview: 'col-span-4',
  indices: 'col-span-5',
  ladder: 'col-span-3',
}
const SPAN_2COL: Record<SectionId, string> = {
  overview: 'col-span-6',
  indices: 'col-span-6',
  ladder: 'col-span-12',
}

/**
 * 块可见性：宽屏三列全可见 → 三块都在跑（本页意图）；窄屏退化态只让可见块轮询。
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

/**
 * 按**容器实测宽度**（不是视口宽度）决定列数。
 *
 * 为什么不能用 Tailwind 的 `xl:` 断点：那是**视口**断点，而本页只是面板内的一块区域 ——
 * DSH 左侧会话栏 + 右侧 AI 栏都在时，视口 1920px 的面板可用宽度可能只有 600px。
 * 实测（真机截图）就出现了"视口够宽 → 强制三列 → 每列 ~200px 挤成一团"。
 * 所以这里用 ResizeObserver 量真实可用宽度：≥1120 → 三列；≥760 → 两列；否则单列。
 *
 * B1 起 `useContainerWidth` / `useAvailableHeight` 已提升到 `@/panel/hooks`（骨架级复用），
 * 本页不再自带一份实现。
 */

export function MarketPage({ onOpenStock }: { onOpenStock?: (s: Selection) => void }) {
  const [tactMs, setTactMs] = useState(30_000)
  const [tick, setTick] = useState(0)
  const [lastTickAt, setLastTickAt] = useState<number | null>(null)
  const [indexSel, setIndexSel] = useState<{ market: MarketTag; code: string; name: string } | null>(null)
  /** 每块自己的刷新计数（与全局 tick 相加后传给子页面：任一变化都会触发该块强制验证）。 */
  const [localTick, setLocalTick] = useState<Record<SectionId, number>>({ overview: 0, indices: 0, ladder: 0 })
  /** 每块自己的数据时间戳（由子页面 `onUpdatedAt` 回传）。 */
  const [blockAt, setBlockAt] = useState<Partial<Record<SectionId, number>>>({})
  const [collapsed, setCollapsed] = useState<Record<SectionId, boolean>>({
    overview: false,
    indices: false,
    ladder: false,
  })

  const overview = useSection()
  const indices = useSection()
  const ladder = useSection()
  /** 栅格自己既是「列数」的测量对象，也是「可用高度」的测量对象。 */
  const gridRef = useRef<HTMLDivElement>(null)
  const containerWidth = useContainerWidth(gridRef)
  const availableHeight = useAvailableHeight(gridRef, { min: 520 })
  const sections = useMemo<Record<SectionId, ReturnType<typeof useSection>>>(
    () => ({ overview, indices, ladder }),
    [overview, indices, ladder],
  )

  // 全页唯一节拍器（标签页隐藏时跳过本轮，与 cache.ts 的轮询纪律一致）
  useEffect(() => {
    if (tactMs <= 0) return
    const timer = window.setInterval(() => {
      if (typeof document !== 'undefined' && document.hidden) return
      // 休市闸门：节拍器一拍就会驱动三块强制验证 —— 非交易时段不推它，
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

  const refreshAll = useCallback(() => {
    setTick((v) => v + 1)
    setLastTickAt(Date.now())
  }, [])

  /* ── 页面级兜底：三块都不可达（审计点名的缺口） ─────────────────────────
   * 判定只用**已有**信号：子页面仅在成功取数后回传 `onUpdatedAt` → `blockAt`。
   * 因此"本块有过时间戳" ⇔ "本块至少成功取过一次数"，不需要再加探针请求。
   * 只看「展开且在视野内」的块：窄屏退化态下不可见的块 `enabled=false`，
   * 压根没发请求，把它们算作"不可达"是误报。
   */
  const [probeSeq, setProbeSeq] = useState(0)
  const [graceExpired, setGraceExpired] = useState(false)
  const expectedBlocks = (['overview', 'indices', 'ladder'] as SectionId[]).filter(
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

  /** 三块全都没回报数据（页面级结论）。 */
  const pageUnreachable = expectedCount > 0 && reportedCount === 0 && graceExpired
  /** 「刷新全部」：重开观察窗 + 驱动节拍器（不给第二套刷新路径，仍走 refreshAll）。 */
  const retryAll = useCallback(() => {
    setGraceExpired(false)
    setProbeSeq((v) => v + 1)
    refreshAll()
  }, [refreshAll])

  const refreshOne = useCallback((id: SectionId) => {
    setLocalTick((s) => ({ ...s, [id]: s[id] + 1 }))
  }, [])

  const toggle = useCallback((id: SectionId) => {
    setCollapsed((c) => ({ ...c, [id]: !c[id] }))
  }, [])

  const openStock = onOpenStock ?? openStockAndWatch
  /** 休市闸门状态（非交易时段定时轮询被挡，头部如实说明）。 */
  const gate = usePollGate()
  const activeCount = (['overview', 'indices', 'ladder'] as SectionId[]).filter(
    (id) => !collapsed[id] && sections[id].active,
  ).length
  const hhmmss = (at: number | undefined) =>
    at === undefined ? '—' : new Date(at).toLocaleTimeString('zh-CN', { hour12: false })

  // 按容器实测宽度决定列数（不用视口断点，见文件头注释）
  const cols = containerWidth >= 1120 ? 3 : containerWidth >= 760 ? 2 : 1
  const gridClass = cols === 1 ? 'flex flex-col gap-1.5' : 'grid min-h-0 grid-cols-12 gap-1.5'
  // 高度：量「到最近滚动容器可视底边」的可用空间，而不是 calc(100vh - 216px) ——
  // 宿主头部高度/字号（可调 12–17px）/提示条都会变，硬减一个常数换个环境必然错位。
  const gridStyle =
    cols === 1 ? undefined : { height: availableHeight > 0 ? `${availableHeight}px` : undefined, minHeight: 520 }
  const blockSpan = (id: SectionId) => (cols === 1 ? '' : cols === 2 ? SPAN_2COL[id] : SPAN_3COL[id])
  // 单列时块不设内部滚动（否则每块都被压成一条），改为每块最小高度 + 页面整体滚
  const blockClass = cols === 1 ? 'min-h-[520px]' : 'min-h-0'

  /** 一个块的外壳：标题栏（本块时间 / 刷新本块 / 折叠）+ 内部滚动区（整页不滚动）。 */
  const renderBlock = (meta: SectionMeta, body: ReactNode) => {
    const sec = sections[meta.id]
    const isCollapsed = collapsed[meta.id]
    return (
      <section
        key={meta.id}
        ref={sec.ref}
        className={`flex min-w-0 flex-col overflow-hidden rounded-lg border border-slate-100 bg-white ${blockClass} ${blockSpan(meta.id)}`}
      >
        <div className="flex shrink-0 items-center gap-1 border-b border-slate-100 bg-slate-50/60 px-2 py-1">
          <button
            type="button"
            onClick={() => toggle(meta.id)}
            title={isCollapsed ? '展开（展开后恢复轮询）' : '折叠（折叠即停止该块轮询，省请求）'}
            className="flex min-w-0 items-center gap-1 dc-t-data font-semibold text-slate-700 hover:text-slate-900"
          >
            {isCollapsed ? <ChevronRight size={11} /> : <ChevronDown size={11} />}
            <span className="truncate">{meta.label}</span>
          </button>
          <span className="truncate dc-t-micro text-slate-400" title={meta.hint}>
            {meta.hint}
          </span>
          <span className="ml-auto flex shrink-0 items-center gap-1">
            <span className="font-mono dc-t-micro text-slate-300" title="本块最近一次成功取数时间">
              {hhmmss(blockAt[meta.id])}
            </span>
            <button
              type="button"
              onClick={() => refreshOne(meta.id)}
              title="只刷新这一块（强制验证；涨停梯队仍受其 30s 缓存约束）"
              className="rounded p-0.5 text-slate-400 hover:bg-white"
            >
              <RefreshCw size={10} />
            </button>
          </span>
        </div>
        {!isCollapsed && (
          <div className={cols === 1 ? 'min-h-0 flex-1' : 'min-h-0 flex-1 overflow-y-auto'}>
            {sec.mounted ? body : null}
          </div>
        )}
      </section>
    )
  }

  return (
    <div className="flex min-h-0 flex-col gap-1.5">
      {/* 顶栏：节拍 + 全局刷新 + 预算提示（合并页面必须让请求代价可见） */}
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="flex items-center gap-1 dc-t-data font-semibold text-slate-700">
          <LayoutGrid size={12} className="text-emerald-600" />
          行情聚合面板
        </span>
        <span className="dc-t-micro text-slate-400">
          三块并排一屏看完 · 全页共用一个节拍器 · 折叠某块即停止它的轮询
        </span>
        <span className="ml-auto flex items-center gap-1">
          <span className="dc-t-micro text-slate-400" title="节拍：驱动所有展开中的块">
            节拍
          </span>
          {TACT_OPTIONS.map((o) => (
            <button
              key={o.ms}
              type="button"
              title={o.hint}
              onClick={() => setTactMs(o.ms)}
              className={`rounded px-1 py-px font-mono dc-t-micro ${
                tactMs === o.ms ? 'bg-emerald-100 text-emerald-600' : 'text-slate-400 hover:bg-slate-100'
              }`}
            >
              {o.label}
            </button>
          ))}
          <button
            type="button"
            onClick={refreshAll}
            title="立即刷新全部展开中的块"
            className="ml-1 flex items-center gap-0.5 rounded px-1 py-0.5 dc-t-data text-slate-500 hover:bg-slate-100"
          >
            <RefreshCw size={10} />
            刷新
          </button>
          {tactMs <= 0 ? (
            <span className="flex items-center gap-0.5 dc-t-micro text-amber-600">
              <Pause size={9} /> 已暂停
            </span>
          ) : (
            <span className="flex items-center gap-0.5 font-mono dc-t-micro text-slate-400">
              <Play size={9} /> {tactMs / 1000}s
            </span>
          )}
          <span className="font-mono dc-t-micro text-slate-400" title="上次自动刷新（所有展开块一起）">
            {lastTickAt === null ? '' : `· ${hhmmss(lastTickAt)}`}
          </span>
          {/* 休市闸门：非交易时段行情不会变，定时轮询已被挡下（手动刷新仍可用）。
              这里如实说明原因，而不是继续显示"轮询中"让人以为还在取数。 */}
          {gate.allowed ? (
            <span className="dc-t-micro text-slate-400">轮询中 {activeCount}/3</span>
          ) : (
            <span className="dc-t-micro text-amber-600" title={gate.reason}>
              休市 · 已暂停定时轮询（手动刷新可用）
            </span>
          )}
        </span>
      </div>

      {/* 页面级兜底：三块都没取到数时，把"今天数据源不可达"说成一句话并给出唯一出口。
          用紧凑形态而不是替换整块栅格：各块自己的错误/空态仍由块内负责（本文件不动它们的渲染），
          这里只补"页面级结论 + 刷新全部"——避免同一件事在页面上说两遍。 */}
      {pageUnreachable && (
        <StateView
          kind="error"
          compact
          kindLabel="数据源不可达"
          title={expectedCount >= 3 ? '三块都没取到数据' : `当前展开的 ${expectedCount} 块都没取到数据`}
          hint={`观察窗 ${ASSEMBLY_GRACE_MS / 1000}s 内没有任何一块回报数据（各块内部的提示见对应区块）`}
          reason="市场总览 / 指数 / 涨停梯队：展开中的块在观察窗内均无成功取数（单次 25s 超时或数据源离线）"
          retryLabel="刷新全部"
          onRetry={retryAll}
        />
      )}

      {/* 聚合栅格：按容器实测宽度 3/2/1 列；≥2 列时整页不滚动、各块内部滚动 */}
      <div ref={gridRef} className={gridClass} style={gridStyle}>
        {renderBlock(
          SECTIONS[0],
          <MarketOverview
            embedded
            showIndexStrip={false}
            onOpenStock={openStock}
            onOpenIndex={(market, code, name) => {
              setIndexSel({ market, code, name })
              refreshOne('indices')
            }}
            enabled={!collapsed.overview && overview.active}
            tick={tick + localTick.overview}
            onUpdatedAt={(at) => setBlockAt((s) => (s.overview === at ? s : { ...s, overview: at }))}
          />,
        )}
        {renderBlock(
          SECTIONS[1],
          <IndicesPage
            embedded
            initial={indexSel}
            enabled={!collapsed.indices && indices.active}
            tick={tick + localTick.indices}
            onUpdatedAt={(at) => setBlockAt((s) => (s.indices === at ? s : { ...s, indices: at }))}
          />,
        )}
        {renderBlock(
          SECTIONS[2],
          <LadderPage
            embedded
            onOpenStock={openStock}
            enabled={!collapsed.ladder && ladder.active}
            tick={tick + localTick.ladder}
            onUpdatedAt={(at) => setBlockAt((s) => (s.ladder === at ? s : { ...s, ladder: at }))}
          />,
        )}
      </div>
    </div>
  )
}
