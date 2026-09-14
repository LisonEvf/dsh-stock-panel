/**
 * src/lib/war-plan-collect.ts —— 作战思路的**素材采集**（"其他板块 → 作战板块"的取数口）。
 *
 * 与 `lib/war-plan.ts` 的分工：`war-plan.ts` 负责**组装**（纯函数）、**存档**与**采纳**；
 * 本文件只负责**把别处的数据取回来**（含两次网络往返），两组职责分开写是为了让
 * 组装那一半可以在 Node 单测里干净地跑（不需要网络/浏览器）。
 *
 * ## 素材来自哪几个板块（每一项都有出处，缺了就如实记进 `missing`）
 *
 *   · **行情**：广度 / 温度计 / 板块榜 / 涨停梯队（调用方已取好，直接传进来）；
 *   · **选股筛选**：同一份全 A 快照上跑本仓既有的预设策略（`lib/screener` 的「放量上攻」），
 *     **零额外请求** —— 快照本来就在手上（涨停梯队之外还有一批"没涨停但在放量"的票，
 *     只给涨停梯队等于让模型只看得到封板的）；
 *   · **自挖板块**：`hist_concept_classes`（引擎快照，服务端已缓存）→ 过弱链筛选 → 按强度取前几类。
 *     ⚠️ 在这里**不给类起名**（命名是自挖板块页的模型调用，作战页不偷花那笔预算）；
 *     类的作用是把"哪一批票在共动"作为证据交给模型；
 *   · **复盘**：最近一份存档的预期清单 / 主线 / 雷区备注；
 *   · **竞价**：竞价时段逐票拉 `auction` 特征 + 系统初判（与竞价雷达同一个 `analyzeAuction`/`judgeExpectation`）；
 *   · **持仓 / 自选**：本地台账直接给。
 *
 * ## 预算
 *
 * 一次采集 = 1 次 `hist_concept_classes`（引擎缓存命中即近零成本）+ 竞价时段 ≤8 次
 * `quote`/`auction`。**只在生成思路时跑一次**（页面打开 / 时段切换 / 手动重算），
 * 不进 30s 轮询 —— 与 `docs/ARCHITECTURE.md` 的请求预算纪律一致。
 */
import { fetchQuote, callToolJson } from './stock-data'
import { analyzeAuction, judgeExpectation, type AuctionPoint, type Verdict } from './auction-analysis'
import { fetchConceptClasses, NAMING_PARAMS_FALLBACK } from './naming'
import { runPool } from './pool'
import { getLatestPlan } from './review-store'
import { presetCond, screenRows } from './screener'
import { MATERIAL_CAPS, prepareConcepts, type WarAuctionRow, type WarMaterials } from './war-plan'
import type { AShareRow } from './stock-data'
import type { Breadth } from './market'
import type { Regime } from './regime'
import type { Situation } from './situation'
import type { LadderSnapshot } from './ladder'
import type { EventItem } from './event-stream'
import type { BoardPulse } from './board-pulse'
import type { Position } from './positions'
import type { WatchItem } from './watchlist-store'
import type { ExpectItem } from './review-store'
import type { SessionPhase } from './session-clock'
import type { Stage } from './stage'
import type { MarketTag } from './symbol'

/** 采集输入（内存里已有的那些 + 采集参数）。 */
export interface WarCollectInput {
  day: string
  stage: Stage
  phase: SessionPhase
  clockText: string
  windowNote: string
  breadth: Breadth | null
  regime: Regime | null
  situation: Situation | null
  ladder: LadderSnapshot | null
  events: EventItem[]
  pulses: BoardPulse[]
  positions: Position[]
  watchlist: WatchItem[]
  /** 全 A 快照（行情页同源；用于"放量上攻"候选，缺省 = 不参与）。 */
  allRows: AShareRow[] | null
  signal?: AbortSignal
}

/** 选股候选（来自「放量上攻」预设：非涨停但在放量的那批）。 */
export function screenerCandidates(rows: AShareRow[] | null, limit = MATERIAL_CAPS.screener): AShareRow[] {
  if (rows === null || rows.length === 0) return []
  const cond = presetCond('surge')
  if (cond === null) return []
  return screenRows(rows, cond)
    .sort((a, b) => (b.amount ?? 0) - (a.amount ?? 0))
    .slice(0, limit)
}

/** 竞价要看的标的（预期清单优先 → 自选补位；去重，上限 {@link MATERIAL_CAPS.auction}）。 */
export function auctionTargets(
  expectations: ExpectItem[],
  watchlist: WatchItem[],
): Array<{ symbol: string; market: MarketTag; code: string; name: string; expectState?: ExpectItem['state'] }> {
  const out: Array<{ symbol: string; market: MarketTag; code: string; name: string; expectState?: ExpectItem['state'] }> = []
  const seen = new Set<string>()
  for (const e of expectations) {
    const market = e.symbol.slice(0, 2) as MarketTag
    const code = e.symbol.slice(2)
    if (seen.has(e.symbol)) continue
    seen.add(e.symbol)
    out.push({ symbol: e.symbol, market, code, name: e.name, expectState: e.state })
  }
  for (const w of watchlist) {
    const symbol = `${w.market}${w.code}`
    if (seen.has(symbol)) continue
    seen.add(symbol)
    out.push({ symbol, market: w.market, code: w.code, name: w.name })
  }
  return out.slice(0, MATERIAL_CAPS.auction)
}

