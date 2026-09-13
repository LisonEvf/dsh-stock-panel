/**
 * src/lib/tool-names.ts —— 内置工具清单的**唯一真源**（host / client / 诊断面板共用）。
 *
 * 为什么单开一个模块：工具名此前在 5 处各写一份（`client.ts` 的 EMBEDDED_TOOLS、
 * `host/tdx-data.ts` 的 dispatch switch、`host-tools.ts` 的 defs()、`MCP-SETUP.md`、
 * `DiagnosticsPanel.tsx` 里的硬编码数字），实测已出现 "19 / 15 / 8 / 12" 四种口径并存
 * （README 说 19 工具冒烟、smoke-embedded 只跑 12 个、HIST 4 个不在内）。数字与名字
 * 一散开就必然漂移 —— 这里收口成一张表，其余地方只能引用。
 *
 * 契约：
 *   1. **数据层工具**（`EMBEDDED_TOOLS`）经 `/api/stock-panel/call` 暴露给浏览器，
 *      实现体在 `src/host/tdx-data.ts` 的 dispatch；新增/改名必须同时改那两处，
 *      由 `tests/tool-names.test.ts` 与 `scripts/smoke-embedded.mjs` 盯住。
 *   2. **对话工具**（`CONVERSATION_TOOLS`）注册给当前对话的 agent，实现在
 *      `src/host-tools.ts`；与数据层工具**不是同一份清单**（对话面是窄的、带文案）。
 */
export interface ToolSpec {
  readonly name: string
  readonly description: string
}

/** 数据层工具（19 个 = 行情 15 + HIST 自挖概念 4）。 */
export const EMBEDDED_TOOLS: readonly ToolSpec[] = [
  { name: 'quote', description: '获取股票实时报价（含 OHLC/成交量/成交额/量比等）' },
  { name: 'kline', description: '获取 A 股 K 线（升序，旧→新）' },
  { name: 'tick_chart', description: '获取分时图' },
  { name: 'transaction', description: '获取逐笔成交' },
  { name: 'auction', description: '获取集合竞价数据' },
  { name: 'unusual', description: '获取市场异动数据' },
  { name: 'board_members', description: '获取板块成分股行情（含排序）' },
  { name: 'capital_flow', description: '获取个股资金流向' },
  { name: 'symbol_info', description: '获取个股简要特征' },
  { name: 'belong_board', description: '查询个股所属板块列表' },
  { name: 'market_monitor', description: '获取主力监控数据' },
  { name: 'server_info', description: '获取服务器交易日、交易时段与状态参数' },
  { name: 'goods_quotes', description: '获取扩展市场报价（期货/港股/美股）' },
  { name: 'goods_kline', description: '获取扩展市场 K 线' },
  { name: 'goods_varieties', description: '获取商品品种列表（期货/期权合约）' },
  { name: 'hist_concept_query', description: '查一只票的 HIST 自挖概念（所在共动类 + 最近共动邻居）' },
  { name: 'hist_concept_classes', description: '当天全部 HIST 自挖类概要（类id/大小/类内相关/强边密度）' },
  { name: 'hist_concept_class', description: '查看某个 HIST 自挖类的完整成员表' },
  { name: 'hist_concept_status', description: 'HIST 自挖概念引擎状态' },
] as const

/** 数据层工具名（供 host 半做入参白名单与错误信息）。 */
export const EMBEDDED_TOOL_NAMES: readonly string[] = EMBEDDED_TOOLS.map((t) => t.name)

/**
 * 走**扩展市场**（7727 端口 ex-client）的工具：与 A 股工具分属两条连接。
 * 用途：串行队列按连接分链 —— 扩展市场挂住时不能堵死 A 股行情（实测过一次
 * `goods_varieties` 卡死把整个数据层拖住，直到重启 dsh web）。
 */
export const EXTENDED_MARKET_TOOLS: readonly string[] = ['goods_quotes', 'goods_kline', 'goods_varieties']

/** 对话工具（8 个 = 行情 4 + HIST 4）；实现在 `src/host-tools.ts`。 */
export const CONVERSATION_TOOLS: readonly ToolSpec[] = [
  { name: 'stock_quote', description: 'A 股实时报价摘要' },
  { name: 'stock_kline', description: 'A 股日 K 线' },
  { name: 'stock_tick', description: 'A 股当日分时' },
  { name: 'stock_unusual', description: '市场异动事件' },
  { name: 'hist_concept_query', description: 'HIST 自挖概念查询（单票）' },
  { name: 'hist_concept_classes', description: 'HIST 自挖类概要（全市场）' },
  { name: 'hist_concept_class', description: 'HIST 自挖类成员表' },
  { name: 'hist_concept_status', description: 'HIST 引擎状态' },
] as const

/** 对话工具名。 */
export const CONVERSATION_TOOL_NAMES: readonly string[] = CONVERSATION_TOOLS.map((t) => t.name)

/** 是否为内置数据层工具名。 */
export function isEmbeddedTool(name: unknown): boolean {
  return typeof name === 'string' && EMBEDDED_TOOL_NAMES.includes(name)
}

/** 是否走扩展市场连接。 */
export function isExtendedMarketTool(name: unknown): boolean {
  return typeof name === 'string' && EXTENDED_MARKET_TOOLS.includes(name)
}
