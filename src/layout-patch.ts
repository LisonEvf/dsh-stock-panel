/**
 * src/layout-patch.ts — dsh-client-ui-layout 布局补丁引擎 v2（随 lib 交付，单一事实源）。
 *
 * 背景：DSH 的 ui-layout 是编译产物，只渲染 sidebar | center | details 三列，
 * 官方 Slots 没有"插件声明第四列"的扩展位。本插件为「A股量化工作台」新增最右
 * stock 列，只能对编译后的 `dsh-client-ui-layout/lib/client.js` 做字节级替换。
 *
 * v2 设计（通用自适应，升级尽量开箱即用）：
 *   1. **容错匹配**：每条规则不再要求锚点与字节逐字一致，而是按 token 序列做
 *      `\s+` 容错匹配（吸收缩进/Tab/CRLF/空格的任何变化）。因此 npm 注册表
 *      构建与 desktop 打包构建（缩进风格不同）共用同一套规则，不再需要变体表。
 *   2. **类名前缀动态发现**：ui-layout 的 CSS Modules 类名带构建期 hash 前缀
 *      （如 `pI_x6G_`）。v1 把前缀硬编码进每一条 CSS 锚点，前缀一变全部失配。
 *      v2 先从 css-module 对象字面量里读出真实前缀（`"detailsCol": "<prefix>detailsCol"`），
 *      再把它替换进所有含前缀的规则（占位符 `$PREFIX$`），规则文本与版本解耦。
 *   3. **CSS 规则不克隆细节内容**：v1 的 stockCol 背景规则直接克隆 detailsCol
 *      的边框声明（`1px solid var(--l2)` → alpha 版改成 `.5px solid var(--l3)`
 *      就失配）。v2 只按**选择器**定位 detailsCol 规则、追加一条**内容自持**
 *      （与 details 无关）的 stockCol 规则。
 *   4. **JSX 片段结构化注入**：v1 整行匹配 center 区 Fragment（alpha 版给
 *      details 包了层 SessionProvider 即失配）。v2 把该规则拆成两段：
 *        a. conversationSeat 包裹（CenterColumn 元素内的独立小锚点）；
 *        b. stock 网格项追加 —— 定位 Fragment 的 children 列表起点后做
 *           **括号配平扫描**找到列表结尾，把 stock div 作为末项插入，
 *           对内部任何新增包裹层免疫。
 *   5. **安全不变**：每条规则必须恰好命中 1 处，任一失配即中止不写、落盘诊断
 *      （$DSH_HOME/patches/layout-report.json），绝不破坏宿主 bundle。
 *
 * 实测兼容矩阵（v2 规则集已对以下版本 pristine 产物逐版本验证通过）：
 *   0.1.1-rc.2 / 0.1.2-alpha.5 / 0.1.2-rc.1。
 * 后续版本若布局语义继续演进（如新增列、重构 AppFrame），可能仍有规则失配：
 * 此时布局补丁自动中止并给出逐规则诊断（见 scripts/patch-layout.mjs --check
 * 与 layout-report.json），按报告更新本文件的规则即可。
 *
 * 自愈/回滚语义与 v1 相同：host 半 apply() 同步执行 ensureLayoutPatchAtBoot()；
 * DSH 升级覆盖 bundle 后自动重打；卸载还原 pristine。
 */

