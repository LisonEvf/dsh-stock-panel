# @lisonevf/dsh-stock-panel

A股量化工作台 —— DSH Web 插件（**主布局第四列**）。

这是 `lisonevf-stock-panel` 的**增量迁移**目标：以 DSH Web 插件的形式，把最重的「K 线图表 + 个股分析」迁进 DeepSeek Harness 的 Web UI，后端保持不变，数据通过 MCP 数据源请求获取。

## 安装（add 即现，零额外修改/配置）

```bash
# 在任意目录执行（registry 发布版）：
dsh plugin --profile web add @lisonevf/dsh-stock-panel
# 或本地开发（file:/link: 均可在插件仓库目录执行）：
dsh plugin --profile web add .        # 相对路径会被锚定到当前目录
```

之后**重启 `dsh web`**（或热加载）——工作台以主布局第四列形式自动出现，与对话区并排。不需要手工登记 settings、不需要手工跑补丁脚本、不需要编辑 profile 的 bundles。

为什么自动：

| 环节 | 机制 |
| --- | --- |
| 加入组合层 | `dsh plugin` 在 `pnpm add` 成功后按安装态自动 reconcile：本包声明 `dsh.bundle.patch` → 自动追加进 profile 的 `dsh.profile.bundles` |
| host 半加载 | 包的 `cordis.patch.yml`（`insert: stock-panel-host`）作为 bundle 层叠加，loader 加载 `lib/index.js` |
| **布局补丁** | `lib/index.js` 的 `apply()` 内**同步**运行内嵌补丁引擎（`src/layout-patch.ts`，已随 lib/ 发布），为 ui-layout 新增 stock 列 |
| browser 半进图 | 本包声明 `dsh.client`（platform: web）+ `exports["./client"]` → 浏览器自动加载 `lib/client.js` 注册 `stock` slot |

## 布局方案（layout-patch 引擎版）

对编译后的 `dsh-client-ui-layout` bundle 做**精确、幂等的字符串替换**：把对话区用
`conversationSeat` 包裹后仍在 center 列，并在最右侧新增 `stock` 列
（`sidebar | center | details | stock`）。工作台列落在 `details` 列**右侧**（即整个页面
的最右边），与对话区**并排、可拖拽调宽**。

```
┌────────┬────────────────┬──────────┬──────────┐
│sidebar │   center       │ details  │  stock   │
│ (可选) │  对话区         │ (原有)   │ (本插件) │
│        │  conversation  │          │ stock    │
│        │                │          │──────────┤
│        │                │          │ 工作台    │
└────────┴────────────────┴──────────┴──────────┘
```

引擎要点（`src/layout-patch.ts`，host 半与 scripts CLI 共用的**单一事实源**）：

- **内嵌随包**：锚点表 + apply/revert/检测逻辑编译进 `lib/index.js`，不再依赖仓库外置的
  `.mjs`/`.json`（此前它们被 `files` 白名单排除，发布物里自愈永远缺席——本次修复的核心）。
- **启动同步自愈**：host `apply()` 内同步执行 `ensureLayoutPatchAtBoot()`（幂等、绝不抛
  异常），确保任何后续 fiber（含浏览器图的组合）读到的都是补丁后的字节；DSH 升级覆盖
  bundle 后会自动补回。
- **锚点验证**：每个替换都要求锚点恰好出现一次，全部通过才写文件；失配即中止，绝不破坏
  宿主 bundle，只告警。
- **版本门控**：锚点表绑定 `SUPPORTED_UI_LAYOUT_VERSION`（当前 `0.1.1-rc.2`）。实际安装
  版本不符时醒目告警（仍尝试，安全），提示更新锚点。
- **可回滚**：pristine 备份写 `$DSH_HOME/patches/layout.backup/client.js.orig`（不是包内，
  安装副本可能在只读 store）。插件卸载/进程退出时若 bundle 处于已打补丁态则自动还原；
  也可手动 `node scripts/patch-layout.mjs --unpatch`。

## 目录

