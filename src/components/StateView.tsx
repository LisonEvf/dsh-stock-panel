/**
 * src/components/StateView.tsx —— 加载 / 空 / 错误三态的**唯一**实现（UX-PLAN V5）。
 *
 * ## 为什么要它（审计结论，2026-09-12）
 * 仓库里三态是碎片化的：**加载态 7 种、错误态 5 种、空态 4 种**，措辞/位置/颜色各不相同
 * （「加载中…」「盘中数据加载中…」「K 加载中…」「加载市场数据…」…）。用户每换一个页面
 * 就要重新学一遍"这里现在到底是什么状态"。比不统一更严重的是两处**语义丢失**：
 *
 *   1. **超时被当成空**：数据链路有 25s 超时（`lib/mcp.ts` 的 `embeddedCall`），
 *      但界面只会说「暂无数据」→ 用户以为"今天真没行情"，其实只是没取到。
 *      → 所以本组件把 `超时` 提为一等 `kindLabel`（见 `classifyStateError`）。
 *   2. **加载态没有高度**：迟到插入的区块会把已填的表单/列表顶下去
 *      （复盘页填表时被"强度差分分析中…"顶走，是真机实测问题）。
 *      → 所以 `loading` 渲染**固定高度骨架**：高度由 `rows` 一次算定，
 *        不是"先 0 高度、内容到了再撑开"。
 *
 * ## 三条硬约束（写进类型，违反就直接编译不过）
 *   · `loading` 必须给 `rows`（可省，默认 3）→ 高度恒定，列表/表单不跳动；
 *   · `error` 必须给 `onRetry`（**类型级必填**）→ 错误态永远有出路，不允许死胡同；
 *   · `error` 的 `reason` 独立成一行小字 → 上面是人话，下面是原始原因（对照日志用）。
 *
 * ## 用法
 * ```tsx
 * <StateView kind="loading" rows={4} title="盘中数据加载中…" />
 * <StateView kind="empty" title="暂无自选" hint="输入 6 位代码直接加" action={{ label: '去行情页', onClick }} />
 * <StateView kind="error" {...classifyStateError(e)} onRetry={() => void load(true)} />
 * ```
 *
 * ## 样式纪律
 * 只用 Tailwind 工具类 + `var(--dc-*)` 语义变量，并复用仓库既有语义 class
 * （`dc-empty` / `dc-empty-mark` / `dc-btn` / `dc-tag`）。**不新增 CSS**：
 * `src/index.css.txt` 由另一处并行修改，本文件不碰它。
 * 颜色一律取 token（`--dc-danger` 表"错误"，不复用涨跌红绿，见 UX-PLAN V4 的硬规则）。
 */
import type { ReactNode } from 'react'
import { ChevronRight, Inbox, Loader2, RefreshCw, Stethoscope, TriangleAlert } from 'lucide-react'

/* ───────────────────────────── 公共 API ───────────────────────────── */

export type StateKind = 'loading' | 'empty' | 'error'

/**
 * 错误分类标签。**存在的意义是把"超时 ≠ 空"显式化**：
 * 审计发现全仓没有一处区分"超时"与"空"，于是 25s 超时长得跟"今天没数据"一模一样。
 *
 * 说明：`lib/mcp.ts` / `lib/gateway.ts` 目前还没把 host 侧的 `kind`
 * （business / unsupported / unavailable）带到前端（UX-PLAN I3 的事），
 * 所以这里先用 `classifyStateError` 按消息特征归类；等 I3 落地后只需把那个函数
 * 换成读 `err.kind`，调用点不用动。
 */
export type StateKindLabel = '业务错' | '数据源不可达' | '未知工具' | '超时'

/** 一个可执行动作（"空态/错误态不许只说话，必须给出路"）。 */
export interface StateAction {
  label: string
  onClick: () => void
  /** 补充说明：点了会发生什么（多动作列表里显示在标签下方）。 */
  hint?: ReactNode
}

