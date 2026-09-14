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
 *   · **结构标签**（官方行业/概念口径，确定性、不经模型）与**模型主题名**分开显示、各自标来源
 *     （见 `host/naming/structure.ts` 头部：前者答"像什么"，后者答"为什么一起动"）；
 *   · 参数与 as_of **必须显示**：同一只票在不同参数下可能属于不同的类，不标 = 不可复现；
 *   · 不可用时说实话（引擎池不足 / 无模型 / 伪类拒绝命名），不静默留白。
 *
 * 颜色一律走 `--dc-*` token：收口前这里用的是 tailwind 的 violet/slate 固定色阶，
 * 与整页的语义 token 不是一套（暗色下既不协调、也不受对比度护栏覆盖）。
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

/**
 * 相关度的**强弱阶**（0.6 是我们实际用的聚类阈值，低于它只是"有点像"）。
 *
 * 为什么不用红/橙/灰：相关度没有方向（不是涨跌），借涨跌色会让人读成"这只票在涨"
 * —— 本仓库对"状态/结构类信息借用涨跌色"有明确禁令（诊断面板曾把 success 画成红）。
 * 这里用**由深到浅的文字色阶梯**表达强弱，语义中性且明暗自适应。
 */
function corrTone(corr: number): string {
  if (corr >= 0.8) return 'text-dc-text'
  if (corr >= 0.6) return 'text-dc-text-2'
  if (corr >= 0.4) return 'text-dc-text-3'
  return 'text-dc-dim'
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
  const structure = outcome !== null && outcome.ok ? outcome.structure : null

  return (
    <div className="rounded-dc-lg border border-dc-border bg-dc-layer-2 p-2" data-testid="stock-concept-card">
      <div className="mb-1 flex items-center gap-1">
        <Link2 size={11} className="text-dc-info" />
        <span className="dc-t-note font-medium text-dc-text-2">自挖板块（市场今天认定的班）</span>
        <span className="ml-auto flex items-center gap-1">
          {concept?.asOf && (
            <span className="font-mono dc-t-micro text-dc-text-3" title="引擎快照日期：参数或日期一变，类就会变">
              as_of {concept.asOf}
            </span>
          )}
          <button
            type="button"
            onClick={() => void load()}
            disabled={busy}
            title="重新取数（参数按校准推荐值）"
            className="rounded-dc-sm p-0.5 text-dc-text-3 hover:bg-dc-layer-3 disabled:opacity-40"
          >
            <RefreshCw size={11} className={busy ? 'animate-spin' : ''} />
          </button>
        </span>
      </div>

      {!supported && <div className="dc-t-data text-dc-text-3">自挖概念引擎只覆盖沪深两市（北交所不参与聚类）</div>}

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
          <div className="mb-1 flex flex-wrap items-center gap-1 dc-t-micro text-dc-text-3">
            <span className="rounded-dc-sm dc-soft-neutral px-1 py-px font-mono">
              window {concept.params.window} · min_corr {concept.params.minCorr} · pool {concept.params.poolN}
            </span>
            <span className="text-dc-dim">|</span>
            {concept.classId === null ? (
              <span className="text-dc-text-2">孤立票（今天没有稳定的同伴）</span>
            ) : (
              <span className="text-dc-text-2">
                类 #{concept.classId} · {concept.classSize} 只 · 类内相关{' '}
                <span className={concept.intraCorr !== null ? corrTone(concept.intraCorr) : ''}>
                  {concept.intraCorr !== null ? concept.intraCorr.toFixed(3) : '—'}
                </span>
              </span>
            )}
          </div>

          {concept.notes.length > 0 && (
            <div className="mb-1 dc-t-micro leading-snug text-dc-warn">{concept.notes.join('；')}</div>
          )}

          {sameClassPeers.length > 0 && (
            <div className="mb-1">
              <div className="mb-0.5 dc-t-micro text-dc-text-3">同类（同一共动类）</div>
              <div className="flex flex-wrap gap-1">
                {sameClassPeers.map((n) => (
                  <button
                    key={n.market + n.code}
                    type="button"
                    onClick={() => onOpenStock?.(n.market as MarketTag, n.code, n.name)}
                    title={`${n.code} ${n.name}｜相关 ${n.corr.toFixed(3)}｜同类`}
                    className="rounded-dc-sm border border-dc-border bg-dc-layer-1 px-1 py-px dc-t-data text-dc-text-2 hover:bg-dc-layer-3"
                  >
                    {n.name}
                    <span className={`ml-1 font-mono ${corrTone(n.corr)}`}>{n.corr.toFixed(2)}</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {otherPeers.length > 0 && (
            <div className="mb-1">
              <div className="mb-0.5 dc-t-micro text-dc-text-3">最近共动邻居（不同类，仅供参考）</div>
              <div className="flex flex-wrap gap-1">
                {otherPeers.map((n) => (
                  <button
                    key={n.market + n.code}
                    type="button"
                    onClick={() => onOpenStock?.(n.market as MarketTag, n.code, n.name)}
                    title={`${n.code} ${n.name}｜相关 ${n.corr.toFixed(3)}｜不同类`}
                    className="rounded-dc-sm border border-dc-border bg-dc-layer-1 px-1 py-px dc-t-data text-dc-text-3 hover:bg-dc-layer-3"
                  >
                    {n.name}
                    <span className={`ml-1 font-mono ${corrTone(n.corr)}`}>{n.corr.toFixed(2)}</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* 命名：可选增强 */}
          <div className="mt-1 flex flex-wrap items-center gap-1 border-t border-dc-border pt-1">
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
              <Sparkles size={11} />
              {namingBusy ? '命名中…' : '让模型命名这个班'}
            </button>
            {named !== null && (
              <button
                type="button"
                disabled={namingBusy}
                onClick={() => void doNaming(true)}
                title="忽略缓存重新命名（会真的再调一次模型）"
                className="rounded-dc-sm px-1 py-0.5 dc-t-micro text-dc-text-3 hover:bg-dc-layer-3 disabled:opacity-40"
              >
                重算
              </button>
            )}
            {namingRouteMissing && (
              <span className="dc-t-micro text-dc-warn">命名桥接未注册：请重启 dsh web（host 半是进程内加载的）</span>
            )}
            {!namingRouteMissing && avail !== null && !avail.available && (
              <span className="dc-t-micro text-dc-warn">模型不可用：{avail.reason}</span>
            )}
            {avail?.available === true && named === null && (
              <span className="dc-t-micro text-dc-text-3">
                {avail.provider}/{avail.model}
              </span>
            )}
            {outcome?.ok === true && outcome.cached && <span className="dc-t-micro text-dc-text-3">（缓存命中）</span>}
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
              structure={structure}
              refreshing={namingBusy}
              onRefresh={() => void doNaming(true)}
            />
          )}
        </>
      )}
    </div>
  )
}
