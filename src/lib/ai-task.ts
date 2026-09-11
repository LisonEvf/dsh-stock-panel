/**
 * src/lib/ai-task.ts — 通用「一键问模型」运行器（页面级 AI 落点共用）。
 *
 * 与 panel/use-ai.ts 的 `useAiVerdict` 的区别：
 *   - `useAiVerdict` 是**盯盘工作台**专用（自带报价/K线/资金流上下文组装 + 结论存档）；
 *   - 本模块是**通用**的：调用方自己组装上下文、自己解释结果（复盘预期清单、选股候选排序）。
 *
 * 三件事统一在这里做，避免每个页面各写一遍：
 *   1. 可用性探测（GET 同路由，宿主没挂 LLM 服务时按钮优雅置灰）；
 *   2. running / error / meta 状态机 + 取消（同一页面重复点按不叠加请求）；
 *   3. 永不抛异常（失败一律转成 error 文案）。
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { aiAvailability, runAiTask, type AiAvailability } from './ai'
import type { AiCallMeta, AiTaskKind, AiTaskRequest, AiTaskResponse } from './ai-contract'

export type AiTaskStatus = 'idle' | 'running' | 'ok' | 'error'

export interface AiTaskRunner {
  status: AiTaskStatus
  /** 失败原因（含「宿主不可用」的说明）。 */
  error?: string
  /** 模型原文（结构化失败时的兜底展示）。 */
  text?: string
  /** 模型思考（reasoning-delta，可折叠展示）。 */
  reasoning?: string
  meta?: AiCallMeta
  /** 可用性（null = 尚未探测完成）。 */
  availability: AiAvailability | null
  busy: boolean
  /** 执行一次；返回原始回包供调用方用类型化助手解析。 */
  run: (context: unknown, ask?: string) => Promise<AiTaskResponse | null>
  /** 清掉上次结果（例如换了筛选条件）。 */
  reset: () => void
}

export function useAiTask(kind: AiTaskKind): AiTaskRunner {
  const [status, setStatus] = useState<AiTaskStatus>('idle')
  const [error, setError] = useState<string | undefined>(undefined)
  const [text, setText] = useState<string | undefined>(undefined)
  const [reasoning, setReasoning] = useState<string | undefined>(undefined)
  const [meta, setMeta] = useState<{ provider: string; model: string; ms: number } | undefined>(undefined)
  const [availability, setAvailability] = useState<AiAvailability | null>(null)
  const abortRef = useRef<AbortController | null>(null)

  useEffect(() => {
    let alive = true
    void aiAvailability().then((a) => {
      if (alive) setAvailability(a)
    })
    return () => {
      alive = false
    }
  }, [])

  const run = useCallback(
    async (context: unknown, ask?: string): Promise<AiTaskResponse | null> => {
      if (abortRef.current !== null) abortRef.current.abort()
      const ac = new AbortController()
      abortRef.current = ac
      setStatus('running')
      setError(undefined)

      const req: AiTaskRequest = { task: kind, context, ...(ask !== undefined && ask !== '' ? { ask } : {}) }
      const res = await runAiTask(req.task, req.context, req.ask, ac.signal)
      if (ac.signal.aborted) return null

      if (!res.ok) {
        setStatus('error')
        setError(res.error ?? '未知错误')
        setMeta(res.meta)
        return res
      }
      setStatus('ok')
      setText(res.text)
      setMeta(res.meta)
      const r = (res as { reasoning?: string }).reasoning
      setReasoning(r)
      return res
    },
    [kind],
  )

  const reset = useCallback(() => {
    if (abortRef.current !== null) abortRef.current.abort()
    abortRef.current = null
    setStatus('idle')
    setError(undefined)
    setText(undefined)
    setReasoning(undefined)
    setMeta(undefined)
  }, [])

  return {
    status,
    ...(error !== undefined ? { error } : {}),
    ...(text !== undefined ? { text } : {}),
    ...(reasoning !== undefined ? { reasoning } : {}),
    ...(meta !== undefined ? { meta } : {}),
    availability,
    busy: status === 'running',
    run,
    reset,
  }
}
