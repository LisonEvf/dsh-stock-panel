/**
 * 异动事件增量捕获器（N4：event-stream.ts）。
 *
 * 依据 PRODUCT-DESIGN §5.3「事件流与局势归类」与 MIGRATION-PLAN §7.4 轮询护栏：
 *   - 盘中轮询 unusual×3（SH/SZ/BJ）+ market_monitor×3（SH/SZ/BJ），30s 一轮；
 *   - key = `${market}-${code}-${time}-${desc}` 去重，只保留增量；
 *   - localStorage 环形落盘（JSON 数组，≤500 条），重启后补齐盘中历史；
 *   - 收盘后（复盘/休市时段）只读：不再轮询捕获（unusual 收盘后退化为竞价快照），
 *     仅显示盘中已捕获的历史 —— 由宿主用 isPostClose(phase) 提示「只读」。
 *
 * 模块级内存态 + 变更通知（复用 watchlist-store / review-store 模式），
 * 事件流页面（WarPage）与复盘页（ReviewPage）都能订阅同一份增量。
 *
 * 数据源：MCP 数据源的 unusual / market_monitor 工具；时段由 server_info 驱动
 * （60s 节流，避免每轮都打 server_info，见 session-clock.ts）。
 */

import { callToolJson, fetchMarketMonitor, fetchUnusual, type UnusualRow } from './stock-data'
import { marketIdToTag, type MarketTag } from './symbol'
import { buildClock, type SessionPhase } from './session-clock'
import { onHostHydrated, syncTable } from './host-state'

/** 事件类型（与 WarPage 的 kindLabel/eventColor 枚举对齐）。 */
export type EventKind =
  | 'limitUp' // 涨停/封板/回封
  | 'limitDown' // 跌停
  | 'break' // 炸板/开板
  | 'surge' // 拉升/上攻/急拉
  | 'bigOrder' // 大单/主力净流入
  | 'other'

/** 事件条目（PRODUCT-DESIGN §5.3 骨架 + key 去重键）。 */
export interface EventItem {
  /** 去重键：`${market}-${code}-${time}-${desc}`。 */
  key: string
  /** 捕获时间戳（落盘时的 Date.now()）。 */
  ts: number
  market: MarketTag
  code: string
  name: string
  desc: string
  kind: EventKind
  /** 服务端事件时间（如 10:03:00；为空时回退到捕获时刻 HH:MM:SS）。 */
  time: string
  value: string
}

const STORAGE_KEY = 'dsh-stock-panel:events:v1'
const MAX_EVENTS = 500 // JSONL 环形裁剪上限（PRODUCT-DESIGN §7）
const PER_MARKET = 40 // 每市场 unusual/market_monitor 条数

let events: EventItem[] = load()
const listeners = new Set<() => void>()

// server_info 时钟缓存（60s 节流；只有轮到捕获时才查，避免 30s 轮询打爆 server_info）
let clockCache: { at: number; phase: SessionPhase } | null = null
const CLOCK_TTL = 60_000

// ===== 存储 =====

function load(): EventItem[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const arr = JSON.parse(raw) as EventItem[]
    if (!Array.isArray(arr)) return []
    return arr
      .filter((e) => e && typeof e.key === 'string' && e.code)
      .sort((a, b) => sortEvents(a, b))
      .slice(0, MAX_EVENTS)
  } catch {
    return []
  }
}

function persist(): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(events))
  } catch {
    /* 隐私模式等忽略 */
  }
  // A1：host 域同步（增量：只发新增/变化/删除的记录 —— 500 条也不会每轮全量重发）。
  syncTable('events', events)
}

function notify(): void {
  for (const fn of listeners) {
    try { fn() } catch { /* ignore */ }
  }
}

/** 订阅事件流变更（返回退订函数）。 */
export function subscribeEvents(fn: () => void): () => void {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

/** 全部事件（新→旧；与 localStorage 落盘同一份排序）。 */
export function getEvents(): EventItem[] {
  return events.slice()
}

/** 事件是否已收盘/休市（只读态）：复盘后 unusual 退化为竞价快照，不再捕获。 */
export function isPostClose(phase: SessionPhase): boolean {
  return phase === 'review' || phase === 'closed'
}

/** 事件排序：时间（服务端 HH:MM:SS）降序，其次捕获 ts 降序。 */
function sortEvents(a: EventItem, b: EventItem): number {
  return timeToSec(b.time) - timeToSec(a.time) || b.ts - a.ts || (a.code < b.code ? -1 : 1)
}

function timeToSec(t: string): number {
  const m = t.match(/(\d{1,2}):(\d{2})(?::(\d{2}))?/)
  if (!m) return -1
  return Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3] ?? 0)
}

