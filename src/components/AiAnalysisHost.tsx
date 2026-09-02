import { useState } from 'react'
import { Sparkles, Loader2, AlertCircle } from 'lucide-react'
import { api, type AiStockReport } from '@/lib/api'

interface Props {
  symbol: string
  name: string
  onReportAdded: (report: AiStockReport) => void
}

type Phase = 'idle' | 'loading' | 'streaming' | 'done' | 'error'

/** AI 个股四维分析宿主：流式调用后端，渲染进度 + 结果 */
export function AiAnalysisHost({ symbol, name, onReportAdded }: Props) {
  const [phase, setPhase] = useState<Phase>('idle')
  const [progress, setProgress] = useState('')
  const [error, setError] = useState('')

  const runAnalysis = async () => {
    if (!symbol) return
    setPhase('loading')
    setError('')
    setProgress('正在分析行情与关键价位…')

    try {
      let content = ''
      let summary = ''
      for await (const chunk of api.stockAnalyzeStream(symbol)) {
        if (chunk.type === 'delta') {
          setPhase('streaming')
          if (chunk.content) { content += chunk.content; setProgress(content.slice(0, 200)) }
          if (chunk.summary) summary = chunk.summary
        } else if (chunk.type === 'error') {
          setPhase('error')
          setError(chunk.message ?? '分析失败')
          return
        } else if (chunk.type === 'done') {
          setPhase('done')
        }
      }

      if (content) {
        onReportAdded({
          id: `local-${Date.now()}`,
          symbol,
          name,
          focus: '四维分析',
          content,
          summary,
          created_at: new Date().toISOString(),
        })
      }
    } catch (e) {
      setPhase('error')
      setError((e as Error).message)
    }
  }

  return (
    <div className="rounded-lg border border-slate-200 p-3">
      <div className="mb-2 flex items-center justify-between">
        <h3 className="text-xs font-medium text-slate-600">AI 四维分析</h3>
        <span className="text-[10px] text-slate-400">技术 · 基本面 · 财务 · 消息面</span>
      </div>

      {phase === 'idle' && (
        <button
          onClick={runAnalysis}
          className="flex w-full items-center justify-center gap-1.5 rounded-md bg-blue-500 px-3 py-2 text-xs text-white hover:bg-blue-600"
        >
          <Sparkles className="h-3.5 w-3.5" />
          开始 AI 分析
        </button>
      )}

      {(phase === 'loading' || phase === 'streaming') && (
        <div className="flex items-center justify-center gap-2 rounded-md bg-slate-50 px-3 py-4 text-xs text-slate-500">
          <Loader2 className="h-3.5 w-3.5 animate-spin text-blue-500" />
          {progress || '分析中…'}
        </div>
      )}

      {phase === 'error' && (
        <div className="flex items-center justify-center gap-2 rounded-md bg-red-50 px-3 py-4 text-xs text-red-500">
          <AlertCircle className="h-3.5 w-3.5" />
          {error || '分析失败，请重试'}
        </div>
      )}
    </div>
  )
}
