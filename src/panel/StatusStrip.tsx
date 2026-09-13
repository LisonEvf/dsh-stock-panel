/**
 * src/panel/StatusStrip.tsx — 常驻状态带（沉浸式盯盘的「一眼看全局」）。
 *
 * 无论切到哪个视图都在，内容全部是**真实数据**：
 *   时段（server_info 驱动）· 主要指数条（可点开）· 涨跌家数 / 涨停·跌停 / 成交额
 *   · 情绪档位（≈ 近似，口径与作战页一致并标注）· AI 一键入口 · ⌘K 搜索
 *
 * 数据全部走 useSwr 缓存（与市场页/指数页共享同一份缓存 key），因此本组件几乎
 * 不产生额外请求：指数 15s、全 A 快照 30s，且只在面板挂载时轮询。
 *
 * ## 分段优先级（B1 尺寸收口，2026-09-12 实测驱动）
 *
 * 实测：2048px 宽窗口下状态带的右端被 `overflow:hidden` 裁掉 ——
 * **成交额 / 情绪 / 问模型 / ⌘K / 收栏按钮全部看不见**（DOM 与 a11y 树里都在）。
 * 原因是整条带子只有「指数条」那一段可伸缩，其余段 `flex: none`，一旦加起来超出
 * 容器宽度，右侧就被静默切掉（没有任何提示）。
 *
 * 现在的规则（按**容器实测宽度**分档，不看视口）：
 *
 *   full  ≥1440  全部内联
 *   mid   ≥1200  成交额 / 情绪 → ⋯ 菜单
 *   tight ≥1000  再收 涨停·跌停
 *   min   <1000  再收 指数条（指数只在这里才进菜单）
 *
 * 两条硬约束：
 *   1. **必显项永不消失**：阶段、一级导航、涨跌家数、操作区（问模型/⌘K/收左/收右）；
 *   2. **被收走的项必须可在 ⋯ 里读到**（不允许静默消失）——菜单里给的是同一份真实值。
 */
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Ellipsis, Search, Sparkles, PanelLeft, PanelRight } from 'lucide-react'
import { useSwr, swrKey } from '@/lib/cache'
import { computeBreadth, fetchAllA, fetchIndexQuotes, pctText, type IndexQuote } from '@/lib/market'
import { BAND_CAP, bandLabel, computeRegime } from '@/lib/regime'
import { buildClock, type SessionPhase } from '@/lib/session-clock'
import { computePollGate, setPollGate } from '@/lib/poll-gate'
import { callToolJson } from '@/lib/stock-data'
import { fmtAmount } from '@/lib/format'
import { Num } from '@/components/Num'
import { useContainerWidth } from './hooks'
import {
  PRIMARY_VIEWS,
  setSelection,
  setView,
  updateUi,
  useUi,
  type PrimaryView,
} from '@/lib/selection'
import { STAGES, type Stage } from '@/lib/stage'

interface Props {
  /** 打开 ⌘K 搜索面板。 */
  onOpenSearch: () => void
  /** 一键问模型（当前标的）；无标的时由 AppShell 决定是否可用。 */
  onAskAi: () => void
  aiBusy?: boolean
  /** 当前真实阶段（状态带展示 + 点击跳到对应入口）。 */
  stage: Stage
  /** 点击阶段 → 去对应入口（复盘/作战）。 */
  onPickStage: () => void
  /** 切换一级入口（由 AppShell 处理"手动选择"语义）。 */
  onPickView: (v: PrimaryView) => void
  /** 状态带右侧的额外内容（可选）。 */
  right?: ReactNode
}

/**
 * 时段 → 颜色档位。
 *
 * 注意**不要**用 dc-up/dc-down：那是涨跌语义（红涨绿跌），拿红色表示"盘中"会和
 * 用户对行情的读法打架（实测原实现就是 `trading → dc-up` 红）。
 * 时段是"状态"，用与价格解耦的 dc-warn（竞价，需要注意）/ dc-info（盘中，活跃）/
 * dc-flat（休市）。
 */
function phaseTone(phase: SessionPhase): string {
  if (phase === 'auction') return 'dc-warn'
  if (phase === 'trading') return 'dc-info'
  return 'dc-flat'
}

/**
 * 宽度 → 分档。0（还没量到 / display:none）按最宽档处理：
 * 少收一点只是"拥挤"，多收了才是"看不到"。
 */
