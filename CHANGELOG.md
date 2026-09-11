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
- 新增离线冒烟：`smoke-client-view.mjs`（视图注册契约）、`smoke-ai-contract.mjs`（AI 契约）；
- CI 接入以上两个冒烟 + 体积护栏口径更新为 820KB；
- **B1 基线纪律**：本批 64 文件此前长期未提交（含 CI 引用的两个冒烟脚本），
  2026-09-12 一次性固化；版本统一 1.4.0（唯一来源 `package.json`）。

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
