/**
 * SetupWizard Component
 * Step-by-step configuration for exchange, broker, and LLM API keys
 */

import React, { useState, useCallback, useEffect, useRef } from "react";
import { Box, Text, useInput } from "ink";
import TextInput from "ink-text-input";
import { NoticeAlert } from "./components/PromptPrimitives.tsx";

import { resetAgents } from "../infra/agents/index.ts";
import { resetProviderRegistry } from "../infra/providers/index.ts";
import { BinanceClient, checkAndValidatePermissions } from "../infra/binance/index.ts";
import { ExchangeFactory, type ExchangeId } from "../infra/exchange/index.ts";
import { EXCHANGE_ENV_MAP } from "../infra/exchange/types.ts";
import { BrokerFactory } from "../infra/broker/factory.ts";
import { BROKER_ENV_MAP, type BrokerId } from "../infra/broker/types.ts";
import { recordStructuredObservation } from "../infra/observability/index.ts";
import { loadConfig, saveConfig } from "../infra/storage/config.ts";
import { saveEnvKeys, createEnvFile, checkEnvStatus } from "../infra/storage/env.ts";
import type {
  GordonConfig,
  ExchangePermissions,
  Preferences,
  MultiExchangeConfig,
  MultiBrokerConfig,
} from "../types/index.ts";
import { COLORS } from "./theme.ts";
import {
  getSetupSectionLabel,
  type SetupWizardMode,
  type SetupWizardSection,
} from "./setup-flow.ts";

type WizardStep =
  | "welcome"
  | "exchange-select"
  | "exchange-key"
  | "exchange-secret"
  | "exchange-passphrase"
  | "exchange-wallet"
  | "exchange-validating"
  | "broker-select"
  | "broker-key"
  | "broker-secret"
  | "broker-mode"
  | "broker-validating"
  | "chain-select"
  | "chain-solana"
  | "chain-polkadot"
  | "chain-chainlink"
  | "chain-evm"
  | "chain-cdp"
  | "chain-synthdata"
  | "rails"
  | "mcp"
  | "llm"
  | "preferences"
  | "startup-banner"
  | "done";

type ChainId = "solana" | "polkadot" | "chainlink" | "evm" | "cdp" | "synthdata";
type LLMWizardProvider = "openai" | "inception" | "dedalus";
type RailProviderId = "helius" | "moonpay" | "polygon";

const CHAIN_OPTIONS: Array<{ id: ChainId; label: string; description: string }> = [
  { id: "solana", label: "Solana", description: "DeFi swaps, token launches, staking, lending (60+ tools)" },
  { id: "polkadot", label: "Polkadot", description: "Cross-chain swaps, staking, governance" },
  { id: "chainlink", label: "Chainlink Streams", description: "Real-time institutional-grade price feeds" },
  { id: "evm", label: "EVM / CCIP", description: "Cross-chain bridging via Chainlink CCIP" },
  { id: "cdp", label: "Coinbase CDP", description: "Base smart wallets, onchain actions" },
  { id: "synthdata", label: "SynthData", description: "AI price predictions, volatility, options, LP optimization" },
];

type ExchangeSelection = ExchangeId | "";
type BrokerSelection = BrokerId | "";

const SUPPORTED_EXCHANGES: ExchangeId[] = ExchangeFactory.getSupportedExchanges();
const SUPPORTED_BROKERS: BrokerId[] = BrokerFactory.getSupportedBrokers();

const EXCHANGE_LABELS: Record<ExchangeId, string> = {
  binance: "Binance",
  binance_us: "Binance US",
  coinbase: "Coinbase",
  kraken: "Kraken",
  bitfinex: "Bitfinex",
  hyperliquid: "Hyperliquid",
  uniswap: "Uniswap",
  robinhood: "Robinhood Crypto",
};

const EXCHANGE_PASSPHRASE_REQUIRED: Record<ExchangeId, boolean> = {
  binance: false,
  binance_us: false,
  coinbase: true,
  kraken: false,
  bitfinex: false,
  hyperliquid: false,
  uniswap: false,
  robinhood: false,
};

const EXCHANGE_WALLET_AUTH: Record<ExchangeId, boolean> = {
  binance: false,
  binance_us: false,
  coinbase: false,
  kraken: false,
  bitfinex: false,
  hyperliquid: true,
  uniswap: true,
  robinhood: false,
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
  uniswap: [
    "Get an API key from developers.uniswap.org",
    "Provide your wallet address (the address that will execute swaps)",
    "Ensure your wallet has ETH for gas and tokens to trade",
    "Supports 15+ chains: Ethereum, Base, Arbitrum, Polygon, Optimism, etc.",
  ],
  robinhood: [
    "Go to Robinhood Crypto API settings and create API credentials",
    "Copy your API key and private signing key",
    "Paste API key into Exchange API Key and private key into Exchange API Secret",
    "Keep your private key secure and never share it",
  ],
};

const BROKER_LABELS: Record<BrokerId, string> = {
  alpaca: "Alpaca",
  webull: "Webull",
  schwab: "Schwab",
  tradier: "Tradier",
  tradestation: "TradeStation",
  tastytrade: "tastytrade",
  trading212: "Trading 212",
  etrade: "E*TRADE",
  ibkr: "Interactive Brokers",
};

const BROKER_INSTRUCTIONS: Record<BrokerId, string[]> = {
  alpaca: [
    "Sign in to app.alpaca.markets",
    "Go to Paper Trading and generate an API key",
    "Copy the API Key ID and API Secret",
    "Use paper mode first, then switch to live once validated",
  ],
  webull: [
    "Sign in to developer.webull.com and create an OpenAPI application",
    "Copy your Webull App Key and App Secret",
    "If your account has multiple brokerage accounts, set WEBULL_ACCOUNT_ID",
    "Use paper/UAT mode first, then switch to live once validated",
  ],
  schwab: [
    "Create a Schwab Developer application and enable trader APIs",
    "Copy API credentials/token details",
    "Optionally set SCHWAB_ACCOUNT_ID for specific account routing",
    "Validate in paper mode before live deployment",
  ],
  tradier: [
    "Create a Tradier developer app and brokerage account",
    "Copy API token/secret values",
    "Optionally set TRADIER_ACCOUNT_ID for explicit account selection",
    "Use sandbox first, then switch to production",
  ],
  tradestation: [
    "Create a TradeStation API app and authorize account access",
    "Copy API credentials/token material",
    "Optionally set TRADESTATION_ACCOUNT_ID for fixed account routing",
    "Validate in SIM mode before live routing",
  ],
  tastytrade: [
    "Use your tastytrade login/email and password for session auth",
    "Optionally set TASTYTRADE_ACCOUNT_ID for account pinning",
    "Validate in sandbox mode before live execution",
  ],
  trading212: [
    "Create Trading 212 Public API credentials",
    "Copy API key and API secret",
    "Optionally set TRADING212_ACCOUNT_ID if you want explicit account pinning",
    "Use the demo environment first before switching to live",
  ],
  etrade: [
    "Create an E*TRADE developer application",
    "Copy API credentials and OAuth token material",
    "Optionally set ETRADE_ACCOUNT_ID if multiple accounts exist",
    "Validate in sandbox mode before live execution",
  ],
  ibkr: [
    "Start IBKR Client Portal Gateway locally and authenticate session",
    "Configure gateway host/ports as needed",
    "Optionally set IBKR_ACCOUNT_ID to pin a specific account",
    "Validate paper account flow before live routing",
  ],
};

/** Validation patterns for chain private keys */
const SOLANA_BASE58_REGEX = /^[1-9A-HJ-NP-Za-km-z]{32,128}$/;
const EVM_HEX_KEY_REGEX = /^0x[0-9a-fA-F]{64}$/;
const POLKADOT_HEX_KEY_REGEX = /^0x[0-9a-fA-F]{64}$/;

interface ChainKeys {
  solanaPrivateKey: string;
  solanaRpcUrl: string;
  polkadotMnemonic: string;
  polkadotPrivateKey: string;
  chainlinkApiKey: string;
  chainlinkApiSecret: string;
  evmPrivateKey: string;
  cdpApiKeyId: string;
  cdpApiKeySecret: string;
  cdpWalletSecret: string;
  synthDataApiKey: string;
}

interface RailKeys {
  heliusApiKey: string;
  moonpayApiKey: string;
  moonpaySecretKey: string;
  polygonRecipient: string;
  polygonPrivateKey: string;
}

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
  brokerType: BrokerSelection;
  brokerApiKey: string;
  brokerApiSecret: string;
  brokerPaper: boolean;
  brokerValidated: boolean;
  // Chain setup
  selectedChains: ChainId[];
  chainKeys: ChainKeys;
  railKeys: RailKeys;
  mcpAutoSync: boolean;
  chainSetupIndex: number;
  selectedLlmProvider: LLMWizardProvider | "";
  openaiApiKey: string;
  inceptionApiKey: string;
  dedalusApiKey: string;
  preferences: Preferences;
  startupBannerMode: "full" | "quiet";
  inputValue: string;
  isValidating: boolean;
}

interface SetupWizardProps {
  onComplete: () => void;
  mode?: SetupWizardMode;
  initialSection?: SetupWizardSection | null;
}

const SECTION_STEP_MAP: Record<SetupWizardSection, WizardStep> = {
  exchange: "exchange-select",
  broker: "broker-select",
  chains: "chain-select",
  rails: "rails",
  mcp: "mcp",
  llm: "llm",
  preferences: "preferences",
};

function getFirstActionStep(
  mode: SetupWizardMode,
  initialSection: SetupWizardSection | null | undefined,
): WizardStep {
  if (mode === "quickstart") return "llm";
  if (mode === "configure" && initialSection) return SECTION_STEP_MAP[initialSection];
  return "exchange-select";
}

function getPostExchangeStep(
  mode: SetupWizardMode,
  initialSection: SetupWizardSection | null | undefined,
): WizardStep {
  if (mode === "quickstart") return "preferences";
  if (mode === "configure" && initialSection === "exchange") return "done";
  return "broker-select";
}

