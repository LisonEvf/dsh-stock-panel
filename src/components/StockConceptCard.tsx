/**
 * src/components/StockConceptCard.tsx —— 个股视角的「自挖板块」卡（A2b 主视角）。
 *
 * 为什么主视角放在个股上（而不是"当日类列表"）：本地校准（`docs/CONCEPT-CALIBRATION.md`）
 * 显示调好参数后 191 只票里仍有 132 只孤立 —— 类列表信息量薄，而"**这只票今天跟谁一起动、
 * 有多像**"对盯盘/复盘直接可用。
 *
 * 本卡的立场（与产品定位一致：盯盘执行台，不替用户下结论）：
 *   · 自挖类 = 「市场今天自己认定的班」，与**官方概念/行业**是两回事，界面上必须显式区分；
 *   · 命名**不给结论只给候选**：展示三态（已命名 / 无共同主题 / 素材不足）+ 降级成因 +
 *     可反查的证据引文；模型自报置信度只作展示，真正的门控是"可计算证据分"；
 *   · 参数与 as_of **必须显示**：同一只票在不同参数下可能属于不同的类，不标 = 不可复现；
 *   · 不可用时说实话（引擎池不足 / 无模型 / 弱链类拒绝命名），不静默留白。
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { RefreshCw, Sparkles, Link2 } from 'lucide-react'
import {
  fetchNamingAvailability,
  fetchStockConcept,
  requestNaming,
  type NamingAvailability,
  type NamingOutcome,
  type StockConcept,
} from '@/lib/naming'
import { NamingResultPanel } from './NamingResultPanel'
import { ErrorBar } from './ErrorBar'
import type { MarketTag } from '@/lib/symbol'

interface Props {
  market: MarketTag
  code: string
  /** 点击邻居票 → 切换当前标的（与左栏「个股」组同一动作）。 */
  onOpenStock?: ((market: MarketTag, code: string, name: string) => void) | undefined
}

/** 相关度色阶（0.6 是我们实际用的聚类阈值，低于它只是"有点像"）。 */
function corrColor(corr: number): string {
  if (corr >= 0.8) return 'text-red-600'
  if (corr >= 0.6) return 'text-orange-500'
  if (corr >= 0.4) return 'text-slate-500'
  return 'text-slate-400'
}

