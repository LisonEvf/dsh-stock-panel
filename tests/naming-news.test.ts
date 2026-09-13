/**
 * tests/naming-news.test.ts —— 板块级快讯素材源（新浪 7×24）的契约测试（离线，不发出网请求）。
 *
 * 为什么这个源必须有测试：它是本站**唯一能解释"为什么一起动"**的素材源，
 * 也是唯一会出网到非通达信的源。它坏掉的方式都很安静：
 *   · 名称归一没做 → 一条都匹配不上（不报错，只是"没素材"）；
 *   · 盘面派生汇总没剔 → 模型把「科创50跌3%」当主题（**循环论证**：那是结果不是原因）；
 *   · 可回溯范围判错 → 把"采不到"写成"市场没有这事"（归因反了，正是 A7 踩过的坑）。
 * 所以这里把这些口径逐条钉住，样本全部取自 `scripts/news-source-probe.mjs` 实测到的真实快讯。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  buildMemberIndex,
  classifyFlash,
  DEFAULT_NEWS,
  fetchNewsFlashes,
  filterFlashTags,
  flashDate,
  flashTitle,
  flashToMaterials,
  flashTs,
  normForMatch,
  parseFeedPage,
  type NewsFlash,
} from '../src/host/naming/news.ts'
import { collectMaterials } from '../src/host/naming/collect.ts'
import type { NamingMember } from '../src/host/naming/types.ts'

const MEMBERS: NamingMember[] = [
  { market: 'SH', code: '688543', name: '国科军工' },
  { market: 'SH', code: '688802', name: '沐曦股份-U' }, // 正文只写「沐曦股份」→ 只能靠 ext 代码命中
  { market: 'SH', code: '688568', name: '中科星图' },
]

/** 构造一条接口条目（形状与新浪 7×24 一致）。 */
function rawFlash(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 1,
    rich_text: '正文',
    create_time: '2026-09-11 10:00:00',
    tag: [{ name: '公司' }],
    ext: JSON.stringify({ docurl: 'https://finance.sina.com.cn/7x24/x', stocks: [] }),
    ...over,
  }
}

function pagePayload(rows: unknown[]): unknown {
  return { result: { status: { code: 0 }, data: { feed: { list: rows } } } }
}

/** 假 fetch：按 `page` 参数返回预置页；可指定失败的页。 */
function fakeFetch(pages: Record<number, unknown[]>, failPages: number[] = []) {
  const calls: number[] = []
  const impl = (async (url: string) => {
    const p = Number(new URL(url).searchParams.get('page') ?? '1')
    calls.push(p)
    if (failPages.includes(p)) {
      return { ok: false, status: 500, json: async () => ({}) } as unknown as Response
    }
    return { ok: true, status: 200, json: async () => pagePayload(pages[p] ?? []) } as unknown as Response
  }) as unknown as typeof fetch
  return { impl, calls }
}

const flash = (over: Partial<NewsFlash> = {}): NewsFlash => ({
  id: '1',
  ts: '2026-09-11 10:00:00',
  text: '正文',
  tags: [],
  stocks: [],
  url: 'https://finance.sina.com.cn/7x24/x',
  ...over,
})

// ===== ① 归一与解析 =====

test('归一：通达信补空格/全角字母的票名要能匹配正文里的简称', () => {
  // 实测：通达信给的是 `万 科Ａ`、`沐曦股份-U`，正文写的是 `万科A`、`沐曦股份`
  assert.equal(normForMatch('万 科Ａ'), '万科A')
  assert.equal(normForMatch('深天马Ａ'), '深天马A')
  assert.equal(normForMatch(' 中际旭创 '), '中际旭创')
  assert.ok(normForMatch('午后军工板块持续走高，国科军工均涨超4%').includes(normForMatch('国科军工')))
})

test('parseFeedPage：字段按不可信处理；无正文丢弃；ext 坏 JSON 不炸；商品代码不混进 A 股', () => {
  const rows = parseFeedPage(pagePayload([
    rawFlash({ id: 7, rich_text: '【翔宇医疗成立翔脑科技公司】…', ext: JSON.stringify({
      docurl: 'https://a/b',
      stocks: [{ market: 'stock', symbol: 'sh688626', key: '翔宇医疗' }, { market: 'commodity', symbol: 'nf_sc0', key: '石油' }],
    }) }),
    rawFlash({ id: 8, rich_text: '   ' }), // 空正文
    rawFlash({ id: 9, ext: '不是 JSON' }),
    'not-an-object',
  ]))
  assert.equal(rows.length, 2, '空正文与非对象条目被丢弃')
  assert.equal(rows[0]?.id, '7')
  assert.equal(rows[0]?.text, '【翔宇医疗成立翔脑科技公司】…')
  assert.equal(rows[0]?.ts, '2026-09-11 10:00:00')
  assert.deepEqual(rows[0]?.tags, ['公司'])
  assert.deepEqual(rows[0]?.stocks, ['688626'], '只留 A 股代码（商品 symbol 不是 A 股）')
  assert.equal(rows[0]?.url, 'https://a/b')
  assert.deepEqual(rows[1]?.stocks, [], 'ext 坏 JSON → 空关联，不抛')
})

