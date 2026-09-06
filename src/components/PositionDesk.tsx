/**
 * 持仓决策台（N6：PositionDesk）。
 *
 * 依据 WATCH-METHODOLOGY §7「凯利为纲」与 PRODUCT-DESIGN §5.4「持仓决策条」：
 *   - 持仓增删 + 平仓自动记交易日志（持有期口径，positions.ts）；
 *   - 顶部自统计 p̂/b̂ 与「凯利建议单票仓位」（≤护栏封顶；样本<50 显示无证据→空仓）；
 *   - 失败条件回显（复盘清单写好后盘中只触发不辩论）。
 */

import { useEffect, useReducer, useState } from 'react'
import { Plus, Trash2, X } from 'lucide-react'
import {
  addPosition,
  closePosition,
  computeStats,
  getPositions,
  removePosition,
  statsLabel,
  subscribePositions,
  type Position,
  type SignalKind,
} from '@/lib/positions'
import { kellyPosition, gateFromBand } from '@/lib/sizing'
import type { RegimeBand } from '@/lib/regime'
import { getWatchlist, subscribeWatchlist, type WatchItem } from '@/lib/watchlist-store'
import { today } from '@/lib/review-store'

interface Props {
  /** 温度计档位（来自 WarPage regime）；null 时不展示凯利建议。 */
  band: RegimeBand | null
}

const UP = '#c74040'
const DOWN = '#2d9b65'
const SIGNS: { v: SignalKind; l: string }[] = [
  { v: 'trueStrong', l: '真强打板' },
  { v: 'weak2strong', l: '弱转强低吸' },
  { v: 'lowBoard', l: '低位首板' },
  { v: 'leader', l: '龙头' },
  { v: 'catchup', l: '补涨' },
  { v: 'other', l: '其他' },
]

