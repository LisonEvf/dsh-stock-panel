# CHANGELOG

> 本文件于 **2026-09-12 补齐**（此前 MISSING，1.1.0 → 1.3.0 的变更无法追溯）。
> 记录规则：**每批一次原子提交 + 一条 CHANGELOG**；版本号**单一来源 = `package.json`**；文档只写批次/版本名，不复制绝对数字（体积、工具数、超时由脚本输出）。
> **定版流程（1.5.0 起）**：批次累积时先写成 `[未发布]`，发布时① `package.json` 升版 → ② 本节加 `## [x.y.z] 日期` 并把该批 `[未发布]` 段落降为 `###` 小节 → ③ `pnpm build && pnpm test && pnpm guard` → ④ 提交 + `git tag -a vx.y.z` → ⑤ `pnpm publish`（registry = GitHub Packages，见 `package.json` 的 `publishConfig`）。
>
> ⚠️ **版本号历史遗留（1.4.0 已收口）**：2026-09-12 之前提交标签写到 `1.1.0`，`package.json` 在工作区被改成 `1.3.0`（长期未提交），而 README 用 v1.2/v1.3/v1.4 描述界面迭代。**2026-09-12 起** v1.2/v1.3/v1.4 合并为 `1.4.0` 一次发布，版本号单一来源 = `package.json`。**1.5.0（2026-09-13）**首次真正发到 registry，并补上 `v1.5.0` tag。
>
> ⚠️ **第 ⑤ 步的坑（2026-09-14 实测，已修）**：`package.json` 里那个名为 **`publish`** 的 script 会被当作 **npm 生命周期钩子** —— `pnpm publish` 成功发完之后，它还会再跑一次 `npm publish`，于是控制台紧跟一条红色
> `EPUBLISHCONFLICT: You cannot publish over the previously published versions: x.y.z`。**版本其实已经发出去了**，
> 别被这条错吓到、也别随手改版本号重发：用 `npm view <pkg>@x.y.z --registry=https://npm.pkg.github.com/` 看有没有该版本、
> 必要时 `npm pack` 解包与本地 `lib/` 逐字节比对（本次即如此确认：published `lib/client.js` 与本地 sha256 前缀一致）。
> 该 script 已改名 **`publish:github`**（不再是生命周期名），`pnpm publish` 从此干净退出。

---

## [未发布]

**安装路径实测（三条路都跑过一遍）** —— 一条命令零配置的那条已配置就绪（Release 资产）

> 触发：用户先问「通过 registry 安装是否可行、是不是要额外 npmrc；如果不用，能不能 `dsh plugin --profile web add github:LisonEvf/dsh-stock-panel#main` 一键装」，
> 再问「**怎么能让用户一键安装**」。
> 全部结论都是**真机跑出来的**（不是读文档推的）：各自装了包、起了实例、在真浏览器里确认视图注册。细节写进 `README.md` §安装。

### 2026-09-14 · 一键安装：把发布产物挂成 Release 资产（**一条命令、零配置、零凭证**）
- 现状：`@lisonevf/dsh-stock-panel` 在 **GitHub Packages**，而那个源**读也要 token** → 无论怎么写，用户都得先配 `~/.npmrc`；
  `github:#main` 那条路则要现场构建，被 pnpm 的 allowBuilds 闸门挡住（见下）。**两条都不是"一键"**。
- 做法：把 **registry 上那份 1.6.0 tarball**（`npm pack` 下载，shasum 与 registry 的 `dist.shasum` 一致）挂成 `v1.6.0` 的 Release 资产。
  tarball 是**已构建产物** → pnpm 直接用、**不执行任何构建脚本** → 不需要 token、不需要 allowBuilds，dsh 照样按真实包名 reconcile 进 `dsh.profile.bundles`。
- **一键命令**（真机验证：全新 `DSH_HOME`、空 profile、零配置）：
  `dsh plugin --profile web add https://github.com/LisonEvf/dsh-stock-panel/releases/download/v1.6.0/lisonevf-dsh-stock-panel-1.6.0.tgz`
  → 装到的 `lib/client.js` 与 Release 资产**逐字节一致**（sha256 `8ad3fc00…`）、`bundles` 变 `[dsh-base, @lisonevf/dsh-stock-panel]`、
  版本 1.6.0；Release 正文里也写了这条命令。
- **第二条一键路径**（跟 main 走、不改配置文件）：`--config.dangerouslyAllowAllBuilds=true` 由 dsh 原样转发给 pnpm，当场放行构建脚本闸门 ——
  `dsh plugin --profile web add github:LisonEvf/dsh-stock-panel#main --config.dangerouslyAllowAllBuilds=true`（实测通过，代价：每次安装现场构建 ~50s）。
- **还差一步才能"最短命令"**：`dsh plugin --profile web add @lisonevf/dsh-stock-panel`（零配置）要求包同时在**公共 npmjs** 上
  （`@lisonevf` scope 在 npmjs 目前是空的、公开包免费）。这属于发布渠道决策：要 npmjs 账号登录后才能做，**未做**。

### 2026-09-14 · registry 安装：可行，但**认证是硬要求**（公开包也一样）
- 干净环境实测三档：不配 scoped 源 → 404（默认 registry=npmjs，那里没有本包）；只配 `@lisonevf:registry=https://npm.pkg.github.com/`、不带 token → **`E401 authentication token not provided`**；配上 `_authToken` → 通过。故 `.npmrc` 两行是必须的（token 用 classic PAT，勾 `read:packages`）。
- **端到端验证**（不是"装上了就算"）：把 `DSH_HOME` 指到一个**全新临时家目录**模拟另一台机器 → `dsh plugin --profile web add @lisonevf/dsh-stock-panel@1.6.0` → profile 的 `dsh.profile.bundles` 自动变 `[dsh-base, dsh-web-app, @lisonevf/dsh-stock-panel]` → `dsh web` 起得来（host 半把 TDX 桥接 / build 路由 / 持久化域 12 张表 / 对话工具 ×8 / AI 桥接 / 命名桥接全注册上）→ 真浏览器里 `viewRegistered: true`、`version 1.6.0`、19 个内置工具、console 0 报错。
- 顺带确认：registry 装的是**已构建产物**（tarball 里带 `lib/`），所以**不跑构建脚本**、不需要任何 allowlist。

### 2026-09-14 · GitHub 直装：不需要 token，但**首次必然失败一次**
- `dsh plugin --profile web add github:LisonEvf/dsh-stock-panel#main` 在全新 profile 上实测报
  `ERR_PNPM_GIT_DEP_PREPARE_NOT_ALLOWED` —— 这条路要**现场构建**（`prepare` 跑 `pnpm build`），而 pnpm 默认拦 git 依赖的构建脚本；
  dsh 自己也会把该补的 key 与做法打出来（`runPlugin()` 的 git 分支，见 `@deepseek-ai/dsh` 的 `lib/plugin-*.js`）。
- 补进 **profile 的** `pnpm-workspace.yaml` 后重跑即成功（实测装出来的 `lib/client.js` 与本地构建同为 667,371 字节）。
- ⚠️ 三条值得记住的实测结论：① 那把 key **精确到 commit**（`'@lisonevf/dsh-stock-panel@https://codeload.github.com/.../tar.gz/<sha>'`）—— 只写**包名**、`'@lisonevf/*'`、codeload URL **通配都不认**，所以 main 每推一次要重加一把；② 免维护的写法是 `dangerouslyAllowAllBuilds: true`（放行范围更大）；③ **`#v1.6.0` 装不上** —— 那个提交里 `publish` 脚本还在，pnpm 的 prepare 会把它当生命周期钩子一起跑 → `npm publish` 失败（这正是本版把它改名 `publish:github` 的原因）。**git 安装用 `#main`**。

### 2026-09-14 · 顺带修掉两个"自己会踩自己"的地方
- **构建 id 含 `package.json`**（`scripts/build-id.mjs` 的 `HASH_FILES`）：发布后只改了 `package.json` 的脚本名、没重新 `build` → `verify-live` 立刻报「构建 id 不一致（运行 fd545a63 / 源码 ce1cf6f6）→ 请重启 dsh web」，而**真正该做的是 `pnpm build`**。已在 `scripts/verify-live.mjs` 头部把这条写清（并说明：拿本地工作树当基准，对 registry 安装的实例报不一致属预期），`README.md` §安装 同步。
- 本地 `lib/` 已按当前源码重建（id = `ce1cf6f6`），`build-client --check` / 体积护栏 665KB / 28 文件单测 / lint 复验全绿。

---

## [1.6.0] 2026-09-14

**重点页专项 + 作战板块重做** —— 作战思路改由模型给结论（以其他板块为素材）；自挖板块修掉字段名事故 + 分类命名三项补强 + 版面重做；行情页重新组合

> 发布物：`@lisonevf/dsh-stock-panel@1.6.0`（registry = GitHub Packages）+ git tag `v1.6.0`。
> **发布已确认**：registry 上 `1.6.0` 存在且 `dist-tags.latest = 1.6.0`；`npm pack` 解包后 `lib/client.js`
> 与本地构建**逐字节一致**（sha256 前缀 `8ad3fc000ca529bd`），host 半含 `war-plan` 路由与 `pseudo_class` /
> `board_symbol_name` / `a2b-2` 等本版标记 —— 即"发出去的就是这一份"。
> 本批两条主线都由用户直接点名：①「重做作战板块，是大模型提供作战思路而不是用户自己选择，注意以其他板块为基础，
> 而不是空穴来风」；②「重点优化自挖板块，既要解决分类命名问题，也要优化显示美观」。两批各自都靠**真机探针**
> 推翻了"看起来已经好了"的结论（离线单测抓不到的那类问题）。
> ⚠️ **本批如实记下的缺口**：个股视角的「自挖板块」卡（设计上的**主视角**：所属共动类 + 同类伙伴 + 最近共动邻居）
> **当前没有挂载点** —— 它只被 `StockDetailPage` 引用，而 A6 摘掉「个股明细」整页时它一起失去了入口（文件在，
> 但 tree-shaking 后不进 bundle；真机核实工作台 DOM 里没有它）。**数据源是通的**（真机 `hist_concept_query`
> 冷启动 ~6s、`hist_concept_class` 同理），缺的只是一个挂载点；挂回「工作台」要把它连同 `NamingResultPanel`
> 拉进 client bundle，而体积只剩 ~13KB 余量 → **先减重、再挂载**（详见 ROADMAP A2「仍未做」⑤ 与 §B2）。

