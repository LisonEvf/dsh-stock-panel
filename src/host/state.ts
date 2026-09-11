/**
 * src/host/state.ts — host 侧持久化（A1）：DSH 存储子系统的 `stock_panel` 领域。
 *
 * ## 为什么走 DSH 存储子系统而不是自己写文件
 *
 * `dsh-base` 已经在每个 profile 里挂载了存储栈（`storage` 枢纽 + `storage-json` 后端
 * + `storage-domain` 领域层，json 后端 root = `$DSH_HOME/storages`）。用它拿到的是：
 * 介质所有权归平台、写入原子、领域版本校验、逐记录布局（写放大可控）、`domain/changed`
 * 事件。数据也不再随「清浏览器缓存 / 换设备」蒸发。
 *
 * ## 为什么不 import `@deepseek-ai/dsh-storage-domain` 的 `defineDomain`
 *
 * 公开 npm 上的该包只有 `0.0.1-rc.1`，而宿主跑的是 `0.1.2-rc.1` —— import 会造成
 * 版本错配。而 `defineDomain` 只是「校验 + 身份函数」，运行期契约实测只有三处：
 *   - `descriptorOf(spec)` 读 name/version/tables 的键/hasGlobal/layout；
 *   - `spec.tables[t].valueSchema.parse(raw)` 逐条校验；
 *   - `spec.global.schema.parse(stored)` / `initial`。
 * 所以本模块**手搓 spec**，并提供一个只需 `parse` / `safeParse` 的极简 schema，
 * 既零依赖，也不与宿主的 zod 副本耦合。schema 的写法在 `miniObjectSchema` 里。
 *
 * ## 域的形态与版本策略
 *
 * - 领域名 `stock_panel`、版本**固定 `1`**（`UNIT_NAME_RE = ^[a-z][a-z0-9_]*$`，**不能有连字符**）。
 *   ⚠️ 实测（介质证据见 `scripts/verify-state-domain.mjs`）：per-record 布局下每条记录落盘为
 *   `{ "version": N, "record": {...} }`，**version 不一致时不会报错，而是把旧记录静默丢弃**
 *   （打开成功但记录数为 0）——静默丢数据比报错更危险，所以版本绝不能随手上调。
 *   真要升版本，必须同时声明 `compatibleVersions: [旧版本…]`（官方逃生口）让旧记录继续可读；
 *   日常字段演进走 `global.schemaVersion` + 启动迁移遍历（版本保持不变）。
 * - `layout: 'per-record'`：事件流是追加型、写入频繁，逐记录文档避免「每次写都重发整个 unit」。
 *   ⚠️ 该布局把**记录键当文件名**，要求匹配 `^[a-zA-Z0-9_-]+$`，不匹配直接抛错 →
 *   自然键（含 `:` 与中文，如事件流的 `SH-600519-10:03-封涨停板`）必须经 `encodeStateKey()`
 *   做 base64url 编码（见下方「记录键编码」一节）；
 * - `invalidRecords: 'backup-and-skip'`：单条坏记录被移到一边并跳过，**不让整域打不开**
 *   （否则一条脏数据就会让用户的复盘/持仓全部读不出来）；
 * - 语义校验仍在 store 层（各 store 载入时本来就会 shape 过滤），这里只做介质边界的最小校验。
 *
 * ## 降级
 *
 * 宿主没挂存储子系统（或 open 失败）时**不崩、不阻塞**：只标记不可用并给出原因，
 * 前端继续用 localStorage（`localStorage 降级兜底`）。
 */
import { getOwnPropertySafe, readBody } from '../host-util'
import { STATE_ROUTE } from '../lib/endpoints'
import { STATE_DOMAIN, STATE_DOMAIN_VERSION, STATE_TABLES, isStateTable } from '../lib/state-tables'
import { hostBuildInfo } from './build-info'

/** JSON 对象（记录值）。 */
type JsonObject = Record<string, unknown>

/** 子系统需要的 schema 面（实测只有这两个方法）。 */
interface MiniSchema {
  parse(value: unknown): JsonObject
  safeParse(value: unknown): { success: boolean }
}

