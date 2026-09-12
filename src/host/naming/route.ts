/**
 * src/host/naming/route.ts —— 命名 HTTP 桥接（A2b-②）。
 *
 *   GET  /api/stock-panel/naming   → 能力与口径（模型可用性 / 提示词版本 / 默认参数 / 缓存规模）
 *   POST /api/stock-panel/naming   → { classId, asOf?, window?, minCorr?, poolN?, windowDays?, refresh? }
 *
 * 为什么 GET 要回"口径"而不只是 available：命名的结论**依赖四个聚类参数**，
 * 同一只票在不同参数下可能属于不同的类（`docs/CONCEPT-CALIBRATION.md` 实测）。
 * 界面必须能把参数显示出来，否则结论不可复现 —— 所以参数由 host 半给出，不由前端各自硬编码。
 *
 * 路由只做参数校验与转发；策略（弱链拒绝、缓存、护栏）全在 `run.ts`，两侧共用同一实现。
 */
import { NAMING_ROUTE } from '../../lib/endpoints'
import { readJsonBody } from '../../host-ai'
import {
  DEFAULT_NAMING_PARAMS,
  nameClass,
  namingAvailability,
  namingCacheStats,
  clearNamingCache,
  type NamingRuntime,
} from './run'
import { DEFAULT_NAMING_GUARD } from './types'
import { NAMING_PROMPT_VERSION } from './fingerprint'
import { DEFAULT_COLLECT } from './collect'

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
              defaults: DEFAULT_NAMING_PARAMS,
              guard: DEFAULT_NAMING_GUARD,
              collect: { perStockQuota: DEFAULT_COLLECT.perStockQuota, maxChars: DEFAULT_COLLECT.maxChars },
              cache: namingCacheStats().size,
              today: rt.today ?? null,
            })
            return
          }

          const body = (await readJsonBody(req)) as Record<string, unknown>
          if (body === null || typeof body !== 'object') {
            send(res, 400, { ok: false, error: 'body 需要 {"classId": number}' })
            return
          }
          // 显式清缓存（调试用；不放进默认路径，避免误触）
          if (body.clearCache === true) {
            clearNamingCache()
            send(res, 200, { ok: true, cleared: true })
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
