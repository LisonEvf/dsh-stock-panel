/**
 * src/host/naming/collect.ts —— 命名素材采集（A2b-②，移植自 `cluster-namer/news/opentdx_zt.py` 的适配器部分）。
 *
 * ⚠️ **本批最重要的诚实性问题：哪些素材能代表 as_of 当天。**
 * 本站数据层（node-tdx）里三类素材的"时间性"完全不同：
 *
 *   | 素材 | 时间性 | 能否用于历史 as_of |
 *   | --- | --- | --- |
 *   | 异动 / 主力监控（`unusual` / `market_monitor`） | **当日实时列表**，无历史接口 | ❌ 不能 |
 *   | 所属板块（`belong_board`） | **当前快照**（分类学，变化慢） | 🟡 可用但须标注"非历史回放" |
 *   | 封板状态（由 `kline` 推导） | **历史可回放**（日K 带日期） | ✅ 完全可用 |
 *
 * 参考实现从快照目录读历史 parquet，所以它没有这个问题；我们**必须**自己交代清楚：
 * 把今天的异动贴到一个 3 天前的类上，等于凭空造出一份"当天证据"——那正是护栏要防的事。
 * 因此：只有当 `asOf === 当前交易日` 时才采异动/监控，否则记入 `missingSources` 并在
 * `notes` 里写明原因（UI 会把 `missingSources` 展示给用户）。
 *
 * 采集依赖以参数注入（`callTool`），因此本模块可以在**离线单测**里用假数据跑全链路。
 */
import { countStreak, isOneWordLimitUp, type CandleLike } from '../../lib/indicators'
import {
  applyQuota,
  boardsToMaterials,
  dedupMaterials,
  limitUpTypeToMaterial,
  splitBoards,
  truncateMaterials,
  unusualToMaterial,
  type BelongBoardRow,
  type UnusualRow,
} from './materials'
import { memberLabel, type MaterialCorpus, type MaterialItem, type NamingMember } from './types'

/** 采集依赖。 */
export interface CollectDeps {
  /** 工具调用（默认接内置 TDX；单测可传假实现）。 */
  callTool: (name: string, args: Record<string, unknown>) => Promise<unknown>
  /** 当前交易日（`server_info.today` 口径的 YYYY-MM-DD）；undefined = 未知（保守：不采实时源）。 */
  today?: string | undefined
}

export interface CollectArgs {
  /** 类的 as_of（历史回放判断题）。 */
  asOf: string
  members: NamingMember[]
  windowDays: number
  /** 每市场拉多少条异动/监控（市场级列表，再按成员过滤）。 */
  marketListCount?: number
  /** 并发上限（内置 TDX 是串行队列，这里的并发只影响编排，不会真并行发包）。 */
  concurrency?: number
}

export interface CollectResult {
  corpus: MaterialCorpus
  /** 实际采到的源名（用于 UI 说明"这个名字是从哪些材料里归纳的"）。 */
  sourcesUsed: string[]
  /** 人类可读的采集说明（含口径偏差，必须如实上报）。 */
  notes: string[]
}

/** 素材源标识（进指纹，所以必须是稳定常量）。 */
export const SOURCE_UNUSUAL = 'unusual'
export const SOURCE_MONITOR = 'market_monitor'
export const SOURCE_BOARD = 'belong_board'
export const SOURCE_KLINE = 'kline'

/** 默认采集配置（可配，不是"真理"）。 */
export const DEFAULT_COLLECT = {
  marketListCount: 200,
  perStockQuota: 3,
  maxChars: 4000,
  dedupThreshold: 0.9,
  klineBars: 20,
} as const

