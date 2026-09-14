/**
 * src/lib/ai-contract.ts — AI 任务的**单一契约**（host 半与 client 半共用）。
 *
 * 为什么共享：prompt 模板、JSON 形状与容错解析必须完全一致——host 半负责
 * 组装 prompt 与解析回包，client 半负责渲染与回填视图，两边对同一份契约编译，
 * 改一处即两边同步。本模块**不 import 任何 DOM / Node API**，两半都可安全引用。
 *
 * 输出契约（硬要求）：模型必须只输出**一个 JSON 对象**，不允许解释文字与
 * markdown 围栏；`parseAiResult` 再做一层容错（去围栏 / 花括号配平扫描 /
 * 逐字段校验与夹取），解析失败也绝不丢模型原文（`raw` 兜底给视图显示）。
 */

// 取值类型**只引用**（`import type`，编译期擦除）：本文件因此仍不带任何运行时依赖，
// host 半与 client 半都能安全引用；同时也避免把 Q1/Q3/局势/竞价判定的取值各抄一份
// —— 抄一份就会漂一份（`war-plan` 的 Q1/Q2/Q3/判定直接沿用既有业务类型）。
import type { Q1Value, Q3Action } from './dayrun'
import type { Situation } from './situation'
import type { Verdict } from './auction-analysis'

/** AI 任务种类（客户端只传 kind + 上下文，prompt 由本模块统一掌管）。 */
export type AiTaskKind = 'stock-verdict' | 'review-plan' | 'scout-rank' | 'war-plan'

/** 观点方向。 */
export type AiStance = 'bullish' | 'neutral' | 'bearish'

/** 个股四维研判（`stock-verdict`）。 */
export interface StockVerdict {
  stance: AiStance
  /** 0-100 的多头把握分（已夹取）。 */
  score: number
  /** 一句话结论。 */
  oneLine: string
  /** 支撑结论的要点（有数字/事实才算，≤6 条）。 */
  thesis: string[]
  /** 风险点（≤6 条）。 */
  risks: string[]
  /** 关键价位——client 半会把它画到主图上（「模型反馈完善视图」的落点）。 */
  levels?: {
    support?: number
    resistance?: number
    stop?: number
    target?: number
  }
  /** 次日/后续要盯的信号（≤6 条）。 */
  watch: string[]
}

/** 次日预期清单条目（`review-plan`）。 */
export interface ReviewPlanItem {
  text: string
  /** 0-100 的看好程度。 */
  score: number
  reason: string
  /** 可选的关联标的（标准符号，如 SH600519）。 */
  symbol?: string
}

/** 次日预期清单（`review-plan`）。 */
export interface ReviewPlan {
  summary: string
  /** ≤5 条（与复盘页编辑器一致）。 */
  items: ReviewPlanItem[]
}

/** 选股候选排序条目（`scout-rank`）。 */
export interface ScoutRankPick {
  /** 标准符号（SH/SZ/BJ + 6 位）。 */
  symbol: string
  name?: string
  score: number
  reason: string
}

/** 选股候选排序（`scout-rank`）。 */
export interface ScoutRank {
  summary: string
  picks: ScoutRankPick[]
}

// ────────────────────────────── 作战思路（war-plan） ──────────────────────────────
//
// 「作战」页的产物不再是让用户自己挑的一堆选项，而是**模型给出的作战思路**：
// 主攻方向 → 候选票（含触发/失败条件）→ 三问落点 → 持仓动作 → 竞价判定。
//
// ⚠️ 本契约的**立身之本**是"以其他板块为基础"：模型只能从素材里已经出现的票与板块名里
// 说话（素材 = 行情/自挖板块/涨停梯队/事件流/复盘存档/持仓/自选/竞价，见 `lib/war-plan.ts`）。
// 因此这里刻意带一个 `guard` 字段：**护栏剔除了什么，必须回传到界面上**，
// 而不是让模型看起来"说得都对"（同 naming 的立场：记录而不静默丢弃）。

/** 作战基调（模型给的全局姿态）。 */
export type WarPlanStance = 'attack' | 'defend' | 'wait'

/** 主攻方向的**来源**（可分辨是哪一页的素材给的，与 naming 的来源标签同立场）。 */
export type WarPlanSource = 'concept' | 'board' | 'ladder' | 'watch' | 'position'

