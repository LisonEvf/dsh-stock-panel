# CHANGELOG

> 本文件于 **2026-09-12 补齐**（此前 MISSING，导致 1.1.0 → 1.3.0 的变更无法追溯）。
> 记录规则：**每批一次原子提交 + 一条 CHANGELOG**；版本号**单一来源 = `package.json`**；
> 文档只写批次/版本名，不复制绝对数字（体积、工具数、超时由脚本输出）。
>
> ⚠️ **版本号说明（历史遗留，已于 1.4.0 收口）**：2026-09-12 之前，本仓库的版本号与提交标签不一致——
> 提交标签写到 `1.1.0`，`package.json` 在工作区被改成 `1.3.0`（长期未提交），
> 而 `README` 用 v1.2/v1.3/v1.4 描述界面迭代。**2026-09-12 起**：v1.2/v1.3/v1.4 合并为
> `1.4.0` 一次发布，版本号单一来源 = `package.json`。

---

## [1.4.0] 2026-09-12

**流程驱动导航 + 官方槽注入 + AI 双通道**（v1.2 / v1.3 / v1.4 三个迭代的合并发布）

> 本批是**体量最大的一次界面重构**（新增 `src/panel/*`、`src/views/*`、
> `src/lib/{selection,stage,ai,ai-task,ai-contract}.ts`、`src/host-ai.ts` 与两个离线冒烟脚本）。
> 此前长期滞留在工作区、**没有 git 回滚点**，2026-09-12 一次性固化并统一版本号
> （见 `docs/ROADMAP.md` B1）。

### v1.2 —— 注入方式回到官方契约（废弃宿主布局补丁）
- 界面注入改为官方 `conversation.view` 视图标签页（`ctx.slots.inject`，声明感知）；
- **删除**：布局补丁引擎 `src/layout-patch.ts`、锚点表、CLI `scripts/patch-layout.mjs`、
  多版本回归器 `scripts/validate-layout-versions.mjs`、`patches/`（bundle 快照与备份）；
  宿主 bundle 已还原为 pristine——插件**不再读写宿主任何发行物**；
- 面板 Tab/标的状态改为 localStorage 持久化（视图会被卸载重挂）。

### v1.3 —— 宽视图沉浸式盯盘台 + AI 双通道
- 三段式骨架：状态带（阶段/指数/广度/情绪/问模型/⌘K）+ 左栏列表 + 主区 + 右栏 AI 常驻；
- 左侧零额外请求（自选/涨停/异动从状态带已轮询的全 A 快照过滤）；键盘优先（⌘K、1-3、t、j/k、a、`[`/`]`）；
- 视觉改为跟随 DSH 主题：`src/index.css.txt` 只做 `--dc-*` → 宿主 `--dsw-*` 语义映射，A 股红涨绿跌是唯一自持配色；
- **AI 直调**（`src/host-ai.ts` + `POST /api/stock-panel/ai`）：读宿主 `ctx.agentDefaultModel` 路由，
  `ctx.llm.stream` 出一份严格 JSON，失败优雅置灰且不影响行情；
- **AI 契约**（`src/lib/ai-contract.ts`，host/client 共用）：prompt 与解析同源、去围栏/配平/字段夹取、原文永不丢；
- **自愈重试**：`maxTokens` 是 reasoning+正文共享预算（提到 6000），`finish=max-tokens` 时自动裁一档重试
  （≤3 调用 / ≤3 裁剪分开计数），`meta.shrunk` 回传并由 UI 显式提示；
- **结论回填视图**三处：个股决策卡 + 主图价位线（`priceLines`）／复盘「AI 预期排序」／
  选股「AI 候选排序 + 表内 `AI#n` 徽标」——全部**只读参考 + 逐条采纳**，不覆盖用户草稿；
- 「深入对话」通道：把上下文注入当前对话（输入框有草稿时置灰）。

