/**
 * 相对强度差分（N3：strength.ts）。
 *
 * 依据 WATCH-METHODOLOGY §4.2「强弱 = 相对强度的差分，不是绝对涨幅」与
 * PRODUCT-DESIGN §4.3 的 classifyStrength 骨架，把「真强 / 惯性 / 转弱 /
 * 弱转强 / 平」从可测连续量（当日涨跌幅、5 日累计、3 日动量差分、量比、
 * 是否涨停、连板）判定出来，供复盘「时空定性」与盘中「Q1 持续性增减」使用。
 *
 * 证据级：D（经验阈值，跨样本不稳）——阈值集中到文件顶部常量，
 * 用自身历史校准后再定死，禁止当常数用（见 STRATEGY-RESEARCH 顶部警告）。
 */

import { fetchKlineRows } from './stock-data'
import { runPool } from './pool'
import { countStreak } from './indicators'

/** 单只候选的强度行（输入，≤120 只）。 */
export interface StrengthRow {
  symbol: string // 'SH603138'
  market: 'SH' | 'SZ' | 'BJ'
  code: string
  name: string
  /** 当日涨跌幅（%）。 */
  pct_today: number
  /** 5 日累计涨幅（%）——空间。 */
  cum5: number
  /**
   * 3 日动量差分：
   *   (近 3 日涨跌幅之和) - (前 3 日涨跌幅之和)
   * 正值 = 动能增强，负值 = 动能衰减。
   */
  delta3: number
  /** 当日量 / 5 日均量（量比近似）。 */
  volRatio: number
  /** 当日是否封涨停（close ≈ 涨停价）。 */
  atLimit: boolean
  /** 连板数（0 = 未涨停或未知）。 */
  streak: number
  /** 距 52 周新高的接近度（0-1，1 = 创新高）。由上层补充，缺省 0。 */
  distTo52WHigh?: number
}

/** 强度判定（WATCH-METHODOLOGY §4.2）。 */
export type StrongKind =
  | 'trueStrong' // 真强：放量封板且动能增强
  | 'inertia' // 假强：惯性封板（ΔR<0，昨日强者的余温）
  | 'weakening' // 转弱：高位放量滞涨
  | 'weak2strong' // 弱转强：ΔR 快速转正 + 放量
  | 'flat' // 平

/** 阈值（经验 C/D 级，集中可配，须用自身历史校准）。 */
export interface StrengthThresholds {
  /** 封板且量比≥此值、Δ3≥0 → 真强。 */
  volRatioStrong: number
  /** 封板但 Δ3<0 → 惯性（假强）。 */
  // 用 Δ3<0 区分，无需额外阈值
  /** 高位（cum5 超此值）放量（量比≥volRatioWeak）且当日跌 → 转弱。 */
  cum5High: number
  volRatioWeak: number
  /** 弱转强：未涨停但 Δ3>0 且量比≥此值。 */
  volRatioWeak2Strong: number
  /** 52 周高点锚点：距高点近（≥0.9）时放量突破更可信。 */
  highNear: number
}

export const DEFAULT_STRENGTH_THRESHOLDS: StrengthThresholds = {
  volRatioStrong: 1.2,
  cum5High: 15,
  volRatioWeak: 2,
  volRatioWeak2Strong: 1.5,
  highNear: 0.9,
}

/**
 * 判定单只标的的强度类别（WATCH-METHODOLOGY §4.2 三件套：
 * 同层级相对强度差分 + 量价 + 结构）。
 *
 * ⚠️ 修复记录（B4 单测抓到）：前两条判断此前写成 `&& t.volRatioWeak` / `&& t.volRatioStrong`
 * —— 那是**对数字取真值**，阈值本身恒为真（默认 2 / 1.2），等于"量比"根本没参与判断：
 * 缩量一字板也会被叫「真强」。现在改成真正的比较 `r.volRatio >= t.*`。
 * 这会让一部分原先被判成真强的标的落到 flat —— 那是修对了，不是回归。
 */