/** 封板状态文案（由日K推导，替代参考实现的 ChangeUpType 字段）。 */
export function limitUpTypeOf(rows: CandleLike[], code: string, name: string): string {
  if (rows.length < 2) return ''
  const st = countStreak(rows, code, name)
  if (st.streak <= 0) return ''
  const last = rows[rows.length - 1]
  const prev = rows[rows.length - 2]
  const oneWord = isOneWordLimitUp(prev.close, last.open, last.close, code, name)
  // 首板不再重复写"1连板"（读起来像两件事）
  const head = st.streak === 1 ? '首板' : `${st.streak}连板`
  return `${head}·${oneWord ? '一字板' : '换手板'}`
}

/** 把内置工具返回的日K行归一成 `CandleLike`（host 半不能 import 浏览器侧 stock-data）。 */
export function toCandles(rows: unknown): CandleLike[] {
  if (!Array.isArray(rows)) return []
  const out: CandleLike[] = []
  for (const r of rows) {
    // 数组里可能有 null / 非对象（工具输出不保证）——直接跳过，不让它把整类采集打断
    if (r === null || typeof r !== 'object') continue
    const row = r as Record<string, unknown>
    const dateRaw = row.date ?? row.datetime ?? row.time
    const open = Number(row.open)
    const close = Number(row.close)
    const high = Number(row.high)
    const low = Number(row.low)
    if (!dateRaw || !Number.isFinite(close)) continue
    out.push({
      date: String(dateRaw).slice(0, 10),
      open: Number.isFinite(open) ? open : close,
      high: Number.isFinite(high) ? high : close,
      low: Number.isFinite(low) ? low : close,
      close,
      ...(Number.isFinite(Number(row.volume)) ? { volume: Number(row.volume) } : {}),
    } as CandleLike)
  }
  return out.sort((a, b) => String(a.date).localeCompare(String(b.date)))
}

/** 市场级实时列表（异动/监控）→ 只保留属于本类成员的行。 */
export function filterMarketRows(rows: unknown, memberCodes: Set<string>): UnusualRow[] {
  if (!Array.isArray(rows)) return []
  const out: UnusualRow[] = []
  for (const r of rows) {
    const row = r as UnusualRow
    const code = String(row.code ?? '').trim()
    if (!code || !memberCodes.has(code)) continue
    out.push(row)
  }
  return out
}

/** 按市场分组（实时列表是按市场拉的，成员可能跨沪深）。 */
export function marketsOf(members: NamingMember[]): Array<'SH' | 'SZ' | 'BJ'> {
  const set = new Set(members.map((m) => m.market))
  return [...set]
}

/**
 * 采集一个类的命名素材。
 *
 * 单票失败不影响整类（记入 `failedStocks`）；整源失败记入 `missingSources`。
 * 采集本身**不发 LLM 请求**，因此可以放心重试。
 */
