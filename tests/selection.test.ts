/**
 * tests/selection.test.ts —— 导航/视图状态层的单元测试（B4 扩面，A6 后重写）。
 *
 * 为什么值得测：这一层出错的表现**全是静默的** ——
 *   · A4 把「市场总览 / 指数 / 涨停梯队」三页合并成单页 `market` 后，老用户落盘值仍是旧 id；
 *     映射写错 → 页面打不开，且没有任何报错（`viewIdOf` 返回 null 就直接回默认值）；
 *   · A6 把「工具抽屉」拆平、下线「自选盘 / 个股明细 / 看盘」三个入口后，最怕的是
 *     **它们又悄悄长回导航栏**（同一件事两个入口），或者 `watch` 被塞进 `PRIMARY_VIEWS`
 *     把 `1-7` 的键位整体错位（`hotkeys.test.ts` 也钉了这条）。
 * 这里把这两类约定写成可执行契约。
 *
 * 注：`selection.ts` 在模块加载时会读 localStorage（浏览器 API）。在 Node 里读不到会走
 * 异常分支返回默认状态 —— 所以本文件能在无浏览器环境下直接 import。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  ALL_VIEWS,
  DEFAULT_VIEW,
  LEGACY_VIEW_IDS,
  PRIMARY_VIEWS,
  WORKBENCH_VIEW,
  initialViewOf,
  viewIdOf,
} from '../src/lib/selection.ts'

test('★ 默认入口是「行情」，且必须是导航栏上的入口（否则首屏没有任何一项高亮）', () => {
  assert.equal(DEFAULT_VIEW, 'market', '默认入口 = 用户决策：行情（任何时段都成立的第一眼）')
  assert.ok(
    PRIMARY_VIEWS.some((v) => v.id === DEFAULT_VIEW),
    '默认值必须在 PRIMARY_VIEWS 里 —— 落到工作台或未知值都会让状态带上没有高亮项',
  )
})

test('★ 初始视图：旧键（ui:v3）一次性落到默认入口；新键按落盘值', () => {
  // 旧键：不管当年停在哪个入口（含当年的工具字段），升级后第一次统一去行情 ——
  // 否则"上次停在作战"会压过用户刚提的"默认显示行情"，看起来像没改。
  assert.equal(initialViewOf('war', true), DEFAULT_VIEW, '旧键里的 war → 行情')
  assert.equal(initialViewOf('review', true), DEFAULT_VIEW, '旧键里的 review → 行情')
  assert.equal(initialViewOf(undefined, true), DEFAULT_VIEW, '旧键字段缺失也去行情')
  // 新键：用户选过哪个就记哪个（跨卸载/刷新保持，这是既有持久化要求）
  assert.equal(initialViewOf('review', false), 'review', '新键里选过复盘 → 复盘')
  assert.equal(initialViewOf('watch', false), 'watch', '工作台也能被记住（点股票进去后刷新不跳走）')
  // 新键里的非法/缺失值 → 默认入口（不猜、也不空白）
  assert.equal(initialViewOf('不存在的入口', false), DEFAULT_VIEW)
  assert.equal(initialViewOf(undefined, false), DEFAULT_VIEW)
  assert.equal(initialViewOf(42, false), DEFAULT_VIEW)
})

test('PRIMARY_VIEWS：id 唯一、字段齐全、外盘仍是次要且排最后', () => {
  const ids = PRIMARY_VIEWS.map((v) => v.id)
  assert.equal(new Set(ids).size, ids.length, `一级入口 id 唯一（${ids.join('/')}）`)
  for (const v of PRIMARY_VIEWS) {
    assert.ok(v.label.length > 0 && v.hint.length > 0, `${v.id} 有标签与说明`)
  }
  const secondary = PRIMARY_VIEWS.filter((v) => v.secondary === true).map((v) => v.id)
  assert.deepEqual(secondary, ['global'], '只有外盘是次要（A4 的弱化决策，A6 保留）')
  assert.equal(PRIMARY_VIEWS[PRIMARY_VIEWS.length - 1].id, 'global', '次要入口排在最后')
})

test('★ A6：流程两阶段在最前，其余板块与它们**同级**（抽屉不再有中间层）', () => {
  assert.deepEqual(
    PRIMARY_VIEWS.map((v) => v.id),
    ['review', 'war', 'market', 'concept', 'scout', 'alerts', 'global'],
    '顺序 = 状态带上的顺序 = 1-7 键位',
  )
})

test('★ A6：三个下线入口不得回到导航栏（同一件事不许有两个入口）', () => {
  for (const gone of ['watchlist', 'detail', 'watch']) {
    assert.ok(
      !PRIMARY_VIEWS.some((v) => v.id === gone),
      `「${gone}」不该在 PRIMARY_VIEWS 里：自选/个股走左栏列表，工作台走"点股票"`,
    )
  }
  // 工作台仍必须是**合法视图**（否则点左栏一行会落到一个不存在的视图上）
  assert.equal(WORKBENCH_VIEW.id, 'watch')
  assert.ok(WORKBENCH_VIEW.label.length > 0 && WORKBENCH_VIEW.hint.length > 0, '工作台有标签与说明')
  assert.ok(
    ALL_VIEWS.some((v) => v.id === 'watch'),
    '工作台在 ALL_VIEWS 里（渲染导航用 PRIMARY_VIEWS，校验/⌘K 直达用 ALL_VIEWS）',
  )
  assert.equal(ALL_VIEWS.length, PRIMARY_VIEWS.length + 1, 'ALL_VIEWS = 导航入口 + 工作台')
})

test('★ A4 合并：三页合成一页 market，旧 id 全部就地映射（老用户不掉页）', () => {
  assert.deepEqual(LEGACY_VIEW_IDS, { overview: 'market', indices: 'market', ladder: 'market' })
  for (const legacy of ['overview', 'indices', 'ladder']) {
    assert.equal(viewIdOf(legacy), 'market', `旧 id ${legacy} → market`)
  }
  assert.ok(
    PRIMARY_VIEWS.some((v) => v.id === 'market'),
    'market 必须在 PRIMARY_VIEWS 里（否则映射结果会被二次校验丢掉）',
  )
  // 合并后的三个旧 id 不得再作为独立入口存在（否则用户会看到重复入口）
  for (const legacy of ['overview', 'indices', 'ladder']) {
    assert.ok(!PRIMARY_VIEWS.some((v) => v.id === legacy), `旧入口 ${legacy} 应已下线`)
  }
})

test('viewIdOf：现行 id 原样通过，非法/缺失一律 null（不猜、不落到第一项）', () => {
  for (const v of ALL_VIEWS) assert.equal(viewIdOf(v.id), v.id, `${v.id} 通过`)
  assert.equal(viewIdOf('不存在的入口'), null)
  assert.equal(viewIdOf('watchlist'), null, '已下线的工具页 id 不认（A6：它不是视图）')
  assert.equal(viewIdOf('detail'), null, '同上')
  assert.equal(viewIdOf(''), null)
  assert.equal(viewIdOf(null), null)
  assert.equal(viewIdOf(undefined), null)
  assert.equal(viewIdOf(42), null)
  // 映射的**目标**也必须是合法视图：否则等于把旧值换成一个同样打不开的值
  for (const target of Object.values(LEGACY_VIEW_IDS)) {
    assert.ok(ALL_VIEWS.some((v) => v.id === target), `映射目标 ${target} 是合法视图`)
  }
})