test('标题/时间戳：`【…】` 取标题；ts 精度到分钟；日期切片', () => {
  assert.equal(flashTitle('【军工板块持续走高 银河电子、博云新材双双涨停】午后…'), '军工板块持续走高 银河电子、博云新材双双涨停')
  assert.equal(flashTitle('没有方头括号的一条快讯正文'), '没有方头括号的一条快讯正文')
  assert.equal(flashTs('2026-09-11 13:53:44'), '2026-09-11 13:53')
  assert.equal(flashTs('坏时间'), '')
  assert.equal(flashDate('2026-09-11 13:53:44'), '2026-09-11')
  assert.equal(flashDate(''), '')
})

// ===== ② 标签去噪（阈值来自实测）=====

test('标签去噪：丢掉「国际」（除非带 A 股代码）；正向白名单默认关闭且不误伤', () => {
  const intl = flash({ tags: ['国际'], text: '墨西哥国家石油公司称，墨西哥湾原油泄漏已得到控制。' })
  const intlWithCode = flash({ tags: ['国际'], stocks: ['600519'], text: '…带 A 股代码的国际条目…' })
  const normal = flash({ tags: ['其他'], text: '【某行业事件】…' })
  assert.deepEqual(filterFlashTags([intl, intlWithCode, normal]).map((f) => f.text), [intlWithCode.text, normal.text])
  assert.deepEqual(DEFAULT_NEWS.keepTags, [], '正向白名单默认必须是空的（实测只会误伤）')
  // 旋钮还在：显式打开时按白名单过滤
  assert.deepEqual(filterFlashTags([normal], ['公司'], []).length, 0, '白名单打开时未命中标签的条目被丢弃')
})

// ===== ③ 四层分层（含两条反直觉契约）=====

test('★ 分层：点名成员 + 事件词 → announce；点名成员无事件词 → anchor', () => {
  const index = buildMemberIndex(MEMBERS)
  // 实测原文（2026-09-11 13:53:44，ext 带 688543）
  const army = flash({
    stocks: ['688543'],
    tags: ['市场'],
    text: '【军工板块持续走高 银河电子、博云新材双双涨停】午后军工板块持续走高，银河电子、博云新材涨停，'
      + '此前内蒙一机涨停，长城军工、北方长龙、航发科技、国科军工均涨超4%。',
  })
  const a = classifyFlash(army, index)
  assert.equal(a.level, 'anchor', '含「涨停/涨超」不算事件词：那是价格事实，不是事件')
  assert.equal(a.hits[0]?.member.code, '688543')
  assert.equal(a.hits[0]?.via, 'both', 'ext 代码 + 正文股名 → 双重确认')

  const event = flash({ stocks: ['688626'], text: '【翔宇医疗成立翔脑科技公司，含AI相关业务】企查查APP显示，翔脑科技（河南）有限责任公司成立…' })
  const b = classifyFlash(event, buildMemberIndex([{ market: 'SH', code: '688626', name: '翔宇医疗' }]))
  assert.equal(b.level, 'announce', '有事件词（成立）→ 最强层')
  assert.ok(b.reason.includes('成立'))
})

test('★ 反直觉契约：成员名带 -U 后缀、正文只写简称 → 仅 ext 代码也必须算命中', () => {
  // 实测原文：「【沐曦股份等在上海新设咨询管理公司】」——成员名是 `沐曦股份-U`，
  // 按股名匹配**一条都匹配不上**。若把"代码+股名双重确认"当门槛，这条真素材会丢。
  const idx = buildMemberIndex(MEMBERS)
  const text = '【沐曦股份等在上海新设咨询管理公司】企查查APP显示，上海孚曦晨沐咨询管理有限公司成立…'
  assert.equal(normForMatch(text).includes(normForMatch('沐曦股份-U')), false, '前提：股名对不上（正文没有 -U）')
  const c = classifyFlash(flash({ stocks: ['688802'], text }), idx)
  assert.equal(c.level, 'announce')
  assert.equal(c.hits[0]?.member.code, '688802')
  assert.equal(c.hits[0]?.via, 'code', '仅靠 ext 代码命中')
})

