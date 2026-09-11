> ## ⚠️ 已归档（2026-09-12）——结论全部过期，仅作历史溯源
>
> 本文写于 2026-09-06，其「差距清单」在当时成立，但**现在几乎全部已交付或被推翻**：
> A1（strength 未接入）已接入复盘页；A2（温度计近似）复盘侧已实算；
> B1–B6（M7–M11 未做）全部完成；C3/C4/C5 已修或已清理。
> 版本号（0.4.0）、体积数字（477.6KB / 450KB 护栏）、Tab 结构（7 Tab）均与现状不符。
> 现行文档：`README.md` + `docs/ROADMAP.md`。

# 现状全面梳理与后续开发工作（2026-09-06 周日盘后梳理）

> 本次梳理依据：README.md（M0–M6/N1–N7 交付记录 + 2026-09-06 真机验收）、
> MIGRATION-PLAN.md（M7–M11 路线图）、PRODUCT-DESIGN.md（N1–N7 批次与验收锚点）、
> 代码接线核对（src/ 下 grep/read 实证）、lib/ 构建产物与 git 状态。
> 结论先行：**功能面 N1–N7 已全部完成并真机验收；当前真正的后续工作 =
> ① 基线未固化（整批 N 系列 + 6 篇文档均未提交）② 方法论闭环缺「昨日快照实算 + 强度接入」两块
> ③ MIGRATION-PLAN 路线图 M7–M11 尚未启动 ④ 一批卫生/性能债 ⑤ 交易日盘中复验（被行情源阻塞）。**

> **执行进展（2026-09-06 当日完成）**：
> - ✅ **W0**（0.4.0 基线，commit `6eb5e42`）：全量提交 + 清理（test/mock/旧组件/echarts 移除、
>   api.ts dataSource 翻转修复、KlineChart 受控 rows、vite/css 类型修复）；全量 `tsc --noEmit` 0 错误、`pnpm build` 过。
> - ✅ **W2**（复盘温度计实算）：`review-store` v3（`limitUpPool` 建档 + v2 自动迁移 +
>   `getPrevSnapshot`）；新纯函数库 `lib/review-metrics.ts`（实算 晋级率/炸板率/首板溢价）；
>   ReviewPage 盘眼口径标注琥珀小字；事件清单按当日过滤（修复跨日累积污染）。
> - ✅ **W1**（N3 复盘引用面）：复盘页「强度差分 · 观察池」（今日池 ∪ 上一交易日池 ∪ 板块代表 ≤120，
>   真强/惯性/转弱/弱转强徽标 + Δ3/量比悬浮）与「低位首板候选」列表 + 一键加入预期清单。
> - ✅ **W3**（M9 个股增强，0.6.0）：个股页图表卡 日K（近3月/6月/1年/全部 区间 + MA 开关，A 股配色）
>   ｜ 分时（`StockIntraday`，tick_chart，收盘/休市可回看历史交易日）+ 逐笔成交折叠面板
>   （`StockTransactions`，transaction；bs_flag 方向/vol 单位待盘中复验）。
>   同时修复**数据层严重缺陷**：`stock-data.ts` `toArray` 对 callToolJson 已解析数组二次
>   JSON.parse 致整层静默空返回（晚行情源恢复后真机冒烟复现并修复，
>   kline/board_members/transaction/tick_chart/unusual/quote 实测返回正常）。
> - ✅ **W4**（M7 本地监控/告警，0.7.0）：`lib/alerts.ts` 规则引擎（价格突破跌破/涨跌幅/异动关键词）
>   + 命中记录 localStorage；`AlertWatcher` 常驻 PanelApp 根（12s 轮询 price/pct 规则标的 ≤10 +
>   增量扫事件流关键词）；「监控」第 8 Tab（规则管理/命中列表）+ 未读徽标 + Toast 浮层；
>   规则判定 × 真实行情/事件冒烟命中正确。飞书推送（B 轨）未做。
> - ✅ **W5**（M8 轻量选股，0.8.0）：`lib/screener.ts`（全 A 快照条件筛选/6 预设策略/客户端信号
>   MA5 上穿 MA20·放量上穿 MA60，detectSignal 纯函数 + runSignalOnCandidates pool≤8 带进度）
>   + `pages/ScoutPage.tsx`「选股」Tab（结果行点开个股/信号命中高亮徽标）；
>   真实数据冒烟：全 A 5556 只、6 预设命中 11–151、信号管线跑通。
> - ✅ **W6**（M10 扩展市场，0.9.0）：`stock-data` goods 适配器（quote/kline/varieties）+
>   `pages/GlobalPage.tsx`「外盘」Tab（美股/港股预设报价+日K，quote 缺失回退 K 线自算；
>   期货多市场异动快览）；实测 HK quote/K、US/HK kline、varieties 均正常（网关侧美股 quote 空，
>   页面已回退）。
> - ✅ **W7**（M11 打包发布治理，1.0.0）：`scripts/sync-profile.mjs`（读 DSH_HOME，file:/link: 装即
>   跳过）、`scripts/check-bundle-size.mjs`（client.js 护栏 600KB，当前未压缩 ≈575KB）、
>   `.github/workflows/ci.yml`（install→prepare build→tsc→护栏）；README §打包发布与治理。
>   待办：registry `pnpm publish` 执行、README screenshots/、CHANGELOG。
> - ✅ **W8**（对话行情工具 · AI 零后端，1.1.0）：host 半注册对话工具 stock_quote / stock_kline /
>   stock_tick / stock_unusual（`src/host-data.ts` 网关→远端 MCP 双路径直连 + `src/host-tools.ts`），
>   当前对话助手可直接取数做四维分析；个股页 AI 区块改「对话联动 · 复制指令」；
>   FastAPI B2 依赖退役。host 取数双路径冒烟通过（重启 dsh web 后即可在对话调用）。
> - ⏳ 待交易日（周一盘中）复验：实算数值跨日回归、强度差分真实行情表现、逐笔 bs_flag/vol 单位、
>   事件捕获口径、监控命中 Toast/徽标交互与事件关键词盘中增量。

