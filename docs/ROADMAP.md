# ROADMAP — 前端路线图

> 2026-09-12 重写，取代已归档的 `docs/archive/MIGRATION-PLAN.md`（M0–M11）与 `docs/archive/NEXT-WORK.md`（W0–W8）——两套编号已全部交付或失效。
> 两条正交轨道：**A 产品闭环**（用户能多做成什么事）× **B 工程地基**（让 A 不塌）；每个版本 = A 一项 + B 一项，每项都有**可离线验收的锚点**（除标注「交易日」者外）。
> 规模沿用旧口径：S ≤2d / M 3-5d / L 1-2w。

---

## 1. 定位与能力边界（2026-09-12 定案）

**本插件 = A 股盯盘执行台**：服务 `WATCH-METHODOLOGY.md` 的固定时间表（盘后复盘写清单 → 次日竞价对照 → 盘中只答 Q1–Q3 → 尾盘定仓）。

| 能力 | 归属 | 状态 |
| --- | --- | --- |
| 执行台：复盘/作战/看盘、清单与存档、Q1–Q3、持仓与凯利、监控告警 | **本插件** | ✅ 已有 |
| AI 研判（一键 + 深入对话）、结论回填视图 | **本插件** | ✅ 已有 |
| 自挖概念**发现**（HIST 共动类） | **本插件内置**（node-tdx HistEngine，19 工具之一族） | ✅ 引擎已有，⏳ 无 UI |
| 自挖概念**命名**（涨停/异动素材 + LLM 归纳 + 护栏） | **本插件 host 半移植**（口径与护栏来源 `cluster-namer`） | ⏳ A2 |
| 选股引擎（20 策略）、回测（vectorbt）、财务、数据管道/外部数据接入 | 父项目 `tickflow-stock-panel`（`frontend/` SPA + `backend/`） | ❌ **不在本插件范围** |
| 自挖类算法研究（kronoros co_cluster）、簇命名试验、情绪研究 | 兄弟项目 `kronoros` / `cluster-namer` / `sentiment` | ❌ 各自演进 |
| DSH 宿主能力（会话/LLM/设置/沙箱/存储） | DSH 平台（`ctx.*`） | ✅ 复用，不自造 |

**边界规则（任何新需求先过这一问）**：「它服务的是『今天该做什么』吗？」—— 是 → 进主区（四层信息：① 环境 ② 主线 ③ 标的 ④ 动作）；否但是查证工具 → 进一个**同级入口**（A6 起平铺：行情/自挖板块/选股筛选/监控规则/外盘）；否且属于研究/回测/数据 → 交给上游项目，本插件只做**引用**。
**明确不做**（防范围膨胀）：自动下单/推送交易信号；新增图表库；全市场分钟级扫描；历史概念标签当聚类输入；把研究型功能（回测、策略编辑、财务）搬进本插件。

---

## 2. 轨道 A —— 产品闭环

### A1 · host 侧持久化（全量迁移 + localStorage 降级）✅ **已完成（2026-09-12）**
**起点**：14 个 localStorage 键、3 种命名空间、无导出/重置、清缓存即失忆、跨设备不同步；「复盘存档 × 昨日池」这类**跨日资产**恰恰最不能丢。

**内容**：用 DSH 存储子系统落地 `stock_panel` 领域（json 后端落 `$DSH_HOME/storages`），表：`watchlist / review / dayrun / positions / tradelog / verdicts / events / viewed（个股栏）`；host 半新增同源读写路由（`GET/POST /api/stock-panel/state`）；前端 store API 不变（同步内存读 + 异步增量落盘 + localStorage 镜像）；首次启动一次性把 localStorage 上传。

**契约（实测确认）**：

| 项 | 口径 |
| --- | --- |
| 领域 | 名 `stock_panel`（`UNIT_NAME_RE = ^[a-z][a-z0-9_]*$`，**不能有连字符**）、版本固定 `1`、`layout: per-record`（事件流追加型）、`invalidRecords: 'backup-and-skip'`（单条脏记录不阻塞整域） |
| 依赖与 inject | **不 import `@deepseek-ai/dsh-storage-domain`**：公开 npm 只有 `0.0.1-rc.1` 而宿主是 `0.1.2-rc.1`；该包运行期只用到 `descriptorOf` + `valueSchema.parse` + `global.schema.parse/initial`，故**手搓 spec + 极简 schema**（零依赖，不与宿主 zod 副本耦合）。`storageDomain` **刻意不列进 inject**（可选增强，同 llm 立场）：宿主没挂存储子系统时只降级为 localStorage，不拖累 TDX 桥接与对话工具 |
| 客户端与门禁 | `initHostState()` 在 `client.ts` 的 apply 里拉一次全量快照 → 写 localStorage 镜像 → 通知各 store 重载（`onHostHydrated`）；写入走**指纹差量**（只推新增/变化/删除，事件流 500 条也不会每轮全量重发）。`scripts/smoke-host-state.mjs`（26 项断言：路由注册 / 领域 spec 契约 / 读写闭环 / 未声明表被拒 / 无存储子系统时降级），已进 CI |

**验收锚点**：① 清空浏览器 localStorage 后刷新，自选/复盘/持仓/看过的个股全部还在（需真机 GUI 复验）；② host 域不可用时自动降级为本地存储并在底栏标注（`持久化：本地` + 悬浮原因）；③ 老数据一次性首迁（域里能看到记录数）；④ 领域版本演进演练：记录校验刻意宽松，加字段不会让旧记录被 `invalid-record` 拒载。　**规模**：M

