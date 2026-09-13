/**
 * src/lib/review-draft.ts —— 复盘草稿的**独立持久化**（N10：草稿不再只活在组件 state 里）。
 *
 * ## 为什么需要这个模块（审计实测的丢失路径）
 *
 * 「次日预期清单」是 WATCH-METHODOLOGY 唯一要求留下的产出物（≤5 条 × 7 字段），
 * 但在此之前它只存在 `ReviewPage` 的 `useState` 里（`src/pages/ReviewPage.tsx:143`），
 * 只有点「存档」才写库（同文件 :580-613）。于是这些操作都会把盘后 20 分钟的工作清零：
 *   · 点列表行 / 事件行 / 指数芯片（`ReviewPage.tsx:688/775/817/851/867`）
 *     → `openStockAndWatch` 切到「看盘」→ `ReviewPage` 卸载 → 草稿归零；
 *   · 切一级视图（复盘 ⇄ 作战 ⇄ 看盘）、切宿主标签页 → 同样是卸载 → 同样归零。
 *
 * 本模块把草稿做成**独立于组件生命周期**的一份数据：
 *   · localStorage 键 `dsh-stock-panel:review-draft:v1`（**每次编辑同步立即写**，刷新不丢）；
 *   · host 域表 `review_draft`（A1 的权威介质；推送 1s 防抖，离开页面时立即 flush）。
 *
 * ## 口径（写死在这里，避免"看起来没丢"）
 *
 * 1. **同日草稿**：进复盘页自动恢复到编辑器 —— 这是"离开不丢"的兑现方式；
 * 2. **隔日草稿**：**不自动回填**，只给一次性非阻塞提示，由用户选「载入」或「丢弃」。
 *    理由：昨天的预期清单对今天的计划是过期信息，自动回填会让人误以为"今天的计划已经写好了"
 *    （比丢失更危险）；但它也可能是用户昨晚的劳动，所以**也不静默丢弃**。
 *    在用户处置之前，草稿槽**冻结**（调用方不得自动清空，见 `draftAction` 的用法约束）；
 * 3. **存档成功 → 清草稿**；**存档未落盘 → 草稿原样保留**（失败却清 = 真丢）；
 * 4. **编辑内容与当日已存档快照一致 → 草稿槽清空**（没有未存档改动时不留噪音，
 *    否则每次进页面都会被"草稿已保存"误导，而且会在 host 里堆一份与存档重复的记录）；
 * 5. **空内容（无预期 / 无备注 / 无风向标）→ 草稿槽清空**（不写空壳）。
 *
 * ## 与 `state-tables.ts` 的关系（加表要连带的迁移考虑）
 *
 * `state-tables.ts` 是 host/client 共用的表清单单一来源：本模块用的 `review_draft`
 * 必须同时登记在那里（否则 `keyOfRecord` 取不到记录键 → **静默不同步**），并且：
 *   · **不动 `STATE_DOMAIN_VERSION`**（固定 1）：改它会让已有介质 `open` 直接抛
 *     version-mismatch 且不做迁移 = 把用户既有数据全废掉；新增表在旧域里不存在，
 *     `host-state.ts` 的启动流程会走「域里为空 + 本地有数据 → 首迁上传」，无需额外迁移代码；
 *   · **不动 `review` 表**：`dsh-stock-panel:review:v3` 的 v2→v3 迁移是既有契约，
 *     草稿是**另一个键**，与它互不影响。
 *
 * ## 一个已知的真实风险（本模块主动兜住）
 *
 * host 域是权威：启动 hydrate 时**远程记录会覆盖本地镜像**（`host-state.ts:306-313`）。
 * 若一次编辑还停在 1s 防抖窗口里（或 push 的 fetch 在刷新时被取消），下次打开就会
 * 被旧记录盖掉。所以：`onHostHydrated` 里按「时间戳新的赢」合并（`pickNewerDraft`），
 * 本地更新就重写镜像并补推 host。
 *
 * 纯逻辑（清洗 / 隔日判定 / 清空时机）与本文件的存储读写分离，前者可在 node 里单测
 * （`tests/review-draft.test.ts`）：存储读写带 `typeof localStorage/window` 守卫，
 * 在无 DOM 环境下安全降级为 no-op。
 */

import type { ExpectItem, WindFlagRef, WindFlagTag } from './review-store'
import { onHostHydrated, syncTable } from './host-state'

