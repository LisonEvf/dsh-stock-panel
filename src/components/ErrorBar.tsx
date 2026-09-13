/**
 * src/components/ErrorBar.tsx —— 统一**错误条**（UX-PLAN I3）。
 *
 * ## 和 StateView 的 error 态什么关系（别写重了）
 * `StateView kind="error"` 是**整块区域**没有内容时的占位（居中、带空态标记），
 * 适合"这一格现在什么都没有，因为取数失败了"。
 * 本组件是**贴在内容上方的一条横幅**：页面/卡片里已经有（或将有）别的数据，
 * 只是某一路取数挂了 —— 比如盯盘页报价挂了但 K 线还在、竞价雷达 40 只里挂了 12 只、
 * 选股页信号分析跑挂了一半。这种情况下用居中空态把整块内容顶掉是错的：用户会以为
 * "这一整块都没数据"。
 *
 * ## 为什么必须做它（审计结论）
 * 审计原文三条，全都指向"错误不可区分、不可重试"：
 *   1. `src/lib/mcp.ts:68-70` 旧代码 `throw new Error(name + ': ' + body?.error)` 把 host 半
 *      已经分好的 `kind`（business / unsupported / unavailable，见 `src/host-util.ts:86-99`）
 *      **丢掉了** → 「未知工具」与「数据源离线」在界面上是同一个红字。本组件的第一职责
 *      就是**把 kind 翻译成人话 + 不同建议**；`lib/mcp.ts` 现在抛 `McpToolError`（带 kind）。
 *   2. `src/views/WatchView.tsx:59-63` 读了 `quote.error` 却从不渲染 → 报价区永久显示 `—`，
 *      用户以为"今天就是没价"。本组件就是渲染它的那个东西。
 *   3. `AuctionRadar` / `StockConceptCard` / `ScoutPage` 逐项 catch 静默、失败无出路。
 *
 * ## API
 *   <ErrorBar error={e} onRetry={() => void load()} />                  // 最小用法
 *   <ErrorBar error={e} onRetry={load} onDiagnose={openDiag} />         // 带诊断入口
 *   <ErrorBar error={agg} onRetry={load} extra="逐项失败 12/40" />       // 带补充信息
 *   <ErrorBar error={e} title="命名失败" retryLabel="重命名" />          // 覆盖文案
 *   <ErrorBar error={e} onRetry={load} compact />                       // 单行（窄栏用）
 *
 * `error` 为 `null | undefined | ''` 时**渲染 null** —— 调用方不用自己写条件。
 * `onRetry` 可选（和 StateView 的 error 态不同：那里是整块占位，没重试就是死胡同；
 * 这里是横幅，允许只报告不重试，比如"取消后"的提示）。
 *
 * ## 分类判定顺序（这是本组件的重点，不要随意改）
 *   1. `kind` 直读（`mcpErrorKind(error)`，见 lib/mcp.ts）—— host 亲口说的分类，最可信；
 *   2. 消息里的 host 原文特征（`unknown tool: xxx`，见 `src/host/tdx-data.ts:289`）；
 *   3. 复用 `StateView.classifyStateError`（**只读引用，那个文件由别人维护**）按消息特征兜底。
 * 第 2 步为什么存在：kind 会经过 `lib/cache.ts` 的 `errMsg()` 被降级成**纯字符串**
 * （`SwrEntry.error` 只有 string 字段，而那个文件不在本次改动范围），一旦降级就没 kind 了；
 * 而 host 的未知工具原文是 `unknown tool: xxx`，StateView 的正则收的是
 * `未知工具|unsupported|not supported|不支持|no such tool`，**恰好漏了它**。这里补上，
 * 避免"未知工具"在字符串路径上退化成"业务错"。
 *
 * ## 样式纪律
 * 只用 Tailwind 工具类 + `var(--dc-*)` 语义变量 + 仓库既有语义 class
 * （`dc-btn` / `dc-btn--accent` / `dc-btn--ghost` / `dc-tag` / `dc-tag--danger` /
 * `dc-bad` / `dc-warn` / `dc-flat`）。**不新增 CSS**（`src/index.css.txt` 由并行任务维护）。
 * 颜色一律取 token：`--dc-danger` 表"错误"，不复用涨跌红绿（UX-PLAN V4 硬规则）。
 */
