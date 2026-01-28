/**
 * SetupWizard Component
 * Step-by-step configuration for Binance and LLM API keys
 */

import React, { useState, useCallback } from "react";
import { Box, Text, useInput } from "ink";
import TextInput from "ink-text-input";

import { BinanceClient, checkAndValidatePermissions } from "../infra/binance/index.ts";
import { loadConfig, saveConfig } from "../infra/storage/config.ts";
import { saveEnvKeys, createEnvFile, checkEnvStatus } from "../infra/storage/env.ts";
import type { GordonConfig, ExchangePermissions, Preferences } from "../types/index.ts";

// Color palette
const COLORS = {
  TAN: "#d4a27f",
  TAN_DIM: "#b8896a",
  WHITE: "#e8e4de",
  DIM: "#a39e93",
} as const;

type WizardStep = "welcome" | "binance-key" | "binance-secret" | "binance-validating" | "llm" | "preferences" | "done";

interface WizardState {
  step: WizardStep;
  binanceApiKey: string;
  binanceApiSecret: string;
  binancePermissions: ExchangePermissions | null;
  binanceError: string | null;
  openaiApiKey: string;
  dedalusApiKey: string;
  preferences: Preferences;
  inputValue: string;
  isValidating: boolean;
}

interface SetupWizardProps {
  onComplete: () => void;
}

function maskSecret(value: string): string {
  if (value.length === 0) return "";
  if (value.length <= 4) return "*".repeat(value.length);
  return "*".repeat(value.length - 4) + value.slice(-4);
}

