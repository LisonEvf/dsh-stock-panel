# ARCHITECTURE — 架构与数据流

> 本文描述 **@lisonevf/dsh-stock-panel** 的实际架构与关键约定。定位与界面见 `README.md`，
> 待做项见 `docs/ROADMAP.md`，历史计划见 `docs/archive/`。
> 文中标注 ✅=现状已实现；⏳=规划中（带对应 ROADMAP 编号）。

---

## 1. 双半结构与构建

```
@lisonevf/dsh-stock-panel
├── host 半（Node，tsdown/rolldown → lib/index.js）
│   ├── src/index.ts         Cordis entry：inject ['webServer','tools']，职责
│   │                        ① provide 插件元数据（视图槽/ID/order）
│   │                        ② registerEmbeddedTdxBridge → POST /api/stock-panel/call
│   │                        ③ registerStockTools → 注册 8 个对话工具
│   │                        ④ registerAiBridge → POST /api/stock-panel/ai（可选增强）
│   │                        ⑤ registerStateBridge → GET/POST /api/stock-panel/state（可选增强，A1）
│   │                        ⑥ registerBuildInfoRoute → GET /api/stock-panel/build
│   ├── src/host/tdx-data.ts 内置 node-tdx 服务：连接管理 + serial 串行队列 + 19 工具分发
│   ├── src/host/hist-data.ts 内置 HIST 自挖概念引擎（惰性单例，快照 TTL 3600s）
│   ├── src/host-ai.ts       一键问模型：官方 ctx.llm + agentDefaultModel + 自愈重试
│   ├── src/host-tools.ts    对话工具定义（**8 个**：行情 4 + HIST 4；raw ToolDefinition）
│   ├── src/host/state.ts    host 侧持久化（DSH 存储子系统 stock_panel 领域 + /api/stock-panel/state）
│   └── src/host-util.ts     ctx 安全访问 + 桥接路由注册
└── browser 半（esbuild + tailwind → lib/client.js，**必须单模块**）
    ├── src/client.ts        apply(ctx)：注入样式 + slots.inject('conversation.view') + 诊断句柄
    ├── src/panel/           三段式骨架（AppShell/StatusStrip/WatchList/AiPanel/use-ai/hooks）
    ├── src/views/           流程入口（复盘/作战/看盘/工具单页/阶段头）
    ├── src/pages/components 页面与组件
    └── src/lib/             领域逻辑与状态层（selection/cache/market/ladder/…）
```

约束（契约级，不能违反）：

| 约束 | 原因 |
| --- | --- |
| host 半不得 import 浏览器专用模块；client 半不得 import Node 模块 | 两个 bundle 分别在 Node 与浏览器执行 |
| client bundle 必须 flat module graph（**不能 code splitting**） | 插件运行时契约 → 体积只能靠减少内联代码，见 `scripts/check-bundle-size.mjs` 头部体积账 |
| 视图注册只用 `ctx.slots.inject('conversation.view', …)` | 声明感知：宿主 apply 早晚都成立，声明消失/HMR 自动装卸 |
| `llm` / `agentDefaultModel` **刻意不列进 inject** | 它们是可选增强：宿主没挂 LLM 服务时只置灰按钮，不拖累行情链路 |

产物与体积（2026-09-12 实测）：

| 产物 | 大小 | 护栏 |
| --- | --- | --- |
| `lib/client.js` | 815,857 B（796.7 KB） | **820 KB**（`CLIENT_MAX_KB` 可覆盖），余量 23.3 KB = 2.9% |
| `lib/index.js` | 162,379 B（158.6 KB） | 无护栏（ROADMAP B2 建议补） |
| `lib/index.js.map` | 454,171 B | 不随包发布 |

---

## 2. 数据链路 ✅

```
Browser                        host 半（dsh web 进程内）                行情源
───────                        ──────────────────────                  ──────
invokeTool(name,args)  ──POST──▶ /api/stock-panel/call
  （src/lib/mcp.ts，25s 超时）    └─ callEmbeddedTool(name,args)
                                     └─ serial() 串行队列 ──▶ node-tdx（opentdx.js）
                                        · TDX 长连接 TCP 7709/7727
                                        · 19 工具分发 + 输出归一化
                                        · hist_concept_* → HistEngine（惰性重建）
```

- **错误语义**：业务错 → `{ok:false, kind:'business'}`；未知工具 → `kind:'unsupported'`；
  连接不可达/禁用 → `kind:'unavailable'`。前端**如实展示**，不回退任何远端服务。
