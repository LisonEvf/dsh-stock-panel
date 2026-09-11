// scripts/bundle-css-stub.mjs —— 给「分析类」脚本用的 CSS 桩插件。
//
// 真实构建（scripts/build-client.mjs）把 `./index.css` 解析成虚拟模块，
// 用 postcss+tailwind 编译 `src/index.css.txt` 再压缩内联。分析脚本不想为此跑一条
// 完整的 tailwind 管线（慢且与结论无关），于是用本桩把它替换成一个定长占位串：
// CSS 占比在 bundle 里可单独量（构建日志/体积账里有），分析的重点是 **JS 归因**。

/** 占位串长度：与实测内联 CSS（≈45KB）同量级，避免百分比失真。 */
const CSS_BYTES = 45_600

export function pluginCssStub() {
  return {
    name: 'css-stub',
    setup(b) {
      b.onResolve({ filter: /\.css$/ }, () => ({ path: 'panel-css', namespace: 'css-stub' }))
      b.onLoad({ filter: /.*/, namespace: 'css-stub' }, () => {
        const filler = '/* css stub */'.repeat(Math.ceil(CSS_BYTES / 14)).slice(0, CSS_BYTES)
        return { contents: `export default ${JSON.stringify(filler)}`, loader: 'js' }
      })
    },
  }
}