/** 一个主攻方向（板块名必须逐字来自素材，host 半逐字反查）。 */
export interface WarPlanSector {
  /** 方向名 —— **必须逐字取自素材的板块名/自挖类名**，不许自造（否则会被剔除）。 */
  name: string
  source: WarPlanSource
  /** 0-100 的强度把握分。 */
  score: number
  why: string
  /** 该方向下点名的成员（标准符号；不在素材内的会被剔除）。 */
  members: string[]
}

/** 一条候选票（作战主体：做什么 + 什么条件触发 + 什么条件算失败）。 */
export interface WarPlanPick {
  symbol: string
  name?: string
  /** 角色（主攻 / 跟随 / 风向标 / 观察…自由文本，窄位展示）。 */
  role: string
  score: number
  reason: string
  /** 触发条件（可量化）；模型没给时为空串（界面如实显示"未给"）。 */
  trigger: string
  /** 失败条件 / 止损依据；同上。 */
  stop: string
}

/** Q1 落点（持续性）。 */
export interface WarPlanQ1 {
  value: Q1Value
  why: string
}

/** Q2 落点（局势）。 */
export interface WarPlanQ2 {
  value: Situation
  why: string
}

/** Q3 落点：某标的今天该做的动作（模型给默认，用户可改）。 */
export interface WarPlanAction {
  symbol: string
  action: Q3Action
  why: string
}

/** 竞价对照落点：某预期今日竞价该怎么判（模型给默认，用户可改）。 */
export interface WarPlanVerdict {
  symbol: string
  verdict: Verdict
  why: string
}

/**
 * host 半护栏报告（**不静默剔除**）。
 *
 * 为什么必须在契约里：作战思路是"模型指挥你下注"，被剔掉的点名恰恰是
 * "模型本来想说但系统不许它说"的部分 —— 用户有权看到模型越界的频率。
 */
export interface WarPlanGuardReport {
  /** 被剔除的点名（"SH600001（不在素材内）"这种带原因的形式）。 */
  droppedSymbols: string[]
  /** 被剔除的方向名（不在素材板块名里）。 */
  droppedSectors: string[]
  /** 引文里**反查不到**的条目（原文保留，界面上标注未落地）。 */
  ungrounded: string[]
  /** 可逐字/数字反查到素材的引文条数。 */
  grounded: number
  /** 白名单规模（界面说明"模型可点名的票 N 只 / 板块 M 个"）。 */
  symbolPool: number
  sectorPool: number
}

/** 空护栏报告（解析层的初值；真正填值的是 host 半的 `guardWarPlan`）。 */
export function emptyWarPlanGuard(): WarPlanGuardReport {
  return { droppedSymbols: [], droppedSectors: [], ungrounded: [], grounded: 0, symbolPool: 0, sectorPool: 0 }
}

/** 作战思路（`war-plan`）。 */
export interface WarPlan {
  /**
   * 素材不足：模型必须**如实说**"证据不足"，而不是编一套思路出来。
   * （同 naming 的"没素材不许起名"：宁可不说话，也不许编。）
   */
  insufficient: boolean
  /** `insufficient=true` 的原因（也是直接给用户看的那句话）。 */
  reason: string
  /** 一句话战况判断（盘眼）。 */
  summary: string
  stance: WarPlanStance
  /** 主攻方向（≤3）。 */
  sectors: WarPlanSector[]
  /** 候选票（≤5）。 */
  picks: WarPlanPick[]
  /** 三问落点（模型没给 = null，界面显示"未给"，不代填）。 */
  q1: WarPlanQ1 | null
  q2: WarPlanQ2 | null
  /** 持仓动作（≤12，只覆盖素材里给了的持仓）。 */
  actions: WarPlanAction[]
  /** 竞价对照判定（≤12，只覆盖素材里给了的预期）。 */
  verdicts: WarPlanVerdict[]
  /** 今天**不做**什么（纪律项，≤5）。 */
  avoid: string[]
  /** 引用到的数据点（每条都应能在素材里逐字/数字反查，≤8）。 */
  evidence: string[]
  guard: WarPlanGuardReport
}

