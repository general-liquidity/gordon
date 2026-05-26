import React, { useCallback, useEffect, useState } from "react";
import { Box, Text, Spacer, useInput, useApp } from "./ink-custom";

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
import { GordonHeader } from "./components/layout/GordonHeader.tsx";
import { type Message, type MessageVariant } from "./components/messages/MessageBubble.tsx";
import { StreamingText } from "./components/messages/StreamingText.tsx";
import { AgentProgress } from "./components/status/AgentProgress.tsx";
import { SwarmTree } from "./components/charts/SwarmTree.tsx";
import { ApprovalDialog } from "./components/dialogs/ApprovalDialog.tsx";
import { WorkerBadge } from "./components/status/WorkerBadge.tsx";
import { InlineHelp } from "./components/InlineHelp.js";
import { CommandPalette, type PaletteItem } from "./components/CommandPalette.js";
import { BootScreen } from "./components/layout/BootScreen.tsx";
import { SetupWizard, type SetupPreflight } from "./components/wizards/SetupWizard.tsx";
import { PrivacyConsent, type PrivacyChoices } from "./components/editors/PrivacyConsent.tsx";
// HandoffArrow no longer rendered inline (suppress routing noise) — keep
// import out so we don't carry dead deps.
// import { HandoffArrow } from "./components/status/HandoffArrow.tsx";
import { PromptInput } from "./components/layout/PromptInput.tsx";
import { defaultMessageQueue } from "../infra/runtime/messageQueue.js";
import { saveEnvKeys } from "../infra/storage/config/env.ts";
import { providerRegistry } from "../infra/runtime/providers/registry.js";
import { loadConfig, saveConfig } from "../infra/storage/config/config.js";
import { refreshRuntimeCredentials } from "./bridge/runtime.js";
import { VirtualMessageList } from "./components/display/VirtualMessageList.tsx";
import { CostDisplay } from "./components/status/CostDisplay.tsx";
import { updateTerminalTab, resetTerminalTab } from "./terminalTab.js";
import { getActionsForKey, isVimModeEnabled } from "./keybindings/keybindings.js";
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
import { getNextHint, recordHintShown, incrementSessionCount, type HintContext } from "../app/setup/onboarding/index.ts";

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
import { ThreadBrowser } from "./components/browsers/ThreadBrowser.tsx";
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
import { ToolCallInline, type ToolCallState } from "./components/status/ToolCallInline.tsx";
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
import { LivePositions, type Position } from "./components/status/LivePositions.tsx";
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

import { AlternateScreen } from "./components/layout/AlternateScreen.tsx";

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
 * DebateViewerOverlay — wraps DebateViewer with Esc-dismiss.
 * DebateViewer has no onClose prop, so we attach key handling here.
 */
