/**
 * src/components/ConceptClassesCard.tsx —— 「自挖板块」类列表（A2b 次要视角，放在工具单页）。
 *
 * 为什么是次要视角：校准（`docs/CONCEPT-CALIBRATION.md`）显示推荐参数下全 A 只有 10 个类、
 * 其中 9 个非弱链类、**155 只孤立** —— 类列表信息量薄，主视角必须是个股。
 * 但类列表有一个别处没有的价值：**能看见被排除的东西**。
 *   · 弱链伪类（类内相关远低于阈值）被过滤，但要显示"排除了几个、为什么"；
 *   · 成交额榜内却孤立的强势票也列出来 —— 那说明它今天是"独狼"，不是"班"。
 * 参考实现（cluster-namer）也是这个立场：`ExcludedClass` 记录而不丢弃，
 * 否则用户会以为引擎只挖到这么几个板块。
 *
 * 参数必须显示（as_of + window / min_corr / pool_n）：同票不同参数所属类不同，不标 = 不可复现。
 */
import { useCallback, useEffect, useState } from 'react'
import { RefreshCw, Sparkles } from 'lucide-react'
import { fetchNamingAvailability, requestNaming, type NamingOutcome, type NamingParams, NAMING_PARAMS_FALLBACK } from '@/lib/naming'
import { callToolJson } from '@/lib/stock-data'
import { NamingResultPanel } from './NamingResultPanel'
import type { MarketTag } from '@/lib/symbol'

interface ClassRow {
  classId: number
  size: number
  intraCorr: number
  strongDensity: number
  weakChain: boolean
  top: string[]
}

interface ClassesPayload {
  ok: boolean
  asOf: string
  classes: ClassRow[]
  isolatedN: number
  isolatedTop: Array<{ market: string; code: string; name: string; chgPct: number | null }>
  notes: string[]
  params: NamingParams
}

interface Props {
  onOpenStock?: ((market: MarketTag, code: string, name: string) => void) | undefined
}

function num(v: unknown): number | undefined {
  const n = Number(v)
  return Number.isFinite(n) ? n : undefined
}

/** 拉类列表（原始工具调用 + 归一；失败不抛，返回 ok:false + 原因）。 */
async function loadClasses(params: NamingParams): Promise<ClassesPayload> {
  const raw = (await callToolJson('hist_concept_classes', {
    window: params.window,
    min_corr: params.minCorr,
    pool_n: params.poolN,
    top_members: 5,
  })) as Record<string, unknown> | null
  if (raw === null || raw.ok === false) {
    return {
      ok: false,
      asOf: String((raw as { as_of?: unknown } | null)?.as_of ?? ''),
      classes: [],
      isolatedN: 0,
      isolatedTop: [],
      notes: [String((raw as { error?: unknown } | null)?.error ?? '引擎未返回结果')],
      params,
    }
  }
  const classes: ClassRow[] = []
  for (const c of (Array.isArray(raw.classes) ? raw.classes : []) as Array<Record<string, unknown>>) {
    classes.push({
      classId: Number(c.class_id),
      size: num(c.size) ?? 0,
      intraCorr: num(c.mean_intra_corr) ?? 0,
      strongDensity: num(c.strong_density) ?? 0,
      weakChain: Boolean(c.weak_chain),
      top: (Array.isArray(c.top) ? c.top : []).map((t) => String(t)),
    })
  }
  const isolatedTop: ClassesPayload['isolatedTop'] = []
  for (const s of (Array.isArray(raw.isolated_top) ? raw.isolated_top : []) as Array<Record<string, unknown>>) {
    isolatedTop.push({
      market: String(s.market ?? '').toUpperCase(),
      code: String(s.code ?? ''),
      name: String(s.name ?? ''),
      chgPct: num(s.chg_pct) ?? null,
    })
  }
  const meta = (raw.meta ?? {}) as Record<string, unknown>
  return {
    ok: true,
    asOf: String(raw.as_of ?? meta.as_of ?? ''),
    classes,
    isolatedN: num(raw.isolated_n) ?? 0,
    isolatedTop,
    notes: [],
    params,
  }
}

