import { useEffect, useState } from 'react'
import { Sparkles, Loader2, AlertCircle, RefreshCw } from 'lucide-react'
import { api, detectBackend, type AiStockReport } from '@/lib/api'

interface Props {
  symbol: string
  name: string
  onReportAdded: (report: AiStockReport) => void
}

type Phase = 'idle' | 'loading' | 'streaming' | 'done' | 'error'
type BackendState = 'checking' | 'yes' | 'no'

/** 404 → 友好文案（纯 MCP 模式常见：后端路由不存在）。 */
function friendly(err: string): string {
  if (/404/.test(err)) return '后端不可用（404）：AI 分析需要 FastAPI 后端（B 轨），当前数据源未提供该服务。'
  return err || '分析失败，请重试'
}

/**
 * AI 个股四维分析宿主（B 轨）。
 * 进入前先探测 FastAPI 后端：不可用（纯 MCP 模式 → /api/stock-analysis 404）时
 * 停用按钮并给出提示，避免用户点到 404；后端可用时保持原流式分析。
 */
export function AiAnalysisHost({ symbol, name, onReportAdded }: Props) {
  const [phase, setPhase] = useState<Phase>('idle')
  const [progress, setProgress] = useState('')
  const [error, setError] = useState('')
  const [backend, setBackend] = useState<BackendState>('checking')

  // 每次换标的重新探测（探测结果本身有 60s 模块缓存）
  useEffect(() => {
    let cancelled = false
    setBackend('checking')
    void detectBackend().then((ok) => {
      if (!cancelled) setBackend(ok ? 'yes' : 'no')
    })
    return () => {
      cancelled = true
    }
  }, [symbol])

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
          if (chunk.content) {
            content += chunk.content
            setProgress(content.slice(0, 200))
          }
          if (chunk.summary) summary = chunk.summary
        } else if (chunk.type === 'error') {
          setPhase('error')
          setError(friendly(chunk.message ?? '分析失败'))
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
      setError(friendly((e as Error).message))
    }
  }

  return (
    <div className="rounded-lg border border-slate-200 p-3">
      <div className="mb-2 flex items-center justify-between">
        <h3 className="text-xs font-medium text-slate-600">AI 四维分析</h3>
        <div className="flex items-center gap-1">
          <span className="text-[10px] text-slate-400">技术 · 基本面 · 财务 · 消息面</span>
          {backend === 'no' && (
            <span className="rounded bg-amber-50 px-1 text-[8px] text-amber-600">B 轨未检测</span>
          )}
        </div>
      </div>

      {backend === 'checking' && (
        <div className="flex items-center justify-center gap-1.5 rounded-md bg-slate-50 px-3 py-2 text-[10px] text-slate-400">
          <Loader2 className="h-3 w-3 animate-spin" />检测后端可用性…
        </div>
      )}

      {backend === 'no' && (
        <div className="rounded-md bg-amber-50 px-2.5 py-2">
          <div className="mb-1 flex items-start gap-1 text-[11px] leading-snug text-amber-700">
            <AlertCircle className="mt-px h-3.5 w-3.5 shrink-0" />
            <span>
              AI 四维分析依赖 FastAPI 后端（B 轨 `/api/stock-analysis`）。当前为纯 MCP 数据源、
              未检测到后端（请求 404/不可达），功能已停用；面板其余功能不受影响。
              启动后端后点「重试检测」即可恢复。
            </span>
          </div>
          <button
            onClick={() => {
              setBackend('checking')
              void detectBackend().then((ok) => setBackend(ok ? 'yes' : 'no'))
            }}
            className="flex items-center gap-1 rounded bg-white px-1.5 py-0.5 text-[9px] font-medium text-amber-600 hover:bg-amber-100"
          >
            <RefreshCw className="h-2.5 w-2.5" />重试检测
          </button>
        </div>
      )}

      {backend === 'yes' && (phase === 'idle' || phase === 'done') && (
        <button
          onClick={runAnalysis}
          className="flex w-full items-center justify-center gap-1.5 rounded-md bg-blue-500 px-3 py-2 text-xs text-white hover:bg-blue-600"
        >
          <Sparkles className="h-3.5 w-3.5" />
          {phase === 'done' ? '再次 AI 分析' : '开始 AI 分析'}
        </button>
      )}

      {backend === 'yes' && (phase === 'loading' || phase === 'streaming') && (
        <div className="flex items-center justify-center gap-2 rounded-md bg-slate-50 px-3 py-4 text-xs text-slate-500">
          <Loader2 className="h-3.5 w-3.5 animate-spin text-blue-500" />
          {progress || '分析中…'}
        </div>
      )}

      {backend === 'yes' && phase === 'error' && (
        <div className="rounded-md bg-red-50 px-3 py-2 text-xs text-red-500">{error}</div>
      )}

      {backend === 'yes' && phase === 'done' && (
        <div className="mb-1.5 rounded-md bg-emerald-50 px-3 py-2 text-xs text-emerald-600">
          分析完成，报告已追加至下方列表
        </div>
      )}
    </div>
  )
}