/** 领域表句柄（DSH 契约：读同步、写返回 Promise）。 */
interface StateTableHandle {
  get(key: string): JsonObject | undefined
  entries(): IterableIterator<[string, JsonObject]>
  keys(): IterableIterator<string>
  readonly size: number
  put(key: string, value: JsonObject): Promise<void>
  delete(key: string): Promise<boolean>
}

/** 领域句柄。 */
export interface StateDomainHandle {
  readonly name: string
  readonly global: {
    get(): JsonObject
    set(value: JsonObject): Promise<void>
  }
  table(name: string): StateTableHandle
  close(): Promise<void>
}

/** 领域 facility（`ctx.storageDomain`）。 */
export interface StateFacility {
  open(spec: unknown): Promise<StateDomainHandle>
}

/** 领域 global（schemaVersion 供将来做「表内加法演进」的迁移遍历）。 */
interface StateGlobal extends JsonObject {
  schemaVersion: number
  migratedFromLocalStorage: boolean
  updatedAt: number
}

const GLOBAL_INITIAL: StateGlobal = { schemaVersion: 1, migratedFromLocalStorage: false, updatedAt: 0 }

/**
 * 极简对象 schema：只要求「非 null 对象」，并按表做一条**软性关键字段**检查。
 *
 * 为什么不写严 schema：记录由我们自己的 store 写入，介质边界的职责是「防止把非对象/
 * 半截 JSON 当成记录」，而不是复刻 store 的语义校验（那会导致一次字段变更就让老记录
 * 被拒、进而整域打不开）。真正的不变量（市场合法性、上限裁剪）在各 store 载入时执行。
 */
function miniObjectSchema(label: string, keyField?: string): MiniSchema {
  const check = (value: unknown): JsonObject => {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
      throw new Error(`${STATE_DOMAIN}: ${label} 记录必须是 JSON 对象`)
    }
    const obj = value as JsonObject
    if (keyField !== undefined && typeof obj[keyField] !== 'string') {
      throw new Error(`${STATE_DOMAIN}: ${label} 记录缺少字符串字段 '${keyField}'`)
    }
    return obj
  }
  return {
    parse: check,
    safeParse: (value: unknown) => {
      try {
        check(value)
        return { success: true }
      } catch {
        return { success: false }
      }
    },
  }
}

/** 各表的关键字段（软校验用：有则必须是字符串）。 */
const KEY_FIELD: Record<string, string | undefined> = {
  watchlist: 'code',
  review: 'day',
  dayrun: 'day',
  positions: 'symbol',
  tradelog: undefined,
  verdicts: 'symbol',
  events: 'key',
  viewed: 'code',
}

/**
 * 手搓的领域 spec（形态与 `defineDomain` 的输出一致）。
 *
 * 导出原因：`scripts/verify-state-domain.mjs` 用**宿主的真实存储栈**
 * （cordis + dsh-storage + storage-json + storage-domain）打开同一份 spec 做校验——
 * 手搓 spec 的风险只能靠「用真实现跑一遍」来排除，靠假实现不算验证。
 */
export function buildStateSpec(): unknown {
  const tables: Record<string, { valueSchema: MiniSchema }> = {}
  for (const meta of STATE_TABLES) {
    tables[meta.table] = { valueSchema: miniObjectSchema(meta.label, KEY_FIELD[meta.table]) }
  }
  return {
    name: STATE_DOMAIN,
    version: STATE_DOMAIN_VERSION,
    layout: 'per-record',
    invalidRecords: 'backup-and-skip',
    global: { schema: miniObjectSchema('global'), initial: GLOBAL_INITIAL },
    tables,
  }
}

// ────────────────────────────── 状态 ──────────────────────────────

let domain: StateDomainHandle | null = null
let opening: Promise<void> | null = null
let unavailableReason: string | null = null
let lastError: string | null = null
/** 宿主 ctx（惰性解析服务用）。 */
let hostCtx: unknown = null
/** 服务解析来源（诊断用：能区分「服务晚到」与「服务确实没挂」）。 */
let facilitySource = '尚未解析'

