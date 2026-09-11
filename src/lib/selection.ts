/**
 * src/lib/selection.ts — 盯盘台的「当前标的」与 UI 状态（跨栏联动的唯一真源）。
 *
 * 三段式布局（左列表 / 主区 / 右 AI 栏）要求三栏读到**同一个当前标的**：
 * 左栏点一下 → 主图换标的 → 右栏 AI 卡换上下文 → 决策卡与图上价位线一起更新。
 * 因此这里放一个模块级 store（与 watchlist-store / alerts 同款模式）：
 * 内存态 + localStorage 持久化 + 订阅通知 + React hook。
 *
 * 持久化键：`stock-panel:ui:v2`（含视图、栏显隐、K 线区间、当前标的）。
 * 旧 v1 键（`stock-panel:view:v1`，只有 tab/stock）做一次性迁移，避免升级后丢标的。
 */
import { useEffect, useReducer } from 'react'
import { parseSymbol, toSymbol, type MarketTag } from './symbol'
import { currentStage, STAGES, type Stage } from './stage'

/** 当前聚焦的标的。 */
export interface Selection {
  market: MarketTag
  code: string
  name: string
}

/** 一级入口（**按看盘流程**组织，不按功能组织）。 */
export type PrimaryView = 'review' | 'war' | 'watch'

/**
 * 一级导航 = 方法论两阶段 + 一个自由看盘。
 *
 * 依据 `WATCH-METHODOLOGY.md` §8 固定时间表 与 `PRODUCT-DESIGN.md` §3.1：
 * 「作战」（竞价+盘中+尾盘，页内按时段自动切换）与「复盘」才是方法论的执行界面；
 * 「看盘」保留原有的自由查看习惯（左列表 + 主图 + AI），但它不是流程的一环。
 * 其余功能（总览/指数/梯队/外盘/选股/监控/明细/自选盘）收进「工具」抽屉，
 * 任何时段一键可达——旧习惯不被剥夺，只是不再霸占一级导航。
 */
export const PRIMARY_VIEWS: Array<{ id: PrimaryView; label: string; hint: string }> = [
  { id: 'review', label: '复盘', hint: '收盘后/盘前：七步复盘 → 写次日预期清单（1）' },
  { id: 'war', label: '作战', hint: '竞价→验证窗→盘中→尾盘：页内按时段自动切换（2）' },
  { id: 'watch', label: '看盘', hint: '自由查看：左列表 + 主图 + AI 研判（3）' },
]

/** 工具抽屉条目（旧页面入口，任何时段可达；不属于看盘流程）。 */
export interface ToolEntry {
  id: string
  label: string
  hint: string
  group: '市场' | '研究' | '自选与监控' | '个股'
}

export const TOOL_VIEWS: ToolEntry[] = [
  { id: 'overview', label: '市场总览', hint: '广度 / 涨跌分布 / 榜单 / 异动', group: '市场' },
  { id: 'indices', label: '指数', hint: '9 大指数日K与分时', group: '市场' },
  { id: 'ladder', label: '涨停梯队', hint: '连板梯队 + 板块热度 TOP', group: '市场' },
  { id: 'global', label: '外盘', hint: '港股 / 美股 / 期货', group: '市场' },
  { id: 'scout', label: '选股筛选', hint: '快照筛选 + MA 信号 + AI 排序', group: '研究' },
  { id: 'watchlist', label: '自选盘', hint: '自选表格（加删/清空）', group: '自选与监控' },
  { id: 'alerts', label: '监控规则', hint: '价格/涨跌幅/关键词规则与命中', group: '自选与监控' },
  { id: 'detail', label: '个股明细', hint: '旧版全功能个股页（信息条/筹码/逐笔）', group: '个股' },
]

/**
 * 各一级入口的二级页签。
 * 复盘/作战**没有**二级页签：它们的"二级"就是方法论自身的步骤与时段，
 * 页内已经按流程顺序呈现（七步引导条 / 时段任务条），再切页签反而割裂流程。
 */
export const SUB_VIEWS: Record<PrimaryView, Array<{ id: string; label: string }>> = {
  review: [],
  war: [],
  watch: [
    { id: 'workbench', label: '工作台' },
    { id: 'detail', label: '明细' },
    { id: 'watchlist', label: '自选盘' },
  ],
}

/** 左栏（盯盘列表）的分组。 */
export type LeftGroup = 'watch' | 'limit' | 'unusual'

/** 面板 UI 状态（持久化）。 */
export interface UiState {
  view: PrimaryView
  /** 每个一级视图各自的二级页签（切走再回来保持原位）。 */
  sub: Record<PrimaryView, string>
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
  /** 工具抽屉当前打开的页面 id（null = 未打开，主区显示阶段内容）。 */
  tool: string | null
  /** 阶段手动覆盖：仅当它与真实阶段一致时才生效（见 lib/stage.ts）。 */
  stageOverride: Stage | null
}

