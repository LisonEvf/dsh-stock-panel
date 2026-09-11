/**
 * host 半对话工具（chat 联动，零 FastAPI）。
 *
 * 给当前对话注册行情工具，助手可自行取数做个股/市场分析：
 *   stock_quote / stock_kline / stock_tick / stock_unusual
 *
 * 注册方式：raw ToolDefinition（不依赖 @deepseek-ai/dsh-tools 的 defineTool 构建期
 * 导入——包只在运行态宿主侧存在；字段对齐 dsh-tools 的 ToolDefinition 约定：
 * name/description/parameters(JSON Schema)/output{schema,render}/execute(args)).
 */

import { hostKline, hostQuote, hostTick, hostUnusual, hostToolCall } from './host-data'

interface ToolParamsSpec {
  type: 'object'
  properties: Record<string, { type: string; description: string; enum?: string[] }>
  required: string[]
}

interface RawToolDef {
  name: string
  description: string
  parameters: ToolParamsSpec
  output: { schema: { type: string }; render: (args: unknown, value: unknown) => unknown[] }
  execute: (args: Record<string, unknown>) => Promise<unknown>
}

/** 仅 A 股解析：支持 SH600519 / 600519 / sz000001 / 000001.sz 等。 */
export function hostParseSymbol(raw: unknown): { market: 'SH' | 'SZ' | 'BJ'; code: string } | null {
  const s = String(raw ?? '').trim().toUpperCase().replace(/\.(SH|SZ|BJ)$/i, '')
  const m = s.match(/^(SH|SZ|BJ)(\d{6})$/)
  if (m) return { market: m[1] as 'SH' | 'SZ' | 'BJ', code: m[2] }
  const digits = s.replace(/[^0-9]/g, '')
  const code = digits.slice(-6)
  if (!/^\d{6}$/.test(code)) return null
  const market = code.startsWith('6') ? 'SH' : code.startsWith('0') || code.startsWith('3') ? 'SZ' : code.startsWith('4') || code.startsWith('8') || code.startsWith('9') ? 'BJ' : 'SH'
  return { market, code }
}

function f(n: unknown, digits = 2): string {
  const v = Number(n)
  return Number.isFinite(v) ? v.toFixed(digits) : '—'
}

function sign(n: number): string {
  return n > 0 ? '+' : n < 0 ? '−' : ''
}

/** 报价 → 一行摘要（含涨跌幅/量比/换手/成交额）。 */
function quoteText(q: Record<string, unknown>): string {
  const close = Number(q.close ?? 0)
  const pre = Number(q.pre_close ?? 0)
  const pct = pre > 0 ? ((close - pre) / pre) * 100 : 0
  const vr = Number(q.vol_ratio ?? 0)
  const turn = Number(q.turnover ?? 0)
  const amountYi = (Number(q.amount ?? 0) / 1e8).toFixed(1)
  return `${q.name ?? q.code} ${q.code} 现价 ${f(close)}（${sign(pct)}${f(Math.abs(pct))}%）昨收 ${f(pre)} 开 ${f(q.open)} 高 ${f(q.high)} 低 ${f(q.low)} 量比 ${vr > 0 ? f(vr) : '—'} 换手 ${turn > 0 ? `${f(turn)}%` : '—'} 额 ${amountYi}亿`
}

/** 日 K → 紧凑行（升序，展示末尾 days 根）。 */
function klineText(rows: Record<string, unknown>[], days: number): string {
  const want = Math.min(rows.length, Math.max(5, Math.min(days, 90)))
  const show = rows.slice(rows.length - want)
  const head = `日K ${rows.length} 根，展示最近 ${show.length} 根（旧→新）`
  const lines = show.map((r) => {
    const c = Number(r.close ?? 0)
    const o = Number(r.open ?? 0)
    const pct = o > 0 ? ((c - o) / o) * 100 : 0
    return `${String(r.datetime).slice(0, 10)} 开${f(o)} 收${f(c)} 高${f(r.high)} 低${f(r.low)}（较开盘 ${sign(pct)}${f(Math.abs(pct))}%）`
  })
  return [head, ...lines].join('\n')
}

