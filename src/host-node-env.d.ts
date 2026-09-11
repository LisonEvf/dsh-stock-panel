/**
 * host 侧最小 Node 环境声明（本包无 @types/node）。
 *
 * 只声明 host/client 两半共用的**唯一** Node 全局：`process`
 * （`src/lib/endpoints.ts` 的 `envGet()` 用 `typeof process === 'undefined'` 守卫后读 env）。
 *
 * v1.2 起界面注入改走官方槽位，`src/layout-patch.ts` 已删除，随之不需要
 * `node:fs` / `node:path` / `node:os` 的模块声明（内置 TDX 走 vendor 的
 * `src/host/vendor/opentdx.js`，是未被 tsc 收录的 .js 产物）。
 * 若日后引入 @types/node，删掉本文件即可（避免重复声明冲突）。
 */

declare const process: { env: Record<string, string | undefined> }
