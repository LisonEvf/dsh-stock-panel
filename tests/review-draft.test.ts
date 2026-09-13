/**
 * tests/review-draft.test.ts —— 复盘草稿持久化的单元测试（N10）。
 *
 * 为什么必须锁住它：审计实测的丢失路径是「只活在组件 state 里」，而修法的核心不是
 * "会写 localStorage"（那太容易写成总是覆盖），而是**几个容易反着写坏的口径**：
 *
 *   1. 隔日草稿**不能自动回填**当日计划（否则用户以为今天计划写好了），
 *      但也**不能静默丢**（昨晚的劳动可能还在里面）→ 必须落到 `stale` 这个显式分支；
 *   2. 清空时机：**存档成功才清**；失败却清 = 真丢（这就是"重试/配额满"场景下的事故）；
 *   3. 损坏数据（半截 JSON、缺 tags 的条目、坏日期）**不能抛、也不能把好条目一起拖死** ——
 *      草稿是跨版本、可被手改的数据，一条坏记录不能让复盘页白屏。
 *
 * 测试只跑纯逻辑 + 一个内存版 localStorage 假体（不发网络请求、不需要真浏览器）。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  DRAFT_STORAGE_KEY,
  MAX_DRAFT_EXPECTATIONS,
  clearDraft,
  draftAction,
  draftEntry,
  draftEntryNotice,
  flushDraft,
  formatClock,
  getDraft,
  isDraftContentEmpty,
  matchesArchived,
  pickNewerDraft,
  preferDraft,
  readDraftList,
  readDraftFromStorage,
  sameDraftContent,
  sanitizeDraft,
  sanitizeExpectation,
  saveDraft,
  type DraftContent,
  type ReviewDraft,
} from '../src/lib/review-draft.ts'
import type { ExpectItem } from '../src/lib/review-store.ts'

// ────────────────────────────── 测试夹具 ──────────────────────────────

/** 内存版 localStorage（node 里没有 DOM；只实现草稿用到的三个方法）。 */
function installFakeStorage(): Map<string, string> {
  const map = new Map<string, string>()
  ;(globalThis as unknown as { localStorage: unknown }).localStorage = {
    getItem: (k: string) => (map.has(k) ? (map.get(k) as string) : null),
    setItem: (k: string, v: string) => {
      map.set(k, String(v))
    },
    removeItem: (k: string) => {
      map.delete(k)
    },
  }
  return map
}

function exp(over: Partial<ExpectItem> = {}): ExpectItem {
  return {
    id: 'e1',
    symbol: 'SH603138',
    name: '海量数据',
    tags: { themeDay: 2, level: 'mid', role: 'follower' },
    state: 'divergence',
    scenario: '高开分歧后回封',
    auctionOK: '高开3%+竞价量>昨日20%',
    failIf: '低开破5日线',
    reason: '量比1.8 缩量回踩',
    ...over,
  }
}

/** 造一份带 1 条预期的内容（草稿的最小非空形态）。 */
function content(over: Partial<DraftContent> = {}): DraftContent {
  return { day: '2026-09-12', expectations: [exp()], riskNote: '', windFlags: [], ...over }
}

function draft(over: Partial<ReviewDraft> = {}): ReviewDraft {
  return { day: '2026-09-12', updatedAt: 1000, expectations: [exp()], ...over }
}

/** 已存档视图（与 `ArchivedView` 结构一致）。 */
function archived(over: Partial<{ savedAt: number; expectations: ExpectItem[]; riskNote?: string }> = {}) {
  return { savedAt: 500, expectations: [exp()], riskNote: undefined, ...over }
}

// ────────────────────────────── 隔日判定 ──────────────────────────────