### v1.4 —— 导航改为流程驱动
- 一级导航从「4 个功能视图」改为**方法论两阶段 + 自由看盘**（复盘 / 作战 / 看盘），
  其余 8 个旧页面收进「工具」（`t` 或 ⌘K 直达）；
- 新增阶段模型 `src/lib/stage.ts`（时段 → 复盘/竞价/盘中/尾盘 + 该阶段必须回答的问题 + 唯一输出）
  与**阶段头**（把方法论原文摊在页面顶部）；
- **时段自动跟随 + 手动优先**：跨 9:15 / 14:30 / 15:10 自动切入口，手动点过后本会话不再跟随；
- 复盘/作战用 `.dc-flow` 列流宽屏并排（复盘页 ⑦ 输出独占整行）；
- 新增 `src/lib/selection.ts` 作为「当前标的 + UI 状态」唯一真源（v3 键 + v1/v2 迁移）。

### 同期修复与配套
- **B5 构建可见性**：构建 id = src 内容哈希（`scripts/build-id.mjs`）；
  `__PANEL_VERSION__` / `__PANEL_BUILD_ID__` 由两条构建链注入（tsdown 0.13 不消费 `define`，
  改用 rolldown 插件文本注入）；host 新增 `GET /api/stock-panel/build`；底栏显示版本 + 构建 id，
  服务端重建后提示「有新构建 · 点此刷新」——修掉「改完代码只 build 不刷新、界面静默跑旧 bundle」。
- **B6 静默失效**：① 关键价位是 HTTP-only 端点，embedded 部署下必然 404 且被 `allSettled` 吞掉
  → 新增 `api.stockAnalysisLevelsAvailable()` 并显式提示不可用原因与替代做法（模型价位线）；
  ② AI 请求的 `AbortController` 从未把 signal 透传下去（取消是死代码）→ 三处包装透传 signal，
  切换标的/卸载即取消在途 90s 流。
- **B3 请求预算**：ladder 加 30s 共享缓存 + in-flight 去重（此前作战页/梯队页/复盘页各自重算，
  实测约占全部工具调用 90%），内部 `fetchAllA(true)` 改为复用 market 的 20s 缓存；
  轮询在 `document.hidden` 时跳过（一处修复覆盖 13 个 SWR 轮询者）+ 左栏收起停止轮询 +
  3 个直连 `setInterval` 加守卫；修 `cache.ts` 的 `refreshInterval` 变更永不生效（deps 缺项）。
- 修 `fmtPct` 口径错（指数显示 `上证-117.66%`：小数/百分数两种口径混用）——统一走 `pctText()`；
- `stock-data.ts` `toArray` 对已解析数组二次 `JSON.parse` 导致整层静默空返回（已修）；
- 新增离线冒烟：`smoke-client-view.mjs`（视图注册契约 + 持久化降级）、`smoke-ai-contract.mjs`（AI 契约）、
  `smoke-host-state.mjs`（host 半：三条路由 / 持久化领域 spec 契约 / 读写闭环 / 降级，26 项断言）；
- CI 接入以上三个冒烟（host 半此前**零离线覆盖**）；体积护栏经登记后 820 → 840KB（见脚本头部体积账）；
- **B1 基线纪律**：本批 64 文件此前长期未提交（含 CI 引用的两个冒烟脚本），
  2026-09-12 一次性固化；版本统一 1.4.0（唯一来源 `package.json`）。

### A1 — host 侧持久化（全量迁移 + localStorage 降级）
- 新增 `stock_panel` 领域（DSH 存储子系统，json 后端 → `$DSH_HOME/storages`），8 张表：
  `watchlist / review / dayrun / positions / tradelog / verdicts / events / viewed`；
- host 半新增 `GET/POST /api/stock-panel/state`（`src/host/state.ts`）：全量快照、单条/批量写入、
  批量删除、迁移标记；失败如实返回不可用原因（**不静默降级**）；
