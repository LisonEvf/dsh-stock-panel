/**
 * src/views/StageWarView.tsx — **作战阶段**（WATCH-METHODOLOGY §4–§5）。
 *
 * 一级导航里「作战」的落地。竞价 / 验证窗 / 盘中 / 尾盘**不是四个页面**，
 * 而是同一个战场的四个时段形态——`pages/WarPage.tsx` 内部已按 `session-clock`
 * 自动切换：竞价/盘前挂「预期 × 竞价判定」+ 竞价雷达，盘中挂「三问必答卡」，
 * 全程带「时段任务条」（每时段唯一目标 + 检查清单 + 倒计时）。
 *
 * 这里只加阶段头：把方法论原文的三个问题摊在顶部（先看问题，再看数据）。
 */
import { WarPage } from '@/pages/WarPage'
import { openStockAndWatch, useUi } from '@/lib/selection'
import { currentStage, resolveStage, STAGES } from '@/lib/stage'
import { StageHead } from './StageHead'

export function StageWarView() {
  const ui = useUi()
  const real = currentStage()
  const stage = resolveStage(real, ui.stageOverride)
  return (
    <div className="dc-view">
      <StageHead
        stage={real}
        note={
          stage === real
            ? real === 'intraday'
              ? '9:30–10:00 是竞价结论验证窗：高开是否有承接 / 低开是否收复 / 弱转强是否放量'
              : real === 'tail'
                ? 'T+1 之下尾盘是唯一的动作点：兑现或换股，收盘前完成仓位定性'
                : undefined
            : `真实阶段是「${STAGES[real].label}」`
        }
      />
      <WarPage onOpenStock={openStockAndWatch} />
    </div>
  )
}
