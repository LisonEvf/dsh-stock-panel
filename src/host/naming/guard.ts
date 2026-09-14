/**
 * src/host/naming/guard.ts —— 证据护栏（A2b 的核心，逐条移植自 `cluster-namer/guard.py`）。
 *
 * 为什么这块必须**逐字移植**而不是"照着意思重写"：护栏的全部价值来自它的严格性，
 * 而严格性只体现在边界上（引文最短长度、分隔符归一、时间戳以谁为准、窗口外证据怎么算）。
 * 任何一处"宽松一点更方便"，都会让幻觉引文通过 —— 界面上看不出区别，只有抽查才发现。
 *
 * 参考实现里被真实 LLM 逼出来的三条加固，这里全部保留：
 *   A5：门控用可计算指标 `evidenceScore`，LLM 自报 confidence 只作展示；
 *   A6：证据时间戳进护栏，窗口外的证据不计入门控（负样本可复现）；
 *   A7：降级成因字段化（绝不留 `none`）。
 *
 * 另外保留一条真实踩过的坑：prompt 把素材渲染成 `标题 / 摘要`，真实 LLM 会把 " / "
 * 一起抄回来，而素材文本是用**空格**连接的 —— 不做分隔符归一，合规引文会被判成幻觉。
 */
import {
  materialText,
  tsDate,
  windowContains,
  type DegradedReason,
  type MaterialCorpus,
  type MaterialItem,
  type MaterialWindow,
  type NamingEvidence,
  type NamingGuardConfig,
  type NamingResult,
  type NamingVerdict,
} from './types'
import { describeMaterialCause, pickDegradedReason } from './cause'
import { SOURCE_NEWS } from './news'

/** 引文最短长度：只抄「所属板块」四个字不构成有效证据。 */
export const MIN_QUOTE_LEN = 4

/**
 * 主题名长度参考上限（**不截断**，只提示）。
 *
 * 为什么要有：类列表一行里主题名后面还跟着涨幅/涨停/成员，实测模型偶尔会写
 * 「银行、电力、白酒等红利资产同步走强」这种整句话当主题名 —— 一行的宽度被它吃掉，
 * 用户扫不了列表。但**截断一个名字比保留它更危险**（半截名字会被误引，
 * 同"降级不留半个名字"的立场），所以这里只标注、不改写。
 */
export const THEME_MAX_LEN = 16

/** 主题名末尾的通用后缀（去掉它们不损失信息：「白酒板块」=「白酒」）。 */
const GENERIC_THEME_SUFFIX = ['板块', '概念', '题材', '主题', '行业', '方向', '行情']

/** 包裹用的引号/括号（模型常把名字包起来，展示时要脱掉）。 */
const WRAPPER_PAIRS: ReadonlyArray<readonly [string, string]> = [
  ['「', '」'],
  ['『', '』'],
  ['“', '”'],
  ['‘', '’'],
  ['《', '》'],
  ['〈', '〉'],
  ['【', '】'],
  ['[', ']'],
  ['(', ')'],
  ['（', '）'],
  ['"', '"'],
  ["'", "'"],
]

/**
 * 主题名归一：脱引号 → 去空白 → 去通用后缀。
 *
 * 为什么这是**护栏**的一部分而不是展示层的小修饰：主题名是这一整套流程唯一给出去的东西，
 * 它的形状（"短标签" vs "一句话"）决定了它能不能被引用、被比较、被记住。
 * 模型输出「有色金属板块」与「有色金属」是同一件事，而界面上前者会挤掉后面的数字；
 * 模型输出「金融街、华侨城A 等地产股」时我们**不**改写（那可能真是它的归纳），
 * 只在 guardNotes 里标注偏长 —— 归因与改写都要留在可追溯的地方。
 *
 * 归一后为空的（只给了引号/后缀）→ 返回 `''`，由调用方按"named 但 theme 为空"降级处理。
 */
export function normalizeTheme(raw: unknown): string {
  let s = raw == null ? '' : String(raw)
  // 去空白：中文主题名里不该有空格/换行（模型有时写"有色 金属"）
  s = s.replace(/[\s\u3000]+/g, '')
  for (const [open, close] of WRAPPER_PAIRS) {
    while (s.length >= 2 && s.startsWith(open) && s.endsWith(close)) s = s.slice(1, -1)
  }
  for (const suffix of GENERIC_THEME_SUFFIX) {
    // 至少留 2 个字：不允许把「板块」两个字的后缀削成一个字的名字
    if (s.length > suffix.length + 1 && s.endsWith(suffix)) {
      s = s.slice(0, -suffix.length)
      break
    }
  }
  return s.trim()
}

