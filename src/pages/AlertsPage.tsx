/**
 * 本地监控页（M7：AlertsPage，Tab「监控」）。
 *
 * 依据 MIGRATION-PLAN §5 M7 裁剪版：
 *   - 规则管理：价格突破/跌破、涨跌幅 ≥/≤、异动关键词；开/关、删除；
 *   - 命中记录：按时间倒序，未读高亮；全部已读 / 清空；localStorage 持久化；
 *   - 命中判定由常驻 AlertWatcher（PanelApp 根）驱动，本页只展示与编辑。
 *
 * 命中提示：Tab 徽标（未读数）+ 面板内 Toast（见 PanelApp）。
 */

import { useEffect, useMemo, useState } from 'react'
import { Bell, BellRing, Plus, Trash2, X } from 'lucide-react'
import { InstrumentSearch } from '@/components/InstrumentSearch'
import { parseSymbol } from '@/lib/symbol'
import {
  addRule,
  clearHits,
  getHits,
  getRules,
  markAllRead,
  removeRule,
  ruleLabel,
  ruleTypeLabel,
  subscribeAlerts,
  updateRule,
  type AlertHit,
  type AlertRule,
  type AlertRuleType,
} from '@/lib/alerts'

const TYPE_OPTS: { v: AlertRuleType; l: string }[] = [
  { v: 'price_above', l: '价格突破 ≥' },
  { v: 'price_below', l: '价格跌破 ≤' },
  { v: 'pct_above', l: '涨幅 ≥ x%' },
  { v: 'pct_below', l: '跌幅 ≤ x%（破位）' },
  { v: 'event_keyword', l: '异动关键词命中' },
]

const FIELD_CLS =
  'w-full min-w-0 rounded border border-slate-200 bg-white px-1.5 py-1 text-[11px] text-slate-700 outline-none focus:border-emerald-400'

function fmtTime(ts: number): string {
  const d = new Date(ts)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
}

