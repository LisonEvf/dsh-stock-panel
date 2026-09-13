/**
 * 告警常驻 Watcher（M7）：挂载于面板壳根节点（任意 Tab 激活均生效）。
 *
 * 轮询（12s，document 隐藏/面板卸载即停）：
 *   1. price/pct 规则 → 对其标的（去重 ≤10）拉实时报价 → evaluateQuoteRule；
 *   2. event_keyword 规则 → 只扫描「新增事件」（事件流顶部 key 变化后的增量）。
 * 命中 → recordHit（60s 同文案合并）+ 冷却 Map（同规则同标的 5 分钟只提醒一次），
 * 由订阅方（监控 Tab 徽标 / PanelApp Toast）感知。
 *
 * 预算：price 规则标的数 × 1 请求 /12s（上限 10）；关键词规则 0 额外请求。
 *
 * ## 失败可见（2026-09-12 审计补齐，本文件的核心改动）
 *
 * 原实现把取数失败**静默吞掉**（worker 里 `catch { return null }`）：价格规则拉不到
 * 报价时，命中列表一直空着，用户会得出「今天没信号」的结论 —— 实际只是取数失败。
 * 这比"报错"更有害：错误结论看起来和正常结论一模一样。
 *
 * 现在每轮轮询都把结果写进一个**模块级健康度 store**：
 *   · 零新增依赖/全局状态库 —— 与 `lib/alerts`、`lib/selection` 同款
 *     「模块级内存态 + 订阅 + React hook」手法，本文件自带，不需要动 lib/；
 *   · 监控页（AlertsPage）用 `useWatcherHealth()` 读它，在有失败时显示
 *     「连续失败 N 轮 + 原始原因 + 立即重试」，并用 `runWatcherNow()` 手动补跑一轮；
 *   · 失败不阻断其它标的/其它规则（保持原语义），只是**不再无声**。
 *
 * 计时器数量不变：仍是唯一一个 `setInterval(TICK_MS)`
 * （`scripts/budget.mjs` 的棘轮只降不升，本轮改动不新增轮询声明点）。
 */

import { useEffect, useRef, useSyncExternalStore } from 'react'
import { getEvents } from '@/lib/event-stream'
import { fetchQuote } from '@/lib/stock-data'
import { runPool } from '@/lib/pool'
import { isPollAllowed } from '@/lib/poll-gate'
import type { MarketTag } from '@/lib/symbol'
import {
  evaluateEventRule,
  evaluateQuoteRule,
  getRules,
  recordHit,
  ruleLabel,
  subscribeAlerts,
  type AlertRule,
} from '@/lib/alerts'

const TICK_MS = 12_000
const COOLDOWN_MS = 5 * 60_000 // 同规则同标的提醒冷却
const MAX_SYMBOLS = 10

/* ─────────────────────── 健康度 store（失败可见） ─────────────────────── */

/** 轮询健康度快照（监控页呈现「为什么没有命中」用）。 */
export interface WatcherHealth {
  /** 生效（enabled）规则条数；0 = 不发任何取数请求。 */
  enabledRules: number
  /** 本轮涉及的价格标的数（取数预算诊断用，上限 MAX_SYMBOLS）。 */
  quoteTargets: number
  /** 本轮增量扫描到的新事件数（关键词规则）。 */
  scannedEvents: number
  /** 连续失败轮数（任一轮无失败即归零）。 */
  failStreak: number
  /** 最近一次失败的原始原因（保留到下次成功：回答"刚才为什么没提醒"）。 */
  lastFailReason: string
  /** 最近一次完成轮询的时间（成功或失败）。 */
  lastTickAt: number
  /** 最近一次无失败轮询的时间（0 = 还没成功过）。 */
  lastOkAt: number
  /** 上一轮是否因标签页隐藏而被跳过（不区分"没跑"与"跑了没命中"很重要）。 */
  skippedHidden: boolean
  /** 上一轮是否因**休市闸门**被跳过（非交易时段价格不动，不必每 12s 问一遍）。 */
  skippedClosed: boolean
}

