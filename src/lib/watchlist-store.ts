/**
 * 自选股本地存储（M5：去掉对 FastAPI 后端 /api/watchlist 的依赖）。
 *
 * 存 localStorage（key: dsh-stock-panel:watchlist:v1），模块级内存态 + 变更通知，
 * 跨组件（市场页 / 自选页 / 个股页星标）即时同步。
 */

import { useEffect, useReducer } from 'react'
import { parseSymbol, toSymbol, type MarketTag } from './symbol'
import { onHostHydrated, syncTable } from './host-state'

export interface WatchItem {
  market: MarketTag
  code: string
  name: string
}

const STORAGE_KEY = 'dsh-stock-panel:watchlist:v1'
const MAX_ITEMS = 60

let items: WatchItem[] = load()
const listeners = new Set<() => void>()

function load(): WatchItem[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const arr = JSON.parse(raw) as WatchItem[]
    if (!Array.isArray(arr)) return []
    return arr
      .filter((it) => it && it.code && /^(SH|SZ|BJ)$/.test(it.market))
      .slice(0, MAX_ITEMS)
  } catch {
    return []
  }
}

function persist(): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(items))
  } catch {
    /* 隐私模式等场景忽略 */
  }
  // A1：localStorage 是镜像，host 域是权威 —— 增量同步（不可用时自动 no-op）。
  syncTable('watchlist', items)
}

function notify(): void {
  for (const fn of listeners) {
    try {
      fn()
    } catch {
      /* ignore */
    }
  }
}

export function getWatchlist(): WatchItem[] {
  return items.slice()
}

export function isWatched(market: MarketTag, code: string): boolean {
  return items.some((it) => it.market === market && it.code === code)
}

/** 加自选；返回是否新增。 */
export function watchAdd(item: { market: MarketTag; code: string; name?: string }): boolean {
  if (items.some((it) => it.market === item.market && it.code === item.code)) return false
  items = [{ market: item.market, code: item.code, name: item.name || item.code }, ...items].slice(0, MAX_ITEMS)
  persist()
  notify()
  return true
}

/** 按标准符号添加（自动解析市场）。 */
export function watchAddSymbol(symbol: string, name?: string): boolean {
  const p = parseSymbol(symbol)
  if (!p) return false
  return watchAdd({ market: p.market, code: p.code, name })
}

export function watchRemove(market: MarketTag, code: string): boolean {
  const next = items.filter((it) => !(it.market === market && it.code === code))
  if (next.length === items.length) return false
  items = next
  persist()
  notify()
  return true
}

export function watchRemoveSymbol(symbol: string): boolean {
  const p = parseSymbol(symbol)
  if (!p) return false
  return watchRemove(p.market, p.code)
}

export function watchClear(): void {
  if (items.length === 0) return
  items = []
  persist()
  notify()
}

/** 统一符号入口：市场页/个股页把 AShareRow 加自选。 */
export function watchToggle(item: { market: MarketTag; code: string; name?: string }): boolean {
  const exists = items.some((it) => it.market === item.market && it.code === item.code)
  if (exists) watchRemove(item.market, item.code)
  else watchAdd(item)
  return !exists
}

export function subscribeWatchlist(fn: () => void): () => void {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

// A1：host 域的数据落地到 localStorage 后，用权威版本重载并通知 UI。
onHostHydrated(() => {
  items = load()
  notify()
})

/** React hook：返回 { items, isWatched, add, remove, clear, toggle, symbol }。 */
export function useWatchlist() {
  // 轻量订阅：数据变更时 forceUpdate 重渲染（列表量小，无性能问题）
  const [, force] = useReducer((x: number) => x + 1, 0)
  useEffect(() => subscribeWatchlist(force), [])
  return {
    items: items.slice(),
    isWatched: (m: MarketTag, c: string) => isWatched(m, c),
    add: (item: { market: MarketTag; code: string; name?: string }) => watchAdd(item),
    remove: (m: MarketTag, c: string) => watchRemove(m, c),
    clear: () => watchClear(),
    toggle: (item: { market: MarketTag; code: string; name?: string }) => watchToggle(item),
    symbol: (item: WatchItem) => toSymbol(item.market, item.code),
  }
}