/** localStorage 键（独立键：不动 review:v3，见文件头）。 */
export const DRAFT_STORAGE_KEY = 'dsh-stock-panel:review-draft:v1'
/** host 域表名（必须与 `state-tables.ts` 的登记一致；表名不允许连字符）。 */
export const DRAFT_TABLE = 'review_draft'
/** 草稿里的预期条数上限（与 WATCH-METHODOLOGY §3.3 的 ≤5 一致）。 */
export const MAX_DRAFT_EXPECTATIONS = 5
/** 草稿里的风向标条数上限（与复盘第六步的 ≤8 一致）。 */
export const MAX_DRAFT_WIND_FLAGS = 8
/** host 侧推送防抖（localStorage 是立即写，这一档只是避免把击键变成磁盘写）。 */
const HOST_SYNC_DELAY_MS = 1000

/**
 * 复盘草稿（localStorage 里是 `[draft]` 或 `[]` —— 与 review 表同为 `array` 形状，
 * 这样 host 的「记录键 = day」映射不需要任何特殊处理）。
 */
export interface ReviewDraft {
  /** 草稿所属日期（YYYY-MM-DD，本地日）—— 也是 host 表里的记录键。 */
  day: string
  /** 最近一次自动保存时间（ms）。 */
  updatedAt: number
  /** 当日「次日预期清单」草稿（≤5）。 */
  expectations: ExpectItem[]
  /** 亏钱共性备注（复盘第五步，与预期清单一同丢失，故一并入草稿）。 */
  riskNote?: string
  /** 风向标（复盘第六步，同上）。 */
  windFlags?: WindFlagRef[]
}

/** 草稿的"编辑内容"（不含 `updatedAt`：时间戳由 `saveDraft` 统一盖，避免调用方各写各的）。 */
export type DraftContent = Omit<ReviewDraft, 'updatedAt'>

/** 当日已存档快照里参与"是否有未存档改动"比较的部分。 */
export interface ArchivedView {
  savedAt: number
  expectations: ExpectItem[]
  riskNote?: string
  windFlags?: WindFlagRef[]
}

/** 进页面时的草稿处置决策。 */
export type DraftEntry =
  | { kind: 'none' } // 没有草稿
  | { kind: 'restore'; draft: ReviewDraft } // 同日：自动恢复
  | { kind: 'stale'; draft: ReviewDraft } // 隔日：不自动恢复，等用户处置

/** 当前编辑内容该怎样处置草稿槽（唯一口径，自动保存与离开前 flush 共用）。 */
export type DraftAction =
  | { kind: 'clear' }
  | { kind: 'save'; content: DraftContent; updatedAt: number }

// ────────────────────────────── 纯逻辑（可单测） ──────────────────────────────

const STATES: readonly ExpectItem['state'][] = [
  'strong',
  'divergence',
  'weak2strong',
  'highRisk',
  'recession',
  'newLow',
]
const LEVELS: readonly ExpectItem['tags']['level'][] = ['low', 'mid', 'high']
const ROLES: readonly ExpectItem['tags']['role'][] = ['leader', 'follower', 'catchup']
const WIND_TAGS: readonly WindFlagTag[] = ['dayLeader', 'rebound', 'lowVolume', 'strongHold', 'other']

function str(v: unknown): string {
  return typeof v === 'string' ? v : ''
}

function oneOf<T extends string>(list: readonly T[], v: unknown): T | null {
  return typeof v === 'string' && (list as readonly string[]).includes(v) ? (v as T) : null
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === 'object' && !Array.isArray(v)
}

/**
 * 一条预期清单的兜底清洗：形状不可救 → 整条丢弃；可救 → 补齐默认值。
 *
 * 为什么要有这一步：草稿是**跨版本、跨设备、可被手改/半截写入**的数据，
 * 而渲染层会直接读 `exp.tags.level`（受控 `<select>`）—— 一条缺 `tags` 的记录
 * 会让整个复盘页白屏。宁可少恢复一条，也不能让页面打不开。
 * 对**合法数据本函数是恒等的**（这一点很重要：否则"恢复→与存档比较"会假阳性）。
 */
export function sanitizeExpectation(value: unknown): ExpectItem | null {
  if (!isPlainObject(value)) return null
  const id = str(value.id)
  const symbol = str(value.symbol)
  const state = oneOf(STATES, value.state)
  if (id === '' || symbol === '' || state === null) return null
  const tags = isPlainObject(value.tags) ? value.tags : {}
  const themeDayRaw = Number(tags.themeDay)
  return {
    id,
    symbol,
    name: str(value.name) || symbol,
    tags: {
      ...(Number.isFinite(themeDayRaw) && themeDayRaw >= 1
        ? { themeDay: Math.min(30, Math.round(themeDayRaw)) }
        : {}),
      level: oneOf(LEVELS, tags.level) ?? 'mid',
      role: oneOf(ROLES, tags.role) ?? 'follower',
    },
    state,
    scenario: str(value.scenario),
    auctionOK: str(value.auctionOK),
    failIf: str(value.failIf),
    reason: str(value.reason),
  }
}

