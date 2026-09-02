# @tickflow/dsh-stock-panel

A股量化工作台 —— DSH Web 插件（details 右侧面板）。

这是 `tickflow-stock-panel` 的**增量迁移**目标：以 DSH Web 插件的形式，把最重的「K 线图表 + 个股分析」迁进 DeepSeek Harness 的 Web UI，后端保持不变，数据通过 API 请求获取。

## 目录

```
frontend-dsh/
├── package.json          # dsh.client manifest + tsdown build
├── tsdown.config.ts      # rolldown 构建配置
├── tsconfig.json
├── tailwind.config.js / postcss.config.js
├── src/
│   ├── client.ts         # 插件入口：apply(ctx) 注册 details slot
│   ├── index.ts          # 默认导出 + css 暴露
│   ├── index.css.txt     # Tailwind 样式（.txt 后缀绕过 rolldown CSS 管线）
│   ├── pages/
│   │   └── StockDetailPage.tsx   # details 面板容器
│   └── vite-env.d.ts
└── lib/                  # 构建输出（gitignore）
```

## 技术要点（踩坑记录）

- **构建工具**：用 `tsdown`（基于 rolldown）。rolldown 1.2.x **已移除 CSS bundling**，也不支持 Vite 的 `?inline` 后缀。
  - 解决方案：把 `index.css` 重命名为 `index.css.txt`，用一个最小 rolldown 插件（`tsdown.config.ts` 里的 `cssAsString`）在 `resolveId` 阶段重定向并在 `load` 阶段读成字符串导出。
- **rolldown 版本**：`platform` 只接受 `browser`/`node`/`neutral`，web 插件用 `browser`。
- **依赖**：内部 `@deepseek-ai/dsh-client-*` 包**不在 npm**，仅来自 DSH 检出（运行时由宿主注入），因此**只列为 `dsh.client.inject`，不进 dependencies/peerDependencies**。
- **单模块约束**：dsh.client bundle 必须是单模块（flat module graph），所有第三方依赖走 `dsh.client.external`，由 host 扫描注入。

## 构建

```bash
cd frontend-dsh
pnpm install
pnpm build        # 输出到 lib/（client.js / index.js / *.d.ts）
```

## 本地加载（overlay，无需发布）

插件构建产物在 `lib/`。DSH 在启动时扫描 `dsh.client` 包并注入到 Cordis 插件图。本地开发加载方式：

1. 确保 `lib/client.js` 已构建（见上）。
2. 在 `.dsh/settings.yaml` 的插件配置中登记本插件（`inject` 列出运行时服务）。
3. 重启 DSH（或热加载），在会话右侧 details 面板即可看到「股票工作台」入口。

> 具体的 settings 键名与加载流程以官方 [publish.md](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/user/develop/basic/publish.md) 为准。若你的 DSH 版本支持 overlay 目录，可将 `lib/` 软链/映射到插件扫描目录后重启即可。

## 迁移路线

- **M0（当前）**：插件骨架打通 —— 注册 details slot，渲染占位面板，验证「打包 → 加载 → 渲染」全链路。✅
- **M1**：接入 lightweight-charts 日 K + 分时图 + `api.ts`，渲染真实 K 线。
- **M2**：迁入 `StockPanel` / 信息条 / 关键价位 / ECharts 分析图。
- **M3**：用同一骨架扩展 Screener / Monitor / Backtest。
