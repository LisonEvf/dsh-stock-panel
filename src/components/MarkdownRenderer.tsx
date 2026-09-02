import { Fragment, type ReactNode } from 'react'

/**
 * 轻量 Markdown 渲染器 — 零依赖，专为 AI 分析报告设计。
 * 支持：标题 / 加粗 / 行内代码 / 列表 / 表格 / 引用 / 分隔线 / 段落
 */

function renderInline(text: string, keyBase: string): ReactNode[] {
  const nodes: ReactNode[] = []
  const re = /(\*\*([^*]+)\*\*)|(`([^`]+)`)/g
  let last = 0
  let m: RegExpExecArray | null
  let i = 0
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) nodes.push(<Fragment key={`${keyBase}-t-${i}`}>{text.slice(last, m.index)}</Fragment>)
    if (m[1]) {
      nodes.push(<strong key={`${keyBase}-b-${i}`} className="font-semibold text-slate-800">{m[2]}</strong>)
    } else if (m[3]) {
      nodes.push(
        <code key={`${keyBase}-c-${i}`} className="px-1 py-0.5 rounded bg-slate-100 text-[0.85em] font-mono text-emerald-700">
          {m[4]}
        </code>,
      )
    }
    last = m.index + m[0].length
    i++
  }
  if (last < text.length) nodes.push(<Fragment key={`${keyBase}-t-end`}>{text.slice(last)}</Fragment>)
  return nodes
}

function parseTable(lines: string[], start: number): { rows: string[][]; consumed: number } | null {
  const tableLines: string[] = []
  let idx = start
  while (idx < lines.length && lines[idx].trim().startsWith('|')) {
    tableLines.push(lines[idx].trim())
    idx++
  }
  if (tableLines.length < 2) return null
  if (!/^|[\s-:|]+$/.test(tableLines[1]) && !tableLines[1].split('|').every(c => /^[\s-:]*$/.test(c))) {
    return null
  }
  const parseRow = (line: string) =>
    line.replace(/^\|/, '').replace(/\|$/, '').split('|').map(c => c.trim())
  const header = parseRow(tableLines[0])
  const body = tableLines.slice(2).map(parseRow)
  return { rows: [header, ...body], consumed: tableLines.length }
}

export function MarkdownRenderer({ content }: { content: string }) {
  const lines = content.replace(/\r\n/g, '\n').split('\n')
  const blocks: ReactNode[] = []
  let i = 0
  let key = 0

  while (i < lines.length) {
    const line = lines[i]
    const trimmed = line.trim()

    if (!trimmed) { i++; continue }

    if (/^(-{3,}|\*{3,}|_{3,})$/.test(trimmed)) {
      blocks.push(<hr key={key++} className="my-6 border-slate-200" />)
      i++
      continue
    }

    const hMatch = trimmed.match(/^(#{1,4})\s+(.+)$/)
    if (hMatch) {
      const level = hMatch[1].length
      const text = hMatch[2]
      const sizeCls = level === 1 ? 'text-base' : level === 2 ? 'text-sm' : 'text-xs'
      const mtCls = level <= 2 ? 'mt-6' : 'mt-5'
      blocks.push(
        <div key={key++} className={`${sizeCls} ${mtCls} mb-3 font-semibold text-slate-800 flex items-center gap-1.5`}>
          {renderInline(text, `h-${key}`)}
        </div>,
      )
      i++
      continue
    }

    if (trimmed.startsWith('>')) {
      const quoteLines: string[] = []
      while (i < lines.length && lines[i].trim().startsWith('>')) {
        quoteLines.push(lines[i].trim().replace(/^>\s?/, ''))
        i++
      }
      blocks.push(
        <blockquote key={key++} className="my-4 pl-3 border-l-2 border-amber-400/40 bg-amber-400/[0.04] py-1.5 pr-2 rounded-r text-xs text-slate-600">
          {renderInline(quoteLines.join(' '), `q-${key}`)}
        </blockquote>,
      )
      continue
    }

    if (trimmed.startsWith('|')) {
      const table = parseTable(lines, i)
      if (table) {
        const [header, ...body] = table.rows
        const ncol = header.length
        blocks.push(
          <div key={key++} className="my-5 overflow-hidden rounded border border-slate-200">
            <table className="w-full text-xs border-collapse table-fixed">
              <colgroup>
                <col className="w-auto" />
                {Array.from({ length: ncol - 1 }).map((_, ci) => (
                  <col key={ci} className={ci === ncol - 2 ? 'w-1/2' : 'w-auto'} />
                ))}
              </colgroup>
              <thead>
                <tr className="bg-slate-50">
                  {header.map((cell, ci) => (
                    <th key={ci} className="px-2.5 py-1.5 text-left font-medium text-slate-700 border-b border-slate-200 whitespace-nowrap">
                      {renderInline(cell, `th-${key}-${ci}`)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {body.map((row, ri) => (
                  <tr key={ri} className="border-b border-slate-100 last:border-0">
                    {row.map((cell, ci) => (
                      <td key={ci} className="px-2.5 py-1.5 text-slate-600 align-top break-words">
                        {renderInline(cell, `td-${key}-${ri}-${ci}`)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>,
        )
        i += table.consumed
        continue
      }
    }

    if (/^[-*]\s+/.test(trimmed)) {
      const items: string[] = []
      while (i < lines.length && /^\s*[-*]\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\s*[-*]\s+/, ''))
        i++
      }
      blocks.push(
        <ul key={key++} className="my-4 space-y-2">
          {items.map((item, ii) => (
            <li key={ii} className="flex items-start gap-2 text-sm text-slate-600 leading-relaxed">
              <span className="mt-[7px] h-1 w-1 rounded-full bg-emerald-500 shrink-0" />
              <span>{renderInline(item, `li-${key}-${ii}`)}</span>
            </li>
          ))}
        </ul>,
      )
      continue
    }

    if (/^\d+\.\s+/.test(trimmed)) {
      const items: string[] = []
      while (i < lines.length && /^\s*\d+\.\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\s*\d+\.\s+/, ''))
        i++
      }
      blocks.push(
        <ol key={key++} className="my-4 space-y-2">
          {items.map((item, ii) => (
            <li key={ii} className="flex items-start gap-2 text-xs text-slate-600 leading-relaxed">
              <span className="mt-0.5 h-4 w-4 rounded-full bg-emerald-100 text-emerald-700 text-[10px] font-mono flex items-center justify-center shrink-0">
                {ii + 1}
              </span>
              <span className="flex-1 text-slate-600">{renderInline(item, `ol-${key}-${ii}`)}</span>
            </li>
          ))}
        </ol>,
      )
      continue
    }

    blocks.push(
      <p key={key++} className="my-3 text-sm text-slate-600 leading-relaxed">
        {renderInline(trimmed, `p-${key}`)}
      </p>,
    )
    i++
  }

  return <div>{blocks}</div>
}
