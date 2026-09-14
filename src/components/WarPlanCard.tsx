/**
 * src/components/WarPlanCard.tsx —— 「作战思路」卡（v1.6 作战板块的**主产物**）。
 *
 * ## 这一版换掉了什么
 *
 * 旧作战页是"数据摊开 + 你自己点选"：Q1 三个按钮、Q2 六个按钮、Q3 逐只持仓四个按钮、
 * 竞价逐条判定 —— 决策劳动全在用户身上。新版第一屏就是**模型读完其他板块给的作战思路**：
 * 主攻方向 → 候选票（含触发/失败条件）→ 三问落点 → 持仓动作 → 竞价判定；
 * 用户的角色变成**采纳 / 修改 / 驳回**（下方 Q 卡仍保留，就是那个"改"的入口）。
 *
 * ## 三条必须显示出来的东西（否则这张卡就是在替模型吹牛）
 *
 *   1. **素材**：这次思路基于什么 —— 缺口（哪一块没取到数）与白名单规模
 *      （"可点名的票 N 只 / 可用方向 M 个"）；
 *   2. **护栏痕迹**：被剔除的越界点名、引文可反查比例（`lib/war-plan-guard.ts`）；
 *   3. **采纳痕迹**：哪些写进了当日记录、哪些因为"你已经有答案"而原样保留。
 *
 * 缺任何一条，用户就没法判断"这句话是模型读出来的还是编的" —— 那正是本次要消灭的东西。
 */
import { Check, RefreshCw, Sparkles, Star, ExternalLink, Undo2, AlertTriangle } from 'lucide-react'
import type { AiAvailability } from '@/lib/ai'
import type { WarPlan } from '@/lib/ai-contract'
import type { AdoptionResult, WarPlanRecord } from '@/lib/war-plan'
import { planFreshness, WAR_PLAN_TTL_MS } from '@/lib/war-plan'
import { verdictLabel, verdictColor } from '@/lib/auction-analysis'
import { situationShortLabel } from '@/lib/situation'
import { watchAddSymbol } from '@/lib/watchlist-store'
import { AiRankList, type AiRankRow } from './AiRankList'
import { StateView, classifyStateError } from './StateView'
import type { OpenStock } from '@/panel/PanelApp'
import type { MarketTag } from '@/lib/symbol'

interface Props {
  /** 本时段的思路存档（null = 还没生成过）。 */
  record: WarPlanRecord | null
  busy: boolean
  /** 失败原因（含"宿主没挂模型"）。 */
  error?: string | undefined
  availability: AiAvailability | null
  /** 自动生成判定说明（"已有时段内的思路" / "没有素材不自动生成"）。 */
  autoWhy: string
  /** 采纳写回痕迹。 */
  adoption: AdoptionResult | null
  /** 素材缺口（与进 prompt 的是同一份）。 */
  missing: string[]
  /** 符号 → 名称（模型只给符号，名称要回查素材）。 */
  nameOf: (symbol: string) => string | undefined
  /** 是否已在自选。 */
  inWatchlist: (symbol: string) => boolean
  onRegenerate: () => void
  /** 驳回：清掉模型写进当日记录的那部分答案。 */
  onReject: () => void
  onOpenStock: (s: OpenStock) => void
}

const STANCE_LABEL: Record<WarPlan['stance'], string> = { attack: '进攻', defend: '防守', wait: '观望' }

/** 方向来源标签（与自挖板块页一样：**来源必须可分辨**）。 */
const SOURCE_LABEL: Record<string, string> = {
  concept: '自挖类',
  board: '板块榜',
  ladder: '梯队',
  watch: '自选',
  position: '持仓',
}