export function classifyStrength(r: StrengthRow, t: StrengthThresholds = DEFAULT_STRENGTH_THRESHOLDS): StrongKind {
  // 高位放量滞涨（连板高位 + 量比放大 + 当日收跌）→ 转弱预警
  if (!r.atLimit && r.cum5 > t.cum5High && r.volRatio >= t.volRatioWeak && r.pct_today < 0) return 'weakening'
  // 封板但动能衰减（Δ3<0）→ 惯性假强：昨日强者的余温
  if (r.atLimit && r.delta3 < 0) return 'inertia'
  // 封板 + 放量 + 动能增强 → 真强
  if (r.atLimit && r.volRatio >= t.volRatioStrong && r.delta3 >= 0) return 'trueStrong'
  // 未涨停但动能快速转正 + 放量 → 弱转强候选
  if (!r.atLimit && r.delta3 > 0 && r.volRatio >= t.volRatioWeak2Strong) return 'weak2strong'
  return 'flat'
}

/** 判定文本（供 UI 徽标 / 标签）。 */
export function strongKindLabel(kind: StrongKind): string {
  switch (kind) {
    case 'trueStrong': return '真强'
    case 'inertia': return '惯性'
    case 'weakening': return '转弱'
    case 'weak2strong': return '弱转强'
    default: return '平'
  }
}

/** 判定颜色（A 股语义，红涨绿跌，陷阱橙色）。 */
export function strongKindColor(kind: StrongKind): string {
  switch (kind) {
    case 'trueStrong':
    case 'weak2strong': return '#c74040' // 红：强
    case 'inertia': return '#c74040' // 红但需谨慎（惯性）
    case 'weakening': return '#2d9b65' // 绿：弱
    default: return '#94a3b8' // 灰：平
  }
}

/** 单日涨跌幅（由相邻两根 K 的收盘算，%）。 */
function dailyPct(cur: { close: number }, prev: { close: number }): number {
  if (!prev || !prev.close || prev.close <= 0) return 0
  return ((cur.close - prev.close) / prev.close) * 100
}

/**
 * 对单只候选拉 DAILY(5) K 线算强度行。
 * 输入：market, code, name（≤120 只时用 runPool 并行）。
 * 失败返回 null（不抛断整体）。
 */
export async function computeStrength(
  market: 'SH' | 'SZ' | 'BJ',
  code: string,
  name: string
): Promise<StrengthRow | null> {
  try {
    const kl = await fetchKlineRows(market, code, 'DAILY', 5)
    if (!kl || kl.length < 5) return null
    // kl 升序（旧→新），末根为当日
    const pcts: number[] = []
    for (let i = 1; i < kl.length; i++) {
      pcts.push(dailyPct(kl[i], kl[i - 1]))
    }
    // pcts[i] = 第 i 根相对第 i-1 根；长度 = kl.length-1
    const pct_today = pcts[pcts.length - 1]
    // 5 日累计 = 各日涨跌幅连乘（几何累计）
    let cum5 = 1
    for (const p of pcts) cum5 *= 1 + p / 100
    cum5 = (cum5 - 1) * 100
    // 3 日动量差分：近 3 日之和 - 前 3 日之和
    const n = pcts.length
    const recent3 = pcts.slice(Math.max(0, n - 3), n).reduce((a, b) => a + b, 0)
    const prior3 = pcts.slice(Math.max(0, n - 6), Math.max(0, n - 3)).reduce((a, b) => a + b, 0)
    const delta3 = recent3 - prior3
    // 量比近似：当日量 / 前 5 日平均量
    let volRatio = 0
    const vols = kl.map((k) => Number(k.volume ?? k.vol ?? 0)).filter((v) => v > 0)
    if (vols.length >= 2) {
      const lastVol = vols[vols.length - 1]
      const avg5 = vols.slice(0, -1).reduce((a, b) => a + b, 0) / Math.max(1, vols.length - 1)
      volRatio = avg5 > 0 ? lastVol / avg5 : 0
    }
    // 是否涨停：按代码规则算出的涨跌停幅度判定（下面 atLimitFinal）；
    // 这里删掉过一段更早的临时判定（含 `last.open > 0 ? 1 : 1` 这种恒真三元），它从未被使用，
    // 连带它引用的 last/prev 也一并删掉（保留会让死代码继续看起来"有人用"）。
    // 简单判定：当日涨幅≈10%/20%/30%（按代码规则）视为涨停
    const { limitUpPct } = await import('./indicators')
    const limPct = limitUpPct(code, name)
    const atLimitFinal = Math.abs(pct_today - limPct) < 0.3 || pct_today >= limPct * 0.99
    // 连板数
    const streak = countStreak(kl, code, name).streak
    return {
      symbol: `${market}${code}`,
      market,
      code,
      name,
      pct_today,
      cum5,
      delta3,
      volRatio,
      atLimit: atLimitFinal,
      streak,
    }
  } catch {
    return null
  }
}

