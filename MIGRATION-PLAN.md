# dsh-stock-panel 迁移实施总方案（MIGRATION-PLAN）

> 把 `tickflow-stock-panel`（原 React SPA + FastAPI 后端）的功能与图表，
> 逐步迁移进 **DSH Web 插件 `frontend-dsh`（@lisonevf/dsh-stock-panel）**。
> 核心目标：**更快、更轻量**——去掉独立部署链路，插件形态直连 MCP 行情源。
>
> 版本基线：frontend-dsh 0.4.0 · M0–M6 与 N1–N7 已完成 · 本文覆盖 M7 至发布。

---

## 1. 目标与成功标准

### 1.1 迁移目标

| 维度 | 原架构（待淘汰） | DSH 插件（目标） |
| --- | --- | --- |
| 形态 | 独立 React SPA + FastAPI + Polars/vectorbt | DSH Web GUI 主布局「stock」第四列插件 |
| 数据链路 | 浏览器 → FastAPI → OpenTDX/本地 Parquet | 浏览器 → host 半桥接 → MCP 服务器（opentdx 3.4.0，15 工具） |
| AI/对话 | 独立 LLM 配置 | 复用 DSH 自身 LLM 能力（可选阶段） |
| 自选/设置 | 后端文件 | 浏览器 localStorage |
| 部署 | Docker 双容器/整站 | 一个 npm 包 + DSH |

### 1.2 可量化成功标准（验收锚点）

- **体积**：主 bundle ≤ 400KB（现状 client.js 361KB）；单页功能按需裁剪，不引入 echarts/framer-motion 等重依赖。
- **首屏**：stock 列 300ms 内可见骨架，数据 1s 内出首屏（MCP 局域网 RTT ~ms 级）。
- **轮询预算**：市场页全 A 拉取 ≤1 次/20s；自选 ≤60 只/12s；页面隐藏时自动暂停。
- **功能覆盖**：原 35 个页面/组件按下表 P0/P1/P2 分级迁移，P0 全部完成、P1 ≥80%、P2 显式标记为"后端可选"。
- **可用性**：纯 MCP 模式 0 后端依赖可跑通全部 P0/P1；后端存在时（`__DSH_DATA_SOURCE__='http'`）恢复 B 轨功能。
- **质量门禁**：`pnpm build` 通过；改动文件 `tsc --noEmit` 0 错误；关键数据流有协议冒烟测试。

---

## 2. 现状盘点（M0–M5 已完成）

| 里程碑 | 内容 | 状态 |
| --- | --- | --- |
| M0 | 插件骨架 + layout patch（stock 第四列）+ host 半自愈 | ✅ |
| M1 | 日 K / 分时图 + api.ts（lightweight-charts） | ✅ |
| M2 | 信息条 / 关键价位 / 指标自定义 | ✅ |
| M3 | 标的搜索 + 自选管理 | ✅ |
| M4 | AI 四维分析 + 报告历史 + Markdown 渲染 | ✅ |
| M5 | **市场总览 + 指数 + 自选实时行情**（Tab 壳；SSE 修复；全A/统计/搜索/自选本地化） | ✅ |

**M5 遗留技术债（后续批次处理）**
- `src/lib/mcp.ts` SSE 解析已修；host 装配（`main` + `inject: ['webServer']`）2026-09-05 实证修复，
  桥接路由/工具透传/client bundle 均已在临时实例无头验证通过；**剩余 = 主 GUI 重启后的浏览器点击验收**（§11）。
- 关键价位 / AI 分析仍走 HTTP 后端 → 见 §6 B 轨（levels.py 纯函数可移植 TS）。
- `Watchlist.tsx`（旧 M3 组件，走后端）→ ✅ 已随 0.4.0 基线删除（被 `WatchlistPage` 取代）。
- `IntradayChart.tsx`（M1 HTTP 版个股分时）→ ✅ M9/0.6.0 已由 `StockIntraday.tsx`（纯 MCP）取代接入。

