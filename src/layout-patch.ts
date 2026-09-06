/**
 * src/layout-patch.ts — dsh-client-ui-layout 布局补丁引擎（随 lib 交付，单一事实源）。
 *
 * 背景：DSH 的 ui-layout 是编译产物，只渲染 sidebar | center | details 三列，
 * 官方 Slots 没有"插件声明第四列"的扩展位。本插件为「A股量化工作台」新增最右
 * stock 列 + 对话区 conversationSeat 包裹，只能对编译后的
 * `dsh-client-ui-layout/lib/client.js` 做精确、幂等的字节级替换。
 *
 * 本模块把【锚点数据 + 应用 / 还原 / 检测逻辑】全部内嵌，编译后随 lib/ 一起
 * 进发布物（package.json `files` 白名单）。host 半（src/index.ts）在 apply 内
 * **同步**调用 `ensureLayoutPatchAtBoot()`，保证：
 *   1. 全新 profile 上 `dsh plugin --profile web add` 后，下次启动自动打上补丁，
 *      无需任何手动步骤（不再依赖仓库外置的 scripts/*.mjs）；
 *   2. DSH 升级还原 bundle 后能自动重打；
 *   3. 锚点失配时**中止不写**、醒目告警，绝不破坏宿主 bundle；
 *   4. 提供反向还原（卸载/清理时把 bundle 还原成 pristine 备份）。
 *
 * 版本门控：锚点只对 SUPPORTED_UI_LAYOUT_VERSION 对应的编译构建验证过。若实际
 * 安装版本不符会醒目告警，但仍会尝试（每个替换都校验锚点恰好出现一次，全过才
 * 写，因此失配只会中止，不会写坏）；锚点更新后请同步更新该常量。
 */

