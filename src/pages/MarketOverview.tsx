/**
 * 市场总览（M5）：指数条 + 大盘速览 + 涨跌分布 + 榜单 + 异动速递。
 *
 * 数据全部直连 MCP（无后端）：
 *   - fetchIndexQuotes：预设 9 大指数实时报价
 *   - fetchAllA：全 A 5566 只一次拉取（20s 缓存），广度/分布/榜单客户端计算
 *   - fetchUnusualAll：SH/SZ/BJ 三市场异动合并
 *
 * 懒加载缓存（useSwr）：
 *   - 首次进入先读缓存里的旧数据立即渲染（秒开），后台静默重新验证；
 *   - 每 20s 后台轮询刷新；**验证失败会下线过期数据并自动重试一次**，
 *     绝不用过期数据冒充实时行情（避免以假乱真）；
 *   - 切走再切回 Tab 直接命中缓存，不重复全量拉取。
 *
 * 点击股票行 → 切「个股」Tab；点击指数芯片 → 切「指数」Tab。
 */

import { useEffect, useMemo } from 'react'
import { RefreshCw } from 'lucide-react'
import {
  computeBreadth,
  computeDistribution,
  fetchAllA,
  fetchIndexQuotes,
  fetchUnusualAll,
  pctText,
  ensureSearchIndex,
  type AShareRow,
  type DistBucket,
  type UnusualItem,
} from '@/lib/market'
import { useSwr, swrKey } from '@/lib/cache'
import { fmtBigNum } from '@/lib/format'
import type { MarketTag } from '@/lib/symbol'
import type { OpenStock } from '@/panel/PanelApp'

const UP = 'var(--dc-up)'
const DOWN = 'var(--dc-down)'

// 行情自动刷新间隔：轮询后台重新验证（与缓存新鲜窗口配合）。
const REFRESH_MS = 20_000

function pctColor(v: number): string {
  if (v > 0) return UP
  if (v < 0) return DOWN
  return '#94a3b8'
}

interface Props {
  onOpenStock: (s: OpenStock) => void
  onOpenIndex: (m: MarketTag, code: string, name: string) => void
  /** 是否轮询（合并页按"滚动到可视区才轮询"传 false/true）。默认 true = 独立页行为。 */
  enabled?: boolean
  /**
   * 统一节拍递增值（合并页的唯一节拍器）。变化一次 → 本区块强制验证一次。
   * 传了它就把 `refreshInterval` 交给节拍器，避免同一份指数数据被两个定时器各拉一遍。
   */
  tick?: number
  /** 自轮询间隔覆盖（0 = 不自己起定时器，只由 tick / 手动驱动）。 */
  pollMs?: number
  /**
   * 嵌入模式（行情聚合面板）：**交出整页布局与页头** —— 外层不再 `h-full overflow-y-auto`、
   * 不再渲染自己的标题/刷新条（块外壳负责这些），由聚合页统一排版。
   */
  embedded?: boolean
  /** 数据时间戳回传（聚合页在块标题上显示"本块刷新时间"）。 */
  onUpdatedAt?: (at: number) => void
  /** 是否显示 9 大指数条（聚合面板里另有一整块「指数」，故传 false 去重）。 */
  showIndexStrip?: boolean
}

