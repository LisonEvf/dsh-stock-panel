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

/** AI 任务种类（客户端只传 kind + 上下文，prompt 由本模块统一掌管）。 */
export type AiTaskKind = 'stock-verdict' | 'review-plan' | 'scout-rank'

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

/** 按任务 kind 映射到结构化结果类型。 */
export interface AiTaskResultMap {
  'stock-verdict': StockVerdict
  'review-plan': ReviewPlan
  'scout-rank': ScoutRank
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
