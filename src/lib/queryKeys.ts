/**
 * DSH 插件版 React Query key 管理。
 * 仅列出个股分析所需，后续按需扩展。
 */

export const QK = {
  // Kline
  kline: (symbol: string, start: string, end: string, extColumns?: string) =>
    ['kline', symbol, start, end, extColumns ?? ''] as const,
  klineMinute: (symbol: string, date: string) =>
    ['kline-minute', symbol, date] as const,
  stockLevels: (symbol: string, days?: number) =>
    ['stock-levels', symbol, days ?? 120] as const,

  // 自选股
  watchlist: ['watchlist'] as const,

  // AI 分析报告
  analysisReports: ['analysis-reports'] as const,
}