/** 分时 → 抽样行（≤150 点）。 */
function tickText(rows: Record<string, unknown>[]): string {
  const cap = 150
  let show = rows
  if (rows.length > cap) {
    const step = rows.length / cap
    show = rows.filter((_, i) => Math.floor(i / step) !== Math.floor((i - 1) / step) || i === rows.length - 1)
  }
  const head = `分时 ${rows.length} 点（抽样 ${show.length}，time 价格 均价 vol）`
  const lines = show.map((r) => `${r.time ?? '—'} ${f(r.price)} ${r.avg != null ? f(r.avg) : '—'} ${r.vol ?? '—'}`)
  return [head, ...lines].join('\n')
}

/** 异动 → 行（time name code desc value）。 */
function unusualText(rows: Record<string, unknown>[]): string {
  if (!rows.length) return '当前市场无异动事件'
  return rows
    .map((r) => `${r.time ?? '—'} ${r.code ?? ''} ${r.name ?? ''} ${r.desc ?? ''}${r.value ? ` ${r.value}` : ''}`)
    .join('\n')
}

/** 纯文本工具工厂：返回 string，模型侧以 text 呈现。 */
function textTool(
  name: string,
  description: string,
  properties: ToolParamsSpec['properties'],
  required: string[],
  execute: RawToolDef['execute'],
): RawToolDef {
  return {
    name,
    description,
    parameters: { type: 'object', properties, required },
    output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: String(value) }] },
    execute,
  }
}

// ── HIST 自挖概念工具（进程内 HistEngine） ──

function histQueryText(d: Record<string, any>): string {
  if (!d || !d.ok) return `HIST 查询失败：${d?.error ?? '未知'}`
  const st = d.stock ?? {}
  const cls = d.class
  const peers = (d.peers ?? []) as any[]
  const clsLine = cls
    ? `属于自挖类 #${cls.class_id}（规模 ${cls.size}，类内相关 ${cls.mean_intra_corr}）`
    : '不属于任何自挖类（当日孤立）'
  const peersLine = peers.length
    ? `共动邻居：${peers.map((p: any) => `${p.name}(${p.corr})${p.same_class ? '·同类' : ''}`).join('、')}`
    : '无共动邻居'
  return `${st.market ?? ''}${st.code ?? ''}（${st.name ?? ''}）as_of ${d.as_of}；${clsLine}；${peersLine}`
}

function histClassesText(d: Record<string, any>): string {
  if (!d || !d.ok) return `HIST 类概要失败：${d?.error ?? '未知'}`
  const classes = (d.classes ?? []) as any[]
  if (!classes.length) return `as_of ${d.as_of}：无自挖类（${d.isolated_n} 只孤立票）`
  const lines = classes.map((c: any) =>
    `类 #${c.class_id}（规模 ${c.size}，类内相关 ${c.mean_intra_corr}${c.weak_chain ? '，弱链' : ''}）：${(c.top ?? []).join('、')}`)
  return `as_of ${d.as_of} 共 ${d.n} 个自挖类，孤立 ${d.isolated_n} 只：\n${lines.join('\n')}`
}

function histClassMembersText(d: Record<string, any>): string {
  if (!d || !d.ok) return `HIST 类成员失败：${d?.error ?? '未知'}`
  const cls = d.class ?? {}
  const members = (d.members ?? []) as any[]
  const rows = members.map((m: any) => `${m.market}${m.code} ${m.name}（涨幅 ${m.chg_pct ?? '—'}%，类内相关 ${m.mean_corr_to_class ?? '—'}）`)
  return `类 #${cls.class_id}（规模 ${cls.size}，类内相关 ${cls.mean_intra_corr}）成员：\n${rows.join('\n')}`
}

function histStatusText(d: Record<string, any>): string {
  const snap = d?.snapshot ?? {}
  return `HIST 引擎：${d?.engine ?? ''}；快照${d?.snapshot_ready ? '就绪' : '未就绪'}${snap?.as_of ? ` as_of=${snap.as_of}` : ''}；K线缓存 ${d?.kline_cached ?? 0} 条`
}

/**
 * HIST 自挖概念的**调参字段**（三个查询工具共用）。
 *
 * 为什么必须暴露：默认参数在当前实现下会退化（`min_corr=0.45` 出一个 141 只的「弱链」巨类，
 * 类内相关仅 0.027）——**调参不是可选项**。实测（`docs/CONCEPT-CALIBRATION.md`）：
 * `min_corr=0.6 + window=90` 才切出语义自洽的小类（电力/地产/工程机械/面板/白酒…）。
 * 早期这些字段没声明，调用方传了也会被丢掉，于是拿到「看起来对、其实是默认参数」的结果
 * —— 属于静默错误，已修。
 */