export function PositionDesk({ band }: Props) {
  const [, force] = useReducer((x: number) => x + 1, 0)
  useEffect(() => subscribePositions(force), [])
  const [watchlist, setWatchlist] = useState<WatchItem[]>(() => getWatchlist())
  useEffect(() => subscribeWatchlist(() => setWatchlist(getWatchlist())), [])

  // 加仓表单
  const [adding, setAdding] = useState(false)
  const [pickSym, setPickSym] = useState('')
  const [entryPrice, setEntryPrice] = useState('')
  const [shares, setShares] = useState('')
  const [stopLoss, setStopLoss] = useState('')
  const [failIf, setFailIf] = useState('')
  const [msg, setMsg] = useState('')

  // 平仓表单
  const [closingSym, setClosingSym] = useState<string | null>(null)
  const [exitPrice, setExitPrice] = useState('')
  const [signal, setSignal] = useState<SignalKind>('weak2strong')

  const positions = getPositions()
  const stats = computeStats()

  const pick = watchlist.find((w) => `${w.market}${w.code}` === pickSym)
  const pickSymbol = pick ? `${pick.market}${pick.code}` : ''

  const flash = (t: string) => {
    setMsg(t)
    window.setTimeout(() => setMsg(''), 2200)
  }

  const submitAdd = () => {
    if (!pick) return flash('请选择标的（自选）')
    const price = Number(entryPrice)
    const sh = Math.floor(Number(shares))
    if (!price || price <= 0 || !sh || sh <= 0) return flash('成本价 / 股数需为正数')
    const stop = stopLoss ? Number(stopLoss) : 0
    const ok = addPosition({
      symbol: pickSymbol,
      market: pick.market,
      code: pick.code,
      name: pick.name,
      entryDate: today(),
      entryPrice: price,
      shares: sh,
      plan: { stopLoss: stop > 0 ? stop : price, failIf: failIf.trim(), note: '' },
    })
    if (!ok) return flash('该标的已在持仓中')
    setAdding(false)
    setEntryPrice('')
    setShares('')
    setStopLoss('')
    setFailIf('')
    flash(`已加仓 ${pick.name}`)
  }

  const submitClose = (p: Position) => {
    const price = Number(exitPrice)
    if (!price || price <= 0) return flash('请输入退出价')
    const t = closePosition(p.symbol, price, today(), signal)
    if (t) flash(`平仓 ${p.name}：${t.profit ? '+' : ''}${t.pnlPct.toFixed(2)}%（已记日志）`)
    setClosingSym(null)
    setExitPrice('')
  }

  // 凯利建议：自统计 p̂/b̂（无证据按 0 → 空仓）；温度计闸门 + 护栏封顶
  const gate = band ? gateFromBand(band) : 0
  const suggested =
    band && stats.hasEvidence
      ? kellyPosition({
          p: stats.p,
          b: stats.b > 0 ? stats.b : 1,
          fraction: 0.5,
          gateCap: gate,
          stopLossPct: 7,
        })
      : 0

  return (
    <div className="rounded-md border border-slate-100 bg-emerald-50/40 px-2 py-1.5">
      <div className="mb-1 flex items-center justify-between">
        <span className="text-[10px] font-medium text-slate-400">持仓决策台 · {positions.length} 只</span>
        <button
          onClick={() => setAdding((v) => !v)}
          className="flex items-center gap-0.5 rounded px-1 py-0.5 text-[10px] text-emerald-600 hover:bg-emerald-100/60"
        >
          <Plus className="h-3 w-3" />
          {adding ? '收起' : '加仓'}
        </button>
      </div>

      {msg && <div className="mb-1 rounded bg-amber-50 px-1.5 py-0.5 text-[9px] text-amber-600">{msg}</div>}

      {/* 自统计 + 凯利建议 */}
      <div className="mb-1.5 rounded bg-white px-1.5 py-1 text-[9px] leading-relaxed text-slate-500">
        <div>交易日志自统计：{statsLabel(stats)}</div>
        {band && (
          <div>
            凯利建议单票 ≤ <span className="font-mono font-semibold text-slate-700">{suggested.toFixed(1)}%</span>
            {!stats.hasEvidence && <span className="text-slate-400">（无证据 → 空仓）</span>}
          </div>
        )}
      </div>

      {/* 加仓表单 */}
      {adding && (
        <div className="mb-1.5 space-y-1 rounded bg-white px-1.5 py-1.5">
          {watchlist.length === 0 ? (
            <div className="text-[9px] text-slate-300">自选为空——先去「自选」加标的，再从下拉选择</div>
          ) : (
            <select
              value={pickSym}
              onChange={(e) => setPickSym(e.target.value)}
              className="w-full rounded border border-slate-200 bg-white px-1 py-0.5 text-[10px] text-slate-700 outline-none focus:border-emerald-400"
            >
              <option value="">选择自选标的…</option>
              {watchlist.map((w) => (
                <option key={`${w.market}${w.code}`} value={`${w.market}${w.code}`}>
                  {w.name} {w.code}
                </option>
              ))}
            </select>
          )}
          <div className="grid grid-cols-3 gap-1">
            <input value={entryPrice} onChange={(e) => setEntryPrice(e.target.value)} placeholder="成本价" inputMode="decimal"
              className="w-full min-w-0 rounded border border-slate-200 bg-white px-1 py-0.5 text-[10px] outline-none placeholder:text-slate-300 focus:border-emerald-400" />
            <input value={shares} onChange={(e) => setShares(e.target.value)} placeholder="股数" inputMode="numeric"
              className="w-full min-w-0 rounded border border-slate-200 bg-white px-1 py-0.5 text-[10px] outline-none placeholder:text-slate-300 focus:border-emerald-400" />
            <input value={stopLoss} onChange={(e) => setStopLoss(e.target.value)} placeholder="止损价(可选)" inputMode="decimal"
              className="w-full min-w-0 rounded border border-slate-200 bg-white px-1 py-0.5 text-[10px] outline-none placeholder:text-slate-300 focus:border-emerald-400" />
          </div>
          <input value={failIf} onChange={(e) => setFailIf(e.target.value)} placeholder="失败条件（断板/破位/退潮，复盘口径）"
            className="w-full rounded border border-slate-200 bg-white px-1 py-0.5 text-[10px] outline-none placeholder:text-slate-300 focus:border-emerald-400" />
          <button onClick={submitAdd}
            className="w-full rounded bg-emerald-500 py-1 text-[10px] font-medium text-white hover:bg-emerald-600">
            加入持仓（T+1：开仓即持有到次日）
          </button>
        </div>
      )}

      {/* 持仓列表 */}
      {positions.length > 0 ? (
        <ul className="space-y-1">
          {positions.map((p) => (
            <li key={p.symbol} className="rounded bg-white px-1.5 py-1">
              {closingSym !== p.symbol ? (
                <div className="flex items-center justify-between gap-1">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline gap-1">
                      <span className="truncate text-[11px] font-semibold text-slate-700">{p.name}</span>
                      <span className="shrink-0 font-mono text-[8px] text-slate-300">{p.code}</span>
                    </div>
                    <div className="mt-0.5 truncate text-[9px] text-slate-500">
                      成本 {p.entryPrice.toFixed(2)} · {p.shares}股 · 止损 {p.plan.stopLoss.toFixed(2)}
                      {p.plan.failIf && <span className="text-amber-600"> · 失败：{p.plan.failIf}</span>}
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    <button onClick={() => { setClosingSym(p.symbol); setExitPrice(String(p.entryPrice)) }}
                      className="rounded bg-red-50 px-1.5 py-0.5 text-[9px] font-medium text-red-600 hover:bg-red-100">
                      平仓
                    </button>
                    <button onClick={() => removePosition(p.symbol)} title="删除（不记日志）"
                      className="rounded p-0.5 text-slate-300 hover:text-slate-500">
                      <Trash2 className="h-3 w-3" />
                    </button>
                  </div>
                </div>
              ) : (
                <div className="space-y-1">
                  <div className="text-[9px] text-slate-400">平仓 {p.name}（将记入交易日志）</div>
                  <div className="grid grid-cols-[1fr_auto] gap-1">
                    <input value={exitPrice} onChange={(e) => setExitPrice(e.target.value)} placeholder="退出价" inputMode="decimal"
                      className="w-full min-w-0 rounded border border-slate-200 bg-white px-1 py-0.5 text-[10px] outline-none focus:border-emerald-400" />
                    <select value={signal} onChange={(e) => setSignal(e.target.value as SignalKind)}
                      className="rounded border border-slate-200 bg-white px-1 py-0.5 text-[10px] text-slate-700 outline-none focus:border-emerald-400">
                      {SIGNS.map((s) => <option key={s.v} value={s.v}>{s.l}</option>)}
                    </select>
                  </div>
                  <div className="flex items-center gap-1">
                    <button onClick={() => submitClose(p)}
                      className="flex-1 rounded bg-red-500 py-0.5 text-[10px] font-medium text-white hover:bg-red-600">
                      确认平仓
                    </button>
                    <button onClick={() => setClosingSym(null)} className="rounded p-0.5 text-slate-400 hover:bg-slate-100" title="取消">
                      <X className="h-3 w-3" />
                    </button>
                  </div>
                </div>
              )}
            </li>
          ))}
        </ul>
      ) : (
        <div className="rounded bg-white px-1.5 py-2 text-center text-[9px] text-slate-300">
          暂无持仓 —— 空仓也是仓位决策
        </div>
      )}
    </div>
  )
}
