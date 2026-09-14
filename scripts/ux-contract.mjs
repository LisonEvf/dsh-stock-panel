// scripts/ux-contract.mjs — 界面契约静态检查（B1 尺寸收口 + B0 止血的护栏）。
//
// 为什么需要：本插件最容易复发的不是业务 bug，而是**布局与更新路径的回归**：
//   - 状态带右端被 overflow 静默裁掉（实测：成交额/情绪/问模型/⌘K 全部看不见）；
//   - 骨架又用视口断点决定栏位（DSH 里"视口宽、容器窄"是常态）；
//   - 又写出 calc(100vh - Npx) 这种换个宿主字号就错位的魔法数；
//   - 刷新按钮又退回 location.reload()（实测拿不到新 bundle）。
// 这些都能在**不跑浏览器**的前提下用静态断言守住，所以放进 CI（真正的像素验证仍需真机，
// 步骤见 docs/UX-PLAN.md 的"验收"一节）。
//
// 用法：node scripts/ux-contract.mjs

import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs'
import { join, resolve, relative } from 'node:path'
import { pathToFileURL } from 'node:url'

const ROOT = resolve(import.meta.dirname, '..')

const read = (rel) => readFileSync(join(ROOT, rel), 'utf8')
const exists = (rel) => existsSync(join(ROOT, rel))

/** 递归收集 src 下的源码文件（跳过第三方 vendor）。 */
function srcFiles(dir = join(ROOT, 'src'), out = []) {
  for (const name of readdirSync(dir)) {
    const abs = join(dir, name)
    const st = statSync(abs)
    if (st.isDirectory()) {
      if (name === 'vendor' || name === 'node_modules') continue
      srcFiles(abs, out)
    } else if (/\.(ts|tsx)$/.test(name)) {
      out.push(relative(ROOT, abs).replace(/\\/g, '/'))
    }
  }
  return out
}

