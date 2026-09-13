# 前端体验优化方案与实施路径（实测 + 源码审计驱动）

> 对象：`@lisonevf/dsh-stock-panel` v1.4.0（DSH Web 视图标签页「A股工作台」）
> 方法：**真机实测**（运行中的 `dsh web` @127.0.0.1:3080 上操作 + 屏幕 1:1 截图，2048×1152 窗口）+ **两份并行静态审计**（视觉设计系统 / 交互与请求预算）；宿主主题令牌取真值后**对比度按实算**（非估算）。
> 日期：2026-09-12（周六，非交易日；行情为 9/11 收盘快照）

## 0. 阅读须知（避免误判下面任何结论）

- **实测实例是旧 bundle，且源码在并发修改**：页内 `v1.4.0 · ef950715`、服务端 `3873ab9c`，诊断面板①自报「不一致 —— 需硬刷新」；实测期间 `MarketPage.tsx`(12:25:01)/`MarketOverview.tsx`(12:24:58)/`LadderPage.tsx`(12:22:56)/`IndicesPage.tsx`(12:22:47) 被改、`lib/client.js` 12:25:22 重建 → 行情聚合页结论**可能已被修掉，先 diff**。
- **L2/L3/L5/L6 是像素级现象，硬刷新后必须复验**：依赖 CSS（`.dc-strip`/`.dc-rail`/图表参数），旧 bundle 规则可能与当前 `src/index.css.txt` 已有差异（现在 `.dc-strip-grow` 是 `flex:1 1 auto;min-width:0`，按 flexbox 本不该溢出却实测溢出）→ 避免修一个已经修好的问题。
- 标注与覆盖：【实测】·【源码】带 `文件:行` ·【实算】宿主真实令牌算出的 WCAG 比值 ·【未验证】。实测覆盖：状态带 / 左栏 / 复盘七步 / 作战 / 看盘(图+资金流) / 工具·行情三列 / ⌘K / 诊断面板 / 1440px 窄窗 / 键盘(`1 2 3 t [ ] Esc`) / 标签页来回切。

## 1. 结论速览

### 1.1 阻断级（不修会持续消耗信任）

| # | 现象 | 证据 | 影响 |
| --- | --- | --- | --- |
| **L1** | **「构建已更新 · 点此刷新」点了没用，还会把界面点坏** | 【实测】点击后仍 `ef950715`；点击后进入「半渲染态」：**状态带/左栏/二级导航/底栏完全不显示（DOM 与 a11y 树里都在），只有主区可见**；切标签页不恢复，整页导航 `?nc=1` 才恢复 | 更新路径不可信（`window.location.reload()` 在 HTTP 缓存下拿不到新 bundle，README 自己要求 Ctrl+Shift+R）。**真因与刷新无关，见 §9** |
| **L2** | **状态带右端被裁，核心指标 + 两个主操作看不见** | 【实测 1:1】2048 宽下 `↑643 ↓4870 涨停…` 从 x≈1935 起、被 2020 边界切断；**成交额 / 情绪≈低温 / 问模型 / ⌘K / 收左栏 / 收右栏 全在视口外**（DOM 里都在） | `.dc-strip{overflow:hidden}`＋只有 `.dc-strip-grow` 可收缩 → 左栏+右栏都开时必然溢出 |
| **L3** | **图表：左侧大片空白 + 价位线标签压住价格轴** | 【实测 1:1】蜡烛只占右侧 40–60%，左侧约 800px 空白；右侧 4 个模型价位标签**上下重叠**（支撑 86.00 与止损 84.00 直接叠死）并**盖住 Y 轴刻度** | 盯盘图是最高频界面，直接决定专业感 |
| **L4** | **非交易时段/无清单时作战页几乎全空** | 【实测】周六 12:30：只有 3 张小卡（局势 / 事件流·0 / 持仓决策台·0）+ 整屏空白；没有「今天为什么空」「下一个时段几点」「此刻做什么」 | 用户最容易在不该看盘时点进来，撞空白后不会再点第二次 |
| **L5** | **窄容器下右栏被压成竖条** | 【实测】1440 窗宽时右栏约 100px，AI 文本逐字换行 | 骨架用**视口**断点（`AppShell.tsx:130-137`），DSH 里「视口宽、容器窄」是常态 |
| **L6** | **亮色主题层级塌陷 + 小字对比度不达标** | 【实算】宿主亮色 `layer-1/2/3 全部 = #ffffff` → `.dc-score` 进度槽与容器 **1.00:1（完全不可见）**、`.dc-tag` 底色消失；`--dc-dim` = `#adb2b8` → **2.13:1**（`.dc-row-sub/.dc-foot/.dc-ai-note/.dc-empty` 等 9 类 10px 小字全程）；`--dc-text-3` **3.70:1** | 亮色是宿主默认之一，等于「一半主题下细节丢失」 |
| **L7** | **同一个数字两个单位** | 【实测+源码】状态带 `19870亿`（`StatusStrip.tsx:174` 手算 `(x/1e8).toFixed(0)`）vs 市场总览 `1.99万亿`（`MarketOverview.tsx:252` 走 `fmtBigNum`） | 同屏可比性直接失效；口径漂移的温床 |
| **L8** | **涨跌红有两套色值，其中一套不达 AA** | 【实算】token 暗色提亮 `#c74040→#e26060`（`index.css.txt:74-77`），但 **17 个文件各自重声明 `#c74040`**（`KlineChart.tsx:17`、`MarketOverview.tsx:37`…），`chip-profile.ts:80` 还是十进制 `[199,64,64]`（grep 抓不到）。暗底 `#232324` 上：硬编码 **3.17:1 ✗** vs token **4.73:1 ✓** | 同屏两种红；暗色下硬编码那套读不清 |
| **L9** | **语义反向：错误用绿、成功用红、现价永远红** | 【源码】`DiagnosticsPanel.tsx:40-45` `success→dc-up`(红)/`error→dc-down`(绿)；`StatusStrip.tsx:50` 盘中阶段用红；`StockDetailPage.tsx:321` `text-red-600`（暗底 3.25:1 ✗）跌了也红 | 与 A 股「红涨绿跌」正面对撞；诊断/状态类信息会被误读 |

### 1.2 视觉/排版级（不改会反复长回来）

| # | 现象 | 证据（量化） |
| --- | --- | --- |
| V-a | **设计令牌双轨制，等于没有设计系统** | 【源码】新轨 `--dc-*`（7 文件）+ 旧轨 Tailwind 调色板（**1090 处硬编码色类**，热点 `ReviewPage.tsx` 136 / `ReviewPanels.tsx` 81 / `ScoutPage.tsx` 70），中间靠 **61 条仅暗色生效的重映射**（`index.css.txt:1249-1374`）桥接；`tailwind.config.js` 的 `theme.extend` **是空的** |
| V-b | 字号/圆角/标题层级失控 | **17 档字号**（CSS 7 + Tailwind 任意值 14，`text-[8px]` 94 次、`text-[9px]` 116 次）、**9 档圆角**、同屏 **6 档卡片标题**（13px 页标题 vs 12px 区块标题倒挂）；`ScoutPage`/`ReviewPage` 用到 **7px/8px** |
| V-c | 数字排版 3 套配方 | `.dc-num` 24 次 / 只 `font-mono` 38 处缺 tabular / 只 `tabular-nums` 7 处缺 mono；`.dc-num` 把 `亿/万/%` 吞进西文 mono → CJK 字宽跳变（`index.css.txt:61` 无 CJK 回退） |
| V-d | 图表无主题响应 + 参数三份漂移 | 【源码】三个图表组件各复制一份 `createChart` 参数（量副图 margins 0.85 vs 0.8；分时缺加载遮罩）；全仓 `MutationObserver` **0 命中** → 宿主切主题图表不重绘。轴色 `#94a3b8`：暗底 6.11:1 ✓ / **亮底 2.57:1 ✗**；**十字线数值标签两主题都只有 1.85:1**；量柱 `rgba(199,64,64,.45)` 暗底合成 **1.84:1 ≈ 不可见**（与实测「量柱偏淡」一致） |
| V-e | 状态实现碎片化 | 加载态 **7 种**、错误态 **5 种**、空态 **4 种**；**`MarketPage` 自身零兜底**（grep loading/error/暂无 全 0）；`AlertWatcher.tsx:124` 轮询失败静默（用户以为"今天没信号"）；**超时态全仓缺失**（链路有 25s 超时，UI 无体现） |
| V-f | 可访问性未达标 | 全仓 **只有 2 处 ARIA**；**无任何 `:focus-visible`/`focus:ring`**，14 处 `outline-none`；**10 处 `div/span/li onClick` 键盘不可达**（左栏每一行、⌘K 面板行）；控件高度 **13–27px 全部 < 24px**（WCAG 2.2 SC 2.5.8 不通过）；无 `prefers-reduced-motion`；图表 canvas 无替代文本 |
| V-g | 魔法数布局 | `MarketPage.tsx:182` `calc(100vh - 216px)`（宿主字号可调 12–17px → 必然错位）；`.dc-panel-body{height:208px}` 硬编码；主图吃 60% 高度而下面板固定高 |