/**
 * 批量计算强度（≤120 只，pool≤6 并发）。
 * 返回非 null 的强度行数组。
 */
export async function computeStrengthBatch(
  candidates: { market: 'SH' | 'SZ' | 'BJ'; code: string; name: string }[],
  concurrency = 6
): Promise<StrengthRow[]> {
  const results = await runPool(candidates, (c) => computeStrength(c.market, c.code, c.name), { concurrency })
  return results.filter((r): r is StrengthRow => !!r)
}

/**
 * 低位首板候选（N3 复盘辅助，替代大而全选股器）。
 * 依据 WATCH-METHODOLOGY §3「第 1 天可试错」与 §5.2「新方向启动」：
 * 当日首板（streak===1，非一字）、量价健康（量比 1.5~5）、
 * 位置低（cum5 不高）、板块有扩散。
 *
 * 输入：已算好的强度行 + 板块信息（boardLimitUp / boardTotalLimitUp）。
 */
export interface LowBoardCandidate {
  row: StrengthRow
  boardConcentration: number // 所属板块涨停数 / 全市场涨停数（扩散度）
  score: number // 综合评分（经验，仅供排序）
}

export function scoreLowBoardCandidate(row: StrengthRow, boardConcentration: number): number {
  let score = 0
  // 首板加分，一字板减分（开板更真实）
  if (row.streak >= 1) score += 20
  // 量比健康区间（1.5~5）加分，巨量（>5）减分
  if (row.volRatio >= 1.5 && row.volRatio <= 5) score += 15
  else if (row.volRatio > 5) score -= 10
  // 位置低（cum5 低）加分
  if (row.cum5 < 5) score += 15
  else if (row.cum5 > 20) score -= 15
  // 动能增强（delta3>0）加分
  if (row.delta3 > 0) score += 10
  // 板块扩散
  score += boardConcentration * 100
  return score
}

/** 过滤 + 排序出低位首板候选（≤30）。 */
export function selectLowBoardCandidates(
  rows: StrengthRow[],
  boardConcentration: (code: string) => number,
  limit = 30
): LowBoardCandidate[] {
  const cands: LowBoardCandidate[] = []
  for (const row of rows) {
    // 只取当日首板（streak===1 且当日涨停），非首板/未涨停不取
    if (row.streak !== 1 || !row.atLimit) continue
    // 位置不能太高（cum5 过高=已发酵，非低位首板）
    if (row.cum5 > 10) continue
    cands.push({ row, boardConcentration: boardConcentration(row.code), score: 0 })
  }
  for (const c of cands) c.score = scoreLowBoardCandidate(c.row, c.boardConcentration)
  return cands.sort((a, b) => b.score - a.score).slice(0, limit)
}