import type { ReactNode } from 'react'
import { RefreshCw, Stethoscope, TriangleAlert, X } from 'lucide-react'
import { classifyStateError, TDX_TIMEOUT_MS, type StateKindLabel } from './StateView'
import { mcpErrorKind, type McpErrorKind } from '@/lib/mcp'

/* ───────────────────────────── 类型 ───────────────────────────── */

export interface ErrorBarProps {
  /** 抛出来的任何东西（Error / 字符串 / 未知）。null/undefined/'' → 不渲染。 */
  error: unknown
  /** 重试入口。**有出路是这一条横幅存在的意义**；确实没有出路时可以不传。 */
  onRetry?: (() => void) | undefined
  /** 诊断入口（诊断面板已在骨架里，页面按需接）。 */
  onDiagnose?: (() => void) | undefined
  /** 覆盖人话标题（默认按分类给）。 */
  title?: ReactNode
  /** 覆盖重试按钮文案（默认"重试"）。 */
  retryLabel?: string
  /** 覆盖诊断按钮文案（默认"诊断"）。 */
  diagnoseLabel?: string
  /**
   * 补充信息（渲染在原因行下面）：逐项失败计数、命中了哪几只之类的**事实**。
   * 审计要求"逐项失败的计数/原因要可见"，就靠它。
   */
  extra?: ReactNode
  /** 关闭入口（可选；只报告不重试时给用户一条退场路）。 */
  onDismiss?: (() => void) | undefined
  /** 单行紧凑形态（窄栏/卡片里用）：原文进 title 属性，仍可悬停读到。 */
  compact?: boolean
  /**
   * 显式指定分类，优先于所有自动判定。
   * 用于调用方**已经知道** kind 的场景（如聚合多条失败后自己判定）。
   */
  kind?: McpErrorKind | null
  className?: string
  /** 无障碍播报（默认 polite）。 */
  live?: 'polite' | 'off'
}

/** 分类结果：人话标题 + 分类标签 + 原始原因。 */
export interface ClassifiedError {
  kindLabel: StateKindLabel
  /** kind 原文（没有 kind 时为 null，表示走的是消息兜底）。 */
  kind: McpErrorKind | null
  title: string
  /** 处置建议（不同 kind 给不同建议 —— 这是本组件存在的理由）。 */
  advice: string
  /** 原始原因，独立成一行小字；保留原文便于对照日志/诊断。 */
  reason: string
  /** 图标色（语义色 **当图标** 用：dc-bad / dc-warn / dc-flat）。 */
  tone: string
}

/* ───────────────────────────── 分类 ───────────────────────────── */

/**
 * kind → 人话。四类必须给**不同**建议，否则做了等于没做：
 *   · business    参数/标的的问题 → 原样重试通常还是同样结果，要改输入；
 *   · unsupported host 没注册这个工具名 → 是版本/重启问题，不是网络问题；
 *   · unavailable 连接没建立/断了 → 去查行情源与网络；
 *   · timeout     请求发出去了没回来 → 数据源忙，重试一般能恢复。
 *
 * `tone` 的取色理由：只用在**图标**上（图形元素 3:1 即可达标），标签文字不按 kind 上色 ——
 * 10px 彩字在明暗两套主题下总有一边不达 AA（语义色 token 亮色偏深、暗色偏亮）。
 */
const KIND_META: Record<
  McpErrorKind,
  { label: StateKindLabel; title: string; advice: string; tone: string }
> = {
  business: {
    label: '业务错',
    title: '这个请求被数据源拒绝了',
    advice: '参数/标的/时段不满足要求；原样重试多半还是同样结果，需要改条件（换标的、改周期、避开非交易时段）。',
    tone: 'dc-warn',
  },
  unsupported: {
    label: '未知工具',
    title: '该数据接口在当前版本不可用',
    advice: '前端调了 host 半没注册的工具名，这是版本不匹配而不是网络问题：重启 dsh web 让 host 重新注册工具后再试。',
    tone: 'dc-flat',
  },
  unavailable: {
    label: '数据源不可达',
    title: '数据源不可达',
    advice: '内置 TDX 桥接连不上或已断开：先确认行情源/网络，再看设置里的传输模式，稍后重试。',
    tone: 'dc-bad',
  },
  timeout: {
    label: '超时',
    title: `取数超时（单次 ${TDX_TIMEOUT_MS / 1000}s 未返回）`,
    advice: '请求已发出但没回来，通常是数据源忙或行情异常；直接重试，仍超时再缩小请求范围（减少标的数/周期数）。',
    tone: 'dc-bad',
  },
}

