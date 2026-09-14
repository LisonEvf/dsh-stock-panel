/**
 * src/components/MarketKpiBar.tsx —— 行情页的「环境带」（**一屏仪表盘的第一行**）。
 *
 * ## 为什么要把两个 2×2 合成一条 6 格
 *
 * 收口前，"环境"这件事被拆在两块里各写一遍：`MarketOverview` 有 2×2（涨跌家数 / 涨停跌停 /
 * 强势弱势 / 两市成交），`LadderPage` 也有 2×2（涨停 / 跌停 / 最高连板 / ≥2板晋级）。
 * 同一个数字在页面上出现两遍，而两处都只分到 ~66px —— 加起来 132px 的垂直空间，
 * 换来的是一屏里读两遍同样的数（实测整页 innerText 里「涨停」出现 19 次）。
 *
 * 现在合成**一处、一行 6 格**，再把"涨跌分布"从一块 12 柱的竖图压成一条 10px 的横条：
 * 环境层从 ~200px 降到 ~80px，让出来的高度给了真正藏东西的两块（实测那两块藏了 74% / 83%）。
 *
 * ## 每个格子的口径（写在这里，免得下次又各写一份）
 *
 * | 格 | 口径 | 来源 |
 * | --- | --- | --- |
 * | 涨 / 平 / 跌 | 全 A 快照的 pct 符号计数 | `computeBreadth` |
 * | 涨停 / 跌停 | **收盘价触及交易所涨跌停价**（`buy/sell_price_limit`，各板幅度不同） | `computeBreadth` |
 * | 强势 / 弱势 | 涨跌幅 ≥ ±3% 的家数 | `computeBreadth` |
 * | 最高连板 | 客户端连板统计（主板 10 / 创业科创 20 / 北交 30 / ST 5） | `loadLadder` |
 * | ≥2板晋级 | 连板 ≥2 的家数（高位家数） | `loadLadder` |
 * | 两市成交 + 均涨 | 全 A 成交额合计 / 全 A 平均涨跌幅 | `computeBreadth` |
 *
 * 本组件是**纯展示**：数据由页面持有（一份数据一处取，见 `MarketPage` 的取数纪律），
 * 所以它不会自己发请求 —— 这也是它敢放在最上面、又不受"折叠即停轮询"影响的原因。
 */
import { fmtBigNum } from '@/lib/format'
import { pctText, type Breadth, type DistBucket } from '@/lib/market'

/** 涨停梯队块回传的环境数字（由 `LadderPage` 上报，避免页面自己再算一遍）。 */
export interface LadderStats {
  limitUp: number
  limitDown: number
  maxStreak: number
  /** 梯队档数（有几个不同的连板数） */
  tiers: number
  /** ≥2 板家数（高位家数） */
  highTier: number
  /** 连板待确认的家数（日K 没拉到，**不算**进上面任何数） */
  unconfirmed: number
}

export interface MarketKpiBarProps {
  breadth: Breadth | null
  dist: DistBucket[] | null
  ladder: LadderStats | null
  /** 数据还没到（首屏）——显示「—」而不是 0：0 是"真的没有"，"—"是"还不知道"。 */
  loading: boolean
}

function n(v: number | undefined | null): string {
  return v === undefined || v === null ? '—' : String(v)
}

/** 分布条的段透明度：越极端越实（内圈接近 0% 的段本来就该"淡"）。 */
function distAlpha(label: string): number {
  if (label.includes('5') && (label.startsWith('<') || label.startsWith('>'))) return 0.95
  if (label.includes('3')) return 0.75
  if (label.includes('1')) return 0.55
  return 0.4
}

