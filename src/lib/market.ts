/**
 * 市场数据聚合层（M5：市场总览 / 指数 / 本地搜索）。
 *
 * 全部直连 MCP 数据源，无 FastAPI 后端：
 *   - 指数行情：quote（预设指数清单，代码见 INDEX_LIST）
 *   - 全市场：board_members("A", count=6000) 一次取全 A 5566 只
 *     （含 close/pre_close/buy_price_limit/turnover/amount → 广度/分布/榜单全客户端算）
 *   - 异动：unusual（SH/SZ/BJ 三市场合并）
 *
 * 模块级缓存：全 A 列表 20s TTL，多个视图共享同一份数据，轮询不打架。
 */

import {
  fetchBoardMembers,
  fetchQuote,
  fetchUnusual,
  quotePct,
  toAShareRow,
  type AShareRow,
  type QuoteRow,
  type UnusualRow,
} from './stock-data'
import { marketIdToTag, type MarketTag } from './symbol'
import { swrFetch } from './cache'

// ===== 指数清单（代码已实测，无数据服务的自动跳过） =====

export interface IndexMeta {
  market: MarketTag
  code: string
  name: string
}

export const INDEX_LIST: IndexMeta[] = [
  { market: 'SH', code: '999999', name: '上证指数' },
  { market: 'SZ', code: '399001', name: '深证成指' },
  { market: 'SZ', code: '399006', name: '创业板指' },
  { market: 'SH', code: '000688', name: '科创50' },
  { market: 'SH', code: '000680', name: '科创综指' },
  { market: 'SH', code: '000300', name: '沪深300' },
  { market: 'SH', code: '000905', name: '中证500' },
  { market: 'SH', code: '000852', name: '中证1000' },
  { market: 'SZ', code: '399005', name: '中小100' },
]

export interface IndexQuote {
  market: MarketTag
  code: string
  name: string
  pre_close: number
  open: number
  high: number
  low: number
  close: number
  change: number
  pct: number
  amount: number
  vol_ratio: number
  turnover: number
  ok: boolean
}

/** 指数实时行情（并行拉取；无数据的指数 ok=false，由 UI 过滤）。 */
export async function fetchIndexQuotes(): Promise<IndexQuote[]> {
  const settled = await Promise.allSettled(
    INDEX_LIST.map(async (idx) => {
      const q = await fetchQuote(idx.market, idx.code)
      // 休市/数据源退化时 close 可能为 0：按无效剔除（避免渲染 -100% 假行情）
      if (!q || !Number.isFinite(q.close) || q.close <= 0 || !Number.isFinite(q.pre_close) || q.pre_close <= 0) return null
      return {
        market: idx.market,
        code: idx.code,
        name: q.name || idx.name,
        pre_close: q.pre_close,
        open: Number(q.open) || q.close,
        high: Number(q.high) || q.close,
        low: Number(q.low) || q.close,
        close: q.close,
        change: q.close - q.pre_close,
        pct: quotePct(q),
        amount: Number(q.amount ?? 0),
        vol_ratio: Number(q.vol_ratio ?? 0),
        turnover: Number(q.turnover ?? 0),
        ok: true,
      } as IndexQuote
    }),
  )
  const fulfilled = settled.filter((r) => r.status === 'fulfilled')
  // 全部请求失败（数据源不可达/超时）→ 抛错让 UI 呈现"不可达"而非"暂无数据"
  if (fulfilled.length === 0 && settled.length > 0) {
    throw new Error('行情源不可达：指数请求全部失败（MCP 超时或数据源离线）')
  }
  return fulfilled
    .map((r) => (r.status === 'fulfilled' ? r.value : null))
    .filter((x): x is IndexQuote => !!x && x.ok)
}

// ===== 全 A 列表（**共用 cache.ts 的唯一缓存**，B5-②收口） =====

