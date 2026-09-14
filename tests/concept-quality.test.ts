/**
 * tests/concept-quality.test.ts —— 自挖类「可采信」判据（伪类过滤）的正/负样本。
 *
 * ## 样本全部来自实测（不要凭手感改数）
 *
 * 依据 `docs/CONCEPT-CALIBRATION.md` §2 与 2026-09-13 真机探针：
 *
 * | 样本 | 规模 | 类内相关 | 强边密度 | 引擎 weak_chain | 真相 |
 * | --- | --- | --- | --- | --- | --- |
 * | 负样本 A | 194 | 0.008 | — | true | `min_corr=0.3` 时整个池连成一个类（引擎已标记） |
 * | 负样本 B | 52 | 0.428 | 0.14 | **false** | 漏网的传递链巨类（`min_corr=0.6` 也照样出现） |
 * | 正样本 | 2 | 0.701 | 1.00 | false | 「中际旭创 + 新易盛」这种真班 |
 * | 正样本 | 7 | 0.611 | 0.667 | false | 有色·贵金属 |
 * | 正样本 | 3 | 0.568 | 0.667 | false | 三角形：一条边偏弱，但它是真小班（**不许误杀**） |
 *
 * 判据是 `strongDensity < 0.5` **且** `intraCorr < minCorr` 两条同时成立；
 * 负样本 B 被拦、正样本 3 只票那条不被拦 —— 这正是"宁可放过也不误杀"的落点。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  CHAIN_MAX_DENSITY,
  classQuality,
  filterUsableClasses,
  qualityReasonLabel,
  type QualityInput,
} from '../src/lib/concept-quality'

const MIN_CORR = 0.6

/** 实测样本（顺序 = 负样本在前）。 */
const SAMPLES: Array<{ label: string; input: QualityInput; usable: boolean; reason: string }> = [
  { label: '194 只 / 0.008 / 引擎标记弱链', input: { weakChain: true, intraCorr: 0.008, strongDensity: 0.02, size: 194 }, usable: false, reason: 'weak_chain' },
  { label: '52 只 / 0.428 / 密度 0.14（引擎漏网的传递链）', input: { weakChain: false, intraCorr: 0.428, strongDensity: 0.14, size: 52 }, usable: false, reason: 'chain_suspect' },
  { label: '2 只 / 0.701 / 密度 1.00（光模块）', input: { weakChain: false, intraCorr: 0.701, strongDensity: 1, size: 2 }, usable: true, reason: 'ok' },
  { label: '7 只 / 0.611 / 密度 0.667（有色·贵金属）', input: { weakChain: false, intraCorr: 0.6113, strongDensity: 0.667, size: 7 }, usable: true, reason: 'ok' },
  { label: '3 只 / 0.568 / 密度 0.667（三角形，一条边偏弱）', input: { weakChain: false, intraCorr: 0.568, strongDensity: 0.667, size: 3 }, usable: true, reason: 'ok' },
]

test('★ 实测负样本被拦、正样本不被误杀（判据的落点）', () => {
  for (const s of SAMPLES) {
    const q = classQuality(s.input, MIN_CORR)
    assert.equal(q.usable, s.usable, `${s.label}：可采信应为 ${s.usable}（实际 ${q.usable}，${q.note}）`)
    assert.equal(q.reason, s.reason, `${s.label}：原因应为 ${s.reason}`)
    if (!q.usable) assert.ok(q.note.length > 10, '被拦必须给出可读原因（不许静默丢弃）')
  }
})

test('两条条件必须**同时**成立才拦（单看任一条都会误杀真班）', () => {
  // 相关低但密度高（3 只票的紧三角）→ 放过
  assert.equal(classQuality({ intraCorr: 0.4, strongDensity: 0.9, size: 3 }, MIN_CORR).usable, true)
  // 密度低但相关够（成员多、平均仍高于阈值）→ 放过
  assert.equal(classQuality({ intraCorr: 0.65, strongDensity: 0.2, size: 30 }, MIN_CORR).usable, true)
  // 两条都踩 → 拦
  assert.equal(classQuality({ intraCorr: 0.59, strongDensity: 0.49, size: 30 }, MIN_CORR).usable, false)
})

test('判据跟着**实际使用的阈值**走（参数一改，结论要跟着改）', () => {
  const row: QualityInput = { intraCorr: 0.45, strongDensity: 0.3, size: 20 }
  assert.equal(classQuality(row, 0.6).usable, false, 'min_corr=0.6 下这是传递链')
  assert.equal(classQuality(row, 0.4).usable, true, 'min_corr=0.4 下同一个类内相关已高于阈值')
  assert.equal(CHAIN_MAX_DENSITY, 0.5, '密度阈值是可调常数：改它必须同时改本测试与 concept-quality.ts 的注释')
})

test('缺字段 = 信息不足 → 不拦（宁缺勿误杀：引擎换了字段名不该让整张列表消失）', () => {
  assert.equal(classQuality({}, MIN_CORR).usable, true)
  assert.equal(classQuality({ intraCorr: Number.NaN, strongDensity: undefined }, MIN_CORR).usable, true)
  assert.equal(classQuality({ intraCorr: 0.428, strongDensity: 0.14 }, 0.6).usable, false, '两个都给了才判')
})

test('filterUsableClasses：**不丢信息**（被拦下的原样留在 dropped 里，并按原因计数）', () => {
  const rows = SAMPLES.map((s, i) => ({ classId: i + 1, ...s.input }))
  const out = filterUsableClasses(rows, MIN_CORR)
  assert.equal(out.usable.length, 3)
  assert.equal(out.dropped.length, 2)
  assert.deepEqual(out.byReason, { weak_chain: 1, chain_suspect: 1 })
  // 被拦下的行必须能原样取回（界面要靠它显示"排除了哪几个、为什么"）
  assert.deepEqual(out.dropped.map((d) => d.row.classId).sort(), [1, 2])
  assert.equal(out.dropped[1].quality.reason, 'chain_suspect')
  // 顺序：可采信的保持输入顺序（排序是调用方的事，过滤不该改序）
  assert.deepEqual(out.usable.map((r) => r.classId), [3, 4, 5])
})

test('原因标签是界面与文档共用的同一份文案', () => {
  assert.equal(qualityReasonLabel('ok'), '可采信')
  assert.equal(qualityReasonLabel('weak_chain'), '弱链伪类')
  assert.equal(qualityReasonLabel('chain_suspect'), '传递链可疑')
})
