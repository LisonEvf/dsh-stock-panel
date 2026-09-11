/**
 * src/lib/endpoints.ts — 数据源端点与传输模式的【单一配置源】（host 与 client 共用）。
 *
 * 背景：旧代码把端点默认值与覆盖变量散落在 mcp.ts / host-util.ts / host-data.ts /
 * gateway.ts 四处，且 host（env: DSH_*）与 client（window: __DSH_*）两套变量名
 * 不一致，容易配错。本模块统一解析顺序与命名：
 *
 *   覆盖优先级（高 → 低）：
 *     1) 环境变量 / window 全局（按所在运行时取其一）
 *     2) 本模块默认值
 *
 * 传输模式（__DSH_TDX_TRANSPORT__ / DSH_TDX_TRANSPORT）：
 *   - 'embedded'（默认）: 插件 host 半**进程内**直连 TDX（node-tdx 内置），
 *     浏览器走同源路由 POST /api/stock-panel/call；
 *   - 'http'（遗留）    : 外部 opentdx JSON 网关（gateway/ python 或兼容 HTTP
 *     服务，默认 http://127.0.0.1:8017）——仅当用户仍自建该服务时使用。
 *
 * 远端 MCP（192.168.31.196:8007/mcp）已移除：内置 node-tdx 覆盖全部 15 个行情
 * 工具，不再保留远端 MCP 兜底。
 *
 * 本模块是纯函数/常量，不 import 任何 Node 或 DOM API（带 typeof 守卫），
 * host 半与 client 半都可安全引用。
 */

/** 浏览器端传输模式覆盖变量。 */
export const WINDOW_TRANSPORT_KEY = '__DSH_TDX_TRANSPORT__'
/** 浏览器端遗留 HTTP 网关端点覆盖变量。 */
export const WINDOW_HTTP_GATEWAY_KEY = '__DSH_TDX_GATEWAY__'
/** host 端环境变量前缀（node 侧同名覆盖）。 */
export const ENV_PREFIX = 'DSH_'

/** 遗留外部 HTTP 网关默认端点。 */
export const DEFAULT_HTTP_GATEWAY_ENDPOINT = 'http://127.0.0.1:8017'
/** 内置（embedded）桥接路由（同源，host 半注册）。 */
export const EMBEDDED_CALL_ROUTE = '/api/stock-panel/call'
/** AI 任务桥接路由（同源，host 半注册；走官方 ctx.llm 直调）。 */
export const AI_CALL_ROUTE = '/api/stock-panel/ai'
/** 构建信息路由（同源，host 半注册）：{ version, buildId } —— 用于检出「浏览器跑着旧构建」。 */
export const BUILD_INFO_ROUTE = '/api/stock-panel/build'
/** host 侧持久化路由（同源，host 半注册）：GET 全量快照 / POST 单条或批量写入。 */
export const STATE_ROUTE = '/api/stock-panel/state'

export type TdxTransportMode = 'embedded' | 'http'

function isBrowser(): boolean {
  return typeof window !== 'undefined'
}

function winGet(key: string): string | undefined {
  try {
    if (!isBrowser()) return undefined
    const v = (window as unknown as Record<string, unknown>)[key]
    return typeof v === 'string' && v ? v : undefined
  } catch {
    return undefined
  }
}

function envGet(key: string): string | undefined {
  try {
    if (typeof process === 'undefined') return undefined
    return process.env?.[key]
  } catch {
    return undefined
  }
}

function normMode(v: string | undefined): TdxTransportMode | undefined {
  if (v === 'embedded' || v === 'http') return v
  return undefined
}

/** 当前传输模式。浏览器优先读 window.__DSH_TDX_TRANSPORT__；host 读 DSH_TDX_TRANSPORT。默认 'embedded'。 */
export function getTransportMode(): TdxTransportMode {
  const v = isBrowser() ? winGet(WINDOW_TRANSPORT_KEY) : envGet(`${ENV_PREFIX}TDX_TRANSPORT`)
  return normMode(v) ?? 'embedded'
}

/** 遗留外部 HTTP 网关端点：覆盖 → 默认。 */
export function getHttpGatewayEndpoint(): string {
  const v = isBrowser() ? winGet(WINDOW_HTTP_GATEWAY_KEY) : envGet(`${ENV_PREFIX}TDX_GATEWAY`)
  return v ?? DEFAULT_HTTP_GATEWAY_ENDPOINT
}

/** host 侧是否启用内置 TDX（默认开；env DSH_TDX_EMBEDDED=0 关闭）。 */
export function hostEmbeddedEnabled(): boolean {
  const v = envGet(`${ENV_PREFIX}TDX_EMBEDDED`)
  return v !== '0' && v !== 'false'
}

/** 诊断：当前端点解析结果（诊断句柄 / 日志用）。 */
export function endpointDiagnostics(): Record<string, string> {
  return {
    transport: getTransportMode(),
    httpGateway: getHttpGatewayEndpoint(),
    embeddedRoute: EMBEDDED_CALL_ROUTE,
    aiRoute: AI_CALL_ROUTE,
    buildRoute: BUILD_INFO_ROUTE,
  }
}
