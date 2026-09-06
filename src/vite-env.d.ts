/**
 * 客户端构建期类型。
 *
 * 注意：不引用 `vite/client`——它的 `*.css` 是「空模块」声明（无 default 导出），
 * 会让 `import panelCss from './index.css'` 的默认导入类型变成模块命名空间，
 * 赋给 string 时 tsc 报错。本包该导入在构建期由 cssAsString / build-client.mjs
 * 改写为 CSS 字符串，故在此给出真实形状。
 */
declare module '*.css' {
  const css: string
  export default css
}

interface ImportMetaEnv {
  readonly VITE_API_BASE?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