export function MarketOverview({
  onOpenStock,
  onOpenIndex,
  enabled = true,
  tick = 0,
  pollMs = REFRESH_MS,
  embedded = false,
  onUpdatedAt,
  showIndexStrip = true,
}: Props) {
  // 三个独立数据源，各自缓存 + 后台轮询（互不阻塞，部分失败各自呈现）。
  // 合并页（MarketPage）会传 enabled=false 停止轮询、pollMs=0 交出自己的定时器。
  const indicesSwr = useSwr(swrKey.indices(), () => fetchIndexQuotes(), {
    ttl: 6_000,
    refreshInterval: pollMs,
    enabled,
  })
  const allASwr = useSwr(swrKey.allA(), () => fetchAllA(), {
    ttl: 6_000,
    refreshInterval: pollMs,
    enabled,
  })
  const unusualSwr = useSwr(swrKey.unusualAll(), () => fetchUnusualAll(40), {
    ttl: 6_000,
    refreshInterval: pollMs,
    enabled,
  })

  // 统一节拍：tick 变化 → 三个源各强制验证一次（tick=0 表示没有外部节拍器，保持自带行为）
  const refreshIndices = indicesSwr.refresh
  const refreshAllA = allASwr.refresh
  const refreshUnusual = unusualSwr.refresh
  useEffect(() => {
    if (tick === 0 || !enabled) return
    refreshIndices()
    refreshAllA()
    refreshUnusual()
  }, [tick, enabled, refreshIndices, refreshAllA, refreshUnusual])

  const indices = indicesSwr.data ?? []
  // useMemo 收口：`?? []` 每帧都是新数组，直接进依赖会让下游 memo 每帧重算（lint 抓到）。
  const rows = useMemo(() => allASwr.data ?? [], [allASwr.data])
  const unusual = unusualSwr.data ?? []

  // 预热本地搜索索引（行情页已拉全 A，搜索零成本；懒加载不阻塞首屏）。
  useEffect(() => {
    void ensureSearchIndex().catch(() => undefined)
  }, [])

  const breadth = useMemo(() => computeBreadth(rows), [rows])
  const dist = useMemo(() => computeDistribution(rows), [rows])

  const sorted = useMemo(() => {
    const byPct = [...rows].sort((a, b) => b.pct - a.pct)
    return {
      gainers: byPct.slice(0, 5),
      losers: byPct.slice(-5).reverse(),
      amount: [...rows].sort((a, b) => b.amount - a.amount).slice(0, 5),
      turnover: [...rows].sort((a, b) => b.turnover - a.turnover).slice(0, 5),
    }
  }, [rows])

  // 刷新时间：取最近一次成功取数的时间戳（任一数据源更新即刷新）。
  const updatedAt = Math.max(
    indicesSwr.updatedAt ?? 0,
    allASwr.updatedAt ?? 0,
    unusualSwr.updatedAt ?? 0,
  ) || null

  const refreshing = indicesSwr.isLoading || allASwr.isLoading || unusualSwr.isLoading

  // 聚合页需要在块标题上显示本块刷新时间（嵌入模式下自己不显示页头）
  useEffect(() => {
    if (updatedAt !== null && onUpdatedAt) onUpdatedAt(updatedAt)
  }, [updatedAt, onUpdatedAt])

  // 汇总错误（三个数据源都失败/部分失败时呈现，并保留重试）。
  const errors = [indicesSwr.error, allASwr.error, unusualSwr.error].filter(
    (e): e is string => Boolean(e),
  )
  const errorText = errors.length
    ? errors.length >= 3
      ? '行情源不可达：指数 / 全 A / 异动 请求全部失败（MCP 超时或数据源离线）'
      : errors[0]
    : ''

  const openStock = (r: AShareRow) => onOpenStock({ market: r.market, code: r.code, name: r.name })
  const openStockUnusual = (u: UnusualItem) => onOpenStock({ market: u.market, code: u.code, name: u.name })

  const maxDist = Math.max(1, ...dist.map((d) => d.count))

  return (
    // 嵌入聚合面板时交出整页布局（不自己滚动、不自己吸顶）
    <div className={embedded ? 'px-2 pb-2' : 'h-full overflow-y-auto px-2.5 pb-3'}>
      {/* 头部：标题 + 刷新（吸顶）；刷新走后台强制重新验证。嵌入模式下由块外壳提供 */}
      {!embedded && (
        <div className="ds-sticky-head -mx-2.5 mb-1.5 flex items-center justify-between border-b border-slate-100 px-2.5 pb-1.5 pt-2">
        <span className="text-sm font-semibold text-slate-800">市场总览</span>
        <div className="flex items-center gap-2">
          {updatedAt && (
            <span className="dc-t-data text-slate-300">
              {new Date(updatedAt).toLocaleTimeString('zh-CN', { hour12: false })}
            </span>
          )}
          <button
            onClick={() => {
              indicesSwr.refresh()
              allASwr.refresh()
              unusualSwr.refresh()
            }}
            className="flex items-center gap-1 rounded px-1.5 py-0.5 dc-t-note text-slate-400 hover:bg-slate-100 hover:text-slate-600"
            title="刷新"
          >
            <RefreshCw className={`h-3 w-3 ${refreshing ? 'animate-spin' : ''}`} />
          </button>
        </div>
        </div>
      )}

      {errorText && (
        <div className="mb-1.5 flex items-start gap-2 rounded bg-red-50 px-2 py-1.5 dc-t-note text-red-500">
          <span className="min-w-0 flex-1">{errorText}</span>
          <button
            onClick={() => {
              indicesSwr.refresh()
              allASwr.refresh()
              unusualSwr.refresh()
            }}
            className="shrink-0 rounded bg-white px-1.5 py-0.5 dc-t-data text-red-500 hover:bg-red-100"
          >
            重试
          </button>
        </div>
      )}

      {/* 行情源空态（休市/未连接）：已请求完成但无任何 A 股行情 */}
      {!refreshing && rows.length === 0 && !errorText && (
        <div className="mb-1.5 rounded-md border border-amber-100 bg-amber-50/60 px-2.5 py-2.5">
          <div className="dc-t-note font-medium text-amber-600">行情源暂无 A 股数据</div>
          <div className="mt-0.5 dc-t-data leading-relaxed text-amber-500/80">
            当前可能处于非交易时段或数据源未连接（20s 自动重试中）。
            <br />
            交易日盘中可查看广度 / 分布 / 榜单 / 异动；休市期建议到「复盘」页做功课。
          </div>
        </div>
      )}

      {/*
        指数条（纵向单列通栏）。
        聚合面板里**不显示**：右侧/旁边的「指数」块已经把 9 大指数摊开（含图），
        这里再列一遍既重复又占掉本块宝贵的纵向空间 —— 实测在窄列里它会把榜单挤下去。
      */}
      {showIndexStrip && indices.length > 0 && (
        <div className="mb-1.5 overflow-hidden rounded-md border border-slate-100">
          {indices.map((q, i) => (
            <button
              key={`${q.market}${q.code}`}
              onClick={() => onOpenIndex(q.market, q.code, q.name)}
              className={`flex w-full items-center gap-2 px-2 py-[5px] text-left transition-colors hover:bg-emerald-50/60 ${i > 0 ? 'border-t border-slate-100' : ''}`}
              title={`查看 ${q.name} 走势`}
            >
              <span className="min-w-0 flex-1 truncate dc-t-note font-medium text-slate-600">{q.name}</span>
              <span className="shrink-0 font-mono dc-t-micro text-slate-300">{q.code}</span>
              <span className="w-14 shrink-0 text-right font-mono dc-t-note text-slate-500 tabular-nums">
                {q.close.toFixed(2)}
              </span>
              <span className="w-14 shrink-0 text-right font-mono dc-t-note font-semibold tabular-nums" style={{ color: pctColor(q.pct) }}>
                {pctText(q.pct)}
              </span>
            </button>
          ))}
        </div>
      )}

      {/* 大盘速览（2×2 纵排） */}
      {rows.length > 0 && (
        <div className="mb-1.5 grid grid-cols-2 gap-1.5">
          <MiniCell label="涨 / 平 / 跌" main={<><span style={{ color: UP }}>{breadth.up}</span><span className="text-slate-300">/</span><span className="text-slate-400">{breadth.flat}</span><span className="text-slate-300">/</span><span style={{ color: DOWN }}>{breadth.down}</span></>} sub={`共 ${breadth.total} 只`} />
          <MiniCell label="涨停 / 跌停" main={<><span style={{ color: UP }}>{breadth.limitUp}</span><span className="text-slate-300">/</span><span style={{ color: DOWN }}>{breadth.limitDown}</span></>} sub="按交易所涨停价" />
          <MiniCell label="强势 / 弱势(±3%)" main={<><span style={{ color: UP }}>{breadth.strongUp}</span><span className="text-slate-300">/</span><span style={{ color: DOWN }}>{breadth.strongDown}</span></>} sub="涨跌≥3%" />
          <MiniCell label="两市成交" main={<span className="text-sm font-semibold">{fmtBigNum(breadth.amountSum)}</span>} sub={`平均涨跌 ${pctText(breadth.avgPct, 2)}`} />
        </div>
      )}

      {/* 涨跌分布（仅在有行情时展示，避免空数据画全零柱误导） */}
      {rows.length > 0 && dist.length > 0 && (
        <div className="mb-1.5 rounded-md border border-slate-100 bg-slate-50/60 px-2 py-1.5">
          <div className="mb-1 dc-t-data font-medium text-slate-400">涨跌分布（% 区间）</div>
          <div className="flex h-12 items-end gap-0.5">
            {dist.map((b: DistBucket) => (
              <div
                key={b.key}
                className="flex min-w-0 flex-1 flex-col items-center justify-end"
                title={`${b.label}%: ${b.count}只`}
              >
                <span className="mb-0.5 dc-t-micro leading-none text-slate-400 tabular-nums">{b.count || ''}</span>
                <div
                  className="w-full rounded-sm"
                  style={{
                    height: `${Math.max(4, (b.count / maxDist) * 34)}px`,
                    background: b.up ? 'rgba(199,64,64,0.55)' : 'rgba(45,155,101,0.55)',
                  }}
                />
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 榜单（纵向单列） */}
      {rows.length > 0 && (
        <div className="mb-1.5 space-y-1.5">
          <RankList title="涨幅榜" items={sorted.gainers} mode="pct" onOpen={openStock} />
          <RankList title="跌幅榜" items={sorted.losers} mode="pct" onOpen={openStock} />
          <RankList title="成交额榜" items={sorted.amount} mode="amount" onOpen={openStock} />
          <RankList title="换手率榜" items={sorted.turnover} mode="turnover" onOpen={openStock} />
        </div>
      )}

      {/* 异动速递 */}
      {unusual.length > 0 && (
        <div className="rounded-md border border-slate-100 bg-slate-50/60 px-2 py-1.5">
          <div className="mb-1 dc-t-data font-medium text-slate-400">市场异动</div>
          <ul className="space-y-0.5">
            {unusual.slice(0, 14).map((u, i) => (
              <li key={`${u.market}${u.code}-${i}`}>
                <button
                  onClick={() => openStockUnusual(u)}
                  className="flex w-full items-center gap-1.5 rounded px-1 py-0.5 text-left hover:bg-white"
                  title={`${u.name} ${u.code}`}
                >
                  <span
                    className="shrink-0 rounded px-1 py-px dc-t-micro font-medium"
                    style={{
                      color: u.kind === 'up' ? UP : u.kind === 'down' ? DOWN : '#b45309',
                      background: u.kind === 'up' ? 'rgba(199,64,64,0.08)' : u.kind === 'down' ? 'rgba(45,155,101,0.08)' : 'rgba(180,83,9,0.08)',
                    }}
                  >
                    {u.desc.replace(/[（）()]/g, '')}
                  </span>
                  <span className="min-w-0 flex-1 truncate dc-t-note text-slate-600">{u.name}</span>
                  <span className="shrink-0 font-mono dc-t-micro text-slate-400 tabular-nums">{u.time}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {refreshing && rows.length === 0 && indices.length === 0 && (
        <div className="py-10 text-center text-xs text-slate-300">加载市场数据…</div>
      )}
    </div>
  )
}

function MiniCell({ label, main, sub }: { label: string; main: React.ReactNode; sub?: string }) {
  return (
    <div className="min-w-0 rounded-md border border-slate-100 bg-slate-50/80 px-2 py-1.5">
      <div className="truncate dc-t-data text-slate-400">{label}</div>
      <div className="mt-0.5 font-mono dc-t-decision font-semibold leading-none text-slate-700 tabular-nums">{main}</div>
      {sub && <div className="mt-1 truncate dc-t-micro text-slate-300">{sub}</div>}
    </div>
  )
}

function RankList({
  title,
  items,
  mode,
  onOpen,
}: {
  title: string
  items: AShareRow[]
  mode: 'pct' | 'amount' | 'turnover'
  onOpen: (r: AShareRow) => void
}) {
  /**
   * 行布局：**按内容定列的 grid**，而不是"名称 flex-1 + 一个值右对齐"。
   *
   * 为什么改：原来一行只有 名称(flex-1,truncate) + 代码 + 一个 w-14 的值 ——
   * 在 370px 宽的列里内容只占 ~130px，**每行约 240px 空着**，而代码只能用 8px 才塞得下。
   * 现在把空着的宽度换成**本来就已经拿到的字段**（换手率/涨幅都是 AShareRow 里的），
   * 于是同一行 4 列、字号升到 12px、代码升到 11px：**信息不减反增，留白变成数据**。
   */
  const primary = (r: AShareRow) =>
    mode === 'pct' ? pctText(r.pct) : mode === 'amount' ? fmtBigNum(r.amount) : `${r.turnover.toFixed(1)}%`
  const secondary = (r: AShareRow) => (mode === 'pct' ? `${r.turnover.toFixed(1)}%` : pctText(r.pct))
  const primaryTone = (r: AShareRow) => (mode === 'pct' ? pctColor(r.pct) : 'var(--dc-text-2)')
  const secondaryTone = (r: AShareRow) => (mode === 'pct' ? 'var(--dc-text-3)' : pctColor(r.pct))
  return (
    <div className="min-w-0 rounded-md border border-slate-100 bg-slate-50/60 px-1.5 py-1.5">
      <div
        className="mb-1 flex items-center justify-between"
        title={`按${mode === 'pct' ? '涨幅' : mode === 'amount' ? '成交额' : '换手率'}排序的前 ${items.length} 名 · 末列为${mode === 'pct' ? '换手率' : '涨跌幅'}`}
      >
        <span className="dc-t-data font-medium text-slate-500">{title}</span>
      </div>
      <ul className="space-y-0.5">
        {items.map((r) => (
          <li key={`${r.market}${r.code}`}>
            <button
              onClick={() => onOpen(r)}
              className="grid w-full grid-cols-[minmax(0,1fr)_5.5ch_6.5ch_7ch] items-baseline gap-x-1.5 rounded px-1 py-[3px] text-left hover:bg-white"
              title={`${r.name} ${r.market}${r.code} · 涨幅 ${pctText(r.pct)} · 换手 ${r.turnover.toFixed(1)}% · 成交额 ${fmtBigNum(r.amount)}（点击查看个股信息）`}
            >
              <span className="min-w-0 truncate dc-t-data text-slate-700">{r.name}</span>
              <span className="text-right font-mono dc-t-note text-slate-400">{r.code}</span>
              <span className="text-right font-mono dc-t-data font-semibold tabular-nums" style={{ color: primaryTone(r) }}>
                {primary(r)}
              </span>
              <span className="text-right font-mono dc-t-note tabular-nums" style={{ color: secondaryTone(r) }}>
                {secondary(r)}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}
