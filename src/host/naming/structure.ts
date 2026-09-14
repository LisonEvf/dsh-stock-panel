/**
 * src/host/naming/structure.ts —— 自挖类的「结构标签」（**确定性**，不经模型）。
 *
 * ## 为什么必须有它（而不是只靠模型命名）
 *
 * 模型命名有一条设计上的硬约束：**没有素材就不许起名字**（三态里的 `insufficient`）。
 * 这条约束本身是对的（它防的是"给噪声编故事"），但它有一个必然的副作用：
 * 素材最缺的那一天（非交易日 / 实时源按设计跳过 / 成员都没涨停），**整张类列表一个标签都没有** ——
 * 实测 2026-09-13：9 个可采信类全部显示「素材不足」，而它们的成员是
 * 「西安奕材-U / 恒坤新材 / 中巨芯-U / 兴福电子」这种一眼能看懂的东西。
 * 界面上只剩一串股票名，用户没法扫、没法比较、也没法记 —— 这等于把"分类"这件事做没了。
 *
 * 所以这里补一个**不需要模型、不需要新闻、任何 as_of 都成立**的标签来源：
 * 成员所属的**官方行业/概念板块**里，被**多只**成员共享的那些词（`belong_board` 素材）。
 *
 * ## 与「模型主题名」的分工（不许混为一谈）
 *
 * | | 结构标签（本模块） | 模型主题名（`run.ts`） |
 * | --- | --- | --- |
 * | 来源 | 厂商板块归属（分类学） | 窗口内的快讯事件 / 板块标签 + 护栏 |
 * | 能回答 | "这个班**像**什么" | "它们今天**为什么**一起动" |
 * | 可证伪性 | 完全可复算（频次），无幻觉空间 | 引文逐字反查后才算数 |
 * | 何时没有 | 成员板块数据缺失 | 素材不足 / 模型不可用 / 护栏拒 |
 *
 * 界面必须**分色分区**地同时显示两者：结构标签是"骨架"，模型主题名是"结论"。
 * 用模型结论去覆盖结构标签（或反过来）都会让人误读来源 —— 那是本项目最忌讳的一类错。
 *
 * ## 为什么从语料里算，而不是再调一次 `belong_board`
 *
 * 批量命名本来就要为所有成员采一次 `belong_board`（见 `collect.ts`），
 * 逐组切分后的语料里就带着每个成员的行业/概念板块行。在这里**纯函数**地数频次 =
 * 0 次额外请求、0 次额外模型调用，而且与模型看到的素材**逐字同源**
 * （模型说"有色金属"、结构标签说"铜·黄金"时，人能立刻看出这是两种口径而不是矛盾）。
 *
 * ## 阈值为什么是"≥2 只共享"
 *
 * 一只票自带的板块标签不是"这个班的性质"（人人都有一堆标签，且各不相同）。
 * 只有被**多只**成员共享的词才描述了类的共性，所以 `minShare = 2` 是硬下限；
 * 并且界面**必须**显示覆盖度（`covered/total`）—— 一个 3/7 的标签是"部分成员的共性"，
 * 不标覆盖就会被当成全类属性（那是另一种形式的编故事）。
 */
import type { MaterialItem } from './types'

/** 一个板块词的频次（按**成员只数**计，不是按出现次数 —— 同一只票重复提到只算一次）。 */
export interface StructureTally {
  /** 板块名（官方行业/概念口径的原始词，不改写）。 */
  name: string
  /** 有多少只成员挂着这个词。 */
  n: number
}

/** 一个类的结构标签（进命名 payload，界面直接渲染）。 */
export interface ClassStructure {
  /** 行业口径频次（降序，最多留 `TOP_N` 个）。 */
  industry: StructureTally[]
  /** 概念口径频次（降序，最多留 `TOP_N` 个）—— 噪声大，只作兜底与佐证。 */
  concept: StructureTally[]
  /**
   * 可直接显示的结构标签（1–2 个词，`·` 连接）；`''` = 没有任何词被 ≥2 只成员共享。
   * 取词顺序：够格的行业词优先，全都没有时才退到概念词。
   */
  label: string
  /** 标签取词的口径（`industry` / `concept` / `none`）—— 界面要说清这个标签是哪种口径。 */
  basis: 'industry' | 'concept' | 'none'
  /** 标签命中的成员只数（至少命中标签里任意一个词的）。 */
  covered: number
  /** 成员总数（= 类的规模，作为覆盖度分母；与"有板块数据的成员数"分开报）。 */
  total: number
  /** 人读口径说明（进 title，不进正文：正文位置要留给标签本身）。 */
  note: string
}

/** 每个口径最多保留几个候选词（界面只显示前 1–2 个，其余进 title）。 */
const TOP_N = 4

/** 一个词至少要几只成员共享才算"类的共性"。 */
export const STRUCTURE_MIN_SHARE = 2

