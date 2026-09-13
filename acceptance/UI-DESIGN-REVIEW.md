# UI 设计评审与美化（第一轮）

> 对象：A股工作台插件面板（client 半）· v1.4.0 · 日期：2026-09-13 · 方法：**真机取数**（隔离 headless Chrome + CDP，非静态读码）
> 证据：`acceptance/shots/`（before / after2 各 11 张 + dark 13 张；**可重建的工作目录、未入库**——`node acceptance/shots.mjs`）、`acceptance/71-style-audit.json`、`acceptance/82-style-audit-after.json`
> 全部改动集中在 **`src/index.css.txt`**（16 处），未改任何组件逻辑。
## 一、评审方法：先量，再改

- `acceptance/audit-inpage.js`：在页面里遍历 `.dsh-stock *`，统计**可见文本节点**的字号/字重/字体分布、全量圆角取值分布、控件的实际命中高度分布、数值单元格是否等宽、交互态（hover / :focus-visible / transition / prefers-reduced-motion）是否真的存在于 CSSOM。
- `acceptance/style-audit.mjs`（起隔离 Chrome → 打开工作台视图 → 注入上面的脚本 → 落盘 JSON）与 `acceptance/shots.mjs`（按 7 个一级入口逐个切页截图，含窄/宽/暗三种容器条件，作为"底图"）。
## 二、评审结论（实测数据）

| # | 发现 | 实测证据 | 判断 |
| --- | --- | --- | --- |
| 1 | **单位字跌破自己定的下限** | 11px 正文里的 `.dc-unit`（`font-size: 0.92em`）算出 **10.12px**，出现 2 处 | 该文件明确定"最小 11px"，自己却破了例；10px 中文/单位基本读不清 |
| 2 | **圆角六档混杂** | 实测同时存在 2/3/4/5/6/8px：`4px(72)` `6px(29)` `2px(8)` `5px(7)` `8px(3)` | "手写样式"最典型的气味——同一屏能看到三种圆角 |
| 3 | **命中区偏小** | 控件高度分布：17px(3) 18px(5) 20px(3) 21px(10) 22px(22) 24px(16) → **21 个低于 WCAG 2.2 的 24px** | 现有契约只守了 `.dc-nav-item`，其他地方漏守 |
| 4 | **容器"浮"不起来** | 卡片底 `--dc-layer-2 = #f8fafc` vs 面板底 `#ffffff`，只差 1 个色阶；卡片无投影 | 亮色下层级全靠 1px 描边撑；暗色更糊 |
| 5 | **工具外框与内容同色** | 状态带 / 左右栏 / 底栏都是 `--dc-layer-1`（= 页面白），只有 1px 分界线 | 三栏结构与"工具条"缺一层底色，结构读不出来 |
| 6 | **分节标题没有存在感** | `.dc-section-label` 是 11px + `--dc-dim` 灰字，与正文同色同重 | 一屏十几段的密排里扫不出段落边界 |
| 7 | **空态像"没加载出来"** | `.dc-empty-mark` = 22px 字符 + `opacity: .7`，周围整屏空白 | 空态没有视觉锚点，与"故障"难区分 |
| 8 | **已做对、本轮刻意不动** | 10/10 数值单元格已是 `tabular-nums`（`.dc-num`）；全站 `:focus-visible` 焦点环（有，且用品牌色）、`prefers-reduced-motion`（有）、A 股红涨绿跌与"状态语义色"解耦（有） | ✅ 但**只有被 `.dc-num` 包裹的**才等宽 |
## 三、改动清单（16 处，全在 `src/index.css.txt`）

