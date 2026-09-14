/**
 * src/lib/ai.ts — client 半 AI 能力：一键直调 + 结论本地存档 + 上下文压缩。
 *
 * 三条职责：
 *   1. **调用**：POST /api/stock-panel/ai（host 半用官方 ctx.llm 直调，见 src/host-ai.ts）；
 *      另有 GET 同路由探测可用性（宿主没挂 LLM 服务时按钮优雅置灰）。
 *   2. **存档**：模型结论按「交易日 + 标的」落 localStorage，刷新/切标签不丢，
 *      复盘时可回看当时的判断（`dsh-stock-panel:ai-verdict:v1`）。
 *   3. **上下文压缩**：把屏幕上的数据压成模型能读的小 JSON（四舍五入 + 截尾），
 *      控制 token 也保证「模型看到的就是你看到的」。
 */
import { useEffect, useReducer } from 'react'
import { AI_CALL_ROUTE } from './endpoints'
import { onHostHydrated, syncTable } from './host-state'
import type {
  AiTaskKind,
  AiTaskResponse,
  ReviewPlan,
  ScoutRank,
  StockVerdict,
  WarPlan,
} from './ai-contract'

/** 一次研判记录（本地存档）。 */
export interface AiVerdictRecord {
  symbol: string
  name: string
  day: string
  verdict: StockVerdict
  /** 模型原文（结构化失败时的兜底，也是留痕）。 */
  raw: string
  provider: string
  model: string
  ms: number
  createdAt: number
}

const VERDICT_KEY = 'dsh-stock-panel:ai-verdict:v1'
const VERDICT_MAX = 80

// ────────────────────────────── 调用 ──────────────────────────────

/**
 * AI 直调可用性（宿主是否挂了 LLM 服务、用哪条路由）。
 * 由 `GET /api/stock-panel/ai` 探测；不可用时面板把按钮置灰并说明原因。
 */
export interface AiAvailability {
  available: boolean
  reason?: string
  provider?: string
  model?: string
}

/** AI 可用性（GET 探测；网络异常时返回不可用而非抛错）。 */
export async function aiAvailability(): Promise<AiAvailability> {
  try {
    const res = await fetch(AI_CALL_ROUTE, { method: 'GET' })
    if (!res.ok) return { available: false, reason: `HTTP ${res.status}` }
    const body = (await res.json()) as { available?: boolean; reason?: string; provider?: string; model?: string }
    return {
      available: body.available === true,
      ...(typeof body.reason === 'string' ? { reason: body.reason } : {}),
      ...(typeof body.provider === 'string' ? { provider: body.provider } : {}),
      ...(typeof body.model === 'string' ? { model: body.model } : {}),
    }
  } catch (err) {
    return { available: false, reason: (err as Error)?.message ?? String(err) }
  }
}

/**
 * 执行一次 AI 任务。永不抛异常：所有失败都以 `{ok:false, kind, error}` 返回，
 * 调用方只需渲染 `error`。
 */
export async function runAiTask(
  task: AiTaskKind,
  context: unknown,
  ask?: string,
  signal?: AbortSignal,
): Promise<AiTaskResponse> {
  try {
    const res = await fetch(AI_CALL_ROUTE, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ task, context, ...(ask !== undefined && ask !== '' ? { ask } : {}) }),
      ...(signal !== undefined ? { signal } : {}),
    })
    const body = (await res.json()) as AiTaskResponse
    if (body === null || typeof body !== 'object') {
      return { ok: false, kind: 'llm-error', error: `响应异常（HTTP ${res.status}）` }
    }
    return body
  } catch (err) {
    const aborted = signal?.aborted === true
    return {
      ok: false,
      kind: 'llm-error',
      error: aborted ? '已取消' : `请求失败：${(err as Error)?.message ?? String(err)}`,
    }
  }
}

/** 便捷包装：个股研判（`signal` 用于切换标的/重跑时取消在途请求）。 */
export function runStockVerdict(context: unknown, ask?: string, signal?: AbortSignal): Promise<AiTaskResponse> {
  return runAiTask('stock-verdict', context, ask, signal)
}

/** 便捷包装：次日预期清单。 */
export function runReviewPlan(context: unknown, ask?: string, signal?: AbortSignal): Promise<AiTaskResponse> {
  return runAiTask('review-plan', context, ask, signal)
}

/** 便捷包装：候选排序。 */
export function runScoutRank(context: unknown, ask?: string, signal?: AbortSignal): Promise<AiTaskResponse> {
  return runAiTask('scout-rank', context, ask, signal)
}

/** 从回包里安全取结构化结果（类型收窄）。 */
export function verdictOf(res: AiTaskResponse): StockVerdict | null {
  const json = res.json
  if (json === null || typeof json !== 'object') return null
  const v = json as StockVerdict
  return typeof v.oneLine === 'string' && typeof v.stance === 'string' ? v : null
}

export function reviewPlanOf(res: AiTaskResponse): ReviewPlan | null {
  const json = res.json
  if (json === null || typeof json !== 'object') return null
  const p = json as ReviewPlan
  return Array.isArray(p.items) ? p : null
}

export function scoutRankOf(res: AiTaskResponse): ScoutRank | null {
  const json = res.json
  if (json === null || typeof json !== 'object') return null
  const s = json as ScoutRank
  return Array.isArray(s.picks) ? s : null
}

/**
 * 作战思路（`war-plan`）。
 *
 * 判据是 `insufficient` **是布尔值**而不是"有没有 picks"：模型说"素材不足、不给思路"
 * 是一个合法且必须原样展示的结论（`insufficient: true` + 空 picks），
 * 用 picks 是否为空来判会把这条结论误当成解析失败。
 */
