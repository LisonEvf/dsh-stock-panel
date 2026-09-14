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
  boardContractDrift,
  boardsToMaterials,
  dedupMaterials,
  limitUpTypeToMaterial,
  splitBoards,
  truncateMaterials,
  unusualToMaterial,
  type BelongBoardRow,
  type UnusualRow,
} from './materials'
import { memberLabel, missingSourcesOf, windowStart, type MaterialCorpus, type MaterialItem, type NamingMember, type SourceReport } from './types'
import { sourceStatusLine } from './cause'
import {
  buildMemberIndex,
  classifyFlash,
  DEFAULT_NEWS,
  fetchNewsFlashes,
  flashDate,
  flashToMaterials,
  SOURCE_NEWS,
  type NewsFetchDeps,
} from './news'

/** 采集依赖。 */
export interface CollectDeps {
  /** 工具调用（默认接内置 TDX；单测可传假实现）。 */
  callTool: (name: string, args: Record<string, unknown>) => Promise<unknown>
  /** 当前交易日（`server_info.today` 口径的 YYYY-MM-DD）；undefined = 未知（保守：不采实时源）。 */
  today?: string | undefined
  /**
   * 板块级快讯源依赖（见 `news.ts`）。
   *
   *   · 不传 = 生产默认（用全局 fetch）；
   *   · `false` = 显式关闭（**离线单测/冒烟必须传它** —— 否则测试会真的发 HTTP，
   *     那既慢又让测试依赖外部网络；这是"依赖注入"在这里存在的全部意义）。
   */
  news?: NewsFetchDeps | false | undefined
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
  /**
   * 语料字符预算（默认 `DEFAULT_COLLECT.maxChars`）。
   *
   * 只有**批量命名**会传它：批量是"多组合并采一次"，沿用单类的 4000 字会把后面的组
   * 整组截断（按时间倒序保留最新 → 先保住最早的组、后几组直接没素材）。
   * 单类路径永远用默认值，口径不变。
   */
  maxChars?: number
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
  /** 快讯翻页上限（实测 24 页 ≈ 40 小时 ≈ 覆盖上一个交易日的完整交易时段）。 */
  newsPages: DEFAULT_NEWS.pages,
} as const

/**
 * 快讯源开关（`DSH_STOCK_PANEL_NEWS=0` 关闭）。
 *
 * 为什么给一个开关：这是本站**唯一会出网到非通达信**的素材源。行情链路是自足的
 * （内置 TDX + 零外部进程），而快讯走 HTTPS —— 在没有外网的环境里必须能一键关掉，
 * 且关掉后**如实记为"按设计跳过"**，不是静默不采（否则又回到"缺失源"归因错误那口坑）。
 */
function newsDisabledByEnv(): boolean {
  const v = process.env.DSH_STOCK_PANEL_NEWS
  return typeof v === 'string' && (v === '0' || v.toLowerCase() === 'false' || v.toLowerCase() === 'off')
}

/**
 * 快讯源是否启用（供 route 的 GET 口径与采集共用同一判据）。
 *
 * 单开一个导出而不是让路由自己读环境变量：口径必须**只有一处**——
 * 否则"界面说开着、采集却跳过了"这种不一致没有任何报错，只能靠人发现。
 */