/** 一条风向标的兜底清洗（同 `sanitizeExpectation`：坏数据不阻塞页面）。 */
export function sanitizeWindFlag(value: unknown): WindFlagRef | null {
  if (!isPlainObject(value)) return null
  const symbol = str(value.symbol)
  const tag = oneOf(WIND_TAGS, value.tag)
  if (symbol === '' || tag === null) return null
  return { symbol, name: str(value.name) || symbol, tag }
}

/**
 * 草稿清洗（**损坏数据的兜底**）：认不出形状 → `null`（当作没有草稿，绝不抛）。
 *
 * `day` 必须匹配 `YYYY-MM-DD`：日期是草稿的"归属"，认不出归属就无法判隔日，
 * 也就无法决定"恢复还是提示" → 只能当作坏数据丢弃。
 */
export function sanitizeDraft(value: unknown): ReviewDraft | null {
  if (!isPlainObject(value)) return null
  const day = str(value.day)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return null
  const expectations = Array.isArray(value.expectations)
    ? value.expectations
        .map(sanitizeExpectation)
        .filter((x): x is ExpectItem => x !== null)
        .slice(0, MAX_DRAFT_EXPECTATIONS)
    : []
  const windFlags = Array.isArray(value.windFlags)
    ? value.windFlags
        .map(sanitizeWindFlag)
        .filter((x): x is WindFlagRef => x !== null)
        .slice(0, MAX_DRAFT_WIND_FLAGS)
    : []
  const riskNote = str(value.riskNote)
  const updatedAt = Number(value.updatedAt)
  return {
    day,
    updatedAt: Number.isFinite(updatedAt) && updatedAt > 0 ? updatedAt : 0,
    expectations,
    ...(windFlags.length > 0 ? { windFlags } : {}),
    ...(riskNote.trim() !== '' ? { riskNote } : {}),
  }
}

/**
 * 从「localStorage 形状」的值里读出草稿：**最多留 1 条**。
 *
 * 为什么是"最多 1 条"：草稿槽只服务"当天这一次未存档编辑"。跨日时旧条目毫无价值
 * （口径 2 也不回填），留着只会让 hydrate 的镜像里塞两份记录。多条时按「日期新优先、
 * 同日按 updatedAt 新优先」取第一条（host 域若因多端写入留下多条，也不会读出一个旧的）。
 */
export function readDraftList(value: unknown): ReviewDraft[] {
  if (!Array.isArray(value)) return []
  const list = value.map(sanitizeDraft).filter((d): d is ReviewDraft => d !== null)
  if (list.length === 0) return []
  list.sort((a, b) => (a.day === b.day ? b.updatedAt - a.updatedAt : a.day < b.day ? 1 : -1))
  return [list[0]]
}

/**
 * 两份草稿谁更新（hydrate 合并用）。
 * 口径：日期新的赢；同日比 `updatedAt`（**新的赢**）—— 本地刚写还没推上去的编辑
 * 不能被远程旧记录盖掉（见文件头"已知的真实风险"）。
 */
export function pickNewerDraft(a: ReviewDraft | null, b: ReviewDraft | null): ReviewDraft | null {
  if (a === null) return b
  if (b === null) return a
  if (a.day !== b.day) return a.day > b.day ? a : b
  return a.updatedAt >= b.updatedAt ? a : b
}

/** 进页面时的处置决策（口径 1 / 2，见文件头）。 */
export function draftEntry(draft: ReviewDraft | null, today: string): DraftEntry {
  if (draft === null) return { kind: 'none' }
  return draft.day === today ? { kind: 'restore', draft } : { kind: 'stale', draft }
}

/**
 * 当日存档快照 vs 已恢复的同日草稿：草稿是否更权威（该不该跳过"用存档回填"）。
 *
 * 口径：比时间戳，新的赢。草稿比存档新 = 存档之后又改过；此时若用存档回填，
 * 会把用户刚写的内容盖回旧值，紧接着自动保存又判定"与存档一致"→ **清掉草稿 = 真丢**。
 */
export function preferDraft(draft: ReviewDraft | null, archivedSavedAt: number | null): boolean {
  if (draft === null) return false
  if (archivedSavedAt === null) return true
  return draft.updatedAt >= archivedSavedAt
}

