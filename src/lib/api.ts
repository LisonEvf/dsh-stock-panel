import type { PriceLevel, LevelType, StockLevels } from './stock-info-fields'
import { fetchKlineRows, fetchQuote as mcpFetchQuote } from './stock-data'
import { searchInstruments } from './market'
import {
  getWatchlist,
  watchAddSymbol,
  watchRemoveSymbol,
  watchClear as watchClearLocal,
} from './watchlist-store'
import type { MarketTag } from './symbol'
// 重新导出，供消费方统一从 @/lib/api 引入
export type { StockLevels, PriceLevel, LevelType }

// 数据源配置：
//   - 'mcp'：走内置 node-tdx 工具接口（embedded，见 lib/stock-data.ts / lib/mcp.ts），
//     无需 FastAPI 后端，也无需远端 MCP 服务器
//   - 'http'：调用 FastAPI 后端（需要后端运行）
//
// 默认 'mcp'（= 内置 node-tdx）。可通过全局变量 __DSH_DATA_SOURCE__ 覆盖。

/** 数据源：'mcp' | 'http' */
export type DataSource = 'mcp' | 'http'

/** 当前数据源（可运行时覆盖）。 */
let dataSource: DataSource =
  (typeof globalThis !== 'undefined' && (globalThis as any).__DSH_DATA_SOURCE__) || 'mcp'

/** 运行时切换数据源。 */
export function setDataSource(source: DataSource): void {
  dataSource = source
}

/** 当前数据源。 */
export function getDataSource(): DataSource {
  return dataSource
}

// 后端 API 客户端（DSH 插件版）
//
// Dev: Vite 代理 /api 到后端端口（默认 3018），VITE_API_BASE 可覆盖。
// Prod: 同源（由宿主/代理转发）。
//
// 仅迁移个股分析所需的最小集合；其余端点按 M2/M3 需要逐步加入。

/**
 * 后端基础地址。
 *
 * 这是 DSH 插件，由 tsdown/rolldown 构建（不是 Vite），因此没有
 * `import.meta.env`。这里用安全的回退：默认空字符串（同源 /api 转发），
 * 可通过全局变量 __VITE_API_BASE__ 覆盖（由宿主或构建注入）。
 */
const BASE =
  (typeof globalThis !== 'undefined' && (globalThis as any).__VITE_API_BASE__) || ''

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const isFormData = init?.body instanceof FormData
  const headers = new Headers(init?.headers)
  if (!isFormData && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json')
  const res = await fetch(`${BASE}${path}`, { ...init, headers })
  if (!res.ok) {
    let detail = ''
    try { const j = JSON.parse(await res.text()); detail = j.detail ?? j.message ?? '' } catch { /* ignore */ }
    const msg = detail || `${res.status} ${res.statusText}`
    throw new Error(msg)
  }
  return res.json() as Promise<T>
}

// ===== 行数据结构 =====

export interface MinuteKlineRow {
  datetime: string
  open: number
  high: number
  low: number
  close: number
  volume: number
  amount: number
}

export interface KlineRow {
  symbol?: string
  date: string
  open: number
  high: number
  low: number
  close: number
  volume?: number
  amount?: number
  /** 换手率（%）；筹码衰减用。 */
  turnover?: number
  /** 流通股本（股）；turnover 缺失时回退计算用。 */
  float_shares?: number
  change_pct?: number
  ma5?: number | null
  ma10?: number | null
  ma20?: number | null
  ma60?: number | null
  macd_dif?: number | null
  macd_dea?: number | null
  macd_hist?: number | null
  rsi_6?: number | null
  rsi_14?: number | null
  rsi_24?: number | null
  kdj_k?: number | null
  kdj_d?: number | null
  kdj_j?: number | null
  boll_upper?: number | null
  boll_lower?: number | null
  signal_limit_up?: boolean
  signal_broken_limit_up?: boolean
  consecutive_limit_ups?: number
  [key: string]: any
}

export interface StockInfo {
  name?: string
  total_shares?: number
  float_shares?: number
  ext?: Record<string, unknown>
}

export interface WatchlistEntry {
  symbol: string
  added_at: string
  note?: string
  name?: string | null
}

export interface AiStockReport {
  id: string
  symbol: string
  name: string
  focus: string
  content: string
  summary?: string
  close?: number | null
  levels?: Record<LevelType, PriceLevel[]>
  created_at: string
}

export interface FinancialMetricRecord {
  symbol?: string
  period_end?: string
  announce_date?: string | null
  eps_basic?: number | null
  eps_diluted?: number | null
  bps?: number | null
  roe?: number | null
  roe_diluted?: number | null
  roa?: number | null
  gross_margin?: number | null
  net_margin?: number | null
  debt_to_asset_ratio?: number | null
  revenue_yoy?: number | null
  net_income_yoy?: number | null
  operating_cash_to_revenue?: number | null
  inventory_turnover?: number | null
  [key: string]: any
}

