/**
 * src/lib/state-tables.ts — host 侧持久化的**表清单**（host 与 client 共用的单一来源）。
 *
 * A1（host 侧持久化）：本地资产从浏览器 localStorage 迁到 DSH 存储子系统的
 * `stock_panel` 领域（见 `docs/ARCHITECTURE.md` §5.2）。本模块只描述「有哪些表」
 * 以及它们对应的 localStorage 键，不含任何 IO：
 *   - host 半用它声明领域表（`src/host/state.ts`）；
 *   - client 半用它做「域 ↔ localStorage 镜像」的映射（`src/lib/host-state.ts`）。
 *
 * ⚠️ 两条硬约束（来自 DSH 存储子系统契约，实测确认）：
 *   1. 领域名/表名必须匹配 `^[a-z][a-z0-9_]*$` —— **不允许连字符**，故领域名是
 *      `stock_panel`（不是 `stock-panel`）；
 *   2. 每个表的值必须是 JSON 可序列化对象（记录键是任意字符串，但绝不进文件路径）。
 */

/** DSH 存储子系统里的领域名（= 后端 unit 名）。 */
export const STATE_DOMAIN = 'stock_panel'
/** 领域格式版本。⚠️ 固定为 1：介质版本不一致会让 open 抛 version-mismatch 且**不做迁移**。 */
export const STATE_DOMAIN_VERSION = 1

/** 一张表的元信息：领域表名 + 对应的 localStorage 键 + 语义说明。 */
export interface StateTableMeta {
  /** 领域表名（也是 host 路由里的 table 参数）。 */
  table: string
  /** 迁移前的 localStorage 键（client 半用它读旧数据/写镜像）。 */
  storageKey: string
  /** 记录键的语义（诊断用）。 */
  keyOf: string
  /** 人读说明。 */
  label: string
  /**
   * localStorage 里的整体形状：
   *   - `array`：数组（多数 store），逐条按 `keyOfRecord` 拆成记录；
   *   - `keyed`：`Record<记录键, 记录>`（如 AI 结论存档本来就是键值表）。
   */
  shape: 'array' | 'keyed'
}

