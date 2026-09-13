/**
 * src/views/WatchView.tsx — 盯盘主视图（沉浸式看盘的核心工作区）。
 *
 * 宽视图下的三段式在这里落地为「报价头 + 大图 + 下部二级面板」：
 *
 *   ┌ 报价头：名称/现价/涨跌/量比/换手/成交额/涨停·跌停价 · 加自选 · 刷新 ┐
 *   ├ 图区（自适应高度）：K线（MA/筹码/价位线） ⇄ 分时                      │
 *   └ 下部：资金流 / 逐笔 / 竞价（二级切换，复用既有面板组件）              │
 *
 * 与旧「个股 Tab」的关键区别：
 *   1. **不再切页** —— 左栏点票，这里原地换标的（选中态唯一真源：lib/selection.ts）；
 *   2. **模型结论回填视图** —— 右栏 AI 卡给出的支撑/压力/止损/目标，直接以价位线
 *      画到这张 K 线上（`priceLines` prop，见 components/KlineChart.tsx）；
 *   3. **图占满高度** —— 窄列时代图高 300px，宽屏下用 flex 撑满剩余空间。
 *
 * 数据全部走 useSwr 共享 key（与状态带、右栏 AI 上下文同源，不重复请求）。
 */
import { useMemo, useRef, useState } from 'react'
import { Star, RefreshCw, LineChart, Activity } from 'lucide-react'
import { useSwr, swrKey } from '@/lib/cache'
import { fetchKlineRows, fetchQuote } from '@/lib/stock-data'
import { isWatched, watchToggle } from '@/lib/watchlist-store'
import { fmtBigNum, fmtPrice } from '@/lib/format'
import { updateUi, useSelection, useUi } from '@/lib/selection'
import { useVerdict } from '@/lib/ai'
import { KlineChart, type PriceLineSpec } from '@/components/KlineChart'
import { StockIntraday } from '@/components/StockIntraday'
import { StockCapitalFlow } from '@/components/StockCapitalFlow'
import { StockTransactions } from '@/components/StockTransactions'
import { StockAuctionReview } from '@/components/StockAuctionReview'
import { ErrorBar } from '@/components/ErrorBar'
import { pctClass } from '@/panel/StatusStrip'

/** K 线区间预设。 */
const RANGES: Array<{ days: number; label: string }> = [
  { days: 60, label: '3月' },
  { days: 120, label: '6月' },
  { days: 250, label: '1年' },
]

/** 下部二级面板。 */
const PANELS = [
  { id: 'flow', label: '资金流' },
  { id: 'tx', label: '逐笔' },
  { id: 'auction', label: '竞价' },
] as const

type PanelId = (typeof PANELS)[number]['id']