### 1.3 交互/预算级（详见 §4）

| # | 现象 | 证据 |
| --- | --- | --- |
| I-a | **复盘「次日预期清单」草稿只在组件内存**：点任意股票（会切看盘）/切视图/切宿主标签页 → 静默清零 | `ReviewPage.tsx:143`（只在点「存档」时写库 `:580-613`） |
| I-b | `MarketPage` 宣称「全页只有一个节拍器」不成立：三块自带定时器（20/15/30s）都没关 | `MarketPage.tsx:288-322` 未传 `pollMs`；`MarketOverview.tsx:77`/`IndicesPage.tsx:39`/`LadderPage.tsx:37` |
| I-c | 同 cache key 多定时器：指数最多 **4 个**、全 A 最多 **5 个来源**；隐藏右栏不等于停轮询 | `cache.ts:239-248`、`StatusStrip.tsx:58/60`、`use-ai.ts:89-105`、`AppShell.tsx:113-119` |
| I-d | 并发越界：自选盘 60 只 = **60 并发**（README 承诺池 ≤6）；告警 12s×≤10 次/分，而这些价格全在全 A 快照里 | `WatchlistPage.tsx:43`、`AlertWatcher.tsx:68-101`、`pool.ts:20` |
| I-e | 错误三类（业务错/未知工具/数据源离线）在 UI 上同形；多处无重试；`quote.error` 从不渲染；⌘K 搜索失败被吞成「无匹配」 | `mcp.ts:68-70`、`WatchView.tsx:59-63`、`AppShell.tsx:425-427` |
| I-f | 键盘：`j/k` 在左栏收起时仍换标的并强制切视图；`Esc` 一次关三样；⌘K 输入框内 ⌘K 被守卫吞掉且无焦点回归；左栏行不可聚焦、`j/k` 不滚动到可见 | `AppShell.tsx:175-217`、`WatchList.tsx:114-131`、`selection.ts:406-424`（死代码） |
| I-g | 破坏性操作全仓 **0 处**确认/撤销（清空自选/删规则/删持仓/清命中/清 AI 存档） | grep `confirm(` 0 命中 |
| I-h | 9:30–10:00 竞价「验证窗」有提示没入口；竞价雷达 9:25 就消失（方法论窗口是 9:15–9:35） | `WarPage.tsx:75, 217`、`WATCH-METHODOLOGY.md:120,164` |
| I-i | 多标签页互踩：全仓无 `storage` 事件监听 → B 标签写任意一条会把整份内存态推给 host，复活 A 已删记录 | `host-state.ts:303-306` 自认；8 处 store 同款钩子 |

## 2. 四条根因（决定优化顺序，不是逐条打补丁）

- **R1 令牌双轨制 → 视觉问题会反复复发**：`--dc-*` 新轨 + 1090 处 Tailwind 硬编码 + 61 条仅暗色生效的重映射三者叠加，任何新组件都可能「亮色对、暗色错」或反之；宿主亮色下 `layer-1/2/3 全塌成 #ffffff` 是这种桥接策略的必然产物。**A5（令牌迁移）不是美化项，是其它视觉项的地基。**
- **R2 用「视口」而非「容器」决定布局，且没有溢出策略**：骨架 `useMediaQuery('(min-width:1120px)')`（`AppShell.tsx:130`）、`.dc-flow` 视口断点、rails 固定 268/344px、`.dc-strip{overflow:hidden}` 且无溢出菜单；同一教训**已经在行情页修过**（容器 `ResizeObserver`，`MarketPage.tsx:96-122`）但没上升为骨架级约定 → L2/L5/L6 都是它的表现形式。
- **R3 异步与状态的「契约」不统一 → 静默失败与丢数据**：错误 `kind` 在 client 侧丢失；三态实现 7+5+4 种；草稿只在内存；破坏性操作无确认；轮询叠加无预算门禁。
- **R4 工程隐患（两处，一行到几行就能修，但有结构性风险）**：① **Tailwind preflight 泄漏到宿主 `<head>`** —— `index.css.txt:1377` 注释称「preflight 关闭」，但 `tailwind.config.js` **没有** `corePlugins:{preflight:false}`，而 `client.ts:132-135` 把编译 CSS 注入宿主 `<head>` → `*{border-width:0}`、`button{background-color:transparent}` 等全局元素选择器与宿主同特异性竞争；实机**未观察到**宿主明显回归（宿主以 CSS-modules 类选择器为主，特异性更高），**影响有界但结构性**，修法一行【未验证：未做宿主逐组件回归巡检】。② **`postcss.config.js` 是死配置且是地雷** —— 包是 `type:module` 而该文件用 `module.exports`（非法 CJS），`scripts/build-client.mjs:44-54` 完全绕过它；`tailwind.config.js` 在 ESM 包内用 `require('tailwindcss-animate')`（靠 jiti 容忍）；`content` 里的 `'./index.html'` 在仓库根不存在。

## 3. 视觉优化方案

状态图例：✅ 已落地 · 🟡 部分落地 · ❌ 未落地（批次见 §9–§11）