---

## 3. 数据源能力矩阵（决定每批可行性的依据）

MCP 工具（opentdx 3.4.0，15 个）与功能映射：

| 工具 | 数据 | 支撑功能 |
| --- | --- | --- |
| `quote` | 实时报价（含涨停/跌停价、量比、换手、PE） | 指数、自选、榜单、监控价格规则 |
| `kline` | 日/周/月/分钟 K（含指数） | 个股图、连板统计、客户端指标 |
| `tick_chart` | 分时（含均价） | 分时图（股票/指数） |
| `transaction` | 逐笔成交 | 盘口明细（个股页增强） |
| `auction` | 集合竞价 9:15-9:25 | 竞价异动（可选） |
| `unusual` | 市场异动（封板/跌停/拉升…） | 涨停梯队、异动速递、监控 |
| `market_monitor` | 主力监控 | 异动/监控 |
| `board_members` | 板块成分行情；`"A"`=全 A 5566 只 | 市场广度、榜单、板块成分、轻量选股快照 |
| `belong_board` | 个股所属板块 | 板块热度聚合（当日活跃股反推） |
| `capital_flow` | 当日/5 日资金流 | 个股页资金面板（P1） |
| `symbol_info` | 个股简况 | 信息条补充 |
| `server_info` | 交易日/时段 | 全局时钟、开盘判定 |
| `goods_*` | 期货/港股/美股 | 扩展市场页（P2，量小） |

**能力缺口（无法纯客户端实现 → 分级处置）：**
- ❌ 无"板块列表/成分全量"枚举工具 → 板块热度用 `belong_board` 反推（P1-lite）。
- ❌ 无全市场多标的批量 K 线 → 全 A 逐只指标扫描不可行 → 轻量选股只扫实时快照。
- ❌ 无财务报表 → Financials 页 P2 降级为行情内嵌估值字段。
- ❌ 无回测/策略引擎 → Backtest 标记为"需后端"B 轨；可做单标的 MA 策略 TS 极简版（P2）。
- ❌ 无搜索工具 → 已用全 A 索引本地搜索（M5 完成）。

---

## 4. 总体架构（演进方向）

```
DSH Web GUI 主布局 第四列 stock
└─ PanelApp（Tab 壳）                       src/panel/PanelApp.tsx
   ├─ 市场 · 指数 · 自选 · 个股（M5 已有）    src/pages/*
   └─ M6+ 梯队/板块 · 监控 · 轻量选股 …       src/pages/*（新增 Tab 或子视图）
数据层：
├─ lib/mcp.ts      SSE/JSON-RPC 客户端（已修）
├─ lib/stock-data.ts 工具适配层（数组/rows/对象）
├─ lib/symbol.ts    符号归一（SZ/SH/BJ）
├─ lib/market.ts   全A缓存+统计+搜索（20s TTL）
├─ lib/watchlist-store.ts   localStorage + 订阅
├─ lib/indicators.ts  （M8 新增）客户端指标：MA/EMA/MACD/RSI/KDJ/BOLL/连板计数
├─ lib/alerts.ts    （M7 新增）本地规则引擎 + 记录 + 徽标
└─ lib/levels.ts    （B 轨）levels.py → TS 纯函数移植
B 轨（可选，__DSH_DATA_SOURCE__='http'）：
  关键价位 / AI 四维 / 完整选股 / 回测 → 复用 FastAPI 端点
```

**决策原则**
1. **A 轨优先**：凡 15 工具能支撑的，一律纯 MCP 实现（更快更轻、零部署）。
2. **B 轨保底**：后端强依赖功能做成"检测到后端才启用"，前端结构不删。
3. **图表统一 lightweight-charts**；不引入 ECharts。窄列适配（列宽 200-420px）优先。
4. **一切可缓存必缓存**：全 A 列表 20s、quote 10-15s、kline 按 symbol LRU。

---

