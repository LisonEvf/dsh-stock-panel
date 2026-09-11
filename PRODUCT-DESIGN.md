# 产品功能与流程设计 PRODUCT-DESIGN（以 WATCH-METHODOLOGY 为蓝图）

> 把 `WATCH-METHODOLOGY.md` 的盯盘方法论落成 **frontend-dsh（@lisonevf/dsh-stock-panel）** 的功能与流程设计。
> 范围：**蓝图 + 核心逻辑骨架（TS 数据结构与判定函数草案）**，不含实现代码。
>
> ## 阅读指引（2026-09-12 校订）
>
> | 章节 | 状态 |
> | --- | --- |
> | **§6c 统一看盘关注点与流程→排版重规划** | ✅ **现行设计**（v1.4 已落地：流程三入口 + 四层关注点） |
> | **§6d 信息架构 v1.5 决策** | ✅ **现行设计**（左栏自选+个股 / 工具单页 / 主区个股信息 / 特色板块 / 校准页） |
> | §5 的数据结构骨架（auction/regime/situation/positions/sizing） | ✅ 已实现，作为契约参考 |
> | §4 / §6（窄列骨架）/ §6b（4 视图三段式） | ⚠️ **历史蓝图**：§6 的窄列排版已作废，§6b 的 4 视图已被 §6c 取代 |
> | §1 原则 5「纯 MCP 无后端」/ §2 现状盘点与能力差距 / §3.1 导航 | ⚠️ **历史**：§1.5 已被 B 轨残留推翻；§2 的「分时未接入个股页」「`auction` 未接」等条目均已过时；§3.1 的「6 Tab」已被 §6c/§6d 取代 |
> | §7 轮询与性能预算 / §8 批次建议 | ⚠️ 数字与批次已迁到 `docs/ARCHITECTURE.md` §3.1 与 `docs/ROADMAP.md` |
>
> 现行总览：`README.md` · 架构：`docs/ARCHITECTURE.md` · 待做：`docs/ROADMAP.md`。
> 旧实施计划（M/N/W 批次）已归档到 `docs/archive/`。

---

## 1. 设计原则（先立规矩，防范围膨胀）

1. **一个目标**：帮助用户每天回答方法论里的三个问题（Q1 持续性增减？Q2 有无局势变化？Q3 动作？），其余功能不为此服务的一律不做。
2. **降噪优先**：页面只展示「相对昨日/上一轮的**变化**」；列表全设上限（≤20 行）；无意义的实时跳动不渲染。
3. **复用优先**：梯队/涨停池/板块热度/全 A 快照等 M6/M5 资产直接复用，不新造数据管道。
4. **时段感知**：交易日时钟（`server_info`）驱动视图自动切换：竞价(9:15-9:25)/盘中/复盘(15:10 后) 呈现对应内容，减少手动切换。
5. ~~**纯 MCP、无后端**~~：⚠️ **已过时**——行情确已纯内置（embedded node-tdx，见 `README.md`），
   但「关键价位」等仍有 HTTP-only 残留（静默失效，见 `docs/ROADMAP.md` B6）。
6. **宽视图优先**：视图占满会话列（官方 `conversation.view` 标签页形态），新页面按
   「主列表 + 右侧详情」的自适应布局设计；窄屏（<720px）退化为单列堆叠，不设固定列宽。

**明确不做**（防噪音与范围膨胀）：不扩展 AI 分析；不引入自动下单/推送交易信号；不新增图表库；不做全市场分钟级扫描；不做「当日所有涨停」之外的历史复盘回溯（仅存近 N 日快照）。

---

## 2. 现状盘点与能力差距

> ⚠️ **历史章节（M5/M6 时代）**：下表用于说明「当时为什么这样设计」。其中「分时未接入个股页」
> 「`auction` 工具未接」「关键价位需后端」等条目**均已过时**；现状以 `README.md` 与
> `docs/ARCHITECTURE.md` 为准。

### 2.1 现有资产（M5/M6，可直接复用）

| 资产 | 位置 | 对方法论的价值 |
| --- | --- | --- |
| 全 A 快照（20s TTL）+ 广度/涨跌分布/榜单/涨停跌停判定 | `lib/market.ts` `fetchAllA/computeBreadth/...` | 复盘动作一（收集异动）的地基 |
| 涨停池 + 连板数 + 一字板（≤80 只，pool≤6 并发） | `lib/ladder.ts` `loadLadder` + `indicators.ts` | 空间维（梯队/最高板/晋级） |
| 板块热度（涨停数聚合 TOP12，剔除伪板块） | `lib/ladder.ts` | 宽度维（板块涨停比/主线识别） |
| 异动合并（3 市场、去重、时间序） | `market.ts` `fetchUnusualAll` | 事件流输入（需升级为增量捕获） |
| 三市场行情轮询 / 页面隐藏暂停模式 | `MarketOverview` 等页面 | 轮询预算基线 |
| 自选（localStorage + 订阅） | `lib/watchlist-store.ts` | 观察池来源之一 |
| 分时/日K/个股页/信息条/搜索 | `IntradayChart` 等（分时未接入个股页） | 竞价/持仓个股的详情入口 |
| server_info（交易日/时段） | MCP 工具（15 个） | 时段感知驱动 |

### 2.2 能力差距（方法论需求 → 缺什么）

