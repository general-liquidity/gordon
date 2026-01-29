import React, { useState, useCallback, useEffect, useRef } from "react";
import { Box, Text, useInput } from "ink";
import { ChatInput } from "./ChatInput.tsx";

import { StatusBar } from "./StatusBar.tsx";
import { WelcomeBanner } from "./WelcomeBanner.tsx";
import { QuickStartMenu, type MenuOption } from "./QuickStartMenu.tsx";
import { ChatView, type ChatMessage } from "./ChatView.tsx";
import { Onboarding } from "./Onboarding.tsx";
import { SetupWizard } from "./SetupWizard.tsx";
import { processMessage, initializeTracing } from "../infra/agents/orchestrator.ts";
import { createLLMClientFromEnv, type LLMClient } from "../infra/llm/index.ts";
import { BinanceClient } from "../infra/binance/index.ts";
import { runMonitorCycle } from "../core/monitor.ts";
import { scan } from "../core/scanner.ts";
import { loadConfig, saveConfig } from "../infra/storage/config.ts";
import { loadEnvFile, checkEnvStatus, type EnvStatus } from "../infra/storage/env.ts";
import { initDatabase } from "../infra/storage/index.ts";
import { initializeContainer } from "../services/container.ts";
import type { GordonContext } from "../infra/agents/types.ts";
import type { Mode, GordonConfig } from "../types/index.ts";

// Color palette
const COLORS = {
  TAN: "#d4a27f",
  TAN_DIM: "#b8896a",
  WHITE: "#e8e4de",
  DIM: "#a39e93",
  ERROR: "#ff6b6b",
} as const;

type AppView = "loading" | "onboarding" | "setup" | "welcome" | "menu" | "chat";

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
  conversationHistory: ConversationMessage[];
}

function getDefaultConfig(): GordonConfig {
  return {
    version: "1.0.0",
    preferences: {
      cashReservePercent: 0.2,
      maxAllocationPerTrade: 0.1,
      defaultTimeframes: ["1h", "4h"],
      topNCoins: 50,
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

export function App(): React.ReactElement {
  const [state, setState] = useState<AppState>({
    view: "loading",
    mode: "SAFE",
    portfolioValue: undefined,
    availableCash: 0,
    connectionStatus: "disconnected",
    messages: [],
    isLoading: false,
    conversationHistory: [],
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

        // Initialize tracing for OpenAI Agents SDK
        if (envStatus.keys.OPENAI_API_KEY) {
          initializeTracing(envStatus.keys.OPENAI_API_KEY);
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
        } catch (error) {
          console.error("Failed to initialize Binance client:", error);
        }
      }

      setState((prev) => ({
        ...prev,
        view: initialView,
        mode: config.mode,
        connectionStatus: llmClientRef.current ? "connected" : "disconnected",
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

  const handleSubmit = useCallback(async (value: string): Promise<void> => {
    if (!value.trim()) return;
    if (state.isLoading) return;

    const userMessage: ChatMessage = {
      role: "user",
      content: value.trim(),
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

    // Build the context for Gordon
    const context: GordonContext = {
      binance: binanceClientRef.current,
      llm: llmClientRef.current,
      config: configRef.current,
      portfolioValue: state.portfolioValue ?? 0,
      availableCash: state.availableCash,
    };

    try {
      const result = await processMessage(
        value.trim(),
        context,
        state.conversationHistory
      );

      const gordonMessage: ChatMessage = {
        role: "gordon",
        content: result.response,
        timestamp: formatTimestamp(),
      };

      setState((prev) => ({
        ...prev,
        messages: [...prev.messages, gordonMessage],
        conversationHistory: result.history,
        isLoading: false,
      }));
    } catch (error) {
      const errorContent =
        error instanceof Error ? error.message : "An unexpected error occurred";

      const errorMessage: ChatMessage = {
        role: "gordon",
        content: `Sorry, I encountered an error: ${errorContent}. Please try again.`,
        timestamp: formatTimestamp(),
      };

      // Still update history with the user message even on error
      setState((prev) => ({
        ...prev,
        messages: [...prev.messages, errorMessage],
        conversationHistory: [
          ...prev.conversationHistory,
          { role: "user", content: value.trim() },
        ],
        isLoading: false,
      }));
    }
  }, [state.isLoading, state.conversationHistory, state.portfolioValue, state.availableCash]);

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
              content: `Welcome to Gordon! Here's how I work:

1. Tell me what you're looking for (e.g., "find me a good BTC setup")
2. I'll scan the market and show you potential trades
3. For each opportunity, I'll create a detailed plan with entry, DCA, stops, and targets
4. You review and approve - nothing executes without your say-so
5. In ARMED mode, I can place orders on your behalf

Remember: I'm in SAFE mode by default. Your funds are protected.`,
              timestamp: formatTimestamp(),
            },
          ],
        }));
        break;
    }
  }, []);

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

  // Handle global keyboard shortcuts
  useInput((input, key) => {
    // Don't process input during loading or onboarding (onboarding has its own handler)
    if (state.view === "loading" || state.view === "onboarding") {
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
      />

      {/* Main content area */}
      <Box flexDirection="column" flexGrow={1}>
        {state.view === "loading" && (
          <Box flexDirection="column" paddingX={2} paddingY={1}>
            <Text color={COLORS.TAN}>Loading Gordon...</Text>
          </Box>
        )}

        {state.view === "onboarding" && (
          <Onboarding onComplete={handleOnboardingComplete} />
        )}

        {state.view === "setup" && (
          <SetupWizard onComplete={handleSetupComplete} />
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
          <QuickStartMenu onSelect={handleMenuSelect} />
        )}

        {state.view === "chat" && (
          <Box flexDirection="column" flexGrow={1}>
            <ChatView messages={state.messages} />

            {/* Loading indicator */}
            {state.isLoading && (
              <Box paddingX={2}>
                <Text color={COLORS.TAN}>Gordon is thinking...</Text>
              </Box>
            )}

            {/* Input area - isolated component to prevent re-render issues */}
            <ChatInput
              onSubmit={handleSubmit}
              disabled={state.isLoading}
              placeholder={
                state.isLoading ? "Waiting for response..." : "Ask Gordon anything..."
              }
            />

            {/* Help hint */}
            <Box paddingX={2} paddingY={0}>
              <Text color={COLORS.DIM}>
                Press ESC to return to menu | Enter to send
              </Text>
            </Box>
          </Box>
        )}
      </Box>
    </Box>
  );
}

export default App;