**定版验收（2026-09-14，全绿）**：`pnpm build`（client **651.7KB** / 护栏 665KB）· `npx tsc --noEmit`（0 错误）·
`pnpm lint`（0 error / 0 warning）· `pnpm test`（**28 文件全过**，含结构性契约 `docs-consistency`）·
`pnpm guard`（budget 棘轮 / ux-contract **26 条** / ux-density / contrast **30 项**）· 离线冒烟五条
（`smoke-client-view` / `smoke-host-state` / `smoke-ai-contract` / `smoke-naming` / `smoke-concept-classes`）·
`build-client.mjs --check`（产物与源码一致）· `verify-live`（对 1.6.0 实例：host 新鲜度 · **12 张表** · 写读删闭环 ·
命名桥接一次真实命名）· `acceptance/readme-shots.mjs`（**README 八张截图全部重拍**，逐张自检：行情「3 列 / 共 4 块 + 环境带 6 格」、
作战「有内容 · 方向 3 个 · 候选 4 只」、自挖板块「调用 1 次 + 模型主题/官方行业/官方概念 三种来源齐全」）。
证据：`acceptance/100-war-tsc-lint-unit.log`、`101-war-guard-size.log`、`102-war-materials-live.log`、`103-war-plan-gui-probe.log`。

### 作战板块重做 —— 作战思路由模型给结论（以其他板块为基础）

> 触发：用户「重做作战板块，是大模型提供作战思路而不是用户自己选择，注意以其他板块为基础，而不是空穴来风」。
> 契约确认（实现前问过用户）：① 产物 = **完整作战计划**（主攻方向 + 候选票 + 触发/失败条件 + 仓位动作），
> 用户只做采纳/否决/重算；② 人工输入**保留为可选覆盖**（模型给默认，用户可改可驳回）；③ 生成时机 =
> **页面打开 + 时段切换各一次**，其余靠手动重算。

#### 2026-09-14 · 作战页的产物换掉了：从"数据摊开 + 你自己点选"到"模型给今天的作战思路"

- 旧版实况：作战页只**展示**（温度计 / 事件流 / 板块脉冲 / 竞价雷达），决策劳动全在用户身上 ——
  复盘页手写预期清单、Q1/Q2/Q3 三张卡逐项点选、竞价逐条判定。AI 直调通道（`lib/ai-contract.ts`）
  一直开着，但**作战页一次模型都没调**；`ai-contract` 只有 `stock-verdict` / `review-plan` / `scout-rank`。
- 新版四层分工（每层可单独测、单独换）：
  - **素材层** `lib/war-plan-collect.ts`：行情（广度 / 温度计 / 板块榜 / 涨停梯队）+ 自挖板块
    （`hist_concept_classes` 引擎快照 → 过弱链筛选 → 按强度取前 8 类）+ **选股筛选**（同一份全 A
    快照上跑既有预设「放量上攻」，**零额外请求**）+ 复盘存档（预期清单 / 主线 / 雷区）+
    竞价（逐票 `auction` 特征 + 与竞价雷达同一个 `judgeExpectation` 初判）+ 持仓 / 自选。
    逐项限额见 `MATERIAL_CAPS`（整体压在 `AI_CONTEXT_MAX_BYTES` = 24KB 以内）。
  - **组装层** `lib/war-plan.ts` 的 `buildWarContext`（纯函数）：压成模型能读的小 JSON，并**显式声明
    `sectorUniverse`**（= 行情页板块榜名）—— 它就是护栏"允许说什么"的白名单。
    自挖类**刻意不给名字**：给类起名是「自挖板块」页的模型调用，作战页不偷花那笔预算；
    类的作用是把"哪一批票在共动"作为**证据**交给模型。
  - **护栏层** `lib/war-plan-guard.ts`（**host 半执行**，权威侧）：① 票白名单（只能点名素材里出现过的
    标的）；② 方向名**逐字**反查（自造板块名一律剔除）；③ 引文反查（数字/名字逐字命中才算落地）。
    剔除与未落地的东西**回传并显示**（`plan.guard`），不静默丢弃 —— 同 naming 的立场。
    ⚠️ 边界写清：引文反查是**逐字/数字级别的抽查**，抓得出"编了个数字/编了个不存在的名字"，
    抓不出"引用了真数字但结论被曲解"，界面上如实标注"可反查 N/M 条"。
  - **呈现 + 采纳层** `components/WarPlanCard.tsx` + `adoptWarPlan`：盘眼 / 主攻方向 / 候选票
    （每只带**触发条件**与**失败条件**）/ 三问落点 / 持仓动作 / 竞价判定；按**只填空位**写进
    `dayrun`（全部标 `from:'ai'`，**人工答案一律不覆盖**），驳回走 `dayrun.clearAiAnswers`
    （只清模型那部分）。Q 卡从"必答"降级为**人工覆盖入口**（默认收起，点任意选项即覆盖）。
- 成本纪律（与全仓同一条口径）：思路按 `${交易日}:${时段}` 缓存 → 同一时段重复打开 = **0 次模型调用**
  （页头显示"已于 HH:MM 生成"，超 30 分钟只标"建议重算"不自动重算）；**休市 / 无盘面素材不自动生成**
  （`autoGenerateDecision` 纯函数：自动跑一次只会换来一句"证据不足"，白花一次调用）；采集一次 =
  1 次 `hist_concept_classes`（引擎缓存命中即近零成本）+ 竞价时段 ≤8 次 quote/auction，
  **不进 30s 轮询**。
- 降级路径（都不假装成功）：无 LLM → 卡片说明原因 + 生成按钮置灰；模型回包结构不可用 → 存成一条
  `insufficient` 思路并**保留原文**（卡片显示原文）；模型回"素材不足"→ 原样展示（这是**允许的正确答案**：
  宁可说证据不足，也不许编一个听起来合理的板块或票）。
- **真机取证**（新增 `acceptance/probe-war-plan.mjs`，隔离 headless Chrome + CDP）第一次跑就抓到
  两个离线单测抓不到的问题：
  1. **采集期的"假空闲"**：采集要拉自挖类引擎（冷启动可达数十秒），而 `useAiTask.busy` 只在模型调用
     期间为真 —— 于是采集期卡片看起来仍是"还没生成"，用户再点「生成」什么也不会发生（被防重入挡住），
     表现得像点坏了。修：忙标志覆盖**全流程**（从采集起），加载态明说"模型正在读其他板块的素材"。
  2. **升级态的诊断话术**：新客户端 + 旧 host 半（host 半在 dsh 进程启动时载入一次）会报
     `未知任务：war-plan`。原提示"点重算再试"是错的出路 → 改为**说清该怎么做**：
     "宿主半还是旧版本（客户端已更新）：重启 dsh web 让 host 半重新加载即可"。
     真机复跑确认该文案已渲染（截图 `acceptance/shots/warplan-*.png`），且 console 0 报错。
- **素材链路真机取证**（新增 `acceptance/probe-war-materials-live.mjs`，与 `probe-structure-live.mjs`
  同一套手法：client 侧采集链打进临时入口在 Node 里跑，`fetch('/api/stock-panel/call')` 转发到
  **构建产物**的 `callEmbeddedTool` —— 真数据源 + 假模型，输出与模型判断无关，可复现）：实测一次采集
  **14.0s**，拿到 **板块榜 12 个（方向名池同源）/ 涨停梯队 20 只 / 自挖类 8 个（19 个成员位，排除 2 个
  弱链类）/ 选股候选 8 只 / 板块脉冲 8 条 / 孤立强势票 5 只**，上下文 **7.7KB**（上限 24KB），
  缺口如实记录（"事件流：本时段没有增量"、"复盘：还没有可引用的复盘存档"）；同一份真素材下喂一份
  **故意越界**的思路（素材外的票 + 自造的板块名 + 编造的引文）→ 断言全部被剔除/标注，
  白名单规模回传 **票 55 / 方向 12**。这条探针挡住的正是 naming 那条线吃过的亏
  （"假数据照着错代码写，两边一起错就永远自洽"）。
- 验收：新增 `tests/war-plan.test.ts`（31 条：回包归一 / 越界点名与引文反查 / 素材组装与限额 /
  自动生成纪律 / 存档与 host 表键口径 / 采纳只填空位与驳回只清 AI）+ `scripts/smoke-ai-contract.mjs`
  扩到 **host 半全链路**（假模型故意越界 → 断言 host 真的剔除了素材外的票/方向、回传 guard、
  回传 `meta.contextBytes`）+ `pnpm test`（28 文件）+ `pnpm guard` 全绿 + `pnpm build`（651.7KB）；
  证据 `acceptance/100-war-tsc-lint-unit.log`、`101-war-guard-size.log`、`102-war-materials-live.log`、
  `103-war-plan-gui-probe.log`。
- 体积账：本批净增 ~31KB，**其中 9KB 是本批自己找回来的** —— client 侧对 `ai-contract` 的**值**引用
  （一个 `emptyWarPlanGuard()` / `contextBytes()`）把四个任务的 prompt 模板整份打进了包，
  `war-plan-guard` 其实只需 host 侧：两处都已清除，上下文体积改由 `AiCallMeta.contextBytes` 回传。
  护栏 650 → **665KB**，账与"下一批必须减重"的杠杆写在 `scripts/check-bundle-size.mjs` 顶部。
- 持久化：新增 host 表 `war_plans`（`dsh-stock-panel:war-plan:v1`，键 `${交易日}:${时段}`，
  shape=keyed）—— 它是"用户按它下单"的那份东西，也是代价最高的一次模型调用，只留内存等于
  每次回作战页都重烧一次；`tests/state-tables.test.ts` 的键口径由 `tests/war-plan.test.ts` 反向钉住。

---

### 自挖板块专项 —— 分类命名（字段名事故 + 结构标签 + 伪类过滤 + 主题名归一）+ 该页版面重做

> 触发：用户「重点优化自挖板块，既要解决分类命名问题，也要优化显示美观」。
> 先取证后动手 —— 真机探针（`acceptance/24-naming-page-probe.log`）显示
> **9 个可采信类全部显示「素材不足」，一个名字都给不出来**，而成员是
> 「西安奕材-U / 恒坤新材 / 中巨芯-U / 兴福电子」这种一眼能看懂的东西。

#### 2026-09-14 · 真 bug：`belong_board` 字段名取错 → 板块归属素材恒为 0 条

- 问题：`host/naming/materials.ts` 的 `boardNameOf` 读 `board_name ?? name`，而真数据层的字段是 **`board_symbol_name`**（见 `lib/stock-data.ts` 的 `BelongBoardRow` / `lib/ladder.ts` 的既有用法）。于是每一行都解析成空。
- 为什么后果不只是"少一类素材"：提示词第 0 条明写「没有快讯时用板块标签兜底」，而板块标签是**唯一一个任何 `as_of` 都采得到的源**（异动/监控只有当日实时列表、封板素材只在有涨停时产出）。它一空，非交易日的类必然 `insufficient` → 整张列表没有名字。
- 为什么单测没抓住：`tests/naming-pipeline.test.ts` 与 `scripts/smoke-naming.mjs` 的假工具返回的是 `{ board_name }` —— **假数据照着错代码写，两边一起错就永远自洽**。已把两处假数据改成真字段名，并新增 `tests/naming-materials.test.ts` 反向钉住契约。
- 关键改动：
  - `boardNameOf` 真字段优先（`board_symbol_name` → `board_name` → `name`），三种都认：认多了只是素材更全，认少了就是整条链路瘫痪。
  - 新增 `boardContractDrift()`：「接口返回了行、但一行都没解析出板块名/类型码」→ 如实报**本地契约漂移**。收口前的文案把这种情况写成「未产出可引用板块（非失败）」，读起来像市场事实，实际是本地 bug（归因错了，下一个人还是会踩）。