```
frontend-dsh/
├── package.json          # dsh.bundle.patch + dsh.client manifest + tsdown build
├── tsdown.config.ts      # host 半构建（rolldown）
├── cordis.patch.yml      # 把本包注册成 host Cordis entry 的 bundle 层
├── src/
│   ├── index.ts          # host 半入口：同步自愈 + MCP 桥接 + 卸载还原
│   ├── layout-patch.ts   # ★ 布局补丁引擎（锚点表 + apply/revert/版本门控）
│   ├── host-util.ts      # host 半工具（ctx 类型 + MCP 桥接路由）
│   ├── client.ts         # browser 半入口：注册 stock slot + 注入样式
│   ├── host-node-env.d.ts# host 侧最小 Node 类型声明（无 @types/node）
│   ├── pages/  panel/  lib/  components/   # 面板 UI 与数据层（M5/M6）
│   └── index.css.txt     # Tailwind 样式（.txt 后缀绕过 rolldown CSS 管线）
├── scripts/
│   ├── patch-layout.mjs  # 引擎的薄 CLI：--check / --target / --force / --unpatch
│   └── smoke-mcp.mjs     # MCP 协议冒烟（握手/工具表/字段语义核验）
├── STRATEGY-RESEARCH.md  # 策略收集与辨证（WATCH-METHODOLOGY 的证据库）
├── WATCH-METHODOLOGY.md  # 盯盘方法论（量价博弈 · 时空 · T+1 短线 · 凯利仓位）
├── PRODUCT-DESIGN.md     # 以方法论为蓝图的功能/流程设计（N1-N7 批次）
├── USER-GUIDE.md         # ★ 用户使用流程（对照蓝图 + 2026-09-06 真机验收校正版）
└── lib/                  # 构建输出（gitignore）
```

## 技术要点（踩坑记录）

- **双半结构是合法的**：`dsh.bundle.patch` 与 `dsh.client` 同时声明并不冲突——bundle 声明
  让本包成为 profile 组合层（host 半 `lib/index.js`：自愈 + MCP 桥接），`dsh.client` 声明
  让本包同时成为浏览器插件（`lib/client.js`：注册 `stock` slot）。约束只有两条：host 半不
  得 import 浏览器专用模块，client 半不得 import Node 模块。
- **构建工具**：用 `tsdown`（基于 rolldown）。rolldown 1.2.x **已移除 CSS bundling**，也
  不支持 Vite 的 `?inline` 后缀。解决方案：`index.css` 重命名 `index.css.txt`，在
  `tsdown.config.ts` 的 `cssAsString` 插件里重定向并读成字符串导出（client 半用
  `scripts/build-client.mjs` 的 tailwind 管线单独编译）。
- **client 半 inject**：`dsh.client.inject` 只列 `["@deepseek-ai/dsh-client-runtime"]`
  （模块到达序）；运行时 service 依赖（`slots`）由 `scripts/build-client.mjs` 在产物里
  声明。**不要**把 `dsh-client-ui-slots` / `dsh-client-ui-details` 列进 inject：这些是内部
  实现包，不在 npm，也不作为独立 fiber 注入。
- **单模块约束**：client bundle 必须是单模块（flat module graph），第三方依赖内联或走
  `dsh.client.external`。
- **布局依赖前提**：锚点对 rc.2 编译产物验证过；DSH 升级重编译后若锚点失配，自愈会中止
  不写并告警——此时更新 `src/layout-patch.ts` 的锚点表与
  `SUPPORTED_UI_LAYOUT_VERSION`（见下）。

## 布局补丁引擎运维

```bash
pnpm build
node scripts/patch-layout.mjs --check      # 查看 target/patched/ui-layout 版本/备份状态
node scripts/patch-layout.mjs --target <bundle>            # 手动打补丁（一般不必要）
node scripts/patch-layout.mjs --target <bundle> --force    # 从 pristine 备份重建
node scripts/patch-layout.mjs --unpatch                    # 还原 ui-layout（卸载后清理）
```

DSH 升级后若 `--check` 显示 `patched: false` 且日志提示锚点失配：把
`SUPPORTED_UI_LAYOUT_VERSION` 更新为新版本，并从新 bundle 里提取
`computeColumns` / store / AppFrame 等锚点替换进 `src/layout-patch.ts`，跑
`node scripts/patch-layout.mjs --force` 验证后再发布。

## 构建

```bash
cd frontend-dsh
pnpm install
pnpm build        # 输出到 lib/（index.js / client.js / *.d.ts / *.map）
```

## 本地开发加载

1. `pnpm build`。
2. 在 profile 目录（`~/.dsh/profiles/web`）执行 `dsh plugin --profile web add <本仓库路径>`
   （或修改依赖后用 pnpm 安装），CLI 会自动 reconcile `dsh.profile.bundles`。
3. 重启 `dsh web`。host 半在 apply 内同步打好 ui-layout 补丁，浏览器加载 client 半后，
   stock 列即出现——无需任何手动配置。

## 迁移路线

