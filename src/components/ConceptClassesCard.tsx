/**
 * src/components/ConceptClassesCard.tsx —— 「自挖板块」类列表（A2b 次要视角 → A6 一级入口）。
 *
 * ## 这个页面回答什么
 *
 * 「今天市场自己把哪些票当成同一个班，这些班分别叫什么、哪个最猛、这个班像什么」。
 * 所以一行里必须同时出现三件事，且**来源可分辨**：
 *   · **强度**（排序依据）= 均涨幅 + 6×涨停数（口径唯一来源 `lib/concept-strength.ts`）；
 *   · **名称**：优先「模型主题名」（有素材才给，受护栏约束），没有时用
 *     **「结构标签」**（官方行业/概念口径，确定性、不经模型，见 `host/naming/structure.ts`）顶位 ——
 *     两者是**不同来源**，所以界面上永远带着来源标签（模型主题 / 官方行业 / 官方概念）；
 *   · **成员**（要落到票）+ 当日涨幅/涨停。
 *
 * ## 为什么名称要"两条腿"（这是本页最重要的一次修正）
 *
 * 旧版只有模型一条腿，而模型命名有一条**正确的**硬约束：没素材不许起名字。
 * 副作用是素材最缺的那天（非交易日 / 实时源按设计跳过 / 成员都没涨停），
 * 整张列表一个标签都没有 —— 实测 9 个可采信类全部显示「素材不足」，
 * 而它们的成员是「西安奕材-U / 恒坤新材 / 中巨芯-U / 兴福电子」这种一眼能看懂的东西。
 * 于是"分类"这件事等于没做：用户看到的是几百个股票名，没有可扫、可比较、可记的锚点。
 *
 * 现在：**结构标签**负责"这个班像什么"（官方分类学数出来的事实，永远有），
 * **模型主题名**负责"它们今天为什么一起动"（需要素材+护栏，没有就如实说没有）。
 * 后者拿不到时前者顶位，且来源标签会跟着变 —— 不允许用其中一个冒充另一个。
 *
 * ## 命名为什么是批量的、且打开就跑
 *
 * 逐类点「命名」= 十次模型请求，而且模型看不到组间区别（容易把"铜"和"铝"都叫成"有色金属"）。
 * 现在：打开页面**自动**批量命名一次（host 侧一次采集 + 少量分批调用 + 逐组护栏），
 * 之后重复打开命中缓存/memo = **0 采集 + 0 模型调用**（页头把这件事显示出来，
 * 因为"花了多少预算"必须可见）。单类的「重命名」保留：要看某组为什么这么叫时用。
 *
 * ## 为什么保留被排除的东西
 *
 * 类列表有一个别处没有的价值：**能看见被排除的东西**。
 * 弱链伪类（引擎标记）与传递链可疑类（本地判据，见 `lib/concept-quality.ts`）
 * 都被过滤，但要显示"排除了几个、分别为什么"；池内却孤立的强势票也列出来 ——
 * 那说明它今天是"独狼"，不是"班"。参考实现（cluster-namer）也是这个立场：记录而不丢弃。
 *
 * 参数必须显示（as_of + window / min_corr / pool_n）：同票不同参数所属类不同，不标 = 不可复现。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ChevronDown, ChevronRight, RefreshCw, Sparkles, Layers } from 'lucide-react'
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
  type ClassStructure,
  type ConceptClassRow,
  type ConceptClassesPayload,
  type NamingAvailability,
  type NamingOutcome,
  type NamingParams,
  NAMING_PARAMS_FALLBACK,
} from '@/lib/naming'
import { compareByStrength, strengthFormulaText } from '@/lib/concept-strength'
import { filterUsableClasses, qualityReasonLabel } from '@/lib/concept-quality'
import { structureLine } from '@/host/naming/structure'
import { NamingResultPanel } from './NamingResultPanel'
import type { MarketTag } from '@/lib/symbol'

interface Props {
  onOpenStock?: ((market: MarketTag, code: string, name: string) => void) | undefined
}

/** 一行默认铺几只成员（其余进「+N」）。52 只全量铺开会把整页撑成几百像素。 */
const MEMBERS_VISIBLE = 12
/** 孤立票默认铺几只。 */
const ISOLATED_VISIBLE = 18