- 验收：`tests/naming-materials.test.ts`（10 条）+ **真机取证** `acceptance/probe-structure-live.mjs`（真 TDX + 假模型，import 构建产物跑整条采集链）：修前 `belong_board` 产出 0 条，修后 **`used` / 30 条（15/15 只票）**，其余源状态不变（两个实时源按设计跳过、kline 无产出——都是市场事实）。

#### 2026-09-14 · 分类命名：结构标签（确定性）+ 传递链伪类过滤 + 主题名归一

- **结构标签**（新增 `host/naming/structure.ts`，纯函数）：把成员所属**官方行业/概念板块**里被 **≥2 只成员共享**的词数出来，作为「这个班像什么」的标签。**不经模型、不依赖新闻、任何 `as_of` 都成立** —— 模型主题名拿不到时它顶位，且界面永远标出来源（`模型主题` / `官方行业` / `官方概念`）。从批量命名**已经采到的语料**里算，0 次额外请求、0 次额外模型调用，与模型看到的素材逐字同源。
  - 覆盖度必须显示（`铜·黄金 5/7 只`）：一个 3/7 的标签是"部分成员的共性"，不标就会被当成全类属性。
  - **真机效果**（同一次取证，as_of 2026-09-09）：9 个类里 7 个拿到结构标签且**逐个人能读懂** —— `电子化学品`（中巨芯-U/恒坤新材/兴福电子）、`半导体·集成电路设计`（摩尔线程-U/沐曦股份-U）、`人脑工程`（博拓生物/翔宇医疗）、`生物制品`（必贝特-U/禾元生物-U）、`5G概念·数据中心`（华丰科技/盛科通信-U）、`机床制造·通用设备`（纽威数控/国盛智科）、`半导体·半导体设备`（先锋精科/正帆科技）。另 2 个是被伪类判据排除的组（不取成员 → 空标签，界面按 `skipReason` 说明原因）。
- **传递链伪类过滤**（新增 `lib/concept-quality.ts`，host/client 共用）：引擎的 `weak_chain` 只挡住了一部分伪类 —— 实测（2026-09-13）有一个 **52 只 / 类内相关 0.428 / 强边密度 0.14** 的传递链巨类 `weak_chain=false`，照旧进了"可采信类"并送去命名。判据：`强边密度 < 0.5` **且** `类内相关 < 实际切边阈值` 两条同时成立才拦（单看任一条会误杀"3 只票的三角形"这类真小班）。被拦的**不丢弃**：计数 + 逐条原因进汇总条的 title，命名路径同样拒绝并给 `reason:"pseudo_class"`（与 `weak_chain` 分开报，归因分层）。
- **主题名归一**（`guard.ts` 的 `normalizeTheme`）：脱引号（「」【】""）、去空白、去「板块/概念/题材」这类通用后缀；归一后为空 → 按"named 但 theme 为空"降级。过长（> 16 字）**只提示不截断**（半截名字比长名字更容易被误引）。每次归一都留 `guardNotes` 痕迹。
- **提示词补第 7/8 条「theme 的形状」**：`2~8 个字的题材短名`、不写句子/后缀/涨跌幅/股票名，板块兜底时优先用**被多数成员共享**的官方行业词（可复核）；批量那一版另加"各组不要为了统一风格而互相模仿"（逐类问时模型更容易把「铜」和「铝」都叫成「有色金属」）。**提示词版本随之 +1**（`a2b-1 → a2b-2`、`a2b-batch-1 → a2b-batch-2`）—— 不改版本号的话，旧提示词产出的长句主题名会被当成新口径的缓存命中（那正是指纹要防的静默复用）。约束落提示词而不是落护栏：护栏只做归一、**不改写**模型的话，改写过的名字更容易被误引。
- 验收：`tests/concept-quality.test.ts`（6 条，样本全部来自实测正/负样本）+ `tests/naming-guard.test.ts`（+4 条：主题名归一 ×3 + 提示词形状约束）+ `tests/naming-pipeline.test.ts`（+4 条：结构标签、模型不可用时结构标签仍在、伪类拒绝、批量逐组结构标签）。

#### 2026-09-14 · 「自挖板块」版面重做（并改为跟随主题 token）

- 问题：整行 7 个指标挤在一条 11px 灰字里用 `·` 分隔，主题名（唯一有信息量的东西）和它们同权；成员 52 只全量铺开把页面撑成几百像素；颜色全是 tailwind 的 `slate/white/violet` 固定色阶 —— **不跟暗色主题**（整页最刺眼处）。
- 关键改动（`components/ConceptClassesCard.tsx` + `index.css.txt` 新增 §4b）：
  - 一行三列固定骨架：**左**（强度数值 + 相对强度条 + 排名，条长按当前列表区间归一、排序仍按数值）│**中**（名称 + 来源胶囊 + 覆盖度 → 指标行 → 成员网格）│**右**（证据 / 重命名，低对比次要动作）。
  - 名称与来源分色分区；模型没命名时把三态结论如实挂上（`模型：素材不足`），**不许结构标签冒充模型结论**。
  - 成员按当日涨幅降序（龙头在前）、默认只铺 12 只 + 「+N 只」展开；孤立票同理（18 只）。
  - 口径说明折进 `<details>`；新增 `.dc-soft-*` 语义浅底 token（`color-mix` 派生，明暗自适应）替换固定色阶。
- 顺带修（同一批测试基建问题）：`tests/naming-pipeline.test.ts` 的批量用例漏传 `news: false`，实际会真的发 HTTPS 抓新浪 7×24 —— 该文件自称"不发一次网络请求"，实测单用例 20–48 秒。补齐后整文件 **135s → 52ms**，且不再依赖外网。
- 验收：`pnpm test`（27 文件 / 93 条命名断言）+ `pnpm guard`（budget/ux-contract/ux-density/contrast 全绿）+ `pnpm build`（client 614.8KB < 650KB 护栏）+ 真机探针 `acceptance/probe-concept-page.mjs`（隔离 headless Chrome：DOM 结构、明暗两套计算样式、console 无报错、明暗截图）。

#### 2026-09-14 · 版面**评审后返工**（第一版被真机像素测量推翻的三处）

> 方法：隔离 headless Chrome 出图 → 逐像素测量（RLE / 众数直方图 / 字形 bbox / WCAG 对比度）+ 两条独立路径交叉验证。
> 它同时**推翻了两条读数**（指标行其实逐像素对齐、底部没有被切半的字），也抓出三处真缺陷 —— 记下来，因为这三处都是"靠肉眼看图看不出来"的：

1. **成员 chip 里股票名只剩 16px（≈1 个汉字，极端 6px）** —— `minmax(10ch,1fr)` 的列宽里，`+14.70%` 这种涨幅就占 42px，加内边距与 gap 后名字被挤没，"点一只票"这个页面目标直接失效。修：列宽 → `minmax(19ch,1fr)`、名字 `flex:1 1 auto` 吃剩余宽度、涨幅 `flex:none`（实测名字拿到 **91px**，5 字名完整显示）。
2. **亮色下整页没有"面"** —— 宿主**亮色**的 layer-1/2/3 全是 `#ffffff`（`index.css.txt` 里 `.dc-tag` 早就为此改用 `--dc-track`，这一页没跟上），于是 8 张卡 + 汇总条 + 全部胶囊在亮色里融成一堵白墙，唯一线索是 1px `#F5F5F5`（1.07:1）。修：新增 `--dc-surface` / `--dc-surface-2` 两个 token —— 亮色取「朝前景混 4%」，暗色覆盖为 layer-1/layer-2（**暗色刻意不用混色**：A 股语义色在护栏里按 `on layer-1` 校验，卡片放 layer-2 会把 `--dc-up` 从 4.54:1 掉到 ~3.97:1）。实测修后：卡 `#F5F6F6` on 页 `#FFFFFF`、chip 纯白坐在卡上、胶囊有底；暗色卡 `#232324` / chip `#2C2C2E` 且**两个面板里的 chip 关系一致**（原来一个是"比卡亮"、一个是"比面板暗"）。
3. **强度条编不出信息** —— 54px 轨道 + min–max 归一：第 4/5/6 名的条长差 1–3px 不可辨，而"0.0 分"被画成 52% 满格红条、−2.7 分只剩一小截绿条（"零分"看起来比"负分"强一倍）。修：标尺改成 `|强度| ÷ 列表内最大 |强度|`（**零点即零宽**），轨道 54 → 68px，强度数值改回**中性主文本色**（14px 红字在暗色卡面上只有 3.97:1，不到 AA；方向交给那条 3px 彩条表达）。实测条长 66/66/61/42/33/31/**1**/68。
   - 顺带：强度色与显示值同源（`toFixed(1)` 后的值决定颜色）—— 原来有原值 `+0.04`、显示「0.0」却画红的情况，同一行自相矛盾。

另外按评审建议改了：汇总条换行策略（叶子项 `white-space: nowrap` + 统计/预算两段各自成段 —— 消掉「0）」「组）」「轮」三个孤字行；中途试过 `grid auto` 列，结果 auto 列按 max-content 分宽度把统计列**压成 5px 宽**，已记入 CSS 注释免得再绕回去）、页头改三列 grid（as_of 与三个参数合成一个胶囊，刷新不再被挤到第二行）、左列强度数字与班名同基线且 `#N` 提到同一行、右列动作恢复按钮感（1px 描边 + 面）、「命名走缓存」从指标行移到右列（它不是指标）、涨停是唯一带强调底的指标、孤立票区写「显示 5/113」（引擎只回前几名，原来"5 只"会被当成"今天只有 5 只孤立票"）、长句诊断不再用琥珀色（11px 琥珀在宿主亮色下实测 3.74:1，不到 AA；彩色只留给真正的故障）。
- 验收：`pnpm test` + `pnpm guard`（contrast 全绿）+ `pnpm build`（614.8KB）+ `acceptance/probe-concept-page.mjs` 的 DOM 实测（chip 名字宽 91px、中列三个块左边缘同为 643、页头 21px 单行、汇总条 52px / 3 行、明暗 surface 各一档）。

#### 2026-09-14 · 行情页：重新组合（真机 780px 下旧三块藏了 74% / 83%）

