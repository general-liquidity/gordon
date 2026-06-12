import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const NAMED = "(?:red|green|yellow|blue|magenta|cyan|white|gray|grey|black)(?:Bright)?";
const FORBIDDEN = [
  new RegExp(`(?:color|borderColor)=\\{?["']${NAMED}["']`, "g"),
  /["']rgb\(\d{1,3},\s*\d{1,3},\s*\d{1,3}\)["']/g,
];

const ALLOWLIST = [
  "src/tui/components/ContextSuggestions.tsx",
  "src/tui/components/InlineHelp.tsx",
  "src/tui/components/browsers/AuditBrowser.tsx",
  "src/tui/components/browsers/CLIBrowser.tsx",
  "src/tui/components/browsers/ExecutionAlgoSelector.tsx",
  "src/tui/components/browsers/HelpBrowser.tsx",
  "src/tui/components/browsers/HistorySearchInput.tsx",
  "src/tui/components/browsers/MarketplaceBrowser.tsx",
  "src/tui/components/browsers/MemorySelector.tsx",
  "src/tui/components/browsers/MessageSelector.tsx",
  "src/tui/components/browsers/OutputStylePicker.tsx",
  "src/tui/components/browsers/PlaybookBrowser.tsx",
  "src/tui/components/browsers/PluginBrowser.tsx",
  "src/tui/components/browsers/SessionBrowser.tsx",
  "src/tui/components/browsers/ShortcutsBrowser.tsx",
  "src/tui/components/browsers/StrategyBrowser.tsx",
  "src/tui/components/browsers/ThemePicker.tsx",
  "src/tui/components/browsers/ThreadBrowser.tsx",
  "src/tui/components/charts/AlphaDecayChart.tsx",
  "src/tui/components/charts/ContextVisualization.tsx",
  "src/tui/components/charts/GenomeDiffViewer.tsx",
  "src/tui/components/charts/IndicatorDashboard.tsx",
  "src/tui/components/charts/JournalViewer.tsx",
  "src/tui/components/charts/OrderbookView.tsx",
  "src/tui/components/charts/SwarmTree.tsx",
  "src/tui/components/dialogs/BackgroundTasksDialog.tsx",
  "src/tui/components/dialogs/CostThresholdDialog.tsx",
  "src/tui/components/dialogs/DiffDialog.tsx",
  "src/tui/components/dialogs/DoctorDialog.tsx",
  "src/tui/components/dialogs/ElicitationDialog.tsx",
  "src/tui/components/dialogs/ExportDialog.tsx",
  "src/tui/components/dialogs/GlobalSearchDialog.tsx",
  "src/tui/components/dialogs/HistorySearchDialog.tsx",
  "src/tui/components/dialogs/IdleReturnDialog.tsx",
  "src/tui/components/dialogs/InvalidConfigDialog.tsx",
  "src/tui/components/dialogs/InvalidSettingsDialog.tsx",
  "src/tui/components/dialogs/PagerDialog.tsx",
  "src/tui/components/dialogs/QuickOpenDialog.tsx",
  "src/tui/components/dialogs/ResetSessionDialog.tsx",
  "src/tui/components/dialogs/SettingsDialog.tsx",
  "src/tui/components/dialogs/SideQuestionDialog.tsx",
  "src/tui/components/dialogs/StatsDialog.tsx",
  "src/tui/components/dialogs/ToolExecutionDetailDialog.tsx",
  "src/tui/components/diff/DiffDetailView.tsx",
  "src/tui/components/diff/DiffFileList.tsx",
  "src/tui/components/display/DebateViewer.tsx",
  "src/tui/components/display/OptimizationResults.tsx",
  "src/tui/components/display/SearchBar.tsx",
  "src/tui/components/display/SkillExecutionViewer.tsx",
  "src/tui/components/display/TaskDependencyView.tsx",
  "src/tui/components/display/TradeJournal.tsx",
  "src/tui/components/display/renderToolActivity.tsx",
  "src/tui/components/editors/ConfigEditor.tsx",
  "src/tui/components/editors/DryRunPreview.tsx",
  "src/tui/components/editors/ExitFlow.tsx",
  "src/tui/components/editors/PlanEditor.tsx",
  "src/tui/components/editors/PrivacyConsent.tsx",
  "src/tui/components/editors/SessionPreview.tsx",
  "src/tui/components/editors/StructuredDiff.tsx",
  "src/tui/components/layout/BootLivePanel.tsx",
  "src/tui/components/layout/FooterHints.tsx",
  "src/tui/components/layout/GordonHeader.tsx",
  "src/tui/components/layout/PromptInput.tsx",
  "src/tui/components/layout/PromptInputFooter.tsx",
  "src/tui/components/layout/UnseenDivider.tsx",
  "src/tui/components/mcp/MCPAgentServerMenu.tsx",
  "src/tui/components/mcp/MCPListPanel.tsx",
  "src/tui/components/mcp/MCPManager.tsx",
  "src/tui/components/mcp/MCPReconnect.tsx",
  "src/tui/components/mcp/MCPRemoteServerMenu.tsx",
  "src/tui/components/mcp/MCPServerApprovalDialog.tsx",
  "src/tui/components/mcp/MCPServerMultiselectDialog.tsx",
  "src/tui/components/mcp/MCPSettings.tsx",
  "src/tui/components/mcp/MCPStdioServerMenu.tsx",
  "src/tui/components/mcp/MCPToolDetailView.tsx",
  "src/tui/components/mcp/MCPToolListView.tsx",
  "src/tui/components/mcp/McpParsingWarnings.tsx",
  "src/tui/components/messages/AdvisorMessage.tsx",
  "src/tui/components/messages/ApprovalMessage.tsx",
  "src/tui/components/messages/BacktestMessage.tsx",
  "src/tui/components/messages/CompactBoundaryMessage.tsx",
  "src/tui/components/messages/ErrorMessage.tsx",
  "src/tui/components/messages/HandoffMessage.tsx",
  "src/tui/components/messages/HighlightedThinkingText.tsx",
  "src/tui/components/messages/InterruptedMessage.tsx",
  "src/tui/components/messages/MessageActions.tsx",
  "src/tui/components/messages/PlanApprovalMessage.tsx",
  "src/tui/components/messages/RateLimitMessage.tsx",
  "src/tui/components/messages/RejectedPlanMessage.tsx",
  "src/tui/components/messages/ScanResultMessage.tsx",
  "src/tui/components/messages/StreamingText.tsx",
  "src/tui/components/messages/TaskAssignmentMessage.tsx",
  "src/tui/components/messages/UserMessage.tsx",
  "src/tui/components/messages/UserToolCanceledMessage.tsx",
  "src/tui/components/messages/UserToolErrorMessage.tsx",
  "src/tui/components/messages/UserToolRejectMessage.tsx",
  "src/tui/components/messages/UserToolSuccessMessage.tsx",
  "src/tui/components/notices/ActionableRiskAlerts.tsx",
  "src/tui/components/notices/EmergencyHalt.tsx",
  "src/tui/components/notices/MemoryUpdateNotification.tsx",
  "src/tui/components/notices/OrderRecoveryNotice.tsx",
  "src/tui/components/panels/BrokerManagerPanel.tsx",
  "src/tui/components/panels/CompactionPanel.tsx",
  "src/tui/components/panels/ConstitutionPanel.tsx",
  "src/tui/components/panels/DeFiOverviewPanel.tsx",
  "src/tui/components/panels/ExchangeManagerPanel.tsx",
  "src/tui/components/panels/LabsPanel.tsx",
  "src/tui/components/panels/SchedulerPanel.tsx",
  "src/tui/components/permissions/APICallPermissionRequest.tsx",
  "src/tui/components/permissions/EnterAutonomousPermissionRequest.tsx",
  "src/tui/components/permissions/ExitAutonomousPermissionRequest.tsx",
  "src/tui/components/permissions/FallbackPermissionRequest.tsx",
  "src/tui/components/permissions/GordonQuestionDialog.tsx",
  "src/tui/components/permissions/StrategyModificationPermissionRequest.tsx",
  "src/tui/components/spinners/ShimmerChar.tsx",
  "src/tui/components/spinners/SpinnerGlyph.tsx",
  "src/tui/components/spinners/TeammateSpinnerLine.tsx",
  "src/tui/components/spinners/TradingSpinner.tsx",
  "src/tui/components/status/AgentProgress.tsx",
  "src/tui/components/status/AwaySummary.tsx",
  "src/tui/components/status/BackgroundTask.tsx",
  "src/tui/components/status/DaemonStatus.tsx",
  "src/tui/components/status/DataSourceHealth.tsx",
  "src/tui/components/status/FeedbackSurvey.tsx",
  "src/tui/components/status/HandoffArrow.tsx",
  "src/tui/components/status/MarketDataStatus.tsx",
  "src/tui/components/status/PostTradeFeedback.tsx",
  "src/tui/components/status/ReconciliationStatus.tsx",
  "src/tui/components/status/ToolCallInline.tsx",
  "src/tui/components/status/WorkerBadge.tsx",
  "src/tui/components/wizards/FirstTradeTour.tsx",
  "src/tui/components/wizards/SetupWizard.tsx",
  "src/tui/design-system/FuzzyPicker.tsx",
  "src/tui/design-system/KeybindingWarnings.tsx",
  "src/tui/design-system/ListItem.tsx",
  "src/tui/design-system/SearchBox.tsx",
  "src/tui/design-system/SelectMulti.tsx",
  "src/tui/design-system/StatusIcon.tsx",
] as const;

function scannedFiles(): string[] {
  const roots = [join(process.cwd(), "src/tui/components"), join(process.cwd(), "src/tui/design-system")];
  const files: string[] = [];

  for (const root of roots) {
    walk(root, root.endsWith("design-system"));
  }

  return files.sort();

  function walk(dir: string, designSystemRoot: boolean): void {
    for (const entry of readdirSync(dir)) {
      const fullPath = join(dir, entry);
      const stat = statSync(fullPath);
      if (stat.isDirectory()) {
        if (!designSystemRoot) walk(fullPath, false);
        continue;
      }

      const rel = normalize(relative(process.cwd(), fullPath));
      if (rel.includes(".test.")) continue;
      if (designSystemRoot && !rel.match(/^src\/tui\/design-system\/[^/]+\.tsx$/)) continue;
      if (!rel.match(/\.(ts|tsx)$/)) continue;
      files.push(rel);
    }
  }
}

function normalize(path: string): string {
  return path.replaceAll("\\", "/");
}

function matchesFor(path: string): string[] {
  const source = readFileSync(join(process.cwd(), path), "utf8");
  const matches: string[] = [];
  for (const pattern of FORBIDDEN) {
    pattern.lastIndex = 0;
    for (const match of source.matchAll(pattern)) {
      matches.push(`${path}:${lineOf(source, match.index ?? 0)}: ${match[0]}`);
    }
  }
  return matches;
}

function lineOf(source: string, index: number): number {
  let line = 1;
  for (let i = 0; i < index; i += 1) {
    if (source.charCodeAt(i) === 10) line += 1;
  }
  return line;
}

describe("raw color literal ratchet", () => {
  test("non-allowlisted TUI component files do not use raw color literals", () => {
    const allowlisted = new Set<string>(ALLOWLIST);
    const violations = scannedFiles()
      .filter((path) => !allowlisted.has(path))
      .flatMap(matchesFor);

    expect(
      violations,
      `Use colorMap.ts (getRiskColor/getMoneyColor/getSignalColor/getAgentColor) or theme tokens via useTheme().\n${violations.join("\n")}`,
    ).toEqual([]);
  });

  test("allowlist entries are still dirty so the list only shrinks", () => {
    const cleanAllowlistEntries = ALLOWLIST.filter((path) => matchesFor(path).length === 0);

    expect(
      cleanAllowlistEntries,
      `Remove clean files from ALLOWLIST:\n${cleanAllowlistEntries.join("\n")}`,
    ).toEqual([]);
  });
});