interface BaseProps {
  title?: ReactNode
  hint?: ReactNode
  /** 单个主动作（内联按钮）。 */
  action?: StateAction
  /** 多个动作（纵向带序号的"该做什么"列表，作战页静默期用）。 */
  actions?: StateAction[]
  /** 单行紧凑形态：贴在内容上方的横幅（保留 kindLabel / reason / 重试语义）。 */
  compact?: boolean
  className?: string
  /** 无障碍播报（V6）：加载/错误默认 polite；纯静态空态默认 off。 */
  live?: 'polite' | 'off'
}

export interface LoadingStateProps extends BaseProps {
  kind: 'loading'
  /** 骨架行数（**决定固定高度**；默认 3，1–40 之间收敛）。 */
  rows?: number
}

export interface EmptyStateProps extends BaseProps {
  kind: 'empty'
}

export interface ErrorStateProps extends BaseProps {
  kind: 'error'
  /** 重试入口。**必填**：错误态永远要给出路（审计硬要求）。 */
  onRetry: () => void
  retryLabel?: string
  /** 原始原因，独立成一行小字（人话在上、原文在下）。 */
  reason?: string
  /** 分类标签：业务错 / 数据源不可达 / 未知工具 / 超时。 */
  kindLabel?: StateKindLabel
  /** 可选诊断入口（诊断面板在骨架里已有，页面按需接）。 */
  onDiagnose?: () => void
  diagnoseLabel?: string
}

export type StateViewProps = LoadingStateProps | EmptyStateProps | ErrorStateProps

/* ───────────────────────────── 内部常量 ───────────────────────────── */

/** 语义 token（不写死色值：明暗主题由 token 层跟随，UX-PLAN V4）。 */
const C = {
  text: 'var(--dc-text)',
  text2: 'var(--dc-text-2)',
  text3: 'var(--dc-text-3)',
  dim: 'var(--dc-dim)',
  border: 'var(--dc-border)',
  track: 'var(--dc-track)',
  danger: 'var(--dc-danger)',
} as const

/** 错误块的浅底：从 danger 派生（`color-mix` 与本仓库 token 层同一手法，不写死 alpha 十六进制）。 */
const DANGER_SOFT = 'color-mix(in srgb, var(--dc-danger) 10%, transparent)'

/**
 * 骨架尺寸（px）。**固定高度是这一组常量的唯一目的**：
 * 总高 = 上下 padding + 标题行 + 行数 × 行高 + 行间距，
 * 一次性算定写在容器上 —— 数据迟到时区块不会把下面的表单顶走。
 */
const SKELETON_ROW_H = 12
const SKELETON_GAP = 6
const FRAME_PAD = 12
const TITLE_ROW_H = 18
const TITLE_GAP = 8
/** 骨架行长度的固定节奏（确定性：同一 rows 每次渲染完全一致，避免自身抖动）。 */
const SKELETON_WIDTHS = [100, 92, 84, 96, 72, 88, 64, 78]
const MAX_ROWS = 40

export function skeletonHeight(rows: number, hasTitle: boolean): number {
  const r = clampRows(rows)
  return (
    FRAME_PAD * 2 +
    (hasTitle ? TITLE_ROW_H + TITLE_GAP : 0) +
    r * SKELETON_ROW_H +
    (r - 1) * SKELETON_GAP
  )
}

function clampRows(rows: number): number {
  if (!Number.isFinite(rows)) return 3
  return Math.max(1, Math.min(MAX_ROWS, Math.round(rows)))
}

function hasNode(v: ReactNode): boolean {
  return v !== undefined && v !== null && v !== false && v !== ''
}

/* ───────────────────────────── 主组件 ───────────────────────────── */

export function StateView(props: StateViewProps) {
  if (props.kind === 'loading') return <LoadingView {...props} />
  if (props.kind === 'empty') return <EmptyView {...props} />
  return <ErrorView {...props} />
}

/* ───────────────────────────── loading ───────────────────────────── */

