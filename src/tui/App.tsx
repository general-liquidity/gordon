import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Box, Text, Spacer, useApp } from "./ink-custom";

// ── Providers ──
import { SettingsProvider } from "./state/SettingsProvider.js";
import { MemoryProvider } from "./state/MemoryProvider.js";
import { StatsProvider } from "./state/StatsProvider.js";
import { NotificationsProvider } from "./state/NotificationsProvider.js";
import {
  AppStateProvider,
  useAppState,
  useDispatch,
  useAppStore,
} from "./state/AppStateProvider.js";
import type { DialogId } from "./state/types.ts";
import { evaluatePermissionModeTransition } from "./state/permissionModeFsm.ts";

// ── Components ──
// Static imports: these were lazy require()s to dodge a circular dep that no
// longer exists. require() also broke `bun build --compile`, which refuses any
// require whose transitive deps contain a top-level await (ink -> yoga-layout).
import { ThemeProvider } from "./themes/ThemeProvider.tsx";
import { GordonInkUITheme } from "./themes/inkUiTheme.tsx";
import { type Message, type MessageVariant } from "./components/messages/MessageBubble.tsx";
import { StreamingText } from "./components/messages/StreamingText.tsx";
import { AgentProgress } from "./components/status/AgentProgress.tsx";
import { SwarmTree } from "./components/charts/SwarmTree.tsx";
import { ApprovalDialog } from "./components/dialogs/ApprovalDialog.tsx";
import { WorkerBadge } from "./components/status/WorkerBadge.tsx";
import { InlineHelp } from "./components/InlineHelp.js";
import { CommandPalette, type PaletteItem, type PaletteWorkspaceSection } from "./components/CommandPalette.js";
import { BootScreen } from "./components/layout/BootScreen.tsx";
import { SetupWizard, type SetupPreflight } from "./components/wizards/SetupWizard.tsx";
import { PrivacyConsent, type PrivacyChoices } from "./components/editors/PrivacyConsent.tsx";
// HandoffArrow no longer rendered inline (suppress routing noise) — keep
// import out so we don't carry dead deps.
// import { HandoffArrow } from "./components/status/HandoffArrow.tsx";
import { PromptInput } from "./components/layout/PromptInput.tsx";
import { StatusLine } from "./components/layout/StatusLine.tsx";
import { BootLivePanel } from "./components/layout/BootLivePanel.tsx";
import { BootHeader } from "./components/layout/BootHeader.tsx";
import { collectBootStaticInfo } from "./boot/bootComposition.ts";
import { defaultMessageQueue } from "../infra/runtime/messageQueue.js";
import { saveEnvKeys } from "../infra/storage/config/env.ts";
import { providerRegistry } from "../infra/runtime/providers/registry.js";
import { loadConfig, saveConfig } from "../infra/storage/config/config.js";
import { normalizeExchangeId, ccxtEnvNames, extractCcxtSubId, ccxtIdToNativeVenue } from "../infra/exchange/types.ts";
import { checkForInjection } from "../infra/safety/defense/injectionDefense.ts";
import type { ExchangeType } from "../types/config.ts";
import { refreshRuntimeCredentials } from "./bridge/runtime.js";
import { VirtualMessageList } from "./components/display/VirtualMessageList.tsx";
import { CostDisplay } from "./components/status/CostDisplay.tsx";
import { updateTerminalTab, resetTerminalTab } from "./terminalTab.js";
import { getActionsForKey, isVimModeEnabled, validateKeybindings } from "./keybindings/keybindings.js";
import { getNotificationFolder } from "./notifications/notificationFolder.js";
import { useFpsTracker } from "./hooks/animation/useFpsTracker.ts";
import {
  getPerformanceMonitor,
  installStdoutTap,
  resetPerformanceMonitor,
} from "./diagnostics/performanceMonitor.js";
import { useAnimationPause } from "./hooks/animation/useAnimationClock.ts";
import { useProactiveChatSubscription } from "./hooks/useProactiveChatSubscription.js";
import { useRateLimitNotification } from "./hooks/useRateLimitNotification.js";
import { useAlertSubscription } from "./state/useAlertSubscription.js";
import {
  getNextHint,
  recordHintShown,
  incrementSessionCount,
  loadOnboardingState,
  shouldShowFirstTradeTour,
  markFirstTradeTourDone,
  type HintContext,
} from "../app/setup/onboarding/index.ts";
import { getQuickActionItems, type WorkspaceId } from "../app/slash/commandUx.ts";

// ── Phase 15-18 Components ──
import { SettingsDialog } from "./components/dialogs/SettingsDialog.tsx";
import { ExportDialog } from "./components/dialogs/ExportDialog.tsx";
import { EmergencyHalt } from "./components/notices/EmergencyHalt.tsx";
import { ContextVisualization } from "./components/charts/ContextVisualization.tsx";
import { SessionBrowser } from "./components/browsers/SessionBrowser.tsx";
import { MemorySelector } from "./components/browsers/MemorySelector.tsx";
import { ModelPicker } from "./components/browsers/ModelPicker.tsx";
import { ThemePicker } from "./components/browsers/ThemePicker.tsx";
import { ExchangePicker } from "./components/browsers/ExchangePicker.tsx";
import { BrokerPicker } from "./components/browsers/BrokerPicker.tsx";
import { DoctorDialog } from "./components/dialogs/DoctorDialog.tsx";
import { runDoctorChecks } from "../infra/diagnostics/doctor.ts";
import { HelpBrowser } from "./components/browsers/HelpBrowser.tsx";
import { ConfigEditor } from "./components/editors/ConfigEditor.tsx";
import { InvalidConfigDialog } from "./components/dialogs/InvalidConfigDialog.tsx";
import { InvalidSettingsDialog } from "./components/dialogs/InvalidSettingsDialog.tsx";
import { ThreadBrowser, type ThreadInfo } from "./components/browsers/ThreadBrowser.tsx";
import { listThreads, switchThread } from "../infra/storage/entities/session.ts";
import { JournalViewer } from "./components/charts/JournalViewer.tsx";
import { ShortcutsBrowser } from "./components/browsers/ShortcutsBrowser.tsx";
import { ApprovalBrowser } from "./components/browsers/ApprovalBrowser.tsx";
import { MCPManager } from "./components/mcp/MCPManager.tsx";
import { MarketplaceBrowser } from "./components/browsers/MarketplaceBrowser.tsx";
import { CLIBrowser } from "./components/browsers/CLIBrowser.tsx";
import { LabsPanel } from "./components/panels/LabsPanel.tsx";
import { PrivacyScreen } from "./components/layout/PrivacyScreen.tsx";
import { FeedbackSurvey } from "./components/status/FeedbackSurvey.tsx";
import { ThinkStep } from "./components/status/ThinkStep.tsx";
import { TradingSpinner } from "./components/spinners/TradingSpinner.tsx";
import { GlimmerMessage } from "./components/spinners/GlimmerMessage.tsx";
import { ToolCallInline } from "./components/status/ToolCallInline.tsx";
import { StreamingMarkdown } from "./components/messages/StreamingMarkdown.tsx";
import { NoSelect } from "./components/layout/NoSelect.tsx";
import { QueuedCommandsNotice } from "./components/notices/QueuedCommandsNotice.tsx";
import { MemoryUsageIndicator } from "./components/notices/MemoryUsageIndicator.tsx";
import { usePromptSuggestions } from "./hooks/usePromptSuggestions.js";
import { StashNotice } from "./components/notices/StashNotice.tsx";
import { ExitFlow } from "./components/editors/ExitFlow.tsx";
import { AwaySummary } from "./components/status/AwaySummary.tsx";
import { PressEnterToContinue } from "./components/layout/PressEnterToContinue.tsx";
import { OrderbookView } from "./components/charts/OrderbookView.tsx";
import { AutonomousControlDialog } from "./components/dialogs/AutonomousControlDialog.tsx";
import { SkillExecutionViewer } from "./components/display/SkillExecutionViewer.tsx";
import { ConstitutionPanel } from "./components/panels/ConstitutionPanel.tsx";
import { InjectionDefensePanel } from "./components/panels/InjectionDefensePanel.tsx";
import { DataSourceHealth } from "./components/status/DataSourceHealth.tsx";
import { RiskConfigPanel } from "./components/panels/RiskConfigPanel.tsx";
import { DeFiOverviewPanel } from "./components/panels/DeFiOverviewPanel.tsx";
import { MarketOverviewPanel } from "./components/panels/MarketOverviewPanel.tsx";
import { RegimeStatusPanel } from "./components/panels/RegimeStatusPanel.tsx";
import { StatsDialog } from "./components/dialogs/StatsDialog.tsx";
import { GlobalSearchDialog } from "./components/dialogs/GlobalSearchDialog.tsx";
import { ResetSessionDialog } from "./components/dialogs/ResetSessionDialog.tsx";
import { PagerDialog, PAGER_LINE_THRESHOLD, findLastLongMessage } from "./components/dialogs/PagerDialog.tsx";
import { DialogHost } from "./components/dialogs/DialogHost.tsx";

// ── Previously unwired components ──
import { ActionableRiskAlerts } from "./components/notices/ActionableRiskAlerts.tsx";
import { AlgoExecutionProgress } from "./components/status/AlgoExecutionProgress.tsx";
import { BacktestWizard } from "./components/wizards/BacktestWizard.tsx";
import { BrokerManagerPanel } from "./components/panels/BrokerManagerPanel.tsx";
import { ConsensusDetailPanel } from "./components/panels/ConsensusDetailPanel.tsx";
import { ContextSuggestions } from "./components/ContextSuggestions.js";
import { CoordinatorAgentStatus } from "./components/status/CoordinatorAgentStatus.tsx";
import { CostThresholdDialog } from "./components/dialogs/CostThresholdDialog.tsx";
import { DiffDialog } from "./components/dialogs/DiffDialog.tsx";
import { DryRunPreview } from "./components/editors/DryRunPreview.tsx";
import { EffortIndicator } from "./components/status/EffortIndicator.tsx";
import { ExchangeManagerPanel } from "./components/panels/ExchangeManagerPanel.tsx";
import { GenomeEvolutionPanel } from "./components/panels/GenomeEvolutionPanel.tsx";
import { HistorySearchDialog } from "./components/dialogs/HistorySearchDialog.tsx";
import { IdleReturnDialog } from "./components/dialogs/IdleReturnDialog.tsx";
import { IndicatorValueViewer } from "./components/charts/IndicatorValueViewer.tsx";
import { InsightBrowser } from "./components/browsers/InsightBrowser.tsx";
import { MarketPulsePanel } from "./components/panels/MarketPulsePanel.tsx";
import { MessageSelector } from "./components/browsers/MessageSelector.tsx";
import { OptimizationResults } from "./components/display/OptimizationResults.tsx";
import { PlanEditor } from "./components/editors/PlanEditor.tsx";
import { PluginBrowser } from "./components/browsers/PluginBrowser.tsx";
import { QuickOpenDialog } from "./components/dialogs/QuickOpenDialog.tsx";
import { ReconciliationStatus } from "./components/status/ReconciliationStatus.tsx";
import { TaskDependencyView } from "./components/display/TaskDependencyView.tsx";
import { WalkForwardResults } from "./components/display/WalkForwardResults.tsx";
import { PlanDiff, type PlanVersion } from "./components/editors/PlanDiff.tsx";
import { PostTradeFeedback } from "./components/status/PostTradeFeedback.tsx";
import { HIP3AssetBrowser } from "./components/browsers/HIP3AssetBrowser.tsx";
import { CounterfactualPanel, type TradeOutcome, type Scenario } from "./components/panels/CounterfactualPanel.tsx";
import { DebateViewer, type DebateViewerData, type DebateRole } from "./components/display/DebateViewer.tsx";
import { SideQuestionDialog } from "./components/dialogs/SideQuestionDialog.tsx";
import { ElicitationDialog, type FormField } from "./components/dialogs/ElicitationDialog.tsx";
import type { SideQuestion } from "./services/suggestions/sideQuestion.ts";

// ── Backend Module UI Components ──
import { LivePositions } from "./components/status/LivePositions.tsx";
import { TradingModeBadge } from "./components/status/TradingModeBadge.tsx";
import { TradingModeBanner } from "./components/status/TradingModeBanner.tsx";
import { KillSwitchBadge } from "./components/status/KillSwitchBadge.tsx";
import { RadarFocusBar } from "./components/status/RadarFocusBar.tsx";
import { FirstTradeTour } from "./components/wizards/FirstTradeTour.tsx";
import { TradeQueueView } from "./components/views/TradeQueueView.tsx";
import { SafetyDashboardView } from "./components/views/SafetyDashboardView.tsx";
import type { MutationResult } from "./components/charts/GenomeDiffViewer.tsx";
import { AuditBrowser } from "./components/browsers/AuditBrowser.tsx";
import { SchedulerPanel } from "./components/panels/SchedulerPanel.tsx";
import { PlaybookBrowser } from "./components/browsers/PlaybookBrowser.tsx";
import { StrategyBrowser } from "./components/browsers/StrategyBrowser.tsx";
import { GenomeDiffViewer } from "./components/charts/GenomeDiffViewer.tsx";
import { IndicatorDashboard } from "./components/charts/IndicatorDashboard.tsx";
import { ConsensusView } from "./components/display/ConsensusView.tsx";
import { ExecutionAlgoSelector } from "./components/browsers/ExecutionAlgoSelector.tsx";
import { DaemonStatus } from "./components/status/DaemonStatus.tsx";
import { TrailingStopDisplay } from "./components/status/TrailingStopDisplay.tsx";
import { OrderRecoveryNotice } from "./components/notices/OrderRecoveryNotice.tsx";
import { MarketDataStatus } from "./components/status/MarketDataStatus.tsx";

// ── Hooks ──
import { useDoublePress } from "./hooks/input/useDoublePress.ts";
import { useElapsedTime, formatElapsed } from "./hooks/animation/useElapsedTime.ts";

/** Format a millisecond duration the same way the spinner does. */
function formatElapsedMs(ms: number): string {
  return formatElapsed(ms / 1000);
}

/** Compact token-count formatter — '432', '12.4K', '1.8M'. Used in the
 *  status line for both context tokens and last-turn tokens. */
function formatTokenCount(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return `${Math.round(n)}`;
}
import { useTerminalSize } from "./hooks/scroll/useTerminalSize.ts";
import { useMergedCommands } from "./hooks/useMergedCommands.js";
import { useSkillTracking } from "./hooks/useSkillTracking.ts";
import { useScreenReader } from "./hooks/useScreenReader.js";
import { useKillSwitchStatus } from "./hooks/useKillSwitchStatus.ts";
import { getSessionTip } from "./boot/tips.ts";
import { installRenderBudget, isRenderBudgetEnabled, isRenderBudgetStrict, getRenderBudgetBreachCount } from "./diagnostics/renderBudget.ts";
import { enterAltScreen, leaveAltScreen } from "./utils/altScreen.ts";
import { radarQuickKeyCommand } from "./input/radarQuickKeys.ts";
import { InputRouterProvider, useRoutedInput, FOCUS_PRIORITY } from "./input/InputRouterContext.tsx";
import { getSuggestionStore } from "../infra/proactive/storage/suggestionStore.ts";

