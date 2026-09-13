/**
 * src/lib/poll-gate.ts —— **休市闸门**：全站"现在该不该轮询行情"的唯一判据。
 *
 * ## 为什么需要它
 * 休市纪律此前只在作战页实现（页面里直接写"休市期不发起全量行情请求"），
 * 而行情页/状态带/自选栏/监控 Watcher 各写各的定时器 —— 于是同一个周六下午实测：
 *   - 作战页写着「已省掉每轮上百次工具调用」；
 *   - 行情页同时按 30s 节拍轮询三块，其中涨停梯队**单轮 ≤177 次工具调用**；
 *   - 监控规则每 12s 轮一次报价。
 * 同一份"休市"事实，被三处各解释一遍，必然有一处解释错。所以判据收口到这里，
 * 定时器**只有一处**需要认识它：`lib/cache.ts` 的轮询循环（全站唯一的数据轮询入口）。
 *
 * ## 设计要点
 *   1. **只挡"定时轮询"，不挡"按需取数"**：页面挂载/手动刷新/切标的一律照常取数，
 *      用户看到的仍是最新快照。休市挡掉的是"每隔 N 秒再问一遍不会变的数"。
 *   2. **保留定时器**：闸门关闭时定时器继续走，只是不发请求 —— 这样开盘（或用户改判）
 *      后能自动恢复，不需要用户刷新页面。
 *   3. **留一个例外**：会话时钟自身（`swr:serverclock`）必须继续轮询，否则闸门永远
 *      没有重开的依据（它本身就是"现在几点/是不是交易日"的来源）。
 *   4. **判据保守**：会话时钟未知时**放行**（按 TTL 限频），而不是停掉一切 ——
 *      宁可多几次请求，也不要因为拿不到时钟就把面板变成死图。
 */
import { useEffect, useReducer } from 'react'

/** 闸门输入（来自 `session-clock.buildClock`）。 */
export interface PollGateInput {
  /** 是否为交易日（当前实现：工作日近似，法定节假日未细化）。 */
  isTradeDay: boolean
  /** 时段（session-clock 的 SessionPhase）。 */
  phase: string
}

export interface PollGateState {
  /** true = 允许定时轮询。 */
  allowed: boolean
  /** 人类可读原因（进 UI 与诊断面板，必须能解释"为什么停了"）。 */
  reason: string
}

/** 允许轮询的时段（竞价 + 连续交易）。 */
const OPEN_PHASES = new Set(['auction', 'trading'])

/** 会话时钟自身的 SWR key：闸门必须放行它，否则无法重新判断开盘。 */
export const POLL_GATE_EXEMPT_KEYS: readonly string[] = ['swr:serverclock']

/** 纯函数：由会话时钟状态算出闸门。 */
export function computePollGate(input: PollGateInput | null): PollGateState {
  if (input === null) {
    return { allowed: true, reason: '会话时钟未知（保守放行：靠各源 TTL 限频）' }
  }
  if (!input.isTradeDay) {
    return { allowed: false, reason: '非交易日（周末；法定节假日按工作日近似）——行情不会变，停掉定时轮询' }
  }
  if (OPEN_PHASES.has(input.phase)) {
    return { allowed: true, reason: '盘中 / 竞价：按节拍轮询' }
  }
  return { allowed: false, reason: `非交易时段（${input.phase}）——已定盘，停掉定时轮询（手动刷新仍可用）` }
}

// ── 进程内状态（单一真源；由 StatusStrip 的会话时钟驱动） ──

let current: PollGateState = { allowed: true, reason: '尚未取得会话时钟（放行）' }
let skippedTicks = 0
const listeners = new Set<() => void>()

function notify(): void {
  for (const fn of listeners) {
    try {
      fn()
    } catch {
      /* ignore */
    }
  }
}

/** 更新闸门（会话时钟变化时调用；同值不通知）。 */
export function setPollGate(next: PollGateState): void {
  if (next.allowed === current.allowed && next.reason === current.reason) return
  current = next
  notify()
}

/** 当前闸门状态。 */
export function pollGate(): PollGateState {
  return current
}

/** 是否允许定时轮询。 */
export function isPollAllowed(): boolean {
  return current.allowed
}

/** 某个 SWR key 是否豁免闸门（仅会话时钟）。 */
export function isPollGateExempt(key: string): boolean {
  return POLL_GATE_EXEMPT_KEYS.includes(key)
}

/** 记账：被闸门挡下的一次轮询（诊断面板展示"省了多少请求"）。 */
export function notePollSkipped(): void {
  skippedTicks += 1
}

/** 已挡下的轮询次数。 */
export function pollSkippedTicks(): number {
  return skippedTicks
}

/** 订阅闸门变化（UI 显示"已暂停轮询"用）。 */
export function subscribePollGate(fn: () => void): () => void {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

/** React hook：当前闸门状态（页面头部显示"休市 · 已暂停轮询"）。 */
export function usePollGate(): PollGateState {
  const [, force] = useReducer((x: number) => x + 1, 0)
  useEffect(() => subscribePollGate(force), [])
  return current
}

/** 测试用：复位。 */
export function resetPollGate(): void {
  current = { allowed: true, reason: '尚未取得会话时钟（放行）' }
  skippedTicks = 0
  listeners.clear()
}