先量后改（`acceptance/probe-market-page.mjs`，隔离 headless Chrome）。旧组合是「总览(4) | 指数(5) | 梯队(3)」并排，但真机容器只有 **780px**（左右栏都开）→ 落到 2 列、只有两行 395px。逐块量「内容高 / 可视高」：

| 块 | 修前 | 修后 |
| --- | --- | --- |
| 市场总览（34 行榜单） | 1391 / 363 = **藏 74%** | —（拆解到环境带 + 榜单 + 异动） |
| 涨停梯队（69 只涨停股） | 2174 / 363 = **藏 83%** | 464 / 406 = 藏 **15%** |
| 指数 | 363 / 363 = 0% | 0% |
| 榜单 / 异动 | （含在上面那 74% 里） | **0% / 0%** |
| 整页「涨停」出现次数 | **19 次** | 5 次 |

"一屏看完"当时只对指数成立 —— 另外两块各是一个独立滚动条，你看到的是一道缝；而同一个数在页面上出现两三遍（总览 2×2、梯队 2×2、状态带各一份）。

- **新组合**：① **环境带**（全宽：6 格 KPI + 一条 10px 涨跌分布横条）——两个 2×2 的**并集**合成一处；② 主行 `指数(5) │ 涨停梯队(7)`；③ 底行 `榜单(7) │ 市场异动(5)`。环境带与底行按内容给高度，主行吃剩余（图表自适应，实测 406px 高）。
- **梯队改 chip 分组**（`LadderPage`）：69 只从"逐行列表 2174px"改成"一梯队一行 chips"，默认只展开最高两档（高位股才是决策相关的），其余折成「展开全部 N 只」——**有标注的取舍**，全量一次点击可达；板块热度默认铺 8 个、其余进「+N」的 title。连板统计改由本块经 `onStats` 上报给环境带（页面**不重算** —— 那是最贵的一段）。
- **删掉 `src/pages/MarketOverview.tsx`**：它的全部内容被环境带 / 榜单 / 异动接管（`RankList` 的宽度口径搬进 `components/MarketBoards.tsx` 并重新定尺），该文件只被 `MarketPage` 引用。
- **栅格写法**：位次全部写进 `index.css.txt` §4c（`.dc-mkt-grid.is-{2,3}col` + **显式 `grid-row`**）。显式行号不是洁癖：底行是"榜单在右、异动在左"而 DOM 顺序是"指数→梯队→榜单→异动"，自动放置（sparse）不会回头补空位，实测被排成**四行**（`91.9 / 240 / 259 / 209`，异动掉到第 4 行）。
- **顺带修的三个真问题**（都不是这次新引入的）：
  1. **页头那句"全页共用一个节拍器"是假的**（审计项 I-b）：各块自带的 20s/15s/30s 定时器从没被关掉，实测 **4 个定时器同时跑**。现在 `MarketPage` 给指数块与梯队块传 `pollMs={0}`；并由 `scripts/ux-contract.mjs` 新增的 `market-single-metronome` 钉住（`budget.mjs` 只数"声明点"，数不出"该关没关"）。
  2. **`useSwr` 的 `enabled:false` 会把手动刷新一起废掉**：它让调度 effect 直接 return，而 `refresh()` 只是 bump 一个 nonce → 静默失灵。页面自己持有的数据源改用 `refreshInterval: 0`（写在 `MarketPage` 头注释里，免得下次再踩）。
  3. **暗色下「日K」药丸是近白底 + 白字**（`IndexChart` 的 `bg-emerald-500 text-white` → §7 把 `bg-emerald-500` 换成 `--dc-accent-fill`，而宿主暗色的 primary fill 接近白色，`text-white` 却没跟着换）：改成共享的 `.dc-seg` 分段控件 + `.dc-seg-btn.is-on`（强调色文字 + 半透明底），并把 `.dc-seg-btn.is-on` 从"中性底 + 主文字色"改成与 `.dc-subnav-item.is-on` 同一套语义。实测暗色：`bg rgba(255,255,255,.14)` + `color ≈#5ad387`。
- **版面评审（像素测量）后的返工**：工具条压回一行（原来折两行、第二行左侧空 570px）；上下两行的**竖缝对齐**到同一栏（原来差 206px）；KPI 着色立规则（有方向的数 = 红绿；热度数「最高连板 / ≥2板晋级」= 红；纯量「两市成交」= 中性），并给第一格加一条"今天偏涨/偏跌"的 2px 强调边（全页字号只有 11/12/14 三档，最大的字反而是中性色的指数点位 —— 结论不能靠读者自己比出来）；「其他」类别的异动胶囊从琥珀改中性（宿主**亮色**下琥珀实测 ~2.9:1，不达 AA）；块头提示句全部缩短（长句实测被截成「沪深北三市场...」）。
- **§7 过渡层减 3 行**：`bg-blue-100` / `bg-slate-50/80` / `divide-slate-100` 在源码里已零引用（本页迁到 token 后自然消失），按该节"每迁一页删对应行"的纪律删掉。
- **验收**：`acceptance/probe-market-page.mjs`（块矩形 / 内容-可视高 / 明细计数 / 三条点击链路 / 明暗计算样式）、`scripts/verify-live.mjs`（host 新鲜度 + 命名桥接 + 持久化闭环，全绿）、`acceptance/readme-shots.mjs`（README 截图重拍，自检「3 列 / 共 4 块 + 环境带 6 格」通过）；`pnpm test` / `pnpm guard`（26 条）/ `pnpm build`（620.1KB < 650KB）全绿；`docs/images/01-market.png` 与 `04-concept.png` 用新构建重拍。

---

## [1.5.0] 2026-09-13

**盯盘执行台收口版** —— 版面/契约收口 + 工作台外壳适配 + A2b 命名补强

> 发布物：`@lisonevf/dsh-stock-panel@1.5.0`（registry = GitHub Packages）+ git tag `v1.5.0`。
> registry 上此前只有 `0.3.5`（1.0.0 ~ 1.4.0 都没发过），**1.5.0 是第一个可安装的现形态版本**。
> 本版把长期滞留在工作区的一整套（下面 5 批）一次性固化成可回滚点：从"141 文件未提交、无任何 tag"
> 到工作区干净 + 版本号收口（`package.json` 单一来源）。

### 2026-09-13 · 工作台：去掉宿主那两条全高拖拽条 + 底部对话框

- 问题：工作台视图里下方对话框两端有贯穿全屏的拖拽条。定位为**宿主** `ui-conversation` 的 `WidthHandle`：`.wSkVaW_widthHandle{ position:absolute; top:0; bottom:0; z-index:8; cursor:col-resize; width:min(40px, calc((100% - 正文宽)/2 - 48px)) }`，左右各一条，落在居中正文列两侧留白里（拖「正文栏宽度」，写 `--dsh-chat-user-width`、落盘 `dsh.conversation.contentWidth`）。
  - 宿主渲染只判 `phase === 'active'`，**不看当前选中的是哪个视图**；工作台是满宽面板，于是两条 40px 的带子压住左右边缘并一路通到底部对话框两端，点按钮/点列表行/拖选文字都被接管（光标变 `col-resize`）。
- 处置（用户拍板）：**这两样在工作台里都不要** —— 拖拽条挡路、底部输入框白占一条；**一份宿主文件都不改**，沿用 v1.2 起「只走官方槽位 + 只读观察宿主」的纪律。
- 宿主同源先例：composer 悬浮场景里宿主自己就是直接把这**两条** `display:none`（`.wSkVaW_root:has([data-conversation-composer-overlay]) .wSkVaW_widthHandle`）—— "工作台里没有正文栏"与宿主这条判定同源，不是新发明的例外。
- 关键改动：
  - 新增 `src/lib/host-chrome.ts`：工作台视图**挂载期间**给 `<body>` 打标记 `data-dc-workbench`（ui-renderer 按 `only: active.id` 过滤条目，挂载 ⟺ 选中，切走即卸载，「对话」页不受影响）；用 `useLayoutEffect`，否则宿主拖拽条比面板先存在、切标签时会闪一帧。
  - `index.css.txt` 新增 §9（宿主外壳适配）两条规则，都挂在同一标记下：`body[data-dc-workbench] [data-width-handle]{display:none}`（藏拖拽条）、`body[data-dc-workbench] [data-composer-seat]{display:none}`（不要底部对话框，让出高度归主区 —— 宿主 `viewArea` 是 `flex:1 1 0`，面板高度按容器实测算、自动跟着长）。
  - 只依赖 `[data-width-handle]` / `[data-composer-seat]` 两个钩子：DSH 改名 → 退化为"什么都没隐藏"、不抛错；`window.__STOCK_PANEL__.chrome()` 报实况。座位只 `display:none`、**不卸载**，Lexical 编辑器实例还在，插件「深入对话」的注入照常能发。
  - `AiPanel` 补一条 8s 自动消失的回执（"已把 prompt 发到对话 —— 切顶部「对话」标签看 agent 的复核"），按钮 `title` 同口径，补上"去掉输入框后点按钮界面毫无反应"的反馈缺口。
- 验证锚点：`tests/host-chrome.test.ts`（5 项）：标记语义（进/出成对、可重入）+ **CSS 契约**（两条规则必须由模块导出的标记常量拼得出来 —— 改名忘改 CSS 是静默失效，这里直接红灯）+ 防回退断言（不许再挂"两态开关"属性）。
- 顺带校准（`pnpm test` 本来就红着：文档数字与工作树不符）：README 单测文件数 23 → 25、命名相关断言 55 → 77；`docs/ARCHITECTURE.md` §5.1 localStorage 键数 14 → 18（按 `src/**` 里的字面量扫出），并补上漏登记的 `viewed` / `review-draft` / `nav` 三行。

---

### 2026-09-12 · 版面评审：类型尺度 + 宽度利用

