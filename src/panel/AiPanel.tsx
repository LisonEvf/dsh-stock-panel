/**
 * src/panel/AiPanel.tsx — 右栏常驻 AI 卡（「一键调用」+「反馈完善视图」的落点）。
 *
 * 两条通道（用户选定的双通道方案）：
 *   1. **一键研判（主）**：host 半用官方 ctx.llm 直调当前默认模型，要求严格 JSON，
 *      结论结构化回填——方向/把握分/要点/风险/**关键价位**（价位由 WatchView 画到主图）。
 *   2. **深入对话（副）**：把已取到的上下文 + 模型初判一起注入当前对话输入框并发送，
 *      由对话里的 agent 自己调行情工具做多轮复核（结果在对话流里，不抢本视图）。
 *
 * 两条通道都是「一键」：不需要复制粘贴、不需要切视图。
 * 上下文由 use-ai.ts 提供（与主图共享缓存，不额外发请求）。
 */
import { useState } from 'react'
import { Sparkles, MessageSquareText, RefreshCw, X, AlertTriangle, Send } from 'lucide-react'
import type { AiRunner } from './use-ai'
import type { StockVerdict } from '@/lib/ai-contract'
import { fmtPrice } from '@/lib/format'
import { todayKey } from '@/lib/ai'

interface Props {
  symbol: string | null
  name: string
  /** K 线窗口（文案用，与主图一致）。 */
  days: number
  ai: AiRunner
  /** 对话通道（不可用时按钮置灰并说明原因）。 */
  chat: {
    available: boolean
    reason?: string
    send: (prompt: string) => void
  }
}

/** 结论方向的中文标签。 */
const STANCE_LABEL: Record<StockVerdict['stance'], string> = {
  bullish: '偏多',
  neutral: '中性',
  bearish: '偏空',
}

/** 「深入对话」的 prompt：把模型初判与屏幕上下文一起交给对话 agent 复核。 */
export function buildDeepDivePrompt(input: {
  symbol: string
  name: string
  verdict: StockVerdict | null
  priceText?: string
}): string {
  const { symbol, name, verdict, priceText } = input
  const lines: string[] = []
  lines.push(`请研判 ${name}（${symbol}）${priceText ? `，当前 ${priceText}` : ''}。`)
  if (verdict !== null) {
    const lv = verdict.levels
    const lvText =
      lv === undefined
        ? ''
        : [
            lv.support !== undefined ? `支撑 ${lv.support}` : '',
            lv.resistance !== undefined ? `压力 ${lv.resistance}` : '',
            lv.stop !== undefined ? `止损 ${lv.stop}` : '',
            lv.target !== undefined ? `目标 ${lv.target}` : '',
          ]
            .filter((s) => s !== '')
            .join(' / ')
    lines.push(
      `工作台内置模型给的初判是「${STANCE_LABEL[verdict.stance]} ${verdict.score} 分」：${verdict.oneLine}` +
        (lvText !== '' ? `（价位：${lvText}）` : ''),
    )
    lines.push('请用行情工具（stock_quote / stock_kline / stock_tick）独立复核：')
    lines.push('① 是否同意这个结论，异议在哪；② 复核关键价位；③ 明日具体观察点（可执行、可证伪）。')
    lines.push('有分歧就直接说分歧，不需要迁就上面的初判。')
  } else {
    lines.push('请用行情工具（stock_quote / stock_kline / stock_tick）分析：趋势位置 / 量价关系 / 风险点 / 明日关注，各 2-3 条。')
  }
  return lines.join('\n')
}