export async function collectMaterials(deps: CollectDeps, args: CollectArgs): Promise<CollectResult> {
  const cfg = DEFAULT_COLLECT
  const notes: string[] = []
  const items: MaterialItem[] = []
  const missingSources = new Set<string>()
  const failedStocks = new Set<string>()
  const sourcesUsed = new Set<string>()
  const codes = new Set(args.members.map((m) => m.code))
  const byCode = new Map(args.members.map((m) => [m.code, m]))

  // ---- 1) 实时源：仅当 as_of 就是当前交易日 ----
  const realtimeOk = deps.today !== undefined && deps.today === args.asOf
  if (!realtimeOk) {
    missingSources.add(SOURCE_UNUSUAL)
    missingSources.add(SOURCE_MONITOR)
    notes.push(
      deps.today === undefined
        ? `实时源不可用（未知当前交易日）：as_of=${args.asOf} 的异动/监控无法采信，本次只用可回放的日K与板块归属`
        : `as_of=${args.asOf} 不是当前交易日（${deps.today}）：异动/监控只能取当日实时列表，**不做历史回放**，本次不采`,
    )
  } else {
    for (const source of [SOURCE_UNUSUAL, SOURCE_MONITOR] as const) {
      for (const market of marketsOf(args.members)) {
        try {
          const rows = await deps.callTool(source, { market, count: cfg.marketListCount })
          const hit = filterMarketRows(rows, codes)
          for (const row of hit) {
            const m = byCode.get(String(row.code))
            if (!m) continue
            const material = unusualToMaterial(row, memberLabel(m), `${m.market}${m.code}`, args.asOf, source)
            if (material) items.push(material)
          }
          if (hit.length > 0) sourcesUsed.add(source)
        } catch (err) {
          missingSources.add(source)
          notes.push(`${source}(${market}) 采集失败：${(err as Error)?.message ?? String(err)}`)
        }
      }
    }
  }

  // ---- 2) 板块归属（当前快照：可用但必须标注）----
  let boardOk = 0
  let boardTotal = 0
  for (const m of args.members) {
    boardTotal += 1
    const key = `${m.market}${m.code}`
    try {
      const raw = await deps.callTool('belong_board', { market: m.market, code: m.code })
      const rows = (Array.isArray(raw) ? raw : []) as BelongBoardRow[]
      const boards = splitBoards(rows)
      const mats = boardsToMaterials(memberLabel(m), key, args.asOf, boards, SOURCE_BOARD)
      if (mats.length > 0) {
        items.push(...mats)
        boardOk += 1
        sourcesUsed.add(SOURCE_BOARD)
      }
    } catch (err) {
      failedStocks.add(key)
      notes.push(`belong_board(${key}) 采集失败：${(err as Error)?.message ?? String(err)}`)
    }
  }
  if (boardOk < boardTotal) {
    missingSources.add(SOURCE_BOARD)
  }
  if (boardOk > 0 && !realtimeOk) {
    notes.push(`板块归属取自**当前快照**（分类学变化慢），不是 ${args.asOf} 当天的历史快照 —— 已在结果里标注`)
  }

  // ---- 3) 封板状态（由日K推导，历史可回放）----
  for (const m of args.members) {
    const key = `${m.market}${m.code}`
    try {
      const rows = await deps.callTool('kline', {
        market: m.market,
        code: m.code,
        period: 'DAILY',
        count: cfg.klineBars,
        adjust: 'QFQ',
      })
      const candles = toCandles(rows)
      const upType = limitUpTypeOf(candles, m.code, m.name)
      const material = limitUpTypeToMaterial(memberLabel(m), key, args.asOf, upType, SOURCE_KLINE)
      if (material) {
        items.push(material)
        sourcesUsed.add(SOURCE_KLINE)
      }
    } catch (err) {
      failedStocks.add(key)
      notes.push(`kline(${key}) 采集失败：${(err as Error)?.message ?? String(err)}`)
    }
  }
  if (!sourcesUsed.has(SOURCE_KLINE)) missingSources.add(SOURCE_KLINE)

  // ---- 4) 归一：去重 → 配额 → 截断 ----
  const deduped = dedupMaterials(items, cfg.dedupThreshold)
  const quota = applyQuota(deduped, cfg.perStockQuota)
  const kept = truncateMaterials(quota, cfg.maxChars)
  if (kept.length < quota.length) {
    notes.push(`素材超出字符预算 ${cfg.maxChars}：按时间倒序保留最新 ${kept.length}/${quota.length} 条`)
  }
  notes.push(`素材 ${kept.length} 条（来源：${[...sourcesUsed].join('、') || '无'}）`)

  return {
    corpus: {
      items: kept,
      missingSources: [...missingSources].sort(),
      failedStocks: [...failedStocks].sort(),
    },
    sourcesUsed: [...sourcesUsed].sort(),
    notes,
  }
}

/** 采集说明（供 UI/诊断显示）。 */
export function collectSummary(result: CollectResult, asOf: string, today?: string): string {
  const when = today === asOf ? `as_of=${asOf}（= 当前交易日）` : `as_of=${asOf}（≠ 当前交易日 ${today ?? '未知'}）`
  return `${when} · ${result.corpus.items.length} 条素材 · 缺失源 ${result.corpus.missingSources.join('、') || '无'}`
}