/** 按任务 kind 映射到结构化结果类型。 */
export interface AiTaskResultMap {
  'stock-verdict': StockVerdict
  'review-plan': ReviewPlan
  'scout-rank': ScoutRank
  'war-plan': WarPlan
}

/** 一次 AI 调用的载荷（client → host 路由）。 */
export interface AiTaskRequest {
  task: AiTaskKind
  /** 已由前端取好的行情/列表上下文（host 半不再回源，避免二次等待）。 */
  context: unknown
  /** 可选追加要求（用户在 AI 卡里补一句）。 */
  ask?: string
}

/** 一次 AI 调用的元信息（路由、耗时、自愈痕迹）。 */
export interface AiCallMeta {
  provider: string
  model: string
  ms: number
  /**
   * 自愈裁剪记录。**存在即表示模型看到的数据被裁过**，UI 必须显示出来——
   * 裁剪是为了救回「思考吃光输出预算」的失败，但用户有权知道模型少看了什么。
   */
  shrunk?: string[]
  /** 模型被调用的次数（>1 表示发生过自愈重试）。 */
  attempts?: number
  /**
   * 上下文体积（字节，host 半按 {@link contextBytes} 的口径算）。
   *
   * 为什么由 host 回传而不是让前端自己再算一遍：**前端不需要为此把本模块
   * （含四个任务的 prompt 模板与全部归一器）打进 client bundle** ——
   * 体积护栏实测过这一条：client 侧只要出现一个本模块的**值**引用，
   * 整份 prompt 文本就会跟着进包（见 `lib/war-plan.ts` 头部的成本纪律）。
   */
  contextBytes?: number
}

/** 一次 AI 调用的回包（host 路由 → client）。 */
export interface AiTaskResponse {
  ok: boolean
  task?: AiTaskKind
  /** 模型原文（永远返回，解析失败时供视图兜底显示）。 */
  text?: string
  /** 解析成功时的结构化结果。 */
  json?: unknown
  /** 实际使用的模型路由与耗时（诊断/展示）。 */
  meta?: AiCallMeta
  /** ok=false 时的机器可读分类。 */
  kind?: 'no-model' | 'llm-error' | 'bad-request' | 'context-too-large'
  error?: string
}

/** host 半侧上下文体积上限（超出直接报错，而不是悄悄截断模型的输入）。 */
export const AI_CONTEXT_MAX_BYTES = 24000

// ────────────────────────────── prompt 组装 ──────────────────────────────

/** 所有任务共用的系统约束（人设 + 输出规范）。 */
const BASE_SYSTEM = [
  '你是 A 股短线（T+1）盘中盯盘助手，服务对象是散户交易者。',
  '输出必须是最小化、可执行、可验证的判断，不要写免责声明，不要寒暄，不要复述输入。',
  '只用给你的数据说话：数据不足以支撑某条结论时，就不要写它——不要凑数、不要编造数字。',
  '严格只输出一个 JSON 对象：不要 markdown 代码块围栏，不要任何 JSON 之外的文字。',
].join('\n')