test('draftEntry：同日 → 自动恢复；隔日 → stale（只提示不自动回填）', () => {
  const d = draft({ day: '2026-09-12' })
  assert.equal(draftEntry(null, '2026-09-12').kind, 'none')
  assert.deepEqual(draftEntry(d, '2026-09-12'), { kind: 'restore', draft: d })
  const stale = draftEntry(d, '2026-09-15')
  assert.equal(stale.kind, 'stale', '隔日草稿必须走 stale 分支（不能自动回填当日计划）')
  // 跨月/跨年同样按字符串日期判（本地日 YYYY-MM-DD 定长，字典序 = 时间序）
  assert.equal(draftEntry(draft({ day: '2026-08-31' }), '2026-09-01').kind, 'stale')
  assert.equal(draftEntry(draft({ day: '2026-12-31' }), '2027-01-01').kind, 'stale')
})

test('draftEntryNotice：三种决策各有明确文案（stale 必须说清"不会自动回填"）', () => {
  assert.equal(draftEntryNotice({ kind: 'none' }), '')
  const restore = draftEntryNotice({ kind: 'restore', draft: draft({ updatedAt: 0 }) })
  assert.match(restore, /已恢复/)
  assert.match(restore, /--:--/, '没有可信时间戳时给占位，不假装知道时间')
  const stale = draftEntryNotice({ kind: 'stale', draft: draft({ day: '2026-09-11' }) })
  assert.match(stale, /2026-09-11/)
  assert.match(stale, /不会自动回填/)
})

test('preferDraft：草稿比存档新 → 不许用存档回填（否则"刚写的"被判成无改动而清掉）', () => {
  assert.equal(preferDraft(null, 500), false, '没有草稿：谈不上优先草稿')
  assert.equal(preferDraft(draft({ updatedAt: 900 }), 500), true, '草稿更新 → 优先草稿')
  assert.equal(preferDraft(draft({ updatedAt: 500 }), 500), true, '同一时刻按"新的赢"取草稿')
  assert.equal(preferDraft(draft({ updatedAt: 100 }), 500), false, '存档更新 → 用存档回填')
  assert.equal(preferDraft(draft(), null), true, '今天还没存档 → 草稿即唯一事实')
})

// ────────────────────────────── 清空时机 ──────────────────────────────

test('draftAction：空内容 / 与当日存档一致 → 清；有未存档改动 → 写（时间戳=now）', () => {
  const empty: DraftContent = { day: '2026-09-12', expectations: [], riskNote: '   ', windFlags: [] }
  assert.deepEqual(draftAction(empty, null, 700), { kind: 'clear' }, '空内容不留空壳草稿')
  assert.deepEqual(
    draftAction(content(), archived({ savedAt: 500 }), 700),
    { kind: 'clear' },
    '与当日存档一致 → 没有未存档改动 → 清（否则每次进页面都误报"草稿已保存"）',
  )
  const saved = draftAction(content({ expectations: [exp(), exp({ id: 'e2', symbol: 'SZ000001' })] }), archived(), 700)
  assert.equal(saved.kind, 'save')
  if (saved.kind === 'save') {
    assert.equal(saved.updatedAt, 700)
    assert.equal(saved.content.expectations.length, 2)
  }
})

test('matchesArchived：按字段指纹比较（不受键序影响），备注/风向标任一不同即算有改动', () => {
  assert.equal(matchesArchived(content(), archived()), true)
  assert.equal(matchesArchived(content(), null), false, '没有存档 → 不算"与存档一致"')
  assert.equal(matchesArchived(content({ riskNote: '高位股集体炸板' }), archived()), false)
  assert.equal(
    matchesArchived(content({ riskNote: '  高位股集体炸板 ' }), archived({ riskNote: '高位股集体炸板' })),
    true,
    '备注比较忽略首尾空白（输入框里的空格不是"改动"）',
  )
  assert.equal(
    matchesArchived(content({ expectations: [exp({ scenario: '改过的剧本' })] }), archived()),
    false,
    '改了剧本字段就是有未存档改动',
  )
  // 键序不同但内容相同：必须判"一致"（条目会经 localStorage → sanitize 重建，键序不该是判据）
  const reordered = { ...exp() } as ExpectItem
  const shuffled = {
    reason: reordered.reason,
    state: reordered.state,
    name: reordered.name,
    symbol: reordered.symbol,
    tags: { role: reordered.tags.role, level: reordered.tags.level, themeDay: reordered.tags.themeDay },
    id: reordered.id,
    failIf: reordered.failIf,
    auctionOK: reordered.auctionOK,
    scenario: reordered.scenario,
  } as ExpectItem
  assert.equal(matchesArchived(content({ expectations: [shuffled] }), archived()), true)
})

