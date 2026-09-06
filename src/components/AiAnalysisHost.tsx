import { useState } from 'react'
import { Copy, Check, MessageSquareText } from 'lucide-react'
import type { AiStockReport } from '@/lib/api'

interface Props {
  symbol: string
  name: string
  onReportAdded: (report: AiStockReport) => void
}

/**
 * AI 个股分析（对话联动版，1.1.0）。
 *
 * 不再依赖 FastAPI 后端：host 半已向当前对话注册行情工具
 * （stock_quote / stock_kline / stock_tick / stock_unusual），
 * 助手能自行取数做「趋势/量价/位置/风险」四维分析。本卡片只做
 * 引导 + 一键复制分析指令（粘贴到对话区发送）。
 */
export function AiAnalysisHost({ symbol, name }: Props) {
  const [copied, setCopied] = useState(false)

  const prompt = `请用 stock_quote 与 stock_kline 分析 ${name}（${symbol}）：先给一句话结论，再从「趋势位置 / 量价关系 / 风险点 / 明日关注」四个维度给出 3-5 条要点；有异常才引用具体数字，不要凑数。`

  const copy = async () => {
    const text = prompt
    try {
      await navigator.clipboard.writeText(text)
    } catch {
      const ta = document.createElement('textarea')
      ta.value = text
      ta.style.position = 'fixed'
      ta.style.opacity = '0'
      document.body.appendChild(ta)
      ta.select()
      try {
        document.execCommand('copy')
      } catch {
        /* ignore */
      }
      document.body.removeChild(ta)
    }
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div className="rounded-lg border border-emerald-100 bg-emerald-50/40 p-2.5">
      <div className="mb-1 flex items-center justify-between">
        <h3 className="flex items-center gap-1 text-xs font-medium text-slate-600">
          <MessageSquareText className="h-3.5 w-3.5 text-emerald-500" />
          AI 个股分析 · 对话联动
        </h3>
        <span className="text-[9px] text-emerald-600/70">无需后端</span>
      </div>
      <p className="mb-1.5 text-[10px] leading-relaxed text-slate-500">
        行情工具已接入当前对话（stock_quote / stock_kline / stock_tick / stock_unusual），
        直接让助手分析即可——复制下面的指令，粘贴到对话区发送。
      </p>
      <pre className="mb-1.5 whitespace-pre-wrap rounded bg-white px-2 py-1.5 font-sans text-[10px] leading-relaxed text-slate-600">
        {prompt}
      </pre>
      <button
        onClick={() => void copy()}
        className="flex w-full items-center justify-center gap-1 rounded-md bg-emerald-500 py-1.5 text-[11px] font-medium text-white hover:bg-emerald-600"
      >
        {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
        {copied ? '已复制，去对话区发送' : '复制分析指令'}
      </button>
    </div>
  )
}