test('★ 盘面派生汇总必须剔除（点名了成员也不进语料：那是结果不是原因）', () => {
  const idx = buildMemberIndex(MEMBERS)
  const cases: Array<[string, string]> = [
    ['科创50指数快照', '科创50日内跌幅达3％，成分股中，中科星图跌6.41％，晶合集成跌5.04％，华虹宏力跌4.97％。'],
    ['收评', '【A股收评：创业板指探底回升跌0.49%，兵装重组概念、元件板块表现活跃】A股三大指数今日集体下跌…'],
    ['成交额榜', '【沪深两市今日成交额合计1.97万亿元，中际旭创成交额居首】沪深两市今日全天成交额合计1.97万亿元…'],
    ['资金榜', '【主力资金：转融券标的板块净流出超498亿】截至目前，今日主力资金净流出572.69亿…'],
  ]
  for (const [name, text] of cases) {
    const c = classifyFlash(flash({ stocks: ['688568'], text }), idx)
    assert.equal(c.level, 'digest', `${name} 必须被判为盘面派生汇总（实际 ${c.level}）`)
    assert.ok(c.hits.length > 0, `${name} 确实点名了成员（所以只靠"有锚点"是拦不住的）`)
  }
  // 边界：真实事件里出现「涨停/涨超」不得被误判成汇总
  const event = classifyFlash(flash({ text: '【工信部：加快推进高速光模块与CPO技术产业化】…' }), idx)
  assert.equal(event.level, 'none', '无成员锚点 → none（与 digest 无关）')
})

test('无锚点 → none（国际大宗、无关政策都不得进语料）', () => {
  const c = classifyFlash(flash({ text: '墨西哥国家石油公司称，墨西哥湾原油泄漏已得到控制。', tags: ['国际'] }), buildMemberIndex(MEMBERS))
  assert.equal(c.level, 'none')
  assert.deepEqual(c.hits, [])
})

// ===== ④ 素材归一 =====

test('一条快讯点名 2 只成员 → 2 条素材；ts 到分钟；snippet 是正文全文（逐字引文的前提）', () => {
  const text = '【军工板块持续走高】…长城军工、航发科技、国科军工均涨超4%，中科星图跌6.41%。'
  const f = flash({ stocks: ['688543', '688568'], text, ts: '2026-09-11 13:53:44' })
  const idx = buildMemberIndex(MEMBERS)
  const c = classifyFlash(f, idx)
  const items = flashToMaterials(f, c.hits)
  assert.equal(items.length, 2)
  assert.deepEqual(items.map((i) => i.stock).sort(), ['688543 国科军工', '688568 中科星图'])
  assert.equal(items[0]?.ts, '2026-09-11 13:53', '素材 ts 精确到分钟（护栏按日期判窗口）')
  assert.equal(items[0]?.snippet, text, '正文全文进语料 —— 截断会让合规引文被判成幻觉')
  assert.equal(items[0]?.kind, 'news_flash')
  assert.equal(items[0]?.key, 'SH688543')
})

// ===== ⑤ 抓取：翻页 / 覆盖 / 失败 =====

test('抓取：翻到"已覆盖窗口起点"就停（不为一个 1 天窗口白翻 24 页）', async () => {
  const { impl, calls } = fakeFetch({
    1: [rawFlash({ id: 1, rich_text: '【今日事件】…', create_time: '2026-09-11 10:00:00' })],
    2: [rawFlash({ id: 2, rich_text: '【更早的】…', create_time: '2026-09-09 23:00:00' })],
    3: [rawFlash({ id: 3, rich_text: '【更更早】…', create_time: '2026-09-08 01:00:00' })],
  })
  const r = await fetchNewsFlashes({ fetchImpl: impl, pages: 24 }, '2026-09-09')
  assert.equal(r.stopReason, 'covered')
  assert.equal(r.pagesFetched, 2, '第 2 页最旧一条已 ≤ 窗口起点 → 停止')
  assert.deepEqual(calls, [1, 2])
  assert.equal(r.items.length, 2)
})

test('抓取：翻到页数上限仍未覆盖 → page_cap（覆盖不完整必须能被上报）', async () => {
  const { impl } = fakeFetch({
    1: [rawFlash({ create_time: '2026-09-11 10:00:00' })],
    2: [rawFlash({ create_time: '2026-09-11 08:00:00' })],
  })
  const r = await fetchNewsFlashes({ fetchImpl: impl, pages: 2 }, '2026-09-01')
  assert.equal(r.stopReason, 'page_cap')
  assert.equal(r.pagesFetched, 2)
})

