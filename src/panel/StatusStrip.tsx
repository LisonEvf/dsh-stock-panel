/**
 * src/panel/StatusStrip.tsx — 常驻状态带（沉浸式盯盘的「一眼看全局」）。
 *
 * 无论切到哪个视图都在，内容全部是**真实数据**：
 *   时段（server_info 驱动）· 主要指数条（可点开）· 涨跌家数 / 涨停·跌停 / 成交额
 *   · 情绪档位（≈ 近似，口径与作战页一致并标注）· AI 一键入口 · ⌘K 搜索
 *
 * 数据全部走 useSwr 缓存（与市场页/指数页共享同一份缓存 key），因此本组件几乎
 * 不产生额外请求：指数 15s、全 A 快照 30s，且只在面板挂载时轮询。
 */
import { useMemo, type ReactNode } from 'react'
import { Search, Sparkles, PanelLeft, PanelRight } from 'lucide-react'
import { useSwr, swrKey } from '@/lib/cache'
import { computeBreadth, fetchAllA, fetchIndexQuotes, pctText, type IndexQuote } from '@/lib/market'
import { BAND_CAP, bandLabel, computeRegime } from '@/lib/regime'
import { buildClock, type SessionPhase } from '@/lib/session-clock'
import { callToolJson } from '@/lib/stock-data'
import { fmtBigNum } from '@/lib/format'
import {
  PRIMARY_VIEWS,
  TOOL_VIEWS,
  closeTool,
  setSelection,
  setTool,
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

/** 时段 → 颜色档位（竞价/盘中高亮，休市压暗）。 */
function phaseTone(phase: SessionPhase): string {
  if (phase === 'auction') return 'dc-warn'
  if (phase === 'trading') return 'dc-up'
  return 'dc-flat'
}

export function StatusStrip({ onOpenSearch, onAskAi, aiBusy = false, stage, onPickStage, onPickView, right }: Props) {
  const ui = useUi()

  // 指数（与指数页/市场页共享缓存）
  const indices = useSwr(swrKey.indices(), () => fetchIndexQuotes(), { ttl: 8000, refreshInterval: 15000 })
  // 全 A 快照（与市场页共享缓存）→ 广度 + 成交额
  const allA = useSwr(swrKey.allA(), () => fetchAllA(), { ttl: 15000, refreshInterval: 30000 })
  // 会话时段（server_info 60s 节流，错了也不影响其它段）
  const clock = useSwr('swr:serverclock', () => callToolJson('server_info', {}), { ttl: 60000, refreshInterval: 60000 })

  const breadth = useMemo(() => (allA.data ? computeBreadth(allA.data) : null), [allA.data])
  const session = useMemo(() => buildClock(clock.data ?? null), [clock.data])

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

  return (
    <div className="dc-strip">
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

      <span className="dc-strip-seg" style={{ color: 'var(--dc-border-strong)' }}>
        |
      </span>

      {/* 一级导航：方法论两阶段 + 自由看盘 */}
      <nav className="dc-nav" aria-label="一级入口">
        {PRIMARY_VIEWS.map((v, i) => (
          <button
            key={v.id}
            type="button"
            title={`${v.hint}（按 ${i + 1}）`}
            className={`dc-nav-item${ui.view === v.id && ui.tool === null ? ' is-on' : ''}`}
            onClick={() => onPickView(v.id)}
          >
            {v.label}
          </button>
        ))}
        {/* 工具抽屉：旧功能入口（总览/指数/梯队/外盘/选股/自选盘/监控/明细） */}
        <button
          type="button"
          className={`dc-nav-item${ui.tool !== null ? ' is-on' : ''}`}
          title="工具（总览/指数/梯队/外盘/选股/自选盘/监控/明细）——按 t 或 ⌘K 也可直达"
          onClick={() => (ui.tool === null ? setTool(TOOL_VIEWS[0].id) : closeTool())}
        >
          工具
        </button>
      </nav>

      <span className="dc-strip-seg" style={{ color: 'var(--dc-border-strong)' }}>
        |
      </span>

      {/* 指数条（点击 → 打开「指数」工具并定位） */}
      <div className="dc-strip-grow">
        {indices.error && quotes.length === 0 ? (
          <span className="dc-strip-seg dc-flat" title={indices.error}>
            指数不可达
          </span>
        ) : quotes.length === 0 ? (
          <span className="dc-strip-seg dc-flat">指数加载中…</span>
        ) : (
          <div className="dc-index-strip">
            {quotes.map((q) => (
              <button
                key={`${q.market}${q.code}`}
                type="button"
                className="dc-index-cell"
                title={`${q.name} 成交额 ${fmtBigNum(q.amount)}（点击打开「行情」页的指数区块）`}
                onClick={() => {
                  // A4 合并后指数与总览/涨停梯队同页：这里打开「行情」（旧 id 'indices' 仍会被 toolIdOf 映射）
                  setTool('market')
                  setSelection({ market: q.market, code: q.code, name: q.name })
                }}
              >
                <span className="dc-index-name">{shortIndexName(q.name)}</span>
                {/* 必须用 pctText（入参已是百分数，见 lib/stock-data.ts quotePct）——
                    fmtPct 吃的是小数、内部再 ×100，误用会把 -1.18% 显示成 -118%。 */}
                <span className={`dc-num ${pctClass(q.pct)}`}>{pctText(q.pct)}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* 广度 + 涨停/跌停 + 成交额 */}
      {breadth ? (
        <>
          <div className="dc-strip-seg" title={`上涨 ${breadth.up} / 下跌 ${breadth.down} / 平盘 ${breadth.flat}`}>
            <span className="dc-up dc-num">↑{breadth.up}</span>
            <span className="dc-down dc-num">↓{breadth.down}</span>
          </div>
          <div className="dc-strip-seg" title="涨停 / 跌停家数（按涨停价精确判定）">
            <span className="dc-up dc-num">涨停 {breadth.limitUp}</span>
            <span className="dc-down dc-num">跌停 {breadth.limitDown}</span>
          </div>
          <div className="dc-strip-seg" title="两市成交额">
            <span>额</span>
            <strong className="dc-num">{(breadth.amountSum / 1e8).toFixed(0)}亿</strong>
          </div>
          {regime ? (
            <div
              className="dc-strip-seg"
              title={`情绪档位（≈近似：晋级率/炸板率用初值估算）｜仓位总闸上限 ${Math.round(BAND_CAP[regime.band] * 100)}%\n${regime.drivers.join('\n')}`}
            >
              <span>情绪≈</span>
              <strong className={regimeTone(regime.temperature)}>{bandLabel(regime.band)}</strong>
              <span className="dc-num dc-flat">{regime.temperature}</span>
            </div>
          ) : null}
        </>
      ) : (
        <div className="dc-strip-seg dc-flat">{allA.error ? '快照不可达' : '快照加载中…'}</div>
      )}

      {right}

      {/* 操作区 */}
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