---

## 1. 现状核对（证据在列）

| 维度 | 状态 | 证据 |
| --- | --- | --- |
| 形态 | DSH Web 插件 · 官方 `conversation.view` 视图标签页「A股工作台」（v1.2；无宿主补丁） | README §注入方案；lib/index.js + lib/client.js 已构建 |
| Tab 壳 | **市场 · 梯队 · 指数 · 自选 · 个股 · 作战 · 复盘** 7 Tab | `src/panel/PanelApp.tsx` |
| M0–M6 | ✅ 完成（K 线/信息条/搜索/自选/AI/市场/指数/梯队/板块热度） | README §迁移路线 |
| N1–N7 | ✅ 代码完成 + 构建通过 + 2026-09-06 真机 GUI 验收（复盘/作战/个股按用户流程走查） | README §方法论批次；USER-GUIDE.md |
| 复盘 | 盘眼/预期清单 ≤5/存档按日覆盖/保留 60 日 | `lib/review-store.ts` + `pages/ReviewPage.tsx` |
| 作战 | 时段标签/温度计/局势/板块脉冲/事件流(增量落盘)/竞价雷达/持仓决策台 | `pages/WarPage.tsx` 全量接线 |
| 个股增强 | 信息条/日K/竞价回顾/资金面板（当日+5日）已挂载 | `pages/StockDetailPage.tsx` L256-262 |
| 数据链路 | 纯 MCP（192.168.31.196:8007，opentdx 3.4.0）+ 会话失效自动重建 + 15s 超时 + structuredContent 兜底 | `lib/mcp.ts`(11:11 最新)、`lib/stock-data.ts` |
| 构建产物 | lib/ 与 src/ 同步（今日 11:11 构建）；**client.js 477.6 KB > 450 KB 预算护栏** | lib/ 时间戳与大小 |
| git | **44 个未跟踪 + 11 个已改未提交**；历史仅 2 个 commit（init / rename）→ 无 0.4.0 基线 | `git status` |
| 数据源实时性 | 周日休市：server_info 空返回、A 股工具空数据（与 README 2026-09-06 记录一致）；扩展市场 HK/US 正常 | 本日 MCP 实测 |

---

## 2. 差距与负债清单

### A. 方法论闭环的半成品（复盘闭环的「最后一公里」，全部可离线开发）
| # | 缺口 | 代码证据 |
| --- | --- | --- |
| A1 | **N3 strength.ts 未接入任何页面**：3 日强度差分 / 真强·惯性分类 / 低位首板候选列表写好未用（README 亦注明「引用面待接」） | 全 src 无 `@/lib/strength` import（WarPage/ReviewPage 导入清单已核对） |
| A2 | **N5 温度计输入仍是近似初值**：promoteRate / brokenRate / firstBoardPremium 无法实算，因为 ReviewSnapshot **未存档「昨日涨停池/首板池」** | `ReviewPage.tsx` L108 注释；`review-store.ts` ReviewSnapshot 字段仅 breadth/regime/mainLine/expectations/notable |
| A3 | 竞价对照矩阵的「弱转强/证伪」质量依赖 A2 的昨日快照；`auction.unmatched` 正负、matched 单位、涨停价对齐**未冒烟复验** | PRODUCT-DESIGN §2.3/§5.1；scripts/smoke-mcp.mjs（阻塞于行情源） |
| A4 | 事件流/板块脉冲/局势/温度计的盘中行为只在休市空态验证过，**交易日盘中未复验** | USER-GUIDE §5 |