import { copyFileSync, existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'

/** 日志前缀（与 client 半一致）。 */
const TAG = '[stock-panel]'

/**
 * 锚点表绑定到的 ui-layout 构建版本（实测 npm 注册表 rc.2 构建）。
 * 注意：必须与 src/layout-patch.ts 的替换锚点一起维护；UI_LAYOUT 升级导致
 * 锚点失配时，从这里开始核对并更新整个 REPLACEMENTS / DESKTOP_CI_ANCHOR。
 */
export const SUPPORTED_UI_LAYOUT_VERSION = '0.1.1-rc.2'

/**
 * stock 列补丁的锚点标记（注入后应全部存在）。
 *
 * 注意：补丁只新增顶层 slot 注册（apply.children.stockPreview），并不会在渲染
 * 层产生字面量 `renderSlot("stock.preview"`，所以这里不能把它当检测标记，
 * 否则每次启动检测都会误判"未打补丁"，空跑一次替换。
 */
export const PATCHED_MARKERS = [
  '"stockCol": "pI_x6G_stockCol"',
  'setStock: (d, px) => {',
  'renderSlot("stock"',
  'conversationSeat',
] as const

/** @param lines - 每行一段；调用方用 \t 转义控制缩进。 */
const L = (...lines: string[]): string => lines.join('\n')

export interface LayoutPatchResult {
  status:
    | 'already-patched'
    | 'patched'
    | 'no-target'
    | 'already-clean'
    | 'reverted'
    | 'no-backup'
    | 'failed'
  /** 实际（realpath 后）目标文件。 */
  target?: string
  /** 命中的构建变体：npm | desktop-ci。 */
  variant?: string
  /** 失败原因（锚点失配等）。 */
  failures?: string[]
  detail?: string
}

/** 一条精确替换：`anchor` 在文件中必须恰好出现一次。 */
interface Replacement {
  id: string
  anchor: string
  replacement: string
}

// ── npm 注册表构建变体的锚点表（与旧 scripts/patch-layout.mjs 逐字一致）──────

const NPM_REPLACEMENTS: Replacement[] = [
  {
    // 新增 stock 列的 CSS 类（背景 / 右边框 / 可滚动）。
    id: 'css.stockCol.rule',
    anchor: '.pI_x6G_detailsCol{border-left:1px solid var(--dsw-alias-border-l2);min-width:0;overflow:hidden}',
    replacement:
      '.pI_x6G_detailsCol{border-left:1px solid var(--dsw-alias-border-l2);min-width:0;overflow:hidden}.pI_x6G_stockCol{background:var(--dsw-specific-sidebar-fill);border-right:1px solid var(--dsw-alias-border-l1);min-width:0;overflow:hidden}',
  },
  {
    // stock 列拖拽句柄的 :after 内容（与 details 列并列）。
    id: 'css.stockCol.handleContent',
    anchor: '.pI_x6G_handle[data-side=details]:after{',
    replacement: '.pI_x6G_handle[data-side=details]:after,.pI_x6G_handle[data-side=stock]:after{',
  },
  {
    // stock 句柄 hover / dragging 时显示 grip 图标（opacity:1）。
    id: 'css.stockCol.handleOpacity',
    anchor: '.pI_x6G_detailsCol:hover~.pI_x6G_handle[data-side=details]:after,.pI_x6G_handle[data-side=details]:hover:after,.pI_x6G_handle[data-side=details][data-dragging=true]:after{opacity:1}',
    replacement:
      '.pI_x6G_detailsCol:hover~.pI_x6G_handle[data-side=details]:after,.pI_x6G_handle[data-side=details]:hover:after,.pI_x6G_handle[data-side=details][data-dragging=true]:after{opacity:1}.pI_x6G_stockCol:hover~.pI_x6G_handle[data-side=stock]:after,.pI_x6G_handle[data-side=stock]:hover:after,.pI_x6G_handle[data-side=stock][data-dragging=true]:after{opacity:1}',
  },
  {
    // stock 句柄 hover / dragging 的悬浮按钮背景 / 边框。
    id: 'css.stockCol.handleHover',
    anchor: '.pI_x6G_handle[data-side=details]:hover:after,.pI_x6G_handle[data-side=details][data-dragging=true]:after{background:var(--dsw-alias-button-floating-hover);border-color:var(--dsw-alias-border-l3)}',
    replacement:
      '.pI_x6G_handle[data-side=details]:hover:after,.pI_x6G_handle[data-side=details][data-dragging=true]:after{background:var(--dsw-alias-button-floating-hover);border-color:var(--dsw-alias-border-l3)}.pI_x6G_handle[data-side=stock]:hover:after,.pI_x6G_handle[data-side=stock][data-dragging=true]:after{background:var(--dsw-alias-button-floating-hover);border-color:var(--dsw-alias-border-l3)}',
  },
  {
    // classMap 注册 stock 列的 utility class。
    id: 'css.classMap.stockCol',
    anchor: '"centerCol": "pI_x6G_centerCol"',
    replacement: '"centerCol": "pI_x6G_centerCol",\n\t\t\t"stockCol": "pI_x6G_stockCol"',
  },
  {
    // 布局计算新增 stock 列宽度（在 sidebar 与 center 之间）。
    id: 'computeColumns',
    anchor: L(
      'function computeColumns(viewport, sidebar, details) {',
      '\t\t\tconst s = sidebar === 0 ? 56 : clampWidth(sidebar, 264, 420);',
      '\t\t\tconst d0 = details === 0 ? 0 : clampWidth(details, 300, 520);',
      '\t\t\tif (s + d0 + 640 <= viewport) return {',
      '\t\t\t\tsidebar: s,',
      '\t\t\t\tcenter: viewport - s - d0,',
      '\t\t\t\tdetails: d0',
      '\t\t\t};',
      '\t\t\tconst d1 = d0 === 0 ? 0 : Math.max(300, viewport - s - 640);',
      '\t\t\tif (s + d1 + 640 <= viewport) return {',
      '\t\t\t\tsidebar: s,',
      '\t\t\t\tcenter: 640,',
      '\t\t\t\tdetails: d1',
      '\t\t\t};',
      '\t\t\treturn {',
      '\t\t\t\tsidebar: s,',
      '\t\t\t\tcenter: Math.max(0, viewport - s),',
      '\t\t\t\tdetails: 0',
      '\t\t\t};',
      '\t\t}',
    ),
    replacement: L(
      'function computeColumns(viewport, sidebar, stock, details) {',
      '\t\t\tconst s = sidebar === 0 ? 56 : clampWidth(sidebar, 264, 420);',
      '\t\t\tconst k0 = stock === 0 ? 0 : clampWidth(stock, 200, 420);',
      '\t\t\tconst d0 = details === 0 ? 0 : clampWidth(details, 300, 520);',
      '\t\t\tif (s + k0 + d0 + 640 <= viewport) return {',
      '\t\t\t\tsidebar: s,',
      '\t\t\t\tstock: k0,',
      '\t\t\t\tcenter: viewport - s - k0 - d0,',
      '\t\t\t\tdetails: d0',
      '\t\t\t};',
      '\t\t\tconst d1 = d0 === 0 ? 0 : Math.max(300, viewport - s - k0 - 640);',
      '\t\t\tif (s + k0 + d1 + 640 <= viewport) return {',
      '\t\t\t\tsidebar: s,',
      '\t\t\t\tstock: k0,',
      '\t\t\t\tcenter: 640,',
      '\t\t\t\tdetails: d1',
      '\t\t\t};',
      '\t\t\treturn {',
      '\t\t\t\tsidebar: s,',
      '\t\t\t\tstock: k0,',
      '\t\t\t\tcenter: Math.max(0, viewport - s - k0),',
      '\t\t\t\tdetails: 0',
      '\t\t\t};',
      '\t\t}',
    ),
  },
  {
    // store 初始化给 stock 列一个默认宽度。
    id: 'store.init.stock',
    anchor: '\t\t\t\t\tsidebar: 280,\n\t\t\t\t\tdetails: 0,',
    replacement: '\t\t\t\t\tsidebar: 280,\n\t\t\t\t\tstock: 360,\n\t\t\t\t\tdetails: 0,',
  },
  {
    // store action 新增 setStock。
    id: 'store.action.setStock',
    anchor:
      '\t\t\t\t\tsetDetails: (d, px) => {\n\t\t\t\t\t\td.details = clampWidth(px, 300, 520);\n\t\t\t\t\t},',
    replacement:
      '\t\t\t\t\tsetDetails: (d, px) => {\n\t\t\t\t\t\td.details = clampWidth(px, 300, 520);\n\t\t\t\t\t},\n\t\t\t\t\tsetStock: (d, px) => {\n\t\t\t\t\t\td.stock = clampWidth(px, 200, 420);\n\t\t\t\t\t},',
  },
  {
    // AppFrame 调用 computeColumns 时传入 stock 列宽。
    id: 'appframe.computeCall',
    anchor:
      'const cols = computeColumns(viewport, sidebarCollapsed ? 0 : panels.sidebar === 0 ? 280 : panels.sidebar, detailsSession === void 0 ? 0 : panels.details);',
    replacement:
      'const stockEffective = narrow ? 0 : panels.stock;\n\t\t\tconst cols = computeColumns(viewport, sidebarCollapsed ? 0 : panels.sidebar === 0 ? 280 : panels.sidebar, stockEffective, detailsSession === void 0 ? 0 : panels.details);',
  },
  {
    // AppFrame 为 stock 列加一个 drag baseline ref。
    id: 'appframe.stockBase',
    anchor: 'const detailsBase = (0, react.useRef)(0);',
    replacement: 'const detailsBase = (0, react.useRef)(0);\n\t\t\tconst stockBase = (0, react.useRef)(0);',
  },
  {
    // AppFrame 为 stock 列加拖拽回调。
    id: 'appframe.stockDragCallbacks',
    anchor: L(
      '\t\t\tconst onDetailsDrag = (0, react.useCallback)((dx) => {',
      '\t\t\t\tactions.setDetails(detailsBase.current - dx);',
      '\t\t\t}, [actions]);',
    ),
    replacement: L(
      '\t\t\tconst onDetailsDrag = (0, react.useCallback)((dx) => {',
      '\t\t\t\tactions.setDetails(detailsBase.current - dx);',
      '\t\t\t}, [actions]);',
      '\t\t\tconst onStockStart = (0, react.useCallback)(() => {',
      '\t\t\t\tstockBase.current = colsRef.current.stock;',
      '\t\t\t\tsetDragging(true);',
      '\t\t\t}, []);',
      '\t\t\tconst onStockDrag = (0, react.useCallback)((dx) => {',
      '\t\t\t\tactions.setStock(stockBase.current - dx);',
      '\t\t\t}, [actions]);',
    ),
  },
  {
    // gridTemplateColumns 把 stock 列放到最右侧（details 之后）。
    id: 'appframe.gridTemplate',
    anchor: 'gridTemplateColumns: `${cols.sidebar}px minmax(0, 1fr) ${cols.details}px`',
    replacement:
      'gridTemplateColumns: `${cols.sidebar}px minmax(0, 1fr) ${cols.details}px ${cols.stock}px`',
  },
  {
    // data-* 标记 stock 列是否收起。
    id: 'appframe.dataStockCollapsed',
    anchor: '"data-details-collapsed": cols.details === 0 || void 0,',
    replacement:
      '"data-details-collapsed": cols.details === 0 || void 0,\n\t\t\t\t"data-stock-collapsed": cols.stock === 0 || void 0,',
  },
  {
    // CenterColumn 改横向排列（row）：内部是 stock.preview + conversationSeat
    // 并排，否则 flex-direction:column 会让它们竖向堆叠、占满整列高度。
    id: 'css.centerSplit',
    anchor: '.pI_x6G_centerCol{flex-direction:column;min-width:0;display:flex;overflow:hidden}',
    replacement:
      '.pI_x6G_centerCol{flex-direction:row;min-width:0;display:flex;overflow:hidden}.pI_x6G_conversationSeat{flex:1 1 0;min-width:0;overflow:hidden}',
  },
  {
    // classMap 注册 conversationSeat（供 stockColumn 内联引用）。
    id: 'css.classMap.conversationSeat',
    anchor: '"centerCol": "pI_x6G_centerCol"',
    replacement:
      '"centerCol": "pI_x6G_centerCol",\n\t\t\t"conversationSeat": "pI_x6G_conversationSeat"',
  },
  {
    // CenterColumn 内部：[conversationSeat(对话) + stock 列]。
    // 注意：不在 center 行内渲染 stock.preview（否则它会与对话争宽度、
    // 压垮输入框所在区域）；工作台列只落在最右侧的 stock 网格列里。
    id: 'appframe.centerSplit',
    anchor:
      '\t\t\t\t\t(0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [(0, react_jsx_runtime.jsx)(CenterColumn, { children: renderSlot("conversation", {}) }), (0, react_jsx_runtime.jsx)(DetailsColumn, { children: renderSlot("details", {}) })] }),',
    replacement: L(
      '\t\t\t\t\t(0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [(0, react_jsx_runtime.jsx)(CenterColumn, { children: (0, react_jsx_runtime.jsx)("div", { className: AppFrame_module_css_default.conversationSeat, children: renderSlot("conversation", {}) }) }), (0, react_jsx_runtime.jsx)(DetailsColumn, { children: renderSlot("details", {}) }), (0, react_jsx_runtime.jsx)("div", { className: AppFrame_module_css_default.stockCol, children: renderSlot("stock", { width: cols.stock }) })] }),',
    ),
  },
  {
    // stock 列拖拽句柄（在 details 与 stock 之间，即 stock 列左边缘）。
    id: 'appframe.stockHandle',
    anchor:
      '\t\t\t\t\tcols.details > 0 && (0, react_jsx_runtime.jsx)(DragHandle, {',
    replacement: L(
      '\t\t\t\t\tcols.stock > 0 && (0, react_jsx_runtime.jsx)(DragHandle, {',
      '\t\t\t\t\t\tside: "stock",',
      '\t\t\t\t\t\tleft: viewport - cols.details - cols.stock,',
      '\t\t\t\t\t\tonStart: onStockStart,',
      '\t\t\t\t\t\tonDrag: onStockDrag,',
      '\t\t\t\t\t\tonEnd: onDragEnd',
      '\t\t\t\t\t}),',
      '\t\t\t\t\tcols.details > 0 && (0, react_jsx_runtime.jsx)(DragHandle, {',
    ),
  },
  {
    // apply.children 注册 "stock" 顶层 slot（与 sidebar 并列）。
    id: 'apply.children.stock',
    anchor: L(
      '\t\t\t\t\t\t"sidebar": {',
      '\t\t\t\t\t\t\tkind: "single",',
      '\t\t\t\t\t\t\tscope: "root"',
      '\t\t\t\t\t\t},',
    ),
    replacement: L(
      '\t\t\t\t\t\t"sidebar": {',
      '\t\t\t\t\t\t\tkind: "single",',
      '\t\t\t\t\t\t\tscope: "root"',
      '\t\t\t\t\t\t},',
      '\t\t\t\t\t\t"stock": {',
      '\t\t\t\t\t\t\tkind: "single",',
      '\t\t\t\t\t\t\tscope: "root"',
      '\t\t\t\t\t\t},',
    ),
  },
  {
    // apply.children 注册 "stock.preview" 子槽（供 client 半引用；
    // 即使不渲染也不影响，保持与 workbench 一致的结构）。
    id: 'apply.children.stockPreview',
    anchor: L(
      '\t\t\t\t\t\t"stock": {',
      '\t\t\t\t\t\t\tkind: "single",',
      '\t\t\t\t\t\t\tscope: "root"',
      '\t\t\t\t\t\t},',
    ),
    replacement: L(
      '\t\t\t\t\t\t"stock": {',
      '\t\t\t\t\t\t\tkind: "single",',
      '\t\t\t\t\t\t\tscope: "root"',
      '\t\t\t\t\t\t},',
      '\t\t\t\t\t\t"stock.preview": {',
      '\t\t\t\t\t\t\tkind: "single",',
      '\t\t\t\t\t\t\tscope: "root"',
      '\t\t\t\t\t\t},',
    ),
  },
]

// ── desktop-ci 变体：同一张表，仅 computeColumns 换成 desktop 构建锚点 ─────────
// （从真实 DSH Desktop 打包版 ui-layout bundle 机械提取；2 空格缩进 + 偶发 CRLF。）

const DESKTOP_CI_COMPUTE_COLUMNS: Replacement = {
  id: 'computeColumns',
  anchor: L(
    'function computeColumns(viewport, sidebar, details) {',
    '\t\t\tconst s = sidebar === 0 ? 56 : clampWidth(sidebar, 264, 420);',
    '\t\t\tconst d0 = details === 0 ? 0 : clampWidth(details, 300, 520);',
    '\t\t\tif (s + d0 + 640 <= viewport) return {',
    '\t\t\t\tsidebar: s,',
    '\t\t\t\tcenter: viewport - s - d0,',
    '\t\t\t\tdetails: d0',
    '\t\t\t};',
    '\t\t\tconst d1 = d0 === 0 ? 0 : Math.max(300, viewport - s - 640);',
    '\t\t\tif (s + d1 + 640 <= viewport) return {',
    '\t\t\t\tsidebar: s,',
    '\t\t\t\tcenter: 640,',
    '\t\t\t\tdetails: d1',
    '\t\t\t};',
    '\t\t\treturn {',
    '\t\t\t\tsidebar: s,',
    '\t\t\t\tcenter: Math.max(0, viewport - s),',
    '\t\t\t\tdetails: 0',
    '\t\t\t};',
    '\t\t}',
  ),
  replacement: L(
    'function computeColumns(viewport, sidebar, stock, details) {',
    '\t\t\tconst s = sidebar === 0 ? 56 : clampWidth(sidebar, 264, 420);',
    '\t\t\tconst k0 = stock === 0 ? 0 : clampWidth(stock, 200, 420);',
    '\t\t\tconst d0 = details === 0 ? 0 : clampWidth(details, 300, 520);',
    '\t\t\tif (s + k0 + d0 + 640 <= viewport) return {',
    '\t\t\t\tsidebar: s,',
    '\t\t\t\tstock: k0,',
    '\t\t\t\tcenter: viewport - s - k0 - d0,',
    '\t\t\t\tdetails: d0',
    '\t\t\t};',
    '\t\t\tconst d1 = d0 === 0 ? 0 : Math.max(300, viewport - s - k0 - 640);',
    '\t\t\tif (s + k0 + d1 + 640 <= viewport) return {',
    '\t\t\t\tsidebar: s,',
    '\t\t\t\tstock: k0,',
    '\t\t\t\tcenter: 640,',
    '\t\t\t\tdetails: d1',
    '\t\t\t};',
    '\t\t\treturn {',
    '\t\t\t\tsidebar: s,',
    '\t\t\t\tstock: k0,',
    '\t\t\t\tcenter: Math.max(0, viewport - s - k0),',
    '\t\t\t\tdetails: 0',
    '\t\t\t};',
    '\t\t}',
  ),
}

interface Variant {
  id: 'npm' | 'desktop-ci'
  replacements: Replacement[]
}

const VARIANTS: Variant[] = [
  { id: 'npm', replacements: NPM_REPLACEMENTS },
  {
    id: 'desktop-ci',
    replacements: NPM_REPLACEMENTS.map((item) =>
      item.id === 'computeColumns' ? DESKTOP_CI_COMPUTE_COLUMNS : item
    ),
  },
]

// ── 路径解析 ────────────────────────────────────────────────────────────────

/** DSH home（环境变量优先，默认 ~/.dsh）。 */
export function dshHomeDir(): string {
  return process.env.DSH_HOME ?? join(homedir(), '.dsh')
}

/** 已安装 ui-layout client bundle 路径（profile node_modules junction）。 */
export function uiLayoutClientPath(dshHome = dshHomeDir()): string {
  return join(dshHome, 'profiles', 'node_modules', '@deepseek-ai', 'dsh-client-ui-layout', 'lib', 'client.js')
}

/** 已安装 ui-layout 包目录（读 package.json 做版本门控）。 */
export function uiLayoutPackageDir(dshHome = dshHomeDir()): string {
  return join(dshHome, 'profiles', 'node_modules', '@deepseek-ai', 'dsh-client-ui-layout')
}

/** 已安装 ui-layout 版本；读取失败返回 undefined。 */
export function installedUiLayoutVersion(dshHome = dshHomeDir()): string | undefined {
  try {
    const manifest = JSON.parse(readFileSync(join(uiLayoutPackageDir(dshHome), 'package.json'), 'utf8')) as {
      version?: string
    }
    return manifest.version
  } catch {
    return undefined
  }
}

/** pristine 备份目录（放 DSH_HOME，安装副本可能在只读 store 里，不能写包内）。 */
function backupDir(dshHome: string): string {
  return join(dshHome, 'patches', 'layout.backup')
}

function pristinePath(dshHome: string): string {
  return join(backupDir(dshHome), 'client.js.orig')
}

// ── 核心替换逻辑 ─────────────────────────────────────────────────────────────

function countOccurrences(haystack: string, needle: string): number {
  if (needle.length === 0) return 0
  let count = 0
  let index = haystack.indexOf(needle)
  while (index !== -1) {
    count += 1
    index = haystack.indexOf(needle, index + needle.length)
  }
  return count
}

function applyReplacements(original: string, replacements: Replacement[]): { patched: string; failures: string[] } {
  let patched = original
  const failures: string[] = []
  for (const item of replacements) {
    const count = countOccurrences(patched, item.anchor)
    if (count === 0) {
      failures.push(`${item.id}: anchor not found`)
      continue
    }
    if (count > 1) {
      failures.push(`${item.id}: anchor found ${count} times (expected exactly 1)`)
      continue
    }
    patched = patched.replace(item.anchor, item.replacement)
  }
  return { patched, failures }
}

function isPatched(text: string): boolean {
  return PATCHED_MARKERS.every((marker) => text.includes(marker))
}

/**
 * 应用布局补丁（同步、幂等）。不做版本门控（门控在 ensureLayoutPatchAtBoot
 * 里以告警形式提示）；每个替换校验锚点恰好一次，全部成功才写文件。
 */
export function applyLayoutPatch(opts: {
  target?: string
  force?: boolean
  dshHome?: string
} = {}): LayoutPatchResult {
  const dshHome = opts.dshHome ?? dshHomeDir()
  const target = resolveExistingTarget(opts.target, dshHome)
  if (!target) return { status: 'no-target', target: opts.target ?? uiLayoutClientPath(dshHome) }

  const real = realpathSync(target)
  const original = readFileSync(real, 'utf8')

  const alreadyPatched = isPatched(original)
  if (alreadyPatched && !opts.force) return { status: 'already-patched', target: real }

  // force 语义：从 pristine 备份重建（而不是在已打补丁内容上重复替换——
  // 那会让多数锚点出现两次而中止）。无备份时退化为对当前内容重打。
  const base = alreadyPatched && opts.force && existsSync(pristinePath(dshHome))
    ? readFileSync(pristinePath(dshHome), 'utf8')
    : original

  const trials = VARIANTS.map((variant) => ({ id: variant.id, ...applyReplacements(base, variant.replacements) }))
  const chosen = trials.find((trial) => trial.failures.length === 0)
  if (!chosen) {
    const lines: string[] = []
    for (const trial of trials) {
      lines.push(`  variant "${trial.id}":`)
      for (const failure of trial.failures) lines.push(`    - ${failure}`)
    }
    return { status: 'failed', target: real, failures: lines, detail: 'bundle matches no known build variant' }
  }

  // 备份 pristine（首次）或追加带时间戳的 .bak（后续重打）。
  try {
    mkdirSync(backupDir(dshHome), { recursive: true })
    const pristine = pristinePath(dshHome)
    if (!existsSync(pristine)) {
      copyFileSync(real, pristine)
    } else {
      const stamp = new Date().toISOString().replace(/[:.]/g, '-')
      copyFileSync(real, join(backupDir(dshHome), `client.js.${stamp}.bak`))
    }
  } catch {
    // 备份失败不阻断（不影响本次补丁）。
  }

  const missingMarkers = PATCHED_MARKERS.filter((marker) => !chosen.patched.includes(marker))
  if (missingMarkers.length > 0) {
    return {
      status: 'failed',
      target: real,
      failures: missingMarkers.map((marker) => `marker missing: ${marker}`),
      detail: 'replacement set produced no verifiable patch',
    }
  }

  writeFileSync(real, chosen.patched, 'utf8')
  return { status: 'patched', target: real, variant: chosen.id }
}

/** 用 pristine 备份还原 bundle；无备份或已干净时分别返回对应状态。 */
export function revertLayoutPatch(opts: {
  target?: string
  dshHome?: string
  force?: boolean
} = {}): LayoutPatchResult {
  const dshHome = opts.dshHome ?? dshHomeDir()
  const target = resolveExistingTarget(opts.target, dshHome)
  if (!target) return { status: 'no-target', target: opts.target ?? uiLayoutClientPath(dshHome) }

  const real = realpathSync(target)
  const original = readFileSync(real, 'utf8')
  if (!isPatched(original) && !opts.force) return { status: 'already-clean', target: real }

  const pristine = pristinePath(dshHome)
  if (!existsSync(pristine)) return { status: 'no-backup', target: real }

  writeFileSync(real, readFileSync(pristine, 'utf8'), 'utf8')
  return { status: 'reverted', target: real }
}

/** 当前布局补丁状态（诊断 / scripts CLI --check 用）。 */
export function layoutPatchState(dshHome = dshHomeDir()): {
  clientPath: string
  exists: boolean
  patched: boolean | null
  version?: string
  expectedVersion: string
  backupExists: boolean
} {
  const clientPath = uiLayoutClientPath(dshHome)
  let exists = false
  let patched: boolean | null = null
  try {
    exists = existsSync(clientPath)
    if (exists) patched = isPatched(readFileSync(clientPath, 'utf8'))
  } catch {
    // 保持 exists 判定结果，patched 为 null
  }
  return {
    clientPath,
    exists,
    patched,
    version: installedUiLayoutVersion(dshHome),
    expectedVersion: SUPPORTED_UI_LAYOUT_VERSION,
    backupExists: existsSync(pristinePath(dshHome)),
  }
}

/**
 * 启动自愈入口（host 半 apply 内同步调用，绝不该抛异常）。
 *
 * 行为：
 *   - ui-layout 不存在（非 web profile / 被移除）→ 静默跳过；
 *   - 已打补丁 → 直接返回；
 *   - 版本与锚点表绑定的版本不符 → 醒目告警后仍尝试（替换全过才写，不会写坏）；
 *   - 打补丁成功 / 失败都记录日志。
 */
export function ensureLayoutPatchAtBoot(opts: {
  dshHome?: string
  logger?: Pick<Console, 'log' | 'warn'>
} = {}): LayoutPatchResult {
  const logger = opts.logger ?? console
  const dshHome = opts.dshHome ?? dshHomeDir()
  const target = uiLayoutClientPath(dshHome)

  try {
    if (!existsSync(target)) return { status: 'no-target', target }
    const original = readFileSync(target, 'utf8')
    if (isPatched(original)) return { status: 'already-patched', target }

    const version = installedUiLayoutVersion(dshHome)
    if (version !== undefined && version !== SUPPORTED_UI_LAYOUT_VERSION) {
      logger.warn(
        `${TAG} ui-layout version ${version} != ${SUPPORTED_UI_LAYOUT_VERSION} (the build this anchor table was validated against). ` +
          `Attempting the patch anyway — every replacement verifies its anchor before writing, so a mismatch aborts without touching the bundle. ` +
          `If it fails, update the anchor table in src/layout-patch.ts.`,
      )
    }

    const result = applyLayoutPatch({ dshHome })
    if (result.status === 'patched') {
      logger.log(`${TAG} re-applied the missing dsh-client-ui-layout stock patch (${result.variant}).`)
    } else if (result.status === 'failed') {
      logger.warn(
        `${TAG} ui-layout stock patch failed — the dsh version may have changed; the stock column will not appear. ` +
          `Update the anchors in src/layout-patch.ts (see SUPPORTED_UI_LAYOUT_VERSION).\n` +
          (result.failures ?? []).join('\n'),
      )
    }
    return result
  } catch (err) {
    logger.warn(`${TAG} ui-layout stock patch check failed:`, err)
    return { status: 'failed', detail: String(err) }
  }
}

/**
 * 卸载 / dispose 时的还原入口（host 半 apply 的 cleanup 内同步调用，绝不抛异常）。
 * 只有 bundle 处于已打补丁状态且 pristine 备份存在时才写回。
 */
export function revertLayoutPatchIfNeeded(opts: {
  dshHome?: string
  logger?: Pick<Console, 'log' | 'warn'>
} = {}): LayoutPatchResult {
  const logger = opts.logger ?? console
  const dshHome = opts.dshHome ?? dshHomeDir()
  const target = uiLayoutClientPath(dshHome)
  try {
    const result = revertLayoutPatch({ dshHome })
    if (result.status === 'reverted') {
      logger.log(`${TAG} reverted ui-layout to the pristine bundle (plugin unloaded).`)
    }
    return result
  } catch (err) {
    logger.warn(`${TAG} ui-layout revert failed:`, err)
    return { status: 'failed', detail: String(err) }
  }
}

/** 解析目标：--target 优先（用于测试 / 手动指定），否则默认 junction 路径。 */
function resolveExistingTarget(explicit: string | undefined, dshHome: string): string | undefined {
  const candidate = explicit ?? uiLayoutClientPath(dshHome)
  return existsSync(candidate) ? candidate : undefined
}