- 客户端（`src/lib/host-state.ts`）：启动拉一次快照 → 覆盖 localStorage 镜像 → 通知各 store 重载
  （`onHostHydrated`）；写入按**指纹差量**推送（事件流 500 条也不全量重发）；不可用时保持纯本地；
- 8 张表清单是单一来源（`src/lib/state-tables.ts`，host/client 共用），并给出各表的自然记录键；
- 新增 `src/lib/viewed-store.ts`（「看过的个股」，A4 左栏「个股」分组的数据源），
  在 `selection.setSelection` 单点埋点；
- 底栏新增 `持久化：host / 本地` 状态（不可用时悬浮给出原因）+ 诊断句柄
  `window.__STOCK_PANEL__.hostState()`；
- 契约取舍（实测）：领域名不能有连字符（`UNIT_NAME_RE`）→ 用 `stock_panel`；**不 import
  `@deepseek-ai/dsh-storage-domain`**（公开 npm 只有 0.0.1-rc.1，宿主是 0.1.2-rc.1）→ 手搓 spec +
  极简 `parse/safeParse` schema，零依赖；`storageDomain` 不列进 inject（可选增强，同 llm 立场）；
- B5-② 缓存收口：`cache.ts` 新增命令式 `swrFetch`，`market.fetchAllA` 删掉私有缓存改走同一 SWR store
  （此前同一份全 A 快照有两套缓存、两套新鲜度）；
- 清理：删除死文件 `src/lib/queryKeys.ts`（零引用，且 react-query 并非依赖）。
- **真实存储栈校验暴露并修掉两个契约陷阱**（`scripts/verify-state-domain.mjs`：用宿主安装的
  cordis + dsh-storage + storage-json + storage-domain 真跑一遍手搓 spec，16 项断言）：
  ① `layout: per-record` 把记录键当**文件名**（要求 `^[a-zA-Z0-9_-]+$`），而自然键含 `:` 与中文
     （事件流 `SH-600519-10:03-封涨停板`）→ 不加处理**每次事件写入都会抛错**；
     修法：host 层 `encodeStateKey/decodeStateKey`（base64url，对客户端完全透明）；
  ② `version` 不一致**不报错，而是静默丢弃旧记录**（打开成功、记录数 0）——比报错更危险，
     因此「版本固定为 1」是硬要求；实测 `compatibleVersions: [旧版本]` 是官方逃生口。
  这两条都写进了 `docs/ARCHITECTURE.md` §5.2 与代码注释（含介质证据）。
- **真机探测又抓到一个时序 bug（A1 会因此完全失效）**：旧实现在 `apply` 里读一次
  `ctx.storageDomain`，读不到就把「不可用」永久缓存 —— 而 cordis 的服务挂载时刻**不保证**
  早于本插件 `apply`。运行实例实测一直返回 `available:false`（原因：ctx.storageDomain 不可用），
  尽管 dsh-base 确实挂了存储栈。
  修法：`ctx.inject(['storageDomain'], cb)`（声明式注入，服务出现/变化时重跑）+ 请求路径
  `ensureStateReady()` 惰性重试，**不缓存否定结论**；兜底解析 `ctx.storage.domain`；
  诊断新增 `facilitySource`（区分「服务晚到」与「确实没挂」）。
  回归用例：`smoke-host-state.mjs` `[6]`（服务晚到后自愈）`[7]`（hub 路径）`[8]`（声明式注入）。
