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
 */

import { useEffect, useRef } from 'react'
import { getEvents } from '@/lib/event-stream'
import { fetchQuote } from '@/lib/stock-data'
import { runPool } from '@/lib/pool'
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
        const snaps = await runPool(targets, async (t) => {
          try {
            return await fetchQuote(t.market, t.code)
          } catch {
            return null
          }
        }, { concurrency: 4 })
        targets.forEach((t, i) => {
          const q = snaps[i]
          if (!q || !Number.isFinite(Number(q.close))) return
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
    }

    void tick()
    const timer = setInterval(() => {
      if (document.hidden) return
      void tick()
    }, TICK_MS)
    return () => clearInterval(timer)
  }, [])

  return null
}
