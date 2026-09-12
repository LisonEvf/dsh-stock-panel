/**
 * tests/strength.test.ts —— 相对强度差分与低位首板候选的单元测试（B4）。
 *
 * 为什么必须锁住它：`classifyStrength` 是复盘「时空定性」与盘中 Q1 的判据来源，
 * 它输出的是**中文结论**（真强/惯性/转弱/弱转强），一旦规则被改坏，界面照样显示
 * 一个像样的标签 —— 看不出错。这里把 WATCH-METHODOLOGY §4.2 的规则写成可执行契约。
 *
 * 本文件同时是**两条真实缺陷的回归锁**：
 *   [1] 量比阈值此前被写成 `&& t.volRatioStrong`（对数字取真值，恒真）→ 量比从未参与判断，
 *       缩量一字板也被判「真强」；现已改为 `r.volRatio >= t.*`。
 *   [2] 阈值全部来自 `DEFAULT_STRENGTH_THRESHOLDS`，必须通过**显式传阈值**验证边界，
 *       否则以后有人把默认值改松，测试会跟着一起变松（假绿）。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  DEFAULT_STRENGTH_THRESHOLDS,
  classifyStrength,
  scoreLowBoardCandidate,
  selectLowBoardCandidates,
  strongKindColor,
  strongKindLabel,
  type StrengthRow,
  type StrongKind,
} from '../src/lib/strength.ts'

/** 中性基准行：量比 1.0 / 未涨停 / 动能平，改一项做对照。 */
function row(patch: Partial<StrengthRow> = {}): StrengthRow {
  return {
    symbol: 'SH600000',
    market: 'SH',
    code: '600000',
    name: '测试股',
    pct_today: 0,
    cum5: 0,
    delta3: 0,
    volRatio: 1,
    atLimit: false,
    streak: 0,
    ...patch,
  }
}

test('阈值默认值是契约（要改必须同时改这条测试，避免偷偷放松）', () => {
  assert.equal(DEFAULT_STRENGTH_THRESHOLDS.volRatioStrong, 1.2)
  assert.equal(DEFAULT_STRENGTH_THRESHOLDS.cum5High, 15)
  assert.equal(DEFAULT_STRENGTH_THRESHOLDS.volRatioWeak, 2)
  assert.equal(DEFAULT_STRENGTH_THRESHOLDS.volRatioWeak2Strong, 1.5)
})

test('★ 回归：真强必须真的放量（缩量封板不得判真强）', () => {
  // 修复前：这两行都会返回 trueStrong（量比阈值恒真）
  assert.equal(classifyStrength(row({ atLimit: true, delta3: 1, volRatio: 1 })), 'flat', '量比 1.0 < 1.2 → 不是真强')
  assert.equal(classifyStrength(row({ atLimit: true, delta3: 1, volRatio: 1.2 })), 'trueStrong', '量比刚好 1.2 → 真强')
  assert.equal(classifyStrength(row({ atLimit: true, delta3: 1, volRatio: 3 })), 'trueStrong', '明显放量 → 真强')
})

test('★ 回归：转弱预警必须真的放量（无量阴跌不算「放量滞涨」）', () => {
  const high = { cum5: 20, pct_today: -2 }
  assert.equal(classifyStrength(row({ ...high, volRatio: 1.9 })), 'flat', '量比 1.9 < 2 → 不判转弱')
  assert.equal(classifyStrength(row({ ...high, volRatio: 2 })), 'weakening', '量比 2 → 转弱')
  // 位置不高时即使放量大跌也不算「高位滞涨」（是别的故事）
  assert.equal(classifyStrength(row({ cum5: 5, pct_today: -2, volRatio: 3 })), 'flat', 'cum5 未过高位线 → 不判转弱')
})

test('五类判定的完整分支（含优先级：惯性优先于真强）', () => {
  // 惯性：封板但 Δ3<0 —— 哪怕放量也先判惯性（昨日强者的余温）
  assert.equal(classifyStrength(row({ atLimit: true, delta3: -0.5, volRatio: 3 })), 'inertia')
  // 弱转强：未涨停 + Δ3>0 + 放量
  assert.equal(classifyStrength(row({ atLimit: false, delta3: 0.5, volRatio: 1.5 })), 'weak2strong')
  assert.equal(classifyStrength(row({ atLimit: false, delta3: 0.5, volRatio: 1.49 })), 'flat', '差一点就是 flat，不四舍五入')
  // 弱转强不看 cum5（低位/高位都可能），但一旦 cum5 高位**且放量**且当日收跌，会先被转弱截走
  assert.equal(
    classifyStrength(row({ atLimit: false, delta3: 0.5, volRatio: 2.5, cum5: 30, pct_today: -3 })),
    'weakening',
    '高位+放量+收跌 → 转弱优先于弱转强',
  )
  assert.equal(
    classifyStrength(row({ atLimit: false, delta3: 0.5, volRatio: 1.5, cum5: 30, pct_today: -3 })),
    'weak2strong',
    '量比只有 1.5 时不算「放量滞涨」，回落到弱转强',
  )
  // 平：什么都不满足
  assert.equal(classifyStrength(row()), 'flat')
})

