/**
 * src/panel/WatchList.tsx — 左栏盯盘列表（自选 / 涨停 / 异动）。
 *
 * 三栏联动的起点：**点任意一行 = 设当前标的**（lib/selection.ts），
 * 主图、下部面板、右栏 AI 卡全部跟着换。
 *
 * 请求预算刻意压到「零额外请求」：
 *   - 「自选」「涨停」两组都从状态带已经在轮询的**全 A 快照**（swr:mkt:allA）里取，
 *     客户端过滤/排序，不再逐只拉报价（窄列时代逐只 quote 的做法已废弃）；
 *   - 「异动」复用市场页同 key 的异动缓存（20s TTL）。
 * 因此左栏放多少只自选都不会增加网络流量。
 *
 * 键盘：j/k 或 ↑/↓ 在当前分组里移动（即时切换主图）。
 */
import { useEffect, useMemo, useReducer } from 'react'
import { useSwr, swrKey } from '@/lib/cache'
import { computeBreadth, fetchAllA, fetchUnusualAll } from '@/lib/market'
import { setSelection, updateUi, useUi, type LeftGroup } from '@/lib/selection'
import { getWatchlist, subscribeWatchlist, type WatchItem } from '@/lib/watchlist-store'
import { useHotkeys } from './hooks'
import { pctClass } from './StatusStrip'
import { fmtBigNum, fmtPrice } from '@/lib/format'

const GROUPS: Array<{ id: LeftGroup; label: string; hint: string }> = [
  { id: 'watch', label: '自选', hint: '本地自选（价格取自全 A 快照，零额外请求）' },
  { id: 'limit', label: '涨停', hint: '按涨停价精确判定的涨停池，按涨幅排序' },
  { id: 'unusual', label: '异动', hint: '市场异动事件（盘中增量）' },
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

export function WatchList() {
  const ui = useUi()
  const items = useWatchItems()
  const allA = useSwr(swrKey.allA(), () => fetchAllA(), {
    ttl: 15000,
    refreshInterval: 30000,
    // 左栏收起（HTML hidden，组件仍挂载）时停止轮询：收起 = 不看，不必再拉（B3）。
    enabled: ui.leftRail,
  })
  const unusual = useSwr(swrKey.unusualAll(), () => fetchUnusualAll(40), {
    ttl: 20000,
    refreshInterval: 30000,
    enabled: ui.leftRail,
  })

  /** 全 A 快照 → code 索引（自选用它免请求查价）。 */
  const byCode = useMemo(() => {
    const map = new Map<string, { name: string; close: number; pct: number }>()
    for (const r of allA.data ?? []) map.set(r.code, { name: r.name, close: r.close, pct: r.pct })
    return map
  }, [allA.data])

  const rows: Row[] = useMemo(() => {
    if (ui.leftGroup === 'watch') {
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
    }
    if (ui.leftGroup === 'limit') {
      const list = (allA.data ?? []).filter(
        (r) => r.buy_price_limit > 0 && Math.abs(r.close - r.buy_price_limit) < 1e-6,
      )
      list.sort((a, b) => b.pct - a.pct || b.amount - a.amount)
      return list.slice(0, 80).map((r) => ({
        market: r.market,
        code: r.code,
        name: r.name,
        price: r.close,
        pct: r.pct,
        extra: fmtBigNum(r.amount),
      }))
    }
    return (unusual.data ?? []).slice(0, 80).map((u) => ({
      market: u.market,
      code: u.code,
      name: u.name,
      price: null,
      pct: null,
      extra: u.desc || u.kind || '',
    }))
  }, [ui.leftGroup, items, byCode, allA.data, unusual.data])

  const breadth = useMemo(() => (allA.data ? computeBreadth(allA.data) : null), [allA.data])

  /** 键盘移动光标：把当前 selected 在列表中的位置 ±1。 */
  const move = (delta: number) => {
    if (rows.length === 0) return
    const sel = ui.selection
    const at = sel === null ? -1 : rows.findIndex((r) => r.market === sel.market && r.code === sel.code)
    const next = at < 0 ? (delta > 0 ? 0 : rows.length - 1) : Math.min(rows.length - 1, Math.max(0, at + delta))
    const row = rows[next]
    if (row !== undefined) setSelection({ market: row.market, code: row.code, name: row.name })
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

  const loading = ui.leftGroup === 'unusual' ? unusual.status === 'loading' : allA.status === 'loading'
  const error = ui.leftGroup === 'unusual' ? unusual.error : allA.error
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
        <span
          className="dc-num dc-flat"
          title={breadth ? `全市场 上涨 ${breadth.up} / 下跌 ${breadth.down}` : (activeGroup?.hint ?? '')}
        >
          {rows.length}
        </span>
      </div>

      <div className="dc-rail-body dc-scroll">
        {error ? (
          <div className="dc-row-hint">数据不可达：{error}</div>
        ) : loading && rows.length === 0 ? (
          <div className="dc-row-hint">加载中…</div>
        ) : rows.length === 0 ? (
          <div className="dc-row-hint">
            {ui.leftGroup === 'watch'
              ? '自选为空：在「个股」报价头点 ☆，或从「涨停」列表里挑一只加入。'
              : ui.leftGroup === 'limit'
                ? '当前没有涨停（休市或数据源空返回）。'
                : '暂无异动事件（盘中增量捕获）。'}
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
                  onClick={() => setSelection({ market: r.market, code: r.code, name: r.name })}
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