| 方法论环节 | 需求 | 现有差距 |
| --- | --- | --- |
| §3 复盘 | 时空标签、主线/龙头定性、**预期清单编辑/存档**、3 日强度差分 | 梯队/热度有，但无「时空定性 + 预期清单」结构化输出，无跨日存档 |
| §4 竞价 | auction 序列 → **竞价强度特征**；与昨日预期做**对照矩阵**；陷阱标记 | `auction` 工具未接；无昨日预期存档可对照 |
| §5 盘中 | 异动**增量事件流**、板块资金脉冲、局势归类、持仓决策条 | `unusual` 仅轮询快照（收盘后退化为竞价快照），无增量捕获与局面归类 |
| §6 温度计 | 涨停/跌停/晋级/炸板/首板溢价的**聚合刻度** | 原料分散，无聚合计算与仓位总闸联动 |
| §7 仓位 | 持仓记录、**自统计日志**、凯利计算与护栏 | 完全缺失（无持仓状态） |

### 2.3 数据源约束（实测确认，设计必须遵守）

| 约束 | 影响 | 对策 |
| --- | --- | --- |
| `unusual/market_monitor` 收盘后仅剩 09:15 竞价快照，缺炸板类事件 | 盘中事件只能在盘中捕获 | `event-stream.ts` 盘中轮询并**增量落盘**（localStorage JSONL），收盘后显示已捕获的历史 |
| `auction` 返回当日 09:15–09:24:57 逐点 `matched/unmatched`（盘后可查当日竞价） | 竞价分析只能在当日做；次日需在 9:15 后轮询 | 复盘时把「当日竞价」纳入盘面回顾；次日竞价对照在 9:15+ 现场取数。⚠️ `unmatched` 正负号语义（买单/卖单未匹配方向）未定论，实现前须协议冒烟实测（§7.1 纪律：禁止凭 schema 猜） |
| `board_members` 的 `sort_type=AMOUNT` 报错 | 按金额需客户端自排 | 取数后本地排序；板块脉冲拉全量成分后自算 |
| 单请求可能 15s 超时 / 全 A 响应 ≥2MB | 批量请求需并发限制与容错 | 沿用 `pool.ts`(≤6 并发) + mcp 15s 超时 + 失败降级 |
| `symbol_info.vr`（量比）与 `quote` 同源 | 竞价强度需用「竞价量/昨日同期」等自算量 | 竞价特征以 `auction.matched` 时间序列为主，不依赖外部量比字段 |

---

## 3. 信息架构与流程总览

> ⚠️ **§3.1 的导航形态已作废**（写于「6 Tab」时代）：现行导航 = 流程三入口 + 工具单页，
> 见 §6c / §6d。**§3.2 的三条数据管道划分（P1 复盘 / P2 竞价 / P3 盘中）仍然有效**，
> 实现落在 `lib/review-*`、`lib/auction-analysis`、`lib/event-stream`+`lib/board-pulse`。

### 3.1 导航（新增 1 个 Tab，共 6 个，可横滚）

```
市场 | 梯队 | 指数 | 自选 | 个股 | ★作战
                                    └─ 新增：方法论主战场（§3.2）
```

「作战」是**方法论的执行界面**：同一页面按交易日时段自动切换为两种模式：

- **盘中模式**（9:15–15:00）：竞价对照卡 → 情绪温度计 → 异动事件流 → 板块资金脉冲 → 我的持仓/决策；
- **复盘模式**（15:10 后及盘前任意时间，可手动切换）：今日回顾（自动）→ 时空定性标注 → 次日预期清单（编辑）。

### 3.2 三大数据管道（页面背后）

```
P1 复盘管道（15:10+ 触发 / 手动）
   fetchAllA(缓存) + loadLadder(涨停池/梯队/板块热度)
   → 汇总: 涨停/跌停/最高板/晋级率/炸板统计/首板溢价(需昨日池)
   → strength.ts: 对候选集(≤120)拉 kline(DAILY,5) 算 3 日相对强度差分
   → regime.ts: 温度计刻度
   → review-store.ts: 写 ReviewSnapshot(今日) + 默认生成次日预期草稿(龙头/主线/失败条件)

P2 竞价管道（9:15–9:25，会话内）
   观察池 = 昨日预期清单 + 今日涨停候选 + 自选(上限 ~40)
   → auction-analysis.ts: 每标的 auction(市场,代码) → 竞价强度特征
   → 与 ReviewSnapshot.预期清单 对照 → 强弱转换标记(弱转强/强转弱/证伪/超预期)
   → 陷阱规则(isFalseStrong) 过滤后进「竞价雷达」列表(≤15)

P3 盘中管道（9:30–15:00，30s 轮询，页面隐藏暂停）
   event-stream.ts: unusual×3市场 + market_monitor×3 增量捕获(去重落盘)
   board-pulse.ts: 热度板集合(≤8, 取当日 ladder.top) × board_members(count≤100)
                    每轮差分 → 涨停数/涨速/成交占比变化 > 阈值 → 脉冲事件
   regime.ts: 温度计按最新广度/梯队数据滚动
   → 局势归类(strength/regime 规则表 §5.3) → 决策条 Q1-Q3
```

### 3.3 与现有页面的联动

- 任意列表行点击 → 复用 `onOpenStock` 打开「个股」Tab（个股页后续补 auction/资金面板，见 §8）；
- 竞价雷达/事件流中的标的自动出现在「自选」提醒点（`watchlist-store` 徽标）可选，默认关闭（降噪）；
- 「作战」页隐藏/切走时暂停轮询（沿用现有页面模式），恢复后 1 轮内对齐。

---

## 4. 复盘模式（P1 管道）设计

### 4.1 页面块（自上而下，全部窄列）

1. **今日盘眼**：指数/广度/成交额一行 + 温度计刻度 + 主线一句话（系统给出候选，人确认）。
2. **自动回顾区**：
   - 涨停梯队条形（复用 `LadderPage` 逻辑，只读精简版）+ 跌停/大面统计；
   - 炸板/大面清单（昨日涨停今日 <−5% 或曾涨停后开板；≤10 行，标时空标签）；
   - 板块热度 TOP（复用 ladder.boards）+ 每板块的「时空标签」建议（题材第几天由用户点选或默认 1）。
