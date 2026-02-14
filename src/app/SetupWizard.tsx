/**
 * SetupWizard Component
 * Step-by-step configuration for exchange and LLM API keys
 */

import React, { useState, useCallback } from "react";
import { Box, Text, useInput } from "ink";
import TextInput from "ink-text-input";

import { resetAgents } from "../infra/agents/index.ts";
import { BinanceClient, checkAndValidatePermissions } from "../infra/binance/index.ts";
import { ExchangeFactory, type ExchangeId } from "../infra/exchange/index.ts";
import { loadConfig, saveConfig } from "../infra/storage/config.ts";
import { saveEnvKeys, createEnvFile, checkEnvStatus } from "../infra/storage/env.ts";
import type { GordonConfig, ExchangePermissions, Preferences, MultiExchangeConfig } from "../types/index.ts";
import { COLORS } from "./theme.ts";

type WizardStep =
  | "welcome"
  | "exchange-select"
  | "exchange-key"
  | "exchange-secret"
  | "exchange-passphrase"
  | "exchange-wallet"
  | "exchange-validating"
  | "llm"
  | "preferences"
  | "done";

type ExchangeSelection = ExchangeId | "";

const SUPPORTED_EXCHANGES: ExchangeId[] = ExchangeFactory.getSupportedExchanges();

const EXCHANGE_LABELS: Record<ExchangeId, string> = {
  binance: "Binance",
  binance_us: "Binance US",
  coinbase: "Coinbase",
  kraken: "Kraken",
  bitfinex: "Bitfinex",
  hyperliquid: "Hyperliquid",
};

const EXCHANGE_PASSPHRASE_REQUIRED: Record<ExchangeId, boolean> = {
  binance: false,
  binance_us: false,
  coinbase: true,
  kraken: false,
  bitfinex: false,
  hyperliquid: false,
};

const EXCHANGE_WALLET_AUTH: Record<ExchangeId, boolean> = {
  binance: false,
  binance_us: false,
  coinbase: false,
  kraken: false,
  bitfinex: false,
  hyperliquid: true,
};

const EXCHANGE_INSTRUCTIONS: Record<ExchangeId, string[]> = {
  binance: [
    "Go to binance.com and log in",
    "Navigate to Account > API Management",
    "Create a new API key",
    "Enable 'Read' and 'Spot Trading' permissions",
    "Keep 'Withdrawals' disabled",
  ],
  binance_us: [
    "Go to binance.us and log in",
    "Navigate to Account > API Management",
    "Create a new API key",
    "Enable 'Read' and 'Spot Trading' permissions",
    "Keep 'Withdrawals' disabled",
    "Note: Some features (earn, dust, transfers) are not available on Binance US",
  ],
  coinbase: [
    "Go to Coinbase and open Settings > API",
    "Create a new API key with the needed permissions",
    "Copy the API Key, Secret, and Passphrase",
  ],
  kraken: [
    "Go to Kraken and open Settings > API",
    "Create a new API key with the needed permissions",
    "Copy the API Key and Private Key",
  ],
  bitfinex: [
    "Go to Bitfinex and open Account > API",
    "Create a new API key with the needed permissions",
    "Enable 'Account Read' and 'Orders Read/Write' permissions",
    "Copy the API Key and API Secret",
  ],
  hyperliquid: [
    "Generate a new Ethereum wallet or use an existing one",
    "Export the private key from your wallet (MetaMask: Account Details > Export Private Key)",
    "IMPORTANT: Use a dedicated wallet with limited funds for trading",
    "Never use your main wallet's private key",
    "Fund your Hyperliquid account by depositing USDC on Arbitrum",
  ],
};