test('抓取：第一页失败 → 0 页成功（调用方据此记 failed，而不是"没素材"）', async () => {
  const { impl } = fakeFetch({ 1: [] }, [1])
  const r = await fetchNewsFlashes({ fetchImpl: impl, pages: 3 }, '2026-09-01')
  assert.equal(r.pagesFetched, 0)
  assert.equal(r.failedPages, 1)
  assert.equal(r.stopReason, 'error')
  assert.ok(r.lastError.includes('500'))
})

test('抓取：中途失败保留已取到的页（一次网络抖动不该丢掉整段素材）', async () => {
  const { impl } = fakeFetch({ 1: [rawFlash({ create_time: '2026-09-11 10:00:00' })], 2: [] }, [2])
  const r = await fetchNewsFlashes({ fetchImpl: impl, pages: 4 }, '2026-09-01')
  assert.equal(r.pagesFetched, 1)
  assert.equal(r.failedPages, 1)
  assert.equal(r.items.length, 1)
})

test('抓取：一页空 → empty（接口到底，不是失败；空页仍算"成功取回"）', async () => {
  const { impl } = fakeFetch({ 1: [rawFlash({ create_time: '2026-09-11 10:00:00' })], 2: [] })
  const r = await fetchNewsFlashes({ fetchImpl: impl, pages: 5 }, '2026-09-01')
  assert.equal(r.stopReason, 'empty')
  assert.equal(r.pagesFetched, 2, 'HTTP 成功即计入（判"整体失败"看的是 pagesFetched === 0）')
  assert.equal(r.items.length, 1)
})

// ===== ⑥ 采集接线：逐源四态 / 归因正确性 =====

/** 其余源一律空产出的假工具层（本文件只关心快讯源）。 */
function fakeTools(asOf: string) {
  return async (name: string): Promise<unknown> => {
    switch (name) {
      case 'belong_board':
        return []
      case 'kline':
        return [
          { date: '2026-09-10', open: 10, high: 10.1, low: 9.9, close: 10 },
          { date: asOf, open: 10, high: 10.2, low: 9.9, close: 10 },
        ]
      case 'unusual':
      case 'market_monitor':
        return []
      default:
        throw new Error(`未预期的工具调用：${name}`)
    }
  }
}

function newsPage(rows: unknown[]): Record<number, unknown[]> {
  return { 1: rows, 2: [rawFlash({ id: 2, rich_text: '【更早】…', create_time: '2026-09-08 09:00:00' })] }
}

test('接线：news=false → 记「按设计跳过」（离线测试与关闭开关的路径都不许静默）', async () => {
  const out = await collectMaterials(
    { callTool: fakeTools('2026-09-11'), today: '2026-09-11', news: false },
    { asOf: '2026-09-11', members: MEMBERS, windowDays: 5 },
  )
  const rep = out.corpus.sources?.find((s) => s.source === 'news_flash')
  assert.equal(rep?.status, 'skipped_by_design')
  assert.equal(rep?.produced, 0)
  assert.ok(rep?.detail.includes('显式关闭'))
})

test('★ 接线：快讯进语料 —— 事件/点名进、盘面派生汇总剔除并计数', async () => {
  const pages = newsPage([
    rawFlash({ id: 11, rich_text: '【军工板块持续走高 银河电子、博云新材双双涨停】…国科军工均涨超4%。', create_time: '2026-09-11 13:53:44', ext: JSON.stringify({ docurl: 'https://a', stocks: [{ symbol: 'sh688543' }] }) }),
    rawFlash({ id: 12, rich_text: '科创50日内跌幅达3％，成分股中，中科星图跌6.41％。', create_time: '2026-09-11 10:41:08', tag: [{ name: '焦点' }], ext: JSON.stringify({ stocks: [{ symbol: '688568' }] }) }),
    rawFlash({ id: 13, rich_text: '墨西哥国家石油公司称，墨西哥湾原油泄漏已得到控制。', create_time: '2026-09-11 09:00:00', tag: [{ name: '国际' }] }),
  ])
  const { impl } = fakeFetch(pages)
  const out = await collectMaterials(
    { callTool: fakeTools('2026-09-11'), today: '2026-09-11', news: { fetchImpl: impl, pages: 3 } },
    { asOf: '2026-09-11', members: MEMBERS, windowDays: 5 },
  )
  const rep = out.corpus.sources?.find((s) => s.source === 'news_flash')
  assert.equal(rep?.status, 'used')
  assert.equal(rep?.produced, 1, '只有「军工板块」那条进语料')
  assert.ok(rep?.detail.includes('剔除盘面派生汇总 1 条'), `detail 要如实交代剔除了什么（实际：${rep?.detail}）`)
  const news = out.corpus.items.filter((i) => i.source === 'news_flash')
  assert.equal(news.length, 1)
  assert.equal(news[0]?.stock, '688543 国科军工')
  assert.ok(out.sourcesUsed.includes('news_flash'))
})

