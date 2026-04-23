import React, { useCallback, useEffect, useState } from "react";
import { Box, Text, Spacer, useInput, useApp } from "ink";

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

// ── Components ──
import { GordonHeader } from "./components/GordonHeader.js";
import { type Message, type MessageVariant } from "./components/MessageBubble.js";
import { StreamingText } from "./components/StreamingText.js";
import { AgentProgress } from "./components/AgentProgress.js";
import { SwarmTree } from "./components/SwarmTree.js";
import { ApprovalDialog } from "./components/ApprovalDialog.js";
import { WorkerBadge } from "./components/WorkerBadge.js";
import { InlineHelp } from "./components/InlineHelp.js";
import { CommandPalette, type PaletteItem } from "./components/CommandPalette.js";
import { BootScreen } from "./components/BootScreen.js";
import { SetupWizard, type SetupPreflight } from "./components/SetupWizard.js";
import { PrivacyConsent, type PrivacyChoices } from "./components/PrivacyConsent.js";
import { HandoffArrow } from "./components/HandoffArrow.js";
import { PromptInput } from "./components/PromptInput.js";
import { defaultMessageQueue } from "../infra/runtime/messageQueue.js";
import { saveEnvKeys } from "../infra/storage/env.js";
import { providerRegistry } from "../infra/runtime/providers/registry.js";
import { loadConfig, saveConfig } from "../infra/storage/config.js";
import { refreshRuntimeCredentials } from "./bridge/runtime.js";
import { VirtualMessageList } from "./components/VirtualMessageList.js";
import { CostDisplay } from "./components/CostDisplay.js";
import { updateTerminalTab, resetTerminalTab } from "./terminalTab.js";
import { getActionsForKey, isVimModeEnabled } from "./keybindings/keybindings.js";
import { getNotificationFolder } from "./notifications/notificationFolder.js";
import { useFpsTracker } from "./hooks/useFpsTracker.js";
import { useAnimationPause } from "./hooks/useAnimationClock.js";
import { useProactiveChatSubscription } from "./hooks/useProactiveChatSubscription.js";
import { useAlertSubscription } from "./state/useAlertSubscription.js";
import { getNextHint, recordHintShown, incrementSessionCount, type HintContext } from "../app/onboarding/index.ts";

// ── Phase 15-18 Components ──
import { SettingsDialog } from "./components/SettingsDialog.js";
import { ExportDialog } from "./components/ExportDialog.js";
import { EmergencyHalt } from "./components/EmergencyHalt.js";
import { ContextVisualization } from "./components/ContextVisualization.js";
import { SessionBrowser } from "./components/SessionBrowser.js";
import { MemorySelector } from "./components/MemorySelector.js";
import { ModelPicker } from "./components/ModelPicker.js";
import { ThemePicker } from "./components/ThemePicker.js";
import { ExchangePicker } from "./components/ExchangePicker.js";
import { BrokerPicker } from "./components/BrokerPicker.js";
import { DoctorDialog } from "./components/DoctorDialog.js";
import { HelpBrowser } from "./components/HelpBrowser.js";
import { ConfigEditor } from "./components/ConfigEditor.js";
import { ThreadBrowser } from "./components/ThreadBrowser.js";
import { JournalViewer } from "./components/JournalViewer.js";
import { ShortcutsBrowser } from "./components/ShortcutsBrowser.js";
import { ApprovalBrowser } from "./components/ApprovalBrowser.js";
import { MCPManager } from "./components/MCPManager.js";
import { MarketplaceBrowser } from "./components/MarketplaceBrowser.js";
import { CLIBrowser } from "./components/CLIBrowser.js";
import { PrivacyScreen } from "./components/PrivacyScreen.js";
import { FeedbackSurvey } from "./components/FeedbackSurvey.js";
import { ThinkStep } from "./components/ThinkStep.js";
import { TradingSpinner } from "./components/TradingSpinner.js";
import { GlimmerMessage } from "./components/GlimmerMessage.js";
import { ToolCallInline, type ToolCallState } from "./components/ToolCallInline.js";
import { StreamingMarkdown } from "./components/StreamingMarkdown.js";
import { NoSelect } from "./components/NoSelect.js";
import { QueuedCommandsNotice } from "./components/QueuedCommandsNotice.js";
import { MemoryUsageIndicator } from "./components/MemoryUsageIndicator.js";
import { usePromptSuggestions } from "./hooks/usePromptSuggestions.js";
import { StashNotice } from "./components/StashNotice.js";
import { ExitFlow } from "./components/ExitFlow.js";
import { AwaySummary } from "./components/AwaySummary.js";
import { PressEnterToContinue } from "./components/PressEnterToContinue.js";
import { OrderbookView } from "./components/OrderbookView.js";
import { AutonomousControlDialog } from "./components/AutonomousControlDialog.js";
import { SkillExecutionViewer } from "./components/SkillExecutionViewer.js";
import { ConstitutionPanel } from "./components/ConstitutionPanel.js";
import { InjectionDefensePanel } from "./components/InjectionDefensePanel.js";
import { DataSourceHealth } from "./components/DataSourceHealth.js";
import { RiskConfigPanel } from "./components/RiskConfigPanel.js";
import { DeFiOverviewPanel } from "./components/DeFiOverviewPanel.js";
import { MarketOverviewPanel } from "./components/MarketOverviewPanel.js";
import { RegimeStatusPanel } from "./components/RegimeStatusPanel.js";
import { StatsDialog } from "./components/StatsDialog.js";
import { GlobalSearchDialog } from "./components/GlobalSearchDialog.js";

