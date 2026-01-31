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