- **第一轮真机验证又推翻了我的判断（已再修）**：用户重启后运行实例仍报
  `available:false`，原因文案里出现「inject 已声明/回调已触发」的取证字段 —— 证明新代码在跑，
  但服务仍取不到。取证（读官方消费方 `dsh-session-projection-cache` 的源码 + 检查
  `~/.dsh/storages/workspace.json` 当日仍在写）得到两条硬结论：
  ① **cordis 的服务只有被 inject 声明过才在该 ctx 上可见** —— 我最初「完全不声明、只用
  `getOwnPropertySafe` 读」的做法在真机上必然读不到，惰性重试也救不了；
  ② `ctx.inject(deps, cb)` 的**回调必须使用它给的 scoped ctx**：服务挂在作用域 ctx 上，
  外层 ctx 依然没有它（第一轮修完仍失败就是栽在这里）。
  修法：`ctx.inject(['storageDomain'], (scoped) => initStateDomain(scoped))`（声明感知、
  非静态 inject → 缺存储时不连带禁用行情），并保留请求路径惰性重试；
  诊断字段改为**如实**记录「是否真的声明成功 / 回调是否触发」（原先无条件打标记，会误导排查）。
  新增回归用例 `[8]`（服务**只**挂在 scoped ctx 上也必须可用 —— 模拟真实 cordis 语义）、
  `[9]`（不可用时必须交代取证字段）。
- **B4 质量网**：仓库此前**没有 ESLint、没有测试框架**，`tsc` 又因
  `noUnusedLocals:false` 对死代码与 hook deps 错误隐形。本次：
  · ESLint（flat config，规则刻意克制）→ **0 error / 0 warning**（初批 30 条 warning 已全部清零），
    CI 用 `--max-warnings 0` 做**棘轮**（只降不升，改回 30 等于把门禁关掉）；开启
    `reportUnusedDisableDirectives` 揪失效注释；
  · 单测零新增依赖：Node 内置 `node:test` + 既有 esbuild 打包 TS 测试（`scripts/unit.mjs`），
    **7 个文件 / 65 条** —— `indicators`（涨跌停分档/涨停价/一字板/连板）、
    `regime`（`BAND_CAP` 仓位总闸、退潮压温强制规则、过热检测、单调性）、
    `strength`（五类判定 + 阈值边界 + 低位首板筛选）、`situation`（局势优先级瀑布）、
    `review-metrics`（实算口径 null vs 0、分母与样本、亏钱效应样本）、
    `screener`（条件边界/板块前缀/ST/MA 信号窗口）、`chips`（形状与口径不变量/300% 换手窗口/逐笔降级）；
  · CI 增 lint 与单测两步。
  **单测抓到 5 个真问题**：① `regime` 的 drivers 截断到 3 条时会把「强制压温的原因」挤掉
  （界面只剩数字、看不出为什么）→ 改为点名具体触发条件并优先保留；
  ② 确认「全 0 输入温度仍 >0」（炸板率低会加分）→ 记为行为契约：空数据必须由 UI 判空兜住；
  ③ **`classifyStrength` 的量比阈值从未参与判断**（写成 `&& t.volRatioStrong`，对数字取真值恒真）——
  缩量一字板被判「真强」、无量阴跌被判「放量滞涨」，已改为真正的 `r.volRatio >= t.*`；
  ④ `chips` 空输入抛的是 TypeError 而非约定的「日K数据不足以计算筹码」（`rows[0]` 未定义），
  调用方按 message 判断会完全失效；⑤ `screenRows(rows, cond, 0)` 返回 1 条（先 push 再判长度）。
  踩坑：ESLint flat config 里**「只含 ignores 的对象」才是全局忽略**，把 ignores 与
  `linterOptions` 混写会退化成文件过滤 —— vendor 的 `opentdx.js` 因此被 lint 并因其自带的
  `@typescript-eslint/*` disable 注释直接报 3 个 error。
- **新增实机验收工具** `scripts/verify-live.mjs`（`pnpm verify:live`）：对运行中的 dsh web
  做端到端验收 —— ① host 半新鲜度（运行 buildId vs 源码 buildId，不等即提示重启）
  ② 持久化可用性 + 8 表 + 服务来源 ③ 写→读→删闭环（真域真介质，含清理）④ AI/行情信息项。
  它把「重启后到底好了没」从人肉 DevTools 变成一条命令，并能区分「旧 host 半」与真失败。