/** 涨跌色一律走 token（A 股语义色的唯一来源是 index.css.txt 的 --dc-*）。 */
function pctText(v: number | null): string {
  if (v === null) return '—'
  return `${v > 0 ? '+' : ''}${v.toFixed(2)}%`
}

/** 涨跌色调（内联样式用 var()，不写字面量 —— 暗色下 token 会提亮）。 */
function pctTone(v: number | null): string {
  if (v === null || v === 0) return ''
  return v > 0 ? 'dc-up' : 'dc-down'
}

/**
 * 名称来源（决定名字取哪一份、以及界面上必须标出来的那个胶囊）。
 *
 * 为什么把"来源"做成显式枚举而不是两个可选字段：这两个名字**不可互换地引用**
 * （模型主题名是结论、结构标签是官方分类学事实）。只要它们在同一个位置显示，
 * 就必须有一个字段回答"现在显示的是哪一个"，否则界面一定会漂。
 */
type NameKind = 'model' | 'industry' | 'concept' | 'none'

interface RowName {
  text: string
  kind: NameKind
  /** 来源胶囊文案。 */
  srcLabel: string
  /** 鼠标停上去的解释（含口径与覆盖度）。 */
  title: string
}

const SRC_LABEL: Record<NameKind, string> = {
  model: '模型主题',
  industry: '官方行业',
  concept: '官方概念',
  none: '未命名',
}

/** 一行最终显示的名称：模型命名成功用它，否则退到结构标签。 */
function rowNameOf(outcome: NamingOutcome | null, structure: ClassStructure | null): RowName {
  if (outcome !== null && outcome.ok && outcome.result.verdict === 'named' && (outcome.result.theme ?? '') !== '') {
    const r = outcome.result
    return {
      text: r.theme as string,
      kind: 'model',
      srcLabel: SRC_LABEL.model,
      title:
        `模型归纳的共同主题（as_of ${r.asOf} · 证据分 ${r.evidenceScore.toFixed(2)} · 模型 ${r.modelVersion}）`
        + ' —— 依据是窗口内的快讯事件/板块标签，每条引文都逐字反查过',
    }
  }
  if (structure !== null && structure.label !== '') {
    const kind: NameKind = structure.basis === 'concept' ? 'concept' : 'industry'
    return {
      text: structure.label,
      kind,
      srcLabel: SRC_LABEL[kind],
      title: `${structure.note}（覆盖 ${structure.covered}/${structure.total} 只）—— 这不是模型结论`,
    }
  }
  return {
    text: '未命名',
    kind: 'none',
    srcLabel: SRC_LABEL.none,
    title: '模型没给出主题名，且成员没有可共享的官方板块标签（见展开里的成因）',
  }
}