3. **预期清单编辑器**：卡片式，字段固定（WATCH-METHODOLOGY §3.3 的 7 字段），上限 5 张；支持一键「从今日涨停池加入龙头」。
4. **存档**：保存为当日 `ReviewSnapshot`（JSON），追加历史（默认保留 60 个交易日）。

### 4.2 数据结构骨架

```ts
// lib/review-store.ts（localStorage key: dsh-stock-panel:review:v2）
export type PhaseTag =
  | 'day1' | 'day2+'              // 题材生命周期
  | 'low' | 'mid' | 'high'        // 空间位置
  | 'leader' | 'follower' | 'catchup' // 梯队角色

export interface ExpectItem {
  id: string
  symbol: string                 // 'SH603138'
  name: string
  tags: { themeDay?: number; level: 'low'|'mid'|'high'; role: 'leader'|'follower'|'catchup' }
  state: 'strong'|'divergence'|'weak2strong'|'highRisk'|'recession'|'newLow'
  scenario: string               // 明日剧本（自由文本，≤40 字）
  auctionOK: string              // 竞价条件（可量化，如 "高开3%+竞价量>昨日20%"）
  failIf: string                 // 失败条件
  reason: string                 // 一句话理由（必须含量价证据）
}

export interface ReviewSnapshot {
  day: string                    // '2026-09-04'
  savedAt: number
  breadth: { up: number; down: number; limitUp: number; limitDown: number; amountYi: number }
  regime: Regime
  mainLine: { board: string; leader: ExpectItem['symbol'] | null }[]
  expectations: ExpectItem[]     // ≤5
  notable: string[]              // 关键事件时间线(压缩)
}
```

### 4.3 相对强度差分（真强 vs 惯性）

```ts
// lib/strength.ts —— 输入≤120 只候选(昨日涨停池+今日涨停池+自选+板块代表)
// 对每只拉 kline(DAILY, 5)：pct_d = 当日涨跌幅；streak；volumeRatio_d = vol/MA5(vol)
export interface StrengthRow {
  symbol: string; name: string
  pct_today: number
  cum5: number                    // 5 日累计涨幅（空间）
  delta3: number                  // 3 日动量差分 = (pct_t-2+pct_t-1+pct_t) - (pct_t-5..pct_t-3)
  volRatio: number                // 当日量/5日均量
  atLimit: boolean; streak: number
}
// 真强/惯性分类（WATCH-METHODOLOGY §4.2）
export type StrongKind = 'trueStrong' | 'inertia' | 'weakening' | 'weak2strong' | 'flat'
export function classifyStrength(r: StrengthRow): StrongKind {
  if (r.atLimit && r.volRatio >= 1.2 && r.delta3 >= 0) return 'trueStrong'
  if (r.atLimit && r.delta3 < 0) return 'inertia'          // ★ 假强：惯性封板
  if (!r.atLimit && r.cum5 > 15 && r.volRatio >= 2 && r.pct_today < 0) return 'weakening' // 高位放量滞涨
  if (!r.atLimit && r.delta3 > 0 && r.volRatio >= 1.5) return 'weak2strong'
  return 'flat'
}
```

---

## 5. 盘中模式（P2/P3 管道）设计

### 5.1 竞价雷达（9:15–9:35 高亮）

```ts
// lib/auction-analysis.ts —— 输入 auction 工具返回 items: {time,price,matched,unmatched}[]
export interface AuctionFeatures {
  openPct: number                  // 竞价末端价 vs 昨收（即预期开盘幅）
  nearLimit: boolean               // 末端价贴近涨停价
  slope920_925: number             // 9:20→9:25 matched 累积斜率（真实意图段）
  climaxDir: 'buy' | 'sell' | 'none' // 9:24:30-9:25:00 冲刺方向（price/matched/unmatched 共同判定）
  matchedTotal: number             // 竞价总匹配量（可对比昨日同期/个股历史分位）
  fakeBigThenDrop: boolean         // 9:15-9:20 大量挂单后撤单跳水（诱多特征）
}
export function analyzeAuction(items: AuctionItem[]): AuctionFeatures | null {
  // 骨架要点：
  // 1) 末端 3 点 price → openPct/nearLimit；2) 线性拟合 9:20 后 matched 斜率；
  // 3) 最后 5 点：matched 加速 & price 上抬 ⇒ climaxDir='buy'；price 回落且 unmatched 走负 ⇒ 'sell'
  // 4) fakeBigThenDrop：9:15-9:20 matched 峰 - 9:20 后回落幅度 > 40%
  // ⚠️ 实现前先冒烟验证 unmatched 正负语义与点位抽样（开盘后不再更新？收盘后可回看？），
  //    并确认 matched 单位（手/股）与涨停价判定（price≈buy_price_limit 需 pre_close×1.1/1.2 对齐）
}
```

**对照矩阵（预期 × 竞价）→ 输出标记**（与 WATCH-METHODOLOGY §4.4 同构）：

```ts
// lib/auction-analysis.ts
export type Verdict =
  | 'beatExpect' | 'confirm' | 'falsify' | 'weak2strong' | 'weak2weak' | 'trap'
export function judgeExpectation(exp: ExpectItem['state'], a: AuctionFeatures,
                                 boardPulse?: { limitUp: number; pct: number }): Verdict {
  const boardOk = !boardPulse || boardPulse.limitUp >= 1
  if (exp === 'strong' && a.openPct >= 3 && boardOk) return 'beatExpect'
  if (exp === 'strong' && (a.openPct < 0 || a.climaxDir === 'sell')) return 'falsify'
  if (exp === 'divergence' && a.slope920_925 > 0 && a.climaxDir === 'buy') return 'weak2strong'
  if (a.nearLimit && exp === 'highRisk') return 'trap'          // 高位竞价高开 → 陷阱候选
  return 'confirm'
}
// 陷阱二次过滤 isFalseStrong（WATCH-METHODOLOGY §4.3 三件套）：
// 高位(≥4板) + 竞价高开 + (板块涨停数环比降 | 无龙头共振) + 开盘 10min 无承接 → 标 'trap'
```