- 问题：第二次详细审查（量化普查 + 逐页密疏分析）发现"越放不下越缩字号""元素宽度没算清""整屏空白"三类版面问题。
- 量化基线（可复核，细则见 README §版面基线）：主区实测 **≈1148 × 769px**（几何日志 `railL 268 / railR 344 / strip 1760`，视口 2048×927）；改造前字号普查 **8px 94 处 / 9px 137 处 / 10px 157 处 / 11px 73 处 → ≤10px 占 85%**（甚至出现过 7px），而 ≥14px 只有 13 处（中文 9px 字高≈9px，属不可读范围）。
- 处置（用户拍板）：**按 comfortable 档设计 · 注脚进 `title` · 不留白靠"合理利用元素宽度"而不是藏信息**。
- 关键改动落点：
  - 类型尺度：`index.css.txt` 引入四档 token `--dc-fs-decision 14 / data 12 / note 11 / micro 11` + `.dc-t-*` 工具类，**下限 11px**（css 自身 <11px 的 15 处一并抬升）；全仓替换 **488 处**字号（34+15 个文件），就地字号只剩 4 个白名单强调数字（15/16/18/20px）；状态带指数涨跌升 data 档（12px）、名称退 note（11px）。
  - 宽度利用：`MarketOverview.RankList` 由"名称 flex-1 + 一个 w-14 值"改为按内容定宽的 4 列 grid（名称 │ 代码 │ 主值 │ 副值）—— 同一行 370px 里原来只放 ~130px 内容、空 ~240px，现填入本来就有换手率/涨跌幅，字号同时升到 12px。
  - 宽度利用（卡片与导航）：选股页预设策略 2 列 × 2 行/张 → **3 列 × 单行**（卡片高度减半）；自挖板块行 `#N · class X` 注脚进 `title`、成员 chips 改 `repeat(auto-fill, minmax(10.5ch,1fr))` 网格；`.dc-nav-item` 水平内边距 11px → 8px（7 个入口省 42px，命中区仍 24px）。
  - 空态：`StateView` 由"mark/文案/动作各自 `max-w-md`(448px) 居中"改为 `dc-empty-inner` 两栏（文案 │ 动作）+ `dc-empty-actions` auto-fit 1–3 列，主区 1148px 时宽度利用率 ~39% → ~93%，窄容器自动回落单列居中（作战页休市/监控页无规则的整屏空白由此收敛）。
  - 列流与复盘页：`.dc-flow` 原用 CSS 多列 → 七步视觉顺序变成 **① ④ ⑥ / ② ⑤ ⑦**，改**行优先 grid**（`repeat(N, minmax(0,1fr))` + `align-items: start`）恢复 ①②③/④⑤⑥；档位阈值 1180 → **1100**，新增 `dc-main--flow4`（主区 ≥1450 → 4 列）；复盘页把"同一步的多张卡"合成 `dc-flow-cell`（6 个单元在 3 列下正好两行）。
  - 其余：指数块图高随容器（`useAvailableHeight`，上限 720px；原固定 340px 图 + 摘要只占 ~440px，约 1/3 列高闲置）；外盘改两栏（左=标的紧凑行 8 行、右=报价 + K 线，原为 `grid-cols-2` 小卡 + 固定 220px 窄图）；工作台信息条（字段 10 个上下）与自挖板块 7 个指标改 auto-fit/等宽网格（1148px 一屏 8–9 列）；状态带高度 38 → **44px**、间距 12 → 10px。
- 第二轮反馈（用户："排版不太稳定"）：根因是三条叠加 —— ① 七步里若干块**条件渲染**（梯队为空/强度分析中/无炸板事件），grid 自动流补掉空位 → 块一出现后面编号就换列；② `align-items: start` + 高度随数据剧烈变化；③ 长列表不限高（一张 40 行的卡撑起整行）。
- 第二轮反馈的处置：`dc-slot-1..6` 把每一步**钉在固定列**（按 flow2/3/4 三档分别给列，缺块留空不补位）；`.dc-flow` 改 `align-items: stretch`；新增 `.dc-card-list`（`max-height: 15rem` + 内部滚动）给 4 处长列表（强弱甄别候选池 / 低位首板候选 / 跌停事件 / 炸板清单）—— 列表头写着总条数，限高不是藏信息。
- 验证锚点：新增 `scripts/ux-density.mjs`（类型尺度直方图 + 就地字号下限判定 <14px 即失败、白名单须写明理由 + 宽度浪费手法计数），已并入 `pnpm guard` 与 CI（`pnpm density` 可单独出报告）；`ux-contract.mjs` 新增 `type-scale-tokens-defined`、`type-scale-floor-in-components`、`empty-state-uses-container-width`（24 条全过），加 `flow-slots-pinned` 后门禁 **25 条**。
- 仍未做：状态带**分层**（把 5 个指数收成"2 个关键 + 可展开指数条"）会改动交互与浮层，需真机目视后再定，本轮只做了尺寸与间距；`WATCH-METHODOLOGY` / `USER-GUIDE` 未按本批的版式与交互再复核一遍。

---

### 2026-09-12 · 评审修复：数据层契约 + 轮询纪律 + 持久化缺口

- 问题（来源：一次"真实模拟用户"综合评审，走完 7 个一级入口 + 数据层对拍 + 门禁复跑）：
  - **事故级 · 一条挂死请求堵死整个数据层**：扩展市场一次请求（`goods_varieties` 缺 `market_id` → 被 `|| 0` 静默变成市场号 0）在服务端不返回；此后 `quote` / `server_info` / `hist_concept_status` **全部 10s+ 无响应**、20 分钟不自愈，只能重启 dsh web，而同时**新进程直连 TDX 只要 216ms**（不是上游墙）。根因：全站工具共用**一条无超时的串行 promise 链**（`serial()`），一次永不 settle 的调用让 `queue = run.catch(...)` 永远不再前进；浏览器侧 25s 超时只是**放弃等待**，服务端那个 await 仍在链上。
  - **排序契约（上游 node-tdx）**：分页累加用 `securityList.unshift(...)`，按 `start` 升序取页却把每页插到头部 → `count > 页大小` 时页序整体反转（板块成分股 80/页、板块列表 150/页、K 线 700/页、逐笔 1000/页），单页看不出来。实测全 A 榜 `DESC` 取回升序，「选股筛选」第一屏给的是**最弱的命中**（+2.0% 在最前、+6.0% 沉在最后）。
  - **静默兜底**：`board_members` 的 `sort_type`/`sort_order` 未知值原会静默回落成 `CHANGE_PCT/DESC` —— `sort_type:"AMOUNT"`（枚举里其实叫 `TOTAL_AMOUNT`）会悄悄返回"涨幅榜"。
  - **轮询纪律**：休市纪律此前**只在作战页**实现，行情页/状态带/监控 Watcher 各写各的定时器 —— 实测周六下午作战页写着"已省掉每轮上百次工具调用"，行情页同时按 30s 轮询三块（涨停梯队单轮 ≤177 次工具调用）、监控规则每 12s 轮一次报价。
  - **持久化缺口**：`alerts.ts` 只写 localStorage、没有 `syncTable`，而 README 声称"用户可见的本地资产都在 host 侧" —— 盘前设好的规则清一次缓存就没了。
  - **外盘页首屏空白**：`GlobalPage` 的 `sel` 初值 `null`，只在"点过标签/点过票"后才赋值，而默认标签就是美股 → 首屏永远不发请求（用户读到的是"美股没数据"）。
  - **命名「素材不足」归因错**：`missingSources: string[]` 把三种情形塞进同一字段（①实时源按设计跳过 ②调用成功但无产出 ③真的采集失败），证据卡只能写"源采集缺失"，模型顺着写成"采集失败"、而这段文字被用户当成系统归因读 —— 实测 2026-09-12 周六写着"belong_board/kline/market_monitor/unusual 等源全部采集失败"，真相是 **2 个按设计跳过 + 2 个无产出 + 0 个失败**。
- 处置与关键改动落点（**全部是根因修复**，在正确的层次修 + 补护栏，没有一处是"在调用点加个判断"的补丁）：
  - 事故级：新增 `src/host/serial-queue.ts`（单次调用超时、超时即让该次结算而**链照常前进**；pending/timeouts/lastError 可观测；`reset()` 供重连后丢弃旧链；含 5 条单测）；`src/host/tdx-data.ts` 按**连接**分链（A 股 7709 / 扩展市场 7727，一条挂住不连坐），超时可配（`DSH_TDX_TIMEOUT_MS`=8s / `DSH_TDX_EX_TIMEOUT_MS`=12s），超时即丢弃该连接并自动重连（连续两次整体重建），`tdxEmbeddedDiagnostics()` 暴露每条链的超时/自愈计数；`goods_varieties` 的 `market_id` 改**必填正整数校验**（0/缺失直接报错、不发请求）。
  - 排序：已在 `TRADE/node-tdx` 修 5 处（`unshift` → `push`）并刷新 vendor；插件侧再加契约兜底 `src/host/board-order.ts`（能本地复算的排序键一律重排一遍）；未知枚举改白名单校验 + 报错时列出允许集合（`src/host/tool-args.ts`）。
  - 轮询：新增 `src/lib/poll-gate.ts`（判据唯一 + 会话时钟发布 + 可观测），`lib/cache.ts` 的轮询循环与行情页节拍器统一据此跳过非交易时段的**定时**请求（按需取数/手动刷新照常；定时器保留 → 开盘自动恢复；会话时钟自身豁免）；行情页头部与监控页健康度如实显示"休市 · 已暂停定时轮询"。
  - 持久化：新增两张 host 表 `alert_rules` / `alert_hits`（`state-tables.ts` + `alerts.ts` 接入同步与 hydrate）；三个验收脚本改为**从 `STATE_TABLES` 推导表清单**（此前分别写死 9/8/8，实测已漂移）。
  - 外盘：选中项改为**派生**（默认 = 该市场第一只，各市场各自记住看的是哪只），并对"部分取数失败/未取到报价"给出显式文案。
  - 归因：`SourceReport`（四态 `used / skipped_by_design / no_material / failed` + 模板 detail）成为**唯一真源**（`types.ts`/`collect.ts`），`missingSources` 降级为派生字段，批量切组语料时逐源状态原样透传；新增 `host/naming/cause.ts`（`describeMaterialCause` 确定性模板 + `pickDegradedReason` 按采集事实定档：失败 > 按设计跳过 > 没素材 > 部分成员 > 模型判不足；新增降级成因 `source_skipped`）；prompt 改为给出逐源四态并声明"缺失原因由系统说明，你不要解释"；UI 证据卡新增「素材来源（系统归因）」表 + 系统成因，模型散文改标注「模型说明（模型自述，非系统归因）」，类列表头条改按状态聚合（`无产出 N 组 · 实时源按设计跳过 M 组 · 采集失败 K 组`）。
  - 工程与文档口径：`build-client --check` 比对前把两侧 build id 抹平（哈希输入是 `src/** + package.json`，真手改生成物仍抓得到，四种情形已实测）并把该门禁接进 CI；工具清单单一真源 `src/lib/tool-names.ts`（此前 `client.ts` / dispatch switch / `host-tools.ts` / MCP-SETUP / 诊断面板各写一份，实测漂移成 19/15/8/12 四种口径）；`scripts/update-opentdx.mjs` 在 Windows 必须走 `shell: true`（`execFileSync('npm', …)` ENOENT、`npm.cmd` 被 Node 拒绝即 CVE-2024-27980 的 EINVAL）；HIST 自挖概念工具首次调用要建快照，8s 统一超时会把它直接砍掉 → `hist_concept_*` 给 **90s**（`DSH_TDX_HIST_TIMEOUT_MS` 可覆盖，浏览器侧同步放宽到 60s），其余仍走各链默认值。
