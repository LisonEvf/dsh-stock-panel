/**
 * 涨停梯队 + 板块热度 数据装配（M6）。
 *
 * 流程（全客户端，直连 MCP）：
 *   1. fetchAllA(force)：全 A 快照 → 封涨停池（close ≈ buy_price_limit）与跌停家数
 *   2. 对涨停池每只（并发 ≤6）：
 *        kline(DAILY, 20)  → countStreak 数连板 / 一字板
 *        belong_board      → 所属板块（板块行自带当日涨停数）
 *   3. 聚合：按板数分组 + 板块涨停数排行
 *
 * 涨停/跌停判定均以交易所涨停价字段为准（buy/sell_price_limit），
 * 连板用客户端规则（主板 10% / 创业·科创 20% / 北交 30% / ST 5%，见 lib/indicators.ts）。
 */

import { fetchAllA, type AShareRow } from './market'
import { fetchBelongBoard, fetchKlineRows, type BelongBoardRow } from './stock-data'
import { countStreak } from './indicators'
import { runPool } from './pool'

export interface LadderStock extends AShareRow {
  streak: number
  dates: string[]
  oneWord: boolean
  /** kline 拉取成功才能数连板；失败保留在池中标记待确认。 */
  streakKnown: boolean
}

export interface BoardStat {
  boardSymbol: string
  name: string
  type: string
  /** 板块当日涨停家数（来自 belong_board 的 涨停数 字段，板块级）。 */
  limitUpCount: number
  /** 板块指数当日涨跌幅（%）。 */
  pct: number
  /** 板块内代表股（涨停池中首个属于该板的标的）。 */
  rep: string
  repCode: string
}

export interface LadderSnapshot {
  /** 封涨停池（含连板信息，按板数↓、金额↓排序）。 */
  limitUp: LadderStock[]
  limitDownCount: number
  /** 板块热度 TOP（按涨停数↓）。 */
  boards: BoardStat[]
  fetchedAt: number
}

const LIMIT_EPS = 1e-6

/** 参与热度聚合的板块类型：3=地区, 4=概念, 12=行业（剔除 5 风格/策略类伪板块）。 */
const BOARD_TYPES = new Set(['3', '4', '12'])

export async function loadLadder(signal?: AbortSignal): Promise<LadderSnapshot> {
  const all = await fetchAllA(true)
  const limitUpRaw = all.filter(
    (r) => r.buy_price_limit > 0 && Math.abs(r.close - r.buy_price_limit) < LIMIT_EPS,
  )
  const limitDownCount = all.filter(
    (r) => r.sell_price_limit > 0 && Math.abs(r.close - r.sell_price_limit) < LIMIT_EPS,
  ).length

  const results = await runPool(
    limitUpRaw.slice(0, 80),
    async (r): Promise<{ row: AShareRow; streak: number; dates: string[]; oneWord: boolean; streakKnown: boolean; boards: BelongBoardRow[] }> => {
      // 单个标的失败不丢弃：连板标"待确认"，板块置空，防止涨停池缩水
      let streak = 0
      let dates: string[] = []
      let oneWord = false
      let streakKnown = false
      let boards: BelongBoardRow[] = []
      try {
        const kl = await fetchKlineRows(r.market, r.code, 'DAILY', 20)
        const st = countStreak(kl, r.code, r.name)
        streak = st.streak
        dates = st.dates
        oneWord = st.oneWord
        streakKnown = true
      } catch {
        /* 保持待确认 */
      }
      try {
        boards = (await fetchBelongBoard(r.market, r.code)).filter((b) =>
          BOARD_TYPES.has(String(b.board_type ?? '')),
        )
      } catch {
        /* 板块缺省 */
      }
      return { row: r, streak, dates, oneWord, streakKnown, boards }
    },
    { concurrency: 6, signal },
  )

  const stocks: LadderStock[] = []
  const boardMap = new Map<string, BoardStat>()
  for (const item of results) {
    if (!item) continue
    stocks.push({
      ...item.row,
      streak: item.streak,
      dates: item.dates,
      oneWord: item.oneWord,
      streakKnown: item.streakKnown,
    })
    for (const b of item.boards) {
      const symbol = String(b.board_symbol ?? '').trim()
      if (!symbol) continue
      const count = Number(b['涨停数'] ?? 0) || 0
      const prevClose = Number(b.pre_close ?? 0)
      const close = Number(b.close ?? 0)
      const pct = prevClose > 0 && close > 0 ? ((close - prevClose) / prevClose) * 100 : 0
      const name = String(b.board_symbol_name ?? symbol)
      const existing = boardMap.get(symbol)
      if (!existing) {
        boardMap.set(symbol, {
          boardSymbol: symbol,
          name,
          type: String(b.board_type ?? ''),
          limitUpCount: count,
          pct,
          rep: item.row.name,
          repCode: item.row.code,
        })
      } else {
        existing.limitUpCount = Math.max(existing.limitUpCount, count)
      }
    }
  }

  // 连板数已知的在前；未知（数据待确认）沉底
  stocks.sort(
    (a, b) =>
      Number(b.streakKnown) - Number(a.streakKnown) ||
      b.streak - a.streak ||
      b.amount - a.amount,
  )
  const boards = [...boardMap.values()]
    .sort((a, b) => b.limitUpCount - a.limitUpCount || Math.abs(b.pct) - Math.abs(a.pct))
    .slice(0, 12)

  return { limitUp: stocks, limitDownCount, boards, fetchedAt: Date.now() }
}

/** 板块类型标签（TDX board_type）。 */
export function boardTypeLabel(type: string): string {
  switch (type) {
    case '3':
      return '地区'
    case '4':
      return '概念'
    case '5':
      return '风格'
    case '12':
      return '行业'
    default:
      return type || ''
  }
}