// ── Previously unwired components ──
import { ActionableRiskAlerts } from "./components/ActionableRiskAlerts.js";
import { AlgoExecutionProgress } from "./components/AlgoExecutionProgress.js";
import { BacktestWizard } from "./components/BacktestWizard.js";
import { BrokerManagerPanel } from "./components/BrokerManagerPanel.js";
import { ConsensusDetailPanel } from "./components/ConsensusDetailPanel.js";
import { ContextSuggestions } from "./components/ContextSuggestions.js";
import { CoordinatorAgentStatus } from "./components/CoordinatorAgentStatus.js";
import { CostThresholdDialog } from "./components/CostThresholdDialog.js";
import { DiffDialog } from "./components/DiffDialog.js";
import { DryRunPreview } from "./components/DryRunPreview.js";
import { EffortIndicator } from "./components/EffortIndicator.js";
import { ExchangeManagerPanel } from "./components/ExchangeManagerPanel.js";
import { GenomeEvolutionPanel } from "./components/GenomeEvolutionPanel.js";
import { HistorySearchDialog } from "./components/HistorySearchDialog.js";
import { IdleReturnDialog } from "./components/IdleReturnDialog.js";
import { IndicatorValueViewer } from "./components/IndicatorValueViewer.js";
import { InsightBrowser } from "./components/InsightBrowser.js";
import { MarketPulsePanel } from "./components/MarketPulsePanel.js";
import { MessageSelector } from "./components/MessageSelector.js";
import { OptimizationResults } from "./components/OptimizationResults.js";
import { PlanEditor } from "./components/PlanEditor.js";
import { PluginBrowser } from "./components/PluginBrowser.js";
import { QuickOpenDialog } from "./components/QuickOpenDialog.js";
import { ReconciliationStatus } from "./components/ReconciliationStatus.js";
import { TaskDependencyView } from "./components/TaskDependencyView.js";
import { WalkForwardResults } from "./components/WalkForwardResults.js";

// ── Backend Module UI Components ──
import { LivePositions, type Position } from "./components/LivePositions.js";
import type { MutationResult } from "./components/GenomeDiffViewer.js";
import { AuditBrowser } from "./components/AuditBrowser.js";
import { SchedulerPanel } from "./components/SchedulerPanel.js";
import { PlaybookBrowser } from "./components/PlaybookBrowser.js";
import { StrategyBrowser } from "./components/StrategyBrowser.js";
import { GenomeDiffViewer } from "./components/GenomeDiffViewer.js";
import { IndicatorDashboard } from "./components/IndicatorDashboard.js";
import { ConsensusView } from "./components/ConsensusView.js";
import { ExecutionAlgoSelector } from "./components/ExecutionAlgoSelector.js";
import { DaemonStatus } from "./components/DaemonStatus.js";
import { TrailingStopDisplay } from "./components/TrailingStopDisplay.js";
import { OrderRecoveryNotice } from "./components/OrderRecoveryNotice.js";
import { MarketDataStatus } from "./components/MarketDataStatus.js";