test('★ 接线：可回溯范围晚于 as_of → 记「按设计跳过」而不是「无产出」（归因不能反）', async () => {
  // 实测：接口只有滚动最新列表，翻到上限也只到最近约 50 小时
  const pages = { 1: [rawFlash({ create_time: '2026-09-12 10:00:00' })], 2: [rawFlash({ create_time: '2026-09-11 20:00:00' })] }
  const { impl } = fakeFetch(pages)
  const out = await collectMaterials(
    { callTool: fakeTools('2026-08-01'), today: '2026-08-01', news: { fetchImpl: impl, pages: 2 } },
    { asOf: '2026-08-01', members: MEMBERS, windowDays: 5 },
  )
  const rep = out.corpus.sources?.find((s) => s.source === 'news_flash')
  assert.equal(rep?.status, 'skipped_by_design', '采不到 ≠ 市场没这事：必须是"按设计跳过"')
  assert.ok(rep?.detail.includes('超出可回溯范围'))
  assert.ok(out.notes.some((n) => n.includes('超出可回溯范围')))
})

test('接线：快讯抓取失败 → 记 failed（且不影响其余素材）', async () => {
  const { impl } = fakeFetch({ 1: [] }, [1])
  const out = await collectMaterials(
    { callTool: fakeTools('2026-09-11'), today: '2026-09-11', news: { fetchImpl: impl, pages: 2 } },
    { asOf: '2026-09-11', members: MEMBERS, windowDays: 5 },
  )
  const rep = out.corpus.sources?.find((s) => s.source === 'news_flash')
  assert.equal(rep?.status, 'failed')
  assert.ok(out.notes.some((n) => n.includes('快讯源抓取失败')))
  assert.ok((out.corpus.sources ?? []).length >= 5, '逐源状态照旧齐全（不能因为一个源失败就少发状态）')
})

test('接线：窗口内没有点名成员 → no_material（市场事实，不是失败）', async () => {
  const pages = newsPage([rawFlash({ id: 21, rich_text: '【某公司公告：拟回购股份】…', create_time: '2026-09-11 11:00:00' })])
  const { impl } = fakeFetch(pages)
  const out = await collectMaterials(
    { callTool: fakeTools('2026-09-11'), today: '2026-09-11', news: { fetchImpl: impl, pages: 3 } },
    { asOf: '2026-09-11', members: MEMBERS, windowDays: 5 },
  )
  const rep = out.corpus.sources?.find((s) => s.source === 'news_flash')
  assert.equal(rep?.status, 'no_material')
  assert.ok(rep?.detail.includes('没有一条点名本组成员'))
  assert.ok(rep?.detail.includes('不是采集失败'))
})

test('接线：窗口外的快讯不得进语料（护栏按日期判窗口，采集侧也不能先塞进去）', async () => {
  const pages = newsPage([
    rawFlash({ id: 31, rich_text: '【军工板块持续走高】…国科军工均涨超4%。', create_time: '2026-08-01 10:00:00', ext: JSON.stringify({ stocks: [{ symbol: 'sh688543' }] }) }),
  ])
  const { impl } = fakeFetch(pages)
  const out = await collectMaterials(
    { callTool: fakeTools('2026-09-11'), today: '2026-09-11', news: { fetchImpl: impl, pages: 3 } },
    { asOf: '2026-09-11', members: MEMBERS, windowDays: 5 },
  )
  assert.equal(out.corpus.items.filter((i) => i.source === 'news_flash').length, 0)
})

test('抓取：翻页上限命中且未覆盖窗口起点 → 明确写出「覆盖不完整」', async () => {
  const pages = { 1: [rawFlash({ create_time: '2026-09-11 10:00:00' })] }
  const { impl } = fakeFetch(pages)
  const out = await collectMaterials(
    { callTool: fakeTools('2026-09-11'), today: '2026-09-11', news: { fetchImpl: impl, pages: 1 } },
    { asOf: '2026-09-11', members: MEMBERS, windowDays: 5 },
  )
  assert.ok(out.notes.some((n) => n.includes('覆盖不完整')), `notes 必须交代覆盖不完整（实际 ${JSON.stringify(out.notes)}）`)
})