/** 全 A 快照的缓存 key（与状态带/各页面的 useSwr 同一个 key）。 */
const ALL_A_KEY = 'swr:mkt:allA'
/** 新鲜期：20s（行情快照；页面级 refreshInterval 通常 30s，> TTL 所以仍会真刷新）。 */
const ALL_A_TTL = 20_000

/** 真正取一次全 A（无缓存逻辑，只做取数 + 适配）。 */
async function loadAllARows(): Promise<AShareRow[]> {
  const raw = await fetchBoardMembers('A', 6000, 'CHANGE_PCT', 'DESC')
  const rows: AShareRow[] = []
  for (const r of raw) {
    const row = toAShareRow(r)
    if (row) rows.push(row)
  }
  return rows
}

/**
 * 全 A 行情列表（**唯一缓存**：`cache.ts` 的 SWR store）。
 *
 * @param force 忽略新鲜期强制刷新（用户手动刷新时用）
 */
export async function fetchAllA(force = false): Promise<AShareRow[]> {
  return swrFetch(ALL_A_KEY, loadAllARows, { ttl: force ? 0 : ALL_A_TTL })
}

// ===== 市场广度 / 分布 =====

export interface Breadth {
  total: number
  up: number
  down: number
  flat: number
  /** 收盘价 ≥ 涨停价（buy_price_limit 精确判定，仅主板/创业有值）。 */
  limitUp: number
  limitDown: number
  /** 涨跌 ≥3% 的强势/弱势家数。 */
  strongUp: number
  strongDown: number
  /** 全市场成交额合计（元）。 */
  amountSum: number
  avgPct: number
}

export function computeBreadth(rows: AShareRow[]): Breadth {
  let up = 0
  let down = 0
  let flat = 0
  let limitUp = 0
  let limitDown = 0
  let strongUp = 0
  let strongDown = 0
  let amountSum = 0
  let pctSum = 0
  for (const r of rows) {
    amountSum += r.amount || 0
    pctSum += r.pct
    if (r.pct > 0) up++
    else if (r.pct < 0) down++
    else flat++
    if (r.pct >= 3) strongUp++
    if (r.pct <= -3) strongDown++
    // 涨停价判定：buy_price_limit>0 且 close 触及涨停价（ST 5% 亦生效）
    if (r.buy_price_limit > 0 && Math.abs(r.close - r.buy_price_limit) < 1e-6) limitUp++
    if (r.sell_price_limit > 0 && Math.abs(r.close - r.sell_price_limit) < 1e-6) limitDown++
  }
  return {
    total: rows.length,
    up,
    down,
    flat,
    limitUp,
    limitDown,
    strongUp,
    strongDown,
    amountSum,
    avgPct: rows.length ? pctSum / rows.length : 0,
  }
}

export interface DistBucket {
  key: string
  label: string
  count: number
  /** 该桶是否偏涨（条形红色）。 */
  up: boolean
}

const BUCKETS: { key: string; label: string; up: boolean; test: (p: number) => boolean }[] = [
  { key: 'lt-5', label: '<-5', up: false, test: (p) => p < -5 },
  { key: '-5-3', label: '-5~-3', up: false, test: (p) => p >= -5 && p < -3 },
  { key: '-3-1', label: '-3~-1', up: false, test: (p) => p >= -3 && p < -1 },
  { key: '-1-0', label: '-1~0', up: false, test: (p) => p >= -1 && p < 0 },
  { key: '0-1', label: '0~1', up: true, test: (p) => p >= 0 && p < 1 },
  { key: '1-3', label: '1~3', up: true, test: (p) => p >= 1 && p < 3 },
  { key: '3-5', label: '3~5', up: true, test: (p) => p >= 3 && p < 5 },
  { key: 'gt-5', label: '>5', up: true, test: (p) => p >= 5 },
]

export function computeDistribution(rows: AShareRow[]): DistBucket[] {
  const counts = new Map<string, number>()
  for (const b of BUCKETS) counts.set(b.key, 0)
  for (const r of rows) {
    const b = BUCKETS.find((x) => x.test(r.pct))
    if (b) counts.set(b.key, (counts.get(b.key) ?? 0) + 1)
  }
  return BUCKETS.map((b) => ({ key: b.key, label: b.label, up: b.up, count: counts.get(b.key) ?? 0 }))
}