**竞价雷达列表（≤15 行）**：每行 = 名称/代码 + 预期状态图标 + 竞价特征迷你（高开幅、冲刺方向、量） + Verdict 徽标（超预期红/证伪绿/陷阱橙）。**只突出与昨日预期不一致者**，一致的整行置灰（降噪）。

### 5.2 情绪温度计

```ts
// lib/regime.ts —— 输入: 全 A 快照 + 涨停池统计 + 昨日首板池
export interface RegimeInputs {
  limitUp: number; limitDown: number; maxStreak: number
  promoteRate: number            // 晋级率 = 昨日涨停今日仍涨停/昨日涨停数
  brokenRate: number             // 炸板率 = 炸板数/曾涨停数
  firstBoardPremium: number      // 首板次日平均溢价(%)，需昨日首板池
  upRatio: number                // 上涨家数占比 0-1
  amountYi: number               // 两市成交额(亿)（分位化用）
}
export type RegimeBand = 'ice' | 'cold' | 'warm' | 'hot' | 'overheat'
export interface Regime { temperature: number; band: RegimeBand; drivers: string[] }
export function computeRegime(i: RegimeInputs): Regime {
  // 骨架：各输入先做阈值分段打分(0-100 加权)，加权=温度；
  // 特别规则: promoteRate<0.25 或 brokenRate>0.5 ⇒ 温度强制 ≤ 45(退潮/分歧);
  // maxStreak>=5 && 缩量加速(upRatio高但amount降) ⇒ 触发 overheat 标记;
  // drivers 记录拉高/压低项(≤3)，供人工复核而非只看一个数字
}
```

温度计联动：**仓位总闸** = `band → G(总仓上限)`（WATCH-METHODOLOGY §6.2 表格固化进 `sizing.ts` 默认参数）。

### 5.3 事件流与局势归类

```ts
// lib/event-stream.ts —— 增量捕获
// 轮询 unusual×3 + market_monitor×3(30s)；key=`${market}-${code}-${time}-${desc}` 去重；
// 写入 localStorage(JSONL 环形 ≤500 条)；重启后补齐；
// 收盘后进入只读模式（显示盘中已捕获历史，标注「收盘后 unusual 退化为竞价快照」提示）
export interface EventItem {
  ts: number; market: 'SH'|'SZ'|'BJ'; code: string; name: string
  desc: string; kind: 'limitUp'|'limitDown'|'break'|'surge'|'bigOrder'|'other'
  time: string; value: string
}

// lib/board-pulse.ts —— 板块资金脉冲
// 热度板集合(≤8)每轮 board_members(count≤100, CHANGE_PCT desc)：
//   板块涨停数 δ、板块内均涨幅 δ、成交额占比 δ > 阈值(默认 涨停+1 或 均涨幅>+1.5pp) → pulse 事件
export interface BoardPulse {
  board: string; name: string
  limitUp: number; avgPct: number; amountShare: number   // 与上轮差分后仅保留 δ 显著者
  leader: { code: string; name: string; pct: number } | null
}

// 局势归类（把观察翻译成局面 → 决策条 Q1-Q3）
export type Situation =
  | 'highLowSwitch' | 'innerDivergence' | 'newDirection'
  | 'weightLift' | 'recession' | 'normal'
export function judgeSituation(regime: Regime, ev: EventItem[], pulse: BoardPulse[],
                               oldLeader: { code: string; atLimit: boolean } | null): Situation {
  // 高位龙头炸板/断板 + 低位批量 limitUp + 指数平稳 → highLowSwitch
  // 主线龙头分歧但板块 limitUp 仍增 → innerDivergence
  // 陌生板块集体 surge(≥3 只) + 无昨日主线共振 → newDirection
  // 指数↑但 limitUp 少(广度差) → weightLift
  // limitDown 增多 + promoteRate 骤降 + 炸板率升 → recession
}
```

### 5.4 我的持仓与决策条

```ts
// lib/positions.ts + lib/sizing.ts
export interface Position {
  symbol: string; name: string
  entryDate: string; entryPrice: number; shares: number
  plan: { stopLoss: number; failIf: string; target?: number; note: string }  // 失败条件复盘时已写
  expectState: ExpectItem['state']  // 关联当日预期
}
// 决策条三行：
//  Q1 持续性：持仓对象 regime.band + classifyStrength(实时快照) → 增强/衰减/中性
//  Q2 局势：judgeSituation(...) 结果 → 提示文本（如「高低切进行中：老龙头兑现，低位新方向观察」）
//  Q3 动作：持仓触发 failIf/断板/破位 → 卖；竞价 Verdict=weak2strong 且板块 ok → 可半仓试错；否则观望

// lib/sizing.ts —— 凯利 + 温度计闸门 + 事件护栏（WATCH-METHODOLOGY §7，参数集中可配）
export interface KellyArgs {
  p: number; b: number            // 持有期口径自统计
  fraction: number                // 默认 0.5（1/2 凯利）→ 0.25
  gateCap: number                 // 温度计总仓闸门 ×账户
  stopLossPct: number             // 计划止损幅(%)
}
export function kellyPosition(args: KellyArgs): number {
  const fStar = args.b * args.p - (1 - args.p) / args.b   // 若 p*b ≤ q → 0
  if (fStar <= 0) return 0
  const byKelly = fStar * args.fraction * 100
  const byStop = args.gateCap * (args.stopLossPct / 10)  // 示例换算（名义仓位=风险预算/止损幅）
  return Math.min(byKelly, byStop, 10)                    // 硬封顶单票 ≤10%
}
// 附加护栏（常量）：单板块合计≤30%；同日独立逻辑≤4；两跌停最坏情景 ≤账户 8-10%
```