- **遗留 http 模式**：`window.__DSH_TDX_TRANSPORT__='http'` 时改走自建 python 网关
  （`gateway/`，默认 `127.0.0.1:8017`，15s 超时）。默认 embedded；`DSH_TDX_EMBEDDED=0` 可在 host 侧禁用内置。
- **单一配置源**：端点/模式全部收口在 `src/lib/endpoints.ts`（host env + client window 两个入口）。
- 排障与字段语义见 `MCP-SETUP.md`；诊断句柄见 §8。

### 2.1 自挖概念管道（HIST → 命名 → UI）⏳ A2

```
① 发现（已内置）  src/host/hist-data.ts → HistEngine
   池：全 A 成交额榜前 pool_n（默认 200）→ QFQ 日线 → 60 日残差收益 → Pearson 相关
   → 聚类（有 scipy 走 hclust，纯 JS 路径自动降级阈值图）
   输出：classes[]（class_id/size/mean_intra_corr/members）+ isolated[]
② 命名（v1.5 移植 cluster-namer 口径）
   素材：成员的涨停/异动（unusual/market_monitor）+ 所属板块（belong_board）
   约束：素材**只用于解释，不进聚类输入**（否则退化回「按官方花名册分组」）
   模型：host 半复用 ctx.llm（与 AI 双通道共用路由与预算）
   护栏：证据必须可反查（引文比对 + 时间窗 + 覆盖度）→ 不达标即降级
   verdict 三态：named / no_common / insufficient(+降级成因)
③ 呈现（待定）
   候选落点：工具单页「概念」区块（主）· 复盘②主线识别（引用）· 看盘个股卡（所属共动类）
```

**前置门槛**：默认参数当前输出退化（实测 `as_of=2026-09-11`：7 类中 1 个 141 只「弱链」
mean_intra_corr=0.027、其余 6 类仅 2–3 只、200 池中 42 只孤立）→ 必须先完成
**参数校准（pool_n / window / min_corr）+ 弱链过滤 + 跨日稳定性**，否则不得进入 UI 开发。

---

## 3. 前端状态层 ✅

| 层 | 位置 | 职责 | 约定 |
| --- | --- | --- | --- |
| **当前标的 + UI 状态** | `src/lib/selection.ts` | 唯一真源：selection / view / sub / tool / 栏显隐 / K 线窗口 | 模块级 store + localStorage（`stock-panel:ui:v3`，含 v1/v2 迁移）+ 订阅 + `useUi()` |
| **SWR 缓存** | `src/lib/cache.ts` | `useSwr(key, fetcher, {ttl, refreshInterval, enabled})`：fresh 命中零请求 / stale 先回后刷 / 失败驱逐 + 重试冷却 / in-flight 去重 | key 全部由 `swrKey` 工厂生成；**不提供 AbortSignal**（已知限制） |
| **全 A 快照** | `src/lib/market.ts` | `fetchAllA(force)`：20s TTL，`force=true` 绕过 | ⚠️ 与 `cache.ts` 是**两套缓存**（ROADMAP B5 收口） |
| **领域 store** | `watchlist-store` / `review-store` / `dayrun` / `positions` / `alerts` / `event-stream` / `ai` | 各自 localStorage + 订阅 | 见 §5 键表；全部计划迁移到 host 域存储 |
| **派生纯函数** | `ladder` / `regime` / `situation` / `strength` / `review-metrics` / `screener` / `chips` / `indicators` | 无 IO，阈值全部是「可配置初值 + 自校准」 | 方法论要求：**禁止把阈值当常数用** |

### 3.1 轮询与请求预算（⚠️ 已知架构债）

轮询点共 21 处（13 个 SWR `refreshInterval` + 8 个 `setInterval`）。按代码常量推算（非实测采样）：

| 来源 | 频率 | 量级 |
| --- | --- | --- |
| 常驻基线（指数 15s ×9 / 全A 30s / 时钟 60s / 异动 30s×3 / 当前标的 12s） | — | **≈50 次/分** |
| 作战页每轮（30s）：server_info + captureOnce(6) + 全A + **ladder（≤1 + ≤160）** + 板块脉冲(≤8) | 30s | **≤177 次/轮 → ≤354 次/分** |
| 监控规则（AlertWatcher，12s，≤10 只） | 12s | ≤50 次/分 |