function LoadingView(props: LoadingStateProps) {
  const { title, hint, rows = 3, compact = false, className, live = 'polite' } = props
  const list = compact ? 1 : clampRows(rows)
  const showTitle = hasNode(title)

  return (
    <div
      className={
        (compact
          ? 'flex items-center gap-1.5 rounded-md border px-2 py-1 '
          : 'rounded-md border ') + (className ?? '')
      }
      // 固定高度（border-box 显式声明，避免宿主 reset 差异导致高度含义变化）
      style={{
        boxSizing: 'border-box',
        borderColor: C.border,
        // 非紧凑形态的 padding 与骨架高度用同一组常量算，保证"算出来的高"就是"看到的高"
        padding: compact ? undefined : FRAME_PAD,
        height: compact ? undefined : skeletonHeight(list, showTitle),
      }}
      role="status"
      aria-live={live}
      aria-busy="true"
    >
      <div className="flex items-center gap-1.5" style={{ height: TITLE_ROW_H, color: C.text3 }}>
        <Loader2 className="h-3 w-3 shrink-0 animate-spin" />
        <span className="shrink-0 dc-t-note font-medium">{title ?? '加载中…'}</span>
        {hasNode(hint) && (
          <span className="min-w-0 truncate dc-t-data" style={{ color: C.dim }}>
            {hint}
          </span>
        )}
      </div>
      {!compact && (
        <div className="flex flex-col" style={{ marginTop: TITLE_GAP, gap: SKELETON_GAP }}>
          {Array.from({ length: list }, (_, i) => (
            <div
              key={i}
              style={{
                height: SKELETON_ROW_H,
                width: `${SKELETON_WIDTHS[i % SKELETON_WIDTHS.length]}%`,
                background: C.track,
                borderRadius: 3,
              }}
            />
          ))}
        </div>
      )}
    </div>
  )
}

/* ───────────────────────────── empty ───────────────────────────── */

function EmptyView(props: EmptyStateProps) {
  const { title, hint, action, actions, compact = false, className, live = 'off' } = props

  if (compact) {
    return (
      <div
        className={'flex items-center gap-1.5 rounded-md border px-2 py-1 ' + (className ?? '')}
        style={{ boxSizing: 'border-box', borderColor: C.border }}
        role="status"
        aria-live={live}
      >
        <Inbox className="h-3.5 w-3.5 shrink-0" style={{ color: C.text3 }} />
        {hasNode(title) && (
          <span className="shrink-0 dc-t-note font-medium" style={{ color: C.text2 }}>
            {title}
          </span>
        )}
        {hasNode(hint) && (
          <span className="min-w-0 flex-1 truncate dc-t-data" style={{ color: C.text3 }} title={typeof hint === 'string' ? hint : undefined}>
            {hint}
          </span>
        )}
        <ActionButtons action={action} actions={actions} compact />
      </div>
    )
  }

  return (
    <div
      className={'dc-empty rounded-md border ' + (className ?? '')}
      style={{ boxSizing: 'border-box', borderColor: C.border }}
      role="status"
      aria-live={live}
    >
      {/* 空态也要**用满宽度**：原来 mark/文案/动作各自 `max-w-md`(448px) 居中，
          在主区 1148px 里等于把 61% 的宽度和整块高度白放着（实测作战页/监控页整屏空白）。
          现在拆成"文案 │ 动作"两栏，动作按 `auto-fit minmax(220px,1fr)` 自适应列数——
          窄容器自动回落单栏，宽容器自动变 2–3 列，不靠视口断点。 */}
      <div className="dc-empty-inner">
        <div className="dc-empty-text">
          <span className="dc-empty-mark" style={{ color: C.text3 }}>
            <Inbox className="h-5 w-5" />
          </span>
          {hasNode(title) && (
            <div className="dc-t-data font-semibold" style={{ color: C.text2 }}>
              {title}
            </div>
          )}
          {hasNode(hint) && (
            <div className="dc-t-note leading-relaxed" style={{ color: C.text3 }}>
              {hint}
            </div>
          )}
        </div>
        <div className="dc-empty-actions">
          <ActionButtons action={action} actions={actions} />
        </div>
      </div>
    </div>
  )
}

/* ───────────────────────────── error ───────────────────────────── */

