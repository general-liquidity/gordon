import React, { useState, useCallback, useEffect, useRef } from "react";
import { Box, Text, useInput } from "ink";
import TextInput from "ink-text-input";

import { StatusBar } from "./StatusBar.tsx";
import { WelcomeBanner } from "./WelcomeBanner.tsx";
import { QuickStartMenu, type MenuOption } from "./QuickStartMenu.tsx";
import { ChatView, type ChatMessage } from "./ChatView.tsx";
import { Onboarding } from "./Onboarding.tsx";
import { processMessage } from "../infra/agents/orchestrator.ts";
import { createLLMClientFromEnv, type LLMClient } from "../infra/llm/index.ts";
import { loadConfig, saveConfig } from "../infra/storage/config.ts";
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

type AppView = "loading" | "onboarding" | "welcome" | "menu" | "chat";

interface ConversationMessage {
  role: "user" | "assistant";
  content: string;
}

interface AppState {
  view: AppView;
  mode: Mode;
  portfolioValue: number | undefined;
  connectionStatus: "connected" | "disconnected" | "connecting";
  messages: ChatMessage[];
  inputValue: string;
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
    connectionStatus: "disconnected",
    messages: [],
    inputValue: "",
    isLoading: false,
    conversationHistory: [],
  });

  const llmClientRef = useRef<LLMClient | null>(null);
  const configRef = useRef<GordonConfig>(getDefaultConfig());

  // Initialize config and LLM client on mount
  useEffect(() => {
    async function initialize(): Promise<void> {
      // Load config and check onboarding status
      const config = await loadConfig();
      configRef.current = config;

      // Determine initial view based on onboarding status
      const initialView = config.onboardingComplete ? "welcome" : "onboarding";

      // Initialize LLM client
      try {
        llmClientRef.current = createLLMClientFromEnv();
        setState((prev) => ({
          ...prev,
          view: initialView,
          mode: config.mode,
          connectionStatus: "connected",
        }));
      } catch {
        // LLM client not configured - will show error when user tries to chat
        setState((prev) => ({
          ...prev,
          view: initialView,
          mode: config.mode,
          connectionStatus: "disconnected",
        }));
      }
    }

    initialize();
  }, []);

  function handleInputChange(value: string): void {
    setState((prev) => ({ ...prev, inputValue: value }));
  }

  const handleSubmit = useCallback(async (value: string): Promise<void> => {
    if (!value.trim()) return;
    if (state.isLoading) return;

    const userMessage: ChatMessage = {
      role: "user",
      content: value.trim(),
      timestamp: formatTimestamp(),
    };

    // Add user message, clear input, and set loading state
    setState((prev) => ({
      ...prev,
      messages: [...prev.messages, userMessage],
      inputValue: "",
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
      binance: null, // Will be configured via setup
      llm: llmClientRef.current,
      config: configRef.current,
      portfolioValue: state.portfolioValue ?? 0,
      availableCash: 0, // Will be updated when Binance is connected
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
  }, [state.isLoading, state.conversationHistory, state.portfolioValue]);

  // Handle menu selection
  const handleMenuSelect = useCallback((option: MenuOption): void => {
    switch (option) {
      case "chat":
        setState((prev) => ({ ...prev, view: "chat" }));
        break;
      case "scan":
        setState((prev) => ({
          ...prev,
          view: "chat",
          messages: [
            ...prev.messages,
            {
              role: "gordon",
              content:
                "Starting market scan... I'll analyze the top coins for support bounce setups.",
              timestamp: formatTimestamp(),
            },
          ],
        }));
        break;
      case "portfolio":
        setState((prev) => ({
          ...prev,
          view: "chat",
          messages: [
            ...prev.messages,
            {
              role: "gordon",
              content:
                "Portfolio view coming soon. Connect your exchange API in setup to see your positions.",
              timestamp: formatTimestamp(),
            },
          ],
        }));
        break;
      case "setup":
        setState((prev) => ({
          ...prev,
          view: "chat",
          messages: [
            ...prev.messages,
            {
              role: "gordon",
              content:
                "Setup wizard coming soon. You'll be able to configure your Binance API keys here.",
              timestamp: formatTimestamp(),
            },
          ],
        }));
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
        setState((prev) => ({
          ...prev,
          view: "chat",
          messages: [
            {
              role: "gordon",
              content: `Great choice! Let's get you set up with Binance.

To connect your account, I'll need your API credentials:

1. Log into Binance and go to API Management
2. Create a new API key with "Spot Trading" permissions
3. Copy your API Key and Secret Key

You can set these as environment variables:
  export BINANCE_API_KEY="your-key"
  export BINANCE_API_SECRET="your-secret"

Or run the setup wizard from the menu when you're ready.

For now, feel free to ask me anything about trading strategies!`,
              timestamp: formatTimestamp(),
            },
          ],
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

            {/* Input area */}
            <Box
              borderStyle="single"
              borderColor={state.isLoading ? COLORS.DIM : COLORS.TAN_DIM}
              paddingX={1}
              marginX={1}
            >
              <Text color={state.isLoading ? COLORS.DIM : COLORS.TAN}>
                {">"}{" "}
              </Text>
              <TextInput
                value={state.inputValue}
                onChange={handleInputChange}
                onSubmit={handleSubmit}
                placeholder={
                  state.isLoading ? "Waiting for response..." : "Ask Gordon anything..."
                }
              />
            </Box>

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
