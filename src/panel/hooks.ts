/**
 * src/panel/hooks.ts — 盯盘台骨架的小工具 hook（无状态依赖，纯 UI 层）。
 */
import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react'
import { isEditableTarget } from '@/lib/selection'

/** 媒体查询订阅（首帧即返回真实值，避免闪一下再收栏）。 */
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return true
    return window.matchMedia(query).matches
  })
  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return
    const mql = window.matchMedia(query)
    const onChange = (e: MediaQueryListEvent) => setMatches(e.matches)
    setMatches(mql.matches)
    mql.addEventListener('change', onChange)
    return () => mql.removeEventListener('change', onChange)
  }, [query])
  return matches
}

/**
 * 按**容器实测宽度**决定布局（而不是视口宽度）。
 *
 * 为什么骨架级要用它：DSH 里「视口宽、容器窄」是常态 —— 左侧会话栏 + 右侧 AI 栏
 * 都在时，视口 1920px 的面板可用宽度可能只有 600px。行情页（`pages/MarketPage.tsx`）
 * 已经用这条路修过一次（容器 ≥1120 三列 / ≥760 两列），这里把它提升为骨架级约定，
 * 避免每个页面各自踩一遍。
 *
 * 首帧用 `useLayoutEffect` 同步量一次：否则宽度的初值会让布局先按错误档位画一帧。
 * 小于 8px 的变化忽略（避免滚动条/亚像素抖动引起反复重渲染）。
 */
