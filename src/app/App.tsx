import React, { useCallback, useEffect, useRef, useMemo, useState, useSyncExternalStore } from "react";
import { Box, Text, useInput } from "ink";

import {
  type ThreadStatusInfo,
  type ChainStatusInfo,
} from "./StatusBar.tsx";
import { WelcomeBanner } from "./WelcomeBanner.tsx";
import { QuickStartMenu, type MenuOption } from "./QuickStartMenu.tsx";
import { ChatView, type ChatMessage } from "./ChatView.tsx";
import { appendPendingApprovalMessages, hasConversationMomentum } from "./chatFlow.ts";
import { Onboarding } from "./Onboarding.tsx";
import { QuickStartWizard } from "./QuickStartWizard.tsx";
import { SetupWizard } from "./SetupWizard.tsx";
import { DoctorPanel } from "./DoctorPanel.tsx";
import { ModelSelector } from "./ModelSelector.tsx";
import { ShortcutsOverlay } from "./components/ShortcutsOverlay.tsx";
import { ProgressIndicator } from "./components/ProgressIndicator.tsx";
import { ThemeProvider, useTheme } from "./components/ThemeProvider.tsx";
import { ChatScreen } from "./screens/ChatScreen.tsx";
import { initializeTracing } from "../infra/agents/orchestrator.ts";
import { initRouting } from "../infra/routing/manager.ts";
import { createLLMClientFromEnv, type LLMClient } from "../infra/llm/index.ts";
import { syncAgentRailMcpPlugins } from "../infra/rails/index.ts";
import { BinanceClient } from "../infra/binance/index.ts";
import { BinanceAdapter, ExchangeFactory, type Exchange } from "../infra/exchange/index.ts";
import { resolveExchangeCredentials } from "../infra/exchange/types.ts";
import { BrokerFactory, type BrokerAdapter } from "../infra/broker/index.ts";
import { resolveBrokerCredentials } from "../infra/broker/types.ts";
import {
  initializeRealtimeMonitor,
  shutdownRealtimeMonitor,
} from "../core/monitor.ts";
import { runOrderRecovery } from "../core/order-recovery.ts";
import { listTrades } from "../infra/storage/trades.ts";
import { listPlans } from "../infra/storage/plans.ts";
import { recordStructuredObservation } from "../infra/observability/index.ts";
import { getResolvedConfigWriteScope, loadConfig, saveConfig, saveResolvedConfig } from "../infra/storage/config.ts";
import { loadConfigBundle, type ConfigLayers } from "../infra/storage/config.ts";
import {
  runSharedMonitorCycle,
  runSharedScan,
  subscribeToMarketPrice,
} from "../core/market-data-coordinator.ts";
import {
  updateThreadId,
  type SessionInfo,
} from "../infra/storage/session.ts";
import {
  cloneThread,
  listThreads,
  listThreadTree,
  getThreadInfo,
  switchThread,
  deleteThread,
  updateThreadLabel,
  ensureThreadRegistered,
  type ThreadInfo,
} from "../infra/agents/threadManager.ts";
import { loadEnvFile, checkEnvStatus, type EnvStatus } from "../infra/storage/env.ts";
import { initDatabase } from "../infra/storage/index.ts";
import { initializeContainer } from "../services/container.ts";
import { reconcileWithBinance } from "../services/reconciliation.service.ts";
import { createErrorContext, formatErrorWithContext } from "../utils/errorContext.ts";
import type { GordonContext } from "../infra/agents/types.ts";
import type { Mode, GordonConfig } from "../types/index.ts";
import type { Plan } from "../types/plan.ts";
import { COLORS, type ThemeName } from "./theme.ts";
import { buildVisibleThreadPolicy } from "./threadDensity.ts";
import { getNextWorkspace, getPreviousWorkspace, getWorkspaceByShortcut } from "./workspaces.ts";
import { loadWorkspaceShellState, saveWorkspaceShellState } from "./workspaceShellState.ts";
import {
  parseSlashCommand,
  commandToPrompt,
  formatCommandHelp,
  parseHelpArg,
  formatPaginatedCommandHelp,
  isDeterministicSlashCommand,
  isRuntimeHandledSlashCommand,
} from "./slashCommands.ts";
import {
  handleConfigCommand,
  handleExchangeCommand,
  handleBrokerCommand,
  handleStocksCommand,
  handleStrategyCommand,
  handleGenCommand,
  handleKeyringCommand,
  handleMCPCommand,
  handleRoutingCommand,
  handleTelemetryCommand,
  handleContextCommand,
  handleWorkflowCommand,
  formatWorkflowResult,
  handleExportCommand,
} from "./commands/index.ts";
import { formatScanResults, formatPortfolioResults } from "./components/formatResults.ts";
import {
  checkForPluginSuggestions,
  formatPluginSuggestionsMessage,
} from "./commands/mcp.ts";
import { bootstrapV07 } from "../core/bootstrap.ts";
import { getMarketEmitter } from "../events/index.ts";
import { getSubscriptionRegistry } from "../events/index.ts";
import { clearToolCache, getToolCacheStats, pruneToolCache } from "../infra/agents/tools/cache.ts";
import { buildAppGordonContext } from "../gateway/ui/context.ts";
import { getActionBySlashName, type CredentialProfile } from "../infra/actions/index.ts";
import type {
  ScanExportData,
  AnalysisExportData,
  BacktestExportData,
} from "./commands/export.ts";
import {
  parseSetupWizardMode,
  parseSetupWizardSection,
  type OnboardingSelection,
  type SetupWizardMode,
  type SetupWizardSection,
} from "./setup-flow.ts";
import { OVERLAY_NONE, isOverlayOpen, openOverlay, type OverlayState } from "./overlayState.ts";
import {
  cancelTaskTree,
  completeTaskTree,
  createTaskTree,
  dequeueTaskTreeSubmission,
  failTaskTree,
  markTaskTreeRoutingResolved,
  queueTaskTreeSubmission,
  recordTaskTreeAgentSwitch,
  recordTaskTreeToolEnd,
  recordTaskTreeToolStart,
  type TaskTreeState,
} from "./taskTree.ts";
import {
  buildBackgroundTaskTree,
  buildBackgroundTaskTreeSignature,
  type BackgroundStatusResponse,
} from "./backgroundTasks.ts";
import { getOrCreateDaemonToken } from "../gateway/security/auth.ts";
import { sendIpcCommand, isIpcDaemonReachable } from "../gateway/daemon/ipc.ts";
import { createEnvelopeMeta } from "../gateway/protocol/envelope.ts";
import {
  ACTION_LOG_GROUP_ALIASES,
  appendActionLogEntry,
  buildCompactionSummary,
  buildThreadSummaryReport,
  formatActionLogEntries,
  getActionLogEntry,
  isActionLogEntryType,
  isActionLogGroupAlias,
  listActionLogEntries,
  setActionLogBookmarked,
  type ActionLogEntry,
  type ActionLogEntryType,
} from "../infra/action-log/index.ts";
import { rebuildACEMemoryForThread } from "../infra/agents/aceMemory.ts";
import { getArmedStatus } from "../infra/agents/middleware/access-control.ts";
import { parseRuntimeApprovalShortcut, parseSystemShortcut } from "./systemCommandShortcuts.ts";
import { SessionRuntimeFactory, type SessionRuntime } from "../runtime/index.ts";
import type { RuntimeApprovalRequest, RuntimeTranscriptEntry } from "../runtime/contracts/types.ts";
import {
  createAppStore,
  createInitialAppState,
  parseQueuedSubmission,
  type AppView,
  type AppState,
  type AppStateStore,
  type LastResults,
  type QueuedSubmission,
  type QueuedSubmissionKind,
  type WorkspaceId,
} from "./state/AppStore.ts";
import { createRuntimeInspectorViewModel } from "./presenters/RuntimePresenter.ts";
import {
  buildWorkspaceBoardViewModel,
  clampWorkspaceCardIndex,
  getPrimaryWorkspaceAction,
  type WorkspaceStrategyInventorySnapshot,
} from "./workspaceViewModels.ts";
import { getRuntimeApprovalShortId } from "./runtimeApprovalId.ts";
import {
  applyRuntimeApprovalDecision,
  compactRuntimeTranscript,
  formatRuntimeApprovals,
  formatRuntimeBridge,
  formatRuntimeHistory,
  formatRuntimeHandoffs,
  formatRuntimePlugins,
  formatRuntimeScratchpad,
  formatRuntimeSessionInfo,
  formatRuntimeState,
  formatRuntimeTranscript,
} from "./commands/runtime.ts";
import {
  buildRuntimeActivityStatus,
  buildRuntimeLinkedSession,
  shouldRefreshRuntimeInspector,
} from "./runtime/runtimeStateSync.ts";
import { strategyRegistry } from "../strategies/index.ts";
import { listGeneratedStrategies } from "../infra/storage/generated-strategies.ts";
import { playbookRegistry } from "../core/playbooks/index.ts";
import {
  buildSystematicPortfolioSummary,
  listResearchExperiments,
  listStrategyProfiles,
} from "../infra/systematic/service.ts";

type PluginSuggestion = ReturnType<typeof checkForPluginSuggestions>[number];

interface ParsedActionLogRequest {
  entryTypes?: ActionLogEntryType[];
  bookmarkedOnly: boolean;
  sessionId?: string;
  threadQuery?: string;
  limit: number;
}

function getIdSuffix(id: string): string {
  const separatorIndex = id.indexOf("_");
  return separatorIndex >= 0 ? id.slice(separatorIndex + 1) : id;
}

function getRequestCredentialProfile(config: GordonConfig): CredentialProfile {
  if (config.mode === "ARMED") {
    return "live";
  }
  const activeBroker = config.brokers.find((broker) => broker.id === config.activeBrokerId)
    ?? config.brokers.find((broker) => broker.isDefault)
    ?? config.brokers[0];
  if (activeBroker?.paper) {
    return "paper";
  }
  return "default";
}

function buildKnownOrderOwnerKeys(
  trades: Array<{ id: string; planId: string }>
): Set<string> {
  const keys = new Set<string>();

  for (const trade of trades) {
    const tradeSuffix = getIdSuffix(trade.id);
    const planSuffix = getIdSuffix(trade.planId);

    keys.add(trade.id);
    keys.add(tradeSuffix);
    keys.add(trade.planId);
    keys.add(planSuffix);

    // Gordon client order IDs encode the first 8 chars of plan suffix.
    if (planSuffix.length >= 8) {
      keys.add(planSuffix.slice(0, 8));
    }
  }

  return keys;
}

function getDefaultConfig(): GordonConfig {
  return {
    version: "1.0.0",
    exchanges: [],
    brokers: [],
    agentRails: {
      walletProviders: [],
      chainProviders: [],
      paymentProviders: [],
      autoSyncMcpPlugins: true,
      requireApprovalForExternalActions: true,
    },
    mcpServers: [],
    preferences: {
      cashReservePercent: 0.2,
      maxAllocationPerTrade: 0.1,
      defaultTimeframes: ["1h", "4h"],
      topNCoins: 50,
      maxConcurrentTrades: 5,
    },
    memoryConfig: {
      lastMessages: 20,
      maxSessionDurationHours: 24,
      memoryWarningThreshold: 0.8,
    },
    mode: "SAFE",
    armedUntil: null,
    onboardingComplete: false,
    startupBannerMode: "full",
    useKeyring: false,
    telemetry: { enabled: false, researchData: false },
    riskManagement: {
      mode: "enforce",
      maxDailyLossPercent: 3,
      maxDrawdownPercent: 15,
      maxPositionSizePercent: 10,
      maxPositions: 5,
    },
    strategyRuntime: {
      allocationStrategy: "equal_weight",
    },
    regimeDetection: {
      autoRegime: true,
    },
    systematic: {
      executionMode: "assisted",
      minTradesForPromotion: 30,
      minValidationScore: 60,
      autoSnapshotDatasets: true,
      autoCreateResearchExperiments: true,
      simulationRealism: {
        profile: "realistic",
        executionLagBars: 1,
        spreadBps: 2,
        marketImpactBps: 1,
      },
      biasDiagnostics: {
        minBacktestDays: 90,
        minOutOfSampleWindows: 3,
        maxTradePnlConcentrationPercent: 55,
        maxCagrPercent: 300,
        requireWalkForward: true,
        requireMonteCarlo: true,
      },
    },
  };
}