export function newsSourceEnabled(): boolean {
  return !newsDisabledByEnv()
}

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
  const failedStocks = new Set<string>()
  /** 逐源状态（唯一真源：UI 成因、护栏定档都从这里来）。 */
  const sources: SourceReport[] = []
  const codes = new Set(args.members.map((m) => m.code))
  const byCode = new Map(args.members.map((m) => [m.code, m]))

  // ---- 1) 实时源：仅当 as_of 就是当前交易日 ----
  const realtimeOk = deps.today !== undefined && deps.today === args.asOf
  if (!realtimeOk) {
    const why =
      deps.today === undefined
        ? '当前交易日未知（server_info 未取到）'
        : `as_of=${args.asOf} ≠ 当前交易日 ${deps.today}`
    for (const source of [SOURCE_UNUSUAL, SOURCE_MONITOR] as const) {
      sources.push({
        source,
        status: 'skipped_by_design',
        produced: 0,
        detail: `${why}：该源只有"当日实时列表"、没有历史接口，本次不采（不做历史回放）`,
      })
    }
    notes.push(
      `${why}：异动/主力监控只有"当日实时列表"、没有历史接口 → **不做历史回放**，本次按设计跳过（把今天的异动贴到别的日期的类上等于凭空造证据）`,
    )
  } else {
    for (const source of [SOURCE_UNUSUAL, SOURCE_MONITOR] as const) {
      let produced = 0
      let failedMarkets = 0
      let lastErr = ''
      for (const market of marketsOf(args.members)) {
        try {
          const rows = await deps.callTool(source, { market, count: cfg.marketListCount })
          const hit = filterMarketRows(rows, codes)
          for (const row of hit) {
            const m = byCode.get(String(row.code))
            if (!m) continue
            const material = unusualToMaterial(row, memberLabel(m), `${m.market}${m.code}`, args.asOf, source)
            if (material) {
              items.push(material)
              produced += 1
            }
          }
        } catch (err) {
          failedMarkets += 1
          lastErr = (err as Error)?.message ?? String(err)
          notes.push(`${source}(${market}) 采集失败：${lastErr}`)
        }
      }
      const detail =
        failedMarkets > 0 && produced === 0
          ? `调用失败（${failedMarkets} 个市场）：${lastErr}`
          : failedMarkets > 0
            ? `${produced} 条命中；另有 ${failedMarkets} 个市场采集失败：${lastErr}`
            : produced > 0
              ? `当日实时列表命中本组成员 ${produced} 条`
              : '当日实时列表里没有本组成员的记录（无数据 ≠ 失败）'
      sources.push({
        source,
        status: failedMarkets > 0 && produced === 0 ? 'failed' : produced > 0 ? 'used' : 'no_material',
        produced,
        detail,
      })
    }
  }

  // ---- 2) 板块归属（当前快照：可用但必须标注）----
  let boardOk = 0
  let boardFailed = 0
  let lastBoardErr = ''
  /**
   * 「接口返回了行、但一行都没解析出板块」的票数（去重前）。
   *
   * 为什么要单独数：这正是 2026-09-14 那个字段名 bug 的形状 —— 接口好、数据有，
   * 只是本地把字段名读成了另一个（`board_name` vs 真字段 `board_symbol_name`），
   * 于是产出恒为 0，而当时的归因文案把它写成「板块归属都未产出可引用板块（非失败）」：
   * 读起来像"市场事实"，实际是**本地契约漂移**。两者必须分开报，
   * 否则下一个同类 bug 还是会伪装成"没有素材"骗过所有人（含模型）。
   */
  let boardDriftReason = ''
  for (const m of args.members) {
    const key = `${m.market}${m.code}`
    try {
      const raw = await deps.callTool('belong_board', { market: m.market, code: m.code })
      const rows = (Array.isArray(raw) ? raw : []) as BelongBoardRow[]
      const boards = splitBoards(rows)
      const mats = boardsToMaterials(memberLabel(m), key, args.asOf, boards, SOURCE_BOARD)
      if (mats.length > 0) {
        items.push(...mats)
        boardOk += 1
      } else if (boardDriftReason === '') {
        // 只在**确实漂移**时记（"这只票只有地区/风格板块"是正常情况，见 boardContractDrift）
        boardDriftReason = boardContractDrift(rows)
      }
    } catch (err) {
      boardFailed += 1
      lastBoardErr = (err as Error)?.message ?? String(err)
      failedStocks.add(key)
      notes.push(`belong_board(${key}) 采集失败：${lastBoardErr}`)
    }
  }
  const boardDrift = boardDriftReason !== '' && boardOk === 0
  if (boardDrift) {
    notes.push(
      `belong_board 契约漂移：${boardDriftReason} —— 这是**本地字段/类型码取错**，不是"没有板块归属"；`
      + '请核对 materials.ts 的 boardNameOf/boardTypeLabel 与 lib/stock-data.ts 的 BelongBoardRow',
    )
  }
  sources.push({
    source: SOURCE_BOARD,
    status: boardFailed > 0 && boardOk === 0 ? 'failed' : boardDrift ? 'failed' : boardOk > 0 ? 'used' : 'no_material',
    produced: boardOk,
    detail:
      boardOk > 0
        ? `${boardOk}/${args.members.length} 只票产出板块归属${realtimeOk ? '' : '（当前快照，非当日历史快照）'}`
        : boardDrift
          ? `契约漂移（不是"没有板块"）：${boardDriftReason}`
          : boardFailed > 0
            ? `${boardFailed} 只票调用失败：${lastBoardErr}`
            : `${args.members.length} 只票的板块归属都未产出可引用板块（非失败）`,
  })
  if (boardOk > 0 && !realtimeOk) {
    notes.push(`板块归属取自**当前快照**（分类学变化慢），不是 ${args.asOf} 当天的历史快照 —— 已在结果里标注`)
  }

  // ---- 3) 封板状态（由日K推导，历史可回放）----
  let klineOk = 0
  let klineFailed = 0
  let lastKlineErr = ''
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
        klineOk += 1
      }
    } catch (err) {
      klineFailed += 1
      lastKlineErr = (err as Error)?.message ?? String(err)
      failedStocks.add(key)
      notes.push(`kline(${key}) 采集失败：${lastKlineErr}`)
    }
  }
  sources.push({
    source: SOURCE_KLINE,
    status: klineFailed > 0 && klineOk === 0 ? 'failed' : klineOk > 0 ? 'used' : 'no_material',
    produced: klineOk,
    detail:
      klineOk > 0
        ? `${klineOk}/${args.members.length} 只票窗口内封板（首板/连板/一字）`
        : klineFailed > 0
          ? `${klineFailed} 只票取日K失败：${lastKlineErr}`
          : `窗口内这 ${args.members.length} 只票都没有封板（日K 因此不产出封板素材）—— 这是市场事实，不是采集失败`,
  })

  // ---- 4) 板块级快讯（本站唯一的非 TDX 素材源；时间性口径见 `news.ts` 头部）----
  //
  // 与异动/监控的**关键差别**：那两类只有"当前这一份"列表，翻页也翻不出过去 → 只能按设计跳过；
  // 快讯每条带**真实时间戳**且能翻页回放（实测 30 页 ≈ 50.8 小时，上一个交易日的完整交易时段
  // 落在第 17–23 页）。所以判据不是"as_of 是不是今天"，而是
  // 「**请求的时间窗落不落在可回溯范围内**」—— 落得进就采（历史 as_of 也成立，因为
  // 正文时间戳就是当天的），落不进才如实记 `skipped_by_design`。
  const winStart = windowStart({ end: args.asOf, days: args.windowDays })
  if (deps.news === false || newsDisabledByEnv()) {
    sources.push({
      source: SOURCE_NEWS,
      status: 'skipped_by_design',
      produced: 0,
      detail:
        deps.news === false
          ? '快讯源被调用方显式关闭（离线测试/冒烟）'
          : '快讯源被环境变量 DSH_STOCK_PANEL_NEWS 关闭',
    })
  } else {
    const newsDeps: NewsFetchDeps = { pages: cfg.newsPages, ...(deps.news ?? {}) }
    const fetched = await fetchNewsFlashes(newsDeps, winStart)
    const dates = fetched.items.map((f) => flashDate(f.ts)).filter((d) => d !== '').sort()
    const reachStart = dates[0] ?? ''
    const reachEnd = dates[dates.length - 1] ?? ''
    if (fetched.pagesFetched === 0) {
      sources.push({
        source: SOURCE_NEWS,
        status: 'failed',
        produced: 0,
        detail: `抓取失败（${fetched.failedPages} 页）：${fetched.lastError || '未知错误'}`,
      })
      notes.push(`快讯源抓取失败：${fetched.lastError || '未知错误'}（该源失败不影响其余素材）`)
    } else if (reachStart === '' || reachStart > args.asOf) {
      // 可回溯范围整体晚于窗口 → 这个 as_of 采不到。**必须与"市场没有这事"区分开**
      sources.push({
        source: SOURCE_NEWS,
        status: 'skipped_by_design',
        produced: 0,
        detail:
          `快讯只有滚动最新列表（无历史接口），本次最早只取到 ${reachStart || '无'}，`
          + `晚于 as_of=${args.asOf} —— 超出可回溯范围，不做历史回放`,
      })
      notes.push(
        `快讯源超出可回溯范围：最早取到 ${reachStart || '无'}，而时间窗是 ${winStart} ~ ${args.asOf}`
        + '（按日存档见 CHANGELOG「仍未做」；这一条是数据边界，不是失败）',
      )
    } else {
      const inWindow = fetched.items.filter((f) => {
        const d = flashDate(f.ts)
        return d !== '' && d >= winStart && d <= args.asOf
      })
      const index = buildMemberIndex(args.members)
      let announceN = 0
      let anchorN = 0
      let digestN = 0
      for (const flash of inWindow) {
        const c = classifyFlash(flash, index)
        if (c.level === 'none') continue
        if (c.level === 'digest') {
          digestN += 1
          continue
        }
        if (c.level === 'announce') announceN += 1
        else anchorN += 1
        items.push(...flashToMaterials(flash, c.hits))
      }
      const hitN = announceN + anchorN
      const reach = `可回溯 ${reachStart} ~ ${reachEnd}`
      sources.push({
        source: SOURCE_NEWS,
        status: hitN > 0 ? 'used' : 'no_material',
        produced: hitN,
        detail:
          hitN > 0
            ? `时间窗内 ${inWindow.length} 条快讯（${reach}）：点名本组成员 ${hitN} 条（含事件词 ${announceN} 条）；`
              + `另剔除盘面派生汇总 ${digestN} 条`
            : `时间窗内 ${inWindow.length} 条快讯（${reach}），但没有一条点名本组成员`
              + `${digestN > 0 ? `（另有 ${digestN} 条盘面派生汇总已剔除）` : ''} —— 这是市场事实，不是采集失败`,
      })
      const capped = fetched.stopReason === 'page_cap' && reachStart > winStart
      notes.push(
        `快讯：窗口内 ${inWindow.length} 条 → 进语料 ${hitN} 条（事件 ${announceN} / 点名 ${anchorN}），`
        + `剔除盘面派生汇总 ${digestN} 条`
        + (capped ? `；**覆盖不完整**（翻到 ${fetched.pagesFetched} 页上限，最早仅到 ${reachStart}，窗口起点是 ${winStart}）` : ''),
      )
      if (capped) {
        notes.push('快讯源翻页有上限、且接口无历史查询：更早的日期要靠按日存档（本批未做）—— 不归档则超窗即不可回放')
      }
      if (fetched.failedPages > 0) {
        notes.push(`快讯源有 ${fetched.failedPages} 页抓取失败：${fetched.lastError}（已取到的页面照常使用）`)
      }
    }
  }

  // ---- 5) 归一：去重 → 配额 → 截断 ----
  const deduped = dedupMaterials(items, cfg.dedupThreshold)
  const quota = applyQuota(deduped, cfg.perStockQuota)
  const budget = args.maxChars ?? cfg.maxChars
  const kept = truncateMaterials(quota, budget)
  if (kept.length < quota.length) {
    notes.push(`素材超出字符预算 ${budget}：按时间倒序保留最新 ${kept.length}/${quota.length} 条`)
  }
  // 截断后逐源重新计数：`produced` 必须反映**真正进了语料**的条数（否则 UI 里的
  // "已采用 N 条"与 `items` 对不上，又是一种静默不一致）。
  const keptBySource = new Map<string, number>()
  for (const it of kept) keptBySource.set(it.source, (keptBySource.get(it.source) ?? 0) + 1)
  const sourcesOut: SourceReport[] = sources.map((s) => ({
    ...s,
    produced: keptBySource.get(s.source) ?? 0,
    // 被预算截断的源：状态仍是「无产出」，但说明里要交代是被截断而不是没采到
    status: s.status === 'used' && (keptBySource.get(s.source) ?? 0) === 0 ? 'no_material' : s.status,
    detail:
      s.status === 'used' && (keptBySource.get(s.source) ?? 0) === 0
        ? `${s.detail}；但全部素材因字符预算被截断，最终未进入语料`
        : s.detail,
  }))
  notes.push(`素材 ${kept.length} 条（来源：${sourcesOut.filter((s) => s.produced > 0).map((s) => s.source).join('、') || '无'}）`)

  return {
    corpus: {
      items: kept,
      sources: sourcesOut,
      missingSources: missingSourcesOf(sourcesOut),
      failedStocks: [...failedStocks].sort(),
    },
    sourcesUsed: sourcesOut.filter((s) => s.produced > 0).map((s) => s.source).sort(),
    notes,
  }
}

/** 采集说明（供 UI/诊断显示）。 */
export function collectSummary(result: CollectResult, asOf: string, today?: string): string {
  const when = today === asOf ? `as_of=${asOf}（= 当前交易日）` : `as_of=${asOf}（≠ 当前交易日 ${today ?? '未知'}）`
  const status = (result.corpus.sources ?? []).map(sourceStatusLine).join(' · ')
  return `${when} · ${result.corpus.items.length} 条素材 · ${status || `缺失源 ${result.corpus.missingSources.join('、') || '无'}`}`
}