export function useContainerWidth<T extends HTMLElement>(
  ref: RefObject<T | null>,
  epsilon = 8,
): number {
  const [width, setWidth] = useState(0)

  // 首帧同步量一次（useLayoutEffect 在浏览器绘制前运行，不会先按错档位画一帧）。
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const apply = (w: number) => setWidth((prev) => (Math.abs(prev - w) < epsilon ? prev : w))
    apply(el.clientWidth)
    if (typeof ResizeObserver === 'undefined') {
      const onResize = () => apply(el.clientWidth)
      window.addEventListener('resize', onResize)
      return () => window.removeEventListener('resize', onResize)
    }
    const ro = new ResizeObserver((entries) => {
      for (const e of entries) apply(e.contentRect.width)
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [ref, epsilon])

  return width
}

/**
 * 自身顶边到最近滚动祖先可视底边的**可用高度**（px）。
 *
 * 用途：替代 `calc(100vh - 216px)` 这类魔法数 —— 宿主头部高度、字号、提示条都会变，
 * 用视口高度硬减一个常数，换个环境必然错位（实测：宿主字号可调 12–17px）。
 *
 * 关键点：用「相对滚动内容」的偏移量算，而不是 getBoundingClientRect().top ——
 * 后者会随滚动变化，导致「越滚越高」的正反馈。
 */
export function useAvailableHeight<T extends HTMLElement>(
  ref: RefObject<T | null>,
  options: { min?: number; gap?: number } = {},
): number {
  const min = options.min ?? 320
  const gap = options.gap ?? 8
  const [height, setHeight] = useState(0)

  // 用 layout effect：测不到就在首帧按 auto 高度画，会闪一下再撑开。
  useLayoutEffect(() => {
    const el = ref.current
    if (!el || typeof window === 'undefined') return

    // 最近的可纵向滚动祖先（没有就退回视口）
    let scroller: HTMLElement | null = el.parentElement
    while (scroller && scroller !== document.body) {
      const cs = window.getComputedStyle(scroller)
      if (/(auto|scroll|overlay)/.test(cs.overflowY)) break
      scroller = scroller.parentElement
    }

    const measure = () => {
      const host = scroller ?? document.documentElement
      const hostRect = host.getBoundingClientRect()
      const elRect = el.getBoundingClientRect()
      const offsetInContent = elRect.top - hostRect.top + (scroller?.scrollTop ?? 0)
      const avail = Math.max(min, Math.round(host.clientHeight - offsetInContent - gap))
      setHeight((prev) => (Math.abs(prev - avail) < 8 ? prev : avail))
    }

    measure()
    window.addEventListener('resize', measure)
    if (typeof ResizeObserver === 'undefined') return () => window.removeEventListener('resize', measure)
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    if (scroller) ro.observe(scroller)
    return () => {
      ro.disconnect()
      window.removeEventListener('resize', measure)
    }
  }, [ref, min, gap])

  return height
}

/**
 * 半渲染自检 + 自愈：状态带是骨架的第一段（38px，`.dc-strip`）。
 *
 * 实测根因（2026-09-12，真机控制台取证）：
 *   宿主会话列本身是**滚动容器**（`*_scrollBody`，clientHeight 851 / scrollHeight 1192），
 *   本面板长到 983–1006px（比它高）→ 宿主持续把它滚动（scrollTop 318→341→364，每 3s +23px）
 *   → 面板顶边跑到视口上方 242px，**状态带被顶出可视区**；DOM/a11y 树里一切正常，
 *   画面上却"少了一块"。这就是用户报的"界面坏了"。
 *
 * 所以这里做两件事：
 *   1. **判据**：不只看盒子尺寸，还用 `document.elementFromPoint` 取状态带中心点最上层元素 ——
 *      必须还是我们自己的东西（宿主元素压在上面 / 取不到 = 实际不可见）；
 *   2. **自愈**：把宿主滚动容器拨回到"让本面板顶边可见"的位置（只改 scrollTop，
 *      不碰宿主 DOM；配合 AppShell 里给 `.dc-shell` 高度封顶，宿主就没得可滚了）。
 *
 * 治不了时才返回 true（界面给硬刷新入口 + 一条可复制的诊断日志）。
 */
export function useChromeHealth(hostRef: RefObject<HTMLElement | null>, minHeight = 30): boolean {
  const [broken, setBroken] = useState(false)
  const healedRef = useRef(0)

  useEffect(() => {
    if (typeof window === 'undefined') return
    const measure = () => {
      const host = hostRef.current
      if (!host) return
      const el = host.querySelector<HTMLElement>('.dc-strip')
      if (!el) {
        setBroken(true)
        console.warn('[stock-panel] 半渲染自检：找不到 .dc-strip 节点')
        return
      }
      const rect = el.getBoundingClientRect()
      const cs = window.getComputedStyle(el)
      const sized = rect.height >= minHeight && cs.display !== 'none' && cs.visibility !== 'hidden'
      // 中心点采样：最上层元素必须属于本插件（宿主元素压上来 = 我们没被画出来）
      const cx = Math.min(Math.max(rect.left + rect.width / 2, 1), Math.max(1, window.innerWidth - 1))
      const cy = Math.min(Math.max(rect.top + rect.height / 2, 1), Math.max(1, window.innerHeight - 1))
      const top = document.elementFromPoint(cx, cy)
      const ours = top !== null && typeof top.closest === 'function' && top.closest('.dsh-stock') !== null
      const ok = sized && ours

      // 自愈：面板顶边跑到滚动容器上方 → 把容器拨回来（最多 3 次，避免和宿主来回抢）
      if (!ok && healedRef.current < 3) {
        let node: HTMLElement | null = el.parentElement
        while (node && node !== document.body) {
          if (/(auto|scroll|overlay)/.test(window.getComputedStyle(node).overflowY) && node.scrollHeight > node.clientHeight + 1) {
            const shellRect = document.querySelector('.dc-shell')?.getBoundingClientRect()
            const delta = (shellRect?.top ?? rect.top) - node.getBoundingClientRect().top
            if (delta < 0) {
              healedRef.current += 1
              node.scrollTop = Math.max(0, node.scrollTop + delta)
              window.requestAnimationFrame(measure)
              return
            }
            break
          }
          node = node.parentElement
        }
      }

      setBroken(!ok)
      if (!ok) {
        // 用字符串打日志：CDP/控制台里嵌套对象只显示 "Object"，排障读不到数字。
        const scrollChain: string[] = []
        let node: HTMLElement | null = el.parentElement
        while (node && node !== document.body) {
          if (node.scrollHeight > node.clientHeight + 1 || node.scrollTop !== 0) {
            scrollChain.push(`${node.className || node.tagName}[top=${Math.round(node.scrollTop)} h=${Math.round(node.clientHeight)}/${Math.round(node.scrollHeight)}]`)
          }
          node = node.parentElement
        }
        const shellRect = document.querySelector('.dc-shell')?.getBoundingClientRect()
        console.warn(
          '[stock-panel] 半渲染自检失败：状态带不可见（自愈已试 ' +
            healedRef.current +
            ' 次） ' +
            JSON.stringify({
              原因: sized ? '被宿主元素覆盖 / 被祖先裁切 / 负偏移' : '盒子尺寸异常',
              strip: { x: Math.round(rect.left), y: Math.round(rect.top), w: Math.round(rect.width), h: Math.round(rect.height) },
              shell: shellRect ? { y: Math.round(shellRect.top), h: Math.round(shellRect.height) } : null,
              视口: { w: window.innerWidth, h: window.innerHeight, scrollY: Math.round(window.scrollY) },
              采样点最上层: top instanceof Element ? `${top.tagName.toLowerCase()}.${String(top.className).slice(0, 40)}` : String(top),
              滚动祖先: scrollChain.slice(0, 4),
            }),
        )
      }
    }
    let raf1 = window.requestAnimationFrame(() => {
      raf1 = window.requestAnimationFrame(measure)
    })
    // 首帧可能还没完成布局；再补两次迟到检查（含标签页切回来的场景）。
    const t1 = window.setTimeout(measure, 80)
    const t2 = window.setTimeout(measure, 2000)
    // 半渲染可能是**加载后**才发生（宿主滚动 / 迟到重排），所以再加周期性复查。
    // budget-ignore：纯几何测量，不发请求（见 scripts/budget.mjs 的豁免规则）
    const timer = window.setInterval(measure, 3000)
    window.addEventListener('resize', measure)
    document.addEventListener('visibilitychange', measure)
    return () => {
      window.cancelAnimationFrame(raf1)
      window.clearTimeout(t1)
      window.clearTimeout(t2)
      window.clearInterval(timer)
      window.removeEventListener('resize', measure)
      document.removeEventListener('visibilitychange', measure)
    }
  }, [hostRef, minHeight])

  return broken
}

/** 定时 tick（用于相对时间/倒计时/时钟显示）。 */
export function useNow(intervalMs = 1000): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), intervalMs)
    return () => window.clearInterval(timer)
  }, [intervalMs])
  return now
}

