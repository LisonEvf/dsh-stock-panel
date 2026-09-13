/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  /**
   * preflight 必须关闭（B1，2026-09-12）。
   *
   * 为什么：本插件的编译后 CSS 是注入**宿主 `<head>`** 的（`src/client.ts`
   * injectPanelStyles），而 preflight 是全局样式 —— 打开它等于用
   * `*{border-width:0}`、`button{background-color:transparent}` 这类
   * 元素级选择器去改 DSH shell 的 DOM。宿主不用 Tailwind（组件样式是 CSS Modules，
   * 见官方 web-styling 规范），这些规则不是它该承受的。
   *
   * 插件自身的渲染不受影响：`src/index.css.txt` §8 有一份**作用域版 preflight**
   * （只用 `:where()` 把特异性压到 0），逐条补回 preflight 里会影响插件的元素规则。
   * 改这里时必须两处一起看。
   */
  corePlugins: {
    preflight: false,
  },
  theme: {
    /**
     * 设计令牌（B2 收口）。**为什么要有这一层**：实测全仓字号 17 档、圆角 9 档，
     * 光靠"随手写 text-[11px]"没有约束；语义色则散在 22 个文件里各自写字面量。
     * 这里把「字号 6 档 / 圆角 4 档 / 语义色」变成可枚举的类名：
     *   - 字号：text-dc-10 / text-dc-11 / text-dc-12 / text-dc-14 / text-dc-18 / text-dc-20
     *   - 圆角：rounded-dc-sm|md|lg|xl
     *   - 语义色：text-dc-up / text-dc-down / text-dc-ok / text-dc-bad / text-dc-warn / text-dc-info
     *            bg-dc-up-soft / bg-dc-down-soft，以及 dc-text / dc-text-3 / dc-dim / dc-border…
     * 颜色一律指向 `src/index.css.txt` 的 `--dc-*` 变量 → 明暗主题自动跟随，
     * 不在 Tailwind 里复制色值（复制就会出现"两套红"）。
     */
    extend: {
      fontSize: {
        'dc-10': ['10px', '14px'],
        'dc-11': ['11px', '15px'],
        'dc-12': ['12px', '1.45'],
        'dc-14': ['14px', '1.4'],
        'dc-18': ['18px', '1.25'],
        'dc-20': ['20px', '1.2'],
      },
      borderRadius: {
        'dc-sm': '4px',
        'dc-md': '6px',
        'dc-lg': '8px',
        'dc-xl': '10px',
      },
      colors: {
        'dc-up': 'var(--dc-up)',
        'dc-down': 'var(--dc-down)',
        'dc-flat': 'var(--dc-flat)',
        'dc-up-soft': 'var(--dc-up-soft)',
        'dc-down-soft': 'var(--dc-down-soft)',
        'dc-ok': 'var(--dc-success)',
        'dc-bad': 'var(--dc-danger)',
        'dc-warn': 'var(--dc-warn)',
        'dc-info': 'var(--dc-accent)',
        'dc-text': 'var(--dc-text)',
        'dc-text-2': 'var(--dc-text-2)',
        'dc-text-3': 'var(--dc-text-3)',
        'dc-dim': 'var(--dc-dim)',
        'dc-border': 'var(--dc-border)',
        'dc-layer-1': 'var(--dc-layer-1)',
        'dc-layer-2': 'var(--dc-layer-2)',
        'dc-layer-3': 'var(--dc-layer-3)',
        'dc-track': 'var(--dc-track)',
      },
    },
  },
  plugins: [require('tailwindcss-animate')],
}
