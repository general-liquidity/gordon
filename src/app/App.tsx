import React, { useState, useCallback, useEffect, useRef, useMemo } from "react";
import { Box, Text, useInput } from "ink";
import { ChatInput } from "./ChatInput.tsx";

import {
  type ThreadStatusInfo,
  type ChainStatusInfo,
} from "./StatusBar.tsx";
import { WelcomeBanner } from "./WelcomeBanner.tsx";
import { QuickStartMenu, type MenuOption } from "./QuickStartMenu.tsx";
import { ChatView, type ChatMessage } from "./ChatView.tsx";
import { Onboarding } from "./Onboarding.tsx";
import { QuickStartWizard } from "./QuickStartWizard.tsx";
import { SetupWizard } from "./SetupWizard.tsx";
import { DoctorPanel } from "./DoctorPanel.tsx";
import { ModelSelector } from "./ModelSelector.tsx";
import { TaskTree } from "./components/TaskTree.tsx";
import { ShortcutsOverlay, ShortcutsHint } from "./components/ShortcutsOverlay.tsx";
import { ProgressIndicator, StreamingProgress } from "./components/ProgressIndicator.tsx";
import { ThemeProvider, useTheme } from "./components/ThemeProvider.tsx";
import { processMessageStream, initializeTracing } from "../infra/agents/orchestrator.ts";
import { initMCPTools, enableMCPHotReload } from "../infra/mcp/client.ts";
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
import { loadConfig, saveConfig } from "../infra/storage/config.ts";
import { loadConfigBundle, type ConfigLayers } from "../infra/storage/config.ts";
import {
  runSharedMonitorCycle,
  runSharedScan,
  subscribeToMarketPrice,
} from "../core/market-data-coordinator.ts";
import {
  initializeSession,
  resumeSession,
  startNewSession,
  getCurrentSession,
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
import { COLORS, type ThemeName } from "./theme.ts";
import { buildVisibleThreadPolicy } from "./threadDensity.ts";
import {
  parseSlashCommand,
  commandToPrompt,
  formatCommandHelp,
  parseHelpArg,
  formatPaginatedCommandHelp,
} from "./slashCommands.ts";
import {
  handleConfigCommand,
  handleExchangeCommand,
  handleBrokerCommand,
  handleStocksCommand,
  handleStrategyCommand,
  handleGenCommand,
  handleMCPCommand,
  handleRoutingCommand,
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

type AppView =
  | "loading"
  | "onboarding"
  | "quickstart"
  | "setup"
  | "doctor"
  | "model"
  | "welcome"
  | "menu"
  | "chat";

interface ConversationMessage {
  role: "user" | "assistant";
  content: string;
}

interface AppState {
  view: AppView;
  mode: Mode;
  portfolioValue: number | undefined;
  availableCash: number;
  connectionStatus: "connected" | "disconnected" | "connecting";
  messages: ChatMessage[];
  isLoading: boolean;
  isStreaming: boolean;
  streamingMessageTimestamp: string | null;
  activeToolCall: string | null;
  activityStatus: string | null;
  taskTree: TaskTreeState | null;
  backgroundTaskTree: TaskTreeState | null;
  conversationHistory: ConversationMessage[];
  btcPrice: number | undefined;
  overlay: OverlayState;
  queuedSubmissions: QueuedSubmission[];
  showStartupHint: boolean;
  chatInputSeed: string;
  chatInputSeedNonce: number;
  setupMode: SetupWizardMode;
  setupSection: SetupWizardSection | null;
  /** Current session info for Mastra agent memory */
  session: SessionInfo | null;
  /** Thread info for status bar display */
  threadStatusInfo: ThreadStatusInfo | null;
  /** Chain network status for status bar */
  chainStatus: ChainStatusInfo | null;
  configLayers: ConfigLayers | null;
}

interface LastResults {
  scan?: ScanExportData;
  analysis?: AnalysisExportData;
  backtest?: BacktestExportData;
  portfolio?: Record<string, unknown>;
  technicalAnalysis?: Record<string, unknown>;
  regime?: Record<string, unknown>;
  toolResults?: Record<string, Record<string, unknown>>;
}

type PluginSuggestion = ReturnType<typeof checkForPluginSuggestions>[number];

type QueuedSubmissionKind = "follow-up" | "steer";

interface QueuedSubmission {
  id: string;
  kind: QueuedSubmissionKind;
  value: string;
  preview: string;
}

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

function parseQueuedSubmission(value: string): {
  kind: QueuedSubmissionKind;
  submitValue: string;
  preview: string;
} | null {
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  const steeringMatch = trimmed.match(/^\/steer\s+(.+)$/isu);
  if (steeringMatch) {
    const submitValue = steeringMatch[1]?.trim();
    if (!submitValue) {
      return null;
    }
    return {
      kind: "steer",
      submitValue,
      preview: submitValue,
    };
  }

  return {
    kind: "follow-up",
    submitValue: trimmed,
    preview: trimmed,
  };
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
  const [state, setState] = useState<AppState>({
    view: "loading",
    mode: "SAFE",
    portfolioValue: undefined,
    availableCash: 0,
    connectionStatus: "disconnected",
    messages: [],
    isLoading: false,
    isStreaming: false,
    streamingMessageTimestamp: null,
    activeToolCall: null,
    activityStatus: null,
    taskTree: null,
    backgroundTaskTree: null,
    conversationHistory: [],
    btcPrice: undefined,
    overlay: OVERLAY_NONE,
    queuedSubmissions: [],
    showStartupHint: true,
    chatInputSeed: "",
    chatInputSeedNonce: 0,
    setupMode: parseSetupWizardMode(process.env.GORDON_SETUP_MODE, "advanced"),
    setupSection: parseSetupWizardSection(process.env.GORDON_SETUP_SECTION),
    session: null,
    threadStatusInfo: null,
    chainStatus: null,
    configLayers: null,
  });

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

  const refreshBackgroundTaskTree = useCallback(async (): Promise<void> => {
    if (backgroundRefreshInFlightRef.current) {
      return;
    }
    backgroundRefreshInFlightRef.current = true;
    const reachable = await isIpcDaemonReachable().catch(() => false);
    if (!reachable) {
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
    return appendActionLogEntry({
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

    switch (toolName) {
      case "scan_market":
        lastResultsRef.current.scan = resultObj as ScanExportData;
        break;
      case "analyze_coin":
        lastResultsRef.current.analysis = resultObj as AnalysisExportData;
        break;
      case "run_backtest":
      case "compare_backtests":
      case "get_backtest_summary":
      case "analyze_backtest_results":
        lastResultsRef.current.backtest = resultObj as BacktestExportData;
        break;
      case "check_positions":
      case "get_portfolio_state":
        lastResultsRef.current.portfolio = resultObj;
        break;
      case "get_technical_analysis":
      case "get_advanced_analysis":
        lastResultsRef.current.technicalAnalysis = resultObj;
        break;
      case "detect_market_regime":
        lastResultsRef.current.regime = resultObj;
        break;
      default:
        // Store any tool result in a generic map for potential export
        if (!lastResultsRef.current.toolResults) lastResultsRef.current.toolResults = {};
        lastResultsRef.current.toolResults[toolName] = resultObj;
        break;
    }
  }, []);

  const appendMessages = useCallback((nextMessages: ChatMessage[]): void => {
    if (nextMessages.length === 0) {
      return;
    }

    setState((prev) => ({
      ...prev,
      messages: [...prev.messages, ...nextMessages],
    }));
  }, []);

  const updateMessageByTimestamp = useCallback((
    timestamp: string,
    updater: (message: ChatMessage) => ChatMessage
  ): void => {
    setState((prev) => {
      const nextMessages = [...prev.messages];
      for (let i = nextMessages.length - 1; i >= 0; i--) {
        const message = nextMessages[i];
        if (message && message.timestamp === timestamp && message.role === "gordon") {
          nextMessages[i] = updater(message);
          return {
            ...prev,
            messages: nextMessages,
          };
        }
      }

      return prev;
    });
  }, []);

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

      if ((active.type === "binance" || active.type === "binance_us") && creds.apiKey && creds.apiSecret) {
        const baseUrl = active.type === "binance_us" ? "https://api.binance.us" : undefined;
        binanceClientRef.current = new BinanceClient(creds.apiKey, creds.apiSecret, baseUrl);
      } else {
        binanceClientRef.current = null;
      }
    } catch {
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
    } catch {
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

      if (requestedStartView === "doctor") {
        initialView = "doctor";
      } else if (requestedStartView === "quickstart") {
        initialView = "quickstart";
      } else if (requestedStartView === "setup") {
        initialView = "setup";
      } else if (envStatus.hasLLMKey) {
        // Keys are already configured - skip onboarding entirely
        initialView = "welcome";

        // Mark onboarding as complete if it wasn't
        if (!config.onboardingComplete) {
          const updatedConfig = { ...config, onboardingComplete: true };
          configRef.current = updatedConfig;
          await saveConfig(updatedConfig);
        }
      } else if (config.onboardingComplete) {
        // Onboarding was done but no keys - show welcome anyway
        initialView = "welcome";
      } else {
        // New user without keys - show onboarding
        initialView = "onboarding";
      }

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
            await initMCPTools();
            await initRouting();
            enableMCPHotReload(5000);
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
            const { processMessageStream } = await import("../infra/agents/orchestrator.ts");
            const session = await getCurrentSession();
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
            const stream = processMessageStream(prompt, gordonCtx, session?.threadId ?? undefined, session?.resourceId);
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
      const session = await initializeSession({ autoResume: false });
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
        setupMode: requestedSetupMode,
        setupSection: requestedSetupSection,
        mode: config.mode,
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
      }));

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

  const openChatWorkspace = useCallback((options?: { seed?: string; resetInput?: boolean }): void => {
    setState((prev) => ({
      ...prev,
      view: "chat",
      overlay: OVERLAY_NONE,
      ...(prev.view !== "chat" || options?.resetInput
        ? {
            chatInputSeed: options?.seed ?? "",
            chatInputSeedNonce: prev.chatInputSeedNonce + 1,
          }
        : {}),
    }));
  }, []);

  const openQuickActionsOverlay = useCallback((): void => {
    setState((prev) => ({
      ...prev,
      view: "chat",
      overlay: openOverlay("quick-actions"),
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

    // Check for slash commands
    const parsedCommand = parseSlashCommand(normalizedValue);
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

      if (command.name === "portfolio" && isStocksMarketArgs(args)) {
        const userMessage: ChatMessage = {
          role: "user",
          content: value.trim(),
          timestamp: formatTimestamp(),
        };
        setState((prev) => ({ ...prev, messages: [...prev.messages, userMessage], isLoading: true }));
        const stocksArgs = stripStocksMarketPrefix(args);
        const message = await handleStocksCommand(`account ${stocksArgs}`.trim());
        await refreshActiveBroker();
        setState((prev) => ({
          ...prev,
          messages: [...prev.messages, { role: "gordon", content: message, timestamp: formatTimestamp() }],
          isLoading: false,
        }));
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
          const resumed = await resumeSession();
          if (resumed) {
            const resumeMessage: ChatMessage = {
              role: "gordon",
              content: `Session resumed! I'll remember our previous conversations.\n\n**Session Details:**\n- Thread ID: \`${resumed.threadId.slice(0, 20)}...\`\n- Resource ID: \`${resumed.resourceId}\`\n\nI can now recall relevant context from our past discussions. How can I help you today?`,
              timestamp: formatTimestamp(),
            };
            setState((prev) => ({
              ...prev,
              session: resumed,
              messages: [
                ...prev.messages,
                { role: "user", content: value.trim(), timestamp: formatTimestamp() },
                resumeMessage,
              ],
            }));
          } else {
            // No previous session to resume
            const newSession = await startNewSession();
            const noSessionMessage: ChatMessage = {
              role: "gordon",
              content: `No previous session found. Starting a fresh session.\n\n**New Session Details:**\n- Thread ID: \`${newSession.threadId.slice(0, 20)}...\`\n- Resource ID: \`${newSession.resourceId}\``,
              timestamp: formatTimestamp(),
            };
            setState((prev) => ({
              ...prev,
              session: newSession,
              messages: [
                ...prev.messages,
                { role: "user", content: value.trim(), timestamp: formatTimestamp() },
                noSessionMessage,
              ],
            }));
          }
        })();
        return;
      }

      // Handle /new-session command - start a fresh session
      if (command.action === "menu" && command.target === "new-session") {
        (async () => {
          const newSession = await startNewSession();
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
        (async () => {
          const sessionInfo = await getCurrentSession();
          const sessionAge = sessionInfo.threadStartedAt
            ? Math.round((Date.now() - new Date(sessionInfo.threadStartedAt).getTime()) / 1000 / 60)
            : 0;
          const sessionMessage: ChatMessage = {
            role: "gordon",
            content: `**Current Session Info:**\n\n` +
              `- **Thread ID:** \`${sessionInfo.threadId?.slice(0, 25) || "None"}...\`\n` +
              `- **Resource ID:** \`${sessionInfo.resourceId}\`\n` +
              `- **Session Started:** ${sessionInfo.threadStartedAt ? new Date(sessionInfo.threadStartedAt).toLocaleString() : "N/A"}\n` +
              `- **Session Age:** ${sessionAge} minutes\n` +
              `- **Total Sessions:** ${sessionInfo.sessionCount}\n\n` +
              `Use \`/resume\` to continue a previous session or \`/new-session\` to start fresh.`,
            timestamp: formatTimestamp(),
          };
          setState((prev) => ({
            ...prev,
            messages: [
              ...prev.messages,
              { role: "user", content: value.trim(), timestamp: formatTimestamp() },
              sessionMessage,
            ],
          }));
        })();
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
            if (!isStocksMarketArgs(args)) {
              break;
            }
            const stocksArgs = stripStocksMarketPrefix(args);
            setState((prev) => ({ ...prev, messages: [...prev.messages, userMessage], isLoading: true }));
            const message = await handleStocksCommand(`positions ${stocksArgs}`.trim());
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
          case "get_order_status": {
            if (!isStocksMarketArgs(args)) {
              break;
            }
            const stocksArgs = stripStocksMarketPrefix(args);
            setState((prev) => ({ ...prev, messages: [...prev.messages, userMessage], isLoading: true }));
            const message = await handleStocksCommand(`orders ${stocksArgs}`.trim());
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
          case "handle_strategy_command": {
            setState((prev) => ({ ...prev, messages: [...prev.messages, userMessage], isLoading: true }));
            const message = await handleStrategyCommand(args);
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
          case "arm_system": {
            const currentConfig = await loadConfig();
            const isArming = command.name === "arm";
            if (isArming) {
              const armHours = 24;
              const armedUntil = new Date(Date.now() + armHours * 60 * 60 * 1000).toISOString();
              configRef.current = { ...currentConfig, mode: "ARMED", armedUntil };
              await saveConfig(configRef.current);
              setState((prev) => ({
                ...prev,
                mode: "ARMED",
                messages: [
                  ...prev.messages,
                  userMessage,
                  {
                    role: "gordon",
                    content: `System **live enabled** for ${armHours} hours.\n\nI can now execute approved trade plans. I will still ask for your explicit confirmation before placing any order.\n\nTo return to read-only mode: \`/disarm\``,
                    timestamp: formatTimestamp(),
                  },
                ],
              }));
            } else {
              configRef.current = { ...currentConfig, mode: "SAFE", armedUntil: null };
              await saveConfig(configRef.current);
              setState((prev) => ({
                ...prev,
                mode: "SAFE",
                messages: [
                  ...prev.messages,
                  userMessage,
                  {
                    role: "gordon",
                    content: "System **read-only**. Live order execution is disabled.",
                    timestamp: formatTimestamp(),
                  },
                ],
              }));
            }
            return;
          }
          default:
            break;
        }
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
      const stream = processMessageStream(
        messageToSend,
        context,
        state.session?.threadId,
        state.session?.resourceId,
        { signal: streamAbortController.signal }
      );
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

      // Throttled version — batches updates every 50ms for smooth rendering
      const scheduleUpdate = (): void => {
        if (!pendingUpdate) {
          pendingUpdate = true;
          pendingTimer = setTimeout(() => {
            pendingUpdate = false;
            pendingTimer = null;
            updateStreamingMessage(fullContent, currentAgentName);
          }, 50);
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
    refreshActiveExchange,
    refreshActiveBroker,
    openChatWorkspace,
    openQuickActionsOverlay,
    openShortcutsOverlay,
    appendCurrentActionLogEntry,
    resolveThreadFromQuery,
    updateMessageByTimestamp,
    updateLastResultsFromTool,
  ]);

  const handleSubmit = useCallback(async (value: string): Promise<void> => {
    const queuedIntent = parseQueuedSubmission(value);
    if (!queuedIntent) {
      return;
    }

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
              ? `Steering update queued. Gordon will stop the current run and pivot to:\n\n${queuedIntent.preview}`
              : `Queued follow-up for after the current run:\n\n${queuedIntent.preview}`,
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

    const syncBackgroundStatus = async (): Promise<void> => {
      if (disposed) return;
      await refreshBackgroundTaskTree();
    };

    void syncBackgroundStatus();
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
          const stream = processMessageStream(
            prompt,
            context,
            state.session?.threadId,
            state.session?.resourceId,
            { signal: streamAbortController.signal }
          );
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
              }, 50);
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

    const submitMenuCommand = (command: string): void => {
      openChatWorkspace();
      void handleSubmit(command);
    };

    switch (option) {
      case "chat":
        openChatWorkspace();
        break;
      case "scan":
        if (!exchangeRef.current) {
          setState((prev) => ({
            ...prev,
            view: "chat",
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
        if (!exchangeRef.current) {
          setState((prev) => ({
            ...prev,
            view: "chat",
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
              const portfolioStart = Date.now();
              const allBalances = await exchangeRef.current!.getAllBalances();

              // Calculate total value and extract USDT balance
              let totalValue = 0;
              let usdtBalance = 0;
              const holdings: Array<{ asset: string; amount: number; usdtValue: number; wallet?: string; note?: string }> = [];

              // USD-pegged stablecoins
              const stablecoins = ["USDT", "USD", "USDC", "BUSD", "TUSD", "USDP", "FDUSD"];

              for (const balance of allBalances) {
                const amount = balance.total ?? (balance.free + balance.locked);
                let usdtValue = 0;

                if (stablecoins.includes(balance.asset)) {
                  // Stablecoins are 1:1 with USD
                  usdtValue = amount;
                  if (balance.asset === "USDT" || balance.asset === "USD") {
                    usdtBalance += amount;
                  }
                } else {
                  // Try to get price from the active exchange (works for crypto and some fiat like EUR)
                  try {
                    const price = await exchangeRef.current!.getPrice(`${balance.asset}USDT`);
                    usdtValue = amount * price;
                  } catch (error) {
                    console.error(`No USDT pair for ${balance.asset}:`, error);
                    // Show raw amount without USD value
                    holdings.push({
                      asset: balance.asset,
                      amount,
                      usdtValue: 0,
                      wallet: "spot",
                      note: "No USD rate"
                    });
                    continue;
                  }
                }

                if (usdtValue > 0.01) {
                  holdings.push({ asset: balance.asset, amount, usdtValue, wallet: "spot" });
                  totalValue += usdtValue;
                }
              }

              // Sort by value
              holdings.sort((a, b) => b.usdtValue - a.usdtValue);

              const executionTime = Date.now() - portfolioStart;

              const formatted = formatPortfolioResults({
                totalValue,
                availableCash: usdtBalance,
                holdings: holdings.map((h) => ({
                  asset: h.asset,
                  total: h.amount,
                  usdValue: h.usdtValue,
                  wallet: h.wallet,
                  note: h.note,
                })),
                executionTime,
                maxRows: 15,
              });

              setState((prev) => ({
                ...prev,
                portfolioValue: totalValue,
                availableCash: usdtBalance,
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
        submitMenuCommand("/preview-order");
        break;
      case "plan":
        submitMenuCommand("/plan");
        break;
      case "positions":
        submitMenuCommand("/positions");
        break;
      case "orders":
        submitMenuCommand("/orders");
        break;
      case "wallet":
        submitMenuCommand("/wallet");
        break;
      case "fund":
        submitMenuCommand("/fund quote");
        break;
      case "strategies-live":
        submitMenuCommand("/strategies-live");
        break;
      case "regime":
        submitMenuCommand("/regime");
        break;
      case "bridge":
        setState((prev) => ({
          ...prev,
          view: "chat",
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
        submitMenuCommand("/chains");
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
    runMenuStream,
  ]);

  // Handle onboarding completion
  const handleOnboardingComplete = useCallback(
    async (selection: OnboardingSelection): Promise<void> => {
      // Update config with onboarding complete
      const updatedConfig: GordonConfig = {
        ...configRef.current,
        onboardingComplete: true,
      };
      configRef.current = updatedConfig;
      await saveConfig(updatedConfig);

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

    // Try to initialize LLM client with new keys
    try {
      llmClientRef.current = createLLMClientFromEnv();
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

    // Show shortcuts with ? key (only when not actively typing in chat input)
    // The ? should only trigger when in menu view or when the shortcuts overlay is toggled
    if (input === "?" && (state.view === "menu" || isOverlayOpen(state.overlay, "quick-actions"))) {
      openShortcutsOverlay();
      return;
    }

    if (state.view === "welcome" && input.toLowerCase() === "b") {
      const nextBannerMode = configRef.current.startupBannerMode === "quiet" ? "full" : "quiet";
      const updatedConfig = { ...configRef.current, startupBannerMode: nextBannerMode };
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
  }, { isActive: true });

  const visibleThreadPolicy = useMemo(
    () => buildVisibleThreadPolicy({
      messages: state.messages,
      isStreaming: state.isStreaming,
      hasTaskTree: Boolean(state.taskTree),
      hasBackgroundTasks: Boolean(state.backgroundTaskTree),
    }),
    [state.backgroundTaskTree, state.isStreaming, state.messages, state.taskTree]
  );
  const maxVisibleMessages = visibleThreadPolicy.visibleLimit;
  const hiddenMessageCount = visibleThreadPolicy.hiddenCount;
  const visibleMessages = useMemo(
    () => (hiddenMessageCount > 0 ? state.messages.slice(-maxVisibleMessages) : state.messages),
    [hiddenMessageCount, maxVisibleMessages, state.messages]
  );
  const hasWalletRails = (
    configRef.current.agentRails.walletProviders.length > 0
    || configRef.current.agentRails.chainProviders.length > 0
    || configRef.current.agentRails.paymentProviders.length > 0
  );
  const quickActionsOverlayOpen = isOverlayOpen(state.overlay, "quick-actions");
  const shortcutsOverlayOpen = isOverlayOpen(state.overlay, "shortcuts");
  const showChatBanner = state.view === "chat" && state.messages.length < 4;

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
          <Box flexDirection="column" flexGrow={1}>
            {/* Startup hint - shows for 5 seconds */}
            {state.showStartupHint && state.messages.length === 0 && !showChatBanner && (
              <ShortcutsHint
                duration={5000}
                visible={state.showStartupHint}
              />
            )}

            {showChatBanner && (
              <WelcomeBanner mode={configRef.current.startupBannerMode} context="chat" />
            )}

            <ChatView
              messages={visibleMessages}
              hiddenCount={hiddenMessageCount}
              visibleLimit={maxVisibleMessages}
              isStreaming={state.isStreaming}
              activeStreamingTimestamp={state.streamingMessageTimestamp}
              activityStatus={state.activityStatus}
              activeToolCall={state.activeToolCall}
            />

            {quickActionsOverlayOpen && (
              <QuickStartMenu
                onSelect={handleMenuSelect}
                onTypeToChat={(seed) => openChatWorkspace({ seed, resetInput: true })}
                mode={state.mode}
                setupComplete={configRef.current.onboardingComplete}
                hasExchange={Boolean(exchangeRef.current)}
                hasBroker={Boolean(brokerRef.current)}
                hasWalletRails={hasWalletRails}
                hasMcpServers={configRef.current.mcpServers.length > 0}
                variant="overlay"
              />
            )}

            {(state.isLoading || state.isStreaming || state.queuedSubmissions.length > 0) && (
              <Box
                flexDirection="column"
                borderStyle="round"
                borderColor={COLORS.ACCENT_DIM}
                marginX={2}
                marginBottom={1}
                paddingX={1}
              >
                <Text color={COLORS.WHITE}>
                  {state.isStreaming
                    ? "Run active"
                    : state.isLoading
                      ? "Run starting"
                      : "Queue ready"}
                  {state.activityStatus ? `: ${state.activityStatus}` : ""}
                </Text>
                <Text color={COLORS.DIM}>
                  {"Esc stops the active streamed response when possible. Enter queues a follow-up. Use /steer <message> to redirect the next run."}
                </Text>
                {state.taskTree && <TaskTree tree={state.taskTree} />}
                {state.queuedSubmissions.length > 0 && (
                  <Text color={COLORS.HIGHLIGHT}>
                    Next queued: {state.queuedSubmissions[0]?.preview}
                    {state.queuedSubmissions.length > 1 ? ` (+${state.queuedSubmissions.length - 1} more)` : ""}
                  </Text>
                )}
              </Box>
            )}

            {state.backgroundTaskTree && (
              <Box
                flexDirection="column"
                borderStyle="round"
                borderColor={COLORS.TAN_DIM}
                marginX={2}
                marginBottom={1}
                paddingX={1}
              >
                <Text color={COLORS.DIM}>
                  Daemon-owned work continues outside the active chat run.
                </Text>
                <TaskTree tree={state.backgroundTaskTree} title="Background Tasks" />
              </Box>
            )}

            {state.isLoading && (
              <ProgressIndicator
                label={state.activityStatus || "Gordon is thinking..."}
                status="Routing request and preparing the response..."
                onCancel={cancelActiveResponse}
                cancellable={Boolean(activeStreamAbortControllerRef.current)}
              />
            )}
            {state.isStreaming && (
              <StreamingProgress
                operation={state.activityStatus || "Streaming response..."}
                currentTool={state.activeToolCall}
                isStreaming={state.isStreaming}
                onCancel={cancelActiveResponse}
              />
            )}

            {/* Input area - isolated component to prevent re-render issues */}
            <ChatInput
              onSubmit={handleSubmit}
              onOpenQuickActions={openQuickActionsOverlay}
              disabled={quickActionsOverlayOpen}
              busy={state.isLoading || state.isStreaming}
              queueDepth={state.queuedSubmissions.length}
              placeholder={
                quickActionsOverlayOpen
                  ? "Quick Actions open..."
                  : state.isLoading || state.isStreaming
                  ? "Waiting for response..."
                  : "Ask Gordon anything..."
              }
              seedValue={state.chatInputSeed}
              seedNonce={state.chatInputSeedNonce}
              quickActionContext={{
                mode: state.mode,
                setupComplete: configRef.current.onboardingComplete,
                hasExchange: Boolean(exchangeRef.current),
                hasBroker: Boolean(brokerRef.current),
                hasWalletRails,
              }}
            />

            {/* Help hint */}
            <Box paddingX={2} paddingY={0}>
              <Text color={COLORS.DIM}>
                Ctrl+K: actions | ESC: stop agent response | /menu: actions | /help: commands
              </Text>
            </Box>
          </Box>
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
