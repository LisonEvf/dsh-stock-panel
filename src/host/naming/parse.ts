/**
 * src/host/naming/parse.ts —— 模型输出的分级降级解析（A2b，移植自 `cluster-namer/pipeline.py`）。
 *
 * 剥围栏 → 剥前缀 → 直接 parse → 去尾逗号/补括号 重试，仍然失败就**如实降级**
 * （`llm_invalid_json`），而不是"跨引擎借 key 抢修 JSON"。
 *
 * 为什么刻意不做得更聪明：把畸形输出硬凑成一个看起来合法的结构，等于让一份没人写过的结论
 * 进入复盘报告；本项目宁可显示「模型输出无法解析」，也不要一个来源不明的主题名
 * （参考实现 docs/07 风险一）。解析失败时**原文必须保留**，供人抽查。
 */
import type { RawNamingOutput } from './guard'

export interface ParseOutcome {
  raw: RawNamingOutput | null
  /** 失败原因（成功时为空串）。 */
  error: string
}

/** 去掉 markdown 围栏。 */
const FENCE_RE = /```(?:json)?\s*|\s*```/g

export function parseLlmJson(text: string | undefined | null): ParseOutcome {
  if (!text) return { raw: null, error: '空响应' }
  let cleaned = String(text).replace(FENCE_RE, '').trim()
  // 模型常见「先说一句再给 JSON」：从第一个 { 或 [ 开始截
  const starts = [cleaned.indexOf('{'), cleaned.indexOf('[')].filter((i) => i >= 0)
  if (starts.length > 0 && Math.min(...starts) > 0) {
    cleaned = cleaned.slice(Math.min(...starts))
  }
  const first = tryParseObject(cleaned)
  if (first.ok) return { raw: first.value, error: '' }

  const repaired = repair(cleaned)
  const second = tryParseObject(repaired)
  if (second.ok) return { raw: second.value, error: '' }
  return { raw: null, error: `JSON 解析失败：${first.error}` }
}

function tryParseObject(text: string): { ok: true; value: RawNamingOutput } | { ok: false; error: string } {
  try {
    const data: unknown = JSON.parse(text)
    if (data && typeof data === 'object' && !Array.isArray(data)) {
      return { ok: true, value: data as RawNamingOutput }
    }
    return { ok: false, error: '顶层不是对象' }
  } catch (err) {
    return { ok: false, error: (err as Error).message }
  }
}

/**
 * 去尾逗号 + 补齐未闭合的括号（只做**结构性**修复，不改写字段内容）。
 *
 * 与参考实现的差别：参考实现是"先补 `}` 再补 `]`"，于是 `{"a":[1,2`（截断在数组里）
 * 会被补成 `{"a":[1,2}` —— 仍然非法，白白多一次失败。这里改为按**括号栈**补：
 * 谁最后开、谁先关，两种截断顺序都能修好。仍然坚持只碰结构、不猜内容。
 */
export function repair(text: string): string {
  let out = text.replace(/,\s*([}\]])/g, '$1').replace(/,\s*$/, '')
  const stack: string[] = []
  let inString = false
  let escaped = false
  for (const ch of out) {
    if (inString) {
      if (escaped) escaped = false
      else if (ch === '\\') escaped = true
      else if (ch === '"') inString = false
      continue
    }
    if (ch === '"') inString = true
    else if (ch === '{') stack.push('}')
    else if (ch === '[') stack.push(']')
    else if ((ch === '}' || ch === ']') && stack[stack.length - 1] === ch) stack.pop()
  }
  // 字符串被截断：补一个引号，否则补括号也没意义
  if (inString) out += '"'
  return out + stack.reverse().join('')
}

/** 批量输出里的一组（classId + 该组的模型原始输出）。 */
export interface RawBatchEntry {
  classId: number
  raw: RawNamingOutput
}

/**
 * 从批量输出里取出 `results` 数组（逐组归一）。
 *
 * 与单类解析同一立场：**只做结构提取，不猜内容**。缺项（某组没给结论）不在这里补，
 * 由调用方按"该组模型未给结论"如实降级 —— 补一个空结论出来等于替模型签字。
 */
export function extractBatchResults(raw: RawNamingOutput | null): { entries: RawBatchEntry[]; error: string } {
  if (raw === null) return { entries: [], error: '空响应' }
  const list = (raw as { results?: unknown }).results
  if (!Array.isArray(list)) {
    const keys = Object.keys(raw as Record<string, unknown>).slice(0, 8).join(',')
    return { entries: [], error: `顶层缺少 results 数组（收到的键：${keys || '无'}）` }
  }
  const entries: RawBatchEntry[] = []
  for (const item of list) {
    if (item === null || typeof item !== 'object' || Array.isArray(item)) continue
    const o = item as Record<string, unknown> & RawNamingOutput
    const id = Number(o.class_id ?? o.classId)
    if (!Number.isFinite(id)) continue
    entries.push({ classId: id, raw: o })
  }
  return { entries, error: '' }
}