function isFacility(v: unknown): v is StateFacility {
  return v !== null && typeof v === 'object' && typeof (v as StateFacility).open === 'function'
}

/**
 * 解析存储服务（每次调用都重新看）。
 *
 * ⚠️ 为什么不在 apply 时取一次就完事（**真机实测踩到的 bug**）：
 * cordis 的插件激活是**服务可用性驱动**的，`storage-domain` 的挂载时刻不保证早于本插件
 * 的 apply。旧实现「apply 时读一次 → 读不到就把不可用结论**永久缓存**」导致真机上
 * `available:false`（原因：ctx.storageDomain 不可用）——而 dsh-base 明明挂了存储栈。
 * 现在：`ctx.inject` 声明（服务出现时回调）+ **每次请求惰性重试**双保险。
 */
function resolveFacility(): StateFacility | null {
  const direct = getOwnPropertySafe(hostCtx, 'storageDomain')
  if (isFacility(direct)) {
    facilitySource = 'ctx.storageDomain'
    return direct
  }
  // 文档说明领域层同时挂在 ctx.storage.domain（与 ctx.storageDomain 同一个对象）
  const hub = getOwnPropertySafe(hostCtx, 'storage')
  const viaHub = hub === undefined ? undefined : getOwnPropertySafe(hub, 'domain')
  if (isFacility(viaHub)) {
    facilitySource = 'ctx.storage.domain'
    return viaHub
  }
  facilitySource =
    hostCtx === null
      ? '尚未拿到宿主 ctx'
      : 'ctx.storageDomain / ctx.storage.domain 均不可用（服务可能晚于 apply 挂载，下次请求会重试）'
  return null
}

/** 打开领域（幂等；失败只记录原因，不抛）。 */
function ensureOpen(facility: StateFacility | null): Promise<void> {
  if (opening !== null) return opening
  if (facility === null || typeof facility.open !== 'function') {
    // ⚠️ 不把结论永久缓存：下一次请求还会再解析一次（见 resolveFacility 的说明）。
    unavailableReason = `宿主未挂载存储子系统（${facilitySource}）`
    return Promise.resolve()
  }
  opening = facility
    .open(buildStateSpec())
    .then((d) => {
      domain = d
      unavailableReason = null
      console.log(
        `[stock-panel] 持久化域 '${STATE_DOMAIN}' 已就绪（${STATE_TABLES.length} 张表 @ json 后端，服务来源 ${facilitySource}）`,
      )
    })
    .catch((err: unknown) => {
      unavailableReason = `持久化域打开失败：${(err as Error)?.message ?? String(err)}`
      // 打开失败可能也是时序问题（后端未就绪）→ 允许下次请求重试。
      opening = null
      console.warn('[stock-panel] ' + unavailableReason + ' —— 前端将退回 localStorage')
    })
  return opening
}

/**
 * 确保领域可用（请求路径调用）：域已开 → 直接返回；否则解析服务并尝试打开。
 *
 * 这是 A1 的关键修补点：把「启动时一次性判定」改成「按需 + 可重试」。
 */
export async function ensureStateReady(): Promise<void> {
  if (domain !== null) return
  await ensureOpen(resolveFacility())
}

/**
 * 在 host 半启动时调用（同步返回；打开过程异步进行）。
 *
 * 传 `ctx`（不是 facility）：服务可能在 apply 之后才挂上，所以这里只记 ctx。
 */
export function initStateDomain(ctx: unknown): void {
  hostCtx = ctx
  void ensureOpen(resolveFacility())
}

/** 关闭领域（fiber dispose / 服务消失时调用；重置后可再次打开）。 */
export async function closeStateDomain(): Promise<void> {
  const d = domain
  domain = null
  opening = null
  unavailableReason = null
  if (d !== null) {
    try {
      await d.close()
    } catch (err) {
      console.warn('[stock-panel] 持久化域关闭失败：', err)
    }
  }
}