### A1 的真机验收（一条命令，需重启一次）
host 半是**进程内**加载：`lib/index.js` 改了必须重启 `dsh web` 才生效（client 半只需硬刷新）。

```powershell
dsh web                              # 重启宿主（会中断当前会话）
node scripts/verify-live.mjs         # ① host 新鲜度 ② 持久化可用性 ③ 写→读→删闭环
```

脚本逐项报告，并把「运行的是重启前的旧 host 半」与真实失败区分开（实测示例：运行 `1cd46631` / 源码 `fcb2f869` → 明确提示重启）。人工再确认两点：底栏显示 `持久化：host`；清一次浏览器 localStorage 再刷新，自选/复盘/持仓仍在。

**已修的真机 bug（时序）**：旧实现在 `apply` 里读一次 `ctx.storageDomain` 并把「不可用」**永久缓存**，而 cordis 的服务挂载时刻不保证早于 apply → 运行实例一直 `available:false`。修法：`ctx.inject(['storageDomain'], …)` 声明式注入 + 请求路径惰性重试，不缓存否定结论；回归用例 `smoke-host-state.mjs` `[6][7][8]`。

### A1.1 · 「看过的个股」store ✅（A4 的数据源，UI 待 A4）
`src/lib/viewed-store.ts`（表 `viewed`）：最近看过的标的（新→旧、去重、上限 30、带查看次数），在 `selection.ts` 的 `setSelection` 单点埋点（左栏/搜索/任意列表点行都汇到这里）。A4 只需把它渲染成左栏分组 + 点击渲染个股信息。　**规模**：S

### A2 · 特色板块：自挖概念 + 命名 ✅ **A2a 与 A2b 均已完成（2026-09-12）**
**两步走，前置未达标不得进 UI**（报告 `docs/CONCEPT-CALIBRATION.md`；工具 `pnpm concept:sweep` / `pnpm concept:stability`）。
**A2a 数据质量 ✅**
- **引擎事实**：内置 JS 走**阈值图连通分量**（无 scipy）→ 必然出现「传递链」巨类，被标 `weak_chain=true`；`min_corr=0.3` 时 194/196 挤成一类、类内相关 **0.008**（≈噪声）。
- **推荐默认**：`pool_n=200` · `window=90` · **`min_corr=0.6`** + **无条件过滤 weak_chain**。实测（as_of 2026-09-11）：可用类 **6 个**（vs 0.45 时 1 个）；孤立 132/191。
- **语义质量**：校准后的 9 个非弱链类语义自洽 —— 电力（深南电A/深圳能源/粤电力Ａ）、地产（万科Ａ/华侨城Ａ）、工程机械（中联重科/柳工/徐工）、面板（TCL科技/京东方Ａ）、粮油、有色、医药、白酒（古井贡酒/泸州老窖），类内相关 0.57–0.81。
- **跨日稳定性**：相邻交易日（09-10→09-11）9 个类逐一 **Jaccard=1.00**；跨 2.5 个月（06-30 vs 09-11）结构明显不同（13 类 vs 10 类）→ 参数与日期确实在起作用。
- **顺带修掉的真问题**：四个 `hist_concept_*` 对话工具此前**丢掉 `as_of`/`window`/`min_corr`/`pool_n`**（传了也白传 = 静默错误），现已声明并转发全部调参字段。

**A2b 命名与呈现 ✅**：host 半移植 `cluster-namer` 口径 —— 素材取成员的涨停/异动（`unusual`/`market_monitor`）与所属板块（`belong_board`，行业口径 `board_type=12`），走 `ctx.llm` 归纳；**护栏照搬**：证据可反查（引文比对 + 时间窗 + 覆盖度）、`named / no_common / insufficient(+降级成因)` 三态、缓存指纹。

| 模块（`src/host/naming/`：六个纯函数 + 编排/路由 + 两个 UI） | 要点 |
| --- | --- |
| `guard.ts` | 引文逐字反查（分隔符归一）、可计算证据分 **0.40 覆盖度 + 0.25 命中票数 + 0.20 窗口内比例 + 0.15 条数（3 条封顶）**、时间窗护栏、降级成因分层、**自报 confidence 不作门控** |
| `prompt.ts` / `parse.ts` / `fingerprint.ts` / `materials.ts` | 提示词与语料渲染；分级降级解析；口径指纹（provider/模型/窗口/源集合/**提示词版本**/护栏阈值）；板块类型码、**非叙事板块词黑名单**、去重/配额/截断 |
| `collect.ts` / `run.ts` / `route.ts` | 采集（见下方「时间性」）；取类成员 → 弱链拒绝 → 采集 → 模型 → 护栏 → **进程内缓存**（key = asOf:classId:fingerprint，命中不产生第二次 LLM 调用）；✅ 批量路径 `nameClasses`（类列表默认）：一次并集采集 → 按成员数分批问模型 → **逐组独立过护栏**（跨组借证据会被拒；漏项如实降级）+ 整批 memo（重复打开 0 调用）。GET 出能力与口径（模型/提示词版本/默认参数/批量预算/护栏/缓存规模）；POST 命名（单类 `classId`，或批量 `all:true` / `classIds:[..]`；非法一律 400，不猜默认值） |
| UI 与强度口径 | 个股卡 `StockConceptCard`（**主视角**：所属类 + 同类伙伴 + 最近共动邻居 + 命名）挂个股详细页；类列表 `ConceptClassesCard` 作为「自挖板块」一级入口（✅ 打开即批量命名归类、按**强度**降序、行内给涨幅/涨停数/成员，含被排除的弱链类计数与池内孤立票）；结论展示抽成 `NamingResultPanel` 两处共用。强度 = `lib/concept-strength.ts`（纯函数，host/client 共用）：**均涨幅% + 6×涨停数**，涨停按 `buy_price_limit` 精确判定、缺失值不按 0 算；`hist_concept_classes` 出数时由 `host/hist-data.ts` 的 `enrichClasses` 补齐（与引擎共用 60s 全A快照 memo）。单测：`tests/concept-strength.test.ts` |

