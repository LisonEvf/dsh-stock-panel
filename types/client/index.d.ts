// 由 scripts/postbuild-dts.mjs 自动生成，勿手改。
// client 半由 rolldown 构建（无 .d.ts），这里声明 dsh.client 包契约面。

/** 运行时由 @deepseek-ai/dsh-client-runtime 提供的 ctx。 */
export type DshClientCtx = any;

/** dsh.client 包契约：apply 注册 UI，inject 声明所需 service 名。 */
export interface ClientPluginModule {
  apply: (ctx: DshClientCtx) => void
  inject: string[]
}

export declare const apply: (ctx: DshClientCtx) => void
export declare const inject: string[]