- **A1 首迁可靠性**：真机验收中出现「`migratedFromLocalStorage=true` 但 8 张表记录数全 0」
  （标记写了、数据没落地 —— 首迁上传在途被页面刷新取消）。改为「先 `flushState()` 确认全部
  上传成功 → 才写首迁标记」，失败时进 `failedTables` 并自动重试（回页面 / 5 秒后），
  诊断面板新增「待同步表数」（0 = 全部落地）让这类静默不一致可见。
- **B2 体积：默认 minify + sourcemap（用户决策）**：client.js 822.5 → **530.8 KB（−35.7%）**，
  护栏 840 → **600 KB**（余量从 2% 回到 11.5%）。
  先量后减：新增 `scripts/bundle-report.mjs`（esbuild metafile 成分报告）——实测大头是
  `lightweight-charts` 216.8KB(26%) 与我们自己的页面代码 175.9KB(22%)，不存在"随手砍零碎"的空间。
  可调试性用 `lib/client.js.map` 补偿（宿主 client-modules 层读取并校验为 Source Map v3、
  再盖章组合 map URL；缺失不影响执行）；包装改用 esbuild 的 banner/footer 以保证 sourcemap
  行号含包装行；逃生阀 `CLIENT_MINIFY=0`（需配 `CLIENT_MAX_KB`）。minify 后契约冒烟全绿。
- **A2b-① 命名内核（`src/host/naming/`）**：把 `cluster-namer`（Python 参考实现）的命名阶段
  逐条移植到 host 半 —— 纯函数、零外部进程、25 条离线单测（`tests/naming-guard.test.ts`）：
  · `guard.ts` 证据护栏：引文**逐字反查**（比较前归一空白与 "/"，否则 prompt 渲染成「标题 / 摘要」
    而模型照抄会把自己的合规引文判成幻觉 —— 参考实现真实踩过）、A5 可计算证据分
    （0.40 覆盖度 + 0.25 命中票数 + 0.20 窗口内比例 + 0.15 条数，条数 3 条封顶）、
    A6 时间窗护栏（窗口外证据不计入门控）、A7 降级成因分层（`named / no_common / insufficient`
    + `no_material / partial_material / source_failed / llm_*` + `guard_rejected`）；
    **模型自报 confidence 只作展示，不参与门控**（自报置信度不是可校准的概率）；
  · `prompt.ts` 提示词与语料渲染（硬性规则与护栏一一对应，改一处必须改另一处）；
  · `parse.ts` 分级降级解析（围栏 / 寒暄前缀 / 尾逗号 / 括号补齐），失败如实降级并保留原文；
  · `fingerprint.ts` 口径指纹（provider / 模型 / 客户端版本 / 窗口 / 源集合 / **提示词版本** / 护栏阈值），
    指纹不匹配视为未命中 —— 防"换了口径却复用旧结论"这种最危险的静默错误；
  · `materials.ts` 素材归一：板块类型码（12 行业 / 4 概念 / 5 风格 / 3 地区）、
    **非叙事板块词黑名单**（真实踩过把「含可转债」当成共同主题）、去重（二元组 Dice ≈ difflib 0.9）
    / 每票每源配额 / 全类字符预算截断。
  **移植时修掉的两个偏差（单测发现）**：① 参考实现按语料顺序取引文出处，而语料按时间升序，
  同一文本同时存在于窗口内外时会先撞上最旧那条、把本该算窗口内的证据挡掉（冤枉降级）→
  改为优先认窗口内那条；② 参考实现的括号补齐是"先 `}` 再 `]`"，`{"a":[1,2` 补完仍非法 →
  改为按括号栈补（含未闭合字符串）。
