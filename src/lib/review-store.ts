/**
 * 复盘快照存储（N1：review-store.ts；v3：2026-09-06 增加昨日涨停池建档）。
 *
 * 依据 WATCH-METHODOLOGY §3.4「输出物与存档」与 PRODUCT-DESIGN §4.2 数据结构，
 * 把 ReviewSnapshot（结构化 JSON）落 localStorage（key: dsh-stock-panel:review:v3），
 * 按日追加（默认保留 60 个交易日），供：次日竞价对照、周末复盘、p̂/b̂ 自统计。
 *
 * v3（N5+）：快照额外保存当日涨停池摘要（limitUpPool），次日复盘据此**实算**
 * 晋级率 / 首板溢价（替代近似初值），不再需要"猜"。旧 v2 数据加载时自动迁移。
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

/** 涨停池建档行（v3：随当日快照存档，供次日实算晋级率/首板溢价）。 */
export interface LimitUpPoolItem {
  symbol: string // 'SH600000'
  name: string
  /** 当日连板数（countStreak；0 = kline 拉取失败未知）。 */
  streak: number
  streakKnown: boolean
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

/** 风向标（复盘第 6 步：从当日候选标记的"有特点的票"，次日盯盘用）。 */
export interface WindFlagRef {
  symbol: string // 'SH603138'
  name: string
  tag: WindFlagTag
}

/** 风向标类型（复盘七步法第 6 步语义）。 */
export type WindFlagTag = 'dayLeader' | 'rebound' | 'lowVolume' | 'strongHold' | 'other'

/** 复盘快照（PRODUCT-DESIGN §4.2；v3 增 limitUpPool）。 */
export interface ReviewSnapshot {
  day: string // '2026-09-04'
  savedAt: number
  breadth: BreadthSnap
  regime: Regime | null
  mainLine: MainLine[]
  expectations: ExpectItem[] // ≤5
  notable: string[] // 关键事件时间线(压缩)
  /**
   * v3：当日涨停池摘要（存档时写入，≤80 只）。
   * 次日复盘据此实算 promoteRate（晋级率）与 firstBoardPremium（首板溢价），
   * 并作为次日竞价雷达的对照底座之一。旧 v2 存档无此字段（可选）。
   */
  limitUpPool?: LimitUpPoolItem[]
  /** 亏钱效应共性备注（复盘七步法第 5 步：把雷区共性记下来；人工文本，可选）。 */
  riskNote?: string
  /** 风向标清单（复盘七步法第 6 步：标记的有特点标的 ≤8 只；可选，兼容旧档）。 */
  windFlags?: WindFlagRef[]
}

const STORAGE_KEY = 'dsh-stock-panel:review:v3'
/** v2 旧键：仅迁移读取，不再写入。 */
const LEGACY_KEY_V2 = 'dsh-stock-panel:review:v2'
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
    if (raw) {
      const arr = JSON.parse(raw) as ReviewSnapshot[]
      if (Array.isArray(arr)) return sanitize(arr)
    }
    // v2 → v3 自动迁移（非破坏：旧键保留不动）
    const rawV2 = localStorage.getItem(LEGACY_KEY_V2)
    if (rawV2) {
      const arrV2 = JSON.parse(rawV2) as ReviewSnapshot[]
      if (Array.isArray(arrV2) && arrV2.length) {
        const migrated = sanitize(arrV2)
        try {
          localStorage.setItem(STORAGE_KEY, JSON.stringify(migrated))
        } catch { /* 隐私模式等忽略 */ }
        return migrated
      }
    }
    return []
  } catch {
    return []
  }
}

/** 校验 + 裁剪（保持新→旧序、上限 60 条）。 */
function sanitize(list: ReviewSnapshot[]): ReviewSnapshot[] {
  const arr = list.filter((s) => s && typeof s.day === 'string')
  arr.sort((a, b) => (a.day < b.day ? 1 : -1))
  return arr.slice(0, MAX_DAYS)
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
 * 取给定日期之前最近的一份存档（"上一交易日"口径）。
 * 快照按日新→旧排列：跳过空档（周末/节假日未存）直接取最近更早一份。
 * 供次日复盘实算晋级率/首板溢价（v3 limitUpPool 对照底座）。
 */
export function getPrevSnapshot(day: string): ReviewSnapshot | null {
  for (const s of snapshots) {
    if (s.day < day) return s
  }
  return null
}

/**
 * 找「今日竞价要对照的预期清单」：优先今日已存档（盘前/当日计划），
 * 否则取最近一份更早日期的复盘清单（其预期目标即今日）。与
 * WATCH-METHODOLOGY §4「开盘对照昨日预期」+ PRODUCT-DESIGN §P2 口径一致。
 */
export function getLatestPlan(day: string): ReviewSnapshot | null {
  return getReview(day) ?? getPrevSnapshot(day)
}

/**
 * 保存今日复盘。同日多次保存覆盖当日条目。
 * 返回更新后的快照列表（始终按日新→旧排序）。
 */
export function saveReview(snap: ReviewSnapshot): ReviewSnapshot[] {
  const idx = snapshots.findIndex((s) => s.day === snap.day)
  const next = idx >= 0
    ? snapshots.map((s, i) => (i === idx ? snap : s))
    : [snap, ...snapshots]
  next.sort((a, b) => (a.day < b.day ? 1 : -1))
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
