/**
 * src/components/ConceptClassesCard.tsx —— 「自挖板块」类列表（A2b 次要视角 → A6 一级入口）。
 *
 * ## 这个页面回答什么
 *
 * 「今天市场自己把哪些票当成同一个班，这些班分别叫什么、哪个最猛」。
 * 所以三件事必须在同一行里同时出现，且**同源**：
 *   · **强度**（排序依据）= 均涨幅 + 6×涨停数（口径唯一来源 `lib/concept-strength.ts`）；
 *   · **涨幅 / 涨停数**（用户要的两个数，也是强度分的两个分量）；
 *   · **模型给的主题名**（命名归类）。
 * 排序用强度、显示也用强度 —— 否则会出现"排在前面的涨幅更低"这种无法解释的列表。
 *
 * ## 命名为什么是批量的、且打开就跑
 *
 * 逐类点「命名」= 十次模型请求，而且模型看不到组间区别（容易把"铜"和"铝"都叫成"有色金属"）。
 * 现在：打开页面**自动**批量命名一次（host 侧一次采集 + 少量分批调用 + 逐组护栏），
 * 之后重复打开命中缓存/memo = **0 采集 + 0 模型调用**（页头把这件事显示出来，
 * 因为"花了多少预算"必须可见）。单类的「重命名」保留：要看某组为什么这么叫时用。
 *
 * ## 为什么保留弱链与孤立票
 *
 * 类列表有一个别处没有的价值：**能看见被排除的东西**。
 * 弱链伪类（类内相关远低于阈值）被过滤，但要显示"排除了几个"；
 * 池内却孤立的强势票也列出来 —— 那说明它今天是"独狼"，不是"班"。
 * 参考实现（cluster-namer）也是这个立场：记录而不丢弃。
 *
 * 参数必须显示（as_of + window / min_corr / pool_n）：同票不同参数所属类不同，不标 = 不可复现。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ChevronDown, ChevronRight, RefreshCw, Sparkles } from 'lucide-react'
import {
  entryOutcome,
  fetchConceptClasses,
  fetchNamingAvailability,
  requestBatchNaming,
  requestNaming,
  verdictLabel,
  degradedLabel,
  type BatchNamingEntry,
  type BatchNamingOutcome,
  type ConceptClassRow,
  type ConceptClassesPayload,
  type NamingAvailability,
  type NamingOutcome,
  type NamingParams,
  NAMING_PARAMS_FALLBACK,
} from '@/lib/naming'
import { compareByStrength, strengthFormulaText } from '@/lib/concept-strength'
import { NamingResultPanel } from './NamingResultPanel'
import type { MarketTag } from '@/lib/symbol'

interface Props {
  onOpenStock?: ((market: MarketTag, code: string, name: string) => void) | undefined
}

/** 涨跌色一律走 token（A 股语义色的唯一来源是 index.css.txt 的 --dc-*）。 */
function pctText(v: number | null): string {
  if (v === null) return '—'
  return `${v > 0 ? '+' : ''}${v.toFixed(2)}%`
}

function pctClass(v: number | null): string {
  if (v === null || v === 0) return 'text-slate-400'
  return v > 0 ? 'dc-up' : 'dc-down'
}

/** 主题名/状态：`named` 才有名字（降级不留半个名字给人误引）。 */
function themeOf(outcome: NamingOutcome | null): { text: string; tone: string; verdict: string | null } {
  if (outcome === null || outcome.ok === false) {
    return { text: '未命名', tone: 'text-slate-400', verdict: null }
  }
  const r = outcome.result
  if (r.verdict === 'named') return { text: r.theme ?? '（空）', tone: 'text-violet-700', verdict: r.verdict }
  return { text: verdictLabel(r.verdict), tone: 'text-slate-500', verdict: r.verdict }
}