const UI_KEY = 'stock-panel:ui:v3'
const LEGACY_KEY = 'stock-panel:view:v1'
/** 旧 v2 键（4 视图时代）→ 迁移其自选/标的等偏好。 */
const LEGACY_UI_V2 = 'stock-panel:ui:v2'

const DEFAULT_UI: UiState = {
  view: 'war',
  sub: { review: '', war: '', watch: 'workbench' },
  leftRail: true,
  rightRail: true,
  leftGroup: 'watch',
  klineDays: 120,
  showMA: true,
  selection: null,
  tool: null,
  stageOverride: null,
}

const MARKETS: readonly MarketTag[] = ['SH', 'SZ', 'BJ']

function isRecord(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === 'object' && !Array.isArray(v)
}

function isPrimaryView(v: unknown): v is PrimaryView {
  return v === 'watch' || v === 'war' || v === 'review'
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

/** 从旧 v2 状态（4 视图时代）搬走仍然有意义的偏好：标的、栏显隐、K 线窗口。 */
function migrateV2(): Partial<UiState> {
  try {
    const raw = localStorage.getItem(LEGACY_UI_V2)
    if (raw === null) return {}
    const p: unknown = JSON.parse(raw)
    if (!isRecord(p)) return {}
    const leftGroup: LeftGroup = p.leftGroup === 'limit' || p.leftGroup === 'unusual' ? p.leftGroup : 'watch'
    return {
      leftRail: p.leftRail !== false,
      rightRail: p.rightRail !== false,
      leftGroup,
      klineDays: typeof p.klineDays === 'number' && p.klineDays >= 20 && p.klineDays <= 1000 ? p.klineDays : DEFAULT_UI.klineDays,
      showMA: p.showMA !== false,
      selection: asSelection(p.selection) ?? migrateLegacy(),
    }
  } catch {
    return { selection: migrateLegacy() }
  }
}

function loadUi(): UiState {
  const migrated = migrateV2()
  // 首次安装（无任何持久化状态）：直接按当前时段落到对应阶段入口，
  // 让新用户第一次打开就看到"现在该干什么"，而不是一个随机入口。
  const firstRun: PrimaryView = STAGES[currentStage()].entry === 'review' ? 'review' : 'war'
  const fallback: UiState = {
    ...DEFAULT_UI,
    ...migrated,
    view: firstRun,
    selection: migrated.selection ?? migrateLegacy(),
  }
  try {
    const raw = localStorage.getItem(UI_KEY)
    if (raw === null) return fallback
    const p: unknown = JSON.parse(raw)
    if (!isRecord(p)) return fallback
    const subRaw = isRecord(p.sub) ? p.sub : {}
    const sub = { ...DEFAULT_UI.sub }
    for (const key of Object.keys(sub) as PrimaryView[]) {
      const v = subRaw[key]
      if (typeof v === 'string' && SUB_VIEWS[key].some((s) => s.id === v)) sub[key] = v
    }
    const view = isPrimaryView(p.view) ? p.view : DEFAULT_UI.view
    const klineDays = typeof p.klineDays === 'number' && p.klineDays >= 20 && p.klineDays <= 1000 ? p.klineDays : DEFAULT_UI.klineDays
    const leftGroup: LeftGroup = p.leftGroup === 'limit' || p.leftGroup === 'unusual' ? p.leftGroup : 'watch'
    const tool = typeof p.tool === 'string' && TOOL_VIEWS.some((t) => t.id === p.tool) ? p.tool : null
    return {
      view,
      sub,
      leftRail: p.leftRail !== false,
      rightRail: p.rightRail !== false,
      leftGroup,
      klineDays,
      showMA: p.showMA !== false,
      selection: asSelection(p.selection),
      tool,
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

/** 切换一级视图（保留各视图自己的二级页签）。切到阶段入口会同时关掉工具抽屉。 */
export function setView(view: PrimaryView): UiState {
  return updateUi({ view, tool: null })
}

/** 切换当前视图的二级页签。 */
export function setSubView(view: PrimaryView, sub: string): UiState {
  if (!SUB_VIEWS[view].some((s) => s.id === sub)) return ui
  return updateUi({ sub: { ...ui.sub, [view]: sub } })
}

/** 打开工具抽屉（主区交给工具页面，阶段/看盘状态不丢）。 */
export function setTool(toolId: string | null): UiState {
  if (toolId !== null && !TOOL_VIEWS.some((t) => t.id === toolId)) return ui
  return updateUi({ tool: toolId })
}

/** 关闭工具抽屉，回到当前阶段内容。 */
export function closeTool(): UiState {
  return updateUi({ tool: null })
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
 * 打开某标的并切到「看盘」（自由查看）。
 *
 * 各页面/阶段统一用它作为 `onOpenStock`：方法论里「看到异动 → 立刻看图验证量价」
 * 是最高频的一次跳转，必须一键直达图中（而不是跳到一个新"功能页"）。
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