import { copyFileSync, existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'

/** 日志前缀（与 client 半一致）。 */
const TAG = '[stock-panel]'

/**
 * 版本门控标签：锚点规则集已实测验证过的 ui-layout 版本区间。
 * 仅用于诊断提示（layoutPatchState / --check），不再做等值阻断——
 * 失配判定以逐规则锚点命中为准（规则不命中会中止且绝不写坏）。
 */
export const SUPPORTED_UI_LAYOUT_VERSION = '0.1.1-rc.2 .. 0.1.2-rc.1 (validated)'

/**
 * 语义检测标记（与版本前缀无关的正则）：三者齐备才认为已打补丁。
 * 注意：必须是"打补丁后新增且不在 pristine 中"的语义产物；
 * 不要用 CSS 类名等带 hash 的产物做标记（前缀会变）。
 */
export const PATCHED_MARKERS = [
  'renderSlot\\("stock"',
  'setStock: \\(d, px\\)',
  'data-stock-collapsed',
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
  /** 命中规则集标识（v2 起固定为 'adaptive'；保留字段以兼容 CLI）。 */
  variant?: string
  /** 失败原因（逐规则诊断行）。 */
  failures?: string[]
  detail?: string
}

/**
 * 一条补丁规则：
 *  - kind 'literal'：anchor 为 token 序列（内部任意空白都会被容错），replacement 为整段注入文本；
 *  - kind 'jsxAppend': 在匹配到的 children 列表起点做括号配平，把 insert 作为末项插进列表。
 * 两类规则都要求"定位点恰好命中 1 处"。
 */
type PatchRule =
  | { kind: 'literal'; id: string; anchor: string; replacement: string }
  | { kind: 'jsxAppend'; id: string; listStart: string; insert: string }

/**
 * 规则表（v2）。含 `$PREFIX$` 占位符的文本在执行期用动态发现的前缀替换。
 * 占位符出现在含 CSS Modules 类名的锚点与注入文本里。
 */
const RULES: PatchRule[] = [
  // ── CSS：stockCol 背景规则（内容自持，不克隆 details 边框；按选择器定位追加） ──
  {
    kind: 'literal',
    id: 'css.stockCol.rule',
    // 锚点只含选择器 + 空的规则体占位：实际执行时先用正则定位 `.detailsCol{...}`
    // 整条规则（内容可漂移），再在其后追加我们的规则。见 buildCssStockColRule()。
    anchor: '__CSS_STOCKCOL_RULE__',
    replacement: '__CSS_STOCKCOL_RULE__',
  },
  // ── CSS：stock 拖拽句柄的 :after 内容（与 details 句柄并列） ──
  {
    kind: 'literal',
    id: 'css.stockCol.handleContent',
    anchor: '.$PREFIX$handle[data-side=details]:after{',
    replacement: '.$PREFIX$handle[data-side=details]:after,.$PREFIX$handle[data-side=stock]:after{',
  },
  // ── CSS：stock 句柄 hover / dragging 时显示 grip 图标（opacity:1） ──
  {
    kind: 'literal',
    id: 'css.stockCol.handleOpacity',
    anchor:
      '.$PREFIX$detailsCol:hover~.$PREFIX$handle[data-side=details]:after,.$PREFIX$handle[data-side=details]:hover:after,.$PREFIX$handle[data-side=details][data-dragging=true]:after{opacity:1}',
    replacement:
      '.$PREFIX$detailsCol:hover~.$PREFIX$handle[data-side=details]:after,.$PREFIX$handle[data-side=details]:hover:after,.$PREFIX$handle[data-side=details][data-dragging=true]:after{opacity:1}.$PREFIX$stockCol:hover~.$PREFIX$handle[data-side=stock]:after,.$PREFIX$handle[data-side=stock]:hover:after,.$PREFIX$handle[data-side=stock][data-dragging=true]:after{opacity:1}',
  },
  // ── CSS：stock 句柄 hover / dragging 的悬浮按钮背景 / 边框 ──
  {
    kind: 'literal',
    id: 'css.stockCol.handleHover',
    anchor:
      '.$PREFIX$handle[data-side=details]:hover:after,.$PREFIX$handle[data-side=details][data-dragging=true]:after{background:var(--dsw-alias-button-floating-hover);border-color:var(--dsw-alias-border-l3)}',
    replacement:
      '.$PREFIX$handle[data-side=details]:hover:after,.$PREFIX$handle[data-side=details][data-dragging=true]:after{background:var(--dsw-alias-button-floating-hover);border-color:var(--dsw-alias-border-l3)}.$PREFIX$handle[data-side=stock]:hover:after,.$PREFIX$handle[data-side=stock][data-dragging=true]:after{background:var(--dsw-alias-button-floating-hover);border-color:var(--dsw-alias-border-l3)}',
  },
  // ── CSS：css-module classMap 注册 stockCol / conversationSeat（前缀动态） ──
  {
    kind: 'literal',
    id: 'css.classMap.stockCol',
    anchor: '"centerCol": "$PREFIX$centerCol"',
    replacement: '"centerCol": "$PREFIX$centerCol",\n\t\t\t"stockCol": "$PREFIX$stockCol"',
  },
  {
    kind: 'literal',
    id: 'css.classMap.conversationSeat',
    anchor: '"centerCol": "$PREFIX$centerCol"',
    replacement: '"centerCol": "$PREFIX$centerCol",\n\t\t\t"conversationSeat": "$PREFIX$conversationSeat"',
  },
  // ── CSS：CenterColumn 改横向排列（row）：内部 conversationSeat 需要横向空间 ──
  {
    kind: 'literal',
    id: 'css.centerSplit',
    anchor: '.$PREFIX$centerCol{flex-direction:column;min-width:0;display:flex;overflow:hidden}',
    replacement:
      '.$PREFIX$centerCol{flex-direction:row;min-width:0;display:flex;overflow:hidden}.$PREFIX$conversationSeat{flex:1 1 0;min-width:0;overflow:hidden}',
  },

  // ── 布局计算：computeColumns 新增 stock 列宽（v1 全函数替换，v2 容错匹配） ──
  {
    kind: 'literal',
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
  // ── store 初始化给 stock 列一个默认宽度 ──
  {
    kind: 'literal',
    id: 'store.init.stock',
    anchor: '\t\t\t\t\t\tsidebar: 280,\n\t\t\t\t\t\tdetails: 0,',
    replacement: '\t\t\t\t\t\tsidebar: 280,\n\t\t\t\t\t\tstock: 360,\n\t\t\t\t\t\tdetails: 0,',
  },
  // ── store action 新增 setStock ──
  {
    kind: 'literal',
    id: 'store.action.setStock',
    anchor:
      '\t\t\t\t\tsetDetails: (d, px) => {\n\t\t\t\t\t\td.details = clampWidth(px, 300, 520);\n\t\t\t\t\t},',
    replacement:
      '\t\t\t\t\tsetDetails: (d, px) => {\n\t\t\t\t\t\td.details = clampWidth(px, 300, 520);\n\t\t\t\t\t},\n\t\t\t\t\tsetStock: (d, px) => {\n\t\t\t\t\t\td.stock = clampWidth(px, 200, 420);\n\t\t\t\t\t},',
  },
  // ── AppFrame 调用 computeColumns 时传入 stock 列宽 ──
  {
    kind: 'literal',
    id: 'appframe.computeCall',
    anchor:
      'const cols = computeColumns(viewport, sidebarCollapsed ? 0 : panels.sidebar === 0 ? 280 : panels.sidebar, detailsSession === void 0 ? 0 : panels.details);',
    replacement:
      'const stockEffective = narrow ? 0 : panels.stock;\n\t\t\tconst cols = computeColumns(viewport, sidebarCollapsed ? 0 : panels.sidebar === 0 ? 280 : panels.sidebar, stockEffective, detailsSession === void 0 ? 0 : panels.details);',
  },
  // ── AppFrame 为 stock 列加一个 drag baseline ref ──
  {
    kind: 'literal',
    id: 'appframe.stockBase',
    anchor: 'const detailsBase = (0, react.useRef)(0);',
    replacement: 'const detailsBase = (0, react.useRef)(0);\n\t\t\tconst stockBase = (0, react.useRef)(0);',
  },
  // ── AppFrame 为 stock 列加拖拽回调 ──
  {
    kind: 'literal',
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
  // ── gridTemplateColumns 把 stock 列放到最右侧（details 之后） ──
  {
    kind: 'literal',
    id: 'appframe.gridTemplate',
    anchor: 'gridTemplateColumns: `${cols.sidebar}px minmax(0, 1fr) ${cols.details}px`',
    replacement:
      'gridTemplateColumns: `${cols.sidebar}px minmax(0, 1fr) ${cols.details}px ${cols.stock}px`',
  },
  // ── data-* 标记 stock 列是否收起 ──
  {
    kind: 'literal',
    id: 'appframe.dataStockCollapsed',
    anchor: '"data-details-collapsed": cols.details === 0 || void 0,',
    replacement:
      '"data-details-collapsed": cols.details === 0 || void 0,\n\t\t\t\t"data-stock-collapsed": cols.stock === 0 || void 0,',
  },
  // ── conversationSeat 包裹（对话区内容放进可弹性收缩的容器） ──
  {
    kind: 'literal',
    id: 'appframe.conversationSeatWrap',
    anchor: '(0, react_jsx_runtime.jsx)(CenterColumn, { children: renderSlot("conversation", {}) })',
    replacement:
      '(0, react_jsx_runtime.jsx)(CenterColumn, { children: (0, react_jsx_runtime.jsx)("div", { className: AppFrame_module_css_default.conversationSeat, children: renderSlot("conversation", {}) }) })',
  },
  // ── stock 网格项：作为 center Fragment children 列表的末项追加（结构化注入） ──
  {
    kind: 'jsxAppend',
    id: 'appframe.stockGridAppend',
    listStart: '(0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [',
    insert:
      ' (0, react_jsx_runtime.jsx)("div", { className: AppFrame_module_css_default.stockCol, children: renderSlot("stock", { width: cols.stock }) })',
  },
  // ── apply.children 注册 "stock" 顶层 slot（与 sidebar 并列） ──
  {
    kind: 'literal',
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
]

// ── 路径解析 ────────────────────────────────────────────────────────────────

/**
 * 剥离 Windows 扩展路径前缀 `\\?\`（rolldown browser 平台打包后，
 * node:fs.realpathSync 对带该前缀的路径解析异常，表现为 lstat 'C:' EISDIR）。
 */
function stripExtPrefix(p: string): string {
  if (
    p.charCodeAt(0) === 92 && p.charCodeAt(1) === 92 &&
    p.charCodeAt(2) === 63 && p.charCodeAt(3) === 92
  ) return p.slice(4)
  return p
}

/** DSH home（环境变量优先，默认 ~/.dsh）。 */
export function dshHomeDir(): string {
  return stripExtPrefix(process.env.DSH_HOME ?? join(homedir(), '.dsh'))
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

/** 诊断报告路径（失配时落盘，供升级后人工排查）。 */
export function reportPath(dshHome = dshHomeDir()): string {
  return join(dshHome, 'patches', 'layout-report.json')
}

// ── 容错匹配与结构化扫描 ────────────────────────────────────────────────────

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * 把锚点文本变成"空白无关"的正则：任意连续空白（含换行/Tab/CRLF）都折叠成 \s+，
 * 非空白 token 按原序逐一转义。
 */
function tolerantPattern(anchor: string): RegExp {
  const parts = anchor.split(/\s+/).filter(Boolean).map(escapeRegExp)
  return new RegExp(parts.join('\\s+'), 'g')
}

/** 从 css-module 对象字面量发现真实 hash 前缀（如 pI_x6G_）。 */
function discoverCssPrefix(text: string): string | undefined {
  const m = text.match(/"detailsCol"\s*:\s*"([A-Za-z0-9_-]+)"/)
  if (!m) return undefined
  const value = m[1]
  const suffix = 'detailsCol'
  return value.endsWith(suffix) ? value.slice(0, value.length - suffix.length) : undefined
}

/**
 * 括号配平扫描：从 text[startIdx]（应为 '[' 或 '{'）出发，返回与之配对的
 * 结束符下标（对 '[' 返回 ']'，对 '{' 返回 '}'）。跳过字符串字面量与
 * `//`、`/* *​/` 注释。找不到返回 -1。
 */
function balancedEnd(text: string, startIdx: number): number {
  const open = text[startIdx]
  const close = open === '[' ? ']' : '}'
  let depth = 0
  let i = startIdx
  while (i < text.length) {
    const ch = text[i]
    if (ch === '"' || ch === "'") {
      const quote = ch
      i += 1
      while (i < text.length) {
        const c = text[i]
        if (c === '\\') i += 2
        else if (c === quote) { i += 1; break }
        else i += 1
      }
      continue
    }
    if (ch === '`') {
      i += 1
      while (i < text.length) {
        if (text[i] === '\\') i += 2
        else if (text[i] === '`') { i += 1; break }
        else i += 1
      }
      continue
    }
    if (ch === '/' && text[i + 1] === '/') {
      while (i < text.length && text[i] !== '\n') i += 1
      continue
    }
    if (ch === '/' && text[i + 1] === '*') {
      const end = text.indexOf('*/', i + 2)
      i = end === -1 ? text.length : end + 2
      continue
    }
    if (ch === open) depth += 1
    else if (ch === close) {
      depth -= 1
      if (depth === 0) return i
    }
    i += 1
  }
  return -1
}

/** 找到 jsxAppend 规则的 children 列表终点，返回其 ']' 下标（须恰好命中 1 处）。 */
function findListEnd(text: string, listStart: string): { index: number } | { error: string } {
  const m = tolerantPattern(listStart).exec(text)
  if (!m) return { error: 'children list start not found' }
  const next = tolerantPattern(listStart)
  next.lastIndex = m.index + 1
  if (next.exec(text)) return { error: 'children list start found multiple times' }
  const openIdx = text.indexOf('[', m.index)
  const end = balancedEnd(text, openIdx)
  if (end === -1) return { error: 'children list has no balanced closing bracket' }
  return { index: end }
}

// ── 核心替换逻辑 ─────────────────────────────────────────────────────────────

function applyRules(text: string, rules: PatchRule[]): { patched: string; failures: string[] } {
  let patched = text
  const failures: string[] = []
  for (const rule of rules) {
    if (rule.kind === 'literal') {
      const matches = [...patched.matchAll(tolerantPattern(rule.anchor))]
      if (matches.length === 0) {
        failures.push(`${rule.id}: anchor not found (whitespace-tolerant)`)
        continue
      }
      if (matches.length > 1) {
        failures.push(`${rule.id}: anchor found ${matches.length} times (expected exactly 1)`)
        continue
      }
      const m = matches[0]
      patched = patched.slice(0, m.index) + rule.replacement + patched.slice(m.index + m[0].length)
      continue
    }
    // jsxAppend
    const found = findListEnd(patched, rule.listStart)
    if ('error' in found) {
      failures.push(`${rule.id}: ${found.error}`)
      continue
    }
    const endIdx = found.index
    const tail = patched.slice(endIdx)
    if (!tail.startsWith(']')) {
      failures.push(`${rule.id}: unbalanced scan landed on wrong character`)
      continue
    }
    patched = patched.slice(0, endIdx) + ',' + rule.insert + ']' + patched.slice(endIdx + 1)
  }
  return { patched, failures }
}

/**
 * 构造并执行 stockCol CSS 追加规则：
 *  - 发现 css 前缀后定位 `.detailsCol{...}` 的**基础规则**（选择器即为该条规则
 *    起点；`[data-details-collapsed] .detailsCol{border-left:none}` 这类变体
 *    选择器前缀更长，会被排除），在其后追加内容自持的 stockCol 规则。
 *    只按选择器定位，不依赖规则内容 → 边框 token 如何漂移都不影响。
 */
function buildCssStockColRule(text: string): { rule: PatchRule } | { error: string } {
  const prefix = discoverCssPrefix(text)
  if (!prefix) return { error: 'cannot discover css-module prefix ("detailsCol" class value)' }
  const pattern = new RegExp(`\\.${escapeRegExp(prefix)}detailsCol\\{`, 'g')
  const matches = [...text.matchAll(pattern)]
  if (matches.length === 0) return { error: 'detailsCol css rule not found by selector' }
  // 规则起点：匹配位置前一个字符不是选择器延续字符（字母/数字/_/-/./]/)），
  // 即该处是一条独立规则语句的开头。
  const CONTINUE = new Set(['.', ']', ')', '-'])
  let base: RegExpMatchArray | null = null
  for (const m of matches) {
    const prev = m.index > 0 ? text[m.index - 1] : ''
    const isContinue = prev !== '' && (/[A-Za-z0-9_]/.test(prev) || CONTINUE.has(prev))
    if (!isContinue) { base = m; break }
  }
  if (!base || base.index === undefined) return { error: 'cannot locate the base detailsCol rule (only collapsed variants found)' }
  const closeIdx = text.indexOf('}', base.index)
  if (closeIdx === -1) return { error: 'detailsCol css rule has no closing brace' }
  const full = text.slice(base.index, closeIdx + 1)
  const own = `.$PREFIX$stockCol{background:var(--dsw-specific-sidebar-fill);border-right:1px solid var(--dsw-alias-border-l1);min-width:0;overflow:hidden}`
  const rule: PatchRule = {
    kind: 'literal',
    id: 'css.stockCol.rule',
    anchor: full,
    replacement: full + own.replace(/\$PREFIX\$/g, prefix),
  }
  return { rule }
}

/** 是否已打补丁：三个语义标记（正则）齐备。 */
function isPatched(text: string): boolean {
  return PATCHED_MARKERS.every((marker) => new RegExp(marker).test(text))
}

/** 模板替换 $PREFIX$，并把计算型规则（css.stockCol.rule）插入规则表头部。 */
function prepareRules(text: string): { rules: PatchRule[]; prefix?: string } | { error: string } {
  const prefix = discoverCssPrefix(text)
  const cssStock = buildCssStockColRule(text)
  if ('error' in cssStock) return { error: cssStock.error }
  const resolved: PatchRule[] = RULES.filter((r) => r.id !== 'css.stockCol.rule').map((r) => {
    const out = { ...r }
    const p = prefix ?? ''
    if ('anchor' in out) out.anchor = out.anchor.replace(/\$PREFIX\$/g, p)
    if ('replacement' in out) out.replacement = out.replacement.replace(/\$PREFIX\$/g, p)
    return out as PatchRule
  })
  resolved.unshift(cssStock.rule)
  return { rules: resolved, prefix }
}

/** 落盘诊断报告（尽力而为，失败不影响主流程）。 */
function writeReport(dshHome: string, payload: Record<string, unknown>): void {
  try {
    mkdirSync(backupDir(dshHome), { recursive: true })
    writeFileSync(reportPath(dshHome), JSON.stringify(payload, null, 2), 'utf8')
  } catch {
    /* 报告写失败不阻断 */
  }
}

/**
 * 应用布局补丁（同步、幂等）。每条规则容错匹配且必须恰好命中 1 处，
 * 全部成功才写文件；任一失配即中止返回 failed（绝不写坏 bundle）。
 */
export function applyLayoutPatch(opts: {
  target?: string
  force?: boolean
  dshHome?: string
} = {}): LayoutPatchResult {
  const dshHome = stripExtPrefix(opts.dshHome ?? dshHomeDir())
  const explicit = opts.target ? stripExtPrefix(opts.target) : undefined
  const target = resolveExistingTarget(explicit, dshHome)
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

  const prepared = prepareRules(base)
  if ('error' in prepared) {
    writeReport(dshHome, { ts: new Date().toISOString(), status: 'failed', detail: prepared.error })
    return { status: 'failed', target: real, failures: [`prepare: ${prepared.error}`], detail: 'cannot build adaptive rule set' }
  }

  const { patched, failures } = applyRules(base, prepared.rules)
  if (failures.length > 0) {
    writeReport(dshHome, {
      ts: new Date().toISOString(),
      status: 'failed',
      target: real,
      installedVersion: installedUiLayoutVersion(dshHome) ?? null,
      expectedVersion: SUPPORTED_UI_LAYOUT_VERSION,
      cssPrefix: prepared.prefix ?? null,
      failures,
    })
    return { status: 'failed', target: real, failures, detail: 'bundle does not satisfy the adaptive rule set' }
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

  const missingMarkers = PATCHED_MARKERS.filter((marker) => !new RegExp(marker).test(patched))
  if (missingMarkers.length > 0) {
    writeReport(dshHome, {
      ts: new Date().toISOString(),
      status: 'failed',
      detail: 'replacement set produced no verifiable patch',
      missingMarkers,
    })
    return {
      status: 'failed',
      target: real,
      failures: missingMarkers.map((marker) => `marker missing: ${marker}`),
      detail: 'replacement set produced no verifiable patch',
    }
  }

  writeFileSync(real, patched, 'utf8')
  writeReport(dshHome, {
    ts: new Date().toISOString(),
    status: 'patched',
    target: real,
    installedVersion: installedUiLayoutVersion(dshHome) ?? null,
    cssPrefix: prepared.prefix ?? null,
  })
  return { status: 'patched', target: real, variant: 'adaptive' }
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
  reportExists: boolean
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
    reportExists: existsSync(reportPath(dshHome)),
  }
}

/**
 * 启动自愈入口（host 半 apply 内同步调用，绝不该抛异常）。
 *
 * 行为：
 *   - ui-layout 不存在（非 web profile / 被移除）→ 静默跳过；
 *   - 已打补丁 → 直接返回；
 *   - 版本不在已验证区间 → 醒目告警后仍尝试（规则不命中会中止不写，不会写坏）；
 *   - 打补丁成功 / 失败都记录日志并落盘 layout-report.json。
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
    if (version !== undefined && !version.startsWith('0.1.1') && !version.startsWith('0.1.2')) {
      logger.warn(
        `${TAG} ui-layout version ${version} is outside the validated range ${SUPPORTED_UI_LAYOUT_VERSION}. ` +
          `Attempting the adaptive patch anyway — every rule must match exactly once before writing, ` +
          `so a mismatch aborts without touching the bundle (details in ${reportPath(dshHome)}).`,
      )
    }

    const result = applyLayoutPatch({ dshHome })
    if (result.status === 'patched') {
      logger.log(`${TAG} re-applied the missing dsh-client-ui-layout stock patch (adaptive).`)
    } else if (result.status === 'failed') {
      logger.warn(
        `${TAG} ui-layout stock patch failed — the dsh version may have changed; the stock column will not appear. ` +
          `Per-rule diagnostics written to ${reportPath(dshHome)}; update the rules in src/layout-patch.ts.\n` +
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