export interface KlineDailyResponse {
  symbol: string
  name?: string
  stock_info?: StockInfo
  rows: KlineRow[]
  source?: string
}

export interface KlineMinuteResponse {
  symbol: string
  name?: string
  stock_info?: StockInfo
  requested_date?: string | null
  date: string | null
  rows: MinuteKlineRow[]
  source?: 'local' | 'live' | 'none'
  fallback?: boolean
  fallback_reason?: string | null
}

// ===== API 方法（仅个股分析所需）=====

export const api = {
  /** 日 K：支持 days 或 dateRange，以及扩展列 ext_columns */
  klineDaily: async (
    symbol: string,
    days = 120,
    dateRange?: { start: string; end: string },
    extColumns?: string,
  ): Promise<KlineDailyResponse> => {
    // MCP 数据源：走内置 node-tdx 工具接口（embedded）
    if (dataSource === 'mcp') {
      try {
        // symbol 格式可能是 "SH000001" 或 "000001"，解析 market + code
        const { market, code } = parseSymbol(symbol)
        const mcpRows = await fetchKlineRows(market as MarketTag, code, 'DAILY', Math.min(days, 1000))
        // 转换成 api.ts 的 KlineRow 格式
        const rows: KlineRow[] = mcpRows.map((r) => ({
          symbol: code,
          date: r.datetime,
          open: r.open,
          high: r.high,
          low: r.low,
          close: r.close,
          volume: r.vol ?? r.volume ?? 0,
          amount: r.amount,
          turnover: r.turnover,
          float_shares: r.float_shares,
        }))
        return {
          symbol: code,
          rows,
          source: 'mcp',
        }
      } catch (err) {
        // ⚠️ 不要把全局 dataSource 翻成 'http'：那会让后续 quote/搜索等所有请求
        // 一并改走后端，造成数据源状态漂移（后端常不在线，页面集体报错）。
        // MCP 失败即如实抛错，由调用方做单次降级/提示。
        console.warn('[api] MCP klineDaily 失败:', err)
        throw err instanceof Error ? err : new Error(String(err))
      }
    }
    // HTTP 数据源：调用 FastAPI 后端
    return request<KlineDailyResponse>(
      (dateRange
        ? `/api/kline/daily?symbol=${encodeURIComponent(symbol)}&start_date=${dateRange.start}&end_date=${dateRange.end}`
        : `/api/kline/daily?symbol=${encodeURIComponent(symbol)}&days=${days}`)
        + (extColumns ? `&ext_columns=${encodeURIComponent(extColumns)}` : ''),
    )
  },

  /** 分钟 K（当日分时或历史某日） */
  klineMinute: (symbol: string, date?: string): Promise<KlineMinuteResponse> =>
    request<KlineMinuteResponse>(
      `/api/kline/minute?symbol=${encodeURIComponent(symbol)}${date ? `&date=${date}` : ''}`,
    ),

  /** 批量日 K（选股/看板用，M3 需要） */
  klineDailyBatch: (symbols: string[], days = 12): Promise<{ data: Record<string, KlineRow[]> }> =>
    request<{ data: Record<string, KlineRow[]> }>('/api/kline/daily-batch', {
      method: 'POST',
      body: JSON.stringify({ symbols, days }),
    }),

  /** 标的搜索（MCP：本地全 A 索引；HTTP：后端搜索接口） */
  instrumentSearch: async (q: string, limit = 20): Promise<{ results: { symbol: string; name: string; code: string }[] }> => {
    if (dataSource === 'mcp') {
      try {
        const hits = await searchInstruments(q, limit)
        return {
          results: hits.map((h) => ({ symbol: h.symbol, name: h.name, code: h.code })),
        }
      } catch (err) {
        // 同上：不做全局 dataSource 翻转，失败如实抛错。
        console.warn('[api] MCP 本地搜索失败:', err)
        throw err instanceof Error ? err : new Error(String(err))
      }
    }
    return request<{ results: { symbol: string; name: string; code: string }[] }>(
      `/api/kline/instruments/search?q=${encodeURIComponent(q)}&limit=${limit}`,
    )
  },

  // ===== AI 个股分析（M4）=====
  stockAnalysisReportsList: (): Promise<{ reports: AiStockReport[] }> =>
    request<{ reports: AiStockReport[] }>('/api/stock-analysis/reports'),
  stockAnalysisReportDelete: (reportId: string): Promise<{ ok: boolean }> =>
    request<{ ok: boolean }>(`/api/stock-analysis/reports/${encodeURIComponent(reportId)}`, {
      method: 'DELETE',
    }),
  async *stockAnalyzeStream(symbol: string, focus?: string): AsyncGenerator<{
    type: 'meta' | 'delta' | 'error' | 'done'
    symbol?: string
    summary?: string
    content?: string
    message?: string
  }> {
    const res = await fetch('/api/stock-analysis/analyze', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ symbol, focus: focus ?? '' }),
    })
    if (!res.ok) {
      let detail = ''
      try { const j = JSON.parse(await res.text()); detail = j.detail ?? j.message ?? '' } catch { /* ignore */ }
      const msg = detail || `${res.status} ${res.statusText}`
      throw new Error(msg)
    }
    if (!res.body) throw new Error('响应无 body')
    const reader = res.body.getReader()
    const decoder = new TextDecoder()
    let buf = ''
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      buf += decoder.decode(value, { stream: true })
      const lines = buf.split('\n')
      buf = lines.pop() ?? ''
      for (const line of lines) {
        const s = line.trim()
        if (!s) continue
        try { yield JSON.parse(s) } catch { /* ignore */ }
      }
    }
    if (buf.trim()) {
      try { yield JSON.parse(buf.trim()) } catch { /* ignore */ }
    }
  },

  // ===== 个股分析：关键价位 =====
  /**
   * 关键价位是否可用。
   *
   * ⚠️ 该端点**只有 HTTP 后端**有实现（无 embedded 分支）。默认部署是 embedded，
   * 所以调用它必然 404 —— 早期调用方把它放在 `Promise.allSettled` 里，失败被吞掉，
   * 界面表现为「没有关键价位」，属于**静默失效**（功能死了但没人知道）。
   * 现在调用方必须先问这个函数，并在不可用时**显式说明原因**。
   */
  stockAnalysisLevelsAvailable: (): boolean => dataSource === 'http',

  stockAnalysisLevels: (symbol: string, days = 120): Promise<StockLevels> => {
    if (dataSource !== 'http') {
      // 明确抛错（而不是发一个注定 404 的请求），调用方据此展示「不可用」原因。
      throw new Error('关键价位需要 HTTP 后端（当前为内置 embedded 模式，未提供 /api/stock-analysis/levels）')
    }
    return request<StockLevels>(`/api/stock-analysis/levels?symbol=${encodeURIComponent(symbol)}&days=${days}`)
  },

  // ===== 自选股（MCP：本地 localStorage；HTTP：后端） =====
  watchlistList: async (): Promise<{ symbols: WatchlistEntry[] }> => {
    if (dataSource === 'mcp') {
      const items = getWatchlist()
      return {
        symbols: items.map((it) => ({
          symbol: `${it.market}${it.code}`,
          name: it.name,
          added_at: new Date().toISOString(),
        })),
      }
    }
    return request<{ symbols: WatchlistEntry[] }>('/api/watchlist')
  },
  watchlistAdd: async (symbol: string, note = ''): Promise<{ symbols: WatchlistEntry[] }> => {
    if (dataSource === 'mcp') {
      watchAddSymbol(symbol, note || undefined)
      return api.watchlistList()
    }
    return request<{ symbols: WatchlistEntry[] }>('/api/watchlist', {
      method: 'POST',
      body: JSON.stringify({ symbol, note }),
    })
  },
  watchlistRemove: async (symbol: string): Promise<{ symbols: WatchlistEntry[] }> => {
    if (dataSource === 'mcp') {
      watchRemoveSymbol(symbol)
      return api.watchlistList()
    }
    return request<{ symbols: WatchlistEntry[] }>(`/api/watchlist/${encodeURIComponent(symbol)}`, {
      method: 'DELETE',
    })
  },
  watchlistClear: async (): Promise<{ removed: number }> => {
    if (dataSource === 'mcp') {
      const removed = getWatchlist().length
      watchClearLocal()
      return { removed }
    }
    return request<{ removed: number }>('/api/watchlist', { method: 'DELETE' })
  },

  // ===== 实时行情（MCP）=====
  quote: async (symbol: string): Promise<{ code: string; name?: string; close?: number; [key: string]: any }> => {
    if (dataSource === 'mcp') {
      const { market, code } = parseSymbol(symbol)
      const q = await mcpFetchQuote(market as MarketTag, code)
      if (!q) throw new Error('暂无报价')
      const out: { code: string; name?: string; close?: number; [key: string]: any } = { ...q }
      out.volume = q.vol
      return out
    }
    return request<any>(`/api/quote?symbol=${encodeURIComponent(symbol)}`)
  },
}

/**
 * 解析 symbol 为 { market, code }。
 * 支持格式："SH000001" / "SZ000001" / "000001" / "sh000001"。
 * 默认 SH（上交所）。
 */
function parseSymbol(symbol: string): { market: string; code: string } {
  const s = symbol.trim().toUpperCase()
  const m = s.match(/^(SH|SZ|BJ)(\d{6})$/)
  if (m) {
    return { market: m[1], code: m[2] }
  }
  // 纯 6 位代码，默认 SH
  if (/^\d{6}$/.test(s)) {
    return { market: 'SH', code: s }
  }
  // 其他格式，默认 SH + 纯数字部分
  const digits = s.replace(/[^0-9]/g, '')
  return { market: 'SH', code: digits.slice(-6) }
}
