/**
 * src/panel/WatchList.tsx — 左栏盯盘列表（**自选 / 个股**）。
 *
 * A4（2026-09-12）收敛为两组，定位是「**我要盯谁**」：
 *   - **自选**：手工维护的观察池（`watchlist-store`）；
 *   - **个股**：最近看过的（`viewed-store`，自动积累，见 `selection.setSelection` 的埋点）。
 * 原来的「涨停」「异动」下线：涨停有「涨停梯队」工具页，异动并入工具单页 ——
 * 左栏不再兼作行情浏览器（也顺带省掉左栏那条 30s×3 的异动轮询）。
 *
 * 交互（A4 的关键变化）：**点任意一行 = 设当前标的 + 切到「看盘」**，
 * 于是主区立刻渲染这只票的个股信息（报价头 / 图 / 资金·逐笔·竞价 / 右栏 AI），
 * 而不是"只换标的不换页"——用户点它就是为了看它。
 *
 * 请求预算：零额外请求。「自选」「个股」两组的**价格都取自状态带已在轮询的全 A 快照**
 * （`swr:mkt:allA`，30s），左栏放多少只都不增加网络流量。
 *
 * 键盘（审计 UX-PLAN I4 / V6 修）：
 *   - `j/k`（全局）与 `↑/↓`（焦点在左栏内）在当前分组里移动（即时切换主图）；
 *   - 移动**同时把真实键盘焦点搬到新行**并 `scrollIntoView({block:'nearest'})` ——
 *     原实现只改 `ui.selection`，焦点留在原地、行滚出可视区外就再也"看不见自己走到哪了"；
 *   - 行本身**可 Tab 到达**（`role="button"` + roving `tabIndex`：只有当前行是 0），
 *     Enter/Space 打开 —— 原来是一个纯 `div + onClick`，键盘用户根本无法到达这一栏；
 *   - **`j/k` 的作用域判定不在这里**：`resolveHotkey`（`lib/hotkeys.ts`）在左栏收起时
 *     直接返回 `null`，本组件只执行派发过来的 `{type:'watchMove'}`。守卫只写一处，
 *     不会出现"两处判断漂移"（这正是审计里"收起左栏按 j/k 仍换标的"的成因）。
 */
import { useEffect, useLayoutEffect, useMemo, useReducer, useRef, useState } from 'react'
import { useSwr, swrKey } from '@/lib/cache'
import { fetchAllA } from '@/lib/market'
import { subscribeWatchMove } from '@/lib/hotkeys'
import { openStockAndWatch, updateUi, useUi, type LeftGroup } from '@/lib/selection'
import { getWatchlist, subscribeWatchlist, type WatchItem } from '@/lib/watchlist-store'
import { getViewed, subscribeViewed, type ViewedStock } from '@/lib/viewed-store'
import { pctClass } from './StatusStrip'
import { fmtPrice } from '@/lib/format'

const GROUPS: Array<{ id: LeftGroup; label: string; hint: string }> = [
  { id: 'watch', label: '自选', hint: '手工维护的观察池（价格取自全 A 快照，零额外请求）；点行即看它' },
  { id: 'viewed', label: '个股', hint: '最近看过的标的（自动积累，上限 30）；点行即看它' },
]

/** 列表行统一形状。 */
interface Row {
  market: 'SH' | 'SZ' | 'BJ'
  code: string
  name: string
  price: number | null
  pct: number | null
  extra?: string
}

/** 订阅自选变更（模块级 store，与 UI 状态解耦）。 */
function useWatchItems(): WatchItem[] {
  const [, bump] = useReducer((x: number) => x + 1, 0)
  useEffect(() => subscribeWatchlist(bump), [])
  // 不用 useMemo 缓存：`getWatchlist()` 只是 ≤60 项的 slice，而"以 tick 为依赖缓存"
  // 在 lint 看来是无效依赖（tick 未参与计算）—— 直接返回更简单也更诚实。
  return getWatchlist()
}

/** 订阅「看过的个股」变更。 */
function useViewedItems(): ViewedStock[] {
  const [, bump] = useReducer((x: number) => x + 1, 0)
  useEffect(() => subscribeViewed(bump), [])
  return getViewed()
}

/** 「多久以前看的」——个股栏要的是"最近"，不是精确时间。 */
function agoText(at: number): string {
  const d = Date.now() - at
  if (d < 60_000) return '刚刚'
  if (d < 3_600_000) return `${Math.floor(d / 60_000)} 分钟前`
  if (d < 86_400_000) return `${Math.floor(d / 3_600_000)} 小时前`
  return `${Math.floor(d / 86_400_000)} 天前`
}