export function warPlanOf(res: AiTaskResponse): WarPlan | null {
  const json = res.json
  if (json === null || typeof json !== 'object') return null
  const p = json as WarPlan
  return typeof p.insufficient === 'boolean' ? p : null
}

// ────────────────────────────── 本地存档 ──────────────────────────────

let records: Record<string, AiVerdictRecord> = loadRecords()
const listeners = new Set<() => void>()

function recordKey(day: string, symbol: string): string {
  return `${day}:${symbol.toUpperCase()}`
}

function loadRecords(): Record<string, AiVerdictRecord> {
  try {
    const raw = localStorage.getItem(VERDICT_KEY)
    if (raw === null) return {}
    const parsed = JSON.parse(raw) as unknown
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
    return parsed as Record<string, AiVerdictRecord>
  } catch {
    return {}
  }
}

function persistRecords(): void {
  try {
    // 只保留最近 VERDICT_MAX 条（按时间倒序裁剪），避免 localStorage 无限膨胀。
    const entries = Object.entries(records).sort((a, b) => b[1].createdAt - a[1].createdAt)
    if (entries.length > VERDICT_MAX) {
      records = Object.fromEntries(entries.slice(0, VERDICT_MAX))
    }
    localStorage.setItem(VERDICT_KEY, JSON.stringify(records))
  } catch {
    /* 隐私模式/配额：忽略 */
  }
  // A1：host 域同步（该表本就是键值表 → shape: 'keyed'）。
  syncTable('verdicts', records)
}

// A1：host 域数据落地后，用权威版本重载并通知 UI。
onHostHydrated(() => {
  records = loadRecords()
  notify()
})

function notify(): void {
  for (const fn of listeners) {
    try {
      fn()
    } catch {
      /* ignore */
    }
  }
}

/** 今天的交易日键（本地日期，与复盘存档同口径）。 */
export function todayKey(d: Date = new Date()): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

/** 读取某标的当日研判（无则 null）。 */
export function getVerdict(symbol: string, day = todayKey()): AiVerdictRecord | null {
  return records[recordKey(day, symbol)] ?? null
}

/** 写入/覆盖某标的当日研判。 */
export function saveVerdict(rec: AiVerdictRecord): void {
  records = { ...records, [recordKey(rec.day, rec.symbol)]: rec }
  persistRecords()
  notify()
}

export function removeVerdict(symbol: string, day = todayKey()): void {
  const key = recordKey(day, symbol)
  if (!(key in records)) return
  const next = { ...records }
  delete next[key]
  records = next
  persistRecords()
  notify()
}

export function subscribeAi(fn: () => void): () => void {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

/** React hook：某标的当日研判（跨组件同步）。 */
export function useVerdict(symbol: string | null): AiVerdictRecord | null {
  const [, force] = useReducer((x: number) => x + 1, 0)
  useEffect(() => subscribeAi(force), [])
  if (symbol === null || symbol === '') return null
  return getVerdict(symbol)
}

// ────────────────────────────── 上下文压缩 ──────────────────────────────

/** 数值四舍五入（模型不需要 8 位小数；也省 token）。 */
function r(v: unknown, digits = 2): number | null {
  const n = typeof v === 'number' ? v : Number(v)
  if (!Number.isFinite(n)) return null
  const p = 10 ** digits
  return Math.round(n * p) / p
}

/** 日 K 压缩：只留近 N 根，字段精简。 */
export function compactKline(
  rows: Array<Record<string, unknown>> | null | undefined,
  limit = 60,
): Array<Record<string, number | string>> {
  if (!Array.isArray(rows) || rows.length === 0) return []
  const tail = rows.slice(-limit)
  return tail.map((row) => {
    const date = typeof row.date === 'string' ? row.date.slice(0, 10) : String(row.date ?? '')
    return {
      d: date,
      o: r(row.open) ?? 0,
      h: r(row.high) ?? 0,
      l: r(row.low) ?? 0,
      c: r(row.close) ?? 0,
      v: r(row.volume, 0) ?? 0,
    }
  })
}

/** 报价压缩（字段名对齐行情工具，模型好理解）。 */
export function compactQuote(q: Record<string, unknown> | null | undefined): Record<string, unknown> {
  if (q === null || q === undefined) return {}
  const pick = (keys: string[]): Record<string, unknown> => {
    const out: Record<string, unknown> = {}
    for (const k of keys) {
      if (q[k] === undefined || q[k] === null) continue
      out[k] = typeof q[k] === 'number' ? r(q[k]) : q[k]
    }
    return out
  }
  return pick([
    'close', 'pre_close', 'open', 'high', 'low', 'pct',
    'volume', 'amount', 'turnover', 'volume_ratio', 'buy_price_limit', 'sell_price_limit',
  ])
}

/** 指数/广度压缩（复盘与大盘背景）。 */
export function compactBreadth(b: Record<string, unknown> | null | undefined): Record<string, unknown> {
  if (b === null || b === undefined) return {}
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(b)) {
    out[k] = typeof v === 'number' ? r(v) : v
  }
  return out
}

/** 通用列表压缩：只保留白名单字段并截断条数。 */
export function compactRows(
  rows: Array<Record<string, unknown>> | null | undefined,
  fields: string[],
  limit = 40,
): Array<Record<string, unknown>> {
  if (!Array.isArray(rows)) return []
  return rows.slice(0, limit).map((row) => {
    const out: Record<string, unknown> = {}
    for (const f of fields) {
      if (row[f] === undefined || row[f] === null) continue
      out[f] = typeof row[f] === 'number' ? r(row[f]) : row[f]
    }
    return out
  })
}
