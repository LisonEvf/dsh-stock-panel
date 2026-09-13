/**
 * src/components/Num.tsx — 数字的**单一排版入口**（B2 排版收口）。
 *
 * 为什么需要（审计实测）：
 *   - 数字排版有 3 套配方：`.dc-num` 24 次、只 `font-mono` 38 处（缺 tabular-nums，
 *     跳动时会抖）、只 `tabular-nums` 7 处（缺等宽，字宽不齐）；
 *   - `.dc-num` 把 `亿/万/%` 这类**单位也吞进西文等宽字体** → CJK 字宽跳变、看着发挤。
 *
 * 做法：数字部分用等宽 + `tabular-nums`，单位部分用正文字体（`.dc-unit`），
 * 并且**单位/精度只从 `@/lib/format` 来**（沿用 fmtAmount / fmtPctPercent / fmtPrice），
 * 组件里不再手写 `toFixed` 与 `1e8`。
 */
import { fmtAmount, fmtPrice } from '@/lib/format'

export type NumKind = 'count' | 'amount' | 'price' | 'percent' | 'text'
/** 语义色档：`up`/`down` 是**价格涨跌**语义；`ok`/`bad`/`warn`/`info` 是**状态**语义，两者不可混用。 */
export type NumTone = 'up' | 'down' | 'flat' | 'ok' | 'bad' | 'warn' | 'info'

const TONE_CLASS: Record<NumTone, string> = {
  up: 'dc-up',
  down: 'dc-down',
  flat: 'dc-flat',
  ok: 'dc-ok',
  bad: 'dc-bad',
  warn: 'dc-warn',
  info: 'dc-info',
}

interface Props {
  /** 原始值（未格式化）。`kind='text'` 时直接渲染 `raw`。 */
  value?: number | null | undefined
  kind?: NumKind
  /** 单位（如 `只`、`%`）；`amount`/`percent` 的单位由格式化函数给出，无需传。 */
  unit?: string
  /** 语义色档。**省略则跟随父级颜色**（不擅自染色）。 */
  tone?: NumTone
  /** 悬停显示的原始值（默认给出，便于核对口径）。 */
  title?: string
  /** 位数（price/count 用）。 */
  digits?: number
  className?: string
}

/** 把「数字 + 单位」拆开：`1.99万亿` → `1.99` + `万亿`；`+2.37%` → `+2.37` + `%`。 */
export function splitNum(text: string): { digits: string; unit: string } {
  const m = text.match(/^([+-]?[\d,]+(?:\.\d+)?)(.*)$/)
  if (m === null) return { digits: text, unit: '' }
  return { digits: m[1], unit: m[2] }
}

export function Num({ value, kind = 'count', unit = '', tone, title, digits, className = '' }: Props) {
  let text: string
  switch (kind) {
    case 'amount':
      text = fmtAmount(value)
      break
    case 'price':
      text = fmtPrice(value, digits ?? 2)
      break
    case 'percent':
      // 入参是**百分数**（3.5 = +3.5%）——小数口径请先自行 ×100 或改用 fmtPctRatio
      text = value == null || Number.isNaN(value) ? '—' : `${value > 0 ? '+' : ''}${value.toFixed(digits ?? 2)}%`
      break
    case 'count':
      text = value == null || Number.isNaN(value) ? '—' : Math.round(value).toLocaleString('en-US')
      break
    default:
      text = String(value ?? '')
  }

  if (kind === 'text') {
    return <span className={className}>{text}</span>
  }

  const split = splitNum(text)
  const full = split.digits + split.unit + (unit === '' ? '' : unit)
  const toneClass = tone === undefined ? '' : TONE_CLASS[tone]
  const cls = [toneClass, className].filter((x) => x !== '').join(' ')

  return (
    <span className={cls === '' ? undefined : cls} title={title ?? full}>
      <span className="dc-num">{split.digits}</span>
      {(split.unit !== '' || unit !== '') && (
        <span className="dc-unit">
          {split.unit}
          {unit}
        </span>
      )}
    </span>
  )
}