function nowTime(): string {
  const d = new Date()
  const p = (n: number) => String(n).padStart(2, '0')
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
}

// ===== 归一化 =====

/** 按描述文本归类事件类型（unusual/market_monitor 的 desc 自由文本启发式）。 */
function classifyKind(desc: string): EventKind {
  // 炸板优先于涨停判定：如「涨停打开（炸板）」「开板回落」
  if (/炸板|打开涨停|涨停打开|开板/.test(desc)) return 'break'
  if (/跌停/.test(desc)) return 'limitDown'
  if (/涨停|封板|回封|触板|秒板|顶格/.test(desc)) return 'limitUp'
  if (/拉升|上攻|快速上涨|急拉|点火|冲高|抢筹/.test(desc)) return 'surge'
  if (/大单|主力|净流入|净流出|资金|封单|流入|流出/.test(desc)) return 'bigOrder'
  return 'other'
}

/** 服务端行 → 事件条目；key 已存在返回 null。 */
function toItem(raw: UnusualRow, seen: Set<string>): EventItem | null {
  const code = String(raw.code ?? '').trim()
  if (!code) return null
  const market = marketIdToTag(raw.market)
  const desc = String(raw.desc ?? '').trim()
  const time = String(raw.time ?? '').trim() || nowTime()
  const key = `${market}-${code}-${time}-${desc}`
  if (seen.has(key)) return null
  seen.add(key)
  return {
    key,
    ts: Date.now(),
    market,
    code,
    name: (raw.name || code).trim(),
    desc,
    kind: classifyKind(desc),
    time,
    value: String(raw.value ?? '').trim(),
  }
}

// ===== 时段门控 =====

/** 当前时段（server_info → buildClock，60s 节流；失败时按本地工作时段近似）。 */
async function currentPhase(): Promise<SessionPhase> {
  const now = Date.now()
  if (clockCache && now - clockCache.at < CLOCK_TTL) return clockCache.phase
  let phase: SessionPhase
  try {
    const info = await callToolJson('server_info', {})
    phase = buildClock(info ?? null).phase
  } catch {
    // 服务器不可达：近似本地（周中 9:30-15:00 视为盘中，否则只读）
    const d = new Date()
    const day = d.getDay()
    if (day === 0 || day === 6) phase = 'closed'
    else if (d.getHours() >= 9 && d.getHours() < 15) phase = 'trading'
    else phase = 'closed'
  }
  clockCache = { at: now, phase }
  return phase
}

// ===== 捕获 =====

/**
 * 捕获一轮增量：unusual×3 + market_monitor×3（每市场 ≤40 条）。
 * 仅在竞价/盘中时段捕获；收盘后（复盘/休市/盘前）返回 0 且不写盘。
 * 返回本轮新增条数；重复轮询不重复计数（key 去重）。
 */
export async function captureOnce(signal?: AbortSignal): Promise<number> {
  let phase: SessionPhase
  try {
    phase = await currentPhase()
  } catch {
    phase = 'trading' // 时钟失败不阻塞捕获，让 fetch 兜底
  }
  if (phase !== 'trading' && phase !== 'auction') return 0

  const markets: MarketTag[] = ['SH', 'SZ', 'BJ']
  const settled = await Promise.allSettled([
    ...markets.map((m) => fetchUnusual(m, PER_MARKET)),
    ...markets.map((m) => fetchMarketMonitor(m, PER_MARKET)),
  ])
  if (signal?.aborted) return 0

  const seen = new Set(events.map((e) => e.key))
  const added: EventItem[] = []
  for (const s of settled) {
    if (s.status !== 'fulfilled') continue
    for (const raw of s.value as UnusualRow[]) {
      const item = toItem(raw, seen)
      if (item) added.push(item)
    }
  }
  if (!added.length) return 0

  events = [...added, ...events].sort(sortEvents).slice(0, MAX_EVENTS)
  persist()
  notify()
  return added.length
}

/** 清空本地事件（调试/重置用）。 */
export function clearEvents(): void {
  events = []
  try { localStorage.removeItem(STORAGE_KEY) } catch { /* ignore */ }
  // A1：同步清空到 host（增量同步会把这一批键当作删除下发）。
  syncTable('events', events)
  notify()
}

// A1：host 域数据落地后，用权威版本重载并通知 UI。
onHostHydrated(() => {
  events = load()
  notify()
})