// ===== 异动 =====

export interface UnusualItem {
  market: MarketTag
  code: string
  name: string
  time: string
  desc: string
  value: string
  kind: 'up' | 'down' | 'other'
}

function classifyDesc(desc: string): UnusualItem['kind'] {
  if (/涨停|封板|回封|触板|拉升/.test(desc)) return 'up'
  if (/跌停|炸板/.test(desc)) return desc.includes('跌停') ? 'down' : 'other'
  return 'other'
}

/** 三市场异动合并（去重、按时间排序）。 */
export async function fetchUnusualAll(perMarket = 40): Promise<UnusualItem[]> {
  const markets: MarketTag[] = ['SH', 'SZ', 'BJ']
  const settled = await Promise.allSettled(markets.map((m) => fetchUnusual(m, perMarket)))
  const seen = new Set<string>()
  const items: UnusualItem[] = []
  for (const s of settled) {
    if (s.status !== 'fulfilled') continue
    for (const raw of s.value as UnusualRow[]) {
      const code = String(raw.code ?? '')
      if (!code) continue
      const key = `${raw.market}-${code}-${raw.time}`
      if (seen.has(key)) continue
      seen.add(key)
      items.push({
        market: marketIdToTag(raw.market),
        code,
        name: raw.name || code,
        time: raw.time || '',
        desc: raw.desc || '',
        value: raw.value || '',
        kind: classifyDesc(raw.desc || ''),
      })
    }
  }
  items.sort((a, b) => (a.time < b.time ? 1 : -1))
  return items
}

// ===== 全 A 本地搜索索引（供 InstrumentSearch 无后端可用） =====

let searchIndex: AShareRow[] | null = null
let searchIndexFetching: Promise<AShareRow[]> | null = null

/** 预热搜索索引（市场页已拉全 A 时顺带调用，避免搜索首击卡顿）。 */
export function ensureSearchIndex(): Promise<AShareRow[]> {
  if (searchIndex) return Promise.resolve(searchIndex)
  if (!searchIndexFetching) {
    searchIndexFetching = fetchAllA()
      .then((rows) => {
        searchIndex = rows
        return rows
      })
      .finally(() => {
        searchIndexFetching = null
      })
  }
  return searchIndexFetching
}

export interface SearchHit {
  symbol: string
  name: string
  code: string
  market: MarketTag
}

/** 本地搜索（代码前缀 / 名称包含）。MCP 数据源下替代后端搜索接口。 */
export async function searchInstruments(q: string, limit = 20): Promise<SearchHit[]> {
  const key = q.trim().toUpperCase()
  if (!key) return []
  const rows = await ensureSearchIndex()
  const hits: SearchHit[] = []
  const digitsOnly = /^\d+$/.test(key)
  for (const r of rows) {
    if (hits.length >= limit * 2) break
    let score = -1
    if (digitsOnly) {
      if (r.code.startsWith(key)) score = 0
    } else {
      if (r.name.includes(key)) score = 1
      if (r.name.toUpperCase() === key) score = -1 // exact match handled above
    }
    if (score >= 0) {
      hits.push({
        symbol: `${r.market}${r.code}`,
        name: r.name,
        code: r.code,
        market: r.market,
      })
    }
  }
  // 优先级：代码前缀命中在前，名称包含在后
  return hits.slice(0, limit)
}

// ===== 小工具 =====

/** 涨跌幅(百分比数值) → 显示文本，如 3.5 → "+3.50%" */
export function pctText(v: number | null | undefined, digits = 2): string {
  if (v == null || !Number.isFinite(v)) return '—'
  const s = v > 0 ? '+' : ''
  return `${s}${v.toFixed(digits)}%`
}

export type { AShareRow, QuoteRow }