## 5. 批次路线图（每批 = 一个可独立验收的里程碑）

> 规模：S(≤2d) / M(3-5d) / L(1-2w)。每批结束必须过 §7 质量门禁并更新 README/MCP-SETUP。

### M6 — 涨停梯队 + 板块热度（P0，规模 M）✅ 已交付（2026-09-05，headless E2E 通过）
- **实现**：「梯队」Tab（`src/pages/LadderPage.tsx`）+ `src/lib/indicators.ts`（countStreak/一字板/
  分板涨跌停规则）+ `src/lib/ladder.ts`（聚合）+ `src/lib/pool.ts`（并发池）+ `belong_board` 适配。
  涨停池改为 A 列表 `close≈buy_price_limit` 精确判定（unusual 仅竞价快照，作辅助）；板块热度剔除
  style 伪板块（保留 概念/行业/地区）；`mcp.ts` 补 15s 请求超时兜底；失败个股保留为"连板待确认"。
- **实测**：42 涨停 → 4板×1（龙版传媒）/2板×4/1板×19；板块榜 人工智能(11) 等；全流程 32s。
- **遗留**：封板率/炸板依赖 unusual 盘中事件（竞价快照无炸板事件，按需展示）；连板窗口 20 根封顶；
  E2E 实测单请求偶发 15s 超时（服务端慢调用），已降级不丢数据。

### M7 — 本地监控中心（P0，规模 M）
- **内容**：新增「监控」Tab（或市场页角标）：
  1. 规则类型：价格突破/跌破（自选+个股，复用 quote 轮询 12s）、市场异动关键词（unusual 流）、主力异动（market_monitor）；
  2. `lib/alerts.ts`：localStorage 规则 + 命中记录（JSONL 形态）+ 去重冷却；命中右下角 Toast（复用 DSH UI 风格）+ Tab 徽标；
  3. 桌面通知（可选 Notification API）；
  4. B 轨：飞书推送走 host 桥接（`ctx.webServer` 已有，加 `/api/stock-panel/push` 路由）——飞书 webhook 浏览器直发有 CORS 限制，必须服务端转发。
- **验收**：自设"跌破 -5%"规则能在下一次轮询命中并弹提醒；重启 DSH 记录仍在。
- **注意**：轮询预算叠加（自选 12s 已存在，规则计算零额外请求）。

### M8 — 轻量选股引擎（P1，规模 L）
- **内容**：新增「选股」Tab：
  1. **快照选股（纯 MCP）**：全 A 一次快照 + 客户端条件：换手/量比/涨跌幅/涨停形态/金额/市值区间 → 即时筛选；
  2. **信号选股（客户端指标）**：`lib/indicators.ts`（MA 金叉/MACD/RSI/BOLL/新高新低）——候选集 = 快照过滤出的 ≤200 只，再并行拉 kline(60-120) 算指标（8 并发，预计 10-30s，带进度条）；
  3. 内置 6-8 个策略卡片（对应原 20 策略的"纯行情可算"子集），策略即配置，可另存本地；
  4. 结果表 + 排序 + 点击跳个股；周期自选（日/周）。
  5. **B 轨**：`__DSH_DATA_SOURCE__='http'` 时可直接切原完整策略引擎接口。
- **验收**：任意字段条件即时出结果；"MA5 上穿 MA20"策略在 ≤30s 出 TOP 列表且与后端策略抽查一致率 ≥80%。
- **前置**：M6 的 indicators.ts 扩展 + 并发调度器（`lib/pool.ts`：并发数/退避/取消）。