/** 断言表：每条 = 一个可复现的回归场景。 */
const CHECKS = [
  {
    id: 'preflight-off',
    why: 'preflight 是全局样式，而插件 CSS 注入宿主 <head> —— 打开它等于改 DSH shell 的 DOM',
    run() {
      const cfg = read('tailwind.config.js')
      assert(/corePlugins\s*:\s*\{[^}]*preflight\s*:\s*false/.test(cfg), 'tailwind.config.js 缺 corePlugins.preflight = false')
    },
  },
  {
    id: 'scoped-reset',
    why: 'preflight 关了就必须有作用域版 reset，否则插件自身的边框/字距会变',
    run() {
      const css = read('src/index.css.txt')
      assert(css.includes(':where(.dsh-stock'), 'index.css.txt 缺 :where(.dsh-stock) 作用域 reset')
      assert(/border-style:\s*solid/.test(css), '作用域 reset 缺 border-style: solid（.border 工具类靠它生效）')
      assert(/\.dsh-stock \[hidden\]/.test(css), '作用域 reset 缺 [hidden]{display:none}')
      // reset 必须**整条**零特异性：`:where(.dsh-stock) [type='button']` 这种写法里
      // `[type='button']` 仍是类级特异性，会与组件类打平、靠"文件在后"赢，
      // 从而清零组件的 padding/border（实测把状态带导航挤成一团）。
      // 只看 §8 作用域 reset 那一段（别把暗色覆盖层/组件本身算进来）。
      const resetStart = css.indexOf('8. 作用域 reset')
      const reset = resetStart < 0 ? '' : css.slice(resetStart)
      const offenders = []
      for (const m of reset.matchAll(/^([^{}\n]+)\{/gm)) {
        const selector = m[1].trim()
        if (selector === '' || selector.startsWith('/') || selector.startsWith('*')) continue
        if (!/\b(button|input|select|textarea)\b|\[type=/.test(selector)) continue
        if (selector.startsWith(':where(')) continue
        offenders.push(selector.replace(/\s+/g, ' '))
      }
      assert(
        offenders.length === 0,
        `作用域 reset 里有非零特异性选择器（会压过组件类）：${offenders.slice(0, 3).join(' | ')}`,
      )
    },
  },
  {
    id: 'strip-grid-not-flex',
    why: 'flex 版只有指数条可伸缩、右簇不能缩 → 内容变多时右端（问模型/⌘K/收栏）被静默裁掉；grid 的 minmax(0,1fr) 才保证挤不出去',
    run() {
      const css = read('src/index.css.txt')
      const strip = css.match(/\.dc-strip\s*\{[^}]*\}/)
      assert(strip !== null, 'index.css.txt 找不到 .dc-strip')
      assert(/display:\s*grid/.test(strip[0]), '.dc-strip 必须是 display: grid（分档+右簇永不被挤出）')
      assert(/minmax\(0,\s*1fr\)/.test(strip[0]), '.dc-strip 缺 minmax(0, 1fr) 轨道（指数条那一列）')
      const grow = css.match(/\.dc-strip-grow\s*\{[^}]*\}/)
      assert(grow !== null, 'index.css.txt 找不到 .dc-strip-grow')
      assert(!/flex:/.test(grow[0]), '.dc-strip-grow 不该再声明 flex（它是 grid 轨道，flex 属性无效只会误导）')
    },
  },
  {
    id: 'strip-tails-and-overflow-menu',
    why: '分档摘掉的段必须能在 ⋯ 菜单里读到，不允许静默消失',
    run() {
      const css = read('src/index.css.txt')
      const tsx = read('src/panel/StatusStrip.tsx')
      assert(css.includes('.dc-strip-tails'), 'index.css.txt 缺 .dc-strip-tails（右簇）')
      assert(css.includes('.dc-strip-pop'), 'index.css.txt 缺 .dc-strip-pop（⋯ 菜单）')
      assert(tsx.includes('dc-strip-more'), 'StatusStrip 缺 ⋯ 溢出菜单')
      assert(/role="dialog"/.test(tsx), '⋯ 菜单缺 role="dialog"')
      assert(/aria-expanded=/.test(tsx), '⋯ 触发按钮缺 aria-expanded')
    },
  },
  {
    id: 'no-viewport-magic-height',
    why: 'calc(100vh - Npx) 在宿主字号可调（12–17px）时必然错位',
    run() {
      const files = ['src/pages/MarketPage.tsx']
      for (const f of files) {
        // 只看代码：注释里出现 calc(100vh …) 是说明性文字，不算违约。
        const text = stripComments(read(f))
        assert(!/calc\(\s*100vh/.test(text), `${f} 仍有 calc(100vh …) 魔法数（改用 useAvailableHeight）`)
      }
    },
  },
  {
    id: 'flow-columns-by-container',
    why: '列流列数必须按主区容器宽度，不能按视口（左右栏都开时主区可能只有 600px）',
    run() {
      const css = read('src/index.css.txt')
      assert(css.includes('.dc-main--flow2 .dc-flow'), 'index.css.txt 缺 .dc-main--flow2 .dc-flow')
      assert(css.includes('.dc-main--flow3 .dc-flow'), 'index.css.txt 缺 .dc-main--flow3 .dc-flow')
      const viewportFlow = /@media[^{]*\{\s*\.dc-flow/.test(css)
      assert(!viewportFlow, '.dc-flow 又用回了视口媒体查询')
    },
  },
  {
    id: 'skeleton-uses-container-width',
    why: '骨架的栏位显隐必须按容器宽度（视口宽 ≠ 面板宽）',
    run() {
      const shell = read('src/panel/AppShell.tsx')
      assert(shell.includes('useContainerWidth'), 'AppShell 没用 useContainerWidth')
      assert(shell.includes('is-w-narrow'), 'AppShell 缺窄容器标记（is-w-narrow）')
      assert(!/useMediaQuery\(\s*'\(min-width/.test(shell), 'AppShell 又用回了视口断点决定栏位')
    },
  },
  {
    id: 'hard-reload-not-plain-reload',
    why: 'location.reload() 会命中 HTTP 缓存 —— 实测点了「点此刷新」仍是旧 bundle',
    run() {
      assert(exists('src/lib/build-info.ts'), 'src/lib/build-info.ts 不存在')
      const bi = read('src/lib/build-info.ts')
      assert(/export function hardReload/.test(bi), 'build-info.ts 缺 hardReload')
      const shell = read('src/panel/AppShell.tsx')
      assert(shell.includes('hardReload'), 'AppShell 没用 hardReload')
      assert(!/window\.location\.reload\(\)/.test(shell), 'AppShell 又退回 window.location.reload()')
      const strip = read('src/panel/StatusStrip.tsx')
      assert(!/window\.location\.reload\(\)/.test(strip), 'StatusStrip 出现 location.reload()')
    },
  },
  {
    id: 'half-render-self-check',
    why: '实测出现过「状态带/栏位 DOM 在、画面不在」的半渲染态，必须能自检并给硬刷新入口',
    run() {
      const shell = read('src/panel/AppShell.tsx')
      const hooks = read('src/panel/hooks.ts')
      assert(hooks.includes('useChromeHealth'), 'hooks.ts 缺 useChromeHealth')
      assert(shell.includes('useChromeHealth'), 'AppShell 没用 useChromeHealth')
      assert(shell.includes('dc-layout-warn'), 'AppShell 缺半渲染告警条')
      assert(read('src/index.css.txt').includes('.dc-layout-warn'), 'index.css.txt 缺 .dc-layout-warn')
    },
  },
  {
    id: 'no-hardcoded-semantic-colors',
    why: '涨跌色散在 22 个文件里各自写字面量 → 暗色下 CSS token 已提亮、字面量没提亮，同屏两种红（实测 3.17:1 vs 4.73:1，前者不达 AA）',
    run() {
      // 唯一允许出现字面量的地方：token 定义（CSS）与兜底表（theme-colors），
      // 以及 K 线注释里对历史色值的说明。
      const allowed = new Set(['src/lib/theme-colors.ts'])
      const offenders = []
      for (const f of srcFiles()) {
        if (allowed.has(f)) continue
        const text = stripComments(read(f))
        if (/#(c74040|2d9b65|e26060|45b57c)\b/i.test(text)) offenders.push(f)
      }
      assert(offenders.length === 0, `仍有涨跌色字面量：${offenders.join(', ')}（改用 'var(--dc-up)' 或 themeColor('up')）`)
    },
  },
  {
    id: 'no-manual-unit-math',
    why: '实测同一个数在两个地方分别手算成 `19870亿` 与 `1.99万亿` —— 单位/精度必须只有一个入口',
    run() {
      const allowed = new Set(['src/lib/format.ts'])
      // 只查**界面层**：业务层（screener 阈值、host 工具文案）里的 1e8 是算出来的口径，不是显示格式。
      const uiPrefixes = ['src/components/', 'src/pages/', 'src/panel/', 'src/views/']
      const offenders = []
      for (const f of srcFiles()) {
        if (allowed.has(f) || !uiPrefixes.some((p) => f.startsWith(p))) continue
        const text = stripComments(read(f))
        // 手写 1e8 / 1e12 除以/乘以并拼"亿/万亿"，或 toFixed(0)}亿
        if (/\/\s*1e(8|12)\b/.test(text) && /亿|万亿/.test(text)) offenders.push(f)
        if (/toFixed\(\d+\)\s*\}?\s*亿/.test(text)) offenders.push(f)
      }
      assert(offenders.length === 0, `仍有手写单位换算：${[...new Set(offenders)].join(', ')}（改用 @/lib/format 的 fmtAmount）`)
    },
  },
  {
    id: 'status-colors-decoupled-from-price',
    why: '状态类信息借用了涨跌色 → 诊断面板曾把 success 画成红、error 画成绿（实测），用户会读反',
    run() {
      const css = read('src/index.css.txt')
      for (const cls of ['.dc-ok', '.dc-bad', '.dc-warn', '.dc-info']) {
        assert(css.includes(cls), `index.css.txt 缺 ${cls}（状态语义色）`)
      }
      const diag = read('src/panel/DiagnosticsPanel.tsx')
      // 诊断面板只表达"状态"，不该出现 dc-up/dc-down（注释除外）
      assert(!/\bdc-(up|down)\b/.test(stripComments(diag)), 'DiagnosticsPanel 又用回了 dc-up/dc-down（应使用 dc-ok/dc-bad）')
      const strip = read('src/panel/StatusStrip.tsx')
      const toneFn = strip.match(/function phaseTone[\s\S]{0,320}?\n\}/)
      assert(toneFn !== null, 'StatusStrip 找不到 phaseTone')
      assert(!/dc-(up|down)/.test(toneFn[0]), 'phaseTone 又用涨跌色表示时段（应与价格语义解耦）')
    },
  },
  {
    id: 'chart-theme-single-source',
    why: '审计实测三个图表组件各复制一份 createChart 参数并已漂移，且零主题响应（切明暗不重绘）',
    run() {
      if (!exists('src/lib/chart-theme.ts')) {
        // 该文件由批次 2 引入；缺失时只提示，不判失败（避免与并行改动打架）
        console.log('      提示：src/lib/chart-theme.ts 尚未引入（图表主题统一未落地）')
        return
      }
      const theme = read('src/lib/chart-theme.ts')
      assert(theme.includes('subscribeThemeChange') || theme.includes('applyChartTheme'), 'chart-theme.ts 缺主题响应（applyChartTheme/subscribeThemeChange）')
      for (const f of ['src/components/KlineChart.tsx', 'src/components/IndexChart.tsx']) {
        if (!exists(f)) continue
        const text = stripComments(read(f))
        assert(text.includes('chart-theme'), `${f} 未复用 chart-theme.ts（禁止再各写一份 createChart 参数）`)
        assert(!/createChart\s*\(\s*[^)]*,\s*\{[\s\S]{0,400}(grid|layout)\s*:/.test(text), `${f} 又内联了 createChart 主题参数`)
      }
    },
  },
  {
    id: 'three-state-component',
    why: '审计实测加载态 7 种 / 错误态 5 种 / 空态 4 种，且超时态全仓缺失',
    run() {
      if (!exists('src/components/StateView.tsx')) {
        console.log('      提示：src/components/StateView.tsx 尚未引入（三态组件化未落地）')
        return
      }
      const sv = read('src/components/StateView.tsx')
      for (const kind of ['loading', 'empty', 'error']) {
        assert(new RegExp(`['"\`]${kind}['"\`]`).test(sv), `StateView 缺 ${kind} 态`)
      }
      assert(/onRetry/.test(sv), 'StateView 的 error 态必须带重试入口（onRetry）')
      assert(/StateView/.test(read('src/pages/MarketPage.tsx')), 'MarketPage 未使用 StateView（页面级兜底缺失）')
    },
  },
  {
    id: 'review-draft-persisted',
    why: '审计实测：复盘「次日预期清单」草稿只在组件 state（ReviewPage.tsx:143）里 —— 点任意股票/切视图/切标签即清零，而这是方法论唯一要求的产出物',
    run() {
      assert(exists('src/lib/review-draft.ts') || exists('src/lib/review-store.ts'), '找不到复盘草稿模块')
      const store = read(exists('src/lib/review-draft.ts') ? 'src/lib/review-draft.ts' : 'src/lib/review-store.ts')
      assert(/draft/i.test(store), '复盘草稿模块里看不到 draft 相关实现')
      const page = read('src/pages/ReviewPage.tsx')
      assert(/review-draft|saveDraft|loadDraft|draft/i.test(page), 'ReviewPage 未接草稿持久化（还会丢）')
    },
  },
  {
    id: 'error-kind-propagated',
    why: '审计实测：host 半区分 business/unsupported/unavailable，但 client 侧 mcp.ts:68-70 把 kind 丢了 → 三类错误在界面上完全同形，给不出不同建议',
    run() {
      const mcp = read('src/lib/mcp.ts')
      assert(/\bkind\b/.test(mcp), 'mcp.ts 未把错误的 kind 带到前端')
      assert(exists('src/components/ErrorBar.tsx'), '缺统一的 ErrorBar（错误条 + 重试）')
      const bar = read('src/components/ErrorBar.tsx')
      assert(/onRetry/.test(bar), 'ErrorBar 必须支持重试入口')
    },
  },
  {
    id: 'hotkeys-pure-and-tested',
    why: '审计实测：快捷键是一坨 if 链（AppShell.tsx:175-217），Esc 一次关三样、输入框内 ⌘K 失效、左栏收起时 j/k 仍换标的 —— 全都无法用单测守住',
    run() {
      assert(exists('src/lib/hotkeys.ts'), '缺 src/lib/hotkeys.ts（纯函数解析）')
      const hot = read('src/lib/hotkeys.ts')
      assert(/resolveHotkey/.test(hot), 'hotkeys.ts 未导出 resolveHotkey')
      assert(exists('tests/hotkeys.test.ts'), '缺 tests/hotkeys.test.ts（快捷键契约无人守）')
      const shell = read('src/panel/AppShell.tsx')
      assert(/resolveHotkey/.test(shell), 'AppShell 仍在自己写 if 链，没有走 resolveHotkey')
    },
  },
  {
    id: 'palette-dialog-a11y',
    why: '审计实测：全仓只有 2 处 ARIA，⌘K 弹层没有 dialog 语义、关闭后焦点不回归、结果只能用第一条',
    run() {
      const shell = read('src/panel/AppShell.tsx')
      assert(/role="dialog"/.test(shell), '⌘K弹层缺 role="dialog"')
      assert(/aria-modal/.test(shell), '⌘K弹层缺 aria-modal')
      assert(/activeElement/.test(shell), '⌘K关闭时没有焦点回归（未记录 activeElement）')
    },
  },
  {
    id: 'watchlist-rows-keyboard-reachable',
    why: '审计实测：左栏每一行都是 div+onClick，键盘不可达；j/k 只改选择不移动焦点、不滚动到可见',
    run() {
      const wl = read('src/panel/WatchList.tsx')
      assert(/tabIndex/.test(wl), '左栏行缺 tabIndex（键盘不可达）')
      assert(/scrollIntoView/.test(wl), 'j/k 移动后不滚动到可见（看不到自己选中了谁）')
      assert(/role="button"|role='button'/.test(wl), '左栏行缺按钮语义')
    },
  },
  {
    id: 'hit-target-24px',
    why: '审计实测控件高度 13–27px 全部低于 WCAG 2.2 SC 2.5.8 的最小目标尺寸 24px；状态带里那四个一级入口是最常点的地方',
    run() {
      const css = read('src/index.css.txt')
      const nav = css.match(/\.dc-nav-item\s*\{[^}]*\}/)
      assert(nav !== null, 'index.css.txt 找不到 .dc-nav-item')
      const pad = nav[0].match(/padding:\s*([\d.]+)px/)
      assert(pad !== null && Number(pad[1]) >= 6, `.dc-nav-item 垂直内边距 <6px（12px 字号 + 2×6px = 24px 命中区）`)
      // 窄档也不许把垂直内边距压下去
      const tight = css.match(/\.dc-strip\.is-tier-(tight|min)\s+\.dc-nav-item[^{]*\{([^}]*)\}/)
      if (tight !== null) {
        const tp = tight[2].match(/padding:\s*([\d.]+)px/)
        assert(tp === null || Number(tp[1]) >= 6, '窄档把 .dc-nav-item 的垂直内边距压到 24px 之下')
      }
    },
  },
  {
    id: 'no-dead-postcss-config',
    why: 'postcss.config.js 在 type:module 包里是非法 CJS 且构建根本不用它（死配置 + 地雷）',
    run() {
      assert(!exists('postcss.config.js'), 'postcss.config.js 又出现了（构建走 scripts/build-client.mjs 的 PostCSS JS API）')
      const build = read('scripts/build-client.mjs')
      assert(build.includes('tailwindcss('), 'build-client.mjs 未直接用 PostCSS JS API 编译 Tailwind')
    },
  },
  {
    id: 'type-scale-tokens-defined',
    why: '版面评审实测：字号原先只能就地写 text-[9px]，全仓 ≤10px 占 85%（8px 94 处/9px 137 处/10px 157 处）——没有统一尺度就必然越写越小',
    run() {
      const css = read('src/index.css.txt')
      for (const v of ['--dc-fs-decision', '--dc-fs-data', '--dc-fs-note', '--dc-fs-micro']) {
        assert(css.includes(v), `index.css.txt 缺 ${v}（类型尺度 token）`)
      }
      for (const cls of ['.dc-t-decision', '.dc-t-data', '.dc-t-note', '.dc-t-micro']) {
        assert(css.includes(cls), `index.css.txt 缺 ${cls} 工具类`)
      }
      // 尺度下限：css 自身也不许出现 <11px 的字号
      const small = [...css.matchAll(/font-size:\s*(\d+(?:\.\d+)?)px/g)].map((m) => Number(m[1])).filter((v) => v < 11)
      assert(small.length === 0, `index.css.txt 仍有 ${small.length} 处 <11px 的 font-size`)
    },
  },
  {
    id: 'type-scale-floor-in-components',
    why: '组件里再出现 <14px 的就地字号 = 尺度被绕过；细则（白名单/统计）由 scripts/ux-density.mjs 守',
    run() {
      const offenders = []
      for (const f of srcFiles()) {
        if (!/\.tsx$/.test(f)) continue
        const text = stripComments(read(f))
        for (const m of text.matchAll(/text-\[(\d+(?:\.\d+)?)px\]/g)) {
          if (Number(m[1]) < 14) offenders.push(`${f}: text-[${m[1]}px]`)
        }
      }
      assert(
        offenders.length === 0,
        `组件里出现 <14px 的就地字号（改用 dc-t-* token；注脚请进 title）：${offenders.slice(0, 3).join(' | ')}`,
      )
    },
  },
  {
    id: 'empty-state-uses-container-width',
    why: '版面评审实测：空态 mark/文案/动作各自 max-w-md(448px) 居中，主区 1148px 时白放 61% 宽度（作战页/监控页整屏空白）',
    run() {
      const sv = read('src/components/StateView.tsx')
      // 只查**空态**那一段（错误态的正文限宽是另一回事：错误文案拉满 1148px 反而难读）
      const start = sv.indexOf('function EmptyView')
      const end = sv.indexOf('/* ───────────────────────────── error')
      const empty = start < 0 ? '' : sv.slice(start, end > start ? end : undefined)
      assert(empty !== '', 'StateView 找不到 EmptyView（空态实现）')
      assert(!/max-w-md/.test(stripComments(empty)), 'EmptyView 又用 max-w-md 把空态挤成中间一条（应让 .dc-empty-inner 吃满容器宽度）')
      assert(empty.includes('dc-empty-inner'), 'EmptyView 缺 .dc-empty-inner（文案│动作 两栏容器）')
      const css = read('src/index.css.txt')
      assert(css.includes('.dc-empty-inner'), 'index.css.txt 缺 .dc-empty-inner')
      assert(/\.dc-empty-actions\s*\{[^}]*auto-fit/.test(css), '.dc-empty-actions 未用 auto-fit 自适应列数（宽度没被利用）')
      assert(/\.dc-main--flow[23]\s+\.dc-empty/.test(css), 'index.css.txt 缺宽容器下的空态排版覆盖（.dc-main--flow2/3 .dc-empty）')
    },
  },
  {
    id: 'market-single-metronome',
    why: '审计项 I-b：行情聚合页页头写着「全页共用一个节拍器」，但各块自带的默认 refreshInterval（指数 15s / 梯队 30s）从没被关掉 —— 实测同时有 4 个定时器在跑，页头在说谎。`budget.mjs` 只数"声明点"，数不出"该关没关"，所以这条得单独守',
    run() {
      const page = read('src/pages/MarketPage.tsx')
      const off = (page.match(/pollMs=\{0\}/g) ?? []).length
      assert(off >= 2, `MarketPage 必须给自带定时器的块传 pollMs={0}（实测只有 ${off} 处；指数块与梯队块各需一处）`)
      // 页面自己持有的数据源也不许带非零刷新间隔（刷新率由节拍器独占）
      const own = page.match(/refreshInterval:\s*([1-9][\d_]*)/g) ?? []
      assert(own.length === 0, `MarketPage 自己持有的 useSwr 不许带非零刷新间隔：${own.join(', ')}`)
    },
  },
  {
    id: 'flow-slots-pinned',
    why: '复盘七步里有条件渲染的块 —— 自动流会把空位补掉，块一出现编号就换位置（实测"排版来回跳"）',
    run() {
      const css = read('src/index.css.txt')
      const flow = css.match(/\.dc-flow\s*\{[^}]*\}/)
      assert(flow !== null, 'index.css.txt 找不到 .dc-flow')
      assert(/display:\s*grid/.test(flow[0]), '.dc-flow 必须是 grid（CSS 多列会"先填满一列"，把编号顺序打乱）')
      assert(/align-items:\s*stretch/.test(flow[0]), '.dc-flow 应 align-items: stretch（行内等高，高度不随数据忽高忽低）')
      for (const mode of ['flow2', 'flow3', 'flow4']) {
        assert(css.includes(`.dc-main--${mode} .dc-flow > .dc-slot-1`), `缺 .dc-main--${mode} 下的槽位列定义（dc-slot-*）`)
      }
      const page = read('src/pages/ReviewPage.tsx')
      for (let i = 1; i <= 6; i++) {
        assert(page.includes(`dc-slot-${i}`), `ReviewPage 缺 dc-slot-${i}（第 ${i} 步没被钉住列）`)
      }
      // 长列表必须限高：一行里只要有一张 40 行的卡，整行就被撑起来（高度随数据跳的来源）
      assert(/\.dc-card-list\s*\{[^}]*max-height/.test(css), '.dc-card-list 缺 max-height（长列表会把整行撑高）')
    },
  },
]

function assert(cond, message) {
  if (!cond) throw new Error(message)
}

/** 去掉行注释与块注释（契约检查针对代码，注释里的示例字符串不算违约）。 */
function stripComments(text) {
  return text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')
}

function main() {
  let failed = 0
  for (const check of CHECKS) {
    try {
      check.run()
      console.log(`  ✔ ${check.id}`)
    } catch (err) {
      failed += 1
      console.error(`  ✗ ${check.id}: ${err.message}`)
      console.error(`      为什么：${check.why}`)
    }
  }
  if (failed > 0) {
    console.error(`\n[ux-contract] ${failed}/${CHECKS.length} 条不通过（相对：${relative(ROOT, import.meta.dirname)}）`)
    process.exit(1)
  }
  console.log(`\n[ux-contract] 全部通过 ✅（${CHECKS.length} 条）`)
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main()
}