function ErrorView(props: ErrorStateProps) {
  const {
    title,
    hint,
    reason,
    kindLabel,
    action,
    actions,
    onRetry,
    retryLabel = '重试',
    onDiagnose,
    diagnoseLabel = '诊断',
    compact = false,
    className,
    live = 'polite',
  } = props

  const buttons = (
    <span className="flex shrink-0 items-center gap-1.5">
      {/* 重试入口：错误态**必须**有（类型级必填）—— 不允许出现"只能干瞪眼"的错误 */}
      <button type="button" className="dc-btn dc-btn--accent" onClick={onRetry}>
        <RefreshCw className="h-3 w-3" />
        {retryLabel}
      </button>
      {onDiagnose !== undefined && (
        <button type="button" className="dc-btn dc-btn--ghost" onClick={onDiagnose}>
          <Stethoscope className="h-3 w-3" />
          {diagnoseLabel}
        </button>
      )}
    </span>
  )

  if (compact) {
    // 紧凑形态只有一行：优先显示"人话"，原文进 title 属性（鼠标悬停仍读得到，
    // 不至于为了放下原文把横幅撑成两行）。
    const primary = hasNode(hint) ? hint : hasNode(reason) ? `原因：${reason}` : undefined
    const tip = [
      typeof hint === 'string' && hint !== '' ? hint : null,
      hasNode(reason) ? `原因：${String(reason)}` : null,
    ]
      .filter((x): x is string => x !== null)
      .join(' · ')
    return (
      <div
        className={'flex items-center gap-1.5 rounded-md border px-2 py-1 ' + (className ?? '')}
        style={{ boxSizing: 'border-box', borderColor: C.border, background: DANGER_SOFT }}
        role="status"
        aria-live={live}
      >
        <TriangleAlert className="h-3.5 w-3.5 shrink-0" style={{ color: C.danger }} />
        <span className="shrink-0 dc-t-note font-semibold" style={{ color: C.text }}>
          {title ?? '取数失败'}
        </span>
        {kindLabel !== undefined && <span className="dc-tag dc-tag--danger shrink-0">{kindLabel}</span>}
        {hasNode(primary) && (
          <span
            className="min-w-0 flex-1 truncate dc-t-data"
            style={{ color: C.text3 }}
            title={tip !== '' ? tip : undefined}
          >
            {primary}
          </span>
        )}
        {buttons}
      </div>
    )
  }

  return (
    <div
      className={'dc-empty rounded-md border ' + (className ?? '')}
      style={{ boxSizing: 'border-box', borderColor: C.border }}
      role="status"
      aria-live={live}
    >
      <span className="dc-empty-mark" style={{ color: C.danger }}>
        <TriangleAlert className="h-5 w-5" />
      </span>
      <div className="flex flex-wrap items-center justify-center gap-1.5">
        <span className="dc-t-data font-semibold" style={{ color: C.text }}>
          {title ?? '取数失败'}
        </span>
        {kindLabel !== undefined && <span className="dc-tag dc-tag--danger">{kindLabel}</span>}
      </div>
      {hasNode(hint) && (
        <div className="max-w-md dc-t-note leading-relaxed" style={{ color: C.text3 }}>
          {hint}
        </div>
      )}
      {hasNode(reason) && (
        <div
          className="max-w-full break-words rounded px-1.5 py-0.5 font-mono dc-t-data leading-snug"
          style={{ background: C.track, color: C.text3 }}
          title={String(reason)}
        >
          原因：{reason}
        </div>
      )}
      {buttons}
      <ActionButtons action={action} actions={actions} />
    </div>
  )
}

/* ───────────────────────────── 动作区 ───────────────────────────── */

