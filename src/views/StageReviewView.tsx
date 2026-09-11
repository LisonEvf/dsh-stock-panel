/**
 * src/views/StageReviewView.tsx — **复盘阶段**（WATCH-METHODOLOGY §3）。
 *
 * 一级导航里「复盘」的落地：阶段头（本阶段要回答的问题 + 唯一输出）
 * + 既有七步复盘页（`pages/ReviewPage.tsx`——页内本就按 ①整体情绪 → ⑦明日交易计划
 * 的流程顺序排布，并带「七步复盘引导条」）。
 *
 * 为什么不再拆页签：七步是一条**顺序流程**，拆页签会切断「从看天气到写清单」的因果链。
 * 宽屏下由 `.dc-flow` 列流把各步并排展开，顺序仍由序号与引导条保持可见。
 */
import { ReviewPage } from '@/pages/ReviewPage'
import { openStockAndWatch, useUi } from '@/lib/selection'
import { currentStage, resolveStage, STAGES } from '@/lib/stage'
import { StageHead } from './StageHead'

export function StageReviewView() {
  const ui = useUi()
  const real = currentStage()
  const stage = resolveStage(real, ui.stageOverride)
  return (
    <div className="dc-view">
      <StageHead
        stage="review"
        note={
          stage === 'review'
            ? '清单外的一律不看不买（§3.3 纪律）· 盘后与盘前做的是同一件事：写/改清单'
            : `真实阶段是「${STAGES[real].label}」，你正在提前或回看复盘`
        }
      />
      <ReviewPage onOpenStock={openStockAndWatch} />
    </div>
  )
}