function getPostBrokerStep(
  mode: SetupWizardMode,
  initialSection: SetupWizardSection | null | undefined,
): WizardStep {
  if (mode === "configure" && initialSection === "broker") return "done";
  return "chain-select";
}

function getPostChainsStep(
  mode: SetupWizardMode,
  initialSection: SetupWizardSection | null | undefined,
): WizardStep {
  if (mode === "configure" && initialSection === "chains") return "done";
  return "rails";
}

function getPostRailsStep(
  mode: SetupWizardMode,
  initialSection: SetupWizardSection | null | undefined,
): WizardStep {
  if (mode === "configure" && initialSection === "rails") return "done";
  return "mcp";
}

function getPostMcpStep(
  mode: SetupWizardMode,
  initialSection: SetupWizardSection | null | undefined,
): WizardStep {
  if (mode === "configure" && initialSection === "mcp") return "done";
  return "llm";
}

function getPostLlmStep(
  mode: SetupWizardMode,
  initialSection: SetupWizardSection | null | undefined,
): WizardStep {
  if (mode === "quickstart") return "exchange-select";
  if (mode === "configure" && initialSection === "llm") return "done";
  return "preferences";
}

function getPostPreferencesStep(
  mode: SetupWizardMode,
  initialSection: SetupWizardSection | null | undefined,
): WizardStep {
  if (mode === "configure" && initialSection === "preferences") return "done";
  return "done";
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

function getBrokerLabel(brokerType: BrokerSelection): string {
  if (!brokerType) return "Broker";
  return BROKER_LABELS[brokerType] || brokerType;
}

function getBrokerInstructions(brokerType: BrokerSelection): string[] {
  if (!brokerType) return [];
  return BROKER_INSTRUCTIONS[brokerType] || ["Follow your broker documentation to create API keys."];
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

function generateBrokerId(type: BrokerId, brokers: MultiBrokerConfig[]): string {
  const baseId: string = type;
  let id: string = baseId;
  let counter = 1;

  while (brokers.some((broker) => broker.id === id)) {
    id = `${baseId}_${counter}`;
    counter++;
  }

  return id;
}

function parseBrokerMode(value: string): boolean | null {
  const normalized = value.trim().toLowerCase();
  if (!normalized || normalized === "paper" || normalized === "true" || normalized === "1") {
    return true;
  }
  if (normalized === "live" || normalized === "false" || normalized === "0") {
    return false;
  }
  return null;
}

function parseLLMProviderInput(value: string): { provider: LLMWizardProvider; apiKey: string } | null {
  const match = value.match(/^(openai|inception|dedalus)\s*[:=\/]\s*(.+)$/i);
  if (!match?.[1] || !match[2]) {
    return null;
  }

  return {
    provider: match[1].toLowerCase() as LLMWizardProvider,
    apiKey: match[2].trim(),
  };
}

function parseRailsInput(value: string): { keys: Partial<RailKeys>; errors: string[] } {
  const keys: Partial<RailKeys> = {};
  const errors: string[] = [];
  const entries = value
    .split(";")
    .map((entry) => entry.trim())
    .filter(Boolean);

  for (const entry of entries) {
    const [provider, rawValue] = entry.split(/[:=]/, 2).map((part) => part.trim());
    if (!provider || !rawValue) {
      errors.push(`Invalid rail entry: ${entry}`);
      continue;
    }

    const normalized = provider.toLowerCase() as RailProviderId;
    if (normalized === "helius") {
      keys.heliusApiKey = rawValue;
      continue;
    }

    if (normalized === "moonpay") {
      const [apiKey, secretKey] = rawValue.split(",").map((part) => part.trim());
      if (!apiKey || !secretKey) {
        errors.push("MoonPay requires both api key and secret key: moonpay:apiKey,secretKey");
        continue;
      }
      keys.moonpayApiKey = apiKey;
      keys.moonpaySecretKey = secretKey;
      continue;
    }

    if (normalized === "polygon") {
      const [recipient, privateKey] = rawValue.split(",").map((part) => part.trim());
      if (!recipient || !privateKey) {
        errors.push("Polygon x402 requires recipient and private key: polygon:recipient,privateKey");
        continue;
      }
      keys.polygonRecipient = recipient;
      keys.polygonPrivateKey = privateKey;
      continue;
    }

    errors.push(`Unsupported rail provider: ${provider}`);
  }

  return { keys, errors };
}

function parseMcpSyncInput(value: string): boolean | null {
  const normalized = value.trim().toLowerCase();
  if (!normalized || normalized === "auto" || normalized === "on" || normalized === "true" || normalized === "yes") {
    return true;
  }
  if (normalized === "manual" || normalized === "off" || normalized === "false" || normalized === "no") {
    return false;
  }
  return null;
}

export function SetupWizard({
  onComplete,
  mode = "advanced",
  initialSection = null,
}: SetupWizardProps): React.ReactElement {
  const lastTrackedStepRef = useRef<WizardStep | null>(null);
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
    brokerType: "",
    brokerApiKey: "",
    brokerApiSecret: "",
    brokerPaper: true,
    brokerValidated: false,
    selectedChains: [],
    chainKeys: {
      solanaPrivateKey: "",
      solanaRpcUrl: "",
      polkadotMnemonic: "",
      polkadotPrivateKey: "",
      chainlinkApiKey: "",
      chainlinkApiSecret: "",
      evmPrivateKey: "",
      cdpApiKeyId: "",
      cdpApiKeySecret: "",
      cdpWalletSecret: "",
      synthDataApiKey: "",
    },
    railKeys: {
      heliusApiKey: "",
      moonpayApiKey: "",
      moonpaySecretKey: "",
      polygonRecipient: "",
      polygonPrivateKey: "",
    },
    mcpAutoSync: true,
    chainSetupIndex: 0,
    selectedLlmProvider: "",
    openaiApiKey: "",
    inceptionApiKey: "",
    dedalusApiKey: "",
    preferences: {
      cashReservePercent: 0.2,
      maxAllocationPerTrade: 0.1,
      defaultTimeframes: ["1h", "4h"],
      topNCoins: 50,
      maxConcurrentTrades: 5,
    },
    startupBannerMode: "full",
    inputValue: "",
    isValidating: false,
  });

  useEffect(() => {
    let mounted = true;
    void loadConfig().then((config) => {
      if (!mounted) return;
      setState((prev) => ({
        ...prev,
        preferences: config.preferences,
        mcpAutoSync: config.agentRails.autoSyncMcpPlugins,
        startupBannerMode: config.startupBannerMode,
      }));
    }).catch(() => {
      // Best effort only. The wizard still works with defaults.
    });

    return () => {
      mounted = false;
    };
  }, [initialSection, mode]);

  const llmConfigured = Boolean(state.openaiApiKey || state.inceptionApiKey || state.dedalusApiKey);

  const recordSetupObservation = useCallback((eventType: string, options?: {
    outcome?: "success" | "failure" | "info" | "cancelled";
    status?: string;
    step?: WizardStep;
    exchange?: string;
    broker?: string;
    provider?: string;
    selectedCount?: number;
    reason?: string;
    durationMs?: number;
    details?: Record<string, unknown>;
  }) => {
    recordStructuredObservation({
      eventType,
      workflow: "setup",
      source: "setup_wizard",
      component: "SetupWizard",
      outcome: options?.outcome,
      status: options?.status,
      step: options?.step ?? state.step,
      exchange: (options?.exchange ?? state.exchangeType) || undefined,
      broker: (options?.broker ?? state.brokerType) || undefined,
      provider: (options?.provider ?? state.selectedLlmProvider) || undefined,
      selectedCount: options?.selectedCount ?? state.selectedChains.length,
      reason: options?.reason,
      durationMs: options?.durationMs,
      details: {
        wizardMode: mode,
        initialSection: initialSection ?? undefined,
        exchangeValidated: state.exchangeValidated,
        brokerValidated: state.brokerValidated,
        llmConfigured,
        selectedChains: state.selectedChains,
        mcpAutoSync: state.mcpAutoSync,
        startupBannerMode: state.startupBannerMode,
        ...options?.details,
      },
    });
  }, [
    initialSection,
    llmConfigured,
    mode,
    state.brokerType,
    state.brokerValidated,
    state.exchangeType,
    state.exchangeValidated,
    state.mcpAutoSync,
    state.selectedChains,
    state.selectedLlmProvider,
    state.startupBannerMode,
    state.step,
  ]);

  useEffect(() => {
    recordStructuredObservation({
      eventType: "setup.wizard_opened",
      workflow: "setup",
      source: "setup_wizard",
      component: "SetupWizard",
      outcome: "info",
      step: "welcome",
      details: {
        wizardMode: mode,
        initialSection: initialSection ?? undefined,
      },
    });
  }, [initialSection, mode]);

  useEffect(() => {
    if (lastTrackedStepRef.current === state.step) return;
    lastTrackedStepRef.current = state.step;

    recordSetupObservation("setup.step_viewed", {
      outcome: "info",
      status: "viewed",
      step: state.step,
    });
  }, [recordSetupObservation, state.step]);

  const validateExchangeCredentials = useCallback(async (
    exchangeType: ExchangeId,
    apiKey: string,
    apiSecret: string,
    passphrase?: string,
    walletPrivateKey?: string
  ) => {
    const startedAt = Date.now();
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
        recordSetupObservation("setup.exchange_validation_failed", {
          outcome: "failure",
          status: "connection_failed",
          step: "exchange-key",
          exchange: exchangeType,
          reason: "Could not connect to Binance API. Please check your internet connection.",
          details: {
            durationMs: Date.now() - startedAt,
          },
        });
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
        recordSetupObservation("setup.exchange_validation_failed", {
          outcome: "failure",
          status: "permissions_invalid",
          step: "exchange-key",
          exchange: exchangeType,
          reason: validation.errors[0] ?? "Exchange permissions validation failed.",
          details: {
            durationMs: Date.now() - startedAt,
            validationErrors: validation.errors,
          },
        });
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
        step: getPostExchangeStep(mode, initialSection),
        isValidating: false,
        exchangePermissions: permissions,
        exchangeError: null,
        exchangeValidated: true,
      }));
      recordSetupObservation("setup.exchange_validated", {
        outcome: "success",
        status: "validated",
        exchange: exchangeType,
        details: {
          durationMs: Date.now() - startedAt,
          permissionSummary: permissions,
        },
      });
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
        step: getPostExchangeStep(mode, initialSection),
        isValidating: false,
        exchangePermissions: null,
        exchangeError: null,
        exchangeValidated: true,
      }));
      recordSetupObservation("setup.exchange_validated", {
        outcome: "success",
        status: "validated",
        exchange: exchangeType,
        details: {
          durationMs: Date.now() - startedAt,
        },
      });
    } catch (error) {
      ExchangeFactory.removeFromCache(exchangeType, {
        apiKey: isWalletAuth ? "" : apiKey,
        apiSecret: isWalletAuth ? "" : apiSecret,
        walletPrivateKey,
      });
      const message = error instanceof Error ? error.message : String(error);
      recordSetupObservation("setup.exchange_validation_failed", {
        outcome: "failure",
        status: "validation_failed",
        step: errorStep,
        exchange: exchangeType,
        reason: message,
        details: {
          durationMs: Date.now() - startedAt,
        },
      });
      setState((prev) => ({
        ...prev,
        step: errorStep,
        isValidating: false,
        exchangeError: message,
        exchangeApiKey: "",
        exchangeApiSecret: "",
        exchangePassphrase: "",
        walletPrivateKey: "",
        exchangeValidated: false,
      }));
    }
  }, [initialSection, mode]);

  const validateBrokerCredentials = useCallback(async (
    brokerType: BrokerId,
    apiKey: string,
    apiSecret: string,
    paper: boolean,
  ) => {
    const startedAt = Date.now();
    setState((prev) => ({
      ...prev,
      step: "broker-validating",
      isValidating: true,
      exchangeError: null,
    }));

    try {
      const broker = BrokerFactory.create(brokerType, { apiKey, apiSecret, paper });
      const connected = await broker.testConnection();

      if (!connected) {
        recordSetupObservation("setup.broker_validation_failed", {
          outcome: "failure",
          status: "connection_failed",
          step: "broker-key",
          broker: brokerType,
          reason: "Could not connect to broker API. Check key/secret and try again.",
          details: {
            durationMs: Date.now() - startedAt,
          },
        });
        setState((prev) => ({
          ...prev,
          step: "broker-key",
          isValidating: false,
          exchangeError: "Could not connect to broker API. Check key/secret and try again.",
          brokerApiKey: "",
          brokerApiSecret: "",
          brokerValidated: false,
          inputValue: "",
        }));
        return;
      }

      setState((prev) => ({
        ...prev,
        step: getPostBrokerStep(mode, initialSection),
        isValidating: false,
        exchangeError: null,
        brokerPaper: paper,
        brokerValidated: true,
        inputValue: "",
      }));
      recordSetupObservation("setup.broker_validated", {
        outcome: "success",
        status: paper ? "paper_validated" : "live_validated",
        broker: brokerType,
        details: {
          durationMs: Date.now() - startedAt,
          paper,
        },
      });
    } catch (error) {
      BrokerFactory.removeFromCache(brokerType, { apiKey, apiSecret, paper });
      const message = error instanceof Error ? error.message : String(error);
      recordSetupObservation("setup.broker_validation_failed", {
        outcome: "failure",
        status: "validation_failed",
        step: "broker-key",
        broker: brokerType,
        reason: message,
        details: {
          durationMs: Date.now() - startedAt,
          paper,
        },
      });
      setState((prev) => ({
        ...prev,
        step: "broker-key",
        isValidating: false,
        exchangeError: message,
        brokerApiKey: "",
        brokerApiSecret: "",
        brokerValidated: false,
        inputValue: "",
      }));
    }
  }, []);

  const saveConfiguration = useCallback(async (overrides?: {
    preferences?: Preferences;
    startupBannerMode?: "full" | "quiet";
  }) => {
    const currentConfig = await loadConfig();
    const newConfig: GordonConfig = {
      ...currentConfig,
      preferences: overrides?.preferences ?? state.preferences,
      startupBannerMode: overrides?.startupBannerMode ?? state.startupBannerMode,
      onboardingComplete: true,
    };

    const isWalletAuth = requiresWalletAuth(state.exchangeType);
    const hasExchangeCredentials = state.exchangeType && state.exchangeValidated && (
      isWalletAuth
        ? !!state.walletPrivateKey
        : !!(state.exchangeApiKey && state.exchangeApiSecret)
    );
    const hasBrokerCredentials = state.brokerType
      && state.brokerValidated
      && !!(state.brokerApiKey && state.brokerApiSecret);

    // 1. Build env keys for .env file (all exchanges + chains + LLM)
    const envKeys: Record<string, string> = {};

    if (state.openaiApiKey) envKeys.OPENAI_API_KEY = state.openaiApiKey;
    if (state.inceptionApiKey) envKeys.INCEPTION_API_KEY = state.inceptionApiKey;
    if (state.dedalusApiKey) envKeys.DEDALUS_API_KEY = state.dedalusApiKey;
    if (state.selectedLlmProvider) {
      envKeys.GORDON_PROVIDER = state.selectedLlmProvider;
      envKeys.GORDON_MODEL =
        state.selectedLlmProvider === "openai"
          ? "openai/gpt-5.2"
          : state.selectedLlmProvider === "inception"
            ? "inception/mercury-2"
            : "openai/gpt-5.2";
    }

    // Broker credentials
    if (state.brokerType) {
      const envMap = BROKER_ENV_MAP[state.brokerType];
      if (envMap) {
        if (envMap.key && state.brokerApiKey) envKeys[envMap.key] = state.brokerApiKey;
        if (envMap.secret && state.brokerApiSecret) envKeys[envMap.secret] = state.brokerApiSecret;
        if (envMap.paper) envKeys[envMap.paper] = state.brokerPaper ? "true" : "false";
      }
    }

    // Map exchange credentials to env var names (all exchange types, not just Binance)
    if (state.exchangeType) {
      const envMap = EXCHANGE_ENV_MAP[state.exchangeType];
      if (envMap) {
        if (envMap.key && state.exchangeApiKey) envKeys[envMap.key] = state.exchangeApiKey;
        if (envMap.secret && state.exchangeApiSecret) envKeys[envMap.secret] = state.exchangeApiSecret;
        if (envMap.passphrase && state.exchangePassphrase) envKeys[envMap.passphrase] = state.exchangePassphrase;
        if (envMap.wallet && state.walletPrivateKey) envKeys[envMap.wallet] = state.walletPrivateKey;
      }
    }

    // Chain provider keys
    if (state.chainKeys.solanaPrivateKey) envKeys.SOLANA_PRIVATE_KEY = state.chainKeys.solanaPrivateKey;
    if (state.chainKeys.solanaRpcUrl) envKeys.SOLANA_RPC_URL = state.chainKeys.solanaRpcUrl;
    if (state.chainKeys.polkadotMnemonic) envKeys.POLKADOT_MNEMONIC = state.chainKeys.polkadotMnemonic;
    if (state.chainKeys.polkadotPrivateKey) envKeys.POLKADOT_PRIVATE_KEY = state.chainKeys.polkadotPrivateKey;
    if (state.chainKeys.chainlinkApiKey) envKeys.CHAINLINK_API_KEY = state.chainKeys.chainlinkApiKey;
    if (state.chainKeys.chainlinkApiSecret) envKeys.CHAINLINK_API_SECRET = state.chainKeys.chainlinkApiSecret;
    if (state.chainKeys.evmPrivateKey) envKeys.EVM_PRIVATE_KEY = state.chainKeys.evmPrivateKey;
    if (state.chainKeys.cdpApiKeyId) envKeys.CDP_API_KEY_ID = state.chainKeys.cdpApiKeyId;
    if (state.chainKeys.cdpApiKeySecret) envKeys.CDP_API_KEY_SECRET = state.chainKeys.cdpApiKeySecret;
    if (state.chainKeys.cdpWalletSecret) envKeys.CDP_WALLET_SECRET = state.chainKeys.cdpWalletSecret;
    if (state.chainKeys.synthDataApiKey) envKeys.SYNTHDATA_API_KEY = state.chainKeys.synthDataApiKey;
    if (state.railKeys.heliusApiKey) envKeys.HELIUS_API_KEY = state.railKeys.heliusApiKey;
    if (state.railKeys.moonpayApiKey) envKeys.MOONPAY_API_KEY = state.railKeys.moonpayApiKey;
    if (state.railKeys.moonpaySecretKey) envKeys.MOONPAY_SECRET_KEY = state.railKeys.moonpaySecretKey;
    if (state.railKeys.polygonRecipient) envKeys.POLYGON_X402_RECIPIENT = state.railKeys.polygonRecipient;
    if (state.railKeys.polygonPrivateKey) envKeys.POLYGON_X402_PRIVATE_KEY = state.railKeys.polygonPrivateKey;

    // 2. Save secrets to .env (the source of truth for credentials)
    const envStatus = await checkEnvStatus();
    if (envStatus.fileExists) {
      await saveEnvKeys(envKeys);
    } else {
      await createEnvFile(envKeys);
    }

    // 3. Build exchange config for config.json with redacted secrets
    if (hasExchangeCredentials) {
      const exchanges = currentConfig.exchanges ? [...currentConfig.exchanges] : [];
      const exchangeType = state.exchangeType as ExchangeId;
      const exchangeId = generateExchangeId(exchangeType, exchanges);

      const newExchange: MultiExchangeConfig = {
        id: exchangeId,
        type: exchangeType,
        apiKey: "***",
        apiSecret: "***",
        passphrase: state.exchangePassphrase ? "***" : undefined,
        walletPrivateKey: state.walletPrivateKey ? "***" : undefined,
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
          name: "binance" as const,
          apiKey: "***",
          apiSecret: "***",
          permissions: state.exchangePermissions,
        };
      }
    }

    if (hasBrokerCredentials) {
      const brokers = currentConfig.brokers ? [...currentConfig.brokers] : [];
      const brokerType = state.brokerType as BrokerId;
      const brokerId = generateBrokerId(brokerType, brokers);

      const newBroker: MultiBrokerConfig = {
        id: brokerId,
        type: brokerType,
        apiKey: "***",
        apiSecret: "***",
        paper: state.brokerPaper,
        isDefault: true,
      };

      newConfig.brokers = [
        ...brokers.map((broker) => ({
          ...broker,
          isDefault: false,
        })),
        newBroker,
      ];
      newConfig.activeBrokerId = brokerId;
    }

    newConfig.agentRails = {
      ...currentConfig.agentRails,
      autoSyncMcpPlugins: state.mcpAutoSync,
      walletProviders: state.railKeys.moonpayApiKey || state.railKeys.moonpaySecretKey
        ? [
            ...currentConfig.agentRails.walletProviders
              .filter((provider) => provider.type !== "moonpay")
              .map((provider) => ({ ...provider, isDefault: false })),
            {
              id: "moonpay",
              type: "moonpay",
              authMode: "native",
              enabled: true,
              isDefault: true,
            },
          ]
        : currentConfig.agentRails.walletProviders,
      activeWalletProviderId: state.railKeys.moonpayApiKey || state.railKeys.moonpaySecretKey
        ? "moonpay"
        : currentConfig.agentRails.activeWalletProviderId,
      chainProviders: state.railKeys.heliusApiKey
        ? [
            ...currentConfig.agentRails.chainProviders
              .filter((provider) => provider.type !== "helius")
              .map((provider) => ({ ...provider, isDefault: false })),
            {
              id: "helius",
              type: "helius",
              authMode: "native",
              enabled: true,
              isDefault: true,
              network: "solana",
            },
          ]
        : currentConfig.agentRails.chainProviders,
      activeChainProviderId: state.railKeys.heliusApiKey
        ? "helius"
        : currentConfig.agentRails.activeChainProviderId,
      paymentProviders: state.railKeys.polygonRecipient || state.railKeys.polygonPrivateKey
        ? [
            ...currentConfig.agentRails.paymentProviders
              .filter((provider) => provider.type !== "polygon")
              .map((provider) => ({ ...provider, isDefault: false })),
            {
              id: "polygon",
              type: "polygon",
              authMode: "native",
              enabled: true,
              isDefault: true,
              network: "polygon",
              recipient: state.railKeys.polygonRecipient || undefined,
            },
          ]
        : currentConfig.agentRails.paymentProviders,
      activePaymentProviderId: state.railKeys.polygonRecipient || state.railKeys.polygonPrivateKey
        ? "polygon"
        : currentConfig.agentRails.activePaymentProviderId,
    };

    await saveConfig(newConfig);

    // Reset provider and agent caches so next access reinitializes with fresh env variables
    resetProviderRegistry();
    resetAgents();

    recordStructuredObservation({
      eventType: "setup.configuration_saved",
      workflow: "setup",
      source: "setup_wizard",
      component: "SetupWizard",
      outcome: "success",
      status: mode === "configure" ? "section_saved" : "completed",
      exchange: state.exchangeType || undefined,
      broker: state.brokerType || undefined,
      provider: state.selectedLlmProvider || undefined,
      selectedCount: state.selectedChains.length,
      details: {
        wizardMode: mode,
        initialSection: initialSection ?? undefined,
        onboardingComplete: true,
        hasExchangeCredentials,
        hasBrokerCredentials,
        llmConfigured,
        envKeysSavedCount: Object.keys(envKeys).length,
        railsConfiguredCount: [
          state.railKeys.heliusApiKey,
          state.railKeys.moonpayApiKey || state.railKeys.moonpaySecretKey,
          state.railKeys.polygonRecipient || state.railKeys.polygonPrivateKey,
        ].filter(Boolean).length,
        startupBannerMode: overrides?.startupBannerMode ?? state.startupBannerMode,
        mcpAutoSync: state.mcpAutoSync,
      },
    });
  }, [
    state.exchangeApiKey,
    state.exchangeApiSecret,
    state.exchangePassphrase,
    state.walletPrivateKey,
    state.exchangePermissions,
    state.exchangeType,
    state.exchangeValidated,
    state.brokerType,
    state.brokerApiKey,
    state.brokerApiSecret,
    state.brokerPaper,
    state.brokerValidated,
    state.chainKeys,
    state.railKeys,
    state.mcpAutoSync,
    state.preferences,
    state.startupBannerMode,
    state.selectedLlmProvider,
    state.openaiApiKey,
    state.inceptionApiKey,
    state.dedalusApiKey,
    llmConfigured,
    initialSection,
    mode,
  ]);

  // Map chain IDs to their wizard step names
  const chainStepMap: Record<ChainId, WizardStep> = {
    solana: "chain-solana",
    polkadot: "chain-polkadot",
    chainlink: "chain-chainlink",
    evm: "chain-evm",
    cdp: "chain-cdp",
    synthdata: "chain-synthdata",
  };

  // Advance to the next selected chain step, or to LLM if done
  const advanceChainStep = useCallback((currentIndex: number, chains: ChainId[]) => {
    const nextIndex = currentIndex + 1;
    if (nextIndex < chains.length) {
      const nextChain = chains[nextIndex];
      setState((prev) => ({
        ...prev,
        step: nextChain ? chainStepMap[nextChain] : getPostChainsStep(mode, initialSection),
        chainSetupIndex: nextIndex,
        inputValue: "",
        exchangeError: null,
      }));
    } else {
      setState((prev) => ({
        ...prev,
        step: getPostChainsStep(mode, initialSection),
        inputValue: "",
        exchangeError: null,
      }));
    }
  }, [initialSection, mode]);

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
              exchangeError: `Unsupported crypto venue: ${trimmedValue}. Supported: ${SUPPORTED_EXCHANGES.join(", ")}`,
              inputValue: "",
            }));
            return;
          }

          // Route to wallet auth for DEX venues like Hyperliquid
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

        case "broker-select": {
          if (!trimmedValue) {
            setState((prev) => ({ ...prev, step: "chain-select", inputValue: "" }));
            break;
          }

          const normalized = trimmedValue.toLowerCase();
          const match = SUPPORTED_BROKERS.find((broker) => broker === normalized);

          if (!match) {
            setState((prev) => ({
              ...prev,
              exchangeError: `Unsupported broker: ${trimmedValue}. Supported: ${SUPPORTED_BROKERS.join(", ")}`,
              inputValue: "",
            }));
            return;
          }

          setState((prev) => ({
            ...prev,
            brokerType: match,
            brokerApiKey: "",
            brokerApiSecret: "",
            brokerPaper: true,
            brokerValidated: false,
            exchangeError: null,
            step: "broker-key",
            inputValue: "",
          }));
          break;
        }

        case "broker-key":
          if (trimmedValue) {
            setState((prev) => ({
              ...prev,
              brokerApiKey: trimmedValue,
              step: "broker-secret",
              inputValue: "",
            }));
          }
          break;

        case "broker-secret":
          if (trimmedValue) {
            setState((prev) => ({
              ...prev,
              brokerApiSecret: trimmedValue,
              step: "broker-mode",
              inputValue: "",
            }));
          }
          break;

        case "broker-mode": {
          if (!state.brokerType) {
            setState((prev) => ({
              ...prev,
              step: "broker-select",
              inputValue: "",
            }));
            break;
          }

          const paper = parseBrokerMode(trimmedValue);
          if (paper === null) {
            setState((prev) => ({
              ...prev,
              exchangeError: 'Use "paper" or "live" (or true/false).',
            }));
            return;
          }

          setState((prev) => ({
            ...prev,
            brokerPaper: paper,
            inputValue: "",
            exchangeError: null,
          }));

          await validateBrokerCredentials(
            state.brokerType as BrokerId,
            state.brokerApiKey,
            state.brokerApiSecret,
            paper,
          );
          break;
        }

        case "chain-select": {
          // Parse comma-separated chain selections (e.g., "1,3,5" or "solana,chainlink")
          if (!trimmedValue) {
            setState((prev) => ({ ...prev, step: getPostChainsStep(mode, initialSection), inputValue: "" }));
            break;
          }
          const parts = trimmedValue.split(",").map((s) => s.trim().toLowerCase());
          const selected: ChainId[] = [];
          for (const part of parts) {
            // Support both numbers (1-5) and names
            const idx = parseInt(part, 10);
            if (!isNaN(idx) && idx >= 1 && idx <= CHAIN_OPTIONS.length) {
              const opt = CHAIN_OPTIONS[idx - 1];
              if (opt) selected.push(opt.id);
            } else {
              const match = CHAIN_OPTIONS.find((o) => o.id === part || o.label.toLowerCase() === part);
              if (match) selected.push(match.id);
            }
          }
          const unique = [...new Set(selected)];
          if (unique.length === 0) {
            setState((prev) => ({ ...prev, step: getPostChainsStep(mode, initialSection), inputValue: "" }));
          } else {
            const firstChain = unique[0]!;
            setState((prev) => ({
              ...prev,
              selectedChains: unique,
              chainSetupIndex: 0,
              step: chainStepMap[firstChain],
              inputValue: "",
            }));
          }
          break;
        }

        case "chain-solana":
          if (trimmedValue) {
            // Validate base58 format (Solana private keys are 64-88 base58 chars)
            if (!SOLANA_BASE58_REGEX.test(trimmedValue)) {
              setState((prev) => ({
                ...prev,
                exchangeError: "Invalid format. Solana private keys are base58-encoded (no 0, O, I, l characters). Check your key and try again.",
              }));
              return;
            }
            setState((prev) => ({
              ...prev,
              chainKeys: { ...prev.chainKeys, solanaPrivateKey: trimmedValue },
              exchangeError: null,
              inputValue: "",
            }));
          }
          advanceChainStep(state.chainSetupIndex, state.selectedChains);
          break;

        case "chain-polkadot":
          if (trimmedValue) {
            // Accept hex private key (0x-prefixed) or mnemonic (12/24 words)
            const wordCount = trimmedValue.split(/\s+/).length;
            const isHexKey = POLKADOT_HEX_KEY_REGEX.test(trimmedValue);
            const isMnemonic = wordCount === 12 || wordCount === 24;
            if (!isHexKey && !isMnemonic) {
              setState((prev) => ({
                ...prev,
                exchangeError: `Invalid format. Expected a 12 or 24-word mnemonic phrase, or a 0x-prefixed hex private key (66 chars). Got ${wordCount} word(s).`,
              }));
              return;
            }
            setState((prev) => ({
              ...prev,
              chainKeys: {
                ...prev.chainKeys,
                ...(isHexKey
                  ? { polkadotPrivateKey: trimmedValue }
                  : { polkadotMnemonic: trimmedValue }),
              },
              exchangeError: null,
              inputValue: "",
            }));
          }
          advanceChainStep(state.chainSetupIndex, state.selectedChains);
          break;

        case "chain-chainlink":
          // Expect "key,secret" comma-separated (both required for Data Streams)
          if (trimmedValue) {
            const [key, secret] = trimmedValue.split(",").map((s) => s.trim());
            if (!key || !secret) {
              setState((prev) => ({
                ...prev,
                exchangeError: "Both API Key and API Secret are required. Enter them comma-separated: key,secret",
              }));
              return;
            }
            setState((prev) => ({
              ...prev,
              chainKeys: {
                ...prev.chainKeys,
                chainlinkApiKey: key,
                chainlinkApiSecret: secret,
              },
              exchangeError: null,
              inputValue: "",
            }));
          }
          advanceChainStep(state.chainSetupIndex, state.selectedChains);
          break;

        case "chain-evm":
          if (trimmedValue) {
            // Validate EVM private key: 0x-prefixed 64 hex chars
            const evmKey = trimmedValue.startsWith("0x") ? trimmedValue : `0x${trimmedValue}`;
            if (!EVM_HEX_KEY_REGEX.test(evmKey)) {
              setState((prev) => ({
                ...prev,
                exchangeError: "Invalid EVM private key. Expected 0x followed by 64 hex characters (66 chars total).",
              }));
              return;
            }
            setState((prev) => ({
              ...prev,
              chainKeys: { ...prev.chainKeys, evmPrivateKey: evmKey },
              exchangeError: null,
              inputValue: "",
            }));
          }
          advanceChainStep(state.chainSetupIndex, state.selectedChains);
          break;

        case "chain-cdp":
          // Expect "key_id,key_secret,wallet_secret" — all three required
          if (trimmedValue) {
            const parts = trimmedValue.split(",").map((s) => s.trim());
            if (!parts[0] || !parts[1] || !parts[2]) {
              setState((prev) => ({
                ...prev,
                exchangeError: "All three values are required: API Key ID, API Key Secret, and Wallet Secret. Separate with commas.",
              }));
              return;
            }
            setState((prev) => ({
              ...prev,
              chainKeys: {
                ...prev.chainKeys,
                cdpApiKeyId: parts[0]!,
                cdpApiKeySecret: parts[1]!,
                cdpWalletSecret: parts[2]!,
              },
              exchangeError: null,
              inputValue: "",
            }));
          }
          advanceChainStep(state.chainSetupIndex, state.selectedChains);
          break;

        case "chain-synthdata":
          if (trimmedValue) {
            setState((prev) => ({
              ...prev,
              chainKeys: {
                ...prev.chainKeys,
                synthDataApiKey: trimmedValue,
              },
              exchangeError: null,
              inputValue: "",
            }));
          }
          advanceChainStep(state.chainSetupIndex, state.selectedChains);
          break;

        case "llm":
          if (trimmedValue) {
            const parsed = parseLLMProviderInput(trimmedValue);
            if (!parsed) {
              setState((prev) => ({
                ...prev,
                exchangeError: "Use explicit provider format: openai:<key>, inception:<key>, or dedalus:<key>.",
              }));
              return;
            }
            setState((prev) => ({
              ...prev,
              selectedLlmProvider: parsed.provider,
              openaiApiKey: parsed.provider === "openai" ? parsed.apiKey : prev.openaiApiKey,
              dedalusApiKey: parsed.provider === "dedalus" ? parsed.apiKey : prev.dedalusApiKey,
              inceptionApiKey: parsed.provider === "inception" ? parsed.apiKey : prev.inceptionApiKey,
              step: getPostLlmStep(mode, initialSection),
              inputValue: "",
              exchangeError: null,
            }));
          }
          break;

        case "rails": {
          if (!trimmedValue) {
            setState((prev) => ({
              ...prev,
              step: getPostRailsStep(mode, initialSection),
              inputValue: "",
              exchangeError: null,
            }));
            break;
          }

          const parsed = parseRailsInput(trimmedValue);
          if (parsed.errors.length > 0) {
            setState((prev) => ({
              ...prev,
              exchangeError: parsed.errors.join("\n"),
            }));
            break;
          }

          setState((prev) => ({
            ...prev,
            railKeys: {
              ...prev.railKeys,
              ...parsed.keys,
            },
            step: getPostRailsStep(mode, initialSection),
            inputValue: "",
            exchangeError: null,
          }));
          break;
        }

        case "mcp": {
          const autoSync = parseMcpSyncInput(trimmedValue);
          if (autoSync === null) {
            setState((prev) => ({
              ...prev,
              exchangeError: 'Use "auto" or "manual" (or on/off, true/false).',
            }));
            break;
          }

          setState((prev) => ({
            ...prev,
            mcpAutoSync: autoSync,
            step: getPostMcpStep(mode, initialSection),
            inputValue: "",
            exchangeError: null,
          }));
          break;
        }

        case "preferences": {
          const percent = parseInt(trimmedValue, 10);
          if (!isNaN(percent) && percent >= 0 && percent <= 100) {
            const newPreferences = { ...state.preferences, cashReservePercent: percent / 100 };
            setState((prev) => ({
              ...prev,
              preferences: newPreferences,
              step: "startup-banner",
              inputValue: "",
            }));
          }
          break;
        }

        case "startup-banner": {
          const normalized = trimmedValue.toLowerCase();
          if (normalized !== "full" && normalized !== "quiet") {
            setState((prev) => ({
              ...prev,
              exchangeError: 'Use "full" or "quiet".',
            }));
            break;
          }

          setState((prev) => ({
            ...prev,
            startupBannerMode: normalized,
            step: getPostPreferencesStep(mode, initialSection),
            inputValue: "",
            exchangeError: null,
          }));
          await saveConfiguration({
            preferences: state.preferences,
            startupBannerMode: normalized,
          });
          break;
        }
      }
    },
    [
      state.step,
      state.exchangeType,
      state.exchangeApiKey,
      state.exchangeApiSecret,
      state.brokerType,
      state.brokerApiKey,
      state.brokerApiSecret,
      state.chainSetupIndex,
      state.selectedChains,
      state.preferences,
      state.startupBannerMode,
      initialSection,
      mode,
      validateExchangeCredentials,
      validateBrokerCredentials,
      saveConfiguration,
      advanceChainStep,
    ]
  );

  const handleInputChange = useCallback((value: string) => {
    setState((prev) => ({ ...prev, inputValue: value.replace(/\r\n/g, "\n"), exchangeError: null }));
  }, []);

  const handleSkip = useCallback(async () => {
    recordSetupObservation("setup.step_skipped", {
      outcome: "cancelled",
      status: "skipped",
      step: state.step,
    });

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
          step: getPostExchangeStep(mode, initialSection),
          inputValue: "",
        }));
        break;

      case "broker-select":
      case "broker-key":
      case "broker-secret":
      case "broker-mode":
        setState((prev) => ({
          ...prev,
          brokerType: "",
          brokerApiKey: "",
          brokerApiSecret: "",
          brokerPaper: true,
          brokerValidated: false,
          exchangeError: null,
          step: getPostBrokerStep(mode, initialSection),
          inputValue: "",
        }));
        break;

      case "chain-select":
        setState((prev) => ({
          ...prev,
          step: getPostChainsStep(mode, initialSection),
          inputValue: "",
        }));
        break;

      case "chain-solana":
      case "chain-polkadot":
      case "chain-chainlink":
      case "chain-evm":
      case "chain-cdp":
      case "chain-synthdata":
        advanceChainStep(state.chainSetupIndex, state.selectedChains);
        break;

      case "llm":
        setState((prev) => ({
          ...prev,
          step: getPostLlmStep(mode, initialSection),
          inputValue: "",
        }));
        break;

      case "rails":
        setState((prev) => ({
          ...prev,
          step: getPostRailsStep(mode, initialSection),
          inputValue: "",
          exchangeError: null,
        }));
        break;

      case "mcp":
        setState((prev) => ({
          ...prev,
          step: getPostMcpStep(mode, initialSection),
          inputValue: "",
          exchangeError: null,
        }));
        break;

      case "preferences":
        setState((prev) => ({
          ...prev,
          step: "startup-banner",
          inputValue: "",
        }));
        break;

      case "startup-banner":
        setState((prev) => ({
          ...prev,
          step: getPostPreferencesStep(mode, initialSection),
          inputValue: "",
        }));
        await saveConfiguration({
          preferences: state.preferences,
          startupBannerMode: state.startupBannerMode,
        });
        break;
    }
  }, [
    state.step,
    state.chainSetupIndex,
    state.selectedChains,
    state.preferences,
    state.startupBannerMode,
    advanceChainStep,
    initialSection,
    mode,
    recordSetupObservation,
    saveConfiguration,
  ]);

  useInput((input, key) => {
    if (state.step === "welcome" && (input || key.return)) {
      setState((prev) => ({ ...prev, step: getFirstActionStep(mode, initialSection) }));
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
  const brokerLabel = getBrokerLabel(state.brokerType);

  return (
    <Box flexDirection="column" paddingX={2} paddingY={1}>
      {state.step === "welcome" && (
        <WelcomeStep mode={mode} initialSection={initialSection} />
      )}

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

      {state.step === "broker-select" && (
        <BrokerSelectStep
          error={state.exchangeError}
          inputValue={state.inputValue}
          onInputChange={handleInputChange}
          onSubmit={handleInputSubmit}
        />
      )}

      {state.step === "broker-key" && (
        <BrokerKeyStep
          brokerLabel={brokerLabel}
          brokerType={state.brokerType}
          error={state.exchangeError}
          inputValue={state.inputValue}
          onInputChange={handleInputChange}
          onSubmit={handleInputSubmit}
        />
      )}

      {state.step === "broker-secret" && (
        <BrokerSecretStep
          brokerLabel={brokerLabel}
          apiKey={state.brokerApiKey}
          inputValue={state.inputValue}
          onInputChange={handleInputChange}
          onSubmit={handleInputSubmit}
        />
      )}

      {state.step === "broker-mode" && (
        <BrokerModeStep
          brokerLabel={brokerLabel}
          inputValue={state.inputValue}
          onInputChange={handleInputChange}
          onSubmit={handleInputSubmit}
        />
      )}

      {state.step === "broker-validating" && (
        <BrokerValidatingStep brokerLabel={brokerLabel} />
      )}

      {state.step === "chain-select" && (
        <ChainSelectStep
          inputValue={state.inputValue}
          onInputChange={handleInputChange}
          onSubmit={handleInputSubmit}
        />
      )}

      {state.step === "chain-solana" && (
        <ChainKeyStep
          chainLabel="Solana"
          description="Enables DeFi swaps, token operations, staking, and lending across 60+ tools."
          keyLabel="Solana Private Key"
          placeholder="Base58 private key..."
          instructions={[
            "Create a new Solana wallet (e.g., via Phantom or solana-keygen)",
            "Export your private key (Base58 encoded)",
            "Use a DEDICATED wallet with limited funds for trading",
          ]}
          inputValue={state.inputValue}
          onInputChange={handleInputChange}
          onSubmit={handleInputSubmit}
          isMasked={true}
          error={state.exchangeError}
        />
      )}

      {state.step === "chain-polkadot" && (
        <ChainKeyStep
          chainLabel="Polkadot"
          description="Enables cross-chain swaps on HydraDX, staking, governance, and XCM transfers."
          keyLabel="Polkadot Mnemonic or Private Key"
          placeholder="word1 word2 ... (12/24 words) or 0x..."
          instructions={[
            "Create a new Polkadot account (e.g., via Polkadot.js extension)",
            "Export your mnemonic seed phrase (12 or 24 words) or hex private key",
            "Use a DEDICATED wallet with limited funds",
          ]}
          inputValue={state.inputValue}
          onInputChange={handleInputChange}
          onSubmit={handleInputSubmit}
          isMasked={true}
          error={state.exchangeError}
        />
      )}

      {state.step === "chain-chainlink" && (
        <ChainKeyStep
          chainLabel="Chainlink Data Streams"
          description="Enables sub-second institutional-grade price feeds for 50+ crypto pairs."
          keyLabel="API Key, API Secret"
          placeholder="api-key,api-secret"
          instructions={[
            "Sign up at data.chain.link for Data Streams access",
            "Generate an API key and secret from your dashboard",
            "Enter both separated by a comma: key,secret",
          ]}
          inputValue={state.inputValue}
          onInputChange={handleInputChange}
          onSubmit={handleInputSubmit}
          isMasked={true}
          error={state.exchangeError}
        />
      )}

      {state.step === "chain-evm" && (
        <ChainKeyStep
          chainLabel="EVM / Chainlink CCIP"
          description="Enables cross-chain token bridging between Ethereum, Arbitrum, Optimism, Polygon, Base, and more."
          keyLabel="EVM Private Key"
          placeholder="0x..."
          instructions={[
            "Export a private key from MetaMask or another EVM wallet",
            "Use a DEDICATED wallet with limited funds",
            "Ensure the wallet has ETH/native tokens for gas on source chains",
          ]}
          inputValue={state.inputValue}
          onInputChange={handleInputChange}
          onSubmit={handleInputSubmit}
          isMasked={true}
          error={state.exchangeError}
        />
      )}

      {state.step === "chain-cdp" && (
        <ChainKeyStep
          chainLabel="Coinbase CDP"
          description="Enables Base smart wallets, token deployments, and onchain actions via Coinbase Developer Platform."
          keyLabel="API Key ID, API Key Secret, Wallet Secret"
          placeholder="key-id,key-secret,wallet-secret"
          instructions={[
            "Go to portal.cdp.coinbase.com and create an API key",
            "Copy the API Key ID, API Key Secret, and Wallet Secret",
            "Enter all three separated by commas: id,secret,wallet-secret",
          ]}
          inputValue={state.inputValue}
          onInputChange={handleInputChange}
          onSubmit={handleInputSubmit}
          isMasked={true}
          error={state.exchangeError}
        />
      )}

      {state.step === "chain-synthdata" && (
        <ChainKeyStep
          chainLabel="SynthData"
          description="AI-powered probabilistic price predictions, volatility forecasts, options pricing, liquidation risk, and LP optimization."
          keyLabel="API Key"
          placeholder="your-synthdata-api-key"
          instructions={[
            "Sign up at synthdata.co and subscribe to a plan",
            "Generate an API key from your SynthData dashboard",
            "Paste your API key below",
          ]}
          inputValue={state.inputValue}
          onInputChange={handleInputChange}
          onSubmit={handleInputSubmit}
          isMasked={true}
          error={state.exchangeError}
        />
      )}

      {state.step === "rails" && (
        <RailsStep
          error={state.exchangeError}
          inputValue={state.inputValue}
          onInputChange={handleInputChange}
          onSubmit={handleInputSubmit}
        />
      )}

      {state.step === "mcp" && (
        <McpStep
          currentMode={state.mcpAutoSync}
          error={state.exchangeError}
          inputValue={state.inputValue}
          onInputChange={handleInputChange}
          onSubmit={handleInputSubmit}
        />
      )}

      {state.step === "llm" && (
        <LLMStep
          exchangeConfigured={state.exchangeValidated}
          exchangeLabel={exchangeLabel}
          brokerConfigured={state.brokerValidated}
          brokerLabel={brokerLabel}
          llmConfigured={!!(state.openaiApiKey || state.inceptionApiKey || state.dedalusApiKey)}
          error={state.exchangeError}
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

      {state.step === "startup-banner" && (
        <StartupBannerStep
          currentMode={state.startupBannerMode}
          error={state.exchangeError}
          inputValue={state.inputValue}
          onInputChange={handleInputChange}
          onSubmit={handleInputSubmit}
        />
      )}

      {state.step === "done" && (
        <DoneStep
          exchangeConfigured={state.exchangeValidated}
          exchangeLabel={exchangeLabel}
          brokerConfigured={state.brokerValidated}
          brokerLabel={brokerLabel}
          llmConfigured={!!(state.openaiApiKey || state.inceptionApiKey || state.dedalusApiKey)}
          chainKeys={state.chainKeys}
          railKeys={state.railKeys}
          mcpAutoSync={state.mcpAutoSync}
        />
      )}

      {state.step !== "welcome" && state.step !== "done" && state.step !== "exchange-validating" && state.step !== "broker-validating" && (
        <>
          {state.inputValue.includes("\n") && (
            <Box marginTop={1}>
              <NoticeAlert title="Multi-line paste detected" variant="info">
                Enter submits the full block for this setup step.
              </NoticeAlert>
            </Box>
          )}
          <Box marginTop={1}>
            <Text color={COLORS.DIM}>Press ESC to skip this step</Text>
          </Box>
        </>
      )}
    </Box>
  );
}

interface WelcomeStepProps {
  mode: SetupWizardMode;
  initialSection: SetupWizardSection | null;
}

function WelcomeStep({ mode, initialSection }: WelcomeStepProps): React.ReactElement {
  const setupLabel = mode === "quickstart"
    ? "QuickStart"
    : mode === "configure"
      ? `Configure ${initialSection ? getSetupSectionLabel(initialSection) : "Gordon"}`
      : "Advanced Setup";

  const scopeLines = mode === "quickstart"
    ? [
        "1. Choose one LLM provider",
        "2. Connect one primary trading venue",
        "3. Set a starting cash reserve",
        "4. Choose your startup banner mode",
        "5. Land directly in the terminal for scan and analysis",
      ]
    : [
        "1. Exchange API credentials",
        "2. Stock broker API credentials (optional)",
        "3. Blockchain networks and agent rails",
        "4. MCP auto-sync and LLM provider",
        "5. Trading preferences",
        "6. Startup banner mode",
      ];

  return (
    <Box flexDirection="column">
      <Box marginBottom={1}>
        <Text color={COLORS.TAN} bold>
          {setupLabel}
        </Text>
      </Box>

      <Box flexDirection="column" marginBottom={1}>
        <Text color={COLORS.WHITE}>
          This wizard will configure Gordon for the workflow you selected.
        </Text>
        <Text color={COLORS.WHITE}>
          Gordon will set up:
        </Text>
      </Box>

      <Box flexDirection="column" marginLeft={2}>
        {scopeLines.map((line) => (
          <Text key={line} color={COLORS.DIM}>{line}</Text>
        ))}
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
          Choose Exchange
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
          placeholder="binance | robinhood"
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
          {exchangeLabel} API Key
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
          mask="*"
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
          {exchangeLabel} API Secret
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
          Your secret is never displayed and is stored locally in ~/.gordon/.env
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
          {exchangeLabel} API Passphrase
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
          {exchangeLabel} Wallet Private Key
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
          Your private key is never displayed and is stored locally in ~/.gordon/.env
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

interface BrokerSelectStepProps {
  error: string | null;
  inputValue: string;
  onInputChange: (value: string) => void;
  onSubmit: (value: string) => void;
}

function BrokerSelectStep({
  error,
  inputValue,
  onInputChange,
  onSubmit,
}: BrokerSelectStepProps): React.ReactElement {
  return (
    <Box flexDirection="column">
      <Box marginBottom={1}>
        <Text color={COLORS.TAN} bold>
          Choose Stock Broker
        </Text>
      </Box>

      {error && (
        <Box marginBottom={1} borderStyle="single" borderColor="red" paddingX={1}>
          <Text color="red">{error}</Text>
        </Box>
      )}

      <Box flexDirection="column" marginBottom={1}>
        <Text color={COLORS.WHITE}>
          Optional: connect a stock/options broker.
        </Text>
        <Text color={COLORS.DIM}>
          Supported: {SUPPORTED_BROKERS.join(", ")}
        </Text>
      </Box>

      <Box marginTop={1}>
        <Text color={COLORS.WHITE}>Enter broker name (or ESC to skip): </Text>
        <TextInput
          value={inputValue}
          onChange={onInputChange}
          onSubmit={onSubmit}
          placeholder={SUPPORTED_BROKERS.join(" | ")}
        />
      </Box>
    </Box>
  );
}

interface BrokerKeyStepProps {
  brokerLabel: string;
  brokerType: BrokerSelection;
  error: string | null;
  inputValue: string;
  onInputChange: (value: string) => void;
  onSubmit: (value: string) => void;
}

function BrokerKeyStep({
  brokerLabel,
  brokerType,
  error,
  inputValue,
  onInputChange,
  onSubmit,
}: BrokerKeyStepProps): React.ReactElement {
  const instructions = getBrokerInstructions(brokerType);

  return (
    <Box flexDirection="column">
      <Box marginBottom={1}>
        <Text color={COLORS.TAN} bold>
          {brokerLabel} API Key
        </Text>
      </Box>

      {error && (
        <Box marginBottom={1} borderStyle="single" borderColor="red" paddingX={1}>
          <Text color="red">{error}</Text>
        </Box>
      )}

      {instructions.length > 0 && (
        <Box flexDirection="column" marginBottom={1}>
          <Text color={COLORS.TAN_DIM} bold>How to get your API key:</Text>
          <Box flexDirection="column" marginLeft={2}>
            {instructions.map((line, index) => (
              <Text key={`${brokerLabel}-step-${index}`} color={COLORS.DIM}>
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
          placeholder="Alpaca API key"
          mask="*"
        />
      </Box>
    </Box>
  );
}

interface BrokerSecretStepProps {
  brokerLabel: string;
  apiKey: string;
  inputValue: string;
  onInputChange: (value: string) => void;
  onSubmit: (value: string) => void;
}

function BrokerSecretStep({
  brokerLabel,
  apiKey,
  inputValue,
  onInputChange,
  onSubmit,
}: BrokerSecretStepProps): React.ReactElement {
  return (
    <Box flexDirection="column">
      <Box marginBottom={1}>
        <Text color={COLORS.TAN} bold>
          {brokerLabel} API Secret
        </Text>
      </Box>

      <Box marginBottom={1}>
        <Text color={COLORS.DIM}>API Key: </Text>
        <Text color={COLORS.TAN_DIM}>{maskSecret(apiKey)}</Text>
      </Box>

      <Box marginTop={1}>
        <Text color={COLORS.WHITE}>Enter your API Secret: </Text>
        <TextInput
          value={inputValue}
          onChange={onInputChange}
          onSubmit={onSubmit}
          placeholder="Alpaca API secret"
          mask="*"
        />
      </Box>
    </Box>
  );
}

interface BrokerModeStepProps {
  brokerLabel: string;
  inputValue: string;
  onInputChange: (value: string) => void;
  onSubmit: (value: string) => void;
}

function BrokerModeStep({
  brokerLabel,
  inputValue,
  onInputChange,
  onSubmit,
}: BrokerModeStepProps): React.ReactElement {
  return (
    <Box flexDirection="column">
      <Box marginBottom={1}>
        <Text color={COLORS.TAN} bold>
          {brokerLabel} Trading Mode
        </Text>
      </Box>

      <Box flexDirection="column" marginBottom={1}>
        <Text color={COLORS.WHITE}>
          Choose trading mode: paper (recommended) or live.
        </Text>
        <Text color={COLORS.DIM}>
          Paper mode uses simulated trades with real market data.
        </Text>
      </Box>

      <Box marginTop={1}>
        <Text color={COLORS.WHITE}>Enter mode (paper/live): </Text>
        <TextInput
          value={inputValue}
          onChange={onInputChange}
          onSubmit={onSubmit}
          placeholder="paper"
        />
      </Box>
    </Box>
  );
}

interface BrokerValidatingStepProps {
  brokerLabel: string;
}

function BrokerValidatingStep({ brokerLabel }: BrokerValidatingStepProps): React.ReactElement {
  return (
    <Box flexDirection="column">
      <Box marginBottom={1}>
        <Text color={COLORS.TAN} bold>
          Validating {brokerLabel} Credentials...
        </Text>
      </Box>

      <Box>
        <Text color={COLORS.WHITE}>
          Testing broker API connection...
        </Text>
      </Box>
    </Box>
  );
}

interface RailsStepProps {
  error: string | null;
  inputValue: string;
  onInputChange: (value: string) => void;
  onSubmit: (value: string) => void;
}

function RailsStep({
  error,
  inputValue,
  onInputChange,
  onSubmit,
}: RailsStepProps): React.ReactElement {
  return (
    <Box flexDirection="column">
      <Box marginBottom={1}>
        <Text color={COLORS.TAN} bold>
          Agent Rails
        </Text>
      </Box>

      {error && (
        <Box marginBottom={1} borderStyle="single" borderColor="red" paddingX={1}>
          <Text color="red">{error}</Text>
        </Box>
      )}

      <Box flexDirection="column" marginBottom={1}>
        <Text color={COLORS.WHITE}>
          Optional: configure native rails for wallet funding, Solana data, and agent payments.
        </Text>
        <Text color={COLORS.DIM}>
          Enter one or more entries separated by semicolons.
        </Text>
      </Box>

      <Box flexDirection="column" marginBottom={1} marginLeft={2}>
        <Text color={COLORS.DIM}>helius:your-api-key</Text>
        <Text color={COLORS.DIM}>moonpay:api-key,secret-key</Text>
        <Text color={COLORS.DIM}>polygon:recipient,private-key</Text>
      </Box>

      <Box marginTop={1}>
        <Text color={COLORS.WHITE}>Enter rail credentials: </Text>
        <TextInput
          value={inputValue}
          onChange={onInputChange}
          onSubmit={onSubmit}
          placeholder="helius:key; moonpay:api,secret"
          mask="*"
        />
      </Box>
    </Box>
  );
}

interface McpStepProps {
  currentMode: boolean;
  error: string | null;
  inputValue: string;
  onInputChange: (value: string) => void;
  onSubmit: (value: string) => void;
}

function McpStep({
  currentMode,
  error,
  inputValue,
  onInputChange,
  onSubmit,
}: McpStepProps): React.ReactElement {
  return (
    <Box flexDirection="column">
      <Box marginBottom={1}>
        <Text color={COLORS.TAN} bold>
          MCP Auto-Sync
        </Text>
      </Box>

      {error && (
        <Box marginBottom={1} borderStyle="single" borderColor="red" paddingX={1}>
          <Text color="red">{error}</Text>
        </Box>
      )}

      <Box flexDirection="column" marginBottom={1}>
        <Text color={COLORS.WHITE}>
          Gordon can auto-sync built-in MCP plugins for native rails like Helius and MoonPay.
        </Text>
        <Text color={COLORS.DIM}>
          Current default: {currentMode ? "auto" : "manual"}
        </Text>
      </Box>

      <Box marginTop={1}>
        <Text color={COLORS.WHITE}>Enter mode (auto/manual): </Text>
        <TextInput
          value={inputValue}
          onChange={onInputChange}
          onSubmit={onSubmit}
          placeholder={currentMode ? "auto" : "manual"}
        />
      </Box>
    </Box>
  );
}

interface LLMStepProps {
  exchangeConfigured: boolean;
  exchangeLabel: string;
  brokerConfigured: boolean;
  brokerLabel: string;
  llmConfigured: boolean;
  error: string | null;
  inputValue: string;
  onInputChange: (value: string) => void;
  onSubmit: (value: string) => void;
}

function LLMStep({
  exchangeConfigured,
  exchangeLabel,
  brokerConfigured,
  brokerLabel,
  llmConfigured,
  error,
  inputValue,
  onInputChange,
  onSubmit,
}: LLMStepProps): React.ReactElement {
  return (
    <Box flexDirection="column">
      <Box marginBottom={1}>
        <Text color={COLORS.TAN} bold>
          LLM API Key
        </Text>
      </Box>

      {exchangeConfigured && (
        <Box marginBottom={1}>
          <Text color="green">{exchangeLabel} configured successfully!</Text>
        </Box>
      )}

      {brokerConfigured && (
        <Box marginBottom={1}>
          <Text color="green">{brokerLabel} broker configured successfully!</Text>
        </Box>
      )}

      {llmConfigured && (
        <Box marginBottom={1}>
          <Text color="green">An LLM key is already configured. Enter a new key only if you want to replace it.</Text>
        </Box>
      )}

      {error && (
        <Box marginBottom={1} borderStyle="single" borderColor="red" paddingX={1}>
          <Text color="red">{error}</Text>
        </Box>
      )}

      <Box flexDirection="column" marginBottom={1}>
        <Text color={COLORS.WHITE}>
          Gordon uses AI to analyze markets and generate trade plans.
        </Text>
        <Text color={COLORS.WHITE}>
          Enter one provider-key pair using explicit format.
        </Text>
      </Box>

      <Box flexDirection="column" marginBottom={1}>
        <Text color={COLORS.TAN_DIM} bold>Accepted formats:</Text>
        <Box flexDirection="column" marginLeft={2}>
          <Text color={COLORS.DIM}>1. openai:sk-...</Text>
          <Text color={COLORS.DIM}>2. inception:your-key</Text>
          <Text color={COLORS.DIM}>3. dedalus:dd-...</Text>
        </Box>
      </Box>

      <Box marginBottom={1}>
        <Text color={COLORS.TAN_DIM}>
          Alternatively, set OPENAI_API_KEY, INCEPTION_API_KEY, or DEDALUS_API_KEY environment variables.
        </Text>
      </Box>

      <Box marginTop={1}>
        <Text color={COLORS.WHITE}>Enter provider and API key: </Text>
        <TextInput
          value={inputValue}
          onChange={onInputChange}
          onSubmit={onSubmit}
          placeholder="openai:sk-..."
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
          Trading Preferences
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

interface StartupBannerStepProps {
  currentMode: "full" | "quiet";
  error: string | null;
  inputValue: string;
  onInputChange: (value: string) => void;
  onSubmit: (value: string) => void;
}

function StartupBannerStep({
  currentMode,
  error,
  inputValue,
  onInputChange,
  onSubmit,
}: StartupBannerStepProps): React.ReactElement {
  return (
    <Box flexDirection="column">
      <Box marginBottom={1}>
        <Text color={COLORS.TAN} bold>
          Startup Banner
        </Text>
      </Box>

      {error && (
        <Box marginBottom={1} borderStyle="single" borderColor="red" paddingX={1}>
          <Text color="red">{error}</Text>
        </Box>
      )}

      <Box flexDirection="column" marginBottom={1}>
        <Text color={COLORS.WHITE}>
          Choose how Gordon should appear on startup.
        </Text>
        <Text color={COLORS.DIM}>
          Full shows the ASCII banner and quote. Quiet shows the compact header only.
        </Text>
        <Text color={COLORS.DIM}>
          Current default: {currentMode}
        </Text>
      </Box>

      <Box marginTop={1}>
        <Text color={COLORS.WHITE}>Enter mode (full/quiet): </Text>
        <TextInput
          value={inputValue}
          onChange={onInputChange}
          onSubmit={onSubmit}
          placeholder={currentMode}
        />
      </Box>
    </Box>
  );
}

interface ChainSelectStepProps {
  inputValue: string;
  onInputChange: (value: string) => void;
  onSubmit: (value: string) => void;
}

function ChainSelectStep({ inputValue, onInputChange, onSubmit }: ChainSelectStepProps): React.ReactElement {
  return (
    <Box flexDirection="column">
      <Box marginBottom={1}>
        <Text color={COLORS.TAN} bold>
          Blockchain Networks
        </Text>
      </Box>

      <Box flexDirection="column" marginBottom={1}>
        <Text color={COLORS.WHITE}>
          Configure blockchain network keys to unlock DeFi, bridging, and on-chain tools.
        </Text>
        <Text color={COLORS.DIM}>
          Enter the numbers of the chains you want to configure (comma-separated), or press ESC to skip.
        </Text>
      </Box>

      <Box flexDirection="column" marginBottom={1}>
        {CHAIN_OPTIONS.map((chain, index) => (
          <Box key={chain.id}>
            <Box width={4}><Text color={COLORS.ACCENT}>{index + 1}.</Text></Box>
            <Box width={22}><Text color={COLORS.WHITE} bold>{chain.label}</Text></Box>
            <Text color={COLORS.DIM}>{chain.description}</Text>
          </Box>
        ))}
      </Box>

      <Box marginTop={1}>
        <Text color={COLORS.WHITE}>Select chains (e.g., 1,3 or solana,chainlink): </Text>
        <TextInput
          value={inputValue}
          onChange={onInputChange}
          onSubmit={onSubmit}
          placeholder="1,2,3"
        />
      </Box>
    </Box>
  );
}

interface ChainKeyStepProps {
  chainLabel: string;
  description: string;
  keyLabel: string;
  placeholder: string;
  instructions: string[];
  inputValue: string;
  onInputChange: (value: string) => void;
  onSubmit: (value: string) => void;
  isMasked?: boolean;
  error?: string | null;
}

function ChainKeyStep({
  chainLabel,
  description,
  keyLabel,
  placeholder,
  instructions,
  inputValue,
  onInputChange,
  onSubmit,
  isMasked = false,
  error,
}: ChainKeyStepProps): React.ReactElement {
  return (
    <Box flexDirection="column">
      <Box marginBottom={1}>
        <Text color={COLORS.TAN} bold>
          {chainLabel}
        </Text>
      </Box>

      <Box flexDirection="column" marginBottom={1}>
        <Text color={COLORS.WHITE}>{description}</Text>
      </Box>

      {error && (
        <Box marginBottom={1} borderStyle="single" borderColor="red" paddingX={1}>
          <Text color="red">{error}</Text>
        </Box>
      )}

      <Box marginBottom={1} borderStyle="single" borderColor="yellow" paddingX={1}>
        <Box flexDirection="column">
          <Text color="yellow" bold>SECURITY</Text>
          <Text color="yellow">Use a DEDICATED wallet with limited funds. Never use your primary wallet.</Text>
        </Box>
      </Box>

      <Box flexDirection="column" marginBottom={1}>
        <Text color={COLORS.TAN_DIM} bold>Setup instructions:</Text>
        <Box flexDirection="column" marginLeft={2}>
          {instructions.map((line, index) => (
            <Text key={`${chainLabel}-${index}`} color={COLORS.DIM}>
              {index + 1}. {line}
            </Text>
          ))}
        </Box>
      </Box>

      <Box marginTop={1}>
        <Text color={COLORS.WHITE}>{keyLabel}: </Text>
        <TextInput
          value={inputValue}
          onChange={onInputChange}
          onSubmit={onSubmit}
          placeholder={placeholder}
          mask={isMasked ? "*" : undefined}
        />
      </Box>

      <Box marginTop={1}>
        <Text color={COLORS.DIM}>
          Keys are stored locally in ~/.gordon/.env
        </Text>
      </Box>
    </Box>
  );
}

interface DoneStepProps {
  exchangeConfigured: boolean;
  exchangeLabel: string;
  brokerConfigured: boolean;
  brokerLabel: string;
  llmConfigured: boolean;
  chainKeys: ChainKeys;
  railKeys: RailKeys;
  mcpAutoSync: boolean;
}

function DoneStep({
  exchangeConfigured,
  exchangeLabel,
  brokerConfigured,
  brokerLabel,
  llmConfigured,
  chainKeys,
  railKeys,
  mcpAutoSync,
}: DoneStepProps): React.ReactElement {
  const hasSolana = !!chainKeys.solanaPrivateKey;
  const hasPolkadot = !!(chainKeys.polkadotMnemonic || chainKeys.polkadotPrivateKey);
  const hasChainlink = !!(chainKeys.chainlinkApiKey && chainKeys.chainlinkApiSecret);
  const hasEVM = !!chainKeys.evmPrivateKey;
  const hasCDP = !!(chainKeys.cdpApiKeyId && chainKeys.cdpApiKeySecret && chainKeys.cdpWalletSecret);
  const hasSynthData = !!chainKeys.synthDataApiKey;
  const anyChain = hasSolana || hasPolkadot || hasChainlink || hasEVM || hasCDP || hasSynthData;
  const hasRails = !!(railKeys.heliusApiKey || railKeys.moonpayApiKey || railKeys.polygonRecipient);

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
          <Text color={brokerConfigured ? "green" : COLORS.DIM}>
            {brokerConfigured ? "[OK]" : "[--]"} {brokerLabel} Broker
          </Text>
          {!brokerConfigured && (
            <Text color={COLORS.DIM}> (not configured)</Text>
          )}
        </Box>

        {/* Chain status */}
        {anyChain && (
          <>
            {hasSolana && (
              <Box><Text color="green">[OK] Solana (DeFi, tokens, staking)</Text></Box>
            )}
            {hasPolkadot && (
              <Box><Text color="green">[OK] Polkadot (swaps, staking, governance)</Text></Box>
            )}
            {hasChainlink && (
              <Box><Text color="green">[OK] Chainlink Streams (real-time prices)</Text></Box>
            )}
            {hasEVM && (
              <Box><Text color="green">[OK] EVM / CCIP (cross-chain bridging)</Text></Box>
            )}
            {hasCDP && (
              <Box><Text color="green">[OK] Coinbase CDP (Base smart wallets)</Text></Box>
            )}
            {hasSynthData && (
              <Box><Text color="green">[OK] SynthData (AI predictions, LP optimization)</Text></Box>
            )}
          </>
        )}
        {!anyChain && (
          <Box><Text color={COLORS.DIM}>[--] Blockchain networks (not configured)</Text></Box>
        )}

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
        <Box>
          <Text color={hasRails ? "green" : COLORS.DIM}>
            {hasRails ? "[OK]" : "[--]"} Agent rails
          </Text>
          {!hasRails && (
            <Text color={COLORS.DIM}> (not configured)</Text>
          )}
        </Box>
        <Box>
          <Text color="green">[OK] MCP auto-sync: {mcpAutoSync ? "auto" : "manual"}</Text>
        </Box>
      </Box>

      {!exchangeConfigured && (
        <Box marginBottom={1}>
          <Text color={COLORS.TAN_DIM}>
            Note: Without exchange API keys, Gordon runs in demo mode.
          </Text>
        </Box>
      )}

      {!anyChain && (
        <Box marginBottom={1}>
          <Text color={COLORS.TAN_DIM}>
            Tip: Configure chains later via Settings or by editing ~/.gordon/.env
          </Text>
        </Box>
      )}

      <Box marginTop={1}>
        <Text color={COLORS.DIM}>Press any key to return to main menu...</Text>
      </Box>
    </Box>
  );
}

export const __setupWizardBrokerInternals = {
  getBrokerLabel,
  getBrokerInstructions,
  generateBrokerId,
  parseBrokerMode,
  parseRailsInput,
  parseMcpSyncInput,
  getFirstActionStep,
};

export default SetupWizard;
