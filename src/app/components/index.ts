/**
 * Components Index
 * Export all reusable UI components
 */

export { RichTable, KeyValueList } from "./RichTable.tsx";
export type { TableColumn, ColumnType, RichTableProps, KeyValuePair, KeyValueListProps } from "./RichTable.tsx";

// Command autocomplete with filtering
export { CommandAutocomplete, CommandHint, fuzzyMatch } from "./CommandAutocomplete.tsx";

// ink-ui based components
export { TradeConfirmation } from "./TradeConfirmation.tsx";
export {
  ProgressIndicator,
  ScanProgress,
  OrderProgress,
  StreamingProgress,
  useOperationTimer
} from "./ProgressIndicator.tsx";
export {
  SuccessMessage,
  ErrorMessage,
  WarningAlert,
  InfoAlert,
  RiskWarning,
  ConnectionAlert
} from "./StatusMessages.tsx";

// Markdown rendering
export { MarkdownText } from "./MarkdownText.tsx";

// Theme system
export { ThemeProvider, useTheme, useIsDarkTheme, useThemeColors } from "./ThemeProvider.tsx";

// Keyboard shortcuts
export { ShortcutsOverlay, ShortcutsHint, useShortcutsHint } from "./ShortcutsOverlay.tsx";

// Paginated output
export { PaginatedOutput, PaginatedText, usePagination } from "./PaginatedOutput.tsx";

// Quick actions
export { QuickActions, getQuickActionCommand, getQuickActionsCount, QUICK_ACTIONS } from "./QuickActions.tsx";

// Result summaries and timing
export {
  ResultSummaryBox,
  OperationTimer,
  withTiming,
  withTimingSync,
  formatExecutionTime,
  formatNumber,
  formatPercent,
  formatCurrency,
  getValueColor,
  buildScanSummary,
  buildAnalysisSummary,
  buildBacktestSummary,
  buildPortfolioSummary,
  buildComparisonSummary,
} from "./ResultSummary.tsx";
export type { ResultSummary, ResultSummaryProps } from "./ResultSummary.tsx";

// Standard column definitions for RichTable
export {
  MARKET_SCAN_COLUMNS,
  MARKET_SCAN_COLUMNS_COMPACT,
  TRENDING_COLUMNS,
  ANALYSIS_COLUMNS,
  PORTFOLIO_COLUMNS,
  PORTFOLIO_COLUMNS_COMPACT,
  PORTFOLIO_COLUMNS_DETAILED,
  BACKTEST_COLUMNS,
  BACKTEST_COLUMNS_COMPACT,
  BACKTEST_METRICS_COLUMNS,
  BACKTEST_TRADES_COLUMNS,
  STRATEGY_COMPARISON_COLUMNS,
  STRATEGY_LIST_COLUMNS,
  ORDERS_COLUMNS,
  POSITIONS_COLUMNS,
  TRADE_HISTORY_COLUMNS,
  EARN_COLUMNS,
  getResponsiveColumns,
  addAllocationColumn,
  transformScanDataForDisplay,
  transformBacktestDataForDisplay,
} from "./StandardColumns.ts";

// Text-based result formatting (for tool outputs)
export {
  formatResultSummary,
  formatScanResults,
  formatAnalysisResults,
  formatBacktestResults,
  formatPortfolioResults,
  formatComparisonResults,
} from "./formatResults.ts";
export type {
  ScanResultFormatOptions,
  AnalysisResultFormatOptions,
  BacktestResultFormatOptions,
  PortfolioFormatOptions,
  ComparisonFormatOptions,
} from "./formatResults.ts";