- **A. 尺度自洽**：① `.dc-unit` `font-size: 0.92em` → `max(11px, 0.92em)`（保住"小一档"层级又不破 11px 下限）；② 新增圆角 token `--dc-r-xs/sm/md`（4/6/8，与 `tailwind.config.js` 的 `rounded-dc-sm|md|lg` 同值），收敛 `.dc-btn`(5→6)、`.dc-tag`(3→4)、`.dc-card`(8→token)、滚动条(3→4)；③ 新增层级 token `--dc-shadow-1/2`：优先吃宿主 `--dsw-shadow-lv1/2`，取不到才用兜底值。
- **B. 层级与分层**：④ `.dc-card` 加 `box-shadow: var(--dc-shadow-1)`、圆角走 token、padding 8/10 → 10/12；⑤ `.dc-card-head` 加下分隔线 + 字距；⑥ **状态带 / 左右栏 / 底栏改用 `--dc-layer-2`**（工具外框），主区保持纯白 —— 本轮观感变化最大的一处；⑦ `.dc-rail-head`：`--dc-layer-3` 底 + 600 字重；⑧ `.dc-section-label`：600 字重 + `--dc-text-2` + 品牌色竖条（`::before`，不占布局宽度）。
- **C. 可读性与手感**：⑨ `.dsh-stock` 根**全局 `font-variant-numeric: tabular-nums`**（列不再参差、刷新不整行抖动；对中文与字重无影响）；⑩ `.dc-btn` 字重 400 → 500；⑪ `.dc-btn--icon` `min-width/min-height: 24px` 方形命中区；⑫ `.dc-chip` `min-height: 22px` + 内边距 2/9（原 ~18px）；⑬ `.dc-tag` `line-height` 16 → 18px；⑭ `.dc-row` 补 `transition: background .12s ease`；⑮ `.dc-empty-mark` 22px 灰字符 → **44px 柔和圆底**（前景色 7% 混出）+ 居中字符；⑯ 暗色主题 `--dc-shadow-1: none`（深底看不见投影），层级交给提亮描边。
## 四、复核（改前 / 改后，同一套真机审计脚本）

| 指标 | BEFORE | AFTER |
| --- | --- | --- |
| 字号 <11px 的文本节点 | **2**（10.12px，单位字） | **0** ✅ |
| 圆角取值档位 | 5 档（2/4/5/6/8px） | **3 档**（4/6/8px）+ 空态圆形 |
| 控件 ≥24px 命中区 | 16 个 | **21 个**（+5） |
| 17–21px 小控件 | 21 个 | **17 个**（−4） |
| 数值单元格等宽 | 仅 `.dc-num` 内 | 全局（含表格/列表内的裸数字） |
| 交互态定义 | hover / focus-visible / transition / reduced-motion 均有 | 同（新增卡片阴影与行过渡） |

**门禁复核（全部 exit 0）**：`pnpm build` · `npx tsc --noEmit` · `pnpm lint`（0 warning）· `ux-contract`(25 条) · `ux-density --check` · `contrast --check`(30 项，含暗色) · `budget --check` · `check-bundle-size` · `build-client --check`（证据：`acceptance/80-polish-*.log`、`acceptance/83-layer-*.log`）。

**功能回归（真浏览器）**：`acceptance/85-e2e-after-polish.log` —— 视图注册 / 19 工具 / embedded 真机调用 / 7 个一级入口逐个挂载 / 0 未捕获异常 / 0 console.error 全部通过；唯一一条 FAIL 是我自己写的"渲染后立刻查 canvas"时序断言（同脚本稍后的数据落地检查里 canvas=7 通过），已删除该重复断言。
## 五、没做的（下一轮候选，按收益排序）

1. **类卡片头部的"空证据带"**：`ConceptClassesCard` 证据区为空时仍占一整块高度（JSX 结构问题，需组件级改动，本轮刻意只动 CSS）。
2. **行情页三个块头是 TSX 手写的**，未复用统一"块头"类；建议抽 `.dc-block-head` 并纳入 ux-contract 守护。
3. **单列退化态滚动语义**：容器 <1120px 时三块竖着摞，"各块内部滚动 + 整页不滚动"退化成整页滚动。
4. **表格表头底色/斑马纹缺失**：复盘与组件的长列表行多时定位成本高。
5. **暗色主题未出实机截图**：机制已确认（`body[data-ds-dark-theme]` 下 `--dsw-alias-bg-base` 实测 #fff → #151517、面板 token 解析为 rgb(21,21,23)），但 headless 合成器没重绘那一帧 —— 属**截图工具限制**、非产品缺陷；暗色对比度由 `contrast.mjs` 的 30 项数值校验覆盖（含 dark 组），要实机底图需在宿主里把外观切成深色后手动截。
6. **仍有 17 个 <24px 的控件**（主要在状态带次要项与行内小标签，收敛需逐个评估布局影响）；**状态带密集度**：窄容器下仍是最挤的一条（7 个入口 + 指数条 + 右簇），本轮未动其栅格。