**自统计入口**：每笔平仓后记录（信号类型 / 结果 / 持有期）→ 形成 `trade-log`，复盘页提供 p̂/b̂ 滚动统计（≥50 样本才启用建议仓位，样本不足显示「无证据，空仓」）。

---

## 6. 页面骨架（ASCII，窄列）

```
┌ 作战 ──────────────[复盘|盘中]──┐   ← 模式：时段自动/可手动
│ 09:24 竞价阶段 · 温度 68(高温)  │   ← session-clock + 温度计一行
├───────────────────────────────┤
│ ★ 竞价雷达（≤15 行，仅逆预期高亮）│
│   名称      预期→判定   高开 量 │
│   海量数据  强一致→超预期 +5%  ↑ │
│   键邦股份  分歧→弱转强  -1%  ↑ │
├───────────────────────────────┤
│ 情绪温度计  [▮▮▮▮▮▯▯] 68 高温    │  ← drivers: 晋级率↑ 炸板率正常
│ 局势：主线内分歧（龙头炸板回封中） │
├───────────────────────────────┤
│ 异动事件流（增量 only）          │
│  10:03 603138 回封涨停 封单12万手│
│  10:05 000xxx 拉升 7% 大单流入   │
├───────────────────────────────┤
│ 我的持仓 ×2  决策：持有(条件未触发)│
│   603138 计划止损 14.2  浮盈 4.2%│  ← 尾盘才定去留
└───────────────────────────────┘
（复盘模式替换下半区为: 今日盘眼/回顾/预期清单编辑器 ≤5 卡 + 存档按钮）
```

---

## 6b. 页面骨架（宽视图 / v1.3 沉浸式，取代 §6 的窄列骨架）

> ⚠️ **已被 §6c / §6d 取代**（v1.3 的「4 个功能视图 + 1-4 快捷键」在 v1.4 改为流程三入口）。
> 保留原因：§6b 的 ASCII 骨架是「三段式（状态带 / 左列表·主图 / 右 AI）」的原始定义，仍有参考价值。

视图从「窄列 + 10 Tab」变成会话列全宽后的三段式；一级导航收敛为 4 个，其余降为二级页签。
§6 的窄列骨架仍然适用于**二级页签内部**（那些页面尚未按宽屏重排）。

```
┌ 状态带（常驻 38px）──────────────────────────────────────────────────────┐
│ 盘中 2026-09-08 │ [1盯盘][2市场][3选股][4复盘] │ 上证+0.6% 深成+0.9% … │
│ ↑3120 ↓1980  涨停 58 跌停 6  额 9821亿  情绪≈高温 72 │ [✦问模型][⌘K][◧][◨]│
├──────────┬──────────────────────────────────────┬──────────────────────┤
│ 自选 涨停 │ 报价头：贵州茅台 SH600519 ☆ 1680.0 +2.1% 量比1.4 换手0.8% …│
│ 异动      ├──────────────────────────────────────┤ ✦ AI 研判   deepseek │
│           │ [日K|分时] [3月 6月 1年] [MA] 模型价位×4│ ┌ 偏多 ────── 72 ┐│
│ 贵州茅台  │                                        │ 放量突破平台上沿  ││
│ 1680 +2.1%│        ┌ K 线 + 量柱 + MA + 筹码 ┐      │ 支撑要点 …        ││
│ 宁德时代  │        │  ┄┄ 压力(模型) 1720      │      │ 风险 …            ││
│  198 +1.2%│        │  ┄┄ 支撑(模型) 1620      │      │ 关键价位（已画图）││
│ …         │        │  ┄┄ 止损(模型) 1580      │      │ [一键研判][深入对话]│
│           ├──────────────────────────────────────┤ 模型思考（折叠）    │
│           │ [资金流|逐笔|竞价]                    │                    │
└──────────┴──────────────────────────────────────┴──────────────────────┘
```

要点（实现见 README §宽视图沉浸式盯盘台）：

1. **当前标的是唯一真源**：左栏点一行 → 主图/下部面板/右栏 AI 同步换，不切页；
   任意页面点股票 → 设标的并跳到盯盘。
2. **左栏零额外请求**：自选/涨停从状态带已在轮询的全 A 快照里取（30s），异动复用市场页缓存。
3. **AI 常驻右栏**：一键研判（host 直调 `ctx.llm` → 结构化结论）与深入对话
   （注入当前对话让 agent 复核）两个入口都在手边；模型给的关键价位**画到主图上**。
4. **主题跟随 DSH**：`--dc-*` 语义层映射宿主 `--dsw-*` token；A 股红涨绿跌为唯一自持配色。
5. **键盘优先**：⌘K 搜索 / 1-4 切视图 / j·k 移动 / a 问模型 / [ ] 收栏。

### 批次

| 批次 | 内容 | 状态 |
| --- | --- | --- |
| P1 | 骨架 + 状态带 + 左栏 + 右栏 AI + 盯盘工作台 + 4 视图收敛 + 主题跟随 + 键盘 | ✅ v1.3.0 |
| P2a | AI 三个回填落点：个股决策卡 + 主图价位线 / 复盘「AI 预期排序」（含对用户草稿打分，逐条采纳）/ 选股「AI 候选排序」+ 表内 `AI#n` 徽标 | ✅ v1.3.0 |
| P2b | 逐页宽屏精修：市场（总览/指数/梯队/外盘）与复盘的两列展开；作战台宽屏化 | 待做 |
| P3 | 旧页面迁移到 `--dc-*` token 后删除样式过渡层；退役被工作台取代的旧页面（同时回收 bundle 体积） | 待做 |