const INITIAL_HEALTH: WatcherHealth = {
  enabledRules: 0,
  quoteTargets: 0,
  scannedEvents: 0,
  failStreak: 0,
  lastFailReason: '',
  lastTickAt: 0,
  lastOkAt: 0,
  skippedHidden: false,
  skippedClosed: false,
}

let health: WatcherHealth = INITIAL_HEALTH
const healthSubs = new Set<() => void>()

/** 健康度快照（非 React 场景用）。 */
export function getWatcherHealth(): WatcherHealth {
  return health
}

/** 订阅健康度变化；返回退订函数。 */
export function subscribeWatcherHealth(fn: () => void): () => void {
  healthSubs.add(fn)
  return () => healthSubs.delete(fn)
}

function publishHealth(patch: Partial<WatcherHealth>): void {
  health = { ...health, ...patch }
  for (const fn of Array.from(healthSubs)) {
    try {
      fn()
    } catch {
      /* 订阅方异常不影响轮询 */
    }
  }
}

/**
 * React hook：订阅健康度（监控页直接用，不必自己写订阅）。
 *
 * 用 `useSyncExternalStore` 而不是 `useState + useEffect`：后者在"订阅生效前又跑完了一轮"
 * 时有概率读到过期快照（要等下一轮 12s 才纠正）；外部 store 的标准读法没有这个缝
 * （与 `lib/cache.ts` 同一手法）。快照对象只在 publish 时替换，引用稳定，不会自激重渲。
 */
export function useWatcherHealth(): WatcherHealth {
  return useSyncExternalStore(subscribeWatcherHealth, getWatcherHealth)
}

/**
 * 当前挂载中的轮询函数（挂载时登记、卸载时清空）。
 * 为什么是一个模块级函数引用而不是 Context：Watcher 在壳根、监控页在工具页，
 * 两者唯一的交集就是「现在帮我补跑一轮」这一个动作，一个引用足够，不引全局状态库。
 */
let tickRef: (() => Promise<void>) | null = null

/** 立刻补跑一轮（监控页「立即重试」）。Watcher 未挂载时是 no-op，返回 false。 */
export function runWatcherNow(): boolean {
  if (tickRef === null) return false
  void tickRef()
  return true
}

function errText(e: unknown): string {
  if (e instanceof Error) return e.message !== '' ? e.message : e.name
  return typeof e === 'string' ? e : String(e)
}

/* ─────────────────────────────── 组件 ─────────────────────────────── */