function DebateViewerOverlay({ data, onClose }: { data: DebateViewerData; onClose: () => void }) {
  useInput((_input, key) => { if (key.escape) onClose(); });
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

  // Rate limit notification — records binance:rate_limit and surfaces a
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
      unsubRate = bus.on("binance:rate_limit", (event) => {
        rateLimit.recordRateLimit("binance", event.weight, event.limit, 60_000);
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

  // ── Phase 5 reconciler baseline — opt-in only when GORDON_PERF_LOG is set ──
  // Subscribes to the underlying store (bypassing the React render loop) and
  // taps `process.stdout.write` to record frame-time + cell-churn for the
  // custom reconciler comparison. Zero-cost when the env var is unset: the
  // early return fires once at mount and nothing downstream runs.
  useEffect(() => {
    const flushPath = process.env.GORDON_PERF_LOG;
    if (!flushPath) return; // zero-cost path

    const monitor = getPerformanceMonitor();
    monitor.start({ flushPath });
    const uninstallTap = installStdoutTap(monitor);

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
      uninstallTap();
      monitor.stop();
      resetPerformanceMonitor();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const isScreenReaderActive = useScreenReader();
  const vimModeActive = isVimModeEnabled();
  const useAltScreen = process.env.GORDON_ALT_SCREEN !== "false";
  const threadId = useAppState((s) => s.threadId);
  const isResumedSession = useAppState((s) => s.isResumedSession);
  const tokenCount = useAppState((s) => s.tokenCount);
  const contextTokens = useAppState((s) => s.contextTokens);
  const lastTurnDurationMs = useAppState((s) => s.lastTurnDurationMs);
  const lastTurnTokens = useAppState((s) => s.lastTurnTokens);
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

  // PlanDiff overlay — auto-shown when a second plan:created fires for the
  // same symbol and any numeric field changed. Previous snapshot kept per symbol.
  const [planDiff, setPlanDiff] = useState<{ previous: PlanVersion; current: PlanVersion } | null>(null);
  const prevPlansRef = React.useRef<Map<string, PlanVersion>>(new Map());

  // PostTradeFeedback overlay — shown when trade:opened fires (order fill).
  const [postTradeFeedback, setPostTradeFeedback] = useState<string | null>(null);

  // HIP3AssetBrowser overlay — opened via /hip3 slash command.
  const [showHIP3, setShowHIP3] = useState(false);

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
  const [showLabs, setShowLabs] = useState(false);

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
  const { elapsed: elapsedSeconds } = useElapsedTime(isStreaming);
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
    showQuickOpen || showReconciliation || showTaskDeps || showWalkForward ||
    !!counterfactual || !!debateView || !!elicitationRequest;

  // ── Prompt suggestions based on conversation context ──
  const promptSuggestions = usePromptSuggestions(messages, isStreaming, !!false /* hasExchange */);

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
        const { checkForInjection } = require("../infra/safety/injectionDefense.js") as typeof import("../infra/safety/defense/injectionDefense.ts");
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
              id: `review-trade-${Date.now()}`,
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
              id: `debate-${Date.now()}`,
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
            body = formatPerfSnapshot(snap, flushPath, "stopped");
          }
        } else if (sub === "report") {
          const snap = monitor.snapshot();
          body = formatPerfSnapshot(snap, monitor.getFlushPath(), monitor.isRunning() ? "running" : "idle");
        } else {
          body = "Usage: /perf [start [path] | stop | report]";
        }
        dispatch({
          type: "ADD_MESSAGE",
          message: {
            id: `perf-${Date.now()}`,
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
      try { const { loadConfig: lc, saveConfig: sc } = await import("../infra/storage/config/config.ts"); const cfg = await lc(); await sc({ ...cfg, theme } as any); } catch {}
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

  if (showLabs) {
    return <LabsPanel onComplete={(msg) => {
      dispatch({ type: "ADD_MESSAGE", message: { id: `labs-${Date.now()}`, role: "system", content: msg, timestamp: new Date().toISOString() } });
      setShowLabs(false);
    }} onCancel={() => setShowLabs(false)} />;
  }

  if (showBrokerPicker) {
    return <BrokerPicker activeBroker={null} configuredBrokers={[]} onComplete={(action, broker, creds) => {
      dispatch({ type: "ADD_MESSAGE", message: { id: `broker-${Date.now()}`, role: "system", content: `Broker ${action}: ${broker}${creds ? " (credentials saved)" : ""}`, timestamp: new Date().toISOString() } });
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

  // HIP-3 asset browser — full-screen picker like ExchangePicker
  if (showHIP3) {
    return <HIP3AssetBrowser
      onSelect={(req) => {
        dispatch({ type: "ADD_MESSAGE", message: { id: `hip3-${Date.now()}`, role: "system", content: `HIP-3 selected: ${req.symbol} @ $${req.price.toFixed(2)} · ${req.builder}/${req.collateral} · ${req.maxLeverage}x`, timestamp: new Date().toISOString() } });
        setShowHIP3(false);
      }}
      onClose={() => setShowHIP3(false)}
    />;
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
    ? ""
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

          {/* Spinner — shown during all streaming. Carries the elapsed
              timer so users see it ramp up next to the verb (Claude Code
              pattern: 'Cogitating · 23s · 1.2K tok'). */}
          {isStreaming && !isThinking && (
            <TradingSpinner
              agentName={activeAgentName ?? undefined}
              streamLength={0}
              userInput={lastUserInput}
              activeToolName={activeToolCalls.find((t) => t.status === "running")?.toolName}
              elapsedMs={elapsedSeconds * 1000}
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

      {/* ── Status bar above input (Codex pattern: model · % left · trading status) ── */}
      <Box paddingX={2} marginY={1} justifyContent="space-between">
        <Box gap={1}>
          <Text color={memoryUsageRatio > 0.9 ? "red" : memoryUsageRatio > 0.7 ? "yellow" : undefined} dimColor={memoryUsageRatio <= 0.7}>{Math.round((1 - memoryUsageRatio) * 100)}% left</Text>
          {liveContextTokens > 0 && (
            <>
              <Text dimColor>{"·"}</Text>
              <Text dimColor>{formatTokenCount(liveContextTokens)} ctx</Text>
            </>
          )}
          {lastTurnDurationMs > 0 && (
            <>
              <Text dimColor>{"·"}</Text>
              <Text dimColor>{formatElapsedMs(lastTurnDurationMs)}</Text>
              {lastTurnTokens > 0 && (
                <>
                  <Text dimColor>{"·"}</Text>
                  <Text dimColor>{formatTokenCount(lastTurnTokens)} tok</Text>
                </>
              )}
            </>
          )}
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
