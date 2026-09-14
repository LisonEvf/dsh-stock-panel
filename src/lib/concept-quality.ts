/**
 * src/lib/concept-quality.ts —— 自挖类「可采信」判据（host/client 共用，**纯函数**）。
 *
 * ## 这个模块要解决的问题：引擎的 `weak_chain` 只挡住了一半伪类
 *
 * 内置引擎走的是**阈值图连通分量**（纯 JS 路径没有 scipy，见 `docs/CONCEPT-CALIBRATION.md` §1）。
 * 阈值图的固有性质是：只要存在一条边的传递链，很远的两只票也会落进同一个"类" ——
 * 于是会切出**巨类**（实测 `min_corr=0.3` 时 196 只里 194 只挤成一个类，类内相关 0.008）。
 * 引擎给这种类打了 `weak_chain=true`，界面也据此过滤。
 *
 * 但实测（2026-09-13，`min_corr=0.6 / window=90 / pool=200`）出现了**漏网的一份**：
 * 一个 **52 只**的类，`mean_intra_corr=0.428`、`strong_density=0.14`，
 * 而 `weak_chain=false` —— 它照样进了"可采信类"，和"中际旭创+新易盛"这种
 * 两只票的真班并列显示，还因为成员多、个别成员涨停而在强度排序里排到前面。
 * 界面现状是把它当正常类、也送去命名（等于让模型给一坨传递链编一个主题）。
 *
 * ## 判据（两条，都必须成立 —— 宁可放过，也不误杀真班）
 *
 * | 条件 | 为什么 |
 * | --- | --- |
 * | `strongDensity < 0.5` | 强边密度 = 类内相关 ≥ 阈值的边占比。真班是"互为同伴"，密度接近 1；传递链的密度低（实测 0.14 vs 真班 0.67–1.00） |
 * | `intraCorr < minCorr` | 类内平均相关低于**用户自己设的切边阈值**：说明这个类的连通主要靠链，而不是靠互相够像 |
 *
 * 为什么**不是**只看 `intraCorr < minCorr`：阈值图里 3 只票的三角形只要有一条边偏弱
 * （A-B 0.7 / B-C 0.7 / A-C 0.3 → 均值 0.567 < 0.6）就会被误杀，而它是**真的小班**。
 * 加上密度条件后，三角形的强边密度 = 2/3 = 0.67 ≥ 0.5 → 不拦。
 * 两条件同时成立才拦，误杀面被压到最小，而实测的两个负样本（194 只/0.008、
 * 52 只/0.428+0.14）都被拦住。
 *
 * ## 与 `weak_chain` 的关系
 *
 * 本模块**不改写**引擎的结论，只在其之上追加一道**本地可复算**的门槛，
 * 并把两者分开报（`weak_chain` = 引擎说的；`chain_suspect` = 本地判的）——
 * 归因必须分层，否则出问题时无法判断"是引擎漏了"还是"是我们加严了"
 * （同 `host/naming/cause.ts` 的立场）。
 *
 * 被拦下的类**不删除、不静默**：界面照旧计数并给出被拦的原因（记录而不丢弃）。
 */

/** 类不采信的原因（`ok` = 可采信）。 */
export type ClassQualityReason = 'ok' | 'weak_chain' | 'chain_suspect'

/** 可采信判据的结论。 */
export interface ClassQuality {
  usable: boolean
  reason: ClassQualityReason
  /** 人读说明（进 title 与统计行；**由系统算出来**，不由模型书写）。 */
  note: string
}

/**
 * 传递链伪类的**强边密度**上限。
 *
 * 实测真班 0.67–1.00、传递链巨类 0.14，0.5 落在两者的空档里；
 * 改它必须同时改本注释与 `tests/concept-quality.test.ts` 的两组正/负样本。
 */
export const CHAIN_MAX_DENSITY = 0.5

/** 判据所需的最小形状（类列表行与命名路径都能满足）。 */
export interface QualityInput {
  /** 引擎的弱链标记（缺省 = 没标）。 */
  weakChain?: boolean | undefined
  /** 类内平均相关。 */
  intraCorr?: number | undefined
  /** 强边密度（类内相关 ≥ 阈值的边占比）。 */
  strongDensity?: number | undefined
  /** 类规模。 */
  size?: number | undefined
}

function finiteOr(v: unknown, dflt: number): number {
  const n = Number(v)
  return Number.isFinite(n) ? n : dflt
}

/**
 * 判定一个类能否采信。`minCorr` 必须传**本次实际使用的切边阈值**
 * （用户/参数改了阈值，判据要跟着变；拿默认值硬编码会让结论与参数脱钩）。
 */
export function classQuality(c: QualityInput, minCorr: number): ClassQuality {
  if (c.weakChain === true) {
    return {
      usable: false,
      reason: 'weak_chain',
      note: '引擎标记为弱链伪类（类内相关远低于阈值）：不采信、不展示、不命名',
    }
  }
  const intra = finiteOr(c.intraCorr, 1)
  const density = finiteOr(c.strongDensity, 1)
  if (density < CHAIN_MAX_DENSITY && intra < minCorr) {
    return {
      usable: false,
      reason: 'chain_suspect',
      note:
        `传递链可疑：类内平均相关 ${intra.toFixed(3)} < 切边阈值 ${minCorr}，且强边密度 ${density.toFixed(2)} `
        + `< ${CHAIN_MAX_DENSITY}（互为同伴的边太少）—— 阈值图把一串弱连接传成了"一个班"，不采信`,
    }
  }
  return { usable: true, reason: 'ok', note: '' }
}

/** 过滤结果（保留被拦下的行，供界面计数与说明）。 */
export interface ClassFilterResult<T> {
  usable: T[]
  /** 被拦下的行 + 原因（**不丢弃**：界面要显示"排除了几个、为什么"）。 */
  dropped: Array<{ row: T; quality: ClassQuality }>
  /** 按原因分组的计数（弱链 / 传递链可疑）。 */
  byReason: Record<Exclude<ClassQualityReason, 'ok'>, number>
}

/** 按可采信判据过滤一批类行（**不丢信息**：被拦下的原样返回在 `dropped` 里）。 */
export function filterUsableClasses<T extends QualityInput>(rows: readonly T[], minCorr: number): ClassFilterResult<T> {
  const usable: T[] = []
  const dropped: Array<{ row: T; quality: ClassQuality }> = []
  const byReason = { weak_chain: 0, chain_suspect: 0 }
  for (const row of rows) {
    const q = classQuality(row, minCorr)
    if (q.usable) usable.push(row)
    else {
      dropped.push({ row, quality: q })
      if (q.reason !== 'ok') byReason[q.reason] += 1
    }
  }
  return { usable, dropped, byReason }
}

/** 被拦原因的中文标签（界面统计行与命名降级说明共用一处）。 */
export function qualityReasonLabel(reason: ClassQualityReason): string {
  switch (reason) {
    case 'weak_chain':
      return '弱链伪类'
    case 'chain_suspect':
      return '传递链可疑'
    default:
      return '可采信'
  }
}
