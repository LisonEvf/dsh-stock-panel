/**
 * tests/serial-queue.test.ts —— 串行队列的单次超时与"链不堵死"契约。
 *
 * 背景（2026-09-12 实测事故）：内置 TDX 的所有调用串在一条 promise 链上且**没有超时**，
 * 一次 `goods_varieties` 挂死后连 `quote` 都 10s+ 无响应，只能重启 dsh web。
 * 这里用假任务把三条不变量钉住：
 *   1. 串行：任务按入队顺序执行，不并发（协议帧不允许交错）；
 *   2. 超时：单次调用超时 → 该次 reject，且**后面的任务照常跑**（链不堵）；
 *   3. 可观测/可恢复：stats 记下超时次数与连续超时，onTimeout 被触发（调用方据此重连）。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createSerialQueue, QueueTimeoutError } from '../src/host/serial-queue'

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

test('串行执行：任务按入队顺序跑，不并发', async () => {
  const q = createSerialQueue({ label: 'test', timeoutMs: 1_000 })
  const order: string[] = []
  let concurrent = 0
  let maxConcurrent = 0
  const task = (tag: string, ms: number) => async () => {
    concurrent += 1
    maxConcurrent = Math.max(maxConcurrent, concurrent)
    await sleep(ms)
    order.push(tag)
    concurrent -= 1
    return tag
  }
  const all = [q.run(task('a', 30)), q.run(task('b', 5)), q.run(task('c', 10))]
  const got = await Promise.all(all)
  assert.deepEqual(got, ['a', 'b', 'c'])
  assert.deepEqual(order, ['a', 'b', 'c'], '完成顺序必须等于入队顺序')
  assert.equal(maxConcurrent, 1, '同一时刻只能有一个任务在跑')
})

test('单次超时：该次 reject 为 QueueTimeoutError，但后面的任务不受影响（链不堵死）', async () => {
  const timeouts: number[] = []
  const q = createSerialQueue({
    label: 'hang',
    timeoutMs: 40,
    onTimeout: (info) => timeouts.push(info.consecutiveTimeouts),
  })
  const never = () => new Promise<never>(() => { /* 永不 settle：模拟卡死的 socket */ })
  const hung = q.run(never)

  await assert.rejects(hung, (err: unknown) => {
    assert.ok(err instanceof QueueTimeoutError, '超时必须是 QueueTimeoutError')
    assert.equal((err as QueueTimeoutError).timeoutMs, 40)
    return true
  })
  // 超时当刻：累计 1 次、连续 1 次、不留 pending
  const afterTimeout = q.stats()
  assert.equal(afterTimeout.timeouts, 1)
  assert.equal(afterTimeout.consecutiveTimeouts, 1)
  assert.equal(afterTimeout.pending, 0, '超时后不能留下 pending 泄漏')
  assert.equal(afterTimeout.inFlight, false)
  assert.deepEqual(timeouts, [1], 'onTimeout 必须被触发（调用方据此重连）')

  // 关键断言：死请求之后的调用仍然能拿到结果，且成功一次后"连续超时"归零、累计数保留
  assert.equal(await q.run(async () => 'ok-after-hang'), 'ok-after-hang')
  const afterRecover = q.stats()
  assert.equal(afterRecover.consecutiveTimeouts, 0, '成功一次即归零')
  assert.equal(afterRecover.timeouts, 1, '累计超时次数不因成功而清零')
})

test('失败不阻断链：前一个任务抛错，后一个照常执行', async () => {
  const q = createSerialQueue({ label: 'test', timeoutMs: 500 })
  const bad = q.run(async () => {
    throw new Error('boom')
  })
  const good = q.run(async () => 42)
  await assert.rejects(bad, /boom/)
  assert.equal(await good, 42)
})

test('连续超时计数会累计，成功一次即归零（供"两次以上就整体重建"的策略用）', async () => {
  const q = createSerialQueue({ label: 'test', timeoutMs: 20 })
  const never = () => new Promise<never>(() => {})
  await assert.rejects(q.run(never))
  await assert.rejects(q.run(never))
  assert.equal(q.stats().consecutiveTimeouts, 2)
  assert.equal(await q.run(async () => 'ok'), 'ok')
  assert.equal(q.stats().consecutiveTimeouts, 0)
  assert.equal(q.stats().timeouts, 2, '累计次数不归零')
})

test('reset：丢弃旧链之后，新任务不再排在死请求后面', async () => {
  const q = createSerialQueue({ label: 'test', timeoutMs: 5_000 })
  void q.run(() => new Promise<never>(() => {})) // 模拟挂死（未超时）
  await sleep(10)
  assert.equal(q.stats().inFlight, true)
  q.reset()
  const t0 = Date.now()
  assert.equal(await q.run(async () => 'fresh'), 'fresh', 'reset 后新任务必须能立即执行')
  assert.ok(Date.now() - t0 < 1_000, '不应等待挂死的旧任务')
})