test('自定义阈值真的生效（阈值是参数，不是硬编码）', () => {
  const loose = { ...DEFAULT_STRENGTH_THRESHOLDS, volRatioStrong: 0.5 }
  assert.equal(classifyStrength(row({ atLimit: true, delta3: 1, volRatio: 0.8 }), loose), 'trueStrong', '放松阈值后 0.8 也算放量')
  assert.equal(classifyStrength(row({ atLimit: true, delta3: 1, volRatio: 0.8 })), 'flat', '默认阈值下同一行不是真强')
})

test('标签与颜色覆盖全部类别（界面不出现英文枚举）', () => {
  const kinds: StrongKind[] = ['trueStrong', 'inertia', 'weakening', 'weak2strong', 'flat']
  const labels = kinds.map((k) => strongKindLabel(k))
  assert.equal(new Set(labels).size, kinds.length, `标签互不相同（${labels.join('/')}）`)
  for (const k of kinds) {
    assert.ok(strongKindLabel(k).length > 0 && !strongKindLabel(k).includes(k), `${k} → ${strongKindLabel(k)}`)
    assert.match(strongKindColor(k), /^#[0-9a-f]{6}$/i, `${k} 颜色为 hex`)
  }
  // A 股语义：转弱用绿（跌色），不得跟着真强写成红
  assert.notEqual(strongKindColor('weakening'), strongKindColor('trueStrong'), '转弱与真强必须不同色')
})

test('低位首板候选评分方向性（评分只用于排序，但方向不能反）', () => {
  const base = row({ atLimit: true, streak: 1, volRatio: 2, cum5: 2, delta3: 1 })
  const healthy = scoreLowBoardCandidate(base, 0)
  assert.ok(scoreLowBoardCandidate({ ...base, volRatio: 8 }, 0) < healthy, '巨量（>5）应比健康量能得分低')
  assert.ok(scoreLowBoardCandidate({ ...base, cum5: 30 }, 0) < healthy, '位置已高（cum5>20）应减分')
  assert.ok(scoreLowBoardCandidate({ ...base, delta3: -1 }, 0) < healthy, '动能衰减应减分')
  assert.ok(scoreLowBoardCandidate(base, 0.1) > healthy, '板块扩散（集中度）应加分')
  assert.equal(scoreLowBoardCandidate(base, 0) - healthy, 0, '同输入评分稳定（无隐藏状态）')
})

test('低位首板筛选：只留「当日首板 + 位置低」，并按分数降序、条数受限', () => {
  const mk = (code: string, patch: Partial<StrengthRow>) => row({ code, symbol: `SH${code}`, ...patch })
  const rows: StrengthRow[] = [
    mk('600001', { atLimit: true, streak: 1, cum5: 3, volRatio: 2, delta3: 1 }), // ✅ 低位首板
    mk('600002', { atLimit: true, streak: 2, cum5: 3, volRatio: 2 }), // ❌ 二板
    mk('600003', { atLimit: false, streak: 1, cum5: 3, volRatio: 2 }), // ❌ 未涨停（streak 可疑）
    mk('600004', { atLimit: true, streak: 1, cum5: 12, volRatio: 2 }), // ❌ 位置已高
    mk('600005', { atLimit: true, streak: 1, cum5: 4, volRatio: 1, delta3: -1 }), // ✅ 但分低
  ]
  const got = selectLowBoardCandidates(rows, () => 0)
  assert.deepEqual(got.map((c) => c.row.code), ['600001', '600005'], '只留两只合格候选，且高分在前')
  assert.ok(got[0].score >= got[1].score, '降序排列')

  // limit 生效（用 40 只合格标的验证截断）
  const many = Array.from({ length: 40 }, (_, i) =>
    mk(String(600100 + i), { atLimit: true, streak: 1, cum5: 1, volRatio: 2, delta3: 1 }),
  )
  assert.equal(selectLowBoardCandidates(many, () => 0).length, 30, '默认上限 30')
  assert.equal(selectLowBoardCandidates(many, () => 0, 5).length, 5, 'limit 可覆盖')
  // cum5 恰好 10 应保留（边界是 `> 10` 才剔除）
  assert.equal(selectLowBoardCandidates([mk('600006', { atLimit: true, streak: 1, cum5: 10, volRatio: 2 })], () => 0).length, 1)
})