test('isDraftContentEmpty：只有风向标（或只有备注）也算非空 —— 它们同样会丢', () => {
  assert.equal(isDraftContentEmpty({ day: '2026-09-12', expectations: [] }), true)
  assert.equal(isDraftContentEmpty({ day: '2026-09-12', expectations: [], riskNote: '雷区共性' }), false)
  assert.equal(
    isDraftContentEmpty({
      day: '2026-09-12',
      expectations: [],
      windFlags: [{ symbol: 'SH600000', name: '浦发', tag: 'other' }],
    }),
    false,
  )
})

test('sameDraftContent：内容等价（忽略 updatedAt）→ 不重写；草稿槽为空 → 不算等价', () => {
  assert.equal(sameDraftContent(null, content()), false)
  assert.equal(sameDraftContent(draft({ updatedAt: 1_000 }), content()), true)
  assert.equal(sameDraftContent(draft({ updatedAt: 999_999 }), content()), true, 'updatedAt 不参与比较')
  assert.equal(sameDraftContent(draft({ day: '2026-09-11' }), content()), true, '日期不参与"内容"比较（调用方各自判日）')
  assert.equal(sameDraftContent(draft(), content({ riskNote: '新写的共性' })), false)
  assert.equal(sameDraftContent(draft({ expectations: [] }), content()), false)
})

// ────────────────────────────── 损坏数据兜底 ──────────────────────────────

test('sanitizeDraft：坏 JSON 形状 / 坏日期 → null（当作没有草稿，绝不抛）', () => {
  assert.equal(sanitizeDraft(null), null)
  assert.equal(sanitizeDraft('{不是对象}'), null)
  assert.equal(sanitizeDraft([]), null)
  assert.equal(sanitizeDraft({}), null, '没有 day 就无法判隔日 → 丢弃')
  assert.equal(sanitizeDraft({ day: '2026/09/12', expectations: [] }), null, '日期格式不合法 → 丢弃')
  assert.equal(sanitizeDraft({ day: '2026-09-12' })?.expectations.length, 0, '缺 expectations 视为空清单')
})

test('sanitizeDraft：坏条目单独丢、好条目照留；越界条数被裁剪', () => {
  const dirty = sanitizeDraft({
    day: '2026-09-12',
    updatedAt: 1234,
    expectations: [
      exp(),
      null,
      { id: 'x' }, // 缺 symbol/state → 丢
      'not-an-object',
      exp({ id: 'e3', symbol: 'SZ000002', state: 'strong' }),
    ],
  })
  assert.notEqual(dirty, null)
  assert.deepEqual(dirty?.expectations.map((e) => e.id), ['e1', 'e3'])
  assert.equal(dirty?.updatedAt, 1234)

  const many = sanitizeDraft({
    day: '2026-09-12',
    expectations: Array.from({ length: 9 }, (_, i) => exp({ id: `e${i}` })),
  })
  assert.equal(many?.expectations.length, MAX_DRAFT_EXPECTATIONS, '草稿也遵守"预期 ≤5"的口径')
})

test('sanitizeExpectation：缺 tags 时补默认值（否则受控 select 会白屏/告警）', () => {
  const fixed = sanitizeExpectation({ id: 'e9', symbol: 'SH600000', state: 'strong' })
  assert.notEqual(fixed, null)
  assert.deepEqual(fixed?.tags, { level: 'mid', role: 'follower' })
  assert.equal(fixed?.name, 'SH600000', '没名字就用代码兜底（UI 不会渲染出空标题）')
  assert.equal(fixed?.scenario, '', '非字符串文本字段一律回落空串，而不是 undefined')
  // 非法枚举值同样回落默认（不丢整条：标的还在，用户能自己改回来）
  const badEnum = sanitizeExpectation({
    id: 'e10',
    symbol: 'SH600000',
    state: 'strong',
    tags: { level: 'HIGH', role: 'bigboss', themeDay: 999 },
  })
  assert.deepEqual(badEnum?.tags, { themeDay: 30, level: 'mid', role: 'follower' })
  assert.equal(sanitizeExpectation({ id: 'e11', symbol: 'SH600000', state: '暴涨' }), null, 'state 不认识 → 整条丢')
})

