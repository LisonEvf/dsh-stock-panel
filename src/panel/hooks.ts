/**
 * src/panel/hooks.ts — 盯盘台骨架的小工具 hook（无状态依赖，纯 UI 层）。
 */
import { useEffect, useState } from 'react'
import { isEditableTarget } from '@/lib/selection'

/** 媒体查询订阅（首帧即返回真实值，避免闪一下再收栏）。 */
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return true
    return window.matchMedia(query).matches
  })
  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return
    const mql = window.matchMedia(query)
    const onChange = (e: MediaQueryListEvent) => setMatches(e.matches)
    setMatches(mql.matches)
    mql.addEventListener('change', onChange)
    return () => mql.removeEventListener('change', onChange)
  }, [query])
  return matches
}

/** 定时 tick（用于相对时间/倒计时/时钟显示）。 */
export function useNow(intervalMs = 1000): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), intervalMs)
    return () => window.clearInterval(timer)
  }, [intervalMs])
  return now
}

/**
 * 全局快捷键。默认在可编辑控件（input/textarea/contenteditable）内不触发，
 * 避免抢走用户的打字与对话输入。
 */
export function useHotkeys(
  handler: (e: KeyboardEvent) => void,
  options: { enabled?: boolean; allowInEditable?: boolean } = {},
): void {
  const enabled = options.enabled !== false
  const allowInEditable = options.allowInEditable === true
  useEffect(() => {
    if (!enabled) return
    const onKey = (e: KeyboardEvent) => {
      if (!allowInEditable && isEditableTarget(e.target)) return
      handler(e)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [enabled, allowInEditable, handler])
}
