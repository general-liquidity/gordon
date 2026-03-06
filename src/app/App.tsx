import React, { useState, useCallback, useEffect, useRef, useMemo } from "react";
import { Box, Text, useInput } from "ink";
import { Spinner, Alert, StatusMessage } from "@inkjs/ui";
import { ChatInput } from "./ChatInput.tsx";

import { StatusBar, type ThreadStatusInfo, type ChainStatusInfo } from "./StatusBar.tsx";
import type { TickerItem } from "./components/effects/index.ts";
import { WelcomeBanner } from "./WelcomeBanner.tsx";
import { QuickStartMenu, type MenuOption } from "./QuickStartMenu.tsx";
import { ChatView, type ChatMessage } from "./ChatView.tsx";
import { Onboarding } from "./Onboarding.tsx";
import { SetupWizard } from "./SetupWizard.tsx";
import { ModelSelector } from "./ModelSelector.tsx";
import { ShortcutsOverlay, ShortcutsHint, useShortcutsHint } from "./components/ShortcutsOverlay.tsx";
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
import {
  parseSlashCommand,
  commandToPrompt,
  formatCommandHelp,
  parseHelpArg,
  formatPaginatedCommandHelp,
  formatAnalysisCommandsHelp,
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
import type {
  ScanExportData,
  AnalysisExportData,
  BacktestExportData,
} from "./commands/export.ts";

type AppView = "loading" | "onboarding" | "setup" | "model" | "welcome" | "menu" | "chat";

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
  activeToolCall: string | null;
  activityStatus: string | null;
  conversationHistory: ConversationMessage[];
  btcPrice: number | undefined;
  showShortcuts: boolean;
  showStartupHint: boolean;
  /** Current session info for Mastra agent memory */
  session: SessionInfo | null;
  /** Thread info for status bar display */
  threadStatusInfo: ThreadStatusInfo | null;
  /** Chain network status for status bar */
  chainStatus: ChainStatusInfo | null;
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

function getIdSuffix(id: string): string {
  const separatorIndex = id.indexOf("_");
  return separatorIndex >= 0 ? id.slice(separatorIndex + 1) : id;
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
  };
}