**合计 ≈200–400 次/分（3.4–6.7 req/s），其中约 90% 是 ladder。** 三个问题：

1. `src/lib/ladder.ts` **完全没有缓存**，却被 3 个调用方各自重算（作战页 30s / 梯队页 30s / 复盘页一次性）；
2. 指数有 **3 个独立的 15s 定时器**共享同一 SWR key（状态带 / AI 上下文 / 指数页），相位错开时会重复请求；
3. 除 `AlertWatcher` 外**没有任何轮询检查 `document.hidden`**；左右栏用 HTML `hidden` 收起时组件仍挂载 → 轮询照跑。

对策与验收锚点见 `docs/ROADMAP.md` B3。

---

## 4. 视图与导航（现状 → 目标）✅/⏳ A4

- **现状**：一级导航 = 复盘 / 作战 / 看盘（`PRIMARY_VIEWS`），工具 = 抽屉（`TOOL_VIEWS` 8 项，
  `views/ToolHost.tsx`）；看盘有三个二级页签（工作台 / 明细 / 自选盘）；左栏三分组（自选 / 涨停 / 异动）。
- **目标**：左栏 = **自选 + 个股（最近看过）**；点击任一栏的标的 → 主区渲染**个股信息**；
  工具合并为**单页**（外盘弱化为次要区块）；涨停/异动分组下线（涨停走梯队、异动进工具单页）。
- **持久化要求**：视图被卸载（切到「对话」）后回来必须保持标的/视图/工具位置——因此所有 UI 状态
  都在 `selection.ts` 落盘，**新增「个股栏」的历史列表同样要落盘**（并纳入 host 持久化迁移）。

---

## 5. 持久化

### 5.1 现状（localStorage，14 键）✅

| 键 | 归属 | 版本/迁移 | 校验 |
| --- | --- | --- | --- |
| `stock-panel:ui:v3`（+ v2 / view:v1 旧键） | `selection.ts` | ✅ v2→v3、v1→v3 | 逐字段 |
| `dsh-stock-panel:review:v3`（+ v2 旧键） | `review-store.ts` | ✅ v2→v3（非破坏） | sanitize + 60 日截断 |
| `dsh-stock-panel:ai-verdict:v1` | `ai.ts` | — | 形状校验 + 80 条上限 |
| `dsh-stock-panel:watchlist:v1` | `watchlist-store.ts` | — | 市场白名单 + ≤60 |
| `dsh-stock-panel:alerts:rules:v1` / `:hits:v1` | `alerts.ts` | — | 过滤 + ≤200 |
| `dsh-stock-panel:events:v1` | `event-stream.ts` | — | 去重 + ≤500 |
| `dsh-stock-panel:dayrun:v1` | `dayrun.ts` | — | 过滤 + ≤60 日 |
| `dsh-stock-panel:positions:v1` / `:tradelog:v1` | `positions.ts` | — | ⚠️ 仅 `Array.isArray` |
| `stock-info-bar-fields` | `stock-info-fields.ts` | ⚠️ 无版本 | 非空 |

问题：3 种命名空间、只有 2 个键有迁移、`removeItem` 全仓只出现 1 次（无「清空/重置」）、
无导出导入、清缓存即失忆、跨设备不同步。

### 5.2 目标：host 侧持久化（DSH 存储子系统）⏳ A1

DSH 的 `dsh-base` 已挂载存储栈（**本 profile 直接可用，无需额外安装**）：

| 行 | 包 | 作用 |
| --- | --- | --- |
| `storage` | `@deepseek-ai/dsh-storage` | 枢纽 `ctx.storage`（后端注册 + 数据形式挂载） |
| `storage-json` | `@deepseek-ai/dsh-storage-json` | json 后端，root = `$DSH_HOME/storages` |
| `storage-domain` | `@deepseek-ai/dsh-storage-domain` | 领域数据形式 `ctx.storageDomain`（backend: json） |

**用法**（host 半，`src/host/state.ts`，✅ 已实现）：

```ts
// ① 不写进静态 inject —— storageDomain 是可选增强（同 llm 立场）：
//    缺服务时只降级为 localStorage，不该让整个插件不激活（行情链路必须照常）。
// ② 但也**不能**在 apply 时读一次就定生死 —— 见下方时序教训。
initStateDomain(ctx)                       // 只记 ctx，不在启动时判定
ctx.inject(['storageDomain'], () => {      // cordis 声明式注入：服务出现/变化时回调
  initStateDomain(ctx)                     // 幂等；服务消失时 cordis 会重跑
})
registerStateBridge(ws)                    // GET/POST /api/stock-panel/state
```