export function StockConceptCard({ market, code, onOpenStock }: Props) {
  const [concept, setConcept] = useState<StockConcept | null>(null)
  const [avail, setAvail] = useState<NamingAvailability | null>(null)
  /**
   * 命名路由探不到（一般为 404）：最常见的原因是 **host 半还是重启前的旧进程** ——
   * 命名桥接是 host 半注册的路由，浏览器刷新不会让它出现。这种情况必须说清"要重启"，
   * 而不是让用户点一下按钮再看到一个 404 报错。
   */
  const [namingRouteMissing, setNamingRouteMissing] = useState(false)
  const [outcome, setOutcome] = useState<NamingOutcome | null>(null)
  const [busy, setBusy] = useState(false)
  const [namingBusy, setNamingBusy] = useState(false)
  /**
   * 错误**分两路**（I3）：取数失败与命名失败是两件事，出路也不同 ——
   * 旧版共用一个字符串，于是命名失败只能靠"重新取数"（把整张卡重拉一遍）来"重试"，
   * 既不解决问题（命名桥接的问题不在取数），也白花一次聚类请求。
   * 现在各自独立成 ErrorBar，重试各自回到该走的那条路（load / doNaming）。
   */
  const [loadErr, setLoadErr] = useState<unknown>(null)
  const [namingErr, setNamingErr] = useState<unknown>(null)

  // 只在沪深两市有意义（引擎不支持 BJ）
  const supported = market === 'SH' || market === 'SZ'

  const load = useCallback(async () => {
    if (!supported) return
    setBusy(true)
    setLoadErr(null)
    setOutcome(null)
    try {
      // 能力/参数只探一次（参数由 host 半给出：界面不各自硬编码，否则两端口径会漂）
      const info = await fetchNamingAvailability().catch(() => null)
      setAvail(info)
      setNamingRouteMissing(info === null)
      setConcept(await fetchStockConcept(market as 'SH' | 'SZ', code, info?.defaults))
    } catch (e) {
      setLoadErr(e)
      setConcept(null)
    } finally {
      setBusy(false)
    }
  }, [market, code, supported])

  useEffect(() => {
    void load()
  }, [load])

  const doNaming = useCallback(
    async (refresh: boolean) => {
      if (concept?.classId == null) return
      setNamingBusy(true)
      setNamingErr(null)
      try {
        setOutcome(await requestNaming({ classId: concept.classId, asOf: concept.asOf, params: concept.params, refresh }))
      } catch (e) {
        setNamingErr(e)
      } finally {
        setNamingBusy(false)
      }
    },
    [concept],
  )

  const sameClassPeers = useMemo(() => (concept?.neighbors ?? []).filter((n) => n.sameClass), [concept])
  const otherPeers = useMemo(() => (concept?.neighbors ?? []).filter((n) => !n.sameClass), [concept])

  const named = outcome?.ok === true ? outcome.result : null
  const refused = outcome !== null && outcome.ok === false ? outcome : null

  return (
    <div className="rounded-lg border border-violet-100 bg-violet-50/30 p-2" data-testid="stock-concept-card">
      <div className="mb-1 flex items-center gap-1">
        <Link2 size={11} className="text-violet-500" />
        <span className="dc-t-note font-medium text-slate-600">自挖板块（市场今天认定的班）</span>
        <span className="ml-auto flex items-center gap-1">
          {concept?.asOf && (
            <span className="font-mono dc-t-micro text-slate-400" title="引擎快照日期：参数或日期一变，类就会变">
              as_of {concept.asOf}
            </span>
          )}
          <button
            type="button"
            onClick={() => void load()}
            disabled={busy}
            title="重新取数（参数按校准推荐值）"
            className="rounded p-0.5 text-slate-400 hover:bg-white disabled:opacity-40"
          >
            <RefreshCw size={10} className={busy ? 'animate-spin' : ''} />
          </button>
        </span>
      </div>

      {!supported && <div className="dc-t-data text-slate-400">自挖概念引擎只覆盖沪深两市（北交所不参与聚类）</div>}

      {/* 取数失败：分类 + 原因 + 重试（旧版只有一行红字，没有出路） */}
      {supported && loadErr !== null && (
        <ErrorBar
          className="mb-1"
          error={loadErr}
          onRetry={() => void load()}
          title="自挖概念取数失败"
          retryLabel="重新取数"
        />
      )}

      {/* 引擎不可用（concept.ok === false）：不是异常而是领域状态，但也必须给出路 */}
      {supported && concept !== null && !concept.ok && (
        <ErrorBar
          className="mb-1"
          error={concept.notes.join('；') || '引擎当前不可用（未给出原因）'}
          onRetry={() => void load()}
          title="引擎当前不可用"
          retryLabel="重新取数"
          kind="business"
        />
      )}

      {supported && concept?.ok === true && (
        <>
          {/* 参数与口径：不标参数 = 结论不可复现 */}
          <div className="mb-1 flex flex-wrap items-center gap-1 dc-t-micro text-slate-400">
            <span className="rounded bg-white px-1 py-px font-mono">
              window {concept.params.window} · min_corr {concept.params.minCorr} · pool {concept.params.poolN}
            </span>
            <span className="text-slate-300">|</span>
            {concept.classId === null ? (
              <span className="text-slate-500">孤立票（今天没有稳定的同伴）</span>
            ) : (
              <span className="text-slate-500">
                类 #{concept.classId} · {concept.classSize} 只 · 类内相关{' '}
                <span className={concept.intraCorr !== null ? corrColor(concept.intraCorr) : ''}>
                  {concept.intraCorr !== null ? concept.intraCorr.toFixed(3) : '—'}
                </span>
              </span>
            )}
          </div>

          {concept.notes.length > 0 && (
            <div className="mb-1 dc-t-micro leading-snug text-amber-600">{concept.notes.join('；')}</div>
          )}

          {sameClassPeers.length > 0 && (
            <div className="mb-1">
              <div className="mb-0.5 dc-t-micro text-slate-400">同类（同一共动类）</div>
              <div className="flex flex-wrap gap-1">
                {sameClassPeers.map((n) => (
                  <button
                    key={n.market + n.code}
                    type="button"
                    onClick={() => onOpenStock?.(n.market as MarketTag, n.code, n.name)}
                    title={`${n.code} ${n.name}｜相关 ${n.corr.toFixed(3)}｜同类`}
                    className="rounded border border-violet-200 bg-white px-1 py-px dc-t-data text-slate-600 hover:border-violet-400"
                  >
                    {n.name}
                    <span className={`ml-1 font-mono ${corrColor(n.corr)}`}>{n.corr.toFixed(2)}</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {otherPeers.length > 0 && (
            <div className="mb-1">
              <div className="mb-0.5 dc-t-micro text-slate-400">最近共动邻居（不同类，仅供参考）</div>
              <div className="flex flex-wrap gap-1">
                {otherPeers.map((n) => (
                  <button
                    key={n.market + n.code}
                    type="button"
                    onClick={() => onOpenStock?.(n.market as MarketTag, n.code, n.name)}
                    title={`${n.code} ${n.name}｜相关 ${n.corr.toFixed(3)}｜不同类`}
                    className="rounded border border-slate-200 bg-white/70 px-1 py-px dc-t-data text-slate-500 hover:border-slate-400"
                  >
                    {n.name}
                    <span className={`ml-1 font-mono ${corrColor(n.corr)}`}>{n.corr.toFixed(2)}</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* 命名：可选增强 */}
          <div className="mt-1 flex items-center gap-1 border-t border-violet-100 pt-1">
            <button
              type="button"
              disabled={concept.classId === null || namingBusy || namingRouteMissing || avail?.available === false}
              onClick={() => void doNaming(false)}
              title={
                concept.classId === null
                  ? '孤立票没有"班"可命名'
                  : namingRouteMissing
                    ? '命名桥接是 host 半注册的路由：请重启 dsh web（浏览器刷新不够）'
                    : avail?.available === false
                      ? `模型不可用：${avail.reason ?? '未知'}`
                      : '让模型根据成员票的当日素材归纳共同主题（护栏会核对每条引文）'
              }
              className="dc-btn dc-btn--accent dc-btn--icon flex items-center gap-1 px-1.5 py-0.5 dc-t-data disabled:opacity-40"
            >
              <Sparkles size={10} />
              {namingBusy ? '命名中…' : '让模型命名这个班'}
            </button>
            {named !== null && (
              <button
                type="button"
                disabled={namingBusy}
                onClick={() => void doNaming(true)}
                title="忽略缓存重新命名（会真的再调一次模型）"
                className="rounded px-1 py-0.5 dc-t-micro text-slate-400 hover:bg-white disabled:opacity-40"
              >
                重算
              </button>
            )}
            {namingRouteMissing && (
              <span className="dc-t-micro text-amber-600">命名桥接未注册：请重启 dsh web（host 半是进程内加载的）</span>
            )}
            {!namingRouteMissing && avail !== null && !avail.available && (
              <span className="dc-t-micro text-amber-600">模型不可用：{avail.reason}</span>
            )}
            {avail?.available === true && named === null && (
              <span className="dc-t-micro text-slate-400">
                {avail.provider}/{avail.model}
              </span>
            )}
            {outcome?.ok === true && outcome.cached && <span className="dc-t-micro text-slate-400">（缓存命中）</span>}
          </div>

          {/* 命名失败：**就地重试命名**（旧版只有右上角的"重新取数"，那条路要重跑整块聚类，
              既不对症也白花请求）。这里 onRetry 直接回到 doNaming。 */}
          {namingErr !== null && (
            <ErrorBar
              className="mb-1"
              error={namingErr}
              onRetry={() => void doNaming(false)}
              retryLabel="重新命名"
              title="命名失败"
              extra="命名失败不影响上面的共动类与邻居（那些是引擎算出来的，不依赖模型）。"
            />
          )}

          {refused !== null && <NamingResultPanel outcome={refused} />}

          {outcome !== null && outcome.ok === true && (
            <NamingResultPanel
              outcome={outcome}
              refreshing={namingBusy}
              onRefresh={() => void doNaming(true)}
            />
          )}
        </>
      )}
    </div>
  )
}