**⚠️ 时间性决策（本站与参考实现最大的口径差异，必须记住）**：node-tdx 的三类素材时间性不同 —— 异动/主力监控是**当日实时列表、无历史接口**；板块归属是**当前快照**（分类学，变化慢）；封板状态由**日K推导、可完全回放**。因此采集层只在 `as_of === 当前交易日` 时采实时源，否则记入 `missingSources` 并在采集说明里写明「不做历史回放」；板块归属照用但**显式标注"当前快照"**。把今天的异动贴到三天前的类上等于凭空造证据 —— 那是护栏存在的意义。移植偏差（单测发现，已修）：① 参考实现按语料顺序取引文出处，而语料按时间升序 → 同一文本同时存在于窗口内外时会先撞最旧那条、把本该算窗口内的证据挡掉（冤枉降级）；② 参考实现的括号补齐是"先 `}` 再 `]`"，`{"a":[1,2`（截断在数组里）补完仍非法 → 改为按括号栈补。
**校准给出的形态约束（已落实）**
- 主视角 = **个股视角**（`hist_concept_query`：所属类 + top-k 共动邻居 + corr）—— 因为校准后仍有 132/191 只孤立，"类列表"信息量薄；
- 类列表次要（4–6 个非弱链类），**标出 as_of 与四个参数**（同票不同参数所属类不同，不标=不可复现）；
- 冷启动文案：首次 ~8s（拉数百只 K 线），之后 30–50ms（GET 里回 `cache`/`today` 供界面说明）；v0 **不做**与官方行业的重合度对照（那是命名阶段 `differ.py` 的活）。

**仍未做**：① 命名缓存只在进程内存（跨进程持久化要新增表 + 版本迁移，等真实使用反馈）；② 官方关系三分类（收敛/叙事漂移/官方盲区）—— v0 明确不做；③ 自挖类**跨日跟踪**（今天的"铜"与昨天的"铜"是不是同一个班 —— 命名缓存按 as_of 隔离，强度也只看当日；跨日归并需要额外的类相似度口径，未列入本批）。

**验收锚点**：① 命名结果带可回溯引文，编造引文的负样本必须降级为 `no_common`；② 时间窗外的证据不计入门控（负样本可复现）；③ 与官方花名册的「盲区」判定只对**行业口径**生效；④ 缓存命中不产生重复 LLM 调用（指纹不匹配视为未命中）；⑤ UI 上明确区分「自挖类（市场今天认定的班）」与「官方概念」，且**不自动改写**用户的复盘结论。覆盖：`tests/naming-guard.test.ts`（25 条）+ `tests/naming-pipeline.test.ts`（16 条，注入假工具/假模型跑全链路）+ `scripts/smoke-naming.mjs`（对**构建产物**验路由/口径/护栏/缓存，CI 已接）。　**规模**：A2a ✅ / A2b ✅

### A3 · 复盘校准页（把「一致率 ≥80%」变成可测量的数）⏳ **决策：必要**
**问题**：方法论与 `PRODUCT-DESIGN` 写了验收指标（与人工判定一致率 ≥80%、温度计分档一致率），但**从未被测量**；「交易日复验清单」散落成待办，没有看板。

**内容**：数据其实已经在手 —— `dayrun` 记录了 Q2 的 `from: 'auto' | 'manual'`、逐条竞价判定 `verdicts`、Q1/Q3 与持仓动作；`review-metrics` 已有晋级率/炸板率/首板溢价实算。新增页面输出：
- **系统 vs 人工分歧**：局势候选（auto）被改成 manual 的比例与样本清单；竞价判定（系统建议 vs 用户点选）；
- **预测 vs 结果**：昨日预期清单 × 今日实际（兑现/证伪命中率，按状态与角色分组）；
- **阈值校准入口**：温度计分档、强度分类阈值、共振阈值 —— 按自身历史回看并留痕；
- 立场不变：**只呈现统计与分歧样本，不自动改用户结论**。

**验收锚点**：① 连续两天有存档后，页面给出可解释的一致率与分歧样本（点样本能跳到当日判定）；② 校准后的阈值变更留痕可回滚；③ 无数据日显示空态而不是 0%（不假装精度）。　**规模**：M

