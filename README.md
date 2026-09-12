# @lisonevf/dsh-stock-panel

A 股 **盯盘执行台** —— DSH Web 插件（官方 `conversation.view` 视图标签页「A股工作台」）。

> **定位（2026-09-12 明确）**：本插件是**盘中/盘后的执行台**，服务 `WATCH-METHODOLOGY.md`
> 的固定时间表——盘后复盘写清单 → 次日竞价对照 → 盘中只答 Q1–Q3 → 尾盘定仓。
> 它**不是**全功能量化平台：选股引擎、回测、财务、数据管道仍属父项目
> `tickflow-stock-panel`（`frontend/` SPA + `backend/` FastAPI）；概念命名的算法来源是
> 兄弟项目 `cluster-namer`（见 §特色板块）。边界表见 `docs/ROADMAP.md` §1。

## 安装（add 即现，零额外修改/配置）

```bash
# registry 发布版：
dsh plugin --profile web add @lisonevf/dsh-stock-panel
# 或本地开发（在插件仓库目录执行，link: 挂载 → 改源码只需 build + 重启）：
dsh plugin --profile web add .
```

之后**重启 `dsh web`** 并**硬刷新浏览器**（Ctrl+Shift+R）——会话页出现「**A股工作台**」
视图标签页（在「对话」右侧）。不需要手工登记 settings、不需要跑脚本、**也不改动宿主任何文件**。

> ⚠️ **构建产物 ≠ 运行实例**：`lib/` 是构建输出（已 gitignore），浏览器加载的是**上次刷新时**的
> bundle。改完代码只 build 不重启/不刷新，看到的仍是旧界面（实测过：仓库已是 v1.4 流程导航，
> 浏览器里还跑着 v1.3 的四入口）。验收前务必：`pnpm build` → 重启 `dsh web` → 硬刷新。

| 环节 | 机制 |
| --- | --- |
| 加入组合层 | `dsh plugin` 在 `pnpm add` 成功后按安装态 reconcile：本包声明 `dsh.bundle.patch` → 自动追加进 profile 的 `dsh.profile.bundles` |
| host 半加载 | 包的 `cordis.patch.yml`（`insert: stock-panel-host`）作为 bundle 层叠加，loader 加载 `lib/index.js` |
| **视图注入** | browser 半（`lib/client.js`）用官方 `ctx.slots.inject('conversation.view', …)` 注册视图条目——声明感知、零宿主改动 |
| browser 半进图 | 本包声明 `dsh.client`（platform: web）+ `exports["./client"]` → 浏览器自动加载 `lib/client.js` |

## 界面

### 当前形态（v1.4 + A4 导航收口）

一级导航只回答「**现在该干什么**」，功能页降级为一张工具单页：

```
┌ 状态带：阶段(可点，看本时段该答什么)│[复盘][作战][看盘]│[工具]│指数条│广度│情绪≈│[问模型][⌘K] ┐
├──────────┬──────────────────────────────────────────────┬──────────────────────┤
│ 左栏      │ 阶段头：本阶段必须回答的问题 + 唯一输出          │ 右栏 AI 研判          │
│ 自选      │ 主区 ── 复盘：七步流程（列流并排，⑦输出独占整行） │  一键研判 → 决策卡     │
│ 个股      │        作战：竞价→验证窗→盘中→尾盘（时段自切）   │  关键价位 → 画到主图   │
│ (最近看过) │        看盘：个股信息（报价头/图/资金·逐笔·竞价）│  深入对话 → 注入对话   │
└──────────┴──────────────────────────────────────────────┴──────────────────────┘
```

| 入口 | 时段 | 你要做的事 |
| --- | --- | --- |
| **复盘** | 15:10–次日 9:15 | 七步复盘 → **写下次日预期清单（≤5 条，7 字段）并存档** |
| **作战** | 9:15–15:00 | 竞价（预期×竞价对照矩阵）→ 验证窗 → 盘中（Q1/Q2/Q3 必答卡）→ 尾盘（兑现/换股/定仓） |
| **看盘** | 任意时段 | 个股信息：报价头 + 日K⇄分时 + 资金/逐笔/竞价 + 右栏 AI（不属于流程） |
| **工具** | 任意时段 | **一张单页**：总览 / 指数 / 涨停梯队 / 选股筛选 / 自选盘 / 监控规则 / 个股明细 / 外盘（次要，默认不展开） |