test('sanitizeDraft 对合法数据是恒等的（否则"恢复→与存档比较"会假阳性清草稿）', () => {
  const original = draft({ day: '2026-09-12', updatedAt: 999, riskNote: '雷区：高位缩量', windFlags: [{ symbol: 'SH600000', name: '浦发', tag: 'dayLeader' }] })
  const roundTrip = sanitizeDraft(JSON.parse(JSON.stringify(original)))
  assert.deepEqual(roundTrip, original)
})

test('readDraftList：非数组/空数组 → 空；多条 → 只留「日期新、同日时间新」的一条', () => {
  assert.deepEqual(readDraftList(null), [])
  assert.deepEqual(readDraftList({ day: '2026-09-12' }), [], '形状不是数组（旧版/脏数据）→ 空')
  assert.deepEqual(readDraftList([]), [])
  const list = readDraftList([
    draft({ day: '2026-09-10', updatedAt: 9_000 }),
    draft({ day: '2026-09-12', updatedAt: 1_000 }),
    draft({ day: '2026-09-12', updatedAt: 2_000 }),
  ])
  assert.equal(list.length, 1, '草稿槽最多留一条')
  assert.equal(list[0].day, '2026-09-12')
  assert.equal(list[0].updatedAt, 2_000)
})

test('pickNewerDraft：hydrate 合并"新的赢"（本地刚写不能被远程旧记录盖掉）', () => {
  const remote = draft({ day: '2026-09-12', updatedAt: 1_000 })
  const local = draft({ day: '2026-09-12', updatedAt: 2_000 })
  assert.equal(pickNewerDraft(remote, local), local)
  assert.equal(pickNewerDraft(local, remote), local)
  assert.equal(pickNewerDraft(draft({ day: '2026-09-13', updatedAt: 1 }), local)?.day, '2026-09-13', '日期新的优先')
  assert.equal(pickNewerDraft(null, local), local)
  assert.equal(pickNewerDraft(local, null), local)
  assert.equal(pickNewerDraft(null, null), null)
})

// ────────────────────────────── 存储往返（内存版 localStorage） ──────────────────────────────

test('saveDraft/clearDraft：键名固定、往返无损、清理后读回 null', () => {
  const map = installFakeStorage()
  const written = saveDraft(content({ riskNote: '高位股炸板共性' }), 1_700_000_000_000)
  assert.equal(written.updatedAt, 1_700_000_000_000)
  assert.ok(map.has(DRAFT_STORAGE_KEY), '草稿必须写在独立键上（不动 review:v3）')
  assert.equal(DRAFT_STORAGE_KEY, 'dsh-stock-panel:review-draft:v1')

  const raw = JSON.parse(map.get(DRAFT_STORAGE_KEY) as string)
  assert.ok(Array.isArray(raw), 'localStorage 形状是数组（与 host 表 shape=array + 记录键=day 对齐）')
  assert.equal(raw.length, 1)
  assert.equal(raw[0].day, '2026-09-12')

  // 模拟"刷新页面"：从 localStorage 重新读回（新的会话/组件卸载后就是这样恢复的）
  const reloaded = readDraftFromStorage()
  assert.equal(reloaded?.riskNote, '高位股炸板共性')
  assert.deepEqual(reloaded?.expectations, content().expectations, '预期条目往返无损（7 字段全在）')
  assert.equal(getDraft()?.updatedAt, 1_700_000_000_000, '模块内存态与镜像一致')

  clearDraft()
  assert.equal(readDraftFromStorage(), null, '清空后刷新读回 null（存档成功才允许走到这里）')
  assert.equal(getDraft(), null)
  assert.equal(map.has(DRAFT_STORAGE_KEY), false, '清空要删键，而不是留一份空数组')
  clearDraft() // 幂等：重复清不抛
})

