# stock-tdx-gateway — 本机 opentdx 直连行情网关（替代远端 MCP 数据链路）

> ## ⚠️ 遗留组件（2026-09-08 起默认停用）
>
> v1.1 起插件**内置** JS 版 TDX 直连（node-tdx，host 半进程内，见
> `src/host/tdx-data.ts` + `src/lib/endpoints.ts`），默认不再依赖本 python
> 网关进程。本目录仅服务显式 `__DSH_TDX_TRANSPORT__ = 'http'` 的遗留部署
> （`run-gateway.ps1` 自启仍可用）。新部署请勿再配置它。
>
> 现行数据源与传输说明见 `MCP-SETUP.md`；本文下方「自动回退远端 MCP」「15 工具」等描述
> **已作废**（远端 MCP 已整体移除，工具数为 19）。本目录是否保留见 `docs/ROADMAP.md` B2。

把行情数据从「远端 MCP（192.168.31.196:8007，SSE + JSON-RPC）」改为**本机直连 opentdx 源码**，
去掉 LAN 一跳（实测 TCP ~30ms）与 MCP 会话/SSE 开销，聚焦**首连/预热**优化。

```
Browser(插件, dsh web 127.0.0.1:3080)
   └─(同源 fetch 由 host 桥转发或直连) JSON POST
   http://127.0.0.1:8017/call   ← stock-tdx-gateway（本文件）
      └─ opentdx（TRADE\opentdx 源码，共享 TdxClient）
         └─ TDX 行情服务器（7709 A股 / 7727 扩展，自动选服+心跳保活）
```

## 快速开始

```powershell
# 启动（后台隐藏窗口，含启动预热）
powershell -ExecutionPolicy Bypass -File gateway\run-gateway.ps1 -Action start

# 开机自启（写入 HKCU Run）
powershell -ExecutionPolicy Bypass -File gateway\run-gateway.ps1 -Action autostart-on

# 状态 / 停止 / 重启
... -Action status | stop | restart
```

或手动运行（需 python ≥3.12，建议复用 `tickflow-stock-panel\backend\.venv\Scripts\python.exe`）：

```powershell
& "...\backend\.venv\Scripts\python.exe" gateway\gateway.py --host 127.0.0.1 --port 8017
```

脚本自动解析 opentdx 源码位置：`frontend-dsh/gateway` 上溯 3 级 → `TRADE\opentdx`
（可用 `-OpentdxSrc` / 环境变量 `OPENTDX_SRC` 覆盖）。**零 pip 依赖**：opentdx 核心与网关本体均只用标准库。

## 协议

| 端点 | 说明 |
| --- | --- |
| `POST /call` | body `{"tool": "<工具名>", "args": {...}}` → `{"ok":true,"data":…}` 或 `{"ok":false,"error":"…"}` |
| `GET /healthz` | `{"ok":…,"connected":{"a":bool,"ext":bool},"uptime_s":…,"tools":[…]}` |

工具名/参数/返回结构与远端 MCP 服务器（opentdx-mcp 15 工具）逐一对齐，前端
`stock-data.ts` 适配层不改动：

`quote` `kline` `tick_chart` `transaction` `auction` `unusual` `market_monitor`
`board_members`(`"A"`=全A) `belong_board` `capital_flow` `symbol_info` `server_info`
`goods_quotes` `goods_kline` `goods_varieties`

序列化约定（与 MCP 输出一致）：枚举 → 数值（market：0=SZ/1=SH/2=BJ）；
`datetime/date/time` → ISO 字符串（如 `2026-09-04T00:00:00` / `09:15:00`）；UTF-8。

## 连接速度优化（首连/预热侧重点）

| 项 | 实现 | 实测 |
| --- | --- | --- |
| 进程常驻 + 启动预热 | `TdxClient.__enter__()` 启动即完成 7709+7727 选服/建连/登录（3 次重试，失败退出交守护重启） | 首连约 **0.17s** |
| 选服缓存 | opentdx 传输层进程级缓存最快主站（300s TTL），warm 请求无需再探测 | — |
| warm 单请求 | 纯 JSON 直连 + HTTP keep-alive | 约 **15ms** |
| 心跳保活 | 共享客户端 `heartbeat=True`，空闲不断线；断线后下个请求自动重连 | — |
| 并发安全 | 共享客户端 `multithread=True`（收发加锁），HTTP 线程池安全 | — |
| 对比远端 MCP | 每请求额外 ≈30ms LAN + MCP 会话/SSE 开销，且依赖远端进程可用 | — |

> 说明：opentdx 的选服结果缓存为进程内存级（非磁盘）。因首连仅 ~0.17s，未做磁盘持久化；
> 若未来重启频繁可再加。warm 指标与浏览器端 20s/12s 轮询缓存叠加，实际请求量很低。

## 前端数据源切换

- 默认数据源 = 本地网关（`src/lib/mcp.ts` 的 `invokeTool` 按 `window.__DSH_TDX_TRANSPORT__` 分发：
  缺省 `'tdx'` = 网关；`'mcp'` = 强制远端 MCP）。
- 网关不可达（未启动/超时）时**自动回退远端 MCP**，10s 冷却后重试网关，页面不中断。
- 网关地址覆盖：`window.__DSH_TDX_GATEWAY__ = 'http://127.0.0.1:8017'`。
- 原 `__DSH_DATA_SOURCE__='mcp'|'http'` 语义不变（api.ts 关键价位/AI 分析仍按该开关）。

## 故障排查

- `gateway\gateway.log(.out/.err)`：启动失败看 `.err`（常见：TDX 服务器不可达/防火墙）。
- `status` 报未运行 → 确认 python ≥3.12、opentdx 源码路径；杀进程后 `restart`。
- 插件页报错但网关 `status` 正常 → 浏览器控制台看是否走 `__DSH_TDX_TRANSPORT__='mcp'` 回退日志。