### M9 — 个股页增强（P1，规模 M） ✅ 2026-09-06 完成（0.6.0；第 5 项 B 轨 levels 移植除外）
- **内容**：
  1. ✅ 个股分时接入（新组件 `components/StockIntraday.tsx`，纯 MCP `tick_chart`，
     基线日期 = 最近日 K 交易日，收盘后/休市可回看；替代 M1 期 HTTP 版 `IntradayChart`）；
  2. ✅ 日 K 区间切换（近 3 月/6 月/1 年/全部）+ MA5/10/20 开关（`KlineChart` 受控 rows +
     按区间重取；A 股配色红涨绿跌统一）；
  3. ✅ 资金面板：`capital_flow`（当日/5 日主力净流入）—— 已于 N7 接入；
  4. ✅ 逐笔成交：`components/StockTransactions.tsx`（`transaction` 最新 60 条，折叠；
     `bs_flag` 方向与 vol 单位语义**待盘中复验**）；
  5. **B 轨**：关键价位移植 `levels.py` → `lib/levels.ts` 纯函数（未做，仍待办）。
- **验收**：个股页无后端可看图/分时/资金/逐笔（MCP 模式已过冒烟）；价位在 http 源下显示（不变）。

### M10 — 扩展市场 + 系统打磨（P2，规模 S-M）
- **内容**：`goods_quotes/kline`（港股/美股/期货）做成"扩展市场"Tab（表格式 + 迷你图，量小）；
  - server_info 驱动的交易日/开闭市角标；竞价速览（auction，9:15-9:25 窗口）。
- **验收**：TSLA/00700 可看报价与 K 线。

### M11 — 打包发布与治理（P0，规模 S）
- **内容**：
  1. 版本号 0.4.0+ 与 CHANGELOG；`pnpm publish` 到 GitHub Packages（package.json 已配）；
  2. `.github/workflows/ci.yml`：build + tsc(check 清单) + 冒烟（§7.3）；
  3. README 截图（screenshots/ 新目录：M5 四 Tab、M6 梯队…）；
  4. 布局补丁锚点版本化：锚点表收敛到 `src/layout-patch.ts`（`SUPPORTED_UI_LAYOUT_VERSION` 门控 + DSH 升级回归步骤，文档化）；
  5. 轻量化预算护栏：CI 里校验 `lib/client.js ≤ 450KB`，超限告警。
- **验收**：全新机器 `dsh plugin --profile web add @lisonevf/dsh-stock-panel` + 重启 dsh web 即出现面板（零额外修改/配置）。

---

## 6. B 轨（后端可选功能）处置清单

| 原功能 | 处置 | 触发条件 |
| --- | --- | --- |
| 关键价位（9 类） | B1：移植 levels.py → TS 纯函数（优先） | 无（本地算，MCP 可用） |
| AI 四维分析 | B2：保留 HTTP；后续可改 DSH LLM 工具调用 | dataSource='http' |
| 完整 Screener（20 策略+自定义信号） | B3：仅 http；M8 提供轻量版 | dataSource='http' |
| Backtest（vectorbt） | B4：仅 http；UI 内嵌 iframe/链接 | dataSource='http' |
| Monitor 后端 SSE + 飞书 | B5：M7 本地版 + 桥接推送 | 本地版 MCP 可用；飞书需后端桥 |
| Financials 页 | B6：降级为行情估值卡片，不进路线图 | — |
| Data/管道/排程/LLMService/Trading/Branding/Dev/Auth/Onboarding | 不迁移（DSH 已提供对应能力：对话/Auth/LLM） | — |

---

## 7. 工程质量体系

### 7.1 每批标准步骤（模板）
1. **调研**：列出目标功能依赖的数据字段 → 用 §3 矩阵确认工具/参数；不明确的先写协议冒烟脚本实测（禁止凭 schema 猜）。
2. **数据层**：在 `stock-data.ts`/`market.ts` 增加适配函数 + 类型 + 缓存策略。
3. **组件**：先做窄列草稿（≤400px），再谈交互；图表只用 lightweight-charts。
4. **接线**：Tab 或跳转接入 PanelApp；复用 openStock/openIndex 导航。
5. **构建**：`pnpm build`；全量 `tsc --noEmit` 0 错误（0.4.0 起 test/mock 脚手架已删除，不再需要临时 include 清单）。
6. **协议冒烟**：node 直连远端 MCP 跑通新增工具（§7.3 模板）。
7. **真机验收**：重启 dsh web → GUI 过 §5 各批验收清单（首批 M6 必须做，回补 M5 全链路验证）。
8. **文档**：README 路线图 + MCP-SETUP 工具表 + 数据量/轮询预算更新。