// ── Bridge ──
import { initializeRuntime, handleInput, handleApprovalDecision, performSessionReset, getRuntime, abortActiveTurn } from "./bridge/runtime.js";

// ============================================================================
// Gordon App — Claude Code for Vibe Trading
//
// Conversation-first. No borders on messages. No panels. No dashboard.
// Inline tables, charts, approvals, agent progress — all in the conversation.
//
// Provider tree:
//   SettingsProvider > MemoryProvider > StatsProvider > NotificationsProvider
//   > AppStateProvider > AppInner
//
// State: useAppState(selector) + useDispatch() from AppStateProvider
//        + local useState for Phase 15-18 dialog toggles
// ============================================================================

// ── Feedback trade data shape ──
interface FeedbackTradeData {
  tradeId: string;
  symbol: string;
  pnl?: number;
  pnlPercent?: number;
}

const EXAMPLE_PROMPTS = [
  'Try "what\'s BTC doing?"',
  'Try "scan for opportunities"',
  'Try "check my portfolio risk"',
  'Try "/morning-brief"',
  'Try "analyze ETH setup"',
  'Try "what\'s trending today?"',
  'Try "/dd BTC"',
] as const;

/**
 * DebateViewerOverlay — wraps DebateViewer with Esc-dismiss.
 * DebateViewer has no onClose prop, so we attach key handling here.
 */
function DebateViewerOverlay({ data, onClose }: { data: DebateViewerData; onClose: () => void }) {
  useRoutedInput((_input, key) => {
    if (!key.escape) return false;
    onClose();
  }, { id: "dialog:debate-view", priority: FOCUS_PRIORITY.DIALOG });
  return (
    <Box flexDirection="column">
      <DebateViewer data={data} />
      <Box paddingX={2}><Text dimColor>Press Esc to dismiss.</Text></Box>
    </Box>
  );
}

/**
 * Format a PerfSnapshot for inline rendering as a system message body.
 * Concise, ≤ 8 lines — matches /perf command spec.
 */
function formatPerfSnapshot(
  snap: ReturnType<ReturnType<typeof getPerformanceMonitor>["snapshot"]>,
  flushPath: string | null,
  status: "running" | "idle" | "stopped",
  budgetBreaches = 0,
): string {
  const h = snap.frameHistogram;
  const fmt = (n: number) => (n >= 10 ? n.toFixed(1) : n.toFixed(2));
  const mb = (n: number) => `${(n / (1024 * 1024)).toFixed(0)}MB`;
  const lines: string[] = [];
  lines.push(`Performance snapshot (${status}; last ${h.samples} samples):`);
  lines.push(`  Frame time:  p50=${fmt(h.p50Ms)}ms  p95=${fmt(h.p95Ms)}ms  p99=${fmt(h.p99Ms)}ms`);
  lines.push(`  Mean write:  ${fmt(h.meanWriteMs)}ms`);
  lines.push(`  Byte churn:  ~${Math.round(h.meanBytes)} bytes/frame`);
  if (snap.latestMemory) {
    lines.push(`  Memory:      heap=${mb(snap.latestMemory.heapUsed)}  rss=${mb(snap.latestMemory.rss)}`);
  } else {
    lines.push(`  Memory:      (no samples yet)`);
  }
  lines.push(`  Renders:     ${snap.totalRenders} total  /  ${snap.totalFrames} frames`);
  if (isRenderBudgetEnabled()) {
    lines.push(`  Budget:      ${budgetBreaches} breach${budgetBreaches === 1 ? "" : "es"} recorded`);
  }
  lines.push(`  Log:         ${flushPath ?? "(no flush path; use /perf start <path>)"}`);
  return lines.join("\n");
}

/**
 * AppInner — The core UI, mounted inside the provider tree.
 * Reads all state via useAppState selectors and dispatches via useDispatch.
 */
