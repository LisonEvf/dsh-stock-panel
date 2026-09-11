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
 * 键盘：j/k 或 ↑/↓ 在当前分组里移动（即时切换主图）。
 */
import { useEffect, useMemo, useReducer } from 'react'
import { useSwr, swrKey } from '@/lib/cache'
import { fetchAllA } from '@/lib/market'
import { openStockAndWatch, updateUi, useUi, type LeftGroup } from '@/lib/selection'
import { getWatchlist, subscribeWatchlist, type WatchItem } from '@/lib/watchlist-store'
import { getViewed, subscribeViewed, type ViewedStock } from '@/lib/viewed-store'
import { useHotkeys } from './hooks'
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
  const [tick, bump] = useReducer((x: number) => x + 1, 0)
  useEffect(() => subscribeWatchlist(bump), [])
  return useMemo(() => getWatchlist(), [tick])
}

/** 订阅「看过的个股」变更。 */
function useViewedItems(): ViewedStock[] {
  const [tick, bump] = useReducer((x: number) => x + 1, 0)
  useEffect(() => subscribeViewed(bump), [])
  return useMemo(() => getViewed(), [tick])
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

  /** 键盘移动光标：把当前 selected 在列表中的位置 ±1。 */
  const move = (delta: number) => {
    if (rows.length === 0) return
    const sel = ui.selection
    const at = sel === null ? -1 : rows.findIndex((r) => r.market === sel.market && r.code === sel.code)
    const next = at < 0 ? (delta > 0 ? 0 : rows.length - 1) : Math.min(rows.length - 1, Math.max(0, at + delta))
    const row = rows[next]
    if (row !== undefined) openStockAndWatch({ market: row.market, code: row.code, name: row.name })
  }

  useHotkeys((e) => {
    if (e.metaKey || e.ctrlKey || e.altKey) return
    if (e.key === 'j' || e.key === 'ArrowDown') {
      e.preventDefault()
      move(1)
    } else if (e.key === 'k' || e.key === 'ArrowUp') {
      e.preventDefault()
      move(-1)
    }
  })

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
          <div className="dc-list">
            {rows.map((r) => {
              const active =
                ui.selection !== null && ui.selection.market === r.market && ui.selection.code === r.code
              return (
                <div
                  key={`${r.market}${r.code}`}
                  className={`dc-row${active ? ' is-active' : ''}`}
                  title={`${r.name} ${r.market}${r.code}${r.extra !== undefined ? ` · ${r.extra}` : ''}（点击查看个股信息）`}
                  onClick={() => openStockAndWatch({ market: r.market, code: r.code, name: r.name })}
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