**P2a 的设计立场（连续性要求）**：AI 结果永远是**只读参考区 + 逐条采纳**，不自动覆盖用户草稿。
理由：预期清单与候选池是用户的决策记录，被模型静默改写会毁掉「次日对照自己判断」的价值。
因此排序面板只做三件事：排序、给理由、给一键采纳按钮；已在清单的条目标注而非重复插入。

---

## 6c. 统一看盘关注点与流程 → 排版重规划（v1.4）

### 6c.1 结论：把「功能分块」换成「流程分块」

v1.3 用 4 个功能视图（盯盘/市场/选股/复盘）组织界面，结果**功能齐全但流程断裂**：
「作战」被塞在「选股」下面，复盘与竞价被拆到两个视图，用户要在脑子里自己走流程。
而 `WATCH-METHODOLOGY.md` §8 给的是**固定时间表**，§3–§5 给的是**每个时段只答几个问题**：

> 15:10–16:00 复盘写清单 → 9:15–9:35 竞价对照 → 9:30–15:00 只答 Q1–Q3 → 14:30 尾盘决策

所以排版的第一原则是**时段驱动**（这也正是 §3.1 原始蓝图的设计：单一「作战」界面按
时段自动切模式）。v1.4 把它恢复，并把功能块下沉为「工具」。

### 6c.2 统一的四层关注点（任何时段都只看这四层）

| 层 | 看什么 | 数据/模块 | 它决定什么 |
| --- | --- | --- | --- |
| **① 环境** | 指数方向、涨跌家数、涨停/跌停、成交额分位、情绪温度分档 | `market.ts` `regime.ts` | **总仓位闸门 G**（温度计是总闸） |
| **② 主线** | 板块涨停数（结构而非计数）、最高连板、梯队是否断层、主线内龙头 | `ladder.ts` `board-pulse.ts` | **只对主线给仓位**；支线只看 |
| **③ 标的** | 我的预期清单对象、持仓、总龙头、炸板/大面样本 | `review-store.ts` `positions.ts` `event-stream.ts` | 盯谁、谁的失败条件触发了 |
| **④ 动作** | 清单对照判定 / Q1–Q3 / 兑现换股 / 仓位 | `mission.ts` `auction-analysis.ts` `sizing.ts` | **今天做什么**（唯一输出） |

**"杂乱"的判定标准**：任何一块信息，如果不能明确归到上面四层之一，就不该出现在主区
（可以进工具抽屉）。这条规则可以直接用于下一轮的功能清理。

### 6c.3 五个时段 × 四层的具体形态

| 时段 | ① 环境 | ② 主线 | ③ 标的 | ④ 动作（唯一输出） |
| --- | --- | --- | --- | --- |
| **复盘** 15:10–9:15 | 温度计 + 广度 + 成交额分位（七步①） | 连板梯队 + 板块结构 + 资金流向（七步②③④） | 昨日涨停今日表现 / 大面样本 / 风向标（①b⑤⑥） | **次日预期清单 ≤5 条（7 字段）+ 存档**（七步⑦） |
| **竞价** 9:15–9:30 | 指数竞价方向 | 主线板块是否同步 | **预期清单对象** × 竞价特征 | 每条预期的判定：超预期/证伪/弱转强/陷阱 |
| **验证窗** 9:30–10:00 | — | 主线扩散度 | 竞价判定对象 | 高开承接 / 低开收复 / 弱转强放量 → 半仓试错 |
| **盘中** 10:00–14:30 | 温度滚动 | 板块脉冲 + 涨停比 | 事件流 + 持仓 + 龙头状态 | **Q1 持续性 / Q2 局势 / Q3 动作** |
| **尾盘** 14:30–15:00 | — | 主线是否留强 | 持仓 + 换股候选 | 兑现 / 换股 / 定仓（T+1 唯一动作点） |

### 6c.4 落地的排版

```
┌ 状态带：阶段(可点)│[复盘][作战][看盘][工具]│指数条│广度│情绪≈│[问模型][⌘K][◧][◨] ┐
├──────────┬──────────────────────────────────────────────┬──────────────────┤
│ 左栏列表  │ 阶段头：本阶段要回答的问题（方法论原文）+ 唯一输出 │ 右栏 AI 研判       │
│ 自选/涨停 │ ─────────────────────────────────────────────│ 一键研判→决策卡    │
│ /异动     │ 主区：七步复盘 / 时段作战（宽屏列流并排）        │ 价位线→主图        │
│           │      或 工具页（抽屉打开时接管）                 │ 深入对话           │
└──────────┴──────────────────────────────────────────────┴──────────────────┘
```

- **一级导航 3 项**：`复盘`（方法论 §3）｜`作战`（§4–§5，页内按时段自动切）｜`看盘`（自由查看，不属于流程）；
- **工具抽屉**：`总览 / 指数 / 涨停梯队 / 外盘 / 选股筛选 / 自选盘 / 监控规则 / 个股明细`
  ——旧习惯的入口全部保留，一键可达（`t` 或 ⌘K 输入功能名直达），但不再占用一级导航；
- **阶段头**：把方法论原文的「本阶段必须回答的问题」摊在顶部——页面替用户记住流程；
- **列流排版**（`.dc-flow`）：宽屏 2–3 列紧密接排，窄屏自动单列；
  复盘页把七步的**信息步（①–⑥）并排**，而**⑦ 输出（预期清单）独占整行**——
  信息并排看、结论单独写；
