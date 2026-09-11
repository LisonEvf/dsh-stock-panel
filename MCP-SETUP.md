# 数据源与传输配置（MCP-SETUP，2026-09-12 重写）

> 本文原名「MCP 数据源配置说明」。**远端 MCP 已在 v1.1 移除**，旧内容（远端桥接、
> `192.168.31.196:8007`、`POST /api/stock-panel/mcp`）整体作废；现行链路如下。
> 架构背景见 `docs/ARCHITECTURE.md` §2。

## 0. 一句话

数据默认来自 **host 半进程内的 node-tdx 直连**（embedded）——**零外部进程、零远端依赖**；
业务错/未知工具/不可达一律如实上抛，**没有兜底回退**。

```
Browser（src/lib/mcp.ts，25s 超时）
  └─ POST /api/stock-panel/call   body: {"tool": "<name>", "args": {...}}
       → host 半 registerEmbeddedTdxBridge        （src/host-util.ts）
       → serial() 串行队列 → node-tdx（src/host/vendor/opentdx.js，进程内长连接）
            ├─ TCP 7709 / 7727 ── 通达信行情服务器
            ├─ 19 个工具分发 + 输出归一化           （src/host/tdx-data.ts）
            └─ hist_concept_* → 进程内 HistEngine   （src/host/hist-data.ts）
```

## 1. 传输模式

| 模式 | 说明 | 端点/开关 |
| --- | --- | --- |
| **embedded（默认）** | host 半进程内 node-tdx，覆盖全部 19 个工具 | 无端点；host 侧 `DSH_TDX_EMBEDDED=0` 可禁用 |
| `http`（遗留） | 自建 python JSON 网关（`gateway/`，不随包发布） | `window.__DSH_TDX_TRANSPORT__='http'` / `DSH_TDX_TRANSPORT=http`；端点 `window.__DSH_TDX_GATEWAY__` / `DSH_TDX_GATEWAY`（默认 `http://127.0.0.1:8017`，15s 超时） |

端点与模式的**单一配置源**是 `src/lib/endpoints.ts`（同时读 host env 与 client window）。
诊断：`window.__STOCK_PANEL__.transport()` / `.endpoints()`。

错误语义（`kind`）：`business`（行情源业务错，如参数非法/无数据）、`unsupported`（未知工具）、
`unavailable`（连接不可达或内置被禁用）。UI 按 kind 给不同提示，不重试成灾。

## 2. 工具清单（19 个）

> ⚠️ 这是**数据层**（`src/host/tdx-data.ts` 分发，浏览器经 `/api/stock-panel/call` 调用）的清单。
> **对话工具是另一份清单、共 8 个**（`src/host-tools.ts` 注册给当前对话的 agent：
> `stock_quote` / `stock_kline` / `stock_tick` / `stock_unusual` + 4 个 `hist_concept_*`）。
> 两个数字不要混用。

行情 15（与 python opentdx-mcp 契约一致）：

| 工具 | 参数 | 用途与注意 |
| --- | --- | --- |
| `quote` | `{market, code}` | 实时报价（股票/指数通用）。指数代码：上证 `SH 999999`、深成 `SZ 399001`、创业 `SZ 399006`、科创50 `SH 000688`、科创综指 `SH 000680`、沪深300 `SH 000300`、中证500 `SH 000905`、中证1000 `SH 000852`、中小100 `SZ 399005`（`SH 000016` 上证50 无数据） |
| `kline` | `{market, code, period, count, start, adjust}` | K 线（升序）。`adjust=QFQ` 用于自挖概念引擎 |
| `tick_chart` | `{market, code, query_date?}` | 分时（price/avg/vol）；`query_date` 可回看历史交易日 |
| `transaction` | `{market, code, query_date?}` | 逐笔成交。⚠️ `bs_flag` 方向与 `vol` 单位**待交易日复验** |
| `auction` | `{market, code}` | 集合竞价 9:15–9:25 逐点。⚠️ 收盘后/盘前语义、`unmatched` 正负、`matched` 单位**待交易日复验** |
| `unusual` | `{market, count}` | 市场异动。`market` 取 SH/SZ/BJ；⚠️ 收盘后多退化为 09:15 竞价快照，缺「炸板」类事件 |
| `market_monitor` | `{market, count}` | 主力异动（同上限制） |
| `board_members` | `{board_symbol, count, sort_type, sort_order}` | 板块成分；`"A"` = 全 A（约 5.5k 只完整 quote，≥2MB）。⚠️ `sort_type=AMOUNT` 服务端报错 → 按金额请客户端自排 |
| `belong_board` | `{market, code}` | 个股所属板块。`board_type`：**3=地区 / 4=概念 / 5=风格 / 12=行业**（热度榜剔除 5；命名差异对照只用 12） |
| `capital_flow` | `{market, code}` | 当日 + 5 日主力/散户净流入 |
| `symbol_info` | `{market, code}` | 个股简况（现价/内外盘/换手/均价/活跃度） |
| `server_info` | — | 交易日/时段/状态（驱动时段模型；休市期可能空返回 → 本地时钟兜底） |
| `goods_quotes` / `goods_kline` / `goods_varieties` | 见工具描述 | 扩展市场（期货/港股/美股）。⚠️ 美股 `quote` 可能为空 → 页面用 K 线末两收盘自算 |

