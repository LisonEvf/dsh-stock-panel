/**
 * 轻量并发池（M6+）：限制对 MCP 服务器的并发请求数，支持取消。
 *
 * 用法：runPool(items, worker, { concurrency, signal }) →
 * 返回与 items 等长的数组（某项失败为 null，不抛断整体）。
 */

export interface PoolOptions {
  /** 最大并发数（默认 6；MCP 服务器/局域网带宽有限，别开太大）。 */
  concurrency?: number
  /** AbortSignal：中止后已排队的项直接置 null（进行中的无法中断，由 worker 自行判断）。 */
  signal?: AbortSignal
}

export async function runPool<T, R>(
  items: readonly T[],
  worker: (item: T, index: number) => Promise<R>,
  options: PoolOptions = {},
): Promise<(R | null)[]> {
  const { concurrency = 6, signal } = options
  if (items.length === 0) return []
  const out: (R | null)[] = new Array(items.length).fill(null)
  let next = 0
  let aborted = false
  if (signal) {
    const onAbort = () => {
      aborted = true
    }
    if (signal.aborted) aborted = true
    else signal.addEventListener('abort', onAbort, { once: true })
  }
  const limit = Math.max(1, Math.min(concurrency, items.length))
  const runWorker = async () => {
    for (;;) {
      if (aborted) return
      const i = next++
      if (i >= items.length) return
      try {
        out[i] = await worker(items[i], i)
      } catch {
        out[i] = null
      }
    }
  }
  await Promise.all(Array.from({ length: limit }, runWorker))
  return out
}