- **M0**：插件骨架打通 —— 注册 details slot，渲染占位面板，验证「打包 → 加载 → 渲染」全链路。✅
- **M1**：接入 lightweight-charts 日 K + 分时图 + `api.ts`，渲染真实 K 线。✅
- **M2**：迁入信息条（`StockInfoBar`）/ 关键价位（`PriceLevels`）/ 指标自定义。✅
- **M3**：标的搜索下拉（`InstrumentSearch`）+ 自选股管理（`Watchlist`）。✅
- **M4**：AI 四维分析（`AiAnalysisHost`）+ 报告历史（`AiReportCard`）+ Markdown 渲染（`MarkdownRenderer`）。✅
- **M5**：市场总览 + 指数 + 自选实时行情。✅
- **M6**：涨停梯队 + 板块热度。✅
- **N1–N7**：方法论批次（复盘 / 作战·竞价盘中 / 个股增强），蓝图见 `PRODUCT-DESIGN.md` §8，状态见文末。✅ 代码完成 + 构建通过 + **2026-09-06 真机 GUI 验收**（复盘/作战/个股按「用户流程」走查，见 `USER-GUIDE.md`）。

## M5：市场总览 / 指数 / 自选实时行情

面板壳改为 **Tab 导航**（`src/panel/PanelApp.tsx`）：**市场 · 梯队 · 指数 · 自选 · 个股 · 作战 · 复盘**（梯队见「M6」，作战/复盘见文末「方法论批次」）。
全部数据**直连 MCP 数据源**（`192.168.31.196:8007/mcp`，opentdx 3.4.0），**无需 FastAPI 后端**：

| Tab | 页面 | 数据工具 | 说明 |
| --- | --- | --- | --- |
| 市场 | `src/pages/MarketOverview.tsx` | `board_members("A", 6000)` + `quote`(指数) + `unusual`(SH/SZ/BJ) | 一次拉全 A 5566 只 → 广度 / 涨跌分布 / 涨幅·跌幅·成交·换手榜单 / 涨停·跌停（按 `buy_price_limit` 精确判定）/ 异动速递；20s 轮询 |
| 指数 | `src/pages/IndicesPage.tsx` + `src/components/IndexChart.tsx` | `quote` + `kline(DAILY)` + `tick_chart` | 9 大指数切换；日 K（K 线 + MA5/10/20 + 量）/ 分时（价格 + 均价 + 昨收线）双模式 |
| 自选 | `src/pages/WatchlistPage.tsx` | `quote`（逐只并行）+ 本地搜索 | **自选改存 localStorage**（`src/lib/watchlist-store.ts`）；12s 轮询实时价；点行打开个股 |
| 个股 | `src/pages/StockDetailPage.tsx` | `kline` + `tick_chart` + `auction` + `capital_flow` + `transaction` | 由市场/自选点选打开（`open` 入参）；搜索走本地全 A 索引（`searchInstruments`）。M9/W3：**日K（近3月/6月/1年/全部 区间 + MA5/10/20 开关）｜ 分时（当日/最近交易日，昨收虚线）** + 逐笔成交（折叠，最新 60 条，方向/单位语义待盘中复验） |

> 数据源端点按环境而定：本机为 `192.168.31.196:8007`。若不可达，面板会优雅降级/提示
> （UI 仍照常出现）。

## M6：涨停梯队 + 板块热度

「梯队」Tab（`src/pages/LadderPage.tsx`，Tab 已增至：市场 · 梯队 · 指数 · 自选 · 个股 · 作战 · 复盘）。

- **涨停池**：全 A 快照（`board_members("A")`）中 `close ≈ buy_price_limit` 精确判定。
- **连板统计**：`src/lib/indicators.ts`（`countStreak`：主板 10% / 创业·科创 20% / 北交 30% / ST 5%，
  含一字板判定），对涨停池每只并行 `kline(DAILY,20)` 回溯；失败个股保留并标"连板待确认"。
- **板块热度**：涨停池每只 `belong_board` → 聚合板块当日涨停数（剔除 style 类伪板块，
  保留 概念/行业/地区），按涨停数降序 TOP12（附板块指数涨跌幅与代表股）。
- **并发**：`src/lib/pool.ts`（≤6 并发）；**请求超时**：`mcp.ts` 每请求 15s AbortSignal 兜底。
  30s 刷新；点任意行/板块代表股 → 跳「个股」Tab。

## 方法论批次 N1–N7（蓝图：`PRODUCT-DESIGN.md` §8，依据：`WATCH-METHODOLOGY.md` / `STRATEGY-RESEARCH.md`）