/** 结构指标（"这个班紧不紧"）与当日强弱分开显示：两者不是一类数字。 */
function structMetrics(c: ConceptClassRow): Array<{ label: string; value: string; title: string }> {
  return [
    {
      label: '类内相关',
      value: c.intraCorr.toFixed(3),
      title: '类内平均相关（结构指标：越紧越像一个班）。低于切边阈值且强边密度低 → 传递链可疑，已过滤',
    },
    { label: '强边', value: c.strongDensity.toFixed(2), title: '强边密度 = 类内相关 ≥ 阈值的边占比，真班接近 1' },
    { label: '规模', value: `${c.size} 只`, title: `类规模（有当日行情的 ${c.knownN} 只）` },
  ]
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
  /** 展开"证据"（命名结论与逐条引文）。 */
  const [expanded, setExpanded] = useState<Record<number, boolean>>({})
  /** 展开该行的全部成员。 */
  const [membersOpen, setMembersOpen] = useState<Record<number, boolean>>({})
  const [isoOpen, setIsoOpen] = useState(false)
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
      setMembersOpen({})
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

  /** 这一组的结构标签：单类覆盖自带的那份优先（它就是这次采集的事实）。 */
  const structureOfClass = useCallback(
    (classId: number): ClassStructure | null => {
      const single = overrides[classId]
      if (single !== undefined && single.ok) return single.structure
      return entryOf(classId)?.structure ?? null
    },
    [entryOf, overrides],
  )

  /**
   * 可采信类 = 引擎给的类里，既不是弱链伪类、也不是传递链可疑的那些（判据与 host 命名路径同源）。
   * 被拦下的**不丢**：`byReason` 进汇总条的"已排除"说明。
   */
  const filter = useMemo(
    () => filterUsableClasses(payload?.classes ?? [], payload?.params.minCorr ?? params.minCorr),
    [payload, params.minCorr],
  )

  // 强度降序（口径与 host 聚合同源；并列看结构，见 compareByStrength）
  const rows: ConceptClassRow[] = useMemo(
    () =>
      [...filter.usable].sort((a, b) =>
        compareByStrength(
          { classId: a.classId, strength: a.strength, strongDensity: a.strongDensity, intraCorr: a.intraCorr, size: a.size },
          { classId: b.classId, strength: b.strength, strongDensity: b.strongDensity, intraCorr: b.intraCorr, size: b.size },
        ),
      ),
    [filter],
  )
  const droppedN = filter.dropped.length

  /**
   * 强度条的归一标尺：**按绝对值最大者**归一，于是零点就是零宽。
   *
   * 为什么不用 min–max 归一（第一版就是这么写的，实测踩了）：普跌日全是负数时
   * min–max 会把"0.0 分"画成半格红条、"−2.7 分"只剩一小截绿条 —— 视觉上
   * "零分"比"负分"强一倍多，条长与"强弱"直接反了；而且 8 行的条长会挤在 40–54px 里，
   * 差 1–3px 根本不可辨（等于没编码）。改成 |v|/max|v| 后：0 → 0 宽（不画），
   * 最强者满格，方向由颜色（红涨/绿跌）承担。
   */
  const barScale = useMemo(() => {
    if (rows.length === 0) return 1
    return Math.max(1e-9, ...rows.map((c) => Math.abs(c.strength)))
  }, [rows])

  /** 相对条长（%）：|强度| / 列表内最大 |强度|，零分不画。 */
  const barPctOf = useCallback(
    (strength: number): number => Math.round((Math.abs(strength) / barScale) * 100),
    [barScale],
  )

  /** 命名进度 + **按采集事实聚合的成因**（页头一句话必须说得出"为什么没有名字"）。 */
  const naming = useMemo(() => {
    const outcomes = rows
      .map((c) => outcomeOf(c.classId))
      .filter((o): o is Extract<NamingOutcome, { ok: true }> => o !== null && o.ok)
    const results = outcomes.map((o) => o.result)
    const named = results.filter((r) => r.verdict === 'named').length
    /** 模型没给名字、但结构标签顶上了的组数（这才是用户实际"看得到名字"的组数）。 */
    const labelled = rows.filter((c) => rowNameOf(outcomeOf(c.classId), structureOfClass(c.classId)).kind !== 'none').length
    const cached = batch?.entries.filter((e) => e.cached).length ?? 0
    const nameless = results.filter((r) => r.verdict !== 'named')
    const byReason = new Map<string, number>()
    for (const r of nameless) byReason.set(r.degradedReason, (byReason.get(r.degradedReason) ?? 0) + 1)
    const failed = nameless.filter((r) => r.sourceStatus.some((s) => s.status === 'failed')).length
    /**
     * 没有名字的组，按**系统归因**（`degradedReason`，分层口径见 host/naming/types.ts）取前两档。
     *
     * 为什么不按"源状态拼一句话"：源状态是**四个源的组合**，拼出来会出现
     * 「无产出 0 组」这种读了等于没读的句子（实测），而真正的成因已经由 `degradedReason`
     * 分层定过档 —— 两处各说一半只会互相稀释。逐源明细仍在**每一组的展开卡**里
     * （`sourceStatus` 逐条列出），那才是它该出现的地方。
     */
    const topReasons = [...byReason.entries()]
      .sort((a, b) => (b[1] !== a[1] ? b[1] - a[1] : a[0].localeCompare(b[0])))
      .slice(0, 2)
      .map(([k, n]) => `${degradedLabel(k) || k} ${n} 组`)
    return { named, labelled, cached, nameless: nameless.length, byReason, topReasons, failed }
  }, [rows, outcomeOf, structureOfClass, batch])

  const formula = strengthFormulaText()
  const isoList = payload?.isolatedTop ?? []
  const isoShown = isoOpen ? isoList : isoList.slice(0, ISOLATED_VISIBLE)

  return (
    <div className="dc-cc">
      {/* 页头：一句"这页在回答什么" + 口径（合成一个 chip，不占两行）+ 刷新 */}
      <div className="dc-cc-head">
        <span className="dc-cc-title">
          <Layers size={14} />
          自挖板块
          <span className="dc-cc-ask" title="市场今天把哪些票当成同一个班 · 哪个班最猛 · 这个班像什么">
            市场自己认定的班 · 按强度排序
          </span>
        </span>
        {/* as_of 与三个参数合成一个 chip：拆成两个会在中等宽度下把「刷新」挤到第二行 */}
        <span className="dc-cc-chip-param" title="同票不同参数所属类不同 —— 不标参数 = 结论不可复现">
          as_of {payload?.asOf || '—'} · window {params.window} · min_corr {params.minCorr} · pool {params.poolN}
        </span>
        <button
          type="button"
          onClick={() => void load()}
          disabled={busy}
          className="dc-cc-act"
          title="重新取数（参数按校准推荐值；换 as_of 或参数会触发引擎重建，约数秒）"
        >
          <RefreshCw size={11} className={busy ? 'animate-spin' : ''} />
          刷新
        </button>
      </div>

      {err !== '' && <div className="dc-cc-note is-warn">取数失败：{err}</div>}

      {namingRouteMissing && (
        <div className="dc-cc-note is-warn">
          命名桥接未注册（GET /api/stock-panel/naming 不可达）：host 半是<b>进程内加载</b>的，
          请重启 dsh web。共动聚类、结构标签（官方行业口径）与强度/涨幅/涨停数照常可看，只是没有模型主题名。
        </div>
      )}

      {payload !== null && !payload.ok && (
        <div className="dc-cc-note is-warn">
          引擎当前不可用：{payload.notes.join('；') || '未知原因'}
          <div style={{ marginTop: 2 }}>
            常见原因：非交易日 / 成交额榜快照未就绪（可用池不足）。冷启动首次拉数百只 K 线约需数秒，之后走缓存。
          </div>
        </div>
      )}

      {payload?.ok === true && (
        <>
          {/* 汇总条：可采信几个班 / 排除了几个（按原因）/ 孤立几只 / 这一轮花了多少预算 */}
          {/* 汇总条：stats（左，吃剩余宽）+ 预算/动作（右）+ 诊断（独占第二行） */}
          <div className="dc-cc-summary">
            <div className="dc-cc-stats">
              <span>
                可采信类 <b>{rows.length}</b> 个
              </span>
              <span>
                孤立票 <b>{payload.isolatedN}</b> 只
              </span>
              {droppedN > 0 && (
                <span
                  title={filter.dropped
                    .map((d) => `#${d.row.classId}（${d.row.size} 只）：${d.quality.note}`)
                    .join('\n')}
                >
                  已排除 <b>{droppedN}</b> 个（
                  {[
                    filter.byReason.chain_suspect > 0
                      ? `${qualityReasonLabel('chain_suspect')} ${filter.byReason.chain_suspect}`
                      : '',
                    filter.byReason.weak_chain > 0 ? `${qualityReasonLabel('weak_chain')} ${filter.byReason.weak_chain}` : '',
                  ]
                    .filter((s) => s !== '')
                    .join(' · ')}
                  ）
                </span>
              )}
            </div>
            <div className="dc-cc-summary-tail">
              <span>
                <Sparkles size={11} style={{ color: 'var(--dc-accent)', display: 'inline' }} className={batchBusy ? 'animate-pulse' : ''} />
                {namingRouteMissing ? (
                  <span>模型主题名不可用（命名桥接未注册）</span>
                ) : avail?.available === false ? (
                  <span style={{ color: 'var(--dc-warn)' }}>模型不可用：{avail.reason ?? '未知原因'}</span>
                ) : batchBusy ? (
                  <span>模型正在命名归类…（一次采集 + 少量分批调用，通常几秒到一分钟）</span>
                ) : batchErr !== '' ? (
                  <span style={{ color: 'var(--dc-warn)' }}>批量命名未完成：{batchErr}</span>
                ) : batch !== null ? (
                  <span title="「可读标签」= 模型主题名 或 官方结构标签能顶上；两个都没有才是真的没名字">
                    可读标签 <b>{naming.labelled}</b>/{rows.length} 组 · 模型主题 <b>{naming.named}</b>
                  </span>
                ) : (
                  <span>等待模型命名…（结构标签已可用）</span>
                )}
              </span>
              {batch !== null && naming.nameless > 0 && (
                <span title={[...naming.byReason.entries()].map(([k, n]) => `${n} 组：${degradedLabel(k)}`).join('；')}>
                  {/* 长句子**不**用琥珀色：11px 的琥珀字在宿主亮色下实测 3.74:1（不到 AA）。
                      警示语义改由"数字加粗 + title 里的逐条成因"承担，颜色只留给真正的故障。 */}
                  {`${naming.nameless} 组无模型主题名：${naming.topReasons.join(' · ')}`}
                  {naming.failed > 0 ? `（采集失败 ${naming.failed} 组）` : ''}
                </span>
              )}
              {batch !== null && (
                <span title="本次真的发起的模型调用次数（0 = 全部命中缓存/memo）">
                  调用 <b>{batch.llmCalls}</b> 次
                  {batch.memoHit ? ' · 复用上一轮' : ` · 缓存命中 ${naming.cached} 组`}
                </span>
              )}
              {avail?.model !== undefined && (
                <span className="dc-cc-chip-param" title={`模型 ${avail.provider ?? '?'}/${avail.model}`}>
                  {avail.model}
                </span>
              )}
              <button
                type="button"
                disabled={batchBusy || namingRouteMissing || avail?.available === false || rows.length === 0}
                onClick={() => void doBatch(true)}
                title="忽略缓存重新命名全部（会真的再调模型；只想看某组为什么这么叫时用单组「重命名」）"
                className="dc-cc-act"
              >
                <Sparkles size={10} />
                {batchBusy ? '命名中…' : '重新命名全部'}
              </button>
            </div>
          </div>

          <div className="dc-cc-list">
            {rows.length === 0 && (
              <div className="dc-cc-note">
                当前参数下没有可采信的共动类（全部被判定为弱链或传递链可疑）。可放宽 min_corr 再看，但校准结论是
                0.6 才切得出语义自洽的小类 —— 放宽会换来"巨类噪声"。
              </div>
            )}
            {rows.map((c, i) => {
              const outcome = outcomeOf(c.classId)
              const structure = structureOfClass(c.classId)
              const name = rowNameOf(outcome, structure)
              const entry = entryOf(c.classId)
              const open = expanded[c.classId] === true
              const allMembers = membersOpen[c.classId] === true
              // 成员按当日涨幅降序：龙头在最前面（host 侧只保证了类内顺序，那是结构顺序）
              const members = [...c.members].sort((a, b) => (b.chgPct ?? -999) - (a.chgPct ?? -999))
              const shown = allMembers ? members : members.slice(0, MEMBERS_VISIBLE)
              const restN = members.length - shown.length
              const barPct = barPctOf(c.strength)
              /**
               * 强度色与**显示出来的**数值同源（都走 toFixed(1) 后的值）。
               *
               * 为什么不让颜色看原值：实测有一行原值 +0.04、显示「0.0」，颜色却是红的 ——
               * 数字中性、颜色为正，同一行自相矛盾（读的人会以为自己看错）。
               * 精度是展示层的事，那就让展示层的两个出口（数字与颜色）用同一个数。
               */
              const strengthShown = Number(c.strength.toFixed(1))
              const tone = strengthShown > 0 ? 'var(--dc-up)' : strengthShown < 0 ? 'var(--dc-down)' : 'var(--dc-dim)'
              const named = outcome !== null && outcome.ok && outcome.result.verdict === 'named'
              return (
                <article
                  key={c.classId}
                  className={`dc-cc-card${c.limitUpN > 0 ? ' is-limit' : ''}`}
                  data-testid={`concept-class-${c.classId}`}
                >
                  {/* 左：强度（数值与排名同行 + 条）。
                      数值用**中性主文本色**而不是红/绿：14px 红字在暗色卡面上实测只有 3.97:1
                      （不到 AA），而且 8 行一片红会让"零分"和"涨停"一样刺眼 ——
                      方向交给下面那条 3px 的彩色条去表达，数值只负责"多大"。 */}
                  <div className="dc-cc-rank" title={`${formula}\n排序 #${i + 1}（强度降序）· 自挖类 class ${c.classId}`}>
                    <span className="dc-cc-rankline">
                      <span className="dc-cc-strength">{strengthShown.toFixed(1)}</span>
                      <span className="dc-cc-rankno">#{i + 1}</span>
                    </span>
                    <span className="dc-cc-bar" style={{ color: tone }} title={`强度 ${strengthShown.toFixed(1)}｜条长 = |强度| ÷ 列表内最大 |强度|`}>
                      <i style={{ width: `${barPct}%` }} />
                    </span>
                  </div>

                  {/* 中：名称（+来源）/ 当日强弱 / 结构指标 / 成员 */}
                  <div className="dc-cc-main">
                    <div className="dc-cc-names">
                      <span
                        className={`dc-cc-name${name.kind === 'none' ? ' is-none' : ''}`}
                        title={name.title}
                      >
                        {name.text}
                      </span>
                      {/* 来源标签只在这个名字**真的有来源**时才出现：
                          名字已经是「未命名」时再挂一个写着「未命名」的来源胶囊 = 同一个词说两遍
                          （实测第一版就是这样，行首读起来是"未命名 未命名"）。 */}
                      {name.kind !== 'none' && (
                        <span className={`dc-cc-src${name.kind === 'model' ? ' is-model' : ''}`} title={name.title}>
                          {name.srcLabel}
                        </span>
                      )}
                      {/* 结构标签被顶上来当主名时，把它自己的覆盖度显示出来 ——
                          一个 3/7 的标签是"部分成员的共性"，不标会被当成全类属性 */}
                      {name.kind !== 'model' && structure !== null && structure.label !== '' && (
                        <span className="dc-cc-cover" title={structure.note}>
                          {structure.covered}/{structure.total} 只
                        </span>
                      )}
                      {/* 有模型主题名时，结构标签**仍然要显示**（只是退到副位）：
                          "它为什么动"与"它像什么"是两个答案，同时看到才知道该信哪一个
                          （也才能在两者矛盾时一眼发现 —— 那正是需要人去判断的地方）。 */}
                      {name.kind === 'model' && structure !== null && structure.label !== '' && (
                        <span className="dc-cc-src" title={structure.note}>
                          官方{structure.basis === 'concept' ? '概念' : '行业'} {structureLine(structure)}
                        </span>
                      )}
                      {/* 模型没命名时，把模型的三态结论如实挂在旁边（不让结构标签冒充模型结论） */}
                      {!named && outcome !== null && outcome.ok && (
                        <span className="dc-cc-src" title={outcome.result.causeNote || '模型没有给出共同主题'}>
                          模型：{verdictLabel(outcome.result.verdict)}
                        </span>
                      )}
                      {named && outcome.ok && outcome.result.alternatives.length > 0 && (
                        <span className="dc-cc-alts" title={`备选：${outcome.result.alternatives.join('、')}`}>
                          备选 {outcome.result.alternatives.slice(0, 3).join('、')}
                        </span>
                      )}
                    </div>

                    <div className="dc-cc-metrics">
                      {/* 涨停放第一个并且是唯一带强调底的指标：它是"这个班猛不猛"最该一眼看到的数
                          （收口前它和"规模""命名走缓存"同字号同颜色，埋在 8 项一串里）。 */}
                      <span
                        className={`dc-cc-metric is-hot${c.limitUpN > 0 ? ' is-on' : ''}`}
                        title="当日收盘触及涨停价的成员只数（buy_price_limit 精确判定，各板幅度不同）"
                      >
                        <span>涨停</span>
                        <b className={c.limitUpN > 0 ? 'dc-up' : ''}>{c.limitUpN}</b>
                      </span>
                      <span className="dc-cc-metric" title="成员当日涨跌幅的均值（缺失值不计入）">
                        <span>均涨</span>
                        <b className={pctTone(c.chgMean)}>{pctText(c.chgMean)}</b>
                      </span>
                      <span className="dc-cc-metric" title="成员当日最大涨幅（这个班的龙头跑了多少）">
                        <span>最大</span>
                        <b className={pctTone(c.chgMax)}>{pctText(c.chgMax)}</b>
                      </span>
                      <span className="dc-cc-metric" title="上涨只数（含涨停）/ 有当日行情的成员只数">
                        <span>上涨</span>
                        <b>
                          {c.upN}/{c.knownN}
                        </b>
                      </span>
                      {structMetrics(c).map((m) => (
                        <span key={m.label} className="dc-cc-metric is-struct" title={m.title}>
                          <span>{m.label}</span>
                          <b>{m.value}</b>
                        </span>
                      ))}
                      {c.knownN < c.size && (
                        <span className="dc-cc-metric is-struct" title="部分成员没有当日行情（停牌/无数据）——没有被当成 0 平盘">
                          <span style={{ color: 'var(--dc-warn)' }}>仅 {c.knownN}/{c.size} 只有行情</span>
                        </span>
                      )}
                    </div>

                    <div
                      className="dc-cc-members"
                      style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(19ch, 1fr))' }}
                    >
                      {members.length === 0 && <span className="dc-cc-chip">{c.top.join('、') || '（无成员）'}</span>}
                      {shown.map((m) => (
                        <button
                          key={`${m.market}${m.code}`}
                          type="button"
                          onClick={() => onOpenStock?.(m.market as MarketTag, m.code, m.name)}
                          title={`${m.code} ${m.name}｜当日 ${pctText(m.chgPct)}${m.limitUp ? '｜涨停' : ''}${
                            m.corr !== null ? `｜与类内平均相关 ${m.corr}` : ''
                          }（点击看这只票）`}
                          className={`dc-cc-chip${m.limitUp ? ' is-limit' : ''}`}
                        >
                          <span>
                            {m.name}
                            {m.limitUp && <span style={{ marginLeft: 3, fontSize: 11 }}>板</span>}
                          </span>
                          <em className={pctTone(m.chgPct)}>{pctText(m.chgPct)}</em>
                        </button>
                      ))}
                      {restN > 0 && (
                        <button
                          type="button"
                          className="dc-cc-more"
                          onClick={() => setMembersOpen((prev) => ({ ...prev, [c.classId]: true }))}
                          title={`展开这个班其余的 ${restN} 只成员`}
                        >
                          +{restN} 只
                        </button>
                      )}
                      {allMembers && members.length > MEMBERS_VISIBLE && (
                        <button
                          type="button"
                          className="dc-cc-more"
                          onClick={() => setMembersOpen((prev) => ({ ...prev, [c.classId]: false }))}
                          title="收起成员"
                        >
                          收起
                        </button>
                      )}
                    </div>
                  </div>

                  {/* 右：动作（次要动作，但看得出可点）+ 流水线状态（它不是"指标"） */}
                  <div className="dc-cc-actions">
                    <button
                      type="button"
                      onClick={() => setExpanded((prev) => ({ ...prev, [c.classId]: !open }))}
                      title={open ? '收起模型结论与逐条证据' : '展开模型结论与逐条证据（引文逐字可反查）'}
                      className="dc-cc-act"
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
                      className={`dc-cc-act${namingId === c.classId ? ' is-busy' : ''}`}
                    >
                      {namingId === c.classId ? (
                        '命名中…'
                      ) : (
                        <>
                          <Sparkles size={10} />
                          重命名
                        </>
                      )}
                    </button>
                    {entry?.cached === true && (
                      <span className="dc-cc-pipe" title="这一组的模型结论命中缓存（没有发生新的模型调用）">
                        命名走缓存
                      </span>
                    )}
                  </div>

                  {open && outcome !== null && (
                    <div className="dc-cc-note">
                      <NamingResultPanel
                        outcome={outcome}
                        structure={structure}
                        refreshing={namingId === c.classId}
                        onRefresh={() => void doNaming(c.classId, true)}
                      />
                    </div>
                  )}
                  {open && outcome === null && (
                    <div className="dc-cc-note">
                      这一组还没有模型结论
                      {entry?.skipReason === 'weak_chain'
                        ? '（弱链伪类：不采信、也不命名 —— 引擎标记）'
                        : entry?.skipReason === 'pseudo_class'
                          ? '（传递链可疑：不采信、也不命名 —— 本地判据，见类内相关与强边密度）'
                          : entry?.skipReason === 'over_cap'
                            ? '（超出本轮命名上限：先命名最强的几组，可手动「重命名」这一组）'
                            : batchBusy
                              ? '（模型正在命名…）'
                              : '（点「重命名」让模型单独看这一组）'}
                    </div>
                  )}
                </article>
              )
            })}
          </div>

          {isoList.length > 0 && (
            <div className="dc-cc-iso">
              <div className="dc-cc-iso-head">
                <span>池内却孤立的票（强势但不跟人共动 —— 独狼，不是班）</span>
                {/* 引擎只回"孤立票前几名"，而孤立票总数远大于它（实测 5 vs 113）——
                    必须把两个数都写出来，否则"5 只"会被当成"今天只有 5 只孤立票"。 */}
                <span className="dc-cc-cover" title="引擎只回传孤立票的前几名；总数见左侧">
                  显示 {isoList.length}/{payload.isolatedN}
                </span>
              </div>
              <div className="dc-cc-iso-grid" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(10ch, 1fr))' }}>
                {isoShown.map((s) => (
                  <button
                    key={s.market + s.code}
                    type="button"
                    onClick={() => onOpenStock?.(s.market as MarketTag, s.code, s.name)}
                    title={`${s.code} ${s.name}${s.chgPct !== null ? `｜当日 ${s.chgPct.toFixed(2)}%` : ''}${s.limitUp ? '｜涨停' : ''}`}
                    className={`dc-cc-chip${s.limitUp ? ' is-limit' : ''}`}
                  >
                    <span>{s.name}</span>
                    <em className={pctTone(s.chgPct)}>{pctText(s.chgPct)}</em>
                  </button>
                ))}
                {!isoOpen && isoList.length > ISOLATED_VISIBLE && (
                  <button type="button" className="dc-cc-more" onClick={() => setIsoOpen(true)}>
                    +{isoList.length - ISOLATED_VISIBLE} 只
                  </button>
                )}
                {isoOpen && isoList.length > ISOLATED_VISIBLE && (
                  <button type="button" className="dc-cc-more" onClick={() => setIsoOpen(false)}>
                    收起
                  </button>
                )}
              </div>
            </div>
          )}

          {/* 口径：默认折叠（它必须写清楚，但不该占掉一屏的正文字号位置） */}
          <details className="dc-cc-foot">
            <summary>口径与边界（强度公式 / 涨停判定 / 两种名称的来源 / 排除规则）</summary>
            <div style={{ marginTop: 4 }}>
              <div title={formula}>
                <b>强度</b> = 均涨幅% + 6×涨停数，按强度降序（并列看强边密度 → 类内相关 → 规模）；
                左侧的条长只是**当前列表内**的相对强弱，排序永远按数值。
              </div>
              <div>
                <b>涨停</b>由「收盘价触及涨停价」判定（`buy_price_limit`，各板幅度不同所以不用 9.8% 阈值法；
                无涨跌幅限制的新股不计入）。
              </div>
              <div>
                <b>名称有两条腿</b>：<span className="dc-cc-src">模型主题</span>是模型归纳 + 逐条引文护栏的产物
                （护栏拒了就如实降级，不留半个名字）；<span className="dc-cc-src">官方行业 / 官方概念</span>是
                「结构标签」—— 把成员所属的厂商板块里被 ≥2 只成员共享的词数出来（确定性、不经模型、任何 as_of 都成立）。
                后者只回答"这个班**像**什么"，不回答"为什么一起动"。
              </div>
              <div>
                这是**无监督共动聚类**（K 线残差相关 → 阈值图连通分量）挖出的类，与官方概念/行业是两回事。
                被排除的类分两种：{qualityReasonLabel('weak_chain')}（引擎标记）与 {qualityReasonLabel('chain_suspect')}
                （类内平均相关低于切边阈值且强边密度 &lt; 0.5 —— 阈值图把一串弱连接传成了"一个班"）；两者都不展示、不命名，
                但会计数（记录而不丢弃）。
              </div>
            </div>
          </details>
        </>
      )}
    </div>
  )
}