export function WatchList() {
  const ui = useUi()
  const items = useWatchItems()
  const viewed = useViewedItems()
  const allA = useSwr(swrKey.allA(), () => fetchAllA(), {
    ttl: 15000,
    refreshInterval: 30000,
    // 左栏收起（HTML hidden，组件仍挂载）时停止轮询：收起 = 不看，不必再拉（B3）。
    enabled: ui.leftRail,
  })

  /** 全 A 快照 → code 索引（自选/个股用它免请求查价）。 */
  const byCode = useMemo(() => {
    const map = new Map<string, { name: string; close: number; pct: number }>()
    for (const r of allA.data ?? []) map.set(r.code, { name: r.name, close: r.close, pct: r.pct })
    return map
  }, [allA.data])

  const rows: Row[] = useMemo(() => {
    if (ui.leftGroup === 'viewed') {
      return viewed.map((it) => {
        const snap = byCode.get(it.code)
        return {
          market: it.market,
          code: it.code,
          name: it.name || snap?.name || it.code,
          price: snap?.close ?? null,
          pct: snap?.pct ?? null,
          extra: agoText(it.at),
        }
      })
    }
    return items.map((it) => {
      const snap = byCode.get(it.code)
      return {
        market: it.market,
        code: it.code,
        name: it.name || snap?.name || it.code,
        price: snap?.close ?? null,
        pct: snap?.pct ?? null,
      }
    })
  }, [ui.leftGroup, items, viewed, byCode])

  /** 当前选中行在本分组里的下标（-1 = 选中的票不在本分组里，或还没选过）。 */
  const activeIndex = useMemo(() => {
    const sel = ui.selection
    if (sel === null) return -1
    return rows.findIndex((r) => r.market === sel.market && r.code === sel.code)
  }, [rows, ui.selection])

  /** 行 DOM 引用（roving focus 要按行号取节点）。 */
  const rowRefs = useRef<Array<HTMLDivElement | null>>([])

  /**
   * roving tabindex（审计 I4 第 2 条）：
   *   列表里**只有一行 `tabIndex=0`** —— Tab 进来落在"当前所在的那一行"，而不是
   *   给每一行都留一个 Tab 停靠点（60 行 = 按 60 次 Tab 才能出去，等于键盘不可用）。
   *   焦点跟随 `j/k` 移动，所以"按 Tab 进列表"永远落在你上一次走到的地方。
   */
  const [focusAt, setFocusAt] = useState(-1)

  // 分组切换后旧行号失效（否则 Tab 会落在新列表里一个莫名其妙的位置）。
  useEffect(() => {
    setFocusAt(-1)
  }, [ui.leftGroup])

  const tabbableAt =
    rows.length === 0 ? -1 : focusAt >= 0 && focusAt < rows.length ? focusAt : activeIndex >= 0 ? activeIndex : 0

  /** 把**真实键盘焦点**搬到第 i 行，并保证这一行在可视区内。 */
  const focusRow = (i: number) => {
    setFocusAt(i)
    const el = rowRefs.current[i]
    if (el === null || el === undefined) return
    el.focus()
    // block:'nearest'：已经在可视区内就完全不动滚动位置（避免列表自己跳一下）。
    el.scrollIntoView({ block: 'nearest' })
  }

  /** 键盘移动光标：把当前 selected 在列表中的位置 ±1（鼠标点击行为不变，仍是 openStockAndWatch）。 */
  const move = (delta: number) => {
    if (rows.length === 0) return
    const at = activeIndex
    const next =
      at < 0 ? (delta > 0 ? 0 : rows.length - 1) : Math.min(rows.length - 1, Math.max(0, at + delta))
    const row = rows[next]
    if (row === undefined) return
    openStockAndWatch({ market: row.market, code: row.code, name: row.name })
    focusRow(next)
  }

  /** 最新一份 move（listener 只绑一次，避免每次渲染重装监听）。 */
  const moveRef = useRef(move)
  // layout effect：分组切换那一帧里 rows 整个换了一批，若用被动 effect 就会有一小段
  // "拿着上一组的 rows 去算下一行"的窗口（按 j 跳到别的票）。
  useLayoutEffect(() => {
    moveRef.current = move
  })

  // 执行 AppShell 派发过来的移动（`j/k` 或左栏内的 `↑/↓`）。
  useEffect(() => subscribeWatchMove((delta) => moveRef.current(delta)), [])

  const activeGroup = GROUPS.find((g) => g.id === ui.leftGroup)

  return (
    <>
      <div className="dc-rail-head">
        <div className="dc-nav" style={{ gap: 2 }}>
          {GROUPS.map((g) => (
            <button
              key={g.id}
              type="button"
              title={g.hint}
              className={`dc-nav-item${ui.leftGroup === g.id ? ' is-on' : ''}`}
              style={{ padding: '3px 8px', fontSize: 11 }}
              onClick={() => updateUi({ leftGroup: g.id })}
            >
              {g.label}
            </button>
          ))}
        </div>
        <span style={{ flex: 1 }} />
        <span className="dc-num dc-flat" title={activeGroup?.hint ?? ''}>
          {rows.length}
        </span>
      </div>

      <div className="dc-rail-body dc-scroll">
        {allA.error ? (
          <div className="dc-row-hint">行情快照不可达：{allA.error}（自选仍可点开看图）</div>
        ) : allA.status === 'loading' && rows.length === 0 ? (
          <div className="dc-row-hint">加载中…</div>
        ) : rows.length === 0 ? (
          <div className="dc-row-hint">
            {ui.leftGroup === 'watch'
              ? '自选为空：在「看盘」报价头点 ☆ 加入，或 ⌘K 搜索标的。'
              : '还没有看过的个股：在左栏/搜索/任意列表点开一只票，它就会出现在这里。'}
          </div>
        ) : (
          <div
            className="dc-list"
            role="group"
            aria-label={`${activeGroup?.label ?? '列表'}，共 ${rows.length} 只；j/k 或 ↑↓ 移动，回车打开`}
          >
            {rows.map((r, index) => {
              const active =
                ui.selection !== null && ui.selection.market === r.market && ui.selection.code === r.code
              const open = () => openStockAndWatch({ market: r.market, code: r.code, name: r.name })
              return (
                // role="button" + tabIndex（审计 I4 第 2 条）：原来这里是个纯 div + onClick，
                // 键盘完全不可达（Tab 跳不到、Enter 没反应）。这里刻意不用原生 <button>：
                // `.dc-row` 的 flex 布局与左对齐文本是按 div 调的，改成 button 会被 UA 的
                // `text-align: center` 打乱（正文居中），且行内还嵌了"价格/涨跌幅"两段数字。
                <div
                  key={`${r.market}${r.code}`}
                  ref={(el) => {
                    rowRefs.current[index] = el
                  }}
                  role="button"
                  // roving：只有当前行可 Tab 到达，其余 -1（可用 ↑↓/j/k 或 Tab 出去）。
                  tabIndex={index === tabbableAt ? 0 : -1}
                  // 当前标的 = "当前项"，用 aria-current 而不是再编一个视觉状态（读屏要能读出来）。
                  aria-current={active ? 'true' : undefined}
                  className={`dc-row${active ? ' is-active' : ''}`}
                  title={`${r.name} ${r.market}${r.code}${r.extra !== undefined ? ` · ${r.extra}` : ''}（点击查看个股信息）`}
                  onClick={open}
                  // 焦点落哪一行，roving 的"锚"就跟到哪一行（鼠标点、Tab 进来都算）。
                  onFocus={() => setFocusAt(index)}
                  onKeyDown={(e) => {
                    // role="button" 只是"承诺"，浏览器不会代劳 Enter/Space —— 必须自己接，
                    // 否则读屏用户听到"按钮"却按不动。
                    if (e.key === 'Enter' || e.key === ' ' || e.key === 'Spacebar') {
                      e.preventDefault() // Space 默认是滚动列表
                      open()
                    }
                  }}
                >
                  <div className="dc-row-main">
                    <span className="dc-row-name">{r.name || r.code}</span>
                    <span className="dc-row-sub">
                      {r.market}
                      {r.code}
                      {r.extra !== undefined && r.extra !== '' ? ` · ${r.extra}` : ''}
                    </span>
                  </div>
                  <div className="dc-row-side">
                    <span className="dc-num">{fmtPrice(r.price)}</span>
                    <span className={`dc-num ${pctClass(r.pct)}`}>
                      {r.pct === null ? '' : `${r.pct > 0 ? '+' : ''}${r.pct.toFixed(2)}%`}
                    </span>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </>
  )
}