/** 当前持久化状态（诊断/UI 用）。 */
export interface StateStatus {
  available: boolean
  reason?: string
  domain: string
  version: number
  /** 存储服务的解析来源（区分「服务晚到/确实没挂」）。 */
  facilitySource?: string
  schemaVersion?: number
  migratedFromLocalStorage?: boolean
  /** 各表记录数（可用时）。 */
  counts?: Record<string, number>
  lastError?: string
}

export function stateStatus(): StateStatus {
  if (domain === null) {
    return {
      available: false,
      ...(unavailableReason !== null ? { reason: unavailableReason } : {}),
      domain: STATE_DOMAIN,
      version: STATE_DOMAIN_VERSION,
      facilitySource,
      ...(lastError !== null ? { lastError } : {}),
    }
  }
  const counts: Record<string, number> = {}
  for (const meta of STATE_TABLES) {
    try {
      counts[meta.table] = domain.table(meta.table).size
    } catch {
      counts[meta.table] = -1
    }
  }
  const g = domain.global.get()
  return {
    available: true,
    domain: STATE_DOMAIN,
    version: STATE_DOMAIN_VERSION,
    facilitySource,
    schemaVersion: typeof g.schemaVersion === 'number' ? g.schemaVersion : 1,
    migratedFromLocalStorage: g.migratedFromLocalStorage === true,
    counts,
    ...(lastError !== null ? { lastError } : {}),
  }
}

/** 全量快照：{ tables: { 表名: { 记录键: 值 } } }。 */
export interface StateSnapshot extends StateStatus {
  tables: Record<string, Record<string, JsonObject>>
}

/**
 * 自然键 → 路径安全键（base64url，无 padding）。
 *
 * ⚠️ 实测发现（只有用**宿主真实存储栈**才暴露）：`layout: 'per-record'` 的 json 后端
 * 把记录键映射成**文件名**，因此要求键匹配 `^[a-zA-Z0-9_-]+$`（SAFE_KEY_RE），
 * 不匹配直接**抛错**。而我们的自然键含 `:` 与中文——例如事件流的
 * `${market}-${code}-${time}-${desc}` = `SH-600519-10:03-封涨停板`；
 * 不处理的话**每一次事件写入都会抛异常**。base64url 的字符集恰好在允许集内，
 * 编解码放在 host 层，对客户端完全透明（wire 与诊断看到的始终是自然键）。
 */