**⚠️ 时序教训（真机实测踩到，已修）**：cordis 的插件激活是**服务可用性驱动**的，
`storage-domain` 的挂载时刻**不保证早于**本插件的 `apply`。旧实现在 `apply` 里
`getOwnPropertySafe(ctx,'storageDomain')` 读一次，读不到就把「不可用」**永久缓存** ——
结果运行实例一直返回 `available:false`（原因：`ctx.storageDomain 不可用`），而 dsh-base
明明挂了存储栈。现在双保险：`ctx.inject` 声明 + **请求路径惰性重试**（`ensureStateReady()`，
不缓存否定结论）。回归用例见 `smoke-host-state.mjs` 的 `[6][7][8]`（服务晚到 / 挂在 hub 上 /
声明式注入三条路径）。
辅助解析：`ctx.storageDomain`，兜底 `ctx.storage.domain`（文档：两者是同一个对象）。

**两条硬约束（实测确认，踩过）**：
1. 领域名/表名必须匹配 `UNIT_NAME_RE = ^[a-z][a-z0-9_]*$` —— **不能有连字符**，
   所以领域名是 `stock_panel`（不是 `stock-panel`）；
2. 公开 npm 上的 `@deepseek-ai/dsh-storage-domain` 只有 `0.0.1-rc.1`，而宿主跑 `0.1.2-rc.1`
   —— **不 import 它**。`defineDomain` 只是「校验 + 身份函数」，运行期契约实测只有三处：
   `descriptorOf(spec)`（读 name/version/tables 键/hasGlobal/layout）、
   `spec.tables[t].valueSchema.parse(raw)`、`spec.global.schema.parse(stored)` / `initial`。
   因此**手搓 spec** + 一个只需 `parse`/`safeParse` 的极简 schema，零依赖、不与宿主 zod 副本耦合。

**领域形态**：`name: 'stock_panel'`、`version: 1`（**固定**）、`layout: 'per-record'`
（事件流追加频繁，逐记录文档避免「每次写重发整个 unit」）、
`invalidRecords: 'backup-and-skip'`（单条脏记录被移开并跳过，**不让整域打不开**）、
`global = { schemaVersion, migratedFromLocalStorage, updatedAt }`。

**版本与 schema 演进策略**（前两条是**用宿主真实存储栈跑出来的**，见 §9 校验脚本）：

1. `version` **固定为 1**，绝不因字段变更上调。⚠️ 实测语义与直觉不同：per-record 布局下
   每条记录落盘为 `{ "version": N, "record": {...} }`，**version 不一致不会报错，而是把旧记录静默丢弃**
   （打开成功、记录数为 0）——静默丢数据比报错更糟，所以这条是硬要求；
2. 真要升版本，必须同时声明 `compatibleVersions: [旧版本…]`（官方逃生口，实测有效：
   用 `version: 2 + compatibleVersions: [1]` 打开仍能读到 version=1 的记录）；
3. 日常演进用 global 的 `schemaVersion` + 启动迁移遍历（版本保持不变）；
4. 记录校验只做**介质边界最小校验**（必须是 JSON 对象 + 关键字段是字符串），
   语义校验留在各 store 载入时 —— 严 schema 会让「加字段」变成「老记录被拒 → 整域打不开」；
5. 破坏性变更 = 换**表名**（如 `review_v2`），启动时把老表读出来重写后删除；
6. **记录键必须编码**：per-record 布局把键当文件名，要求匹配 `^[a-zA-Z0-9_-]+$`，不匹配直接抛错。
   我们的自然键含 `:` 与中文（事件流的 `SH-600519-10:03-封涨停板`）→ host 层用
   `encodeStateKey()` 做 base64url 编解码，对客户端完全透明。

**8 张表**（清单单一来源 `src/lib/state-tables.ts`，host/client 共用）：
`watchlist`（自选）、`review`（复盘存档，键=交易日）、`dayrun`（当日运行/Q1-Q3/竞价判定）、
`positions`（持仓）、`tradelog`（交易日志）、`verdicts`（AI 结论，键=`day:SYMBOL`）、
`events`（事件流，键=事件指纹）、`viewed`（看过的个股，A4 左栏「个股」分组的数据源）。