export function AlertWatcher(): null {
  const rulesRef = useRef<AlertRule[]>([])
  const cooldownRef = useRef<Map<string, number>>(new Map())
  const topEventKeyRef = useRef('')

  // 规则快照同步到 ref（alerts 变更即时生效，不重启轮询）
  useEffect(() => {
    const sync = () => {
      rulesRef.current = getRules()
    }
    sync()
    return subscribeAlerts(sync)
  }, [])

  useEffect(() => {
    const hitOnce = (rule: AlertRule, symbolKey: string | undefined, message: string) => {
      const ck = `${rule.id}|${symbolKey ?? ''}`
      const now = Date.now()
      if (now - (cooldownRef.current.get(ck) ?? 0) < COOLDOWN_MS) return
      cooldownRef.current.set(ck, now)
      recordHit({
        ruleId: rule.id,
        ruleLabel: ruleLabel(rule),
        symbol: symbolKey,
        message,
      })
    }

    const tick = async () => {
      const rs = rulesRef.current.filter((r) => r.enabled)
      // 本轮记账（失败**计数 + 原因**，而不是静默吞掉）
      let failed = 0
      let quoteTargets = 0
      let scannedEvents = 0
      let failReason = ''

      try {
        const priceRules = rs.filter(
          (r) =>
            !!r.market && !!r.code && (r.type === 'price_above' || r.type === 'price_below' || r.type === 'pct_above' || r.type === 'pct_below'),
        )

        // 1) 价格/涨跌幅规则：对涉及标的（去重 ≤10）拉实时报价
        if (priceRules.length) {
          const seen = new Set<string>()
          const targets: { market: MarketTag; code: string }[] = []
          for (const r of priceRules) {
            const key = `${r.market}${r.code}`
            if (seen.has(key) || targets.length >= MAX_SYMBOLS) continue
            seen.add(key)
            targets.push({ market: r.market as MarketTag, code: r.code as string })
          }
          quoteTargets = targets.length
          const snaps = await runPool(targets, async (t) => {
            try {
              return await fetchQuote(t.market, t.code)
            } catch (e) {
              // 语义不变（单个标的失败不阻断其它标的），但**记账**：以前这里完全静默
              failed += 1
              if (failReason === '') failReason = `${t.market}${t.code} ${errText(e)}`
              return null
            }
          }, { concurrency: 4 })
          targets.forEach((t, i) => {
            const q = snaps[i]
            if (!q) return // 取数异常已在 worker 里记为失败
            if (!Number.isFinite(Number(q.close))) {
              // 拿到了对象但没有可用价格：和"取不到"是同一件事（假数据比空更危险）
              failed += 1
              if (failReason === '') failReason = `${t.market}${t.code} 报价缺 close 字段`
              return
            }
            const snap = {
              market: t.market,
              code: t.code,
              name: q.name || undefined,
              close: Number(q.close),
              pre_close: Number(q.pre_close ?? 0),
            }
            for (const r of priceRules) {
              if (r.market === t.market && r.code === t.code) {
                const msg = evaluateQuoteRule(r, snap)
                if (msg) hitOnce(r, `${t.market}${t.code}`, msg)
              }
            }
          })
        }

        // 2) 异动关键词规则：增量扫描事件流（顶部 key 变化后的新事件）
        const kwRules = rs.filter((r) => r.type === 'event_keyword')
        if (kwRules.length) {
          const evs = getEvents()
          const topKey = evs.length ? evs[0].key : ''
          if (topKey && topKey !== topEventKeyRef.current) {
            const prevIdx = topEventKeyRef.current ? evs.findIndex((e) => e.key === topEventKeyRef.current) : -1
            const fresh = prevIdx === -1 ? evs : evs.slice(0, prevIdx)
            scannedEvents = fresh.length
            for (const e of fresh) {
              for (const r of kwRules) {
                if (evaluateEventRule(r, { name: e.name, desc: e.desc, code: e.code })) {
                  hitOnce(r, `${e.market}${e.code}`, `事件 ${e.time} ${e.name} ${e.desc}`)
                }
              }
            }
          }
          topEventKeyRef.current = topKey
        }
      } catch (e) {
        // 兜底：任何未预料的异常也必须变成"可见的失败"，绝不允许再变成静默空列表
        failed += 1
        if (failReason === '') failReason = errText(e)
      }

      const now = Date.now()
      const ok = failed === 0
      publishHealth({
        enabledRules: rs.length,
        quoteTargets,
        scannedEvents,
        failStreak: ok ? 0 : health.failStreak + 1,
        lastFailReason: ok ? health.lastFailReason : failReason !== '' ? failReason : '轮询失败（未取到具体原因）',
        lastTickAt: now,
        lastOkAt: ok ? now : health.lastOkAt,
        skippedHidden: false,
        skippedClosed: false,
      })
    }

    tickRef = tick
    void tick()
    const timer = setInterval(() => {
      if (document.hidden) {
        // 隐藏时跳过本轮：明确记下来，免得监控页把"没跑"误读成"跑了但没命中"
        publishHealth({ skippedHidden: true })
        return
      }
      // 休市闸门（lib/poll-gate.ts）：非交易时段价格不动，"每 12s 问一遍报价"只是白烧请求。
      // 与行情页同一判据，不再各写一套"休市"解释。
      if (!isPollAllowed()) {
        publishHealth({ skippedClosed: true, lastTickAt: Date.now() })
        return
      }
      void tick()
    }, TICK_MS)
    return () => {
      tickRef = null
      clearInterval(timer)
    }
  }, [])

  return null
}