export function SetupWizard({ onComplete }: SetupWizardProps): React.ReactElement {
  const [state, setState] = useState<WizardState>({
    step: "welcome",
    binanceApiKey: "",
    binanceApiSecret: "",
    binancePermissions: null,
    binanceError: null,
    openaiApiKey: "",
    dedalusApiKey: "",
    preferences: {
      cashReservePercent: 0.2,
      maxAllocationPerTrade: 0.1,
      defaultTimeframes: ["1h", "4h"],
      topNCoins: 50,
    },
    inputValue: "",
    isValidating: false,
  });

  const validateBinanceKeys = useCallback(async (apiKey: string, apiSecret: string) => {
    setState((prev) => ({
      ...prev,
      step: "binance-validating",
      isValidating: true,
      binanceError: null,
    }));

    const client = new BinanceClient(apiKey, apiSecret);

    const connected = await client.testConnection();
    if (!connected) {
      setState((prev) => ({
        ...prev,
        step: "binance-key",
        isValidating: false,
        binanceError: "Could not connect to Binance API. Please check your internet connection.",
      }));
      return;
    }

    const { permissions, validation } = await checkAndValidatePermissions(client);

    if (!validation.valid) {
      setState((prev) => ({
        ...prev,
        step: "binance-key",
        isValidating: false,
        binanceError: validation.errors.join("\n"),
        binanceApiKey: "",
        binanceApiSecret: "",
      }));
      return;
    }

    setState((prev) => ({
      ...prev,
      step: "llm",
      isValidating: false,
      binancePermissions: permissions,
      binanceError: null,
    }));
  }, []);

  const saveConfiguration = useCallback(async () => {
    const currentConfig = await loadConfig();

    const newConfig: GordonConfig = {
      ...currentConfig,
      preferences: state.preferences,
      onboardingComplete: true,
    };

    if (state.binanceApiKey && state.binanceApiSecret && state.binancePermissions) {
      newConfig.exchange = {
        name: "binance",
        apiKey: state.binanceApiKey,
        apiSecret: state.binanceApiSecret,
        permissions: state.binancePermissions,
      };
    }

    await saveConfig(newConfig);

    // Save API keys to .env file
    const envStatus = await checkEnvStatus();
    const envKeys: Record<string, string> = {};

    if (state.openaiApiKey) {
      envKeys.OPENAI_API_KEY = state.openaiApiKey;
    }
    if (state.dedalusApiKey) {
      envKeys.DEDALUS_API_KEY = state.dedalusApiKey;
    }
    if (state.binanceApiKey) {
      envKeys.BINANCE_API_KEY = state.binanceApiKey;
    }
    if (state.binanceApiSecret) {
      envKeys.BINANCE_API_SECRET = state.binanceApiSecret;
    }

    // Create or update .env file
    if (envStatus.fileExists) {
      await saveEnvKeys(envKeys);
    } else {
      await createEnvFile(envKeys);
    }
  }, [state.binanceApiKey, state.binanceApiSecret, state.binancePermissions, state.preferences, state.openaiApiKey, state.dedalusApiKey]);

  const handleInputSubmit = useCallback(
    async (value: string) => {
      const trimmedValue = value.trim();

      switch (state.step) {
        case "binance-key":
          if (trimmedValue) {
            setState((prev) => ({
              ...prev,
              binanceApiKey: trimmedValue,
              step: "binance-secret",
              inputValue: "",
            }));
          }
          break;

        case "binance-secret":
          if (trimmedValue) {
            setState((prev) => ({
              ...prev,
              binanceApiSecret: trimmedValue,
              inputValue: "",
            }));
            await validateBinanceKeys(state.binanceApiKey, trimmedValue);
          }
          break;

        case "llm":
          if (trimmedValue) {
            setState((prev) => ({
              ...prev,
              openaiApiKey: trimmedValue,
              step: "preferences",
              inputValue: "",
            }));
          }
          break;

        case "preferences":
          const percent = parseInt(trimmedValue, 10);
          if (!isNaN(percent) && percent >= 0 && percent <= 100) {
            setState((prev) => ({
              ...prev,
              preferences: {
                ...prev.preferences,
                cashReservePercent: percent / 100,
              },
              step: "done",
              inputValue: "",
            }));
            await saveConfiguration();
          }
          break;
      }
    },
    [state.step, state.binanceApiKey, validateBinanceKeys, saveConfiguration]
  );

  const handleInputChange = useCallback((value: string) => {
    setState((prev) => ({ ...prev, inputValue: value }));
  }, []);

  const handleSkip = useCallback(async () => {
    switch (state.step) {
      case "binance-key":
        setState((prev) => ({
          ...prev,
          step: "llm",
          inputValue: "",
        }));
        break;

      case "binance-secret":
        setState((prev) => ({
          ...prev,
          binanceApiKey: "",
          step: "llm",
          inputValue: "",
        }));
        break;

      case "llm":
        setState((prev) => ({
          ...prev,
          step: "preferences",
          inputValue: "",
        }));
        break;

      case "preferences":
        setState((prev) => ({
          ...prev,
          step: "done",
          inputValue: "",
        }));
        await saveConfiguration();
        break;
    }
  }, [state.step, saveConfiguration]);

  useInput((input, key) => {
    if (state.step === "welcome" && (input || key.return)) {
      setState((prev) => ({ ...prev, step: "binance-key" }));
      return;
    }

    if (state.step === "done" && (input || key.return)) {
      onComplete();
      return;
    }

    if (key.escape) {
      handleSkip();
    }
  });

  return (
    <Box flexDirection="column" paddingX={2} paddingY={1}>
      {state.step === "welcome" && (
        <WelcomeStep />
      )}

      {state.step === "binance-key" && (
        <BinanceKeyStep
          error={state.binanceError}
          inputValue={state.inputValue}
          onInputChange={handleInputChange}
          onSubmit={handleInputSubmit}
        />
      )}

      {state.step === "binance-secret" && (
        <BinanceSecretStep
          apiKey={state.binanceApiKey}
          inputValue={state.inputValue}
          onInputChange={handleInputChange}
          onSubmit={handleInputSubmit}
        />
      )}

      {state.step === "binance-validating" && (
        <ValidatingStep />
      )}

      {state.step === "llm" && (
        <LLMStep
          binanceConfigured={!!state.binancePermissions}
          inputValue={state.inputValue}
          onInputChange={handleInputChange}
          onSubmit={handleInputSubmit}
        />
      )}

      {state.step === "preferences" && (
        <PreferencesStep
          currentPercent={Math.round(state.preferences.cashReservePercent * 100)}
          inputValue={state.inputValue}
          onInputChange={handleInputChange}
          onSubmit={handleInputSubmit}
        />
      )}

      {state.step === "done" && (
        <DoneStep
          binanceConfigured={!!state.binancePermissions}
          llmConfigured={!!state.openaiApiKey}
        />
      )}

      {state.step !== "welcome" && state.step !== "done" && state.step !== "binance-validating" && (
        <Box marginTop={1}>
          <Text color={COLORS.DIM}>Press ESC to skip this step</Text>
        </Box>
      )}
    </Box>
  );
}

function WelcomeStep(): React.ReactElement {
  return (
    <Box flexDirection="column">
      <Box marginBottom={1}>
        <Text color={COLORS.TAN} bold>
          Welcome to Gordon Setup
        </Text>
      </Box>

      <Box flexDirection="column" marginBottom={1}>
        <Text color={COLORS.WHITE}>
          This wizard will help you configure Gordon for trading.
        </Text>
        <Text color={COLORS.WHITE}>
          We will set up:
        </Text>
      </Box>

      <Box flexDirection="column" marginLeft={2}>
        <Text color={COLORS.DIM}>1. Binance API credentials</Text>
        <Text color={COLORS.DIM}>2. LLM API key (for AI features)</Text>
        <Text color={COLORS.DIM}>3. Trading preferences</Text>
      </Box>

      <Box marginTop={2}>
        <Text color={COLORS.TAN_DIM}>
          You can skip any step and configure it later.
        </Text>
      </Box>

      <Box marginTop={1}>
        <Text color={COLORS.DIM}>Press any key to continue...</Text>
      </Box>
    </Box>
  );
}

