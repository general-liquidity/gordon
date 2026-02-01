import React, { useState, useCallback, useEffect, useRef } from "react";
import { Box, Text, useInput } from "ink";
import { Spinner, Alert, StatusMessage } from "@inkjs/ui";
import { ChatInput } from "./ChatInput.tsx";

import { StatusBar } from "./StatusBar.tsx";
import { WelcomeBanner } from "./WelcomeBanner.tsx";
import { QuickStartMenu, type MenuOption } from "./QuickStartMenu.tsx";
import { ChatView, type ChatMessage } from "./ChatView.tsx";
import { Onboarding } from "./Onboarding.tsx";
import { SetupWizard } from "./SetupWizard.tsx";
import { ModelSelector } from "./ModelSelector.tsx";
import { ShortcutsOverlay, ShortcutsHint, useShortcutsHint } from "./components/ShortcutsOverlay.tsx";
import { ThemeProvider, useTheme } from "./components/ThemeProvider.tsx";
import { processMessageStream, initializeTracing } from "../infra/agents/orchestrator.ts";
import { createLLMClientFromEnv, type LLMClient } from "../infra/llm/index.ts";
import { BinanceClient } from "../infra/binance/index.ts";
import {
  runMonitorCycle,
  initializeRealtimeMonitor,
  shutdownRealtimeMonitor,
} from "../core/monitor.ts";
import { runOrderRecovery } from "../core/order-recovery.ts";
import { listTrades } from "../infra/storage/trades.ts";
import { scan } from "../core/scanner.ts";
import { loadConfig, saveConfig } from "../infra/storage/config.ts";
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
import type { GordonContext } from "../infra/agents/types.ts";
import type { Mode, GordonConfig } from "../types/index.ts";
import { COLORS, type ThemeName } from "./theme.ts";
import { parseSlashCommand, commandToPrompt, formatCommandHelp } from "./slashCommands.ts";

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
  conversationHistory: ConversationMessage[];
  btcPrice: number | undefined;
  showShortcuts: boolean;
  showStartupHint: boolean;
  /** Current session info for Mastra agent memory */
  session: SessionInfo | null;
}

function getDefaultConfig(): GordonConfig {
  return {
    version: "1.0.0",
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
  };
}