/**
 * host **原文**口径的"未知工具"：`unknown tool: ${name}`（`src/host/tdx-data.ts:289`）、
 * `unknown hist tool: ${name}`（`src/host/hist-data.ts:136`）。
 * StateView 的正则没收这两个写法，而 kind 一旦被 cache.ts 降级成字符串就只剩消息可判 —— 这里补上。
 */
const HOST_UNSUPPORTED_RE = /unknown (hist )?tool|no such tool|tool not (found|registered)/i

/**
 * 把任意错误归类。判定顺序见文件头注释；`kindOverride` 优先。
 * 导出是为了让页面能自己决定标题（如"命名失败"）时复用同一套分类。
 */
export function classifyErrorBar(error: unknown, kindOverride?: McpErrorKind | null): ClassifiedError {
  const reason = reasonText(error)
  const kind = kindOverride ?? mcpErrorKind(error)
  if (kind !== null) {
    const meta = KIND_META[kind]
    return { kindLabel: meta.label, kind, title: meta.title, advice: meta.advice, reason, tone: meta.tone }
  }
  // 消息兜底 ①：host 原文的未知工具口径（见 HOST_UNSUPPORTED_RE 注释）
  if (HOST_UNSUPPORTED_RE.test(reason)) {
    const meta = KIND_META.unsupported
    return { kindLabel: meta.label, kind: null, title: meta.title, advice: meta.advice, reason, tone: meta.tone }
  }
  // 消息兜底 ②：复用 StateView 的分类（超时 ≠ 空、不可达优先于超时）
  const c = classifyStateError(error)
  const tone = c.kindLabel === '业务错' ? 'dc-warn' : c.kindLabel === '未知工具' ? 'dc-flat' : 'dc-bad'
  const advice =
    c.kindLabel === '未知工具'
      ? KIND_META.unsupported.advice
      : c.kindLabel === '数据源不可达'
        ? KIND_META.unavailable.advice
        : c.kindLabel === '超时'
          ? KIND_META.timeout.advice
          : '按原始原因排查（参数/标的/时段）；若重试仍失败，打开诊断看这一路的取数记录。'
  return { kindLabel: c.kindLabel, kind: null, title: c.title, advice, reason, tone }
}

/**
 * 从任意抛出物里取一段能读的文字。
 * StateView 的 `errorText` 没有导出（那个文件不归本次改动），这里保留同款语义的小实现。
 */
function reasonText(err: unknown): string {
  if (err instanceof Error) return err.message !== '' ? err.message : err.name
  if (typeof err === 'string') return err
  if (err === null) return '未知错误（error 为 null）'
  if (err === undefined) return '未知错误（error 为 undefined）'
  try {
    return JSON.stringify(err) ?? String(err)
  } catch {
    return String(err)
  }
}

/** 空错误判定（null / undefined / 空串都不渲染）。 */
function isEmptyError(err: unknown): boolean {
  return err === null || err === undefined || err === ''
}

/* ───────────────────────────── 组件 ───────────────────────────── */

/** 语义 token（不写死色值：明暗主题跟随 token 层，UX-PLAN V4）。 */
const C = {
  text: 'var(--dc-text)',
  text2: 'var(--dc-text-2)',
  text3: 'var(--dc-text-3)',
  border: 'var(--dc-border)',
  track: 'var(--dc-track)',
} as const

/** 错误块的浅底：从 danger 派生（与 StateView 同一手法，不写死 alpha 十六进制）。 */
const DANGER_SOFT = 'color-mix(in srgb, var(--dc-danger) 10%, transparent)'