interface BinanceKeyStepProps {
  error: string | null;
  inputValue: string;
  onInputChange: (value: string) => void;
  onSubmit: (value: string) => void;
}

function BinanceKeyStep({ error, inputValue, onInputChange, onSubmit }: BinanceKeyStepProps): React.ReactElement {
  return (
    <Box flexDirection="column">
      <Box marginBottom={1}>
        <Text color={COLORS.TAN} bold>
          Step 1: Binance API Key
        </Text>
      </Box>

      {error && (
        <Box marginBottom={1} borderStyle="single" borderColor="red" paddingX={1}>
          <Text color="red">{error}</Text>
        </Box>
      )}

      <Box flexDirection="column" marginBottom={1}>
        <Text color={COLORS.WHITE}>
          Gordon needs Binance API access to view your portfolio and place trades.
        </Text>
      </Box>

      <Box flexDirection="column" marginBottom={1}>
        <Text color={COLORS.TAN_DIM} bold>How to get your API key:</Text>
        <Box flexDirection="column" marginLeft={2}>
          <Text color={COLORS.DIM}>1. Go to binance.com and log in</Text>
          <Text color={COLORS.DIM}>2. Navigate to Account {">"} API Management</Text>
          <Text color={COLORS.DIM}>3. Create a new API key</Text>
          <Text color={COLORS.DIM}>4. Enable "Read" and "Spot Trading" permissions</Text>
          <Text color={COLORS.DIM}>5. IMPORTANT: Keep "Withdrawals" DISABLED</Text>
        </Box>
      </Box>

      <Box marginTop={1}>
        <Text color={COLORS.WHITE}>Enter your API Key: </Text>
        <TextInput
          value={inputValue}
          onChange={onInputChange}
          onSubmit={onSubmit}
          placeholder="Paste your API key here..."
        />
      </Box>
    </Box>
  );
}

interface BinanceSecretStepProps {
  apiKey: string;
  inputValue: string;
  onInputChange: (value: string) => void;
  onSubmit: (value: string) => void;
}

function BinanceSecretStep({ apiKey, inputValue, onInputChange, onSubmit }: BinanceSecretStepProps): React.ReactElement {
  return (
    <Box flexDirection="column">
      <Box marginBottom={1}>
        <Text color={COLORS.TAN} bold>
          Step 1: Binance API Secret
        </Text>
      </Box>

      <Box marginBottom={1}>
        <Text color={COLORS.DIM}>API Key: </Text>
        <Text color={COLORS.TAN_DIM}>{maskSecret(apiKey)}</Text>
      </Box>

      <Box flexDirection="column" marginBottom={1}>
        <Text color={COLORS.WHITE}>
          Now enter the API Secret (this was shown only once when you created the key).
        </Text>
      </Box>

      <Box marginTop={1}>
        <Text color={COLORS.WHITE}>Enter your API Secret: </Text>
        <TextInput
          value={inputValue}
          onChange={onInputChange}
          onSubmit={onSubmit}
          placeholder="Paste your API secret here..."
          mask="*"
        />
      </Box>

      <Box marginTop={1}>
        <Text color={COLORS.DIM}>
          Your secret is never displayed and is stored locally in ~/.gordon/config.json
        </Text>
      </Box>
    </Box>
  );
}

function ValidatingStep(): React.ReactElement {
  return (
    <Box flexDirection="column">
      <Box marginBottom={1}>
        <Text color={COLORS.TAN} bold>
          Validating Binance Credentials...
        </Text>
      </Box>

      <Box>
        <Text color={COLORS.WHITE}>
          Testing connection and checking permissions...
        </Text>
      </Box>
    </Box>
  );
}

interface LLMStepProps {
  binanceConfigured: boolean;
  inputValue: string;
  onInputChange: (value: string) => void;
  onSubmit: (value: string) => void;
}

