/**
 * src/host/board-order.ts —— `board_members` 的**排序契约**在适配层的本地复算（纯函数）。
 *
 * ## 为什么适配层要自己排一遍
 * 数据层（vendored node-tdx）在多页取数时用 `securityList.unshift(...)` 拼页，
 * 于是 `count > 80`（页大小 80）时**页序被反转**：请求 DESC 反而得到"整体升序、
 * 每 80 行块内降序"的列表。2026-09-12 实测：
 *   count=80  → 179.22 … 6.12（正确）
 *   count=160 → 6.06 … 3.79, 179.22 … 6.12（两块颠倒）
 * 全 A 快照正是 `count=6000`，所以"选股筛选"第一屏给出的 60 条是**最弱的命中**
 * （+2.0% 在最前，+6.0% 沉在最后）——而 UI 与用户都以为它是按涨幅排的。
 *
 * 根因已在 node-tdx 修（`unshift` → `push`，见该仓库 src/client/mac-mixin.ts）；
 * 这里再排一遍是**契约兜底**：接口文档写着"含排序"，那就不该依赖下游实现是否守约。
 * 坏掉的排序是"看起来对、其实不是你要的"那类错误 —— 必须在能算的地方自证。
 *
 * 口径：
 *   - 只对**行内有字段可复算**的排序键生效（其余键返回 enforced=false，如实标注）；
 *   - 缺失/非有限值一律排到末尾（DESC 时视为 -∞，ASC 时视为 +∞）；
 *   - 同值用 `code` 兜底保证确定性（同输入必然同输出）。
 */

/** 排序键名 → 行内取值函数（名字取自 node-tdx 的 SortType 枚举）。 */
const KEY_OF_SORT: Record<string, (row: Record<string, unknown>) => number | string | null> = {
  CODE: (r) => str(r.code),
  NAME: (r) => str(r.name),
  PRE_CLOSE: (r) => num(r.pre_close),
  OPEN: (r) => num(r.open),
  HIGH: (r) => num(r.high),
  LOW: (r) => num(r.low),
  PRICE: (r) => num(r.close),
  VOLUME: (r) => num(r.vol),
  TOTAL_AMOUNT: (r) => num(r.amount),
  LAST_VOLUME: (r) => num(r.last_volume),
  CHANGE: (r) => delta(r),
  CHANGE_PCT: (r) => pct(r),
  AMPLITUDE_PCT: (r) => amplitude(r),
  AVG: (r) => num(r.avg_price),
  PE_DYNAMIC: (r) => num(r.pe_dynamic),
  INSIDE_VOLUME: (r) => num(r.inside_volume),
  OUTSIDE_VOLUME: (r) => num(r.outside_volume),
  BID_VOLUME: (r) => num(r.bid_volume),
  ASK_VOLUME: (r) => num(r.ask_volume),
  OPEN_AMOUNT: (r) => num(r.open_amount),
  VOL_RATIO: (r) => num(r.vol_ratio),
  TURNOVER_RATE: (r) => num(r.turnover),
  FLOAT_SHARES: (r) => num(r.float_shares),
  FLOAT_MARKET_CAP: (r) => num(r.circulating_capital_z),
  TOTAL_MARKET_CAP_AB: (r) => num(r.total_market_cap_ab),
  SPEED_PCT: (r) => num(r.speed_pct),
  ACTIVITY: (r) => num(r.activity),
  SHORT_TURNOVER_PCT: (r) => num(r.short_turnover_pct),
  VOL_SPEED_PCT: (r) => num(r.vol_speed_pct),
  MAIN_NET_AMOUNT: (r) => num(r.main_net_amount),
  MAIN_NET_RATIO: (r) => num(r.main_net_ratio),
  AMOUNT_2M: (r) => num(r.amount_2m),
}

/** 可本地复算的排序键（供文档/诊断展示）。 */
export const LOCALLY_SORTABLE_KEYS: readonly string[] = Object.keys(KEY_OF_SORT).sort()

function num(v: unknown): number | null {
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

function str(v: unknown): string | null {
  return typeof v === 'string' && v !== '' ? v : null
}

function pct(r: Record<string, unknown>): number | null {
  const c = num(r.close)
  const p = num(r.pre_close)
  if (c === null || p === null || p === 0) return null
  return ((c - p) / p) * 100
}

function delta(r: Record<string, unknown>): number | null {
  const c = num(r.close)
  const p = num(r.pre_close)
  if (c === null || p === null) return null
  return c - p
}

function amplitude(r: Record<string, unknown>): number | null {
  const h = num(r.high)
  const l = num(r.low)
  const p = num(r.pre_close)
  if (h === null || l === null || p === null || p === 0) return null
  return ((h - l) / p) * 100
}

export interface OrderResult {
  rows: Record<string, unknown>[]
  /** 是否真的按请求的排序键排过（false = 该键无本地可复算字段，顺序仍取自数据层）。 */
  enforced: boolean
  /** enforced=false 时的原因（供诊断/日志，不进用户可见文案）。 */
  reason?: string
}

/**
 * 按请求的排序键/方向重排 `board_members` 结果。
 *
 * @param rows 数据层返回的行（对象数组）
 * @param sortKeyName 排序键名（已通过枚举白名单校验，如 'CHANGE_PCT'）
 * @param orderName 方向（'ASC' / 'DESC' / 'NONE'）
 */
export function orderBoardRows(
  rows: unknown,
  sortKeyName: string,
  orderName: string,
): OrderResult {
  if (!Array.isArray(rows)) return { rows: [], enforced: false, reason: 'rows 不是数组' }
  const list = rows as Record<string, unknown>[]
  const key = KEY_OF_SORT[sortKeyName]
  if (key === undefined) return { rows: list, enforced: false, reason: `排序键 ${sortKeyName} 无本地可复算字段` }
  if (orderName === 'NONE') return { rows: list, enforced: false, reason: 'NONE 表示不排序' }

  const dir = orderName === 'ASC' ? 1 : -1
  // 缺失值排末尾：DESC 视为 -∞，ASC 视为 +∞（乘 dir 之后统一为"最差"）。
  const missing = dir === 1 ? Number.POSITIVE_INFINITY : Number.NEGATIVE_INFINITY

  const sorted = list.slice().sort((a, b) => {
    const va = key(a)
    const vb = key(b)
    const na = va === null ? missing : va
    const nb = vb === null ? missing : vb
    if (typeof na === 'string' || typeof nb === 'string') {
      const sa = String(na)
      const sb = String(nb)
      if (sa !== sb) return sa < sb ? -dir : dir
    } else if (na !== nb) {
      return na < nb ? -dir : dir
    }
    // 兜底：同值按 code 升序，保证确定性
    const ca = String(a.code ?? '')
    const cb = String(b.code ?? '')
    return ca < cb ? -1 : ca > cb ? 1 : 0
  })
  return { rows: sorted, enforced: true }
}