/** 每个任务的 JSON 形状说明（喂给模型）。 */
const SCHEMA_HINT: Record<AiTaskKind, string> = {
  'stock-verdict': [
    'JSON 形状：',
    '{"stance":"bullish|neutral|bearish","score":0-100,"oneLine":"一句话结论",',
    '"thesis":["支撑要点（引用具体数字/形态）"],"risks":["风险点"],',
    '"levels":{"support":数字,"resistance":数字,"stop":数字,"target":数字},',
    '"watch":["次日要盯的信号"]}',
    '要求：thesis/risks/watch 各 2-4 条，每条一句话、必须能追溯到给你的数据；',
    'levels 用你判断的价位（数字，元），无法判断的字段直接省略该键；',
    'score 是你对「短线偏多」的把握分（50=中性）。',
  ].join('\n'),
  'review-plan': [
    'JSON 形状：',
    '{"summary":"今日一句话盘眼","items":[{"text":"明日预期（可执行、可证伪）","score":0-100,"reason":"依据","symbol":"SH600519"}]}',
    '要求：items 最多 5 条、按 score 降序；',
    '数据里若给了 myExpectations（用户自己写的预期草稿），**先逐条给它打分并原样复用它的 text**，再补充新条目；',
    '每条必须来自给你的市场数据（主线板块/涨停梯队/广度/事件），score 是「明日兑现概率」的把握分；',
    'symbol 只在有明确标的时给（标准符号），纯盘面判断不要编造标的。',
  ].join('\n'),
  'scout-rank': [
    'JSON 形状：',
    '{"summary":"一句话筛选结论","picks":[{"symbol":"SH600519","name":"名称","score":0-100,"reason":"入选理由"}]}',
    '要求：从候选里挑 3-5 只最有「持续性」的（放量、非高位、主线内、有承接），',
    'picks 按 score 降序；reason 必须引用候选里的具体字段（涨幅/量比/换手/成交额）；不要新增候选之外的票。',
  ].join('\n'),
  'war-plan': [
    'JSON 形状：',
    '{"insufficient":false,"summary":"一句话盘眼","stance":"attack|defend|wait",',
    '"sectors":[{"name":"主攻方向名","source":"concept|board|ladder|watch|position","score":0-100,"why":"依据","members":["SH600519"]}],',
    '"picks":[{"symbol":"SH600519","name":"名称","role":"主攻|跟随|风向标","score":0-100,"reason":"依据","trigger":"触发条件","stop":"失败条件"}],',
    '"q1":{"value":"strengthen|flat|weaken","why":"依据"},',
    '"q2":{"value":"normal|highLowSwitch|innerDivergence|newDirection|weightLift|recession","why":"依据"},',
    '"actions":[{"symbol":"SH600519","action":"hold|reduce|clear|addTrial","why":"依据"}],',
    '"verdicts":[{"symbol":"SH600519","verdict":"beatExpect|confirm|falsify|weak2strong|weak2weak|trap","why":"依据"}],',
    '"avoid":["今天不做什么"],"evidence":["逐字引用素材里的数据点"]}',
    '硬约束（违反会被系统剔除，并在界面上标出来）：',
    '1. 票**只能**从素材里已经出现过的票里选（positions / watchlist / ladder / myPlan / concepts.members / boards.rep）；',
    '2. sectors[].name 必须**逐字**取自素材的 sectorUniverse（行情板块榜名 / 自挖类名），不许自己起名 —— 说不出来就少给一个方向；',
    '3. evidence 每条要能在素材里逐字或数字反查到（写成「涨停 23 家」「机器人概念 5 板」这种带数字的事实），反查不到的会被标注；',
    '4. 素材不足以支撑判断时（休市/取数失败/自挖引擎不可用），**只输出** {"insufficient":true,"reason":"缺什么、所以不给思路"}，不要编一套出来；',
    '5. 数量：sectors ≤3、picks ≤5、actions 只覆盖素材给了的持仓、verdicts 只覆盖素材给了的预期（没有就留空数组）；',
    '6. summary 一句话、stance 是今天的总基调；avoid 写纪律（如"不追高位断板"）。',
  ].join('\n'),
}

/** 组装一次调用的 prompt（system + 单条 user）。 */
export function buildAiPrompt(
  task: AiTaskKind,
  context: unknown,
  ask?: string,
): { system: string; user: string } {
  const header: Record<AiTaskKind, string> = {
    'stock-verdict': '任务：对下面这只股票做短线研判（趋势位置 / 量价关系 / 风险 / 明日关注）。',
    'review-plan': '任务：基于今日盘面数据，给出明日预期清单（供复盘页直接采用）。',
    'scout-rank': '任务：从候选池里挑出最值得盯的几只，并给出理由。',
    'war-plan':
      '任务：基于给出的盘面素材，给出**今天怎么打**的作战思路（主攻方向 → 候选票 → 三问 → 持仓动作 → 竞价判定）。'
      + '素材来自行情、自挖板块（市场自聚类）、涨停梯队、事件流、复盘存档、持仓、自选与竞价；'
      + '素材里没有的东西一律不说 —— 宁可说"证据不足"，也不要补一个听起来合理的板块或票。',
  }
  const parts = [header[task], SCHEMA_HINT[task], '', '数据（JSON）：', safeStringify(context)]
  if (typeof ask === 'string' && ask.trim() !== '') {
    parts.push('', `额外要求（优先级最高）：${ask.trim()}`)
  }
  return { system: BASE_SYSTEM, user: parts.join('\n') }
}