export function AlertsPage() {
  const [rules, setRules] = useState<AlertRule[]>(() => getRules())
  const [hits, setHits] = useState<AlertHit[]>(() => getHits())

  // 新增草稿
  const [draftType, setDraftType] = useState<AlertRuleType>('price_above')
  const [draftSymbol, setDraftSymbol] = useState('')
  const [draftValue, setDraftValue] = useState('')
  const [draftKeyword, setDraftKeyword] = useState('')
  const [err, setErr] = useState('')

  useEffect(() => {
    markAllRead() // 进入页面即清未读（徽标清零）
    const off = subscribeAlerts(() => {
      setRules(getRules())
      setHits(getHits())
    })
    return off
  }, [])

  const needsSymbol = useMemo(
    () => draftType !== 'event_keyword',
    [draftType],
  )

  const add = () => {
    setErr('')
    if (needsSymbol) {
      const p = draftSymbol ? parseSymbol(draftSymbol) : null
      if (!p) {
        setErr('请先选择标的（代码搜索框选一个）')
        return
      }
      const value = Number(draftValue)
      if (!Number.isFinite(value)) {
        setErr('阈值需为数字')
        return
      }
      addRule({ type: draftType, market: p.market, code: p.code, value })
    } else {
      const kw = draftKeyword.trim()
      if (!kw) {
        setErr('请输入关键词')
        return
      }
      addRule({ type: 'event_keyword', keyword: kw })
    }
    setDraftSymbol('')
    setDraftValue('')
    setDraftKeyword('')
  }

  const unread = hits.filter((h) => !h.read).length

  return (
    <div className="h-full overflow-y-auto px-2.5 pb-3">
      <div className="ds-sticky-head -mx-2.5 mb-1.5 flex items-center justify-between border-b border-slate-100 px-2.5 pb-1.5 pt-2">
        <span className="flex items-center gap-1.5 text-[13px] font-semibold text-slate-800">
          <Bell className="h-3.5 w-3.5 text-emerald-500" />
          监控 · {rules.filter((r) => r.enabled).length} 条生效规则
        </span>
        <div className="flex items-center gap-1.5">
          {unread > 0 && <span className="rounded bg-red-50 px-1 text-[9px] font-medium text-red-500">{unread} 未读</span>}
        </div>
      </div>

      {/* ① 新增规则 */}
      <div className="mb-1.5 rounded-md border border-slate-100 bg-slate-50/60 px-2 py-1.5">
        <div className="mb-1 text-[10px] font-medium text-slate-400">新增规则</div>
        <div className="space-y-1">
          <select value={draftType} onChange={(e) => setDraftType(e.target.value as AlertRuleType)} className={FIELD_CLS}>
            {TYPE_OPTS.map((o) => (
              <option key={o.v} value={o.v}>{o.l}</option>
            ))}
          </select>
          {needsSymbol ? (
            <div className="flex items-center gap-1">
              <div className="min-w-0 flex-1">
                <InstrumentSearch
                  onSelect={(symbol) => setDraftSymbol(symbol)}
                  className="w-full min-w-0 [&_input]:py-0.5 [&_input]:text-[11px]"
                />
              </div>
              {draftSymbol && (
                <button onClick={() => setDraftSymbol('')} className="shrink-0 rounded p-0.5 text-slate-300 hover:text-red-400" title="清除">
                  <X className="h-3 w-3" />
                </button>
              )}
            </div>
          ) : null}
          {needsSymbol && draftSymbol && (
            <div className="flex items-center gap-1">
              <span className="rounded bg-emerald-50 px-1 font-mono text-[9px] text-emerald-600">{draftSymbol}</span>
              <span className="text-[8px] text-slate-300">目标</span>
              <input
                value={draftValue}
                onChange={(e) => setDraftValue(e.target.value)}
                placeholder={draftType.startsWith('price') ? '价格，如 12.5' : '涨跌幅%，如 -5 / 3'}
                inputMode="decimal"
                className={FIELD_CLS}
              />
            </div>
          )}
          {!needsSymbol && (
            <input
              value={draftKeyword}
              onChange={(e) => setDraftKeyword(e.target.value)}
              placeholder="关键词，如：炸板 / 拉升 / 大单"
              className={FIELD_CLS}
            />
          )}
          {err && <div className="text-[10px] text-red-500">{err}</div>}
          <button
            onClick={add}
            className="flex w-full items-center justify-center gap-1 rounded bg-emerald-500 py-1 text-[11px] font-medium text-white hover:bg-emerald-600"
          >
            <Plus className="h-3 w-3" />添加规则
          </button>
        </div>
      </div>

      {/* ② 规则列表 */}
      {rules.length > 0 && (
        <div className="mb-1.5 rounded-md border border-slate-100 bg-slate-50/60 px-2 py-1.5">
          <div className="mb-1 text-[10px] font-medium text-slate-400">规则 · {rules.length}</div>
          <div className="space-y-1">
            {rules.map((r) => (
              <div key={r.id} className={`rounded bg-white px-1.5 py-1 ${r.enabled ? '' : 'opacity-50'}`}>
                <div className="flex items-center gap-1">
                  <span className="min-w-0 flex-1 truncate font-mono text-[10px] text-slate-600">{ruleLabel(r)}</span>
                  <span className="shrink-0 rounded bg-slate-100 px-1 text-[8px] text-slate-400">{ruleTypeLabel(r.type)}</span>
                  <button
                    onClick={() => updateRule(r.id, { enabled: !r.enabled })}
                    className={`shrink-0 rounded px-1 text-[9px] ${r.enabled ? 'bg-emerald-100 text-emerald-600' : 'bg-slate-100 text-slate-400'}`}
                  >
                    {r.enabled ? '开' : '关'}
                  </button>
                  <button onClick={() => removeRule(r.id)} className="shrink-0 rounded p-0.5 text-slate-200 hover:text-red-500">
                    <Trash2 className="h-3 w-3" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ③ 命中记录 */}
      <div className="rounded-md border border-slate-100 bg-slate-50/60 px-2 py-1.5">
        <div className="mb-1 flex items-center justify-between">
          <span className="flex items-center gap-1 text-[10px] font-medium text-slate-400">
            <BellRing className="h-3 w-3 text-emerald-500" />命中记录 · {hits.length}
          </span>
          <div className="flex items-center gap-1.5">
            {hits.length > 0 && (
              <button onClick={markAllRead} className="text-[9px] text-slate-400 hover:text-emerald-500">全部已读</button>
            )}
            {hits.length > 0 && (
              <button onClick={clearHits} className="text-[9px] text-slate-300 hover:text-red-400">清空</button>
            )}
          </div>
        </div>
        {hits.length === 0 && (
          <div className="py-2 text-center text-[10px] text-slate-300">暂无命中（Watcher 12s 轮询；休市/无数据不提醒）</div>
        )}
        <div className="space-y-0.5">
          {hits.map((h) => (
            <div key={h.id} className={`rounded px-1.5 py-0.5 ${h.read ? 'bg-white/60' : 'bg-amber-50'}`}>
              <div className="flex items-center gap-1">
                <span className="min-w-0 flex-1 truncate text-[10px] text-slate-700">{h.message}</span>
                <span className="shrink-0 font-mono text-[8px] text-slate-300">{fmtTime(h.ts)}</span>
              </div>
              <div className="text-[8px] text-slate-300">规则：{h.ruleLabel}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