export function ConceptClassesCard({ onOpenStock }: Props) {
  const [payload, setPayload] = useState<ConceptClassesPayload | null>(null)
  const [params, setParams] = useState<NamingParams>(NAMING_PARAMS_FALLBACK)
  const [avail, setAvail] = useState<NamingAvailability | null>(null)
  /** 命名路由探不到（host 半未重启）—— 与"模型不可用"必须分开说，否则用户会去查模型配置。 */
  const [namingRouteMissing, setNamingRouteMissing] = useState(false)
  const [batch, setBatch] = useState<(BatchNamingOutcome & { ok: true }) | null>(null)
  const [batchErr, setBatchErr] = useState('')
  const [batchBusy, setBatchBusy] = useState(false)
  /** 单类重命名的结果（覆盖批量结论的那一组）。 */
  const [overrides, setOverrides] = useState<Record<number, NamingOutcome>>({})
  const [namingId, setNamingId] = useState<number | null>(null)
  const [expanded, setExpanded] = useState<Record<number, boolean>>({})
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  /** 自动批量命名的去重键（as_of + 参数）：同一口径只自动跑一次。 */
  const autoKeyRef = useRef('')

  const load = useCallback(async () => {
    setBusy(true)
    setErr('')
    try {
      const info = await fetchNamingAvailability().catch(() => null)
      setAvail(info)
      setNamingRouteMissing(info === null)
      const p = info?.defaults ?? NAMING_PARAMS_FALLBACK
      setParams(p)
      const data = await fetchConceptClasses(p, 5)
      setPayload(data)
      // 换 as_of/参数后旧的批量结论不再适用（同一类在不同参数下可能不是同一批票）
      autoKeyRef.current = ''
      setBatch(null)
      setOverrides({})
    } catch (e) {
      setErr((e as Error).message || '自挖板块取数失败')
      setPayload(null)
    } finally {
      setBusy(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  /** 批量命名（`refresh` = 绕过缓存/memo，会真的再调模型）。 */
  const doBatch = useCallback(
    async (refresh: boolean) => {
      setBatchBusy(true)
      setBatchErr('')
      try {
        const out = await requestBatchNaming({
          ...(payload?.asOf !== undefined && payload.asOf !== '' ? { asOf: payload.asOf } : {}),
          params,
          refresh,
        })
        if (out.ok) {
          setBatch(out)
          setOverrides({})
        } else {
          setBatchErr(out.note || '批量命名未完成')
        }
      } catch (e) {
        setBatchErr((e as Error).message || '批量命名失败')
      } finally {
        setBatchBusy(false)
      }
    },
    [payload, params],
  )

  // 打开即命名（仅当模型与路由都可用；一轮只跑一次，之后靠缓存/memo）
  useEffect(() => {
    if (payload?.ok !== true || payload.classes.length === 0) return
    if (avail?.available !== true || namingRouteMissing) return
    const key = `${payload.asOf}|${params.window}/${params.minCorr}/${params.poolN}`
    if (autoKeyRef.current === key) return
    autoKeyRef.current = key
    void doBatch(false)
  }, [payload, avail, namingRouteMissing, params, doBatch])

  /**
   * 单类重命名（忽略缓存重算）：结论覆盖批量里那一组，并自动展开它的证据。
   * `refresh=false` 时可能直接命中"单类"缓存（与批量是不同提示词，缓存不共享）。
   */
  const doNaming = useCallback(
    async (classId: number, refresh: boolean) => {
      setNamingId(classId)
      setErr('')
      try {
        const data = await requestNaming({
          classId,
          ...(payload?.asOf !== undefined && payload.asOf !== '' ? { asOf: payload.asOf } : {}),
          params,
          refresh,
        })
        setOverrides((prev) => ({ ...prev, [classId]: data }))
        setExpanded((prev) => ({ ...prev, [classId]: true }))
      } catch (e) {
        setErr((e as Error).message || '命名失败')
      } finally {
        setNamingId(null)
      }
    },
    [payload, params],
  )

  /** 这一组最终采用的结论：单类覆盖 > 批量结果。 */
  const outcomeOf = useCallback(
    (classId: number): NamingOutcome | null => {
      const single = overrides[classId]
      if (single !== undefined) return single
      const entry = batch?.entries.find((e) => e.classId === classId)
      if (entry === undefined || batch === null) return null
      return entryOutcome(batch, entry)
    },
    [batch, overrides],
  )

  const entryOf = useCallback(
    (classId: number): BatchNamingEntry | undefined => batch?.entries.find((e) => e.classId === classId),
    [batch],
  )

  // 强度降序（口径与 host 聚合同源；并列看结构，见 compareByStrength）
  const rows: ConceptClassRow[] = useMemo(() => {
    const usable = (payload?.classes ?? []).filter((c) => !c.weakChain)
    return [...usable].sort((a, b) =>
      compareByStrength(
        { classId: a.classId, strength: a.strength, strongDensity: a.strongDensity, intraCorr: a.intraCorr, size: a.size },
        { classId: b.classId, strength: b.strength, strongDensity: b.strongDensity, intraCorr: b.intraCorr, size: b.size },
      ),
    )
  }, [payload])
  const weakN = (payload?.classes ?? []).filter((c) => c.weakChain).length

  /** 命名进度 + **按采集事实聚合的成因**（页头一句话必须说得出"为什么没有名字"）。 */
  const naming = useMemo(() => {
    const outcomes = rows
      .map((c) => outcomeOf(c.classId))
      .filter((o): o is Extract<NamingOutcome, { ok: true }> => o !== null && o.ok)
    const results = outcomes.map((o) => o.result)
    const named = results.filter((r) => r.verdict === 'named').length
    const concluded = rows.filter((c) => outcomeOf(c.classId) !== null).length
    const cached = batch?.entries.filter((e) => e.cached).length ?? 0
    // 没有名字的那些组，按**系统归因**（degradedReason）与**素材来源状态**分别计数。
    // 不再写成"模型判为无共同主题或素材不足"——那句话把三种成因混成一句，
    // 让人以为模型看过素材后下的判断（实测：其实是 2 个源按设计跳过 + 2 个源无产出）。
    const nameless = results.filter((r) => r.verdict !== 'named')
    const byReason = new Map<string, number>()
    for (const r of nameless) byReason.set(r.degradedReason, (byReason.get(r.degradedReason) ?? 0) + 1)
    const skipped = nameless.filter((r) => r.sourceStatus.some((s) => s.status === 'skipped_by_design')).length
    const failed = nameless.filter((r) => r.sourceStatus.some((s) => s.status === 'failed')).length
    const noMaterial = nameless.filter((r) => r.degradedReason === 'no_material').length
    return { named, concluded, cached, nameless: nameless.length, byReason, skipped, failed, noMaterial }
  }, [rows, outcomeOf, batch])

  const formula = strengthFormulaText()

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-1.5 dc-t-data text-slate-500">
        <span className="font-medium text-slate-600">市场今天把哪些票当成同一个班</span>
        {payload?.asOf && <span className="rounded bg-slate-100 px-1 font-mono dc-t-micro">as_of {payload.asOf}</span>}
        <span className="rounded bg-slate-100 px-1 font-mono dc-t-micro">
          window {params.window} · min_corr {params.minCorr} · pool {params.poolN}
        </span>
        <button
          type="button"
          onClick={() => void load()}
          disabled={busy}
          className="ml-auto flex items-center gap-0.5 rounded px-1 py-0.5 text-slate-400 hover:bg-slate-100 disabled:opacity-40"
        >
          <RefreshCw size={10} className={busy ? 'animate-spin' : ''} />
          刷新
        </button>
      </div>

      {err !== '' && <div className="rounded bg-red-50 px-2 py-1 dc-t-note text-red-500">{err}</div>}

      {namingRouteMissing && (
        <div className="rounded border border-amber-100 bg-amber-50 px-2 py-1.5 dc-t-note text-amber-700">
          命名桥接未注册（GET /api/stock-panel/naming 不可达）：host 半是**进程内加载**的，
          <span className="font-medium">请重启 dsh web</span>。共动聚类与强度/涨幅/涨停数照常可看，
          只是没有模型给的名字。
        </div>
      )}

      {payload !== null && !payload.ok && (
        <div className="rounded border border-amber-100 bg-amber-50 px-2 py-1.5 dc-t-note text-amber-700">
          引擎当前不可用：{payload.notes.join('；') || '未知原因'}
          <div className="mt-0.5 dc-t-data text-amber-600">
            常见原因：非交易日 / 成交额榜快照未就绪（可用池不足）。冷启动首次拉数百只 K 线约需数秒，之后走缓存。
          </div>
        </div>
      )}

      {payload?.ok === true && (
        <>
          {/* 命名状态行：模型给了几个名字、这次花了多少次调用 —— 预算必须可见 */}
          <div className="flex flex-wrap items-center gap-1.5 rounded border border-slate-100 bg-slate-50/70 px-2 py-1 dc-t-data text-slate-500">
            <Sparkles size={10} className={batchBusy ? 'animate-pulse text-violet-500' : 'text-violet-400'} />
            {namingRouteMissing ? (
              <span>模型命名不可用（命名桥接未注册）</span>
            ) : avail?.available === false ? (
              <span className="text-amber-600">模型不可用：{avail.reason ?? '未知原因'}</span>
            ) : batchBusy ? (
              <span>模型正在命名归类…（一次采集 + 少量分批调用，通常几秒到一分钟）</span>
            ) : batchErr !== '' ? (
              <span className="text-amber-600">批量命名未完成：{batchErr}</span>
            ) : batch !== null ? (
              <>
                <span>
                  已命名 <span className="font-medium text-violet-700">{naming.named}</span> / {rows.length} 组
                  {naming.nameless > 0 && (
                    <span
                      className="text-amber-600"
                      title={[...naming.byReason.entries()].map(([k, n]) => `${n} 组：${degradedLabel(k)}`).join('；')}
                    >
                      {`（${naming.nameless} 组没有名字：`}
                      {naming.skipped > 0 ? `实时源按设计跳过 ${naming.skipped} 组` : ''}
                      {naming.skipped > 0 ? ' · ' : ''}
                      {`无产出 ${naming.noMaterial} 组`}
                      {naming.failed > 0 ? ` · 采集失败 ${naming.failed} 组` : ''}
                      {'）'}
                    </span>
                  )}
                </span>
                <span className="text-slate-400">
                  本次模型调用 {batch.llmCalls} 次
                  {batch.memoHit ? ' · 复用上一轮结果（不重新采集素材、不调模型）' : ` · 缓存命中 ${naming.cached} 组`}
                </span>
              </>
            ) : (
              <span>等待模型命名…</span>
            )}
            <span className="ml-auto flex items-center gap-1">
              {avail?.model !== undefined && (
                <span className="font-mono dc-t-micro text-slate-400" title={`模型 ${avail.provider ?? '?'}/${avail.model}`}>
                  {avail.model}
                </span>
              )}
              <button
                type="button"
                disabled={batchBusy || namingRouteMissing || avail?.available === false || rows.length === 0}
                onClick={() => void doBatch(true)}
                title="忽略缓存重新命名全部（会真的再调模型；能看某组为什么这么叫时用单组「重命名」）"
                className="dc-btn dc-btn--accent dc-btn--icon flex items-center gap-0.5 px-1.5 py-0.5 dc-t-data disabled:opacity-40"
              >
                <Sparkles size={10} />
                {batchBusy ? '命名中…' : '重新命名全部'}
              </button>
            </span>
          </div>

          <div className="flex flex-wrap items-center gap-2 dc-t-data text-slate-400">
            <span>
              可采信类 <span className="font-medium text-slate-600">{rows.length}</span> 个 ·{' '}
              <span title={formula}>按强度排序（均涨幅 + 6×涨停数）</span>
            </span>
            <span>
              孤立票 <span className="font-medium text-slate-600">{payload.isolatedN}</span> 只（今天没有稳定的同伴）
            </span>
            {weakN > 0 && (
              <span title="类内相关远低于阈值 → 阈值图连通分量的传递链伪类，不采信也不命名">
                已过滤弱链伪类 {weakN} 个
              </span>
            )}
          </div>

          <div className="space-y-1">
            {rows.length === 0 && (
              <div className="rounded border border-slate-100 bg-slate-50 px-2 py-1.5 dc-t-note text-slate-500">
                当前参数下没有可采信的共动类（全部被判定为弱链或不足）。可放宽 min_corr 再看，但校准结论是
                0.6 才切得出语义自洽的小类 —— 放宽会换来"巨类噪声"。
              </div>
            )}
            {rows.map((c, i) => {
              const outcome = outcomeOf(c.classId)
              const th = themeOf(outcome)
              const entry = entryOf(c.classId)
              const open = expanded[c.classId] === true
              return (
                <div key={c.classId} className="rounded border border-slate-100 bg-white px-2 py-1">
                  <div className="flex flex-wrap items-baseline gap-1.5">
                    <span
                      className="dc-num rounded bg-slate-100 px-1 dc-t-decision font-semibold text-slate-600"
                      title={formula}
                    >
                      {c.strength.toFixed(1)}
                    </span>
                    <span
                      className={`text-sm font-semibold ${th.tone}`}
                      title={
                        outcome !== null && outcome.ok && outcome.result.verdict === 'named'
                          ? `模型归纳的共同主题（as_of ${outcome.result.asOf} · 证据分 ${outcome.result.evidenceScore.toFixed(2)}）`
                          : '模型没有给出主题名（见展开里的成因）'
                      }
                    >
                      {th.text}
                    </span>
                    {th.verdict === 'named' && outcome !== null && outcome.ok && outcome.result.alternatives.length > 0 && (
                      <span className="dc-t-micro text-slate-400">备选 {outcome.result.alternatives.slice(0, 2).join('、')}</span>
                    )}
                    {/* 注脚（排名/类号）进 title：一行里注脚越多，主题名能用的宽度越少。
                        需要它时鼠标停一下就有，不必常驻占位。 */}
                    <span
                      className="dc-t-micro text-slate-300"
                      title={`排序 #${i + 1}（按强度降序）· 自挖类 class ${c.classId}${payload?.asOf !== undefined ? ` · as_of ${payload.asOf}` : ''}`}
                    >
                      #{i + 1}
                    </span>
                    <span className="ml-auto flex items-center gap-1">
                      <button
                        type="button"
                        onClick={() => setExpanded((prev) => ({ ...prev, [c.classId]: !open }))}
                        title={open ? '收起模型结论与逐条证据' : '展开模型结论与逐条证据（引文逐字可反查）'}
                        className="flex items-center gap-0.5 rounded px-1 py-0.5 dc-t-micro text-slate-400 hover:bg-slate-100"
                      >
                        {open ? <ChevronDown size={10} /> : <ChevronRight size={10} />}
                        证据
                      </button>
                      <button
                        type="button"
                        disabled={namingId !== null || namingRouteMissing || avail?.available === false}
                        onClick={() => void doNaming(c.classId, true)}
                        title={
                          namingRouteMissing
                            ? '命名桥接是 host 半注册的路由：请重启 dsh web（浏览器刷新不够）'
                            : avail?.available === false
                              ? `模型不可用：${avail.reason ?? '未知'}`
                              : '只重算这一组（忽略缓存，会再调一次模型）'
                        }
                        className="rounded px-1 py-0.5 dc-t-micro text-slate-400 hover:bg-slate-100 disabled:opacity-40"
                      >
                        {namingId === c.classId ? '命名中…' : '重命名'}
                      </button>
                    </span>
                  </div>

                  {/* 当日强弱：涨停数 + 涨幅（用户要的两个数，也是强度分的两个分量）。
                      用**等宽网格**而不是 flex-wrap：7 个指标在各类之间纵向对齐，
                      扫一列就能比较（flex-wrap 会让位置随各行内容长度漂移）。 */}
                  <div
                    className="mt-0.5 grid items-baseline gap-x-2 gap-y-0.5 dc-t-data"
                    style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(8.5ch, 1fr))' }}
                  >
                    <span
                      className={c.limitUpN > 0 ? 'dc-up font-medium' : 'text-slate-400'}
                      title="当日收盘触及涨停价的成员只数（buy_price_limit 精确判定，与状态带广度同法）"
                    >
                      涨停 {c.limitUpN}
                    </span>
                    <span className={pctClass(c.chgMean)} title="成员当日涨跌幅的均值（缺失值不计入）">
                      均 {pctText(c.chgMean)}
                    </span>
                    {c.chgMax !== null && (
                      <span className="text-slate-400" title="成员当日最大涨幅（这个班的龙头跑了多少）">
                        最大 {pctText(c.chgMax)}
                      </span>
                    )}
                    <span className="text-slate-400" title="上涨只数（含涨停）">
                      上涨 {c.upN}/{c.knownN}
                    </span>
                    <span className="text-slate-300">·</span>
                    <span className="text-slate-400" title="类内平均相关（结构指标：越紧越像一个班）">
                      类内相关 <span className="dc-num text-slate-600">{c.intraCorr.toFixed(3)}</span>
                    </span>
                    <span className="text-slate-400" title="强边密度 = 类内相关 ≥ 阈值的边占比">
                      强边 <span className="dc-num text-slate-600">{c.strongDensity.toFixed(2)}</span>
                    </span>
                    <span className="text-slate-400">{c.size} 只</span>
                    {c.knownN < c.size && (
                      <span className="text-amber-500" title="部分成员没有当日行情（停牌/无数据）——没有被当成 0 平盘">
                        仅 {c.knownN}/{c.size} 只有行情
                      </span>
                    )}
                    {entry?.cached === true && <span className="text-slate-300">（命名走缓存）</span>}
                  </div>

                  {/* 成员 chips：用**等宽网格**而不是 flex-wrap —— 每个 chip 宽 ~10ch，
                      网格让它们按可用宽度自动排列成整齐的列，右边缘不再参差。 */}
                  <div className="mt-0.5 grid gap-1" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(10.5ch, 1fr))' }}>
                    {c.members.length === 0 && <span className="dc-t-data text-slate-400">{c.top.join('、')}</span>}
                    {c.members.map((m) => (
                      <button
                        key={`${m.market}${m.code}`}
                        type="button"
                        onClick={() => onOpenStock?.(m.market as MarketTag, m.code, m.name)}
                        title={`${m.code} ${m.name}｜当日 ${pctText(m.chgPct)}${m.limitUp ? '｜涨停' : ''}${
                          m.corr !== null ? `｜与类内平均相关 ${m.corr}` : ''
                        }（点击看这只票）`}
                        className={`rounded border px-1 py-px dc-t-data hover:border-slate-400 ${
                          m.limitUp ? 'border-red-200 bg-red-50' : 'border-slate-200 bg-white'
                        } text-slate-500`}
                      >
                        {m.name}
                        <span className={`ml-1 font-mono ${pctClass(m.chgPct)}`}>{pctText(m.chgPct)}</span>
                        {m.limitUp && <span className="ml-0.5 dc-t-micro text-red-500">涨停</span>}
                      </button>
                    ))}
                  </div>

                  {open && outcome !== null && (
                    <NamingResultPanel
                      outcome={outcome}
                      refreshing={namingId === c.classId}
                      onRefresh={() => void doNaming(c.classId, true)}
                    />
                  )}
                  {open && outcome === null && (
                    <div className="mt-1 rounded bg-slate-50 px-1.5 py-1 dc-t-data text-slate-500">
                      这一组还没有模型结论
                      {entry?.skipReason === 'weak_chain'
                        ? '（弱链伪类：不采信、也不命名）'
                        : entry?.skipReason === 'over_cap'
                          ? '（超出本轮命名上限：先命名最强的几组，可手动「重命名」这一组）'
                          : batchBusy
                            ? '（模型正在命名…）'
                            : '（点「重命名」让模型单独看这一组）'}
                    </div>
                  )}
                  {open && outcome !== null && outcome.ok && outcome.result.degradedReason !== 'none' && (
                    <div className="mt-0.5 dc-t-micro text-amber-600">
                      成因：{degradedLabel(outcome.result.degradedReason) || outcome.result.degradedReason}
                    </div>
                  )}
                </div>
              )
            })}
          </div>

          {payload.isolatedTop.length > 0 && (
            <div className="rounded border border-slate-100 bg-slate-50/60 px-2 py-1.5">
              <div className="dc-t-data text-slate-500">
                池内却孤立的票（强势但不跟人共动 —— 独狼，不是班）
              </div>
              <div className="mt-0.5 flex flex-wrap gap-1">
                {payload.isolatedTop.map((s) => (
                  <button
                    key={s.market + s.code}
                    type="button"
                    onClick={() => onOpenStock?.(s.market as MarketTag, s.code, s.name)}
                    title={`${s.code} ${s.name}${s.chgPct !== null ? `｜当日 ${s.chgPct.toFixed(2)}%` : ''}${
                      s.limitUp ? '｜涨停' : ''
                    }`}
                    className="rounded border border-slate-200 bg-white px-1 py-px dc-t-data text-slate-500 hover:border-slate-400"
                  >
                    {s.name}
                    <span className={`ml-1 font-mono ${pctClass(s.chgPct)}`}>{pctText(s.chgPct)}</span>
                    {s.limitUp && <span className="ml-0.5 dc-t-micro text-red-500">涨停</span>}
                  </button>
                ))}
              </div>
            </div>
          )}

          <div className="dc-t-data leading-relaxed text-slate-400">
            <span className="text-slate-500">口径：</span>
            <span title={formula}>强度 = 均涨幅% + 6×涨停数</span>
            ，按强度降序（并列看强边密度 → 类内相关 → 规模）。涨停由**收盘价触及涨停价**判定
            （`buy_price_limit`，各板幅度不同所以不用 9.8% 阈值法；无涨跌幅限制的新股不计入）。
            这是**无监督共动聚类**（K 线残差相关 → 阈值图连通分量）挖出的类，与官方概念/行业是两回事；
            <span className="text-slate-500">弱链类（类内相关远低于阈值）已过滤且不参与命名</span>。
            主题名是**模型归纳 + 逐条引文护栏**的产物（护栏拒了就如实降级，不留半个名字）。
          </div>
        </>
      )}
    </div>
  )
}