### 7.2 代码规范
- 颜色 A 股语义：红涨 `#c74040` / 绿跌 `#2d9b65`；涨跌幅一律百分比数值（`pctText` 带符号）。
- market 数值 0=SZ/1=SH/2=BJ 只在适配层出现一次，UI 只用 `MarketTag`。
- 轮询组件统一模式：`useEffect` 装载 + `setInterval` + 卸载清理；`itemsRef` 存最新依赖；页面不可见时降频或暂停。
- 新增模块必须先写类型（接口在适配层定义），禁止 any 外溢到组件。
- 不新增重依赖；新增依赖需在 PR 注明 gzip 成本。

### 7.3 协议冒烟模板（node 直连，非浏览器）
```js
// 流程固定为: initialize → (capture mcp-session-id) → notifications/initialized → tools/call
// 解析: 按 SSE data: 行收集 JSON；失败回退整体 JSON.parse（与 src/lib/mcp.ts 的 parseMcpBody 一致）
```
每次新增工具调用（board/kline/…）都套此模板验证字段与分页上限。

### 7.4 性能预算护栏（CI 或提交前）
- `lib/client.js` ≤ 450KB（超限 → 提示拆分/降级）。
- 市场页全 A 请求 ≤1 次/20s；单批并行 MCP ≤8 并发。
- 全 A 响应体 ≥2MB 时不落 localStorage（只留内存缓存）。

---

## 8. 风险与对策

| # | 风险 | 影响 | 对策 |
| --- | --- | --- | --- |
| 1 | MCP 服务器工具行为与 schema 不符（如 AMOUNT 排序报错、000016 无数据） | 功能失败 | 每工具先冒烟实测；代码容错（空/错误 → 优雅降级）；文档记录已验证清单 |
| 2 | 全 A 5566 只 × 多次调用 = 带宽/限流 | 页面卡、被限流 | 20s TTL 缓存；页面隐藏暂停；失败退避重试（1s/5s/30s） |
| 3 | DSH 升级覆盖 ui-layout patch | stock 列消失 | 已有自愈脚本；维护锚点 JSON；升级回归步骤文档化（M11） |
| 4 | SSE 流式/长连接在浏览器端被代理中断 | 数据断 | 轮询为主架构，SSE 仅 AI 流；断线自动重连 |
| 5 | 窄列（200-420px）放不下原版复杂页 | UI 劣化 | 每个页面先出窄列草稿；表格列数 ≤6；图表高 ≤360 |
| 6 | 后端强依赖功能迁不动 | 覆盖不达标 | §6 B 轨显式分级；验收指标按 P0/P1/P2 而非 100% |
| 7 | 浏览器直接请求第三方（飞书/Feishu）CORS | 推送失败 | 一律走 host 桥接服务端转发 |
| 8 | `src/lib` 曾被 .gitignore 吞掉 | 代码丢失 | 已锚定 `/lib/`；提交前 `git add -f src/lib` 核对；CI 校验关键文件在库 |

---

## 9. 版本与发布节奏

| 版本 | 内容 | 建议 |
| --- | --- | --- |
| 0.3.5→0.4.0 | M5 交付（当前工作区） | 先提交+发布，建立基线 |
| 0.5.0 | M6 梯队/板块热度 | 每批一版 |
| 0.6.0 | M7 本地监控 | |
| 0.7.0 | M8 轻量选股 | |
| 0.8.0 | M9 个股增强 | |
| 0.9.0 | M10 扩展市场 | |
| 1.0.0 | M11 治理+CI+文档 | 首个稳定发布 |

