/**
 * host 半行情数据客户端（对话工具用，Node 直连，零 FastAPI）。
 *
 * 数据源：内置 TDX（进程内 node-tdx，src/host/tdx-data.ts）——唯一数据源，
 * 覆盖全部 15 个行情工具；远端 MCP（192.168.31.196:8007/mcp）已移除，无兜底。
 *
 * 返回 payload 与浏览器端 stock-data 同构（quote/kline/tick_chart/unusual），
 * 解析规则一致：数组 / {rows|data|items} / 单对象 → 数组或对象。
 *
 * ⚠️ 本模块只允许被 host 半（Node）代码使用；不得被 client 半 import。
 */

import { callEmbeddedTool } from './host/tdx-data'

function toList<T = unknown>(input: unknown): T[] {
  if (input == null) return []
  if (Array.isArray(input)) return input as T[]
  if (typeof input === 'string') {
    if (!input.trim()) return []
    try {
      const d = JSON.parse(input)
      return toList<T>(d)
    } catch {
      return []
    }
  }
  const obj = input as { rows?: unknown; data?: unknown; items?: unknown }
  if (Array.isArray(obj.rows)) return obj.rows as T[]
  if (Array.isArray(obj.data)) return obj.data as T[]
  if (Array.isArray(obj.items)) return obj.items as T[]
  if (typeof input === 'object') return [input as T]
  return []
}

/** 统一调用：内置 TDX（唯一数据源），返回与面板一致的工具 payload。 */
export async function hostToolCall(name: string, args: Record<string, unknown>): Promise<unknown> {
  return callEmbeddedTool(name, args)
}

// ===== 对话工具用的公开取数函数（返回数组/对象，失败抛错） =====

export interface HostQuote {
  market: number
  code: string
  name?: string
  close: number
  pre_close: number
  open: number
  high: number
  low: number
  vol?: number
  vol_ratio?: number
  amount?: number
  turnover?: number
  [key: string]: unknown
}

export async function hostQuote(market: string, code: string): Promise<HostQuote> {
  const payload = await hostToolCall('quote', { market, code })
  const rows = toList(payload)
  if (!rows.length) throw new Error(`${market}${code} 暂无报价`)
  return rows[0] as HostQuote
}

export async function hostKline(market: string, code: string, count = 60): Promise<Record<string, unknown>[]> {
  const payload = await hostToolCall('kline', { market, code, period: 'DAILY', count })
  return toList<Record<string, unknown>>(payload)
}

export async function hostTick(market: string, code: string): Promise<Record<string, unknown>[]> {
  const payload = await hostToolCall('tick_chart', { market, code })
  return toList<Record<string, unknown>>(payload)
}

export async function hostUnusual(market: string, count = 20): Promise<Record<string, unknown>[]> {
  const payload = await hostToolCall('unusual', { market, count })
  return toList<Record<string, unknown>>(payload)
}
