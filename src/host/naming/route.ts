/**
 * src/host/naming/route.ts —— 命名 HTTP 桥接（A2b-②）。
 *
 *   GET  /api/stock-panel/naming   → 能力与口径（模型可用性 / 提示词版本 / 默认参数 / 批量预算 / 缓存规模）
 *   POST /api/stock-panel/naming   → 单类：{ classId, asOf?, window?, minCorr?, poolN?, windowDays?, refresh? }
 *                                    批量：{ all: true } 或 { classIds: [..] }（+ 同样的可选参数）
 *
 * 批量是**类列表的默认路径**：打开页面就要看到每个班的名字，逐类调用等于十次模型请求，
 * 且模型看不到组间区别（会把"铜"和"铝"都叫成"有色金属"）。批量与单类共用同一张 per-class 缓存，
 * 但提示词版本不同（`NAMING_BATCH_PROMPT_VERSION`），所以两种问法的结论不会互相当成缓存命中。
 *
 * 为什么 GET 要回"口径"而不只是 available：命名的结论**依赖四个聚类参数**，
 * 同一只票在不同参数下可能属于不同的类（`docs/CONCEPT-CALIBRATION.md` 实测）。
 * 界面必须能把参数显示出来，否则结论不可复现 —— 所以参数由 host 半给出，不由前端各自硬编码。
 *
 * 路由只做参数校验与转发；策略（弱链拒绝、缓存、护栏、分批）全在 `run.ts`，两侧共用同一实现。
 */
import { NAMING_ROUTE } from '../../lib/endpoints'
import { readJsonBody } from '../../host-ai'
import {
  DEFAULT_BATCH,
  DEFAULT_NAMING_PARAMS,
  nameClass,
  nameClasses,
  namingAvailability,
  namingCacheStats,
  clearNamingCache,
  type NamingRuntime,
} from './run'
import { DEFAULT_NAMING_GUARD } from './types'
import { NAMING_BATCH_PROMPT_VERSION, NAMING_PROMPT_VERSION } from './fingerprint'
import { DEFAULT_COLLECT, newsSourceEnabled } from './collect'

type WebServerLike = {
  register: (route: {
    kind: 'exact' | 'prefix'
    path: string
    handler: (req: unknown, res: unknown) => void | Promise<void>
  }) => () => void
}

function send(res: unknown, status: number, payload: unknown): void {
  const w = res as {
    setHeader?: (k: string, v: string) => void
    end: (b: string) => void
    statusCode?: number
  }
  if (w.setHeader) {
    w.statusCode = status
    w.setHeader('Content-Type', 'application/json')
  }
  w.end(JSON.stringify(payload))
}

/** 数值参数（越界/非数字一律当作未传，不猜）。 */
function num(v: unknown): number | undefined {
  if (v === undefined || v === null || v === '') return undefined
  const n = Number(v)
  return Number.isFinite(n) ? n : undefined
}

/**
 * 注册命名桥接。`getRuntime` 每次请求求值：宿主服务可能晚于本插件就绪
 * （与 AI 桥接同一立场，惰性解析避免注册期拿不到 ctx.llm）。
 */
export function registerNamingBridge(webServer: WebServerLike, getRuntime: () => NamingRuntime): void {
  try {
    webServer.register({
      kind: 'exact',
      path: NAMING_ROUTE,
      handler: async (req, res) => {
        try {
          const rt = getRuntime()
          if ((req as { method?: string })?.method === 'GET') {
            send(res, 200, {
              ok: true,
              ...namingAvailability(rt),
              promptVersion: NAMING_PROMPT_VERSION,
              batchPromptVersion: NAMING_BATCH_PROMPT_VERSION,
              defaults: DEFAULT_NAMING_PARAMS,
              guard: DEFAULT_NAMING_GUARD,
              collect: {
                perStockQuota: DEFAULT_COLLECT.perStockQuota,
                maxChars: DEFAULT_COLLECT.maxChars,
                // 快讯源是唯一会出网到非通达信的源：口径与开关必须能被界面与诊断看到
                newsPages: DEFAULT_COLLECT.newsPages,
                newsEnabled: newsSourceEnabled(),
              },
              batch: { maxClasses: DEFAULT_BATCH.maxClasses, maxMembersPerCall: DEFAULT_BATCH.maxMembersPerCall },
              cache: namingCacheStats().size,
              today: rt.today ?? null,
            })
            return
          }

          const body = (await readJsonBody(req)) as Record<string, unknown>
          if (body === null || typeof body !== 'object') {
            send(res, 400, { ok: false, error: 'body 需要 {"classId": number} 或 {"all": true}' })
            return
          }
          // 显式清缓存（调试用；不放进默认路径，避免误触）
          if (body.clearCache === true) {
            clearNamingCache()
            send(res, 200, { ok: true, cleared: true })
            return
          }
          /**
           * 批量路径（类列表默认走它）：`{all:true}` = 全部可采信类，
           * `{classIds:[..]}` = 指定几组。两者都不需要 classId。
           */
          const batch = body.all === true || Array.isArray(body.classIds)
          if (batch) {
            const ids = Array.isArray(body.classIds)
              ? body.classIds.map((v) => num(v)).filter((v): v is number => v !== undefined && v > 0)
              : undefined
            if (Array.isArray(body.classIds) && (ids ?? []).length === 0) {
              send(res, 400, { ok: false, error: 'classIds 必须是非空的正整数数组' })
              return
            }
            const outcome = await nameClasses(rt, {
              ...(ids !== undefined ? { classIds: ids } : {}),
              asOf: typeof body.asOf === 'string' ? body.asOf : undefined,
              window: num(body.window),
              minCorr: num(body.minCorr),
              poolN: num(body.poolN),
              windowDays: num(body.windowDays),
              maxClasses: num(body.maxClasses),
              maxMembersPerCall: num(body.maxMembersPerCall),
              refresh: body.refresh === true,
            })
            send(res, 200, outcome)
            return
          }
          const classId = num(body.classId)
          if (classId === undefined || classId <= 0) {
            send(res, 400, { ok: false, error: `classId 必须是正整数（收到 ${JSON.stringify(body.classId)}）` })
            return
          }
          const outcome = await nameClass(rt, {
            classId,
            asOf: typeof body.asOf === 'string' ? body.asOf : undefined,
            window: num(body.window),
            minCorr: num(body.minCorr),
            poolN: num(body.poolN),
            windowDays: num(body.windowDays),
            refresh: body.refresh === true,
          })
          send(res, 200, outcome)
        } catch (err) {
          send(res, 500, { ok: false, error: (err as Error)?.message ?? String(err) })
        }
      },
    })
    console.log(`[stock-panel] 命名桥接已注册：${NAMING_ROUTE}`)
  } catch (err) {
    console.warn('[stock-panel] 命名桥接注册失败：', err)
  }
}