function formatTimestamp(): string {
  return new Date().toLocaleTimeString("en-US", {
    hour: "2-digit",
    minute: "2-digit",
  });
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
    conversationHistory: [],
    btcPrice: undefined,
    showShortcuts: false,
    showStartupHint: true,
    session: null,
  });

  const llmClientRef = useRef<LLMClient | null>(null);
  const binanceClientRef = useRef<BinanceClient | null>(null);
  const configRef = useRef<GordonConfig>(getDefaultConfig());

  // Initialize config and LLM client on mount
  useEffect(() => {
    async function initialize(): Promise<void> {
      // Initialize database first
      await initDatabase();

      // Load .env file (if it exists)
      await loadEnvFile();

      // Check environment status early to get keys
      const envStatusEarly = await checkEnvStatus();

      // Initialize service container with available credentials
      try {
        await initializeContainer({
          binance: envStatusEarly.hasBinanceKeys && envStatusEarly.keys.BINANCE_API_KEY && envStatusEarly.keys.BINANCE_API_SECRET
            ? {
                apiKey: envStatusEarly.keys.BINANCE_API_KEY,
                apiSecret: envStatusEarly.keys.BINANCE_API_SECRET,
              }
            : undefined,
          openai: envStatusEarly.hasLLMKey && envStatusEarly.keys.OPENAI_API_KEY
            ? { apiKey: envStatusEarly.keys.OPENAI_API_KEY }
            : undefined,
          logLevel: "info",
        });
      } catch (error) {
        console.error("Failed to initialize service container:", error);
      }

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

        // Initialize tracing for Mastra Agent
        if (envStatus.keys.OPENAI_API_KEY) {
          initializeTracing();
        }
      } catch (error) {
        console.error("Failed to initialize LLM client:", error);
      }

      // Initialize Binance client if keys are available
      if (envStatus.hasBinanceKeys && envStatus.keys.BINANCE_API_KEY && envStatus.keys.BINANCE_API_SECRET) {
        try {
          binanceClientRef.current = new BinanceClient(
            envStatus.keys.BINANCE_API_KEY,
            envStatus.keys.BINANCE_API_SECRET
          );

          // Reconcile local state with Binance on startup
          // This ensures any orders that filled while offline are recorded
          reconcileWithBinance(binanceClientRef.current)
            .then((result) => {
              if (result.ordersUpdated > 0) {
                console.log(`Reconciliation complete: ${result.ordersUpdated} orders synced`);
              }
              if (result.warnings.length > 0) {
                console.warn("Reconciliation warnings:", result.warnings);
              }
              if (result.errors.length > 0) {
                console.error("Reconciliation errors:", result.errors);
              }
            })
            .catch((error) => {
              console.error("Reconciliation failed:", error);
            });

          // Run order recovery only if there are active trades
          const allTrades = listTrades({});
          const activeTrades = allTrades.filter(
            (t) => t.status === "OPEN" || t.status === "PARTIAL"
          );

          if (activeTrades.length > 0) {
            const knownTradeIds = new Set(
              allTrades.map((t) => t.id.replace("trade_", ""))
            );
            runOrderRecovery(binanceClientRef.current, knownTradeIds, {
              logResults: true,
            })
              .then((recoveryResult) => {
                if (recoveryResult.orphaned.length > 0) {
                  console.warn(
                    `Found ${recoveryResult.orphaned.length} orphaned orders on Binance`
                  );
                }
              })
              .catch(() => {
                // Silently ignore - not critical for startup
              });
          }

          // Initialize real-time WebSocket monitoring (optional enhancement)
          initializeRealtimeMonitor().catch((error) => {
            console.warn("Real-time monitoring unavailable:", error);
          });
        } catch (error) {
          console.error("Failed to initialize Binance client:", error);
        }
      }

      // Initialize session for Mastra agent memory
      // Auto-resume is disabled by default - creates fresh sessions
      // Users can use /resume to continue previous sessions
      const session = await initializeSession({ autoResume: false });
      console.log(`[Gordon] Session initialized: threadId=${session.threadId}, resourceId=${session.resourceId}, isNew=${session.isNewSession}`);

      // Ensure the current thread is registered in the thread registry
      // This enables thread management features like cloning and listing
      await ensureThreadRegistered();

      setState((prev) => ({
        ...prev,
        view: initialView,
        mode: config.mode,
        connectionStatus: llmClientRef.current ? "connected" : "disconnected",
        session,
      }));
    }

    initialize();
  }, []);

  // Automatic monitor cycle - runs every 15 minutes to check open positions
  useEffect(() => {
    const MONITOR_INTERVAL_MS = 900000; // 15 minutes

    const intervalId = setInterval(() => {
      if (!binanceClientRef.current) {
        return;
      }

      runMonitorCycle(binanceClientRef.current)
        .then((result) => {
          if (result.alerts.length === 0) {
            return;
          }

          const alertMessages: ChatMessage[] = result.alerts.map((alert) => ({
            role: "gordon" as const,
            content: `[Monitor Alert] ${alert.message}`,
            timestamp: formatTimestamp(),
          }));

          setState((prev) => ({
            ...prev,
            messages: [...prev.messages, ...alertMessages],
          }));
        })
        .catch((error) => {
          console.error("Monitor cycle error:", error);
        });
    }, MONITOR_INTERVAL_MS);

    return () => {
      clearInterval(intervalId);
    };
  }, []);

  // Fetch BTC price periodically
  useEffect(() => {
    const fetchBtcPrice = async () => {
      if (!binanceClientRef.current) return;
      try {
        const price = await binanceClientRef.current.getPrice("BTCUSDT");
        setState((prev) => ({ ...prev, btcPrice: price }));
      } catch (error) {
        console.error("Failed to fetch BTC price:", error);
      }
    };

    // Fetch immediately
    fetchBtcPrice();

    // Then every 30 seconds
    const intervalId = setInterval(fetchBtcPrice, 30000);

    return () => clearInterval(intervalId);
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

      // Handle special /help with no args - show command list
      if (command.name === "help" && !args) {
        const helpMessage: ChatMessage = {
          role: "gordon",
          content: formatCommandHelp(),
          timestamp: formatTimestamp(),
        };
        setState((prev) => ({
          ...prev,
          messages: [...prev.messages,
            { role: "user", content: value.trim(), timestamp: formatTimestamp() },
            helpMessage
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
            const cloneMessage: ChatMessage = {
              role: "gordon",
              content: `**Thread Cloned Successfully!**\n\n` +
                `A new branch has been created for "what if" testing.\n\n` +
                `- **New Thread ID:** \`${result.newThreadId.slice(0, 25)}...\`\n` +
                `- **Messages Copied:** ${result.messagesCopied}\n` +
                `- **Source Thread:** \`${result.sourceThreadId.slice(0, 20)}...\`\n\n` +
                `Use \`/switch ${result.newThreadId.slice(0, 15)}\` to switch to the cloned thread, or \`/threads\` to see all threads.`,
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

            const switchMessage: ChatMessage = {
              role: "gordon",
              content: `**Switched to thread: ${targetThread.label}**\n\n` +
                `- **Thread ID:** \`${result.threadId.slice(0, 25)}...\`\n` +
                `- **Messages:** ${targetThread.messageCount}\n\n` +
                `You are now continuing this conversation branch. ` +
                `Your previous thread is still available via \`/threads\`.`,
              timestamp: formatTimestamp(),
            };

            setState((prev) => ({
              ...prev,
              session: newSession,
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
            const cloneInfo = info.clonedFrom
              ? `\n- **Cloned From:** \`${info.clonedFrom.slice(0, 20)}...\``
              : "";
            const infoMessage: ChatMessage = {
              role: "gordon",
              content: `**Thread Info: ${info.label}**\n\n` +
                `- **Thread ID:** \`${info.threadId}\`\n` +
                `- **Status:** ${info.isActive ? "Active" : "Inactive"}\n` +
                `- **Messages:** ${info.messageCount}\n` +
                `- **Created:** ${new Date(info.createdAt).toLocaleString()}\n` +
                `- **Last Active:** ${new Date(info.lastActiveAt).toLocaleString()}` +
                cloneInfo,
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

      // Convert command to natural language for the agent
      messageToSend = commandToPrompt(command, args);
      displayMessage = value.trim(); // Still show the command to user
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
    }));

    // Check if LLM client is configured
    if (!llmClientRef.current) {
      const errorMessage: ChatMessage = {
        role: "gordon",
        content:
          "I'm not fully configured yet. Please set up your API keys in the environment (OPENAI_API_KEY or DEDALUS_API_KEY).",
        timestamp: formatTimestamp(),
      };

      setState((prev) => ({
        ...prev,
        messages: [...prev.messages, errorMessage],
        isLoading: false,
      }));
      return;
    }

    // Build the context for Gordon with session info
    const context: GordonContext = {
      binance: binanceClientRef.current,
      llm: llmClientRef.current,
      config: configRef.current,
      portfolioValue: state.portfolioValue ?? 0,
      availableCash: state.availableCash,
      userId: state.session?.resourceId,
      threadId: state.session?.threadId,
    };

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

      // Helper to update the streaming message with agent attribution
      const updateStreamingMessage = (content: string, agent?: string): void => {
        setState((prev) => {
          const newMessages = [...prev.messages];
          // Find the last Gordon message with matching timestamp (the streaming one)
          for (let i = newMessages.length - 1; i >= 0; i--) {
            const msg = newMessages[i];
            if (msg && msg.role === "gordon" && msg.timestamp === streamingTimestamp) {
              newMessages[i] = {
                role: "gordon",
                content,
                timestamp: streamingTimestamp,
                agent: agent || msg.agent,
              };
              break;
            }
          }
          return { ...prev, messages: newMessages };
        });
      };

      for await (const event of stream) {
        switch (event.type) {
          case "text_delta":
            if (event.content) {
              fullContent += event.content;
              updateStreamingMessage(fullContent, currentAgentName);
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
            }));
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
            }));
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
        };
      });
    }
  }, [state.isLoading, state.isStreaming, state.conversationHistory, state.portfolioValue, state.availableCash]);

  // Handle menu selection
  const handleMenuSelect = useCallback((option: MenuOption): void => {
    switch (option) {
      case "chat":
        setState((prev) => ({ ...prev, view: "chat" }));
        break;
      case "scan":
        if (!binanceClientRef.current) {
          setState((prev) => ({
            ...prev,
            view: "chat",
            messages: [
              ...prev.messages,
              {
                role: "gordon",
                content:
                  "Binance API not connected. Add your API keys to the .env file:\n\nBINANCE_API_KEY=your-key\nBINANCE_API_SECRET=your-secret\n\nThen restart Gordon.",
                timestamp: formatTimestamp(),
              },
            ],
          }));
        } else {
          setState((prev) => ({
            ...prev,
            view: "chat",
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
              const scanResult = await scan(binanceClientRef.current!, {
                topN: configRef.current.preferences.topNCoins,
                timeframes: configRef.current.preferences.defaultTimeframes,
              });

              const coinsWithSetup = scanResult.coins.filter((c) => c.setupDetected);
              const lines: string[] = [];

              if (coinsWithSetup.length === 0) {
                lines.push("**No support bounce setups detected at this time.**\n");
                lines.push(`Scanned ${scanResult.coins.length} coins across ${scanResult.timeframes.join(", ")} timeframes.`);
                lines.push("\nTry again later or ask me to analyze a specific coin.");
              } else {
                lines.push(`**Found ${coinsWithSetup.length} potential setup(s):**\n`);
                lines.push("| Symbol | Price | 24h Change | Confidence | Bias | Risk |");
                lines.push("|--------|-------|------------|------------|------|------|");

                for (const coin of coinsWithSetup.slice(0, 10)) {
                  const changeStr = coin.change24h >= 0
                    ? `+${coin.change24h.toFixed(2)}%`
                    : `${coin.change24h.toFixed(2)}%`;
                  const confidenceStr = `${(coin.setupConfidence * 100).toFixed(0)}%`;

                  lines.push(
                    `| ${coin.symbol} | $${coin.price.toFixed(4)} | ${changeStr} | ${confidenceStr} | ${coin.bias} | ${coin.risk} |`
                  );
                }

                if (coinsWithSetup.length > 10) {
                  lines.push(`\n_...and ${coinsWithSetup.length - 10} more setups_`);
                }

                lines.push("\nAsk me about any of these coins for a detailed analysis and trade plan.");
              }

              setState((prev) => ({
                ...prev,
                messages: [
                  ...prev.messages,
                  {
                    role: "gordon",
                    content: lines.join("\n"),
                    timestamp: formatTimestamp(),
                  },
                ],
              }));
            } catch (error) {
              setState((prev) => ({
                ...prev,
                messages: [
                  ...prev.messages,
                  {
                    role: "gordon",
                    content: `Failed to scan market: ${error instanceof Error ? error.message : "Unknown error"}`,
                    timestamp: formatTimestamp(),
                  },
                ],
              }));
            }
          })();
        }
        break;
      case "portfolio":
        if (!binanceClientRef.current) {
          setState((prev) => ({
            ...prev,
            view: "chat",
            messages: [
              ...prev.messages,
              {
                role: "gordon",
                content:
                  "Binance API not connected. Add your API keys to the .env file:\n\nBINANCE_API_KEY=your-key\nBINANCE_API_SECRET=your-secret\n\nThen restart Gordon.",
                timestamp: formatTimestamp(),
              },
            ],
          }));
        } else {
          // Fetch portfolio data
          setState((prev) => ({
            ...prev,
            view: "chat",
            messages: [
              ...prev.messages,
              {
                role: "gordon",
                content: "Fetching your portfolio from Binance...",
                timestamp: formatTimestamp(),
              },
            ],
          }));

          // Async fetch portfolio from both spot and funding wallets
          (async () => {
            try {
              const allBalances = await binanceClientRef.current!.getAllBalances();

              // Calculate total value and extract USDT balance
              let totalValue = 0;
              let usdtBalance = 0;
              const holdings: Array<{ asset: string; amount: number; usdtValue: number; wallet: string; note?: string }> = [];

              // USD-pegged stablecoins
              const stablecoins = ["USDT", "USD", "USDC", "BUSD", "TUSD", "USDP", "FDUSD"];

              for (const balance of allBalances) {
                const amount = balance.free + balance.locked;
                let usdtValue = 0;

                if (stablecoins.includes(balance.asset)) {
                  // Stablecoins are 1:1 with USD
                  usdtValue = amount;
                  if (balance.asset === "USDT" || balance.asset === "USD") {
                    usdtBalance += amount;
                  }
                } else {
                  // Try to get price from Binance (works for crypto and some fiat like EUR)
                  try {
                    const price = await binanceClientRef.current!.getPrice(`${balance.asset}USDT`);
                    usdtValue = amount * price;
                  } catch (error) {
                    console.error(`No USDT pair for ${balance.asset}:`, error);
                    // Show raw amount without USD value
                    holdings.push({
                      asset: balance.asset,
                      amount,
                      usdtValue: 0,
                      wallet: balance.wallet,
                      note: "No USD rate"
                    });
                    continue;
                  }
                }

                if (usdtValue > 0.01) {
                  holdings.push({ asset: balance.asset, amount, usdtValue, wallet: balance.wallet });
                  totalValue += usdtValue;
                }
              }

              // Sort by value
              holdings.sort((a, b) => b.usdtValue - a.usdtValue);

              // Format message
              const lines = [
                `**Portfolio Value: $${totalValue.toFixed(2)} USD**\n`,
                "| Asset | Amount | Value (USD) | Wallet |",
                "|-------|--------|-------------|--------|",
              ];

              for (const h of holdings.slice(0, 15)) {
                const valueStr = h.usdtValue > 0 ? `$${h.usdtValue.toFixed(2)}` : (h.note || "N/A");
                lines.push(
                  `| ${h.asset} | ${h.amount.toFixed(4)} | ${valueStr} | ${h.wallet} |`
                );
              }

              if (holdings.length > 15) {
                lines.push(`\n_...and ${holdings.length - 15} more assets_`);
              }

              setState((prev) => ({
                ...prev,
                portfolioValue: totalValue,
                availableCash: usdtBalance,
                messages: [
                  ...prev.messages,
                  {
                    role: "gordon",
                    content: lines.join("\n"),
                    timestamp: formatTimestamp(),
                  },
                ],
              }));
            } catch (error) {
              setState((prev) => ({
                ...prev,
                messages: [
                  ...prev.messages,
                  {
                    role: "gordon",
                    content: `Failed to fetch portfolio: ${error instanceof Error ? error.message : "Unknown error"}`,
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
      case "trending":
        setState((prev) => ({
          ...prev,
          view: "chat",
          messages: [
            ...prev.messages,
            {
              role: "user",
              content: "/trending",
              timestamp: formatTimestamp(),
            },
            {
              role: "gordon",
              content: "Finding today's trending tokens...",
              timestamp: formatTimestamp(),
            },
          ],
        }));
        // Trigger the trending request through the agent with streaming
        (async () => {
          if (!llmClientRef.current) return;
          const context: GordonContext = {
            binance: binanceClientRef.current,
            llm: llmClientRef.current,
            config: configRef.current,
            portfolioValue: state.portfolioValue ?? 0,
            availableCash: state.availableCash,
            userId: state.session?.resourceId,
            threadId: state.session?.threadId,
          };

          // Create initial empty message for streaming
          const trendingTimestamp = formatTimestamp();
          setState((prev) => ({
            ...prev,
            messages: [...prev.messages, {
              role: "gordon",
              content: "",
              timestamp: trendingTimestamp,
            }],
            isStreaming: true,
          }));

          try {
            const stream = processMessageStream(
              "Show me what's trending and pumping today",
              context,
              state.session?.threadId,
              state.session?.resourceId
            );
            let fullContent = "";
            let trendingAgent: string | undefined;

            for await (const event of stream) {
              if (event.type === "text_delta" && event.content) {
                fullContent += event.content;
                setState((prev) => {
                  const newMessages = [...prev.messages];
                  for (let i = newMessages.length - 1; i >= 0; i--) {
                    const msg = newMessages[i];
                    if (msg && msg.role === "gordon" && msg.timestamp === trendingTimestamp) {
                      newMessages[i] = {
                        role: "gordon",
                        content: fullContent,
                        timestamp: trendingTimestamp,
                        agent: trendingAgent || msg.agent,
                      };
                      break;
                    }
                  }
                  return { ...prev, messages: newMessages };
                });
              } else if (event.type === "agent_switch" && event.agentName) {
                trendingAgent = event.agentName;
              } else if (event.type === "tool_call_start") {
                setState((prev) => ({ ...prev, activeToolCall: event.toolName || "tool" }));
                if (event.agentName) {
                  trendingAgent = event.agentName;
                }
              } else if (event.type === "tool_call_end") {
                setState((prev) => ({ ...prev, activeToolCall: null }));
              } else if (event.type === "done") {
                if (event.agentName) {
                  trendingAgent = event.agentName;
                }
                // Final update with agent attribution
                setState((prev) => {
                  const newMessages = [...prev.messages];
                  for (let i = newMessages.length - 1; i >= 0; i--) {
                    const msg = newMessages[i];
                    if (msg && msg.role === "gordon" && msg.timestamp === trendingTimestamp) {
                      newMessages[i] = {
                        role: "gordon",
                        content: fullContent,
                        timestamp: trendingTimestamp,
                        agent: trendingAgent,
                      };
                      break;
                    }
                  }
                  return { ...prev, messages: newMessages, isStreaming: false, activeToolCall: null };
                });
              } else if (event.type === "error") {
                setState((prev) => {
                  const newMessages = [...prev.messages];
                  for (let i = newMessages.length - 1; i >= 0; i--) {
                    const msg = newMessages[i];
                    if (msg && msg.role === "gordon" && msg.timestamp === trendingTimestamp) {
                      newMessages[i] = {
                        role: "gordon",
                        content: fullContent || `Failed to get trending: ${event.error}`,
                        timestamp: trendingTimestamp,
                        agent: trendingAgent,
                      };
                      break;
                    }
                  }
                  return { ...prev, messages: newMessages, isStreaming: false, activeToolCall: null };
                });
              }
            }
          } catch (error) {
            setState((prev) => {
              const newMessages = [...prev.messages];
              for (let i = newMessages.length - 1; i >= 0; i--) {
                const msg = newMessages[i];
                if (msg && msg.role === "gordon" && msg.timestamp === trendingTimestamp) {
                  newMessages[i] = {
                    role: "gordon",
                    content: `Failed to get trending: ${error instanceof Error ? error.message : "Unknown error"}`,
                    timestamp: trendingTimestamp,
                  };
                  break;
                }
              }
              return { ...prev, messages: newMessages, isStreaming: false, activeToolCall: null };
            });
          }
        })();
        break;
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
    }
  }, [state.portfolioValue, state.availableCash, state.conversationHistory]);

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

Your API keys have been saved to the .env file in your project directory.

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
  }, []);

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

  return (
    <Box flexDirection="column" height="100%">
      {/* Status Bar - Always visible */}
      <StatusBar
        mode={state.mode}
        portfolioValue={state.portfolioValue}
        connectionStatus={state.connectionStatus}
        btcPrice={state.btcPrice}
      />

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
          <Box flexDirection="column">
            <WelcomeBanner />
            <Box paddingX={2}>
              <Text color={COLORS.DIM}>Press any key to continue...</Text>
            </Box>
          </Box>
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

            <ChatView messages={state.messages} />

            {/* Loading/Streaming indicator */}
            {state.isLoading && (
              <Box paddingX={2}>
                <Spinner label="Gordon is thinking..." />
              </Box>
            )}
            {state.isStreaming && state.activeToolCall && (
              <Box paddingX={2}>
                <Spinner label={`Running ${state.activeToolCall}...`} />
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