### B. MIGRATION-PLAN 路线图未启动项（按原文档编号）
| # | 批次 | 内容 | 现状 |
| --- | --- | --- | --- |
| B1 | M7 | 本地监控/告警中心（alerts.ts 规则引擎 + Toast + Tab 徽标 + 记录持久化） | 未做（无 alerts.ts、无监控 UI） |
| B2 | M8 | 轻量选股（全 A 快照条件筛选 + ≤200 候选客户端指标信号 + 策略卡片） | 未做 |
| B3 | M9 残余 | 个股**分时图未接入**（`IntradayChart.tsx` 已写好但无任何 import）；日 K 区间切换/MA 开关未做；`transaction` 逐笔未接 | 未做 |
| B4 | B 轨 B1 | 关键价位 `levels.py → levels.ts` 纯函数移植未做 → **MCP 模式下关键价位/AI 分析隐藏**（仅 HTTP 后端有） | `api.ts` stockAnalysisLevels 纯 HTTP；StockDetailPage L249 空则隐藏 |
| B5 | M10 | 扩展市场（goods_quotes/kline：HK/US/期货） | 未做（数据源周末可用，成本低） |
| B6 | M11 | 打包发布治理：版本 0.4.0+、CI、`scripts/sync-profile.mjs`、README 截图、体积护栏 | 未做 |

### C. 代码卫生与性能债
| # | 问题 | 证据 | 建议 |
| --- | --- | --- | --- |
| C1 | echarts / echarts-for-react 为死依赖（src 无任何 import） | package.json deps；src grep 0 命中 | 移除，减小安装体积 |
| C2 | client.js 477.6 KB > 450 KB 护栏 | lib/client.js | 先查构成（是否含大第三方/未压缩）再决定裁剪 |
| C3 | `api.ts` MCP 失败会**一次性把全局 dataSource 翻成 'http'**（副作用，之后所有请求改走后端） | api.ts klineDaily/instrumentSearch catch 分支 `dataSource = 'http'` | 改为仅本次调用回退或记录告警，不污染全局态 |
| C4 | StockDetailPage 日 K **双请求**：loadSymbol 拉一次 + KlineChart 内部再拉一次（chartRowsRef 补丁式传参） | StockDetailPage L82-110 vs KlineChart 自加载 | KlineChart 支持受控 rows，去掉重复拉取 |
| C5 | 遗留文件未清理：旧 `Watchlist.tsx`(M3 走后端)、`src/test-*`、`mock-*`、`tmp-old-*.tsx`、`dist/` —— **2026-09-08 已清**：`src/index.css`、`patches/`（bundle 快照 + 备份）、layout-patch 引擎/CLI/回归器 | git untracked / 目录清单 | 剩余项提交基线前删/移，测试脚手另归档 |
| C6 | 文档陈旧：StockDetailPage 头注释仍写「M5 适配版 · 关键价位需后端」等；README 与代码局部不一致 | StockDetailPage L19-34 | 与 W0 一并订正 |

### D. 阻塞项（需交易日/行情源恢复，无法现在做）
1. A 股行情源恢复后跑 `node scripts/smoke-mcp.mjs` 复核 auction 字段语义（unmatched 正负、matched 单位、涨停价对齐）。
2. 交易日盘中：事件流增量捕获/收盘只读、板块脉冲差分、局势归类、温度计实数值、竞价雷达 9:15-9:25 全流程复验。

---

## 3. 后续开发工作（确定的清单，W0–W7）

> 规模沿用 MIGRATION-PLAN：S ≤2d / M 3-5d / L 1-2w。每项含验收锚点；
> 除标注「交易日」者外全部可离线开发 + 本地验收。