- **自动跟随 + 手动优先**：跨过 9:15 / 14:30 / 15:10 边界时自动切到对应入口；
  用户手动点过导航后本次会话不再自动跟随（不打断正在做的事）。

### 6c.5 与旧习惯的兼容清单

| 旧习惯 | 现在怎么走 |
| --- | --- |
| 点股票看详情 | 任意列表点行 → 「看盘」入口原地换标的（不丢上下文） |
| 「个股」全功能页 | 「看盘 › 明细」二级页签（`StockDetailPage` 原样保留） |
| 「自选」Tab | 左栏「自选」分组（实时价）+ 「自选盘」表格（工具抽屉） |
| 「市场/指数/梯队/外盘」Tab | 工具抽屉（1 键 + 1 击），状态带指数条可直接点进「指数」 |
| 「选股」Tab | 工具抽屉 › 选股筛选（AI 排序能力保留） |
| 「监控」Tab | 工具抽屉 › 监控规则（命中 Toast/徽标不变） |
| 快捷键 | `⌘K` 搜索、`1-3` 入口、`t` 工具、`j/k` 移动、`a` 问模型、`[ ]` 收栏 |

---

## 6d. 信息架构 v1.5（2026-09-12 决策记录）

> 本节是**已拍板的决策**，取代 §6b 的 4 视图与 §6c.4 的抽屉细节；实施项见 `docs/ROADMAP.md` A1–A5。

### 6d.1 定位：盯盘执行台（不是全功能量化台）

| 能力 | 归属 |
| --- | --- |
| 盘中/盘后执行（复盘清单 → 竞价对照 → Q1–Q3 → 尾盘定仓）、盯盘台、AI 研判 | **本插件** |
| 自挖概念**发现**（HIST 共动类） | **本插件内置**（node-tdx HistEngine） |
| 自挖概念**命名**（LLM 归纳 + 护栏） | **本插件 host 半移植**自 `cluster-namer`（口径来源，算法上游仍是它） |
| 选股引擎（20 策略）、回测（vectorbt）、财务、数据管道/外部数据接入 | 父项目 `tickflow-stock-panel`（`frontend/` SPA + `backend/` FastAPI），**不在本插件范围** |
| 自挖类算法研究（co_cluster daily/api）、情绪/簇命名其他试验 | 兄弟项目 `kronoros` / `sentiment` / `cluster-namer` 各自演进 |

**边界规则**：任何新需求先问「它服务的是『今天该做什么』吗」——否，则不做或向上游项目提。

### 6d.2 布局（三段式保持不变，栏的内容变）

```
┌ 状态带：阶段(可点)│[复盘][作战][看盘]│[工具]│指数条│广度│情绪≈│[问模型][⌘K] ┐
├────────────┬──────────────────────────────────────────┬──────────────────┤
│ 左栏        │ 主区：**选中标的即渲染个股信息**            │ 右栏 AI 研判       │
│ ▸ 自选      │   报价头（现价/涨跌/量比/换手/涨停跌停价）   │  一键研判 → 决策卡 │
│   （实时价） │   图区：日K ⇄ 分时（MA / 筹码 / 模型价位线） │  关键价位 → 画到图 │
│ ▸ 个股      │   概念区：官方板块 + **自挖共动类/命名**（新）│  深入对话          │
│   （看过的） │   下部：资金流 / 逐笔 / 竞价（二级切换）      │                   │
└────────────┴──────────────────────────────────────────┴──────────────────┘
```

三条落地要求：

1. **左栏保留自选栏**，点行即渲染个股信息（不再是「跳页」）；
2. **左栏新增「个股」分组 = 最近看过的个股**（按浏览顺序，上限可配，落盘持久化），点行同样渲染个股信息；
   **下线「涨停」「异动」两个分组**——涨停已有「涨停梯队」工具，异动并入工具单页；
3. **工具合并为一张单页**：市场总览 / 指数 / 涨停梯队 / 选股筛选 / 自选盘 / 监控规则 / 个股明细 / 外盘
   在同一页分区呈现（⌘K 直达区块），**外盘弱化**为页内次要区块（默认折叠，不再占独立入口）。

### 6d.3 特色板块：自挖概念 + 命名（本插件差异化能力）

- **发现**（已内置）：HIST 残差共动 → 无监督聚类 → 当日「市场自己认定的班」；
- **命名**（v1.5）：成员涨停/异动素材 + LLM 归纳 + 护栏 → `named / no_common / insufficient`，
  并给出与官方花名册的关系（`官方已有（收敛）` / `叙事漂移` / `官方盲区`）；
- **口径硬约束**（沿用 cluster-namer）：素材**只用于解释、不进聚类输入**；证据**必须可反查**
  （引文比对 + 时间窗 + 覆盖度门控）；**拒绝命名是一等公民**；
- **前置门槛**：先做参数校准（pool_n/window/min_corr）+ 弱链过滤 + 跨日稳定性，达标后才上 UI；
- **呈现**：主区「概念区」为主（个股视角 + 当日类列表），复盘②主线识别引用为辅。

### 6d.4 复盘校准页（必要）

方法论写的「与人工判定一致率 ≥80%」从未被测量过。数据其实已经在手：
`dayrun` 记录了 Q2 的 `from: 'auto' | 'manual'`、逐条竞价判定 `verdicts`、Q1/Q3 与持仓动作。
校准页要做的是把这些**反算成可回看的分数**：

- 系统候选 vs 人工确认（局势/竞价判定一致率、分歧样本清单）；
- 预测侧：昨日预期清单 × 今日实际结果（兑现/证伪命中率，已有 `review-metrics` 基础）；
- 阈值校准：温度计分档、强度分类、共振阈值的「按自身历史校准」入口；
- **只呈现统计与分歧样本，不自动改用户结论**（沿用「AI 不覆盖草稿」立场）。