- 验证锚点：`scripts/smoke-embedded.mjs` 新增跨页排序（DESC/ASC）与"未知枚举必须报错"断言，并按 `EMBEDDED_TOOL_NAMES` 自查覆盖面（此前 README 写"19 工具冒烟"、脚本只跑 12 个）；新增 `tests/state-tables.test.ts`（扫 `src/**` 存储键，凡 `dsh-stock-panel:*` 必须在表里或显式遗留白名单）；新增 `tests/docs-consistency.test.ts`（README 的 N 张表/N 个工具/体积护栏/测试文件数/命名断言数与代码脚本比对，同步修正为 11 张表、22 个测试文件、46 条命名断言、五个离线冒烟 + 三个门禁）；`tests/naming-cause.test.ts`（7 条，含"没有失败源时不许出现失败归因"）、`naming-pipeline` 追加 2 条、`smoke-naming` 新增 `[4b] 归因口径` 段；单测覆盖 `board-order` / `tdx-dispatch`（注入假 client，不触网）。
  - 真机复验（新 vendor + 真实行情，as_of=2026-09-11 / today=2026-09-12）：逐源状态 `unusual/market_monitor = 按设计跳过 · belong_board/kline = 无产出 · 失败 0`，`degradedReason = source_skipped`，成因文案如实分列三类且不含失败归因。
- 文档口径同步：`docs/ARCHITECTURE.md`（护栏数字改单一来源引用、AI 可取消的过期结论标注已修）、`docs/ROADMAP.md`（A2b 状态、B3-③⑤ 已完成、休市闸门入册）、`PRODUCT-DESIGN` 头部（§6e 为唯一现行）、`USER-GUIDE`（去掉 v1.5 已发布口径）。
- 仍未做（下一批）：自挖概念**发现**的命中率 —— sat 当日 9 个可采信类里 0 个含涨停、132 只孤立票，`pool_n`/`window`/`min_corr` 的调参与"是否按当日涨幅加权"值得单独做一次校准（属产品判断，非缺陷）；`docs/archive/` 历史文档未清理；`USER-GUIDE` 与 `WATCH-METHODOLOGY` 尚未按本批行为复核一遍。

---

### 2026-09-12 · A2b 补强

- 问题/目标（用户侧一句话）：打开「自挖板块」就要有名字、最猛的班排最上面、行上直接看到涨停数和涨幅；此前逐类命名要十次请求，且模型看不到组间区别（容易把"铜"和"铝"都叫成"有色金属"）。
- 处置与关键改动落点：
  - 强度口径单独立模块 `src/lib/concept-strength.ts`（host/client 共用纯函数）：`强度 = 均涨幅% + 6×涨停数`（权重是显式常数 `STRENGTH_LIMIT_UP_WEIGHT`，改它必须同时改注释与单测）；并列时按 **强边密度 → 类内相关 → 规模 → classId**；**排序与显示同源**。
  - 涨停**精确判定**：收盘价触及涨停价 `buy_price_limit`（各板幅度 10/20/30/5%，阈值法必然误判），**不做阈值兜底**（`buy_price_limit=0` 是上市首日等"没有涨停概念"的票，兜底会把涨 400% 的新股算成涨停）。缺失值不按 0 处理：均涨幅只按有行情的成员算并上报 `known_n`（界面标注"仅 N/M 只有行情"），顺带修掉 `Number(null) === 0` 静默坑（`concept-strength.ts` 的 `numOrNull` 与 `lib/naming.ts` 的 `num`）。
  - `hist_concept_classes` 每行新增 `members[]`（代码/名称/当日涨幅/涨停/类内相关）、`chg_mean`、`chg_max`、`up_n`、`limit_up_n`、`known_n`、`strength`，孤立票也带 `limit_up`；成本为每类一次 `classMembers`（纯 CPU）+ 与引擎**共用 60s 全A快照 memo**（不重复拉 ≥2MB）。
  - 批量命名：`POST /api/stock-panel/naming` 支持 `{all:true}` / `{classIds:[..]}` —— 一次并集采集 → 按成员数分批（`maxMembersPerCall`，默认 24）问模型 → **逐组独立过护栏**；跨组借证据会被拒（引文只能在本组语料反查到），模型漏给某组结论则如实降级为 `llm_invalid_json`（不替它补结论），弱链伪类既不命名也不进批次；目标按**强度降序**挑选（`maxClasses` 默认 12）。预算可见可控：整批 memo（同口径重复打开 `llmCalls: 0`）、逐组 per-class 缓存、页头显示「本次模型调用 N 次 · 缓存命中 M 组」；「重新命名全部」= `refresh`，行内「重命名」= 只重算该组；批量与单类提示词版本不同（`NAMING_BATCH_PROMPT_VERSION`），两种问法互不冒充缓存。
  - 界面：`components/ConceptClassesCard.tsx` 重写 —— 第一行 强度分 → 模型主题名（紫色，仅 `named` 才显示名字，降级显示三态）→ 备选 → 排名/class id；第二行 涨停数 / 均涨幅 / 最大涨幅 / 上涨只数 / 类内相关 / 强边密度 / 规模（缺失标"仅 N/M"）；第三行 成员票 chips（涨幅 + 涨停标记，点击跳到工作台看图）；「证据」展开逐条引文与采集口径。
- 验证锚点：`tsc` / `eslint --max-warnings 0` / 单测（**14 文件**，新增 `tests/concept-strength.test.ts`，`naming-pipeline.test.ts` 增 5 条批量用例：强度挑选、跨组引文被拒、缺项如实降级、memo 命中、分批不改变结论）。
  - 其余门禁与体积：`guard:ux` / `guard:budget` / `guard:contrast` / 体积（588.6 KB / 650 KB）/ `smoke:naming`（新增第 6 段：批量全链路）全部通过。
- 新增 `scripts/smoke-concept-classes.mjs`（`pnpm smoke:concept`，已接 CI）：真引擎 + 假行情，验证"引擎 → 补数 → 回给界面"接线（成员字段名 / 均涨幅 / 涨停数 / 强度公式 / 快照只拉一次 / 第二次调用零取数）。**它抓到一个真 bug**：内部成员是 camelCase（`chgPct`/`limitUp`）而前端按 snake_case 解析 → 成员涨幅全是"—"、涨停标记全灭且不报错；现 host 侧显式归一成 `chg_pct` / `limit_up` / `corr`，并把字段名写成冒烟断言。
- 仍未做（下一步第一件事）：**真机未复验**（需重启 `dsh web` + 硬刷新）——① 打开「自挖板块」是否自动出现主题名与"本次调用 N 次"；② 排序是否与行内涨幅/涨停数一致；③ 涨停数与状态带广度是否同口径；④ 重复打开是否 0 次模型调用；⑤ 非交易日（as_of ≠ 今天）是否只采可回放素材。

---

### 2026-09-12 · A6 导航平铺：拆掉「工具」中间层，摘除三个重复入口

- 问题/目标（用户侧一句话）：以前要点「工具」再找区块的页面，现在都应在状态带上与「复盘 / 作战」并排；同属产品闭环 A 轨，实施依据见 `PRODUCT-DESIGN.md` §6e。
- 处置与关键改动落点：
  - 一级导航平铺：`复盘 | 作战 | 行情 | 自挖板块 | 选股筛选 | 监控规则 | 外盘`（`PRIMARY_VIEWS`，顺序 = 状态带顺序 = `1-7` 键位；外盘仍为次要：排最后 + 颜色更淡）。旧 A4「工具单页」下线：`views/ToolHost.tsx` 删除，主区改由 `views/ViewHost.tsx` 按 `view` 单页渲染（`switch`，不是一排 `hidden` 容器 —— `display:none` 不停轮询）。
  - 摘除「自选盘」「个股明细」（左栏常驻列表就是它们的入口，按"只摘入口、留文件"处理，不再被引用 → 不进 bundle）；摘除「看盘」入口 —— 它更名**工作台**（`WORKBENCH_VIEW`）且**不上导航栏**（不占键位、不会"切走回不来"），⌘K 仍可搜到（搜 `ALL_VIEWS`）。
  - 看盘二级页签（工作台/明细/自选盘）与 `SUB_VIEWS` / `setSubView` / `ui.sub` 一并删除；**默认入口改为「行情」**（`DEFAULT_VIEW`，用户决策）—— v1.4 的"按时段落到复盘/作战"作废，复盘/作战一键可达（`1`/`2`），时段边界仍自动跟随（用户没手动点过导航时）；单测钉住"默认值必须是导航栏上的入口"。
  - **UI 键升到 `stock-panel:ui:v4` 并做一次性落点重置**：只改 fallback 的话，老用户浏览器里的 `ui:v3` 会压过新默认；读到旧键时 `initialViewOf()` 统一返回行情（其余偏好照常继承），写回 v4 后按用户选择记忆。
  - 机制与键位：`TOOL_VIEWS` / `ui.tool` / `setTool` / `closeTool` / `toolIdOf` / `LEGACY_TOOL_IDS` 全部删除，`toolIdOf` → **`viewIdOf`**（旧 id `overview`/`indices`/`ladder` 仍就地映射到 `market`，落盘的 `tool` 值也参与迁移 → 老用户不掉页、不报错）；键盘 `1-7` 改为一级入口、`t`（工具抽屉）下线（普通字母放行）、`Esc` 只剩两层（⌘K 面板 > 诊断面板）；`lib/hotkeys.ts` 契约表与 `tests/hotkeys.test.ts` 同步（含"工作台不得回到 PRIMARY_VIEWS"回归断言）。
  - 机制与键位（⌘K 面板）：功能名直达从"工具区块"改为"一级入口"（分组名 `入口`）。
  - 状态带：导航 4 项 → 7 项，窄档（tight/min）给导航加**横滚兜底**（`min-width:0` + `overflow-x:auto`，防"导航变宽把右簇挤出可视区"）；死样式 `.dc-tool-body/.dc-tool-more/.dc-tool-entry*/.dc-toolgroup*/.dc-page-head` 清理，页面挂载槽改名 `.dc-view-body`；作战页静默期任务卡改文案（"建自选观察池 → 展开左栏「自选」分组"、"体检监控规则 → 切到「监控规则」入口"）。
- 验证锚点：`tsc` / `eslint --max-warnings 0` / 单测（13 文件，`selection.test.ts` 按 A6 契约重写）/ `guard:ux`（21 条）/ `guard:budget` / `guard:contrast` / `check-bundle-size` / 4 个离线 smoke 全绿；`pnpm build` 通过。
  - 构建产物核对：`lib/client.js` 里 `自选盘`/`个股明细`/`toolToggle`/`closeTool`/`dc-tool-entry` 均 0 次命中，`复盘/行情/自挖板块/选股筛选/监控规则/外盘/工作台` 均在。