/** 稳定序列化（循环引用/超大对象不抛异常）。 */
function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value, null, 1) ?? 'null'
  } catch {
    return '（上下文无法序列化）'
  }
}

// ────────────────────────────── 解析与校验 ──────────────────────────────

/** 去 markdown 围栏；取第一个**花括号配平**的 JSON 对象。 */
export function extractJsonObject(text: string): unknown {
  if (typeof text !== 'string' || text.trim() === '') return null
  const cleaned = text
    .replace(/^\s*```(?:json|JSON)?\s*/m, '')
    .replace(/```\s*$/m, '')
    .trim()

  // 1) 直接解析
  const direct = tryParse(cleaned)
  if (direct !== undefined) return direct

  // 2) 花括号配平扫描（跳过字符串内的括号）
  const start = cleaned.indexOf('{')
  if (start < 0) return null
  let depth = 0
  let inStr = false
  let esc = false
  for (let i = start; i < cleaned.length; i++) {
    const ch = cleaned[i]
    if (inStr) {
      if (esc) esc = false
      else if (ch === '\\') esc = true
      else if (ch === '"') inStr = false
      continue
    }
    if (ch === '"') inStr = true
    else if (ch === '{') depth += 1
    else if (ch === '}') {
      depth -= 1
      if (depth === 0) {
        const candidate = tryParse(cleaned.slice(start, i + 1))
        return candidate === undefined ? null : candidate
      }
    }
  }
  return null
}

function tryParse(s: string): unknown | undefined {
  try {
    const v: unknown = JSON.parse(s)
    return v === null ? undefined : v
  } catch {
    return undefined
  }
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === 'object' && !Array.isArray(v)
}

/** 夹取到 [0,100] 的整数；非法返回 fallback。 */
function scoreOf(v: unknown, fallback = 50): number {
  const n = typeof v === 'number' ? v : Number(v)
  if (!Number.isFinite(n)) return fallback
  return Math.max(0, Math.min(100, Math.round(n)))
}

/** 正数价位；非法返回 undefined。 */
function priceOf(v: unknown): number | undefined {
  const n = typeof v === 'number' ? v : Number(v)
  if (!Number.isFinite(n) || n <= 0) return undefined
  return n
}

/** 字符串数组（去空、去重、限长）。 */
function strList(v: unknown, max = 6): string[] {
  if (!Array.isArray(v)) return []
  const out: string[] = []
  for (const item of v) {
    if (typeof item !== 'string') continue
    const s = item.trim()
    if (s === '' || out.includes(s)) continue
    out.push(s)
    if (out.length >= max) break
  }
  return out
}

function str(v: unknown, fallback = ''): string {
  return typeof v === 'string' && v.trim() !== '' ? v.trim() : fallback
}

/** 标准符号校验（SH/SZ/BJ + 6 位数字）。 */
export function isStandardSymbol(v: unknown): v is string {
  return typeof v === 'string' && /^(SH|SZ|BJ)\d{6}$/.test(v.trim().toUpperCase())
}

function normalizeSymbol(v: unknown): string | undefined {
  if (typeof v !== 'string') return undefined
  const s = v.trim().toUpperCase()
  if (/^(SH|SZ|BJ)\d{6}$/.test(s)) return s
  const digits = s.replace(/\D/g, '')
  if (digits.length === 6) {
    // 无市场前缀时按 A 股代码段推断（6/9→SH，其余→SZ，4/8→BJ）
    const head = digits[0]
    const market = head === '6' || head === '9' ? 'SH' : head === '4' || head === '8' ? 'BJ' : 'SZ'
    return market + digits
  }
  return undefined
}