export function ConceptClassesCard({ onOpenStock }: Props) {
  const [payload, setPayload] = useState<ClassesPayload | null>(null)
  const [params, setParams] = useState<NamingParams>(NAMING_PARAMS_FALLBACK)
  const [avail, setAvail] = useState<{ available: boolean; reason?: string; provider?: string; model?: string } | null>(null)
  const [outcome, setOutcome] = useState<{ classId: number; data: NamingOutcome } | null>(null)
  const [busy, setBusy] = useState(false)
  const [namingId, setNamingId] = useState<number | null>(null)
  const [err, setErr] = useState('')

  const load = useCallback(async () => {
    setBusy(true)
    setErr('')
    try {
      const info = await fetchNamingAvailability().catch(() => null)
      setAvail(info)
      const p = info?.defaults ?? NAMING_PARAMS_FALLBACK
      setParams(p)
      setPayload(await loadClasses(p))
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

  const doNaming = useCallback(
    async (classId: number, refresh: boolean) => {
      setNamingId(classId)
      setErr('')
      try {
        const data = await requestNaming({ classId, asOf: payload?.asOf, params, refresh })
        setOutcome({ classId, data })
      } catch (e) {
        setErr((e as Error).message || '命名失败')
      } finally {
        setNamingId(null)
      }
    },
    [payload, params],
  )

  const usable = (payload?.classes ?? []).filter((c) => !c.weakChain)
  const excluded = (payload?.classes ?? []).filter((c) => c.weakChain)

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-1.5 text-[10px] text-slate-500">
        <span className="font-medium text-slate-600">市场今天把哪些票当成同一个班</span>
        {payload?.asOf && <span className="rounded bg-slate-100 px-1 font-mono text-[9px]">as_of {payload.asOf}</span>}
        <span className="rounded bg-slate-100 px-1 font-mono text-[9px]">
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

      {err !== '' && <div className="rounded bg-red-50 px-2 py-1 text-[11px] text-red-500">{err}</div>}

      {payload !== null && !payload.ok && (
        <div className="rounded border border-amber-100 bg-amber-50 px-2 py-1.5 text-[11px] text-amber-700">
          引擎当前不可用：{payload.notes.join('；') || '未知原因'}
          <div className="mt-0.5 text-[10px] text-amber-600">
            常见原因：非交易日 / 成交额榜快照未就绪（可用池不足）。冷启动首次拉数百只 K 线约需数秒，之后走缓存。
          </div>
        </div>
      )}

      {payload?.ok === true && (
        <>
          <div className="flex flex-wrap items-center gap-2 text-[10px] text-slate-400">
            <span>可用类 <span className="font-medium text-slate-600">{usable.length}</span> 个</span>
            <span>
              孤立票 <span className="font-medium text-slate-600">{payload.isolatedN}</span> 只（今天没有稳定的同伴）
            </span>
            {excluded.length > 0 && (
              <span title="类内相关远低于阈值 → 阈值图连通分量的传递链伪类，不采信也不命名">
                已过滤弱链伪类 {excluded.length} 个
              </span>
            )}
          </div>

          <div className="space-y-1">
            {usable.length === 0 && (
              <div className="rounded border border-slate-100 bg-slate-50 px-2 py-1.5 text-[11px] text-slate-500">
                当前参数下没有可采信的共动类（全部被判定为弱链或不足）。可放宽 min_corr 再看，但校准结论是
                0.6 才切得出语义自洽的小类 —— 放宽会换来"巨类噪声"。
              </div>
            )}
            {usable.map((c) => (
              <div key={c.classId} className="rounded border border-slate-100 bg-white px-2 py-1">
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="font-mono text-[10px] text-slate-400">#{c.classId}</span>
                  <span className="text-[11px] text-slate-600">{c.size} 只</span>
                  <span className="text-[10px] text-slate-400">
                    类内相关 <span className="font-mono text-slate-600">{c.intraCorr.toFixed(3)}</span>
                  </span>
                  <span className="text-[10px] text-slate-400">
                    强边密度 <span className="font-mono text-slate-600">{c.strongDensity.toFixed(2)}</span>
                  </span>
                  <button
                    type="button"
                    disabled={namingId !== null || avail?.available === false}
                    onClick={() => void doNaming(c.classId, outcome?.classId === c.classId)}
                    title={
                      avail?.available === false
                        ? `模型不可用：${avail.reason ?? '未知'}`
                        : '让模型根据成员票的当日素材归纳共同主题（护栏逐条核对引文）'
                    }
                    className="dc-btn dc-btn--accent dc-btn--icon ml-auto flex items-center gap-0.5 px-1.5 py-0.5 text-[10px] disabled:opacity-40"
                  >
                    <Sparkles size={10} />
                    {namingId === c.classId ? '命名中…' : '命名'}
                  </button>
                </div>
                <div className="mt-0.5 flex flex-wrap gap-1">
                  {c.top.map((n, i) => (
                    <span key={`${n}-${i}`} className="rounded bg-slate-50 px-1 py-px text-[10px] text-slate-500">
                      {n}
                    </span>
                  ))}
                </div>
                {outcome?.classId === c.classId && (
                  <NamingResultPanel
                    outcome={outcome.data}
                    refreshing={namingId === c.classId}
                    onRefresh={() => void doNaming(c.classId, true)}
                  />
                )}
              </div>
            ))}
          </div>

          {payload.isolatedTop.length > 0 && (
            <div className="rounded border border-slate-100 bg-slate-50/60 px-2 py-1.5">
              <div className="text-[10px] text-slate-500">
                池内却孤立的票（强势但不跟人共动 —— 独狼，不是班）
              </div>
              <div className="mt-0.5 flex flex-wrap gap-1">
                {payload.isolatedTop.map((s) => (
                  <button
                    key={s.market + s.code}
                    type="button"
                    onClick={() => onOpenStock?.(s.market as MarketTag, s.code, s.name)}
                    title={`${s.code} ${s.name}${s.chgPct !== null ? `｜当日 ${s.chgPct.toFixed(2)}%` : ''}`}
                    className="rounded border border-slate-200 bg-white px-1 py-px text-[10px] text-slate-500 hover:border-slate-400"
                  >
                    {s.name}
                    {s.chgPct !== null && (
                      <span className={`ml-1 font-mono ${s.chgPct >= 0 ? 'text-red-500' : 'text-emerald-600'}`}>
                        {s.chgPct >= 0 ? '+' : ''}
                        {s.chgPct.toFixed(1)}%
                      </span>
                    )}
                  </button>
                ))}
              </div>
            </div>
          )}

          <div className="text-[10px] leading-relaxed text-slate-400">
            口径说明：这是**无监督共动聚类**（K 线残差相关 → 阈值图连通分量）挖出的类，
            与官方概念/行业是两回事；<span className="text-slate-500">弱链类（类内相关远低于阈值）已过滤且不参与命名</span>。
            引擎无 scipy 时走阈值图，必然出现"传递链"巨类 —— 这正是必须过滤的原因。
          </div>
        </>
      )}
    </div>
  )
}