function ActionButtons({
  action,
  actions,
  compact = false,
}: {
  action?: StateAction
  actions?: StateAction[]
  compact?: boolean
}) {
  const list = actions !== undefined && actions.length > 0 ? actions : null

  // 紧凑形态：动作退化成小内联按钮（横幅只有一行，放不下带说明的纵向列表）
  if (compact) {
    if (list === null && action === undefined) return null
    return (
      <span className="flex shrink-0 items-center gap-1">
        {(list ?? []).map((a) => (
          <button
            key={a.label}
            type="button"
            className="dc-btn dc-btn--ghost"
            title={typeof a.hint === 'string' ? a.hint : undefined}
            onClick={a.onClick}
          >
            {a.label}
          </button>
        ))}
        {action !== undefined && (
          <button
            type="button"
            className="dc-btn dc-btn--accent"
            title={typeof action.hint === 'string' ? action.hint : undefined}
            onClick={action.onClick}
          >
            {action.label}
          </button>
        )}
      </span>
    )
  }

  if (list === null && action === undefined) return null

  return (
    <>
      {list !== null && (
        // 多动作 = "此刻该做的 N 件事"：每件事给"点了会去哪"的说明。
        // 列数交给 `.dc-empty-actions` 的 auto-fit 决定（宽度自适应，不写死 max-w-md）。
        <div className="flex w-full flex-col gap-1">
          {list.map((a, i) => (
            <button
              key={a.label}
              type="button"
              onClick={a.onClick}
              className="flex w-full items-center gap-1.5 rounded-md border px-1.5 py-1 text-left hover:bg-[var(--dc-hover)]"
              style={{ boxSizing: 'border-box', borderColor: C.border }}
            >
              <span
                className="flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-full dc-t-micro font-bold"
                style={{ background: 'var(--dc-accent-fill)', color: 'var(--dc-accent-text)' }}
              >
                {i + 1}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate dc-t-note font-medium" style={{ color: C.text }}>
                  {a.label}
                </span>
                {hasNode(a.hint) && (
                  <span className="block truncate dc-t-micro" style={{ color: C.text3 }}>
                    {a.hint}
                  </span>
                )}
              </span>
              <ChevronRight className="h-3 w-3 shrink-0" style={{ color: C.text3 }} />
            </button>
          ))}
        </div>
      )}
      {action !== undefined && (
        <button
          type="button"
          onClick={action.onClick}
          className="dc-btn dc-btn--accent mt-1"
          title={typeof action.hint === 'string' ? action.hint : undefined}
        >
          {action.label}
        </button>
      )}
    </>
  )
}

/* ───────────────────────── 错误分类（超时 ≠ 空） ───────────────────────── */

/** 数据链路单次调用超时（`lib/mcp.ts` 的 `embeddedCall(timeoutMs = 25_000)`）。 */
export const TDX_TIMEOUT_MS = 25_000

export interface ClassifiedStateError {
  kindLabel: StateKindLabel
  /** 人话标题（错误块第一行）。 */
  title: string
  /** 原始原因（独立成一行小字，保留原文便于对照日志/诊断）。 */
  reason: string
}

const UNSUPPORTED_RE = /未知工具|unsupported|not supported|不支持|no such tool/i
const UNAVAILABLE_RE = /不可达|ECONN|socket|reset|断线|未连接|未连上|桥接|离线|offline|failed to fetch|networkerror|network error|网络/i
const TIMEOUT_RE = /超时|timeout|timed out|aborted|abort/i

/**
 * 把任意抛出的错误归纳成 `StateView` 能呈现的三件套：`kindLabel / title / reason`。
 *
 * 判定顺序有讲究：**"不可达"优先于"超时"**——因为像
 * 「行情源不可达：指数请求全部失败（MCP 超时或数据源离线）」这种复合文案，
 * 对用户来说结论是"源不可达"；而纯粹的「内置 TDX 请求超时(25000ms)」才是超时。
 *
 * ⚠️ 这是**临时 shim**：host 侧其实已经带 `kind`（`host-util.ts`：business /
 * unsupported / unavailable），只是没传到前端（UX-PLAN I3）。等 I3 落地，
 * 这里改成读 `err.kind` 即可，调用点不用动。
 */
export function classifyStateError(err: unknown, fallbackTitle = '取数失败'): ClassifiedStateError {
  const reason = errorText(err)
  if (UNSUPPORTED_RE.test(reason)) {
    return { kindLabel: '未知工具', title: '该数据接口在当前版本不可用', reason }
  }
  if (UNAVAILABLE_RE.test(reason)) {
    return { kindLabel: '数据源不可达', title: '数据源不可达', reason }
  }
  if (TIMEOUT_RE.test(reason)) {
    return { kindLabel: '超时', title: `取数超时（单次 ${TDX_TIMEOUT_MS / 1000}s 未返回）`, reason }
  }
  return { kindLabel: '业务错', title: fallbackTitle, reason }
}

function errorText(err: unknown): string {
  if (err instanceof Error) return err.message !== '' ? err.message : err.name
  if (typeof err === 'string') return err
  try {
    return JSON.stringify(err) ?? String(err)
  } catch {
    return String(err)
  }
}