### 6d.5 持久化（host 侧）

全部本地资产从 localStorage 迁到 DSH 存储子系统的 `stock-panel` 领域
（`ctx.storageDomain` + `defineDomain`，json 后端落 `$DSH_HOME/storages`），
**localStorage 降级兜底**；含**个股栏历史**。设计与迁移策略见 `docs/ARCHITECTURE.md` §5.2。

## 7. 轮询与性能预算

> ⚠️ 本节数字为 2026-09 设计期预算。**实测口径（含 ladder 占 ~90% 请求、栏收起不停轮询等债务）
> 已迁到 `docs/ARCHITECTURE.md` §3.1**，对策见 `docs/ROADMAP.md` B3。

| 数据 | 频率 | 量 | 说明 |
| --- | --- | --- | --- |
| server_info | 60s | 1 请求 | 时段感知；只在作战页激活时 |
| unusual+market_monitor | 30s ×6 市场参数 | ≤6 | 事件增量；作战页隐藏即暂停 |
| 全 A 快照 | 20s TTL 缓存 | 1（≥2MB） | 复盘与盘中广度复用，不重复拉 |
| 热度板 members | 30s ×≤8 板 | ≤8 | count≤100/板；仅在 P3 激活时 |
| auction | 9:15–9:25 每 10s ×≤40 标的 | 240/时段 | 仅在竞价时段轮询；开盘后停 |
| kline(DAILY,5) 强度差分 | 复盘 1 次 ×≤120 | 120（pool≤6） | 约 20–40s，带进度 |
| 历史存储 | localStorage | JSONL ≤500 事件、复盘 ≤60 日 | 超限环形裁剪 |

> 合计峰值 ≈ 全 A + 8 板块 + 竞价批量，均在既有并发护栏内；非激活 Tab 一律暂停轮询。

---

## 8. 建议实施批次（历史：N1–N7 已全部交付）

> ⚠️ **历史章节**：N1–N7 已交付（见 `CHANGELOG.md`）。**现行路线图在 `docs/ROADMAP.md`**
> （两轨：产品闭环 A1–A5 / 工程地基 B1–B6）。本节的批次划分仅作溯源。

| 批次 | 内容（方法论视角重命名/裁剪） | 规模 |
| --- | --- | --- |
| N1（≈M7 裁剪） | `session-clock.ts` + `review-store.ts` + **复盘模式页**（盘眼/回顾/预期清单/存档） | S-M |
| N2 | `auction-analysis.ts` + **竞价雷达**（含对照矩阵与陷阱过滤） | S |
| N3（≈M8 裁剪：选股引擎降级为复盘辅助） | `strength.ts` 强度差分 + 「低位首板候选」列表（服务复盘观察池，替代大而全选股器） | M |
| N4（≈M7 监控吸收） | `event-stream.ts` + `board-pulse.ts` + **盘中模式页**（事件流/局势归类） | M |
| N5 | `regime.ts` 温度计 + 总仓闸门联动 | S |
| N6 | `positions.ts` + `sizing.ts` + 交易日志自统计 → **持仓决策条** | M |
| N7（≈M9 增强） | 个股页补竞价回顾/资金面板（`auction/capital_flow`），支撑点开详情 | S-M |

验收锚点（每个页面独立可测）：
- 复盘：保存后刷新不丢；次日竞价页能读出昨日 `expectations`；
- 竞价：9:25 后 15s 内出全部观察池特征；与人工判定一致率 ≥80%（前 20 交易日抽样）；
- 盘中：事件流无重复、仅增量渲染；退潮/高低切等归类在构造样本上符合预期；
- 温度计：与人工「冰点-沸点」判断一致率 ≥80%（抽样 20 日）；
- 仓位：`kellyPosition` 对「p=0.5,b=1」返回 0；对边界参数不越护栏。

---

## 9. 变更记录

- v0.1（本稿）：方法论蓝图 → 功能/流程设计初版；数据源约束基于 MCP 实测（2026-09-05 盘后）；核心逻辑为骨架草案，阈值/参数集中到各 lib 顶部常量，待实施时按自身统计校准。
- v0.2（2026-09-08）：新增 §6b 宽视图骨架（三段式盯盘台）与 P1-P3 批次；§6 窄列骨架降级为「二级页签内部」参考。背景：视图注入改官方 `conversation.view` 后占满会话列，窄列排版不再适用；同时补齐「一键问模型 → 结论回填视图」的 AI 双通道设计。
- v0.3（2026-09-11 真机验收）：P2a 三个落点（个股决策卡+图上价位线、复盘预期排序、选股候选排序）落地并在真机确认可见；新增 **AI 自愈重试**：`maxTokens` 是 reasoning 与正文的**共享预算**，推理等级高时模型会把预算烧在思考上（实测 60 根日 K 的上下文直接 0 正文失败），故 host 半在「只回思考不回正文」或「上下文超限」时自动裁剪上下文并重试，以 `meta.shrunk` + UI 提示如实告知。**设计红线维持不变：AI 结果不自动覆盖用户草稿；裁剪不静默。**
- v0.4（2026-09-12 校订）：新增 **§6d 信息架构 v1.5 决策**——定位明确为「盯盘执行台」并附能力归属表；
  左栏改为「自选 + 个股（最近看过）」、点行即渲染个股信息（下线涨停/异动分组）；工具合并为单页、外盘弱化；
  新增**自挖概念 + 命名**特色板块（host 半移植 cluster-namer 口径与护栏）；新增**复盘校准页**；
  持久化改 **host 侧领域存储 + localStorage 降级**。同时把 §1–§6b、§7–§8 标注为历史，
  现行文档拆分为 `README.md` / `docs/ARCHITECTURE.md` / `docs/ROADMAP.md` / `CHANGELOG.md`。