type StripTier = 'full' | 'mid' | 'tight' | 'min'
function tierOf(width: number): StripTier {
  if (width <= 0 || width >= 1440) return 'full'
  if (width >= 1200) return 'mid'
  if (width >= 1000) return 'tight'
  return 'min'
}

export function StatusStrip({ onOpenSearch, onAskAi, aiBusy = false, stage, onPickStage, onPickView, right }: Props) {
  const ui = useUi()
  const stripRef = useRef<HTMLDivElement>(null)
  const moreRef = useRef<HTMLDivElement>(null)
  const stripWidth = useContainerWidth(stripRef)
  const tier = tierOf(stripWidth)
  const [moreOpen, setMoreOpen] = useState(false)

  // 指数（与指数页/市场页共享缓存）
  const indices = useSwr(swrKey.indices(), () => fetchIndexQuotes(), { ttl: 8000, refreshInterval: 15000 })
  // 全 A 快照（与市场页共享缓存）→ 广度 + 成交额
  const allA = useSwr(swrKey.allA(), () => fetchAllA(), { ttl: 15000, refreshInterval: 30000 })
  // 会话时段（server_info 60s 节流，错了也不影响其它段）
  const clock = useSwr('swr:serverclock', () => callToolJson('server_info', {}), { ttl: 60000, refreshInterval: 60000 })

  const breadth = useMemo(() => (allA.data ? computeBreadth(allA.data) : null), [allA.data])
  const session = useMemo(() => buildClock(clock.data ?? null), [clock.data])

  /**
   * 休市闸门（`lib/poll-gate.ts`）：会话时钟是全站唯一判据来源，这里把它发布出去，
   * `lib/cache.ts` 的轮询循环据此跳过非交易时段的定时请求（详见该模块头部实测背景）。
   */
  useEffect(() => {
    setPollGate(computePollGate({ isTradeDay: session.isTradeDay, phase: session.phase }))
  }, [session])

  /** 情绪档位：与作战页同口径（涨跌/涨停/成交额驱动，晋级率等用近似初值并在 UI 标注 ≈）。 */
  const regime = useMemo(() => {
    if (!breadth || breadth.up + breadth.down === 0) return null
    return computeRegime({
      limitUp: breadth.limitUp,
      limitDown: breadth.limitDown,
      maxStreak: 0,
      promoteRate: 0.4,
      brokenRate: 0.2,
      firstBoardPremium: 1.5,
      upRatio: breadth.up / Math.max(1, breadth.up + breadth.down),
      amountYi: breadth.amountSum / 1e8,
    })
  }, [breadth])

  const quotes = (indices.data ?? []).filter((q) => q.ok).slice(0, 5)

  // 分档：哪些段需要收进 ⋯
  const hide = {
    indices: tier === 'min',
    limits: tier === 'tight' || tier === 'min',
    amount: tier === 'mid' || tier === 'tight' || tier === 'min',
    regime: tier === 'mid' || tier === 'tight' || tier === 'min',
  }
  const hasHidden = hide.indices || hide.limits || hide.amount || hide.regime

  /** ⋯ 菜单的锚点坐标：用 position:fixed 渲染，避免被 `.dc-strip` 的 overflow 裁掉。 */
  const [popPos, setPopPos] = useState<{ top: number; right: number } | null>(null)

  // 菜单开着时：点外面 / 按 Esc 关；分档变化把已收走的项自动合上
  useEffect(() => {
    if (!moreOpen) return
    const onDown = (e: MouseEvent) => {
      if (!moreRef.current?.contains(e.target as Node)) setMoreOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMoreOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [moreOpen])

  // 锚点：跟随 ⋯ 按钮的实际位置（窗口缩放/滚动时重算）
  useLayoutEffect(() => {
    if (!moreOpen) {
      setPopPos(null)
      return
    }
    const place = () => {
      const rect = moreRef.current?.getBoundingClientRect()
      if (!rect) return
      setPopPos({ top: Math.round(rect.bottom + 6), right: Math.max(8, Math.round(window.innerWidth - rect.right)) })
    }
    place()
    window.addEventListener('resize', place)
    window.addEventListener('scroll', place, true)
    return () => {
      window.removeEventListener('resize', place)
      window.removeEventListener('scroll', place, true)
    }
  }, [moreOpen])

  useEffect(() => {
    if (!hasHidden) setMoreOpen(false)
  }, [hasHidden])

  /** 涨停·跌停 / 成交额 / 情绪：同一份真实值，内联与 ⋯ 菜单共用同一套渲染。 */
  const limitSeg = breadth ? (
    <div className="dc-strip-seg" title="涨停 / 跌停家数（按涨停价精确判定）">
      <Num kind="count" value={breadth.limitUp} tone="up" unit="涨停" />
      <Num kind="count" value={breadth.limitDown} tone="down" unit="跌停" />
    </div>
  ) : null
  const amountSeg = breadth ? (
    <div className="dc-strip-seg" title={`两市成交额 ${fmtAmount(breadth.amountSum)}`}>
      <span>额</span>
      {/* 单位/精度走唯一入口 fmtAmount：原实现手算 (x/1e8).toFixed(0) 得 `19870亿`，
          而市场总览走 fmtAmount 得 `1.99万亿` —— 同一个数两种单位，同屏可比性失效（实测）。 */}
      <Num kind="amount" value={breadth.amountSum} className="dc-num" />
    </div>
  ) : null
  const regimeSeg = regime ? (
    <div
      className="dc-strip-seg"
      title={`情绪档位（≈近似：晋级率/炸板率用初值估算）｜仓位总闸上限 ${Math.round(BAND_CAP[regime.band] * 100)}%\n${regime.drivers.join('\n')}`}
    >
      <span>情绪≈</span>
      <strong className={regimeTone(regime.temperature)}>{bandLabel(regime.band)}</strong>
      <span className="dc-num dc-flat">{regime.temperature}</span>
    </div>
  ) : null
  const indexCells = quotes.map((q) => (
    <button
      key={`${q.market}${q.code}`}
      type="button"
      className="dc-index-cell"
      title={`${q.name} 成交额 ${fmtAmount(q.amount)}（点击打开「行情」页的指数区块）`}
      onClick={() => {
        // A6：指数与总览/涨停梯队同在「行情」一级入口下（旧 id 'indices' 仍会被 viewIdOf 映射）
        setView('market')
        setSelection({ market: q.market, code: q.code, name: q.name })
      }}
    >
      <span className="dc-index-name">{shortIndexName(q.name)}</span>
      {/* 必须用 pctText（入参已是百分数，见 lib/stock-data.ts quotePct）——
          fmtPct 吃的是小数、内部再 ×100，误用会把 -1.18% 显示成 -118%。 */}
      <span className={`dc-num ${pctClass(q.pct)}`}>{pctText(q.pct)}</span>
    </button>
  ))

  return (
    <div className={`dc-strip is-tier-${tier}`} ref={stripRef}>
      {/* 阶段（=方法论时段）：一眼看到"现在该干什么"，点击去对应入口 */}
      <button
        type="button"
        className="dc-strip-seg dc-stagechip"
        title={`本阶段该回答的问题：\n${STAGES[stage].questions.join('\n')}\n\n输出：${STAGES[stage].output}`}
        onClick={onPickStage}
      >
        <strong className={phaseTone(session.phase)}>{STAGES[stage].label}</strong>
        <span className="dc-num dc-flat">{session.tradeDate ?? '—'}</span>
      </button>

      <span className="dc-strip-seg dc-strip-sep">|</span>

      {/* 一级导航：方法论两阶段 + 平铺的板块（A6：抽屉拆平，不再有「工具」中间层） */}
      <nav className="dc-nav" aria-label="一级入口">
        {PRIMARY_VIEWS.map((v, i) => (
          <button
            key={v.id}
            type="button"
            title={`${v.hint}（按 ${i + 1}）`}
            className={`dc-nav-item${ui.view === v.id ? ' is-on' : ''}${v.secondary === true ? ' is-secondary' : ''}`}
            onClick={() => onPickView(v.id)}
          >
            {v.label}
          </button>
        ))}
      </nav>

      <span className="dc-strip-seg dc-strip-sep">|</span>

      {/* 指数条（点击 → 打开「行情」一级入口并定位）。min 档收进 ⋯：此时它会被压到 0 宽 */}
      {!hide.indices ? (
        <div className="dc-strip-grow">
          {indices.error && quotes.length === 0 ? (
            <span className="dc-strip-seg dc-flat" title={indices.error}>
              指数不可达
            </span>
          ) : quotes.length === 0 ? (
            <span className="dc-strip-seg dc-flat">指数加载中…</span>
          ) : (
            <div className="dc-index-strip ds-no-scrollbar">{indexCells}</div>
          )}
        </div>
      ) : (
        <div className="dc-strip-grow" />
      )}

      {/* 右簇：必显项 + 可收项 + ⋯。右簇自己 flex:none，可收项按档位摘掉 → 永不越界 */}
      <div className="dc-strip-tails">
        {/* 广度（必显）：上涨/下跌家数 */}
        {breadth ? (
          <div className="dc-strip-seg" title={`上涨 ${breadth.up} / 下跌 ${breadth.down} / 平盘 ${breadth.flat}`}>
            <span className="dc-up dc-num">↑{breadth.up}</span>
            <span className="dc-down dc-num">↓{breadth.down}</span>
          </div>
        ) : (
          <div className="dc-strip-seg dc-flat">{allA.error ? '快照不可达' : '快照加载中…'}</div>
        )}

        {!hide.limits ? limitSeg : null}
        {!hide.amount ? amountSeg : null}
        {!hide.regime ? regimeSeg : null}

        {right}

        {/* ⋯ 溢出菜单：被收走的项在这里以同一份真实值展示（不允许静默消失） */}
        {hasHidden ? (
          <div className="dc-strip-more" ref={moreRef}>
            <button
              type="button"
              className={`dc-btn dc-btn--ghost dc-btn--icon${moreOpen ? ' is-on' : ''}`}
              title="还有几项当前宽度放不下：点开看完整数值"
              aria-expanded={moreOpen}
              aria-haspopup="dialog"
              onClick={() => setMoreOpen((v) => !v)}
            >
              <Ellipsis size={13} />
            </button>
            {moreOpen && popPos !== null ? (
              <div
                className="dc-strip-pop"
                role="dialog"
                aria-label="状态带收起项"
                style={{ top: popPos.top, right: popPos.right }}
              >
                <div className="dc-row-hint">当前宽度放不下（数值与内联一致）</div>
                {hide.indices ? (
                  <div className="dc-strip-pop-row">
                    <span className="dc-strip-pop-label">指数</span>
                    <span className="dc-strip-pop-body dc-index-strip ds-no-scrollbar">{indexCells}</span>
                  </div>
                ) : null}
                {hide.limits ? <div className="dc-strip-pop-row">{limitSeg}</div> : null}
                {hide.amount ? <div className="dc-strip-pop-row">{amountSeg}</div> : null}
                {hide.regime ? <div className="dc-strip-pop-row">{regimeSeg}</div> : null}
              </div>
            ) : null}
          </div>
        ) : null}

        {/* 操作区（必显） */}
        <div className="dc-strip-seg">
          <button
            type="button"
            className="dc-btn dc-btn--accent dc-btn--icon"
            title="一键问模型（当前标的，A）"
            disabled={aiBusy}
            onClick={onAskAi}
          >
            <Sparkles size={12} />
            问模型
          </button>
          <button type="button" className="dc-btn dc-btn--ghost dc-btn--icon" title="搜索标的（⌘K / Ctrl+K）" onClick={onOpenSearch}>
            <Search size={13} />
          </button>
          <button
            type="button"
            className={`dc-btn dc-btn--icon ${ui.leftRail ? '' : 'dc-btn--ghost'}`}
            title="显示/隐藏左栏（[）"
            onClick={() => updateUi({ leftRail: !ui.leftRail })}
          >
            <PanelLeft size={13} />
          </button>
          <button
            type="button"
            className={`dc-btn dc-btn--icon ${ui.rightRail ? '' : 'dc-btn--ghost'}`}
            title="显示/隐藏右栏（]）"
            onClick={() => updateUi({ rightRail: !ui.rightRail })}
          >
            <PanelRight size={13} />
          </button>
        </div>
      </div>
    </div>
  )
}

/** 指数名缩写（状态带窄）。 */
function shortIndexName(name: string): string {
  return name
    .replace('上证指数', '上证')
    .replace('深证成指', '深成')
    .replace('创业板指', '创业')
    .replace('科创综指', '科综')
    .replace('沪深300', '300')
    .replace('中证500', '500')
    .replace('中证1000', '1000')
    .replace('中小100', '中小')
}

/** A 股涨跌配色类（红涨绿跌）。 */
export function pctClass(pct: number | null | undefined): string {
  if (pct === null || pct === undefined || !Number.isFinite(pct) || pct === 0) return 'dc-flat'
  return pct > 0 ? 'dc-up' : 'dc-down'
}

function regimeTone(temp: number): string {
  if (temp >= 70) return 'dc-up'
  if (temp >= 45) return 'dc-warn'
  return 'dc-flat'
}

/** 类型再导出（供视图复用指数数据类型）。 */
export type { IndexQuote }