- 仍未做（下一步第一件事）：**真机未复验**（需 `pnpm build` 后重启 `dsh web` 并硬刷新）——① 状态带 7 个入口一屏内可见（含窄容器档位）；② 点左栏任一行落到工作台；③ `Esc` 不再关掉主区；④ `1-7` 与 ⌘K 直达；⑤ 老用户落盘值（当年 `tool` 字段）迁移后不空白。

---

## [1.4.0] 2026-09-12

**流程驱动导航 + 官方槽注入 + AI 双通道**（v1.2 / v1.3 / v1.4 三个迭代的合并发布）

> 本批是**体量最大的一次界面重构**（新增 `src/panel/*`、`src/views/*`、`src/lib/{selection,stage,ai,ai-task,ai-contract}.ts`、`src/host-ai.ts`
> 与两个离线冒烟脚本）；此前长期滞留在工作区、**没有 git 回滚点**，2026-09-12 一次性固化并统一版本号（见 `docs/ROADMAP.md` B1）。

### v1.2 —— 注入方式回到官方契约（废弃宿主布局补丁）

- 界面注入改为官方 `conversation.view` 视图标签页（`ctx.slots.inject`，声明感知）。
- **删除**：布局补丁引擎 `src/layout-patch.ts`、锚点表、`scripts/patch-layout.mjs`、`scripts/validate-layout-versions.mjs`、`patches/`（bundle 快照与备份）；宿主 bundle
  已还原 pristine —— 插件**不再读写宿主任何发行物**。
- 面板 Tab/标的状态改为 localStorage 持久化（视图会被卸载重挂）。

### v1.3 —— 宽视图沉浸式盯盘台 + AI 双通道

- 三段式骨架：状态带（阶段/指数/广度/情绪/问模型/⌘K）+ 左栏列表 + 主区 + 右栏 AI 常驻；左侧零额外请求（自选/涨停/异动从状态带已轮询的全 A 快照过滤）；键盘优先（⌘K、1-3、t、j/k、a、`[`/`]`）。
- 视觉跟随 DSH 主题：`src/index.css.txt` 只做 `--dc-*` → 宿主 `--dsw-*` 语义映射，A 股红涨绿跌是唯一自持配色。
- **AI 直调**（`src/host-ai.ts` + `POST /api/stock-panel/ai`）：读宿主 `ctx.agentDefaultModel` 路由，`ctx.llm.stream` 出一份严格 JSON，失败优雅置灰且不影响行情；**AI
  契约**（`src/lib/ai-contract.ts`）prompt 与解析同源、去围栏/配平/字段夹取、原文永不丢。
- **自愈重试**：`maxTokens` 是 reasoning + 正文共享预算（提到 6000），`finish=max-tokens` 时自动裁一档重试（≤3 调用 / ≤3 裁剪分开计数），`meta.shrunk` 回传并由 UI 显式提示。
- **结论回填视图**三处：个股决策卡 + 主图价位线（`priceLines`）／复盘「AI 预期排序」／选股「AI 候选排序 + 表内 `AI#n` 徽标」—— 全部**只读参考 + 逐条采纳**，不覆盖用户草稿；「深入对话」通道把上下文注入当前对话（输入框有草稿时置灰）。

### v1.4 —— 导航改为流程驱动

- 一级导航从「4 个功能视图」改为**方法论两阶段 + 自由看盘**（复盘 / 作战 / 看盘），其余 8 个旧页面收进「工具」（`t` 或 ⌘K 直达）。
- 新增阶段模型 `src/lib/stage.ts`（时段 → 复盘/竞价/盘中/尾盘 + 该阶段必须回答的问题 + 唯一输出）与**阶段头**（方法论原文摊在页面顶部）。
- **时段自动跟随 + 手动优先**：跨 9:15 / 14:30 / 15:10 自动切入口，手动点过后本会话不再跟随；复盘/作战用 `.dc-flow` 列流宽屏并排（复盘页 ⑦ 输出独占整行）。
- 新增 `src/lib/selection.ts` 作为「当前标的 + UI 状态」唯一真源（v3 键 + v1/v2 迁移）。

### 同期修复与配套

- **B5 构建可见性**：构建 id = src 内容哈希（`scripts/build-id.mjs`）；`__PANEL_VERSION__` / `__PANEL_BUILD_ID__` 由两条构建链注入（tsdown 0.13 不消费 `define`，改用 rolldown
  插件文本注入）；host 新增 `GET /api/stock-panel/build`；底栏显示版本 + 构建 id，服务端重建后提示「有新构建 · 点此刷新」。
- **B6 静默失效**：① 关键价位是 HTTP-only 端点，embedded 部署下必然 404 且被 `allSettled` 吞掉 → 新增 `api.stockAnalysisLevelsAvailable()` 并显式提示不可用原因与替代做法；② AI 请求的
  `AbortController` 从未透传 signal（取消是死代码）→ 三处包装透传，切换标的/卸载即取消在途 90s 流。
- **B3 请求预算**：ladder 加 30s 共享缓存 + in-flight 去重（此前作战页/梯队页/复盘页各自重算，实测约占全部工具调用 90%），`fetchAllA(true)` 改复用 market 的 20s 缓存；轮询在 `document.hidden`
  时跳过（一处修复覆盖 13 个 SWR 轮询者）+ 左栏收起停止轮询 + 3 个直连 `setInterval` 加守卫；修 `cache.ts` 的 `refreshInterval` 变更永不生效（deps 缺项）。
- 修 `fmtPct` 口径错（指数显示 `上证-117.66%`）—— 统一走 `pctText()`；修 `stock-data.ts` `toArray` 对已解析数组二次 `JSON.parse` 导致整层静默空返回。
- 新增离线冒烟 `smoke-client-view.mjs`（视图注册契约 + 持久化降级）、`smoke-ai-contract.mjs`（AI 契约）、`smoke-host-state.mjs`（host 半 26 项断言：三条路由 / 持久化领域 spec 契约 / 读写闭环 / 降级），
  并接入 CI（host 半此前**零离线覆盖**）；体积护栏经登记后 820 → 840KB。
- **B1 基线纪律**：本批 64 文件此前长期未提交（含 CI 引用的两个冒烟脚本），2026-09-12 一次性固化；版本统一 1.4.0（唯一来源 `package.json`）。

### A1 —— host 侧持久化（全量迁移 + localStorage 降级）

- 新增 `stock_panel` 领域（DSH 存储子系统，json 后端 → `$DSH_HOME/storages`），8 张表：`watchlist / review / dayrun / positions / tradelog / verdicts / events / viewed`；host
  半新增 `GET/POST /api/stock-panel/state`（`src/host/state.ts`），失败如实返回不可用原因（**不静默降级**）。
- 客户端 `src/lib/host-state.ts`：启动拉一次快照 → 覆盖 localStorage 镜像 → 通知各 store 重载（`onHostHydrated`）；写入按**指纹差量**推送（事件流 500 条也不全量重发）；不可用时保持纯本地。表清单单一来源
  `src/lib/state-tables.ts`；新增 `src/lib/viewed-store.ts`（在 `selection.setSelection` 单点埋点）；底栏新增「持久化：host / 本地」+ 诊断句柄
  `window.__STOCK_PANEL__.hostState()`。
- 契约取舍（实测）：领域名不能有连字符（`UNIT_NAME_RE`）→ 用 `stock_panel`；**不 import `@deepseek-ai/dsh-storage-domain`**（公开 npm 只有 0.0.1-rc.1，宿主是 0.1.2-rc.1）→ 手搓
  spec + 极简 `parse/safeParse`，零依赖；`storageDomain` 不列进 inject（可选增强）。
- B5-② 缓存收口：`cache.ts` 新增命令式 `swrFetch`，`market.fetchAllA` 删掉私有缓存改走同一 SWR store（此前同一份全 A 快照有两套缓存）；删除死文件 `src/lib/queryKeys.ts`（零引用，react-query
  并非依赖）。
- `scripts/verify-state-domain.mjs`（用宿主安装的 cordis + dsh-storage + storage-json + storage-domain 真跑一遍手搓 spec，16 项断言）暴露两个契约陷阱：① `layout: per-record`
  把记录键当**文件名**（要求 `^[a-zA-Z0-9_-]+$`），而自然键含 `:` 与中文（事件流 `SH-600519-10:03-封涨停板`）→ host 层 `encodeStateKey/decodeStateKey`（base64url，对客户端透明）；②
  `version` 不一致**不报错而是静默丢弃旧记录** → 「版本固定为 1」是硬要求（实测 `compatibleVersions` 是官方逃生口）。两条已写进 `docs/ARCHITECTURE.md` §5.2 与代码注释。
- **时序 bug（会让 A1 完全失效）**：旧实现在 `apply` 里读一次 `ctx.storageDomain`，读不到就把「不可用」永久缓存，而 cordis 服务挂载不保证早于插件 `apply` → 改 `ctx.inject(['storageDomain'], cb)`（声明式注入）+
  请求路径 `ensureStateReady()` 惰性重试，**不缓存否定结论**，兜底解析 `ctx.storage.domain`，诊断新增 `facilitySource`。
- **第一轮真机验证推翻了我的判断（已再修）**：取证（读官方消费方 `dsh-session-projection-cache` 源码 + `~/.dsh/storages/workspace.json` 当日仍在写）得到两条硬结论：① cordis 的服务**只有被 inject
  声明过**才在该 ctx 上可见；② `ctx.inject(deps, cb)` 的**回调必须使用它给的 scoped ctx**。修法 `ctx.inject(['storageDomain'], (scoped) => initStateDomain(scoped))`，诊断字段改为如实记录"是否真的声明成功
  / 回调是否触发"。回归用例 `smoke-host-state.mjs` `[6]` 服务晚到后自愈、`[7]` hub 路径、`[8]` 声明式注入（服务**只**挂在 scoped ctx 上也必须可用）、`[9]` 不可用时必须交代取证字段。
- **A1 首迁可靠性**：出现「`migratedFromLocalStorage=true` 但 8 张表记录数全 0」（首迁上传在途被刷新取消）→ 改为先 `flushState()` 确认全部上传成功**才**写首迁标记，失败进 `failedTables` 并自动重试（回页面
  / 5 秒后），诊断面板新增「待同步表数」。
- 新增实机验收工具 `scripts/verify-live.mjs`（`pnpm verify:live`）：① host 半新鲜度（运行 buildId vs 源码 buildId，不等即提示重启）② 持久化可用性 + 8 表 + 服务来源 ③ 写→读→删闭环 ④ AI/行情信息项。
- **B4 质量网**：仓库此前没有 ESLint、没有测试框架 → ESLint（flat config，规则克制）**0 error / 0 warning**，CI 用 `--max-warnings 0` 做棘轮；单测零新增依赖（Node 内置 `node:test` +
  `scripts/unit.mjs`）**7 个文件 / 65 条**（`indicators` / `regime` / `strength` / `situation` / `review-metrics` / `screener` / `chips`）；CI 增 lint
  与单测两步。单测抓到 5 个真问题：`regime` drivers 截断挤掉强制压温原因；全 0 输入温度仍 >0（记为行为契约，空数据须 UI 判空）；`classifyStrength` 量比阈值恒真（`&& t.volRatioStrong` → `r.volRatio >= t.*`）；`chips`
  空输入抛 TypeError 而非约定文案；`screenRows(rows, cond, 0)` 返回 1 条。踩坑：ESLint flat config 里「只含 ignores 的对象」才是全局忽略。