- **左栏两组 = 我要盯谁**：**自选**（手工观察池）+ **个股**（最近看过，自动积累 ≤30）。
  **点任意一行 = 设标的 + 切到看盘** → 主区立刻是这只票的个股信息（`openStockAndWatch`）。
- **工具单页只挂载当前区块**：标题常驻（信息架构一眼可见）、内容按需展开 ——
  8 个页面的轮询叠加会打爆请求预算（涨停梯队单轮 ≤177 次调用），所以不做"全部齐挂"。
- **时段自动跟随 + 手动优先**：跨过 9:15 / 14:30 / 15:10 边界自动切入口；用户手动点过导航后本会话停止跟随。
- **三栏联动**：`src/lib/selection.ts` 的「当前标的」是唯一真源——左栏点行 → 主图/下部面板/右栏 AI 一起换。
- **键盘优先**：`⌘K`/`/` 搜索（可搜功能名直达工具）、`1-3` 入口、`t` 工具、`j/k` 左栏移动、`a` 问模型、`[`/`]` 收栏、`Esc` 关。
- **底栏**：阶段 / 工具 / 当前标的、`持久化：host|本地`、`v1.4.0 · <build id>`（服务端已重建时提示「有新构建 · 点此刷新」）、以及 **🩺 诊断面板**（构建一致性 / 持久化 / 数据链路 / 缓存底账 / AI 与 HIST）。

### A4 之后仍待收口（见 `docs/ROADMAP.md`）

| 项 | 内容 |
| --- | --- |
| 主区收口 | 「看盘 › 工作台 / 明细」两个页签合并成一个个股信息面（A4 剩余；明细页含筹码/信息条等独有区块） |
| 工具区块级直达 | ⌘K 输入功能名目前是切到该工具区块，尚未做"跳到页内锚点并滚动定位" |
| 旧页面退役 | 退役被新骨架取代的旧页面（A5 + B2 的减重手段） |

## 数据链路（embedded 内置 TDX，零外部进程）

```
Browser(invokeTool / useSwr)
  └─ POST /api/stock-panel/call {tool,args}（同源）
       → host 半 registerEmbeddedTdxBridge
       → node-tdx（src/host/vendor/opentdx.js，进程内长连接）── TCP 7709/7727 ── TDX
```

- **19 个工具**（内置 TDX 的**数据层**分发，浏览器经 `/api/stock-panel/call` 调用）
  = 15 个行情工具（quote/kline/tick_chart/transaction/auction/unusual/market_monitor/
  board_members/belong_board/capital_flow/symbol_info/server_info/goods_*）+ **4 个 HIST 自挖概念工具**
  （`hist_concept_query` / `hist_concept_classes` / `hist_concept_class` / `hist_concept_status`）。
- **8 个对话工具**（注册给当前对话的 agent，`host-tools.ts`）= 4 个行情（stock_quote/kline/tick/unusual）
  + 4 个 HIST——两者不是同一个清单，不要混用数字。
- 业务错/未知工具/不可达**如实上抛**，**不回退任何远端服务**（远端 MCP 已于 v1.1 移除）。
- 请求超时 25s（`src/lib/mcp.ts`），并发池 ≤6（`src/lib/pool.ts`）。
- 遗留 `http` 模式（自建 python 网关 `gateway/`，默认 127.0.0.1:8017）默认关闭，详见 `MCP-SETUP.md`。

## AI：一键调用 + 反馈回填视图（双通道）

```
通道 A｜一键研判（主）  右栏按钮 / 状态带「问模型」/ 快捷键 a
  → POST /api/stock-panel/ai（host 半，直调官方 ctx.llm + agentDefaultModel）
  → 严格 JSON → 校验归一 → 回填视图
通道 B｜深入对话（副）  右栏「深入对话」→ inputActions.setDraft + submit()
  → 当前对话的 agent 自行调 stock_quote/kline/... 多轮复核（不切视图）
```

**模型结论的四个回填落点**：个股决策卡 + 主图价位线（`KlineChart` 的 `priceLines`）／
复盘「AI 预期排序参考区」／选股「AI 候选排序 + 表内 `AI#n` 徽标」／盘中叙事（规划中）。

工程要点（离线可回归，`scripts/smoke-ai-contract.mjs`）：

- **模型路由零配置**：读宿主 `ctx.agentDefaultModel.currentSelection()`，插件侧有兜底；
  宿主未挂 LLM 服务时按钮**优雅置灰**并说明原因，**不影响行情**（`llm` 刻意不列进 `inject`）。