### A4 · 信息架构 v1.5（导航收口）✅ **主体已完成（2026-09-12）**
> ⚠️ **本节的「工具单页」形态已被 [A6](#a6--信息架构-a6导航平铺--已完成2026-09-12) 取代**（同日落地）：抽屉拆平、`ToolHost.tsx` 删除、主区改 `ViewHost.tsx`。下表保留当时的决策与验收记录。

| 变更 | 内容 | 状态 |
| --- | --- | --- |
| 左栏 | **保留自选栏**；**新增「个股」分组 = 最近看过的个股**（新→旧、去重、上限 30、带查看次数、落盘）；**下线「涨停」「异动」分组** | ✅ |
| 点行行为 | 点左栏任一行 = 设当前标的 **+ 切到「看盘」** → 主区立刻是该标的的个股信息（`openStockAndWatch`） | ✅ |
| 工具 | **7 个工具合并为一张单页**（标题锚点常驻 + 当前区块展开）；**外盘弱化**（排最后、标「次要」、默认不展开） | ✅ 已被 A6 取代 |
| 行情合并 | 市场总览 + 指数 + 涨停梯队 → **一屏并排聚合**（`MarketPage`）：容器宽度分列 / 单节拍器 / 每块可折叠 | ✅ |
| 主区收口 | 「工作台 / 明细」分工收口为一个个股信息面 | ✅ **A6 解决**：「明细」页签与整页入口已下线，工作台是个股信息主面 |

**落地要点**
- `selection.ts`：`LeftGroup = 'watch' | 'viewed'`；旧持久化值 `limit`/`unusual` 经 `leftGroupOf()` 就地收敛到「自选」（**不需要**再升 UI 键版本）；工具页旧 id（`overview`/`indices`/`ladder`）经当时的 `toolIdOf()` + `LEGACY_TOOL_IDS` 收敛到 `market`（A6 起为 `viewIdOf()` + `LEGACY_VIEW_IDS`，同样是就地收敛、不升版本键）；
- `WatchList.tsx`：两组都从状态带已在轮询的全 A 快照取价（零额外请求），并**去掉左栏那条 30s×3 的异动轮询**；j/k 仍在当前分组内移动；
- **只挂载当前展开的区块是硬约束**：行情页（总览 20s / 指数 15s / 涨停梯队 30s，**单轮 ≤177 次工具调用**）/ 自选盘 12s … 全挂会把请求预算打爆（`docs/ARCHITECTURE.md` §3.1）→ **标题常驻（信息架构可见）、内容按需挂载（离开即卸载 → 轮询停止）**；
- `MarketPage.tsx`：三块**并排**聚合（不是竖着摞），列数按**容器实测宽度**（`ResizeObserver`：≥1120 三列 / ≥760 两列 / 否则单列 —— 视口断点在 DSH 里会骗人：左栏 + 右 AI 栏都开着时视口 2560px、面板只有 600px）；四条请求预算纪律见 `ARCHITECTURE.md` §4；
- 新增样式 `.dc-page-head` / `.dc-tool-body` / `.dc-tool-more` / `.dc-tool-entry*`（只消费 `--dc-*` token）。

**验收锚点**：✅ 点左栏任一行 → 主区是该标的个股信息（并切到看盘）；✅「个股」分组跨刷新保留（已并入 A1 的 host 持久化表 `viewed`）；✅ 外盘不占独立入口且默认折叠；✅ j/k 在左栏两组内移动；✅ 行情页三块一页（旧 id 映射有单测）；⏳ **⌘K 输入功能名直达区块未做**（当前仍走工具单页的整体切换，未做区块级滚动定位 —— 行情页内已有锚点可复用）。　**规模**：M（剩余为区块级直达）

### A6 · 信息架构 A6（导航平铺）✅ **已完成（2026-09-12）**
**决策来源**：`PRODUCT-DESIGN.md` §6e（用户拍板）。一句话：**拆掉「工具」这一层**。

| 变更 | 内容 | 状态 |
| --- | --- | --- |
| 导航平铺 | `复盘 / 作战 / 行情 / 自挖板块 / 选股筛选 / 监控规则 / 外盘` 同级（旧抽屉里的板块全部提上来） | ✅ |
| 摘入口 | **「自选盘」「个股明细」摘除**：左栏常驻列表（自选 / 个股，点行即看）就是它们的入口 | ✅ |
| 摘入口 | **「看盘」摘除**：更名 **工作台**（`WORKBENCH_VIEW`），不上导航栏 —— 点左栏任一行 / 任意页面点股票即到 | ✅ |
| 机制下线 | `ToolHost` / `TOOL_VIEWS` / `ui.tool` / `setTool` / `closeTool` / `SUB_VIEWS` / `ui.sub` / `setSubView` 全部删除 | ✅ |
| 键盘 | `1-7` 一级入口；`t` 下线；`Esc` 只剩两层（⌘K 面板 > 诊断面板） | ✅ |
| 迁移 | `toolIdOf` → `viewIdOf`：旧 id `overview`/`indices`/`ladder` → `market`，落盘 `tool` 值参与迁移 | ✅ |
| 默认入口 | **默认 = 行情**（`DEFAULT_VIEW`）：首屏不再"按时段猜阶段入口"；默认值必须是导航栏上的入口（单测钉住） | ✅ |

**落地要点**
- `src/views/ViewHost.tsx`（新）：`switch (ui.view)` 单页渲染 —— **不许**改成一排 `hidden` 容器，`display:none` 不停轮询（涨停梯队单轮 ≤177 次调用，只有卸载才停）；
- `src/lib/selection.ts`：`PRIMARY_VIEWS`（导航 + `1-7` 键位）与 `ALL_VIEWS`（含工作台，供校验与 ⌘K）分开导出；`WORKBENCH_VIEW.id === 'watch'` 必须在 `ALL_VIEWS` 里、且**不在** `PRIMARY_VIEWS` 里；`DEFAULT_VIEW = 'market'` 是**默认入口**的唯一来源（`DEFAULT_UI.view` 与首次安装的 fallback 都读它）；**UI 键升到 `ui:v4`**：读到旧 `ui:v3` 时由 `initialViewOf()` 一次性落到默认入口（否则"上次停在作战"会压过新默认），写回 v4 后按用户选择记住；
- `src/lib/hotkeys.ts`：`toolToggle` / `toolOpen` / `closeTop.layer='tool'` 删除，契约表与单测同步；
- `src/panel/StatusStrip.tsx`：导航 4 → 7 项，`.is-secondary` 表达"外盘次要"；窄档给导航加横滚兜底（`min-width:0` + `overflow-x:auto`），防止把右簇挤出可视区；
- `src/index.css.txt`：`.dc-tool-*` / `.dc-page-head` 死样式清理；挂载槽改名 `.dc-view-body`；
- `WatchlistPage.tsx` / `StockDetailPage.tsx` **保留文件、不再被引用**（不进 bundle）—— 「只摘入口、不删文件」是本次的明确选择，回退成本低。

**验收锚点**：✅ 单测钉住"七个入口的顺序 + 工作台不得回到导航栏 + 旧 id 映射 + 默认入口是行情"；✅ 构建产物核对（`自选盘`/`个股明细`/`toolToggle`/`dc-tool-entry` 零命中）；⏳ **真机复验未做**（需重启 `dsh web` + 硬刷新）：7 项导航在窄容器下不被裁、首屏停在行情、点左栏落工作台、`Esc` 只关弹层、`1-7` 与 ⌘K 直达、老用户落盘值迁移后不空白。　**规模**：S-M

### A5 · 视觉收口（`--dc-*` 迁移 + 宽屏精修）⏳
**现状**：只有 7 个新文件（`panel/*`、`views/*`）消费 `--dc-*`；**28 个旧文件仍有 1,000+ 处硬编码 Tailwind 颜色**（`ReviewPage` 单文件 136 处），CSS 里 64 条暗色主题重映射作为过渡层。

**内容**：逐页迁移到语义 token，每迁完一页删掉对应重映射行；顺带做旧页面的宽屏精修（当前宽屏重排只落在复盘/作战/看盘主区）。

**验收锚点**：每版迁移 3–4 个文件；`index.css.txt` 中 `data-ds-dark-theme` 重映射行数**单调下降**；明暗主题下无不可读元素；迁移不增加体积（下一条 B2 的账）。　**规模**：L（可分摊到多版）

---

## 3. 轨道 B —— 工程地基

### B1 · 基线与版本纪律 ✅ **已完成（2026-09-12）**
**起点**：**53 项未提交**（26 改 / 11 删 / 16 未跟踪），未跟踪里包含**CI 正在引用的两个冒烟脚本**与 `src/views/`、`src/panel/*`、`src/lib/{selection,stage,ai,ai-task,ai-contract}.ts`、`src/host-ai.ts` —— 即 **CI 门禁从未真正执行过**（克隆 `origin/main` 得不到这些文件）；`package.json` = 1.3.0，而 README/CHANGELOG 描述的 v1.2/v1.3/v1.4 全在工作区。

**内容与落地**：① 原子提交现有 v1.2/v1.3/v1.4 批次（代码批次 `4c768e4`，64 文件）+ 文档批次；② `package.json` 版本统一（本轮 = 1.4.0）；③ 补齐 `CHANGELOG.md`（1.1.0→1.4.0）；④ 归档旧计划到 `docs/archive/`；⑤ 此后**每批一次提交 + 一条 CHANGELOG**。

**验收锚点**：✅ `git status` 干净（除 B2 待清的 `types/` 悬空副本）；✅ 版本号三处一致（package.json / CHANGELOG / 状态带显示的 `v1.4.0`）；✅ 两个冒烟脚本已入库 → CI 门禁自此真正生效。　**规模**：S

### B2 · 体积与减重 ✅ **主体已完成（2026-09-12）**
**起点**：`lib/client.js` 825.8 KB / 护栏 840 KB → 余量仅 2%；契约要求 client bundle **单模块（不能 code splitting）**。
**落地**
1. **先量后减**：新增 `scripts/bundle-report.mjs`（esbuild metafile 成分报告：三类汇总 / 按目录 / 单文件 top25 / 未压缩·minify·gzip 三口径）。实测成分（未压缩 822.5 KB）：`lightweight-charts` 216.8 KB(26%) · `src/pages` 175.9 KB(22%，ReviewPage 单文件 51.8 KB) · `src/components` 136 KB(17%) · `src/lib` 125.7 KB(16%) · 内联 CSS 44.6 KB(5.5%) → **大头是我们的代码 + 图表库**，不存在"随手砍零碎"的空间。
2. **默认 minify + sourcemap（用户决策）**：822.5 → **530.8 KB（−35.7%）**；`lib/client.js.map` 补偿可调试性（宿主 client-modules 层会读取并校验为 Source Map v3，再盖章自己的组合 map URL；缺失不影响执行）。逃生阀 `CLIENT_MINIFY=0`（体积必然超护栏，需配 `CLIENT_MAX_KB`）。包装改用 esbuild 的 banner/footer，使 sourcemap 行号包含包装行。
3. **护栏重设为 600 KB**（余量 69 KB）—— 从"2% 的假门禁"回到真门禁；体积账在脚本头部逐行登记。
4. 顺带清理：删除死文件 `src/lib/queryKeys.ts`（零引用，且 react-query 并非依赖）。

**仍未做（故意留下，不阻塞）**：`lib/index.js` 护栏、CSS 单列口径、死代码清理的剩余部分（`api.*` 9 个死方法、AI 报告历史整链、HTTP-only 残留分支、`gateway/` 目录与其 2.4 MB 日志、根目录 `types/` 悬空 .d.ts）—— 主要影响认知负担与仓库卫生，体积收益有限；真正的大头减重靠 **A5**（token 迁移 + 退役被新骨架取代的旧页面）。

**验收锚点**：✅ client.js 530.8 KB ≤ 700 KB（护栏 600 KB 且余量 14%）；⏳ **护栏覆盖 host/CSS 产物未做**；✅ 体积账新增多行登记；✅ 成分报告可一键复现。　**规模**：M（主体 S，剩余为卫生项）

### B3 · 请求预算与缓存一致性
**起点**：≈**200–400 次工具调用/分**，其中 **≈90% 是 ladder** —— `src/lib/ladder.ts` **零缓存**，却被作战页（30s）/梯队页（30s）/复盘页三处各自重算（每轮 ≤1+160 次调用）；指数有**三个独立 15s 定时器**共享同一 key；除 `AlertWatcher` 外**没有轮询检查 `document.hidden`**，左右栏用 HTML `hidden` 收起时组件仍挂载、轮询照跑；`cache.ts` 的 `refreshInterval` 变更因 deps 缺项不生效。
**内容与落地（2026-09-12）**
- ① ✅ `loadLadder(signal, {force})` 加 30s 快照缓存 + in-flight 去重，内部 `fetchAllA(true)` 改为复用 market 的 20s 缓存（作战页同轮不再重复拉全 A）；
- ② ✅ `cache.ts` 的轮询 tick 在 `document.hidden` 时跳过（一处修复覆盖 **13 个** SWR 轮询者）、左栏收起时 `enabled:false` 停轮询、3 个直连 `setInterval` 加隐藏守卫；
- ③ ✅ 指数三处 15s 定时器收口到统一节拍（`swrKey.indices()` 共享缓存 + 单一节拍器）；
- ④ ✅ effect deps 补上 `refreshInterval`；
- ⑤ ✅ 请求预算度量脚本 `scripts/budget.mjs`（已进 CI，**只降不升**）。

**追加**：休市闸门收口到 `lib/poll-gate.ts`（非交易时段停掉定时轮询，见 CHANGELOG「评审修复」批）。

**验收锚点**：作战页单轮调用数从 ≤177 降到 ≤25；常驻基线从 50/分降到 ≤20/分；后台标签页 0 请求；`refreshInterval` 运行时可改；度量脚本输出与实测一致。　**规模**：M

### B4 · 质量网（lint + 单测 + 产物校验）🟢 **已完成（2026-09-12）**
**起点**：**无 ESLint、无测试框架**（lockfile 0 命中）；`tsc` 只检查 `src`，且 `noUnusedLocals/noUnusedParameters: false` → 死代码与 hook 依赖错误对编译器隐形。
**落地**
1. **ESLint（flat config，规则刻意克制）**：`eslint src scripts` → **0 error / 0 warning**（棘轮：`--max-warnings` 由 30 收紧到 **0**，本文件与 `package.json` / `ci.yml` / `README` 均已同步）；启用 `react-hooks/rules-of-hooks`（error）+ `exhaustive-deps`（warn）；TS 侧只开 `no-unused-vars`（warn，`_` 前缀可忽略）+ 若干低噪音规则。**不套"全量 recommended"**：28 个旧页面会产出上千条噪音，然后被整片 disable。
2. **单测（零新增依赖）**：Node 内置 `node:test` + 已有的 esbuild 打包 TS 测试（`scripts/unit.mjs`，`pnpm test`），不引入 vitest/jest。**7 个测试文件 / 65 条**：`indicators`（涨跌停分档 / 涨停价 / 一字板 / 连板统计）、`regime`（`BAND_CAP` 仓位总闸档位 / 退潮压温强制规则 / 过热检测 / 单调性）、`strength`（五类判定 + 阈值边界 + 低位首板筛选）、`situation`（局势优先级瀑布 + 不看温度档位）、`review-metrics`（null vs 0、分母与样本、亏钱效应样本）、`screener`（条件边界 / 板块前缀 / ST / MA 信号窗口）、`chips`（形状与口径不变量 / 300% 换手窗口 / 逐笔降级）。
3. **门禁接线**：CI 增 `eslint --max-warnings 0`（**棘轮：只降不升**）与 `node scripts/unit.mjs`；`linterOptions.reportUnusedDisableDirectives` 打开。
4. **单测抓到 5 个真问题**（这是它存在的意义）：① `regime` 的 drivers 截断到 3 条时会把**强制压温的原因**挤掉 → 改为「点名具体触发条件（晋级率<25% / 炸板率>50%）并优先保留」；② 确认"全 0 输入温度仍 >0"（炸板率低会加分）—— 记录为**行为契约**：空数据必须由 UI 侧判空兜住；③ **`classifyStrength` 的量比阈值从未参与判断**（写成 `&& t.volRatioStrong`，对数字取真值恒真）→ 缩量一字板被判「真强」；已改为 `r.volRatio >= t.*`（判真强/转弱会变少，那是修对了）；④ **`chips` 空输入抛的是 TypeError**（`rows[0]` 未定义）而不是约定的「日K数据不足以计算筹码」，调用方按 message 判断会完全失效 → `core()` 入口补闸门；⑤ **`screenRows(rows, cond, 0)` 返回 1 条**（先 push 再判长度）→ 补 `limit<=0 → []` 闸门。

**仍未做**：① 测试文件目前不在 `tsc` 的 include 内（断言靠运行保证，类型错误由 esbuild 暴露）；② `build-client --check` 的 hash 基线文件（现状是与磁盘产物比对，能挡住手改生成物）；③ `screenRows` 目前**只有测试在用**（ScoutPage 自己写了一份同逻辑的 200 条循环）—— 要么合并、要么删掉导出。

**验收锚点**：✅ CI 增 lint + 单测步骤且全绿；✅ 无失效 `eslint-disable`（现仅 1 处 `KlineChart` 的 `exhaustive-deps`，且被 `reportUnusedDisableDirectives` 确认仍需要）；✅ 新增方法论阈值必须附带单测（温度计档位与强制规则已锁）；✅ R4 实算指标（晋级率/首板溢价/炸板率）必须锁死「无证据 → null」与分母口径。　**规模**：L ✅

### B5 · 运行态一致性与可观测
**起点**：**构建产物 ≠ 运行实例 ≠ 文档**三者无任何校验。实测：仓库已是 v1.4 流程导航，而浏览器里仍跑着 v1.3 的四入口（页面刷新前加载的旧 bundle）；另有两套缓存（`cache.ts` 与 `market.ts`）对同一份全 A 数据给出不同新鲜度。
**内容与落地（2026-09-12）**
- ① ✅ 采纳**比"构建时间"更强的做法** —— 构建 id = src 内容哈希（`scripts/build-id.mjs`，确定性，因此 `build-client --check` 仍可逐字节比对；并修掉一个真 bug：`SKIP_DIRS` 原按目录名全局匹配，导致 `src/lib/**` 不进哈希、id 对 `src/lib` 改动无反应）；host 新增 `GET /api/stock-panel/build` 暴露后端 id；底栏显示 `v1.4.0 · <id>`，两份 id 不一致时给出「有新构建 · 点此刷新」按钮。
- ② ✅ 全 A 快照缓存**收口为一处**：`cache.ts` 新增命令式 `swrFetch(key, fetcher, {ttl})`，`market.fetchAllA(force)` 删掉私有的 `allACache/allAFetching`，改走同一个 SWR store（此前 UI 在不同页面可能读到相差 20s 的两份数据）。
- ③ ✅ **诊断面板**（`src/panel/DiagnosticsPanel.tsx`，底栏 🩺 按钮 / Esc 关闭）：① 构建（本页 vs 服务端 build id → 是否跑着旧 bundle）② 持久化（host 域可用性 / 降级原因 / 各表记录数 / 是否首迁）③ 数据链路（transport / 端点 / 工具数）④ 缓存（每个 SWR key 的状态、数据年龄、是否在途 —— 13 个轮询者的共同底账，每秒刷新）⑤ AI 与 HIST（按需探测，不轮询）。设计立场：**如实展示，包括不可用的原因**。

**验收锚点**：✅ 改完代码只 build 不刷新时，界面能提示「当前运行的是旧构建」；✅ 全 A 数据只有一个缓存（`swr:mkt:allA`）；✅ 五类子系统状态可在面板内一眼判断（不需要开 DevTools 抄命令）。　**规模**：M

### B6 · 静默失效修复（小手术，随时可做）✅ **已完成（2026-09-12）**

| # | 问题 | 证据 | 影响 |
| --- | --- | --- | --- |
| 1 | **关键价位功能静默失效**：`StockDetailPage` 调 HTTP-only 的 `stockAnalysisLevels`，在 embedded 部署下 404，被 `Promise.allSettled` 吞掉 → `levels` 恒为 null | `StockDetailPage.tsx` / `api.ts` | 用户以为「没有价位」，实际是功能死了 |
| 2 | **AI 请求无法中断**：`use-ai.ts` 的 AbortController 是死代码（signal 未透传给 `ai.ts` 两参包装） | `panel/use-ai.ts` / `lib/ai.ts` | 快速重跑白烧 LLM 额度（单请求 90s） |
| 3 | 干掉的 `eslint-disable`、`queryKeys.ts`、9 个死 `api.*` 方法 | 见 B2 | 认知负担 |

**落地**：① `api.stockAnalysisLevelsAvailable()` + 三处包装透传 signal；界面上以琥珀条显式给出「关键价位不可用 + 原因 + 替代做法（右栏模型价位线）」；② `runStockVerdict/runReviewPlan/runScoutRank` 全部接受并透传 `signal`，`use-ai` 在切换标的/卸载时取消在途请求；③（死代码清理）归入 B2。

**验收锚点**：✅ 关键价位在 embedded 下**明确提示不可用**（不再静默 null）；✅ 切换标的时上一笔 AI 流真的被取消；⏳ 死代码删除后体积账更新（B2）。　**规模**：S

---

## 4. 版本节奏

| 版本 | 轨道 A | 轨道 B | 主题 |
| --- | --- | --- | --- |
| **V1.5** | A1（host 持久化全量迁移） | **B1（基线提交/版本统一）· B5（构建 rev 显示）· B6（静默失效）** | 「地基版」：先把可回滚点与数据资产立住 |
| **V1.6** | A2a（参数校准报告）→ A2b（命名板块） | B3（请求预算） | 「特色板块版」：自挖概念 + 命名 |
| **V1.7** | A4（左栏自选+个股 / 工具单页 / 外盘弱化）→ **A6（导航平铺，取代工具单页）** + A3（复盘校准页） | B2（减重 100KB+） | 「导航收口版」 |
| **V1.8** | A5（token 迁移收尾） | **B4（ESLint + 单测 + 产物校验）✅ 已提前完成** | 「质量网版」 |

> **V1.5 进度（2026-09-12）**：**B1 ✅ · B5-①② ✅ · B6 ✅ · B3 部分 ✅（ladder 共享缓存 + 可见性暂停 + `cache.ts` deps 修复）· A1 ✅**；原文标注的剩余项（B5-③ 诊断面板、B3-③⑤）后续已在 §B5 / §B3 落地栏标记 ✅。
> 代码批次 `4c768e4`（v1.2/v1.3/v1.4 合并发布）+ `494fb54`（构建 id 修复），A1 批次见其提交。
> **B4 ✅（提前于 V1.8 完成）**：lint 归零并把棘轮收到 `--max-warnings 0`；单测 7 文件 / 65 条覆盖方法论地基与复盘实算口径，并抓到 5 个真问题（含 `classifyStrength` 量比阈值恒真）。
> 📌 **体积（现行值）**：client.js **534.3 KB / 护栏 600 KB**（≈89%）。历史值 814.0KB / 840KB 是**减重前**的口径，仅作对比，勿再引用（B2 减重已完成）。

### 本周三件事（按性价比排序）
> 四项均已 ✅（B1 基线与 `4c768e4`、B3-① ladder 30s 共享缓存消掉约 90% 调用量、B6 两个静默失效、A1 host 持久化 8 张表 + 同源路由 + 增量同步 + 降级 + 离线门禁）；原文的「下一步」建议（B2 减重 / B5-③ 诊断面板 → V1.6 的 A2a）均已落地，见 §B2 / §B5 / §A2。

---

## 5. 交易日复验清单（阻塞项看板）

需要交易日盘中数据才能定论；每条都要把结论**回填到对应文档**后才算关闭。

| # | 待验项 | 关联 | 状态 |
| --- | --- | --- | --- |
| 1 | `auction`：`unmatched` 正负语义 / `matched` 单位 / 与涨停价对齐 / 开盘后是否停更 | MCP-SETUP §5 · 竞价对照矩阵 | ⏳ 交易日 |
| 2 | `transaction`：`bs_flag` 方向 / `vol` 单位 | MCP-SETUP §5 · 逐笔面板 | ⏳ 交易日 |
| 3 | `unusual`/`market_monitor`：盘中增量质量（炸板/回封是否真的出现） | 事件流 · 监控关键词 | ⏳ 交易日 |
| 4 | 温度计实算（晋级率/炸板率/首板溢价）跨日正确性 | review-metrics · 校准页 A3 | ⏳ 交易日 |
| 5 | 强度差分（真强/惯性）与人工判定的一致率抽样 | strength.ts · A3 | ⏳ 交易日 |
| 6 | 自挖概念引擎：`as_of` 跨日推进 + 校准后类规模/稳定性 | A2a | ⏳ 交易日 |
| 7 | 监控命中 Toast/徽标交互、重启保留 | alerts | ⏳ 交易日 |
| 8 | 竞价雷达 9:15–9:25 全流程（观察池 ≤40、判定写回 dayrun） | AuctionRadar · dayrun | ⏳ 交易日 |

---

## 6. 未决 / 待确认

| # | 事项 | 需要谁定 | 影响 |
| --- | --- | --- | --- |
| 1 | 自挖概念的**呈现密度**：是「当日类列表」为主，还是「个股所属共动类」为主？（A2b 可先做后者，成本低） | 用户 | 已定：**两者都要**（个股卡=主视角，类列表=一级入口且按强度排序） |
| 2 | 「个股栏」历史上限与排序（默认 30 只 / 最近优先？是否按日期分组？） | 用户 | A4 细节 |
| 3 | ~~工具单页的分区顺序~~ —— A6 已把抽屉拆平（§A6），顺序即 `PRIMARY_VIEWS`；若要再加入口，先定"分组/收起"设计 | 用户 | 已关闭 |
| 4 | 命名是否要产出「每日报告」（cluster-namer 的 recap HTML/MD）并落盘导出 | 用户 | A2b 是否含报告渲染 |
| 5 | 是否保留遗留 `http` 网关与 `gateway/`（B2 提议删除，需确认没有旁路调试需求） | 用户 | B2 删除范围 |
| 6 | 复盘/持仓/交易日志是否需要**导出/导入**（JSON 或 CSV） | 用户 | A1 增量 |