export function encodeStateKey(key: string): string {
  const bytes = new TextEncoder().encode(key)
  let bin = ''
  for (const b of bytes) bin += String.fromCharCode(b)
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

/** 路径安全键 → 自然键（非本编码的键原样返回，便于人工排查介质）。 */
export function decodeStateKey(encoded: string): string {
  try {
    const b64 = encoded.replace(/-/g, '+').replace(/_/g, '/')
    const pad = b64.length % 4 === 0 ? '' : '='.repeat(4 - (b64.length % 4))
    const bin = atob(b64 + pad)
    const bytes = new Uint8Array(bin.length)
    for (let i = 0; i < bin.length; i += 1) bytes[i] = bin.charCodeAt(i)
    return new TextDecoder().decode(bytes)
  } catch {
    return encoded
  }
}

export function stateSnapshot(): StateSnapshot {
  const status = stateStatus()
  const tables: Record<string, Record<string, JsonObject>> = {}
  if (domain !== null) {
    for (const meta of STATE_TABLES) {
      const out: Record<string, JsonObject> = {}
      try {
        for (const [k, v] of domain.table(meta.table).entries()) out[decodeStateKey(k)] = v
      } catch (err) {
        lastError = `读取表 ${meta.table} 失败：${(err as Error)?.message ?? String(err)}`
      }
      tables[meta.table] = out
    }
  }
  return { ...status, tables }
}

/** 标记「已从 localStorage 迁移」并刷新时间戳。 */
async function touchGlobal(patch: Partial<StateGlobal>): Promise<void> {
  if (domain === null) return
  const cur = domain.global.get()
  await domain.global.set({ ...cur, ...patch, updatedAt: Date.now() })
}

/** 写一条记录。 */
export async function statePut(table: string, key: string, value: JsonObject): Promise<void> {
  if (domain === null) throw new Error(unavailableReason ?? '持久化域不可用')
  if (!isStateTable(table)) throw new Error(`未声明的表 '${table}'`)
  await domain.table(table).put(encodeStateKey(key), value)
}

/** 删一条记录（返回是否真的删掉了）。 */
export async function stateDelete(table: string, key: string): Promise<boolean> {
  if (domain === null) throw new Error(unavailableReason ?? '持久化域不可用')
  if (!isStateTable(table)) throw new Error(`未声明的表 '${table}'`)
  return domain.table(table).delete(encodeStateKey(key))
}

/** 迁移标记（写入一次即可）。 */
export async function markMigrated(): Promise<void> {
  await touchGlobal({ migratedFromLocalStorage: true })
}

// ────────────────────────────── 路由 ──────────────────────────────

/** 与 host-util.ts 的 webServer 形状一致（避免循环依赖，仅留结构类型）。 */
interface WebServerLike {
  register: (route: {
    kind: 'exact' | 'prefix'
    path: string
    handler: (req: unknown, res: unknown) => void | Promise<void>
  }) => () => void
}

/** 注册 GET / POST /api/stock-panel/state。 */
export function registerStateBridge(webServer: WebServerLike): void {
  try {
    webServer.register({
      kind: 'exact',
      path: STATE_ROUTE,
      handler: async (req, res) => {
        const resW = res as {
          statusCode?: number
          setHeader?: (k: string, v: string) => void
          end: (b: string) => void
        }
        const send = (status: number, payload: unknown) => {
          if (resW.setHeader) {
            resW.statusCode = status
            resW.setHeader('Content-Type', 'application/json')
            resW.setHeader('Cache-Control', 'no-store')
          }
          resW.end(JSON.stringify(payload))
        }
        const method = String((req as { method?: string }).method ?? 'GET').toUpperCase()

        if (method === 'GET') {
          await ensureStateReady() // 按需解析服务（可重试）：服务晚到也能自愈
          send(200, { ok: true, build: hostBuildInfo(), ...stateSnapshot() })
          return
        }
        if (method !== 'POST') {
          send(405, { ok: false, error: '仅支持 GET / POST' })
          return
        }

        try {
          const body = await readBody(req)
          const p = (body.payload ?? {}) as {
            table?: string
            key?: string
            value?: JsonObject
            delete?: boolean
            records?: Record<string, JsonObject>
            deletes?: string[]
            migrated?: boolean
          }
          if (p.migrated === true) {
            await markMigrated()
            send(200, { ok: true, migrated: true })
            return
          }
          const table = String(p.table ?? '')
          if (!isStateTable(table)) {
            send(400, { ok: false, error: `未声明的表 '${table}'` })
            return
          }
          if (domain === null) {
            send(503, { ok: false, error: unavailableReason ?? '持久化域不可用' })
            return
          }
          let written = 0
          let deleted = 0
          if (p.records !== undefined && p.records !== null) {
            for (const [k, v] of Object.entries(p.records)) {
              await statePut(table, k, v)
              written += 1
            }
          }
          if (Array.isArray(p.deletes)) {
            for (const k of p.deletes) {
              if (await stateDelete(table, String(k))) deleted += 1
            }
          }
          if (typeof p.key === 'string' && p.key !== '') {
            if (p.delete === true) {
              if (await stateDelete(table, p.key)) deleted += 1
            } else if (p.value !== undefined && p.value !== null) {
              await statePut(table, p.key, p.value)
              written += 1
            }
          }
          send(200, { ok: true, table, written, deleted })
        } catch (err) {
          lastError = (err as Error)?.message ?? String(err)
          send(500, { ok: false, error: lastError })
        }
      },
    })
    console.log(`[stock-panel] 持久化路由已注册：GET/POST ${STATE_ROUTE}（域 '${STATE_DOMAIN}'）`)
  } catch (err) {
    console.warn('[stock-panel] 持久化路由注册失败：', err)
  }
}
