/**
 * src/components/MarketBoards.tsx —— 榜单（4 张）与市场异动（窄列版）。
 *
 * ## 为什么这两块从「总览」里拆出来
 *
 * 收口前它们都在 `MarketOverview` 里、且都是**纵向堆叠**：4 张榜 × 5 行 + 异动 14 行
 * 在 387×363 的可视区里排到 1391px —— 实测**藏了 74%**，用户看到的是一道缝加一个滚动条。
 * 拆出来放到聚合页的**底行全宽**（2 列时 8/12 + 4/12）之后：
 *   · 榜单 2×2 排、每张 5 行 → 高度减半；
 *   · 异动只留 8 条（它是 20s 刷新的"速递"，不是归档），也不再纵向滚动。
 *
 * ## 窄列的取舍（**写清楚，不许再悄悄加回代码列**）
 *
 * 每张榜只有 ~250px：名称(4 字 ≈48px) + 代码(36px) + 主值 + 副值 = 188px 起步，
 * 再加内边距就没有宽度给名称了（那正是本仓库反复踩的"宽度没算清"）。
 * 所以窄列**只留「名称 + 主值」**，代码 / 换手率 / 成交额全部进 `title` 与主值的副标题。
 * 榜单的用途是扫"谁在动"，不是抄代码 —— 要代码点进去看个股页。
 */
import { fmtBigNum } from '@/lib/format'
import { pctText, type AShareRow, type UnusualItem } from '@/lib/market'
import type { MarketTag } from '@/lib/symbol'

const UP = 'var(--dc-up)'
const DOWN = 'var(--dc-down)'

function pctColor(v: number): string {
  if (v > 0) return UP
  if (v < 0) return DOWN
  return 'var(--dc-text-3)'
}

/** 一张榜的排序口径与列值。 */
interface BoardSpec {
  key: string
  title: string
  /** 取值方式（值 + 颜色）。 */
  value: (r: AShareRow) => { text: string; tone: string }
  /** 副标题（进 title，说明这一列是什么口径）。 */
  sub: string
}

const BOARDS: BoardSpec[] = [
  { key: 'gainers', title: '涨幅榜', sub: '按当日涨幅降序', value: (r) => ({ text: pctText(r.pct), tone: pctColor(r.pct) }) },
  { key: 'losers', title: '跌幅榜', sub: '按当日涨幅升序', value: (r) => ({ text: pctText(r.pct), tone: pctColor(r.pct) }) },
  { key: 'amount', title: '成交额榜', sub: '按当日成交额降序', value: (r) => ({ text: fmtBigNum(r.amount), tone: 'var(--dc-text-2)' }) },
  {
    key: 'turnover',
    title: '换手率榜',
    sub: '按当日换手率降序',
    value: (r) => ({ text: `${r.turnover.toFixed(1)}%`, tone: 'var(--dc-text-2)' }),
  },
]

/** 每张榜显示几行（底行高度 ~200px 定过：标题 16 + 5 行 × 22 + 内边距）。 */
const ROWS_PER_BOARD = 5

export interface MarketBoardsProps {
  rows: AShareRow[]
  onOpenStock: (market: MarketTag, code: string, name: string) => void
}

/** 4 张榜（2×2 自适应列）。 */
export function MarketBoards({ rows, onOpenStock }: MarketBoardsProps) {
  const sorted: Record<string, AShareRow[]> = {
    gainers: [...rows].sort((a, b) => b.pct - a.pct).slice(0, ROWS_PER_BOARD),
    losers: [...rows].sort((a, b) => a.pct - b.pct).slice(0, ROWS_PER_BOARD),
    amount: [...rows].sort((a, b) => b.amount - a.amount).slice(0, ROWS_PER_BOARD),
    turnover: [...rows].sort((a, b) => b.turnover - a.turnover).slice(0, ROWS_PER_BOARD),
  }
  return (
    <div className="dc-boards">
      {BOARDS.map((b) => (
        <div className="dc-board" key={b.key}>
          <div className="dc-board-head">
            <b>{b.title}</b>
            <span title={b.sub}>前 {ROWS_PER_BOARD}</span>
          </div>
          {sorted[b.key].map((r) => {
            const v = b.value(r)
            return (
              <button
                key={`${r.market}${r.code}`}
                type="button"
                className="dc-board-row"
                title={`${r.name} ${r.market}${r.code}｜涨幅 ${pctText(r.pct)}｜换手 ${r.turnover.toFixed(1)}%｜成交额 ${fmtBigNum(r.amount)}｜${b.sub}`}
                onClick={() => onOpenStock(r.market, r.code, r.name)}
              >
                <span>{r.name}</span>
                <em style={{ color: v.tone }}>{v.text}</em>
              </button>
            )
          })}
        </div>
      ))}
    </div>
  )
}

/** 异动速递显示几条（20s 一轮的速递；要更多请去「监控规则」看历史）。 */
export const UNUSUAL_ROWS = 8

/**
 * 市场异动（三市场合并、按时间倒序）。
 *
 * 类别胶囊用**语义色**（涨/跌/其他）而不是涨跌红绿混用：`kind` 是 `lib/market.ts`
 * 按 desc 关键词分类的结果（封板/拉升 = up、跌停 = down、其余 = other），
 * 所以"其他"必须与涨跌色分开 —— 否则"炸板"会看起来像上涨。
 */
export function UnusualFeed({
  items,
  onOpenStock,
}: {
  items: UnusualItem[]
  onOpenStock: (market: MarketTag, code: string, name: string) => void
}) {
  return (
    <div className="dc-unusual">
      {items.slice(0, UNUSUAL_ROWS).map((u, i) => (
        <button
          key={`${u.market}${u.code}-${i}`}
          type="button"
          className="dc-unusual-row"
          title={`${u.name} ${u.market}${u.code}｜${u.desc}${u.value ? `｜${u.value}` : ''}｜${u.time}`}
          onClick={() => onOpenStock(u.market, u.code, u.name)}
        >
          <span className={`dc-unusual-kind is-${u.kind}`}>{u.desc.replace(/[（）()]/g, '')}</span>
          <span>{u.name}</span>
          <em>{u.time}</em>
        </button>
      ))}
    </div>
  )
}
