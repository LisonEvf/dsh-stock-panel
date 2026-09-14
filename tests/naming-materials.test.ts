/**
 * tests/naming-materials.test.ts —— 命名素材归一 + **数据层契约**（`belong_board` 的字段名）。
 *
 * ## 事故背景（2026-09-14）：假数据照着错代码写，两边一起错就永远自洽
 *
 * `materials.ts` 的 `boardNameOf` 读的是 `board_name ?? name`，而真实数据层的字段是
 * **`board_symbol_name`**（见 `src/lib/stock-data.ts` 的 `BelongBoardRow` 与 `lib/ladder.ts` 的用法）。
 * 后果不是"少一类素材"：提示词第 0 条明写「没有快讯时用板块标签兜底」，而板块标签是
 * **唯一一个任何 as_of 都采得到的源**（异动/监控只有当日实时列表、封板素材只在有涨停时产出）。
 * 它一空，非交易日的类就必然 `insufficient` —— 实测 9 个类全部显示「素材不足」，一个名字都给不出来。
 *
 * 为什么单测没抓住：`tests/naming-pipeline.test.ts` 的假工具返回的是 `{ board_name: … }`，
 * 与错代码同源。所以本文件的第一条用例就是**用真字段名**（`board_symbol_name`）反向钉住它，
 * 并且钉住"漂移检测"—— 那样下次再漂，界面会把原因说成"本地契约漂移"而不是"市场没有板块"。
 *
 * 另一半是**结构标签**（`structure.ts`）：它必须完全不依赖模型与新闻，
 * 只从官方板块素材里数频次 —— 这是"素材最缺的那天列表仍然可读"的唯一保证。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  boardContractDrift,
  boardNameOf,
  boardTypeLabel,
  boardsToMaterials,
  isNarrativeBoard,
  splitBoards,
  textSimilarity,
} from '../src/host/naming/materials'
import { STRUCTURE_MIN_SHARE, structureOf, structureLine } from '../src/host/naming/structure'
import type { MaterialItem } from '../src/host/naming/types'

/** 真实 `belong_board` 返回的**字段名与类型码**（照 2026-09-14 的实测输出抄，不要凭印象改）。 */
const REAL_ROWS = [
  { board_type: '3', board_symbol_name: '福建板块' },
  { board_type: '4', board_symbol_name: '黄金概念' },
  { board_type: '5', board_symbol_name: '大盘股' },
  { board_type: '12', board_symbol_name: '铜' },
  { board_type: '12', board_symbol_name: '工业金属' },
]

test('boardNameOf 认真字段 board_symbol_name（这个字段名读错会让整条命名链路瘫痪）', () => {
  assert.equal(boardNameOf({ board_symbol_name: '铜' }), '铜')
  // 兜底字段仍要认（远端 Python MCP 的历史口径是 board_name；认少了才会出事）
  assert.equal(boardNameOf({ board_name: '酿酒' }), '酿酒')
  assert.equal(boardNameOf({ name: '白酒' }), '白酒')
  assert.equal(boardNameOf({}), '', '取不到就是空串，不猜')
})

test('splitBoards：真字段 + 数字类型码都要能切出概念/行业（并过滤非叙事词）', () => {
  const { concepts, industries } = splitBoards(REAL_ROWS)
  assert.deepEqual(concepts, ['黄金概念'], '类型码 4 = 概念，且"大盘股"是风格不是概念')
  assert.deepEqual(industries, ['铜', '工业金属'], '类型码 12 = 行业')
  // 实际数据里 board_type 也可能是数字（两套口径并存）
  assert.deepEqual(splitBoards([{ board_type: 12, board_symbol_name: '白酒' }]).industries, ['白酒'])
})

test('boardsToMaterials：一只票出「概念 / 行业」两条素材（与参考实现一致）', () => {
  const mats = boardsToMaterials('601899 紫金矿业', 'SH601899', '2026-09-11', splitBoards(REAL_ROWS))
  assert.equal(mats.length, 2)
  assert.equal(mats[0].kind, 'board_concept')
  assert.equal(mats[0].snippet, '黄金概念')
  assert.equal(mats[1].kind, 'board_industry')
  assert.equal(mats[1].snippet, '铜、工业金属')
  assert.equal(mats[1].ts, '2026-09-11 15:00', '板块归属是当日收盘口径')
  // 什么都没有 → 不产素材（而不是产一条空素材）
  assert.deepEqual(boardsToMaterials('x', 'SZ000001', '2026-09-11', { concepts: [], industries: [] }), [])
})

test('boardContractDrift：字段名取错要报"契约漂移"，正常数据一律不报', () => {
  assert.equal(boardContractDrift(REAL_ROWS), '')
  // 空行 = 没有数据，不是漂移
  assert.equal(boardContractDrift([]), '')
  // 只有地区/风格板块（有名字、有类型码）是**正常情况**，不许报漂移
  assert.equal(boardContractDrift([{ board_type: '3', board_symbol_name: '福建板块' }]), '')
  // 字段名漂移：有行、有类型码，但没有一行能取到名字
  assert.match(boardContractDrift([{ board_type: '12', board_symbol_name: undefined }]), /board_symbol_name/)
  // 类型码漂移：有行、有名字，但类型码一个都不认识
  assert.match(boardContractDrift([{ board_type: '99', board_symbol_name: '铜' }]), /board_type/)
})

