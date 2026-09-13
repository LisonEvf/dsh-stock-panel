/**
 * src/lib/selection.ts — 盯盘台的「当前标的」与 UI 状态（跨栏联动的唯一真源）。
 *
 * 三段式布局（左列表 / 主区 / 右 AI 栏）要求三栏读到**同一个当前标的**：
 * 左栏点一下 → 主图换标的 → 右栏 AI 卡换上下文 → 决策卡与图上价位线一起更新。
 * 因此这里放一个模块级 store（与 watchlist-store / alerts 同款模式）：
 * 内存态 + localStorage 持久化 + 订阅通知 + React hook。
 *
 * 持久化键：`stock-panel:ui:v4`（含视图、栏显隐、K 线区间、当前标的）。
 * 旧 v3 键（A6 之前）/ v2 键 / v1 键（`stock-panel:view:v1`）各做一次性迁移，避免升级后丢标的。
 */
import { useEffect, useReducer } from 'react'
import { parseSymbol, toSymbol, type MarketTag } from './symbol'
import { type Stage } from './stage'
import { recordViewed } from './viewed-store'

/** 当前聚焦的标的。 */
export interface Selection {
  market: MarketTag
  code: string
  name: string
}

/**
 * 一级入口 = 方法论两阶段 + **平铺的各个板块**（A6 导航平铺）。
 *
 * A4 时代把「复盘 / 作战 / 看盘」留在一级导航，其余功能全塞进「工具」抽屉（单页分区）。
 * A6 把抽屉拆平：旧抽屉里的**板块直接与复盘 / 作战同级**——它们本来就各自独立取数、
 * 各自有轮询节拍，藏在抽屉里只会多一层"点开工具 → 再找区块"的跳转。
 *
 * 同时下线三处入口（都是"同一件事有两个入口"的重复）：
 *   - 「自选盘」「个股明细」：自选与个股都有左栏（`panel/WatchList.tsx`）常驻列表，
 *     点行即看（`openStockAndWatch`），不必再各有一个整页；
 *   - 「看盘」：它不是流程的一环，而是**点左栏任一行就落到的默认主区**（工作台），
 *     因此不上导航栏 —— 见 `WORKBENCH_VIEW`。
 */
export type PrimaryView = 'review' | 'war' | 'watch' | 'market' | 'concept' | 'scout' | 'alerts' | 'global'

/** 一个一级入口（导航栏标签 + 悬停说明）。 */
export interface ViewEntry {
  id: PrimaryView
  label: string
  hint: string
  /** 次要入口：排在最后、视觉弱化（外盘）。 */
  secondary?: boolean
}

const REVIEW_VIEW: ViewEntry = { id: 'review', label: '复盘', hint: '收盘后/盘前：七步复盘 → 写次日预期清单（1）' }
const WAR_VIEW: ViewEntry = { id: 'war', label: '作战', hint: '竞价→验证窗→盘中→尾盘：页内按时段自动切换（2）' }

/**
 * **工作台**（原「看盘」）：自由查看 —— 左列表 + 主图 + 资金/逐笔/竞价 + 右栏 AI。
 *
 * 刻意**不在** `PRIMARY_VIEWS` 里（A6 决策）：它不是"再一个板块"，而是默认主区 ——
 * 左栏点任意一行、任意页面点股票都会落到这里（`openStockAndWatch`）。
 * 因此它不占导航键位，也永远不会"切走回不来"：左栏随时点一下就回来了。
 */
export const WORKBENCH_VIEW: ViewEntry = {
  id: 'watch',
  label: '工作台',
  hint: '自由看盘：左列表 + 主图 + 资金/逐笔/竞价 + 右栏 AI（点左栏任一行即到）',
}

/**
 * 导航栏上的入口（顺序 = 状态带上从左到右 = `1-9` 键位顺序）。
 *
 * 外盘排最后并标「次要」——它与本插件的定位（A 股盯盘执行台）关系最远。
 */
export const PRIMARY_VIEWS: ViewEntry[] = [
  REVIEW_VIEW,
  WAR_VIEW,
  {
    id: 'market',
    label: '行情',
    hint: '市场总览 + 指数 + 涨停梯队（一页三块；滚到哪块才轮询哪块）（3）',
  },
  {
    id: 'concept',
    label: '自挖板块',
    hint: '无监督共动聚类：市场今天把哪些票当成同一个班（可通过模型命名，护栏逐条核对引文）（4）',
  },
  { id: 'scout', label: '选股筛选', hint: '快照筛选 + MA 信号 + AI 排序（5）' },
  { id: 'alerts', label: '监控规则', hint: '价格/涨跌幅/关键词规则与命中（6）' },
  { id: 'global', label: '外盘', hint: '港股 / 美股 / 期货（次要）（7）', secondary: true },
]