export function MarketKpiBar({ breadth, dist, ladder, loading }: MarketKpiBarProps) {
  const up = 'var(--dc-up)'
  const down = 'var(--dc-down)'
  const dim = 'var(--dc-text-3)'

  const total = breadth?.total ?? 0
  const distTotal = (dist ?? []).reduce((a, b) => a + b.count, 0)
  const upShare = total > 0 && breadth ? Math.round((breadth.up / total) * 100) : null
  /**
   * 今天"偏涨还是偏跌"→ 给第一格一条左侧强调边（**第一个数据块必须自己说出结论**）。
   * 为什么不再靠读者比数字：全页字号只有 11/12/14 三档，最大的字反而是指数点位（中性色），
   * 实测评审结论是"情绪要自己比出来"。一条边的成本是 2px，收益是零阅读成本。
   */
  const tone = breadth === null || breadth.up === breadth.down ? 'flat' : breadth.up > breadth.down ? 'up' : 'down'

  return (
    <div className="dc-kpi" data-testid="market-kpi">
      <div
        className={`dc-kpi-cell${tone === 'flat' ? '' : ` is-tone-${tone}`}`}
        title="全 A 快照的涨跌家数（平盘 = 涨跌幅恰好为 0）；左侧色边 = 今天偏涨还是偏跌"
      >
        <span>涨 / 平 / 跌</span>
        <span className="dc-kpi-value">
          <b style={{ color: up }}>{loading && breadth === null ? '—' : n(breadth?.up)}</b>
          <i>/</i>
          <b>{n(breadth?.flat)}</b>
          <i>/</i>
          <b style={{ color: down }}>{n(breadth?.down)}</b>
        </span>
        <span className="dc-kpi-sub">共 {n(breadth?.total)} 只</span>
      </div>

      <div className="dc-kpi-cell" title="收盘价触及交易所涨停价 / 跌停价的家数（各板幅度不同，不用 9.8% 阈值法）">
        <span>涨停 / 跌停</span>
        <span className="dc-kpi-value">
          <b style={{ color: up }}>{n(breadth?.limitUp)}</b>
          <i>/</i>
          <b style={{ color: down }}>{n(breadth?.limitDown)}</b>
        </span>
        <span className="dc-kpi-sub">按交易所涨跌停价</span>
      </div>

      <div className="dc-kpi-cell" title="涨跌幅 ≥ +3% / ≤ −3% 的家数（强势资金 vs 亏钱效应）">
        <span>强势 / 弱势 ±3%</span>
        <span className="dc-kpi-value">
          <b style={{ color: up }}>{n(breadth?.strongUp)}</b>
          <i>/</i>
          <b style={{ color: down }}>{n(breadth?.strongDown)}</b>
        </span>
        <span className="dc-kpi-sub">涨跌 ≥3%</span>
      </div>

      <div className="dc-kpi-cell" title="客户端连板统计的最高板（主板 10% / 创业科创 20% / 北交 30% / ST 5%）">
        <span>最高连板</span>
        <span className="dc-kpi-value">
          {/* 连板/高位家数是"热度"数：有方向（越多越热）→ 按 A 股习惯给红；
              只有"两市成交"这种没有方向的量才留中性色（评审点名的着色规则）。 */}
          <b style={{ color: ladder !== null && ladder.maxStreak > 0 ? up : undefined }}>
            {ladder ? `${ladder.maxStreak}` : '—'}
          </b>
          <i>板</i>
        </span>
        <span className="dc-kpi-sub">
          {ladder ? `${ladder.tiers} 组梯队` : loading ? '读取中…' : '无封板'}
        </span>
      </div>

      <div className="dc-kpi-cell" title="连板 ≥ 2 的家数：高位股是「接力情绪」的载体">
        <span>≥2板晋级</span>
        <span className="dc-kpi-value">
          <b style={{ color: ladder !== null && ladder.highTier > 0 ? up : undefined }}>
            {ladder ? n(ladder.highTier) : '—'}
          </b>
          <i>只</i>
        </span>
        <span className="dc-kpi-sub">
          {ladder && ladder.unconfirmed > 0 ? `另有 ${ladder.unconfirmed} 只待确认` : '高位家数'}
        </span>
      </div>

      <div className="dc-kpi-cell" title="全 A 成交额合计与平均涨跌幅（平均涨跌幅是「普涨还是普跌」的最快读数）">
        <span>两市成交 / 均涨</span>
        <span className="dc-kpi-value">
          <b>{breadth ? fmtBigNum(breadth.amountSum) : '—'}</b>
        </span>
        <span
          className="dc-kpi-sub"
          style={{ color: breadth && breadth.avgPct !== 0 ? (breadth.avgPct > 0 ? up : down) : dim }}
        >
          {breadth ? `均值 ${pctText(breadth.avgPct, 2)}` : '读取中…'}
        </span>
      </div>

      {/* 涨跌分布：一条横条（左跌右涨），重心在哪一侧一眼可见；逐段 title 给区间与家数 */}
      <div className="dc-kpi-dist">
        <span className="dc-kpi-dist-label">涨跌分布</span>
        <span className="dc-kpi-dist-bar" title="按涨跌幅区间分段的成分股家数（左 = 跌，右 = 涨）">
          {(dist ?? []).map((b) => (
            <i
              key={b.key}
              title={`${b.label}%：${b.count} 只`}
              style={{
                width: distTotal > 0 ? `${(b.count / distTotal) * 100}%` : '0%',
                background: b.up ? up : down,
                opacity: distAlpha(b.label),
              }}
            />
          ))}
        </span>
        <span className="dc-kpi-dist-tip">
          {upShare === null ? '—' : `涨 ${upShare}% · 跌 ${100 - upShare}%`}
        </span>
      </div>
    </div>
  )
}