/** 空结构（没有任何板块素材时）。 */
export function emptyStructure(total: number): ClassStructure {
  return {
    industry: [],
    concept: [],
    label: '',
    basis: 'none',
    covered: 0,
    total,
    note: total > 0 ? `${total} 只成员都没有可用的板块归属数据（belong_board 无产出）` : '没有成员',
  }
}

/** 把一行板块素材的 `snippet`（`、` 连接）拆成去重后的词表。 */
function splitBoardWords(snippet: string): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  for (const raw of String(snippet ?? '').split(/[、,，/|]/)) {
    const w = raw.trim()
    if (w === '' || seen.has(w)) continue
    seen.add(w)
    out.push(w)
  }
  return out
}

/**
 * 数一个口径的频次：**按成员只数**计。
 *
 * 为什么要按成员去重而不是直接数出现次数：同一只票可能同时挂「铜」和「工业金属」，
 * 也可能在语料里出现两条同类素材（配额/去重都可能放过）。按出现次数数，
 * 一只票就能把一个词顶到第一 —— 那描述的是"信息量"，不是"多少只票是这样"。
 */
function tallyOf(items: readonly MaterialItem[], kind: MaterialItem['kind']): { tally: StructureTally[]; memberHits: Map<string, Set<string>> } {
  const perMember = new Map<string, Set<string>>()
  for (const it of items) {
    if (it.kind !== kind) continue
    const key = it.key !== '' ? it.key : it.stock
    let set = perMember.get(key)
    if (set === undefined) {
      set = new Set<string>()
      perMember.set(key, set)
    }
    for (const w of splitBoardWords(it.snippet)) set.add(w)
  }
  const counts = new Map<string, number>()
  const memberHits = new Map<string, Set<string>>()
  for (const [member, words] of perMember) {
    for (const w of words) {
      counts.set(w, (counts.get(w) ?? 0) + 1)
      const hits = memberHits.get(w)
      if (hits === undefined) memberHits.set(w, new Set([member]))
      else hits.add(member)
    }
  }
  const tally = [...counts.entries()]
    .map(([name, n]) => ({ name, n }))
    .sort((a, b) => (b.n !== a.n ? b.n - a.n : a.name.localeCompare(b.name, 'zh')))
  return { tally: tally.slice(0, TOP_N), memberHits }
}

/**
 * 从（某一组的）语料里算出结构标签。
 *
 * `total` 是**类规模**（成员总数），不是"有板块数据的成员数"：
 * 覆盖度要按"这个班总共几只票"来报，否则 4/4 与 4/12 会长得一模一样。
 */
export function structureOf(items: readonly MaterialItem[], total: number): ClassStructure {
  const n = Math.max(total, 0)
  if (n === 0) return emptyStructure(0)
  const boardItems = items.filter((i) => i.kind === 'board_industry' || i.kind === 'board_concept')
  if (boardItems.length === 0) return emptyStructure(n)

  const industry = tallyOf(boardItems, 'board_industry')
  const concept = tallyOf(boardItems, 'board_concept')

  /** 够格的词（≥ `STRUCTURE_MIN_SHARE` 只成员共享）。 */
  const qualify = (t: StructureTally[]): StructureTally[] => t.filter((x) => x.n >= STRUCTURE_MIN_SHARE)
  const indQualified = qualify(industry.tally)
  const conQualified = qualify(concept.tally)
  const basis: ClassStructure['basis'] = indQualified.length > 0 ? 'industry' : conQualified.length > 0 ? 'concept' : 'none'
  const picked = (basis === 'industry' ? indQualified : conQualified).slice(0, 2)
  const hits = basis === 'industry' ? industry.memberHits : concept.memberHits

  // 覆盖度 = **至少命中标签里任意一个词**的成员只数（不是各词命中数之和：
  // 一只票同时挂「铜」和「黄金」时只能算一只，否则会出现 7/7 这种虚高覆盖）
  const coveredSet = new Set<string>()
  for (const p of picked) for (const m of hits.get(p.name) ?? []) coveredSet.add(m)

  const label = picked.map((p) => p.name).join('·')
  const wordNote = picked.map((p) => `${p.name} ${p.n}/${n}`).join('、')
  const note =
    label === ''
      ? `${n} 只成员里没有任何板块词被 ${STRUCTURE_MIN_SHARE} 只以上共享（官方行业/概念口径，非模型结论）`
      : `结构标签（官方${basis === 'industry' ? '行业' : '概念'}板块口径，${STRUCTURE_MIN_SHARE} 只以上成员共享）：${wordNote}`
        + ` —— 只说明"这些票被官方分类学归到同一处"，与"今天为什么一起动"（模型主题名）是两件事`

  return { industry: industry.tally, concept: concept.tally, label, basis, covered: coveredSet.size, total: n, note }
}

/** 结构标签的一行短文案（界面/诊断共用一处，避免两处各拼一遍）。 */
export function structureLine(s: ClassStructure | null | undefined): string {
  if (s === null || s === undefined || s.label === '') return ''
  return `${s.label}（${s.covered}/${s.total} 只）`
}