/**
 * 全部一级视图（含不上导航的工作台）。
 *
 * 用途只有一个：**校验**（落盘值可能来自旧版本，见 `viewIdOf`）与 ⌘K 的功能名直达 ——
 * 渲染导航请一律用 `PRIMARY_VIEWS`，否则工作台会"偷偷"回到导航栏上。
 */
export const ALL_VIEWS: ViewEntry[] = [
  REVIEW_VIEW,
  WAR_VIEW,
  WORKBENCH_VIEW,
  ...PRIMARY_VIEWS.slice(2),
]

/**
 * 左栏（盯盘列表）的分组。
 *
 * A4（2026-09-12）收敛为两组：**自选**（手工维护的观察池）+ **个股**（最近看过的，自动积累）。
 * 原来的「涨停」「异动」两组下线：涨停有「行情 › 涨停梯队」、异动并入「行情 › 市场总览」——
 * 左栏只回答「我要盯谁」，不再兼作行情浏览器。
 *
 * A6（导航平铺）之后左栏更重要了：它同时是**自选 / 个股的入口**（「自选盘」「个股明细」
 * 两个整页已下线）—— 点行即看（`openStockAndWatch` → 主区工作台）。
 */
export type LeftGroup = 'watch' | 'viewed'

/** 面板 UI 状态（持久化）。 */
export interface UiState {
  view: PrimaryView
  /** 左栏（盯盘列表）显隐。 */
  leftRail: boolean
  /** 右栏（AI / 决策）显隐。 */
  rightRail: boolean
  /** 左栏当前分组。 */
  leftGroup: LeftGroup
  /** K 线窗口（根）。 */
  klineDays: number
  /** 均线叠加。 */
  showMA: boolean
  /** 最近一次选择的标的（跨刷新保留）。 */
  selection: Selection | null
  /** 阶段手动覆盖：仅当它与真实阶段一致时才生效（见 lib/stage.ts）。 */
  stageOverride: Stage | null
}

const UI_KEY = 'stock-panel:ui:v4'
const LEGACY_KEY = 'stock-panel:view:v1'
/** 旧 v2 键（4 视图时代）→ 迁移其自选/标的等偏好。 */
const LEGACY_UI_V2 = 'stock-panel:ui:v2'
/**
 * 旧 v3 键（A6 之前）→ 一次性迁移。
 *
 * 为什么升键（v3 → v4）：A6 既换了信息架构（抽屉拆平）又换了默认入口（→ 行情），
 * 而 `view` 恰好是"用户上次停在哪"——沿用旧值会让升级后打开还是老地方，
 * 看起来像没改。所以升级后**第一次**打开统一落到 `DEFAULT_VIEW`，其余偏好照常继承
 * （见 `initialViewOf`）。写回 v4 之后不再重置。
 */
const LEGACY_UI_V3 = 'stock-panel:ui:v3'

/**
 * **默认入口 = 行情**（用户决策，2026-09-12）。
 *
 * v1.4 的默认是"按时段落到复盘/作战"（想让新用户第一眼看到"现在该干什么"），
 * 实测这个默认不好用：行情（总览 + 指数 + 涨停梯队）是**任何时段都成立的第一眼**
 * —— 开盘前看昨天收盘结构、盘中看当下广度、收盘后看全天结果，都不需要先猜"现在几点"。
 * 阶段入口仍然一键可达（`1`/`2`），且**跨时段边界仍会自动跟随**（见 `AppShell` 的时段驱动：
 * 用户没手动点过导航时，9:15 / 15:10 这类边界会切到对应阶段入口）。
 *
 * 硬约束：默认值必须是**导航栏上的入口**（`PRIMARY_VIEWS` 之一）——
 * 否则首次打开时状态带没有任何一项高亮，用户不知道自己在哪（单测钉住）。
 */
export const DEFAULT_VIEW: PrimaryView = 'market'

const DEFAULT_UI: UiState = {
  view: DEFAULT_VIEW,
  leftRail: true,
  rightRail: true,
  leftGroup: 'watch',
  klineDays: 120,
  showMA: true,
  selection: null,
  stageOverride: null,
}

const MARKETS: readonly MarketTag[] = ['SH', 'SZ', 'BJ']

function isRecord(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === 'object' && !Array.isArray(v)
}

function isStage(v: unknown): v is Stage {
  return v === 'review' || v === 'auction' || v === 'intraday' || v === 'tail'
}

function asSelection(v: unknown): Selection | null {
  if (!isRecord(v)) return null
  const market = v.market
  if (typeof market !== 'string' || !(MARKETS as readonly string[]).includes(market)) return null
  if (typeof v.code !== 'string' || v.code === '') return null
  return {
    market: market as MarketTag,
    code: v.code,
    name: typeof v.name === 'string' && v.name !== '' ? v.name : v.code,
  }
}