/** 竞价逐票取数（与竞价雷达同一套特征化与初判）。 */
async function collectAuctions(
  targets: ReturnType<typeof auctionTargets>,
  signal?: AbortSignal,
): Promise<{ rows: WarAuctionRow[]; missing: string[] }> {
  if (targets.length === 0) return { rows: [], missing: [] }
  let noData = 0
  const rows = await runPool<(typeof targets)[number], WarAuctionRow | null>(
    targets,
    async (t): Promise<WarAuctionRow | null> => {
      if (signal?.aborted === true) return null
      try {
        const q = await fetchQuote(t.market, t.code)
        if (q === null) {
          noData += 1
          return null
        }
        const data = (await callToolJson('auction', { market: t.market, code: t.code })) as unknown
        const points: AuctionPoint[] = Array.isArray(data)
          ? (data as AuctionPoint[])
          : Array.isArray((data as { items?: unknown } | null)?.items)
            ? ((data as { items: AuctionPoint[] }).items)
            : []
        if (points.length === 0) {
          noData += 1
          return null
        }
        const a = analyzeAuction(points, Number(q.pre_close), Number(q.buy_price_limit))
        if (a === null) {
          noData += 1
          return null
        }
        const auto: Verdict | undefined = t.expectState === undefined ? undefined : judgeExpectation(t.expectState, a)
        return {
          symbol: t.symbol,
          name: t.name,
          openPct: a.openPct,
          climaxDir: a.climaxDir,
          nearLimit: a.nearLimit,
          fakeBigThenDrop: a.fakeBigThenDrop,
          ...(t.expectState !== undefined ? { expectState: t.expectState } : {}),
          ...(auto !== undefined ? { autoVerdict: auto } : {}),
        }
      } catch {
        noData += 1
        return null
      }
    },
    { concurrency: 4, ...(signal !== undefined ? { signal } : {}) },
  )
  const ok = rows.filter((r): r is WarAuctionRow => r !== null)
  const missing = noData > 0 ? [`竞价：${noData}/${targets.length} 只取不到逐点数据（未到 9:15 或该票当日无竞价）`] : []
  return { rows: ok, missing }
}

/** 采集一次作战思路的全部素材（失败只记录缺口，绝不抛给调用方）。 */
export async function collectWarMaterials(input: WarCollectInput): Promise<WarMaterials> {
  const missing: string[] = []

  // ① 自挖板块（引擎快照；不可用/超时都不算失败，只是"模型看不到这块"）
  let concepts: WarMaterials['concepts'] = null
  let conceptsNote = ''
  let isolatedTop: WarMaterials['isolatedTop'] = []
  try {
    const payload = await fetchConceptClasses(NAMING_PARAMS_FALLBACK, 5)
    const prepared = prepareConcepts(payload)
    concepts = prepared.rows
    conceptsNote = prepared.note
    if (!payload.ok) missing.push(`自挖板块：${payload.notes.join('；') || '引擎未返回'}`)
    isolatedTop = payload.isolatedTop.slice(0, MATERIAL_CAPS.isolated).map((s) => ({
      symbol: `${s.market}${s.code}`,
      name: s.name,
      chgPct: s.chgPct,
      limitUp: s.limitUp,
    }))
  } catch (e) {
    conceptsNote =  '自挖板块引擎取数失败'
    missing.push(`自挖板块：${(e as Error)?.message ?? String(e)}`)
  }

  // ② 选股筛选（同一份全 A 快照上跑预设，零额外请求）
  const screened = screenerCandidates(input.allRows)
  if (input.allRows === null) missing.push('选股筛选：全 A 快照本轮未取到')
  else if (screened.length === 0) missing.push('选股筛选：预设「放量上攻」本轮无命中')

  // ③ 行情
  if (input.breadth === null) missing.push('行情：广度/温度计取数失败')
  if (input.ladder === null) missing.push('行情：涨停梯队取数失败（方向名池会随之变空）')
  if (input.events.length === 0) missing.push('事件流：本时段没有增量（非交易时段属正常）')

  // ④ 复盘存档
  let myPlan: WarMaterials['myPlan'] = null
  try {
    const prev = getLatestPlan(input.day)
    if (prev !== null) {
      myPlan = {
        day: prev.day,
        expectations: prev.expectations,
        mainLine: prev.mainLine.map((l) => (l.leader === null ? l.board : `${l.board}（${l.leader}）`)),
        riskNote: prev.riskNote ?? '',
      }
    } else {
      missing.push('复盘：还没有可引用的复盘存档（没有预期清单 → 竞价没有对照基准）')
    }
  } catch {
    missing.push('复盘：存档读取失败')
  }

  // ⑤ 竞价（只有竞价/盘前时段值得取：其它时段竞价早就定格了）
  const auctionPhase = input.phase === 'auction' || input.phase === 'premarket'
  const targets = auctionPhase ? auctionTargets(myPlan?.expectations ?? [], input.watchlist) : []
  const auctions = auctionPhase ? await collectAuctions(targets, input.signal) : { rows: [], missing: [] }
  missing.push(...auctions.missing)

  return {
    day: input.day,
    stage: input.stage,
    phase: input.phase,
    clockText: input.clockText,
    windowNote: input.windowNote,
    breadth: input.breadth,
    regime: input.regime,
    situation: input.situation,
    ladder: input.ladder,
    events: input.events,
    pulses: input.pulses,
    concepts,
    conceptsNote,
    isolatedTop,
    screened,
    positions: input.positions,
    watchlist: input.watchlist,
    myPlan,
    auctions: auctions.rows,
    missing,
  }
}
