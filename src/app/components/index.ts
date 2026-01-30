/**
 * Components Index
 * Export all reusable UI components
 */

export { RichTable, KeyValueList } from "./RichTable.tsx";
export type { TableColumn, ColumnType, RichTableProps, KeyValuePair, KeyValueListProps } from "./RichTable.tsx";

export { CommandAutocomplete, CommandHint } from "./CommandAutocomplete.tsx";

// ink-ui based components
export { TradeConfirmation } from "./TradeConfirmation.tsx";
export { ProgressIndicator, ScanProgress, OrderProgress } from "./ProgressIndicator.tsx";
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