| # | 工作 | 内容要点 | 依赖 | 规模 | 验收锚点 | 可否离线 |
| --- | --- | --- | --- | --- | --- | --- |
| W0 | **基线固化 + 卫生清理** | 提交全部 N 系列代码与 6 篇文档（原子提交）；删 C5 遗留、移除 echarts；改 api.ts C3、KlineChart 受控 C4；订正 C6 注释；版本 0.4.0 | — | S | `git status` 干净；`pnpm build` 过；client.js 体积记录 | ✅ |
| W1 | **N3 复盘引用面** | strength.ts 输入 = 今日涨停池+昨日涨停池+自选+主线代表 ≤120；复盘页「强度差分」列（真强/惯性/转弱/弱转强）+「低位首板候选」观察池行 → 一键加入预期清单 | W0（基线） | M | 复盘页对同一候选集：classifyStrength 结果可解释；候选行可一键进预期清单；指标与人工判定（抽样）一致率 ≥80% | ✅ |
| W2 | **昨日快照建档 + N5 实算** | ReviewSnapshot schema v3：补 `limitUpPool`(code/name/streak/board) + `firstBoardPool`；存档时写入；次日复盘实算 promoteRate/brokenRate/firstBoardPremium；旧 v2 数据兼容迁移 | W0 | M | 连续两天存档后温度计输入不再来自近似初值；drivers 显示实算项；v2 旧档读入不崩 | ✅（回归用存档） |
| W3 | **M9 个股增强（分时/区间/逐笔）** | 个股页接入分时（复用 IntradayChart 或 IndexChart 分时模式）；日 K 近 3/6 月/1 年/全部 + MA 开关；transaction 逐笔（折叠） | W0 | M | 个股页无后端可看分时/日K区间；分时与指数页同数据源一致 | ✅（历史分时 query_date） |
| W4 | **M7 本地监控/告警** | alerts.ts（规则=价格突破/跌破 ×自选/个股 + unusual 关键词 + market_monitor）+ 命中记录(JSONL 环形) + Toast + Tab 徽标；0 额外请求（复用轮询结果） | W0 | M | 自设「跌破 -5%」规则在下轮命中并提醒；重启不丢 | 规则引擎 ✅ / 真机交易日复验 |
| W5 | **M8 轻量选股** | 全 A 快照客户端筛选（换手/量比/涨跌幅/金额…）+ 候选 ≤200 拉 kline(60-120) 算 MA 金叉/MACD/RSI/BOLL/新高（pool≤8，进度条）+ 6-8 策略卡片 | W0 | L | 任意条件即时出结果；MA5 上穿 MA20 策略 ≤30s 出 TOP 且与后端抽样一致率 ≥80% | 部分（需盘中数据才有意义） |
| W6 | **M10 扩展市场** | goods_quotes/kline 表格 + 迷你图 Tab（HK/US/期货），量小；周末可用 | W0 | S | TSLA/00700 可看报价与 K 线 | ✅ |
| W7 | **M11 打包发布治理** | 0.4.0 发布到 GitHub Packages；CI(build+tsc+冒烟+体积护栏)；sync-profile.mjs；README 截图；布局补丁升级回归步骤文档化 | W0 先 | S-M | 全新机器 add 即现面板；CI 全绿；client.js ≤450KB（或护栏更新+说明） | ✅ |

**交易日复验清单（D，配合 W1/W2/W4 验收）**：见 §2-D，排入下一个交易日（周一 2026-09-07）盘中执行。

---

## 4. 推荐执行顺序与理由

1. **W0 基线固化先行**：44 未跟踪文件 = 整个 N 系列与全部文档，风险最高（无回滚点）；同时顺手完成 C 类卫生债（10 分钟内可做的事一次性做掉）。
2. **W1 → W2（复盘闭环收口）**：方法论链路「复盘 → 竞价对照 → 盘中 → 复盘」目前差「强度接入 + 昨日实算」这两块纯本地能力，休市期可完整开发并用存档回归验收；周一盘中即可真机复验，价值兑现最快。
3. **W3 个股增强**：与作战/复盘点开核价量的体验直接相关，体量适中，历史分时可离线验证。
4. **W4 M7 监控 → W5 M8 选股**：按 MIGRATION-PLAN 原路线，各自独立可发布。
5. **W6 M10 扩展市场**：量小的热身/填充任务，任何时候可插。
6. **W7 M11 发布治理**：紧随首个带版本基线之后（建议与 W0 合并为 0.4.0 一起发，避免「已提交未发布」再次悬空）。

> 版本建议：W0 = 0.4.0；W1+W2 = 0.5.0（方法论闭环版）；W3/W4/W5/W6 各一版；W7 = 收口（CI/护栏/文档）。
