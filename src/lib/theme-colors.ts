/**
 * src/lib/theme-colors.ts — 取语义色的**唯一入口**（B2 令牌收口）。
 *
 * 为什么需要：A 股语义色（红涨绿跌）在 22 个文件里被各自重声明成字面量
 * （`const UP = '#c74040'`），于是：
 *   - 暗色下 CSS token 已提亮到 `#e26060`，这些字面量仍是 `#c74040`
 *     （暗底 #232324 上 3.17:1，不达 AA），**同屏两种红**；
 *   - 换色要改 22 处，必然漏。
 *
 * 两种用法：
 *   1. **DOM 内联样式 / Tailwind 任意值**：直接用 CSS 变量字符串（`'var(--dc-up)'`），
 *      由浏览器解析，**自动跟随主题**，零 JS。见 `UP`/`DOWN` 导出。
 *   2. **canvas / 图表库配置**：lightweight-charts 等把颜色画进 canvas，解析不了 CSS 变量，
 *      必须给具体色值 → 用 `themeColor('up')`（带缓存 + 主题变化失效）。
 *
 * 主题变化监听：宿主通过 `body[data-ds-dark-theme]` 切换明暗，这里用 MutationObserver
 * 在切换时清缓存，图表侧（`chart-theme.ts`）据此重绘 —— 修「切主题图表不变色」。
 */

/** DOM 用：CSS 变量字符串（浏览器解析、自动跟随主题）。 */
export const UP = 'var(--dc-up)'
export const DOWN = 'var(--dc-down)'
export const FLAT = 'var(--dc-flat)'
/** 低透明度底色（标签/徽标底），由 color-mix 从语义色派生，不写死 alpha。 */
export const UP_SOFT = 'var(--dc-up-soft)'
export const DOWN_SOFT = 'var(--dc-down-soft)'

/** canvas / 图表用：语义 token 名。 */
export type SemanticColor =
  | 'up'
  | 'down'
  | 'flat'
  | 'warn'
  | 'danger'
  | 'success'
  | 'accent'
  | 'text'
  | 'text-2'
  | 'text-3'
  | 'dim'
  | 'border'
  | 'border-strong'
  | 'layer-1'
  | 'layer-2'
  | 'layer-3'
  | 'bg'
  | 'track'

/** 兜底值（宿主没挂 token 或读取失败时）——与 src/index.css.txt 的 fallback 保持一致。 */
const FALLBACK: Record<SemanticColor, string> = {
  up: '#c74040',
  down: '#2d9b65',
  flat: '#64748b',
  warn: '#d97706',
  danger: '#dc2626',
  success: '#16a34a',
  accent: '#10b981',
  text: '#0f172a',
  'text-2': '#475569',
  'text-3': '#64748b',
  dim: '#94a3b8',
  border: '#e2e8f0',
  'border-strong': '#cbd5e1',
  'layer-1': '#ffffff',
  'layer-2': '#f8fafc',
  'layer-3': '#f1f5f9',
  bg: '#ffffff',
  track: 'rgba(15, 23, 42, 0.12)',
}

const cache = new Map<SemanticColor, string>()
let observer: MutationObserver | null = null
let watched: HTMLElement | null = null

/** 主题切换（宿主改 body 属性）时清缓存。 */
function ensureObserver(): void {
  if (observer !== null || typeof window === 'undefined' || typeof MutationObserver === 'undefined') return
  const target = document.body
  if (target === null) return
  watched = target
  observer = new MutationObserver(() => cache.clear())
  observer.observe(target, { attributes: true, attributeFilter: ['data-ds-dark-theme', 'class', 'style'] })
}

/** 所有 DOM 变化的订阅（图表侧用：主题变化 → 重新 applyOptions）。 */
export function subscribeThemeChange(fn: () => void): () => void {
  if (typeof window === 'undefined' || typeof MutationObserver === 'undefined') return () => {}
  const mo = new MutationObserver(fn)
  if (document.body !== null) {
    mo.observe(document.body, { attributes: true, attributeFilter: ['data-ds-dark-theme', 'class'] })
  }
  return () => mo.disconnect()
}

/** 取语义色的具体色值（canvas / 图表配置用）。 */
export function themeColor(name: SemanticColor): string {
  if (typeof window === 'undefined' || typeof document === 'undefined') return FALLBACK[name]
  const hit = cache.get(name)
  if (hit !== undefined) return hit
  ensureObserver()
  let value = ''
  try {
    // token 定义在插件根 `.dsh-stock` 上（见 index.css.txt §1）
    const host = document.querySelector('.dsh-stock') ?? document.documentElement
    value = window.getComputedStyle(host).getPropertyValue(`--dc-${name}`).trim()
    // color-mix() 在 computed style 里可能拿不到最终色值 → 退到临时元素上实测
    if (value === '' || value.startsWith('color-mix')) value = resolveViaProbe(`--dc-${name}`)
  } catch {
    value = ''
  }
  const out = value === '' ? FALLBACK[name] : value
  cache.set(name, out)
  return out
}

/** 把 CSS 变量套到一个临时元素上，让浏览器算出最终色值（color-mix 等函数值需要）。 */
function resolveViaProbe(varName: string): string {
  try {
    const probe = document.createElement('span')
    probe.style.cssText = `position:absolute;left:-9999px;top:-9999px;color:var(${varName})`
    const host = document.querySelector('.dsh-stock') ?? document.body
    if (host === null) return ''
    host.appendChild(probe)
    const out = window.getComputedStyle(probe).color
    probe.remove()
    return out === '' || out === 'rgba(0, 0, 0, 0)' ? '' : out
  } catch {
    return ''
  }
}

/** `#rrggbb` / `rgb(...)` / `rgba(...)` → [r,g,b]（canvas 渐变/填充用）。 */
export function themeRgb(name: SemanticColor): [number, number, number] {
  return toRgb(themeColor(name), FALLBACK[name])
}

function toRgb(value: string, fallback: string): [number, number, number] {
  const rgb = parseRgb(value) ?? parseRgb(fallback)
  return rgb ?? [199, 64, 64]
}

function parseRgb(value: string): [number, number, number] | null {
  const hex = value.trim().match(/^#([0-9a-f]{6})$/i)
  if (hex !== null) {
    const n = parseInt(hex[1], 16)
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
  }
  const short = value.trim().match(/^#([0-9a-f]{3})$/i)
  if (short !== null) {
    const [r, g, b] = short[1].split('').map((c) => parseInt(c + c, 16))
    return [r, g, b]
  }
  const fn = value.match(/rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)/i)
  if (fn !== null) return [Math.round(Number(fn[1])), Math.round(Number(fn[2])), Math.round(Number(fn[3]))]
  return null
}

/** 测试/调试用：清缓存。 */
export function clearThemeColorCache(): void {
  cache.clear()
}

/** 已监听的宿主节点（诊断用）。 */
export function themeColorWatchTarget(): HTMLElement | null {
  return watched
}