function hm(ts: number): string {
  const d = new Date(ts)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

/** 符号 → OpenStock（世界知识只有一处：SH/SZ/BJ 前缀）。 */
function asOpenStock(symbol: string, name: string | undefined): OpenStock {
  return { market: symbol.slice(0, 2) as MarketTag, code: symbol.slice(2), name: name ?? symbol }
}

export function WarPlanCard(props: Props) {
  const { record, busy } = props
  const plan = record?.plan ?? null
  const now = Date.now()
  const stale = record !== null && planFreshness(record, now) === 'stale'
  const unavailable = props.availability !== null && !props.availability.available

  const sectorRows: AiRankRow[] = (plan?.sectors ?? []).map((s, i) => ({
    key: `s${i}-${s.name}`,
    rank: i + 1,
    title: s.name,
    subtitle: SOURCE_LABEL[s.source] ?? s.source,
    score: s.score,
    reason: s.why === '' ? '（模型没给依据）' : s.why,
    extra:
      s.members.length === 0 ? (
        <span>未点名成员</span>
      ) : (
        s.members.map((sym) => (
          <button
            key={sym}
            type="button"
            className="dc-chip"
            title={`打开 ${props.nameOf(sym) ?? sym}`}
            onClick={() => props.onOpenStock(asOpenStock(sym, props.nameOf(sym)))}
          >
            {props.nameOf(sym) ?? sym}
          </button>
        ))
      ),
  }))

  const pickRows: AiRankRow[] = (plan?.picks ?? []).map((p, i) => ({
    key: `p${i}-${p.symbol}`,
    rank: i + 1,
    title: p.name ?? props.nameOf(p.symbol) ?? p.symbol,
    subtitle: p.symbol,
    note: p.role,
    score: p.score,
    reason: p.reason,
    extra: (
      <>
        <span title="触发条件：什么情况下才动手">{p.trigger === '' ? '触发条件 未给' : `触发 ${p.trigger}`}</span>
        <span title="失败条件：什么情况下认错离场">{p.stop === '' ? '失败条件 未给' : `失败 ${p.stop}`}</span>
      </>
    ),
    actions: (
      <>
        <button
          type="button"
          className="dc-btn dc-btn--accent dc-btn--icon"
          title="打开（切到盯盘工作台）"
          onClick={() => props.onOpenStock(asOpenStock(p.symbol, p.name ?? props.nameOf(p.symbol)))}
        >
          <ExternalLink size={11} />
        </button>
        <button
          type="button"
          className="dc-btn dc-btn--icon"
          title={props.inWatchlist(p.symbol) ? '已在自选' : '加入自选'}
          disabled={props.inWatchlist(p.symbol)}
          onClick={() => watchAddSymbol(p.symbol, p.name ?? props.nameOf(p.symbol))}
        >
          <Star size={11} />
        </button>
      </>
    ),
  }))

  const guard = plan?.guard
  const droppedN = (guard?.droppedSymbols.length ?? 0) + (guard?.droppedSectors.length ?? 0)

  /**
   * 落点行（Q1 / Q2 / 逐只持仓动作 / 逐条竞价判定）。
   *
   * 四类落点合成一份数据再渲染：它们的版式完全一样（标签 + 值 + 依据），
   * 各写一遍 JSX 就是四份会各自漂的重复（改一处忘了另外三处）。
   */
  const drops: Array<{ key: string; tag: string; value: string; why: string; color?: string }> = []
  if (plan !== null && !plan.insufficient) {
    if (plan.q1 !== null) drops.push({ key: 'q1', tag: 'Q1 持续性', value: q1Text(plan.q1.value), why: plan.q1.why })
    if (plan.q2 !== null) drops.push({ key: 'q2', tag: 'Q2 局势', value: situationShortLabel(plan.q2.value), why: plan.q2.why })
    for (const a of plan.actions) {
      drops.push({ key: `a-${a.symbol}`, tag: `Q3 ${props.nameOf(a.symbol) ?? a.symbol}`, value: q3Text(a.action), why: a.why })
    }
    for (const v of plan.verdicts) {
      drops.push({
        key: `v-${v.symbol}`,
        tag: `竞价 ${props.nameOf(v.symbol) ?? v.symbol}`,
        value: verdictLabel(v.verdict),
        why: v.why,
        color: verdictColor(v.verdict),
      })
    }
  }

  return (
    /* `dc-war-plan*` 是给真机探针用的**结构锚点**（acceptance/probe-war-plan.mjs 要靠它取数）：
       Tailwind 的工具类里没有稳定的语义钩子，探针只能靠这些标记定位卡片各段。 */
    <div className="dc-war-plan mb-1.5 rounded-md border border-emerald-100 bg-white px-2 py-1.5">
      {/* ── 头：这份思路是什么、什么时候算的、怎么重来 ── */}
      <div className="dc-war-plan-head mb-1 flex flex-wrap items-center gap-1.5">
        <span className="flex items-center gap-1 dc-t-data font-semibold text-slate-600">
          <Sparkles className="h-3 w-3 text-emerald-500" />
          作战思路（模型）
        </span>
        {plan !== null && !plan.insufficient && (
          <span className="dc-tag" title="模型的全局姿态">
            {STANCE_LABEL[plan.stance]}
          </span>
        )}
        {record !== null && (
          <span className="dc-t-micro text-slate-400" title={record.stageLabel}>
            {hm(record.at)} 生成 · {record.stageLabel}
            {stale ? ` · 已超过 ${Math.round(WAR_PLAN_TTL_MS / 60000)} 分钟，建议重算` : ''}
          </span>
        )}
        {record !== null && (
          <span className="dc-t-micro text-slate-300" title={`模型 ${record.provider}/${record.model} · 上下文 ${(record.ctxBytes / 1024).toFixed(1)}KB`}>
            {record.model} · {(record.ms / 1000).toFixed(1)}s
          </span>
        )}
        <span className="flex-1" />
        {props.adoption !== null && props.adoption.written.length > 0 && (
          <button
            type="button"
            className="dc-btn dc-btn--ghost"
            title="清掉模型写进当日记录的那部分答案（人工点过的不动）"
            onClick={props.onReject}
          >
            <Undo2 size={11} />驳回模型结论
          </button>
        )}
        <button
          type="button"
          className="dc-btn dc-btn--accent"
          disabled={busy || unavailable}
          title={unavailable ? `模型不可用：${props.availability?.reason ?? ''}` : '用当前素材重新生成一份'}
          onClick={props.onRegenerate}
        >
          {busy ? <RefreshCw size={11} className="animate-spin" /> : <RefreshCw size={11} />}
          {record === null ? '生成' : '重算'}
        </button>
      </div>

      {/* ── 三态：加载 / 失败 / 空（都用统一组件，错误态必有出路） ── */}
      {busy && (
        <StateView
          kind="loading"
          rows={3}
          title="模型正在读其他板块的素材…"
          hint="行情（广度·温度计·板块榜·涨停梯队）→ 自挖板块（自聚类强度）→ 涨停梯队 → 事件流 → 复盘存档 → 持仓 / 自选 → 竞价"
        />
      )}

      {!busy && props.error !== undefined && props.error !== '' && (
        <StateView
          kind="error"
          compact={record !== null}
          className="mb-1"
          {...classifyStateError(props.error, '模型没有给出作战思路')}
          hint={errorHint(props.error, record !== null)}
          onRetry={props.onRegenerate}
        />
      )}

      {!busy && record === null && props.error === undefined && (
        <StateView
          kind="empty"
          title={unavailable ? '模型不可用 —— 作战思路这一版由模型提供' : '本时段还没有作战思路'}
          hint={
            <>
              {props.autoWhy}
              <br />
              素材来源：行情 / 自挖板块 / 涨停梯队 / 事件流 / 复盘存档 / 持仓与自选 / 竞价 —— 模型只能用这些素材说话。
              {unavailable ? <><br />原因：{props.availability?.reason ?? '未知'}</> : null}
              {props.missing.length > 0 ? <><br />素材缺口：{props.missing.join('；')}</> : null}
            </>
          }
          action={unavailable ? undefined : { label: '生成作战思路', onClick: props.onRegenerate }}
        />
      )}

      {!busy && plan !== null && plan.insufficient && (
        <StateView
          kind="empty"
          compact
          title="模型：素材不足，不给思路"
          hint={
            <>
              {plan.reason}
              <br />
              这是**允许的正确答案**：宁可说"证据不足"，也不许编一个听起来合理的板块或票。
              {props.missing.length > 0 ? <><br />素材缺口：{props.missing.join('；')}</> : null}
            </>
          }
          action={{ label: '重算', onClick: props.onRegenerate }}
        />
      )}

      {/* ── 思路主体 ── */}
      {!busy && plan !== null && !plan.insufficient && (
        <div className="space-y-1.5">
          {/* 盘眼 */}
          <div className="rounded border border-slate-100 bg-slate-50/60 px-2 py-1.5">
            <div className="dc-t-decision font-semibold text-slate-700">{plan.summary === '' ? '（模型没给一句话判断）' : plan.summary}</div>
            <div className="mt-0.5 dc-t-micro text-slate-400">
              素材：可点名 {guard?.symbolPool ?? 0} 只票 · 可用 {guard?.sectorPool ?? 0} 个方向名
              {record !== null ? ` · 上下文 ${(record.ctxBytes / 1024).toFixed(1)}KB` : ''}
              {record !== null && record.shrunk.length > 0 ? ` · ⚠ 已自动裁剪 ${record.shrunk.length} 次（模型少看了：${record.shrunk[record.shrunk.length - 1]}）` : ''}
            </div>
          </div>

          {/* 主攻方向 */}
          <div className="dc-war-plan-sectors">
            <div className="mb-0.5 dc-t-data font-medium text-slate-400">
              主攻方向 · {plan.sectors.length} 个
              <span className="ml-1 dc-t-micro text-slate-300">（名字只能逐字取自素材）</span>
            </div>
            {plan.sectors.length === 0 ? (
              <div className="dc-ai-note">模型没有给出主攻方向（素材里没有可用的板块名时这是正确回答）。</div>
            ) : (
              <AiRankList rows={sectorRows} />
            )}
          </div>

          {/* 候选票 */}
          <div className="dc-war-plan-picks">
            <div className="mb-0.5 dc-t-data font-medium text-slate-400">
              候选票 · {plan.picks.length} 只
              <span className="ml-1 dc-t-micro text-slate-300">（依据是素材里的量价与共动）</span>
            </div>
            {plan.picks.length === 0 ? (
              <div className="dc-ai-note">模型没有点名候选票。</div>
            ) : (
              <AiRankList rows={pickRows} />
            )}
          </div>

          {/* 三问落点 + 持仓动作 + 竞价判定：模型给默认，人可改（写回痕迹必须显示） */}
          <div className="dc-war-plan-drops rounded border border-slate-100 bg-slate-50/60 px-2 py-1.5">
            <div className="mb-0.5 flex items-center gap-1 dc-t-data font-medium text-slate-400">
              落点（已按默认写进当日记录）
              {props.adoption !== null && (
                <span className="dc-t-micro text-slate-300">
                  · 写入 {props.adoption.written.length} 项
                  {props.adoption.kept.length > 0 ? ` · 保留你的答案 ${props.adoption.kept.length} 项` : ''}
                </span>
              )}
            </div>
            <ul className="space-y-0.5">
              {drops.map((d) => (
                <li key={d.key} className="flex items-start gap-1 dc-t-note text-slate-600">
                  <Check className="mt-0.5 h-3 w-3 shrink-0 text-emerald-500" />
                  <span className="shrink-0 text-slate-400">{d.tag}</span>
                  <span className="min-w-0 flex-1">
                    <span style={d.color === undefined ? {} : { color: d.color }}>{d.value}</span>
                    {d.why !== '' ? <span className="text-slate-400"> · {d.why}</span> : null}
                  </span>
                </li>
              ))}
              {drops.length === 0 && (
                <li className="dc-ai-note">模型没有给任何落点（素材里没有持仓 / 预期 / 竞价数据时是正常的）。</li>
              )}
            </ul>
            {props.adoption !== null && props.adoption.kept.length > 0 && (
              <div className="mt-0.5 dc-ai-note" title={props.adoption.kept.join('；')}>
                保留你的答案：{props.adoption.kept.join('、')}
              </div>
            )}
          </div>

          {/* 纪律 + 证据 */}
          <div className="dc-war-plan-evidence rounded border border-slate-100 bg-slate-50/60 px-2 py-1.5">
            <div className="mb-0.5 dc-t-data font-medium text-slate-400">今天不做 · 证据</div>
            {plan.avoid.length === 0 ? (
              <div className="dc-ai-note">模型没写纪律项。</div>
            ) : (
              <ul className="space-y-0.5">
                {plan.avoid.map((a) => (
                  <li key={a} className="dc-t-note text-slate-600">· {a}</li>
                ))}
              </ul>
            )}
            {plan.evidence.length === 0 ? (
              <div className="mt-0.5 dc-ai-note">模型没给引文（没有引文 = 结论无法追溯，慎重）。</div>
            ) : (
              <ul className="mt-0.5 space-y-0.5">
                {plan.evidence.map((e) => {
                  const bad = guard?.ungrounded.includes(clipQuote(e)) === true
                  return (
                    <li key={e} className="dc-t-note text-slate-500" title={bad ? '这条未能在素材里逐字/数字反查' : '可在素材里逐字/数字反查到'}>
                      {bad ? <AlertTriangle className="mr-0.5 inline h-2.5 w-2.5 text-amber-500" /> : null}
                      {bad ? <s>{e}</s> : e}
                    </li>
                  )
                })}
              </ul>
            )}
          </div>

          {/* 护栏与素材缺口（"模型越界了多少"必须看得见） */}
          {(droppedN > 0 || (guard?.ungrounded.length ?? 0) > 0 || props.missing.length > 0 || (record !== null && record.shrunk.length > 0)) && (
            <div className="dc-war-plan-guard dc-ai-note">
              {droppedN > 0 && (
                <div title={[...(guard?.droppedSymbols ?? []), ...(guard?.droppedSectors ?? [])].join('；')}>
                  ⚠ 已剔除 {droppedN} 条**素材里没有的**点名
                  {guard !== undefined && guard.droppedSectors.length > 0 ? `（其中 ${guard.droppedSectors.length} 个方向名不在素材板块名里）` : ''}
                  —— 模型越界的部分没有被采信。
                </div>
              )}
              {(guard?.ungrounded.length ?? 0) > 0 && (
                <div>⚠ 引文可反查 {guard?.grounded ?? 0}/{plan.evidence.length} 条，未落地的已划掉（逐字/数字级别的抽查，不等于语义核验）。</div>
              )}
              {props.missing.length > 0 && <div>素材缺口：{props.missing.join('；')} —— 缺的那块模型看不到。</div>}
              {record !== null && record.shrunk.length > 0 && (
                <div>⚠ 上下文过大，已自动裁剪后重试：{record.shrunk.join('；')}</div>
              )}
            </div>
          )}

          {record !== null && record.raw !== '' && (plan.picks.length === 0 && plan.sectors.length === 0) && (
            <div className="dc-ai-raw" title="模型原文（结构化结果可用时不需要看它）">{record.raw}</div>
          )}
        </div>
      )}
    </div>
  )
}

/** Q1 取值 → 中文（与 QAnswers 的按钮文案一致）。 */
function q1Text(v: string): string {
  return v === 'strengthen' ? '增强' : v === 'weaken' ? '衰减' : '中性'
}

/** Q3 取值 → 中文（与 QAnswers 的按钮文案一致）。 */
function q3Text(v: string): string {
  return v === 'hold' ? '持有' : v === 'reduce' ? '减仓' : v === 'clear' ? '清仓/兑现' : '半仓试错'
}

/** 与 host 半护栏同样的截断口径（用于把引文对回 `guard.ungrounded`）。 */
function clipQuote(s: string): string {
  return s.length > 40 ? s.slice(0, 40) + '…' : s
}

/**
 * 失败时该给用户什么出路。
 *
 * `未知任务：war-plan` 是本批真机实测撞到的**升级态**：客户端每次刷新即更新（宿主按请求发
 * `lib/client.js`），而 **host 半在 dsh 进程启动时载入一次** —— 于是新卡片配旧 host，
 * 表现成"点了生成就报未知任务"。这不是 bug 而是加载时机，所以说清该怎么做，
 * 而不是让用户对着一个业务错反复点重试（同一条纪律见 `client/命名路由不可达` 的提示）。
 */
function errorHint(error: string, hasRecord: boolean): string {
  if (/未知任务|unsupported/i.test(error)) {
    return '宿主半还是旧版本（客户端已更新）：重启 dsh web 让 host 半重新加载即可 —— 插件的 host 半在进程启动时载入一次'
  }
  if (hasRecord) return '下面保留上一次成功的思路；可点重算再试'
  return '点重算再试一次；若是"宿主未提供 LLM"，请先给 DSH 配默认模型'
}
