/**
 * 轻量选股引擎（M8：screener.ts，纯函数 + 数据拉取分离）。
 *
 * 依据 MIGRATION-PLAN §5 M8 裁剪：
 *   1. **快照筛选**：全 A 一次快照（fetchAllA，20s TTL 共享）+ 客户端条件
 *      （涨跌幅/换手/量比/成交额/市值/板块/剔除 ST）→ 即时出结果；
 *   2. **信号筛选**（可选增强）：候选集 ≤200 拉 kline(DAILY, 80) 客户端算信号：
 *      MA5 上穿 MA20（金叉）、收盘上穿 MA60（近期）——pool≤8，带进度。
 *
 * 阈值/预设均为「经验初值 + 可调」，不做黑箱（WATCH-METHODOLOGY 纪律）。
 */

import type { AShareRow } from './stock-data'
import type { McpKlineRow } from './stock-data'
import { fetchKlineRows } from './stock-data'
import { runPool } from './pool'

// ===== 快照筛选 =====

export interface ScreenCond {
  /** 当日涨跌幅区间（%，与 AShareRow.pct 同口径）。 */
  pctMin?: number
  pctMax?: number
  /** 换手率下限（%，行内 turnover 字段为百分比数值）。 */
  turnoverMin?: number
  /** 量比下限。 */
  volRatioMin?: number
  /** 成交额下限（亿）。 */
  amountMinYi?: number
  /** 市值区间（亿）。 */
  capMinYi?: number
  capMaxYi?: number
  /** 剔除名称含 ST 的标的。 */
  noST?: boolean
  /** 板块过滤。 */
  board?: 'all' | 'main_sh' | 'main_sz' | 'cyb' | 'kcb' | 'bj'
}

const BJ_PREFIXES = ['43', '83', '87', '92']

export function boardOf(code: string): 'main_sh' | 'main_sz' | 'cyb' | 'kcb' | 'bj' {
  if (code.startsWith('688')) return 'kcb'
  if (code.startsWith('30')) return 'cyb'
  if (code.startsWith('60')) return 'main_sh'
  if (BJ_PREFIXES.some((p) => code.startsWith(p))) return 'bj'
  return 'main_sz'
}

/** 单行 × 条件 → 是否命中。 */
export function matchScreen(row: AShareRow, c: ScreenCond): boolean {
  if (c.pctMin != null && row.pct < c.pctMin) return false
  if (c.pctMax != null && row.pct > c.pctMax) return false
  if (c.turnoverMin != null && row.turnover < c.turnoverMin) return false
  if (c.volRatioMin != null && row.vol_ratio < c.volRatioMin) return false
  if (c.amountMinYi != null && row.amount / 1e8 < c.amountMinYi) return false
  if (c.capMinYi != null && row.total_market_cap_ab / 1e8 < c.capMinYi) return false
  if (c.capMaxYi != null && row.total_market_cap_ab / 1e8 > c.capMaxYi) return false
  if (c.noST && /ST/i.test(row.name)) return false
  if (c.board && c.board !== 'all' && boardOf(row.code) !== c.board) return false
  return true
}

/**
 * 快照筛选（保持入参顺序，上限 limit）。
 *
 * `limit <= 0` 明确表示"不要结果"：原来的写法是"先 push 再判断长度"，
 * 于是 limit=0 会返回 1 条（B4 单测在边界上抓到）。这里补上闸门，
 * 对 limit≥1 的行为完全不变。
 */
export function screenRows(rows: AShareRow[], c: ScreenCond, limit = 200): AShareRow[] {
  const out: AShareRow[] = []
  if (limit <= 0) return out
  for (const r of rows) {
    if (!matchScreen(r, c)) continue
    out.push(r)
    if (out.length >= limit) break
  }
  return out
}

// ===== 预设策略卡片（6 张，经验初值可调） =====

export interface Preset {
  key: string
  label: string
  hint: string
  cond: ScreenCond
}

