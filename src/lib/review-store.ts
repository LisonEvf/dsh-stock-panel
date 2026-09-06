/**
 * 复盘快照存储（N1：review-store.ts）。
 *
 * 依据 WATCH-METHODOLOGY §3.4「输出物与存档」与 PRODUCT-DESIGN §4.2 数据结构，
 * 把 ReviewSnapshot（结构化 JSON）落 localStorage（key: dsh-stock-panel:review:v2），
 * 按日追加（默认保留 60 个交易日），供：次日竞价对照、周末复盘、p̂/b̂ 自统计。
 *
 * 模块级内存态 + 变更通知，跨组件即时同步（复用 watchlist-store 模式）。
 */

import type { Regime } from './regime'

/** 时空标签（PRODUCT-DESIGN §4.2）。 */
export type PhaseTag =
  | 'day1' | 'day2+' // 题材生命周期
  | 'low' | 'mid' | 'high' // 空间位置
  | 'leader' | 'follower' | 'catchup' // 梯队角色

/** 预期清单单项（WATCH-METHODOLOGY §3.3 的 7 字段）。 */
export interface ExpectItem {
  id: string // 唯一 id
  symbol: string // 'SH603138'
  name: string
  tags: {
    themeDay?: number // 题材第几天
    level: 'low' | 'mid' | 'high'
    role: 'leader' | 'follower' | 'catchup'
  }
  /** 状态：强一致/分歧/分歧转一致(弱转强候选)/高位风险/退潮/低位启动。 */
  state: 'strong' | 'divergence' | 'weak2strong' | 'highRisk' | 'recession' | 'newLow'
  scenario: string // 明日剧本（自由文本，≤40 字）
  auctionOK: string // 竞价条件（可量化，如 "高开3%+竞价量>昨日20%"）
  failIf: string // 失败条件
  reason: string // 一句话理由（必须含量价证据）
}

/** 广度快照。 */
export interface BreadthSnap {
  up: number
  down: number
  limitUp: number
  limitDown: number
  amountYi: number
}

/** 主线（板块 + 龙头代表）。 */
export interface MainLine {
  board: string
  leader: string | null
}

/** 复盘快照（PRODUCT-DESIGN §4.2）。 */
export interface ReviewSnapshot {
  day: string // '2026-09-04'
  savedAt: number
  breadth: BreadthSnap
  regime: Regime | null
  mainLine: MainLine[]
  expectations: ExpectItem[] // ≤5
  notable: string[] // 关键事件时间线(压缩)
}

const STORAGE_KEY = 'dsh-stock-panel:review:v2'
const MAX_DAYS = 60 // 默认保留 60 个交易日

let snapshots: ReviewSnapshot[] = load()
const listeners = new Set<() => void>()

/** 生成唯一 id。 */
function uid(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8)
}

function todayStr(d: Date = new Date()): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

function load(): ReviewSnapshot[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const arr = JSON.parse(raw) as ReviewSnapshot[]
    if (!Array.isArray(arr)) return []
    return arr.slice(-MAX_DAYS)
  } catch {
    return []
  }
}

function persist(): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(snapshots))
  } catch {
    /* 隐私模式等忽略 */
  }
}

function notify(): void {
  for (const fn of listeners) {
    try { fn() } catch { /* ignore */ }
  }
}

/** 订阅变更。 */
export function subscribeReview(fn: () => void): () => void {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

/** 全部历史（新→旧）。 */
export function getReviews(): ReviewSnapshot[] {
  return snapshots.slice()
}

/** 按日取（用于次日竞价对照）。 */
export function getReview(day: string): ReviewSnapshot | null {
  return snapshots.find((s) => s.day === day) ?? null
}

/**
 * 保存今日复盘。同日多次保存覆盖当日条目。
 * 返回更新后的快照列表。
 */
export function saveReview(snap: ReviewSnapshot): ReviewSnapshot[] {
  const idx = snapshots.findIndex((s) => s.day === snap.day)
  const next = idx >= 0
    ? snapshots.map((s, i) => (i === idx ? snap : s))
    : [snap, ...snapshots]
  snapshots = next.slice(0, MAX_DAYS)
  persist()
  notify()
  return snapshots
}

/** 删除某日复盘。 */
export function deleteReview(day: string): ReviewSnapshot[] {
  snapshots = snapshots.filter((s) => s.day !== day)
  persist()
  notify()
  return snapshots
}

/** 新建一条预期清单单项（自动 id，追加，≤5 张）。 */
export function addExpectation(snapDay: string, exp: Omit<ExpectItem, 'id'>): ReviewSnapshot | null {
  const snap = snapshots.find((s) => s.day === snapDay)
  if (!snap) return null
  if (snap.expectations.length >= 5) return null
  snap.expectations = [...snap.expectations, { ...exp, id: uid() }]
  persist()
  notify()
  return snap
}

/** 更新一条预期清单单项。 */
export function updateExpectation(snapDay: string, id: string, patch: Partial<ExpectItem>): ReviewSnapshot | null {
  const snap = snapshots.find((s) => s.day === snapDay)
  if (!snap) return null
  const item = snap.expectations.find((e) => e.id === id)
  if (!item) return null
  Object.assign(item, patch)
  persist()
  notify()
  return snap
}

/** 删除一条预期清单单项。 */
export function removeExpectation(snapDay: string, id: string): ReviewSnapshot | null {
  const snap = snapshots.find((s) => s.day === snapDay)
  if (!snap) return null
  snap.expectations = snap.expectations.filter((e) => e.id !== id)
  persist()
  notify()
  return snap
}

/** 生成次日日期字符串（下一个交易日近似 = 次日；实际以 server_info 为准）。 */
export function nextDayStr(day: string): string {
  const d = new Date(day + 'T00:00:00')
  d.setDate(d.getDate() + 1)
  return todayStr(d)
}

/** 今天的日期字符串。 */
export function today(): string {
  return todayStr()
}
