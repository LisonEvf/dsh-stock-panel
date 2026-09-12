/**
 * src/pages/MarketPage.tsx —— 行情页：**市场总览 + 指数 + 涨停梯队 一页表达**（A4 合并，用户决策）。
 *
 * 合并的动机：这三块回答的是同一个问题链（今天市场什么状态 → 指数怎么走 → 钱在哪些板上），
 * 拆成三个入口时用户必须在页签间来回跳，"看过指数再回来看梯队"这一步纯属开销。
 *
 * ⚠️ 但合并不是把三个页面的轮询拼在一屏 —— 那样请求预算是三倍，而涨停梯队**单轮 ≤177 次
 * 工具调用**（见 `docs/ARCHITECTURE.md` §3.1）。所以本页有三条硬纪律：
 *
 *   1. **滚动到可视区才挂载**：区块首次进入视野才挂载（`IntersectionObserver`），
 *      离开视野**停止轮询**（`enabled=false`，数据与 DOM 保留 → 不会因来回滚动反复重取）。
 *   2. **全页只有一个节拍器**：15/20/30/60s 或「暂停」由本页统一驱动（`tick`），各区块
 *      自己**不再起定时器** —— 否则同一份指数数据会被两个订阅者各拉一遍
 *      （`useSwr` 的 in-flight 去重只在**同时**发起时生效，两个独立定时器不保证同时）。
 *   3. **重的更慢**：涨停梯队即使被更快节拍驱动，也走它自己的 30s 共享缓存
 *      （`loadLadder` 的 force=false 路径）→ 实际仍是 ~30s 一轮。
 *
 * 页面顶部把「本轮刷新时间 / 当前节拍 / 预算提示」摊开显示：合并页面必须让请求代价可见，
 * 否则用户会以为"一页看完"是免费的。
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { RefreshCw, Pause, Play } from 'lucide-react'
import { MarketOverview } from './MarketOverview'
import { IndicesPage } from './IndicesPage'
import { LadderPage } from './LadderPage'
import { openStockAndWatch, type Selection } from '@/lib/selection'
import type { MarketTag } from '@/lib/symbol'

/** 可调节拍（0 = 暂停自动刷新，仍可手动点刷新）。 */
const TACT_OPTIONS: Array<{ ms: number; label: string; hint: string }> = [
  { ms: 15_000, label: '15s', hint: '最激进：指数/广度/榜单每 15s 一轮（盘中波动大时用）' },
  { ms: 20_000, label: '20s', hint: '默认：与原先「市场总览」一致' },
  { ms: 30_000, label: '30s', hint: '省流量：适合长时间挂着看' },
  { ms: 60_000, label: '60s', hint: '最省：只看大方向' },
  { ms: 0, label: '暂停', hint: '停止自动刷新（切到别的页签也会自动停）' },
]

type SectionId = 'overview' | 'indices' | 'ladder'

const SECTIONS: Array<{ id: SectionId; label: string; hint: string }> = [
  { id: 'overview', label: '市场总览', hint: '指数条 + 涨跌分布 + 榜单 + 异动速递' },
  { id: 'indices', label: '指数', hint: '9 大指数日K与分时（点总览里的指数芯片可直接跳到这里）' },
  { id: 'ladder', label: '涨停梯队', hint: '连板梯队 + 板块热度（最重的一块：单轮 ≤177 次工具调用）' },
]

/**
 * 「滚到哪块才轮询哪块」的实现。
 *
 * `mounted` 只增不减（首次可见即常驻）—— 避免用户在页内上下滚动时反复挂载/卸载、
 * 每次都重新取数；`active` 反映**当前**是否在视野内，用于开关轮询。
 */
function useSection() {
  const ref = useRef<HTMLElement>(null)
  const [active, setActive] = useState(false)
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    const el = ref.current
    // 无 IntersectionObserver（老内核/单测环境）：退化为"始终活跃"，不静默不刷新
    if (!el || typeof IntersectionObserver === 'undefined') {
      setActive(true)
      setMounted(true)
      return
    }
    const io = new IntersectionObserver(
      (entries) => {
        const visible = entries.some((e) => e.isIntersecting)
        setActive(visible)
        if (visible) setMounted(true)
      },
      // 上下各放宽 240px：滚到附近就预热，避免"露出半个屏才开始转"
      { rootMargin: '240px 0px' },
    )
    io.observe(el)
    return () => io.disconnect()
  }, [])

  return { ref, active, mounted }
}