| 项 | 问题 → 做法（含验收） | 状态 / 落点 |
| --- | --- | --- |
| **V1 状态带：任何宽度下 8 个信息 + 4 个操作永不消失** | （L2）分段优先级 `阶段`/`一级导航`（必须）> `指数条`（可滚）> `广度+涨跌停`（必须）> `成交额`（可收）> `情绪`（可收）> `问模型/⌘K/收栏`（必须，右端固定簇）；被收段必须进右簇 `⋯` 溢出菜单（popover/tooltip），不允许「静默消失」。**验收**：容器 1676 / 1200 / 900 / 700 四档截图，右簇 4 个操作与「广度」必须可见，右簇 boundingRect 不越界 | ✅ 批次 1：改 grid `auto auto auto auto minmax(0,1fr) auto` + full/mid/tight/min 分档 + `⋯` 菜单 + 指数条横滚，落点 `src/panel/StatusStrip.tsx`/`src/index.css.txt`。四档截图基线仍未建（§9 剩余验证 1） |
| **V2 图表** | （L3 + V-d）① `fitContent()`/`setVisibleLogicalRange` 修「120 根只占半幅」；② 标签间距 < 标签高度时合并为一个标签块（`压力 92.66 / 目标 96.63`），**不得覆盖 Y 轴刻度**；③ 抽 `lib/chart-theme.ts` 统一网格/轴/十字线/量柱/水印，`MutationObserver` 监听 `body[data-ds-dark-theme]` → `applyOptions` 重绘；④ 量柱与蜡烛同色系、**只降明度不降透明度**；⑤ 模型价位改中性/专属色（橙/紫/蓝）+ 虚线阶数，消除与涨跌语义打架。**验收**：4 个标签 bounding box 两两不相交；120 根时首根蜡烛 x 距绘图区左缘 < 40px；亮/暗两主题下轴与十字线对比度 ≥ 4.5:1 | 🟡 批次 2 完成 ①–④：`src/lib/chart-theme.ts` 被 `KlineChart.tsx`/`IndexChart.tsx` 复用 + 主题订阅；`createRangeFitter` 按实际根数 `setVisibleLogicalRange(-0.5..bars-0.5)`；标签按 `priceToCoordinate` 像素 y 传递式聚簇（阈值 16px ≈ 标签高度）、`axisLabelVisible` 全关（零遮挡）；量柱 `themeRgb ×0.9` 降明度 + alpha 0.85 预乘（亮 4.44/4.49:1、暗 3.06/4.01:1，旧值 1.84:1）；轴色改 `text-2`（2.57 → 7.58:1）。**剩余**：**⑤ 未做**（tone→颜色集中在 `PRICE_LINE_TOKENS`，语义在 `WatchView.tsx` 传参处）；`StockIntraday.tsx` 仍是第三份 `createChart` 副本（无主题订阅、旧量柱 alpha，owner 只需改 import）；标签聚簇像素效果未验证 |
| **V3 复盘页密度与层级** | （L6 实测切字 + V-b）① 卡片指标分三级：`温度/档位/主线` 一级（14–20px，**≤3 个**）、`涨停/跌停/额` 二级（12px + 单位统一）、`晋级率/炸板率/首板溢价` 三级（11px，收进「口径与近似」行）；② 卡片内指数条删除或改横滚（指数已在状态带常驻，实测已被列宽切断「科创…」）；③ 七步导航 chip 加状态语义（已完成 ✓ / 有待办 / 未看）并解释「⑦ 计划」为何高亮（现状无图例）；④ 撤销 7px/8px 字号，`ScoutPage`/`ReviewPage` 最小字号 ≥ 10px | ❌ 未落地：批次 2/3 记录中无本项；`ReviewPanels` 的 `text-[8px]` 明确仍在（§10） |
| **V4 令牌与排版收口** | （R1，批次 2 的地基）① 四语义色 token（亮/暗各一套）`--dc-price-up`(红)/`--dc-price-down`(绿)/`--dc-warn`(琥珀)/`--dc-info`(蓝)，**硬规则：警示/阈值/状态不得复用 price-up/down**；② 消灭 17 个文件里的色常量（新建 `lib/theme-colors.ts`、删死函数 `format.ts:46 priceColorClass`、收口 `chip-profile.ts:80` 的十进制 `[199,64,64]`）；③ 字号 6 档（10/11/12/14/18/20）+ 圆角 4 档写进 `tailwind.config.js` 的 `theme.extend`（现在为空），清理 3 个零引用 CSS 类（`dc-card`/`dc-card-head`/`dc-nav-badge`）；④ `<Num>` 数字组件（`font-mono`+`tabular-nums`、单位/CJK 移出等宽、千分位、缺失值 `—` 与 `0` 区分、`title` 原始值）；⑤ 单位单一入口 `fmtAmount`（亿/万亿自动）+ `fmtPctPercent`/`fmtPctRatio` 改名 → 修 L7；⑥ 次级文字对比度：`--dc-dim` 改映射 `tertiary`、`--dc-text-3` 亮色改 `bluish-700` → 9 类 10px 小字从 2.13–4.24:1 提到 ≥4.5:1，亮色下 `.dc-score`/`.dc-tag` 需真正的层级色（不能全 `#fff`）。**验收**：`grep -c '#\(c74040\|dc2626\|ef4444\)'` = 0；亮/暗两主题逐屏截图 + 对比度清单全绿 | ✅ 批次 2（§10）：`theme-colors.ts` 已替换 **45 处**字面量、覆盖 17 个文件；`src/components/Num.tsx`；`theme.extend` 补成 6 档字号 + 4 档圆角 + 语义色；`format.ts` 新增 `fmtAmount`/`fmtPctRatio`/`fmtPctPercent`/`upDownClass`（`fmtBigNum` 保留为 deprecated 别名）；对比度明细见 §10。**剩余**：`<Num>` 目前只接进状态带，其余页面属渐进迁移（契约脚本拦新增硬编码） |
| **V5 三态组件化** | （V-e / L4）① 新建 `components/StateView.tsx`：`loading`（固定高度骨架防抖动）/`empty`（原因 + 下一步动作按钮）/`error`（kind + 人话原因 + 重试 + 诊断入口），替换现存 7+5+4 种实现；② 补缺失：`MarketPage` 自身兜底、`AlertWatcher` 失败可见、`WatchlistPage`/`AlertsPage` 空态、**超时态（25s）**；③ 作战页非交易时段 → 静默期界面（「今天周六 / 当前属休市」「下一时段 14:30 尾盘定仓（还剩 1h57m）」「此刻该做的 3 件事：写清单/看风向标/归档复盘」）；④ 复盘「强度差分分析中…（10–40s）」固定高度占位，不得推动已填表单。**验收**：非交易日 + 空自选 + 首次使用 三种冷启动下主区不出现 > 1/3 屏的纯空白 | ✅ 批次 2：`StateView.tsx` 为三态唯一实现（`error` 类型级必填 `onRetry`（错误态不许是死胡同）+ `kindLabel` + 独立 `reason` 行 + `classifyStateError()`）；已接进 `MarketPage`/`AlertWatcher`/`WatchlistPage`/`AlertsPage`/`WarPage`（静默期界面） |
| **V6 可访问性与热区** | （V-f，配合批次 3）① 全局 `:focus-visible`（现无，且 14 处 `outline-none`）、10 处 `div/span/li onClick` 改 `button` 或加 `role+tabIndex+keydown`；② 交互控件 `min-height: 24px`（WCAG 2.2 SC 2.5.8）；③ 弹层 `role="dialog"` + `aria-modal`，Toast/加载/错误加 `aria-live="polite"`；④ `prefers-reduced-motion` 兜底，图表 canvas 加 `aria-label` 概述（标的/周期/区间） | 🟡 批次 3：命中区达 SC 2.5.8（`.dc-nav-item` 垂直内边距 5→6px = 24px，窄档只收水平内边距，契约 `hit-target-24px`）；诊断面板 `role="dialog" aria-modal`；⌘K `aria-activedescendant` + 焦点回归；`WatchList` 行 roving `tabIndex` + `role="button"`/`role="group"`；`StockInfoBar` 的 `<span onClick>` 改真 button。**剩余（本批记录无落地证据，【未验证】）**：`prefers-reduced-motion`、图表 canvas `aria-label`、`outline-none` 全量收敛、其余 `div/span/li onClick` 可达性 |
| **V7 布局魔法数** | （V-g）`MarketPage.tsx:182` 的 `calc(100vh - 216px)` 改由容器高度实测（`ResizeObserver`，与列数同源）；`.dc-panel-body{height:208px}` 改比例 + 最小高度；主图与下部面板共享同一「高度预算」变量 | ✅ 批次 1：`useAvailableHeight` 取代 `calc(100vh - N)`，契约「无 `100vh` 魔法数」已进 `scripts/ux-contract.mjs`；`.dc-panel-body{height:208px}` 的改动在实施记录中**无记录【未验证】** |

## 4. 操作体验优化方案