export function ErrorBar(props: ErrorBarProps) {
  const {
    error,
    onRetry,
    onDiagnose,
    title,
    retryLabel = '重试',
    diagnoseLabel = '诊断',
    extra,
    onDismiss,
    compact = false,
    kind,
    className,
    live = 'polite',
  } = props

  if (isEmptyError(error)) return null

  const info = classifyErrorBar(error, kind)

  const buttons = (
    <span className="flex shrink-0 items-center gap-1">
      {onRetry !== undefined && (
        <button type="button" className="dc-btn dc-btn--accent" onClick={onRetry} title={info.advice}>
          <RefreshCw className="h-3 w-3" />
          {retryLabel}
        </button>
      )}
      {onDiagnose !== undefined && (
        <button type="button" className="dc-btn dc-btn--ghost" onClick={onDiagnose} title="打开诊断面板看这一路的取数记录">
          <Stethoscope className="h-3 w-3" />
          {diagnoseLabel}
        </button>
      )}
      {onDismiss !== undefined && (
        <button type="button" className="dc-btn dc-btn--ghost dc-btn--icon" onClick={onDismiss} title="关闭这条提示">
          <X className="h-3 w-3" />
        </button>
      )}
    </span>
  )

  // 标签：中性底（`dc-tag` 自带 --dc-track）+ `--dc-text` 文字。
  // 为什么不按 kind 上色：标签是 10px 小字，彩色底/彩色字在**明暗两套主题**下的对比度
  // 都不稳（语义色 token 亮色偏深、暗色偏亮，白字/彩字至少有一边不达 AA）。
  // kind 的区分放在**标签文字 + 图标色 + 处置建议**上 —— 这三样才是"给不同建议"的载体。
  const tag = (
    <span className="dc-tag shrink-0" style={{ color: C.text }}>
      {info.kindLabel}
    </span>
  )
  const icon = <TriangleAlert className={`h-3.5 w-3.5 shrink-0 ${info.tone}`} />
  const tip = `【${info.kindLabel}】${info.advice}\n原因：${info.reason}`

  if (compact) {
    // 单行：人话 + 标签 + 原文（截断，悬停可读全文）+ 按钮
    return (
      <div
        className={'flex items-center gap-1.5 rounded-md border px-2 py-1 ' + (className ?? '')}
        style={{ boxSizing: 'border-box', borderColor: C.border, background: DANGER_SOFT }}
        role="status"
        aria-live={live}
      >
        {icon}
        <span className="shrink-0 dc-t-note font-semibold" style={{ color: C.text }}>
          {title ?? info.title}
        </span>
        {tag}
        <span className="min-w-0 flex-1 truncate font-mono dc-t-data" style={{ color: C.text3 }} title={tip}>
          {info.reason}
        </span>
        {buttons}
      </div>
    )
  }

  return (
    <div
      className={'rounded-md border px-2 py-1 ' + (className ?? '')}
      style={{ boxSizing: 'border-box', borderColor: C.border, background: DANGER_SOFT }}
      role="status"
      aria-live={live}
    >
      {/* 第一行：人话标题 + 分类标签 + 出路（出路必须与标题同一行：视线不用找） */}
      <div className="flex flex-wrap items-center gap-1.5">
        {icon}
        <span className="min-w-0 dc-t-note font-semibold" style={{ color: C.text }}>
          {title ?? info.title}
        </span>
        {tag}
        <span className="flex-1" />
        {buttons}
      </div>

      {/* 第二行：处置建议（不同 kind 不同建议 —— 区分 kind 的**用处**在这里） */}
      <div className="mt-0.5 dc-t-data leading-snug" style={{ color: C.text2 }}>
        {info.advice}
      </div>

      {/* 第三行：原始原因小字（保留原文，便于对照日志与诊断） */}
      <div
        className="mt-0.5 break-words rounded px-1.5 py-0.5 font-mono dc-t-data leading-snug"
        style={{ background: C.track, color: C.text3 }}
        title={info.reason}
      >
        原因：{info.reason}
      </div>

      {extra !== undefined && extra !== null && (
        <div className="mt-0.5 dc-t-data leading-snug" style={{ color: C.text3 }}>
          {extra}
        </div>
      )}
    </div>
  )
}