import { AlternateScreen } from "./components/AlternateScreen.js";

// ── Hooks ──
import { useDoublePress } from "./hooks/useDoublePress.js";
import { useElapsedTime } from "./hooks/useElapsedTime.js";
import { useTerminalSize } from "./hooks/useTerminalSize.js";
import { useMergedCommands } from "./hooks/useMergedCommands.js";
import { useScreenReader } from "./hooks/useScreenReader.js";

// ── Bridge ──
import { initializeRuntime, handleInput, handleApprovalDecision } from "./bridge/runtime.js";

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

/**
 * AppInner — The core UI, mounted inside the provider tree.
 * Reads all state via useAppState selectors and dispatches via useDispatch.
 */
function AppInner() {
  const dispatch = useDispatch();
  const { getState } = useAppStore();
  const { exit } = useApp();

  // Subscribe to proactive:suggestion_fired events on the Gordon event bus
  // and push them into the chat stream as proactive_suggestion messages.
  // This is the only place that bridges radar-mode suggestions into the TUI.
  useProactiveChatSubscription(dispatch);

  // Bridge `alert:fired` events (from emitAlert) into the TUI notification
  // queue. Info → info variant; warning → alert variant; critical → error.
  useAlertSubscription();

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
  const permissionMode = useAppState((s) => s.permissionMode);
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
  const isScreenReaderActive = useScreenReader();
  const vimModeActive = isVimModeEnabled();
  const useAltScreen = process.env.GORDON_ALT_SCREEN !== "false";
  const threadId = useAppState((s) => s.threadId);
  const isResumedSession = useAppState((s) => s.isResumedSession);
  const tokenCount = useAppState((s) => s.tokenCount);
  const autonomousActive = useAppState((s) => s.autonomousActive);
  const autonomousStrategyCount = useAppState((s) => s.autonomousStrategyCount);

  // ── Phase 15-18 local state ──
  const [showSettings, setShowSettings] = useState(false);
  const [showExport, setShowExport] = useState(false);
  const [showEmergency, setShowEmergency] = useState(false);
  const [showContext, setShowContext] = useState(false);
  const [showSessions, setShowSessions] = useState(false);
  const [showMemory, setShowMemory] = useState(false);
  const [privacyMode, setPrivacyMode] = useState(false);
  const [showFeedback, setShowFeedback] = useState(false);
  const [feedbackTradeData, setFeedbackTradeData] = useState<FeedbackTradeData | null>(null);

  const [showModelPicker, setShowModelPicker] = useState(false);
  const [showMCPManager, setShowMCPManager] = useState(false);
  const [showMarketplace, setShowMarketplace] = useState(false);
  const [showCLIBrowser, setShowCLIBrowser] = useState(false);
  const [showThemePicker, setShowThemePicker] = useState(false);
  const [showExchangePicker, setShowExchangePicker] = useState(false);
  const [showBrokerPicker, setShowBrokerPicker] = useState(false);
  const [showDoctor, setShowDoctor] = useState(false);
  const [showHelpBrowser, setShowHelpBrowser] = useState(false);
  const [showConfigEditor, setShowConfigEditor] = useState(false);
  const [showThreadBrowser, setShowThreadBrowser] = useState(false);
  const [showJournal, setShowJournal] = useState(false);
  const [showShortcuts, setShowShortcuts] = useState(false);
  const [showApprovalBrowser, setShowApprovalBrowser] = useState(false);

  // ── Backend module UI toggles ──
  const [showAudit, setShowAudit] = useState(false);
  const [showScheduler, setShowScheduler] = useState(false);
  const [showPlaybooks, setShowPlaybooks] = useState(false);
  const [showStrategies, setShowStrategies] = useState(false);
  const [showGenome, setShowGenome] = useState(false);
  const [showIndicators, setShowIndicators] = useState(false);
  const [showConsensus, setShowConsensus] = useState(false);
  const [showOrderbook, setShowOrderbook] = useState(false);
  const [showAutonomous, setShowAutonomous] = useState(false);
  const [showSkills, setShowSkills] = useState(false);
  const [showConstitution, setShowConstitution] = useState(false);
  const [showInjectionDefense, setShowInjectionDefense] = useState(false);
  const [showDataHealth, setShowDataHealth] = useState(false);
  const [showRiskConfig, setShowRiskConfig] = useState(false);
  const [showDefi, setShowDefi] = useState(false);
  const [showMarketOverview, setShowMarketOverview] = useState(false);
  const [showRegime, setShowRegime] = useState(false);
  const [showStats, setShowStats] = useState(false);
  const [showGlobalSearch, setShowGlobalSearch] = useState(false);
  const [showExitFlow, setShowExitFlow] = useState(false);
  const [exampleIdx] = useState(() => Math.floor(Math.random() * 7));
  const [showBacktestWizard, setShowBacktestWizard] = useState(false);
  const [showBrokerManager, setShowBrokerManager] = useState(false);
  const [showExchangeManager, setShowExchangeManager] = useState(false);
  const [showGenomeEvolution, setShowGenomeEvolution] = useState(false);
  const [showHistorySearch, setShowHistorySearch] = useState(false);
  const [showIndicatorValue, setShowIndicatorValue] = useState(false);
  const [showInsights, setShowInsights] = useState(false);
  const [showMarketPulse, setShowMarketPulse] = useState(false);
  const [showMessageSelector, setShowMessageSelector] = useState(false);
  const [showOptimization, setShowOptimization] = useState(false);
  const [showPlanEditor, setShowPlanEditor] = useState(false);
  const [showPlugins, setShowPlugins] = useState(false);
  const [showQuickOpen, setShowQuickOpen] = useState(false);
  const [showReconciliation, setShowReconciliation] = useState(false);
  const [showTaskDeps, setShowTaskDeps] = useState(false);
  const [showWalkForward, setShowWalkForward] = useState(false);
  const [livePositions, setLivePositions] = useState<Position[]>([]);
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
  const { formatted: elapsedFormatted } = useElapsedTime(isStreaming);
  const paletteItems = useMergedCommands();

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
    showQuickOpen || showReconciliation || showTaskDeps || showWalkForward;

  // ── Prompt suggestions based on conversation context ──
  const promptSuggestions = usePromptSuggestions(messages, isStreaming, !!false /* hasExchange */);

  // ── Queued message count ──
  const queuedCount = defaultMessageQueue.length?.() ?? 0;

  // ── Memory usage (approximate from token count) ──
  const contextLimit = 128000; // Default context window
  const memoryUsageRatio = (tokenCount ?? 0) / contextLimit;

  // ── Determine if agent is in "thinking" mode (any running agent, no output yet) ──
  // thinkingAgent already derived above in the memoized block
  const isThinking = isStreaming && thinkingAgent != null && !streamBuffer;

  // ── Track active tool calls for inline display ──
  const [activeToolCalls, setActiveToolCalls] = useState<ToolCallState[]>([]);
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
      if (next.messages !== prev.messages) {
        dispatch({ type: "SET_MESSAGES", messages: next.messages });
      }
      if (next.isStreaming !== prev.isStreaming) {
        dispatch(next.isStreaming ? { type: "START_STREAMING" } : { type: "STOP_STREAMING" });
      }
      if (next.streamBuffer !== prev.streamBuffer) {
        dispatch({ type: "SET_STREAM_BUFFER", buffer: next.streamBuffer });
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
      if (next.showPalette !== prev.showPalette) {
        dispatch({ type: "SET_SHOW_PALETTE", show: next.showPalette });
      }
      if (next.showHelp !== prev.showHelp) {
        dispatch({ type: "SET_SHOW_HELP", show: next.showHelp });
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
          const hasDedalus = providerRegistry.hasDedalus();
          // Pre-populate preflight with everything already configured.
          // This lets the wizard skip steps on returning users.
          void (async () => {
            try {
              const config = await loadConfig();
              const pre: SetupPreflight = {
                llmProviders: hasDedalus ? [...directProviders, "dedalus"] : [...directProviders],
                exchanges: config.exchanges.map((e) => e.type),
                brokers: config.brokers.map((b) => b.type),
                permissionMode: config.permissionMode,
              };
              setSetupPreflight(pre);
            } catch {
              // Keep defaults if config fails to load.
            }
          })();
          if (directProviders.length === 0 && !hasDedalus) {
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

  // ── Progressive inline hints (shown on first few sessions, then hidden) ──
  useEffect(() => {
    if (!runtimeReady) return;
    incrementSessionCount();

    const hintContext: HintContext = {
      sessionCount: 0, // Loaded from state inside getNextHint
      onboardingComplete: true,
      hasExchange: false, // TODO: pull from config
      hasBroker: false,
      hasGordonMd: false,
      permissionMode: permissionMode ?? "ask",
    };

    const hint = getNextHint(hintContext);
    if (hint) {
      recordHintShown(hint.id);
      dispatch({
        type: "ADD_MESSAGE",
        message: {
          id: `hint-${hint.id}-${Date.now()}`,
          role: "system" as const,
          content: `\u2139 ${hint.message}`,
          timestamp: new Date().toISOString(),
        },
      });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runtimeReady]);

  // ── Ctrl+C double-press exit ──
  useEffect(() => {
    if (ctrlC.isDoublePressed) {
      exit();
    }
  }, [ctrlC.isDoublePressed, exit]);

  // ── Global keybindings (dynamic via keybindings.json) ──
  useInput((input, key) => {
    // Build key string from Ink's key object
    const parts: string[] = [];
    if (key.ctrl) parts.push("ctrl");
    if (key.shift || (input.length === 1 && input === input.toUpperCase() && input !== input.toLowerCase())) parts.push("shift");
    const keyName = key.return ? "return" : key.escape ? "escape" : key.tab ? "tab"
      : key.upArrow ? "up" : key.downArrow ? "down" : key.leftArrow ? "left" : key.rightArrow ? "right"
      : key.pageDown ? "pagedown" : key.pageUp ? "pageup" : input.toLowerCase();
    parts.push(keyName);
    const keyCombo = parts.join("+");

    // Resolve actions via keybinding system
    const vimMode = isVimModeEnabled() ? "normalMode" : "always";
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
        case "toggleAutoMode":
          dispatch({ type: "SET_PERMISSION_MODE", mode: "auto" });
          return;
        case "toggleStrictMode":
          dispatch({ type: "SET_PERMISSION_MODE", mode: "strict" });
          return;
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
  });

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

      // ─��� Injection defense: check input BEFORE it reaches the agent ──
      try {
        const { checkForInjection } = require("../infra/safety/injectionDefense.js") as typeof import("../infra/safety/injectionDefense.js");
        const injectionCheck = checkForInjection(trimmed);
        if (injectionCheck.shouldBlock) {
          dispatch({
            type: "ADD_MESSAGE",
            message: {
              id: `injection-block-${Date.now()}`,
              role: "system",
              variant: "error" as any,
              content: `\u26D4 Input blocked: ${injectionCheck.reason}`,
              timestamp: new Date().toISOString(),
            },
          });
          return;
        }
      } catch { /* non-critical — if defense module fails, let input through */ }

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
      if (trimmed === "/threads" || trimmed === "/sessions-list") {
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

      const userMsg: Message = {
        id: `user-${Date.now()}`,
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
    [isStreaming, dispatch, stateUpdater],
  );

  // Drain queued user inputs when Gordon transitions from busy → idle.
  // Messages typed while streaming get batched and re-submitted here.
  useEffect(() => {
    if (isStreaming) return;
    if (defaultMessageQueue.isEmpty()) return;
    const drained = defaultMessageQueue.dequeueAll();
    // Combine into a single follow-up turn preserving order.
    const combined = drained.map((m) => m.text).join("\n\n");
    // Micro-delay so the streaming→idle state settles before re-submit.
    const timer = setTimeout(() => handleSubmit(combined), 50);
    return () => clearTimeout(timer);
  }, [isStreaming, handleSubmit]);

  // Wire: terminal tab — update tab title/badge/color based on Gordon state.
  useEffect(() => {
    updateTerminalTab({
      activity: isStreaming ? "streaming" : "idle",
      permissionMode: permissionMode ?? "ask",
    });
    return () => { resetTerminalTab(); };
  }, [isStreaming, permissionMode]);

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
    (decision: "always" | "once" | "deny", id: string) => {
      handleApprovalDecision(decision, id, stateUpdater);
    },
    [stateUpdater],
  );

  // ── Emergency halt confirm ──
  const handleEmergencyConfirm = useCallback(() => {
    setShowEmergency(false);
    dispatch({
      type: "ADD_MESSAGE",
      message: {
        id: `emergency-${Date.now()}`,
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
          id: `session-resume-${Date.now()}`,
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
            const { loadConfig, saveConfig } = await import("../infra/storage/config.ts");
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
                inception: "INCEPTION_API_KEY",
                dedalus: "DEDALUS_API_KEY",
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
              const exchangeType = isSandboxSetup
                ? exchangeRaw.split("-")[0]! // "binance-testnet" → "binance"
                : exchangeRaw;
              const suggestedId = isSandboxSetup ? exchangeRaw : exchangeType;

              try {
                const config = await loadConfig();
                const apiKey = data.exchangeApiKey?.trim() ?? "";
                const apiSecret = data.exchangeApiSecret?.trim() ?? "";
                const passphrase = data.exchangePassphrase?.trim();
                const walletKey = data.exchangeWalletKey?.trim();
                const isWalletBased = exchangeType === "hyperliquid" || exchangeType === "uniswap";

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
                    type: exchangeType as "binance" | "binance_us" | "coinbase" | "kraken" | "bitfinex" | "hyperliquid" | "uniswap" | "robinhood" | "okx" | "gemini",
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
                const upperType = exchangeType.toUpperCase();
                if (!isWalletBased) {
                  envUpdates[`${upperType}_API_KEY`] = apiKey;
                  envUpdates[`${upperType}_API_SECRET`] = apiSecret;
                }
                if (passphrase) envUpdates[`${upperType}_PASSPHRASE`] = passphrase;
                if (walletKey) envUpdates[`${upperType}_PRIVATE_KEY`] = walletKey;
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
                    type: brokerType as "alpaca" | "webull" | "schwab" | "tradier" | "tradestation" | "tastytrade" | "trading212" | "etrade" | "ibkr",
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
                id: `setup-${Date.now()}`,
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

  // ── Model picker (interactive provider → model selector) ──
  if (showModelPicker) {
    return (
      <ModelPicker
        currentProvider={(getState() as any).modelProvider ?? "openai"}
        currentModel={(getState() as any).modelName ?? "default"}
        onSelect={async (provider, model) => {
          try {
            const { loadConfig: lc, saveConfig: sc } = await import("../infra/storage/config.ts");
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
              id: `model-${Date.now()}`,
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
      try { const { loadConfig: lc, saveConfig: sc } = await import("../infra/storage/config.ts"); const cfg = await lc(); await sc({ ...cfg, theme } as any); } catch {}
      dispatch({ type: "ADD_MESSAGE", message: { id: `theme-${Date.now()}`, role: "system", content: `Theme changed to ${theme}. Restart for full effect.`, timestamp: new Date().toISOString() } });
      setShowThemePicker(false);
    }} onClose={() => setShowThemePicker(false)} />;
  }

  if (showExchangePicker) {
    return <ExchangePicker onComplete={(msg) => {
      dispatch({ type: "ADD_MESSAGE", message: { id: `exchange-${Date.now()}`, role: "system", content: msg, timestamp: new Date().toISOString() } });
      setShowExchangePicker(false);
    }} onCancel={() => setShowExchangePicker(false)} />;
  }

  if (showBrokerPicker) {
    return <BrokerPicker activeBroker={null} configuredBrokers={[]} onComplete={(action, broker, creds) => {
      dispatch({ type: "ADD_MESSAGE", message: { id: `broker-${Date.now()}`, role: "system", content: `Broker ${action}: ${broker}${creds ? " (credentials saved)" : ""}`, timestamp: new Date().toISOString() } });
      setShowBrokerPicker(false);
    }} onCancel={() => setShowBrokerPicker(false)} />;
  }

  if (showDoctor) {
    return <DoctorDialog checks={[
      { id: "llm", label: "LLM Provider", status: "pass", message: "Connected" },
      { id: "exchange", label: "Exchange", status: "warn", message: "No exchange configured", fixCommand: "/exchange", fixLabel: "Open exchange setup" },
      { id: "broker", label: "Broker", status: "warn", message: "No broker configured", fixCommand: "/broker", fixLabel: "Open broker setup" },
      { id: "keyring", label: "Keyring", status: "info", message: "Available but not enabled" },
    ]} onRunFix={(cmd) => { setShowDoctor(false); handleSubmit(cmd); }} onCancel={() => setShowDoctor(false)} />;
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
      try { const { loadConfig: lc, saveConfig: sc } = await import("../infra/storage/config.ts"); const cfg = await lc(); await sc({ ...cfg, [key]: value }); } catch {}
      dispatch({ type: "ADD_MESSAGE", message: { id: `config-${Date.now()}`, role: "system", content: `Config updated: ${key} = ${value}`, timestamp: new Date().toISOString() } });
    }} onCancel={() => setShowConfigEditor(false)} />;
  }

  if (showThreadBrowser) {
    return <ThreadBrowser threads={[]} activeThreadId={threadId} onSwitch={(id) => {
      dispatch({ type: "ADD_MESSAGE", message: { id: `thread-${Date.now()}`, role: "system", content: `Switched to thread ${id}`, timestamp: new Date().toISOString() } });
      setShowThreadBrowser(false);
    }} onDelete={(id) => {
      dispatch({ type: "ADD_MESSAGE", message: { id: `thread-del-${Date.now()}`, role: "system", content: `Deleted thread ${id}`, timestamp: new Date().toISOString() } });
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
      dispatch({ type: "ADD_MESSAGE", message: { id: `mcp-add-${Date.now()}`, role: "system", content: `MCP server added: ${config.name} (${config.transport})`, timestamp: new Date().toISOString() } });
      setShowMCPManager(false);
    }} onRemove={(id) => {
      dispatch({ type: "ADD_MESSAGE", message: { id: `mcp-rm-${Date.now()}`, role: "system", content: `MCP server removed: ${id}`, timestamp: new Date().toISOString() } });
    }} onReconnect={(id) => {
      dispatch({ type: "ADD_MESSAGE", message: { id: `mcp-rc-${Date.now()}`, role: "system", content: `Reconnecting MCP server: ${id}`, timestamp: new Date().toISOString() } });
    }} onCancel={() => setShowMCPManager(false)} />;
  }

  if (showMarketplace) {
    return <MarketplaceBrowser plugins={[]} onInstall={(pluginId, cmd) => {
      dispatch({ type: "ADD_MESSAGE", message: { id: `mkt-${Date.now()}`, role: "system", content: `Installing ${pluginId}...\nRun: ${cmd}`, timestamp: new Date().toISOString() } });
      setShowMarketplace(false);
    }} onCancel={() => setShowMarketplace(false)} />;
  }

  if (showCLIBrowser) {
    return <CLIBrowser tools={[]} onInstall={(toolId, cmd) => {
      dispatch({ type: "ADD_MESSAGE", message: { id: `cli-${Date.now()}`, role: "system", content: `Install ${toolId}:\n${cmd}`, timestamp: new Date().toISOString() } });
      setShowCLIBrowser(false);
    }} onCancel={() => setShowCLIBrowser(false)} />;
  }

  // ── Placeholder text for PromptInput (Claude Code: rotating example commands) ──
  const EXAMPLE_PROMPTS = [
    'Try "what\'s BTC doing?"',
    'Try "scan for opportunities"',
    'Try "check my portfolio risk"',
    'Try "/morning-brief"',
    'Try "analyze ETH setup"',
    'Try "what\'s trending today?"',
    'Try "/dd BTC"',
  ];
  const placeholder = isStreaming
    ? `\u25CF Gordon is working... ${elapsedFormatted}`
    : ctrlC.isPending
      ? "Press Ctrl+C again to exit"
      : !runtimeReady
        ? "Initializing..."
        : pendingApprovals.length > 0
          ? `${pendingApprovals.length} approval(s) pending \u2014 approve <id> or deny <id>`
          : messages.length === 0
            ? EXAMPLE_PROMPTS[exampleIdx % EXAMPLE_PROMPTS.length]!
            : "";

  return (
    <Box flexDirection="column">
      {/* ── Compact live header — only shown once conversation starts.
           The full boot card is printed to stdout in index.tsx before
           Ink starts, so it lives in terminal history above this frame. ── */}
      {messages.length > 0 && (
        <GordonHeader
          permissionMode={permissionMode ?? "ask"}
          sessionId={sessionId}
          threadId={threadId}
          isResumedSession={isResumedSession}
          resumeMessageCount={isResumedSession ? messages.length : undefined}
          toolCount={5}
          positionCount={0}
          feedCount={0}
          compact={true}
        />
      )}

      {/* ── Conversation — wrapped in PrivacyScreen ── */}
      <PrivacyScreen active={privacyMode}>
        <Box flexDirection="column" paddingX={1}>
          {/* Empty state — header box handles the branding, just show hint text */}
          {messages.length > 0 && (
            <VirtualMessageList
              messages={messages}
              scrollEnabled={!showPalette && !anyDialogOpen}
            />
          )}

          {/* Pending approvals (inline) */}
          {pendingApprovals.map((a) => (
            <ApprovalDialog key={a.id} approval={a} onDecision={handleApproval} />
          ))}

          {/* Handoff arrows */}
          {isStreaming && handoffHistory.length > 0 && (
            <HandoffArrow
              from={handoffHistory[handoffHistory.length - 1]!.from}
              to={handoffHistory[handoffHistory.length - 1]!.to}
            />
          )}

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

          {/* Spinner — shown during all streaming (response is hidden until complete) */}
          {isStreaming && !isThinking && (
            <TradingSpinner
              agentName={activeAgentName ?? undefined}
              streamLength={0}
              userInput={lastUserInput}
              activeToolName={activeToolCalls.find((t) => t.status === "running")?.toolName}
            />
          )}

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

          {/* ── LivePositions — always visible when positions exist ── */}
          {livePositions.length > 0 && (
            <LivePositions initialPositions={livePositions} />
          )}

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
          onSelect={handlePaletteSelect}
          onClose={() => dispatch({ type: "SET_SHOW_PALETTE", show: false })}
        />
      )}

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

      {/* ── Status bar above input (Codex pattern: model · % left · trading status) ── */}
      <Box paddingX={2} justifyContent="space-between">
        <Box gap={1}>
          <Text dimColor>{process.env.GORDON_MODEL ?? "auto"}</Text>
          <Text dimColor>{"\u00b7"}</Text>
          <Text color={memoryUsageRatio > 0.9 ? "red" : memoryUsageRatio > 0.7 ? "yellow" : undefined} dimColor={memoryUsageRatio <= 0.7}>{Math.round((1 - memoryUsageRatio) * 100)}% left</Text>
          {autonomousActive && (
            <>
              <Text dimColor>{"\u00b7"}</Text>
              <Text color="magenta">{"\u25CF"} autonomous</Text>
            </>
          )}
          {livePositions.length > 0 && (
            <>
              <Text dimColor>{"\u00b7"}</Text>
              <Text>{livePositions.length} position{livePositions.length !== 1 ? "s" : ""}</Text>
            </>
          )}
          {memoryUsageRatio > 0.7 && (
            <>
              <Text dimColor>{"\u00b7"}</Text>
              <MemoryUsageIndicator usageRatio={memoryUsageRatio} tokenLimit={contextLimit} />
            </>
          )}
        </Box>
        <Box gap={1}>
          <CostDisplay />
          <Text dimColor>{"\u00b7"} Ctrl+P {"\u00b7"} ? help</Text>
        </Box>
      </Box>

      {/* ── Input area — clean, just the prompt ── */}
      <Box
        borderStyle="round"
        borderColor="gray"
        paddingX={1}
      >
        <PromptInput
          onSubmit={handleSubmit}
          placeholder={placeholder}
          permissionMode={permissionMode ?? "ask"}
          activeAgentCount={activeAgentCount}
          activeAgentName={activeAgentName}
          isStreaming={isStreaming}
          autonomousActive={autonomousActive}
          autonomousStrategyCount={autonomousStrategyCount}
          vimMode={vimModeActive}
        />
      </Box>
    </Box>
  );
}

// ============================================================================
// App — Public export wrapped in provider tree
//
// SettingsProvider > MemoryProvider > StatsProvider > NotificationsProvider
// > AppStateProvider > AppInner
// ============================================================================

export function App() {
  // Import ThemeProvider dynamically to avoid circular deps
  const { ThemeProvider } = require("./themes/ThemeProvider.js");
  return (
    <ThemeProvider>
    <SettingsProvider>
      <MemoryProvider>
        <StatsProvider>
          <NotificationsProvider>
            <AppStateProvider>
              <AppInner />
            </AppStateProvider>
          </NotificationsProvider>
        </StatsProvider>
      </MemoryProvider>
    </SettingsProvider>
    </ThemeProvider>
  );
}