**前端接入（✅ 已实现，`src/lib/host-state.ts`；各 store 的对外 API 零改动）**：

```
浏览器                                            host 半
──────                                           ──────
启动（client.ts 的 apply）：GET /api/stock-panel/state
  → 域里有记录 → 覆盖 localStorage 镜像 + 记下指纹
  → 域里该表为空而本地有数据 → 一次性首迁上传（POST {records}）
  → 通知各 store 重载（onHostHydrated）        ─▶ 域是权威，镜像只是缓存
读：  同步内存读（沿用 getWatchlist() 等原 API，UI 代码零改动）
写：  ① 内存立即更新 + notify（保持同步语义）
      ② localStorage 镜像（离线可读）
      ③ syncTable(表, 值)：与上次指纹**差量**比对
         → POST {table, records?, deletes?}      ─▶ domain.table(t).put/delete
降级：路由 503 / 无 storageDomain / 网络错 → 只写 localStorage；
      底栏显示「持久化：本地」+ 悬浮给出原因（`hostStateInfo()`）
```

- **差量同步**：按表维护 `记录键 → JSON 指纹`；只推新增/变化/删除。事件流（上限 500 条）
  每 30s 有一次捕获，全量重推等于每轮 500 个请求 —— 差量后通常只有几条。
  推送失败会把指纹回滚，下一轮重试仍带上这批差异。
- **写入形状**：`state-tables.ts` 的 `shape`（`array` = 逐条拆记录；`keyed` = 本就是键值表，
  如 AI 结论存档），记录键由 `keyOfRecord()` 从记录自身推导（复用各 store 的自然键）。
- **首次迁移**：域为空 + 本地有数据 → 上传并置 `global.migratedFromLocalStorage=true`。
- **仍在 localStorage**：UI 偏好与信息条列配置（「这台机器的界面状态」，不属于跨日资产）。
- **已知限制**：`domain/changed` 只在本进程内；多标签页/多设备以 host 为权威但**无实时推送**
  （同机多标签各自持有内存态，最后写入者胜）。跨标签一致性留待后续（可选：SSE 推 `domain/changed`）。
- **收益**：数据随 DSH 家目录（`$DSH_HOME/storages`）存活，清缓存/换设备不失忆；
  为「复盘校准」「自挖概念命名缓存」这类跨日资产提供可靠底座。
- **离线门禁**：`scripts/smoke-host-state.mjs`（host 半：路由 / spec 契约 / 读写闭环 / 降级）
  与 `smoke-client-view.mjs` 的 `[3b]`（客户端降级路径）都已进 CI。

---

## 6. AI 契约 ✅

| 环节 | 位置 | 约定 |
| --- | --- | --- |
| 路由解析 | `host-ai.ts` | 优先宿主的 `ctx.agentDefaultModel.currentSelection()`，插件侧兜底；无 LLM → `{available:false, reason}` |
| prompt + 解析 | `lib/ai-contract.ts`（host/client 共用） | 任务化：`stock-verdict` / `review-plan` / `scout-rank`；模型只回一个 JSON；解析做去围栏/配平/夹取；**原文永不丢** |
| 上下文压缩 | `lib/ai.ts` | 报价 + 近 90 根日 K + 资金流 + 广度 + 指数 → 小 JSON（四舍五入 + 截尾），>24KB 先自愈裁剪 |
| 自愈重试 | `host-ai.ts` | `maxTokens` 是 reasoning+正文共享预算（≥6000）；`finish=max-tokens` 或超限 → 裁一档重试（≤3 调用 / ≤3 裁剪，分开计数），`meta.shrunk` 回传并由 UI 提示 |
| 通道 B | `client.ts` slot props | `inputActions.setDraft + submit()` 注入当前对话；输入框有草稿时置灰（不覆盖用户内容） |
| 落点 | `panel/AiPanel.tsx` 等 | 只读参考区 + 逐条采纳；**绝不静默改写用户草稿** |

⚠️ 已知缺陷：`panel/use-ai.ts` 的 AbortController 是死代码（signal 没有传进 `ai.ts` 的
两参包装），AI 请求无法中断（ROADMAP B6）。

---

## 7. 设计立场（不可违背）

