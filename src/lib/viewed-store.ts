/**
 * src/lib/viewed-store.ts — 「看过的个股」（A4 左栏「个股」分组的数据源）。
 *
 * 语义：记录用户**在盯盘台里看过的标的**（点左栏/搜索/任意列表打开都会进这里），
 * 最近看过的排最前、去重、有上限。它是「个股栏」的唯一真源——A4 只负责把它渲染成左栏分组，
 * 点击即渲染个股信息（`setSelection` + 主区个股信息）。
 *
 * 持久化：与其它 store 同款（内存态 + localStorage 镜像 + 变更通知），
 * 并接入 A1 的 host 域表 `viewed`（清浏览器缓存/换设备也不丢「看过什么」）。
 */
import { useEffect, useReducer } from 'react'
import { onHostHydrated, syncTable } from './host-state'
import { toSymbol, type MarketTag } from './symbol'

/** 一条「看过的个股」记录。 */
export interface ViewedStock {
  market: MarketTag
  code: string
  name: string
  /** 最近一次查看的时间戳（排序用）。 */
  at: number
  /** 查看次数（诊断/将来做「常看」用）。 */
  hits: number
}

const STORAGE_KEY = 'dsh-stock-panel:viewed:v1'
/** 上限：个股栏是「最近看过」，太长就失去意义了。 */
const MAX_ITEMS = 30

let items: ViewedStock[] = load()
const listeners = new Set<() => void>()

function load(): ViewedStock[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const arr = JSON.parse(raw) as ViewedStock[]
    if (!Array.isArray(arr)) return []
    return arr
      .filter((it) => it && it.code && /^(SH|SZ|BJ)$/.test(it.market))
      .sort((a, b) => b.at - a.at)
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
  // A1：host 域同步（增量；不可用时自动 no-op）。
  syncTable('viewed', items)
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

/** 最近看过的个股（新 → 旧）。 */
export function getViewed(): ViewedStock[] {
  return items.slice()
}

/**
 * 记一次查看（已存在则提前并累加次数）。
 *
 * 注意：**同标的连续重复调用不会刷新顺序之外的状态**（幂等语义：只更新时间与次数）。
 */
export function recordViewed(item: { market: MarketTag; code: string; name?: string }): void {
  const now = Date.now()
  const idx = items.findIndex((it) => it.market === item.market && it.code === item.code)
  if (idx >= 0) {
    const cur = items[idx]
    const next: ViewedStock = {
      market: cur.market,
      code: cur.code,
      name: item.name || cur.name,
      at: now,
      hits: cur.hits + 1,
    }
    items = [next, ...items.filter((_, i) => i !== idx)]
  } else {
    items = [
      { market: item.market, code: item.code, name: item.name || item.code, at: now, hits: 1 },
      ...items,
    ].slice(0, MAX_ITEMS)
  }
  persist()
  notify()
}

/** 从个股栏移除。 */
export function removeViewed(market: MarketTag, code: string): boolean {
  const next = items.filter((it) => !(it.market === market && it.code === code))
  if (next.length === items.length) return false
  items = next
  persist()
  notify()
  return true
}

/** 清空个股栏。 */
export function clearViewed(): void {
  if (items.length === 0) return
  items = []
  persist()
  notify()
}

/** 订阅变更（左栏渲染用）。 */
export function subscribeViewed(fn: () => void): () => void {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

/** React hook：看过的个股列表。 */
export function useViewed(): ViewedStock[] {
  const [, force] = useReducer((x: number) => x + 1, 0)
  useEffect(() => subscribeViewed(force), [])
  return items.slice()
}

/** 标准符号（SH600519）。 */
export function viewedSymbol(it: ViewedStock): string {
  return toSymbol(it.market, it.code)
}

// A1：host 域数据落地后，用权威版本重载并通知 UI。
onHostHydrated(() => {
  items = load()
  notify()
})