interface WizardState {
  step: WizardStep;
  exchangeType: ExchangeSelection;
  exchangeApiKey: string;
  exchangeApiSecret: string;
  exchangePassphrase: string;
  walletPrivateKey: string;
  exchangePermissions: ExchangePermissions | null;
  exchangeError: string | null;
  exchangeValidated: boolean;
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

function getExchangeLabel(exchangeType: ExchangeSelection): string {
  if (!exchangeType) return "Exchange";
  return EXCHANGE_LABELS[exchangeType] || exchangeType;
}

function getExchangeInstructions(exchangeType: ExchangeSelection): string[] {
  if (!exchangeType) return [];
  return EXCHANGE_INSTRUCTIONS[exchangeType] || ["Follow your exchange documentation to create API keys."];
}

function requiresPassphrase(exchangeType: ExchangeSelection): boolean {
  if (!exchangeType) return false;
  return EXCHANGE_PASSPHRASE_REQUIRED[exchangeType] || false;
}

function requiresWalletAuth(exchangeType: ExchangeSelection): boolean {
  if (!exchangeType) return false;
  return EXCHANGE_WALLET_AUTH[exchangeType] || false;
}

function generateExchangeId(type: ExchangeId, exchanges: MultiExchangeConfig[]): string {
  const baseId: string = type;
  let id: string = baseId;
  let counter = 1;

  while (exchanges.some((ex) => ex.id === id)) {
    id = `${baseId}_${counter}`;
    counter++;
  }

  return id;
}

export function SetupWizard({ onComplete }: SetupWizardProps): React.ReactElement {
  const [state, setState] = useState<WizardState>({
    step: "welcome",
    exchangeType: "",
    exchangeApiKey: "",
    exchangeApiSecret: "",
    exchangePassphrase: "",
    walletPrivateKey: "",
    exchangePermissions: null,
    exchangeError: null,
    exchangeValidated: false,
    openaiApiKey: "",
    dedalusApiKey: "",
    preferences: {
      cashReservePercent: 0.2,
      maxAllocationPerTrade: 0.1,
      defaultTimeframes: ["1h", "4h"],
      topNCoins: 50,
      maxConcurrentTrades: 5,
    },
    inputValue: "",
    isValidating: false,
  });

  const validateExchangeCredentials = useCallback(async (
    exchangeType: ExchangeId,
    apiKey: string,
    apiSecret: string,
    passphrase?: string,
    walletPrivateKey?: string
  ) => {
    setState((prev) => ({
      ...prev,
      step: "exchange-validating",
      isValidating: true,
      exchangeError: null,
    }));

    const isWalletAuth = requiresWalletAuth(exchangeType);
    const errorStep = isWalletAuth ? "exchange-wallet" : "exchange-key";

    if (exchangeType === "binance" || exchangeType === "binance_us") {
      const baseUrl = exchangeType === "binance_us" ? "https://api.binance.us" : undefined;
      const client = new BinanceClient(apiKey, apiSecret, baseUrl);
      const connected = await client.testConnection();

      if (!connected) {
        setState((prev) => ({
          ...prev,
          step: "exchange-key",
          isValidating: false,
          exchangeError: "Could not connect to Binance API. Please check your internet connection.",
          exchangeApiKey: "",
          exchangeApiSecret: "",
          exchangePassphrase: "",
          walletPrivateKey: "",
          exchangeValidated: false,
        }));
        return;
      }

      const { permissions, validation } = await checkAndValidatePermissions(client);

      if (!validation.valid) {
        setState((prev) => ({
          ...prev,
          step: "exchange-key",
          isValidating: false,
          exchangeError: validation.errors.join("\n"),
          exchangeApiKey: "",
          exchangeApiSecret: "",
          exchangePassphrase: "",
          walletPrivateKey: "",
          exchangeValidated: false,
        }));
        return;
      }

      setState((prev) => ({
        ...prev,
        step: "llm",
        isValidating: false,
        exchangePermissions: permissions,
        exchangeError: null,
        exchangeValidated: true,
      }));
      return;
    }

    try {
      const exchange = ExchangeFactory.create(exchangeType, {
        apiKey: isWalletAuth ? "" : apiKey,
        apiSecret: isWalletAuth ? "" : apiSecret,
        passphrase,
        walletPrivateKey,
      });

      await exchange.getAccountInfo();

      setState((prev) => ({
        ...prev,
        step: "llm",
        isValidating: false,
        exchangePermissions: null,
        exchangeError: null,
        exchangeValidated: true,
      }));
    } catch (error) {
      ExchangeFactory.removeFromCache(exchangeType, {
        apiKey: isWalletAuth ? "" : apiKey,
        apiSecret: isWalletAuth ? "" : apiSecret,
        walletPrivateKey,
      });
      setState((prev) => ({
        ...prev,
        step: errorStep,
        isValidating: false,
        exchangeError: error instanceof Error ? error.message : String(error),
        exchangeApiKey: "",
        exchangeApiSecret: "",
        exchangePassphrase: "",
        walletPrivateKey: "",
        exchangeValidated: false,
      }));
    }
  }, []);

  const saveConfiguration = useCallback(async () => {
    const currentConfig = await loadConfig();
    const newConfig: GordonConfig = {
      ...currentConfig,
      preferences: state.preferences,
      onboardingComplete: true,
    };

    const isWalletAuth = requiresWalletAuth(state.exchangeType);
    const hasExchangeCredentials = state.exchangeType && state.exchangeValidated && (
      isWalletAuth
        ? !!state.walletPrivateKey
        : !!(state.exchangeApiKey && state.exchangeApiSecret)
    );

    if (hasExchangeCredentials) {
      const exchanges = currentConfig.exchanges ? [...currentConfig.exchanges] : [];
      const exchangeType = state.exchangeType as ExchangeId;
      const exchangeId = generateExchangeId(exchangeType, exchanges);

      const newExchange: MultiExchangeConfig = {
        id: exchangeId,
        type: exchangeType,
        apiKey: state.exchangeApiKey,
        apiSecret: state.exchangeApiSecret,
        passphrase: state.exchangePassphrase || undefined,
        walletPrivateKey: state.walletPrivateKey || undefined,
        sandbox: false,
        isDefault: true,
      };

      newConfig.exchanges = [
        ...exchanges.map((ex) => ({
          ...ex,
          isDefault: false,
        })),
        newExchange,
      ];
      newConfig.activeExchangeId = exchangeId;

      if (exchangeType === "binance" && state.exchangePermissions) {
        newConfig.exchange = {
          name: "binance",
          apiKey: state.exchangeApiKey,
          apiSecret: state.exchangeApiSecret,
          permissions: state.exchangePermissions,
        };
      }
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
    if (state.exchangeType === "binance" && state.exchangeApiKey) {
      envKeys.BINANCE_API_KEY = state.exchangeApiKey;
    }
    if (state.exchangeType === "binance" && state.exchangeApiSecret) {
      envKeys.BINANCE_API_SECRET = state.exchangeApiSecret;
    }
    if (state.exchangeType === "binance_us" && state.exchangeApiKey) {
      envKeys.BINANCE_US_API_KEY = state.exchangeApiKey;
    }
    if (state.exchangeType === "binance_us" && state.exchangeApiSecret) {
      envKeys.BINANCE_US_API_SECRET = state.exchangeApiSecret;
    }

    // Create or update .env file
    if (envStatus.fileExists) {
      await saveEnvKeys(envKeys);
    } else {
      await createEnvFile(envKeys);
    }

    // Reset agent cache so next access reinitializes with fresh env variables
    resetAgents();
  }, [
    state.exchangeApiKey,
    state.exchangeApiSecret,
    state.exchangePassphrase,
    state.walletPrivateKey,
    state.exchangePermissions,
    state.exchangeType,
    state.exchangeValidated,
    state.preferences,
    state.openaiApiKey,
    state.dedalusApiKey,
  ]);

  const handleInputSubmit = useCallback(
    async (value: string) => {
      const trimmedValue = value.trim();

      switch (state.step) {
        case "exchange-select": {
          if (!trimmedValue) return;
          const normalized = trimmedValue.toLowerCase();
          const match = SUPPORTED_EXCHANGES.find((ex) => ex === normalized);

          if (!match) {
            setState((prev) => ({
              ...prev,
              exchangeError: `Unsupported exchange: ${trimmedValue}. Supported: ${SUPPORTED_EXCHANGES.join(", ")}`,
              inputValue: "",
            }));
            return;
          }

          // Route to wallet auth for DEX exchanges like Hyperliquid
          const nextStep = requiresWalletAuth(match) ? "exchange-wallet" : "exchange-key";

          setState((prev) => ({
            ...prev,
            exchangeType: match,
            exchangeError: null,
            step: nextStep,
            inputValue: "",
          }));
          break;
        }
        case "exchange-key":
          if (trimmedValue) {
            setState((prev) => ({
              ...prev,
              exchangeApiKey: trimmedValue,
              step: "exchange-secret",
              inputValue: "",
            }));
          }
          break;

        case "exchange-secret":
          if (trimmedValue) {
            const needsPassphrase = requiresPassphrase(state.exchangeType);
            setState((prev) => ({
              ...prev,
              exchangeApiSecret: trimmedValue,
              inputValue: "",
              step: needsPassphrase ? "exchange-passphrase" : prev.step,
            }));

            if (!needsPassphrase && state.exchangeType) {
              await validateExchangeCredentials(
                state.exchangeType as ExchangeId,
                state.exchangeApiKey,
                trimmedValue
              );
            }
          }
          break;

        case "exchange-passphrase":
          if (trimmedValue && state.exchangeType) {
            setState((prev) => ({
              ...prev,
              exchangePassphrase: trimmedValue,
              inputValue: "",
            }));
            await validateExchangeCredentials(
              state.exchangeType as ExchangeId,
              state.exchangeApiKey,
              state.exchangeApiSecret,
              trimmedValue
            );
          }
          break;

        case "exchange-wallet":
          if (trimmedValue && state.exchangeType) {
            setState((prev) => ({
              ...prev,
              walletPrivateKey: trimmedValue,
              inputValue: "",
            }));
            await validateExchangeCredentials(
              state.exchangeType as ExchangeId,
              "",
              "",
              undefined,
              trimmedValue
            );
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

        case "preferences": {
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
      }
    },
    [
      state.step,
      state.exchangeType,
      state.exchangeApiKey,
      state.exchangeApiSecret,
      validateExchangeCredentials,
      saveConfiguration,
    ]
  );

  const handleInputChange = useCallback((value: string) => {
    setState((prev) => ({ ...prev, inputValue: value }));
  }, []);

  const handleSkip = useCallback(async () => {
    switch (state.step) {
      case "exchange-select":
      case "exchange-key":
      case "exchange-secret":
      case "exchange-passphrase":
      case "exchange-wallet":
        setState((prev) => ({
          ...prev,
          exchangeType: "",
          exchangeApiKey: "",
          exchangeApiSecret: "",
          exchangePassphrase: "",
          walletPrivateKey: "",
          exchangePermissions: null,
          exchangeError: null,
          exchangeValidated: false,
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
      setState((prev) => ({ ...prev, step: "exchange-select" }));
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

  const exchangeLabel = getExchangeLabel(state.exchangeType);

  return (
    <Box flexDirection="column" paddingX={2} paddingY={1}>
      {state.step === "welcome" && <WelcomeStep />}

      {state.step === "exchange-select" && (
        <ExchangeSelectStep
          error={state.exchangeError}
          inputValue={state.inputValue}
          onInputChange={handleInputChange}
          onSubmit={handleInputSubmit}
        />
      )}

      {state.step === "exchange-key" && (
        <ExchangeKeyStep
          exchangeLabel={exchangeLabel}
          exchangeType={state.exchangeType}
          error={state.exchangeError}
          inputValue={state.inputValue}
          onInputChange={handleInputChange}
          onSubmit={handleInputSubmit}
        />
      )}

      {state.step === "exchange-secret" && (
        <ExchangeSecretStep
          exchangeLabel={exchangeLabel}
          apiKey={state.exchangeApiKey}
          inputValue={state.inputValue}
          onInputChange={handleInputChange}
          onSubmit={handleInputSubmit}
        />
      )}

      {state.step === "exchange-passphrase" && (
        <ExchangePassphraseStep
          exchangeLabel={exchangeLabel}
          inputValue={state.inputValue}
          onInputChange={handleInputChange}
          onSubmit={handleInputSubmit}
        />
      )}

      {state.step === "exchange-wallet" && (
        <ExchangeWalletStep
          exchangeLabel={exchangeLabel}
          exchangeType={state.exchangeType}
          error={state.exchangeError}
          inputValue={state.inputValue}
          onInputChange={handleInputChange}
          onSubmit={handleInputSubmit}
        />
      )}

      {state.step === "exchange-validating" && (
        <ValidatingStep exchangeLabel={exchangeLabel} />
      )}

      {state.step === "llm" && (
        <LLMStep
          exchangeConfigured={state.exchangeValidated}
          exchangeLabel={exchangeLabel}
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
          exchangeConfigured={state.exchangeValidated}
          exchangeLabel={exchangeLabel}
          llmConfigured={!!state.openaiApiKey}
        />
      )}

      {state.step !== "welcome" && state.step !== "done" && state.step !== "exchange-validating" && (
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
        <Text color={COLORS.DIM}>1. Exchange API credentials</Text>
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

interface ExchangeSelectStepProps {
  error: string | null;
  inputValue: string;
  onInputChange: (value: string) => void;
  onSubmit: (value: string) => void;
}

function ExchangeSelectStep({ error, inputValue, onInputChange, onSubmit }: ExchangeSelectStepProps): React.ReactElement {
  return (
    <Box flexDirection="column">
      <Box marginBottom={1}>
        <Text color={COLORS.TAN} bold>
          Step 1: Choose Exchange
        </Text>
      </Box>

      {error && (
        <Box marginBottom={1} borderStyle="single" borderColor="red" paddingX={1}>
          <Text color="red">{error}</Text>
        </Box>
      )}

      <Box flexDirection="column" marginBottom={1}>
        <Text color={COLORS.WHITE}>
          Select the exchange you want to connect.
        </Text>
        <Text color={COLORS.DIM}>
          Supported: {SUPPORTED_EXCHANGES.join(", ")}
        </Text>
      </Box>

      <Box marginTop={1}>
        <Text color={COLORS.WHITE}>Enter exchange name: </Text>
        <TextInput
          value={inputValue}
          onChange={onInputChange}
          onSubmit={onSubmit}
          placeholder="binance"
        />
      </Box>
    </Box>
  );
}

interface ExchangeKeyStepProps {
  exchangeLabel: string;
  exchangeType: ExchangeSelection;
  error: string | null;
  inputValue: string;
  onInputChange: (value: string) => void;
  onSubmit: (value: string) => void;
}

function ExchangeKeyStep({
  exchangeLabel,
  exchangeType,
  error,
  inputValue,
  onInputChange,
  onSubmit,
}: ExchangeKeyStepProps): React.ReactElement {
  const instructions = getExchangeInstructions(exchangeType);

  return (
    <Box flexDirection="column">
      <Box marginBottom={1}>
        <Text color={COLORS.TAN} bold>
          Step 1: {exchangeLabel} API Key
        </Text>
      </Box>

      {error && (
        <Box marginBottom={1} borderStyle="single" borderColor="red" paddingX={1}>
          <Text color="red">{error}</Text>
        </Box>
      )}

      <Box flexDirection="column" marginBottom={1}>
        <Text color={COLORS.WHITE}>
          Gordon needs exchange API access to view your portfolio and place trades.
        </Text>
      </Box>

      {instructions.length > 0 && (
        <Box flexDirection="column" marginBottom={1}>
          <Text color={COLORS.TAN_DIM} bold>How to get your API key:</Text>
          <Box flexDirection="column" marginLeft={2}>
            {instructions.map((line, index) => (
              <Text key={`${exchangeLabel}-step-${index}`} color={COLORS.DIM}>
                {index + 1}. {line}
              </Text>
            ))}
          </Box>
        </Box>
      )}

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

interface ExchangeSecretStepProps {
  exchangeLabel: string;
  apiKey: string;
  inputValue: string;
  onInputChange: (value: string) => void;
  onSubmit: (value: string) => void;
}

function ExchangeSecretStep({
  exchangeLabel,
  apiKey,
  inputValue,
  onInputChange,
  onSubmit,
}: ExchangeSecretStepProps): React.ReactElement {
  return (
    <Box flexDirection="column">
      <Box marginBottom={1}>
        <Text color={COLORS.TAN} bold>
          Step 1: {exchangeLabel} API Secret
        </Text>
      </Box>

      <Box marginBottom={1}>
        <Text color={COLORS.DIM}>API Key: </Text>
        <Text color={COLORS.TAN_DIM}>{maskSecret(apiKey)}</Text>
      </Box>

      <Box flexDirection="column" marginBottom={1}>
        <Text color={COLORS.WHITE}>
          Now enter the API Secret (shown only once when you created the key).
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

interface ExchangePassphraseStepProps {
  exchangeLabel: string;
  inputValue: string;
  onInputChange: (value: string) => void;
  onSubmit: (value: string) => void;
}

function ExchangePassphraseStep({
  exchangeLabel,
  inputValue,
  onInputChange,
  onSubmit,
}: ExchangePassphraseStepProps): React.ReactElement {
  return (
    <Box flexDirection="column">
      <Box marginBottom={1}>
        <Text color={COLORS.TAN} bold>
          Step 1: {exchangeLabel} API Passphrase
        </Text>
      </Box>

      <Box flexDirection="column" marginBottom={1}>
        <Text color={COLORS.WHITE}>
          Enter the API passphrase for your {exchangeLabel} key.
        </Text>
      </Box>

      <Box marginTop={1}>
        <Text color={COLORS.WHITE}>Enter your Passphrase: </Text>
        <TextInput
          value={inputValue}
          onChange={onInputChange}
          onSubmit={onSubmit}
          placeholder="Passphrase"
          mask="*"
        />
      </Box>
    </Box>
  );
}

interface ExchangeWalletStepProps {
  exchangeLabel: string;
  exchangeType: ExchangeSelection;
  error: string | null;
  inputValue: string;
  onInputChange: (value: string) => void;
  onSubmit: (value: string) => void;
}

function ExchangeWalletStep({
  exchangeLabel,
  exchangeType,
  error,
  inputValue,
  onInputChange,
  onSubmit,
}: ExchangeWalletStepProps): React.ReactElement {
  const instructions = getExchangeInstructions(exchangeType);

  return (
    <Box flexDirection="column">
      <Box marginBottom={1}>
        <Text color={COLORS.TAN} bold>
          Step 1: {exchangeLabel} Wallet Private Key
        </Text>
      </Box>

      {error && (
        <Box marginBottom={1} borderStyle="single" borderColor="red" paddingX={1}>
          <Text color="red">{error}</Text>
        </Box>
      )}

      <Box flexDirection="column" marginBottom={1}>
        <Text color={COLORS.WHITE}>
          {exchangeLabel} uses wallet-based authentication (no API key needed).
        </Text>
        <Text color={COLORS.WHITE}>
          Gordon needs your wallet private key to sign transactions.
        </Text>
      </Box>

      <Box marginBottom={1} borderStyle="single" borderColor="yellow" paddingX={1}>
        <Box flexDirection="column">
          <Text color="yellow" bold>SECURITY WARNING</Text>
          <Text color="yellow">
            Use a DEDICATED trading wallet with limited funds.
          </Text>
          <Text color="yellow">
            Never use your main wallet or hardware wallet private key.
          </Text>
        </Box>
      </Box>

      {instructions.length > 0 && (
        <Box flexDirection="column" marginBottom={1}>
          <Text color={COLORS.TAN_DIM} bold>How to get your wallet private key:</Text>
          <Box flexDirection="column" marginLeft={2}>
            {instructions.map((line, index) => (
              <Text key={`${exchangeLabel}-step-${index}`} color={COLORS.DIM}>
                {index + 1}. {line}
              </Text>
            ))}
          </Box>
        </Box>
      )}

      <Box marginTop={1}>
        <Text color={COLORS.WHITE}>Enter your Wallet Private Key: </Text>
        <TextInput
          value={inputValue}
          onChange={onInputChange}
          onSubmit={onSubmit}
          placeholder="0x..."
          mask="*"
        />
      </Box>

      <Box marginTop={1}>
        <Text color={COLORS.DIM}>
          Your private key is never displayed and is stored locally in ~/.gordon/config.json
        </Text>
      </Box>
    </Box>
  );
}

interface ValidatingStepProps {
  exchangeLabel: string;
}

function ValidatingStep({ exchangeLabel }: ValidatingStepProps): React.ReactElement {
  return (
    <Box flexDirection="column">
      <Box marginBottom={1}>
        <Text color={COLORS.TAN} bold>
          Validating {exchangeLabel} Credentials...
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
  exchangeConfigured: boolean;
  exchangeLabel: string;
  inputValue: string;
  onInputChange: (value: string) => void;
  onSubmit: (value: string) => void;
}

function LLMStep({
  exchangeConfigured,
  exchangeLabel,
  inputValue,
  onInputChange,
  onSubmit,
}: LLMStepProps): React.ReactElement {
  return (
    <Box flexDirection="column">
      <Box marginBottom={1}>
        <Text color={COLORS.TAN} bold>
          Step 2: LLM API Key
        </Text>
      </Box>

      {exchangeConfigured && (
        <Box marginBottom={1}>
          <Text color="green">{exchangeLabel} configured successfully!</Text>
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
  exchangeConfigured: boolean;
  exchangeLabel: string;
  llmConfigured: boolean;
}

function DoneStep({ exchangeConfigured, exchangeLabel, llmConfigured }: DoneStepProps): React.ReactElement {
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
          <Text color={exchangeConfigured ? "green" : COLORS.DIM}>
            {exchangeConfigured ? "[OK]" : "[--]"} {exchangeLabel} API
          </Text>
          {!exchangeConfigured && (
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

      {!exchangeConfigured && (
        <Box marginBottom={1}>
          <Text color={COLORS.TAN_DIM}>
            Note: Without exchange API keys, Gordon runs in demo mode.
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
