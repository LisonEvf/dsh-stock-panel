export { apply, type StockPanelContract } from './client'

/**
 * 暴露插件样式字符串。宿主在挂载插件前可将其注入 <style>。
 * 导入 .css.txt（经 tsdown 插件读成字符串），
 * 避免 rolldown 的 CSS bundling 与 Vite ?inline 语法冲突。
 */
import rawCss from './index.css.txt'
export const css = rawCss