- **A2b-② 接线：采集 / 编排 / 路由 / 缓存 / 两个 UI**（同批发布）：
  · `collect.ts` 采集层 —— **本站与参考实现最大的口径差异在这里**：node-tdx 的三类素材时间性不同，
    异动/主力监控是**当日实时列表、无历史接口**，板块归属是**当前快照**，封板状态由日K推导、
    **可完全回放**。因此只在 `as_of === 当前交易日` 时采实时源，否则记入 `missingSources` 并写明
    「不做历史回放」；板块归属照用但**标注"当前快照"**。把今天的异动贴到三天前的类上等于凭空造证据，
    那是护栏存在的意义，不能自己先破。封板状态用同一口径的连板统计取代参考实现的 ChangeUpType 字段。
  · `run.ts` 编排 —— 取类成员 → **弱链伪类拒绝命名（且零模型调用）** → 采集 → 模型 → 护栏 →
    进程内缓存（key = asOf:classId:fingerprint，命中不产生第二次 LLM 调用）。依赖全部注入
    （`callTool`/`llm`/`route`/`ensureToday`），所以整条链路能离线跑通。
  · `route.ts` 路由 —— `GET /api/stock-panel/naming` 回**能力 + 口径**（模型路由 / 提示词版本 /
    默认参数 / 护栏阈值 / 采集预算 / 缓存条数 / 当前交易日；界面不各自硬编码参数），
    `POST` 命名（`classId` 必填，非法一律 400，不猜默认值）。
  · UI —— 个股卡 `StockConceptCard`（**主视角**：所属类 + 同类伙伴 + 最近共动邻居 + 命名按钮）
    挂在个股详细页；类列表 `ConceptClassesCard` 作为工具单页「自挖板块」区块（次要视角：含
    被排除的弱链类计数、池内孤立票）；结论展示抽成 `NamingResultPanel` 两处共用
    （三态 + 证据分 + 逐条引文 + 采集口径偏差 + 「自挖类 ≠ 官方概念/行业」声明）。
  · 覆盖 —— `tests/naming-pipeline.test.ts`（16 条：时间性 / 弱链拒绝 / 缓存与指纹 / 四条降级路径 /
    幻觉引文）+ `scripts/smoke-naming.mjs`（对**构建产物**验路由与口径，假工具+假模型，CI 已接）
    + `verify-live.mjs` 第 ④ 段（对运行实例**真的命名一次**：打印结论/证据分/成因/采集说明）。
  · 体积：client.js 534.3 → **558.0 KB**（护栏 600 KB，余量 42 KB）；host lib/index.js 177.8 → 227.2 KB。
  **v0 明确不做**：与官方行业的重合度对照（官方关系三分类）、命名缓存跨进程持久化。

---

## [1.1.0] 2026-09-10 · `403ac38`

**内置 node-tdx 数据链路 + HIST 自挖概念引擎（移除远端 MCP 依赖）**

- 数据链路从「浏览器 → host 半桥接 → 远端 MCP(192.168.31.196:8007)」改为
  **host 半进程内 node-tdx 直连**（`src/host/vendor/opentdx.js` + `src/host/tdx-data.ts`），
  端点成为同源 `POST /api/stock-panel/call`；远端 MCP 与兜底回退全部移除；
- 工具覆盖扩到 **19 个**：15 个行情工具 + **4 个 HIST 自挖概念工具**
  （`hist_concept_query/classes/class/status`，`src/host/hist-data.ts`，进程内 HistEngine，快照 TTL 3600s）；
- 新增 **筹码分布**（`src/lib/chips.ts` + `src/components/chip-profile.ts`，日 K L0 → 逐笔 L1 升级，
  300% 换手窗口，K 线图叠加与统计条）；
- 新增 **SWR 缓存层**（`src/lib/cache.ts`：ttl / refreshInterval / in-flight 去重 / 失败驱逐 / 重试冷却）；
- 个股页：分时接入、日 K 区间 + MA 开关、逐笔成交折叠面板（`StockIntraday` / `StockTransactions`）；
- 新增 `scripts/smoke-embedded.mjs`、`scripts/update-opentdx.mjs`（vendor 刷新）。

