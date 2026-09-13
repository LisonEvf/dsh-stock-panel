/**
 * 本地监控/告警（M7：alerts.ts）。
 *
 * 依据 MIGRATION-PLAN §5 M7：
 *   - 规则：价格突破/跌破（≥/≤ 目标价）、涨跌幅（≥/≤ x%，相对昨收）、异动关键词（事件流 desc/名称 命中）；
 *   - 命中记录：localStorage 环形 ≤200 条，重启不丢；read 标记供 Tab 徽标/已读清点；
 *   - 冷却：命中去重冷却由 Watcher 在内存层完成（5 分钟同规则同标的只提醒一次），
 *     本模块只负责「规则 × 快照 → 是否命中」的纯判定与记录存储。
 *
 * 模块级内存态 + 变更通知（复用 watchlist-store / event-stream 模式）。
 */

import type { MarketTag } from './symbol'
import { onHostHydrated, syncTable } from './host-state'

// ===== 类型 =====

export type AlertRuleType = 'price_above' | 'price_below' | 'pct_above' | 'pct_below' | 'event_keyword'

export interface AlertRule {
  id: string
  type: AlertRuleType
  enabled: boolean
  /** price/pct 类：标的。 */
  market?: MarketTag
  code?: string
  name?: string
  /** price 类=价格阈值；pct 类=涨跌幅阈值（%，如 -5 = 跌 5%）。 */
  value?: number
  /** event_keyword 类：关键词（命中事件 desc/名称，不区分大小写）。 */
  keyword?: string
  createdAt: number
}

export interface AlertHit {
  id: string
  ruleId: string
  /** 规则简述（UI 行首标签）。 */
  ruleLabel: string
  symbol?: string
  name?: string
  message: string
  ts: number
  read: boolean
}

/** 报价快照（price/pct 规则判定输入）。 */
export interface QuoteSnap {
  market?: MarketTag
  code?: string
  name?: string
  close: number
  pre_close: number
}

// ===== 存储 =====

const RULES_KEY = 'dsh-stock-panel:alerts:rules:v1'
const HITS_KEY = 'dsh-stock-panel:alerts:hits:v1'
const MAX_HITS = 200

let rules: AlertRule[] = loadRules()
let hits: AlertHit[] = loadHits()
const listeners = new Set<() => void>()

function loadRules(): AlertRule[] {
  try {
    const raw = localStorage.getItem(RULES_KEY)
    if (!raw) return []
    const arr = JSON.parse(raw) as AlertRule[]
    return Array.isArray(arr) ? arr.filter((r) => r && typeof r.id === 'string' && r.type) : []
  } catch {
    return []
  }
}

function loadHits(): AlertHit[] {
  try {
    const raw = localStorage.getItem(HITS_KEY)
    if (!raw) return []
    const arr = JSON.parse(raw) as AlertHit[]
    if (!Array.isArray(arr)) return []
    return arr.slice(0, MAX_HITS)
  } catch {
    return []
  }
}

function persistRules(): void {
  try {
    localStorage.setItem(RULES_KEY, JSON.stringify(rules))
  } catch {
    /* 隐私模式等忽略 */
  }
  // A1：host 域同步（增量；不可用时自动 no-op）。规则是跨日资产，不能只活在浏览器里。
  syncTable('alert_rules', rules)
}