/** 编辑内容是否"空"（没有任何可丢的东西）。 */
export function isDraftContentEmpty(content: DraftContent): boolean {
  return (
    content.expectations.length === 0 &&
    (content.riskNote ?? '').trim() === '' &&
    (content.windFlags ?? []).length === 0
  )
}

/**
 * 预期条目指纹。
 *
 * 为什么不直接 `JSON.stringify` 比较：`JSON.stringify` 对**键序敏感**，
 * 而条目会经过「state → localStorage → sanitize 重建」这条链路，键序不该成为判据
 * （否则"明明没改"也会被判成有改动，或反过来误判成无改动而清掉草稿）。
 */
function expFingerprint(e: ExpectItem): string {
  return [
    e.id,
    e.symbol,
    e.name,
    e.tags.themeDay ?? 1,
    e.tags.level,
    e.tags.role,
    e.state,
    e.scenario,
    e.auctionOK,
    e.failIf,
    e.reason,
  ].join('\u0001')
}

function flagFingerprint(f: WindFlagRef): string {
  return [f.symbol, f.name, f.tag].join('\u0001')
}

/** 编辑内容是否与当日已存档快照一致（一致 = 没有未存档改动 → 草稿该清）。 */
export function matchesArchived(content: DraftContent, archived: ArchivedView | null): boolean {
  if (archived === null) return false
  const a = archived.expectations
  const b = content.expectations
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i += 1) {
    if (expFingerprint(a[i]) !== expFingerprint(b[i])) return false
  }
  if ((content.riskNote ?? '').trim() !== (archived.riskNote ?? '').trim()) return false
  const af = archived.windFlags ?? []
  const bf = content.windFlags ?? []
  if (af.length !== bf.length) return false
  for (let i = 0; i < af.length; i += 1) {
    if (flagFingerprint(af[i]) !== flagFingerprint(bf[i])) return false
  }
  return true
}

/**
 * 当前编辑内容应如何处置草稿槽（**唯一口径**：自动保存、离开前 flush 都走它）：
 *   · 空内容 → 清（口径 5）；
 *   · 与当日存档一致 → 清（口径 4）；
 *   · 其余 → 写（覆盖旧草稿，时间戳 = now）。
 */
export function draftAction(
  content: DraftContent,
  archived: ArchivedView | null,
  now: number,
): DraftAction {
  if (isDraftContentEmpty(content)) return { kind: 'clear' }
  if (matchesArchived(content, archived)) return { kind: 'clear' }
  return { kind: 'save', content, updatedAt: now }
}

/**
 * 草稿槽里已有的内容是否与 `content` 等价（**忽略 `updatedAt`**）。
 *
 * 用途：跳过"没有改动也重写一遍"。没有这一步，每次进页面（自动保存 effect 首跑）
 * 都会刷新 `updatedAt` → 状态标签时间跳一下、还会白推一次 host
 * （host 的记录指纹含 updatedAt，内容相同也会被判成一次变更）。
 */
export function sameDraftContent(draft: ReviewDraft | null, content: DraftContent): boolean {
  if (draft === null) return false
  return matchesArchived(content, {
    savedAt: draft.updatedAt,
    expectations: draft.expectations,
    riskNote: draft.riskNote,
    windFlags: draft.windFlags,
  })
}