/** 校验并归一 `stock-verdict`。 */
export function normalizeStockVerdict(raw: unknown): StockVerdict | null {
  if (!isRecord(raw)) return null
  const stanceRaw = str(raw.stance).toLowerCase()
  const stance: AiStance =
    stanceRaw === 'bullish' || stanceRaw === 'bearish' || stanceRaw === 'neutral' ? stanceRaw : 'neutral'
  const oneLine = str(raw.oneLine, str(raw.summary, str(raw.conclusion)))
  const thesis = strList(raw.thesis, 6)
  const risks = strList(raw.risks, 6)
  if (oneLine === '' && thesis.length === 0) return null
  const levelsRaw = isRecord(raw.levels) ? raw.levels : {}
  const levels = {
    support: priceOf(levelsRaw.support),
    resistance: priceOf(levelsRaw.resistance),
    stop: priceOf(levelsRaw.stop),
    target: priceOf(levelsRaw.target),
  }
  const hasLevel = Object.values(levels).some((v) => v !== undefined)
  return {
    stance,
    score: scoreOf(raw.score),
    oneLine,
    thesis,
    risks,
    ...(hasLevel ? { levels } : {}),
    watch: strList(raw.watch, 6),
  }
}

/** 校验并归一 `review-plan`。 */
export function normalizeReviewPlan(raw: unknown): ReviewPlan | null {
  if (!isRecord(raw)) return null
  const itemsRaw = Array.isArray(raw.items) ? raw.items : []
  const items: ReviewPlanItem[] = []
  for (const it of itemsRaw) {
    if (!isRecord(it)) continue
    const text = str(it.text, str(it.expectation))
    if (text === '') continue
    const symbol = normalizeSymbol(it.symbol)
    items.push({
      text,
      score: scoreOf(it.score),
      reason: str(it.reason, '—'),
      ...(symbol !== undefined ? { symbol } : {}),
    })
    if (items.length >= 5) break
  }
  if (items.length === 0) return null
  items.sort((a, b) => b.score - a.score)
  return { summary: str(raw.summary, '—'), items }
}

/** 校验并归一 `scout-rank`。 */
export function normalizeScoutRank(raw: unknown): ScoutRank | null {
  if (!isRecord(raw)) return null
  const picksRaw = Array.isArray(raw.picks) ? raw.picks : []
  const picks: ScoutRankPick[] = []
  for (const p of picksRaw) {
    if (!isRecord(p)) continue
    const symbol = normalizeSymbol(p.symbol)
    if (symbol === undefined) continue
    picks.push({
      symbol,
      ...(str(p.name) !== '' ? { name: str(p.name) } : {}),
      score: scoreOf(p.score),
      reason: str(p.reason, '—'),
    })
    if (picks.length >= 5) break
  }
  if (picks.length === 0) return null
  picks.sort((a, b) => b.score - a.score)
  return { summary: str(raw.summary, '—'), picks }
}

// ────────────────────── 作战思路的取值全集（编译期穷尽） ──────────────────────
//
// 为什么用 `Record<Union, true>` 而不是手写数组：手写数组与联合类型是**两份**真相，
// 少同步一个取值没有任何人会发现（`QAnswers.tsx` 里那份手写 SITUATIONS 就是这么漂的）。
// 这里少一个键就编译不过（CI 的 tsc 门禁），多一个不存在的键也编译不过。

const STANCE_SET: Record<WarPlanStance, true> = { attack: true, defend: true, wait: true }
const SOURCE_SET: Record<WarPlanSource, true> = {
  concept: true,
  board: true,
  ladder: true,
  watch: true,
  position: true,
}
const Q1_SET: Record<Q1Value, true> = { strengthen: true, weaken: true, flat: true }
const Q3_SET: Record<Q3Action, true> = { hold: true, reduce: true, clear: true, addTrial: true }
const SITUATION_SET: Record<Situation, true> = {
  normal: true,
  highLowSwitch: true,
  innerDivergence: true,
  newDirection: true,
  weightLift: true,
  recession: true,
}
const VERDICT_SET: Record<Verdict, true> = {
  beatExpect: true,
  confirm: true,
  falsify: true,
  weak2strong: true,
  weak2weak: true,
  trap: true,
}

/** 从取值全集里取一个合法值；非法/缺失时返回 fallback。 */
function enumOf<T extends string>(set: Record<T, true>, v: unknown, fallback: T): T {
  return typeof v === 'string' && Object.prototype.hasOwnProperty.call(set, v.trim()) ? (v.trim() as T) : fallback
}