/** 引文比较前的归一：去掉所有空白与 "/"（渲染差异，不是幻觉）。 */
function normForMatch(text: string): string {
  return (text ?? '').replace(/[\s/]+/g, '')
}

/** 逐字反查单条引文是否来自该素材。 */
export function verifyQuote(quote: string, item: MaterialItem): boolean {
  const q = (quote ?? '').trim()
  if (q.length < MIN_QUOTE_LEN) return false
  const nq = normForMatch(q)
  if (!nq) return false
  return normForMatch(materialText(item)).includes(nq)
}

/**
 * 在语料里找引文的出处：先按成员标注匹配，再全局兜一次（模型可能只写了名称）。
 *
 * 匹配顺序上有一处**刻意的取舍**：同一段文本同时出现在窗口内与窗口外时（「所属板块」
 * 这条素材每天都在重新生成，内容可能一字不差），优先认**窗口内**的那条。
 * 参考实现按语料顺序取第一条，而语料按时间升序排列 → 会先撞上最旧的一条，
 * 于是"这段证据其实今天就在窗口里"也会被时间窗护栏挡掉（冤枉的降级）。
 * 语义上引文确实存在于窗口内，就该按窗口内计；反查本身与窗口无关（护栏在 `applyGuards`）。
 */
export function findQuoteItem(
  stock: string,
  quote: string,
  corpus: MaterialCorpus,
  window: MaterialWindow,
): MaterialItem | null {
  const match = (pool: MaterialItem[], wantInWindow: boolean): MaterialItem | null => {
    for (const item of pool) {
      const d = tsDate(item.ts)
      const inWindow = Boolean(d && windowContains(window, d))
      if (inWindow !== wantInWindow) continue
      if (verifyQuote(quote, item)) return item
    }
    return null
  }
  const byStock = corpus.items.filter((i) => i.stock === stock)
  for (const pool of [byStock, corpus.items]) {
    const hit = match(pool, true) ?? match(pool, false)
    if (hit) return hit
  }
  return null
}

/**
 * 可计算证据分（A5）：不依赖模型自报。
 *
 * 权重刻意写成显式常量而不是"看起来合理的小数"：它决定 `named` 与否，
 * 各分量含义必须能被复盘时解释 —— 覆盖度 0.40 / 命中票数 0.25 / 窗口内比例 0.20 / 条数 0.15。
 */
export function computeEvidenceScore(count: number, hitMembers: number, coverage: number, inWindowRatio: number): number {
  const volume = Math.min(count / 3, 1)
  const memberFactor = Math.min(hitMembers / 2, 1)
  return round4(0.4 * coverage + 0.25 * memberFactor + 0.2 * inWindowRatio + 0.15 * volume)
}

function round4(n: number): number {
  return Math.round(n * 1e4) / 1e4
}

/** 模型原始输出的宽松形态（字段全部按不可信处理）。 */
export interface RawNamingOutput {
  verdict?: unknown
  theme?: unknown
  confidence?: unknown
  alternatives?: unknown
  evidence?: unknown
  reasoning?: unknown
}

const VALID_VERDICTS: ReadonlySet<string> = new Set(['named', 'no_common', 'insufficient'])

export interface ApplyGuardsArgs {
  raw: RawNamingOutput
  classId: number
  asOf: string
  /** 成员标注列表（`600000 浦发银行`），用于算覆盖度。 */
  memberLabels: string[]
  corpus: MaterialCorpus
  window: MaterialWindow
  cfg: NamingGuardConfig
  modelVersion: string
  fingerprint: string
  /**
   * 采集层是否发生过"源整体失败"。
   * 与「窗口内本来就没素材」区分开：两者都导致 insufficient，但成因不同（A7）。
   */
  sourceFailed?: boolean
}

/**
 * 施加护栏：反查证据 → 算门控指标 → 定结论与降级成因。
 *
 * 立场（照搬参考实现）：`named` 需要**同时**满足 有 theme / 有有效证据 / 条数 /
 * 命中票数 / 覆盖度 / 证据分 六项；任一项不过就降级，且**不保留 theme**
 * —— 半个主题名比没有主题名更容易被误引。
 */
