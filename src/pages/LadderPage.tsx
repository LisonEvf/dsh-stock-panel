/**
 * src/pages/LadderPage.tsx —— 涨停梯队 + 板块热度（行情聚合页的「梯队」块）。
 *
 * 数据（全客户端，直连内置 TDX，`lib/ladder.ts`）：全 A 快照 → 封涨停池 → 逐票日K数连板 +
 * 所属板块（板块行自带当日涨停数）→ 按板数分组 + 板块热度 TOP。
 * 涨停/跌停一律以交易所涨跌停价字段为准；连板用客户端规则（主板 10 / 创业科创 20 /
 * 北交 30 / ST 5）。
 *
 * ## 为什么分组列表改成了「一梯队一行 chips」（2026-09-14 真机测量）
 *
 * 收口前是**逐行列表**：69 只涨停股排成 2174px，而这一块的可视高度只有 363px ——
 * 实测**藏了 83%**，"一屏看完"在这块完全不成立（每个梯队下面还各自带一个滚动条区域）。
 * 换成"每个梯队一行、行内 chips 自动换行"之后，同样的信息量约 11 行就能装下。
 *
 * 默认只展开**最高两档**（高位股才是决策相关的：3 板以上决定情绪高度），
 * 其余折叠成一行 `+N 只 · 展开`。这是**有标注的取舍**，不是静默截断：
 * 全量永远只差一次点击，且展开后仍然完整（`记录而不丢弃`）。
 *
 * 环境数字（涨停/跌停/最高连板/≥2板）**不在本块显示** —— 它们已经由页面的
 * 「环境带」（`MarketKpiBar`）统一显示，本块通过 `onStats` 上报即可：
 * 同一个数在一屏里出现两遍正是这次重排要消灭的事（实测原来整页「涨停」出现 19 次）。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { RefreshCw, Flame, ChevronDown, ChevronRight } from 'lucide-react'
import { loadLadder, type LadderSnapshot, type LadderStock } from '@/lib/ladder'
import { fmtBigNum } from '@/lib/format'
import { inferMarket, type MarketTag } from '@/lib/symbol'
import type { OpenStock } from '@/panel/PanelApp'
import type { LadderStats } from '@/components/MarketKpiBar'

const UP = 'var(--dc-up)'
const DOWN = 'var(--dc-down)'
const REFRESH_MS = 30_000

/** 默认展开几档梯队（高位优先）。 */
const TIERS_OPEN = 2
/** 板块热度默认铺几条（实测 12 条会把这一块撑出 ~23% 的溢出，8 条刚好）。 */
const HEAT_ROWS = 8

function pctColor(v: number): string {
  return v > 0 ? UP : v < 0 ? DOWN : 'var(--dc-text-3)'
}

function tierTone(n: number): string {
  return n >= 5 ? 'is-high' : n >= 3 ? 'is-mid' : ''
}

interface Props {
  onOpenStock: (s: OpenStock) => void
  /** 是否轮询（合并页按"滚动到可视区才轮询"传 false/true）。默认 true = 独立页行为。 */
  enabled?: boolean
  /** 统一节拍递增值（合并页传递；变化一次 → 触发一次 `load(false)`，仍受 30s 缓存约束）。 */
  tick?: number
  /** 自轮询间隔覆盖（0 = 交给外部节拍器）。 */
  pollMs?: number
  /** 数据时间戳回传（聚合页显示本块刷新时间）。 */
  onUpdatedAt?: (at: number) => void
  /** 环境数字回传（页面「环境带」用它；本块自己不再重复显示）。 */
  onStats?: (s: LadderStats) => void
}

