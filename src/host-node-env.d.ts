/**
 * host 侧最小 Node 环境声明（本包无 @types/node）。
 *
 * 只覆盖 host 半（src/layout-patch.ts 等）实际用到的面，够 tsc --noEmit 用；
 * browser 半（src/client.ts 链）不 import node 模块，不受影响。
 * 若日后引入 @types/node，删掉本文件即可（避免重复声明冲突）。
 */
declare module 'node:fs' {
  export function existsSync(path: string): boolean
  export function readFileSync(path: string, encoding: 'utf8'): string
  export function writeFileSync(path: string, data: string, encoding: 'utf8'): void
  export function mkdirSync(path: string, options: { recursive?: boolean }): string | undefined
  export function copyFileSync(src: string, dest: string): void
  export function realpathSync(path: string): string
}

declare module 'node:path' {
  export function join(...parts: string[]): string
}

declare module 'node:os' {
  export function homedir(): string
}

declare const process: { env: Record<string, string | undefined> }