function AppInner() {
  const dispatch = useDispatch();
  const { getState } = useAppStore();
  // Separate handle for perf instrumentation — avoids mutating the shape of
  // the destructure above (which is read throughout the component).
  const perfStore = useAppStore();
  const { exit } = useApp();
  useKillSwitchStatus(dispatch);

  // Boot-time config error: render a dialog instead of crashing the process.
  const configErrorType = process.env.GORDON_CONFIG_ERROR_TYPE;
  const configErrorMsg = process.env.GORDON_CONFIG_ERROR_MSG ?? "Unknown config error";
  if (configErrorType === "syntax") {
    return <InvalidConfigDialog errors={[configErrorMsg]} onClose={() => exit()} />;
  }
  if (configErrorType === "settings") {
    return <InvalidSettingsDialog errors={[configErrorMsg]} onClose={() => exit()} />;
  }

  // Subscribe to proactive:suggestion_fired events on the Gordon event bus
  // and push them into the chat stream as proactive_suggestion messages.
  // This is the only place that bridges radar-mode suggestions into the TUI.
  useProactiveChatSubscription(dispatch);

  // Bridge `alert:fired` events (from emitAlert) into the TUI notification
  // queue. Info → info variant; warning → alert variant; critical → error.
  useAlertSubscription();

  // Rate limit notification — records exchange:rate_limit and surfaces a
  // dismissible inline banner while throttled.
  const rateLimit = useRateLimitNotification();
  React.useEffect(() => {
    let unsubRate: (() => void) | undefined;
    let unsubPlan: (() => void) | undefined;
    let unsubTrade: (() => void) | undefined;
    let unsubTradeClosed: (() => void) | undefined;
    let unsubDebate: (() => void) | undefined;
    let unsubElicit: (() => void) | undefined;
    void import("../events/index.ts").then((m) => {
      const bus = m.getEventBus();
      unsubRate = bus.on("exchange:rate_limit", (event) => {
        rateLimit.recordRateLimit(event.exchangeId, event.weight, event.limit, 60_000);
      });
      // Wire PlanDiff: diff successive plan:created for same symbol
      unsubPlan = bus.on("plan:created", (event) => {
        const p: any = event.plan ?? {};
        const symbol = String(p.symbol ?? p.id ?? "unknown");
        const tp = Array.isArray(p.takeProfit) && p.takeProfit.length > 0 ? Number(p.takeProfit[0]?.price ?? 0) : 0;
        const current: PlanVersion = {
          version: Date.now(),
          entry: Number(p.entry?.price ?? 0),
          stopLoss: Number(p.stopLoss?.price ?? 0),
          takeProfit: tp,
          sizeUsd: Number(p.allocation?.amount ?? 0),
          confidence: Number(p.confidence ?? 0),
          reasoning: typeof p.reasoning === "string" ? p.reasoning : undefined,
        };
        const prev = prevPlansRef.current.get(symbol);
        prevPlansRef.current.set(symbol, current);
        if (prev) setPlanDiff({ previous: prev, current });
      });
      // Wire PostTradeFeedback: prompt after order fill (trade:opened)
      unsubTrade = bus.on("trade:opened", (event) => {
        const t: any = event.trade ?? {};
        const side = String(t.side ?? "").toUpperCase();
        const qty = Number(t.entries?.[0]?.quantity ?? t.quantity ?? 0);
        const price = Number(t.averageEntry ?? t.entries?.[0]?.price ?? 0);
        const desc = `${side || "TRADE"} ${qty || ""} ${t.symbol ?? ""}${price ? ` @ $${price.toFixed(2)}` : ""}`.trim();
        setPostTradeFeedback(desc);
      });
      // Wire CounterfactualPanel: auto-overlay "what if" scenarios on trade:closed
      unsubTradeClosed = bus.on("trade:closed", (event) => {
        const t: any = event.trade ?? {};
        const entry = Number(t.averageEntry ?? t.entries?.[0]?.price ?? 0);
        const exits = Array.isArray(t.exits) ? t.exits : [];
        const exit = Number(exits[exits.length - 1]?.price ?? entry);
        if (!entry || !exit) return; // skip if we don't have prices
        const side = entry <= exit ? "long" : (Number(event.pnl) >= 0 ? "long" : "short");
        const trade: TradeOutcome = {
          symbol: String(t.symbol ?? "?"),
          side,
          entryPrice: entry,
          exitPrice: exit,
          pnl: Number(event.pnl ?? 0),
          pnlPercent: Number(event.pnlPercent ?? 0),
        };
        // Synthesize 3 alternate exits from actual exit price
        const scale = (mult: number) => exit * mult;
        const mkScenario = (description: string, altExit: number): Scenario => {
          const dir = side === "long" ? 1 : -1;
          const altPct = ((altExit - entry) / entry) * 100 * dir;
          const altPnl = trade.pnl === 0 ? 0 : trade.pnl * (altPct / (trade.pnlPercent || altPct || 1));
          return { description, alternateExit: altExit, alternatePnl: altPnl, alternatePnlPercent: altPct };
        };
        const scenarios: Scenario[] = [
          mkScenario("Exit 1% earlier", scale(side === "long" ? 0.99 : 1.01)),
          mkScenario("Held to +2%", scale(side === "long" ? 1.02 : 0.98)),
          mkScenario("Exit at entry (BE)", entry),
        ];
        setCounterfactual({ trade, scenarios });
      });
      // Wire DebateViewer: populate overlay from debate:resolved events (runDebate emits these)
      unsubDebate = bus.on("debate:resolved", (event) => {
        const transcript = event.transcript ?? [];
        // Map the flat transcript into DebateViewer's investment/risk shape
        const roleOf = (speaker: string): DebateRole => {
          const s = speaker.toLowerCase();
          if (s.includes("bull")) return "bull";
          if (s.includes("bear")) return "bear";
          if (s.includes("aggressive")) return "aggressive";
          if (s.includes("conservative")) return "conservative";
          if (s.includes("neutral")) return "neutral";
          if (s.includes("portfolio")) return "portfolio_manager";
          if (s.includes("manager")) return "manager";
          return "neutral";
        };
        const investmentRounds: DebateViewerData["investmentRounds"] = [];
        const riskRounds: DebateViewerData["riskRounds"] = [];
        transcript.forEach((t, i) => {
          const role = roleOf(t.speaker);
          const entry = { roundNumber: i + 1, role, argument: t.argument, keyPoints: [], confidence: 5 };
          if (role === "bull" || role === "bear" || role === "manager") investmentRounds.push(entry);
          else riskRounds.push(entry);
        });
        setDebateView({
          symbol: event.topic,
          investmentRounds,
          riskRounds,
          finalDecision: { action: "HOLD", confidence: 5, reasoning: event.conclusion ?? "" },
        });
      });
      // Wire elicitation dialog: an agent asked a question mid-task
      unsubElicit = bus.on("agent:elicitation_requested", (event) => {
        setElicitationRequest({
          requestId: event.requestId,
          prompt: event.prompt,
          options: event.options,
          kind: event.kind,
        });
      });
    });
    return () => { unsubRate?.(); unsubPlan?.(); unsubTrade?.(); unsubTradeClosed?.(); unsubDebate?.(); unsubElicit?.(); };
    // Empty deps: rateLimit.recordRateLimit is useCallback-stable and all
    // setState dispatchers are guaranteed stable by React. Using [rateLimit]
    // caused re-subscribe on every render (rateLimit is a fresh object
    // literal per render) which in turn re-fired handlers → infinite loop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Mirror warning/critical alerts to the audit log so they survive TUI
  // restarts and reach daemons running without a UI. Idempotent — safe to
  // invoke on every mount.
  React.useEffect(() => {
    let stop: (() => void) | undefined;
    void import("../infra/platform/observability/alertAuditMirror.ts").then((m) => {
      stop = m.startAlertAuditMirror();
    });
    return () => { stop?.(); };
  }, []);

  // ── Selectors (fine-grained subscriptions) ──
  const bootPhase = useAppState((s) => s.bootPhase);
  const runtimeReady = useAppState((s) => s.runtimeReady);
  const showSetup = useAppState((s) => s.showSetup);
  const [setupPreflight, setSetupPreflight] = useState<SetupPreflight>({
    llmProviders: [],
    exchanges: [],
    brokers: [],
  });

  // ── First-run privacy consent gate ──
  // Shows the PrivacyConsent component if no choice has been recorded yet.
  // Persisted via the .telemetry state file's notifiedAt field.
  const [needsPrivacyConsent, setNeedsPrivacyConsent] = React.useState<boolean | null>(null);
  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { getStatus } = await import("../infra/platform/telemetry/telemetry.ts");
        const s = getStatus();
        // We treat anonymousId presence as "telemetry state file exists"; the
        // real check is whether the user was ever shown the consent screen.
        // The telemetry module exposes `notifiedAt` indirectly — if telemetry
        // isn't enabled and notifiedAt is null, we haven't asked yet.
        const fs = await import("node:fs");
        const path = await import("node:path");
        const { GORDON_DIR } = await import("../infra/storage/paths.ts");
        const file = path.join(GORDON_DIR, ".telemetry");
        let needsConsent = true;
        if (fs.existsSync(file)) {
          const raw = JSON.parse(fs.readFileSync(file, "utf-8"));
          if (raw.notifiedAt) needsConsent = false;
        }
        if (!cancelled) setNeedsPrivacyConsent(needsConsent);
      } catch {
        if (!cancelled) setNeedsPrivacyConsent(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);
  const showPalette = useAppState((s) => s.showPalette);
  const showHelp = useAppState((s) => s.showHelp);
  const showFirstTradeTour = useAppState((s) => s.showFirstTradeTour);
  const showResetConfirm = useAppState((s) => s.showResetConfirm);
  const modeBanner = useAppState((s) => s.modeBanner);
  const killSwitches = useAppState((s) => s.killSwitches);
  const activeOverlayView = useAppState((s) => s.activeOverlayView);
  const pager = useAppState((s) => s.pager);
  const radarFocus = useAppState((s) => s.radarFocus);
  const activeWorkspace = useAppState((s) => s.activeWorkspace);
  const openDialogs = useAppState((s) => s.openDialogs);
  const permissionMode = useAppState((s) => s.permissionMode);
  const [connectivityHints, setConnectivityHints] = useState({ hasExchange: false, hasBroker: false });
  const messages = useAppState((s) => s.messages);
  const isStreaming = useAppState((s) => s.isStreaming);
  const streamBuffer = useAppState((s) => s.streamBuffer);
  const activeThinking = useAppState((s) => s.activeThinking);
  const activeAgents = useAppState((s) => s.activeAgents);
  const swarmMode = useAppState((s) => s.swarmMode);
  const handoffHistory = useAppState((s) => s.handoffHistory);
  const pendingApprovals = useAppState((s) => s.pendingApprovals);
  const sessionId = useAppState((s) => s.sessionId);

  // ── FPS tracking + animation clock ──
  const fpsMetrics = useFpsTracker(2000); // Report every 2s
  const { pause: pauseAnimations, resume: resumeAnimations } = useAnimationPause();

  // ── Phase 5 reconciler baseline — opt-in only when perf diagnostics are enabled ──
  // Subscribes to the underlying store (bypassing the React render loop) and
  // taps `process.stdout.write` to record frame-time + cell-churn for the
  // custom reconciler comparison. Zero-cost when the env var is unset: the
  // early return fires once at mount and nothing downstream runs.
  useEffect(() => {
    const flushPath = process.env.GORDON_PERF_LOG;
    const budgetEnabled = isRenderBudgetEnabled();
    if (!flushPath && !budgetEnabled) return; // zero-cost path

    const monitor = getPerformanceMonitor();
    monitor.start({ flushPath: flushPath ?? undefined });
    const uninstallTap = installStdoutTap(monitor);
    let budgetNotified = false;
    const uninstallBudget = budgetEnabled
      ? installRenderBudget({
          sink: (breach) => {
            const message = `[render-budget] ${breach.kind} frame ${breach.observedMs.toFixed(1)}ms > ${breach.budgetMs}ms budget (${breach.consecutive} consecutive)`;
            console.error(message);
            if (!budgetNotified) {
              budgetNotified = true;
              dispatch({
                type: "INJECT_NOTIFICATION",
                notification: {
                  id: `render-budget-${breach.at}`,
                  type: "tui:render_budget",
                  variant: "alert",
                  message,
                  timestamp: new Date(breach.at).toISOString(),
                },
              });
            }
            if (isRenderBudgetStrict()) {
              setTimeout(() => {
                throw new Error(`render budget breached: ${breach.kind}`);
              }, 0);
            }
          },
        })
      : () => {};

    // Track message-count deltas via the store's native subscribe() so the
    // perf counter reflects real dispatches, not just React commits.
    let lastMessageCount = perfStore.getState().messages.length;
    const unsubscribe = perfStore.subscribe(() => {
      const next = perfStore.getState().messages.length;
      if (next !== lastMessageCount) {
        monitor.recordRender(next, "ADD_MESSAGE");
        lastMessageCount = next;
      }
    });

    return () => {
      unsubscribe();
      uninstallBudget();
      uninstallTap();
      monitor.stop();
      resetPerformanceMonitor();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dispatch]);
  const isScreenReaderActive = useScreenReader();
  const vimModeActive = isVimModeEnabled();
  const vimModeRef = React.useRef<"insert" | "normal" | "visual">("insert");
  const useAltScreen = process.env.GORDON_ALT_SCREEN !== "false";
  const threadId = useAppState((s) => s.threadId);
  const isResumedSession = useAppState((s) => s.isResumedSession);
  const tokenCount = useAppState((s) => s.tokenCount);
  const contextTokens = useAppState((s) => s.contextTokens);
  const lastTurnDurationMs = useAppState((s) => s.lastTurnDurationMs);
  const lastTurnTokens = useAppState((s) => s.lastTurnTokens);
  const autonomousActive = useAppState((s) => s.autonomousActive);
  const autonomousStrategyCount = useAppState((s) => s.autonomousStrategyCount);

  const isDialogOpen = React.useCallback(
    (id: DialogId) => openDialogs.some((dialog) => dialog.id === id),
    [openDialogs],
  );
  const dialogSetter = React.useCallback(
    (id: DialogId) => (next: boolean | ((prev: boolean) => boolean)) => {
      const current = openDialogs.some((dialog) => dialog.id === id);
      const show = typeof next === "function" ? next(current) : next;
      dispatch(show ? { type: "OPEN_DIALOG", id } : { type: "CLOSE_DIALOG", id });
    },
    [dispatch, openDialogs],
  );

  // ── Phase 15-18 reducer-backed dialog state ──
  const showSettings = isDialogOpen("settings");
  const setShowSettings = dialogSetter("settings");
  const showExport = isDialogOpen("export");
  const setShowExport = dialogSetter("export");
  const showEmergency = isDialogOpen("emergency");
  const setShowEmergency = dialogSetter("emergency");
  const showContext = isDialogOpen("context");
  const setShowContext = dialogSetter("context");
  const showSessions = isDialogOpen("sessions");
  const setShowSessions = dialogSetter("sessions");
  const showMemory = isDialogOpen("memory");
  const setShowMemory = dialogSetter("memory");
  const [privacyMode, setPrivacyMode] = useState(false);
  // Boot header (banner + session box) snapshot — captured once and committed
  // to the message-list Static so it survives terminal scroll-up. Replaces the
  // raw pre-Ink print in src/tui/index.tsx, which Ink could clobber on overflow.
  const [bootHeaderData] = useState(() => ({
    info: collectBootStaticInfo(),
    columns: process.stdout.columns ?? 120,
  }));
  const bootHeaderNode = useMemo(
    () => <BootHeader info={bootHeaderData.info} columns={bootHeaderData.columns} />,
    [bootHeaderData],
  );
  const showFeedback = isDialogOpen("feedback");
  const setShowFeedback = dialogSetter("feedback");
  const [feedbackTradeData, setFeedbackTradeData] = useState<FeedbackTradeData | null>(null);

  // PlanDiff overlay — auto-shown when a second plan:created fires for the
  // same symbol and any numeric field changed. Previous snapshot kept per symbol.
  const [planDiff, setPlanDiff] = useState<{ previous: PlanVersion; current: PlanVersion } | null>(null);
  const prevPlansRef = React.useRef<Map<string, PlanVersion>>(new Map());

  // PostTradeFeedback overlay — shown when trade:opened fires (order fill).
  const [postTradeFeedback, setPostTradeFeedback] = useState<string | null>(null);

  // HIP3AssetBrowser overlay — opened via /hip3 slash command.
  const showHIP3 = isDialogOpen("hip3");
  const setShowHIP3 = dialogSetter("hip3");

  // CounterfactualPanel overlay — auto-shown on trade:closed (or /review-trade fallback).
  const [counterfactual, setCounterfactual] = useState<{ trade: TradeOutcome; scenarios: Scenario[] } | null>(null);

  // DebateViewer overlay — populated from debate:resolved events (see useEffect above).
  const [debateView, setDebateView] = useState<DebateViewerData | null>(null);

  // Elicitation overlay — shown when an agent calls the ask_user tool.
  // Cleared when the user answers (which emits agent:elicitation_answered).
  const [elicitationRequest, setElicitationRequest] = useState<{
    requestId: string;
    prompt: string;
    options?: Array<{ value: string; label: string }>;
    kind: "choice" | "text" | "confirm";
  } | null>(null);

  const showModelPicker = isDialogOpen("modelPicker");
  const setShowModelPicker = dialogSetter("modelPicker");
  const showMCPManager = isDialogOpen("mcpManager");
  const setShowMCPManager = dialogSetter("mcpManager");
  const showMarketplace = isDialogOpen("marketplace");
  const setShowMarketplace = dialogSetter("marketplace");
  const showCLIBrowser = isDialogOpen("cliBrowser");
  const setShowCLIBrowser = dialogSetter("cliBrowser");
  const showThemePicker = isDialogOpen("themePicker");
  const setShowThemePicker = dialogSetter("themePicker");
  const showExchangePicker = isDialogOpen("exchangePicker");
  const setShowExchangePicker = dialogSetter("exchangePicker");
  const showBrokerPicker = isDialogOpen("brokerPicker");
  const setShowBrokerPicker = dialogSetter("brokerPicker");
  const showDoctor = isDialogOpen("doctor");
  const setShowDoctor = dialogSetter("doctor");
  const showHelpBrowser = isDialogOpen("helpBrowser");
  const setShowHelpBrowser = dialogSetter("helpBrowser");
  const showConfigEditor = isDialogOpen("configEditor");
  const setShowConfigEditor = dialogSetter("configEditor");
  const showThreadBrowser = isDialogOpen("threadBrowser");
  const setShowThreadBrowser = dialogSetter("threadBrowser");
  // Conversation history for the thread browser — loaded when it opens so
  // /resume + /threads show real past sessions instead of an empty menu.
  const [threadList, setThreadList] = useState<ThreadInfo[]>([]);
  useEffect(() => {
    if (!showThreadBrowser) return;
    let alive = true;
    void listThreads()
      .then((records) => {
        if (!alive) return;
        setThreadList(records.map((r) => ({
          id: r.threadId,
          name: r.title || undefined,
          createdAt: r.startedAt,
          messageCount: 0,
          lastActivity: r.lastActiveAt,
          isActive: r.threadId === threadId,
        })));
      })
      .catch(() => {});
    return () => { alive = false; };
  }, [showThreadBrowser, threadId]);
  const showJournal = isDialogOpen("journal");
  const setShowJournal = dialogSetter("journal");
  const showShortcuts = isDialogOpen("shortcuts");
  const setShowShortcuts = dialogSetter("shortcuts");
  const showApprovalBrowser = isDialogOpen("approvalBrowser");
  const setShowApprovalBrowser = dialogSetter("approvalBrowser");
  const showLabs = isDialogOpen("labs");
  const setShowLabs = dialogSetter("labs");

  // ── Backend module UI toggles ──
  const showAudit = isDialogOpen("audit");
  const setShowAudit = dialogSetter("audit");
  const showScheduler = isDialogOpen("scheduler");
  const setShowScheduler = dialogSetter("scheduler");
  const showPlaybooks = isDialogOpen("playbooks");
  const setShowPlaybooks = dialogSetter("playbooks");
  const showStrategies = isDialogOpen("strategies");
  const setShowStrategies = dialogSetter("strategies");
  const showGenome = isDialogOpen("genome");
  const setShowGenome = dialogSetter("genome");
  const showIndicators = isDialogOpen("indicators");
  const setShowIndicators = dialogSetter("indicators");
  const showConsensus = isDialogOpen("consensus");
  const setShowConsensus = dialogSetter("consensus");
  const showOrderbook = isDialogOpen("orderbook");
  const setShowOrderbook = dialogSetter("orderbook");
  const showAutonomous = isDialogOpen("autonomous");
  const setShowAutonomous = dialogSetter("autonomous");
  const showSkills = isDialogOpen("skills");
  const setShowSkills = dialogSetter("skills");
  const showConstitution = isDialogOpen("constitution");
  const setShowConstitution = dialogSetter("constitution");
  const showInjectionDefense = isDialogOpen("injectionDefense");
  const setShowInjectionDefense = dialogSetter("injectionDefense");
  const showDataHealth = isDialogOpen("dataHealth");
  const setShowDataHealth = dialogSetter("dataHealth");
  const showRiskConfig = isDialogOpen("riskConfig");
  const setShowRiskConfig = dialogSetter("riskConfig");
  const showDefi = isDialogOpen("defi");
  const setShowDefi = dialogSetter("defi");
  const showMarketOverview = isDialogOpen("marketOverview");
  const setShowMarketOverview = dialogSetter("marketOverview");
  const showRegime = isDialogOpen("regime");
  const setShowRegime = dialogSetter("regime");
  const showStats = isDialogOpen("stats");
  const setShowStats = dialogSetter("stats");
  const showGlobalSearch = isDialogOpen("globalSearch");
  const setShowGlobalSearch = dialogSetter("globalSearch");
  const showExitFlow = isDialogOpen("exitFlow");
  const setShowExitFlow = dialogSetter("exitFlow");
  const [exampleIdx] = useState(() => Math.floor(Math.random() * 7));
  const showBacktestWizard = isDialogOpen("backtestWizard");
  const setShowBacktestWizard = dialogSetter("backtestWizard");
  const showBrokerManager = isDialogOpen("brokerManager");
  const setShowBrokerManager = dialogSetter("brokerManager");
  const showExchangeManager = isDialogOpen("exchangeManager");
  const setShowExchangeManager = dialogSetter("exchangeManager");
  const showGenomeEvolution = isDialogOpen("genomeEvolution");
  const setShowGenomeEvolution = dialogSetter("genomeEvolution");
  const showHistorySearch = isDialogOpen("historySearch");
  const setShowHistorySearch = dialogSetter("historySearch");
  const showIndicatorValue = isDialogOpen("indicatorValue");
  const setShowIndicatorValue = dialogSetter("indicatorValue");
  const showInsights = isDialogOpen("insights");
  const setShowInsights = dialogSetter("insights");
  const showMarketPulse = isDialogOpen("marketPulse");
  const setShowMarketPulse = dialogSetter("marketPulse");
  const showMessageSelector = isDialogOpen("messageSelector");
  const setShowMessageSelector = dialogSetter("messageSelector");
  const showOptimization = isDialogOpen("optimization");
  const setShowOptimization = dialogSetter("optimization");
  const showPlanEditor = isDialogOpen("planEditor");
  const setShowPlanEditor = dialogSetter("planEditor");
  const showPlugins = isDialogOpen("plugins");
  const setShowPlugins = dialogSetter("plugins");
  const showQuickOpen = isDialogOpen("quickOpen");
  const setShowQuickOpen = dialogSetter("quickOpen");
  const showReconciliation = isDialogOpen("reconciliation");
  const setShowReconciliation = dialogSetter("reconciliation");
  const showTaskDeps = isDialogOpen("taskDeps");
  const setShowTaskDeps = dialogSetter("taskDeps");
  const showWalkForward = isDialogOpen("walkForward");
  const setShowWalkForward = dialogSetter("walkForward");
  const [orderRecovery, setOrderRecovery] = useState<{
    orderId: string; symbol: string; reason: string; attempt: number; maxAttempts: number;
  } | null>(null);
  const [daemonStatus, setDaemonStatus] = useState<{
    status: "running" | "stopped" | "error"; taskCount: number; uptime: number;
  }>({ status: "stopped", taskCount: 0, uptime: 0 });
  const [marketFeeds, setMarketFeeds] = useState<Array<{
    name: string; status: "connected" | "degraded" | "disconnected"; latencyMs: number;
  }>>([]);
  const [genomeMutation, setGenomeMutation] = useState<MutationResult | null>(null);
  const [trailingStop, setTrailingStop] = useState<{
    symbol: string; currentPrice: number; stopLevel: number; trailAmount: number; side: "long" | "short";
  } | null>(null);

  // ── Custom hooks ──
  useTerminalSize();
  const ctrlC = useDoublePress(2000);
  const { elapsed: elapsedSeconds } = useElapsedTime(isStreaming);
  const paletteItems = useMergedCommands();
  // Command frecency — recently/frequently used commands rank up in the palette
  // and slash typeahead as an ordering tiebreaker. Recorded on submit below.
  const { recordUsage: recordCommandUsage, metrics: commandFrecency } = useSkillTracking();

  useEffect(() => {
    const conflicts = validateKeybindings();
    if (conflicts.length === 0) return;
    const preview = conflicts
      .slice(0, 3)
      .map((conflict) => `${conflict.key} -> ${conflict.winner} wins over ${conflict.actions.filter((action) => action !== conflict.winner).join(", ")}`)
      .join("\n");
    dispatch({
      type: "INJECT_NOTIFICATION",
      notification: {
        id: `keybinding-conflict-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        type: "tui:keybinding_conflict",
        variant: "alert",
        message: `Keybinding conflicts detected:\n${preview}`,
        timestamp: new Date().toISOString(),
      },
    });
  }, [dispatch]);

  // ── Derived: memoize all activeAgents derivations in one pass ──
  // Previously the root filtered/mapped activeAgents 3 times per render
  // (count, name, thinkingAgent). Consolidate into one useMemo so the
  // O(n) scan happens once and only when activeAgents actually changes.
  const { activeAgentCount, activeAgentName, thinkingAgent } = React.useMemo(() => {
    let running = 0;
    let thinking: (typeof activeAgents)[number] | undefined;
    for (const c of activeAgents) {
      if (c.status === "running") {
        running++;
        if (!thinking) thinking = c;
      }
    }
    return {
      activeAgentCount: running,
      activeAgentName: activeAgents.length === 1 ? (activeAgents[0]?.agentName ?? null) : null,
      thinkingAgent: thinking,
    };
  }, [activeAgents]);

  // Check if any dialog is open (to suppress other keybindings)
  const anyDialogOpen =
    showSettings || showExport || showEmergency || showContext ||
    showSessions || showMemory || showFeedback ||
    showAudit || showScheduler || showPlaybooks || showStrategies ||
    showGenome || showIndicators || showConsensus ||
    showOrderbook || showAutonomous || showSkills || showConstitution ||
    showInjectionDefense || showDataHealth || showRiskConfig || showDefi ||
    showMarketOverview || showRegime || showStats || showGlobalSearch || showExitFlow ||
    showBacktestWizard || showBrokerManager || showExchangeManager || showGenomeEvolution ||
    showHistorySearch || showIndicatorValue || showInsights || showMarketPulse ||
    showMessageSelector || showOptimization || showPlanEditor || showPlugins ||
    showQuickOpen || showReconciliation || showTaskDeps || showWalkForward ||
    showResetConfirm || !!pager || activeOverlayView !== null ||
    !!counterfactual || !!debateView || !!elicitationRequest;

  // ── Prompt suggestions based on conversation context ──
  const promptSuggestions = usePromptSuggestions(messages, isStreaming, connectivityHints.hasExchange);

  const paletteWorkspaceSection = React.useMemo<PaletteWorkspaceSection>(() => {
    const workspace = coerceWorkspace(activeWorkspace);
    const items = getQuickActionItems({
      permissionMode: permissionMode ?? "ask",
      workspace,
      setupComplete: !showSetup,
      hasExchange: connectivityHints.hasExchange,
      hasBroker: connectivityHints.hasBroker,
    }).map((item) => ({
      id: `workspace-${workspace}-${item.command}`,
      label: item.command,
      description: item.label,
      category: "workspace",
      workflowId: item.workflow ? ({
        discover: "discover",
        analyze: "discover",
        trade: "execute",
        run: "plan",
        accounts: "monitor",
        monitor: "monitor",
        build: "system",
        operate: "system",
      } as const)[item.workflow] : "system",
    }));
    return {
      label: `${workspace.toUpperCase()} QUICK ACTIONS`,
      items,
      colorToken: "uiFocus",
    };
  }, [activeWorkspace, permissionMode, showSetup, connectivityHints.hasExchange, connectivityHints.hasBroker]);

  // ── Queued message count ──
  const queuedCount = defaultMessageQueue.length?.() ?? 0;

  // ── Context budget. Claude Code parity: percentage reflects the
  // current request's input + cache footprint, NOT cumulative session
  // spend. 200k matches the Anthropic Claude default (Opus / Sonnet);
  // override via GORDON_CONTEXT_LIMIT for other providers. ──
  const contextLimit = Number.parseInt(process.env.GORDON_CONTEXT_LIMIT ?? "", 10) || 200_000;
  // Use contextTokens (from-last-turn) when we have it; fall back to
  // cumulative on cold start so the bar still moves before the first
  // turn lands.
  const liveContextTokens = contextTokens > 0 ? contextTokens : (tokenCount ?? 0);
  const memoryUsageRatio = liveContextTokens / contextLimit;

  // ── Determine if agent is in "thinking" mode (any running agent, no output yet) ──
  // thinkingAgent already derived above in the memoized block
  const isThinking = isStreaming && thinkingAgent != null && !streamBuffer;

  // ── Track active tool calls for inline display ──
  const activeToolCalls = useAppState((s) => s.activeToolCalls);
  // ── Track last user input for contextual spinner verb ──
  const [lastUserInput, setLastUserInput] = useState("");

  // ── StateUpdater adapter ──
  // The runtime bridge still uses `setState(fn)` — this adapter runs
  // the updater against a live snapshot from the store, diffs the
  // result, and dispatches granular actions so the reducer stays the
  // single source of truth. Using getState() avoids stale closures.
  const stateUpdater = useCallback(
    (fn: (prev: any) => any) => {
      const prev = getState();
      const next = fn(prev);
      if (!next || next === prev) return;

      // Diff and dispatch granular actions
      const nextLast = next.messages?.[next.messages.length - 1];
      const prevLast = prev.messages?.[prev.messages.length - 1];
      const streamingMessageOnly =
        next.messages !== prev.messages &&
        next.streamBuffer !== prev.streamBuffer &&
        next.messages.length === prev.messages.length &&
        nextLast?.id != null &&
        prevLast?.id != null &&
        nextLast.id === prevLast.id &&
        nextLast.content !== prevLast.content;

      if (streamingMessageOnly) {
        dispatch({
          type: "UPDATE_STREAMING_MESSAGE",
          id: nextLast.id,
          content: nextLast.content,
          streamBuffer: next.streamBuffer,
        });
      } else if (next.messages !== prev.messages) {
        dispatch({ type: "SET_MESSAGES", messages: next.messages });
      }
      if (next.isStreaming !== prev.isStreaming) {
        dispatch(next.isStreaming ? { type: "START_STREAMING" } : { type: "STOP_STREAMING" });
      }
      if (!streamingMessageOnly && next.streamBuffer !== prev.streamBuffer) {
        dispatch({ type: "SET_STREAM_BUFFER", buffer: next.streamBuffer });
      }
      if (next.activeThinking !== prev.activeThinking) {
        dispatch({ type: "SET_ACTIVE_THINKING", thinking: next.activeThinking });
      }
      if (next.activeToolCalls !== prev.activeToolCalls) {
        dispatch({ type: "SET_ACTIVE_TOOL_CALLS", calls: next.activeToolCalls });
      }
      if (next.activeAgents !== prev.activeAgents) {
        dispatch({ type: "SET_ACTIVE_AGENTS", agents: next.activeAgents });
      }
      if (next.swarmMode !== prev.swarmMode) {
        dispatch({ type: "SET_SWARM_MODE", enabled: next.swarmMode });
      }
      if (next.handoffHistory !== prev.handoffHistory) {
        dispatch({ type: "SET_HANDOFF_HISTORY", history: next.handoffHistory });
      }
      if (next.pendingApprovals !== prev.pendingApprovals) {
        dispatch({ type: "SET_PENDING_APPROVALS", approvals: next.pendingApprovals });
      }
      if (next.sessionId !== prev.sessionId || next.threadId !== prev.threadId) {
        dispatch({ type: "SET_SESSION", sessionId: next.sessionId, threadId: next.threadId });
      }
      if (next.isResumedSession !== prev.isResumedSession) {
        dispatch({ type: "SET_RESUMED_SESSION", isResumed: next.isResumedSession });
      }
      if (next.permissionMode !== prev.permissionMode) {
        dispatch({ type: "SET_PERMISSION_MODE", mode: next.permissionMode });
      }
      if (next.runtimeReady !== prev.runtimeReady) {
        dispatch({ type: "SET_RUNTIME_READY", ready: next.runtimeReady });
      }
      if (next.bootPhase !== prev.bootPhase) {
        dispatch({ type: "SET_BOOT_PHASE", phase: next.bootPhase });
      }
      if (next.showSetup !== prev.showSetup) {
        dispatch({ type: "SET_SHOW_SETUP", show: next.showSetup });
      }
      if (next.showFirstTradeTour !== prev.showFirstTradeTour) {
        dispatch({ type: "SET_SHOW_FIRST_TRADE_TOUR", show: next.showFirstTradeTour });
      }
      if (next.showPalette !== prev.showPalette) {
        dispatch({ type: "SET_SHOW_PALETTE", show: next.showPalette });
      }
      if (next.showHelp !== prev.showHelp) {
        dispatch({ type: "SET_SHOW_HELP", show: next.showHelp });
      }
      if (next.showResetConfirm !== prev.showResetConfirm) {
        dispatch({ type: "SET_SHOW_RESET_CONFIRM", show: next.showResetConfirm });
      }
      if (next.backgroundTasks !== prev.backgroundTasks) {
        dispatch({ type: "SET_BACKGROUND_TASKS", tasks: next.backgroundTasks });
      }
      if (next.autonomousActive !== prev.autonomousActive) {
        dispatch({
          type: "SET_AUTONOMOUS_ACTIVE",
          active: next.autonomousActive,
          strategyCount: next.autonomousStrategyCount,
        });
      }
      if (next.activeWorkspace !== prev.activeWorkspace) {
        dispatch({ type: "SET_ACTIVE_WORKSPACE", workspace: next.activeWorkspace });
      }
      if (next.activeOverlayView !== prev.activeOverlayView) {
        dispatch(next.activeOverlayView
          ? { type: "OPEN_OVERLAY_VIEW", view: next.activeOverlayView }
          : { type: "CLOSE_OVERLAY_VIEW" });
      }
      if (next.pager !== prev.pager) {
        dispatch(next.pager ? { type: "OPEN_PAGER", pager: next.pager } : { type: "CLOSE_PAGER" });
      }
      if (next.radarFocus !== prev.radarFocus) {
        dispatch({ type: "SET_RADAR_FOCUS", focus: next.radarFocus });
      }
      const legacyDialogs: Array<[keyof typeof next, DialogId]> = [
        ["showSettings", "settings"],
        ["showExport", "export"],
        ["showEmergency", "emergency"],
        ["showContext", "context"],
        ["showSessions", "sessions"],
        ["showMemory", "memory"],
      ];
      for (const [field, id] of legacyDialogs) {
        if (next[field] === undefined) continue;
        dispatch(next[field]
          ? { type: "OPEN_DIALOG", id }
          : { type: "CLOSE_DIALOG", id });
      }
      if (next.__resetSession) {
        dispatch({ type: "RESET_SESSION" });
      }
    },
    [dispatch, getState],
  );

  // ── Initialize runtime AFTER boot animation completes ──
  useEffect(() => {
    if (bootPhase !== "ready") return; // Wait for boot animation to finish
    if (runtimeReady) return; // Already initialized

    initializeRuntime(stateUpdater)
      .then(() => {
        dispatch({ type: "SET_RUNTIME_READY", ready: true });
        // First-run provider gate: if no LLM provider is configured, force
        // the setup wizard open before the user can type into the chat.
        // This replaces the silent fallthrough that used to hit the LLM
        // layer and produce a cryptic "Provider 'openai' not configured"
        // error on every message.
        try {
          const directProviders = providerRegistry.getAvailableProviders();
          const gateways = providerRegistry.getAvailableGateways();
          // Pre-populate preflight with everything already configured.
          // This lets the wizard skip steps on returning users.
          void (async () => {
            try {
              const config = await loadConfig();
              const pre: SetupPreflight = {
                llmProviders: [...directProviders, ...gateways],
                exchanges: config.exchanges.map((e) => e.type),
                brokers: config.brokers.map((b) => b.type),
                permissionMode: config.permissionMode,
              };
              setSetupPreflight(pre);
            } catch {
              // Keep defaults if config fails to load.
            }
          })();
          if (directProviders.length === 0 && gateways.length === 0) {
            dispatch({ type: "SET_SHOW_SETUP", show: true });
            dispatch({
              type: "ADD_MESSAGE",
              message: {
                id: "first-run-setup",
                role: "system" as const,
                content: "No LLM provider configured. Launching setup wizard — add an API key to continue.",
                timestamp: new Date().toISOString(),
              },
            });
          }
        } catch {
          // Non-critical — fall through to normal TUI. User will hit the
          // existing error path if something else is broken.
        }
      })
      .catch((err) => {
        dispatch({ type: "SET_RUNTIME_READY", ready: true });
        dispatch({
          type: "ADD_MESSAGE",
          message: {
            id: "init-error",
            role: "system" as const,
            variant: "error" as MessageVariant,
            content: `Runtime init error: ${err instanceof Error ? err.message : String(err)}`,
            timestamp: new Date().toISOString(),
          },
        });
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bootPhase]);

  useEffect(() => {
    if (!runtimeReady) return;
    void loadConfig().then(async (config) => {
      const hasExchange = (config.exchanges?.length ?? 0) > 0 || !!config.activeExchangeId;
      setConnectivityHints({
        hasExchange,
        hasBroker: (config.brokers?.length ?? 0) > 0 || !!config.activeBrokerId,
      });
      if (hasExchange) {
        try {
          const { syncExchangeMarketFeeds } = await import("../infra/exchange/marketStreamLifecycle.ts");
          await syncExchangeMarketFeeds();
        } catch {
          // Non-critical — feeds also restart on credential refresh
        }
      }
    });
  }, [runtimeReady]);

  // ── Progressive inline hints (shown on first few sessions, then hidden) ──
  useEffect(() => {
    if (!runtimeReady) return;
    const sessionCount = incrementSessionCount();

    const hintContext: HintContext = {
      sessionCount,
      onboardingComplete: true,
      hasExchange: connectivityHints.hasExchange,
      hasBroker: connectivityHints.hasBroker,
      hasGordonMd: false,
      permissionMode: permissionMode ?? "ask",
    };

    const hint = getNextHint(hintContext);
    if (hint) {
      recordHintShown(hint.id);
      dispatch({
        type: "ADD_MESSAGE",
        message: {
          id: `hint-${hint.id}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          role: "system" as const,
          content: `\u2139 ${hint.message}`,
          timestamp: new Date().toISOString(),
        },
      });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runtimeReady, connectivityHints.hasExchange, connectivityHints.hasBroker]);

  useEffect(() => {
    if (!runtimeReady || showSetup) return;
    if (shouldShowFirstTradeTour(loadOnboardingState(), showSetup)) {
      dispatch({ type: "SET_SHOW_FIRST_TRADE_TOUR", show: true });
    }
  }, [runtimeReady, showSetup, dispatch]);

  // Startup mode banner intentionally disabled for now. Mode-change banners
  // still fire from the reducer when crossing the paper/live boundary.

  const submitRef = React.useRef<(value: string) => void>(() => {});

  // ── Ctrl+C double-press exit ──
  useEffect(() => {
    if (ctrlC.isDoublePressed) {
      exit();
    }
  }, [ctrlC.isDoublePressed, exit]);

  // ── Global keybindings (dynamic via keybindings.json) ──
  useRoutedInput((input, key) => {
    // Build key string from Ink's key object
    const parts: string[] = [];
    if (key.ctrl) parts.push("ctrl");
    if (key.shift || (input.length === 1 && input === input.toUpperCase() && input !== input.toLowerCase())) parts.push("shift");
    const keyName = key.return ? "return" : key.escape ? "escape" : key.tab ? "tab"
      : key.upArrow ? "up" : key.downArrow ? "down" : key.leftArrow ? "left" : key.rightArrow ? "right"
      : key.pageDown ? "pagedown" : key.pageUp ? "pageup" : input.toLowerCase();
    parts.push(keyName);
    const keyCombo = parts.join("+");

    if (radarFocus && !key.ctrl && !key.meta) {
      if (key.escape) {
        dispatch({ type: "SET_RADAR_FOCUS", focus: null });
        return;
      }
      const command = radarQuickKeyCommand(input, radarFocus);
      if (command) {
        dispatch({ type: "SET_RADAR_FOCUS", focus: null });
        submitRef.current(command);
        return;
      }
    }

    if (anyDialogOpen) return false;

    // Resolve actions via keybinding system
    const vimMode = isVimModeEnabled()
      ? vimModeRef.current === "insert" ? "insertMode" : "normalMode"
      : "always";
    const actions = getActionsForKey(keyCombo, vimMode);

    for (const action of actions) {
      switch (action) {
        case "interruptStream":
          ctrlC.onPress();
          return;
        case "togglePalette":
          dispatch({ type: "TOGGLE_PALETTE" });
          return;
        case "togglePrivacy":
          setPrivacyMode((prev) => !prev);
          return;
        case "toggleEmergencyHalt":
          setShowEmergency((prev) => !prev);
          return;
        case "toggleSettings":
          setShowSettings((prev) => !prev);
          return;
        case "toggleExport":
          setShowExport((prev) => !prev);
          return;
        case "toggleContextView":
          setShowContext((prev) => !prev);
          return;
        case "toggleTradeQueue":
          dispatch(activeOverlayView === "tradeQueue"
            ? { type: "CLOSE_OVERLAY_VIEW" }
            : { type: "OPEN_OVERLAY_VIEW", view: "tradeQueue" });
          return;
        case "toggleSafetyDashboard":
          dispatch(activeOverlayView === "safety"
            ? { type: "CLOSE_OVERLAY_VIEW" }
            : { type: "OPEN_OVERLAY_VIEW", view: "safety" });
          return;
        case "focusRadar": {
          if (radarFocus) {
            dispatch({ type: "SET_RADAR_FOCUS", focus: null });
            return;
          }
          const suggestion = getSuggestionStore().getRecent(1, { status: "pending" })[0];
          if (!suggestion) {
            dispatch({
              type: "INJECT_NOTIFICATION",
              notification: {
                id: `radar-focus-empty-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
                type: "tui:radar_focus",
                variant: "info",
                message: "No pending radar card to focus.",
                timestamp: new Date().toISOString(),
              },
            });
            return;
          }
          dispatch({
            type: "SET_RADAR_FOCUS",
            focus: {
              id: suggestion.id,
              category: suggestion.category,
              title: suggestion.title,
            },
          });
          return;
        }
        case "openPager": {
          const longMessage = findLastLongMessage(messages, PAGER_LINE_THRESHOLD);
          if (!longMessage) {
            dispatch({
              type: "INJECT_NOTIFICATION",
              notification: {
                id: `pager-empty-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
                type: "tui:pager",
                variant: "info",
                message: "No long message available for pager.",
                timestamp: new Date().toISOString(),
              },
            });
            return;
          }
          dispatch({
            type: "OPEN_PAGER",
            pager: {
              title: longMessage.role === "gordon" ? "Gordon Response" : "Conversation Message",
              content: longMessage.content,
            },
          });
          return;
        }
        case "toggleAutoMode":
        case "toggleStrictMode": {
          const mode = action === "toggleAutoMode" ? ("auto" as const) : ("strict" as const);
          // FSM verdict at the call site so the rejection message renders even
          // though the reducer backstop would also block the transition.
          const snapshot = getState();
          const verdict = evaluatePermissionModeTransition({
            from: snapshot.permissionMode,
            to: mode,
            pendingApprovals: snapshot.pendingApprovals.length,
            isStreaming: snapshot.isStreaming,
          });
          if (!verdict.allowed) {
            dispatch({
              type: "ADD_MESSAGE",
              message: {
                id: `mode-blocked-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
                role: "system" as const,
                variant: "error" as const,
                content: verdict.reason ?? `Cannot switch permission mode to ${mode}.`,
                timestamp: new Date().toISOString(),
              },
            });
            return;
          }
          dispatch({ type: "SET_PERMISSION_MODE", mode });
          return;
        }
        case "exit":
          exit();
          return;
        // Other actions handled by PromptInput or scroll components
        default:
          break;
      }
    }

    // Fallback: Ctrl+C always works even if keybindings fail
    if (key.ctrl && input === "c") {
      ctrlC.onPress();
      return;
    }
    return false;
  }, { id: "global-keys", priority: FOCUS_PRIORITY.GLOBAL_GUARD });

  // ── Handlers ──
  const handleSubmit = useCallback(
    (value: string) => {
      const trimmed = value.trim();
      if (!trimmed) return;
      setLastUserInput(trimmed);
      if (isStreaming) {
        // Gordon is busy — enqueue instead of dropping. Drained on idle.
        defaultMessageQueue.enqueue({
          text: trimmed,
          priority: "next",
          enqueuedAt: Date.now(),
          source: "cli",
        });
        return;
      }

      dispatch({ type: "SET_SHOW_HELP", show: false });

      // Record slash-command usage for frecency ordering (palette + typeahead).
      if (trimmed.startsWith("/")) {
        const commandName = trimmed.slice(1).split(/\s+/)[0]?.toLowerCase();
        if (commandName) recordCommandUsage(commandName, true, 0);
      }

      // ─��� Injection defense: check input BEFORE it reaches the agent ──
      const injectionCheck = checkForInjection(trimmed);
      if (injectionCheck.shouldBlock) {
        dispatch({
          type: "ADD_MESSAGE",
          message: {
            id: `injection-block-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
            role: "system",
            variant: "error" as any,
            content: `\u26D4 Input blocked: ${injectionCheck.reason}`,
            timestamp: new Date().toISOString(),
          },
        });
        return;
      }

      // ── Phase 15-18 slash commands ──
      if (trimmed === "/model" || trimmed === "/m" || trimmed === "/provider") {
        setShowModelPicker(true);
        return;
      }
      if (trimmed === "/theme") {
        setShowThemePicker(true);
        return;
      }
      if (trimmed === "/exchange") {
        setShowExchangePicker(true);
        return;
      }
      if (trimmed === "/broker") {
        setShowBrokerPicker(true);
        return;
      }
      if (trimmed === "/doctor") {
        setShowDoctor(true);
        return;
      }
      if (trimmed === "/help" || trimmed === "/h" || trimmed === "/commands") {
        setShowHelpBrowser(true);
        return;
      }
      if (trimmed === "/config") {
        setShowConfigEditor(true);
        return;
      }
      if (trimmed === "/threads" || trimmed === "/sessions-list" || trimmed === "/resume") {
        setShowThreadBrowser(true);
        return;
      }
      if (trimmed === "/journal" || trimmed === "/trades") {
        setShowJournal(true);
        return;
      }
      if (trimmed === "/shortcuts" || trimmed === "/keys") {
        setShowShortcuts(true);
        return;
      }
      if (trimmed === "/runtime-approvals" || trimmed === "/approvals") {
        setShowApprovalBrowser(true);
        return;
      }
      if (trimmed === "/mcp" || trimmed === "/plugins") {
        setShowMCPManager(true);
        return;
      }
      if (trimmed === "/marketplace" || trimmed === "/market" || trimmed === "/store") {
        setShowMarketplace(true);
        return;
      }
      if (trimmed === "/cli" || trimmed === "/tools") {
        setShowCLIBrowser(true);
        return;
      }
      // /model <alias>, /exchange <subcommand>, etc. with args → falls through to handlers
      if (trimmed === "/settings") {
        setShowSettings(true);
        return;
      }
      if (trimmed === "/export") {
        setShowExport(true);
        return;
      }
      if (trimmed === "/emergency" || trimmed === "/halt") {
        setShowEmergency(true);
        return;
      }
      if (trimmed === "/context") {
        setShowContext(true);
        return;
      }
      if (trimmed === "/sessions") {
        setShowSessions(true);
        return;
      }
      if (trimmed === "/memory") {
        setShowMemory(true);
        return;
      }
      if (trimmed === "/privacy") {
        setPrivacyMode((prev) => !prev);
        return;
      }

      // ── Backend module slash commands ──
      if (trimmed === "/audit") {
        setShowAudit(true);
        return;
      }
      if (trimmed === "/scheduler") {
        setShowScheduler(true);
        return;
      }
      if (trimmed === "/playbooks") {
        setShowPlaybooks(true);
        return;
      }
      if (trimmed === "/strategies-browser") {
        setShowStrategies(true);
        return;
      }
      if (trimmed === "/indicators") {
        setShowIndicators(true);
        return;
      }
      if (trimmed === "/orderbook") {
        setShowOrderbook(true);
        return;
      }
      if (trimmed === "/autonomous") {
        setShowAutonomous(true);
        return;
      }
      if (trimmed === "/skills") {
        setShowSkills(true);
        return;
      }
      if (trimmed === "/constitution") {
        setShowConstitution(true);
        return;
      }
      if (trimmed === "/injection-defense") {
        setShowInjectionDefense(true);
        return;
      }
      if (trimmed === "/data-health") {
        setShowDataHealth(true);
        return;
      }
      if (trimmed === "/risk-config") {
        setShowRiskConfig(true);
        return;
      }
      if (trimmed === "/defi") {
        setShowDefi(true);
        return;
      }
      if (trimmed === "/market-overview") {
        setShowMarketOverview(true);
        return;
      }
      if (trimmed === "/regime") {
        setShowRegime(true);
        return;
      }
      if (trimmed === "/stats") {
        setShowStats(true);
        return;
      }
      if (trimmed === "/search") {
        setShowGlobalSearch(true);
        return;
      }
      if (trimmed === "/exit") {
        setShowExitFlow(true);
        return;
      }
      if (trimmed === "/backtest-wizard") {
        setShowBacktestWizard(true);
        return;
      }
      if (trimmed === "/broker-manager") {
        setShowBrokerManager(true);
        return;
      }
      if (trimmed === "/exchange-manager") {
        setShowExchangeManager(true);
        return;
      }
      if (trimmed === "/evolve" || trimmed === "/genome") {
        setShowGenomeEvolution(true);
        return;
      }
      if (trimmed === "/history-search") {
        setShowHistorySearch(true);
        return;
      }
      if (trimmed === "/indicator-detail") {
        setShowIndicatorValue(true);
        return;
      }
      if (trimmed === "/insights") {
        setShowInsights(true);
        return;
      }
      if (trimmed === "/market-pulse") {
        setShowMarketPulse(true);
        return;
      }
      if (trimmed === "/select-message") {
        setShowMessageSelector(true);
        return;
      }
      if (trimmed === "/optimization") {
        setShowOptimization(true);
        return;
      }
      if (trimmed === "/plan-editor") {
        setShowPlanEditor(true);
        return;
      }
      if (trimmed === "/plugins") {
        setShowPlugins(true);
        return;
      }
      if (trimmed === "/quick-open") {
        setShowQuickOpen(true);
        return;
      }
      if (trimmed === "/reconciliation") {
        setShowReconciliation(true);
        return;
      }
      if (trimmed === "/task-deps") {
        setShowTaskDeps(true);
        return;
      }
      if (trimmed === "/walk-forward") {
        setShowWalkForward(true);
        return;
      }
      // HIP-3 builder-perp browser (Hyperliquid stocks/commodities/indices)
      if (trimmed === "/hip3" || trimmed === "/hyperliquid-perps" || trimmed === "/builder-perps") {
        setShowHIP3(true);
        return;
      }
      // Review last closed trade — fallback when no trade:closed has been observed this session
      if (trimmed === "/review-trade" || trimmed === "/whatif" || trimmed === "/counterfactual") {
        if (!counterfactual) {
          dispatch({
            type: "ADD_MESSAGE",
            message: {
              id: `review-trade-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
              role: "system",
              content: "No closed trade observed this session. Run a trade first, or close one to see what-if analysis.",
              timestamp: new Date().toISOString(),
            },
          });
        } else {
          // Re-open the auto-populated overlay
          setCounterfactual({ ...counterfactual });
        }
        return;
      }
      // Debate viewer — manual open; no debate:* events on the bus, so show empty state if none captured
      if (trimmed === "/debate" || trimmed === "/deliberation" || trimmed === "/debate-view") {
        if (!debateView) {
          dispatch({
            type: "ADD_MESSAGE",
            message: {
              id: `debate-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
              role: "system",
              content: "No debate captured yet. Debate view will populate once a multi-agent deliberation runs.",
              timestamp: new Date().toISOString(),
            },
          });
        } else {
          setDebateView({ ...debateView });
        }
        return;
      }

      // ── /perf — performance monitor (Phase 5 reconciler diagnostics) ──
      if (trimmed === "/perf" || trimmed.startsWith("/perf ")) {
        const sub = (trimmed.split(/\s+/)[1] ?? "report").toLowerCase();
        const arg = trimmed.split(/\s+/).slice(2).join(" ").trim();
        const monitor = getPerformanceMonitor();
        let body = "";
        if (sub === "start") {
          const path = arg || `/tmp/gordon-perf-${Date.now()}.jsonl`;
          if (monitor.isRunning()) {
            body = `Performance monitor already running. Log: ${monitor.getFlushPath() ?? "(none)"}\nUse /perf stop first to switch paths.`;
          } else {
            installStdoutTap(monitor);
            monitor.start({ flushPath: path });
            body = `Performance monitor started.\nLog: ${path}\nUse /perf report for inline summary, /perf stop to flush + finalize.`;
          }
        } else if (sub === "stop") {
          if (!monitor.isRunning()) {
            body = "Performance monitor is not running.";
          } else {
            const snap = monitor.snapshot();
            const flushPath = monitor.getFlushPath();
            monitor.stop();
            body = formatPerfSnapshot(snap, flushPath, "stopped", getRenderBudgetBreachCount());
          }
        } else if (sub === "report") {
          const snap = monitor.snapshot();
          body = formatPerfSnapshot(snap, monitor.getFlushPath(), monitor.isRunning() ? "running" : "idle", getRenderBudgetBreachCount());
        } else {
          body = "Usage: /perf [start [path] | stop | report]";
        }
        dispatch({
          type: "ADD_MESSAGE",
          message: {
            id: `perf-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
            role: "system",
            content: body,
            timestamp: new Date().toISOString(),
          },
        });
        return;
      }

      // ── /labs — experimental flag manager ──
      if (trimmed === "/labs" || trimmed === "/experiments" || trimmed === "/flags") {
        setShowLabs(true);
        return;
      }

      const userMsg: Message = {
        id: `user-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        role: "user",
        content: trimmed,
        timestamp: new Date().toISOString(),
      };
      // Wire: record input to session history for Ctrl+R browsing
      try {
        const { recordInput } = require("./history/sessionHistory.js") as typeof import("./history/sessionHistory.js");
        recordInput(trimmed, `session_${Date.now()}`);
      } catch { /* non-critical */ }
      dispatch({ type: "ADD_MESSAGE", message: userMsg });
      handleInput(trimmed, stateUpdater);
    },
    [isStreaming, dispatch, stateUpdater, recordCommandUsage],
  );
  submitRef.current = handleSubmit;

  // Drain queued user inputs when Gordon transitions from busy → idle.
  // Messages typed while streaming get batched and re-submitted here.
  //
  // The dequeue happens INSIDE the timer, and the effect depends only on
  // isStreaming (re-submit goes through submitRef, not handleSubmit's identity).
  // The previous version dequeued synchronously then deferred the submit 50ms
  // with handleSubmit in the deps — any re-render in that window changed
  // handleSubmit's identity, re-ran the effect, and its cleanup cleared the
  // timer while the queue was already drained, silently dropping the message.
  useEffect(() => {
    if (isStreaming) return;
    if (defaultMessageQueue.isEmpty()) return;
    const timer = setTimeout(() => {
      if (defaultMessageQueue.isEmpty()) return;
      const drained = defaultMessageQueue.dequeueAll();
      const combined = drained.map((m) => m.text).join("\n\n");
      submitRef.current(combined);
    }, 50);
    return () => clearTimeout(timer);
  }, [isStreaming]);

  // Leave a persistent "thought for Xs" marker when a turn completes — the live
  // spinner shows the time while thinking, this preserves it in the transcript
  // (mirrors Claude Code's "Baked for Xs"). Sub-2s turns are skipped to avoid
  // clutter on quick replies.
  const thinkStartRef = React.useRef<number | null>(null);
  useEffect(() => {
    if (isStreaming) {
      thinkStartRef.current = Date.now();
      return;
    }
    const startedAt = thinkStartRef.current;
    thinkStartRef.current = null;
    if (startedAt == null) return;
    const durationSec = (Date.now() - startedAt) / 1000;
    if (durationSec < 2) return;
    dispatch({
      type: "ADD_MESSAGE",
      message: {
        id: `thought-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        role: "system",
        variant: "compact" as any,
        content: `thought for ${formatElapsed(durationSec)}`,
        timestamp: new Date().toISOString(),
      },
    });
  }, [isStreaming, dispatch]);

  // Wire: terminal tab — update tab title/badge/color based on Gordon state.
  useEffect(() => {
    updateTerminalTab({
      activity: isStreaming ? "streaming" : "idle",
      permissionMode: permissionMode ?? "ask",
    });
  }, [isStreaming, permissionMode]);

  // Restore the tab name only when the TUI actually exits — not on every
  // activity/permission change, which flickered the title to "Terminal".
  useEffect(() => () => { resetTerminalTab(); }, []);

  useEffect(() => {
    if (!useAltScreen || activeOverlayView === null) return;
    enterAltScreen();
    return () => {
      leaveAltScreen();
    };
  }, [useAltScreen, activeOverlayView]);

  // Wire: pause animations when not streaming (user is reading, save CPU).
  useEffect(() => {
    if (isStreaming) resumeAnimations();
    else pauseAnimations();
  }, [isStreaming, pauseAnimations, resumeAnimations]);

  // Wire: log FPS warning if TUI is lagging
  useEffect(() => {
    if (fpsMetrics.isLagging) {
      console.warn(`[gordon] TUI lagging: ${fpsMetrics.avgFps}fps avg, ${fpsMetrics.droppedFrames} dropped`);
    }
  }, [fpsMetrics.isLagging, fpsMetrics.avgFps, fpsMetrics.droppedFrames]);

  const handlePaletteSelect = useCallback(
    (item: PaletteItem) => {
      dispatch({ type: "SET_SHOW_PALETTE", show: false });
      handleSubmit(item.label);
    },
    [dispatch, handleSubmit],
  );

  const handleApproval = useCallback(
    (decision: "always" | "once" | "deny" | "modify", id: string) => {
      handleApprovalDecision(
        decision,
        id,
        stateUpdater,
        pendingApprovals.find((a) => a.id === id),
      );
    },
    [stateUpdater, pendingApprovals],
  );

  // ── Emergency halt confirm ──
  const handleEmergencyConfirm = useCallback(() => {
    setShowEmergency(false);
    dispatch({
      type: "ADD_MESSAGE",
      message: {
        id: `emergency-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        role: "system",
        variant: "error" as MessageVariant,
        content: "EMERGENCY HALT executed. All positions closed, all orders cancelled.",
        timestamp: new Date().toISOString(),
      },
    });
  }, [dispatch]);

  // ── Session resume ──
  const handleSessionSelect = useCallback(
    (selectedSessionId: string) => {
      setShowSessions(false);
      dispatch({
        type: "ADD_MESSAGE",
        message: {
          id: `session-resume-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          role: "system",
          content: `Resuming session ${selectedSessionId}...`,
          timestamp: new Date().toISOString(),
        },
      });
    },
    [dispatch],
  );

  // ── Feedback handlers ──
  const handleFeedbackComplete = useCallback(() => {
    setShowFeedback(false);
    setFeedbackTradeData(null);
  }, []);

  // Must precede every conditional return below — a hook after an early
  // return crashes React ("rendered more hooks") when the condition flips.
  const placeholder = React.useMemo(() => (
    isStreaming
      ? ""
      : ctrlC.isPending
        ? "Press Ctrl+C again to exit"
        : !runtimeReady
          ? "Initializing..."
          : pendingApprovals.length > 0
            ? `${pendingApprovals.length} approval(s) pending — approve <id> or deny <id>`
            : messages.length === 0
              ? EXAMPLE_PROMPTS[exampleIdx % EXAMPLE_PROMPTS.length]!
              : ""
  ), [isStreaming, ctrlC.isPending, runtimeReady, pendingApprovals.length, messages.length, exampleIdx]);

  // ── Skip boot screen — go straight to chat ──
  if (bootPhase === "boot") {
    // Auto-advance to ready immediately
    setTimeout(() => dispatch({ type: "SET_BOOT_PHASE", phase: "ready" }), 0);
    return null;
  }

  // ── Privacy consent gate (first run only) ──
  if (needsPrivacyConsent === true) {
    return (
      <PrivacyConsent
        onComplete={async (choices: PrivacyChoices) => {
          try {
            const fs = await import("node:fs");
            const path = await import("node:path");
            const cryptoMod = await import("node:crypto");
            const { GORDON_DIR } = await import("../infra/storage/paths.ts");
            const telemetryStateFile = path.join(GORDON_DIR, ".telemetry");

            // Read existing state to preserve anonymousId/salt
            let state: { enabled?: boolean; anonymousId?: string; salt?: string; notifiedAt?: number | null } = {};
            if (fs.existsSync(telemetryStateFile)) {
              try {
                state = JSON.parse(fs.readFileSync(telemetryStateFile, "utf-8"));
              } catch {
                // fall through and create fresh
              }
            }
            if (!state.anonymousId) state.anonymousId = cryptoMod.randomBytes(16).toString("hex");
            if (!state.salt) state.salt = cryptoMod.randomBytes(16).toString("hex");
            state.enabled = choices.telemetryEnabled;
            state.notifiedAt = Date.now();

            fs.mkdirSync(GORDON_DIR, { recursive: true });
            fs.writeFileSync(telemetryStateFile, JSON.stringify(state, null, 2), "utf-8");

            // Persist research data choice into config.json
            const { loadConfig, saveConfig } = await import("../infra/storage/config/config.ts");
            const config = await loadConfig();
            if (!config.telemetry) config.telemetry = { enabled: false, researchData: false };
            config.telemetry.enabled = choices.telemetryEnabled;
            config.telemetry.researchData = choices.researchDataEnabled;
            await saveConfig(config);
          } catch {
            // Non-fatal — continue into Gordon even if persist failed
          }
          setNeedsPrivacyConsent(false);
        }}
      />
    );
  }

  // ── Setup wizard ──
  if (showSetup) {
    return (
      <SetupWizard
        preflight={setupPreflight}
        onComplete={(data) => {
          // Persist everything the wizard collected: LLM key → ~/.gordon/.env,
          // exchange/broker → config.json + ~/.gordon/.env env vars.
          void (async () => {
            const summary: string[] = [];
            const errors: string[] = [];

            // ── 1. LLM provider key ───────────────────────────────────────
            const provider = data.llmProvider;
            const llmKey = data.llmKey?.trim();
            if (provider && llmKey) {
              const envVarByProvider: Record<string, string> = {
                openai: "OPENAI_API_KEY",
                anthropic: "ANTHROPIC_API_KEY",
                google: "GOOGLE_API_KEY",
                xai: "XAI_API_KEY",
                openrouter: "OPENROUTER_API_KEY",
                huggingface: "HF_TOKEN",
                groq: "GROQ_API_KEY",
              };
              const envVar = envVarByProvider[provider];
              if (envVar) {
                try {
                  await saveEnvKeys({ [envVar]: llmKey } as Record<string, string>);
                  process.env[envVar] = llmKey;
                  providerRegistry.reset();
                  summary.push(`${provider} key saved`);
                } catch (err) {
                  errors.push(`LLM key save failed: ${err instanceof Error ? err.message : String(err)}`);
                }
              }
            }

            // ── 2. Exchange + credentials ────────────────────────────────
            const exchangeRaw = data.exchange;
            const exchangeConflict = data.exchangeConflictAction;
            if (
              exchangeRaw &&
              exchangeRaw !== "skip" &&
              exchangeConflict !== "skip"
            ) {
              // Resolve base type and sandbox flag from wizard selection
              // (sandbox variants: "binance-testnet", "coinbase-sandbox", etc.)
              const isSandboxSetup =
                exchangeRaw.includes("-testnet") ||
                exchangeRaw.includes("-sandbox") ||
                exchangeRaw.includes("-demo");
              const exchangeType = normalizeExchangeId(
                isSandboxSetup ? exchangeRaw.split("-")[0]! : exchangeRaw,
              );
              const suggestedId = isSandboxSetup ? exchangeRaw : exchangeType;

              try {
                const config = await loadConfig();
                const apiKey = data.exchangeApiKey?.trim() ?? "";
                const apiSecret = data.exchangeApiSecret?.trim() ?? "";
                const passphrase = data.exchangePassphrase?.trim();
                const walletKey = data.exchangeWalletKey?.trim();
                const isWalletBased = exchangeType === "ccxt:hyperliquid";

                // Conflict resolution: update existing entry in place when
                // the user asked to update, rather than creating a duplicate.
                const existing = config.exchanges.find((e) => e.type === exchangeType && e.sandbox === isSandboxSetup);
                let exchangeId: string;
                if (existing && exchangeConflict === "update") {
                  existing.apiKey = isWalletBased ? "" : apiKey;
                  existing.apiSecret = isWalletBased ? "" : apiSecret;
                  if (passphrase) existing.passphrase = passphrase;
                  if (walletKey) existing.walletPrivateKey = walletKey;
                  exchangeId = existing.id;
                  summary.push(`${exchangeType}${isSandboxSetup ? " (sandbox)" : ""} credentials updated`);
                } else {
                  // Fresh add OR user chose "add as second account"
                  exchangeId = suggestedId;
                  let counter = 1;
                  while (config.exchanges.some((e) => e.id === exchangeId)) {
                    exchangeId = `${suggestedId}-${counter++}`;
                  }
                  config.exchanges.push({
                    id: exchangeId,
                    type: exchangeType as ExchangeType,
                    apiKey: isWalletBased ? "" : apiKey,
                    apiSecret: isWalletBased ? "" : apiSecret,
                    sandbox: isSandboxSetup,
                    isDefault: config.exchanges.length === 0,
                    ...(passphrase ? { passphrase } : {}),
                    ...(walletKey ? { walletPrivateKey: walletKey } : {}),
                  });
                  summary.push(`${exchangeType}${isSandboxSetup ? " (sandbox)" : ""} connected as '${exchangeId}'`);
                }
                if (!config.activeExchangeId) config.activeExchangeId = exchangeId;
                await saveConfig(config);

                // Also write the credentials to ~/.gordon/.env so the
                // exchange client factories can restore them from env.
                const envUpdates: Record<string, string> = {};
                const subId = extractCcxtSubId(exchangeType);
                const ccxtEnv = ccxtEnvNames(subId);
                const nativeVenue = ccxtIdToNativeVenue(exchangeType);
                if (!isWalletBased) {
                  envUpdates[ccxtEnv.key] = apiKey;
                  envUpdates[ccxtEnv.secret] = apiSecret;
                  if (nativeVenue) {
                    const venueEnvPrefix = { binance: "BINANCE", binance_us: "BINANCE_US", coinbase: "COINBASE", kraken: "KRAKEN", bitfinex: "BITFINEX", hyperliquid: "HYPERLIQUID", robinhood: "ROBINHOOD", okx: "OKX", gemini: "GEMINI" } as const;
                    const prefix = venueEnvPrefix[nativeVenue];
                    envUpdates[`${prefix}_API_KEY`] = apiKey;
                    envUpdates[`${prefix}_API_SECRET`] = apiSecret;
                  }
                }
                if (passphrase) envUpdates[ccxtEnv.passphrase] = passphrase;
                if (walletKey) envUpdates[ccxtEnv.walletKey] = walletKey;
                if (Object.keys(envUpdates).length > 0) {
                  await saveEnvKeys(envUpdates as Record<string, string>);
                  for (const [k, v] of Object.entries(envUpdates)) process.env[k] = v;
                }
                // Summary already pushed inside the update/add branches above.
              } catch (err) {
                errors.push(`exchange save failed: ${err instanceof Error ? err.message : String(err)}`);
              }
            }

            // ── 3. Broker + credentials ──────────────────────────────────
            const brokerType = data.broker;
            const brokerConflict = data.brokerConflictAction;
            if (
              brokerType &&
              brokerType !== "skip" &&
              brokerConflict !== "skip"
            ) {
              try {
                const config = await loadConfig();
                const apiKey = data.brokerApiKey?.trim() ?? "";
                const apiSecret = data.brokerApiSecret?.trim() ?? "";
                const paper = data.brokerPaper !== "live";

                const existing = config.brokers.find((b) => b.type === brokerType);
                let brokerId: string;
                if (existing && brokerConflict === "update") {
                  existing.apiKey = apiKey;
                  existing.apiSecret = apiSecret;
                  existing.paper = paper;
                  brokerId = existing.id;
                  summary.push(`${brokerType} credentials updated (${paper ? "paper" : "live"})`);
                } else {
                  brokerId = brokerType;
                  let counter = 1;
                  while (config.brokers.some((b) => b.id === brokerId)) {
                    brokerId = `${brokerType}_${counter++}`;
                  }
                  config.brokers.push({
                    id: brokerId,
                    type: brokerType as "alpaca" | "tastytrade" | "ibkr",
                    apiKey,
                    apiSecret,
                    isDefault: config.brokers.length === 0,
                    paper,
                  });
                  summary.push(`${brokerType} connected (${paper ? "paper" : "live"})`);
                }
                if (!config.activeBrokerId) config.activeBrokerId = brokerId;
                await saveConfig(config);

                const upperType = brokerType.toUpperCase();
                await saveEnvKeys({
                  [`${upperType}_API_KEY`]: apiKey,
                  [`${upperType}_API_SECRET`]: apiSecret,
                  [`${upperType}_PAPER`]: paper ? "true" : "false",
                } as Record<string, string>);
                process.env[`${upperType}_API_KEY`] = apiKey;
                process.env[`${upperType}_API_SECRET`] = apiSecret;
                process.env[`${upperType}_PAPER`] = paper ? "true" : "false";
              } catch (err) {
                errors.push(`broker save failed: ${err instanceof Error ? err.message : String(err)}`);
              }
            }

            // ── 4. Permission mode ───────────────────────────────────────
            if (data.permissionMode) {
              try {
                const config = await loadConfig();
                config.permissionMode = data.permissionMode as "auto" | "ask" | "strict" | "paper" | "observe" | "plan";
                await saveConfig(config);
                summary.push(`permissionMode=${data.permissionMode}`);
              } catch {
                // non-critical
              }
            }

            // Force the runtime to re-resolve context on the next tool call
            // so the newly saved exchange / broker / LLM actually get used
            // without requiring a Gordon restart.
            await refreshRuntimeCredentials();

            dispatch({ type: "SET_SHOW_SETUP", show: false });
            const content =
              errors.length > 0
                ? `Setup finished with issues:\n  ${errors.join("\n  ")}\n\nSaved: ${summary.join(", ") || "nothing"}`
                : `Setup complete — ${summary.join(", ") || "no changes"}. Try /scan to see what's moving.`;
            dispatch({
              type: "ADD_MESSAGE",
              message: {
                id: `setup-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
                role: "system",
                content,
                timestamp: new Date().toISOString(),
              },
            });
          })();
        }}
        onSkip={() => dispatch({ type: "SET_SHOW_SETUP", show: false })}
      />
    );
  }

  if (showFirstTradeTour) {
    return (
      <FirstTradeTour
        permissionMode={permissionMode ?? "ask"}
        onDone={() => {
          markFirstTradeTourDone();
          dispatch({ type: "SET_SHOW_FIRST_TRADE_TOUR", show: false });
        }}
      />
    );
  }

  if (activeOverlayView === "tradeQueue") {
    return (
      <TradeQueueView
        pendingApprovals={pendingApprovals}
        permissionMode={permissionMode ?? "ask"}
        onApprovalDecision={handleApproval}
        onRadarAction={handleSubmit}
        onClose={() => dispatch({ type: "CLOSE_OVERLAY_VIEW" })}
      />
    );
  }

  if (activeOverlayView === "safety") {
    return (
      <SafetyDashboardView
        permissionMode={permissionMode ?? "ask"}
        onClose={() => dispatch({ type: "CLOSE_OVERLAY_VIEW" })}
      />
    );
  }

  // ── Model picker (interactive provider → model selector) ──
  if (showModelPicker) {
    return (
      <ModelPicker
        currentProvider={(getState() as any).modelProvider ?? "openai"}
        currentModel={(getState() as any).modelName ?? "default"}
        onSelect={async (provider, model) => {
          try {
            const { loadConfig: lc, saveConfig: sc } = await import("../infra/storage/config/config.ts");
            const cfg = await lc();
            await sc({ ...cfg, modelConfig: { ...cfg.modelConfig, provider: provider as any, model } });
            // Update env vars so resolveRuntimeModel() picks up the change
            process.env.GORDON_PROVIDER = provider;
            if (model) process.env.GORDON_MODEL = model;
            // Reset agent cache so the agent gets recreated with the new model
            const { resetAgents } = await import("../infra/agents/agents.ts");
            resetAgents();
          } catch { /* best-effort */ }
          dispatch({
            type: "ADD_MESSAGE",
            message: {
              id: `model-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
              role: "system",
              content: `Model changed to ${provider}${model ? ` / ${model}` : " (default)"}. Takes effect on next message.`,
              timestamp: new Date().toISOString(),
            },
          });
          setShowModelPicker(false);
        }}
        onCancel={() => setShowModelPicker(false)}
      />
    );
  }

  // ── Interactive dialogs (Claude Code pattern: full-screen replacement) ──

  if (showThemePicker) {
    return <ThemePicker onSelect={async (theme: string) => {
      try { const { loadConfig: lc, saveConfig: sc } = await import("../infra/storage/config/config.ts"); const cfg = await lc(); await sc({ ...cfg, theme } as any); } catch {}
      dispatch({ type: "ADD_MESSAGE", message: { id: `theme-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, role: "system", content: `Theme changed to ${theme}. Restart for full effect.`, timestamp: new Date().toISOString() } });
      setShowThemePicker(false);
    }} onClose={() => setShowThemePicker(false)} />;
  }

  if (showExchangePicker) {
    return <ExchangePicker onComplete={(msg) => {
      dispatch({ type: "ADD_MESSAGE", message: { id: `exchange-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, role: "system", content: msg, timestamp: new Date().toISOString() } });
      setShowExchangePicker(false);
    }} onCancel={() => setShowExchangePicker(false)} />;
  }

  if (showLabs) {
    return <LabsPanel onComplete={(msg) => {
      dispatch({ type: "ADD_MESSAGE", message: { id: `labs-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, role: "system", content: msg, timestamp: new Date().toISOString() } });
      setShowLabs(false);
    }} onCancel={() => setShowLabs(false)} />;
  }

  if (showBrokerPicker) {
    return <BrokerPicker activeBroker={null} configuredBrokers={[]} onComplete={(action, broker, creds) => {
      dispatch({ type: "ADD_MESSAGE", message: { id: `broker-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, role: "system", content: `Broker ${action}: ${broker}${creds ? " (credentials saved)" : ""}`, timestamp: new Date().toISOString() } });
      setShowBrokerPicker(false);
    }} onCancel={() => setShowBrokerPicker(false)} />;
  }

  if (showDoctor) {
    return <DoctorDialog checks={runDoctorChecks()} onRunFix={(cmd) => { setShowDoctor(false); handleSubmit(cmd); }} onCancel={() => setShowDoctor(false)} />;
  }

  if (showHelpBrowser) {
    return <HelpBrowser onRunCommand={(cmd) => { setShowHelpBrowser(false); handleSubmit(cmd); }} onCancel={() => setShowHelpBrowser(false)} />;
  }

  if (showConfigEditor) {
    return <ConfigEditor items={[
      { key: "permissionMode", label: "Permission Mode", category: "Trading", currentValue: permissionMode ?? "ask", type: "select", options: [{ label: "auto", value: "auto" }, { label: "ask", value: "ask" }, { label: "strict", value: "strict" }, { label: "paper", value: "paper" }, { label: "observe", value: "observe" }, { label: "plan", value: "plan" }], description: "How Gordon handles trade execution" },
      { key: "startupBannerMode", label: "Startup Banner", category: "UI", currentValue: "full", type: "select", options: [{ label: "full", value: "full" }, { label: "quiet", value: "quiet" }] },
      { key: "useKeyring", label: "Use Keyring", category: "Security", currentValue: "false", type: "boolean", description: "Store credentials in OS keyring" },
    ]} onSave={async (key, value) => {
      try { const { loadConfig: lc, saveConfig: sc } = await import("../infra/storage/config/config.ts"); const cfg = await lc(); await sc({ ...cfg, [key]: value }); } catch {}
      dispatch({ type: "ADD_MESSAGE", message: { id: `config-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, role: "system", content: `Config updated: ${key} = ${value}`, timestamp: new Date().toISOString() } });
    }} onCancel={() => setShowConfigEditor(false)} />;
  }

  if (showThreadBrowser) {
    return <ThreadBrowser threads={threadList} activeThreadId={threadId} onSwitch={(id) => {
      setShowThreadBrowser(false);
      void (async () => {
        try {
          await switchThread(id);
          const rt = getRuntime();
          if (rt) {
            await rt.resumeSession();
            const transcript = rt.getTranscript();
            dispatch({
              type: "SET_MESSAGES",
              messages: transcript.map((entry, i) => ({
                id: `resumed-${i}-${Date.now()}`,
                role: entry.role === "user" ? "user" as const : "gordon" as const,
                content: entry.content,
                timestamp: entry.timestamp,
              })),
            });
          }
          dispatch({ type: "ADD_MESSAGE", message: { id: `thread-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, role: "system", content: `Resumed conversation ${id}`, timestamp: new Date().toISOString() } });
        } catch {
          dispatch({ type: "ADD_MESSAGE", message: { id: `thread-err-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, role: "system", content: `Could not resume thread ${id}`, timestamp: new Date().toISOString() } });
        }
      })();
    }} onDelete={(id) => {
      dispatch({ type: "ADD_MESSAGE", message: { id: `thread-del-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, role: "system", content: `Thread delete isn't supported yet (${id})`, timestamp: new Date().toISOString() } });
    }} onCancel={() => setShowThreadBrowser(false)} />;
  }

  if (showJournal) {
    return <JournalViewer trades={[]} onCancel={() => setShowJournal(false)} />;
  }

  if (showShortcuts) {
    return <ShortcutsBrowser onCancel={() => setShowShortcuts(false)} />;
  }

  if (showApprovalBrowser) {
    return <ApprovalBrowser pending={[]} recent={[]} onApprove={(id, persist) => {
      handleSubmit(`approve ${id}${persist ? " persist" : ""}`);
      setShowApprovalBrowser(false);
    }} onDeny={(id) => {
      handleSubmit(`deny ${id}`);
      setShowApprovalBrowser(false);
    }} onCancel={() => setShowApprovalBrowser(false)} />;
  }

  if (showMCPManager) {
    return <MCPManager servers={[]} onAdd={(config) => {
      dispatch({ type: "ADD_MESSAGE", message: { id: `mcp-add-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, role: "system", content: `MCP server added: ${config.name} (${config.transport})`, timestamp: new Date().toISOString() } });
      setShowMCPManager(false);
    }} onRemove={(id) => {
      dispatch({ type: "ADD_MESSAGE", message: { id: `mcp-rm-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, role: "system", content: `MCP server removed: ${id}`, timestamp: new Date().toISOString() } });
    }} onReconnect={(id) => {
      dispatch({ type: "ADD_MESSAGE", message: { id: `mcp-rc-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, role: "system", content: `Reconnecting MCP server: ${id}`, timestamp: new Date().toISOString() } });
    }} onCancel={() => setShowMCPManager(false)} />;
  }

  if (showMarketplace) {
    return <MarketplaceBrowser plugins={[]} onInstall={(pluginId, cmd) => {
      dispatch({ type: "ADD_MESSAGE", message: { id: `mkt-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, role: "system", content: `Installing ${pluginId}...\nRun: ${cmd}`, timestamp: new Date().toISOString() } });
      setShowMarketplace(false);
    }} onCancel={() => setShowMarketplace(false)} />;
  }

  if (showCLIBrowser) {
    return <CLIBrowser tools={[]} onInstall={(toolId, cmd) => {
      dispatch({ type: "ADD_MESSAGE", message: { id: `cli-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, role: "system", content: `Install ${toolId}:\n${cmd}`, timestamp: new Date().toISOString() } });
      setShowCLIBrowser(false);
    }} onCancel={() => setShowCLIBrowser(false)} />;
  }

  // HIP-3 asset browser — full-screen picker like ExchangePicker
  if (showHIP3) {
    return <HIP3AssetBrowser
      onSelect={(req) => {
        dispatch({ type: "ADD_MESSAGE", message: { id: `hip3-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, role: "system", content: `HIP-3 selected: ${req.symbol} @ $${req.price.toFixed(2)} · ${req.builder}/${req.collateral} · ${req.maxLeverage}x`, timestamp: new Date().toISOString() } });
        setShowHIP3(false);
      }}
      onClose={() => setShowHIP3(false)}
    />;
  }

  // ── Placeholder text for PromptInput (Claude Code: rotating example commands) ──
  return (
    <Box flexDirection="column">
      {/* ── Conversation — wrapped in PrivacyScreen ── */}
      <PrivacyScreen active={privacyMode}>
        <Box flexDirection="column" paddingX={1}>
          {modeBanner && !modeBanner.dismissed && (
            <TradingModeBanner
              banner={modeBanner}
              onDismiss={() => dispatch({ type: "DISMISS_MODE_BANNER" })}
            />
          )}

          {/* VML always renders so the boot header (banner + session box) is
              committed to the single Static and survives scroll-up. The live
              preflight box shows below it only at the empty boot state. */}
          <VirtualMessageList
            messages={messages}
            scrollEnabled={!showPalette && !anyDialogOpen}
            header={bootHeaderNode}
          />
          {messages.length === 0 && <BootLivePanel hint={getSessionTip()} />}

          {/* Pending approvals — render only the first one to avoid
              multiple useInput listeners catching the same Enter keypress.
              When the first is decided it leaves the list and the next
              auto-renders. */}
          {pendingApprovals[0] ? (
            <ApprovalDialog
              key={pendingApprovals[0].id}
              approval={pendingApprovals[0]}
              onDecision={handleApproval}
            />
          ) : null}

          {/* Handoff arrows — suppressed. Claude Code doesn't surface
              internal routing ('→ Handing off to gordon') to the user;
              it's noise that breaks the conversational frame. The
              handoff is still recorded in handoffHistory for the
              SwarmTree / AgentProgress views when those are active. */}

          {/* Agent progress (parallel chains) or swarm tree */}
          {isStreaming && activeAgents.length > 0 && (
            swarmMode ? (
              <SwarmTree
                agents={activeAgents.map((c) => ({
                  id: c.id,
                  name: c.agentName,
                  symbol: c.symbol,
                  status:
                    c.status === "running"
                      ? ("running" as const)
                      : c.status === "done"
                        ? ("done" as const)
                        : ("error" as const),
                  duration: c.duration,
                }))}
              />
            ) : (
              <AgentProgress
                chains={activeAgents}
                handoffs={handoffHistory}
                tokenCount={tokenCount}
              />
            )
          )}

          {/* ThinkStep — collapsible, trading-adapted. Shows during thinking, then "analyzed for Xs" on completion */}
          {(isThinking || (isStreaming && streamBuffer && thinkingAgent)) && thinkingAgent && (
            <ThinkStep
              reasoning={activeThinking || `Evaluating with ${thinkingAgent.agentName}...`}
              agentName={thinkingAgent.agentName}
              elapsedMs={thinkingAgent.duration}
              isComplete={!!streamBuffer}
            />
          )}

          {/* Inline tool calls — ● Price BTC/USDT → ⎿ $68,432 */}
          {isStreaming && activeToolCalls.length > 0 && (
            <ToolCallInline calls={activeToolCalls} />
          )}

          {/* Spinner moved out of the conversation flow — it now renders pinned
              just above the StatusLine / input (Claude Code pattern). */}

          {/* Inline help */}
          {showHelp && !isStreaming && <InlineHelp />}

          {/* Ctrl+C pending warning */}
          {ctrlC.isPending && (
            <Box marginTop={1}>
              <Text color="red" bold>
                {permissionMode === "auto"
                  ? "\u26A0 Auto mode. Pending operations will continue. Press Ctrl+C again to exit."
                  : "Press Ctrl+C again to exit."}
              </Text>
            </Box>
          )}

          {/* ── LivePositions — always mounted; self-hides when empty ── */}
          <LivePositions />

          {/* ── Order recovery notice ── */}
          {orderRecovery && (
            <OrderRecoveryNotice
              orderId={orderRecovery.orderId}
              symbol={orderRecovery.symbol}
              reason={orderRecovery.reason}
              attempt={orderRecovery.attempt}
              maxAttempts={orderRecovery.maxAttempts}
              status="retrying"
            />
          )}

          {/* ── Trailing stop display — inline when active ── */}
          {trailingStop && (
            <TrailingStopDisplay
              symbol={trailingStop.symbol}
              currentPrice={trailingStop.currentPrice}
              stopLevel={trailingStop.stopLevel}
              trailAmount={trailingStop.trailAmount}
              side={trailingStop.side}
            />
          )}

          {/* ── Genome diff viewer — inline after mutation events ── */}
          {genomeMutation && (
            <GenomeDiffViewer mutation={genomeMutation} />
          )}
        </Box>
      </PrivacyScreen>

      {/* ── Command palette overlay ── */}
      {showPalette && (
        <CommandPalette
          items={paletteItems}
          workspaceSection={paletteWorkspaceSection}
          frecency={commandFrecency}
          onSelect={handlePaletteSelect}
          onClose={() => dispatch({ type: "SET_SHOW_PALETTE", show: false })}
        />
      )}

      {showResetConfirm && (
        <ResetSessionDialog
          onConfirm={() => performSessionReset(stateUpdater)}
          onCancel={() => dispatch({ type: "SET_SHOW_RESET_CONFIRM", show: false })}
        />
      )}

      {pager && (
        <PagerDialog
          title={pager.title}
          content={pager.content}
          onClose={() => dispatch({ type: "CLOSE_PAGER" })}
        />
      )}

      <DialogHost />

      {/* ── Phase 15-18 dialog overlays ── */}
      {showSettings && (
        <SettingsDialog onClose={() => setShowSettings(false)} />
      )}

      {showExport && (
        <ExportDialog onClose={() => setShowExport(false)} />
      )}

      {showEmergency && (
        <EmergencyHalt
          onConfirm={handleEmergencyConfirm}
          onCancel={() => setShowEmergency(false)}
        />
      )}

      {showContext && (
        <ContextVisualization
          context={{
            activePositions: 0,
            recentSymbols: [],
            loadedStrategies: [],
            contextWindowPercent: Math.round((tokenCount / 128000) * 100),
            memoryFilesLoaded: 0,
          }}
        />
      )}

      {showSessions && (
        <SessionBrowser
          sessions={[]}
          onSelect={handleSessionSelect}
          onClose={() => setShowSessions(false)}
        />
      )}

      {showMemory && (
        <MemorySelector
          onSelect={() => setShowMemory(false)}
        />
      )}

      {showFeedback && feedbackTradeData && (
        <FeedbackSurvey
          tradeId={feedbackTradeData.tradeId}
          symbol={feedbackTradeData.symbol}
          pnl={feedbackTradeData.pnl}
          pnlPercent={feedbackTradeData.pnlPercent}
          onComplete={handleFeedbackComplete}
          onSkip={handleFeedbackComplete}
        />
      )}

      {/* Auto-shown plan revision diff */}
      {planDiff && (
        <PlanDiff previous={planDiff.previous} current={planDiff.current} />
      )}

      {/* Post-trade rating prompt — dismiss on rate or skip */}
      {postTradeFeedback && (
        <PostTradeFeedback
          tradeDescription={postTradeFeedback}
          onRate={() => setPostTradeFeedback(null)}
          onSkip={() => setPostTradeFeedback(null)}
        />
      )}

      {/* Auto-shown counterfactual on trade:closed — dismiss on Esc */}
      {counterfactual && (
        <CounterfactualPanel
          trade={counterfactual.trade}
          scenarios={counterfactual.scenarios}
          onClose={() => setCounterfactual(null)}
        />
      )}

      {/* Debate viewer — manual via /debate. Wrap to handle Esc dismissal since component has no onClose. */}
      {debateView && (
        <DebateViewerOverlay data={debateView} onClose={() => setDebateView(null)} />
      )}

      {/* Elicitation dialog — shown when an agent calls ask_user. Emits agent:elicitation_answered on answer. */}
      {elicitationRequest && (() => {
        const answer = (response: string) => {
          void import("../events/index.ts").then((m) => {
            void m.emitEvent("agent:elicitation_answered", {
              requestId: elicitationRequest.requestId,
              answer: response,
            });
          });
          setElicitationRequest(null);
        };
        const dismiss = () => answer(""); // empty answer signals dismissal
        if (elicitationRequest.kind === "choice" || elicitationRequest.kind === "confirm") {
          const opts = elicitationRequest.kind === "confirm"
            ? ["Yes", "No"]
            : (elicitationRequest.options ?? []).map((o) => o.label);
          const sq: SideQuestion = {
            id: elicitationRequest.requestId,
            question: elicitationRequest.prompt,
            options: opts.length > 0 ? opts : undefined,
            context: "",
            kind: elicitationRequest.kind,
          };
          return <SideQuestionDialog question={sq} onAnswer={answer} onDismiss={dismiss} />;
        }
        // "text" kind → ElicitationDialog with a single text field
        const fields: FormField[] = [
          { id: "answer", label: elicitationRequest.prompt, type: "text", required: true },
        ];
        return (
          <ElicitationDialog
            title="Agent Question"
            fields={fields}
            onSubmit={(values) => answer(String(values.answer ?? ""))}
            onCancel={dismiss}
          />
        );
      })()}

      {/* Rate-limit banner — auto-clears when resetMs elapses */}
      {rateLimit.isThrottled && rateLimit.latestEvent && (
        <Box paddingX={2}>
          <Text color="yellow">
            {"⚠"} Rate limit: {rateLimit.latestEvent.provider} {rateLimit.latestEvent.weight}/{rateLimit.latestEvent.limit}
          </Text>
        </Box>
      )}

      {/* ── Backend module dialog overlays ── */}
      {showAudit && (
        <AuditBrowser entries={[]} onClose={() => setShowAudit(false)} />
      )}

      {showScheduler && (
        <SchedulerPanel
          jobs={[]}
          onPause={() => {}}
          onResume={() => {}}
          onDelete={() => {}}
          onClose={() => setShowScheduler(false)}
        />
      )}

      {showPlaybooks && (
        <PlaybookBrowser
          playbooks={[]}
          onSelect={() => {}}
          onDeploy={() => setShowPlaybooks(false)}
          onClose={() => setShowPlaybooks(false)}
        />
      )}

      {showStrategies && (
        <StrategyBrowser
          strategies={[]}
          onSelect={() => {}}
          onDeploy={() => setShowStrategies(false)}
          onClose={() => setShowStrategies(false)}
        />
      )}

      {showIndicators && (
        <IndicatorDashboard
          symbol="--"
          rsi={50}
          macd={{ value: 0, signal: 0, histogram: 0 }}
          trend={{ direction: "sideways", strength: "moderate" }}
          bollinger={{ upper: 0, middle: 0, lower: 0, price: 0 }}
          volume={{ current: 0, average: 0 }}
        />
      )}

      {showConsensus && (
        <ConsensusView
          signals={[]}
          decision="NEUTRAL"
          confidence={0}
        />
      )}

      {/* ── New panel dialogs ── */}
      {showOrderbook && (
        <OrderbookView symbol="BTC/USDT" bids={[]} asks={[]} spread={0} spreadPercent={0} onClose={() => setShowOrderbook(false)} />
      )}
      {showAutonomous && (
        <AutonomousControlDialog
          isActive={autonomousActive}
          isPaused={false}
          cycleCount={0}
          opportunitiesFound={0}
          intervalMinutes={15}
          onAction={() => {}}
          onClose={() => setShowAutonomous(false)}
        />
      )}
      {showSkills && (
        <SkillExecutionViewer runs={[]} onClose={() => setShowSkills(false)} />
      )}
      {showConstitution && (
        <ConstitutionPanel results={[]} blockedCount={0} passedCount={0} onClose={() => setShowConstitution(false)} />
      )}
      {showInjectionDefense && (
        <InjectionDefensePanel matches={[]} inputBlocked={false} inputText="" onClose={() => setShowInjectionDefense(false)} />
      )}
      {showDataHealth && (
        <DataSourceHealth sources={[]} onClose={() => setShowDataHealth(false)} />
      )}
      {showRiskConfig && (
        <RiskConfigPanel checks={[]} mode={"warn"} onClose={() => setShowRiskConfig(false)} />
      )}
      {showDefi && (
        <DeFiOverviewPanel onClose={() => setShowDefi(false)} />
      )}
      {showMarketOverview && (
        <MarketOverviewPanel marketScore={0} regime="" breakouts={[]} consolidations={[]} whaleAlerts={[]} onClose={() => setShowMarketOverview(false)} />
      )}
      {showRegime && (
        <RegimeStatusPanel regimes={[]} onClose={() => setShowRegime(false)} />
      )}
      {showStats && (
        <StatsDialog stats={{} as any} onClose={() => setShowStats(false)} />
      )}
      {showGlobalSearch && (
        <GlobalSearchDialog onClose={() => setShowGlobalSearch(false)} />
      )}
      {showExitFlow && (
        <ExitFlow
          openPositionCount={0}
          autonomousActive={autonomousActive}
          onSaveAndExit={() => { exit(); }}
          onExitWithoutSave={() => { exit(); }}
          onCancel={() => setShowExitFlow(false)}
        />
      )}

      {/* ── Additional panel dialogs ── */}
      {showBacktestWizard && (
        <BacktestWizard strategies={[]} onRun={() => setShowBacktestWizard(false)} onCancel={() => setShowBacktestWizard(false)} />
      )}
      {showBrokerManager && (
        <BrokerManagerPanel brokers={[]} onClose={() => setShowBrokerManager(false)} />
      )}
      {showExchangeManager && (
        <ExchangeManagerPanel exchanges={[]} onClose={() => setShowExchangeManager(false)} />
      )}
      {showGenomeEvolution && (
        <GenomeEvolutionPanel isRunning={false} generation={0} bestFitness={0} populationSize={0} mutationRate={0} variants={[]} onClose={() => setShowGenomeEvolution(false)} />
      )}
      {showHistorySearch && (
        <HistorySearchDialog entries={messages.map((m) => ({ command: m.content, timestamp: m.timestamp ? Date.parse(m.timestamp) : Date.now() }))} onClose={() => setShowHistorySearch(false)} onSelect={() => setShowHistorySearch(false)} />
      )}
      {showIndicatorValue && (
        <IndicatorValueViewer symbol="" indicators={[]} onClose={() => setShowIndicatorValue(false)} />
      )}
      {showInsights && (
        <InsightBrowser insights={[]} onClose={() => setShowInsights(false)} />
      )}
      {showMarketPulse && (
        <MarketPulsePanel pulses={[]} />
      )}
      {showMessageSelector && (
        <MessageSelector messages={messages as any} onSelect={() => setShowMessageSelector(false)} onClose={() => setShowMessageSelector(false)} />
      )}
      {showOptimization && (
        <OptimizationResults results={[]} param1Name="" param2Name="" onClose={() => setShowOptimization(false)} />
      )}
      {showPlanEditor && (
        <PlanEditor plan={{} as any} onSave={() => setShowPlanEditor(false)} onCancel={() => setShowPlanEditor(false)} onApprove={() => setShowPlanEditor(false)} />
      )}
      {showPlugins && (
        <PluginBrowser plugins={[]} onClose={() => setShowPlugins(false)} />
      )}
      {showQuickOpen && (
        <QuickOpenDialog items={[]} onSelect={() => setShowQuickOpen(false)} onClose={() => setShowQuickOpen(false)} />
      )}
      {showReconciliation && (
        <ReconciliationStatus status="ok" discrepancies={[]} lastRunAt={new Date().toISOString()} nextRunAt={new Date().toISOString()} onClose={() => setShowReconciliation(false)} />
      )}
      {showTaskDeps && (
        <TaskDependencyView tasks={[]} onClose={() => setShowTaskDeps(false)} />
      )}
      {showWalkForward && (
        <WalkForwardResults windows={[]} overallScore={0} onClose={() => setShowWalkForward(false)} />
      )}

      {/* ── DaemonStatus + MarketDataStatus — only show when there's something active ── */}
      {(daemonStatus.status !== "stopped" || marketFeeds.length > 0) && (
        <Box paddingX={1} gap={2}>
          {daemonStatus.status !== "stopped" && (
            <DaemonStatus
              status={daemonStatus.status}
              taskCount={daemonStatus.taskCount}
              uptime={daemonStatus.uptime}
            />
          )}
          {marketFeeds.length > 0 && <MarketDataStatus feeds={marketFeeds as any} />}
        </Box>
      )}

      {/* ── Queued commands notice ── */}
      {isStreaming && queuedCount > 0 && (
        <QueuedCommandsNotice count={queuedCount} />
      )}

      {/* Thinking animation — pinned directly above the status line / input
          (next to the context % readout), Claude Code style, instead of being
          buried in the scrolling conversation. */}
      {isStreaming && !isThinking && (
        <TradingSpinner
          agentName={activeAgentName ?? undefined}
          streamLength={streamBuffer?.length ?? 0}
          userInput={lastUserInput}
          activeToolName={activeToolCalls.find((t) => t.status === "running")?.toolName}
          elapsedMs={elapsedSeconds * 1000}
        />
      )}

      <StatusLine
        memoryUsageRatio={memoryUsageRatio}
        liveContextTokens={liveContextTokens}
        lastTurnDurationMs={lastTurnDurationMs}
        lastTurnTokens={lastTurnTokens}
        autonomousActive={autonomousActive}
        contextLimit={contextLimit}
        permissionMode={permissionMode ?? "ask"}
        killSwitches={killSwitches}
      />

      <RadarFocusBar focus={radarFocus} />

      {/* ── Input area — clean, just the prompt ── */}
      <Box
        borderStyle="round"
        borderColor="gray"
        paddingX={1}
      >
        <PromptInput
          onSubmit={handleSubmit}
          onStop={abortActiveTurn}
          placeholder={placeholder}
          permissionMode={permissionMode ?? "ask"}
          activeAgentCount={activeAgentCount}
          activeAgentName={activeAgentName}
          isStreaming={isStreaming}
          autonomousActive={autonomousActive}
          autonomousStrategyCount={autonomousStrategyCount}
          vimMode={vimModeActive}
          locked={radarFocus !== null}
          commandFrecency={commandFrecency}
          onShowShortcuts={pendingApprovals.length === 0 ? () => setShowShortcuts(true) : undefined}
          onVimModeChange={(mode) => {
            vimModeRef.current = mode;
          }}
        />
      </Box>
    </Box>
  );
}

function coerceWorkspace(value: string | null): WorkspaceId {
  switch (value) {
    case "market":
    case "plan":
    case "lab":
    case "monitor":
    case "desk":
      return value;
    default:
      return "desk";
  }
}

// ============================================================================
// App — Public export wrapped in provider tree
//
// SettingsProvider > MemoryProvider > StatsProvider > NotificationsProvider
// > AppStateProvider > AppInner
// ============================================================================

export function App() {
  return (
    <ThemeProvider>
    <GordonInkUITheme>
    <SettingsProvider>
      <MemoryProvider>
        <StatsProvider>
          <NotificationsProvider>
            <AppStateProvider>
              <InputRouterProvider>
                <AppInner />
              </InputRouterProvider>
            </AppStateProvider>
          </NotificationsProvider>
        </StatsProvider>
      </MemoryProvider>
    </SettingsProvider>
    </GordonInkUITheme>
    </ThemeProvider>
  );
}