1. **时段驱动**：界面回答「现在该干什么」，而不是「有哪些功能」；跨过 9:15 / 14:30 / 15:10 自动切入口，用户手动干预后本会话不再跟随。
2. **主区四层信息**：① 环境 ② 主线 ③ 标的 ④ 动作——归不进这四层的进工具页（`PRODUCT-DESIGN.md` §6c）。
3. **AI 不覆盖用户草稿**：排序/命名/研判都是只读参考，采纳必须用户点一下。
4. **不假装精度**：实算 vs 近似的口径必须标在界面上（复盘盘眼的琥珀小字是范例）；裁剪/降级要显式告知。
5. **阈值即初值**：所有方法论阈值（温度分档、强度判定、凯利分数）都是可配置初值 + 自校准，禁止当常数。
6. **不引入重依赖**：client 半单模块且体积只剩 2.9% 余量——新增依赖必须在 PR 说明体积成本。

---

## 8. 诊断与可观测

| 手段 | 位置 |
| --- | --- |
| `window.__STOCK_PANEL__`（version / viewRegistered / transport / endpoints / listTools / callTool / watchlist） | `src/client.ts` |
| `GET /api/stock-panel/ai` | AI 可用性与解析出的路由 |
| host 日志 | `[stock-panel] embedded TDX bridge registered at /api/stock-panel/call`、AI 可用性行 |
| 冒烟脚本 | `scripts/smoke-{client-view,host-state,ai-contract}.mjs`（离线、已进 CI）+ `scripts/smoke-embedded.mjs`（需真机行情） |
| **实机验收** | `node scripts/verify-live.mjs [baseUrl]`：对**运行中**的 dsh web 做端到端验收 —— ① host 半新鲜度（运行 buildId vs 源码 buildId，不等即提示重启）② 持久化 `available` + 8 表 + 服务来源 ③ 往 `viewed` 写 canary → 读回 → 删除（真域真介质的写读删闭环）④ AI/行情信息项。host 半是进程内加载的，改完必须重启；client 半只需硬刷新 |
| **真实存储栈校验** | `node scripts/verify-state-domain.mjs`：用宿主安装的 cordis + dsh-storage + storage-json + storage-domain **真跑一遍**手搓 spec（16 项断言：open 接受 / 8 表 / 键编码必要性 / 落盘持久性 / version 语义 / compatibleVersions 逃生口）。不进 CI（CI 无 DSH 安装），改契约后必跑 |
| ⏳ 待补 | 无（B5-③ 诊断面板已实现：`src/panel/DiagnosticsPanel.tsx`，底栏 🩺 按钮 —— 构建一致性 / 持久化 / 数据链路 / 缓存底账 / AI 与 HIST，五类状态一处可查） |

---

## 9. 已知架构债（对应 ROADMAP 编号）

| # | 债 | 状态 | 编号 |
| --- | --- | --- | --- |
| 1 | ladder 无缓存 + 3 处重算 | ✅ 已修（30s 共享缓存 + in-flight 去重） | B3 |
| 2 | 双缓存（`cache.ts` 与 `market.ts`） | ✅ 已修（`swrFetch` 收口，全仓唯一数据缓存） | B5 |
| 3 | 收起栏 / 后台标签页不停轮询 | ✅ 已修（`document.hidden` 跳过 + 左栏收起 `enabled:false`） | B3 |
| 4 | `cache.ts` 的 `refreshInterval` 变更不生效 | ✅ 已修（deps 补项） | B3 |
| 5 | AI 请求不可中断（signal 未透传） | ✅ 已修（三处包装透传 signal） | B6 |
| 6 | HTTP-only 端点残留在 embedded 部署（关键价位） | 🟡 已**显式提示不可用**并给出替代做法（模型价位线）；真正的 TS 端价位计算仍未做 | B2 |
| 7 | 存储无抽象、无重置/导出 | 🟡 已迁 host 领域（A1）；**导出/导入/重置**仍待做 | A1 |
| 8 | 样式双轨（7 个新文件用 `--dc-*`，28 个旧文件 1,000+ 处硬编码色 + 64 条暗色重映射） | ⏳ 未动 | A5 |
| 9 | 无 ESLint、无单测；`tsc` 只看 `src`（`noUnusedLocals:false`） | ⏳ 未动（离线冒烟已从 2 个增至 3 个） | B4 |
| 10 | client.js 体积 814KB / 护栏 840KB（单模块不可拆分） | ⏳ 需减重至 ≤700KB | B2 |
| 9 | 无 ESLint、无单测；`tsc` 只看 `src`（`noUnusedLocals:false`） | 死代码与 hook 依赖错误隐形 | B4 |