function formatTimestamp(): string {
  return new Date().toLocaleTimeString("en-US", {
    hour: "2-digit",
    minute: "2-digit",
  });
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
    activeToolCall: null,
    activityStatus: null,
    conversationHistory: [],
    btcPrice: undefined,
    showShortcuts: false,
    showStartupHint: true,
    session: null,
    threadStatusInfo: null,
    chainStatus: null,
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

  const refreshActiveExchange = useCallback(async (): Promise<void> => {
    try {
      const config = await loadConfig();
      configRef.current = config;

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
  }, []);

  const refreshActiveBroker = useCallback(async (): Promise<void> => {
    try {
      const config = await loadConfig();
      configRef.current = config;

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
  }, []);

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
            logLevel: "info",
          });
        } catch (error) {
          console.error("Failed to initialize service container:", error);
        }
      });

      // Use the already fetched env status
      const envStatus = envStatusEarly;

      // Load config and check onboarding status
      const config = await loadConfig();
      configRef.current = config;

      // Determine initial view:
      // - If keys are configured (either in .env or env vars), skip onboarding
      // - If onboarding was completed before, show welcome
      // - Otherwise show onboarding
      let initialView: AppView;

      if (envStatus.hasLLMKey) {
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
              console.log(`Reconciliation complete: ${result.ordersUpdated} orders synced`);
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
          console.log("[v0.7] MarketEventEmitter ready");
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
            }) as GordonContext;
            const stream = processMessageStream(prompt, gordonCtx, session?.threadId ?? undefined, session?.resourceId);
            for await (const _event of stream) {
              // Consume stream for event-driven flows.
            }
          });
          console.log("[v0.7] AgentInvoker wired");
        } catch (err) {
          console.error("[v0.7] AgentInvoker setup failed:", err);
        }
      });

      // Initialize session for Mastra agent memory
      // Auto-resume is disabled by default - creates fresh sessions
      // Users can use /resume to continue previous sessions
      const session = await initializeSession({ autoResume: false });
      console.log(`[Gordon] Session initialized: threadId=${session.threadId}, resourceId=${session.resourceId}, isNew=${session.isNewSession}`);

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

  const handleSubmit = useCallback(async (value: string): Promise<void> => {
    if (!value.trim()) return;
    if (state.isLoading || state.isStreaming) return;

    // Check for slash commands
    const parsedCommand = parseSlashCommand(value);
    let messageToSend = value.trim();
    let displayMessage = value.trim();

    if (parsedCommand) {
      const { command, args } = parsedCommand;

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
        setState((prev) => ({ ...prev, view: "setup" }));
        return;
      }

      if (command.action === "menu" && command.target === "model") {
        setState((prev) => ({ ...prev, view: "model" }));
        return;
      }

      if (command.action === "menu" && command.target === "shortcuts") {
        setState((prev) => ({ ...prev, showShortcuts: true }));
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
            "**Available Threads:**\n",
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

      // Handle /help command locally for known help modes
      if (command.name === "help") {
        const helpArg = args.trim();
        const normalized = helpArg.toLowerCase();
        const isPaginatedHelp = normalized.startsWith("page") || normalized === "market" || normalized === "account";
        const isHelpMode =
          normalized === "" ||
          normalized === "advanced" ||
          normalized === "all" ||
          normalized === "expert" ||
          normalized === "trading" ||
          normalized === "analysis" ||
          normalized === "system";

        if (!helpArg || isPaginatedHelp || isHelpMode) {
          let helpContent = "";
          if (!helpArg) {
            helpContent = formatCommandHelp();
          } else if (normalized === "analysis") {
            helpContent = formatAnalysisCommandsHelp();
          } else if (isPaginatedHelp) {
            helpContent = formatPaginatedCommandHelp(helpArg);
          } else {
            const { mode, category } = parseHelpArg(helpArg);
            helpContent = formatCommandHelp(mode, category);
          }

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
              const updatedConfig = await loadConfig();
              configRef.current = updatedConfig;
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
              await saveConfig({ ...currentConfig, mode: "ARMED", armedUntil });
              setState((prev) => ({
                ...prev,
                mode: "ARMED",
                messages: [
                  ...prev.messages,
                  userMessage,
                  {
                    role: "gordon",
                    content: `System **ARMED** for ${armHours} hours. Trading enabled.\n\nI can now execute approved trade plans. I will still ask for your explicit confirmation before placing any order.\n\nTo disarm: \`/disarm\``,
                    timestamp: formatTimestamp(),
                  },
                ],
              }));
            } else {
              await saveConfig({ ...currentConfig, mode: "SAFE", armedUntil: null });
              setState((prev) => ({
                ...prev,
                mode: "SAFE",
                messages: [
                  ...prev.messages,
                  userMessage,
                  {
                    role: "gordon",
                    content: "System **DISARMED**. Back to SAFE mode. No trades will be executed.",
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
      activityStatus: "Routing request...",
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
      activeToolCall: null,
      activityStatus: "Preparing response...",
    }));

    try {
      // Use streaming API with session threadId and resourceId for memory continuity
      const stream = processMessageStream(
        messageToSend,
        context,
        state.session?.threadId,
        state.session?.resourceId
      );
      let fullContent = "";
      let currentAgentName: string | undefined;
      let pendingUpdate = false;

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
          setTimeout(() => {
            pendingUpdate = false;
            updateStreamingMessage(fullContent, currentAgentName);
          }, 50);
        }
      };

      for await (const event of stream) {
        switch (event.type) {
          case "text_delta":
            if (event.content) {
              fullContent += event.content;
              scheduleUpdate();
            }
            break;

          case "agent_switch":
            if (event.agentName) {
              currentAgentName = event.agentName;
              // Update the message with the new agent attribution
              updateStreamingMessage(fullContent, currentAgentName);
            }
            break;

          case "tool_call_start":
            setState((prev) => ({
              ...prev,
              activeToolCall: event.toolName || "tool",
              activityStatus: `Running ${event.toolName || "tool"}...`,
            }));
            // If the tool call has agent info, update attribution
            if (event.agentName && event.agentName !== currentAgentName) {
              currentAgentName = event.agentName;
              updateStreamingMessage(fullContent, currentAgentName);
            }
            break;

          case "tool_call_end":
            setState((prev) => ({
              ...prev,
              activeToolCall: null,
              activityStatus: "Finalizing response...",
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
            updateStreamingMessage(fullContent, currentAgentName);
            setState((prev) => ({
              ...prev,
              isStreaming: false,
              activeToolCall: null,
              activityStatus: null,
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
            break;

          case "error":
            updateStreamingMessage(
              fullContent || `Sorry, I encountered an error: ${event.error}. Please try again.`,
              currentAgentName
            );
            setState((prev) => ({
              ...prev,
              isStreaming: false,
              activeToolCall: null,
              activityStatus: null,
            }));
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
          isLoading: false,
          activeToolCall: null,
          activityStatus: null,
        };
      });
    }
  }, [
    state.isLoading,
    state.isStreaming,
    state.conversationHistory,
    state.portfolioValue,
    state.availableCash,
    state.messages,
    refreshActiveExchange,
    refreshActiveBroker,
    updateMessageByTimestamp,
    updateLastResultsFromTool,
  ]);

  /**
   * Stream a prompt through the agent and update the last Gordon message in-place.
   * Shared by menu-triggered streaming handlers (trending, chains, etc.)
   */
  const runMenuStream = useCallback(
    (prompt: string, messageTimestamp: string, errorPrefix: string) => {
      (async () => {
        if (!llmClientRef.current) return;
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
        });

        setState((prev) => ({
          ...prev,
          messages: [...prev.messages, { role: "gordon" as const, content: "", timestamp: messageTimestamp }],
          isStreaming: true,
          activityStatus: "Preparing response...",
        }));

        const updateMsg = (content: string, agent?: string): void => {
          updateMessageByTimestamp(messageTimestamp, (message) => ({
            ...message,
            content,
            agent: agent || message.agent,
          }));
        };

        let currentAgent: string | undefined;
        try {
          const stream = processMessageStream(prompt, context, state.session?.threadId, state.session?.resourceId);
          let fullContent = "";
          let pendingUpdate = false;

          const scheduleUpdate = (): void => {
            if (!pendingUpdate) {
              pendingUpdate = true;
              setTimeout(() => {
                pendingUpdate = false;
                updateMsg(fullContent, currentAgent);
              }, 50);
            }
          };

          for await (const event of stream) {
            switch (event.type) {
              case "text_delta":
                if (event.content) {
                  fullContent += event.content;
                  scheduleUpdate();
                }
                break;
              case "agent_switch":
                if (event.agentName) {
                  currentAgent = event.agentName;
                  updateMsg(fullContent, currentAgent);
                }
                break;
              case "tool_call_start":
                setState((prev) => ({
                  ...prev,
                  activeToolCall: event.toolName || "tool",
                  activityStatus: `Running ${event.toolName || "tool"}...`,
                }));
                if (event.agentName) {
                  currentAgent = event.agentName;
                }
                break;
              case "tool_call_end":
                setState((prev) => ({
                  ...prev,
                  activeToolCall: null,
                  activityStatus: "Finalizing response...",
                }));
                break;
              case "done":
                if (event.agentName) currentAgent = event.agentName;
                updateMsg(fullContent, currentAgent);
                setState((prev) => ({
                  ...prev,
                  isStreaming: false,
                  activeToolCall: null,
                  activityStatus: null,
                }));
                break;
              case "error":
                updateMsg(fullContent || `${errorPrefix}: ${event.error}`, currentAgent);
                setState((prev) => ({
                  ...prev,
                  isStreaming: false,
                  activeToolCall: null,
                  activityStatus: null,
                }));
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
            activeToolCall: null,
            activityStatus: null,
          }));
        }
      })();
    },
    [state.portfolioValue, state.availableCash, state.session?.resourceId, state.session?.threadId, updateMessageByTimestamp]
  );

  // Handle menu selection
  const handleMenuSelect = useCallback((option: MenuOption): void => {
    switch (option) {
      case "chat":
        setState((prev) => ({ ...prev, view: "chat" }));
        break;
      case "scan":
        if (!exchangeRef.current) {
          setState((prev) => ({
            ...prev,
            view: "chat",
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
        setState((prev) => ({ ...prev, view: "setup" }));
        break;
      case "help":
        setState((prev) => ({
          ...prev,
          view: "chat",
          messages: [
            ...prev.messages,
            {
              role: "gordon",
              content: formatCommandHelp(),
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
      case "strategies-live":
        setState((prev) => ({
          ...prev,
          view: "chat",
          messages: [
            ...prev.messages,
            {
              role: "gordon",
              content: "Use `/strategies-live` to view running strategies, portfolio state, and health.",
              timestamp: formatTimestamp(),
            },
          ],
        }));
        break;
      case "regime":
        setState((prev) => ({
          ...prev,
          view: "chat",
          messages: [
            ...prev.messages,
            {
              role: "gordon",
              content: "Use `/regime` to detect current market conditions and matching strategies.",
              timestamp: formatTimestamp(),
            },
          ],
        }));
        break;
      case "bridge":
        setState((prev) => ({
          ...prev,
          view: "chat",
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
        const chainsTs = formatTimestamp();
        setState((prev) => ({
          ...prev,
          view: "chat",
          messages: [
            ...prev.messages,
            { role: "user", content: "/chains", timestamp: chainsTs },
          ],
        }));
        runMenuStream(
          "Show me which blockchain networks are configured and available. List the tools and capabilities for each configured chain.",
          chainsTs,
          "Failed to check chains"
        );
        break;
      }
    }
  }, [state.portfolioValue, state.availableCash, state.conversationHistory, formatCommandError, runMenuStream]);

  // Handle onboarding completion
  const handleOnboardingComplete = useCallback(
    async (options: { setupApiKeys: boolean; demoMode: boolean }): Promise<void> => {
      // Update config with onboarding complete
      const updatedConfig: GordonConfig = {
        ...configRef.current,
        onboardingComplete: true,
      };
      configRef.current = updatedConfig;
      await saveConfig(updatedConfig);

      // Navigate based on user choice
      if (options.setupApiKeys) {
        // Go to setup wizard to collect API keys
        setState((prev) => ({
          ...prev,
          view: "setup",
        }));
      } else {
        // Demo mode
        setState((prev) => ({
          ...prev,
          view: "chat",
          messages: [
            {
              role: "gordon",
              content: `Welcome to demo mode! You're in SAFE mode, so nothing will execute.

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

      setState((prev) => ({
        ...prev,
        view: "chat",
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
  }, []);

  // Handle global keyboard shortcuts
  useInput((input, key) => {
    // Don't process input during loading or onboarding (onboarding has its own handler)
    if (state.view === "loading" || state.view === "onboarding" || state.view === "model") {
      return;
    }

    // Handle shortcuts overlay
    if (state.showShortcuts) {
      if (key.escape || input === "?") {
        setState((prev) => ({ ...prev, showShortcuts: false }));
      }
      return;
    }

    // Show shortcuts with ? key (only when not actively typing in chat input)
    // The ? should only trigger when in menu view or when the shortcuts overlay is toggled
    if (input === "?" && state.view === "menu") {
      setState((prev) => ({ ...prev, showShortcuts: true }));
      return;
    }

    // ESC to go back to menu from chat
    if (key.escape && state.view === "chat") {
      setState((prev) => ({ ...prev, view: "menu" }));
    }

    // Any key to dismiss welcome banner
    if (state.view === "welcome" && (input || key.return)) {
      setState((prev) => ({ ...prev, view: "menu" }));
    }
  });

  // Build ticker items from available price data
  const tickerItems = useMemo((): TickerItem[] => {
    const items: TickerItem[] = [];
    if (state.btcPrice !== undefined) {
      items.push({ symbol: "BTC", price: state.btcPrice, change: 0 });
    }
    return items;
  }, [state.btcPrice]);

  const maxVisibleMessages = 80;
  const hiddenMessageCount = Math.max(0, state.messages.length - maxVisibleMessages);
  const visibleMessages = useMemo(
    () => (hiddenMessageCount > 0 ? state.messages.slice(-maxVisibleMessages) : state.messages),
    [hiddenMessageCount, maxVisibleMessages, state.messages]
  );

  return (
    <Box flexDirection="column" height="100%">
      {/* Status Bar - hidden during loading to prevent SAFE→ARMED flicker */}
      {state.view !== "loading" && (
        <StatusBar
          mode={state.mode}
          portfolioValue={state.portfolioValue}
          connectionStatus={state.connectionStatus}
          btcPrice={state.btcPrice}
          threadInfo={state.threadStatusInfo || undefined}
          tickerItems={tickerItems}
          chainStatus={state.chainStatus || undefined}
        />
      )}

      {/* Shortcuts Overlay */}
      {state.showShortcuts && (
        <ShortcutsOverlay onClose={() => setState((prev) => ({ ...prev, showShortcuts: false }))} />
      )}

      {/* Main content area */}
      <Box flexDirection="column" flexGrow={1}>
        {state.view === "loading" && (
          <Box flexDirection="column" paddingX={2} paddingY={1}>
            <Spinner label="Loading Gordon..." />
          </Box>
        )}

        {state.view === "onboarding" && (
          <Onboarding onComplete={handleOnboardingComplete} />
        )}

        {state.view === "setup" && (
          <SetupWizard onComplete={handleSetupComplete} />
        )}

        {state.view === "model" && (
          <ModelSelector onComplete={handleModelComplete} />
        )}

        {state.view === "welcome" && (
          <WelcomeBanner />
        )}

        {state.view === "menu" && (
          <QuickStartMenu onSelect={handleMenuSelect} mode={state.mode} />
        )}

        {state.view === "chat" && (
          <Box flexDirection="column" flexGrow={1}>
            {/* Startup hint - shows for 5 seconds */}
            {state.showStartupHint && state.messages.length === 0 && (
              <ShortcutsHint
                duration={5000}
                visible={state.showStartupHint}
              />
            )}

            <ChatView messages={visibleMessages} hiddenCount={hiddenMessageCount} />

            {/* Loading/Streaming indicator */}
            {state.isLoading && (
              <Box paddingX={2}>
                <Spinner label={state.activityStatus || "Gordon is thinking..."} />
              </Box>
            )}
            {state.isStreaming && (state.activeToolCall || state.activityStatus) && (
              <Box paddingX={2}>
                <Spinner label={state.activityStatus || `Running ${state.activeToolCall}...`} />
              </Box>
            )}

            {/* Input area - isolated component to prevent re-render issues */}
            <ChatInput
              onSubmit={handleSubmit}
              disabled={state.isLoading || state.isStreaming}
              placeholder={
                state.isLoading || state.isStreaming
                  ? "Waiting for response..."
                  : "Ask Gordon anything..."
              }
            />

            {/* Help hint */}
            <Box paddingX={2} paddingY={0}>
              <Text color={COLORS.DIM}>
                ESC: menu | /help: commands | /theme: toggle theme | ?: shortcuts
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