/** 旧版（v1）状态迁移：把当时选中的个股带过来。 */
function migrateLegacy(): Selection | null {
  try {
    const raw = localStorage.getItem(LEGACY_KEY)
    if (raw === null) return null
    const parsed: unknown = JSON.parse(raw)
    if (!isRecord(parsed)) return null
    return asSelection(parsed.stock)
  } catch {
    return null
  }
}

/**
 * 左栏分组归一（A4）。
 * 旧持久化值里的 `limit` / `unusual` 已下线，一律落到「自选」；未知值同。
 * 因此**不需要**再升 UI 键版本：v3 里的旧值会被就地收敛。
 */
function leftGroupOf(v: unknown): LeftGroup {
  return v === 'viewed' ? 'viewed' : 'watch'
}

/** 从旧 v2 状态（4 视图时代）搬走仍然有意义的偏好：标的、栏显隐、K 线窗口。 */
function migrateV2(): Partial<UiState> {
  try {
    const raw = localStorage.getItem(LEGACY_UI_V2)
    if (raw === null) return {}
    const p: unknown = JSON.parse(raw)
    if (!isRecord(p)) return {}
    return {
      leftRail: p.leftRail !== false,
      rightRail: p.rightRail !== false,
      leftGroup: leftGroupOf(p.leftGroup),
      klineDays: typeof p.klineDays === 'number' && p.klineDays >= 20 && p.klineDays <= 1000 ? p.klineDays : DEFAULT_UI.klineDays,
      showMA: p.showMA !== false,
      selection: asSelection(p.selection) ?? migrateLegacy(),
    }
  } catch {
    return { selection: migrateLegacy() }
  }
}

/**
 * 落盘状态里的 `view` → 本次要显示的入口（纯函数，单测钉住）。
 *
 * `fromLegacy` = 这次读到的是**旧键**（A6 之前的 `stock-panel:ui:v3`）。
 * 这是**唯一一次"落点重置"**：A6 改的是信息架构（抽屉拆平 + 默认入口换成行情），
 * 旧键里的 `view`（`war` / `review`）与当年的 `tool` 在新导航里仍然合法，
 * 但"上次停在作战"不该压过用户刚提的"默认显示行情" —— 否则升级后打开还是老地方，
 * 看起来像没改。重置只发生这一次：状态写回新键之后，用户选哪个就记哪个
 * （跨卸载/刷新保持，`ARCHITECTURE.md` §4 的持久化要求不变）。
 */
export function initialViewOf(persisted: unknown, fromLegacy: boolean): PrimaryView {
  if (fromLegacy) return DEFAULT_VIEW
  return viewIdOf(persisted) ?? DEFAULT_VIEW
}

function loadUi(): UiState {
  const migrated = migrateV2()
  // 首次安装（无任何持久化状态）：落到**默认入口**（行情），不再是"按时段猜一个阶段入口"。
  const fallback: UiState = {
    ...DEFAULT_UI,
    ...migrated,
    view: DEFAULT_VIEW,
    selection: migrated.selection ?? migrateLegacy(),
  }
  try {
    const current = localStorage.getItem(UI_KEY)
    const raw = current ?? localStorage.getItem(LEGACY_UI_V3)
    if (raw === null) return fallback
    const p: unknown = JSON.parse(raw)
    if (!isRecord(p)) return fallback
    const view = initialViewOf(p.view, current === null)
    const klineDays = typeof p.klineDays === 'number' && p.klineDays >= 20 && p.klineDays <= 1000 ? p.klineDays : DEFAULT_UI.klineDays
    const leftGroup: LeftGroup = leftGroupOf(p.leftGroup)
    return {
      view,
      leftRail: p.leftRail !== false,
      rightRail: p.rightRail !== false,
      leftGroup,
      klineDays,
      showMA: p.showMA !== false,
      selection: asSelection(p.selection),
      stageOverride: isStage(p.stageOverride) ? p.stageOverride : null,
    }
  } catch {
    return fallback
  }
}

let ui: UiState = loadUi()
const listeners = new Set<() => void>()

