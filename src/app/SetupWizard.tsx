/**
 * SetupWizard Component
 * Step-by-step configuration for exchange and LLM API keys
 */

import React, { useState, useCallback } from "react";
import { Box, Text, useInput } from "ink";
import TextInput from "ink-text-input";

import { resetAgents } from "../infra/agents/index.ts";
import { resetProviderRegistry } from "../infra/providers/index.ts";
import { BinanceClient, checkAndValidatePermissions } from "../infra/binance/index.ts";
import { ExchangeFactory, type ExchangeId } from "../infra/exchange/index.ts";
import { EXCHANGE_ENV_MAP } from "../infra/exchange/types.ts";
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
  | "chain-select"
  | "chain-solana"
  | "chain-polkadot"
  | "chain-chainlink"
  | "chain-evm"
  | "chain-cdp"
  | "chain-synthdata"
  | "llm"
  | "preferences"
  | "done";

type ChainId = "solana" | "polkadot" | "chainlink" | "evm" | "cdp" | "synthdata";
type LLMWizardProvider = "openai" | "inception" | "dedalus";

const CHAIN_OPTIONS: Array<{ id: ChainId; label: string; description: string }> = [
  { id: "solana", label: "Solana", description: "DeFi swaps, token launches, staking, lending (60+ tools)" },
  { id: "polkadot", label: "Polkadot", description: "Cross-chain swaps, staking, governance" },
  { id: "chainlink", label: "Chainlink Streams", description: "Real-time institutional-grade price feeds" },
  { id: "evm", label: "EVM / CCIP", description: "Cross-chain bridging via Chainlink CCIP" },
  { id: "cdp", label: "Coinbase CDP", description: "Base smart wallets, onchain actions" },
  { id: "synthdata", label: "SynthData", description: "AI price predictions, volatility, options, LP optimization" },
];

type ExchangeSelection = ExchangeId | "";

const SUPPORTED_EXCHANGES: ExchangeId[] = ExchangeFactory.getSupportedExchanges();

const EXCHANGE_LABELS: Record<ExchangeId, string> = {
  binance: "Binance",
  binance_us: "Binance US",
  coinbase: "Coinbase",
  kraken: "Kraken",
  bitfinex: "Bitfinex",
  hyperliquid: "Hyperliquid",
  uniswap: "Uniswap",
};

const EXCHANGE_PASSPHRASE_REQUIRED: Record<ExchangeId, boolean> = {
  binance: false,
  binance_us: false,
  coinbase: true,
  kraken: false,
  bitfinex: false,
  hyperliquid: false,
  uniswap: false,
};

