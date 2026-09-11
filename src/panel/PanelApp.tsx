/**
 * src/panel/PanelApp.tsx — 插件视图根组件（槽位 props → 骨架）。
 *
 * 职责很薄，只做两件事：
 *   1. 把 conversation.view 槽位给的 **标准 props** 适配成骨架能用的「对话通道」
 *      （`inputActions.setDraft` + `submit`，用于「深入对话」一键注入）；
 *   2. 渲染 <AppShell>。
 *
 * 兼容：`OpenStock` 类型仍从这里导出（9 个页面 import 它），现在是
 * lib/selection.ts `Selection` 的别名，避免这次重排波及所有页面。
 *
 * 关于 useInput 的调用：conversation.view 会话级条目的标准 props 一定带
 * `useInput`；为防契约漂移导致渲染崩溃，缺失时回落到模块级空 hook（**调用次数
 * 恒为 1**，因此不违反 hooks 规则），此时仅「深入对话」的草稿冲突检测失效。
 */
import { useMemo, type ReactElement } from 'react'
import { AppShell, type ChatBridge } from './AppShell'

export type { Selection as OpenStock } from '@/lib/selection'

/** conversation.view 槽位 props 的最小本地契约（只声明本插件用到的面）。 */
export interface SlotPropsLike {
  /** 标准 prop：设置/提交输入草稿。 */
  inputActions?: {
    setDraft?: (text: string) => void
    submit?: () => void
  }
  /** 标准 prop：会话输入状态 hook。 */
  useInput?: (selector: (s: { draft?: string }) => unknown) => unknown
  /** 标准 prop：切换到另一个会话视图（保留以备「去对话查看」）。 */
  openView?: (view: string, focus: string) => void
  [key: string]: unknown
}

/** 空 hook：契约缺失时的稳定回落（保证 hooks 调用次数恒定）。 */
const NO_INPUT = (): undefined => undefined

export function PanelApp(props: SlotPropsLike): ReactElement {
  const useInput = typeof props.useInput === 'function' ? props.useInput : NO_INPUT
  const draft = useInput((s) => s.draft)
  const draftText = typeof draft === 'string' ? draft : ''

  const chat = useMemo<ChatBridge>(() => {
    const ia = props.inputActions
    if (ia === undefined || typeof ia.setDraft !== 'function' || typeof ia.submit !== 'function') {
      return {
        available: false,
        reason: '对话通道不可用：槽位未提供 inputActions（也可复制右栏 prompt 手动发送）',
        send: () => undefined,
      }
    }
    if (draftText.trim() !== '') {
      return {
        available: false,
        reason: '对话输入框里已有草稿：先发送或清空，再一键注入（避免覆盖你正在写的内容）',
        send: () => undefined,
      }
    }
    return {
      available: true,
      send: (prompt: string) => {
        ia.setDraft?.(prompt)
        ia.submit?.()
      },
    }
  }, [props.inputActions, draftText])

  return <AppShell chat={chat} />
}
