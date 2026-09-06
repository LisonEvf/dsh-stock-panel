# 产品功能与流程设计 PRODUCT-DESIGN（以 WATCH-METHODOLOGY 为蓝图）

> 把 `WATCH-METHODOLOGY.md` 的盯盘方法论落成 **frontend-dsh（@lisonevf/dsh-stock-panel）** 的功能与流程设计。
> 范围：**蓝图 + 核心逻辑骨架（TS 数据结构与判定函数草案）**，不含实现代码；实施批次建议见 §8。
> 前提事实（仓库现状/数据源约束）以 M5/M6 交付与 MCP 实测为准（README / MCP-SETUP / MIGRATION-PLAN）。

---

## 1. 设计原则（先立规矩，防范围膨胀）

1. **一个目标**：帮助用户每天回答方法论里的三个问题（Q1 持续性增减？Q2 有无局势变化？Q3 动作？），其余功能不为此服务的一律不做。
2. **降噪优先**：页面只展示「相对昨日/上一轮的**变化**」；列表全设上限（≤20 行）；无意义的实时跳动不渲染。
3. **复用优先**：梯队/涨停池/板块热度/全 A 快照等 M6/M5 资产直接复用，不新造数据管道。
4. **时段感知**：交易日时钟（`server_info`）驱动视图自动切换：竞价(9:15-9:25)/盘中/复盘(15:10 后) 呈现对应内容，减少手动切换。
5. **纯 MCP、无后端**：继续 A 轨优先（MIGRATION-PLAN §4 决策原则）。
6. **窄列优先**：所有新视图先按 ≤420px 设计（stock 列实际宽度）。

**明确不做**（防噪音与范围膨胀）：不扩展 AI 分析；不引入自动下单/推送交易信号；不新增图表库；不做全市场分钟级扫描；不做「当日所有涨停」之外的历史复盘回溯（仅存近 N 日快照）。

---

## 2. 现状盘点与能力差距

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

## 7. 轮询与性能预算（沿用 MIGRATION-PLAN §7.4 护栏）

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

## 8. 建议实施批次（裁剪 M7-M9，供路线图决策，未改 MIGRATION-PLAN）

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