export function AiPanel({ symbol, name, days, ai, chat }: Props) {
  const [ask, setAsk] = useState('')
  const { state, record, availability, busy } = ai

  // 展示优先级：本次运行结果 > 当日存档 > 空态
  const verdict: StockVerdict | null = state.verdict ?? record?.verdict ?? null
  const archived = state.verdict === undefined && record !== null
  const raw = state.raw ?? (archived ? record?.raw : undefined) ?? ''
  const meta = state.meta ?? (archived && record ? { provider: record.provider, model: record.model, ms: record.ms } : undefined)

  if (symbol === null) {
    return (
      <div className="dc-empty">
        <div className="dc-empty-mark">✦</div>
        <div>未选择标的</div>
        <div>在左栏点一只票，或按 ⌘K 搜索 —— 这里会给出模型研判</div>
      </div>
    )
  }

  return (
    <div className="dc-ai">
      <div className="dc-ai-title">
        <Sparkles size={13} style={{ color: 'var(--dc-accent)' }} />
        <span>AI 研判</span>
        <span style={{ flex: 1 }} />
        {meta !== undefined && meta.provider !== '' ? (
          <span className="dc-tag dc-num" title={`${meta.provider}/${meta.model}｜${meta.ms}ms`}>
            {meta.model || meta.provider}
          </span>
        ) : null}
      </div>

      {/* 动作区 */}
      <div className="dc-ai-actions">
        <button
          type="button"
          className="dc-btn dc-btn--accent"
          disabled={busy || availability?.available === false}
          title={availability?.available === false ? `不可用：${availability.reason ?? ''}` : '一键研判（A）'}
          onClick={() => void ai.run(ask.trim() === '' ? undefined : ask.trim())}
        >
          {busy ? <RefreshCw size={12} className="animate-spin" /> : <Sparkles size={12} />}
          {busy ? '研判中…' : verdict !== null ? '重新研判' : '一键研判'}
        </button>
        <button
          type="button"
          className="dc-btn"
          disabled={!chat.available}
          title={chat.available ? '把上下文与初判注入当前对话，用 agent 复核（不切视图）' : chat.reason ?? '对话通道不可用'}
          onClick={() => chat.send(buildDeepDivePrompt({ symbol, name, verdict }))}
        >
          <MessageSquareText size={12} />
          深入对话
        </button>
      </div>

      {/* 追加要求 */}
      <input
        className="dc-palette-input"
        style={{ border: '1px solid var(--dc-border)', borderRadius: 6, padding: '5px 8px', fontSize: 11 }}
        placeholder="补充要求（可选）：例如「只看短线 3 天」「重点看资金」"
        value={ask}
        onChange={(e) => setAsk(e.target.value)}
      />

      {availability !== null && !availability.available ? (
        <div className="dc-ai-note">
          <AlertTriangle size={11} /> AI 直调不可用：{availability.reason}（行情功能不受影响；也可用右侧「深入对话」）
        </div>
      ) : null}

      {/* 状态区 */}
      {state.status === 'running' ? (
        <div className="dc-loading">
          <span className="dc-dot" />
          正在叫模型（趋势/量价/风险/价位）…
        </div>
      ) : null}

      {state.status === 'error' ? (
        <div className="dc-ai-error">
          {state.error}
          <div style={{ marginTop: 4 }}>
            <button type="button" className="dc-btn dc-btn--ghost" onClick={() => void ai.run()}>
              重试
            </button>
          </div>
        </div>
      ) : null}

      {/* 结论卡 */}
      {verdict !== null ? (
        <div className="dc-verdict">
          <div className="dc-verdict-top">
            <span className={`dc-stance is-${verdict.stance}`}>{STANCE_LABEL[verdict.stance]}</span>
            <span className="dc-score" title={`把握分 ${verdict.score}/100`}>
              <i style={{ width: `${verdict.score}%` }} />
            </span>
            <span className={`dc-score-val dc-num ${verdict.stance === 'bullish' ? 'dc-up' : verdict.stance === 'bearish' ? 'dc-down' : 'dc-flat'}`}>
              {verdict.score}
            </span>
          </div>

          {verdict.oneLine !== '' ? <div className="dc-verdict-line">{verdict.oneLine}</div> : null}

          {verdict.thesis.length > 0 ? (
            <>
              <div className="dc-section-label">支撑要点</div>
              <ul className="dc-bullets">
                {verdict.thesis.map((t, i) => (
                  <li key={i}>{t}</li>
                ))}
              </ul>
            </>
          ) : null}

          {verdict.risks.length > 0 ? (
            <>
              <div className="dc-section-label">风险</div>
              <ul className="dc-bullets is-risk">
                {verdict.risks.map((t, i) => (
                  <li key={i}>{t}</li>
                ))}
              </ul>
            </>
          ) : null}

          {verdict.levels !== undefined ? (
            <>
              <div className="dc-section-label">关键价位（已画到主图）</div>
              <LevelsTable levels={verdict.levels} />
            </>
          ) : null}

          {verdict.watch.length > 0 ? (
            <>
              <div className="dc-section-label">明日关注</div>
              <ul className="dc-bullets">
                {verdict.watch.map((t, i) => (
                  <li key={i}>{t}</li>
                ))}
              </ul>
            </>
          ) : null}

          <div className="dc-ai-meta">
            {archived ? <span>存档 · {todayKey()}</span> : <span>本次结果</span>}
            {meta !== undefined && meta.ms > 0 ? <span className="dc-num">{(meta.ms / 1000).toFixed(1)}s</span> : null}
            {meta?.attempts !== undefined && meta.attempts > 1 ? (
              <span title="首次调用模型把输出预算烧在思考上（无正文），已自动裁剪上下文重试">
                重试 {meta.attempts} 次
              </span>
            ) : null}
            {state.verdict === undefined && record !== null ? (
              <button type="button" className="dc-btn dc-btn--ghost dc-btn--icon" title="清除存档" onClick={ai.clear}>
                <X size={11} />
              </button>
            ) : null}
          </div>
          {/* 自愈裁剪必须告知用户：模型少看了什么，不静默 */}
          {meta?.shrunk !== undefined && meta.shrunk.length > 0 ? (
            <div className="dc-ai-note" title={meta.shrunk.join('；')}>
              ⚠ 上下文过大，已自动裁剪后重试（模型看到的数据被缩小）：{meta.shrunk[meta.shrunk.length - 1]}
            </div>
          ) : null}
        </div>
      ) : null}

      {/* 结构化失败：原文兜底（绝不丢模型的话） */}
      {verdict === null && raw !== '' && state.status !== 'running' ? (
        <>
          <div className="dc-section-label">模型原文（未按 JSON 返回，已原样保留）</div>
          <div className="dc-ai-raw dc-scroll">{raw}</div>
        </>
      ) : null}

      {/* 思考过程（默认折叠，透明度） */}
      {state.reasoning !== undefined && state.reasoning !== '' ? (
        <details className="dc-think">
          <summary>模型思考（{state.reasoning.length} 字）</summary>
          <pre>{state.reasoning}</pre>
        </details>
      ) : null}

      {verdict === null && raw === '' && state.status === 'idle' && availability?.available !== false ? (
        <div className="dc-ai-note">
          点「一键研判」让模型基于当前报价、近 {days} 根日 K 与资金流给出结论；
          结论里的关键价位会直接画到主图上，可随时用「深入对话」让 agent 复核。
        </div>
      ) : null}

      {chat.available && verdict !== null ? (
        <div className="dc-ai-note">
          <Send size={10} /> 「深入对话」只注入 prompt，不切换视图 —— 复核结果在对话页，切上面的标签过去看。
        </div>
      ) : null}
    </div>
  )
}

function LevelsTable({ levels }: { levels: NonNullable<StockVerdict['levels']> }) {
  const rows: Array<[string, number | undefined, string]> = [
    ['压力', levels.resistance, 'dc-up'],
    ['支撑', levels.support, 'dc-down'],
    ['止损', levels.stop, 'dc-danger'],
    ['目标', levels.target, 'dc-up'],
  ]
  const shown = rows.filter(([, v]) => v !== undefined)
  if (shown.length === 0) return null
  return (
    <div>
      {shown.map(([label, v, tone]) => (
        <div className="dc-kv" key={label}>
          <span>{label}</span>
          <span className={`dc-num ${tone}`}>{fmtPrice(v)}</span>
        </div>
      ))}
    </div>
  )
}
