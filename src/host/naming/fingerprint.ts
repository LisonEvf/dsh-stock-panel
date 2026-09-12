/**
 * src/host/naming/fingerprint.ts —— 命名缓存指纹（A2b，移植自 `cluster-namer/pipeline.py`）。
 *
 * 为什么必须带指纹：换模型 / 换窗口 / 换源集合后，旧结论**看起来仍然有效**
 * （同一类、同一天、同样的证据引文），但它其实是另一个口径下的产物 ——
 * 这类静默复用比缓存穿透危险得多（参考实现 docs/03 §6）。
 *
 * 指纹只用**口径参数**，不含时间戳：同一口径下重跑应当命中缓存；
 * 也刻意不含 `classId/asOf`（它们已经是缓存键的一部分，进了指纹只是重复）。
 *
 * 为什么不用 `node:crypto`：本仓库的 `tsconfig` 不引 `@types/node`（client 与 host 共用一份配置，
 * 引了会把浏览器侧也拖进 node 类型），而指纹只需要**稳定 + 分散**，不需要密码学强度 ——
 * 用 FNV-1a 64 位（纯 TS、无依赖）。碰撞概率对"一台机器每天几十个类"可忽略；
 * 若将来指纹要用于跨机器共享缓存，必须重新评估这个取舍。
 */

export interface FingerprintInput {
  provider: string
  /** 配置里的模型名。 */
  model: string
  /** 客户端自报的实际模型版本（换客户端也要失效）。 */
  clientVersion?: string
  windowDays: number
  /** 启用中的素材源（顺序无关）。 */
  sources: string[]
  /** 提示词版本：改提示词必须让缓存失效（否则新旧提示词的结论会混在一起）。 */
  promptVersion: string
  /** 护栏阈值也进指纹：阈值变了，同一份素材的结论可能不同。 */
  guard: Record<string, number | boolean>
}

/** 当前提示词版本（改 `prompt.ts` 的 `NAMING_SYSTEM_PROMPT` 时必须 +1）。 */
export const NAMING_PROMPT_VERSION = 'a2b-1'

export function namingFingerprint(input: FingerprintInput): string {
  const payload = {
    provider: input.provider,
    model: input.model,
    client_version: input.clientVersion ?? '',
    window_days: input.windowDays,
    sources: [...input.sources].sort(),
    prompt_version: input.promptVersion,
    guard: sortedObject(input.guard),
  }
  return fnv1a64(JSON.stringify(payload))
}

/** 固定键序，保证同内容指纹稳定（对象字面量顺序不该影响缓存命中）。 */
function sortedObject(obj: Record<string, number | boolean>): Record<string, number | boolean> {
  const out: Record<string, number | boolean> = {}
  for (const k of Object.keys(obj).sort()) out[k] = obj[k]
  return out
}

const FNV_OFFSET = 0xcbf29ce484222325n
const FNV_PRIME = 0x100000001b3n
const MASK64 = 0xffffffffffffffffn

/** FNV-1a 64 位（按 UTF-8 字节），返回 16 位十六进制。 */
export function fnv1a64(text: string): string {
  let hash = FNV_OFFSET
  const bytes = utf8Bytes(text)
  for (const b of bytes) {
    hash ^= BigInt(b)
    hash = (hash * FNV_PRIME) & MASK64
  }
  return hash.toString(16).padStart(16, '0')
}

/** UTF-8 编码（不依赖 TextEncoder：host/client 同构，且避免 polyfill 差异）。 */
function utf8Bytes(text: string): number[] {
  const out: number[] = []
  for (const ch of text) {
    let cp = ch.codePointAt(0) as number
    if (cp < 0x80) {
      out.push(cp)
    } else if (cp < 0x800) {
      out.push(0xc0 | (cp >> 6), 0x80 | (cp & 0x3f))
    } else if (cp < 0x10000) {
      out.push(0xe0 | (cp >> 12), 0x80 | ((cp >> 6) & 0x3f), 0x80 | (cp & 0x3f))
    } else {
      // for..of 已把代理对合并成一个码点；这里处理 >0xFFFF 的补充平面字符
      out.push(
        0xf0 | (cp >> 18),
        0x80 | ((cp >> 12) & 0x3f),
        0x80 | ((cp >> 6) & 0x3f),
        0x80 | (cp & 0x3f),
      )
    }
  }
  return out
}