test('boardTypeLabel 与叙事过滤：属性类板块词必须挡住（否则模型会拿它当主题）', () => {
  assert.equal(boardTypeLabel('12'), '行业')
  assert.equal(boardTypeLabel(4), '概念')
  assert.equal(boardTypeLabel('99'), '')
  assert.equal(isNarrativeBoard('含可转债'), false, '股本属性不是题材')
  assert.equal(isNarrativeBoard('基金重仓'), false)
  assert.equal(isNarrativeBoard('黄金概念'), true)
  // 后缀兜底：带"重仓/成份/标的/预增/预减"的都不是叙事线索
  assert.equal(isNarrativeBoard('某某成份'), false)
})

test('textSimilarity：完全相同 = 1、包含关系不会误判成重复、无关文本很低', () => {
  assert.equal(textSimilarity('所属板块', '所属板块'), 1)
  assert.equal(textSimilarity('', ''), 1)
  // 「铜、工业金属」与「铜」相似度低 → 不会被去重误删（去重阈值 0.9，只少去重、不误删）
  assert.ok(textSimilarity('铜、工业金属', '铜') < 0.5)
  assert.ok(textSimilarity('CPO概念、光通信', 'CPO概念、光通信设备') > 0.8)
})

// ───────────────────────── 结构标签（确定性、不经模型） ─────────────────────────

/** 造一条板块素材（真实结构：一只票一条，snippet 是 `、` 连接的名字）。 */
function boardItem(stock: string, kind: 'board_industry' | 'board_concept', names: string[]): MaterialItem {
  return {
    stock,
    key: `SZ${stock}`,
    source: 'belong_board',
    ts: '2026-09-11 15:00',
    title: kind === 'board_industry' ? '行业板块' : '所属板块',
    snippet: names.join('、'),
    kind,
  }
}

/** 7 只有色票：行业口径里「铜」4 只、「黄金」3 只、「小金属」1 只。 */
function metalsCorpus(): MaterialItem[] {
  return [
    boardItem('601899', 'board_industry', ['铜', '工业金属']),
    boardItem('600362', 'board_industry', ['铜']),
    boardItem('000737', 'board_industry', ['铜']),
    boardItem('603993', 'board_industry', ['铜', '小金属']),
    boardItem('600547', 'board_industry', ['黄金']),
    boardItem('600988', 'board_industry', ['黄金']),
    boardItem('601168', 'board_industry', ['黄金', '铅锌']),
  ]
}

test('structureOf：按**成员只数**数频次，取前两个够格的词做标签', () => {
  const s = structureOf(metalsCorpus(), 7)
  assert.equal(s.basis, 'industry')
  assert.equal(s.label, '铜·黄金', '同频次按名字排序；「小金属」只有 1 只 → 不够格（≥2 只共享）')
  assert.deepEqual(
    s.industry.slice(0, 2).map((t) => `${t.name}:${t.n}`),
    ['铜:4', '黄金:3'],
    '频次降序（标签取的就是这两个）',
  )
  assert.ok(
    s.industry.some((t) => t.n === 1),
    '只被 1 只票共享的词仍然如实记频次（只是不够格当标签）—— 频次表是"证据"，不参与取词也要留着',
  )
  assert.ok(s.industry.every((t) => t.n >= 1))
  // 覆盖度 = **至少命中标签里任意一个词**的成员数（不是各词命中数之和，否则会虚高）
  assert.equal(s.covered, 7)
  assert.equal(s.total, 7)
  assert.match(s.note, /官方行业板块口径/)
  assert.equal(structureLine(s), '铜·黄金（7/7 只）')
})

test('structureOf：同一只票重复提到同一个词只算一只（频次描述的是"多少只票"，不是"多少条信息"）', () => {
  const dup = [...metalsCorpus(), boardItem('601899', 'board_industry', ['铜'])]
  const s = structureOf(dup, 7)
  assert.equal(s.industry.find((t) => t.name === '铜')?.n, 4, '重复素材不得把频次顶上去')
})

test('structureOf：行业全不够格时退到概念口径（并在 basis 上如实标注）', () => {
  const items = [
    boardItem('601899', 'board_concept', ['黄金概念', '稀缺资源']),
    boardItem('600547', 'board_concept', ['黄金概念']),
    boardItem('600988', 'board_concept', ['黄金概念']),
  ]
  const s = structureOf(items, 3)
  assert.equal(s.basis, 'concept')
  assert.equal(s.label, '黄金概念')
  assert.equal(s.covered, 3)
  assert.match(s.note, /官方概念板块口径/)
})

test('structureOf：没有板块素材 / 没有成员 → 空标签（**不编造**，界面按"未命名"显示）', () => {
  assert.equal(structureOf([], 7).label, '')
  assert.equal(structureOf([], 7).basis, 'none')
  assert.equal(structureOf(metalsCorpus(), 0).label, '')
  assert.equal(structureLine(structureOf([], 7)), '', '空标签的短文案是空串，界面据此回落')
  // 每只票各挂各的（没有任何词被 ≥2 只共享）→ 也必须是空标签
  const scattered = [
    boardItem('601899', 'board_industry', ['铜']),
    boardItem('600362', 'board_industry', ['黄金']),
  ]
  assert.equal(structureOf(scattered, 2).label, '', `阈值是 ≥${STRUCTURE_MIN_SHARE} 只共享`)
})