export function MarketPage({ onOpenStock }: { onOpenStock?: (s: Selection) => void }) {
  const [tactMs, setTactMs] = useState(20_000)
  const [tick, setTick] = useState(0)
  const [lastTickAt, setLastTickAt] = useState<number | null>(null)
  const [indexSel, setIndexSel] = useState<{ market: MarketTag; code: string; name: string } | null>(null)

  const overview = useSection()
  const indices = useSection()
  const ladder = useSection()

  // 统一节拍：全页唯一的定时器（标签页隐藏时跳过本轮，与 cache.ts 的轮询纪律一致）
  useEffect(() => {
    if (tactMs <= 0) return
    const timer = window.setInterval(() => {
      if (typeof document !== 'undefined' && document.hidden) return
      setTick((v) => v + 1)
      setLastTickAt(Date.now())
    }, tactMs)
    return () => window.clearInterval(timer)
  }, [tactMs])

  const manualRefresh = useCallback(() => {
    setTick((v) => v + 1)
    setLastTickAt(Date.now())
  }, [])

  const jumpTo = useCallback((id: SectionId) => {
    const target =
      id === 'overview' ? overview.ref.current : id === 'indices' ? indices.ref.current : ladder.ref.current
    target?.scrollIntoView({ block: 'start', behavior: 'smooth' })
  }, [overview.ref, indices.ref, ladder.ref])

  const openStock = onOpenStock ?? openStockAndWatch
  const activeCount = [overview.active, indices.active, ladder.active].filter(Boolean).length

  return (
    <div className="space-y-2">
      {/* 锚点 + 节拍 + 预算提示 */}
      <div className="sticky top-0 z-10 -mx-1 flex flex-wrap items-center gap-1.5 rounded bg-white/95 px-1 py-1 backdrop-blur">
        {SECTIONS.map((s) => (
          <button
            key={s.id}
            type="button"
            title={s.hint}
            onClick={() => jumpTo(s.id)}
            className="rounded px-1.5 py-0.5 text-[11px] text-slate-500 hover:bg-slate-100 hover:text-slate-700"
          >
            {s.label}
          </button>
        ))}
        <span className="ml-auto flex items-center gap-1">
          <span className="text-[9px] text-slate-400" title="全页只有一个节拍器：滚动到可视区的区块才按这个节奏刷新">
            节拍
          </span>
          {TACT_OPTIONS.map((o) => (
            <button
              key={o.ms}
              type="button"
              title={o.hint}
              onClick={() => setTactMs(o.ms)}
              className={`rounded px-1 py-px font-mono text-[9px] ${
                tactMs === o.ms ? 'bg-emerald-100 text-emerald-600' : 'text-slate-400 hover:bg-slate-100'
              }`}
            >
              {o.label}
            </button>
          ))}
          <button
            type="button"
            onClick={manualRefresh}
            title="立即刷新（各区块强制验证一次；涨停梯队仍受其 30s 缓存约束）"
            className="ml-1 flex items-center gap-0.5 rounded px-1 py-0.5 text-[10px] text-slate-400 hover:bg-slate-100"
          >
            <RefreshCw size={10} />
            刷新
          </button>
          {tactMs <= 0 ? (
            <span className="flex items-center gap-0.5 text-[9px] text-amber-600">
              <Pause size={9} /> 已暂停
            </span>
          ) : (
            <span className="flex items-center gap-0.5 text-[9px] text-slate-400">
              <Play size={9} /> {tactMs / 1000}s
            </span>
          )}
        </span>
      </div>

      <div className="text-[9px] leading-relaxed text-slate-400">
        一页看完：市场总览 / 指数 / 涨停梯队。**只有滚到可视区的区块才轮询**（当前 {activeCount}/3），
        全页共用一个节拍器；涨停梯队单轮最重（≤177 次工具调用），走 30s 共享缓存。
        {lastTickAt !== null && <span className="ml-1 font-mono">上次自动刷新 {new Date(lastTickAt).toLocaleTimeString('zh-CN')}</span>}
      </div>

      {/* ① 市场总览 */}
      <section ref={overview.ref} className="scroll-mt-2">
        <div className="mb-1 flex items-center gap-1.5 border-b border-slate-100 pb-1">
          <span className="text-[12px] font-semibold text-slate-700">市场总览</span>
          <span className="text-[9px] text-slate-400">广度 / 分布 / 榜单 / 异动</span>
          {!overview.active && <span className="ml-auto text-[9px] text-slate-300">已离开视野 → 暂停轮询</span>}
        </div>
        {overview.mounted && (
          <MarketOverview
            onOpenStock={openStock}
            onOpenIndex={(market, code, name) => {
              setIndexSel({ market, code, name })
              jumpTo('indices')
            }}
            enabled={overview.active}
            tick={tick}
          />
        )}
      </section>

      {/* ② 指数 */}
      <section ref={indices.ref} className="scroll-mt-2">
        <div className="mb-1 flex items-center gap-1.5 border-b border-slate-100 pb-1">
          <span className="text-[12px] font-semibold text-slate-700">指数</span>
          <span className="text-[9px] text-slate-400">9 大指数：切换条 + 摘要 + 日K/分时</span>
          {!indices.active && <span className="ml-auto text-[9px] text-slate-300">已离开视野 → 暂停轮询</span>}
        </div>
        {indices.mounted && (
          // IndicesPage 自身是整页布局（h-full）：这里给固定高度，避免在长页里塌成 0
          <div className="h-[560px] rounded-lg border border-slate-100">
            <IndicesPage initial={indexSel} enabled={indices.active} tick={tick} />
          </div>
        )}
      </section>

      {/* ③ 涨停梯队 */}
      <section ref={ladder.ref} className="scroll-mt-2">
        <div className="mb-1 flex items-center gap-1.5 border-b border-slate-100 pb-1">
          <span className="text-[12px] font-semibold text-slate-700">涨停梯队</span>
          <span className="text-[9px] text-slate-400">连板梯队 + 板块热度</span>
          {!ladder.active && <span className="ml-auto text-[9px] text-slate-300">已离开视野 → 暂停轮询</span>}
        </div>
        {ladder.mounted && <LadderPage onOpenStock={openStock} enabled={ladder.active} tick={tick} />}
      </section>
    </div>
  )
}
