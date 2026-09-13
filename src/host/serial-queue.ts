/**
 * src/host/serial-queue.ts —— 带**单次调用超时**的串行队列（纯逻辑，可离线单测）。
 *
 * ## 为什么需要它（实测事故）
 * 内置 TDX 是所有工具共用的一条长连接，协议帧不允许并发交错，所以原实现把所有调用串成
 * 一条 promise 链（`serial()`）。问题是链上**没有超时**：一旦某次调用永不 settle，
 * `queue = run.catch(...)` 就再也不会前进，之后每一次 quote/kline/board_members 都排在一个
 * 死请求后面 → 整个面板的数据层静默全挂，只有重启 dsh web 才能恢复。
 *
 * 2026-09-12 实测复现：一次 `goods_varieties`（扩展市场 7727）挂住后，
 * `quote` / `server_info` / `hist_concept_status` 全部 10s+ 无响应；与此同时
 * **新进程直连 TDX 只需 216ms** —— 证明不是上游墙，而是进程内这条链被堵死。
 * 浏览器侧虽有 25s 超时（`lib/mcp.ts`），但它只是**放弃等待**：HTTP 连接断了，
 * 服务端那个 await 仍在链上，堵点不会自己消失。
 *
 * ## 设计要点
 *   1. **超时发生在链内部**：`Promise.race` 让这一次调用以错误 settle，链照常前进；
 *      输掉的那次请求我们主动挂一个空 catch，避免变成 unhandled rejection。
 *   2. **分链**：调用方按连接（A 股 7709 / 扩展市场 7727）建多条队列，一条挂住不连坐。
 *   3. **可观测**：`stats()` 暴露 pending / timeouts / consecutiveTimeouts / lastError，
 *      供诊断面板显示"为什么慢了"，而不是让用户对着转圈猜。
 *   4. **可恢复**：连续超时会触发 `onTimeout`（调用方据此重连 + `reset()` 丢弃旧链）。
 */

/** 单次调用超时（区别于业务错误：这是"没等到回答"）。 */
export class QueueTimeoutError extends Error {
  constructor(
    readonly label: string,
    readonly timeoutMs: number,
  ) {
    super(`${label} 调用超时 ${timeoutMs}ms（原请求已放弃等待）`)
    this.name = 'QueueTimeoutError'
  }
}

/** 队列运行态快照（诊断用）。 */
export interface SerialQueueStats {
  /** 链名（'A股' / '扩展市场'…）。 */
  label: string
  /** 单次调用默认超时（ms）。 */
  timeoutMs: number
  /** 排队中（含正在执行）的任务数。 */
  pending: number
  /** 是否有任务正在执行。 */
  inFlight: boolean
  /** 累计入队任务数。 */
  total: number
  /** 累计超时次数。 */
  timeouts: number
  /** 连续超时次数（成功一次即归零）。 */
  consecutiveTimeouts: number
  /** 最近一次超时时间戳。 */
  lastTimeoutAt: number | null
  /** 最近一次成功调用的耗时（ms）。 */
  lastDurationMs: number | null
  /** 最近一次失败原因。 */
  lastError: string | null
}

export interface SerialQueueOptions {
  label: string
  /** 默认单次超时（ms）。 */
  timeoutMs: number
  /** 发生超时时回调（调用方用于重连）。**在链内同步调用**，不要在这里 await 网络。 */
  onTimeout?: (info: { label: string; timeoutMs: number; consecutiveTimeouts: number }) => void
}

export interface SerialQueue {
  /** 入队执行；返回该次调用的结果（失败即 reject，链不受影响）。 */
  run<T>(task: () => Promise<T>, opts?: { timeoutMs?: number }): Promise<T>
  /**
   * 丢弃当前链（**只在重连之后调用**：新连接已就绪时，旧链上的死请求不该再阻塞新请求）。
   * 不中断已发出的请求，只是让后续任务不再排在它后面。
   */
  reset(): void
  stats(): SerialQueueStats
}

/** 创建一个串行队列。 */
export function createSerialQueue(opts: SerialQueueOptions): SerialQueue {
  let chain: Promise<unknown> = Promise.resolve()
  let pending = 0
  let inFlight = false
  let total = 0
  let timeouts = 0
  let consecutive = 0
  let lastTimeoutAt: number | null = null
  let lastDurationMs: number | null = null
  let lastError: string | null = null

  const timeoutMs = Math.max(1, Math.trunc(opts.timeoutMs))

  function snapshot(): SerialQueueStats {
    return {
      label: opts.label,
      timeoutMs,
      pending,
      inFlight,
      total,
      timeouts,
      consecutiveTimeouts: consecutive,
      lastTimeoutAt,
      lastDurationMs,
      lastError,
    }
  }

  function run<T>(task: () => Promise<T>, runOpts?: { timeoutMs?: number }): Promise<T> {
    const ms = Math.max(1, Math.trunc(runOpts?.timeoutMs ?? timeoutMs))
    pending += 1
    total += 1

    const exec = async (): Promise<T> => {
      pending -= 1
      inFlight = true
      const t0 = Date.now()
      let timer: ReturnType<typeof setTimeout> | undefined
      const started = task()
      // 超时后我们会放弃等待 `started`：先挂一个空 catch，别让它变成 unhandled rejection。
      started.catch(() => undefined)
      try {
        const timeout = new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new QueueTimeoutError(opts.label, ms)), ms)
        })
        const value = await Promise.race([started, timeout])
        consecutive = 0
        lastDurationMs = Date.now() - t0
        return value
      } catch (err) {
        lastError = (err as Error)?.message ?? String(err)
        if (err instanceof QueueTimeoutError) {
          timeouts += 1
          consecutive += 1
          lastTimeoutAt = Date.now()
          try {
            opts.onTimeout?.({ label: opts.label, timeoutMs: ms, consecutiveTimeouts: consecutive })
          } catch {
            /* 回调自身出错不影响队列 */
          }
        }
        throw err
      } finally {
        if (timer !== undefined) clearTimeout(timer)
        inFlight = false
      }
    }

    // 前一个任务无论成功/失败都要放行下一个（原实现的 `.then(fn, fn)` 语义，保留）。
    const next = chain.then(exec, exec)
    chain = next.then(
      () => undefined,
      () => undefined,
    )
    return next
  }

  function reset(): void {
    chain = Promise.resolve()
  }

  return { run, reset, stats: snapshot }
}
