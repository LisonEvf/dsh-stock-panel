/**
 * src/build-const.d.ts — 两条构建链注入的构建期常量。
 *
 * 注入方式：
 *   - host 半：`tsdown.config.ts` 的 `define`；
 *   - client 半：`scripts/build-client.mjs` 的 esbuild `define`。
 * 取值来源：`scripts/build-id.mjs`（版本号读 package.json；构建 id 是 src 内容哈希）。
 */
/** 插件版本号（= package.json version）。 */
declare const __PANEL_VERSION__: string
/** 确定性构建标识（src 内容哈希前 8 位）；用于检出「浏览器跑着旧构建」。 */
declare const __PANEL_BUILD_ID__: string