export function WatchView() {
  const sel = useSelection()
  const ui = useUi()
  const [mode, setMode] = useState<'kline' | 'intraday'>('kline')
  const [panel, setPanel] = useState<PanelId>('flow')

  const market = sel?.market ?? null
  const code = sel?.code ?? null
  const symbol = sel === null ? null : `${sel.market}${sel.code}`

  const quoteKey = market !== null && code !== null ? swrKey.quote(market, code) : 'swr:quote:none'
  /**
   * 报价错误的 **kind 保真**（I3）：审计原文指出旧代码读了 `quote.error` 却从不渲染
   * （`WatchView.tsx:59-63`），报价区于是永久显示 `—`，用户以为"今天就是没价"。
   *
   * 渲染它之前还有个小坑：`useSwr` 只保留**错误字符串**（`lib/cache.ts` 的 `SwrEntry.error`
   * 只有 string 字段，`mcp.ts` 新挂的 kind 会在那里被丢掉），而那个文件不在本次改动范围。
   * 所以退一步：在 fetcher 里顺手存一份**原始错误对象**，渲染时优先用它判分类，
   * 取不到再回退字符串（ErrorBar 内部还有消息特征兜底）。
   * 连 key 一起存，是为了切标的时不要把上一只票的错误算到这一只头上。
   */
  const quoteErrRef = useRef<{ key: string; err: unknown } | null>(null)
  const quote = useSwr(
    quoteKey,
    () => {
      if (market === null || code === null) return Promise.resolve(null)
      return fetchQuote(market, code).catch((e: unknown) => {
        quoteErrRef.current = { key: quoteKey, err: e }
        throw e
      })
    },
    { ttl: 6000, refreshInterval: 12000, enabled: market !== null && code !== null },
  )
  const kline = useSwr(
    symbol !== null ? swrKey.kline(symbol, ui.klineDays) : 'swr:kline:none',
    () => (market !== null && code !== null ? fetchKlineRows(market, code, 'DAILY', ui.klineDays) : Promise.resolve([])),
    { ttl: 60000, enabled: symbol !== null && market !== null && code !== null },
  )
  const verdictRec = useVerdict(symbol)

  /** 报价错误：优先用保留的原始对象（带 kind），否则用缓存层给的字符串。 */
  const quoteError: unknown =
    quote.error === undefined
      ? null
      : quoteErrRef.current !== null && quoteErrRef.current.key === quoteKey
        ? quoteErrRef.current.err
        : quote.error
  /** K 线错误：同 quote 的处理（缓存层同样只留字符串）。 */
  const klineError: unknown = kline.error ?? null

  /** 模型价位 → K 线价位线（这就是「模型反馈完善视图」）。 */
  const priceLines = useMemo<PriceLineSpec[]>(() => {
    const lv = verdictRec?.verdict.levels
    if (lv === undefined) return []
    const out: PriceLineSpec[] = []
    if (lv.resistance !== undefined) out.push({ price: lv.resistance, label: '压力(模型)', tone: 'up' })
    if (lv.support !== undefined) out.push({ price: lv.support, label: '支撑(模型)', tone: 'down' })
    if (lv.stop !== undefined) out.push({ price: lv.stop, label: '止损(模型)', tone: 'danger' })
    if (lv.target !== undefined) out.push({ price: lv.target, label: '目标(模型)', tone: 'warn' })
    return out
  }, [verdictRec])

  /** KlineChart 需要 api.ts 的 KlineRow 形状（date 字段），做一次映射。 */
  const chartRows = useMemo(
    () =>
      (kline.data ?? []).map((r) => ({
        symbol: code ?? '',
        date: r.datetime,
        open: r.open,
        high: r.high,
        low: r.low,
        close: r.close,
        volume: r.vol ?? r.volume ?? 0,
        amount: r.amount,
      })),
    [kline.data, code],
  )

  if (sel === null) {
    return (
      <div className="dc-view">
        <div className="dc-empty" style={{ flex: 1 }}>
          <div className="dc-empty-mark">📈</div>
          <div>盯盘台已就绪</div>
          <div>左栏点一只票（或 ⌘K 搜索）→ 主图、资金、逐笔、AI 研判一起联动</div>
          <div className="dc-ai-note">快捷键：⌘K 搜索 · j/k 上下移动 · a 一键问模型 · [ ] 收起左右栏</div>
        </div>
      </div>
    )
  }

  const q = quote.data
  const close = q?.close ?? (chartRows.length > 0 ? chartRows[chartRows.length - 1].close : null)
  const preClose = q?.pre_close ?? null
  const pct = close !== null && preClose !== null && preClose > 0 ? ((close - preClose) / preClose) * 100 : null
  const starred = isWatched(sel.market, sel.code)

  return (
    <div className="dc-view">
      {/* ── 报价头 ── */}
      <div className="dc-quote-head">
        <div className="dc-quote-id">
          <strong>{sel.name || q?.name || sel.code}</strong>
          <span className="dc-num dc-flat">
            {sel.market}
            {sel.code}
          </span>
          <button
            type="button"
            className={`dc-btn dc-btn--icon ${starred ? '' : 'dc-btn--ghost'}`}
            title={starred ? '移出自选' : '加入自选'}
            onClick={() => watchToggle({ market: sel.market, code: sel.code, name: sel.name })}
          >
            <Star size={12} fill={starred ? 'currentColor' : 'none'} />
          </button>
        </div>

        <div className="dc-quote-price">
          <span className={`dc-num ${pctClass(pct)}`} style={{ fontSize: 20, fontWeight: 700 }}>
            {fmtPrice(close)}
          </span>
          <span className={`dc-num ${pctClass(pct)}`}>{pct === null ? '—' : `${pct > 0 ? '+' : ''}${pct.toFixed(2)}%`}</span>
        </div>

        <div className="dc-quote-facts">
          <Fact label="开盘" value={fmtPrice(q?.open)} tone={q ? pctClass((q.open - (preClose ?? q.open))) : ''} />
          <Fact label="最高" value={fmtPrice(q?.high)} />
          <Fact label="最低" value={fmtPrice(q?.low)} />
          <Fact label="量比" value={q?.vol_ratio !== undefined ? q.vol_ratio.toFixed(2) : '—'} />
          <Fact label="换手" value={q?.turnover !== undefined ? `${q.turnover.toFixed(2)}%` : '—'} />
          <Fact label="成交额" value={fmtBigNum(q?.amount)} />
          {q?.buy_price_limit ? <Fact label="涨停" value={fmtPrice(q.buy_price_limit)} tone="dc-up" /> : null}
          {q?.sell_price_limit ? <Fact label="跌停" value={fmtPrice(q.sell_price_limit)} tone="dc-down" /> : null}
        </div>
      </div>

      {/* 报价失败**必须说话**（I3）：facts 区显示 `—` 不是"今天没价"，而是"这一路取数挂了"。
          错误条给出分类 + 建议 + 重试；`onRetry` 走 quote.refresh()（绕过 ttl 立刻重取）。 */}
      {quoteError !== null && (
        <ErrorBar
          className="mx-1.5 mb-1"
          error={quoteError}
          onRetry={() => quote.refresh()}
          retryLabel="重取报价"
          extra="下面报价栏里的「—」表示这一路没取到数（缓存层已下线旧报价，不会拿过期价冒充实时价）。"
        />
      )}

      {/* ── 图区工具条 ── */}
      <div className="dc-chart-bar">
        <div className="dc-seg">
          <button type="button" className={`dc-seg-btn${mode === 'kline' ? ' is-on' : ''}`} onClick={() => setMode('kline')}>
            <LineChart size={11} /> 日K
          </button>
          <button type="button" className={`dc-seg-btn${mode === 'intraday' ? ' is-on' : ''}`} onClick={() => setMode('intraday')}>
            <Activity size={11} /> 分时
          </button>
        </div>

        {mode === 'kline' ? (
          <>
            <div className="dc-seg">
              {RANGES.map((r) => (
                <button
                  key={r.days}
                  type="button"
                  className={`dc-seg-btn${ui.klineDays === r.days ? ' is-on' : ''}`}
                  onClick={() => updateUi({ klineDays: r.days })}
                >
                  {r.label}
                </button>
              ))}
            </div>
            <button
              type="button"
              className={`dc-chip${ui.showMA ? ' is-on' : ''}`}
              onClick={() => updateUi({ showMA: !ui.showMA })}
              title="MA5/10/20"
            >
              MA
            </button>
          </>
        ) : null}

        {priceLines.length > 0 ? (
          <span className="dc-tag" title="来自右栏 AI 研判的关键价位（已画到图上）">
            模型价位 ×{priceLines.length}
          </span>
        ) : null}

        <span style={{ flex: 1 }} />
        <span className="dc-ai-note">
          {/* 细节交给图区里的 ErrorBar，这里只留状态标记，避免同一句话出现两遍 */}
          {kline.status === 'loading' ? 'K线加载中…' : klineError !== null ? 'K线失败' : `${chartRows.length} 根`}
        </span>
        <button
          type="button"
          className="dc-btn dc-btn--icon dc-btn--ghost"
          title="刷新报价与 K 线"
          onClick={() => {
            quote.refresh()
            kline.refresh()
          }}
        >
          <RefreshCw size={12} />
        </button>
      </div>

      {/* ── 图区 ── */}
      <div className="dc-chart-area">
        {mode === 'kline' ? (
          chartRows.length === 0 && kline.status !== 'loading' ? (
            // K 线失败同样不能只留一句话：给出分类 + 重试（此前这里只有一行 `K 线不可用：…`）
            <div className="w-full p-2">
              {klineError !== null ? (
                <ErrorBar error={klineError} onRetry={() => kline.refresh()} retryLabel="重取 K 线" />
              ) : (
                <div className="dc-empty">
                  <div>暂无 K 线数据（休市/数据源空返回）</div>
                </div>
              )}
            </div>
          ) : (
            <KlineChart
              symbol={symbol ?? ''}
              rows={chartRows}
              showMA={ui.showMA}
              height="auto"
              className="dc-chart-fill"
              priceLines={priceLines}
            />
          )
        ) : (
          // 分时是固定高宽的旧组件：放进可滚动容器，避免在矮窗口里被裁掉
          <div className="dc-scroll" style={{ width: '100%' }}>
            <StockIntraday
              market={sel.market}
              code={sel.code}
              baseDate={new Date().toISOString().slice(0, 10)}
              prevClose={preClose ?? 0}
              height={520}
            />
          </div>
        )}
      </div>

      {/* ── 下部二级面板 ── */}
      <div className="dc-subnav">
        {PANELS.map((p) => (
          <button
            key={p.id}
            type="button"
            className={`dc-subnav-item${panel === p.id ? ' is-on' : ''}`}
            onClick={() => setPanel(p.id)}
          >
            {p.label}
          </button>
        ))}
      </div>
      <div className="dc-panel-body dc-scroll">
        {panel === 'flow' ? <StockCapitalFlow market={sel.market} code={sel.code} /> : null}
        {panel === 'tx' ? <StockTransactions market={sel.market} code={sel.code} /> : null}
        {panel === 'auction' ? <StockAuctionReview market={sel.market} code={sel.code} /> : null}
      </div>
    </div>
  )
}

function Fact({ label, value, tone = '' }: { label: string; value: string; tone?: string }) {
  return (
    <span className="dc-fact">
      <span className="dc-fact-label">{label}</span>
      <span className={`dc-num ${tone}`}>{value}</span>
    </span>
  )
}
