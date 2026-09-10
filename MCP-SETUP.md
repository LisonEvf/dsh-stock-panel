# MCP 数据源配置说明（方案 A）

> ## ⚠️ 2026-09 传输层重构（v1.1）——远端 MCP 已移除，下文旧章节仅作历史存档
>
> 默认数据链路为 **embedded（内置 TDX）**，见 README「传输层重构」小节与
> `src/lib/endpoints.ts`（端点/模式单一配置源）：
>
> ```
> Browser ── POST /api/stock-panel/call {tool,args}（同源）
>    → host 半 registerEmbeddedTdxBridge
>    → node-tdx（src/host/vendor/opentdx.js，进程内长连接）── TCP 7709/7727 ── TDX
>        ├─ 业务错误            → {ok:false, kind:'business'}（如实上抛）
>        ├─ 未知工具            → {ok:false, kind:'unsupported'}
>        └─ 连接不可达/禁用     → {ok:false, kind:'unavailable'}
> ```
>
> 传输模式（`window.__DSH_TDX_TRANSPORT__` / 环境变量 `DSH_TDX_TRANSPORT`）：
> - `embedded`（**默认**）—— 进程内 node-tdx，覆盖全部 15 个行情工具（含
>   goods_varieties），无需任何外部进程、无远端兜底；
> - `http`（遗留）—— 自建 opentdx JSON 网关（`gateway/`，python），端点
>   `window.__DSH_TDX_GATEWAY__` / `DSH_TDX_GATEWAY`（默认 127.0.0.1:8017）。
>
> 诊断：浏览器控制台 `window.__STOCK_PANEL__.endpoints()` / `.transport()`；
> host 日志 `[stock-panel] embedded TDX bridge registered at /api/stock-panel/call`。

## 架构（旧：远端 MCP 桥接）

```
Browser (client.ts)
  → fetch('/api/stock-panel/mcp')  [同源，无 CORS 问题]
  → host 半 (index.ts 的 registerMcpBridge)
  → fetch('http://192.168.31.196:8007/mcp')  [服务端，无 CORS 问题]
  → 返回 MCP 工具数据
```

## 数据源切换

默认使用 MCP 数据源。可通过全局变量切换：

```javascript
// 在浏览器控制台或代码中设置
window.__DSH_DATA_SOURCE__ = 'mcp'  // MCP 数据源（默认）
window.__DSH_DATA_SOURCE__ = 'http' // FastAPI 后端（需要后端运行）
```

## 远端 MCP 服务器地址

默认：`http://192.168.31.196:8007/mcp`

可通过环境变量覆盖（host 半启动时读取）：

```bash
__DSH_MCP_ENDPOINT=http://your-mcp-server:8007/mcp dsh web
```

或修改 `src/index.ts` 的 `registerMcpBridge` 函数中的 `endpoint` 变量。

## 已验证的 MCP 工具（opentdx 3.4.0，15 个）

| 工具 | 用途 | 备注 |
| --- | --- | --- |
| `quote` | 实时报价（`{market, code}`），股票/指数通用 | 指数代码实测：上证 `SH 999999`、深成 `SZ 399001`、创业 `SZ 399006`、科创50 `SH 000688`、科创综指 `SH 000680`、沪深300 `SH 000300`、中证500 `SH 000905`、中证1000 `SH 000852`、中小100 `SZ 399005`（`SH 000016` 上证50 无数据） |
| `kline` | K 线（`{market, code, period, count, start}`），指数同样可用 | 升序返回，`datetime` 形如 `2026-09-04T00:00:00` |
| `tick_chart` | 分时（`{market, code, query_date?}`），指数可用 | 返回 `price/avg/vol` 逐分钟 |
| `board_members` | 板块成分行情（`{board_symbol, count, sort_type, sort_order}`） | `board_symbol="A"` 一次返回全 A 5566 只完整 quote；⚠️ `sort_type=AMOUNT` 服务端报错，按金额请客户端自排 |
| `unusual` / `market_monitor` | 市场异动 / 主力异动（`{market, count}`，market 取 SH/SZ/BJ） | `desc` 如「封涨停板/封跌停板」，`market` 数值 0=SZ/1=SH/2=BJ；⚠️ 收盘后/盘前多为 09:15 竞价快照，缺「炸板」类事件 |
| `belong_board` | 个股所属板块（`{market, code}`） | ✅ 已验证（M6 板块热度）：板块行自带 `board_symbol/board_symbol_name/涨停数/跌停数` 与板块指数 `close/pre_close`；`board_type` 3=地区 4=概念 5=风格 12=行业（热度榜剔除 type5 伪板块） |
| `transaction` / `auction` / `capital_flow` / `symbol_info` | 逐笔 / 竞价 / 资金流 / 简况 | 后续 M9 个股页用 |
| `goods_*` | 期货/港股/美股扩展行情 | 独立品类 |