test('readDraftFromStorage：坏 JSON / 坏记录 → null（不抛，不白屏）', () => {
  const map = installFakeStorage()
  map.set(DRAFT_STORAGE_KEY, '{半截 JSON')
  assert.equal(readDraftFromStorage(), null)
  map.set(DRAFT_STORAGE_KEY, JSON.stringify([{ day: 'oops' }]))
  assert.equal(readDraftFromStorage(), null)
  map.set(DRAFT_STORAGE_KEY, JSON.stringify([draft({ day: '2026-09-12' })]))
  assert.equal(readDraftFromStorage()?.day, '2026-09-12', '好数据仍要读得出来')
})

test('formatClock：HH:MM 补零；没有可信时间戳时给占位', () => {
  const d = new Date(2026, 8, 12, 9, 5) // 本地时间 09:05
  assert.equal(formatClock(d.getTime()), '09:05')
  assert.equal(formatClock(0), '--:--')
  assert.equal(formatClock(Number.NaN), '--:--')
  assert.equal(formatClock(-1), '--:--')
})

// ────────────────────────────── 审计路径回归（端到端的一次"丢失"演练） ──────────────────────────────

test('★ 审计路径：编辑 → 点股票导致卸载 → 回复盘页（同日）恢复；存档成功后才不再恢复', () => {
  installFakeStorage()
  const todayDay = '2026-09-12'

  // 1) 盘后写清单（编辑器每次变更都落草稿；这里模拟两次编辑）
  const action = draftAction(content({ day: todayDay }), null, 1_000)
  assert.equal(action.kind, 'save')
  if (action.kind !== 'save') return
  saveDraft(action.content, action.updatedAt)
  saveDraft(
    content({
      day: todayDay,
      expectations: [exp(), exp({ id: 'e2', symbol: 'SZ000001', name: '平安银行' })],
      riskNote: '高位缩量股集体炸板',
    }),
    action.updatedAt,
  )

  // 2) 点股票 → openStockAndWatch 切「看盘」→ ReviewPage 卸载 → cleanup 里的 flushDraft()
  flushDraft()

  // 3) 回到复盘页：重新读持久化数据 → 同日 → 自动恢复（这就是"离开不丢"）
  const restored = readDraftFromStorage()
  const decision = draftEntry(restored, todayDay)
  assert.equal(decision.kind, 'restore')
  if (decision.kind !== 'restore') return
  assert.equal(decision.draft.expectations.length, 2, '两条预期都要回来（含 7 字段）')
  assert.equal(decision.draft.expectations[0].scenario, '高开分歧后回封')
  assert.equal(decision.draft.expectations[0].auctionOK, '高开3%+竞价量>昨日20%', '7 个字段要整体回来，不能只回一半')
  assert.equal(decision.draft.expectations[0].failIf, '低开破5日线')
  assert.equal(decision.draft.riskNote, '高位缩量股集体炸板', '第五步的共性备注同样不许丢')

  // 4) 点「存档」成功 → 清草稿 → 再回页面时不再有"未存档草稿"（不会再被恢复）
  clearDraft()
  assert.deepEqual(draftEntry(readDraftFromStorage(), todayDay), { kind: 'none' })

  // 5) 而"存档失败"路径：草稿必须原样留着（否则就是真丢）
  const kept = draftAction(content({ day: todayDay }), null, 2_000)
  if (kept.kind !== 'save') return
  saveDraft(kept.content, kept.updatedAt)
  // 存档落盘失败 → 调用方不得清草稿（口径 3）→ 草稿仍可恢复
  assert.equal(getDraft()?.day, todayDay)
  assert.equal(readDraftFromStorage()?.expectations.length, 1)
})