/** 时间戳 → `HH:MM`（状态标签用）；没有可信时间戳时给占位，不假装知道。 */
export function formatClock(ts: number): string {
  if (!Number.isFinite(ts) || ts <= 0) return '--:--'
  const d = new Date(ts)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

/** 进页面的一次性提示文案（同日恢复 / 隔日待处置两种口径都走它，UI 只负责摆位置）。 */
export function draftEntryNotice(entry: DraftEntry): string {
  switch (entry.kind) {
    case 'none':
      return ''
    case 'restore':
      return `已恢复上次未存档的草稿（${formatClock(entry.draft.updatedAt)} · 预期 ${entry.draft.expectations.length} 条）——点「存档」才正式入库`
    case 'stale':
      return `${entry.draft.day} 的未存档草稿（预期 ${entry.draft.expectations.length} 条 · ${formatClock(entry.draft.updatedAt)}）：隔日草稿不会自动回填当日计划，请选择「载入」或「丢弃」`
  }
}

// ────────────────────────────── 存储（localStorage 镜像 + host 域） ──────────────────────────────

/**
 * 当前草稿（模块级内存态，跨组件共享 —— 复用 review-store 的模式）。
 *
 * ⚠️ 无 DOM 环境（node 单测）下 `readDraftFromStorage()` 返回 null，模块可安全 import。
 */
let current: ReviewDraft | null = readDraftFromStorage()
const listeners = new Set<() => void>()
/** host 推送防抖句柄（无 `window` 时恒为 null）。 */
let hostSyncTimer: number | null = null

/** 直接读 localStorage（模块初始化 / hydrate 后重读都用它）。损坏数据 → null。 */
export function readDraftFromStorage(): ReviewDraft | null {
  try {
    if (typeof localStorage === 'undefined') return null
    const raw = localStorage.getItem(DRAFT_STORAGE_KEY)
    if (raw === null) return null
    return readDraftList(JSON.parse(raw))[0] ?? null
  } catch {
    // 坏 JSON / 隐私模式：当作"没有草稿"。**不能抛** —— 一份坏数据不该让页面打不开。
    return null
  }
}

function draftList(): ReviewDraft[] {
  return current === null ? [] : [current]
}

/** 写 localStorage 镜像（配额/隐私模式下静默失败：host 域仍是权威介质）。 */
function writeStorage(): void {
  try {
    if (typeof localStorage === 'undefined') return
    if (current === null) localStorage.removeItem(DRAFT_STORAGE_KEY)
    else localStorage.setItem(DRAFT_STORAGE_KEY, JSON.stringify(draftList()))
  } catch {
    /* ignore */
  }
}

function notify(): void {
  for (const fn of listeners) {
    try {
      fn()
    } catch {
      /* ignore */
    }
  }
}

/** 订阅草稿变更（UI 用它刷新「草稿已自动保存 · 12:31」状态标签）。 */
export function subscribeDraft(fn: () => void): () => void {
  listeners.add(fn)
  return () => {
    listeners.delete(fn)
  }
}

/** 当前草稿（同日 / 隔日由调用方用 `draftEntry` 判）。 */
export function getDraft(): ReviewDraft | null {
  return current
}

/**
 * 写入草稿（自动保存的唯一切入点）。
 *
 * localStorage **同步立即写**：草稿只有几 KB，每次都写换来"任何时刻断电都不丢"；
 * host 侧推送 1s 防抖（host 每条记录都要落盘 JSON，逐键推送会把击键变成磁盘写），
 * 离开页面时由 `flushDraft()` 立即补推。
 */
export function saveDraft(content: DraftContent, now: number = Date.now()): ReviewDraft {
  const draft: ReviewDraft = { ...content, updatedAt: now }
  current = draft
  writeStorage()
  notify()
  scheduleHostSync()
  return draft
}

/**
 * 清空草稿槽（存档成功 / 无未存档改动 / 用户明确点「丢弃」时调用）。
 *
 * ⚠️ 隔日草稿在用户处置前**不得**调用它（那会把用户昨晚写的东西删掉）。
 */
export function clearDraft(): void {
  // 幂等：本来就是空槽就不动（否则每次进页面都会产生一次无意义的通知 + host 空同步）
  if (current === null) return
  current = null
  writeStorage()
  notify()
  scheduleHostSync()
}

/**
 * 立即把草稿推给 host（离开页面 / 卸载前调用）。
 *
 * 为什么必须补这一手：`host-state.ts:306-313` 在启动 hydrate 时**用远程记录覆盖本地镜像**，
 * 停在防抖窗口里的编辑若没推上去，下次打开会被旧记录盖掉（`pickNewerDraft` 是第二道保险）。
 */
export function flushDraft(): void {
  if (hostSyncTimer !== null) {
    window.clearTimeout(hostSyncTimer)
    hostSyncTimer = null
  }
  void syncTable(DRAFT_TABLE, draftList())
}

function scheduleHostSync(): void {
  if (typeof window === 'undefined') return
  if (hostSyncTimer !== null) window.clearTimeout(hostSyncTimer)
  hostSyncTimer = window.setTimeout(() => {
    hostSyncTimer = null
    void syncTable(DRAFT_TABLE, draftList())
  }, HOST_SYNC_DELAY_MS)
}

// A1：host 域数据落地后按「新的赢」合并，并重写镜像 / 补推（见文件头"已知的真实风险"）。
onHostHydrated(() => {
  const merged = pickNewerDraft(readDraftFromStorage(), current)
  current = merged
  // 无条件重写镜像：host hydrate 已经把远程（可能更旧）的值写进了 localStorage
  writeStorage()
  notify()
  // 本地更新（或本地非空）→ 补推，把远程旧记录盖回去
  if (current !== null) scheduleHostSync()
})
