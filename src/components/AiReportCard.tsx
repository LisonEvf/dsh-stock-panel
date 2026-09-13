import { useState } from 'react'
import { Sparkles, Trash2 } from 'lucide-react'
import { api, type AiStockReport } from '@/lib/api'
import { MarkdownRenderer } from './MarkdownRenderer'
import { fmtDate } from '@/lib/format'

interface Props {
  report: AiStockReport
  onDelete?: (id: string) => void
}

/** AI 个股分析报告卡片：四维分析内容渲染 + 删除 */
export function AiReportCard({ report, onDelete }: Props) {
  const [expanded, setExpanded] = useState(false)

  const handleDelete = async () => {
    await api.stockAnalysisReportDelete(report.id)
    onDelete?.(report.id)
  }

  return (
    <div className="rounded-lg border border-slate-200 bg-white p-3">
      {/* 头部 */}
      <div className="mb-2 flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          <Sparkles className="h-3.5 w-3.5 text-blue-500" />
          <span className="text-xs font-medium text-slate-600">AI 四维分析</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="dc-t-data text-slate-400">{fmtDate(report.created_at)}</span>
          {onDelete && (
            <button onClick={handleDelete} className="p-0.5 text-slate-300 hover:text-red-500" title="删除">
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      </div>

      {/* 摘要 */}
      {report.summary && (
        <div className="mb-2 rounded bg-blue-50 px-2 py-1.5 text-xs text-slate-600">
          {report.summary}
        </div>
      )}

      {/* 内容 */}
      {report.content ? (
        <div className={`overflow-auto ${expanded ? '' : 'max-h-48'}`}>
          <MarkdownRenderer content={report.content} />
        </div>
      ) : (
        <div className="text-xs text-slate-400 py-4">分析生成中…</div>
      )}

      {/* 展开/收起 */}
      {report.content && report.content.length > 400 && (
        <button
          onClick={() => setExpanded(v => !v)}
          className="mt-2 dc-t-note text-blue-500 hover:text-blue-700"
        >
          {expanded ? '收起' : '展开全文'}
        </button>
      )}
    </div>
  )
}