export const PRESETS: Preset[] = [
  {
    key: 'surge',
    label: '放量上攻',
    hint: '涨 2~8% · 量比≥2 · 换手≥5% · 额≥5亿',
    cond: { pctMin: 2, pctMax: 8, volRatioMin: 2, turnoverMin: 5, amountMinYi: 5, noST: true },
  },
  {
    key: 'lowBreak',
    label: '低位异动启动',
    hint: '涨 3~9% · 量比≥3 · 小市值 ≤300亿',
    cond: { pctMin: 3, pctMax: 9.5, volRatioMin: 3, turnoverMin: 3, amountMinYi: 3, capMaxYi: 300, noST: true },
  },
  {
    key: 'steady',
    label: '温和放量',
    hint: '涨 0~5% · 量比 1.5~4 · 额≥5亿',
    cond: { pctMin: 0, pctMax: 5, volRatioMin: 1.5, turnoverMin: 3, amountMinYi: 5, noST: true },
  },
  {
    key: 'hotTurn',
    label: '高换手活跃',
    hint: '换手≥10% · 额≥3亿 · 市值≤500亿',
    cond: { turnoverMin: 10, amountMinYi: 3, capMaxYi: 500, volRatioMin: 1.2, noST: true },
  },
  {
    key: 'wash',
    label: '强势回调(洗盘)',
    hint: '微跌 0~-2% · 量比≥1.2 · 换手≥2%',
    cond: { pctMin: -2, pctMax: 0, volRatioMin: 1.2, turnoverMin: 2, noST: true },
  },
  {
    key: 'blue',
    label: '蓝筹动量',
    hint: '额≥20亿 · 涨≥1% · 市值≥1000亿',
    cond: { pctMin: 1, amountMinYi: 20, capMinYi: 1000, noST: true },
  },
]

export function presetCond(key: string): ScreenCond | null {
  return PRESETS.find((p) => p.key === key)?.cond ?? null
}

// ===== 客户端指标信号（候选 ≤200，kline DAILY 80） =====

export type SignalKind = 'ma_golden' | 'ma60_break'

export interface SignalMeta {
  label: string
  needBars: number
}

export const SIGNAL_META: Record<SignalKind, SignalMeta> = {
  ma_golden: { label: 'MA金叉', needBars: 22 },
  ma60_break: { label: '破MA60', needBars: 62 },
}

function ma(values: number[], k: number): number[] {
  const out: number[] = new Array(values.length).fill(NaN)
  let sum = 0
  for (let i = 0; i < values.length; i++) {
    sum += values[i]
    if (i >= k) sum -= values[i - k]
    if (i >= k - 1) out[i] = sum / k
  }
  return out
}

/** 从升序 DAILY K 线检测信号（近 3 根内成立为 true）。 */
export function detectSignal(rows: McpKlineRow[], kind: SignalKind): boolean {
  if (!rows || rows.length < SIGNAL_META[kind].needBars) return false
  const closes = rows.map((r) => Number(r.close))
  const vols = rows.map((r) => Number(r.vol ?? r.volume ?? 0))
  const n = closes.length
  const win = [n - 3, n - 2, n - 1]

  if (kind === 'ma_golden') {
    const m5 = ma(closes, 5)
    const m20 = ma(closes, 20)
    return win.some((i) => i - 1 >= 19 && m5[i - 1] <= m20[i - 1] && m5[i] > m20[i])
  }

  // ma60_break：近 3 根内收盘上穿 MA60，且当日量 ≥ 前 20 日均量的 1.2 倍（放量破位）。
  const m60 = ma(closes, 60)
  const crossed = win.some((i) => i - 1 >= 59 && closes[i - 1] <= m60[i - 1] && closes[i] > m60[i])
  if (!crossed) return false
  const tail = vols.slice(n - 21, n - 1).filter((v) => Number.isFinite(v) && v > 0)
  const avg20 = tail.length ? tail.reduce((a, b) => a + b, 0) / tail.length : 0
  const lastVol = vols[n - 1]
  return avg20 > 0 && lastVol >= avg20 * 1.2
}

/**
 * 对候选跑信号：逐只拉 kline(DAILY,80) → detectSignal。
 * 返回 symbol(`SH600000`) → 命中信号 的 Map；失败静默跳过（不抛断整体）。
 * 与候选同序的回调 onProgress(完成数, 总数) 供 UI 显示进度。
 */
export async function runSignalOnCandidates(
  cands: { market: 'SH' | 'SZ' | 'BJ'; code: string; name: string }[],
  kind: SignalKind,
  concurrency = 8,
  onProgress?: (done: number, total: number) => void,
): Promise<Set<string>> {
  const hits = new Set<string>()
  let done = 0
  const results = await runPool(
    cands,
    async (c) => {
      try {
        const rows = await fetchKlineRows(c.market, c.code, 'DAILY', 80)
        done++
        onProgress?.(done, cands.length)
        if (detectSignal(rows, kind)) {
          return `${c.market}${c.code}`
        }
        return null
      } catch {
        done++
        onProgress?.(done, cands.length)
        return null
      }
    },
    { concurrency },
  )
  for (const s of results) {
    if (s) hits.add(s)
  }
  return hits
}