function LLMStep({ binanceConfigured, inputValue, onInputChange, onSubmit }: LLMStepProps): React.ReactElement {
  return (
    <Box flexDirection="column">
      <Box marginBottom={1}>
        <Text color={COLORS.TAN} bold>
          Step 2: LLM API Key
        </Text>
      </Box>

      {binanceConfigured && (
        <Box marginBottom={1}>
          <Text color="green">Binance configured successfully!</Text>
        </Box>
      )}

      <Box flexDirection="column" marginBottom={1}>
        <Text color={COLORS.WHITE}>
          Gordon uses AI to analyze markets and generate trade plans.
        </Text>
        <Text color={COLORS.WHITE}>
          You can use either OpenAI or Dedalus Labs API.
        </Text>
      </Box>

      <Box flexDirection="column" marginBottom={1}>
        <Text color={COLORS.TAN_DIM} bold>How to get an OpenAI API key:</Text>
        <Box flexDirection="column" marginLeft={2}>
          <Text color={COLORS.DIM}>1. Go to platform.openai.com</Text>
          <Text color={COLORS.DIM}>2. Sign in or create an account</Text>
          <Text color={COLORS.DIM}>3. Navigate to API keys</Text>
          <Text color={COLORS.DIM}>4. Create a new secret key</Text>
        </Box>
      </Box>

      <Box marginBottom={1}>
        <Text color={COLORS.TAN_DIM}>
          Alternatively, set OPENAI_API_KEY or DEDALUS_API_KEY environment variables.
        </Text>
      </Box>

      <Box marginTop={1}>
        <Text color={COLORS.WHITE}>Enter your OpenAI API Key: </Text>
        <TextInput
          value={inputValue}
          onChange={onInputChange}
          onSubmit={onSubmit}
          placeholder="sk-..."
          mask="*"
        />
      </Box>
    </Box>
  );
}

interface PreferencesStepProps {
  currentPercent: number;
  inputValue: string;
  onInputChange: (value: string) => void;
  onSubmit: (value: string) => void;
}

function PreferencesStep({ currentPercent, inputValue, onInputChange, onSubmit }: PreferencesStepProps): React.ReactElement {
  return (
    <Box flexDirection="column">
      <Box marginBottom={1}>
        <Text color={COLORS.TAN} bold>
          Step 3: Trading Preferences
        </Text>
      </Box>

      <Box flexDirection="column" marginBottom={1}>
        <Text color={COLORS.WHITE}>
          Gordon keeps a cash reserve to protect against volatility.
        </Text>
        <Text color={COLORS.WHITE}>
          This is the percentage of your portfolio that will never be traded.
        </Text>
      </Box>

      <Box marginBottom={1}>
        <Text color={COLORS.DIM}>
          Current setting: {currentPercent}%
        </Text>
      </Box>

      <Box marginTop={1}>
        <Text color={COLORS.WHITE}>Cash reserve percentage (0-100): </Text>
        <TextInput
          value={inputValue}
          onChange={onInputChange}
          onSubmit={onSubmit}
          placeholder={String(currentPercent)}
        />
      </Box>

      <Box marginTop={1}>
        <Text color={COLORS.DIM}>
          Recommended: 20% for conservative, 10% for moderate, 5% for aggressive
        </Text>
      </Box>
    </Box>
  );
}

interface DoneStepProps {
  binanceConfigured: boolean;
  llmConfigured: boolean;
}

function DoneStep({ binanceConfigured, llmConfigured }: DoneStepProps): React.ReactElement {
  return (
    <Box flexDirection="column">
      <Box marginBottom={1}>
        <Text color={COLORS.TAN} bold>
          Setup Complete!
        </Text>
      </Box>

      <Box flexDirection="column" marginBottom={1}>
        <Text color={COLORS.WHITE}>
          Gordon is now configured. Here is your setup summary:
        </Text>
      </Box>

      <Box flexDirection="column" marginLeft={2} marginBottom={1}>
        <Box>
          <Text color={binanceConfigured ? "green" : COLORS.DIM}>
            {binanceConfigured ? "[OK]" : "[--]"} Binance API
          </Text>
          {!binanceConfigured && (
            <Text color={COLORS.DIM}> (not configured)</Text>
          )}
        </Box>
        <Box>
          <Text color={llmConfigured ? "green" : COLORS.DIM}>
            {llmConfigured ? "[OK]" : "[--]"} LLM API
          </Text>
          {!llmConfigured && (
            <Text color={COLORS.DIM}> (using environment variables)</Text>
          )}
        </Box>
        <Box>
          <Text color="green">[OK] Preferences</Text>
        </Box>
      </Box>

      {!binanceConfigured && (
        <Box marginBottom={1}>
          <Text color={COLORS.TAN_DIM}>
            Note: Without Binance API, Gordon runs in demo mode.
          </Text>
        </Box>
      )}

      <Box marginTop={1}>
        <Text color={COLORS.DIM}>Press any key to return to main menu...</Text>
      </Box>
    </Box>
  );
}

export default SetupWizard;