export function applyGuards(args: ApplyGuardsArgs): NamingResult {
  const { raw, corpus, window, cfg } = args
  const notes: string[] = []

  // ---- 1) 结论字面量：非法值一律降级 insufficient（不猜模型想说什么）----
  let verdictRaw = String(raw.verdict ?? '').trim().toLowerCase()
  if (!VALID_VERDICTS.has(verdictRaw)) {
    notes.push(`verdict 非法(${JSON.stringify(verdictRaw)}) → 降级 insufficient`)
    verdictRaw = 'insufficient'
  }
  let verdict = verdictRaw as NamingVerdict

  const themeRaw = raw.theme == null ? '' : String(raw.theme).trim()
  // 归一（脱引号/去空白/去「板块」这类通用后缀）—— 只在**实际改动了内容**时留一条备注，
  // 否则每条 guardNotes 都是噪声，"有备注"就不再是信号了。
  const themeNorm = normalizeTheme(themeRaw)
  let theme: string | null = themeNorm || null
  if (themeRaw !== '' && themeRaw !== themeNorm) {
    notes.push(`主题名已归一：${JSON.stringify(themeRaw)} → ${JSON.stringify(themeNorm)}（脱引号/去空白/去通用后缀，不改写词本身）`)
  }
  if (themeNorm.length > THEME_MAX_LEN) {
    notes.push(`（提示）主题名 ${themeNorm.length} 字偏长（参考上限 ${THEME_MAX_LEN}）：按原样保留，不做截断（半截名字会被误引）`)
  }
  const confidenceNum = raw.confidence == null ? Number.NaN : Number(raw.confidence)
  const confidence = Number.isFinite(confidenceNum) ? confidenceNum : null
  const alternatives = Array.isArray(raw.alternatives)
    ? raw.alternatives.map((a) => String(a).trim()).filter((a) => a.length > 0)
    : []
  const reasoning = raw.reasoning == null ? '' : String(raw.reasoning).trim()

  // ---- 2) 证据反查（幻觉闸门）----
  const evidence: NamingEvidence[] = []
  const rawEvidence = Array.isArray(raw.evidence) ? raw.evidence : []
  for (const ev of rawEvidence) {
    if (!ev || typeof ev !== 'object' || Array.isArray(ev)) {
      notes.push('丢弃非对象形式的 evidence 条目')
      continue
    }
    const obj = ev as Record<string, unknown>
    const stock = String(obj.stock ?? '').trim()
    const quote = String(obj.quote ?? '').trim()
    const reportedTs = String(obj.ts ?? '').trim()
    const matched = findQuoteItem(stock, quote, corpus, window)
    if (!matched) {
      notes.push(`证据反查失败（判幻觉，丢弃）：${stock} 「${quote.slice(0, 24)}…」`)
      continue
    }
    // 时间戳以**素材**为准：否则模型把证据挪到窗口外/内都无法被发现
    const ts = matched.ts
    if (reportedTs && reportedTs !== ts) {
      notes.push(`模型自报时间戳与素材不一致（以素材为准）：${stock} ${reportedTs} → ${ts}`)
    }
    const d = tsDate(ts)
    evidence.push({
      stock: matched.stock,
      source: matched.source,
      quote,
      ts,
      inWindow: Boolean(d && windowContains(window, d)),
    })
  }
  notes.push(`证据反查通过 ${evidence.length} 条`)

  const nMembers = Math.max(args.memberLabels.length, 1)
  // ---- 3) A6：窗口外的证据不计入门控 ----
  let usable = evidence
  if (cfg.enforceEvidenceWindow) {
    usable = evidence.filter((e) => e.inWindow)
    const dropped = evidence.length - usable.length
    if (dropped) {
      notes.push(`A6 时间窗护栏：${dropped} 条证据不在窗口内，不计入门控`)
    }
  }
  const hitMembers = new Set(usable.map((e) => e.stock)).size
  const coverage = hitMembers / nMembers
  const inWindowRatio = evidence.length ? usable.length / evidence.length : 0
  const score = computeEvidenceScore(usable.length, hitMembers, coverage, evidence.length ? inWindowRatio : 0)

  // ---- 4) 结论定档 + 成因分层 ----
  let degraded: DegradedReason = 'none'
  if (verdict === 'named') {
    const reasons: string[] = []
    if (!theme) reasons.push('named 但 theme 为空')
    if (cfg.requireEvidence && usable.length === 0) reasons.push('named 但无有效证据')
    if (usable.length < cfg.minEvidenceItems) {
      reasons.push(`素材量门槛：有效证据 ${usable.length} < ${cfg.minEvidenceItems}`)
    }
    if (hitMembers < cfg.minHitMembers) {
      reasons.push(`素材量门槛：命中票数 ${hitMembers} < ${cfg.minHitMembers}`)
    }
    if (coverage < cfg.minCoverage) {
      reasons.push(`覆盖度 ${coverage.toFixed(2)} < ${cfg.minCoverage}`)
    }
    // A5：自报置信度不参与门控，只留一条提示（否则等于让模型自己给自己发通行证）
    if (confidence != null && confidence < cfg.minConfidence) {
      notes.push(`（提示，不参与降级）模型自报置信度 ${confidence.toFixed(2)} 低于 ${cfg.minConfidence}，判定以可计算证据分为准`)
    }
    if (score < cfg.minEvidenceScore) {
      reasons.push(`A5 可计算证据分 ${score.toFixed(2)} < ${cfg.minEvidenceScore}`)
    }
    if (reasons.length) {
      notes.push(...reasons)
      // 有素材但证据不合格 → no_common；完全没素材 → insufficient（成因按采集事实定档）
      if (corpus.items.length === 0) {
        verdict = 'insufficient'
        degraded = pickDegradedReason({
          sources: corpus.sources,
          itemCount: 0,
          missingMemberCount: args.memberLabels.length,
          legacyMissingSources: corpus.missingSources,
        })
      } else {
        verdict = 'no_common'
        degraded = 'guard_rejected'
      }
      theme = null
    }
  } else if (verdict === 'no_common') {
    theme = null
  } else {
    theme = null
    // 成因必须分层，绝不能留 none —— 而且**按采集事实定**，不看模型怎么解释（见 cause.ts）
    const stocksWithItems = new Set(corpus.items.map((i) => i.stock))
    const missingMembers = args.memberLabels.filter((label) => !stocksWithItems.has(label))
    degraded = pickDegradedReason({
      sources: corpus.sources,
      itemCount: corpus.items.length,
      missingMemberCount: missingMembers.length,
      legacyMissingSources: corpus.missingSources,
    })
    if (missingMembers.length > 0) {
      notes.push(`部分成员票窗口内无素材：${missingMembers.join('、')}（源无数据或该票当日无数据）`)
    }
    if (degraded === 'source_skipped') {
      notes.push('实时源（异动/主力监控）按设计跳过：as_of 不是当前交易日，不做历史回放')
    }
    if (degraded === 'source_failed') {
      notes.push(`源采集失败：${corpus.missingSources.join('、')}`)
    }
  }

  const sourceStatus = [...(corpus.sources ?? [])]

  /**
   * 「事件优先、标签兜底」的**独立核对**。
   *
   * 提示词第 0 条要求模型：有快讯事件必须依据事件命名；没有才用板块标签兜底并注明。
   * 模型可能忘记标注 —— 所以系统**自己算一遍事实**（结论有没有用到快讯），
   * 作为护栏备注如实显示。归因不能交给被审计者书写（同 `cause.ts` 的立场）。
   *
   * 只在"语料里确实有快讯、而结论一条都没用"时提示：语料本来就没有快讯的情况，
   * 逐源状态已经写明了原因，再加一句只是噪声。
   */
  const corpusHasNews = corpus.items.some((i) => i.source === SOURCE_NEWS)
  if (verdict === 'named' && corpusHasNews && !evidence.some((e) => e.source === SOURCE_NEWS && e.inWindow)) {
    notes.push('本组命名的证据全部来自板块标签/盘面素材，**没有用到窗口内的快讯事件**（按"事件优先、标签兜底"口径标注）')
  }

  return {
    classId: args.classId,
    asOf: args.asOf,
    verdict,
    theme: verdict === 'named' ? theme : null,
    confidence,
    evidenceScore: score,
    evidenceCoverage: round4(coverage),
    evidenceInWindow: round4(inWindowRatio),
    evidenceCount: usable.length,
    alternatives: verdict === 'named' ? alternatives : [],
    evidence,
    reasoning,
    missingSources: [...corpus.missingSources],
    sourceStatus,
    causeNote: describeMaterialCause(sourceStatus, corpus.items.length, args.memberLabels.length),
    degradedReason: degraded,
    guardNotes: notes,
    fingerprint: args.fingerprint,
    modelVersion: args.modelVersion,
    windowDays: window.days,
    materialCount: corpus.items.length,
  }
}

/** 无证据时的兜底结果（LLM 不可用 / 输出畸形时用）。 */
export function degradedResult(args: {
  classId: number
  asOf: string
  corpus: MaterialCorpus
  window: MaterialWindow
  modelVersion: string
  fingerprint: string
  reason: DegradedReason
  note: string
}): NamingResult {
  return {
    classId: args.classId,
    asOf: args.asOf,
    verdict: 'insufficient',
    theme: null,
    confidence: null,
    evidenceScore: 0,
    evidenceCoverage: 0,
    evidenceInWindow: 0,
    evidenceCount: 0,
    alternatives: [],
    evidence: [],
    reasoning: '素材不足，回退人工命名。',
    missingSources: [...args.corpus.missingSources],
    sourceStatus: [...(args.corpus.sources ?? [])],
    causeNote: describeMaterialCause(args.corpus.sources, args.corpus.items.length),
    degradedReason: args.reason,
    guardNotes: [args.note],
    fingerprint: args.fingerprint,
    modelVersion: args.modelVersion,
    windowDays: args.window.days,
    materialCount: args.corpus.items.length,
  }
}