function persist(): void {
  try {
    localStorage.setItem(UI_KEY, JSON.stringify(ui))
  } catch {
    /* 隐私模式：忽略 */
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

export function getUi(): UiState {
  return ui
}

/** 局部更新 UI 状态（浅合并 + 落盘 + 通知）。 */
export function updateUi(patch: Partial<UiState>): UiState {
  ui = { ...ui, ...patch }
  persist()
  notify()
  return ui
}

/** 切换一级视图（主区立刻换成该页；工作台也是其中一个值，见 `WORKBENCH_VIEW`）。 */
export function setView(view: PrimaryView): UiState {
  return updateUi({ view })
}

/**
 * 一级视图的**历史 id 归一**。
 *
 * 背景：A4 之后「市场总览 / 指数 / 涨停梯队」合并成了单页 `market`，旧版本把它们
 * 存成三个独立 id 落盘。老用户升级后如果还带着旧值，
 * 表现是"页面打不开"且没有任何报错。所以旧 id 一律就地映射到 `market`
 * （与 `leftGroupOf` 收敛旧分组值同一手法）。
 *
 * A6 之后 `market/concept/scout/alerts/global` 从"工具页 id"变成"一级视图 id"，
 * 恰好同名同义 —— 所以无需再为它们写映射（旧值天然可用）。
 */
export const LEGACY_VIEW_IDS: Record<string, string> = {
  overview: 'market',
  indices: 'market',
  ladder: 'market',
}

/** 落盘/外部传入的 id → 现行一级视图 id（未命中或非法一律 null，不猜）。 */
export function viewIdOf(raw: unknown): PrimaryView | null {
  if (typeof raw !== 'string') return null
  const mapped = LEGACY_VIEW_IDS[raw] ?? raw
  const hit = ALL_VIEWS.find((v) => v.id === mapped)
  return hit === undefined ? null : hit.id
}

/** 手动指定阶段（仅在与真实阶段一致时生效；见 lib/stage.ts 的 resolveStage）。 */
export function setStageOverride(stage: Stage | null): UiState {
  return updateUi({ stageOverride: stage })
}

export function subscribeUi(fn: () => void): () => void {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

/** React hook：UI 状态（任何一栏更新都重渲染）。 */
export function useUi(): UiState {
  const [, force] = useReducer((x: number) => x + 1, 0)
  useEffect(() => subscribeUi(force), [])
  return ui
}

// ────────────────────────────── 当前标的 ──────────────────────────────

export function getSelection(): Selection | null {
  return ui.selection
}

/** 设置当前标的（同标的重复点选不触发更新）。 */
export function setSelection(next: Selection | null): void {
  const cur = ui.selection
  if (next === null && cur === null) return
  if (
    next !== null &&
    cur !== null &&
    next.market === cur.market &&
    next.code === cur.code &&
    next.name === cur.name
  ) {
    return
  }
  ui = { ...ui, selection: next }
  persist()
  notify()
  // A4「个股栏」的数据来源：任何一次设标的都记一次「看过」
  // （左栏/搜索/各列表点行都汇到这里，所以这里是唯一需要埋点的地方）。
  if (next !== null) recordViewed({ market: next.market, code: next.code, name: next.name })
}

/** 按标准符号（SH600519）设置当前标的。 */
export function setSelectionBySymbol(symbol: string, name?: string): void {
  const p = parseSymbol(symbol)
  if (p === null) return
  setSelection({ market: p.market, code: p.code, name: name ?? p.code })
}

/** 当前标的的标准符号（无选择时 null）。 */
export function selectionSymbol(sel: Selection | null = ui.selection): string | null {
  return sel === null ? null : toSymbol(sel.market, sel.code)
}

/**
 * 打开某标的并切到**工作台**（自由看盘）。
 *
 * 各页面/阶段统一用它作为 `onOpenStock`：方法论里「看到异动 → 立刻看图验证量价」
 * 是最高频的一次跳转，必须一键直达图中（而不是跳到一个新"功能页"）。
 *
 * 工作台不上导航栏（见 `WORKBENCH_VIEW`），所以它**永远是"点股票"的去处**：
 * 从复盘/作战/行情/自挖板块点任意一行股票，都会落到同一个主图 + 右栏 AI 的界面。
 */
export function openStockAndWatch(s: Selection): void {
  setSelection({ market: s.market, code: s.code, name: s.name })
  setView('watch')
}

/** React hook：当前标的。 */
export function useSelection(): Selection | null {
  const state = useUi()
  return state.selection
}

// ────────────────────────────── 键盘导航 ──────────────────────────────

const UI_KEY_GUARD = 'stock-panel:nav'

/** 键盘导航状态（左列表内的光标位置由列表组件写入）。 */
export interface NavState {
  /** 左栏列表当前光标索引（-1 = 未进入列表）。 */
  cursor: number
}

let nav: NavState = { cursor: -1 }

export function getNav(): NavState {
  return nav
}

export function setCursor(cursor: number): void {
  if (nav.cursor === cursor) return
  nav = { cursor }
  notify()
}

/** 该元素是否为可编辑控件（键盘快捷键需让位于输入）。 */
export function isEditableTarget(el: EventTarget | null): boolean {
  if (el === null || !(el instanceof HTMLElement)) return false
  const tag = el.tagName
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true
  return el.isContentEditable
}

/** 存储键（调试用）。 */
export const SELECTION_STORAGE_KEYS = { ui: UI_KEY, navGuard: UI_KEY_GUARD }