> ⚠️ 响应格式：服务器对 `tools/*` **始终返回 SSE**（`event: message\ndata: {...}`），
> 客户端必须按 SSE 解析（`src/lib/mcp.ts` 的 `parseMcpBody`，已兼容纯 JSON 兜底）。
> 旧版 `resp.json()` 会静默失败 —— 已修复。
>
> ⚠️ 超时兜底：`mcp.ts` 每个请求带 15s AbortSignal 超时（实测偶发慢调用/挂起，
> 无超时会让梯队等批量轮询卡死）；批量并发 ≤6（`src/lib/pool.ts`）。

## M5 之后的本地化（无后端）

- **自选股**：`src/lib/watchlist-store.ts`，localStorage（key `dsh-stock-panel:watchlist:v1`）
- **搜索**：`src/lib/market.ts` 的 `searchInstruments`，用全 A 索引（`board_members("A")` 缓存 20s）本地过滤
- **市场统计**：广度/分布/榜单均在客户端由全 A 列表计算；涨停/跌停用 `buy_price_limit` 精确判定
- **数据源切换**：`window.__DSH_DATA_SOURCE__ = 'mcp' | 'http'`（HTTP 走原 FastAPI 后端，用于关键价位/AI 分析）

## 测试步骤

1. **重启 DSH web 进程**以加载新的 host 半 bundle：
   ```powershell
   # 终止当前进程（PID 18716）
   Stop-Process -Id 18716 -Force
   # 重新启动
   dsh web --no-open
   ```

2. **打开 DSH web GUI**（http://127.0.0.1:3080）

3. **在右侧工作台列输入股票代码**（如 `000001`）

4. **验证内容加载**：
   - 搜索框
   - 信息条
   - 日 K 图
   - 关键价位
   - 自选股
   - AI 分析

5. **检查浏览器控制台**：
   - 应看到 `[stock-panel] MCP bridge registered at /api/stock-panel/mcp`
   - 无 CORS 错误
   - 数据加载成功

## 故障排查

### 问题：面板内容空白

**可能原因：**
1. host 半未加载（未重启 DSH）
2. MCP 服务器不可达
3. CORS 问题（不应出现，因走 host 半桥接）

**排查步骤：**
1. 确认已重启 DSH web 进程
2. 检查 MCP 服务器可达性：
   ```powershell
   Invoke-WebRequest -Uri "http://192.168.31.196:8007/mcp" -Method Post -ContentType "application/json" -Body '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"test","version":"1.0"}}}' -Headers @{ Accept = "application/json, text/event-stream" }
   ```
   应返回 200

3. 检查浏览器开发者工具 → Network → 查看 `/api/stock-panel/mcp` 请求：
   - 状态码应为 200
   - 响应应为 SSE 格式（`event: message\ndata: {...}`）

### 问题：host 半未注册桥接路由

**检查日志：**
- DSH 启动日志应包含 `[stock-panel] MCP bridge registered at /api/stock-panel/mcp`

**确认 bundle 已更新：**
```powershell
# 检查安装的包是否有桥接代码
Select-String -Path "C:\Users\Lison\.dsh\profiles\web\node_modules\@lisonevf\dsh-stock-panel\lib\index.js" -Pattern "stock-panel/mcp"
```

## 技术细节

### host 半桥接路由

**路由：** `POST /api/stock-panel/mcp`

**请求体：**
```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "initialize",
  "params": {
    "protocolVersion": "2024-11-05",
    "capabilities": {},
    "clientInfo": { "name": "dsh-stock-panel", "version": "1.0" }
  },
  "sessionId": "可选，用于维持会话"
}
```

**响应：** SSE 流
```
event: message
data: {"jsonrpc":"2.0","id":1,"result":{...}}
```

### browser 半 MCP 客户端

**文件：** `src/lib/mcp.ts`

**方法：**
- `initialize()` — 建立会话
- `listTools()` — 列出工具
- `callTool(name, args)` — 调用工具

**桥接路由：** `/api/stock-panel/mcp`（同源，由 host 半转发）

## 优势

1. **无 CORS 问题** — 浏览器只调用同源路由，host 半在服务端转发
2. **无需 FastAPI 后端** — 直接调用远端 MCP 服务器
3. **数据源可切换** — 支持 MCP 和 HTTP 两种数据源
4. **符合 DSH 最佳实践** — 使用 `ctx.webServer` 注册路由
