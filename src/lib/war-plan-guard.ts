/**
 * src/lib/war-plan-guard.ts —— 作战思路的**素材护栏**（"以其他板块为基础，不是空穴来风"的落地）。
 *
 * ## 为什么必须有这一层
 *
 * 「作战」页现在由模型给结论（主攻方向 / 候选票 / 三问 / 动作），这是全仓**唯一**
 * 会直接指挥用户下单的输出。而模型的失败模式恰好是最危险的那种：**说得像真的**——
 * 点一只素材里根本没有的票、编一个漂亮的板块名、给一条查不到出处的"证据"。
 * 光靠 prompt 里写"不许编"是不够的（naming 那条线已经吃过这个亏：护栏拒掉的必须记下来）。
 *
 * 所以这里做三件**可机检**的事：
 *   1. **票白名单**：点名只能来自素材里出现过的标的（`positions` / `watchlist` / `ladder` /
 *      `myPlan` / `concepts.members` / `boards.rep`）—— 素材里没有的票，剔除并记录；
 *   2. **方向名逐字反查**：`sectors[].name` 必须在素材声明的 `sectorUniverse` 里**逐字**命中
 *      （行情板块榜名 / 自挖类名）—— 自造板块名 = 剔除并记录；
 *   3. **引文反查**：`evidence` 每条要求能逐字或数字回到素材（抓编造的数字与不存在的名字）。
 *
 * ⚠️ 边界要说清：**引文反查是"逐字/数字"级别的抽查，不是语义校验**——
 * 它能抓住"编了一个数字""编了一个不存在的名字"，抓不出"引用了真数字但结论是曲解的"。
 * 界面上如实标注"可反查 N/M 条"，不假装这是事实核验。
 *
 * 纯函数、零依赖、不碰 DOM/Node —— host 半（权威执行）与单测共用同一份实现。
 */
import type { WarPlan, WarPlanGuardReport } from './ai-contract'

/**
 * 空护栏报告。
 *
 * ⚠️ 刻意**不**从 `ai-contract` 引 `emptyWarPlanGuard()`（那是个**值**引用）：
 * 本模块会被 client 半间接引用（`lib/war-plan.ts` 的 `poolOf`），而 ai-contract
 * 里装着四个任务的 prompt 模板 —— 一个值引用就把它整份打进 client bundle
 * （体积护栏实测抓过这一点，见 `lib/ai-contract.ts` 的 `AiCallMeta.contextBytes`）。
 * 所以这里只引**类型**，值自己写。
 */
function emptyGuard(): WarPlanGuardReport {
  return { droppedSymbols: [], droppedSectors: [], ungrounded: [], grounded: 0, symbolPool: 0, sectorPool: 0 }
}

/** 标准符号（SH/SZ/BJ + 6 位）。 */
const SYMBOL_RE = /(?:SH|SZ|BJ)\d{6}/g
/** 数字字面量（引文反查用）。 */
const NUMBER_RE = /\d+(?:\.\d+)?/g

/** 引文反查的判定阈值（写出来是为了能被单测与文档引用，而不是埋在 if 里）。 */
export const GROUND_MIN_DIGITS = 2
/** 素材里的名词至少要这么多个汉字，才算"够具体、能当反查依据"。 */
export const GROUND_MIN_CJK = 3
/** 报告里引文原样截断长度（太长会把界面撑坏）。 */
const QUOTE_MAX = 40

/** 素材视图（从上下文里抽出来的"能说什么"的白名单）。 */
export interface WarMaterialsView {
  /** 允许点名的标的（素材里出现过的标准符号）。 */
  symbols: Set<string>
  /** 允许使用的方向名（素材声明的板块名/自挖类名）。 */
  sectors: Set<string>
  /** 素材全部字符串值（名字逐字反查用）。 */
  values: string[]
  /** 素材 JSON 原文（数字逐字反查用）。 */
  haystack: string
}

/** 稳定序列化（循环引用不抛；与 ai-contract 的 safeStringify 同口径）。 */
function serialize(value: unknown): string {
  try {
    return JSON.stringify(value) ?? ''
  } catch {
    return ''
  }
}

/** 递归收集字符串值（深度受限：素材是我们自己组装的浅结构）。 */
function collectStrings(value: unknown, out: string[], depth = 0): void {
  if (depth > 6 || out.length > 4000) return
  if (typeof value === 'string') {
    const s = value.trim()
    if (s.length >= 2) out.push(s)
    return
  }
  if (Array.isArray(value)) {
    for (const v of value) collectStrings(v, out, depth + 1)
    return
  }
  if (value !== null && typeof value === 'object') {
    for (const v of Object.values(value as Record<string, unknown>)) collectStrings(v, out, depth + 1)
  }
}

/**
 * 兜底方向名池：上下文**没声明** `sectorUniverse` 时，从常见容器里挑 `name/label`。
 *
 * 为什么要兜底、又为什么只在这一种情况下兜底：
 *   · 护栏判"方向名合法"依据的是组装方声明的名字池。万一组装方漏了这个字段，
 *     全杀等于另一种撒谎（界面会显示"模型一个方向都没给"）；
 *   · 但**声明了却是空数组**是完全不同的一件事 —— 那是组装方在说"今天的素材里
 *     一个方向名都没有"（例如板块榜取数失败）。这时必须严格：一个方向都不许给，
 *     否则"以其他板块为基础"就破了口子。
 */