const HIST_TUNING_PROPS: Record<string, { type: string; description: string }> = {
  pool_n: { type: 'number', description: '候选池大小（全 A 成交额榜前 N，默认 200）' },
  window: { type: 'number', description: '相关窗口（交易日，默认 60；实测 90 切分更稳）' },
  min_corr: {
    type: 'number',
    description: '聚类切边阈值（默认 0.45；**实测 0.6 才可用**，否则出「弱链」巨类）',
  },
  as_of: { type: 'string', description: '截断日期 YYYY-MM-DD（默认最新交易日）' },
  refresh: { type: 'boolean', description: '强制重建快照（默认用缓存；换日期/参数会自动重建）' },
}

/** 从工具入参里挑出 HIST 调参字段（未给就不传，交给引擎默认）。 */
function histTuningArgs(args: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  if (typeof args.as_of === 'string' && args.as_of !== '') out.as_of = args.as_of
  if (args.refresh === true) out.refresh = true
  for (const key of ['pool_n', 'window', 'min_corr'] as const) {
    const v = Number(args[key])
    if (Number.isFinite(v) && v > 0) out[key] = v
  }
  return out
}

function defs(): RawToolDef[] {
  return [
    textTool(
      'stock_quote',
      '查询 A 股实时报价摘要（现价/涨跌幅/昨收/开高低/量比/换手/成交额）。适合判断个股强弱与盘中状态。symbol 形如 SH600519 / 000001 / sz000001。',
      { symbol: { type: 'string', description: 'A 股代码，如 SH600519、600519、SZ000001' } },
      ['symbol'],
      async (args) => {
        const p = hostParseSymbol(args.symbol)
        if (!p) return `无效代码：${args.symbol}（需 6 位数字，可带 SH/SZ/BJ 前缀）`
        try {
          const q = await hostQuote(p.market, p.code)
          return quoteText(q as Record<string, unknown>)
        } catch (e) {
          return `查询失败：${(e as Error).message}`
        }
      },
    ),
    textTool(
      'stock_kline',
      '查询 A 股日 K 线（默认 60 根，最多 250 根），每行 日期 开/收/高/低 与较开盘涨跌%，用于趋势/形态/量价分析。',
      {
        symbol: { type: 'string', description: 'A 股代码，如 SH600519、600519' },
        days: { type: 'number', description: '根数（默认 60，范围 5–250）' },
      },
      ['symbol'],
      async (args) => {
        const p = hostParseSymbol(args.symbol)
        if (!p) return `无效代码：${args.symbol}`
        const days = Math.max(5, Math.min(250, Number(args.days) || 60))
        try {
          const rows = await hostKline(p.market, p.code, days)
          if (!rows.length) return `${p.market}${p.code} 暂无日 K 数据（休市/停牌/代码有误）`
          return klineText(rows, days)
        } catch (e) {
          return `查询失败：${(e as Error).message}`
        }
      },
    ),
    textTool(
      'stock_tick',
      '查询 A 股当日/最近交易日分时（1 分钟粒度，最多抽样 150 点）：time 价格 均价 vol。用于看日内节奏与承接。',
      { symbol: { type: 'string', description: 'A 股代码，如 SH600519、000001' } },
      ['symbol'],
      async (args) => {
        const p = hostParseSymbol(args.symbol)
        if (!p) return `无效代码：${args.symbol}`
        try {
          const rows = await hostTick(p.market, p.code)
          if (!rows.length) return `${p.market}${p.code} 暂无分时数据`
          return tickText(rows)
        } catch (e) {
          return `查询失败：${(e as Error).message}`
        }
      },
    ),
    textTool(
      'stock_unusual',
      '查询 A 股市场异动事件（涨停/炸板/跌停/拉升/大单等），用于市场情绪与复盘。market 可选 SH/SZ/BJ，默认 SH。',
      { market: { type: 'string', description: '市场 SH/SZ/BJ（默认 SH）', enum: ['SH', 'SZ', 'BJ'] } },
      [],
      async (args) => {
        const market = ['SZ', 'BJ'].includes(String(args.market).toUpperCase()) ? String(args.market).toUpperCase() : 'SH'
        try {
          const rows = await hostUnusual(market, 20)
          return unusualText(rows)
        } catch (e) {
          return `查询失败：${(e as Error).message}`
        }
      },
    ),
    textTool(
      'hist_concept_query',
      '查询一只票的 HIST 自挖概念：所在共动类 + 最近共动邻居（corr/是否同类）。无监督算法把「市场自己认定的板块」挖出来。market 仅 SZ/SH。可用 min_corr/window/pool_n 调粒度（默认参数偏粗）。',
      {
        market: { type: 'string', description: '市场 SZ/SH', enum: ['SZ', 'SH'] },
        code: { type: 'string', description: '股票代码，如 603259' },
        topk: { type: 'number', description: '返回最近共动邻居数（默认 8）' },
        ...HIST_TUNING_PROPS,
      },
      ['market', 'code'],
      async (args) => {
        const market = String(args.market ?? '').toUpperCase()
        if (market !== 'SZ' && market !== 'SH') return `无效市场：${args.market}（仅 SZ/SH）`
        try {
          const d = await hostToolCall('hist_concept_query', {
            market,
            code: String(args.code ?? ''),
            topk: Number(args.topk) || 8,
            ...histTuningArgs(args),
          }) as Record<string, any>
          return histQueryText(d)
        } catch (e) {
          return `查询失败：${(e as Error).message}`
        }
      },
    ),
    textTool(
      'hist_concept_classes',
      '查询全部 HIST 自挖类概要（类id/大小/类内相关/强边密度/前几名成员），等价于「市场今天把哪些股票当成同一个板块」。'
        + '⚠️ weak_chain=true 的是阈值图伪类（类内相关很低），**通常应过滤不采信**；'
        + '默认参数偏粗，实测 min_corr=0.6 + window=90 才切出语义自洽的小类。',
      {
        top_members: { type: 'number', description: '每类展示前几名成员（默认 5）' },
        ...HIST_TUNING_PROPS,
      },
      [],
      async (args) => {
        try {
          const d = await hostToolCall('hist_concept_classes', {
            top_members: Number(args.top_members) || 5,
            ...histTuningArgs(args),
          }) as Record<string, any>
          return histClassesText(d)
        } catch (e) {
          return `查询失败：${(e as Error).message}`
        }
      },
    ),
    textTool(
      'hist_concept_class',
      '查看某个 HIST 自挖类的完整成员表（代码/名称/类内相关/当日涨幅）。class_id 来自 hist_concept_classes；'
        + '**同类 id 在不同参数/日期下代表不同的类**，查询时请带上与列表相同的 min_corr/window/pool_n/as_of。',
      {
        class_id: { type: 'number', description: '类 id（来自 hist_concept_classes）' },
        ...HIST_TUNING_PROPS,
      },
      ['class_id'],
      async (args) => {
        try {
          const d = await hostToolCall('hist_concept_class', {
            class_id: Number(args.class_id) || 0,
            ...histTuningArgs(args),
          }) as Record<string, any>
          return histClassMembersText(d)
        } catch (e) {
          return `查询失败：${(e as Error).message}`
        }
      },
    ),
    textTool(
      'hist_concept_status',
      '查看 HIST 自挖概念引擎状态（配置/快照元信息/缓存）。用于探活与查看当前 as_of/类数。',
      {},
      [],
      async () => {
        try {
          const d = await hostToolCall('hist_concept_status', {}) as Record<string, any>
          return histStatusText(d)
        } catch (e) {
          return `查询失败：${(e as Error).message}`
        }
      },
    ),
  ]
}

/**
 * 注册全部行情对话工具。tools 为 ctx.tools（未注入时静默跳过，不影响布局/面板）。
 * 返回工具数；注册失败的单个工具不影响其余。
 */
export function registerStockTools(tools: { register: (def: unknown) => () => void } | undefined): number {
  if (!tools) return 0
  let n = 0
  for (const d of defs()) {
    try {
      tools.register(d as unknown)
      n++
    } catch (err) {
      console.warn('[stock-panel] 工具注册失败:', d.name, (err as Error).message)
    }
  }
  if (n > 0) console.log(`[stock-panel] 对话行情工具已注册 ×${n}`)
  return n
}