自挖概念 4（v1.0 起内置）：

| 工具 | 参数 | 返回要点 |
| --- | --- | --- |
| `hist_concept_classes` | `{top_members?, window?, pool_n?, min_corr?, as_of?, refresh?}` | 当日全部自挖类概要（class_id/size/mean_intra_corr/前几名成员）+ `isolated_n`。`weak_chain=true` 的类是阈值图伪类，**通常应过滤不采信** |
| `hist_concept_query` | `{market, code, topk?, …}` | 该票所在共动类 + 最近共动邻居（corr / 是否同类）。**market 仅 SZ/SH** |
| `hist_concept_class` | `{class_id, …}` | 某类完整成员表（代码/名称/类内相关/当日涨幅） |
| `hist_concept_status` | — | 引擎状态：引擎名、快照是否就绪、`as_of`、K 线缓存条数 |

默认参数：`pool_n=200`（全 A 成交额榜）、`window=60` 交易日、`min_corr=0.45`、快照 TTL 3600s、
**首次调用惰性重建**（冷启动要拉数百只 K 线，`hist_concept_status` 会显示快照未就绪）。

## 3. 排障

| 现象 | 检查 |
| --- | --- |
| 面板完全不出现在会话页 | `window.__STOCK_PANEL__.viewRegistered`（false = 槽未声明或注册失败）；host 日志有无 `视图「A股工作台」已注册` |
| 数据全空、红条「行情源不可达」 | host 半是否加载（日志 `[stock-panel] embedded TDX bridge registered at /api/stock-panel/call`）；`window.__STOCK_PANEL__.callTool('server_info',{})` 是否返回 |
| 路由 404 | 本包是否在 profile 的 `dsh.profile.bundles` 里；改完 host 半是否**重启**过 `dsh web` |
| 界面还是旧版 | 浏览器加载的是上次刷新的 bundle：`pnpm build` → 重启 `dsh web` → **硬刷新**（Ctrl+Shift+R）。`window.__STOCK_PANEL__.version` 可核对 |
| 单只票无数据 | 可能停牌/退市/代码错；换标的验证 |
| 自挖概念首次很慢/未就绪 | 引擎惰性重建（数百只 K 线）；`hist_concept_status` 看 `snapshot_ready`，或显式传 `refresh=true` 重建 |

验证脚本：

```bash
node scripts/smoke-embedded.mjs    # 内置 TDX：19 工具 + 输出归一化（需真机行情）
node scripts/smoke-mcp.mjs         # ⚠️ 历史脚本，指向已移除的远端 MCP，仅作协议模板参考
node scripts/smoke-gateway.mjs     # 遗留 http 网关（需本机 8017 在跑）
```

## 4. 遗留 http 网关（`gateway/`）

python 实现的 opentdx JSON 网关，**不随 npm 包发布**，仅在需要旁路调试（例如对照 python 侧
解析结果）时手动启动：`gateway/run-gateway.ps1`（默认 8017）。前端切到 `http` 模式即可用它。

> 该目录在工作区会留 `gateway/*.log`（可到 MB 级，已在 `.gitignore` 中）。确认不再需要时，
> 建议连同 `gateway/`、`scripts/smoke-gateway.mjs`、`smoke-mcp.mjs` 一并评估删除（ROADMAP B2）。

## 5. 交易日复验清单（阻塞项）

以下字段/行为**只在休市或快照数据上验证过**，需要在交易日盘中复核后回填本文：

1. `auction`：`unmatched` 正负语义（买/卖未匹配方向）、`matched` 单位（手/股）、
   与 `buy_price_limit` 的涨停价对齐、开盘后是否停止更新；
2. `transaction`：`bs_flag` 方向口径、`vol` 单位（手/股）；
3. `unusual` / `market_monitor`：盘中增量质量（炸板/回封事件是否真的出现）；
4. 自挖概念引擎：`as_of` 跨日推进、参数（pool_n/window/min_corr）校准后的类规模分布与稳定性；
5. 温度计实算值（晋级率/炸板率/首板溢价）在真实盘中的表现。
