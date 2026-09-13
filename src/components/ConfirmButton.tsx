/**
 * ConfirmButton —— 破坏性操作的**两段式内联确认**（审计 UX-PLAN §4「I8 破坏性操作确认/撤销」）。
 *
 * 为什么不用 `window.confirm`：本插件跑在 DSH 页签里（`conversation.view`），原生模态会阻塞
 * 渲染进程、样式与宿主明暗主题无关，而且**代价写不进按钮本身**；为什么不用浮层模态：这几处
 * 操作全在窄栏的高频路径上（自选 / 监控 / 持仓），弹层会打断"盯盘"这个主任务。所以采用
 * 「原地变脸」：同一个热区第二次点击才执行，旁边出现「取消」。
 *
 * 为什么必须自动回退（默认 5s；UX-PLAN I8 的「6s 撤销条」同源）：待确认态若永久保持，
 * "两次点击"会退化成"任意两次点击" —— 用户 3 分钟后回来点的那一下会被当成确认执行。
 * 计时器把第二次点击限定在"同一个意图窗口"内。
 *
 * 为什么用 `armedRef` 而不是只看 state：这些操作一旦执行就不可逆（清空自选、删持仓），
 * 而 `setState` 是异步的 —— 长按回车时浏览器会为同一个键连发 click，state 还没落地就会被
 * 读成"仍在待确认"。ref 在回调里**同步**翻转，于是重复 click 直接作废（幂等闸）。
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'

/** 待确认态的自动回退毫秒（审计 I8 定 5s）。 */
export const CONFIRM_TIMEOUT_MS = 5_000

/**
 * 二次确认的最短间隔：挡掉"双击习惯"（手比脑快的那一下）与长按回车的首批自动重复。
 * 下面的 `onKeyDown` 会 best-effort 抑制 `e.repeat` 的默认行为，但浏览器行为不完全一致，
 * 所以这里再兜一层时间闸 —— 只加 250ms，正常"看清文案再点"的节奏不受影响。
 */
const MIN_GAP_MS = 250

/** 待确认按钮的语气：一律取语义色 token（`dc-bad` = `--dc-danger`，与涨跌红解耦）。 */
const TONE_CLS = { danger: 'dc-bad', warn: 'dc-warn' } as const

/** 取消按钮默认样式（纯 Tailwind；高频窄栏里要比确认钮低调）。 */
const CANCEL_CLS = 'shrink-0 rounded px-1 py-0.5 dc-t-micro text-slate-400 hover:bg-slate-100 hover:text-slate-600'

export interface ConfirmButtonProps {
  /** 初始态内容（文本，或图标；图标请用 `ariaLabel` 补读屏名）。 */
  label: ReactNode
  /** 待确认态内容 —— **写清代价**，例如「确认清空 12 只自选？」。 */
  confirmLabel: ReactNode
  /** 第二次点击时执行（语义与原来的 onClick 完全一致）。 */
  onConfirm: () => void
  /** 原生 title（初始态 / 待确认态都沿用）。 */
  title?: string
  /** 无可见文本时（纯图标）的读屏名。 */
  ariaLabel?: string
  disabled?: boolean
  /** 两个状态的按钮 class（尺寸/排版由调用点决定，本组件只叠语义色）。 */
  className?: string
  cancelLabel?: string
  cancelClassName?: string
  tone?: 'danger' | 'warn'
  timeoutMs?: number
}

export function ConfirmButton({
  label,
  confirmLabel,
  onConfirm,
  title,
  ariaLabel,
  disabled = false,
  className = '',
  cancelLabel = '取消',
  cancelClassName = CANCEL_CLS,
  tone = 'danger',
  timeoutMs = CONFIRM_TIMEOUT_MS,
}: ConfirmButtonProps) {
  const [armed, setArmed] = useState(false)
  const armedRef = useRef(false)
  const armedAtRef = useRef(0)
  const confirmRef = useRef<HTMLButtonElement | null>(null)

  const cancel = useCallback(() => {
    armedRef.current = false
    setArmed(false)
  }, [])

  const arm = () => {
    if (disabled) return
    armedRef.current = true
    armedAtRef.current = Date.now()
    setArmed(true)
  }

  const fire = () => {
    // ① 幂等闸：本次确认已开始 → 忽略同一按键带出的后续 click（见文件头注释）
    if (!armedRef.current) return
    // ② 时间闸：双击习惯 / 长按回车的自动重复
    if (Date.now() - armedAtRef.current < MIN_GAP_MS) return
    armedRef.current = false
    setArmed(false)
    onConfirm()
  }

  // 待确认态：5s 无操作自动回到初始态（**不执行** onConfirm）
  useEffect(() => {
    if (!armed) return
    const t = window.setTimeout(cancel, timeoutMs)
    return () => window.clearTimeout(t)
  }, [armed, cancel, timeoutMs])

  /**
   * 待确认态：Esc 取消。
   *
   * 为什么挂在 window 而不是容器的 onKeyDown：用户可能点完第一下就把鼠标/焦点移走
   * （此时按钮已不在焦点上，"取消"却必须仍然可用）。
   * 为什么 capture + stopPropagation：AppShell / DiagnosticsPanel 都有全局 Esc（关工具页、
   * 关详情）—— 若让事件继续冒泡，「取消待确认」会顺手把整页也关掉，比不做还糟。
   */
  useEffect(() => {
    if (!armed) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      e.preventDefault()
      e.stopPropagation()
      cancel()
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [armed, cancel])

  // 进入待确认态把焦点交给「确认」按钮：Enter/Space 在原生 button 上直接可用，
  // 读屏也会念出新出现的控件（配合下面常驻的 role="status"）。
  useEffect(() => {
    if (armed) confirmRef.current?.focus()
  }, [armed])

  const confirmCls = [className, TONE_CLS[tone], 'font-semibold'].filter(Boolean).join(' ')
  const statusText = `${typeof confirmLabel === 'string' ? confirmLabel : '确认'}：再次点击确认，按 Esc 取消`

  /**
   * 读屏可感知：① 初始态 `aria-expanded=false` / 待确认态 `true`（状态变化的机器可读信号）；
   * ② `role="status"`（隐式 aria-live=polite）**常驻挂载**——若随文案一起新建，部分读屏
   * 不会播报（区域必须先存在、再变内容），所以它在两个状态下都渲染，只是内容为空。
   */
  return (
    <span className="inline-flex shrink-0 items-center gap-1">
      {!armed ? (
        <button
          type="button"
          className={className}
          title={title}
          aria-label={ariaLabel}
          aria-expanded={false}
          disabled={disabled}
          onClick={arm}
        >
          {label}
        </button>
      ) : (
        <>
          <button
            ref={confirmRef}
            type="button"
            className={confirmCls}
            title={title}
            aria-label={typeof confirmLabel === 'string' ? undefined : ariaLabel}
            aria-expanded={true}
            onClick={fire}
            onKeyDown={(e) => {
              // 自动重复的 Enter/Space 不该再算一次"点击"（best-effort，另有 MIN_GAP_MS 兜底）
              if (e.repeat && (e.key === 'Enter' || e.key === ' ')) e.preventDefault()
            }}
          >
            {confirmLabel}
          </button>
          <button type="button" className={cancelClassName} onClick={cancel}>
            {cancelLabel}
          </button>
        </>
      )}
      <span role="status" className="sr-only">
        {armed ? statusText : ''}
      </span>
    </span>
  )
}