- **B2 体积（用户决策：默认 minify + sourcemap）**：client.js 822.5 → **530.8 KB（−35.7%）**，护栏 840 → **600 KB**（余量 2% → 11.5%）；先量后减，新增
  `scripts/bundle-report.mjs`（实测大头 `lightweight-charts` 216.8KB(26%)、自有页面代码 175.9KB(22%)）；可调试性用 `lib/client.js.map` 补偿（宿主 client-modules 层校验为
  Source Map v3）；逃生阀 `CLIENT_MINIFY=0`（需配 `CLIENT_MAX_KB`）。
- **A2b-① 命名内核**（`src/host/naming/`）：把 `cluster-namer`（Python 参考实现）的命名阶段逐条移植到 host 半，纯函数、零外部进程、25 条离线单测（`tests/naming-guard.test.ts`）——
  `guard.ts` 证据护栏（引文逐字反查、A5 可计算证据分 0.40 覆盖度 + 0.25 命中票数 + 0.20 窗口内比例 + 0.15 条数、A6 时间窗护栏、A7 降级成因分层；**模型自报 confidence
  只作展示，不参与门控**）、`prompt.ts`、`parse.ts` 分级降级解析、`fingerprint.ts` 口径指纹（含提示词版本，不匹配视为未命中）、`materials.ts` 素材归一（板块类型码 12 行业/4 概念/5 风格/3 地区、非叙事板块词黑名单、去重
  Dice ≈ difflib 0.9、每票每源配额、字符预算截断）。
- **A2b-① 移植时修掉的两个偏差（单测发现）**：① 参考实现按语料顺序取引文出处，同一文本同时存在于窗口内外时会先撞上最旧那条、把窗口内证据挡掉（冤枉降级）→ 改为优先认窗口内那条；② 括号补齐"先 `}` 再 `]`"对 `{"a":[1,2` 仍非法 →
  改为按括号栈补（含未闭合字符串）。
- **A2b-② 接线：采集 / 编排 / 路由 / 缓存 / 两个 UI**：`collect.ts` —— 只在 `as_of === 当前交易日` 时采实时源（异动/主力监控是当日实时列表、无历史接口），否则记入 `missingSources`
  并写明「不做历史回放」，板块归属照用但标注"当前快照"，封板状态由日K推导（可完全回放）并用同一口径的连板统计取代参考实现的 ChangeUpType；`run.ts` 编排（取类成员 → 弱链伪类拒绝命名且零模型调用 → 采集 → 模型 → 护栏 → 进程内缓存 key =
  asOf:classId:fingerprint，依赖全部注入故可离线跑通）；`route.ts`（`GET` 回能力 + 口径：模型路由/提示词版本/默认参数/护栏阈值/采集预算/缓存条数/当前交易日；`POST` 命名，`classId` 必填、非法一律 400 不猜默认值）；UI
  为个股卡 `StockConceptCard` + 类列表 `ConceptClassesCard` + 共用的 `NamingResultPanel`（三态 + 证据分 + 逐条引文 + 采集口径偏差 + 「自挖类 ≠ 官方概念/行业」声明）。
- **A2b-② 覆盖与体积**：`tests/naming-pipeline.test.ts`（16 条）+ `scripts/smoke-naming.mjs`（对构建产物验路由与口径，CI 已接）+ `verify-live.mjs` 第 ④
  段（对运行实例真的命名一次）；client.js 534.3 → **558.0 KB**（护栏 600 KB，余量 42 KB），host lib/index.js 177.8 → 227.2 KB。**v0 明确不做**：与官方行业的重合度对照、命名缓存跨进程持久化。
- **A4 行情页合并**（市场总览 + 指数 + 涨停梯队一页三块，用户决策）：三块回答同一条问题链，拆成三个入口只会让用户在页签间来回跳。**合并 ≠ 把三个轮询拼一屏**（涨停梯队单轮 ≤177 次工具调用），故定三条纪律并写进注释：①
  `IntersectionObserver`（`rootMargin 240px` 预热）滚到可视区才挂载；② 离开视野停轮询但保留数据与 DOM（`enabled=false`）；③ 全页只有一个节拍器（15/20/30/60s 或暂停）。三个旧工具
  id（`overview`/`indices`/`ladder`）由 `toolIdOf()` + `LEGACY_TOOL_IDS` 就地映射到 `market`（不映射则老用户落盘旧值被静默丢弃）。测试 `tests/selection.test.ts`（3 条）；体积 558.0
  → **567.1 KB**（护栏 600 KB，余量 33 KB）。
- **A4 行情面板改为「一屏并排聚合」**（更正上一批的竖排做法）：12 栅格并排（总览 4 / 指数 5 / 梯队 3），**列数按容器实测宽度**（`ResizeObserver`，≥1120 三列 / ≥760 两列 / 否则单列）而不是 Tailwind 视口断点（DSH 左栏
  + 右 AI 栏都在时视口 2560px 而面板只有约 600px）；每块自带本块刷新时间 + 单块刷新 + 折叠（折叠即卸载、该块轮询停止）；默认节拍 30s，页头显示「轮询中 N/3 · 节拍 · 上次刷新」。真机验证（浏览器实拍）：三块并排、块时间戳 12:24:09 /
  12:24:03 / 12:24:06、轮询 3/3、总览块无重复指数条。体积 **568.8 KB**（护栏 600 KB，余量 31 KB）。

---

## [1.1.0] 2026-09-10 · `403ac38`

**内置 node-tdx 数据链路 + HIST 自挖概念引擎（移除远端 MCP 依赖）**

- 数据链路从「浏览器 → host 半桥接 → 远端 MCP(192.168.31.196:8007)」改为 **host 半进程内 node-tdx 直连**（`src/host/vendor/opentdx.js` + `src/host/tdx-data.ts`），端点成为同源
  `POST /api/stock-panel/call`；远端 MCP 与兜底回退全部移除。
- 工具覆盖扩到 **19 个**：15 个行情工具 + **4 个 HIST 自挖概念工具**（`hist_concept_query/classes/class/status`，`src/host/hist-data.ts`，进程内 HistEngine，快照 TTL 3600s）。
- 新增 **筹码分布**（`src/lib/chips.ts` + `src/components/chip-profile.ts`，日 K L0 → 逐笔 L1 升级，300% 换手窗口，K 线图叠加与统计条）。
- 新增 **SWR 缓存层**（`src/lib/cache.ts`：ttl / refreshInterval / in-flight 去重 / 失败驱逐 / 重试冷却）。
- 个股页：分时接入、日 K 区间 + MA 开关、逐笔成交折叠面板（`StockIntraday` / `StockTransactions`）。
- 新增 `scripts/smoke-embedded.mjs`、`scripts/update-opentdx.mjs`（vendor 刷新）。

## [N8/N9] 2026-09-07 · `5a748b7`

**看盘流程任务化 + 复盘页七步向导**

- `src/lib/dayrun.ts`（当日运行记录：Q1/Q2/Q3 答案 + 竞价逐条判定，60 日环形）；`src/lib/mission.ts` + `SessionMission`（时段任务条：唯一目标 + 检查清单 + 倒计时）。
- `QAnswers`（盘中三问必答卡）、`ExpectVerdictPanel`（昨日预期 × 今日竞价逐条判定 → 写回 dayrun）。
- 复盘页七步引导条与「AI 预期排序」（含对用户已写草稿打分）。

## [1.0.1] 2026-09-07 · `f2ea5fe`

真机验收修复：网关告警节流 + 退化行情过滤（无真实行情时不显示误导性温度计/局势）。

## [1.0.0] 2026-09-06 · `204b05f`

打包发布治理：`scripts/sync-profile.mjs`、`scripts/check-bundle-size.mjs`（体积护栏）、`.github/workflows/ci.yml`（build + `tsc --noEmit` + 护栏 + 冒烟）。

## [0.9.0] 2026-09-06 · `ddb971e`

M10 扩展市场（外盘）：美股/港股报价 + 日 K（`goods_quotes`/`goods_kline`，quote 缺失回退 K 线自算），期货多市场异动快览（`goods_varieties`）。

## [0.8.0] 2026-09-06 · `b61daee`

M8 轻量选股：`src/lib/screener.ts`（全 A 快照条件筛选 + 6 张预设策略卡 + 客户端信号「MA5 上穿 MA20」「放量上穿 MA60」，候选 ≤200、并发 ≤8 带进度）+ `pages/ScoutPage.tsx`。

## [0.7.0] 2026-09-06 · `f541bb2`

M7 本地监控：`src/lib/alerts.ts`（价格突破/跌破、涨跌幅、异动关键词规则 + 命中记录 200 条环形 + 冷却去重）+ `AlertWatcher`（12s 轮询，零额外请求复用行情/事件）+ 「监控」页 + 未读徽标与 Toast。

## [0.6.0] 2026-09-06 · `4e096ca`

M9 个股页增强（分时/日 K 区间 + MA/逐笔）+ 修复数据层 `toArray` 严重缺陷（数组被二次 JSON.parse 导致整层静默空返回）。

## [0.5.0] 2026-09-06 · `1bde754`

复盘温度计**实算**：`review-store` v3 建档昨日涨停池/首板池（v2 自动迁移）+ `src/lib/review-metrics.ts` 实算晋级率/炸板率/首板溢价；N3 强度差分接入复盘页（观察池 ≤120：真强/惯性/转弱/弱转强 +
低位首板候选一键加入预期清单）。

## [0.4.0] 2026-09-06 · `6eb5e42`

基线固化 + 方法论批次 N1–N7：复盘模式（盘眼/预期清单 ≤5/存档）、竞价雷达与对照矩阵、事件流/板块脉冲/局势归类、情绪温度计与仓位闸门、持仓决策台 + 凯利仓位、个股页竞价回顾 + 资金面板；卫生清理（移除 echarts 死依赖、api.ts dataSource
翻转副作用、KlineChart 受控 rows）。

## [0.3.x] 2026-09-02 ~ 09-05

M0–M6：插件骨架打通 → 日 K/分时（lightweight-charts）→ 信息条/关键价位 → 标的搜索/自选 → 市场总览/指数/自选实时行情 → 涨停梯队 + 板块连板统计与热度聚合。
（期间数据链路为「浏览器 → host 桥接 → 远端 MCP」；`stock` 第四列布局补丁形态，v1.2 已废弃。）