- **prompt 与解析同源**（`src/lib/ai-contract.ts`，host/client 共用）：模型只许回一个 JSON 对象；
  解析器做去围栏/花括号配平/逐字段校验夹取；解析失败时**原文照样回传显示**。
- **自愈重试**：`maxTokens` 是「思考 + 正文」共享预算，推理模型可能把预算烧在 reasoning 上
  （`finish=max-tokens`）→ host 半自动裁一档上下文重试（≤3 次调用 / ≤3 次裁剪，分开计数），
  裁剪结果在 `meta.shrunk` 回传并由 UI **显式提示**（不静默截断）。
- **不覆盖你的草稿**：AI 结果永远是只读参考区，必须逐条「+」采纳；已在清单的条目标注而不重复插入。

## 特色板块：自挖概念 + 命名（v1.5 规划）

`WATCH-METHODOLOGY` 的「主线识别」目前依赖 `belong_board` 的**官方花名册**，而市场常常先出现
「花名册还没有、但money已经当成一个班」的票。本插件内置的 **HIST 自挖概念引擎**
（`src/host/hist-data.ts` → node-tdx `HistEngine`：QFQ 日线残差共动 → 无监督聚类）就是为这个盲区准备的能力：

| 阶段 | 谁负责 | 现状 |
| --- | --- | --- |
| A **发现**：这些票今天共动了吗 | node-tdx `HistEngine`（内置，零外部进程） | ✅ 已内置（4 个工具），**尚无 UI** |
| B **命名**：它们为什么一起动、叫什么 | 移植 `cluster-namer` 的「涨停/异动素材 + LLM 归纳 + 护栏」到 host 半（复用 `ctx.llm`） | ⏳ v1.5 开发（`docs/ROADMAP.md` A2） |

命名口径照搬 cluster-namer 的三条硬规矩：**消息/旧标签只用于解释、不进聚类输入**；
**证据必须可反查**（引文比对 + 时间窗 + 覆盖度门控）；**拒绝命名是一等公民**
（`no_common` / `insufficient` 带降级成因，不硬凑共性）。
**前置条件**：引擎默认参数当前输出退化（实测 `as_of=2026-09-11`：7 类中 1 个 141 只弱链、
类内相关仅 0.027，另 6 类只有 2–3 只，200 只池中 42 只孤立），须先做**参数校准 + 弱链过滤 +
跨日稳定性**再上 UI。

## 存储

- **已迁移（v1.5 / A1）**：用户可见的本地资产落在 **host 侧持久化**——DSH 存储子系统的
  `stock_panel` 领域（json 后端 → `$DSH_HOME/storages`），8 张表：
  自选 / 复盘存档 / 当日运行 / 持仓 / 交易日志 / AI 结论 / 事件流 / **看过的个股**。
  浏览器 localStorage 降级为**镜像 + 离线兜底**：启动时拉一次全量快照写镜像，
  写入按指纹**差量**推给 host（事件流 500 条也不会每轮全量重发）。
  底栏显示 `持久化：host`（不可用时显示 `本地` 并在悬浮里给出原因）——**不静默降级**。
- **仍在 localStorage**：UI 偏好（视图/栏显隐/K 线区间/当前标的）与信息条列配置——
  它们是「这台机器的界面状态」，不属于跨日资产。
- **收益**：清缓存/换设备不失忆；复盘存档这类资产不再依赖浏览器。
- 领域契约与版本策略（为何不 import 宿主的 storage-domain 包、为何版本固定为 1）见
  `docs/ARCHITECTURE.md` §5.2。

## 质量门禁

