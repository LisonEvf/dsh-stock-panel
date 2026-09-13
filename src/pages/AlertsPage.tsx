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

import { useEffect, useMemo, useRef, useState } from 'react'
import { Bell, BellRing, Plus, Trash2, X } from 'lucide-react'
import { InstrumentSearch } from '@/components/InstrumentSearch'
import { StateView, classifyStateError } from '@/components/StateView'
import { ConfirmButton } from '@/components/ConfirmButton'
import { runWatcherNow, useWatcherHealth } from '@/components/AlertWatcher'
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
  'w-full min-w-0 rounded border border-slate-200 bg-white px-1.5 py-1 dc-t-note text-slate-700 outline-none focus:border-emerald-400'

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
  const enabledCount = rules.filter((r) => r.enabled).length

  /**
   * 轮询健康度（审计补齐：Watcher 的取数失败以前是**静默**的，用户会把
   * "取数失败"读成"今天没信号"——错误结论和正常结论长得一样，比报错更有害）。
   * 健康度由 AlertWatcher 的模块级 store 提供，本页只呈现。
   */
  const watcher = useWatcherHealth()
  const watcherErr = watcher.failStreak > 0 ? classifyStateError(watcher.lastFailReason, '告警轮询失败') : null
  const watcherState =
    watcher.failStreak > 0
      ? `轮询失败 ${watcher.failStreak} 轮`
      : enabledCount === 0
        ? '无生效规则（不发取数请求）'
        : watcher.skippedHidden
          ? '标签页隐藏中：暂停轮询'
          : watcher.skippedClosed
            ? '休市中：暂停轮询（开盘自动恢复）'
            : watcher.lastOkAt > 0
              ? `轮询正常 · ${fmtTime(watcher.lastOkAt)}`
              : '等待首轮轮询'

  // 「新建一条规则」出口：滚到草稿卡并把焦点给到类型下拉
  const draftRef = useRef<HTMLDivElement>(null)
  const selectRef = useRef<HTMLSelectElement>(null)
  const focusDraft = () => {
    draftRef.current?.scrollIntoView({ block: 'nearest' })
    selectRef.current?.focus()
  }

  return (
    <div className="h-full overflow-y-auto px-2.5 pb-3">
      <div className="ds-sticky-head -mx-2.5 mb-1.5 flex items-center justify-between border-b border-slate-100 px-2.5 pb-1.5 pt-2">
        <span className="flex items-center gap-1.5 text-sm font-semibold text-slate-800">
          <Bell className="h-3.5 w-3.5 text-emerald-500" />
          监控 · {enabledCount} 条生效规则
        </span>
        <div className="flex items-center gap-1.5">
          {unread > 0 && <span className="rounded bg-red-50 px-1 dc-t-micro font-medium text-red-500">{unread} 未读</span>}
          <span
            className={`dc-t-micro ${watcher.failStreak > 0 ? 'text-red-500' : 'text-slate-300'}`}
            title="常驻 Watcher 每 12s 轮询一次价格/涨跌幅/关键词规则；这里显示最近一轮的结果"
          >
            {watcherState}
          </span>
        </div>
      </div>

      {/* 轮询失败徽标条：失败不再静默 —— 否则"命中为空"会被读成"今天没信号" */}
      {watcherErr !== null && (
        <StateView
          kind="error"
          compact
          kindLabel={watcherErr.kindLabel}
          title={`告警取数失败（连续 ${watcher.failStreak} 轮）`}
          hint={
            watcher.lastOkAt > 0
              ? `最近一次成功 ${fmtTime(watcher.lastOkAt)}；命中列表为空并不代表没有信号`
              : '尚未成功取过数；命中列表为空并不代表没有信号'
          }
          reason={watcherErr.reason}
          retryLabel="立即重试"
          onRetry={() => {
            runWatcherNow()
          }}
        />
      )}

      {/* ① 新增规则 */}
      <div ref={draftRef} className="mb-1.5 rounded-md border border-slate-100 bg-slate-50/60 px-2 py-1.5">
        <div className="mb-1 dc-t-data font-medium text-slate-400">新增规则</div>
        <div className="space-y-1">
          <select ref={selectRef} value={draftType} onChange={(e) => setDraftType(e.target.value as AlertRuleType)} className={FIELD_CLS}>
            {TYPE_OPTS.map((o) => (
              <option key={o.v} value={o.v}>{o.l}</option>
            ))}
          </select>
          {needsSymbol ? (
            <div className="flex items-center gap-1">
              <div className="min-w-0 flex-1">
                <InstrumentSearch
                  onSelect={(symbol) => setDraftSymbol(symbol)}
                  className="w-full min-w-0 [&_input]:py-0.5 [&_input]:dc-t-note"
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
              <span className="rounded bg-emerald-50 px-1 font-mono dc-t-micro text-emerald-600">{draftSymbol}</span>
              <span className="dc-t-micro text-slate-300">目标</span>
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
          {err && <div className="dc-t-data text-red-500">{err}</div>}
          <button
            onClick={add}
            className="flex w-full items-center justify-center gap-1 rounded bg-emerald-500 py-1 dc-t-note font-medium text-white hover:bg-emerald-600"
          >
            <Plus className="h-3 w-3" />添加规则
          </button>
        </div>
      </div>

      {/* ② 规则列表 */}
      {rules.length > 0 && (
        <div className="mb-1.5 rounded-md border border-slate-100 bg-slate-50/60 px-2 py-1.5">
          <div className="mb-1 dc-t-data font-medium text-slate-400">规则 · {rules.length}</div>
          <div className="space-y-1">
            {rules.map((r) => (
              <div key={r.id} className={`rounded bg-white px-1.5 py-1 ${r.enabled ? '' : 'opacity-50'}`}>
                <div className="flex items-center gap-1">
                  <span className="min-w-0 flex-1 truncate font-mono dc-t-data text-slate-600">{ruleLabel(r)}</span>
                  <span className="shrink-0 rounded bg-slate-100 px-1 dc-t-micro text-slate-400">{ruleTypeLabel(r.type)}</span>
                  <button
                    onClick={() => updateRule(r.id, { enabled: !r.enabled })}
                    className={`shrink-0 rounded px-1 dc-t-micro ${r.enabled ? 'bg-emerald-100 text-emerald-600' : 'bg-slate-100 text-slate-400'}`}
                  >
                    {r.enabled ? '开' : '关'}
                  </button>
                  {/* 审计 I8（原 `onClick={() => removeRule(r.id)}` 一次点击即删）：
                      规则是 localStorage 里的唯一真源，删了没有撤销入口 → 二次确认。
                      ariaLabel 带上规则原文：读屏用户看不到这一行的 ruleLabel，
                      否则只会听到一排"删除"。 */}
                  <ConfirmButton
                    label={<Trash2 className="h-3 w-3" />}
                    ariaLabel={`删除规则：${ruleLabel(r)}`}
                    confirmLabel="确认删除规则？"
                    title="删除规则（不可撤销）"
                    onConfirm={() => removeRule(r.id)}
                    className="shrink-0 rounded p-0.5 dc-t-data text-slate-200 hover:text-red-500"
                  />
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ③ 命中记录 */}
      <div className="rounded-md border border-slate-100 bg-slate-50/60 px-2 py-1.5">
        <div className="mb-1 flex items-center justify-between">
          <span className="flex items-center gap-1 dc-t-data font-medium text-slate-400">
            <BellRing className="h-3 w-3 text-emerald-500" />命中记录 · {hits.length}
          </span>
          <div className="flex items-center gap-1.5">
            {hits.length > 0 && (
              <button onClick={markAllRead} className="dc-t-micro text-slate-400 hover:text-emerald-500">全部已读</button>
            )}
            {/* 审计 I8（原 `onClick={clearHits}` 一次点击即清空，紧挨着「全部已读」）：
                两个按钮相邻且都是文字链，误点概率最高的就是这里 → 二次确认 + 条数。 */}
            {hits.length > 0 && (
              <ConfirmButton
                label="清空"
                confirmLabel={`确认清空 ${hits.length} 条命中？`}
                title="清空命中记录（不可撤销）"
                onConfirm={clearHits}
                className="dc-t-micro text-slate-300 hover:text-red-400"
              />
            )}
          </div>
        </div>
        {hits.length === 0 && (
          /* 空态必须回答「为什么空」而不是只说「暂无」：三种完全不同的原因
             （取数失败 / 没规则 / 有规则但确实没触发）要分得开。 */
          <StateView
            kind="empty"
            title="暂无命中"
            hint={
              watcher.failStreak > 0
                ? '上一轮取数失败：命中为空并不代表「今天没信号」（见页顶红色提示）'
                : enabledCount === 0
                  ? '还没有生效的规则 —— Watcher 不发取数请求，自然不会有命中'
                  : '规则每 12s 轮询一次价格 / 涨跌幅 / 异动关键词；休市或条件未触发时不会命中'
            }
            action={{ label: '新建一条规则', onClick: focusDraft }}
          />
        )}
        <div className="space-y-0.5">
          {hits.map((h) => (
            <div key={h.id} className={`rounded px-1.5 py-0.5 ${h.read ? 'bg-white/60' : 'bg-amber-50'}`}>
              <div className="flex items-center gap-1">
                <span className="min-w-0 flex-1 truncate dc-t-data text-slate-700">{h.message}</span>
                <span className="shrink-0 font-mono dc-t-micro text-slate-300">{fmtTime(h.ts)}</span>
              </div>
              <div className="dc-t-micro text-slate-300">规则：{h.ruleLabel}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