| 项 | 问题 → 做法 | 状态 / 落点 |
| --- | --- | --- |
| **I1 更新路径与半渲染自检** | （L1，批次 0 止血）① 刷新按钮改带 build 的硬刷新 `location.replace(location.pathname + '?b=' + serverBuildId)`（或让 host 输出的 client 模块 URL 带 build query，URL 变化天然绕过缓存）；② 底栏文案改「**已更新到 <build> · 点此加载新版**」+ 加载后一次性「版本 x → y」提示；③ **半渲染自检**：挂载后测 `StatusStrip` 高度（应 38px）与 `offsetParent`，异常 → 顶部横幅「界面未完整加载，请硬刷新」+ 一键硬刷新 | ✅ 批次 0（§9）：`src/lib/build-info.ts` 新增 `hardReload()`、底栏文案、`useChromeHealth` 半渲染自检 + 自愈落地（真因修正见 §9） |
| **I2 复盘草稿持久化** | （I-a，功能修复优先级最高）① 新增独立键 `review-draft:v1`（host 表 + localStorage 镜像），`ReviewPage` 的 `expectations` 读写草稿，存档成功清草稿，离开视图且有未存档草稿时一次性确认（不阻塞）；② 顺带：⌘K 支持搜「复盘/作战/看盘」入口与「今日清单里的票」，⑦ 支持「复制上一份清单」，字段值按标的内存 | ✅ 批次 3（§11）：`src/lib/review-draft.ts` + `state-tables.ts` 注册 `review_draft` 表 + `ReviewPage.tsx`；键名 `dsh-stock-panel:review-draft:v1`；上限与产品约束一致（预期 ≤5、风向标 ≤8）；纯逻辑/副作用分离；写入 = 每次编辑写 localStorage + **1s 防抖推 host**；单测 `tests/review-draft.test.ts`（unit 11 → 12 文件全过） |
| **I3 错误契约与重试** | （I-e）① `mcp.ts` 抛带 `kind`（business/unsupported/unavailable）的错误，统一 `<ErrorBar onRetry kind>`，补 `quote.error`、竞价雷达、强度差分、信号分析、概念命名、`syncTable` 的重试入口；② 命令式取数失败保留上次结果并标注「上次成功 12:31:05」，状态带与各页展示同一节拍来源 | ✅ 批次 3：`lib/mcp.ts` 把 host 侧 `kind` 带到前端（原 `mcp.ts:68-70` 直接丢弃）；新建 `src/components/ErrorBar.tsx`；`WatchView` 报价失败不再永久 `—`、`AuctionRadar` 失败不再是空面板、`StockConceptCard` 命名失败可重试、`ScoutPage` 信号分析补进度/失败/**取消**。**剩余**：`ErrorBar` 分类文案未与「不同建议」逐条对齐（如 unavailable 应建议「稍后重试 / 看诊断面板」） |
| **I4 键盘与焦点** | （I-f）① 把 `AppShell.tsx:175-217` 抽成纯函数 `resolveHotkey(ctx)` → 单测覆盖现有无人守的契约（输入框内 ⌘K 无效、Esc 只关最上层…）；② `Esc` 只关最上层，左栏行/⌘K 结果行/事件流行可聚焦 + `scrollIntoView`，`j/k` 与焦点同步、左栏收起时失效；③ ⌘K 补 `role=dialog` + 焦点陷阱 + 关闭后焦点回归 + ↑↓ 选择（现状只能拿第一条） | ✅ 批次 3：`src/lib/hotkeys.ts` 的 `resolveHotkey(ctx)` → 动作判别式（`openPalette`/`closePalette`/`closeTop{layer}`/`toolToggle`/`watchMove{±1}`/`setView`/`askAi`/`toggleLeftRail`/`toggleRightRail`），三条行为成可测契约：**面板开着时 ⌘K 也能关**、**Esc 只关最上层**、**左栏收起时 j/k 无效**（原先误按会把复盘草稿顶掉）；`AppShell` 改「解析 → 分发」；⌘K 搜索失败与「无匹配」可区分；`WatchList` 行 j/k 搬真实焦点 + `scrollIntoView({block:'nearest'})`。**剩余**：`tests/hotkeys.test.ts` 未落盘 → 契约唯一红灯 `hotkeys-pure-and-tested`（20/21）；真机端到端未复验 |
| **I5 流程摩擦** | （对照 `WATCH-METHODOLOGY.md` §8）① **9:30–10:00 验证窗**：`ExpectVerdictPanel` 挂载条件扩到交易时段验证窗（`mission.ts:153-164` 已有判定），判定 chip 支持「再判定」而非「再点=取消」（隐藏语义）；② 竞价雷达保留只读至 9:35；③ 尾盘：持仓可直接建（不必先加自选），平仓价默认填**当前价**而非成本价，Q3 与平仓合并为一处写回 | ❌ 未落地（批次 4 范围） |
| **I6 请求预算与节拍纪律** | （I-b/c/d）① `MarketPage` 三块补 `pollMs={0}`（**该文件刚被改过，先 diff**），页头「轮询中 N/3」的代价说明要与实测一致；② `cache.ts` 做「每 key 单调度器 + 最小间隔」（保留 `refresh()` 绕过 ttl 的语义）；③ 右栏隐藏停 `useAiVerdict` 的三个轮询，`WatchlistPage`/`AlertWatcher` 价格改读全 A 快照（零成本，并把 60 并发降到 ≤6）；④ `WarPage.tsx:124` 的 `fetchAllA(true)` 改回不强制（避免 2MB 快照重复拉）；⑤ 新增 `scripts/budget.mjs`：静态统计轮询点 → 次/分 + 最大并发，阈值进 CI | 🟡 仅护栏 ⑤ 已落地：`scripts/budget.mjs` + `budget-baseline.json`（棘轮：只降不升，`budget-ignore` 豁免纯 UI 定时器）已进 CI，基线 `maxTimersPerKey = 4`（指数 4 个、全 A 4 个订阅者）。①–④ 收口**未落地**（批次 4），改完必须 `budget --check` 仍绿 |
| **I7 多标的并行（可选）** | 「看盘 › 台账」二级页：5–8 行（价格/涨跌幅/量比/距涨停/AI 存档结论摘要），价格全取全 A 快照（**零新增请求**），只对展开行挂 K 线（`ttl:60s` 无轮询）；不动唯一真源，窄屏可用；用于替代「主区 2–4 格分屏」 | ❌ 未落地（可选，批次 4） |
| **I8 破坏性操作确认/撤销** | （I-g）清空自选、删规则、删持仓、清命中、清 AI 存档 → 二次确认或 6s 撤销条（统一一个 `<UndoBar>`） | ✅ 批次 3：`src/components/ConfirmButton.tsx`（**两段式内联确认**：首点进入待确认态并出现「取消」、5 秒无操作自动回退、Esc 取消、读屏可感知；不弹 `window.confirm`、不新增 CSS），接入 4 处不可逆操作：自选清空、监控规则删除、监控命中清空、持仓记录删除 |

## 5. 实施路径

| 批次 | 内容 | 验收 | 工作量 | 状态 |
| --- | --- | --- | --- | --- |
| **0｜止血 + 护栏** | I1 更新路径 + 半渲染自检；R4 关 preflight（一行）+ 删死 `postcss.config.js`；`scripts/budget.mjs` 最小版；`scripts/snapshot.mjs` 四档宽度基线 | 「点此刷新」真的换版本（页内 build == 诊断①）；budget/snapshot 进 CI | 0.5–1 天 | ✅ 落地（`snapshot.mjs` 缩水，见 §9） |
| **1｜尺寸与布局（性价比最高）** | `useContainerWidth` 提升到 `panel/hooks.ts` 并被骨架/状态带/列流复用；V1 状态带分段优先级 + 右簇 + `⋯` 溢出菜单；V7 去掉魔法数；卡片内指数条改横滚 | L2/L5/L6(切字)/V-g 消失；四档宽度断言通过 | 1–2 天 | ✅ 主体落地（四档截图基线未建） |
| **2｜令牌 + 图表 + 三态** | V4 四语义色/字号圆角令牌/`<Num>`/单位单一入口/对比度修补（一次修掉 L7/L8/L9/V-a~c）；V2 图表主题 hook + fitContent + 标签防碰撞 + 量柱配色；V5 `StateView` 三态替换 + 作战页静默期界面 | `grep` 硬编码色 = 0；亮/暗对比度清单全绿；图表断言通过；冷启动无大空白 | 3–4 天 | ✅ 落地（V2-5 与 `StockIntraday` 除外） |
| **3｜交互契约** | I2 草稿持久化；I3 错误 kind + ErrorBar/重试；I4 键盘纯函数 + 单测 + 焦点陷阱 + 左栏可达；V6 a11y（focus-visible / 24px 热区 / dialog 语义）；I8 确认/撤销 | 新增单测覆盖 hotkey 契约与草稿；「填到一半点票不丢」实测；三类错误可区分 | 3–4 天 | 🟡 代码/单测层完成，真机未复验、`hotkeys.test.ts` 缺 |
| **4｜流程与预算** | I5 验证窗/尾盘/清单复用；I6 请求预算收口；I7 多标的台账（可选）；I9 多标签一致性（`storage` 监听，S/M） | 章节「次/分」下降 ≥50%；9:30–10:00 可改判定；台账页零新增请求 | 4–6 天 | ❌ 未开始 |

**依赖**：批次 0 → 1（护栏先于大改）；批次 2 与 3 可并行（文件域不同）；批次 4 的 I6 与**正在进行的 `MarketPage` 改动**合并落地，避免二次冲突。
**每批固定动作**（沿用仓库既有纪律）：`pnpm lint` → `pnpm test` → `pnpm build` → 重启 `dsh web` → **硬刷新** → `pnpm smoke:*` + `pnpm verify:live` → 四档截图对比。

## 6. 回归护栏（今天 90% 的结论都不会被 CI 拦住）

| 护栏 | 内容 | 成本 | 状态 |
| --- | --- | --- | --- |
| `scripts/budget.mjs` | 静态解析 `refreshInterval`/`setInterval` + 调用方 → 次/分 + 最大并发，阈值报警（ROADMAP B3-⑤） | S | ✅ 已建，基线 `maxTimersPerKey = 4` |
| `scripts/snapshot.mjs` | 对运行中的 `dsh web` 在 4 档容器宽度截图 + 关键元素 boundingRect 断言（状态带右簇不越界、价位标签不重叠、右栏不被压 < 200px、冷启动无大空白） | M | ❌ 仍未建（批次 0 唯一缩水项） |
| `resolveHotkey` 单测 | 把快捷键 if 链变可测契约（输入框内 ⌘K 无效、Esc 只关最上层…） | S | ❌ `tests/hotkeys.test.ts` 未落盘 |
| `tests/review-draft.test.ts` | 草稿读写/清空/跨视图保留 | S | ✅ 已建 |
| 对比度清单脚本 | 用宿主真实 token 值算 WCAG 比值，列出 < 4.5:1 的组合并门禁（`--dc-dim` 2.13:1 会被直接拦住） | S/M | ✅ `scripts/contrast.mjs`（`guard:contrast` 已进 CI；覆盖 15 组配对） |
| eslint `jsx-a11y` | 现在没装；装了才能守住「行可聚焦 / 弹层 role / aria-live」 | S | ❌ 未装 |
| `pnpm verify:live` 扩展 | 真机端到端断言（build 一致性、状态带可见性、四档宽度） | M | ❌ 未扩展（`scripts/verify-live.mjs` 留有扩展位） |

## 7. 明确不做 / 暂缓

- **不做**全量视觉重写：只做「四语义色 + 6 档字号 + 4 档圆角 + `<Num>` + 图表主题」五处收口，其余沿用现有 Tailwind（A5 的 1090 处迁移按批次 2 分文件推进，不搞一次性大爆炸）。
- **不做**移动端适配：DSH 宿主是桌面 Web；只保证「窄容器可用」（批次 1）。
- **暂缓**主区 2–4 格分屏（多图表实例的内存/CPU 与窄屏代价不划算），用 I7 台账替代。
- **暂缓**「看盘 › 工作台 / 明细」合并（ROADMAP 已登记）：牵动两套取数路径，建议批次 4 之后单独做。
- **不做**超过 1 屏的装饰性动效；动效只用于状态变化（加载/更新/命中）。

## 8. 附录

**A. 实测证据索引**（1:1 截图，未入库）：`sb1/sb2`＝状态带左右两半（L2 溢出被裁）· `fresh_top`＝全新加载正常态（对照 L1 半渲染）· `w_d/w_a`＝图表（价位标签重叠、绘图区左空白、量柱偏淡，L3/V-d）· `war_l/war_r`＝作战页三小卡 + 整屏空白（L4）· `rev1`＝复盘①卡（密度、指数条被切、红绿混用，L6/L9）· `narrow`＝1440 窗右栏竖条（L5）· `palette`＝⌘K 面板形态 · `full2/full3`＝复盘列流整体 / 作战空态整体。

**B. 关键源码位置**：骨架/快捷键 `src/panel/AppShell.tsx:98-137, 175-217, 224-385` · 状态带 `src/panel/StatusStrip.tsx:50, 58-62, 84-227`、`src/index.css.txt:92-133` · 栏宽/溢出/脚注裁切 `src/index.css.txt:195-264`（列流断点 `:1191-1207`、重映射层 `:1249-1374`、preflight 注释 `:1377`） · 复盘页 `src/pages/ReviewPage.tsx:143, 176-323, 580-613, 894-1070` · 作战页 `src/pages/WarPage.tsx:75, 115-181, 210-229` · 缓存与轮询 `src/lib/cache.ts:98-154, 239-253`、`src/pages/MarketPage.tsx:96-157, 182, 288-322` · 错误契约 `src/lib/mcp.ts:68-70`、`src/panel/DiagnosticsPanel.tsx:40-45` · 色彩硬编码热点 `src/components/KlineChart.tsx:17`、`src/pages/MarketOverview.tsx:37,252`、`src/components/chip-profile.ts:80`、`src/pages/StockDetailPage.tsx:321` · 持久化 `src/lib/host-state.ts:179, 187-214, 249-264, 303-326`、`src/lib/state-tables.ts:40-97` · 构建配置隐患 `tailwind.config.js`（`theme.extend` 空、无 `corePlugins.preflight:false`）、`postcss.config.js`（非法 CJS 死配置）、`scripts/build-client.mjs:44-54`

**C. 【未验证】清单（落地前请实测）**：亮色主题逐屏实测（本次未切宿主主题）· 逐控件 Tab 焦点环可见性 · 极值数值溢出（北交所 +29.87% 撑破 `w-14`？）· 热键与输入框冲突的完整矩阵 · 宿主 token 全量覆盖率 · preflight 泄漏对宿主的逐组件影响 · bundle 体积回收实测量（现 567KB/600KB，余量 5.5%）· 主图透明背景与宿主占位文字是否叠加 · host 端 TDX 串行队列时延与 25s 超时的关系 · 窄屏实测观感（本次仅到 1440 窗口宽）。

## 9. 实施记录：批次 0 + 批次 1（2026-09-12 落地）

> 状态：**已实现并通过全部门禁**（`tsc` / `eslint --max-warnings 0` / `unit` / `ux-contract` / `budget --check` / `bundle size` / 4 个 smoke 全 0 退出；`pnpm build` 成功）。
> **L1 根因修正（与原方案不同，且更严重）**：原方案归因于刷新路径，真机取证后发现真因与刷新无关 —— 宿主会话列本身是**滚动容器**（`*_scrollBody`：clientHeight 851 / scrollHeight 1192），`.dsh-stock{height:100%}` 在宿主给不出确定高度时退化成 `auto`、被内容撑到 **983–1236px**，于是宿主**持续**把它往下滚（同一进程 scrollTop 318 → 341 → 364 → 594，shell 高度同步 959 → 983 → 1006 → 1236），面板顶边跑到视口上方 **242–495px** → 状态带（+左栏顶部）被顶出可视区；DOM 与 a11y 树里一切正常、控制台无报错 —— 这就是「界面莫名少一块」的真相。

| 项 | 结果（结论） | 落点 |
| --- | --- | --- |
| L1 半渲染自愈 | `AppShell` 用 `useAvailableHeight(shellRef)` 量出「到最近滚动容器可视底边」的可用高度给 `.dc-shell` 封顶（面板不再溢出 → 宿主没得可滚）；`useChromeHealth` 同时做两件事：**判据收紧**（用 `document.elementFromPoint` 取状态带中心点最上层元素，必须是本插件自己的节点）+ **自愈**（把宿主滚动容器拨回让面板顶边可见，只改 `scrollTop`、不碰宿主 DOM，最多 3 次）；治不了才显示顶部红色告警条 + 一键硬刷新 | `src/panel/hooks.ts`、`src/panel/AppShell.tsx` |
| 状态带 flex 不可能可靠 → 改 grid | 复现规律：快照从「加载中」变真实数据时右簇被推出可视区（flex 只有中间可伸缩，右簇 `flex:none` 不能收缩，被 `overflow:hidden` 静默切掉）。改 `grid-template-columns: auto auto auto auto minmax(0,1fr) auto` —— 可缩到 0，**结构上不可能把后面的轨道挤出去**；子节点恒为 6 个（缺内容也渲染空 div） | `src/panel/StatusStrip.tsx`、`src/index.css.txt` |
| R4-1 preflight（唯一「动了宿主观感」的改动） | `corePlugins.preflight = false` + `index.css.txt` 补「作用域版 preflight」（`:where()` 保证特异性 0，逐条补 `border-width/style/color`、`[hidden]`、`a`、`h1-h6`、`input/select/textarea`、`table`、`img/video/canvas`）；产物核对：全局 `*{border-width:0}`/`html{…}`/`body{…}` 均已消失，`--tw-*` 默认值仍在。依据：宿主自带 `html,body,#root{height:100%;margin:0}`、宿主组件的 `box-sizing`/`border:none` 都在各自 CSS Modules 类里显式声明（抽查 9 处）、官方 `web-styling` 规范禁止引入 Tailwind | `tailwind.config.js`、`src/index.css.txt` |
| R4-2 死配置 | 删除（`type:module` 包里的非法 CJS；构建走 `build-client.mjs` 的 PostCSS JS API） | `postcss.config.js` |
| 护栏（3 项） | 请求预算棘轮（静态统计轮询点 → 次/分 + 同 key 定时器数；只降不升；`budget-ignore` 豁免纯 UI 定时器）；10 条界面契约静态断言（preflight 关闭、作用域 reset、状态带 grid、无 `100vh` 魔法数、列流按容器、骨架用容器宽度、`hardReload`、半渲染自检、死配置不存在）；两者进 CI | `scripts/budget.mjs` + `budget-baseline.json`、`scripts/ux-contract.mjs`、`package.json`/`.github/workflows/ci.yml`（`budget`/`guard:ux`/`guard`） |
| 骨架级 hooks 与骨架改造 | 新增 `useContainerWidth`（`useLayoutEffect` 首帧即量）/`useAvailableHeight`（替代 `100vh - N`）/`useChromeHealth`（判据 + 自愈 + 可复制诊断日志）；骨架按**容器宽度**决定栏位与列流（`is-w-narrow`/`is-w-min`/`dc-main--flow2\|3`）、`.dc-shell` 高度封顶、半渲染告警条、`hardReload`、底栏「已更新到 <build> · 点此加载」、`?dshPanelDebug=1` 几何采样；状态带 grid + full/mid/tight/min 分段优先级（按宽度把 涨停跌停/成交额/情绪/指数条 收进 `⋯`）+ `⋯` 溢出菜单（`role=dialog`+`aria-expanded`，`position:fixed` 不被裁）+ 指数条横滚；`.dc-flow` 改由 `dc-main--flow*` 驱动（删视口媒体查询）+ 窄容器栏位规则；`MarketPage` 删除本页自带 `useContainerWidth`、`calc(100vh - 216px)` → `useAvailableHeight` | `src/panel/hooks.ts`、`src/panel/AppShell.tsx`、`src/panel/StatusStrip.tsx`、`src/index.css.txt`、`src/pages/MarketPage.tsx` |
| 真机几何验证（`?dshPanelDebug=1`） | 2048 / 状态带 1760：装载中 → 指数条 1300@540、右簇 178@1852；数据到位 → 指数条 1048@540、右簇 **430@1600..2030（全在面板内）**。1426 / 1138 → **tight**：指数条 696@501、右簇 199@1209（含 `⋯`）、左栏收窄 **220**。1166 / 878 → **min**：指数条 436@501、右簇 199@949、左栏 220 ✅、**右栏自动收起（w=0）** ✅。栏位常态：左栏 268 / 右栏 344。即分档、右簇不被挤出、窄容器收窄左栏与自动收起右栏全部按**容器实测宽度**生效 | — |

**本批未完成的验证（下一步第一件事）**：① **四档容器宽度的像素级截图基线**未建 —— 本次只用几何采样（数字）验证分档与不被裁切，`scripts/snapshot.mjs` 仍未建，是批次 0 承诺里唯一缩水的一项（CI 里没有浏览器依赖，先把可离线判定的 10 条契约落了地）；② **暗色主题**未逐屏复验（宿主当前为亮色）；③ **preflight 关闭后宿主自身的观感**未逐屏巡检（依据见上表 R4-1，风险有界但应补一次人工过屏）；④ `MarketPage` 的 `useAvailableHeight` 只在代码层验证（无 3 列聚合页的实机截图）；⑤ 刷新按钮的「真的换版本」验证：本次靠 Ctrl+Shift+R 加载到新 bundle 证明了链路，`hardReload`（带 build 参数）需下一次构建后用底栏按钮实测一次。

**对后续批次的影响**：批次 2/3/4 不变，但优先级两处调整 —— ① `⋯` 溢出菜单已落地 → 批次 2 的「状态带分档」不用再做，工时移到对比度/令牌收口；② **多了一个必做项**：`useChromeHealth` 这类「宿主容器耦合」自检应推广到 `dc-main`（列流/主区是否被宿主裁切），并考虑把几何采样固化进诊断面板（现在只有 `?dshPanelDebug=1` 打控制台）。批次 4 的请求预算收口依据已量化：`maxTimersPerKey = 4`（指数 4 个、全 A 4 个订阅者）已进基线，改完必须 `budget --check` 仍绿。

## 10. 实施记录：批次 2（令牌 / 单位 / 对比度 / 图表 / 三态）

| 项 | 结果（结论） | 落点 |
| --- | --- | --- |
| 四语义色收口（原 P0-1/3/4） | 涨跌色原在 **22 个文件**里各自字面量声明（暗色下 token 已提亮而字面量没有 → 同屏两种红 3.17:1 vs 4.73:1）：新增唯一入口，**DOM 场景用 `'var(--dc-up)'`**（浏览器解析、自动跟随主题、零 JS）、**canvas/图表用 `themeColor('up')`**（缓存 + 主题变化失效），已替换 **45 处**字面量、覆盖 17 个文件（含 grep 抓不到的 `chip-profile.ts` 十进制 `[199,64,64]`）；诊断面板 `success→dc-up`/`error→dc-down` 改到与价格语义解耦的 `.dc-ok/.dc-bad/.dc-warn/.dc-info`（`DiagnosticsPanel` 5 处、`StatusStrip.phaseTone` 原 `trading→红`）；个股「现价永远红」改为按最后两根 K 线比较方向（涨红/跌绿/平或数据不足中性）；语义色底不再写死 alpha 十六进制（`#c740401a` → `--dc-up-soft/--dc-down-soft`，`color-mix` 派生） | `src/lib/theme-colors.ts`、`src/panel/DiagnosticsPanel.tsx`、`src/pages/StockDetailPage.tsx`、`src/index.css.txt` |
| 单位单一入口（原 P0-2） | 新增 **`fmtAmount`**（万亿/亿/万唯一入口）、`fmtPctRatio`/`fmtPctPercent`（口径显式）、`upDownClass`；`priceColorClass` 从 Tailwind 色类改 `dc-up/dc-down/dc-flat`；`fmtBigNum` 保留为 deprecated 别名。修掉实测「同一个数两种单位」：状态带 `(x/1e8).toFixed(0)+'亿'` → `19870亿` vs 总览 `1.99万亿`，现都走 `fmtAmount`（`ReviewPanels`/`ScoutPage` 手写换算一并收口） | `src/lib/format.ts` |
| 排版与令牌 | `src/components/Num.tsx`：数字排版单一入口（数字等宽 + `tabular-nums`，**单位走 `.dc-unit`（正文字体）**，修 CJK 字宽跳变；单位/精度只能来自 `@/lib/format`）；`tailwind.config.js` 的 `theme.extend` 从**空的**补成字号 6 档（`text-dc-10…20`）、圆角 4 档、语义色（`text-dc-up/dc-ok…`、`bg-dc-up-soft`、`dc-text-3/dc-dim/dc-track`），全部指向 `--dc-*`，不在 Tailwind 里复制色值 | `src/components/Num.tsx`、`tailwind.config.js` |
| 护栏增补 + 修误判 | `scripts/ux-contract.mjs` **10 → 15 条**，新增 5 条全是本轮踩的坑：`no-hardcoded-semantic-colors`（`theme-colors.ts` 白名单）、`no-manual-unit-math`（界面层禁止手写 `1e8`+`亿`）、`status-colors-decoupled-from-price`、`chart-theme-single-source`、`three-state-component`。另修 `scripts/budget.mjs` 两处误判：① 注释里的 `setInterval(TICK_MS)` 被当成轮询声明点 → 扫描改为「匹配去注释后的代码、豁免标注仍读原文」；② `budget-ignore` 豁免由「只看匹配点之后 400 字符」改为「前后各 400 字符」，否则标注写在上一行不生效 | `scripts/ux-contract.mjs`、`scripts/budget.mjs` |
| 图表主题统一（V2） | 新建**唯一来源** `src/lib/chart-theme.ts`（`chartColors()`/`volumeBarColors()`/`baseChartOptions()`/`applyChartTheme()`/`subscribeChartTheme()`/`candleSeriesOptions()`/`addVolumeSeries()`/`priceLineColor()`/`createRangeFitter()`），`KlineChart.tsx`/`IndexChart.tsx` 改为复用并订阅主题（宿主切明暗 → 重绘）；**量副图边距漂移收口**（0.85 vs 0.8 → 统一常量）；可视范围按实际根数 `setVisibleLogicalRange(-0.5..bars-0.5)`，宽度为 0 时挂 pending 等下一帧/`onResize` 补；价位标签按 `priceToCoordinate` 像素 y 传递式聚簇（阈值 16px，每簇只留 1 条 anchor 挂合并标题 `压力(模型) 92.66 / 目标(模型) 96.63`，止损权重最高不被吞），`axisLabelVisible` 全关 → 价格轴零遮挡、数值改由图下价位图例条给出；量柱 `themeRgb ×0.9` 降明度 + alpha 0.85 预乘（亮 4.44/4.49:1、暗 3.06/4.01:1，旧 `rgba(199,64,64,.45)` 暗底 1.84:1）；轴色改 `text-2`（2.57 → 7.58:1）、十字线 `text-2@85%`。审计口径更正：审计说「十字线数值标签两主题都 1.85:1」在装的 lightweight-charts 4.2.3 上**不成立**（库按标签底灰度自动选黑/白前景），即便如此仍改成极端明暗底（≥17:1），两种实现下都达标 | `src/lib/chart-theme.ts`、`src/components/KlineChart.tsx`、`src/components/IndexChart.tsx` |
| 三态组件化（V5） | `components/StateView.tsx` 为三态唯一实现，硬约束写进类型：`loading` 固定高度骨架（由 `rows` 一次算定，治「迟到区块把表单顶下去」）、`error` **类型级必填 `onRetry`**、`error` 带 `kindLabel` + 独立 `reason` 行，附 `classifyStateError()`；接进 `MarketPage`（三块全不可达 + 刷新全部）、`AlertWatcher`（轮询失败不再静默：模块级健康度 + 立即重试，`AlertsPage` 呈现）、`WatchlistPage`/`AlertsPage`（空/错态统一）、`WarPage`（非交易时段静默期界面） | `src/components/StateView.tsx`、`src/pages/MarketPage.tsx`、`src/panel/AlertWatcher.tsx`、`src/pages/WarPage.tsx` |
| 过程中发现并修复的两个真 bug（不在计划里） | ① **作用域 reset 的选择器特异性 bug（本批自引入）**：`:where(.dsh-stock) [type='button']{… padding: 0 …}` 里 `:where()` 只吃掉宿主那段，`[type='button']` 是**属性选择器（类级特异性 (0,1,0)）**，与 `.dc-nav-item` 打平且该段在文件末尾 → 后来者赢 → 组件自己的 `padding: 5px 11px`/`border` 被清零（真机表现：状态带导航挤成「复盘作战看盘工具」）。修法：reset 每条规则整条包进 `:where()`（特异性 0），顺序决定权交回组件类，并加契约断言（`scoped-reset` 拦下任何非 `:where(` 开头的重置选择器）。真机验证：`navItem.padding` `0px` → **`5px 11px`**、`navItem.w` 24 → 46、`grow.x` 540 → 634，`cssLoaded = {hasTrack:true, hasUnit:true, hasGlobalButton:false}`。② **`currentStage()` 恒等于复盘**：`stage.ts` 里 `stageOf(phaseFromDate(d), …)` 漏了第二个参数，而 `phaseFromDate` 在 `isTradeDay` 未传时**一律返回 `'closed'`** → 阶段恒为 `review`，**「跨 9:15 自动切作战、跨 15:10 切回复盘」整套时段跟随是死的**且不报错。修法：`isTradeDay` 显式可选 + 缺省退到本地周末判定（与服务端 `buildClock` 同口径），新增 `tests/stage.test.ts`（周三 10:00→intraday、14:40→tail、周六→review、显式交易日覆盖） | `src/index.css.txt`、`src/lib/stage.ts`、`tests/stage.test.ts`、`scripts/ux-contract.mjs` |
| 最终门禁 · 真机 · 体积 | `tsc 0 · eslint 0 · unit 11 文件全过 · ux-contract 15/15 · budget --check OK · contrast --check OK · bundle 605.4KB/620KB · 4 个 smoke 全 0 · pnpm build OK`；真机（新 bundle `6673b586`，导航方式重载后）：状态带「额 **1.99万亿**」← 单位单一入口生效（原 19870亿）、`navItem.padding 5px 11px`、`hasTrack/hasUnit true`、`strip display:grid`、tails 475px 全在面板内。体积护栏 **600 → 620KB** 是**有意识的**加预算（新增的是替换 20+ 文件重复实现的共享模块 `theme-colors`/`chart-theme`/`Num`/`StateView`），已在 `scripts/check-bundle-size.mjs` 的体积账里写明理由与下一轮减重杠杆 | `scripts/check-bundle-size.mjs` |

**对比度修补明细（原 L6，宿主真值实算）**

| token | 原值 | 现值 | 说明 |
| --- | --- | --- | --- |
| `--dc-text-3` | 宿主 tertiary（亮色 `#81858c`，**3.70:1**） | `color-mix(tertiary 78%, primary)` ≈ **5.20:1** | 11px 标签/次级列的 AA 门槛 |
| `--dc-flat` | 同 tertiary | 同上（`--dc-muted`） | 中性数字（0.00%）用最淡的 caption 根本读不出 |
| `--dc-dim` | 宿主 caption（亮色 `#adb2b8`，**2.13:1**） | `color-mix(tertiary 62%, primary)` ≈ **6.80:1** | 9 类 10px 小字（`.dc-row-sub/.dc-foot/.dc-ai-note/.dc-empty`） |
| `--dc-track`（新） | — | `color-mix(text 20%, transparent)` → 亮 **1.53:1** / 暗 **1.89:1** | 亮色下宿主 layer-1/2/3 全是 `#ffffff`，`.dc-score` 进度槽与容器 **1.00:1**（完全不可见）、`.dc-tag` 底色消失 —— 用「朝前景混 20%」的中性底替代，明暗都成立 |
| `--dc-down`（亮色） | `#2d9b65`（白底 **3.51:1** ✗） | `#1f7a4d` → **5.32:1** | 由新护栏脚本发现：A 股「跌色」在白底不达 AA |
| `--dc-warn`/`--dc-success`/`--dc-info` | 宿主原值（亮色 **3.19 / 3.30 / 2.54:1** ✗） | 各自朝 primary 混 72–74% → **5.21 / 4.9 / 4.9:1** | `--dc-accent` 保留原值供**填充**使用；文字场景走 `--dc-info` |

**新增护栏 `scripts/contrast.mjs`**（离线、零依赖）：解析 `src/index.css.txt` 里的 `--dc-*`（含 `var()` 兜底与 `color-mix()`），用宿主真值快照（写在脚本头部，标注来源与快照日期）算出「前景 token × 背景 token」的 WCAG 对比度，`--check` 低于阈值即失败（文字 ≥4.5:1、UI 元素 ≥1.2:1），已接入 CI（`guard:contrast`）。脚本自身也修了两个实现 bug：`color-mix` 必须用 W3C 的**预乘 alpha**插值；alpha 合成必须走 source-over，否则 `color-mix(text 20%, transparent)` 会被双重降权、算出 1.0 的假阳性。

**仍未验证**：暗色主题逐屏（本批 token 同时影响明暗）· `KlineChart` 的 `height='auto'` 撑满容器（自循环测量 bug 的修复，风险最高）· 标签聚簇的像素效果 · `localization: zh-CN` 的日期格式 · `StockIntraday` 未统一 · 节假日日历（仍按工作日近似）。

**仍未完成（下一批第一件事）**：① `<Num>` 只接进了状态带，其余页面（MarketOverview / 复盘 / 选股表）的数字仍是 Tailwind 任意值，属**渐进迁移**（契约脚本会在新增硬编码时拦住）；② 暗色主题仍未逐屏复验（宿主当前亮色）——本次 token 改动**同时影响明暗**，这条比上一批更要紧；③ `--dc-text-2`/`--dc-border` 等已进对比度清单（`scripts/contrast.mjs` 覆盖 15 组配对），但 JS 侧图表取色（`chart-theme` 里 `themeAlpha('border',0.9)` 网格 ≈1.22:1）不在该脚本视野内；④ 复盘 `ReviewPanels` 的 8px 字号仍在（`text-[8px]`），属字号收敛的剩余工作；⑤ **V2-5（模型价位专属色）未做**，`StockIntraday.tsx` 仍是第三份 `createChart` 副本（见 §3 V2）。

## 11. 实施记录：批次 3（草稿持久化 / 错误契约 / 键盘可达性 / 破坏性操作闸门）

| 项 | 结果（结论） | 落点 |
| --- | --- | --- |
| 复盘草稿持久化（I2，本批头号修复） | 键名 `dsh-stock-panel:review-draft:v1`，上限与产品约束一致（预期 ≤5、风向标 ≤8）；**纯逻辑与副作用分离**：`sanitizeDraft`/`sanitizeExpectation`/`sanitizeWindFlag`（损坏数据兜底）、`pickNewerDraft`（localStorage 镜像 vs host 域取新）、`preferDraft`、`matchesArchived`（等价时不再提示「未保存」，避免假警报）、`draftAction`（把「恢复/提示/清空」收敛成可测决策）；写入 = 每次编辑写 localStorage + **1s 防抖推 host**；单测 unit 11 → 12 文件全过 | `src/lib/review-draft.ts` + `state-tables.ts` 注册 `review_draft` 表 + `ReviewPage.tsx`；`tests/review-draft.test.ts` |
| 错误契约贯通 + 重试/取消（I3） | host 侧 `kind`（business/unsupported/unavailable）带到前端（原 `mcp.ts:68-70` 直接丢弃）；`ErrorBar.tsx`（人话标题 + 分类标签 + 原始原因 + **重试**）；`WatchView` 报价失败不再永久 `—`、`AuctionRadar` 失败不再是空面板、`StockConceptCard` 命名失败可重试、`ScoutPage` 信号分析补进度/失败/**取消** | `src/lib/mcp.ts`、`src/components/ErrorBar.tsx` |
| 键盘与焦点可达性（I4 + V6） | `lib/hotkeys.ts` 的 `resolveHotkey(ctx)` 纯函数 → 动作判别式（`openPalette`/`closePalette`/`closeTop{layer}`/`toolToggle`/`watchMove{±1}`/`setView`/`askAi`/`toggleLeftRail`/`toggleRightRail`）；三条关键行为成为可测契约：**面板开着时 ⌘K 也能关**、**Esc 只关最上层**、**左栏收起时 j/k 无效**（原先误按会把复盘草稿顶掉）；`AppShell` 改「解析 → 分发」；诊断面板 `role="dialog" aria-modal`；⌘K 结果 ↑↓ + `aria-activedescendant` + 关闭后 `activeElement` 焦点回归 + **搜索失败与「无匹配」可区分**；`WatchList` 行 roving `tabIndex` + `role="button"`/`role="group"`，j/k 搬真实焦点并 `scrollIntoView({block:'nearest'})`；命中区达标 **WCAG 2.2 SC 2.5.8**（`.dc-nav-item` 垂直内边距 5→6px = 24px，窄档只收水平内边距）+ 契约 `hit-target-24px`；`StockInfoBar` 的 `<span onClick>` 改真 button | `src/lib/hotkeys.ts`、`src/panel/AppShell.tsx`、`src/components/WatchList.tsx` |
| 破坏性操作闸门（I8） | `components/ConfirmButton.tsx`（**两段式内联确认**：首点进入待确认态并出现「取消」、5 秒无操作自动回退、Esc 取消、读屏可感知；不弹 `window.confirm`、不新增 CSS），接入 4 处不可逆操作：自选清空、监控规则删除、监控命中清空、持仓记录删除 | `src/components/ConfirmButton.tsx` |
| 护栏与门禁 | 契约 15 → **21 条**，新增 6 条对应本批真实缺陷：`review-draft-persisted`/`error-kind-propagated`/`hotkeys-pure-and-tested`/`palette-dialog-a11y`/`watchlist-rows-keyboard-reachable`/`hit-target-24px`；收口门禁 `tsc 0 · eslint 0 · unit 12 文件全过 · budget 0 · contrast 0 · bundle 0 ·` 契约 **20/21**（唯一红灯 `hotkeys-pure-and-tested`） | `scripts/ux-contract.mjs` |

**未验证（下一批第一件事）**：
1. **真机端到端复验未做**（本批只在代码/单测层验证）：①复盘填一半 → 点股票 → 切回，草稿是否还在；②⌘K 关闭后焦点回归、Esc 只关最上层；③左栏 Tab 可达且 j/k 跟随滚动；④`ConfirmButton` 的 5 秒回退与读屏感知。需真人过一遍或扩一条浏览器端脚本（`scripts/verify-live.mjs` 的扩展位）。
2. `tests/hotkeys.test.ts` 未落盘（契约红灯），补上才能把「快捷键表」变成 CI 契约。
3. 错误 `kind` 只到「前端能区分」这一步；`ErrorBar` 的分类文案未与 I3 的「不同建议」逐条对齐（如 unavailable 应建议「稍后重试 / 看诊断面板」）。