export function LadderPage({ onOpenStock, enabled = true, tick = 0, pollMs = REFRESH_MS, onUpdatedAt, onStats }: Props) {
  const [snap, setSnap] = useState<LadderSnapshot | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [allOpen, setAllOpen] = useState(false)
  const busyRef = useRef(false)
  const abortRef = useRef<AbortController | null>(null)

  const load = useCallback(async (force = false) => {
    if (busyRef.current) return
    busyRef.current = true
    if (abortRef.current) abortRef.current.abort()
    const ac = new AbortController()
    abortRef.current = ac
    try {
      // 默认走 30s 共享缓存（与作战页同轮只算一次）；手动刷新传 force。
      const s = await loadLadder(ac.signal, { force })
      if (!ac.signal.aborted) {
        setSnap(s)
        setError('')
      }
    } catch (e) {
      if (!ac.signal.aborted) setError((e as Error).message || '加载失败')
    } finally {
      busyRef.current = false
      setLoading(false)
    }
  }, [])

  // 首次进入（或从合并页滚动到可视区）才取数；enabled=false 时不起定时器（也不取数）
  useEffect(() => {
    if (!enabled) return
    void load()
    if (pollMs <= 0) return
    const timer = window.setInterval(() => {
      if (document.hidden) return
      void load()
    }, pollMs)
    return () => window.clearInterval(timer)
  }, [load, enabled, pollMs])

  // 统一节拍：tick 变化 → 走一次 load(false)（命中 30s 共享缓存时不产生真实开销）
  useEffect(() => {
    if (tick === 0 || !enabled) return
    void load()
  }, [tick, enabled, load])

  // 卸载时中止在途请求（整页切走时会）
  useEffect(() => () => {
    abortRef.current?.abort()
  }, [])

  const known = useMemo(() => snap?.limitUp.filter((s) => s.streakKnown) ?? [], [snap])
  const unknown = useMemo(() => snap?.limitUp.filter((s) => !s.streakKnown) ?? [], [snap])

  const maxStreak = useMemo(() => (known.length === 0 ? 0 : Math.max(...known.map((s) => s.streak))), [known])

  const tiers = useMemo(() => {
    const m = new Map<number, number>()
    for (const s of known) m.set(s.streak, (m.get(s.streak) ?? 0) + 1)
    return [...m.entries()].sort((a, b) => b[0] - a[0])
  }, [known])

  const maxTierCount = useMemo(() => Math.max(1, ...tiers.map(([, c]) => c)), [tiers])

  /** 按板数分组的成员（一次分好，渲染时不再重复过滤）。 */
  const byTier = useMemo(() => {
    const m = new Map<number, LadderStock[]>()
    for (const s of known) {
      const arr = m.get(s.streak)
      if (arr) arr.push(s)
      else m.set(s.streak, [s])
    }
    return m
  }, [known])

  const openStock = (market: MarketTag, code: string, name: string) => onOpenStock({ market, code, name })

  // 聚合页需要在块标题上显示本块刷新时间（梯队用自己的 fetchedAt，比"取数成功时刻"更贴切）
  useEffect(() => {
    if (snap !== null && onUpdatedAt) onUpdatedAt(snap.fetchedAt)
  }, [snap, onUpdatedAt])

  /**
   * 环境数字上报（页面「环境带」用）。
   *
   * 为什么用回调而不是让页面自己再算一遍：连板统计只在这里有（要逐票日K），
   * 页面重算等于把最贵的那段逻辑抄第二份 —— 那正是本仓库反复吃亏的地方。
   */
  useEffect(() => {
    if (onStats === undefined || snap === null) return
    onStats({
      limitUp: known.length,
      limitDown: snap.limitDownCount,
      maxStreak,
      tiers: tiers.length,
      highTier: known.filter((s) => s.streak >= 2).length,
      unconfirmed: unknown.length,
    })
  }, [snap, known, unknown, maxStreak, tiers, onStats])

  return (
    <div className="flex flex-col gap-1.5">
      {error !== '' && <div className="rounded-dc-sm dc-soft-danger px-2 py-1 dc-t-note text-dc-bad">{error}</div>}

      {/* 梯队条形：一档一行（长度 = 该档家数占比），高位档用红/琥珀分色 */}
      {tiers.length > 0 && (
        <div className="rounded-dc-sm border border-dc-border bg-dc-layer-2 px-2 py-1.5">
          <div className="mb-1 flex items-center justify-between gap-2">
            <span className="dc-t-data font-medium text-dc-text-3">
              连板梯队（{known.length} 只）
            </span>
            <span className="flex items-center gap-2">
              {unknown.length > 0 && <span className="dc-t-micro text-dc-warn">{unknown.length} 只待确认</span>}
              <button
                type="button"
                onClick={() => {
                  setLoading(true)
                  void load(true)
                }}
                className="rounded-dc-sm p-0.5 text-dc-text-3 hover:bg-dc-layer-3"
                title="只刷新涨停梯队（它最贵：每个涨停股要拉日K + 所属板块）"
              >
                <RefreshCw size={11} className={loading ? 'animate-spin' : ''} />
              </button>
            </span>
          </div>
          <div className="flex flex-col gap-1">
            {tiers.map(([n, c]) => (
              <div key={n} className="grid grid-cols-[34px_1fr_30px] items-center gap-1.5" title={`${n} 板 · ${c} 只`}>
                <span className={`dc-tier-name ${tierTone(n)}`}>{n}板</span>
                <span className="h-1.5 overflow-hidden rounded-full" style={{ background: 'var(--dc-track)' }}>
                  <span
                    className="block h-full rounded-full"
                    style={{
                      width: `${Math.max(6, (c / maxTierCount) * 100)}%`,
                      background: n >= 3 ? UP : 'var(--dc-dim)',
                      opacity: n >= 3 ? 0.75 : 0.6,
                    }}
                  />
                </span>
                <span className="text-right font-mono dc-t-note text-dc-text-3">{c}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 分组：一梯队一行 chips（默认只展开最高两档，其余点名可展开） */}
      {snap !== null && known.length > 0 && (
        <div className="dc-tier">
          {tiers.map(([n, count], idx) => {
            const opened = allOpen || idx < TIERS_OPEN
            const group = byTier.get(n) ?? []
            return (
              <div className="dc-tier-row" key={n}>
                <span className={`dc-tier-name ${tierTone(n)}`} title={`${n} 板 · ${count} 只`}>
                  {n}板
                </span>
                {opened ? (
                  <span className="dc-tier-chips">
                    {group.map((s) => (
                      <button
                        key={`${s.market}${s.code}`}
                        type="button"
                        className={`dc-tier-chip${s.oneWord ? ' is-oneword' : ''}`}
                        title={`${s.name} ${s.code}｜${s.streak} 连板${s.oneWord ? '｜一字板' : ''}｜换手 ${s.turnover ? `${s.turnover.toFixed(1)}%` : '—'}｜成交额 ${fmtBigNum(s.amount)}`}
                        onClick={() => openStock(s.market, s.code, s.name)}
                      >
                        {s.name}
                        {s.oneWord && <em>一字</em>}
                      </button>
                    ))}
                  </span>
                ) : (
                  <span className="dc-tier-chips">
                    <button
                      type="button"
                      className="dc-tier-more"
                      title={`展开 ${n} 板这 ${count} 只（默认只展开最高的 ${TIERS_OPEN} 档：高位股才是决策相关的）`}
                      onClick={() => setAllOpen(true)}
                    >
                      展开全部 {count} 只
                    </button>
                  </span>
                )}
              </div>
            )
          })}
          <div className="dc-tier-row">
            <span />
            <span className="dc-tier-chips">
              <button
                type="button"
                className="dc-tier-more"
                onClick={() => setAllOpen((v) => !v)}
                title={allOpen ? '只看最高的几档（高位股）' : '展开全部分组'}
              >
                {allOpen ? <ChevronDown size={10} /> : <ChevronRight size={10} />}
                {allOpen ? `只看高位（最高 ${TIERS_OPEN} 档）` : '展开全部梯队'}
              </button>
            </span>
          </div>
        </div>
      )}

      {/* 连板待确认（日K 拉取失败/超时的涨停股）：**不算进任何统计**，但要说出来 */}
      {unknown.length > 0 && (
        <div className="rounded-dc-sm border border-dashed border-dc-border bg-dc-layer-2 px-2 py-1.5">
          <div className="mb-1 dc-t-data font-semibold text-dc-warn">连板待确认 · {unknown.length} 只</div>
          <div className="dc-tier-chips">
            {unknown.map((s) => (
              <button
                key={`${s.market}${s.code}`}
                type="button"
                className="dc-tier-chip"
                title={`${s.name} ${s.code}｜日K 未取到，连板数未知（不计入梯队统计）`}
                onClick={() => openStock(s.market, s.code, s.name)}
              >
                {s.name}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* 板块热度：自适应多列（窄列一行放"板块名 + 涨停数 + 涨幅"）。
          默认只铺前 8 个（实测：12 个会把这一块撑出 23% 的溢出）—— 其余进「+N」的 title，
          块本身仍可整体展开，所以是"有标注的收拢"而不是截断。 */}
      {snap !== null && snap.boards.length > 0 && (
        <div className="rounded-dc-sm border border-dc-border bg-dc-layer-2 px-2 py-1.5">
          <div className="mb-1 flex items-center justify-between gap-2">
            <span className="flex items-center gap-1 dc-t-data font-medium text-dc-text-3">
              <Flame size={11} style={{ color: UP }} />
              涨停板块热度
            </span>
            <span className="dc-t-micro text-dc-dim">按板块当日涨停家数</span>
          </div>
          <div className="dc-heat">
            {snap.boards.slice(0, HEAT_ROWS).map((b) => (
              <button
                key={b.boardSymbol}
                type="button"
                className="dc-heat-row"
                title={`${b.name} · 代表 ${b.rep}（${b.repCode}）｜板块指数 ${b.pct >= 0 ? '+' : ''}${b.pct.toFixed(2)}%`}
                onClick={() => openStock(inferMarket(b.repCode), b.repCode, b.rep)}
              >
                <span>{b.name}</span>
                <span className="dc-heat-count">{b.limitUpCount}</span>
                <span className="dc-heat-pct" style={{ color: pctColor(b.pct) }}>
                  {b.pct >= 0 ? '+' : ''}
                  {b.pct.toFixed(2)}%
                </span>
              </button>
            ))}
            {snap.boards.length > HEAT_ROWS && (
              <span
                className="dc-heat-row text-dc-text-3"
                title={`其余 ${snap.boards.length - HEAT_ROWS} 个板块（按涨停家数）：${snap.boards
                  .slice(HEAT_ROWS)
                  .map((b) => `${b.name} ${b.limitUpCount}`)
                  .join(' · ')}`}
              >
                <span className="dc-t-micro">其余 {snap.boards.length - HEAT_ROWS} 个板块（悬停看名单）</span>
              </span>
            )}
          </div>
        </div>
      )}

      {snap !== null && known.length === 0 && unknown.length === 0 && (
        <div className="rounded-dc-sm border border-dashed border-dc-border py-6 text-center dc-t-data text-dc-dim">
          今日暂无封涨停（或盘中尚未封板）
        </div>
      )}

      {loading && snap === null && <div className="py-8 text-center dc-t-data text-dc-dim">加载涨停池…</div>}
    </div>
  )
}