## [N8/N9] 2026-09-07 · `5a748b7`

**看盘流程任务化 + 复盘页七步向导**

- `src/lib/dayrun.ts`（当日运行记录：Q1/Q2/Q3 答案 + 竞价逐条判定，60 日环形）；
- `src/lib/mission.ts` + `SessionMission`（时段任务条：唯一目标 + 检查清单 + 倒计时）；
- `QAnswers`（盘中三问必答卡）、`ExpectVerdictPanel`（昨日预期 × 今日竞价逐条判定 → 写回 dayrun）；
- 复盘页七步引导条与「AI 预期排序」（含对用户已写草稿打分）。

## [1.0.1] 2026-09-07 · `f2ea5fe`

真机验收修复：网关告警节流 + 退化行情过滤（无真实行情时不显示误导性温度计/局势）。

## [1.0.0] 2026-09-06 · `204b05f`

打包发布治理：`scripts/sync-profile.mjs`、`scripts/check-bundle-size.mjs`（体积护栏）、
`.github/workflows/ci.yml`（build + `tsc --noEmit` + 护栏 + 冒烟）。

## [0.9.0] 2026-09-06 · `ddb971e`

M10 扩展市场（外盘）：美股/港股报价 + 日 K（`goods_quotes`/`goods_kline`，quote 缺失回退 K 线自算），
期货多市场异动快览（`goods_varieties`）。

## [0.8.0] 2026-09-06 · `b61daee`

M8 轻量选股：`src/lib/screener.ts`（全 A 快照条件筛选 + 6 张预设策略卡 + 客户端信号
「MA5 上穿 MA20」「放量上穿 MA60」，候选 ≤200、并发 ≤8 带进度）+ `pages/ScoutPage.tsx`。

## [0.7.0] 2026-09-06 · `f541bb2`

M7 本地监控：`src/lib/alerts.ts`（价格突破/跌破、涨跌幅、异动关键词规则 + 命中记录 200 条环形 + 冷却去重）
+ `AlertWatcher`（12s 轮询，零额外请求复用行情/事件）+ 「监控」页 + 未读徽标与 Toast。

## [0.6.0] 2026-09-06 · `4e096ca`

M9 个股页增强（分时/日 K 区间 + MA/逐笔）+ 修复数据层 `toArray` 严重缺陷（数组被二次 JSON.parse
导致整层静默空返回）。

## [0.5.0] 2026-09-06 · `1bde754`

复盘温度计**实算**：`review-store` v3 建档昨日涨停池/首板池（v2 自动迁移）+
`src/lib/review-metrics.ts` 实算晋级率/炸板率/首板溢价；N3 强度差分接入复盘页
（观察池 ≤120：真强/惯性/转弱/弱转强 + 低位首板候选一键加入预期清单）。

## [0.4.0] 2026-09-06 · `6eb5e42`

基线固化 + 方法论批次 N1–N7：复盘模式（盘眼/预期清单 ≤5/存档）、竞价雷达与对照矩阵、
事件流/板块脉冲/局势归类、情绪温度计与仓位闸门、持仓决策台 + 凯利仓位、个股页竞价回顾 + 资金面板；
卫生清理（移除 echarts 死依赖、api.ts dataSource 翻转副作用、KlineChart 受控 rows）。

## [0.3.x] 2026-09-02 ~ 09-05

M0–M6：插件骨架打通 → 日 K/分时（lightweight-charts）→ 信息条/关键价位 → 标的搜索/自选 →
市场总览/指数/自选实时行情 → 涨停梯队 + 板块连板统计与热度聚合。
（期间数据链路为「浏览器 → host 桥接 → 远端 MCP」；`stock` 第四列布局补丁形态，v1.2 已废弃。）