/** 迁移到 host 的表（**全量迁移**：用户可见的本地资产都在这里）。 */
export const STATE_TABLES: readonly StateTableMeta[] = [
  {
    table: 'watchlist',
    storageKey: 'dsh-stock-panel:watchlist:v1',
    keyOf: 'SH600519',
    label: '自选股',
    shape: 'array',
  },
  {
    table: 'review',
    storageKey: 'dsh-stock-panel:review:v3',
    keyOf: '2026-09-12（交易日）',
    label: '复盘存档（含昨日涨停池）',
    shape: 'array',
  },
  {
    /**
     * N10：复盘草稿（未存档的「次日预期清单」+ 亏钱共性 + 风向标）。
     *
     * 为什么单开一张表而不是塞进 `review`：草稿是**每次编辑都在变**的高频临时态
     * （`review-draft.ts` 每次编辑写 localStorage、1s 防抖推 host），而 `review` 是
     * 按日归档的正式产出物（一天一条）。混在一起会让"编辑中的草稿"污染
     * 「按日归档 + v2→v3 迁移」的既有契约，也会让次日竞价对照读到没存档的半成品。
     *
     * 加表**不动 `STATE_DOMAIN_VERSION`**（固定 1）：改介质版本号会让已有域的 `open`
     * 直接抛 version-mismatch 且不做迁移 = 用户既有数据全废。新表在旧域里不存在，
     * 启动时 `host-state.ts` 会走「域里为空 + 本地有数据 → 首迁上传」，无需迁移代码。
     */
    table: 'review_draft',
    storageKey: 'dsh-stock-panel:review-draft:v1',
    keyOf: '2026-09-12（交易日；同一天只留一条）',
    label: '复盘草稿（自动保存·未存档）',
    shape: 'array',
  },
  {
    table: 'dayrun',
    storageKey: 'dsh-stock-panel:dayrun:v1',
    keyOf: '2026-09-12（交易日）',
    label: '当日运行记录（Q1-Q3 / 竞价判定）',
    shape: 'array',
  },
  {
    table: 'positions',
    storageKey: 'dsh-stock-panel:positions:v1',
    keyOf: 'SH600519',
    label: '持仓',
    shape: 'array',
  },
  {
    table: 'tradelog',
    storageKey: 'dsh-stock-panel:tradelog:v1',
    keyOf: '记录 id',
    label: '交易日志（凯利自统计样本）',
    shape: 'array',
  },
  {
    table: 'verdicts',
    storageKey: 'dsh-stock-panel:ai-verdict:v1',
    keyOf: '2026-09-12:SH600519',
    label: 'AI 研判结论存档',
    shape: 'keyed',
  },
  {
    table: 'events',
    storageKey: 'dsh-stock-panel:events:v1',
    keyOf: '市场-代码-时间-描述',
    label: '异动事件流（增量捕获）',
    shape: 'array',
  },
  {
    table: 'viewed',
    storageKey: 'dsh-stock-panel:viewed:v1',
    keyOf: 'SH600519',
    label: '看过的个股（左栏「个股」分组）',
    shape: 'array',
  },
  {
    /**
     * 监控规则（价格/涨跌幅/关键词）。
     *
     * 为什么补进 host 域：盘前设好的规则是**跨日资产**（次日开盘还要用），却一直只写
     * localStorage —— 清一次浏览器缓存/换台机器就全没了，与"用户可见的本地资产都在
     * host 侧"的口径不符。命中记录同理（复盘要看"今天触发过什么"）。
     *
     * 加表**不动 `STATE_DOMAIN_VERSION`**（固定 1，理由见 review_draft 上方注释）。
     */
    table: 'alert_rules',
    storageKey: 'dsh-stock-panel:alerts:rules:v1',
    keyOf: '规则 id',
    label: '监控规则（价格/涨跌幅/关键词）',
    shape: 'array',
  },
  {
    table: 'alert_hits',
    storageKey: 'dsh-stock-panel:alerts:hits:v1',
    keyOf: '命中 id',
    label: '监控命中记录（环形 ≤200）',
    shape: 'array',
  },
] as const

/** 表名 → 元信息。 */
export const STATE_TABLE_MAP: ReadonlyMap<string, StateTableMeta> = new Map(
  STATE_TABLES.map((t) => [t.table, t]),
)

/** 是否为已声明的表名。 */
export function isStateTable(name: string): boolean {
  return STATE_TABLE_MAP.has(name)
}

/**
 * 从一条记录里取「记录键」（与各 store 自己的自然键一致）。
 *
 * 键的选取刻意复用 store 既有语义（例如 AI 存档本来就是 `${day}:${SYMBOL}`），
 * 这样 hydrate/sync 都是无损映射，不需要额外的键映射表。
 *
 * @returns 记录键；取不到时返回 null（调用方跳过该记录并只告警一次）
 */
export function keyOfRecord(table: string, value: unknown): string | null {
  if (value === null || typeof value !== 'object') return null
  const v = value as Record<string, unknown>
  const str = (x: unknown): string | null => (typeof x === 'string' && x !== '' ? x : null)
  switch (table) {
    case 'watchlist':
    case 'viewed': {
      const market = str(v.market)
      const code = str(v.code)
      return market !== null && code !== null ? `${market}${code}` : null
    }
    case 'review':
    case 'dayrun':
    // N10：草稿的自然键同样是 `day`（同一天只留一条 → 编辑覆盖同一条记录，
    // 不会在 host 里堆出一串历史草稿）。
    case 'review_draft':
      return str(v.day)
    case 'positions':
      return str(v.symbol)
    case 'tradelog':
      return str(v.id)
    case 'verdicts': {
      const day = str(v.day)
      const symbol = str(v.symbol)
      return day !== null && symbol !== null ? `${day}:${symbol.toUpperCase()}` : null
    }
    case 'events':
      return str(v.key)
    case 'alert_rules':
    case 'alert_hits':
      return str(v.id)
    default:
      return null
  }
}