/**
 * 全局快捷键。默认在可编辑控件（input/textarea/contenteditable）内不触发，
 * 避免抢走用户的打字与对话输入。
 *
 * ## handler 用 ref 存（审计 UX-PLAN I4）
 *
 * 原实现的依赖数组是 `[enabled, allowInEditable, handler]`，而 `AppShell` 传的是**内联箭头函数**
 * —— 每次渲染都是新引用，于是 `window.addEventListener/removeEventListener` 也每次重绑。
 * 骨架里有 30s 时钟 tick、SWR 轮询、监控订阅都会触发重渲染，等于**每几秒把全局键盘监听
 * 拆装一遍**：中间那一瞬间按下的键会直接丢掉（真机上表现为"偶尔按 j/k 没反应"），
 * 而且没人能从代码上看出来。
 *
 * 所以监听只在 `enabled`/`allowInEditable` 真正变化时重建，键盘回调永远读最新那个
 * （每次渲染后刷新 ref，"行为不变、只是不再重绑"）。
 *
 * `allowInEditable` 的用途：把"输入框内是否放行"交给调用方的**纯函数**判定 ——
 * ⌘K 面板打开时焦点就在面板的 input 里，若这里一律早退，用户永远关不掉面板
 * （审计原文点名的缺陷）。`AppShell` 因此传 `allowInEditable: true`，
 * 由 `resolveHotkey` 按上下文决定放行哪些键。
 */
export function useHotkeys(
  handler: (e: KeyboardEvent) => void,
  options: { enabled?: boolean; allowInEditable?: boolean } = {},
): void {
  const enabled = options.enabled !== false
  const allowInEditable = options.allowInEditable === true

  const handlerRef = useRef(handler)
  // 用 layout effect 刷新（在绘制前）：被动 effect 是"绘制之后"才跑的，中间那一小段
  // 窗口里按下的键会读到上一帧的上下文（例如刚点了"收起左栏"，j/k 却还认为左栏可见）。
  // 不带依赖数组 = 每次渲染后刷新：ref 只被读取，不参与订阅生命周期。
  useLayoutEffect(() => {
    handlerRef.current = handler
  })

  useEffect(() => {
    if (!enabled) return
    const onKey = (e: KeyboardEvent) => {
      if (!allowInEditable && isEditableTarget(e.target)) return
      handlerRef.current(e)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [enabled, allowInEditable])
}