function fallbackSectorNames(context: unknown): string[] {
  const found: string[] = []
  if (context === null || typeof context !== 'object' || Array.isArray(context)) return found
  const containers = ['boards', 'concepts', 'ladder', 'pulses', 'sectors']
  for (const key of containers) {
    const arr = (context as Record<string, unknown>)[key]
    if (!Array.isArray(arr)) continue
    for (const item of arr) {
      if (item === null || typeof item !== 'object' || Array.isArray(item)) continue
      for (const f of ['name', 'label', 'board']) {
        const v = (item as Record<string, unknown>)[f]
        if (typeof v === 'string' && v.trim() !== '') found.push(v.trim())
      }
    }
  }
  return found
}

/** 从素材上下文抽出白名单视图。 */
export function materialsOf(context: unknown): WarMaterialsView {
  const haystack = serialize(context)
  const symbols = new Set<string>()
  for (const m of haystack.matchAll(SYMBOL_RE)) symbols.add(m[0].toUpperCase())

  const sectors = new Set<string>()
  const declared = (context as { sectorUniverse?: unknown } | null)?.sectorUniverse
  if (Array.isArray(declared)) {
    // 声明了就**只**认它（空数组 = 今天一个方向名都没有，见 fallbackSectorNames 的注释）
    for (const s of declared) if (typeof s === 'string' && s.trim() !== '') sectors.add(s.trim())
  } else {
    for (const n of fallbackSectorNames(context)) sectors.add(n)
  }

  const values: string[] = []
  collectStrings(context, values)
  return { symbols, sectors, values, haystack }
}

/** 一段引文是否能在素材里落地（数字或素材里的名字被逐字引用）。 */
export function evidenceGrounded(text: string, m: WarMaterialsView): boolean {
  if (typeof text !== 'string' || text.trim() === '') return false
  // ① 数字：≥2 位的数字字面量出现在素材原文里（挡"凭空写了个 12.3%"）
  for (const n of text.match(NUMBER_RE) ?? []) {
    if (n.length >= GROUND_MIN_DIGITS && m.haystack.includes(n)) return true
  }
  // ② 名字：引文里**逐字含**素材里的某个名词（板块名/票名/事件描述…）
  //
  // 方向是"引文包含素材串"（而不是"素材串包含引文"）：模型的引文必然是
  // 「名字 + 它自己的解读」（"机器人概念 5 家涨停"），要反查的是名字那一截。
  // 素材串要求 ≥{@link GROUND_MIN_CJK} 个汉字，避免"涨停""板块"这类两字泛词把什么都判成落地。
  for (const v of m.values) {
    if (cjkLength(v) >= GROUND_MIN_CJK && text.includes(v)) return true
  }
  return false
}

/** 串里的汉字个数（判"这个名字够不够具体"用）。 */
function cjkLength(s: string): number {
  let n = 0
  for (const ch of s) {
    const code = ch.codePointAt(0) ?? 0
    if (code >= 0x4e00 && code <= 0x9fa5) n += 1
  }
  return n
}

function clip(s: string): string {
  return s.length > QUOTE_MAX ? s.slice(0, QUOTE_MAX) + '…' : s
}

/**
 * 对一份已解析的作战思路执行护栏（**返回新对象**，不改入参；纯函数便于单测）。
 *
 * 剔除什么、为什么剔除，全部写进 `plan.guard` —— **不在界面上静默消失**。
 */
export function guardWarPlan(input: WarPlan, context: unknown): WarPlan {
  const m = materialsOf(context)
  const guard: WarPlanGuardReport = {
    ...emptyGuard(),
    symbolPool: m.symbols.size,
    sectorPool: m.sectors.size,
  }

  // 素材不足的回答没有可点名的东西，只回填池子规模（界面据此说明"今天没什么可看"）。
  if (input.insufficient) return { ...input, guard }

  const sectors: WarPlan['sectors'] = []
  for (const s of input.sectors) {
    if (!m.sectors.has(s.name.trim())) {
      guard.droppedSectors.push(clip(s.name))
      continue
    }
    const members: string[] = []
    for (const sym of s.members) {
      if (m.symbols.has(sym)) members.push(sym)
      else guard.droppedSymbols.push(`${sym}（方向成员·不在素材内）`)
    }
    sectors.push({ ...s, name: s.name.trim(), members })
  }

  const picks: WarPlan['picks'] = []
  const seenPick = new Set<string>()
  for (const p of input.picks) {
    if (!m.symbols.has(p.symbol)) {
      guard.droppedSymbols.push(`${p.symbol}（候选·不在素材内）`)
      continue
    }
    if (seenPick.has(p.symbol)) {
      guard.droppedSymbols.push(`${p.symbol}（候选·重复）`)
      continue
    }
    seenPick.add(p.symbol)
    picks.push(p)
  }

  const actions = input.actions.filter((a) => {
    if (m.symbols.has(a.symbol)) return true
    guard.droppedSymbols.push(`${a.symbol}（持仓动作·不在素材内）`)
    return false
  })

  const verdicts = input.verdicts.filter((v) => {
    if (m.symbols.has(v.symbol)) return true
    guard.droppedSymbols.push(`${v.symbol}（竞价判定·不在素材内）`)
    return false
  })

  const evidence = input.evidence.filter((e) => {
    if (evidenceGrounded(e, m)) {
      guard.grounded += 1
      return true
    }
    guard.ungrounded.push(clip(e))
    return true // 保留原文但标记未落地（记录而不丢弃；是否采信由用户决定）
  })

  return { ...input, sectors, picks, actions, verdicts, evidence, guard }
}