/**
 * 字符串数组，**顺带容忍模型把单条写成裸字符串**（`"avoid":"不追高"` 是实测常见写法）。
 * 与 `strList` 的区别只在这一条：本函数用于散文型字段，字符串写错格式不该让整条丢掉。
 */
function strListSoft(v: unknown, max: number): string[] {
  const arr = typeof v === 'string' ? [v] : Array.isArray(v) ? v : []
  return strList(arr, max)
}

/** 校验并归一 `war-plan`。⚠️ 这里只做**形状**校验；素材白名单/引文反查在 host 半（`guardWarPlan`）。 */
export function normalizeWarPlan(raw: unknown): WarPlan | null {
  if (!isRecord(raw)) return null
  const guard = emptyWarPlanGuard()

  // 素材不足：模型的**正确回答**之一，必须原样保留（不允许把它当"解析失败"吞掉）。
  if (raw.insufficient === true) {
    return {
      insufficient: true,
      reason: str(raw.reason, '模型判定：现有素材不足以给出作战思路'),
      summary: str(raw.summary),
      stance: 'wait',
      sectors: [],
      picks: [],
      q1: null,
      q2: null,
      actions: [],
      verdicts: [],
      avoid: [],
      evidence: [],
      guard,
    }
  }

  const sectors: WarPlanSector[] = []
  for (const s of Array.isArray(raw.sectors) ? raw.sectors : []) {
    if (!isRecord(s)) continue
    const name = str(s.name)
    if (name === '') continue
    const members: string[] = []
    for (const m of Array.isArray(s.members) ? s.members : []) {
      const sym = normalizeSymbol(m)
      if (sym !== undefined && !members.includes(sym)) members.push(sym)
      if (members.length >= 12) break
    }
    sectors.push({
      name,
      source: enumOf(SOURCE_SET, s.source, 'concept'),
      score: scoreOf(s.score),
      why: str(s.why),
      members,
    })
    if (sectors.length >= 3) break
  }

  const picks: WarPlanPick[] = []
  for (const p of Array.isArray(raw.picks) ? raw.picks : []) {
    if (!isRecord(p)) continue
    const symbol = normalizeSymbol(p.symbol)
    if (symbol === undefined) continue
    const name = str(p.name)
    picks.push({
      symbol,
      ...(name !== '' ? { name } : {}),
      role: str(p.role, '候选'),
      score: scoreOf(p.score),
      reason: str(p.reason, '—'),
      trigger: str(p.trigger),
      stop: str(p.stop),
    })
    if (picks.length >= 5) break
  }
  picks.sort((a, b) => b.score - a.score)

  const q1Raw = isRecord(raw.q1) ? raw.q1 : null
  const q1: WarPlanQ1 | null = q1Raw === null ? null : { value: enumOf(Q1_SET, q1Raw.value, 'flat'), why: str(q1Raw.why) }
  const q2Raw = isRecord(raw.q2) ? raw.q2 : null
  const q2: WarPlanQ2 | null = q2Raw === null ? null : { value: enumOf(SITUATION_SET, q2Raw.value, 'normal'), why: str(q2Raw.why) }

  const actions: WarPlanAction[] = []
  for (const a of Array.isArray(raw.actions) ? raw.actions : []) {
    if (!isRecord(a)) continue
    const symbol = normalizeSymbol(a.symbol)
    if (symbol === undefined) continue
    actions.push({ symbol, action: enumOf(Q3_SET, a.action, 'hold'), why: str(a.why) })
    if (actions.length >= 12) break
  }

  const verdicts: WarPlanVerdict[] = []
  for (const v of Array.isArray(raw.verdicts) ? raw.verdicts : []) {
    if (!isRecord(v)) continue
    const symbol = normalizeSymbol(v.symbol)
    if (symbol === undefined) continue
    verdicts.push({ symbol, verdict: enumOf(VERDICT_SET, v.verdict, 'confirm'), why: str(v.why) })
    if (verdicts.length >= 12) break
  }

  const summary = str(raw.summary, str(raw.oneLine))
  // 三个主字段全空 = 这次回答没有可用信息（不假装成功；原文由调用方保留）。
  if (summary === '' && sectors.length === 0 && picks.length === 0) return null

  return {
    insufficient: false,
    reason: '',
    summary,
    stance: enumOf(STANCE_SET, raw.stance, 'wait'),
    sectors,
    picks,
    q1,
    q2,
    actions,
    verdicts,
    avoid: strListSoft(raw.avoid, 5),
    evidence: strListSoft(raw.evidence, 8),
    guard,
  }
}