把盯盘方法论落成「复盘 / 作战 / 个股增强」三块 UI，新增 Tab：**作战**（`WarPage`：时段感知 + 竞价雷达 + 事件流/板块脉冲/局势 + 持仓决策台）、**复盘**（`ReviewPage`：今日盘眼 + 昨日回顾 + 次日预期清单 ≤5 编辑器 + 存档）。

| 批次 | 交付 | 实现 | 状态 |
| --- | --- | --- | --- |
| N1 | 复盘模式（盘眼/预期清单/存档） | `lib/review-store.ts` + `src/pages/ReviewPage.tsx` | ✅ 构建通过 |
| N2 | 竞价雷达（竞价时段挂载） | `lib/auction-analysis.ts` + `components/AuctionRadar.tsx`（挂入 WarPage） | ✅ |
| N3 | 强度差分 / 低位首板候选 | `lib/strength.ts` + 复盘页接入（观察池 ≤120 → 强度列 / 低位首板候选 → 一键加预期） | ✅（复盘引用面已接 0.5.0；作战引用面待接） |
| N4 | 事件流 / 板块脉冲 / 局势归类 | `lib/event-stream.ts` + `board-pulse.ts` + `situation.ts` + WarPage | ✅ |
| N5 | 情绪温度计（仓位总闸） | `lib/regime.ts` + `lib/review-metrics.ts`（复盘实算：v3 昨日池建档驱动 晋级率/炸板率/首板溢价；作战盘中仍为近似） | ✅ |
| N6 | 持仓决策台 + 凯利仓位 | `lib/positions.ts` + `sizing.ts` + `components/PositionDesk.tsx` | ✅ |
| N7 | 个股页竞价回顾 + 资金面板 | `components/StockAuctionReview.tsx` + `StockCapitalFlow.tsx`（接入 StockDetailPage） | ✅ |

配套：
- **时段/交易日**：`lib/session-clock.ts`（server_info 驱动，已按实测字段修复判定）；
- **协议冒烟**：`node scripts/smoke-mcp.mjs`（握手/工具表已验证；`auction.unmatched` 正负、matched 单位等字段语义待行情源恢复后复验）；
- **昨日快照建档（0.5.0）**：复盘存档携带当日涨停池摘要（`review-store` v3 键，v2 旧档自动迁移），
  次日复盘**实算** 晋级率 / 首板溢价（昨日池 ∩ 今日池）+ 炸板率（当日事件捕获口径），
  盘眼下方琥珀小字标注「实算 vs 近似」口径（缺昨日存档/未捕获时透明回落近似，不假装精度）。
- **已知占位**：作战页盘中温度计输入仍为近似初值（昨日池 ∩ 实时涨停 的联动口径留待下轮）；
  事件流盘中捕获质量需交易日复验（`unusual/market_monitor` 仅在盘中给增量）。

> 验证现状（0.6.0）：**全量 `tsc --noEmit` 0 错误**；`pnpm build` exit 0。
> 2026-09-06 晚行情源恢复（本机 8017 网关回放 09-04 收盘数据）后跑了**适配层真机冒烟**，
> 复现并修复一处**数据层严重缺陷**：`stock-data.ts` 的 `toArray` 对 callToolJson 已解析的
> 数组再二次 `JSON.parse`（数组被字符串化成 "a,b" 解析失败 → 整层数据静默返回空，
> 周六休市空数据掩盖了它）。已改为「数组原样 / 字符串再解析 / 对象分形」三态兼容；
> kline / board_members / transaction / tick_chart / unusual / quote 全链路实测返回正常。
> 真机验收（2026-09-06，周日休市，A 股行情源空返回）：
> - ✅ 面板/7 Tab 加载正常；市场页琥珀空态提示、指数页「行情源暂无指数数据」空态（不再无限"加载中"）、
>   复盘页缺数据时存档禁用并提示、作战页休市停止轮询——均按预期；
> - 🔧 本轮体验修复（`src/lib/stock-data.ts` structuredContent 兜底；`src/lib/mcp.ts` 会话失效自动重建重试；
>   `src/lib/market.ts` 指数全失败抛错；`IndicesPage/MarketOverview/WatchlistPage` 空态与休市直加自选）——
>   使用流程与各场景行为详见 `USER-GUIDE.md`；
> - ⚠️ 行情源当前 A 股工具返回空（扩展市场 HK/US/期货正常）——疑似周末行情状态/上游连接问题；
>   交易日盘中请复查数据；`server_info` 在空数据期返回 null，时段判定由本地时钟兜底。
> 待办：行情源恢复后跑 `node scripts/smoke-mcp.mjs` 复核字段语义（auction unmatched 正负、matched 单位等）。