function persistHits(): void {
  try {
    localStorage.setItem(HITS_KEY, JSON.stringify(hits))
  } catch {
    /* 隐私模式等忽略 */
  }
  syncTable('alert_hits', hits)
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

/** 订阅变更（返回退订函数）。 */
export function subscribeAlerts(fn: () => void): () => void {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

// ===== 规则 CRUD =====

export function getRules(): AlertRule[] {
  return rules.slice()
}

export function getRule(id: string): AlertRule | null {
  return rules.find((r) => r.id === id) ?? null
}

/** 新增规则。 */
export function addRule(input: Omit<AlertRule, 'id' | 'enabled' | 'createdAt'>): AlertRule {
  const rule: AlertRule = {
    ...input,
    id: Date.now().toString(36) + Math.random().toString(36).slice(2, 7),
    enabled: true,
    createdAt: Date.now(),
  }
  rules = [rule, ...rules]
  persistRules()
  notify()
  return rule
}

/** 局部更新规则。 */
export function updateRule(id: string, patch: Partial<AlertRule>): AlertRule | null {
  const rule = rules.find((r) => r.id === id)
  if (!rule) return null
  Object.assign(rule, patch)
  persistRules()
  notify()
  return rule
}

/** 删除规则。 */
export function removeRule(id: string): void {
  rules = rules.filter((r) => r.id !== id)
  persistRules()
  notify()
}

// ===== 命中记录 =====

/** 新增命中（去重：同规则同符号 60s 内的重复 message 直接合并）。 */
export function recordHit(hit: Omit<AlertHit, 'id' | 'ts' | 'read'>): void {
  const now = Date.now()
  const dup = hits.find(
    (h) =>
      h.ruleId === hit.ruleId &&
      h.symbol === hit.symbol &&
      h.message === hit.message &&
      now - h.ts < 60_000,
  )
  if (dup) return
  const entry: AlertHit = { ...hit, id: now.toString(36) + Math.random().toString(36).slice(2, 6), ts: now, read: false }
  hits = [entry, ...hits].slice(0, MAX_HITS)
  persistHits()
  notify()
}

export function getHits(): AlertHit[] {
  return hits.slice()
}

export function unreadCount(): number {
  return hits.filter((h) => !h.read).length
}

/** 全部标记已读（进入监控页 / 点徽标时调用）。 */
export function markAllRead(): void {
  if (!hits.some((h) => !h.read)) return
  for (const h of hits) h.read = true
  persistHits()
  notify()
}

export function clearHits(): void {
  hits = []
  persistHits()
  notify()
}

// ===== 纯判定（规则 × 快照/事件） =====

/** 规则简述标签。 */
export function ruleLabel(rule: AlertRule): string {
  const target = rule.code ? `${rule.name || rule.code}` : ''
  switch (rule.type) {
    case 'price_above':
      return `${target} ≥ ${rule.value}`
    case 'price_below':
      return `${target} ≤ ${rule.value}`
    case 'pct_above':
      return `${target} 涨 ≥ ${rule.value}%`
    case 'pct_below':
      return `${target} 跌 ≤ ${rule.value}%`
    case 'event_keyword':
      return `异动含「${rule.keyword}」`
  }
}

export function ruleTypeLabel(type: AlertRuleType): string {
  switch (type) {
    case 'price_above':
      return '价格突破 ≥'
    case 'price_below':
      return '价格跌破 ≤'
    case 'pct_above':
      return '涨幅 ≥'
    case 'pct_below':
      return '跌幅 ≤'
    case 'event_keyword':
      return '异动关键词'
  }
}

/**
 * 判定 price/pct 规则是否命中报价快照；命中返回提示文案，未命中返回 null。
 * 报价无效（无 close/pre_close）一律视为未命中。
 */
export function evaluateQuoteRule(rule: AlertRule, q: QuoteSnap): string | null {
  const close = Number(q.close)
  const pre = Number(q.pre_close)
  if (!Number.isFinite(close) || !Number.isFinite(pre) || pre <= 0) return null
  const name = q.name || rule.name || rule.code || ''
  const pct = ((close - pre) / pre) * 100
  switch (rule.type) {
    case 'price_above':
      if (rule.value != null && close >= rule.value)
        return `${name} ${close.toFixed(2)} 突破目标 ${rule.value}（${pct >= 0 ? '+' : ''}${pct.toFixed(2)}%）`
      break
    case 'price_below':
      if (rule.value != null && close <= rule.value)
        return `${name} ${close.toFixed(2)} 跌破目标 ${rule.value}（${pct.toFixed(2)}%）`
      break
    case 'pct_above':
      if (rule.value != null && pct >= rule.value)
        return `${name} 现涨 ${pct.toFixed(2)}% ≥ ${rule.value}%`
      break
    case 'pct_below':
      if (rule.value != null && pct <= rule.value)
        return `${name} 现 ${pct.toFixed(2)}% ≤ ${rule.value}%（破位）`
      break
    default:
      break
  }
  return null
}

/** 判定 event_keyword 规则是否命中事件条目。 */
export function evaluateEventRule(rule: AlertRule, ev: { name: string; desc: string; code: string }): boolean {
  if (!rule.keyword) return false
  const kw = rule.keyword.toLowerCase()
  return `${ev.name} ${ev.desc} ${ev.code}`.toLowerCase().includes(kw)
}

// A1：host 域数据落地后，用权威版本重载并通知 UI（与其它 store 同款收口）。
onHostHydrated(() => {
  rules = loadRules()
  hits = loadHits()
  notify()
})