/** 解析并校验模型回包（解析失败返回 null，原文由调用方保留）。 */
export function parseAiResult<T extends AiTaskKind>(task: T, text: string): AiTaskResultMap[T] | null {
  const raw = extractJsonObject(text)
  if (raw === null) return null
  // 有些模型会把对象包一层（{"result": {...}} / {"data": {...}}）
  const inner = isRecord(raw) && isRecord(raw.result)
    ? raw.result
    : isRecord(raw) && isRecord(raw.data)
      ? raw.data
      : raw
  switch (task) {
    case 'stock-verdict':
      return normalizeStockVerdict(inner) as AiTaskResultMap[T] | null
    case 'review-plan':
      return normalizeReviewPlan(inner) as AiTaskResultMap[T] | null
    case 'scout-rank':
      return normalizeScoutRank(inner) as AiTaskResultMap[T] | null
    case 'war-plan':
      return normalizeWarPlan(inner) as AiTaskResultMap[T] | null
    default:
      return null
  }
}

/** 上下文体积（字节，UTF-8 近似：中文按 3 字节估算）。 */
export function contextBytes(context: unknown): number {
  const s = safeStringify(context)
  let bytes = 0
  for (const ch of s) {
    const code = ch.codePointAt(0) ?? 0
    bytes += code > 0xffff ? 4 : code > 0x7ff ? 3 : code > 0x7f ? 2 : 1
  }
  return bytes
}

// ────────────────────────────── 上下文自愈裁剪 ──────────────────────────────

/** 时间序列类字段：裁剪时保留**最新**（尾部）。 */
const TAIL_KEYS = /(kline|rows|series|history|ticks?|events?|bars)/i

/** 一次裁剪的结果。 */
export interface ShrinkResult {
  context: unknown
  /** 人类可读的裁剪说明（回传给 UI 展示，不做静默截断）。 */
  note: string
}

/**
 * 把过大的上下文**裁剪一档**（用于「模型把输出预算烧在思考上」的自愈重试）。
 *
 * 策略（每次只动一处，便于说明与回滚）：
 *   1. 找顶层最大的数组字段：>12 条就砍半——时间序列留尾部（最新），
 *      其余（候选/梯队等排序列表）留头部；
 *   2. 无数组可砍时，把最长的字符串字段截到 1200 字符；
 *   3. 都动不了 → 返回 null（由调用方给出明确错误，而不是假装成功）。
 *
 * 只在**重试**路径使用：正常路径绝不裁剪，避免「悄悄改小模型看到的数据」。
 */
export function shrinkContext(context: unknown): ShrinkResult | null {
  if (!isRecord(context)) return null

  // 1) 最大数组字段
  let bestKey: string | null = null
  let bestSize = 0
  for (const [key, value] of Object.entries(context)) {
    if (!Array.isArray(value)) continue
    if (value.length > bestSize) {
      bestSize = value.length
      bestKey = key
    }
  }
  if (bestKey !== null && bestSize > 12) {
    const arr = context[bestKey] as unknown[]
    const keep = Math.max(10, Math.floor(arr.length / 2))
    const tail = TAIL_KEYS.test(bestKey)
    const sliced = tail ? arr.slice(arr.length - keep) : arr.slice(0, keep)
    return {
      context: { ...context, [bestKey]: sliced },
      note: `${bestKey} 由 ${arr.length} 条裁到 ${keep} 条（保留${tail ? '尾部最新' : '头部'}）`,
    }
  }

  // 2) 最长字符串字段
  let strKey: string | null = null
  let strLen = 0
  for (const [key, value] of Object.entries(context)) {
    if (typeof value === 'string' && value.length > strLen) {
      strLen = value.length
      strKey = key
    }
  }
  if (strKey !== null && strLen > 1200) {
    return {
      context: { ...context, [strKey]: (context[strKey] as string).slice(0, 1200) },
      note: `${strKey} 文本由 ${strLen} 字裁到 1200 字`,
    }
  }
  return null
}