const EXCHANGE_WALLET_AUTH: Record<ExchangeId, boolean> = {
  binance: false,
  binance_us: false,
  coinbase: false,
  kraken: false,
  bitfinex: false,
  hyperliquid: true,
  uniswap: true,
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
  // Chain setup
  selectedChains: ChainId[];
  chainKeys: ChainKeys;
  chainSetupIndex: number;
  selectedLlmProvider: LLMWizardProvider | "";
  openaiApiKey: string;
  inceptionApiKey: string;
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
        step: "chain-select",
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
        step: "chain-select",
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

  const saveConfiguration = useCallback(async (overrides?: { preferences?: Preferences }) => {
    const currentConfig = await loadConfig();
    const newConfig: GordonConfig = {
      ...currentConfig,
      preferences: overrides?.preferences ?? state.preferences,
      onboardingComplete: true,
    };

    const isWalletAuth = requiresWalletAuth(state.exchangeType);
    const hasExchangeCredentials = state.exchangeType && state.exchangeValidated && (
      isWalletAuth
        ? !!state.walletPrivateKey
        : !!(state.exchangeApiKey && state.exchangeApiSecret)
    );

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

    await saveConfig(newConfig);

    // Reset provider and agent caches so next access reinitializes with fresh env variables
    resetProviderRegistry();
    resetAgents();
  }, [
    state.exchangeApiKey,
    state.exchangeApiSecret,
    state.exchangePassphrase,
    state.walletPrivateKey,
    state.exchangePermissions,
    state.exchangeType,
    state.exchangeValidated,
    state.chainKeys,
    state.preferences,
    state.selectedLlmProvider,
    state.openaiApiKey,
    state.inceptionApiKey,
    state.dedalusApiKey,
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
        step: nextChain ? chainStepMap[nextChain] : "llm",
        chainSetupIndex: nextIndex,
        inputValue: "",
        exchangeError: null,
      }));
    } else {
      setState((prev) => ({
        ...prev,
        step: "llm",
        inputValue: "",
        exchangeError: null,
      }));
    }
  }, []);

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

        case "chain-select": {
          // Parse comma-separated chain selections (e.g., "1,3,5" or "solana,chainlink")
          if (!trimmedValue) {
            setState((prev) => ({ ...prev, step: "llm", inputValue: "" }));
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
            setState((prev) => ({ ...prev, step: "llm", inputValue: "" }));
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
              step: "preferences",
              inputValue: "",
              exchangeError: null,
            }));
          }
          break;

        case "preferences": {
          const percent = parseInt(trimmedValue, 10);
          if (!isNaN(percent) && percent >= 0 && percent <= 100) {
            const newPreferences = { ...state.preferences, cashReservePercent: percent / 100 };
            setState((prev) => ({
              ...prev,
              preferences: newPreferences,
              step: "done",
              inputValue: "",
            }));
            await saveConfiguration({ preferences: newPreferences });
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
      state.chainSetupIndex,
      state.selectedChains,
      state.preferences,
      validateExchangeCredentials,
      saveConfiguration,
      advanceChainStep,
    ]
  );

  const handleInputChange = useCallback((value: string) => {
    setState((prev) => ({ ...prev, inputValue: value, exchangeError: null }));
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
          step: "chain-select",
          inputValue: "",
        }));
        break;

      case "chain-select":
        setState((prev) => ({
          ...prev,
          step: "llm",
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
        await saveConfiguration({ preferences: state.preferences });
        break;
    }
  }, [state.step, state.chainSetupIndex, state.selectedChains, advanceChainStep, saveConfiguration]);

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

      {state.step === "llm" && (
        <LLMStep
          exchangeConfigured={state.exchangeValidated}
          exchangeLabel={exchangeLabel}
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

      {state.step === "done" && (
        <DoneStep
          exchangeConfigured={state.exchangeValidated}
          exchangeLabel={exchangeLabel}
          llmConfigured={!!(state.openaiApiKey || state.inceptionApiKey || state.dedalusApiKey)}
          chainKeys={state.chainKeys}
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
        <Text color={COLORS.DIM}>2. Blockchain networks (Solana, Polkadot, Chainlink, etc.)</Text>
        <Text color={COLORS.DIM}>3. LLM API key (for AI features)</Text>
        <Text color={COLORS.DIM}>4. Trading preferences</Text>
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

interface LLMStepProps {
  exchangeConfigured: boolean;
  exchangeLabel: string;
  llmConfigured: boolean;
  error: string | null;
  inputValue: string;
  onInputChange: (value: string) => void;
  onSubmit: (value: string) => void;
}

function LLMStep({
  exchangeConfigured,
  exchangeLabel,
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
          Step 3: LLM API Key
        </Text>
      </Box>

      {exchangeConfigured && (
        <Box marginBottom={1}>
          <Text color="green">{exchangeLabel} configured successfully!</Text>
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
          Step 4: Trading Preferences
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
          Step 2: Blockchain Networks
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
          Step 2: {chainLabel}
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
  llmConfigured: boolean;
  chainKeys: ChainKeys;
}

function DoneStep({ exchangeConfigured, exchangeLabel, llmConfigured, chainKeys }: DoneStepProps): React.ReactElement {
  const hasSolana = !!chainKeys.solanaPrivateKey;
  const hasPolkadot = !!(chainKeys.polkadotMnemonic || chainKeys.polkadotPrivateKey);
  const hasChainlink = !!(chainKeys.chainlinkApiKey && chainKeys.chainlinkApiSecret);
  const hasEVM = !!chainKeys.evmPrivateKey;
  const hasCDP = !!(chainKeys.cdpApiKeyId && chainKeys.cdpApiKeySecret && chainKeys.cdpWalletSecret);
  const hasSynthData = !!chainKeys.synthDataApiKey;
  const anyChain = hasSolana || hasPolkadot || hasChainlink || hasEVM || hasCDP || hasSynthData;

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

export default SetupWizard;