```bash
pnpm build                                  # host + client + dts（client 默认 minify + sourcemap）
node scripts/build-client.mjs --check       # 生成物与源码一致性（防手改生成物）
npx tsc --noEmit                            # 全量类型门禁（0 错误）
pnpm lint                                   # ESLint（0 error；warning 棘轮 30 = 只降不升）
pnpm test                                   # 单元测试（node:test + esbuild 打包，离线）
node scripts/check-bundle-size.mjs          # client.js 体积护栏 600KB（当前 534KB，余量 66KB）
node scripts/bundle-report.mjs --minify     # 体积成分报告（三类汇总 + 单文件 top25 + 压缩口径）
node scripts/smoke-client-view.mjs          # 视图注册契约 + 持久化降级冒烟（离线，CI 已接）
node scripts/smoke-host-state.mjs           # host 半：路由/持久化域/降级（离线，CI 已接）
node scripts/smoke-ai-contract.mjs          # AI 契约冒烟（离线假模型，CI 已接）
node scripts/smoke-embedded.mjs             # 内置 TDX 19 工具冒烟（需真机行情）
pnpm verify:live                            # 对**运行中**的 dsh web 做端到端验收（重启后用）
```
```

CI（`.github/workflows/ci.yml`）：install(→prepare build) → `tsc --noEmit` → `eslint --max-warnings 30`
→ `node scripts/unit.mjs` → 体积护栏 → 三个离线冒烟。**单元测试用 Node 内置 `node:test`**
（`scripts/unit.mjs` 以 esbuild 打包 TS 测试，不引入测试框架）；尚未做的是：30 条 lint warning 清零、
测试面扩到 `strength/situation/review-metrics/screener/chips`（见 `docs/ROADMAP.md` B4）。

运行时自检（浏览器控制台）：

```js
window.__STOCK_PANEL__.viewRegistered   // true = 视图条目注册成功
window.__STOCK_PANEL__.version          // 客户端 bundle 版本（用于判断是否跑着旧产物）
window.__STOCK_PANEL__.transport()      // 'embedded' | 'http'
window.__STOCK_PANEL__.listTools()      // 19 个内置工具
window.__STOCK_PANEL__.callTool('hist_concept_classes', { top_members: 3 })
await (await fetch('/api/stock-panel/ai')).json()   // {available, reason?, provider?, model?}
```

## 目录

```
frontend-dsh/
├── package.json / tsdown.config.ts / cordis.patch.yml   # 双半声明与构建
├── src/
│   ├── index.ts          # host 半入口：TDX 桥接 + 对话工具 + AI 桥接（inject: webServer, tools）
│   ├── host-ai.ts        # ★ 一键问模型（官方 ctx.llm + agentDefaultModel，任务化 + 自愈重试）
│   ├── host-tools.ts     # 对话工具（8 个：行情 4 + HIST 4）
│   ├── host-data.ts      # host 半取数（对话工具走 embedded）
│   ├── host/tdx-data.ts  # ★ 内置 TDX 服务（node-tdx 适配 + 归一化 + 工具分发）
│   ├── host/hist-data.ts # ★ 内置 HIST 自挖概念引擎（惰性单例 + 1h 快照 TTL）
│   ├── host/state.ts     # ★ host 侧持久化（stock_panel 领域 + /api/stock-panel/state）
│   ├── host/build-info.ts# 构建信息路由（版本 + 构建 id）
│   ├── host/vendor/      # opentdx.js（node-tdx 构建产物 vendor + LICENSE + 类型垫片）
│   ├── client.ts         # browser 半入口：注册 conversation.view + 注入样式 + 诊断句柄
│   ├── lib/state-tables.ts # ★ 持久化表清单（host/client 共用单一来源）
│   ├── lib/host-state.ts # ★ host 持久化接入（拉取/hydrate/增量同步/降级）
│   ├── lib/viewed-store.ts # ★ 看过的个股（A4「个股」分组的数据源）
│   ├── lib/selection.ts  # ★ 当前标的 + UI 状态（三栏联动唯一真源，v3 键 + 迁移）
│   ├── lib/stage.ts      # ★ 阶段模型（时段 → 复盘/竞价/盘中/尾盘 + 该阶段的问题与输出）
│   ├── lib/cache.ts      # ★ SWR 缓存层（useSwr + 命令式 swrFetch；全仓唯一数据缓存）
│   ├── lib/ai*.ts        # AI 调用封装 + 通用运行器 + 任务契约（host/client 共用）
│   ├── lib/              # 其余领域逻辑：market/ladder/regime/situation/strength/chips/review-*/
│   ├── panel/            # 三段式骨架：AppShell / StatusStrip / WatchList / AiPanel / use-ai
│   ├── views/            # 流程入口：StageReviewView / StageWarView / WatchView / ToolHost / StageHead
│   ├── pages/ components/# 页面与组件（工具单页内复用；逐页迁移到 --dc-* token）
│   ├── index.css.txt     # Tailwind + --dc-* 语义 token 层（.txt 绕过 rolldown CSS 管线）
│   └── host-node-env.d.ts
├── scripts/              # 构建 + 冒烟 + 体积护栏 + profile 同步 + vendor 刷新
├── docs/                 # ARCHITECTURE / ROADMAP / archive（历史计划）
├── CHANGELOG.md          # 版本与交付史
└── lib/                  # 构建输出（gitignore）
```

## 文档地图

| 文档 | 用途 |
| --- | --- |
| `README.md`（本文） | 定位、安装、界面、数据链路、门禁 —— **唯一真源** |
| `docs/ARCHITECTURE.md` | 架构与数据流：双半结构、状态层、请求预算、存储、AI 契约、自挖概念管道 |
| `docs/ROADMAP.md` | **待做**：两条轨道（产品闭环 / 工程地基）、版本节奏、验收锚点、交易日复验清单 |
| `CHANGELOG.md` | 已交付版本史（0.1 → 1.4） |
| `USER-GUIDE.md` | 用户使用流程（按交易日时间轴）与边界场景行为 |
| `PRODUCT-DESIGN.md` | 流程与功能设计（§6c 现行；§1–§6b 为历史蓝图） |
| `WATCH-METHODOLOGY.md` | 方法论（量价博弈 · 时空 · T+1 · 凯利仓位）—— 设计的蓝本 |
| `STRATEGY-RESEARCH.md` | 方法论的证据库（A/B 级证据与辨证） |
| `MCP-SETUP.md` | 数据源与传输配置（embedded / 遗留 http 网关）+ 排障 |
| `docs/archive/` | 历史计划（MIGRATION-PLAN / NEXT-WORK）—— 仅溯源，勿当现状 |

## 技术要点（踩坑记录）

- **双半结构**：`dsh.bundle.patch` 与 `dsh.client` 可同时声明——约束只有两条：host 半不得 import
  浏览器专用模块，client 半不得 import Node 模块。
- **视图注册用 `slots.inject`**：往别人声明的槽里注册内容时，声明感知的 `ctx.slots.inject(slot, cb)`
  才是官方做法；宿主 apply 早于/晚于本插件都成立，声明消失/HMR 时自动装卸。
- **v1.1 及以前的布局补丁已废弃**：曾对 `dsh-client-ui-layout` bundle 做字节级替换自造第四列，
  代价是改宿主发行物、升级即可能失配。v1.2 起全部走官方槽位，补丁引擎/锚点表/CLI/备份已删除。
- **构建工具**：`tsdown`（rolldown）——rolldown 已移除 CSS bundling，故样式源文件是 `index.css.txt`，
  构建期读成字符串导出；client 半由 `scripts/build-client.mjs` 单独跑 tailwind 管线。
- **client bundle 必须单模块**：契约要求 flat module graph，**不能 code splitting**，
  因此体积只能靠「减少内联代码」而非拆分（见 `scripts/check-bundle-size.mjs` 头部的体积账）。
- **client 半默认 minify + sourcemap**（B2）：体积 822.5 → 530.8KB（−35.7%）；
  `lib/client.js.map` 供宿主 client-modules 层读取（它会把 map 校验为 Source Map v3 并盖章自己的
  组合 map URL，缺失不影响执行）→ 可调试性靠 map 保住。要读产物本体：`CLIENT_MINIFY=0 pnpm build`
  （此时体积必然超护栏，加 `CLIENT_MAX_KB=900`）。成分分析：`node scripts/bundle-report.mjs`。
- **视图会被卸载**：ui-conversation 只渲染当前选中的视图，因此面板自身的 Tab/标的状态全部持久化。

## 版本

当前版本 **1.4.0**（`package.json` 为唯一来源）= v1.2 官方槽迁移 + v1.3 宽视图沉浸式/AI 双通道
+ v1.4 流程驱动导航的**合并发布**（2026-09-12 固化；此前这批工作长期滞留在工作区，无回滚点）。
此后**版本号单一来源 = `package.json`**，文档只写批次/版本名，不重复绝对数字。
已交付版本史见 `CHANGELOG.md`，下一批计划见 `docs/ROADMAP.md`。

## 本地开发加载

1. `pnpm build`。
2. `dsh plugin --profile web add <本仓库路径>`（或 `link:` 依赖）——CLI 自动 reconcile bundles。
3. 重启 `dsh web`（bundle rev 启动时重算）+ 浏览器硬刷新。
4. 开发循环：改源码 → `pnpm build` → 重启 + 硬刷新；host 半改动必须重启进程才生效。