- 提交纪律：每批一次原子提交（feat(dsh): M6 …），文档与代码同批。
- 发布：`pnpm publish --registry=https://npm.pkg.github.com`（已配 script）。

---

## 10. 下一步行动（立即）

1. **M6 启动**（推荐）：先做 M5 遗留清理 + bridge 真机验收 → 涨停池/连板统计（indicators 起步）→ 板块热度反推。
2. **补 CI 冒烟**：把 §7.3 协议冒烟固化为仓库脚本 `scripts/smoke-mcp.mjs`（可设 `--endpoint`），纳入 M6 批次。
3. **数据护栏**：提交前跑一遍性能预算检查（§7.4）。

---

## 11. 真机加载故障排查（2026-09-05 实证）

### 11.1 症状

`/api/stock-panel/mcp` 桥接路由 404；面板从未出现在 stock 列。
根因：**插件 host 半在 DSH 启动时根本没被加载**（不是代码问题，是装配问题）。

### 11.2 根因（两条，均已修复）

1. **package.json 缺 `main`**：loader 把 patch insert 的 entry 解析成 fiber 时
   需要 `main`（对照能正常加载的 `dsh-plugin-dev-kb`：`main: lib/index.js`）。
   → 已在 `package.json` 增加 `"main": "./lib/index.js"`。
2. **host entry 未声明 `inject`**：kb 插件的 entry 导出
   `name / inject: ['skills'] / apply`；我们的 `lib/index.js` 只导出了 `apply`，
   导致 `ctx.webServer` 从不注入 → `registerMcpBridge` 静默跳过（
   `getOwnPropertySafe` 拿到 undefined）。
   → 已在 `src/index.ts` 增加 `export const name` 与 `export const inject = ['webServer']`。

### 11.3 插件装配机制（速查）

- profile 安装：`~/.dsh/profiles/web/node_modules/@lisonevf/dsh-stock-panel`
  （真实目录；`package.json`/`cordis.patch.yml` 需手动同步或保持硬链接，`lib/` 每构建后拷贝）。
- profile bundles 清单：`~/.dsh/profiles/web/package.json` 的 `dsh.profile.bundles`
  （已含本包）；每个 bundle 包内 `cordis.patch.yml`（`dsh.bundle.patch`）在启动时自动应用。
- 历史：旧版曾在 `profiles/web/cordis.patch.yml` 直接 insert `stock-panel`，
  2026-09-02 被改名 `.disabled-*` 停用 → 期间所有"离线开发"（mock/test）都由此而来。
- ui-layout 布局补丁（stock 列）已打在 bundle 文件上（4 个 marker 齐全），与插件加载无关。

### 11.4 验证（headless，免浏览器）

```powershell
# 1) 桥接路由：应 200 + SSE + mcp-session-id
# POST http://127.0.0.1:<port>/api/stock-panel/mcp  body: initialize(...)  (Accept: application/json, text/event-stream)
# 2) 工具列表透传：tools/list 应返回 15 个 opentdx 工具（8163B）
# 3) 客户端 bundle：GET /plugins/@lisonevf/dsh-stock-panel/client.js
#    应 200，且内容含 市场总览 / parseMcpBody / __STOCK_PANEL__ 等 M5 marker
```

### 11.5 发布前同步清单（改代码 → 上线）

1. `pnpm build`（tsdown host + client + dts）
2. 同步到 profile 安装副本：
   `package.json`（非硬链接，必须拷）· `lib/index.js|map` · `lib/client.js|map` · `lib/types/*`
   （`cordis.patch.yml` 是硬链接，无需拷）
3. 重启 `dsh web`（bundle rev 启动时重算，必须重启才生效）
4. 浏览器硬刷新（Ctrl+Shift+R）

> 待办：把步骤 1-2 固化为 `scripts/sync-profile.mjs`（读 `DSH_HOME`），纳入 M11。