function formatTimestamp(): string {
  return new Date().toLocaleTimeString("en-US", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatChatTimestamp(value?: string): string | undefined {
  if (!value) {
    return undefined;
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return value;
  }

  return parsed.toLocaleTimeString("en-US", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

function toChatMessageFromRuntimeTranscript(entry: RuntimeTranscriptEntry): ChatMessage {
  const timestamp = formatChatTimestamp(entry.timestamp);
  const metadata = entry.metadata ?? {};

  if (entry.role === "user") {
    return {
      role: "user",
      content: entry.content,
      timestamp,
    };
  }

  let badge: string | undefined;
  let agent: string | undefined;
  let variant: ChatMessage["variant"];

  switch (entry.role) {
    case "system":
      badge = "System";
      variant = "system";
      break;
    case "tool":
      badge = "Tool";
      variant = "tool";
      break;
    case "agent":
      badge = "Agent";
      variant = "handoff";
      break;
    default:
      break;
  }

  if (typeof metadata.uiVariant === "string") {
    variant = metadata.uiVariant as ChatMessage["variant"];
  }

  if (typeof metadata.activeAgent === "string") {
    agent = metadata.activeAgent;
  } else if (typeof metadata.agentName === "string") {
    agent = metadata.agentName;
  } else if (entry.role === "agent") {
    const match = entry.content.match(/Agent switched to\s+(.+)$/i);
    if (match?.[1]) {
      agent = match[1];
    }
  }

  return {
    role: "gordon",
    content: entry.content,
    timestamp,
    badge,
    agent,
    variant,
  };
}

function buildChatMessagesFromRuntimeTranscript(
  entries: RuntimeTranscriptEntry[],
  options: { maxEntries?: number } = {},
): ChatMessage[] {
  const maxEntries = Math.max(1, Math.min(options.maxEntries ?? 80, 160));
  return entries.slice(-maxEntries).map(toChatMessageFromRuntimeTranscript);
}

function parseActionLogArgs(args: string): ParsedActionLogRequest {
  const tokens = args.split(/\s+/).map((token) => token.trim()).filter(Boolean);
  const parsed: ParsedActionLogRequest = {
    bookmarkedOnly: false,
    limit: 20,
  };

  for (const token of tokens) {
    const lower = token.toLowerCase();
    if (/^\d+$/.test(lower)) {
      parsed.limit = Math.max(1, Math.min(100, Number.parseInt(lower, 10)));
      continue;
    }
    if (lower === "daemon") {
      parsed.sessionId = "daemon";
      continue;
    }
    if (lower === "bookmarked" || lower === "bookmark" || lower === "bookmarks") {
      parsed.bookmarkedOnly = true;
      continue;
    }
    if (isActionLogEntryType(lower)) {
      parsed.entryTypes = [...(parsed.entryTypes ?? []), lower];
      continue;
    }
    if (isActionLogGroupAlias(lower)) {
      parsed.entryTypes = [...(parsed.entryTypes ?? []), ...ACTION_LOG_GROUP_ALIASES[lower]];
      continue;
    }
    parsed.threadQuery = token;
  }

  if (parsed.entryTypes && parsed.entryTypes.length > 0) {
    parsed.entryTypes = [...new Set(parsed.entryTypes)];
  }

  return parsed;
}

function resolveBookmarkedTargetId(raw: string | undefined, entries: ActionLogEntry[]): string | null {
  if (!raw || raw.toLowerCase() === "last") {
    return entries.find((entry) => entry.entryType !== "bookmark")?.id ?? null;
  }

  const lowered = raw.toLowerCase();
  return entries.find((entry) => entry.id.toLowerCase().startsWith(lowered))?.id ?? null;
}

const STOCK_MARKET_TOKENS = ["stock", "stocks", "equity", "equities", ...BrokerFactory.getSupportedBrokers()];
const STOCK_MARKET_PATTERN = new RegExp(`^\\s*(${STOCK_MARKET_TOKENS.join("|")})\\b`, "i");

function isStocksMarketArgs(args: string): boolean {
  return STOCK_MARKET_PATTERN.test(args || "");
}

function stripStocksMarketPrefix(args: string): string {
  const trimmed = (args || "").trim();
  if (!trimmed) return "";
  const parts = trimmed.split(/\s+/);
  const first = parts[0]?.toLowerCase();
  if (first && STOCK_MARKET_TOKENS.includes(first)) {
    return parts.slice(1).join(" ");
  }
  return trimmed;
}

const STARTUP_TASK_CONCURRENCY = 2;

async function runDeferredTasksWithConcurrency(
  tasks: Array<() => Promise<void>>,
  concurrency = STARTUP_TASK_CONCURRENCY,
): Promise<void> {
  if (tasks.length === 0) {
    return;
  }

  const workerCount = Math.min(Math.max(concurrency, 1), tasks.length);
  let nextIndex = 0;

  async function worker(): Promise<void> {
    while (true) {
      const currentIndex = nextIndex;
      nextIndex += 1;
      if (currentIndex >= tasks.length) {
        return;
      }

      const task = tasks[currentIndex];
      if (!task) {
        return;
      }

      try {
        await task();
      } catch (error) {
        console.error("[Startup] Deferred task failed:", error);
      }
    }
  }

  await Promise.all(Array.from({ length: workerCount }, () => worker()));
}

interface AppContentProps {
  onThemeChange: (theme: ThemeName | "toggle", args?: string) => void;
}

function AppContent({ onThemeChange }: AppContentProps): React.ReactElement {
  const appStoreRef = useRef<AppStateStore | null>(null);
  if (!appStoreRef.current) {
    appStoreRef.current = createAppStore(createInitialAppState({
      setupMode: parseSetupWizardMode(process.env.GORDON_SETUP_MODE, "advanced"),
      setupSection: parseSetupWizardSection(process.env.GORDON_SETUP_SECTION),
      overlay: OVERLAY_NONE,
    }));
  }
  const appStore = appStoreRef.current!;
  const state = useSyncExternalStore(appStore.subscribe, appStore.getState, appStore.getState);
  const setState = useCallback((updater: (previous: AppState) => AppState) => appStore.setState(updater), [appStore]);
  const [workspaceShellVersion, setWorkspaceShellVersion] = useState(0);

  const llmClientRef = useRef<LLMClient | null>(null);
  const binanceClientRef = useRef<BinanceClient | null>(null);
  const exchangeRef = useRef<Exchange | null>(null);
  const brokerRef = useRef<BrokerAdapter | null>(null);
  const configRef = useRef<GordonConfig>(getDefaultConfig());
  const lastResultsRef = useRef<LastResults>({});
  const pendingPluginSuggestionsRef = useRef<PluginSuggestion[]>([]);
  const shownPluginSuggestionsRef = useRef<Set<string>>(new Set());
  const monitorCycleInFlightRef = useRef(false);
  const activeStreamAbortControllerRef = useRef<AbortController | null>(null);
  const isDrainingQueueRef = useRef(false);
  const daemonTokenRef = useRef<string | null>(null);
  const loggedMessageKeysRef = useRef<Set<string>>(new Set());
  const transcriptBottomOffsetRef = useRef(0);
  const isUserTypingRef = useRef(false);
  const previousMessageCountRef = useRef(0);
  const portfolioValueRef = useRef<number | undefined>(state.portfolioValue);
  const availableCashRef = useRef<number>(state.availableCash);
  const sessionRuntimeFactoryRef = useRef<SessionRuntimeFactory | null>(null);
  const bumpWorkspaceShellVersion = useCallback(() => {
    setWorkspaceShellVersion((value) => value + 1);
  }, []);

  const getSessionRuntime = useCallback((runtimeId: string = "app"): SessionRuntime => {
    if (!sessionRuntimeFactoryRef.current) {
      sessionRuntimeFactoryRef.current = new SessionRuntimeFactory({
        resolveContext: async ({ session, contextOverride }) => {
          if (contextOverride) {
            return contextOverride;
          }
          if (!llmClientRef.current) {
            throw new Error("LLM client not initialized");
          }
          return buildAppGordonContext({
            binance: binanceClientRef.current,
            exchange: exchangeRef.current,
            broker: brokerRef.current,
            llm: llmClientRef.current,
            config: configRef.current,
            portfolioValue: portfolioValueRef.current ?? 0,
            availableCash: availableCashRef.current,
            userId: session.resourceId,
            threadId: session.threadId,
            credentialProfile: getRequestCredentialProfile(configRef.current),
          });
        },
      });
    }
    return sessionRuntimeFactoryRef.current.get(runtimeId, { sessionId: runtimeId });
  }, []);

  const syncRuntimeToolingState = useCallback(async () => {
    const runtime = getSessionRuntime("app");
    await runtime.refreshPlugins();
  }, [getSessionRuntime]);

  /**
   * Helper to update thread status info in state
   * Call this whenever the thread changes or messages are added
   */
  const updateThreadStatusInfo = useCallback(async (threadId: string | undefined): Promise<void> => {
    if (!threadId) {
      setState((prev) => ({ ...prev, threadStatusInfo: null }));
      return;
    }

    try {
      const threadInfo = await getThreadInfo(threadId);
      if (threadInfo) {
        setState((prev) => ({
          ...prev,
          threadStatusInfo: {
            name: threadInfo.label || "Main",
            messageCount: threadInfo.messageCount,
            isBranch: threadInfo.clonedFrom !== null,
          },
        }));
      } else {
        setState((prev) => ({
          ...prev,
          threadStatusInfo: {
            name: "Main",
            messageCount: 0,
            isBranch: false,
          },
        }));
      }
    } catch {
      // Thread status update is non-critical — silently ignore
    }
  }, []);

  const backgroundRefreshInFlightRef = useRef(false);
  const backgroundTaskTreeSignatureRef = useRef<string | null>(null);
  const backgroundRefreshLastRanAtRef = useRef(0);

  const getTranscriptMessagesForState = useCallback((
    snapshot: Pick<AppState, "messages">,
  ): ChatMessage[] => appendPendingApprovalMessages(
    snapshot.messages,
    getSessionRuntime("app").getState().approvals.pending,
  ), [getSessionRuntime]);

  const getTranscriptMaxOffset = useCallback((
    snapshot: Pick<AppState, "messages" | "isStreaming" | "taskTree" | "backgroundTaskTree">,
  ): number => {
    const transcriptMessages = getTranscriptMessagesForState(snapshot);
    const policy = buildVisibleThreadPolicy({
      messages: transcriptMessages,
      isStreaming: snapshot.isStreaming,
      hasTaskTree: Boolean(snapshot.taskTree),
      hasBackgroundTasks: Boolean(snapshot.backgroundTaskTree),
    });

    return Math.max(0, transcriptMessages.length - policy.visibleLimit);
  }, [getTranscriptMessagesForState]);

  const clampTranscriptOffset = useCallback((
    snapshot: Pick<AppState, "messages" | "isStreaming" | "taskTree" | "backgroundTaskTree">,
    requestedOffset: number,
  ): number => Math.max(0, Math.min(requestedOffset, getTranscriptMaxOffset(snapshot))), [getTranscriptMaxOffset]);

  useEffect(() => {
    transcriptBottomOffsetRef.current = state.transcriptBottomOffset;
  }, [state.transcriptBottomOffset]);

  useEffect(() => {
    isUserTypingRef.current = state.isUserTyping;
  }, [state.isUserTyping]);

  useEffect(() => {
    portfolioValueRef.current = state.portfolioValue;
    availableCashRef.current = state.availableCash;
  }, [state.availableCash, state.portfolioValue]);

  useEffect(() => {
    const runtime = getSessionRuntime("app");
    return runtime.subscribe((runtimeState) => {
      const nextInspector = createRuntimeInspectorViewModel(runtime);
      const snapshot = runtimeState.session.snapshot;
      setState((prev) => {
        const nextSession = buildRuntimeLinkedSession(prev.session, runtimeState);

        const nextIsStreaming = runtimeState.stream.status === "running";
        const nextActivityStatus = buildRuntimeActivityStatus(prev.activityStatus, prev.isStreaming, runtimeState);

        const sessionChanged = (
          (prev.session?.resourceId ?? null) !== (nextSession?.resourceId ?? null)
          || (prev.session?.threadId ?? null) !== (nextSession?.threadId ?? null)
        );
        const streamingChanged = prev.isStreaming !== nextIsStreaming;
        const activityChanged = prev.activityStatus !== nextActivityStatus;
        const inspectorChanged = shouldRefreshRuntimeInspector(prev.runtimeInspector, nextInspector);

        if (!sessionChanged && !streamingChanged && !activityChanged && !inspectorChanged) {
          return prev;
        }

        return {
          ...prev,
          session: nextSession,
          isStreaming: nextIsStreaming,
          activityStatus: nextActivityStatus,
          runtimeInspector: nextInspector,
        };
      });
    });
  }, [getSessionRuntime]);

  useEffect(() => {
    const previousCount = previousMessageCountRef.current;
    const nextCount = getTranscriptMessagesForState({ messages: state.messages }).length;

    if (state.view === "chat" && previousCount !== 0 && nextCount !== previousCount) {
      const delta = nextCount - previousCount;
      setState((prev) => {
        if (prev.view !== "chat" || prev.transcriptBottomOffset === 0) {
          return prev;
        }

        const nextOffset = clampTranscriptOffset(prev, prev.transcriptBottomOffset + delta);
        if (nextOffset === prev.transcriptBottomOffset) {
          return prev;
        }

        return {
          ...prev,
          transcriptBottomOffset: nextOffset,
        };
      });
    }

    previousMessageCountRef.current = nextCount;
  }, [
    clampTranscriptOffset,
    getTranscriptMessagesForState,
    state.backgroundTaskTree,
    state.isStreaming,
    state.messages,
    state.runtimeInspector?.pendingApprovalCount,
    state.taskTree,
    state.view,
  ]);

  useEffect(() => {
    void syncRuntimeToolingState();
  }, [syncRuntimeToolingState]);

  const refreshBackgroundTaskTree = useCallback(async (): Promise<void> => {
    if (backgroundRefreshInFlightRef.current) {
      return;
    }
    backgroundRefreshInFlightRef.current = true;
    const reachable = await isIpcDaemonReachable().catch(() => false);
    if (!reachable) {
      getSessionRuntime("app").setBackgroundTasks([]);
      getSessionRuntime("app").setRemoteState({
        connectionStatus: "offline",
        reachable: false,
        actor: "daemon",
        detail: "IPC daemon unavailable",
      });
      backgroundTaskTreeSignatureRef.current = null;
      setState((prev) => (
        prev.backgroundTaskTree
          ? { ...prev, backgroundTaskTree: null }
          : prev
      ));
      backgroundRefreshInFlightRef.current = false;
      return;
    }

    try {
      const token = daemonTokenRef.current ?? await getOrCreateDaemonToken();
      daemonTokenRef.current = token;

      const response = await sendIpcCommand({
        request: {
          token,
          processImmediately: true,
          envelope: {
            meta: createEnvelopeMeta({
              sessionId: "app",
              source: "agent",
              idempotencyKey: `background_status_${Date.now()}`,
            }),
            command: {
              type: "runtime.background_status",
              payload: {},
            },
          },
        },
        timeoutMs: 5_000,
      });

      if (!response.ok || !response.data) {
        throw new Error(response.error?.message || "Background status unavailable");
      }

      const payload = response.data as BackgroundStatusResponse;
      getSessionRuntime("app").setBackgroundTasks([
        ...payload.scheduler.tasks.map((task) => ({
          id: task.taskId,
          label: task.taskId,
          status: (task.enabled ? "running" : "idle") as "running" | "idle",
          updatedAt: task.lastRunAt ?? task.nextRunAt ?? new Date().toISOString(),
        })),
        {
          id: "autonomous",
          label: "autonomous",
          status: (payload.autonomous.isRunning
            ? (payload.autonomous.isPaused ? "idle" : "running")
            : "completed") as "idle" | "running" | "completed",
          updatedAt: payload.autonomous.lastCycleTime ?? new Date().toISOString(),
        },
      ]);
      getSessionRuntime("app").setRemoteState({
        connectionStatus: "connected",
        reachable: true,
        actor: "daemon",
        detail: `scheduler=${payload.scheduler.tasks.length} autonomous=${payload.autonomous.isRunning ? "on" : "off"}`,
      });
      const nextSignature = buildBackgroundTaskTreeSignature(payload);
      if (nextSignature !== backgroundTaskTreeSignatureRef.current) {
        backgroundTaskTreeSignatureRef.current = nextSignature;
        const nextTree = buildBackgroundTaskTree(payload);
        setState((prev) => ({
          ...prev,
          backgroundTaskTree: nextTree,
        }));
      }
    } catch {
      getSessionRuntime("app").setBackgroundTasks([]);
      getSessionRuntime("app").setRemoteState({
        connectionStatus: "degraded",
        reachable: true,
        actor: "daemon",
        detail: "background status fetch failed",
      });
      backgroundTaskTreeSignatureRef.current = null;
      setState((prev) => (
        prev.backgroundTaskTree
          ? { ...prev, backgroundTaskTree: null }
          : prev
      ));
    } finally {
      backgroundRefreshInFlightRef.current = false;
    }
  }, []);

  const appendCurrentActionLogEntry = useCallback((input: {
    entryType: ActionLogEntryType;
    title: string;
    content?: string;
    payload?: Record<string, unknown>;
    threadId?: string;
    resourceId?: string;
    sessionId?: string;
    correlationId?: string;
    runId?: string;
    parentEntryId?: string;
    label?: string;
    bookmarked?: boolean;
  }): ActionLogEntry => {
    const entry = appendActionLogEntry({
      threadId: input.threadId ?? state.session?.threadId,
      resourceId: input.resourceId ?? state.session?.resourceId,
      sessionId: input.sessionId ?? state.session?.threadId ?? "app",
      correlationId: input.correlationId,
      runId: input.runId,
      parentEntryId: input.parentEntryId,
      entryType: input.entryType,
      title: input.title,
      content: input.content,
      payload: input.payload,
      label: input.label,
      bookmarked: input.bookmarked,
    });
    if (
      entry.threadId &&
      (entry.entryType === "user_message" ||
        entry.entryType === "assistant_message" ||
        entry.entryType === "tool_result")
    ) {
      rebuildACEMemoryForThread(entry.threadId);
    }
    return entry;
  }, [state.session]);

  const resolveThreadFromQuery = useCallback(async (threadQuery?: string): Promise<ThreadInfo | null> => {
    if (!threadQuery) {
      return state.session?.threadId ? getThreadInfo(state.session.threadId) : null;
    }

    const threads = await listThreads();
    return threads.find((thread) =>
      thread.threadId === threadQuery
      || thread.threadId.startsWith(threadQuery)
      || thread.threadId.includes(threadQuery)
      || thread.label.toLowerCase() === threadQuery.toLowerCase()
    ) ?? null;
  }, [state.session?.threadId]);

  useEffect(() => {
    const threadId = state.session?.threadId;
    const resourceId = state.session?.resourceId;
    if (!threadId || !resourceId) {
      return;
    }

    let appendedAny = false;
    for (const [index, message] of state.messages.entries()) {
      if (!message.content.trim()) {
        continue;
      }
      if (
        state.isStreaming
        && state.streamingMessageTimestamp
        && message.role === "gordon"
        && message.timestamp === state.streamingMessageTimestamp
      ) {
        continue;
      }

      const key = [threadId, message.role, message.timestamp ?? `idx-${index}`, index].join(":");
      if (loggedMessageKeysRef.current.has(key)) {
        continue;
      }

      appendActionLogEntry({
        threadId,
        resourceId,
        sessionId: threadId,
        entryType: message.role === "user" ? "user_message" : "assistant_message",
        title: message.role === "user" ? "User message" : "Assistant response",
        content: message.content,
        payload: {
          timestamp: message.timestamp,
          badge: message.badge,
          agent: message.agent,
          index,
        },
      });
      loggedMessageKeysRef.current.add(key);
      appendedAny = true;
    }

    if (appendedAny) {
      rebuildACEMemoryForThread(threadId);
    }
  }, [
    state.isStreaming,
    state.messages,
    state.session?.resourceId,
    state.session?.threadId,
    state.streamingMessageTimestamp,
  ]);

  const updateLastResultsFromTool = useCallback((toolName: string | undefined, toolResult: unknown): void => {
    if (!toolName || !toolResult || typeof toolResult !== "object") return;
    const resultObj = toolResult as Record<string, unknown>;
    if (resultObj.error) return;
    let workspaceSnapshotChanged = false;

    switch (toolName) {
      case "scan_market":
        lastResultsRef.current.scan = resultObj as ScanExportData;
        workspaceSnapshotChanged = true;
        if (Array.isArray((resultObj as ScanExportData).opportunities) && (resultObj as ScanExportData).opportunities?.[0]?.symbol) {
          appStore.updateWorkspaceMemory("market", {
            focusSymbol: (resultObj as ScanExportData).opportunities?.[0]?.symbol,
          });
        }
        break;
      case "analyze_coin":
        lastResultsRef.current.analysis = resultObj as AnalysisExportData;
        workspaceSnapshotChanged = true;
        if (typeof (resultObj as AnalysisExportData).symbol === "string") {
          appStore.updateWorkspaceMemory("market", {
            focusSymbol: (resultObj as AnalysisExportData).symbol,
          });
        }
        break;
      case "run_backtest":
      case "compare_backtests":
      case "get_backtest_summary":
      case "analyze_backtest_results":
        lastResultsRef.current.backtest = resultObj as BacktestExportData;
        workspaceSnapshotChanged = true;
        {
          const backtestConfig = (
            resultObj
            && typeof resultObj.result === "object"
            && resultObj.result !== null
            && "config" in (resultObj.result as Record<string, unknown>)
            && typeof (resultObj.result as Record<string, unknown>).config === "object"
            && (resultObj.result as Record<string, unknown>).config !== null
          )
            ? ((resultObj.result as { config: Record<string, unknown> }).config)
            : null;
          const strategyId = backtestConfig && typeof backtestConfig.strategyId === "string"
            ? backtestConfig.strategyId
            : undefined;
          if (strategyId) {
            appStore.updateWorkspaceMemory("lab", {
              selectedStrategyId: strategyId,
              selectedSource: "built-in",
            });
          }
        }
        break;
      case "check_positions":
      case "get_portfolio_state":
        lastResultsRef.current.portfolio = resultObj;
        workspaceSnapshotChanged = true;
        break;
      case "get_technical_analysis":
      case "get_advanced_analysis":
        lastResultsRef.current.technicalAnalysis = resultObj;
        break;
      case "detect_market_regime":
        lastResultsRef.current.regime = resultObj;
        workspaceSnapshotChanged = true;
        break;
      case "create_plan": {
        workspaceSnapshotChanged = true;
        const plan = "plan" in resultObj && typeof resultObj.plan === "object" && resultObj.plan !== null
          ? resultObj.plan as { id?: string; symbol?: string }
          : null;
        if (plan) {
          appStore.updateWorkspaceMemory("plan", {
            selectedPlanId: plan.id,
            focusSymbol: plan.symbol,
          });
        }
        if (plan?.symbol) {
          appStore.updateWorkspaceMemory("market", {
            focusSymbol: plan.symbol,
          });
        }
        break;
      }
      case "create_grid_plan": {
        workspaceSnapshotChanged = true;
        const preview = "planPreview" in resultObj && typeof resultObj.planPreview === "object" && resultObj.planPreview !== null
          ? resultObj.planPreview as { symbol?: string }
          : null;
        if (preview?.symbol) {
          appStore.updateWorkspaceMemory("plan", {
            focusSymbol: preview.symbol,
          });
        }
        break;
      }
      default:
        // Store any tool result in a generic map for potential export
        if (!lastResultsRef.current.toolResults) lastResultsRef.current.toolResults = {};
        lastResultsRef.current.toolResults[toolName] = resultObj;
        break;
    }
    if (workspaceSnapshotChanged) {
      bumpWorkspaceShellVersion();
    }
  }, [appStore, bumpWorkspaceShellVersion]);

  const getPersistedWorkspaceLastResults = useCallback(() => ({
    scan: lastResultsRef.current.scan,
    analysis: lastResultsRef.current.analysis,
    backtest: lastResultsRef.current.backtest,
    regime: lastResultsRef.current.regime,
    portfolioSummary: lastResultsRef.current.portfolioSummary,
    positionsSummary: lastResultsRef.current.positionsSummary,
    ordersSummary: lastResultsRef.current.ordersSummary,
    workflowSummary: lastResultsRef.current.workflowSummary,
  }), []);

  useEffect(() => {
    if (state.view === "loading") {
      return;
    }

    const timer = setTimeout(() => {
      void saveWorkspaceShellState({
        workspace: state.workspace,
        workspaceMemory: state.workspaceMemory,
        workspaceInteraction: state.workspaceInteraction,
        lastResults: getPersistedWorkspaceLastResults(),
      }).catch(() => undefined);
    }, 80);

    return () => {
      clearTimeout(timer);
    };
  }, [
    getPersistedWorkspaceLastResults,
    state.view,
    state.workspace,
    state.workspaceMemory,
    state.workspaceInteraction,
    workspaceShellVersion,
  ]);

  const appendMessages = useCallback((nextMessages: ChatMessage[]): void => {
    if (nextMessages.length === 0) {
      return;
    }

    appStore.appendMessages(nextMessages);
  }, [appStore]);

  const updateMessageByTimestamp = useCallback((
    timestamp: string,
    updater: (message: ChatMessage) => ChatMessage
  ): void => {
    appStore.updateMessages((previousMessages) => {
      const nextMessages = [...previousMessages];
      for (let i = nextMessages.length - 1; i >= 0; i--) {
        const message = nextMessages[i];
        if (message && message.timestamp === timestamp && message.role === "gordon") {
          nextMessages[i] = updater(message);
          return nextMessages;
        }
      }

      return previousMessages;
    });
  }, [appStore]);

  const refreshResolvedConfig = useCallback(async (): Promise<GordonConfig> => {
    const resolved = await loadConfigBundle();
    configRef.current = resolved.config;
    setState((prev) => ({
      ...prev,
      configLayers: resolved.layers,
    }));
    return resolved.config;
  }, []);

  const refreshActiveExchange = useCallback(async (): Promise<void> => {
    try {
      const config = await refreshResolvedConfig();

      const exchanges = config.exchanges || [];
      if (exchanges.length === 0) {
        exchangeRef.current = null;
        binanceClientRef.current = null;
        return;
      }

      const activeId = config.activeExchangeId || exchanges.find((ex) => ex.isDefault)?.id;
      const active = exchanges.find((ex) => ex.id === activeId) || exchanges[0];
      if (!active) {
        exchangeRef.current = null;
        binanceClientRef.current = null;
        return;
      }

      const creds = resolveExchangeCredentials(active);
      exchangeRef.current = ExchangeFactory.create(active.type, creds);
      recordStructuredObservation({
        eventType: "provider.init_succeeded",
        workflow: "setup",
        source: "config_refresh",
        component: "App",
        outcome: "success",
        status: "exchange_ready",
        exchange: active.type,
        details: {
          providerKind: "exchange",
          activeExchangeId: active.id,
        },
      });

      if ((active.type === "binance" || active.type === "binance_us") && creds.apiKey && creds.apiSecret) {
        const baseUrl = active.type === "binance_us" ? "https://api.binance.us" : undefined;
        binanceClientRef.current = new BinanceClient(creds.apiKey, creds.apiSecret, baseUrl);
      } else {
        binanceClientRef.current = null;
      }
    } catch (error) {
      recordStructuredObservation({
        eventType: "provider.init_failed",
        workflow: "setup",
        source: "config_refresh",
        component: "App",
        outcome: "failure",
        status: "exchange_refresh_failed",
        reason: error instanceof Error ? error.message : String(error),
        details: {
          providerKind: "exchange",
        },
      });
      // Exchange refresh failed — will retry on next config change
    }
  }, [refreshResolvedConfig]);

  const refreshActiveBroker = useCallback(async (): Promise<void> => {
    try {
      const config = await refreshResolvedConfig();

      const brokers = config.brokers || [];
      if (brokers.length === 0) {
        brokerRef.current = null;
        return;
      }

      const activeId = config.activeBrokerId || brokers.find((entry) => entry.isDefault)?.id;
      const active = brokers.find((entry) => entry.id === activeId) || brokers[0];
      if (!active) {
        brokerRef.current = null;
        return;
      }

      const creds = resolveBrokerCredentials(active);
      if (!creds.apiKey || !creds.apiSecret) {
        brokerRef.current = null;
        return;
      }

      brokerRef.current = BrokerFactory.create(active.type, creds);
      recordStructuredObservation({
        eventType: "provider.init_succeeded",
        workflow: "setup",
        source: "config_refresh",
        component: "App",
        outcome: "success",
        status: "broker_ready",
        broker: active.type,
        details: {
          providerKind: "broker",
          activeBrokerId: active.id,
          paper: active.paper,
        },
      });
    } catch (error) {
      recordStructuredObservation({
        eventType: "provider.init_failed",
        workflow: "setup",
        source: "config_refresh",
        component: "App",
        outcome: "failure",
        status: "broker_refresh_failed",
        reason: error instanceof Error ? error.message : String(error),
        details: {
          providerKind: "broker",
        },
      });
      // Broker refresh failed — will retry on next config change
    }
  }, [refreshResolvedConfig]);

  const formatCommandError = useCallback(
    (operation: string, error: unknown, context?: Record<string, unknown>): string => {
      const err = error instanceof Error ? error : new Error(String(error));
      return formatErrorWithContext(createErrorContext(err, operation, context));
    },
    []
  );

  const runLocalCommand = useCallback(async (
    submittedValue: string,
    operation: string,
    task: () => Promise<string>,
  ): Promise<void> => {
    const userMessage: ChatMessage = {
      role: "user",
      content: submittedValue.trim(),
      timestamp: formatTimestamp(),
    };

    setState((prev) => ({ ...prev, messages: [...prev.messages, userMessage], isLoading: true }));

    try {
      const content = await task();
      setState((prev) => ({
        ...prev,
        messages: [...prev.messages, { role: "gordon", content, timestamp: formatTimestamp() }],
        isLoading: false,
      }));
    } catch (error) {
      setState((prev) => ({
        ...prev,
        messages: [
          ...prev.messages,
          { role: "gordon", content: formatCommandError(operation, error), timestamp: formatTimestamp() },
        ],
        isLoading: false,
      }));
    }
  }, [formatCommandError]);

  const getCryptoPortfolioSummary = useCallback(async (): Promise<{
    message: string;
    totalValue: number;
    availableCash: number;
    holdings: Array<{ asset: string; amount: number; usdtValue: number; wallet?: string; note?: string }>;
    executionTime: number;
  }> => {
    if (!exchangeRef.current) {
      throw new Error("No active exchange configured. Use /exchange add <type> or /setup.");
    }

    const portfolioStart = Date.now();
    const allBalances = await exchangeRef.current.getAllBalances();
    const stablecoins = ["USDT", "USD", "USDC", "BUSD", "TUSD", "USDP", "FDUSD"];
    let totalValue = 0;
    let availableCash = 0;
    const holdings: Array<{ asset: string; amount: number; usdtValue: number; wallet?: string; note?: string }> = [];

    for (const balance of allBalances) {
      const amount = balance.total ?? (balance.free + balance.locked);
      if (amount <= 0) {
        continue;
      }

      let usdtValue = 0;
      if (stablecoins.includes(balance.asset)) {
        usdtValue = amount;
        if (balance.asset === "USDT" || balance.asset === "USD") {
          availableCash += amount;
        }
      } else {
        try {
          const price = await exchangeRef.current.getPrice(`${balance.asset}USDT`);
          usdtValue = amount * price;
        } catch {
          holdings.push({
            asset: balance.asset,
            amount,
            usdtValue: 0,
            wallet: "spot",
            note: "No USD rate",
          });
          continue;
        }
      }

      if (usdtValue > 0.01) {
        holdings.push({ asset: balance.asset, amount, usdtValue, wallet: "spot" });
        totalValue += usdtValue;
      }
    }

    holdings.sort((left, right) => right.usdtValue - left.usdtValue);

    const executionTime = Date.now() - portfolioStart;

    return {
      totalValue,
      availableCash,
      holdings,
      executionTime,
      message: formatPortfolioResults({
        totalValue,
        availableCash,
        holdings: holdings.map((holding) => ({
          asset: holding.asset,
          total: holding.amount,
          usdValue: holding.usdtValue,
          wallet: holding.wallet,
          note: holding.note,
        })),
        executionTime,
        maxRows: 15,
      }),
    };
  }, []);

  const getCryptoPositionsSummary = useCallback(async (): Promise<{
    message: string;
    count: number;
    totalUnrealized: number;
    positions: Array<{
      symbol: string;
      status: string;
      unrealizedPnl: number;
      unrealizedPnlPercent: number;
      minutesOpen: number;
    }>;
    alerts: string[];
  }> => {
    if (!exchangeRef.current) {
      throw new Error("No active exchange configured. Use /exchange add <type> or /setup.");
    }

    const result = await runSharedMonitorCycle(exchangeRef.current);
    if (result.updates.length === 0) {
      return {
        message: "No open crypto positions.",
        count: 0,
        totalUnrealized: 0,
        positions: [],
        alerts: [],
      };
    }

    const totalUnrealized = result.updates.reduce((sum, update) => sum + update.unrealizedPnl, 0);
    const positions = result.updates.map((update) => {
      const minutesOpen = Math.max(
        1,
        Math.round((Date.now() - new Date(update.trade.openedAt).getTime()) / 60_000),
      );

      return {
        symbol: update.trade.symbol,
        status: update.status,
        unrealizedPnl: update.unrealizedPnl,
        unrealizedPnlPercent: update.unrealizedPnlPercent,
        minutesOpen,
      };
    });
    const lines = [
      `Open crypto positions: ${positions.length}`,
      `Total unrealized PnL: $${totalUnrealized.toFixed(2)}`,
      "",
      "| Symbol | Status | Unrealized | PnL % | Minutes Open |",
      "|--------|--------|------------|-------|--------------|",
    ];

    for (const update of positions) {
      lines.push(
        `| ${update.symbol} | ${update.status} | $${update.unrealizedPnl.toFixed(2)} | ${update.unrealizedPnlPercent.toFixed(2)}% | ${update.minutesOpen} |`,
      );
    }

    if (result.alerts.length > 0) {
      lines.push("", "**Alerts**");
      for (const alert of result.alerts.slice(0, 5)) {
        lines.push(`- ${alert.message}`);
      }
    }

    return {
      message: lines.join("\n"),
      count: positions.length,
      totalUnrealized,
      positions,
      alerts: result.alerts.map((alert) => alert.message),
    };
  }, []);

  const getCryptoOpenOrdersSummary = useCallback(async (symbolFilter?: string): Promise<{
    message: string;
    count: number;
    symbolFilter?: string;
    orders: Array<{
      symbol: string;
      side: string;
      type: string;
      status: string;
      quantity: number | string;
      price: number | string;
      executedQty: number | string;
    }>;
  }> => {
    if (!exchangeRef.current) {
      throw new Error("No active exchange configured. Use /exchange add <type> or /setup.");
    }

    const normalizedSymbol = symbolFilter?.trim() ? symbolFilter.trim().toUpperCase() : undefined;
    const orders = await exchangeRef.current.getOpenOrders(normalizedSymbol);
    if (orders.length === 0) {
      return {
        message: normalizedSymbol ? `No open crypto orders for ${normalizedSymbol}.` : "No open crypto orders.",
        count: 0,
        symbolFilter: normalizedSymbol,
        orders: [],
      };
    }

    const lines = [
      normalizedSymbol ? `Open crypto orders for ${normalizedSymbol}:` : "Open crypto orders:",
      "| Symbol | Side | Type | Status | Qty | Price | Filled |",
      "|--------|------|------|--------|-----|-------|--------|",
    ];

    for (const order of orders) {
      lines.push(
        `| ${order.symbol} | ${order.side} | ${order.type} | ${order.status} | ${order.quantity} | ${order.price} | ${order.executedQty} |`,
      );
    }

    return {
      message: lines.join("\n"),
      count: orders.length,
      symbolFilter: normalizedSymbol,
      orders: orders.map((order) => ({
        symbol: order.symbol,
        side: order.side,
        type: order.type,
        status: order.status,
        quantity: order.quantity,
        price: order.price,
        executedQty: order.executedQty,
      })),
    };
  }, []);

  const getSystemStatusSummary = useCallback(async (): Promise<string> => {
    const armedStatus = await getArmedStatus();
    const exchangeStatus = await handleExchangeCommand("status");
    const brokerStatus = await handleBrokerCommand("status");
    const keyringStatus = await handleKeyringCommand("status");

    return [
      "**Gordon Status**",
      "",
      `Mode: ${armedStatus.isArmed ? "Live enabled" : "Read-only"}`,
      `Effective config mode: ${armedStatus.mode}`,
      `Armed until: ${armedStatus.armedUntil ?? "Not armed"}`,
      `Remaining armed time: ${armedStatus.remainingTime ?? "Not armed"}`,
      `Exchange route: ${exchangeRef.current ? exchangeRef.current.exchangeId : "none"}`,
      `Broker route: ${brokerRef.current ? brokerRef.current.displayName : "none"}`,
      "",
      exchangeStatus,
      "",
      brokerStatus,
      "",
      keyringStatus.message,
    ].join("\n");
  }, []);

  const applySystemMode = useCallback(async (
    submittedValue: string,
    action: "arm" | "disarm",
  ): Promise<void> => {
    const userMessage: ChatMessage = {
      role: "user",
      content: submittedValue.trim(),
      timestamp: formatTimestamp(),
    };

    setState((prev) => ({ ...prev, messages: [...prev.messages, userMessage], isLoading: true }));

    try {
      const resolved = await loadConfigBundle();
      const armHours = 24;
      const armedUntil = action === "arm"
        ? new Date(Date.now() + armHours * 60 * 60 * 1000).toISOString()
        : null;
      const nextConfig: GordonConfig = {
        ...resolved.config,
        mode: action === "arm" ? "ARMED" : "SAFE",
        armedUntil,
      };

      await saveResolvedConfig(nextConfig, resolved.layers);
      configRef.current = nextConfig;
      const refreshedConfig = await refreshResolvedConfig();

      recordStructuredObservation({
        eventType: action === "arm" ? "system.armed" : "system.disarmed",
        workflow: "execution",
        source: "app_command",
        component: "App",
        outcome: "success",
        status: action === "arm" ? "armed" : "disarmed",
        mode: refreshedConfig.mode,
        ...(armedUntil ? { durationMs: armHours * 60 * 60 * 1000 } : {}),
        details: {
          command: submittedValue.trim(),
          armedUntil,
          writeScope: getResolvedConfigWriteScope(resolved.layers),
        },
      });

      setState((prev) => ({
        ...prev,
        mode: refreshedConfig.mode,
        messages: [
          ...prev.messages,
          {
            role: "gordon",
            content: action === "arm"
              ? `System **live enabled** for ${armHours} hours.\n\nI can now execute approved trade plans. I will still ask for your explicit confirmation before placing any order.\n\nTo return to read-only mode: \`/disarm\``
              : "System **read-only**. Live order execution is disabled.",
            timestamp: formatTimestamp(),
          },
        ],
        isLoading: false,
      }));
    } catch (error) {
      setState((prev) => ({
        ...prev,
        messages: [
          ...prev.messages,
          { role: "gordon", content: formatCommandError(action, error), timestamp: formatTimestamp() },
        ],
        isLoading: false,
      }));
    }
  }, [formatCommandError, refreshResolvedConfig]);

  const getCacheSummary = useCallback(async (args: string): Promise<string> => {
    const action = args.trim().toLowerCase() || "stats";

    if (action === "clear") {
      clearToolCache();
      return "Tool cache cleared successfully.";
    }

    if (action === "prune") {
      const removed = pruneToolCache();
      return `Expired cache entries pruned: ${removed}.`;
    }

    const stats = getToolCacheStats();
    return [
      "**Tool Cache Stats**",
      "",
      `Entries: ${stats.entries}`,
      `Hits: ${stats.hits}`,
      `Misses: ${stats.misses}`,
      `Hit rate: ${(stats.hitRate * 100).toFixed(1)}%`,
      `In-flight requests: ${stats.inFlightRequests}`,
    ].join("\n");
  }, []);

  // Initialize config and LLM client on mount
  useEffect(() => {
    async function initialize(): Promise<void> {
      const deferredStartupTasks: Array<() => Promise<void>> = [];

      // Initialize database first
      await initDatabase();

      // Load .env file (if it exists)
      await loadEnvFile();

      // Bootstrap v0.7 subsystems (memory, playbooks, positions, event subscriptions)
      try {
        await bootstrapV07();
      } catch (err) {
        console.error("[v0.7] Bootstrap failed (non-fatal):", err);
      }

      // Check environment status early to get keys
      const envStatusEarly = await checkEnvStatus();

      deferredStartupTasks.push(async () => {
        try {
          await initializeContainer({
            binance: envStatusEarly.hasBinanceKeys && envStatusEarly.keys.BINANCE_API_KEY && envStatusEarly.keys.BINANCE_API_SECRET
              ? {
                  apiKey: envStatusEarly.keys.BINANCE_API_KEY,
                  apiSecret: envStatusEarly.keys.BINANCE_API_SECRET,
                }
              : undefined,
            llm: envStatusEarly.hasLLMKey
              ? {
                  openaiApiKey: envStatusEarly.keys.OPENAI_API_KEY,
                  inceptionApiKey: envStatusEarly.keys.INCEPTION_API_KEY,
                  dedalusApiKey: envStatusEarly.keys.DEDALUS_API_KEY,
                }
              : undefined,
            logLevel: (process.env.LOG_LEVEL as "debug" | "info" | "warn" | "error" | undefined) ?? "error",
          });
        } catch (error) {
          console.error("Failed to initialize service container:", error);
        }
      });

      // Use the already fetched env status
      const envStatus = envStatusEarly;

      // Load config and check onboarding status
      const { config, layers } = await loadConfigBundle();
      const persistedWorkspaceShell = await loadWorkspaceShellState().catch(() => null);
      if (persistedWorkspaceShell?.lastResults) {
        lastResultsRef.current = persistedWorkspaceShell.lastResults;
      }
      configRef.current = config;
      setState((prev) => ({ ...prev, configLayers: layers }));
      const requestedSetupMode = parseSetupWizardMode(process.env.GORDON_SETUP_MODE, "advanced");
      const requestedSetupSection = parseSetupWizardSection(process.env.GORDON_SETUP_SECTION);
      const requestedStartView = process.env.GORDON_START_VIEW;

      // Determine initial view:
      // - If keys are configured (either in .env or env vars), skip onboarding
      // - If onboarding was completed before, show welcome
      // - Otherwise show onboarding
      let initialView: AppView;
      let onboardingEntryReason = "first_run";

      if (requestedStartView === "doctor") {
        initialView = "doctor";
        onboardingEntryReason = "requested_doctor";
      } else if (requestedStartView === "quickstart") {
        initialView = "quickstart";
        onboardingEntryReason = "requested_quickstart";
      } else if (requestedStartView === "setup") {
        initialView = "setup";
        onboardingEntryReason = "requested_setup";
      } else if (envStatus.hasLLMKey) {
        // Keys are already configured - skip onboarding entirely
        initialView = "welcome";
        onboardingEntryReason = "env_llm_ready";

        // Mark onboarding as complete if it wasn't
        if (!config.onboardingComplete) {
          const updatedConfig = { ...config, onboardingComplete: true };
          configRef.current = updatedConfig;
          await saveConfig(updatedConfig);
          recordStructuredObservation({
            eventType: "setup.onboarding_auto_completed",
            workflow: "setup",
            source: "app_startup",
            component: "App",
            outcome: "success",
            status: "auto_completed",
            details: {
              envFileExists: envStatus.fileExists,
              requestedStartView: requestedStartView ?? null,
            },
          });
        }
      } else if (config.onboardingComplete) {
        // Onboarding was done but no keys - show welcome anyway
        initialView = "welcome";
        onboardingEntryReason = "config_onboarding_complete";
      } else {
        // New user without keys - show onboarding
        initialView = "onboarding";
      }

      recordStructuredObservation({
        eventType: "setup.onboarding_entry_resolved",
        workflow: "setup",
        source: "app_startup",
        component: "App",
        outcome: "info",
        status: initialView,
        reason: onboardingEntryReason,
        details: {
          requestedStartView: requestedStartView ?? null,
          requestedSetupMode,
          requestedSetupSection: requestedSetupSection ?? null,
          llmReady: envStatus.hasLLMKey,
          onboardingComplete: config.onboardingComplete,
          hasExchange: config.exchanges.length > 0,
          hasBroker: config.brokers.length > 0,
          envFileExists: envStatus.fileExists,
        },
      });

      // Initialize LLM client
      try {
        llmClientRef.current = createLLMClientFromEnv();

        deferredStartupTasks.push(async () => {
          if (envStatus.hasLLMKey) {
            try {
              await initializeTracing();
            } catch (err) {
              console.error("[Tracing] Init failed:", (err as Error).message);
            }
          }
        });

        deferredStartupTasks.push(async () => {
          try {
            await syncAgentRailMcpPlugins(config);
            await getSessionRuntime("app").initializeTooling({
              enableHotReload: true,
              intervalMs: 5000,
            });
            await initRouting();
          } catch (err) {
            console.error("[Routing] Init failed:", (err as Error).message);
          }
        });
      } catch (error) {
        console.error("Failed to initialize LLM client:", error);
      }

      // Initialize exchange based on config (preferred) or env Binance keys (fallback)
      let exchangeInitialized = false;
      if (config.exchanges && config.exchanges.length > 0) {
        const activeId = config.activeExchangeId || config.exchanges.find((ex) => ex.isDefault)?.id;
        const active = config.exchanges.find((ex) => ex.id === activeId) || config.exchanges[0];
        if (active) {
          try {
            const creds = resolveExchangeCredentials(active);
            exchangeRef.current = ExchangeFactory.create(active.type, creds);
            exchangeInitialized = true;

            if (active.type === "binance" || active.type === "binance_us") {
              const baseUrl = active.type === "binance_us" ? "https://api.binance.us" : undefined;
              binanceClientRef.current = new BinanceClient(creds.apiKey, creds.apiSecret, baseUrl);
            } else {
              binanceClientRef.current = null;
            }
          } catch {
            // Exchange initialization failed — will fall back to env-based Binance below
          }
        }
      }

      if (!exchangeInitialized && envStatus.hasBinanceKeys && envStatus.keys.BINANCE_API_KEY && envStatus.keys.BINANCE_API_SECRET) {
        try {
          binanceClientRef.current = new BinanceClient(
            envStatus.keys.BINANCE_API_KEY,
            envStatus.keys.BINANCE_API_SECRET
          );
          exchangeRef.current = new BinanceAdapter(
            envStatus.keys.BINANCE_API_KEY,
            envStatus.keys.BINANCE_API_SECRET
          );
          exchangeInitialized = true;
        } catch (error) {
          console.error("Failed to initialize Binance client:", error);
        }
      }

      if (
        !exchangeInitialized
        && envStatus.hasRobinhoodKeys
        && envStatus.keys.ROBINHOOD_API_KEY
        && envStatus.keys.ROBINHOOD_API_SECRET
      ) {
        try {
          exchangeRef.current = ExchangeFactory.create("robinhood", {
            apiKey: envStatus.keys.ROBINHOOD_API_KEY,
            apiSecret: envStatus.keys.ROBINHOOD_API_SECRET,
          });
          exchangeInitialized = true;
        } catch (error) {
          console.error("Failed to initialize Robinhood exchange:", error);
        }
      }

      // Initialize active broker from config or env fallback
      if (config.brokers && config.brokers.length > 0) {
        const activeBrokerId = config.activeBrokerId || config.brokers.find((entry) => entry.isDefault)?.id;
        const activeBroker = config.brokers.find((entry) => entry.id === activeBrokerId) || config.brokers[0];
        if (activeBroker) {
          try {
            const brokerCreds = resolveBrokerCredentials(activeBroker);
            if (brokerCreds.apiKey && brokerCreds.apiSecret) {
              brokerRef.current = BrokerFactory.create(activeBroker.type, brokerCreds);
            } else {
              brokerRef.current = null;
            }
          } catch {
            brokerRef.current = null;
          }
        }
      } else {
        const brokerEnvCandidates: Array<{
          type: Parameters<typeof BrokerFactory.create>[0];
          key?: string;
          secret?: string;
          paper?: string;
          accountId?: string;
        }> = [
          {
            type: "alpaca",
            key: envStatus.keys.ALPACA_API_KEY,
            secret: envStatus.keys.ALPACA_API_SECRET,
            paper: envStatus.keys.ALPACA_PAPER,
          },
          {
            type: "webull",
            key: envStatus.keys.WEBULL_API_KEY,
            secret: envStatus.keys.WEBULL_API_SECRET,
            paper: envStatus.keys.WEBULL_PAPER,
            accountId: envStatus.keys.WEBULL_ACCOUNT_ID,
          },
          {
            type: "schwab",
            key: envStatus.keys.SCHWAB_API_KEY,
            secret: envStatus.keys.SCHWAB_API_SECRET,
            paper: envStatus.keys.SCHWAB_PAPER,
            accountId: envStatus.keys.SCHWAB_ACCOUNT_ID,
          },
          {
            type: "tradier",
            key: envStatus.keys.TRADIER_API_KEY,
            secret: envStatus.keys.TRADIER_API_SECRET,
            paper: envStatus.keys.TRADIER_PAPER,
            accountId: envStatus.keys.TRADIER_ACCOUNT_ID,
          },
          {
            type: "tradestation",
            key: envStatus.keys.TRADESTATION_API_KEY,
            secret: envStatus.keys.TRADESTATION_API_SECRET,
            paper: envStatus.keys.TRADESTATION_PAPER,
            accountId: envStatus.keys.TRADESTATION_ACCOUNT_ID,
          },
          {
            type: "tastytrade",
            key: envStatus.keys.TASTYTRADE_API_KEY,
            secret: envStatus.keys.TASTYTRADE_API_SECRET,
            paper: envStatus.keys.TASTYTRADE_PAPER,
            accountId: envStatus.keys.TASTYTRADE_ACCOUNT_ID,
          },
          {
            type: "trading212",
            key: envStatus.keys.TRADING212_API_KEY,
            secret: envStatus.keys.TRADING212_API_SECRET,
            paper: envStatus.keys.TRADING212_PAPER,
            accountId: envStatus.keys.TRADING212_ACCOUNT_ID,
          },
          {
            type: "etrade",
            key: envStatus.keys.ETRADE_API_KEY,
            secret: envStatus.keys.ETRADE_API_SECRET,
            paper: envStatus.keys.ETRADE_PAPER,
            accountId: envStatus.keys.ETRADE_ACCOUNT_ID,
          },
          {
            type: "ibkr",
            key: envStatus.keys.IBKR_API_KEY,
            secret: envStatus.keys.IBKR_API_SECRET,
            paper: envStatus.keys.IBKR_PAPER,
            accountId: envStatus.keys.IBKR_ACCOUNT_ID,
          },
        ];

        for (const candidate of brokerEnvCandidates) {
          if (!candidate.key || !candidate.secret) continue;
          try {
            brokerRef.current = BrokerFactory.create(candidate.type, {
              apiKey: candidate.key,
              apiSecret: candidate.secret,
              paper: (candidate.paper || "true").toLowerCase() !== "false",
              accountId: candidate.accountId,
            });
            break;
          } catch {
            brokerRef.current = null;
          }
        }
      }

      if (binanceClientRef.current) {
        deferredStartupTasks.push(async () => {
          try {
            const result = await reconcileWithBinance(binanceClientRef.current!);
            if (result.ordersUpdated > 0) {
              if (process.env.GORDON_STARTUP_QUIET !== "1") {
                console.log(`Reconciliation complete: ${result.ordersUpdated} orders synced`);
              }
            }
            if (result.warnings.length > 0) {
              console.warn("Reconciliation warnings:", result.warnings);
            }
            if (result.errors.length > 0) {
              console.error("Reconciliation errors:", result.errors);
            }
          } catch (error) {
            console.error("Reconciliation failed:", error);
          }
        });

        deferredStartupTasks.push(async () => {
          const allTrades = listTrades({});
          const activeTrades = allTrades.filter(
            (t) => t.status === "OPEN" || t.status === "PARTIAL"
          );

          if (activeTrades.length === 0) {
            return;
          }

          const knownOrderOwnerKeys = buildKnownOrderOwnerKeys(activeTrades);
          try {
            const recoveryResult = await runOrderRecovery(binanceClientRef.current!, knownOrderOwnerKeys, {
              logResults: true,
            });
            if (recoveryResult.orphaned.length > 0) {
              console.warn(
                `Found ${recoveryResult.orphaned.length} orphaned orders on Binance`
              );
            }
          } catch {
            // Silently ignore - not critical for startup
          }
        });

        deferredStartupTasks.push(async () => {
          try {
            await initializeRealtimeMonitor(exchangeRef.current?.exchangeId);
          } catch (error) {
            console.warn("Real-time monitoring unavailable:", error);
          }
        });
      }

      deferredStartupTasks.push(async () => {
        try {
          getMarketEmitter();
          if (process.env.GORDON_STARTUP_QUIET !== "1") {
            console.log("[v0.7] MarketEventEmitter ready");
          }
        } catch (err) {
          console.error("[v0.7] MarketEventEmitter setup failed:", err);
        }
      });

      deferredStartupTasks.push(async () => {
        try {
          const registry = getSubscriptionRegistry();
          registry.setInvoker(async (_agentId: string, prompt: string) => {
            const runtime = getSessionRuntime("app");
            const session = await runtime.getCurrentSession();
            if (!llmClientRef.current) {
              throw new Error("LLM client not initialized for event-driven invoke.");
            }
            const gordonCtx = buildAppGordonContext({
              binance: binanceClientRef.current,
              exchange: exchangeRef.current,
              broker: brokerRef.current,
              llm: llmClientRef.current,
              config: configRef.current,
              portfolioValue: 0,
              availableCash: 0,
              userId: session?.resourceId,
              threadId: session?.threadId ?? undefined,
              credentialProfile: getRequestCredentialProfile(configRef.current),
            }) as GordonContext;
            const stream = runtime.streamMessage(prompt, {
              contextOverride: gordonCtx,
              threadId: session?.threadId ?? undefined,
              resourceId: session?.resourceId,
            });
            for await (const _event of stream) {
              // Consume stream for event-driven flows.
            }
          });
          if (process.env.GORDON_STARTUP_QUIET !== "1") {
            console.log("[v0.7] AgentInvoker wired");
          }
        } catch (err) {
          console.error("[v0.7] AgentInvoker setup failed:", err);
        }
      });

      // Initialize session for Mastra agent memory
      // Auto-resume is disabled by default - creates fresh sessions
      // Users can use /resume to continue previous sessions
      const session = await getSessionRuntime("app").initializeSession({ autoResume: false });
      if (process.env.GORDON_STARTUP_QUIET !== "1") {
        console.log(`[Gordon] Session initialized: threadId=${session.threadId}, resourceId=${session.resourceId}, isNew=${session.isNewSession}`);
      }

      // Ensure the current thread is registered in the thread registry
      // This enables thread management features like cloning and listing
      await ensureThreadRegistered();

      // Fetch thread info for status bar
      let threadStatusInfo: ThreadStatusInfo | null = null;
      if (session.threadId) {
        const threadInfo = await getThreadInfo(session.threadId);
        if (threadInfo) {
          threadStatusInfo = {
            name: threadInfo.label || "Main",
            messageCount: threadInfo.messageCount,
            isBranch: threadInfo.clonedFrom !== null,
          };
        } else {
          threadStatusInfo = {
            name: "Main",
            messageCount: 0,
            isBranch: false,
          };
        }
      }

      setState((prev) => ({
        ...prev,
        view: initialView,
        workspace: persistedWorkspaceShell?.workspace ?? prev.workspace,
        setupMode: requestedSetupMode,
        setupSection: requestedSetupSection,
        mode: config.mode,
        portfolioValue: persistedWorkspaceShell?.lastResults.portfolioSummary?.totalValue ?? prev.portfolioValue,
        availableCash: persistedWorkspaceShell?.lastResults.portfolioSummary?.availableCash ?? prev.availableCash,
        connectionStatus: llmClientRef.current ? "connected" : "disconnected",
        session,
        threadStatusInfo,
        chainStatus: {
          solana: envStatus.hasSolanaKey,
          polkadot: envStatus.hasPolkadotKey,
          chainlink: envStatus.hasChainlinkStreamsKeys,
          evm: envStatus.hasChainlinkCCIPKey,
          cdp: envStatus.hasCDPKeys,
          base: envStatus.hasBasescanKey || envStatus.hasCDPKeys,
        },
        workspaceMemory: persistedWorkspaceShell?.workspaceMemory ?? prev.workspaceMemory,
        workspaceInteraction: persistedWorkspaceShell?.workspaceInteraction ?? prev.workspaceInteraction,
      }));

      if (persistedWorkspaceShell) {
        bumpWorkspaceShellVersion();
      }

      void runDeferredTasksWithConcurrency(deferredStartupTasks);
    }

    initialize();
  }, []);

  // Automatic monitor cycle - runs every 15 minutes to check open positions
  useEffect(() => {
    const MONITOR_INTERVAL_MS = 900000; // 15 minutes

    const intervalId = setInterval(() => {
      if (!exchangeRef.current) {
        return;
      }

      if (monitorCycleInFlightRef.current) {
        return;
      }
      monitorCycleInFlightRef.current = true;

      runSharedMonitorCycle(exchangeRef.current)
        .then((result) => {
          if (result.alerts.length === 0) {
            return;
          }

          const alertMessages: ChatMessage[] = result.alerts.map((alert) => ({
            role: "gordon" as const,
            content: `[Monitor Alert] ${alert.message}`,
            timestamp: formatTimestamp(),
          }));

          appendMessages(alertMessages);
        })
        .catch((error) => {
          console.error("Monitor cycle error:", error);
        })
        .finally(() => {
          monitorCycleInFlightRef.current = false;
        });
    }, MONITOR_INTERVAL_MS);

    return () => {
      clearInterval(intervalId);
    };
  }, [appendMessages]);

  // Fetch BTC price periodically
  useEffect(() => {
    if (!exchangeRef.current) {
      return;
    }

    return subscribeToMarketPrice(exchangeRef.current, "BTCUSDT", (price) => {
      setState((prev) => ({ ...prev, btcPrice: price }));
    });
  }, []);

  useEffect(() => () => {
    activeStreamAbortControllerRef.current?.abort();
  }, []);

  const setTranscriptTypingState = useCallback((isTyping: boolean): void => {
    isUserTypingRef.current = isTyping;
    setState((prev) => (
      prev.isUserTyping === isTyping
        ? prev
        : { ...prev, isUserTyping: isTyping }
    ));
  }, []);

  const setChatDraft = useCallback((value: string): void => {
    setState((prev) => (
      prev.chatDraft === value
        ? prev
        : { ...prev, chatDraft: value }
    ));
  }, []);

  const moveTranscriptViewport = useCallback((delta: number): void => {
    if (delta === 0) {
      return;
    }

    setState((prev) => {
      if (prev.view !== "chat") {
        return prev;
      }

      const nextOffset = clampTranscriptOffset(prev, prev.transcriptBottomOffset + delta);
      if (nextOffset === prev.transcriptBottomOffset && !prev.showStartupHint) {
        return prev;
      }

      return {
        ...prev,
        transcriptBottomOffset: nextOffset,
        showStartupHint: false,
      };
    });
  }, [clampTranscriptOffset]);

  const jumpTranscriptToBottom = useCallback((): void => {
    setState((prev) => {
      if (prev.view !== "chat") {
        return prev;
      }

      if (prev.transcriptBottomOffset === 0 && !prev.showStartupHint) {
        return prev;
      }

      return {
        ...prev,
        transcriptBottomOffset: 0,
        showStartupHint: false,
      };
    });
  }, []);

  const jumpTranscriptToTop = useCallback((): void => {
    setState((prev) => {
      if (prev.view !== "chat") {
        return prev;
      }

      const nextOffset = getTranscriptMaxOffset(prev);
      if (nextOffset === prev.transcriptBottomOffset && !prev.showStartupHint) {
        return prev;
      }

      return {
        ...prev,
        transcriptBottomOffset: nextOffset,
        showStartupHint: false,
      };
    });
  }, [getTranscriptMaxOffset]);

  const openWorkspaceShell = useCallback((
    workspace: WorkspaceId,
    options?: {
      seed?: string;
      resetInput?: boolean;
      memoryPatch?: Partial<AppState["workspaceMemory"][Exclude<WorkspaceId, "desk">]>;
    },
  ): void => {
    setState((prev) => ({
      ...prev,
      view: "chat",
      workspace,
      overlay: OVERLAY_NONE,
      transcriptBottomOffset: 0,
      showStartupHint: false,
      ...(prev.view !== "chat" || options?.resetInput
        ? {
            chatDraft: "",
            isUserTyping: false,
            chatInputSeed: options?.seed ?? "",
            chatInputSeedNonce: prev.chatInputSeedNonce + 1,
          }
        : {}),
      ...(workspace !== "desk" && options?.memoryPatch
        ? {
            workspaceMemory: {
              ...prev.workspaceMemory,
              [workspace]: {
                ...prev.workspaceMemory[workspace],
                ...options.memoryPatch,
              },
            },
          }
        : {}),
    }));
  }, []);

  const openChatWorkspace = useCallback((options?: { seed?: string; resetInput?: boolean }): void => {
    openWorkspaceShell("desk", options);
  }, [openWorkspaceShell]);

  const handleWorkspaceShortcut = useCallback((digit: string): void => {
    if (state.view !== "chat" || isOverlayOpen(state.overlay)) {
      return;
    }

    const nextWorkspace = getWorkspaceByShortcut(digit);
    if (!nextWorkspace) {
      return;
    }

    openWorkspaceShell(nextWorkspace, { seed: "", resetInput: true });
  }, [openWorkspaceShell, state.overlay, state.view]);

  const openQuickActionsOverlay = useCallback((): void => {
    setState((prev) => ({
      ...prev,
      view: "chat",
      overlay: openOverlay("quick-actions"),
      showStartupHint: false,
    }));
  }, []);

  const openShortcutsOverlay = useCallback((): void => {
    setState((prev) => ({
      ...prev,
      overlay: openOverlay("shortcuts"),
    }));
  }, []);

  const closeOverlay = useCallback((): void => {
    setState((prev) => ({ ...prev, overlay: OVERLAY_NONE }));
  }, []);

  const cancelActiveResponse = useCallback((): void => {
    const controller = activeStreamAbortControllerRef.current;
    if (!controller || controller.signal.aborted) {
      return;
    }

    controller.abort();
    setState((prev) => ({
      ...prev,
      activityStatus: "Stopping current response...",
      activeToolCall: null,
    }));
  }, []);

  const processSubmission = useCallback(async (value: string): Promise<void> => {
    if (!value.trim()) return;

    const queuedIntent = parseQueuedSubmission(value);
    const normalizedValue = queuedIntent?.submitValue ?? value.trim();
    if (!normalizedValue) return;

    const parsedCommand = parseSlashCommand(normalizedValue);
    if (!parsedCommand) {
      const approvalShortcut = parseRuntimeApprovalShortcut(normalizedValue);
      if (approvalShortcut) {
        const approvalArgs = [
          approvalShortcut.requestId,
          approvalShortcut.persist ? "persist" : null,
          approvalShortcut.decision === "deny" ? approvalShortcut.reason ?? null : null,
        ].filter(Boolean).join(" ");

        await runLocalCommand(
          value,
          approvalShortcut.decision === "approve" ? "runtime approve" : "runtime deny",
          async () => applyRuntimeApprovalDecision(
            getSessionRuntime("app"),
            approvalArgs,
            approvalShortcut.decision,
          ),
        );
        return;
      }

      const systemShortcut = parseSystemShortcut(normalizedValue);
      if (systemShortcut === "status") {
        await runLocalCommand(value, "status", async () => getSystemStatusSummary());
        return;
      }

      if (systemShortcut === "arm" || systemShortcut === "disarm") {
        const explanation = systemShortcut === "arm"
          ? "Use `/arm` to enable live trading."
          : "Use `/disarm` to return Gordon to read-only mode.";

        await runLocalCommand(value, systemShortcut, async () => (
          `${explanation}\n\nMode changes stay slash-only so Gordon does not mutate execution state from plain chat text.`
        ));
        return;
      }
    }

    setState((prev) => (
      prev.transcriptBottomOffset === 0 && !prev.showStartupHint
        ? prev
        : {
            ...prev,
            transcriptBottomOffset: 0,
            showStartupHint: false,
          }
    ));

    // Check for slash commands
    let messageToSend = normalizedValue;
    let displayMessage = normalizedValue;
    let requestedActionId: string | undefined;
    let requestedTaskScope: GordonContext["requestedTaskScope"];
    const credentialProfile = getRequestCredentialProfile(configRef.current);

    if (parsedCommand) {
      const { command, args } = parsedCommand;
      const requestedAction = getActionBySlashName(command.name);
      requestedActionId = requestedAction?.id;
      requestedTaskScope = requestedAction?.taskScope;

      if (command.name === "portfolio") {
        if (isStocksMarketArgs(args) || (!exchangeRef.current && brokerRef.current)) {
          const stocksArgs = stripStocksMarketPrefix(args);
          await runLocalCommand(value, "portfolio", async () => {
            const message = await handleStocksCommand(`account ${stocksArgs}`.trim());
            await refreshActiveBroker();
            return message;
          });
          return;
        }

        await runLocalCommand(value, "portfolio", async () => {
          const summary = await getCryptoPortfolioSummary();
          lastResultsRef.current.portfolioSummary = summary;
          appStore.updateWorkspaceMemory("monitor", {
            focusSection: "book",
          });
          bumpWorkspaceShellVersion();
          setState((prev) => ({
            ...prev,
            portfolioValue: summary.totalValue,
            availableCash: summary.availableCash,
          }));
          return summary.message;
        });
        return;
      }

      // Handle menu-type commands - just convert to prompts, let agent handle
      if (command.action === "menu" && command.target === "setup") {
        setState((prev) => ({
          ...prev,
          view: "setup",
          overlay: OVERLAY_NONE,
          setupMode: "advanced",
          setupSection: null,
        }));
        return;
      }

      if (command.action === "menu" && command.target === "menu") {
        if (state.view === "chat") {
          openQuickActionsOverlay();
        } else {
          setState((prev) => ({ ...prev, view: "menu", overlay: OVERLAY_NONE }));
        }
        return;
      }

      if (command.action === "menu" && command.target === "chat") {
        openChatWorkspace();
        return;
      }

      if (command.action === "menu" && command.target === "workspace-market") {
        openWorkspaceShell("market");
        return;
      }

      if (command.action === "menu" && command.target === "workspace-plan") {
        openWorkspaceShell("plan");
        return;
      }

      if (command.action === "menu" && command.target === "workspace-lab") {
        openWorkspaceShell("lab");
        return;
      }

      if (command.action === "menu" && command.target === "workspace-monitor") {
        openWorkspaceShell("monitor");
        return;
      }

      if (command.action === "menu" && command.target === "configure") {
        const section = parseSetupWizardSection(args.trim() || undefined);
        setState((prev) => ({
          ...prev,
          view: "setup",
          overlay: OVERLAY_NONE,
          setupMode: section ? "configure" : "advanced",
          setupSection: section,
        }));
        return;
      }

      if (command.action === "menu" && command.target === "doctor") {
        setState((prev) => ({ ...prev, view: "doctor", overlay: OVERLAY_NONE }));
        return;
      }

      if (command.action === "menu" && command.target === "telemetry") {
        await runLocalCommand(value, "telemetry", async () => {
          const result = await handleTelemetryCommand(args);
          if (result.success) {
            await refreshResolvedConfig();
          }
          return result.message;
        });
        return;
      }

      if (command.action === "menu" && command.target === "context") {
        await runLocalCommand(value, "context", async () => {
          const result = await handleContextCommand(args, state.session?.threadId);
          return result.message;
        });
        return;
      }

      if (command.action === "menu" && command.target === "model") {
        setState((prev) => ({ ...prev, view: "model", overlay: OVERLAY_NONE }));
        return;
      }

      if (command.action === "menu" && command.target === "shortcuts") {
        openShortcutsOverlay();
        return;
      }

      // Handle theme command
      if (command.action === "menu" && command.target === "theme") {
        const newTheme = args === "dark" || args === "light" ? args : "toggle";
        onThemeChange(newTheme);

        const themeMessage: ChatMessage = {
          role: "gordon",
          content: newTheme === "toggle"
            ? "Theme toggled. Use `/theme dark` or `/theme light` to set a specific theme."
            : `Theme switched to ${newTheme} mode.`,
          timestamp: formatTimestamp(),
        };
        setState((prev) => ({
          ...prev,
          messages: [
            ...prev.messages,
            { role: "user", content: value.trim(), timestamp: formatTimestamp() },
            themeMessage,
          ],
        }));
        return;
      }

      // Handle /resume command - resume previous session with memory context
      if (command.action === "menu" && command.target === "resume") {
        (async () => {
          const runtime = getSessionRuntime("app");
          const resumed = await runtime.resumeSession();
          const persistedWorkspaceShell = await loadWorkspaceShellState().catch(() => null);
          if (persistedWorkspaceShell?.lastResults) {
            lastResultsRef.current = persistedWorkspaceShell.lastResults;
            bumpWorkspaceShellVersion();
          }
          if (resumed) {
            const restoredMessages = buildChatMessagesFromRuntimeTranscript(runtime.getTranscript());
            const resumeMessage: ChatMessage = {
              role: "gordon",
              content: `Session resumed.\n\n**Session Details:**\n- Thread ID: \`${resumed.threadId.slice(0, 20)}...\`\n- Resource ID: \`${resumed.resourceId}\`\n- Restored messages: ${restoredMessages.length}\n\nI restored the runtime transcript for this session. How can I help you today?`,
              timestamp: formatTimestamp(),
              badge: "System",
            };
            setState((prev) => ({
              ...prev,
              session: resumed,
              workspace: persistedWorkspaceShell?.workspace ?? prev.workspace,
              workspaceMemory: persistedWorkspaceShell?.workspaceMemory ?? prev.workspaceMemory,
              workspaceInteraction: persistedWorkspaceShell?.workspaceInteraction ?? prev.workspaceInteraction,
              portfolioValue: persistedWorkspaceShell?.lastResults.portfolioSummary?.totalValue ?? prev.portfolioValue,
              availableCash: persistedWorkspaceShell?.lastResults.portfolioSummary?.availableCash ?? prev.availableCash,
              messages: [...restoredMessages, resumeMessage],
            }));
            void updateThreadStatusInfo(resumed.threadId);
          } else {
            // No previous session to resume
            const newSession = await runtime.startNewSession();
            const noSessionMessage: ChatMessage = {
              role: "gordon",
              content: `No previous session found. Starting a fresh session.\n\n**New Session Details:**\n- Thread ID: \`${newSession.threadId.slice(0, 20)}...\`\n- Resource ID: \`${newSession.resourceId}\``,
              timestamp: formatTimestamp(),
            };
            setState((prev) => ({
              ...prev,
              session: newSession,
              workspace: persistedWorkspaceShell?.workspace ?? prev.workspace,
              workspaceMemory: persistedWorkspaceShell?.workspaceMemory ?? prev.workspaceMemory,
              workspaceInteraction: persistedWorkspaceShell?.workspaceInteraction ?? prev.workspaceInteraction,
              portfolioValue: persistedWorkspaceShell?.lastResults.portfolioSummary?.totalValue ?? prev.portfolioValue,
              availableCash: persistedWorkspaceShell?.lastResults.portfolioSummary?.availableCash ?? prev.availableCash,
              messages: [
                ...prev.messages,
                { role: "user", content: value.trim(), timestamp: formatTimestamp() },
                noSessionMessage,
              ],
            }));
            void updateThreadStatusInfo(newSession.threadId);
          }
        })();
        return;
      }

      // Handle /new-session command - start a fresh session
      if (command.action === "menu" && command.target === "new-session") {
        (async () => {
          const newSession = await getSessionRuntime("app").startNewSession();
          const newSessionMessage: ChatMessage = {
            role: "gordon",
            content: `Started a fresh session! Previous memory context has been cleared.\n\n**New Session Details:**\n- Thread ID: \`${newSession.threadId.slice(0, 20)}...\`\n- Resource ID: \`${newSession.resourceId}\`\n\nReady to start fresh. What would you like to do?`,
            timestamp: formatTimestamp(),
          };
          setState((prev) => ({
            ...prev,
            session: newSession,
            messages: [
              { role: "user", content: value.trim(), timestamp: formatTimestamp() },
              newSessionMessage,
            ],
          }));
        })();
        return;
      }

      // Handle /session command - show current session info
      if (command.action === "menu" && command.target === "session-info") {
        void runLocalCommand(value, "session", async () => formatRuntimeSessionInfo(getSessionRuntime("app")));
        return;
      }

      if (command.action === "menu" && command.target === "runtime-state") {
        void runLocalCommand(value, "runtime", async () => formatRuntimeState(getSessionRuntime("app")));
        return;
      }

      if (command.action === "menu" && command.target === "runtime-plugins") {
        void runLocalCommand(value, "runtime plugins", async () => formatRuntimePlugins(getSessionRuntime("app")));
        return;
      }

      if (command.action === "menu" && command.target === "runtime-transcript") {
        void runLocalCommand(value, "runtime transcript", async () => formatRuntimeTranscript(getSessionRuntime("app"), args));
        return;
      }

      if (command.action === "menu" && command.target === "runtime-scratchpad") {
        void runLocalCommand(value, "runtime scratchpad", async () => formatRuntimeScratchpad(getSessionRuntime("app"), args));
        return;
      }

      if (command.action === "menu" && command.target === "runtime-handoffs") {
        void runLocalCommand(value, "runtime handoffs", async () => formatRuntimeHandoffs(getSessionRuntime("app")));
        return;
      }

      if (command.action === "menu" && command.target === "runtime-approvals") {
        void runLocalCommand(value, "runtime approvals", async () => formatRuntimeApprovals(getSessionRuntime("app")));
        return;
      }

      if (command.action === "menu" && command.target === "runtime-approve") {
        void runLocalCommand(value, "runtime approval", async () =>
          applyRuntimeApprovalDecision(getSessionRuntime("app"), args, "approve"));
        return;
      }

      if (command.action === "menu" && command.target === "runtime-deny") {
        void runLocalCommand(value, "runtime denial", async () =>
          applyRuntimeApprovalDecision(getSessionRuntime("app"), args, "deny"));
        return;
      }

      if (command.action === "menu" && command.target === "runtime-bridge") {
        void runLocalCommand(value, "runtime bridge", async () => formatRuntimeBridge(getSessionRuntime("app")));
        return;
      }

      if (command.action === "menu" && command.target === "runtime-history") {
        void runLocalCommand(value, "runtime history", async () => formatRuntimeHistory(getSessionRuntime("app"), args));
        return;
      }

      // Handle /clone command - clone current thread for "what if" testing
      if (command.action === "menu" && command.target === "clone-thread") {
        (async () => {
          if (!state.session?.threadId) {
            const errorMessage: ChatMessage = {
              role: "gordon",
              content: "No active session to clone. Start a conversation first.",
              timestamp: formatTimestamp(),
            };
            setState((prev) => ({
              ...prev,
              messages: [
                ...prev.messages,
                { role: "user", content: value.trim(), timestamp: formatTimestamp() },
                errorMessage,
              ],
            }));
            return;
          }

          const label = args || undefined;
          const result = await cloneThread(state.session.threadId, undefined, label);

          if (result.success && result.newThreadId) {
            // Get the current thread's info to show the source label
            const currentThreadInfo = await getThreadInfo(state.session.threadId);
            const sourceLabel = currentThreadInfo?.label || "Main Thread";
            const branchLabel = label || `Clone of ${sourceLabel}`;
            appendActionLogEntry({
              threadId: result.newThreadId,
              resourceId: state.session?.resourceId,
              sessionId: result.newThreadId,
              entryType: "branch_summary",
              title: "Branch created",
              content: `Created branch "${branchLabel}" from "${sourceLabel}"`,
              payload: {
                sourceThreadId: state.session.threadId,
                clonedFrom: sourceLabel,
                messagesCopied: result.messagesCopied,
              },
            });

            const cloneMessage: ChatMessage = {
              role: "gordon",
              content: `Created branch: "${branchLabel}"\n` +
                `  Branched from: ${sourceLabel} at message #${result.messagesCopied}\n` +
                `  Tip: Changes here won't affect the original thread\n\n` +
                `Use \`/switch ${result.newThreadId.slice(0, 15)}\` to switch to the new branch, or \`/threads\` to see all threads.`,
              timestamp: formatTimestamp(),
            };
            setState((prev) => ({
              ...prev,
              messages: [
                ...prev.messages,
                { role: "user", content: value.trim(), timestamp: formatTimestamp() },
                cloneMessage,
              ],
            }));
          } else {
            const errorMessage: ChatMessage = {
              role: "gordon",
              content: `**Failed to clone thread.**\n\nError: ${result.error || "Unknown error"}`,
              timestamp: formatTimestamp(),
            };
            setState((prev) => ({
              ...prev,
              messages: [
                ...prev.messages,
                { role: "user", content: value.trim(), timestamp: formatTimestamp() },
                errorMessage,
              ],
            }));
          }
        })();
        return;
      }

      // Handle /threads command - list all threads
      if (command.action === "menu" && command.target === "list-threads") {
        (async () => {
          const threads = await listThreads();
          const threadTree = await listThreadTree();

          if (threads.length === 0) {
            const noThreadsMessage: ChatMessage = {
              role: "gordon",
              content: "No threads found. Your current conversation will be tracked once you start chatting.",
              timestamp: formatTimestamp(),
            };
            setState((prev) => ({
              ...prev,
              messages: [
                ...prev.messages,
                { role: "user", content: value.trim(), timestamp: formatTimestamp() },
                noThreadsMessage,
              ],
            }));
            return;
          }

          const lines = [
            "**Session Tree:**\n",
            "| Status | Label | Messages | Created | Last Active |",
            "|--------|-------|----------|---------|-------------|",
          ];

          for (const thread of threads) {
            const status = thread.isActive ? "**ACTIVE**" : "";
            const created = new Date(thread.createdAt).toLocaleDateString();
            const lastActive = new Date(thread.lastActiveAt).toLocaleDateString();
            const cloneInfo = thread.clonedFrom ? " (clone)" : "";
            lines.push(
              `| ${status} | ${thread.label}${cloneInfo} | ${thread.messageCount} | ${created} | ${lastActive} |`
            );
          }

          lines.push("\n**Branch structure:**");
          for (const thread of threadTree) {
            const indent = "  ".repeat(thread.depth);
            const branchGlyph = thread.depth === 0 ? "•" : "└";
            const activeMarker = thread.isActive ? " [current]" : "";
            const childInfo = thread.childCount > 0 ? ` (${thread.childCount} branch${thread.childCount === 1 ? "" : "es"})` : "";
            lines.push(`${indent}${branchGlyph} ${thread.label}${activeMarker}${childInfo}`);
          }

          lines.push("\n**Thread IDs for switching:**");
          for (const thread of threads) {
            const activeMarker = thread.isActive ? " (current)" : "";
            lines.push(`- \`${thread.threadId.slice(0, 20)}...\`${activeMarker} - ${thread.label}`);
          }

          lines.push("\nUse `/switch <threadId>` to switch threads or `/clone` to create a branch.");

          const threadsMessage: ChatMessage = {
            role: "gordon",
            content: lines.join("\n"),
            timestamp: formatTimestamp(),
          };
          setState((prev) => ({
            ...prev,
            messages: [
              ...prev.messages,
              { role: "user", content: value.trim(), timestamp: formatTimestamp() },
              threadsMessage,
            ],
          }));
        })();
        return;
      }

      // Handle /switch command - switch to a different thread
      if (command.action === "menu" && command.target === "switch-thread") {
        (async () => {
          if (!args) {
            // Show available threads
            const threads = await listThreads();
            const lines = ["**Which thread would you like to switch to?**\n"];

            if (threads.length === 0) {
              lines.push("No threads available. Use `/clone` to create a branch first.");
            } else {
              for (const thread of threads) {
                const activeMarker = thread.isActive ? " (current)" : "";
                lines.push(`- \`${thread.threadId.slice(0, 20)}\`${activeMarker} - ${thread.label}`);
              }
              lines.push("\nUsage: `/switch <threadId>`");
            }

            const helpMessage: ChatMessage = {
              role: "gordon",
              content: lines.join("\n"),
              timestamp: formatTimestamp(),
            };
            setState((prev) => ({
              ...prev,
              messages: [
                ...prev.messages,
                { role: "user", content: value.trim(), timestamp: formatTimestamp() },
                helpMessage,
              ],
            }));
            return;
          }

          // Find matching thread (allow partial match)
          const threads = await listThreads();
          const targetThread = threads.find((t) =>
            t.threadId.startsWith(args) || t.threadId.includes(args)
          );

          if (!targetThread) {
            const errorMessage: ChatMessage = {
              role: "gordon",
              content: `**Thread not found.**\n\nNo thread matching "${args}" was found. Use \`/threads\` to see available threads.`,
              timestamp: formatTimestamp(),
            };
            setState((prev) => ({
              ...prev,
              messages: [
                ...prev.messages,
                { role: "user", content: value.trim(), timestamp: formatTimestamp() },
                errorMessage,
              ],
            }));
            return;
          }

          const result = await switchThread(targetThread.threadId);

          if (result.success) {
            // Update local session state
            const newSession: SessionInfo = {
              resourceId: state.session?.resourceId || "default",
              threadId: result.threadId,
              isNewSession: false,
              previousThreadId: result.previousThreadId,
            };

            // Calculate relative time for "last active"
            const lastActiveDate = new Date(targetThread.lastActiveAt);
            const now = new Date();
            const diffMs = now.getTime() - lastActiveDate.getTime();
            const diffMins = Math.floor(diffMs / 60000);
            const diffHours = Math.floor(diffMs / 3600000);
            const diffDays = Math.floor(diffMs / 86400000);
            let lastActiveStr: string;
            if (diffMins < 1) {
              lastActiveStr = "Just now";
            } else if (diffMins < 60) {
              lastActiveStr = `${diffMins} minute${diffMins === 1 ? "" : "s"} ago`;
            } else if (diffHours < 24) {
              lastActiveStr = `${diffHours} hour${diffHours === 1 ? "" : "s"} ago`;
            } else {
              lastActiveStr = `${diffDays} day${diffDays === 1 ? "" : "s"} ago`;
            }

            // Build enhanced switch message
            const branchInfo = targetThread.clonedFrom
              ? `\n  Type: Branch (cloned from another thread)`
              : `\n  Type: Original thread`;

            const switchMessage: ChatMessage = {
              role: "gordon",
              content: `Switched to thread: "${targetThread.label}"\n` +
                `  Last active: ${lastActiveStr}\n` +
                `  Messages: ${targetThread.messageCount}` +
                branchInfo +
                `\n\nYour previous thread is still available via \`/threads\`.`,
              timestamp: formatTimestamp(),
            };

            // Update thread status info
            const newThreadStatusInfo: ThreadStatusInfo = {
              name: targetThread.label,
              messageCount: targetThread.messageCount,
              isBranch: targetThread.clonedFrom !== null,
            };

            setState((prev) => ({
              ...prev,
              session: newSession,
              threadStatusInfo: newThreadStatusInfo,
              messages: [
                { role: "user", content: value.trim(), timestamp: formatTimestamp() },
                switchMessage,
              ],
            }));
          } else {
            const errorMessage: ChatMessage = {
              role: "gordon",
              content: `**Failed to switch thread.**\n\nError: ${result.error || "Unknown error"}`,
              timestamp: formatTimestamp(),
            };
            setState((prev) => ({
              ...prev,
              messages: [
                ...prev.messages,
                { role: "user", content: value.trim(), timestamp: formatTimestamp() },
                errorMessage,
              ],
            }));
          }
        })();
        return;
      }

      // Handle /thread-info command - get info about a specific thread
      if (command.action === "menu" && command.target === "thread-info") {
        (async () => {
          const threadId = args || state.session?.threadId;

          if (!threadId) {
            const errorMessage: ChatMessage = {
              role: "gordon",
              content: "No thread specified and no active session. Use `/threads` to see available threads.",
              timestamp: formatTimestamp(),
            };
            setState((prev) => ({
              ...prev,
              messages: [
                ...prev.messages,
                { role: "user", content: value.trim(), timestamp: formatTimestamp() },
                errorMessage,
              ],
            }));
            return;
          }

          // Find matching thread
          const threads = await listThreads();
          const targetThread = threads.find((t) =>
            t.threadId.startsWith(threadId) || t.threadId.includes(threadId) || t.threadId === threadId
          );

          if (!targetThread) {
            const errorMessage: ChatMessage = {
              role: "gordon",
              content: `**Thread not found.**\n\nNo thread matching "${threadId}" was found.`,
              timestamp: formatTimestamp(),
            };
            setState((prev) => ({
              ...prev,
              messages: [
                ...prev.messages,
                { role: "user", content: value.trim(), timestamp: formatTimestamp() },
                errorMessage,
              ],
            }));
            return;
          }

          const info = await getThreadInfo(targetThread.threadId);

          if (info) {
            // Calculate session duration
            const createdDate = new Date(info.createdAt);
            const lastActiveDate = new Date(info.lastActiveAt);
            const durationMs = lastActiveDate.getTime() - createdDate.getTime();
            const durationMins = Math.floor(durationMs / 60000);
            const durationHours = Math.floor(durationMs / 3600000);
            let durationStr: string;
            if (durationMins < 60) {
              durationStr = `${durationMins} minute${durationMins === 1 ? "" : "s"}`;
            } else if (durationHours < 24) {
              const mins = durationMins % 60;
              durationStr = `${durationHours}h ${mins}m`;
            } else {
              const days = Math.floor(durationHours / 24);
              const hours = durationHours % 24;
              durationStr = `${days}d ${hours}h`;
            }

            // Calculate relative time for "last active"
            const now = new Date();
            const diffMs = now.getTime() - lastActiveDate.getTime();
            const diffMins = Math.floor(diffMs / 60000);
            const diffHours = Math.floor(diffMs / 3600000);
            const diffDays = Math.floor(diffMs / 86400000);
            let lastActiveStr: string;
            if (diffMins < 1) {
              lastActiveStr = "Just now";
            } else if (diffMins < 60) {
              lastActiveStr = `${diffMins} minute${diffMins === 1 ? "" : "s"} ago`;
            } else if (diffHours < 24) {
              lastActiveStr = `${diffHours} hour${diffHours === 1 ? "" : "s"} ago`;
            } else {
              lastActiveStr = `${diffDays} day${diffDays === 1 ? "" : "s"} ago`;
            }

            // Build thread type info
            let threadTypeInfo: string;
            if (info.clonedFrom) {
              // Try to get the source thread's label
              const sourceInfo = await getThreadInfo(info.clonedFrom);
              const sourceLabel = sourceInfo?.label || info.clonedFrom.slice(0, 15) + "...";
              threadTypeInfo = `  Type: Branch (cloned from "${sourceLabel}")`;
            } else {
              threadTypeInfo = `  Type: Original thread`;
            }

            // Build the info message with enhanced details
            const infoMessage: ChatMessage = {
              role: "gordon",
              content: `Thread Info: "${info.label}"\n\n` +
                `  Status: ${info.isActive ? "ACTIVE (current thread)" : "Inactive"}\n` +
                `  Messages: ${info.messageCount}\n` +
                `  Created: ${createdDate.toLocaleString()}\n` +
                `  Last active: ${lastActiveStr}\n` +
                `  Duration: ${durationStr}\n` +
                threadTypeInfo +
                (info.isActive ? "\n\n  This is your current thread." : `\n\n  Use \`/switch ${info.threadId.slice(0, 15)}\` to switch to this thread.`),
              timestamp: formatTimestamp(),
            };
            setState((prev) => ({
              ...prev,
              messages: [
                ...prev.messages,
                { role: "user", content: value.trim(), timestamp: formatTimestamp() },
                infoMessage,
              ],
            }));
          }
        })();
        return;
      }

      // Handle /delete-thread command - delete a thread
      if (command.action === "menu" && command.target === "delete-thread") {
        (async () => {
          if (!args) {
            const helpMessage: ChatMessage = {
              role: "gordon",
              content: "**Usage:** `/delete-thread <threadId>`\n\nUse `/threads` to see available threads. Note: You cannot delete the currently active thread.",
              timestamp: formatTimestamp(),
            };
            setState((prev) => ({
              ...prev,
              messages: [
                ...prev.messages,
                { role: "user", content: value.trim(), timestamp: formatTimestamp() },
                helpMessage,
              ],
            }));
            return;
          }

          // Find matching thread
          const threads = await listThreads();
          const targetThread = threads.find((t) =>
            t.threadId.startsWith(args) || t.threadId.includes(args)
          );

          if (!targetThread) {
            const errorMessage: ChatMessage = {
              role: "gordon",
              content: `**Thread not found.**\n\nNo thread matching "${args}" was found.`,
              timestamp: formatTimestamp(),
            };
            setState((prev) => ({
              ...prev,
              messages: [
                ...prev.messages,
                { role: "user", content: value.trim(), timestamp: formatTimestamp() },
                errorMessage,
              ],
            }));
            return;
          }

          const result = await deleteThread(targetThread.threadId);

          if (result.success) {
            const deleteMessage: ChatMessage = {
              role: "gordon",
              content: `**Thread deleted:** ${targetThread.label}\n\nThe thread and its messages have been removed.`,
              timestamp: formatTimestamp(),
            };
            setState((prev) => ({
              ...prev,
              messages: [
                ...prev.messages,
                { role: "user", content: value.trim(), timestamp: formatTimestamp() },
                deleteMessage,
              ],
            }));
          } else {
            const errorMessage: ChatMessage = {
              role: "gordon",
              content: `**Failed to delete thread.**\n\nError: ${result.error || "Unknown error"}`,
              timestamp: formatTimestamp(),
            };
            setState((prev) => ({
              ...prev,
              messages: [
                ...prev.messages,
                { role: "user", content: value.trim(), timestamp: formatTimestamp() },
                errorMessage,
              ],
            }));
          }
        })();
        return;
      }

      // Handle /rename-thread command - rename a thread
      if (command.action === "menu" && command.target === "rename-thread") {
        (async () => {
          if (!args) {
            const helpMessage: ChatMessage = {
              role: "gordon",
              content: "**Usage:** `/rename-thread <threadId> <new-label>`\n\nExample: `/rename-thread thread-abc BTC Analysis Branch`",
              timestamp: formatTimestamp(),
            };
            setState((prev) => ({
              ...prev,
              messages: [
                ...prev.messages,
                { role: "user", content: value.trim(), timestamp: formatTimestamp() },
                helpMessage,
              ],
            }));
            return;
          }

          const parts = args.split(/\s+/);
          const threadIdArg = parts[0];
          const newLabel = parts.slice(1).join(" ");

          if (!threadIdArg || !newLabel) {
            const helpMessage: ChatMessage = {
              role: "gordon",
              content: "**Usage:** `/rename-thread <threadId> <new-label>`\n\nBoth thread ID and new label are required.",
              timestamp: formatTimestamp(),
            };
            setState((prev) => ({
              ...prev,
              messages: [
                ...prev.messages,
                { role: "user", content: value.trim(), timestamp: formatTimestamp() },
                helpMessage,
              ],
            }));
            return;
          }

          // Find matching thread
          const threads = await listThreads();
          const targetThread = threads.find((t) =>
            t.threadId.startsWith(threadIdArg) || t.threadId.includes(threadIdArg)
          );

          if (!targetThread) {
            const errorMessage: ChatMessage = {
              role: "gordon",
              content: `**Thread not found.**\n\nNo thread matching "${threadIdArg}" was found.`,
              timestamp: formatTimestamp(),
            };
            setState((prev) => ({
              ...prev,
              messages: [
                ...prev.messages,
                { role: "user", content: value.trim(), timestamp: formatTimestamp() },
                errorMessage,
              ],
            }));
            return;
          }

          const result = await updateThreadLabel(targetThread.threadId, newLabel);

          if (result.success) {
            appendActionLogEntry({
              threadId: targetThread.threadId,
              resourceId: targetThread.resourceId,
              sessionId: targetThread.threadId,
              entryType: "label",
              title: "Thread renamed",
              content: `"${targetThread.label}" -> "${newLabel}"`,
              label: newLabel,
              payload: {
                previousLabel: targetThread.label,
                nextLabel: newLabel,
              },
            });
            const renameMessage: ChatMessage = {
              role: "gordon",
              content: `**Thread renamed!**\n\n"${targetThread.label}" is now "${newLabel}"`,
              timestamp: formatTimestamp(),
            };
            setState((prev) => ({
              ...prev,
              messages: [
                ...prev.messages,
                { role: "user", content: value.trim(), timestamp: formatTimestamp() },
                renameMessage,
              ],
            }));
          } else {
            const errorMessage: ChatMessage = {
              role: "gordon",
              content: `**Failed to rename thread.**\n\nError: ${result.error || "Unknown error"}`,
              timestamp: formatTimestamp(),
            };
            setState((prev) => ({
              ...prev,
              messages: [
                ...prev.messages,
                { role: "user", content: value.trim(), timestamp: formatTimestamp() },
                errorMessage,
              ],
            }));
          }
        })();
        return;
      }

      if (command.action === "menu" && command.target === "action-log") {
        (async () => {
          const parsed = parseActionLogArgs(args);
          const targetThread = parsed.sessionId === "daemon"
            ? null
            : await resolveThreadFromQuery(parsed.threadQuery);

          if (!parsed.sessionId && parsed.threadQuery && !targetThread) {
            const errorMessage: ChatMessage = {
              role: "gordon",
              content: `No thread matching "${parsed.threadQuery}" was found.`,
              timestamp: formatTimestamp(),
            };
            setState((prev) => ({
              ...prev,
              messages: [
                ...prev.messages,
                { role: "user", content: value.trim(), timestamp: formatTimestamp() },
                errorMessage,
              ],
            }));
            return;
          }

          const entries = listActionLogEntries({
            threadId: targetThread?.threadId,
            sessionId: parsed.sessionId,
            entryTypes: parsed.entryTypes,
            bookmarkedOnly: parsed.bookmarkedOnly,
            limit: parsed.limit,
          });

          const title = parsed.sessionId === "daemon"
            ? "Daemon action log"
            : targetThread
              ? `Action log for ${targetThread.label}`
              : "Current thread action log";

          const response: ChatMessage = {
            role: "gordon",
            content: formatActionLogEntries(entries, title),
            timestamp: formatTimestamp(),
          };

          setState((prev) => ({
            ...prev,
            messages: [
              ...prev.messages,
              { role: "user", content: value.trim(), timestamp: formatTimestamp() },
              response,
            ],
          }));
        })();
        return;
      }

      if (command.action === "menu" && command.target === "bookmark-entry") {
        (async () => {
          const [rawTarget, ...labelParts] = args.split(/\s+/).filter(Boolean);
          const targetThread = await resolveThreadFromQuery();
          const entries = listActionLogEntries({
            threadId: targetThread?.threadId,
            limit: 100,
          });
          const targetEntryId = resolveBookmarkedTargetId(rawTarget, entries);
          if (!targetEntryId) {
            const errorMessage: ChatMessage = {
              role: "gordon",
              content: "No matching action-log entry found. Use `/action-log` first to inspect entry IDs.",
              timestamp: formatTimestamp(),
            };
            setState((prev) => ({
              ...prev,
              messages: [
                ...prev.messages,
                { role: "user", content: value.trim(), timestamp: formatTimestamp() },
                errorMessage,
              ],
            }));
            return;
          }

          const bookmarkLabel = labelParts.join(" ").trim() || undefined;
          const updated = setActionLogBookmarked(targetEntryId, true, bookmarkLabel);
          const targetEntry = getActionLogEntry(targetEntryId);
          if (updated && targetEntry) {
            appendCurrentActionLogEntry({
              entryType: "bookmark",
              title: "Bookmark created",
              content: `Bookmarked ${targetEntry.title}`,
              parentEntryId: targetEntryId,
              label: bookmarkLabel,
              payload: {
                targetEntryId,
                bookmarkLabel,
              },
            });
          }

          const bookmarkMessage: ChatMessage = {
            role: "gordon",
            content: updated && targetEntry
              ? `Bookmarked \`${targetEntryId.slice(0, 8)}\` - ${targetEntry.title}`
              : "Failed to bookmark the requested entry.",
            timestamp: formatTimestamp(),
          };
          setState((prev) => ({
            ...prev,
            messages: [
              ...prev.messages,
              { role: "user", content: value.trim(), timestamp: formatTimestamp() },
              bookmarkMessage,
            ],
          }));
        })();
        return;
      }

      if (command.action === "menu" && command.target === "list-bookmarks") {
        (async () => {
          const parsed = parseActionLogArgs(args);
          const targetThread = parsed.sessionId === "daemon"
            ? null
            : await resolveThreadFromQuery(parsed.threadQuery);
          if (!parsed.sessionId && parsed.threadQuery && !targetThread) {
            const errorMessage: ChatMessage = {
              role: "gordon",
              content: `No thread matching "${parsed.threadQuery}" was found.`,
              timestamp: formatTimestamp(),
            };
            setState((prev) => ({
              ...prev,
              messages: [
                ...prev.messages,
                { role: "user", content: value.trim(), timestamp: formatTimestamp() },
                errorMessage,
              ],
            }));
            return;
          }
          const entries = listActionLogEntries({
            threadId: targetThread?.threadId,
            sessionId: parsed.sessionId,
            bookmarkedOnly: true,
            limit: parsed.limit,
          });
          const response: ChatMessage = {
            role: "gordon",
            content: formatActionLogEntries(
              entries,
              parsed.sessionId === "daemon"
                ? "Daemon bookmarks"
                : targetThread
                  ? `Bookmarks for ${targetThread.label}`
                  : "Current thread bookmarks",
            ),
            timestamp: formatTimestamp(),
          };
          setState((prev) => ({
            ...prev,
            messages: [
              ...prev.messages,
              { role: "user", content: value.trim(), timestamp: formatTimestamp() },
              response,
            ],
          }));
        })();
        return;
      }

      if (command.action === "menu" && command.target === "thread-summary") {
        (async () => {
          const targetThread = await resolveThreadFromQuery(args.trim() || undefined);
          if (!targetThread) {
            const errorMessage: ChatMessage = {
              role: "gordon",
              content: "No matching thread found for `/thread-summary`.",
              timestamp: formatTimestamp(),
            };
            setState((prev) => ({
              ...prev,
              messages: [
                ...prev.messages,
                { role: "user", content: value.trim(), timestamp: formatTimestamp() },
                errorMessage,
              ],
            }));
            return;
          }

          if (targetThread.threadId === state.session?.threadId) {
            const runtimeSummary = [
              `**Runtime Thread Summary: ${targetThread.label}**`,
              "",
              getSessionRuntime("app").getProjectedTranscript() || "Runtime transcript is empty for this thread.",
            ].join("\n");
            appendActionLogEntry({
              threadId: targetThread.threadId,
              resourceId: targetThread.resourceId,
              sessionId: targetThread.threadId,
              entryType: "branch_summary",
              title: "Runtime thread summary generated",
              content: runtimeSummary,
              payload: {
                source: "runtime_transcript",
              },
            });

            const response: ChatMessage = {
              role: "gordon",
              content: runtimeSummary,
              timestamp: formatTimestamp(),
            };
            setState((prev) => ({
              ...prev,
              messages: [
                ...prev.messages,
                { role: "user", content: value.trim(), timestamp: formatTimestamp() },
                response,
              ],
            }));
            return;
          }

          const entries = listActionLogEntries({
            threadId: targetThread.threadId,
            limit: 80,
          });
          const summary = buildThreadSummaryReport(targetThread, entries);
          appendActionLogEntry({
            threadId: targetThread.threadId,
            resourceId: targetThread.resourceId,
            sessionId: targetThread.threadId,
            entryType: "branch_summary",
            title: "Thread summary generated",
            content: summary,
            payload: {
              sourceThreadId: targetThread.clonedFrom,
              entryCount: entries.length,
            },
          });

          const response: ChatMessage = {
            role: "gordon",
            content: summary,
            timestamp: formatTimestamp(),
          };
          setState((prev) => ({
            ...prev,
            messages: [
              ...prev.messages,
              { role: "user", content: value.trim(), timestamp: formatTimestamp() },
              response,
            ],
          }));
        })();
        return;
      }

      if (command.action === "menu" && command.target === "compact-thread") {
        (async () => {
          const trimmedArgs = args.trim();
          const parts = trimmedArgs ? trimmedArgs.split(/\s+/) : [];
          const maybeThread = parts[0];
          const explicitThread = maybeThread ? await resolveThreadFromQuery(maybeThread) : null;
          const targetThread = explicitThread ?? await resolveThreadFromQuery();
          const note = explicitThread
            ? parts.slice(1).join(" ").trim()
            : trimmedArgs;

          if (!targetThread) {
            const errorMessage: ChatMessage = {
              role: "gordon",
              content: "No matching thread found for `/compact-thread`.",
              timestamp: formatTimestamp(),
            };
            setState((prev) => ({
              ...prev,
              messages: [
                ...prev.messages,
                { role: "user", content: value.trim(), timestamp: formatTimestamp() },
                errorMessage,
              ],
            }));
            return;
          }

          if (!explicitThread || targetThread.threadId === state.session?.threadId) {
            const responseContent = compactRuntimeTranscript(getSessionRuntime("app"), note);
            appendActionLogEntry({
              threadId: targetThread.threadId,
              resourceId: targetThread.resourceId,
              sessionId: targetThread.threadId,
              entryType: "compaction_summary",
              title: "Runtime compaction generated",
              content: responseContent,
              payload: {
                source: "runtime_transcript",
                note: note || null,
              },
            });

            const response: ChatMessage = {
              role: "gordon",
              content: responseContent,
              timestamp: formatTimestamp(),
            };
            setState((prev) => ({
              ...prev,
              messages: [
                ...prev.messages,
                { role: "user", content: value.trim(), timestamp: formatTimestamp() },
                response,
              ],
            }));
            return;
          }

          const entries = listActionLogEntries({
            threadId: targetThread.threadId,
            limit: 40,
          });
          const summary = buildCompactionSummary(entries, note || undefined);
          appendActionLogEntry({
            threadId: targetThread.threadId,
            resourceId: targetThread.resourceId,
            sessionId: targetThread.threadId,
            entryType: "compaction_summary",
            title: "Thread compaction generated",
            content: summary,
            payload: {
              entryCount: entries.length,
              note: note || null,
            },
          });

          const response: ChatMessage = {
            role: "gordon",
            content: summary,
            timestamp: formatTimestamp(),
          };
          setState((prev) => ({
            ...prev,
            messages: [
              ...prev.messages,
              { role: "user", content: value.trim(), timestamp: formatTimestamp() },
              response,
            ],
          }));
        })();
        return;
      }

      // Handle /help command locally for known help modes
      if (command.name === "help") {
        const helpArg = args.trim();
        const normalized = helpArg.toLowerCase();
        const isPaginatedHelp =
          normalized === "" ||
          normalized === "advanced" ||
          normalized === "all" ||
          normalized === "expert" ||
          normalized.startsWith("page") ||
          ["discover", "analyze", "trade", "run", "accounts", "operate", "market", "analysis", "trading", "strategy", "strategies", "account", "system", "ops"].includes(normalized);

        if (isPaginatedHelp) {
          const { mode, category } = parseHelpArg(helpArg);
          const helpContent = !helpArg || normalized.startsWith("page")
            ? formatPaginatedCommandHelp(helpArg)
            : formatCommandHelp(mode, category);

          const helpMessage: ChatMessage = {
            role: "gordon",
            content: helpContent,
            timestamp: formatTimestamp(),
          };
          setState((prev) => ({
            ...prev,
            messages: [
              ...prev.messages,
              { role: "user", content: value.trim(), timestamp: formatTimestamp() },
              helpMessage,
            ],
          }));
          return;
        }
      }

      // Handle tool-based commands locally when possible
      if (command.action === "tool") {
        const userMessage: ChatMessage = {
          role: "user",
          content: value.trim(),
          timestamp: formatTimestamp(),
        };

        switch (command.target) {
          case "test_connection": {
            await runLocalCommand(value, "status", async () => getSystemStatusSummary());
            return;
          }
          case "handle_config_command": {
            setState((prev) => ({ ...prev, messages: [...prev.messages, userMessage], isLoading: true }));
            const result = await handleConfigCommand(args);
            if (result.success) {
              await refreshResolvedConfig();
            }
            setState((prev) => ({
              ...prev,
              messages: [
                ...prev.messages,
                { role: "gordon", content: result.message, timestamp: formatTimestamp() },
              ],
              isLoading: false,
            }));
            return;
          }
          case "handle_exchange_command": {
            setState((prev) => ({ ...prev, messages: [...prev.messages, userMessage], isLoading: true }));
            const message = await handleExchangeCommand(args);
            await refreshActiveExchange();
            setState((prev) => ({
              ...prev,
              messages: [
                ...prev.messages,
                { role: "gordon", content: message, timestamp: formatTimestamp() },
              ],
              isLoading: false,
            }));
            return;
          }
          case "handle_broker_command": {
            setState((prev) => ({ ...prev, messages: [...prev.messages, userMessage], isLoading: true }));
            const message = await handleBrokerCommand(args);
            await refreshActiveBroker();
            setState((prev) => ({
              ...prev,
              messages: [
                ...prev.messages,
                { role: "gordon", content: message, timestamp: formatTimestamp() },
              ],
              isLoading: false,
            }));
            return;
          }
          case "handle_stocks_command": {
            setState((prev) => ({ ...prev, messages: [...prev.messages, userMessage], isLoading: true }));
            const message = await handleStocksCommand(args);
            await refreshActiveBroker();
            setState((prev) => ({
              ...prev,
              messages: [
                ...prev.messages,
                { role: "gordon", content: message, timestamp: formatTimestamp() },
              ],
              isLoading: false,
            }));
            return;
          }
          case "check_positions": {
            if (isStocksMarketArgs(args) || (!exchangeRef.current && brokerRef.current)) {
              const stocksArgs = stripStocksMarketPrefix(args);
              await runLocalCommand(value, "positions", async () => {
                const message = await handleStocksCommand(`positions ${stocksArgs}`.trim());
                await refreshActiveBroker();
                return message;
              });
              return;
            }

            await runLocalCommand(value, "positions", async () => {
              const summary = await getCryptoPositionsSummary();
              lastResultsRef.current.positionsSummary = summary;
              appStore.updateWorkspaceMemory("monitor", {
                focusSection: "positions",
                focusSymbol: summary.positions[0]?.symbol,
              });
              bumpWorkspaceShellVersion();
              return summary.message;
            });
            return;
          }
          case "get_open_orders": {
            if (isStocksMarketArgs(args) || (!exchangeRef.current && brokerRef.current)) {
              const stocksArgs = stripStocksMarketPrefix(args);
              await runLocalCommand(value, "orders", async () => {
                const message = await handleStocksCommand(`orders ${stocksArgs}`.trim());
                await refreshActiveBroker();
                return message;
              });
              return;
            }

            await runLocalCommand(value, "orders", async () => {
              const summary = await getCryptoOpenOrdersSummary(args);
              lastResultsRef.current.ordersSummary = summary;
              appStore.updateWorkspaceMemory("monitor", {
                focusSection: "positions",
                focusSymbol: summary.orders[0]?.symbol,
              });
              bumpWorkspaceShellVersion();
              return summary.message;
            });
            return;
          }
          case "handle_keyring_command": {
            await runLocalCommand(value, "keyring", async () => {
              const result = await handleKeyringCommand(args);
              if (result.success) {
                await refreshResolvedConfig();
              }
              return result.message;
            });
            return;
          }
          case "handle_strategy_command": {
            setState((prev) => ({ ...prev, messages: [...prev.messages, userMessage], isLoading: true }));
            const message = await handleStrategyCommand(args);
            const strategyArgs = args.trim().split(/\s+/).filter(Boolean);
            const strategyCommand = strategyArgs[0]?.toLowerCase() ?? "list";
            const strategyId = strategyArgs[1];
            if (strategyCommand === "playbooks") {
              appStore.updateWorkspaceMemory("lab", {
                selectedStrategyId: undefined,
                selectedSource: "playbook",
              });
            } else if (strategyCommand === "running" || strategyCommand === "evolving") {
              appStore.updateWorkspaceMemory("lab", {
                selectedSource: "systematic",
              });
            } else if (strategyId) {
              appStore.updateWorkspaceMemory("lab", {
                selectedStrategyId: strategyId,
                selectedSource: strategyCommand === "info" || strategyCommand === "backtest" || strategyCommand === "compare"
                  ? "built-in"
                  : "generated",
              });
            }
            setState((prev) => ({
              ...prev,
              messages: [
                ...prev.messages,
                { role: "gordon", content: message, timestamp: formatTimestamp() },
              ],
              isLoading: false,
            }));
            return;
          }
          case "handle_gen_command": {
            setState((prev) => ({ ...prev, messages: [...prev.messages, userMessage], isLoading: true }));
            const message = await handleGenCommand(args);
            setState((prev) => ({
              ...prev,
              messages: [
                ...prev.messages,
                { role: "gordon", content: message, timestamp: formatTimestamp() },
              ],
              isLoading: false,
            }));
            return;
          }
          case "handle_mcp_command": {
            setState((prev) => ({ ...prev, messages: [...prev.messages, userMessage], isLoading: true }));
            const mcpArgs = args.trim().length > 0 ? args.trim().split(/\s+/) : [];
            const result = await handleMCPCommand(mcpArgs);
            await syncRuntimeToolingState().catch(() => undefined);
            setState((prev) => ({
              ...prev,
              messages: [
                ...prev.messages,
                { role: "gordon", content: result.message, timestamp: formatTimestamp() },
              ],
              isLoading: false,
            }));
            return;
          }
          case "handle_routing_command": {
            setState((prev) => ({ ...prev, messages: [...prev.messages, userMessage], isLoading: true }));
            const routingArgs = args.trim().length > 0 ? args.trim().split(/\s+/) : [];
            const result = await handleRoutingCommand(routingArgs);
            setState((prev) => ({
              ...prev,
              messages: [
                ...prev.messages,
                { role: "gordon", content: result.message, timestamp: formatTimestamp() },
              ],
              isLoading: false,
            }));
            return;
          }
          case "handle_workflow_command": {
            if (!exchangeRef.current) {
              setState((prev) => ({
                ...prev,
                messages: [
                  ...prev.messages,
                  userMessage,
                  {
                    role: "gordon",
                    content: "Exchange API not connected. Run /setup to configure API keys before workflows.",
                    timestamp: formatTimestamp(),
                  },
                ],
              }));
              return;
            }

            setState((prev) => ({ ...prev, messages: [...prev.messages, userMessage], isLoading: true }));
            const result = await handleWorkflowCommand(args, {
              exchange: exchangeRef.current,
              llm: llmClientRef.current ?? undefined,
              config: configRef.current,
            });
            lastResultsRef.current.workflowSummary = {
              workflow: result.workflow,
              success: result.success,
              summary: result.summary,
              steps: result.steps.map((step) => ({
                name: step.name,
                status: step.status,
                message: step.message,
                duration: step.duration,
              })),
            };
            const workflowParts = args.trim().split(/\s+/).filter(Boolean);
            const workflowType = workflowParts[0]?.toLowerCase();
            if (workflowType === "backtest-cycle") {
              appStore.updateWorkspaceMemory("lab", {
                selectedStrategyId: workflowParts[1],
                selectedSource: "built-in",
              });
              if (workflowParts[2]) {
                appStore.updateWorkspaceMemory("market", {
                  focusSymbol: workflowParts[2].toUpperCase(),
                  focusWorkflow: "backtest-cycle",
                });
              }
            } else if (workflowType === "quick" || workflowType === "dd") {
              if (workflowParts[1]) {
                appStore.updateWorkspaceMemory("market", {
                  focusSymbol: workflowParts[1].toUpperCase(),
                  focusWorkflow: workflowType,
                });
              }
            }
            bumpWorkspaceShellVersion();
            setState((prev) => ({
              ...prev,
              messages: [
                ...prev.messages,
                { role: "gordon", content: formatWorkflowResult(result), timestamp: formatTimestamp() },
              ],
              isLoading: false,
            }));
            return;
          }
          case "handle_export_command": {
            setState((prev) => ({ ...prev, messages: [...prev.messages, userMessage], isLoading: true }));
            const result = await handleExportCommand(args, {
              lastScan: lastResultsRef.current.scan,
              lastAnalysis: lastResultsRef.current.analysis,
              lastBacktest: lastResultsRef.current.backtest,
              sessionMessages: state.messages,
            });
            setState((prev) => ({
              ...prev,
              messages: [
                ...prev.messages,
                { role: "gordon", content: result.message, timestamp: formatTimestamp() },
              ],
              isLoading: false,
            }));
            return;
          }
          case "get_cache_stats": {
            await runLocalCommand(value, "cache", async () => getCacheSummary(args));
            return;
          }
          case "handle_telemetry_command": {
            await runLocalCommand(value, "telemetry", async () => {
              const result = await handleTelemetryCommand(args);
              if (result.success) {
                await refreshResolvedConfig();
              }
              return result.message;
            });
            return;
          }
          case "arm_system": {
            await applySystemMode(value, command.name === "arm" ? "arm" : "disarm");
            return;
          }
          default:
            break;
        }
      }

      if (isDeterministicSlashCommand(command) && !isRuntimeHandledSlashCommand(command)) {
        setState((prev) => ({
          ...prev,
          messages: [
            ...prev.messages,
            { role: "user", content: value.trim(), timestamp: formatTimestamp() },
            {
              role: "gordon",
              content: `/${command.name} is registered as a built-in command, but it is not wired for direct execution yet. This is a product bug, not a prompt limitation.`,
              timestamp: formatTimestamp(),
            },
          ],
        }));
        return;
      }

      // Convert command to natural language for the agent
      messageToSend = commandToPrompt(command, args);
      displayMessage = value.trim(); // Still show the command to user
    }

    if (!parsedCommand) {
      const suggestions = checkForPluginSuggestions(messageToSend)
        .filter((s) => !shownPluginSuggestionsRef.current.has(s.pluginId));
      pendingPluginSuggestionsRef.current = suggestions;
    }

    const initialTaskTree = createTaskTree({
      input: displayMessage,
      actionId: requestedActionId,
      commandName: parsedCommand?.command.name,
    });
    appendCurrentActionLogEntry({
      entryType: "action_route",
      title: "Request received",
      content: displayMessage,
      runId: initialTaskTree.runId,
      payload: {
        requestedActionId,
        requestedTaskScope,
        commandName: parsedCommand?.command.name,
      },
    });

    const userMessage: ChatMessage = {
      role: "user",
      content: displayMessage,
      timestamp: formatTimestamp(),
    };

    // Add user message and set loading state
    setState((prev) => ({
      ...prev,
      messages: [...prev.messages, userMessage],
      isLoading: true,
      overlay: OVERLAY_NONE,
      activityStatus: "Routing request...",
      taskTree: initialTaskTree,
    }));

    // Check if LLM client is configured
    if (!llmClientRef.current) {
      const errorMessage: ChatMessage = {
        role: "gordon",
        content:
          "I'm not fully configured yet. Please set up your API keys in the environment (OPENAI_API_KEY, INCEPTION_API_KEY, or DEDALUS_API_KEY).",
        timestamp: formatTimestamp(),
      };

      setState((prev) => ({
        ...prev,
        messages: [...prev.messages, errorMessage],
        isLoading: false,
        activityStatus: null,
        taskTree: failTaskTree(prev.taskTree, "No LLM provider configured"),
      }));
      return;
    }

    // Build the context for Gordon with session info
    const context: GordonContext = buildAppGordonContext({
      binance: binanceClientRef.current,
      exchange: exchangeRef.current,
      broker: brokerRef.current,
      llm: llmClientRef.current!,
      config: configRef.current,
      portfolioValue: state.portfolioValue ?? 0,
      availableCash: state.availableCash,
      userId: state.session?.resourceId,
      threadId: state.session?.threadId,
      requestedActionId,
      requestedTaskScope,
      credentialProfile,
    });

    // Create initial empty assistant message for streaming
    const streamingTimestamp = formatTimestamp();
    const initialGordonMessage: ChatMessage = {
      role: "gordon",
      content: "",
      timestamp: streamingTimestamp,
    };

    // Add empty Gordon message and switch to streaming state
    setState((prev) => ({
      ...prev,
      messages: [...prev.messages, initialGordonMessage],
      isLoading: false,
      isStreaming: true,
      streamingMessageTimestamp: streamingTimestamp,
      activeToolCall: null,
      activityStatus: "Preparing response...",
      taskTree: markTaskTreeRoutingResolved(prev.taskTree ?? initialTaskTree, "Request accepted"),
    }));
    appendCurrentActionLogEntry({
      entryType: "run_status",
      title: "Response started",
      content: "Streaming response initialized",
      runId: initialTaskTree.runId,
      payload: {
        actionId: requestedActionId,
      },
    });

    try {
      const streamAbortController = new AbortController();
      activeStreamAbortControllerRef.current = streamAbortController;

      // Use streaming API with session threadId and resourceId for memory continuity
      const stream = getSessionRuntime("app").streamMessage(messageToSend, {
        contextOverride: context,
        threadId: state.session?.threadId,
        resourceId: state.session?.resourceId,
        signal: streamAbortController.signal,
      });
      let fullContent = "";
      let currentAgentName: string | undefined;
      let pendingUpdate = false;
      let pendingTimer: ReturnType<typeof setTimeout> | null = null;

      // Helper to update the streaming message with agent attribution
      const updateStreamingMessage = (content: string, agent?: string): void => {
        updateMessageByTimestamp(streamingTimestamp, (message) => ({
          ...message,
          content,
          agent: agent || message.agent,
        }));
      };

      // Throttled version — batches updates to reduce chat input jitter while streaming
      const scheduleUpdate = (): void => {
        if (!pendingUpdate) {
          pendingUpdate = true;
          pendingTimer = setTimeout(() => {
            pendingUpdate = false;
            pendingTimer = null;
            updateStreamingMessage(fullContent, currentAgentName);
          }, 100);
        }
      };

      const flushPendingUpdate = (): void => {
        if (pendingTimer) {
          clearTimeout(pendingTimer);
          pendingTimer = null;
        }
        pendingUpdate = false;
      };

      for await (const event of stream) {
        switch (event.type) {
          case "text_delta":
            if (event.content) {
              fullContent += event.content;
              scheduleUpdate();
              if (fullContent.length === event.content.length) {
                setState((prev) => ({
                  ...prev,
                  taskTree: markTaskTreeRoutingResolved(prev.taskTree ?? initialTaskTree, "Response streaming"),
                }));
              }
            }
            break;

          case "agent_switch":
            if (event.agentName) {
              currentAgentName = event.agentName;
              appendCurrentActionLogEntry({
                entryType: "agent_switch",
                title: "Agent switch",
                content: `Delegated to ${event.agentName}`,
                runId: initialTaskTree.runId,
                payload: {
                  agentName: event.agentName,
                },
              });
              // Update the message with the new agent attribution
              updateStreamingMessage(fullContent, currentAgentName);
              setState((prev) => ({
                ...prev,
                taskTree: recordTaskTreeAgentSwitch(prev.taskTree ?? initialTaskTree, event.agentName!),
              }));
            }
            break;

          case "tool_call_start":
            appendCurrentActionLogEntry({
              entryType: "tool_call",
              title: event.toolName || "Tool call",
              content: `Started ${event.toolName || "tool"}`,
              runId: initialTaskTree.runId,
              payload: {
                toolName: event.toolName,
                toolArgs: event.toolArgs,
                agentName: event.agentName ?? currentAgentName,
              },
            });
            setState((prev) => ({
              ...prev,
              activeToolCall: event.toolName || "tool",
              activityStatus: `Running ${event.toolName || "tool"}...`,
              taskTree: recordTaskTreeToolStart(
                prev.taskTree ?? initialTaskTree,
                event.toolName || "tool",
                event.toolArgs,
                event.agentName ?? currentAgentName,
              ),
            }));
            // If the tool call has agent info, update attribution
            if (event.agentName && event.agentName !== currentAgentName) {
              currentAgentName = event.agentName;
              updateStreamingMessage(fullContent, currentAgentName);
            }
            break;

          case "tool_call_end":
            appendCurrentActionLogEntry({
              entryType: "tool_result",
              title: event.toolName || "Tool result",
              content: `Completed ${event.toolName || "tool"}`,
              runId: initialTaskTree.runId,
              payload: {
                toolName: event.toolName,
                toolResult: event.toolResult ?? null,
                agentName: event.agentName ?? currentAgentName,
              },
            });
            setState((prev) => ({
              ...prev,
              activeToolCall: null,
              activityStatus: "Finalizing response...",
              taskTree: recordTaskTreeToolEnd(prev.taskTree ?? initialTaskTree, event.toolName, true),
            }));
            if (event.toolResult) {
              updateLastResultsFromTool(event.toolName, event.toolResult);
            }
            break;

          case "done":
            // Final update with agent attribution
            if (event.agentName) {
              currentAgentName = event.agentName;
            }
            flushPendingUpdate();
            updateStreamingMessage(fullContent, currentAgentName);
            setState((prev) => ({
              ...prev,
              isStreaming: false,
              streamingMessageTimestamp: null,
              activeToolCall: null,
              activityStatus: null,
              taskTree: completeTaskTree(prev.taskTree, "Response ready"),
            }));
            // Update thread status info after message exchange
            if (state.session?.threadId) {
              updateThreadStatusInfo(state.session.threadId);
            }
            // Append MCP plugin suggestions if relevant
            if (pendingPluginSuggestionsRef.current.length > 0) {
              const suggestions = pendingPluginSuggestionsRef.current.filter(
                (s) => !shownPluginSuggestionsRef.current.has(s.pluginId)
              );
              if (suggestions.length > 0) {
                for (const s of suggestions) {
                  shownPluginSuggestionsRef.current.add(s.pluginId);
                }
                setState((prev) => ({
                  ...prev,
                  messages: [
                    ...prev.messages,
                    {
                      role: "gordon",
                      content: formatPluginSuggestionsMessage(suggestions),
                      timestamp: formatTimestamp(),
                    },
                  ],
                }));
              }
              pendingPluginSuggestionsRef.current = [];
            }
            appendCurrentActionLogEntry({
              entryType: "run_status",
              title: "Response completed",
              content: fullContent,
              runId: initialTaskTree.runId,
              payload: {
                agentName: currentAgentName,
                usage: event.usage ?? null,
              },
            });
            break;

          case "cancelled": {
            flushPendingUpdate();
            const stoppedContent = fullContent.trim().length > 0
              ? `${fullContent.trimEnd()}\n\nResponse stopped.`
              : (event.content || "Response stopped.");
            updateStreamingMessage(stoppedContent, currentAgentName);
            setState((prev) => ({
              ...prev,
              isStreaming: false,
              streamingMessageTimestamp: null,
              activeToolCall: null,
              activityStatus: null,
              taskTree: cancelTaskTree(prev.taskTree, "Response stopped"),
            }));
            appendCurrentActionLogEntry({
              entryType: "run_status",
              title: "Response cancelled",
              content: stoppedContent,
              runId: initialTaskTree.runId,
              payload: {
                agentName: currentAgentName,
              },
            });
            break;
          }

          case "error":
            flushPendingUpdate();
            updateStreamingMessage(
              fullContent || `Sorry, I encountered an error: ${event.error}. Please try again.`,
              currentAgentName
            );
            setState((prev) => ({
              ...prev,
              isStreaming: false,
              streamingMessageTimestamp: null,
              activeToolCall: null,
              activityStatus: null,
              taskTree: failTaskTree(prev.taskTree, event.error),
            }));
            appendCurrentActionLogEntry({
              entryType: "run_status",
              title: "Response failed",
              content: event.error ?? "Unknown streaming error",
              runId: initialTaskTree.runId,
              payload: {
                agentName: currentAgentName,
              },
            });
            break;
        }
      }
    } catch (error) {
      const errorContent =
        error instanceof Error ? error.message : "An unexpected error occurred";

      // Update the streaming message with error
      setState((prev) => {
        const newMessages = [...prev.messages];
        // Find the streaming Gordon message
        for (let i = newMessages.length - 1; i >= 0; i--) {
          const msg = newMessages[i];
          if (msg && msg.role === "gordon" && msg.timestamp === streamingTimestamp) {
            newMessages[i] = {
              role: "gordon",
              content: `Sorry, I encountered an error: ${errorContent}. Please try again.`,
              timestamp: streamingTimestamp,
            };
            break;
          }
        }
        return {
          ...prev,
          messages: newMessages,
          conversationHistory: [
            ...prev.conversationHistory,
            { role: "user", content: messageToSend },
          ],
          isStreaming: false,
          streamingMessageTimestamp: null,
          isLoading: false,
          activeToolCall: null,
          activityStatus: null,
          taskTree: failTaskTree(prev.taskTree, errorContent),
        };
      });
      appendCurrentActionLogEntry({
        entryType: "run_status",
        title: "Response failed",
        content: errorContent,
        runId: initialTaskTree.runId,
        payload: {
          requestedActionId,
          requestedTaskScope,
        },
      });
    } finally {
      activeStreamAbortControllerRef.current = null;
    }
  }, [
    state.view,
    state.conversationHistory,
    state.portfolioValue,
    state.availableCash,
    state.messages,
    applySystemMode,
    getSystemStatusSummary,
    refreshActiveExchange,
    refreshActiveBroker,
    openChatWorkspace,
    openQuickActionsOverlay,
    openShortcutsOverlay,
    appendCurrentActionLogEntry,
    resolveThreadFromQuery,
    runLocalCommand,
    updateMessageByTimestamp,
    updateLastResultsFromTool,
  ]);

  const handleSubmit = useCallback(async (value: string): Promise<void> => {
    const queuedIntent = parseQueuedSubmission(value);
    if (!queuedIntent) {
      return;
    }

    setTranscriptTypingState(false);
    setState((prev) => (
      prev.transcriptBottomOffset === 0 && !prev.showStartupHint
        ? prev
        : {
            ...prev,
            transcriptBottomOffset: 0,
            showStartupHint: false,
          }
    ));

    if (state.isLoading || state.isStreaming) {
      const queuedSubmission: QueuedSubmission = {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        kind: queuedIntent.kind,
        value: queuedIntent.submitValue,
        preview: queuedIntent.preview,
      };

      setState((prev) => ({
        ...prev,
        queuedSubmissions: queuedIntent.kind === "steer"
          ? [queuedSubmission, ...prev.queuedSubmissions.filter((entry) => entry.kind !== "steer")]
          : [...prev.queuedSubmissions, queuedSubmission],
        messages: [
          ...prev.messages,
          {
            role: "gordon",
            badge: queuedIntent.kind === "steer" ? "Steer" : "Queued",
            content: queuedIntent.kind === "steer"
              ? `Pivot queued:\n\n${queuedIntent.preview}`
              : `Next:\n\n${queuedIntent.preview}`,
            timestamp: formatTimestamp(),
          },
        ],
        overlay: OVERLAY_NONE,
        activityStatus: queuedIntent.kind === "steer"
          ? "Interrupt requested..."
          : prev.activityStatus,
        taskTree: queueTaskTreeSubmission(prev.taskTree, queuedIntent.preview, queuedIntent.kind),
      }));
      appendCurrentActionLogEntry({
        entryType: "queue_update",
        title: queuedIntent.kind === "steer" ? "Steering update queued" : "Follow-up queued",
        content: queuedIntent.preview,
        payload: {
          kind: queuedIntent.kind,
        },
      });

      if (queuedIntent.kind === "steer") {
        cancelActiveResponse();
      }
      return;
    }

    await processSubmission(queuedIntent.submitValue);
  }, [
    state.isLoading,
    state.isStreaming,
    appendCurrentActionLogEntry,
    cancelActiveResponse,
    processSubmission,
    setTranscriptTypingState,
  ]);

  useEffect(() => {
    if (state.view !== "chat" || state.isLoading || state.isStreaming || state.queuedSubmissions.length === 0) {
      return;
    }

    if (isDrainingQueueRef.current) {
      return;
    }

    const [nextSubmission] = state.queuedSubmissions;
    if (!nextSubmission) {
      return;
    }

    isDrainingQueueRef.current = true;
    setState((prev) => ({
      ...prev,
      queuedSubmissions: prev.queuedSubmissions.filter((entry) => entry.id !== nextSubmission.id),
      activityStatus: nextSubmission.kind === "steer"
        ? "Applying steering update..."
        : "Running queued follow-up...",
      taskTree: dequeueTaskTreeSubmission(prev.taskTree),
    }));

    queueMicrotask(() => {
      void processSubmission(nextSubmission.value)
        .finally(() => {
          isDrainingQueueRef.current = false;
        });
    });
  }, [
    processSubmission,
    state.isLoading,
    state.isStreaming,
    state.queuedSubmissions,
    state.view,
  ]);

  useEffect(() => {
    let disposed = false;

    const syncBackgroundStatus = async (force = false): Promise<void> => {
      if (disposed) return;
      const now = Date.now();
      const shouldThrottle = isUserTypingRef.current || transcriptBottomOffsetRef.current > 0;
      const minimumRefreshGap = shouldThrottle ? 20_000 : 5_000;
      if (!force && now - backgroundRefreshLastRanAtRef.current < minimumRefreshGap) {
        return;
      }

      backgroundRefreshLastRanAtRef.current = now;
      await refreshBackgroundTaskTree();
    };

    void syncBackgroundStatus(true);
    const intervalId = setInterval(() => {
      void syncBackgroundStatus();
    }, 5_000);

    return () => {
      disposed = true;
      clearInterval(intervalId);
    };
  }, [refreshBackgroundTaskTree]);

  /**
   * Stream a prompt through the agent and update the last Gordon message in-place.
   * Shared by menu-triggered streaming handlers (trending, chains, etc.)
   */
  const runMenuStream = useCallback(
    (prompt: string, messageTimestamp: string, errorPrefix: string) => {
      (async () => {
        if (!llmClientRef.current) return;
        const initialTaskTree = createTaskTree({
          input: prompt,
        });
        appendCurrentActionLogEntry({
          entryType: "action_route",
          title: "Menu request received",
          content: prompt,
          runId: initialTaskTree.runId,
          payload: {
            source: "menu",
          },
        });
        const context: GordonContext = buildAppGordonContext({
          binance: binanceClientRef.current,
          exchange: exchangeRef.current,
          broker: brokerRef.current,
          llm: llmClientRef.current!,
          config: configRef.current,
          portfolioValue: state.portfolioValue ?? 0,
          availableCash: state.availableCash,
          userId: state.session?.resourceId,
          threadId: state.session?.threadId,
          credentialProfile: getRequestCredentialProfile(configRef.current),
        });

        setState((prev) => ({
          ...prev,
          messages: [...prev.messages, { role: "gordon" as const, content: "", timestamp: messageTimestamp }],
          isStreaming: true,
          streamingMessageTimestamp: messageTimestamp,
          overlay: OVERLAY_NONE,
          activityStatus: "Preparing response...",
          taskTree: initialTaskTree,
        }));
        appendCurrentActionLogEntry({
          entryType: "run_status",
          title: "Menu response started",
          content: "Streaming response initialized",
          runId: initialTaskTree.runId,
          payload: {
            source: "menu",
          },
        });

        const updateMsg = (content: string, agent?: string): void => {
          updateMessageByTimestamp(messageTimestamp, (message) => ({
            ...message,
            content,
            agent: agent || message.agent,
          }));
        };

        let currentAgent: string | undefined;
        try {
          const streamAbortController = new AbortController();
          activeStreamAbortControllerRef.current = streamAbortController;
          const stream = getSessionRuntime("app").streamMessage(prompt, {
            contextOverride: context,
            threadId: state.session?.threadId,
            resourceId: state.session?.resourceId,
            signal: streamAbortController.signal,
          });
          let fullContent = "";
          let pendingUpdate = false;
          let pendingTimer: ReturnType<typeof setTimeout> | null = null;

          const scheduleUpdate = (): void => {
            if (!pendingUpdate) {
              pendingUpdate = true;
                pendingTimer = setTimeout(() => {
                  pendingUpdate = false;
                  pendingTimer = null;
                  updateMsg(fullContent, currentAgent);
                }, 100);
              }
            };

          const flushPendingUpdate = (): void => {
            if (pendingTimer) {
              clearTimeout(pendingTimer);
              pendingTimer = null;
            }
            pendingUpdate = false;
          };

          for await (const event of stream) {
            switch (event.type) {
              case "text_delta":
                if (event.content) {
                  fullContent += event.content;
                  scheduleUpdate();
                  if (fullContent.length === event.content.length) {
                    setState((prev) => ({
                      ...prev,
                      taskTree: markTaskTreeRoutingResolved(prev.taskTree ?? initialTaskTree, "Response streaming"),
                    }));
                  }
                }
                break;
              case "agent_switch":
                if (event.agentName) {
                  currentAgent = event.agentName;
                  appendCurrentActionLogEntry({
                    entryType: "agent_switch",
                    title: "Agent switch",
                    content: `Delegated to ${event.agentName}`,
                    runId: initialTaskTree.runId,
                    payload: {
                      agentName: event.agentName,
                      source: "menu",
                    },
                  });
                  updateMsg(fullContent, currentAgent);
                  setState((prev) => ({
                    ...prev,
                    taskTree: recordTaskTreeAgentSwitch(prev.taskTree ?? initialTaskTree, event.agentName!),
                  }));
                }
                break;
              case "tool_call_start":
                appendCurrentActionLogEntry({
                  entryType: "tool_call",
                  title: event.toolName || "Tool call",
                  content: `Started ${event.toolName || "tool"}`,
                  runId: initialTaskTree.runId,
                  payload: {
                    toolName: event.toolName,
                    toolArgs: event.toolArgs,
                    agentName: event.agentName ?? currentAgent,
                    source: "menu",
                  },
                });
                setState((prev) => ({
                  ...prev,
                  activeToolCall: event.toolName || "tool",
                  activityStatus: `Running ${event.toolName || "tool"}...`,
                  taskTree: recordTaskTreeToolStart(
                    prev.taskTree ?? initialTaskTree,
                    event.toolName || "tool",
                    event.toolArgs,
                    event.agentName ?? currentAgent,
                  ),
                }));
                if (event.agentName) {
                  currentAgent = event.agentName;
                }
                break;
              case "tool_call_end":
                appendCurrentActionLogEntry({
                  entryType: "tool_result",
                  title: event.toolName || "Tool result",
                  content: `Completed ${event.toolName || "tool"}`,
                  runId: initialTaskTree.runId,
                  payload: {
                    toolName: event.toolName,
                    toolResult: event.toolResult ?? null,
                    source: "menu",
                  },
                });
                setState((prev) => ({
                  ...prev,
                  activeToolCall: null,
                  activityStatus: "Finalizing response...",
                  taskTree: recordTaskTreeToolEnd(prev.taskTree ?? initialTaskTree, event.toolName, true),
                }));
                break;
              case "done":
                if (event.agentName) currentAgent = event.agentName;
                flushPendingUpdate();
                updateMsg(fullContent, currentAgent);
                setState((prev) => ({
                  ...prev,
                  isStreaming: false,
                  streamingMessageTimestamp: null,
                  activeToolCall: null,
                  activityStatus: null,
                  taskTree: completeTaskTree(prev.taskTree, "Response ready"),
                }));
                appendCurrentActionLogEntry({
                  entryType: "run_status",
                  title: "Menu response completed",
                  content: fullContent,
                  runId: initialTaskTree.runId,
                  payload: {
                    agentName: currentAgent,
                    usage: event.usage ?? null,
                    source: "menu",
                  },
                });
                break;
              case "cancelled": {
                flushPendingUpdate();
                const stoppedContent = fullContent.trim().length > 0
                  ? `${fullContent.trimEnd()}\n\nResponse stopped.`
                  : (event.content || "Response stopped.");
                updateMsg(stoppedContent, currentAgent);
                setState((prev) => ({
                  ...prev,
                  isStreaming: false,
                  streamingMessageTimestamp: null,
                  activeToolCall: null,
                  activityStatus: null,
                  taskTree: cancelTaskTree(prev.taskTree, "Response stopped"),
                }));
                appendCurrentActionLogEntry({
                  entryType: "run_status",
                  title: "Menu response cancelled",
                  content: stoppedContent,
                  runId: initialTaskTree.runId,
                  payload: {
                    agentName: currentAgent,
                    source: "menu",
                  },
                });
                break;
              }
              case "error":
                flushPendingUpdate();
                updateMsg(fullContent || `${errorPrefix}: ${event.error}`, currentAgent);
                setState((prev) => ({
                  ...prev,
                  isStreaming: false,
                  streamingMessageTimestamp: null,
                  activeToolCall: null,
                  activityStatus: null,
                  taskTree: failTaskTree(prev.taskTree, event.error),
                }));
                appendCurrentActionLogEntry({
                  entryType: "run_status",
                  title: "Menu response failed",
                  content: event.error ?? "Unknown error",
                  runId: initialTaskTree.runId,
                  payload: {
                    agentName: currentAgent,
                    source: "menu",
                  },
                });
                break;
            }
          }
        } catch (error) {
          updateMsg(
            `${errorPrefix}: ${error instanceof Error ? error.message : "Unknown error"}`,
            currentAgent
          );
          setState((prev) => ({
            ...prev,
            isStreaming: false,
            streamingMessageTimestamp: null,
            activeToolCall: null,
            activityStatus: null,
            taskTree: failTaskTree(prev.taskTree, error instanceof Error ? error.message : "Unknown error"),
          }));
          appendCurrentActionLogEntry({
            entryType: "run_status",
            title: "Menu response failed",
            content: error instanceof Error ? error.message : "Unknown error",
            runId: initialTaskTree.runId,
            payload: {
              source: "menu",
            },
          });
        } finally {
          activeStreamAbortControllerRef.current = null;
        }
      })();
    },
    [
      state.portfolioValue,
      state.availableCash,
      state.session?.resourceId,
      state.session?.threadId,
      appendCurrentActionLogEntry,
      updateMessageByTimestamp,
    ]
  );

  // Handle menu selection
  const handleMenuSelect = useCallback((option: MenuOption): void => {
    const buildChatTransition = (prev: AppState): Partial<AppState> => (
      state.view === "chat"
        ? {}
        : {
            chatInputSeed: "",
            chatInputSeedNonce: prev.chatInputSeedNonce + 1,
          }
    );

    const submitMenuCommand = (command: string, workspace: WorkspaceId = "desk"): void => {
      openWorkspaceShell(workspace);
      void handleSubmit(command);
    };

    switch (option) {
      case "chat":
        openChatWorkspace();
        break;
      case "scan":
        openWorkspaceShell("market");
        if (!exchangeRef.current) {
          setState((prev) => ({
            ...prev,
            view: "chat",
            workspace: "market",
            overlay: OVERLAY_NONE,
            ...buildChatTransition(prev),
            messages: [
              ...prev.messages,
              {
                role: "gordon",
                content:
                  "No exchange configured. Use `/exchange add <type>` to add credentials or run `/setup`.",
                timestamp: formatTimestamp(),
              },
            ],
          }));
        } else {
          setState((prev) => ({
            ...prev,
            view: "chat",
            workspace: "market",
            isLoading: true,
            overlay: OVERLAY_NONE,
            ...buildChatTransition(prev),
            activityStatus: "Scanning market...",
            messages: [
              ...prev.messages,
              {
                role: "gordon",
                content: "Scanning market...",
                timestamp: formatTimestamp(),
              },
            ],
          }));

          (async () => {
            try {
              const exchange = exchangeRef.current;
              if (!exchange) return;
              const scanStart = Date.now();
              const scanResult = await runSharedScan(exchange, {
                topN: configRef.current.preferences.topNCoins,
                timeframes: configRef.current.preferences.defaultTimeframes,
              });
              const executionTime = Date.now() - scanStart;

              const opportunities = scanResult.coins
                .filter((c) => c.setupDetected)
                .map((c) => ({
                  symbol: c.symbol,
                  price: c.price,
                  change24h: c.change24h,
                  setupConfidence: c.setupConfidence,
                  bias: c.bias,
                  risk: c.risk,
                }));

              const formatted = formatScanResults({
                coinsScanned: scanResult.coins.length,
                opportunities,
                executionTime,
                maxRows: 10,
              });

              lastResultsRef.current.scan = {
                timestamp: scanResult.timestamp,
                coinsScanned: scanResult.coins.length,
                opportunities,
                executionTime,
                formattedSummary: formatted,
              };
              bumpWorkspaceShellVersion();

              setState((prev) => ({
                ...prev,
                isLoading: false,
                activityStatus: null,
                messages: [
                  ...prev.messages,
                  {
                    role: "gordon",
                    content: formatted,
                    timestamp: formatTimestamp(),
                  },
                ],
              }));
            } catch (error) {
              setState((prev) => ({
                ...prev,
                isLoading: false,
                activityStatus: null,
                messages: [
                  ...prev.messages,
                  {
                    role: "gordon",
                    content: formatCommandError("market scan", error, {
                      topN: configRef.current.preferences.topNCoins,
                      timeframes: configRef.current.preferences.defaultTimeframes,
                    }),
                    timestamp: formatTimestamp(),
                  },
                ],
              }));
            }
          })();
        }
        break;
      case "portfolio":
        openWorkspaceShell("monitor");
        if (!exchangeRef.current) {
          setState((prev) => ({
            ...prev,
            view: "chat",
            workspace: "monitor",
            overlay: OVERLAY_NONE,
            ...buildChatTransition(prev),
            messages: [
              ...prev.messages,
              {
                role: "gordon",
                content:
                  "No exchange configured. Use `/exchange add <type>` to add credentials or run `/setup`.",
                timestamp: formatTimestamp(),
              },
            ],
          }));
        } else {
          // Fetch portfolio data
          setState((prev) => ({
            ...prev,
            view: "chat",
            workspace: "monitor",
            isLoading: true,
            overlay: OVERLAY_NONE,
            ...buildChatTransition(prev),
            activityStatus: "Fetching portfolio...",
            messages: [
              ...prev.messages,
              {
                role: "gordon",
                content: "Fetching your portfolio from the active exchange...",
                timestamp: formatTimestamp(),
              },
            ],
          }));

          // Async fetch portfolio from both spot and funding wallets
          (async () => {
            try {
              const summary = await getCryptoPortfolioSummary();
              lastResultsRef.current.portfolioSummary = summary;
              bumpWorkspaceShellVersion();

              setState((prev) => ({
                ...prev,
                portfolioValue: summary.totalValue,
                availableCash: summary.availableCash,
                isLoading: false,
                activityStatus: null,
                messages: [
                  ...prev.messages,
                  {
                    role: "gordon",
                    content: summary.message,
                    timestamp: formatTimestamp(),
                  },
                ],
              }));
            } catch (error) {
              setState((prev) => ({
                ...prev,
                isLoading: false,
                activityStatus: null,
                messages: [
                  ...prev.messages,
                  {
                    role: "gordon",
                    content: formatCommandError("portfolio fetch", error),
                    timestamp: formatTimestamp(),
                  },
                ],
              }));
            }
          })();
        }
        break;
      case "setup":
        setState((prev) => ({
          ...prev,
          view: "setup",
          overlay: OVERLAY_NONE,
          setupMode: "advanced",
          setupSection: null,
        }));
        break;
      case "doctor":
        setState((prev) => ({ ...prev, view: "doctor", overlay: OVERLAY_NONE }));
        break;
      case "help":
        setState((prev) => ({
          ...prev,
          view: "chat",
          overlay: OVERLAY_NONE,
          ...buildChatTransition(prev),
          messages: [
            ...prev.messages,
              {
                role: "gordon",
                content: formatPaginatedCommandHelp(),
                timestamp: formatTimestamp(),
              },
            ],
          }));
        break;
      case "trending": {
        const trendingTs = formatTimestamp();
        setState((prev) => ({
          ...prev,
          view: "chat",
          workspace: "market",
          overlay: OVERLAY_NONE,
          ...buildChatTransition(prev),
          messages: [
            ...prev.messages,
            { role: "user", content: "/trending", timestamp: trendingTs },
          ],
        }));
        runMenuStream("Show me what's trending and pumping today", trendingTs, "Failed to get trending");
        break;
      }
      case "analyze":
        setState((prev) => ({
          ...prev,
          view: "chat",
          workspace: "market",
          overlay: OVERLAY_NONE,
          ...buildChatTransition(prev),
          messages: [
            ...prev.messages,
            {
              role: "gordon",
              content: "What coin would you like me to analyze? Just type the symbol (e.g., BTC, ETH, SOL)",
              timestamp: formatTimestamp(),
            },
          ],
        }));
        break;
      case "preview-order":
        submitMenuCommand("/preview-order", "plan");
        break;
      case "plan":
        submitMenuCommand("/plan", "plan");
        break;
      case "positions":
        submitMenuCommand("/positions", "monitor");
        break;
      case "orders":
        submitMenuCommand("/orders", "monitor");
        break;
      case "wallet":
        submitMenuCommand("/wallet", "plan");
        break;
      case "fund":
        submitMenuCommand("/fund quote", "plan");
        break;
      case "strategies-live":
        submitMenuCommand("/strategies-live", "lab");
        break;
      case "regime":
        submitMenuCommand("/regime", "market");
        break;
      case "bridge":
        setState((prev) => ({
          ...prev,
          view: "chat",
          workspace: "plan",
          overlay: OVERLAY_NONE,
          ...buildChatTransition(prev),
          messages: [
            ...prev.messages,
            {
              role: "user",
              content: "/bridge",
              timestamp: formatTimestamp(),
            },
            {
              role: "gordon",
              content: "What would you like to bridge? Tell me the amount, token, source chain, and destination chain.\n\nExample: \"Bridge 100 USDC from Ethereum to Arbitrum\"",
              timestamp: formatTimestamp(),
            },
          ],
        }));
        break;
      case "chains": {
        submitMenuCommand("/chains", "monitor");
        break;
      }
    }
  }, [
    state.view,
    state.portfolioValue,
    state.availableCash,
    state.conversationHistory,
    formatCommandError,
    handleSubmit,
    openChatWorkspace,
    openWorkspaceShell,
    runMenuStream,
  ]);

  // Handle onboarding completion
  const handleOnboardingComplete = useCallback(
    async (selection: OnboardingSelection): Promise<void> => {
      const hadLlmReady = Boolean(
        process.env.OPENAI_API_KEY
        || process.env.DEDALUS_API_KEY
        || process.env.INCEPTION_API_KEY
      );
      const hadExchange = configRef.current.exchanges.length > 0;
      const hadBroker = configRef.current.brokers.length > 0;

      // Update config with onboarding complete
      const updatedConfig: GordonConfig = {
        ...configRef.current,
        onboardingComplete: true,
      };
      configRef.current = updatedConfig;
      await saveConfig(updatedConfig);

      recordStructuredObservation({
        eventType: "setup.onboarding_path_selected",
        workflow: "setup",
        source: "onboarding",
        component: "App",
        outcome: "success",
        status: selection.mode,
        details: {
          selectionMode: selection.mode,
          nextView:
            selection.mode === "quickstart"
              ? "quickstart"
              : selection.mode === "advanced"
                ? "setup"
                : "chat",
          onboardingCompleteBefore: false,
          llmReadyBefore: hadLlmReady,
          hasExchangeBefore: hadExchange,
          hasBrokerBefore: hadBroker,
        },
      });

      if (selection.mode === "quickstart") {
        setState((prev) => ({
          ...prev,
          view: "quickstart",
          setupMode: "quickstart",
          setupSection: null,
        }));
      } else if (selection.mode === "advanced") {
        setState((prev) => ({
          ...prev,
          view: "setup",
          setupMode: "advanced",
          setupSection: null,
        }));
      } else {
        setState((prev) => ({
          ...prev,
          view: "chat",
          overlay: OVERLAY_NONE,
          chatInputSeed: "",
          chatInputSeedNonce: prev.chatInputSeedNonce + 1,
          messages: [
            {
              role: "gordon",
              content: `Welcome to demo mode! You're in read-only mode, so nothing will execute.

This is a great way to explore what I can do:
- Ask me to scan the market for opportunities
- Request analysis on specific coins
- Let me build trade plans (I just won't execute them)

Try saying: "What's the market looking like today?"`,
              timestamp: formatTimestamp(),
            },
          ],
        }));
      }
    },
    []
  );

  // Handle setup wizard completion
  const handleSetupComplete = useCallback(async (): Promise<void> => {
    await loadEnvFile();
    await Promise.all([refreshActiveExchange(), refreshActiveBroker()]);
    const hasExchangeLoaded = Boolean(exchangeRef.current);
    const hasBrokerLoaded = Boolean(brokerRef.current);

    // Try to initialize LLM client with new keys
    try {
      llmClientRef.current = createLLMClientFromEnv();
      recordStructuredObservation({
        eventType: "setup.activation_completed",
        workflow: "setup",
        source: "setup_completion",
        component: "App",
        outcome: "success",
        status: "activated",
        provider: configRef.current.modelConfig?.provider ?? undefined,
        model: configRef.current.modelConfig?.model ?? undefined,
        exchange: exchangeRef.current?.exchangeId,
        broker: brokerRef.current?.brokerId,
        ready: true,
        details: {
          connectionStatus: "connected",
          hasExchangeLoaded,
          hasBrokerLoaded,
        },
      });
      setState((prev) => ({
        ...prev,
        view: "chat",
        overlay: OVERLAY_NONE,
        chatInputSeed: "",
        chatInputSeedNonce: prev.chatInputSeedNonce + 1,
        setupSection: null,
        connectionStatus: "connected",
        messages: [
          {
            role: "gordon",
            content: `Setup complete! I'm ready to help you trade.

Your API keys have been saved to ~/.gordon/.env.

Try saying: "What's the market looking like today?" or "Find me a good BTC setup"`,
            timestamp: formatTimestamp(),
          },
        ],
      }));
    } catch (error) {
      console.error("Failed to initialize LLM client after setup:", error);
      recordStructuredObservation({
        eventType: "setup.activation_failed",
        workflow: "setup",
        source: "setup_completion",
        component: "App",
        outcome: "failure",
        status: "llm_init_failed",
        provider: configRef.current.modelConfig?.provider ?? undefined,
        model: configRef.current.modelConfig?.model ?? undefined,
        exchange: exchangeRef.current?.exchangeId,
        broker: brokerRef.current?.brokerId,
        ready: false,
        reason: error instanceof Error ? error.message : String(error),
        details: {
          connectionStatus: "disconnected",
          hasExchangeLoaded,
          hasBrokerLoaded,
        },
      });
      setState((prev) => ({
        ...prev,
        view: "chat",
        overlay: OVERLAY_NONE,
        chatInputSeed: "",
        chatInputSeedNonce: prev.chatInputSeedNonce + 1,
        setupSection: null,
        connectionStatus: "disconnected",
        messages: [
          {
            role: "gordon",
            content: `Setup complete, but I couldn't connect to the LLM provider.

Please check your API keys in the .env file and restart Gordon.`,
            timestamp: formatTimestamp(),
          },
        ],
      }));
    }
  }, [refreshActiveExchange, refreshActiveBroker]);

  // Handle model selector completion
  const handleModelComplete = useCallback((changed: boolean): void => {
    if (changed) {
      // Reinitialize LLM client with new model
      try {
        llmClientRef.current = createLLMClientFromEnv();
      } catch (error) {
        console.error("Failed to reinitialize LLM client:", error);
      }

      appendCurrentActionLogEntry({
        entryType: "model_change",
        title: "Model updated",
        content: `Model switched to ${configRef.current.modelConfig?.model ?? "default model"}`,
        payload: {
          provider: configRef.current.modelConfig?.provider ?? null,
          model: configRef.current.modelConfig?.model ?? null,
        },
      });

      setState((prev) => ({
        ...prev,
        view: "chat",
        overlay: OVERLAY_NONE,
        chatInputSeed: "",
        chatInputSeedNonce: prev.chatInputSeedNonce + 1,
        messages: [
          ...prev.messages,
          {
            role: "gordon",
            content: "Model updated! I'm now using the new AI model. How can I help you?",
            timestamp: formatTimestamp(),
          },
        ],
      }));
    } else {
      // User cancelled
      setState((prev) => ({ ...prev, view: "menu" }));
    }
  }, [appendCurrentActionLogEntry]);

  // Handle global keyboard shortcuts
  useInput((input, key) => {
    // Don't process input during loading or onboarding (onboarding has its own handler)
    if (
      state.view === "loading"
      || state.view === "onboarding"
      || state.view === "quickstart"
      || state.view === "setup"
      || state.view === "doctor"
      || state.view === "model"
    ) {
      return;
    }

    // Handle shortcuts overlay
    if (isOverlayOpen(state.overlay, "shortcuts")) {
      if (key.escape || input === "?") {
        closeOverlay();
      }
      return;
    }

    if (key.escape && (state.isLoading || state.isStreaming)) {
      if (activeStreamAbortControllerRef.current) {
        cancelActiveResponse();
      } else {
        setState((prev) => ({
          ...prev,
          activityStatus: "Current operation must finish before queued instructions can run.",
        }));
      }
      return;
    }

    if (key.escape && isOverlayOpen(state.overlay)) {
      closeOverlay();
      return;
    }

    if (
      state.view === "chat"
      && !isOverlayOpen(state.overlay)
      && (key.pageUp || key.pageDown || key.home || key.end)
    ) {
      if (key.pageUp) {
        moveTranscriptViewport(transcriptPageSize);
      } else if (key.pageDown) {
        moveTranscriptViewport(-transcriptPageSize);
      } else if (key.home) {
        jumpTranscriptToTop();
      } else if (key.end) {
        jumpTranscriptToBottom();
      }
      return;
    }

    if (
      input.toLowerCase() === "k"
      && key.ctrl
      && state.view === "chat"
      && !state.isLoading
      && !state.isStreaming
    ) {
      setState((prev) => ({
        ...prev,
        overlay: isOverlayOpen(prev.overlay, "quick-actions")
          ? OVERLAY_NONE
          : openOverlay("quick-actions"),
      }));
      return;
    }

    if (
      state.view === "chat"
      && !isOverlayOpen(state.overlay)
      && state.chatDraft.trim().length === 0
      && !state.isLoading
      && !state.isStreaming
      && (input === "[" || input === "]")
    ) {
      openWorkspaceShell(
        input === "]"
          ? getNextWorkspace(state.workspace)
          : getPreviousWorkspace(state.workspace),
        { seed: "", resetInput: true },
      );
      return;
    }

    if (
      state.view === "chat"
      && state.workspace !== "desk"
      && !isOverlayOpen(state.overlay)
      && state.chatDraft.trim().length === 0
      && !state.isLoading
      && !state.isStreaming
      && workspaceViewModel
      && (key.upArrow || key.downArrow)
    ) {
      const cardCount = workspaceViewModel.cards.length;
      if (cardCount > 0) {
        const delta = key.downArrow ? 1 : -1;
        const nextIndex = (selectedWorkspaceCardIndex + delta + cardCount) % cardCount;
        appStore.setWorkspaceSelection(state.workspace, nextIndex);
      }
      return;
    }

    if (
      state.view === "chat"
      && state.workspace !== "desk"
      && !isOverlayOpen(state.overlay)
      && state.chatDraft.trim().length === 0
      && !state.isLoading
      && !state.isStreaming
      && workspaceViewModel
      && key.tab
    ) {
      const primaryAction = getPrimaryWorkspaceAction(workspaceViewModel, selectedWorkspaceCardIndex);
      if (primaryAction) {
        openWorkspaceShell(state.workspace, { seed: primaryAction, resetInput: true });
      }
      return;
    }

    if (
      state.view === "chat"
      && !isOverlayOpen(state.overlay)
      && state.chatDraft.trim().length === 0
      && !state.isLoading
      && !state.isStreaming
      && state.runtimeInspector?.pendingApprovals.length
      && key.shift
      && (input === "A" || input === "D")
    ) {
      const activeApproval = state.runtimeInspector.pendingApprovals[0];
      if (!activeApproval) {
        return;
      }
      const shortId = getRuntimeApprovalShortId(activeApproval.id);
      openWorkspaceShell(state.workspace, {
        seed: input === "A" ? `approve ${shortId}` : `deny ${shortId} `,
        resetInput: true,
      });
      return;
    }

    // Show shortcuts with ? key (only when not actively typing in chat input)
    // The ? should only trigger when in menu view or when the shortcuts overlay is toggled
    if (input === "?" && (state.view === "menu" || isOverlayOpen(state.overlay, "quick-actions"))) {
      openShortcutsOverlay();
      return;
    }

    if (state.view === "welcome" && input.toLowerCase() === "b") {
      const nextBannerMode: GordonConfig["startupBannerMode"] =
        configRef.current.startupBannerMode === "quiet" ? "full" : "quiet";
      const updatedConfig: GordonConfig = {
        ...configRef.current,
        startupBannerMode: nextBannerMode,
      };
      configRef.current = updatedConfig;
      setState((prev) => ({ ...prev }));
      void saveConfig(updatedConfig).catch(() => {
        // Best effort only. The next explicit configure flow can still persist it.
      });
      return;
    }

    // Enter any startup key to dismiss welcome banner
    if (state.view === "welcome" && (input || key.return)) {
      setState((prev) => ({ ...prev, view: "menu" }));
    }
  }, {
    isActive: true,
  });

  const pendingApprovals = useMemo((): RuntimeApprovalRequest[] => (
    getSessionRuntime("app").getState().approvals.pending
  ), [
    getSessionRuntime,
    state.runtimeInspector?.lastUpdatedAt,
    state.runtimeInspector?.pendingApprovalCount,
  ]);

  const transcriptMessages = useMemo(
    () => getTranscriptMessagesForState(state),
    [getTranscriptMessagesForState, pendingApprovals, state.messages]
  );

  const visibleThreadPolicy = useMemo(
    () => buildVisibleThreadPolicy({
      messages: transcriptMessages,
      isStreaming: state.isStreaming,
      hasTaskTree: Boolean(state.taskTree),
      hasBackgroundTasks: Boolean(state.backgroundTaskTree),
      bottomOffset: state.transcriptBottomOffset,
    }),
    [state.backgroundTaskTree, state.isStreaming, state.taskTree, state.transcriptBottomOffset, transcriptMessages]
  );
  const maxVisibleMessages = visibleThreadPolicy.visibleLimit;
  const transcriptPageSize = useMemo(
    () => Math.max(8, Math.floor(visibleThreadPolicy.visibleLimit * 0.66)),
    [visibleThreadPolicy.visibleLimit]
  );
  const visibleMessages = useMemo(
    () => transcriptMessages.slice(visibleThreadPolicy.startIndex, visibleThreadPolicy.endIndex),
    [transcriptMessages, visibleThreadPolicy.endIndex, visibleThreadPolicy.startIndex]
  );
  const transcriptHasMomentum = useMemo(() => hasConversationMomentum(state.messages), [state.messages]);
  const hasWalletRails = (
    configRef.current.agentRails.walletProviders.length > 0
    || configRef.current.agentRails.chainProviders.length > 0
    || configRef.current.agentRails.paymentProviders.length > 0
  );
  const quickActionsOverlayOpen = isOverlayOpen(state.overlay, "quick-actions");
  const shortcutsOverlayOpen = isOverlayOpen(state.overlay, "shortcuts");
  const showChatBanner = false;
  const quickActionContext = useMemo(
    () => ({
      mode: state.mode,
      workspace: state.workspace,
      setupComplete: configRef.current.onboardingComplete,
      hasExchange: Boolean(exchangeRef.current),
      hasBroker: Boolean(brokerRef.current),
      hasWalletRails,
    }),
    [hasWalletRails, state.mode, state.workspace]
  );
  const chatInputPlaceholder = useMemo(() => {
    if (quickActionsOverlayOpen) {
      return "Quick Actions open...";
    }
    if (state.isLoading || state.isStreaming) {
      return "Waiting for response...";
    }
    switch (state.workspace) {
      case "market":
        return "Ask about the tape, regime, or a symbol...";
      case "plan":
        return "Shape or review a trade ticket...";
      case "lab":
        return "Build, compare, or validate a strategy...";
      case "monitor":
        return "Check the book, runtime, or live health...";
      case "desk":
      default:
        return "Ask Gordon anything...";
    }
  }, [quickActionsOverlayOpen, state.isLoading, state.isStreaming, state.workspace]);

  const strategyInventory = useMemo<WorkspaceStrategyInventorySnapshot>(() => {
    let builtInStrategyCount = 0;
    let builtInTier1Count = 0;
    let builtInTier2Count = 0;
    let playbookCount = 0;
    let builtInStrategies: WorkspaceStrategyInventorySnapshot["builtInStrategies"] = [];
    let generatedStrategies: WorkspaceStrategyInventorySnapshot["generatedStrategies"] = [];
    let playbooks: WorkspaceStrategyInventorySnapshot["playbooks"] = [];
    let systematicProfileCount = 0;
    let systematicLiveEligibleCount = 0;
    let systematicProfiles: WorkspaceStrategyInventorySnapshot["systematicProfiles"] = [];
    let researchExperimentCount = 0;
    let researchExperiments: WorkspaceStrategyInventorySnapshot["researchExperiments"] = [];
    let diversificationScore: number | undefined;
    let concentrationRisk: string | undefined;

    try {
      const strategies = strategyRegistry.listStrategies();
      builtInStrategyCount = strategies.length;
      builtInTier1Count = strategies.filter((strategy) => strategy.tier === 1).length;
      builtInTier2Count = strategies.filter((strategy) => strategy.tier === 2).length;
      builtInStrategies = strategies.slice(0, 8).map((strategy) => ({
        id: strategy.id,
        name: strategy.name,
        riskLevel: strategy.riskLevel,
        timeframes: strategy.timeframes,
      }));
    } catch {
      // Registry may not be hydrated yet during boot.
    }

    try {
      const registryPlaybooks = playbookRegistry.getAll();
      playbookCount = registryPlaybooks.length;
      playbooks = registryPlaybooks.slice(0, 8).map((playbook) => ({
        id: playbook.id,
        name: playbook.name,
        riskLevel: playbook.riskLevel,
        timeframes: playbook.timeframes,
      }));
    } catch {
      // Playbook registry may not be loaded yet.
    }

    try {
      generatedStrategies = listGeneratedStrategies({
        orderBy: "createdAt",
        orderDirection: "desc",
        limit: 6,
      }).map((strategy) => ({
        id: strategy.id,
        name: strategy.name,
        riskLevel: strategy.riskLevel,
        timeframes: strategy.timeframes,
        backtestReturn: strategy.backtestReturn,
        backtestSharpe: strategy.backtestSharpe,
      }));
    } catch {
      // Generated-strategy storage may not be initialized yet.
    }

    try {
      const profiles = listStrategyProfiles();
      systematicProfileCount = profiles.length;
      systematicLiveEligibleCount = profiles.filter((profile) => profile.liveEligible).length;
      systematicProfiles = profiles.slice(0, 8).map((profile) => ({
        strategyId: profile.strategyId,
        strategyName: profile.strategyName,
        status: profile.status,
        validationScore: profile.validationScore,
        marketFamily: profile.marketFamily,
        liveEligible: profile.liveEligible,
        capitalWeight: profile.capitalWeight,
      }));
    } catch {
      // Systematic store may not be initialized yet.
    }

    try {
      const experiments = listResearchExperiments();
      researchExperimentCount = experiments.length;
      researchExperiments = experiments.slice(0, 8).map((experiment) => ({
        experimentId: experiment.experimentId,
        strategyId: experiment.strategyId,
        strategyName: experiment.strategyName,
        status: experiment.status,
      }));
    } catch {
      // Systematic experiment store may not be initialized yet.
    }

    try {
      const summary = buildSystematicPortfolioSummary();
      diversificationScore = summary.diversificationScore;
      concentrationRisk = summary.concentrationRisk;
    } catch {
      // Portfolio summary is best-effort only.
    }

    return {
      builtInStrategyCount,
      builtInTier1Count,
      builtInTier2Count,
      builtInStrategies,
      generatedStrategies,
      playbookCount,
      playbooks,
      systematicProfileCount,
      systematicLiveEligibleCount,
      systematicProfiles,
      researchExperimentCount,
      researchExperiments,
      diversificationScore,
      concentrationRisk,
    };
  }, [state.messages]);

  const workspaceViewModel = useMemo(() => {
    if (state.workspace === "desk") {
      return null;
    }

    let plans: Plan[] = [];
    try {
      plans = listPlans().slice(0, 8);
    } catch {
      plans = [];
    }

    return buildWorkspaceBoardViewModel({
      workspace: state.workspace,
      mode: state.mode,
      hasExchange: Boolean(exchangeRef.current),
      hasBroker: Boolean(brokerRef.current),
      hasWalletRails,
      hasMcpServers: (state.runtimeInspector?.mcpServerCount ?? 0) > 0 || configRef.current.mcpServers.length > 0,
      runtimeInspector: state.runtimeInspector,
      queuedCount: state.queuedSubmissions.length,
      lastResults: lastResultsRef.current,
      plans,
      workspaceMemory: state.workspaceMemory,
      strategyInventory,
      planReview: {
        portfolioValue: state.portfolioValue ?? lastResultsRef.current.portfolioSummary?.totalValue ?? 0,
        availableCash: state.availableCash ?? lastResultsRef.current.portfolioSummary?.availableCash ?? 0,
        maxAllocationPerTrade: configRef.current.preferences.maxAllocationPerTrade,
        cashReservePercent: configRef.current.preferences.cashReservePercent,
      },
    });
  }, [
    hasWalletRails,
    state.availableCash,
    state.messages,
    state.mode,
    state.portfolioValue,
    state.queuedSubmissions.length,
    state.runtimeInspector,
    state.workspaceMemory,
    state.workspace,
    strategyInventory,
  ]);

  const selectedWorkspaceCardIndex = useMemo(() => {
    if (state.workspace === "desk" || !workspaceViewModel) {
      return 0;
    }

    return clampWorkspaceCardIndex(
      workspaceViewModel,
      state.workspaceInteraction[state.workspace].selectedCardIndex,
    );
  }, [state.workspace, state.workspaceInteraction, workspaceViewModel]);

  return (
    <Box flexDirection="column" height="100%">
      {/* Shortcuts Overlay */}
      {shortcutsOverlayOpen && (
        <ShortcutsOverlay onClose={closeOverlay} />
      )}

      {/* Main content area */}
      <Box flexDirection="column" flexGrow={1}>
        {state.view === "loading" && (
          <ProgressIndicator
            label="Loading Gordon..."
            status="Initializing services, providers, and runtime state..."
          />
        )}

        {state.view === "onboarding" && (
          <Onboarding onComplete={handleOnboardingComplete} />
        )}

        {state.view === "quickstart" && (
          <QuickStartWizard onComplete={handleSetupComplete} />
        )}

        {state.view === "setup" && (
          <SetupWizard
            mode={state.setupMode === "quickstart" ? "advanced" : state.setupMode}
            initialSection={state.setupSection}
            onComplete={handleSetupComplete}
          />
        )}

        {state.view === "doctor" && (
          <DoctorPanel onComplete={() => setState((prev) => ({ ...prev, view: "menu" }))} />
        )}

        {state.view === "model" && (
          <ModelSelector onComplete={handleModelComplete} />
        )}

        {state.view === "welcome" && (
          <WelcomeBanner mode={configRef.current.startupBannerMode} context="welcome" />
        )}

        {state.view === "menu" && (
          <QuickStartMenu
            onSelect={handleMenuSelect}
            onTypeToChat={(seed) => openChatWorkspace({ seed, resetInput: true })}
            mode={state.mode}
            setupComplete={configRef.current.onboardingComplete}
            hasExchange={Boolean(exchangeRef.current)}
            hasBroker={Boolean(brokerRef.current)}
            hasWalletRails={hasWalletRails}
            hasMcpServers={configRef.current.mcpServers.length > 0}
            variant="home"
          />
        )}

        {state.view === "chat" && (
          <ChatScreen
            visibleMessages={visibleMessages}
            hiddenBefore={visibleThreadPolicy.hiddenBefore}
            hiddenAfter={visibleThreadPolicy.hiddenAfter}
            visibleLimit={maxVisibleMessages}
            isPinnedBottom={visibleThreadPolicy.isPinnedBottom}
            workspace={state.workspace}
            workspaceMemory={state.workspaceMemory}
            isStreaming={state.isStreaming}
            activeStreamingTimestamp={state.streamingMessageTimestamp}
            activityStatus={state.activityStatus}
            activeToolCall={state.activeToolCall}
            showStartupHint={state.showStartupHint}
            showChatBanner={showChatBanner}
            startupBannerMode={configRef.current.startupBannerMode}
            allMessagesCount={transcriptMessages.length}
            quickActionsOverlayOpen={quickActionsOverlayOpen}
            onMenuSelect={handleMenuSelect}
            onTypeToChat={(seed) => openChatWorkspace({ seed, resetInput: true })}
            mode={state.mode}
            setupComplete={configRef.current.onboardingComplete}
            hasExchange={Boolean(exchangeRef.current)}
            hasBroker={Boolean(brokerRef.current)}
            hasWalletRails={hasWalletRails}
            hasMcpServers={configRef.current.mcpServers.length > 0}
            queuedPreview={state.queuedSubmissions[0]?.preview}
            queuedCount={state.queuedSubmissions.length}
            taskTree={state.taskTree}
            backgroundTaskTree={state.backgroundTaskTree}
            runtimeInspector={state.runtimeInspector}
            workspaceViewModel={workspaceViewModel}
            selectedWorkspaceCardIndex={selectedWorkspaceCardIndex}
            isLoading={state.isLoading}
            chatInputPlaceholder={chatInputPlaceholder}
            quickActionContext={quickActionContext}
            hasConversationMomentum={transcriptHasMomentum}
            onSubmit={handleSubmit}
            onWorkspaceShortcut={handleWorkspaceShortcut}
            onOpenQuickActions={openQuickActionsOverlay}
            onTypingStateChange={setTranscriptTypingState}
            onDraftChange={setChatDraft}
            busy={state.isLoading || state.isStreaming}
            seedValue={state.chatInputSeed}
            seedNonce={state.chatInputSeedNonce}
            onCancel={cancelActiveResponse}
            canCancel={Boolean(activeStreamAbortControllerRef.current)}
          />
        )}
      </Box>
    </Box>
  );
}

/**
 * Main App component wrapped with ThemeProvider
 */
export function App(): React.ReactElement {
  const { theme, themeName, toggleTheme, setTheme } = useTheme();

  const handleThemeChange = useCallback((action: ThemeName | "toggle"): void => {
    if (action === "toggle") {
      toggleTheme();
    } else {
      setTheme(action);
    }
  }, [toggleTheme, setTheme]);

  return <AppContent onThemeChange={handleThemeChange} />;
}

/**
 * Root component that provides the theme context
 */
export function AppWithTheme(): React.ReactElement {
  return (
    <ThemeProvider>
      <App />
    </ThemeProvider>
  );
}

export default AppWithTheme;
