/**
 * src/host/tool-args.ts —— 工具入参校验（纯函数，可离线单测）。
 *
 * **为什么要有这一层**：原来 dispatch 里对枚举一律用「查表失败就回落默认值」的写法
 * （`String(args.sort_type) in SortType ? ... : SortType.CHANGE_PCT`），于是：
 *   - `sort_type: 'AMOUNT'`（枚举里其实叫 TOTAL_AMOUNT）→ **静默**返回按涨幅排的数据，
 *     调用方以为自己拿到了成交额榜（实测：AMOUNT/DESC 与 CHANGE_PCT/DESC 返回完全相同）；
 *   - `args` 不是对象（例如被序列化成字符串）→ 每个字段都读到 undefined，
 *     报出来的却是「invalid ex market: undefined」这种指向错误方向的错。
 * 静默替换语义比报错危险得多：数据看起来是对的，只是**不是你要的那一份**。
 * 因此这里的原则是：**缺省可以给默认值，给了值就必须能在白名单里找到，否则如实报错**
 * （并把收到的原值与允许集合写进错误信息，便于一次定位）。
 *
 * 错误类型由调用方注入（`makeError`），这样本模块不依赖 host 半的错误体系，可被单测直接跑。
 */

/** 入参形状/取值错误（业务类；host 半映射为 TdxToolError）。 */
export class ToolArgError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ToolArgError'
  }
}

/** 枚举对象（TS 数字枚举的运行时形态：名字 → 数字）。 */
export type EnumLike = Record<string, unknown>

/** 取枚举的**名字**列表（过滤掉数字键），稳定排序，用于错误信息与文档。 */
export function enumNames(enumObj: EnumLike): string[] {
  return Object.keys(enumObj)
    .filter((k) => typeof enumObj[k] === 'number')
    .sort()
}

export interface ResolveEnumOptions {
  /** 字段名（进错误信息），如 'sort_type'。 */
  label: string
  /** 缺省值：仅当入参为 undefined/null/'' 时生效。不给则该字段必填。 */
  fallback?: number
  /** 自定义错误构造（默认 ToolArgError）。 */
  makeError?: (message: string) => Error
}

/**
 * 名字 → 枚举值。**未知名字一律报错**，不做静默回落。
 *
 * @returns 枚举数字值（或 fallback）
 */
export function resolveEnum(enumObj: EnumLike, raw: unknown, opts: ResolveEnumOptions): number {
  const make = opts.makeError ?? ((m: string) => new ToolArgError(m))
  if (raw === undefined || raw === null || raw === '') {
    if (opts.fallback !== undefined) return opts.fallback
    throw make(`missing ${opts.label}（允许：${enumNames(enumObj).join('/')}）`)
  }
  const name = String(raw).trim().toUpperCase()
  if (Object.prototype.hasOwnProperty.call(enumObj, name)) {
    const v = enumObj[name]
    if (typeof v === 'number') return v
  }
  throw make(`invalid ${opts.label}: ${JSON.stringify(raw)}（允许：${enumNames(enumObj).join('/')}）`)
}

/**
 * `args` 必须是对象（不是数组、字符串、数字、null）。
 *
 * 为什么单列一条：HTTP 路由把 body 里的 `args` 原样透传，一旦上游发成字符串
 * （例如 PowerShell `ConvertTo-Json` 默认 -Depth 2 会把嵌套哈希表串化），
 * 每个字段都变 undefined，报出来的错会指向完全无关的地方。
 */
export function requireArgsObject(raw: unknown, label = 'args'): Record<string, unknown> {
  if (raw === undefined || raw === null) return {}
  if (typeof raw !== 'object' || Array.isArray(raw)) {
    throw new ToolArgError(`${label} 必须是对象（收到 ${describeType(raw)}）`)
  }
  return raw as Record<string, unknown>
}

function describeType(v: unknown): string {
  if (v === null) return 'null'
  if (Array.isArray(v)) return 'array'
  return typeof v
}

/** 正整数（用于 market_id 这类编号）：缺省给默认，给了就必须是范围内的正整数。 */
export function positiveInt(
  raw: unknown,
  opts: { label: string; min?: number; max?: number; fallback?: number; makeError?: (m: string) => Error },
): number {
  const make = opts.makeError ?? ((m: string) => new ToolArgError(m))
  const min = opts.min ?? 1
  const max = opts.max ?? Number.MAX_SAFE_INTEGER
  if (raw === undefined || raw === null || raw === '') {
    if (opts.fallback !== undefined) return opts.fallback
    throw make(`missing ${opts.label}（需 ${min}~${max} 的整数）`)
  }
  const n = Number(raw)
  if (!Number.isInteger(n) || n < min || n > max) {
    throw make(`invalid ${opts.label}: ${JSON.stringify(raw)}（需 ${min}~${max} 的整数）`)
  }
  return n
}

/** 非负整数（count/start 这类）：给默认、限上界，避免 0/NaN 直接被当成"合法但无意义"的值。 */
export function boundedInt(
  raw: unknown,
  opts: { label: string; min?: number; max?: number; fallback: number; makeError?: (m: string) => Error },
): number {
  const make = opts.makeError ?? ((m: string) => new ToolArgError(m))
  const min = opts.min ?? 0
  const max = opts.max ?? Number.MAX_SAFE_INTEGER
  if (raw === undefined || raw === null || raw === '') return opts.fallback
  const n = Number(raw)
  if (!Number.isFinite(n)) throw make(`invalid ${opts.label}: ${JSON.stringify(raw)}（需数字）`)
  const i = Math.trunc(n)
  if (i < min || i > max) throw make(`invalid ${opts.label}: ${JSON.stringify(raw)}（需 ${min}~${max}）`)
  return i
}
