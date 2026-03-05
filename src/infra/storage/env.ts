/**
 * Environment file detection and management
 * Handles .env file reading, writing, and key detection
 *
 * Keys are stored in ~/.gordon/.env for distributed CLI usage.
 * Also checks process.cwd()/.env for development convenience.
 */

import { existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import {
  validateEnvKeys,
  sanitizeKeyValue,
  isPlaceholderKey,
  formatValidationResult,
  type ValidationResult,
} from "./env-validation.ts";
import { createKeyringProvider, KEYRING_SUPPORTED_KEYS } from "./keyring.ts";
import { GORDON_DIR } from "./paths.ts";
import { resetProviderRegistry } from "../providers/index.ts";
const GORDON_ENV_PATH = join(GORDON_DIR, ".env");

// Secondary location: current working directory (for development)
const CWD_ENV_PATH = join(process.cwd(), ".env");

// We write to GORDON_ENV_PATH but read from both
const ENV_FILE_PATH = GORDON_ENV_PATH;

export interface EnvKeys {
  OPENAI_API_KEY?: string;
  DEDALUS_API_KEY?: string;
  INCEPTION_API_KEY?: string;
  ALPACA_API_KEY?: string;
  ALPACA_API_SECRET?: string;
  ALPACA_PAPER?: string;
  SCHWAB_API_KEY?: string;
  SCHWAB_API_SECRET?: string;
  SCHWAB_PAPER?: string;
  SCHWAB_ACCOUNT_ID?: string;
  TRADIER_API_KEY?: string;
  TRADIER_API_SECRET?: string;
  TRADIER_PAPER?: string;
  TRADIER_ACCOUNT_ID?: string;
  TRADESTATION_API_KEY?: string;
  TRADESTATION_API_SECRET?: string;
  TRADESTATION_PAPER?: string;
  TRADESTATION_ACCOUNT_ID?: string;
  TASTYTRADE_API_KEY?: string;
  TASTYTRADE_API_SECRET?: string;
  TASTYTRADE_PAPER?: string;
  TASTYTRADE_ACCOUNT_ID?: string;
  ETRADE_API_KEY?: string;
  ETRADE_API_SECRET?: string;
  ETRADE_PAPER?: string;
  ETRADE_ACCOUNT_ID?: string;
  IBKR_API_KEY?: string;
  IBKR_API_SECRET?: string;
  IBKR_PAPER?: string;
  IBKR_ACCOUNT_ID?: string;
  ROBINHOOD_API_KEY?: string;
  ROBINHOOD_API_SECRET?: string;
  WEBULL_API_KEY?: string;
  WEBULL_API_SECRET?: string;
  WEBULL_PAPER?: string;
  WEBULL_ACCOUNT_ID?: string;
  BINANCE_API_KEY?: string;
  BINANCE_API_SECRET?: string;
  BINANCE_US_API_KEY?: string;
  BINANCE_US_API_SECRET?: string;
  COINBASE_API_KEY?: string;
  COINBASE_API_SECRET?: string;
  COINBASE_PASSPHRASE?: string;
  KRAKEN_API_KEY?: string;
  KRAKEN_API_SECRET?: string;
  BITFINEX_API_KEY?: string;
  BITFINEX_API_SECRET?: string;
  HYPERLIQUID_PRIVATE_KEY?: string;
  TINYFISH_API_KEY?: string;
  UNISWAP_API_KEY?: string;
  THEGRAPH_API_KEY?: string;
  GORDON_PROVIDER?: string;
  GORDON_MODEL?: string;
  // Chain provider keys
  SOLANA_PRIVATE_KEY?: string;
  SOLANA_RPC_URL?: string;
  POLKADOT_MNEMONIC?: string;
  POLKADOT_PRIVATE_KEY?: string;
  CHAINLINK_API_KEY?: string;
  CHAINLINK_API_SECRET?: string;
  EVM_PRIVATE_KEY?: string;
  CDP_API_KEY_ID?: string;
  CDP_API_KEY_SECRET?: string;
  CDP_WALLET_SECRET?: string;
  CDP_NETWORK_ID?: string;
  BASESCAN_API_KEY?: string;
  SYNTHDATA_API_KEY?: string;
}

export interface EnvStatus {
  fileExists: boolean;
  hasLLMKey: boolean;
  hasInceptionKey: boolean;
  hasAlpacaKeys: boolean;
  hasRobinhoodKeys: boolean;
  hasWebullKeys: boolean;
  hasBinanceKeys: boolean;
  hasBinanceUSKeys: boolean;
  hasCoinbaseKeys: boolean;
  hasKrakenKeys: boolean;
  hasBitfinexKeys: boolean;
  hasHyperliquidKey: boolean;
  hasTinyfishKey: boolean;
  hasUniswapKey: boolean;
  hasGraphKey: boolean;
  // Chain provider status
  hasSolanaKey: boolean;
  hasPolkadotKey: boolean;
  hasChainlinkStreamsKeys: boolean;
  hasChainlinkCCIPKey: boolean;
  hasCDPKeys: boolean;
  hasBasescanKey: boolean;
  hasSynthDataKey: boolean;
  keys: EnvKeys;
}

/**
 * Escape a value for single-quoted .env format.
 * Single quotes inside the value are escaped as: end quote, backslash-escaped quote, reopen quote.
 */
function escapeEnvValue(value: string): string {
  return value.replace(/'/g, "'\\''");
}

/**
 * Unescape a value read from a single-quoted .env field.
 * Reverses the escapeEnvValue transform: '\'' → '
 */
function unescapeEnvValue(value: string): string {
  return value.replace(/'\\''/g, "'");
}

/**
 * Format a key=value pair for the .env file (single-quoted)
 */
function formatEnvLine(key: string, value: string): string {
  return `${key}='${escapeEnvValue(value)}'`;
}

/**
 * Parse a .env file content into key-value pairs
 */
function parseEnvContent(content: string): Record<string, string> {
  const result: Record<string, string> = {};

  for (const line of content.split("\n")) {
    const trimmed = line.trim();

    // Skip empty lines and comments
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }

    // Parse KEY=VALUE or KEY='VALUE' or KEY="VALUE"
    const match = trimmed.match(/^([^=]+)=(.*)$/);
    if (match) {
      const key = match[1]?.trim();
      let value = match[2]?.trim() ?? "";

      // Remove surrounding quotes and unescape
      if (value.startsWith("'") && value.endsWith("'")) {
        value = unescapeEnvValue(value.slice(1, -1));
      } else if (value.startsWith('"') && value.endsWith('"')) {
        value = value.slice(1, -1);
      }

      if (key) {
        result[key] = value;
      }
    }
  }

  return result;
}

/**
 * Find the first existing .env file path
 * Checks ~/.gordon/.env first, then cwd/.env for development
 */
function findEnvFilePath(): string | null {
  if (existsSync(GORDON_ENV_PATH)) {
    return GORDON_ENV_PATH;
  }
  if (existsSync(CWD_ENV_PATH)) {
    return CWD_ENV_PATH;
  }
  return null;
}

/** All tracked env key names (single source of truth) */
const ENV_KEY_NAMES: (keyof EnvKeys)[] = [
  "OPENAI_API_KEY", "DEDALUS_API_KEY", "INCEPTION_API_KEY",
  "ALPACA_API_KEY", "ALPACA_API_SECRET", "ALPACA_PAPER",
  "SCHWAB_API_KEY", "SCHWAB_API_SECRET", "SCHWAB_PAPER", "SCHWAB_ACCOUNT_ID",
  "TRADIER_API_KEY", "TRADIER_API_SECRET", "TRADIER_PAPER", "TRADIER_ACCOUNT_ID",
  "TRADESTATION_API_KEY", "TRADESTATION_API_SECRET", "TRADESTATION_PAPER", "TRADESTATION_ACCOUNT_ID",
  "TASTYTRADE_API_KEY", "TASTYTRADE_API_SECRET", "TASTYTRADE_PAPER", "TASTYTRADE_ACCOUNT_ID",
  "ETRADE_API_KEY", "ETRADE_API_SECRET", "ETRADE_PAPER", "ETRADE_ACCOUNT_ID",
  "IBKR_API_KEY", "IBKR_API_SECRET", "IBKR_PAPER", "IBKR_ACCOUNT_ID",
  "ROBINHOOD_API_KEY", "ROBINHOOD_API_SECRET",
  "WEBULL_API_KEY", "WEBULL_API_SECRET", "WEBULL_PAPER", "WEBULL_ACCOUNT_ID",
  "BINANCE_API_KEY", "BINANCE_API_SECRET", "BINANCE_US_API_KEY", "BINANCE_US_API_SECRET",
  "COINBASE_API_KEY", "COINBASE_API_SECRET", "COINBASE_PASSPHRASE",
  "KRAKEN_API_KEY", "KRAKEN_API_SECRET",
  "BITFINEX_API_KEY", "BITFINEX_API_SECRET",
  "HYPERLIQUID_PRIVATE_KEY", "TINYFISH_API_KEY", "UNISWAP_API_KEY", "THEGRAPH_API_KEY", "GORDON_PROVIDER", "GORDON_MODEL",
  "SOLANA_PRIVATE_KEY", "SOLANA_RPC_URL",
  "POLKADOT_MNEMONIC", "POLKADOT_PRIVATE_KEY",
  "CHAINLINK_API_KEY", "CHAINLINK_API_SECRET", "EVM_PRIVATE_KEY",
  "CDP_API_KEY_ID", "CDP_API_KEY_SECRET", "CDP_WALLET_SECRET", "CDP_NETWORK_ID",
  "BASESCAN_API_KEY",
  "SYNTHDATA_API_KEY",
];

/** Build EnvStatus flags from resolved keys */
function buildEnvStatus(keys: EnvKeys, fileExists: boolean): EnvStatus {
  return {
    fileExists,
    hasLLMKey: !!(keys.OPENAI_API_KEY || keys.DEDALUS_API_KEY || keys.INCEPTION_API_KEY),
    hasInceptionKey: !!keys.INCEPTION_API_KEY,
    hasAlpacaKeys: !!(keys.ALPACA_API_KEY && keys.ALPACA_API_SECRET),
    hasRobinhoodKeys: !!(keys.ROBINHOOD_API_KEY && keys.ROBINHOOD_API_SECRET),
    hasWebullKeys: !!(keys.WEBULL_API_KEY && keys.WEBULL_API_SECRET),
    hasBinanceKeys: !!(keys.BINANCE_API_KEY && keys.BINANCE_API_SECRET),
    hasBinanceUSKeys: !!(keys.BINANCE_US_API_KEY && keys.BINANCE_US_API_SECRET),
    hasCoinbaseKeys: !!(keys.COINBASE_API_KEY && keys.COINBASE_API_SECRET && keys.COINBASE_PASSPHRASE),
    hasKrakenKeys: !!(keys.KRAKEN_API_KEY && keys.KRAKEN_API_SECRET),
    hasBitfinexKeys: !!(keys.BITFINEX_API_KEY && keys.BITFINEX_API_SECRET),
    hasHyperliquidKey: !!keys.HYPERLIQUID_PRIVATE_KEY,
    hasTinyfishKey: !!keys.TINYFISH_API_KEY,
    hasUniswapKey: !!keys.UNISWAP_API_KEY,
    hasGraphKey: !!keys.THEGRAPH_API_KEY,
    hasSolanaKey: !!keys.SOLANA_PRIVATE_KEY,
    hasPolkadotKey: !!(keys.POLKADOT_MNEMONIC || keys.POLKADOT_PRIVATE_KEY),
    hasChainlinkStreamsKeys: !!(keys.CHAINLINK_API_KEY && keys.CHAINLINK_API_SECRET),
    hasChainlinkCCIPKey: !!keys.EVM_PRIVATE_KEY,
    hasCDPKeys: !!(keys.CDP_API_KEY_ID && keys.CDP_API_KEY_SECRET && keys.CDP_WALLET_SECRET),
    hasBasescanKey: !!keys.BASESCAN_API_KEY,
    hasSynthDataKey: !!keys.SYNTHDATA_API_KEY,
    keys,
  };
}

/**
 * Check if .env file exists and what keys are configured
 * Checks both ~/.gordon/.env and cwd/.env
 */
export async function checkEnvStatus(): Promise<EnvStatus> {
  const envPath = findEnvFilePath();
  const fileExists = envPath !== null;

  // Parse .env file if it exists, otherwise use empty map
  const parsed: Record<string, string> = fileExists
    ? parseEnvContent(await Bun.file(envPath).text())
    : {};

  // Resolve each key: .env file value > process.env fallback
  const keys = {} as EnvKeys;
  for (const name of ENV_KEY_NAMES) {
    keys[name] = parsed[name] || process.env[name];
  }

  return buildEnvStatus(keys, fileExists);
}

/**
 * Load environment variables from .env file into process.env
 * Resolution order: process.env (shell) > keyring > .env file
 * Checks ~/.gordon/.env first, then cwd/.env
 */
export async function loadEnvFile(): Promise<void> {
  const shellEnvKeys = new Set<string>(
    ENV_KEY_NAMES.filter((name) => !!process.env[name]).map((name) => String(name))
  );

  const envPath = findEnvFilePath();
  if (envPath) {
    const file = Bun.file(envPath);
    const content = await file.text();
    const parsed = parseEnvContent(content);

    // Only set if not already in process.env (process.env takes precedence)
    for (const [key, value] of Object.entries(parsed)) {
      if (!shellEnvKeys.has(key) && !process.env[key]) {
        process.env[key] = value;
      }
    }
  }

  // Load from keyring if enabled (overrides .env but not original shell env)
  await loadKeysFromKeyring(shellEnvKeys);

  resetProviderRegistry();
}

/**
 * Load keys from OS keyring into process.env (if enabled)
 * Only overrides values that did not originate from the shell environment
 */
async function loadKeysFromKeyring(shellEnvKeys: ReadonlySet<string>): Promise<void> {
  try {
    // Read config directly to check useKeyring (avoid circular dependency)
    const configFile = Bun.file(join(GORDON_DIR, "config.json"));
    const configExists = await configFile.exists();
    if (!configExists) return;

    const config = JSON.parse(await configFile.text());
    if (!config.useKeyring) return;

    const keyring = createKeyringProvider();
    if (!(await keyring.isAvailable())) return;

    for (const key of KEYRING_SUPPORTED_KEYS) {
      if (!shellEnvKeys.has(key)) {
        const value = await keyring.get(key);
        if (value) {
          process.env[key] = value;
        }
      }
    }
  } catch {
    // Keyring failures are silent — fall back to .env
  }
}

/**
 * Store a key in the OS keyring
 */
export async function saveKeyToKeyring(key: string, value: string): Promise<void> {
  const keyring = createKeyringProvider();
  if (!(await keyring.isAvailable())) {
    throw new Error("OS keyring is not available");
  }
  await keyring.set(key, value);
}

/**
 * Ensure ~/.gordon directory exists
 */
async function ensureGordonDir(): Promise<void> {
  await mkdir(GORDON_DIR, { recursive: true });
}

/**
 * Save or update keys in .env file
 * Always writes to ~/.gordon/.env for distributed CLI usage
 */
export async function saveEnvKeys(newKeys: Partial<EnvKeys>): Promise<void> {
  await ensureGordonDir();

  let existingContent = "";
  const existingKeys: Record<string, string> = {};

  // Read existing .env if it exists (from either location)
  const envPath = findEnvFilePath();
  if (envPath) {
    const file = Bun.file(envPath);
    existingContent = await file.text();

    // Parse existing keys to preserve order and comments
    for (const line of existingContent.split("\n")) {
      const trimmed = line.trim();
      if (trimmed && !trimmed.startsWith("#")) {
        const match = trimmed.match(/^([^=]+)=/);
        if (match?.[1]) {
          existingKeys[match[1].trim()] = trimmed;
        }
      }
    }
  }

  // Update or add new keys
  const updatedKeys: Record<string, string> = { ...existingKeys };

  for (const [key, value] of Object.entries(newKeys)) {
    if (value) {
      updatedKeys[key] = formatEnvLine(key, value);
      // Also set in process.env for immediate use
      process.env[key] = value;
      if (key === "OPENAI_API_KEY" && !process.env.GORDON_NATIVE_OPENAI_API_KEY) {
        process.env.GORDON_NATIVE_OPENAI_API_KEY = value;
      }
    }
  }

  // Build new content preserving comments and empty lines
  const lines: string[] = [];
  const processedKeys = new Set<string>();

  // First, process existing content to preserve structure
  for (const line of existingContent.split("\n")) {
    const trimmed = line.trim();

    if (!trimmed || trimmed.startsWith("#")) {
      // Preserve comments and empty lines
      lines.push(line);
    } else {
      const match = trimmed.match(/^([^=]+)=/);
      if (match?.[1]) {
        const key = match[1].trim();
        if (updatedKeys[key]) {
          lines.push(updatedKeys[key]);
          processedKeys.add(key);
        }
      }
    }
  }

  // Add any new keys that weren't in the original file
  for (const [key, line] of Object.entries(updatedKeys)) {
    if (!processedKeys.has(key)) {
      // Add a blank line before new section if file had content
      if (lines.length > 0 && lines[lines.length - 1] !== "") {
        lines.push("");
      }
      lines.push(line);
    }
  }

  // Always write to ~/.gordon/.env
  await Bun.write(GORDON_ENV_PATH, lines.join("\n") + "\n");
  resetProviderRegistry();
}

/**
 * Create a new .env file with the given keys
 * Always creates in ~/.gordon/.env for distributed CLI usage
 */
export async function createEnvFile(keys: Partial<EnvKeys>): Promise<void> {
  await ensureGordonDir();

  const lines: string[] = [
    "# Gordon CLI Environment Variables",
    "# Stored in ~/.gordon/.env",
    "",
    "# LLM Provider (pick one)",
  ];

  if (keys.OPENAI_API_KEY) {
    lines.push(formatEnvLine("OPENAI_API_KEY", keys.OPENAI_API_KEY));
  } else {
    lines.push("# OPENAI_API_KEY=sk-...");
  }

  if (keys.DEDALUS_API_KEY) {
    lines.push(formatEnvLine("DEDALUS_API_KEY", keys.DEDALUS_API_KEY));
  } else {
    lines.push("# DEDALUS_API_KEY=dd-...");
  }

  if (keys.INCEPTION_API_KEY) {
    lines.push(formatEnvLine("INCEPTION_API_KEY", keys.INCEPTION_API_KEY));
  } else {
    lines.push("# INCEPTION_API_KEY=...");
  }

  lines.push("");
  lines.push("# Binance (required for trading)");

  if (keys.BINANCE_API_KEY) {
    lines.push(formatEnvLine("BINANCE_API_KEY", keys.BINANCE_API_KEY));
  } else {
    lines.push("# BINANCE_API_KEY=");
  }

  if (keys.BINANCE_API_SECRET) {
    lines.push(formatEnvLine("BINANCE_API_SECRET", keys.BINANCE_API_SECRET));
  } else {
    lines.push("# BINANCE_API_SECRET=");
  }

  lines.push("");
  lines.push("# Binance US (alternative for US users)");

  if (keys.BINANCE_US_API_KEY) {
    lines.push(formatEnvLine("BINANCE_US_API_KEY", keys.BINANCE_US_API_KEY));
  } else {
    lines.push("# BINANCE_US_API_KEY=");
  }

  if (keys.BINANCE_US_API_SECRET) {
    lines.push(formatEnvLine("BINANCE_US_API_SECRET", keys.BINANCE_US_API_SECRET));
  } else {
    lines.push("# BINANCE_US_API_SECRET=");
  }

  lines.push("");
  lines.push("# Coinbase");

  if (keys.COINBASE_API_KEY) {
    lines.push(formatEnvLine("COINBASE_API_KEY", keys.COINBASE_API_KEY));
  } else {
    lines.push("# COINBASE_API_KEY=");
  }

  if (keys.COINBASE_API_SECRET) {
    lines.push(formatEnvLine("COINBASE_API_SECRET", keys.COINBASE_API_SECRET));
  } else {
    lines.push("# COINBASE_API_SECRET=");
  }

  if (keys.COINBASE_PASSPHRASE) {
    lines.push(formatEnvLine("COINBASE_PASSPHRASE", keys.COINBASE_PASSPHRASE));
  } else {
    lines.push("# COINBASE_PASSPHRASE=");
  }

  lines.push("");
  lines.push("# Kraken");

  if (keys.KRAKEN_API_KEY) {
    lines.push(formatEnvLine("KRAKEN_API_KEY", keys.KRAKEN_API_KEY));
  } else {
    lines.push("# KRAKEN_API_KEY=");
  }

  if (keys.KRAKEN_API_SECRET) {
    lines.push(formatEnvLine("KRAKEN_API_SECRET", keys.KRAKEN_API_SECRET));
  } else {
    lines.push("# KRAKEN_API_SECRET=");
  }

  lines.push("");
  lines.push("# Bitfinex");

  if (keys.BITFINEX_API_KEY) {
    lines.push(formatEnvLine("BITFINEX_API_KEY", keys.BITFINEX_API_KEY));
  } else {
    lines.push("# BITFINEX_API_KEY=");
  }

  if (keys.BITFINEX_API_SECRET) {
    lines.push(formatEnvLine("BITFINEX_API_SECRET", keys.BITFINEX_API_SECRET));
  } else {
    lines.push("# BITFINEX_API_SECRET=");
  }

  lines.push("");
  lines.push("# Hyperliquid");

  if (keys.HYPERLIQUID_PRIVATE_KEY) {
    lines.push(formatEnvLine("HYPERLIQUID_PRIVATE_KEY", keys.HYPERLIQUID_PRIVATE_KEY));
  } else {
    lines.push("# HYPERLIQUID_PRIVATE_KEY=");
  }

  lines.push("");
  lines.push("# Tinyfish (browser-native research and automation)");

  if (keys.TINYFISH_API_KEY) {
    lines.push(formatEnvLine("TINYFISH_API_KEY", keys.TINYFISH_API_KEY));
  } else {
    lines.push("# TINYFISH_API_KEY=");
  }

  lines.push("");
  lines.push("# Uniswap");

  if (keys.UNISWAP_API_KEY) {
    lines.push(formatEnvLine("UNISWAP_API_KEY", keys.UNISWAP_API_KEY));
  } else {
    lines.push("# UNISWAP_API_KEY=");
  }

  lines.push("");
  lines.push("# The Graph (subgraph queries for DeFi protocols)");

  if (keys.THEGRAPH_API_KEY) {
    lines.push(formatEnvLine("THEGRAPH_API_KEY", keys.THEGRAPH_API_KEY));
  } else {
    lines.push("# THEGRAPH_API_KEY=");
  }

  // ---- Blockchain Network Keys ----
  lines.push("");
  lines.push("# ---- Blockchain Networks ----");

  lines.push("");
  lines.push("# Solana (DeFi, token swaps, staking, lending — 60+ tools)");
  if (keys.SOLANA_PRIVATE_KEY) {
    lines.push(formatEnvLine("SOLANA_PRIVATE_KEY", keys.SOLANA_PRIVATE_KEY));
  } else {
    lines.push("# SOLANA_PRIVATE_KEY=");
  }
  if (keys.SOLANA_RPC_URL) {
    lines.push(formatEnvLine("SOLANA_RPC_URL", keys.SOLANA_RPC_URL));
  } else {
    lines.push("# SOLANA_RPC_URL=https://api.mainnet-beta.solana.com");
  }

  lines.push("");
  lines.push("# Polkadot (cross-chain swaps, staking, governance)");
  if (keys.POLKADOT_MNEMONIC) {
    lines.push(formatEnvLine("POLKADOT_MNEMONIC", keys.POLKADOT_MNEMONIC));
  } else {
    lines.push("# POLKADOT_MNEMONIC=");
  }
  if (keys.POLKADOT_PRIVATE_KEY) {
    lines.push(formatEnvLine("POLKADOT_PRIVATE_KEY", keys.POLKADOT_PRIVATE_KEY));
  } else {
    lines.push("# POLKADOT_PRIVATE_KEY=");
  }

  lines.push("");
  lines.push("# Chainlink Data Streams (real-time institutional-grade price feeds)");
  if (keys.CHAINLINK_API_KEY) {
    lines.push(formatEnvLine("CHAINLINK_API_KEY", keys.CHAINLINK_API_KEY));
  } else {
    lines.push("# CHAINLINK_API_KEY=");
  }
  if (keys.CHAINLINK_API_SECRET) {
    lines.push(formatEnvLine("CHAINLINK_API_SECRET", keys.CHAINLINK_API_SECRET));
  } else {
    lines.push("# CHAINLINK_API_SECRET=");
  }

  lines.push("");
  lines.push("# EVM Private Key (Chainlink CCIP cross-chain bridging)");
  if (keys.EVM_PRIVATE_KEY) {
    lines.push(formatEnvLine("EVM_PRIVATE_KEY", keys.EVM_PRIVATE_KEY));
  } else {
    lines.push("# EVM_PRIVATE_KEY=0x...");
  }

  lines.push("");
  lines.push("# Coinbase CDP (Base smart wallets, onchain actions)");
  if (keys.CDP_API_KEY_ID) {
    lines.push(formatEnvLine("CDP_API_KEY_ID", keys.CDP_API_KEY_ID));
  } else {
    lines.push("# CDP_API_KEY_ID=");
  }
  if (keys.CDP_API_KEY_SECRET) {
    lines.push(formatEnvLine("CDP_API_KEY_SECRET", keys.CDP_API_KEY_SECRET));
  } else {
    lines.push("# CDP_API_KEY_SECRET=");
  }
  if (keys.CDP_WALLET_SECRET) {
    lines.push(formatEnvLine("CDP_WALLET_SECRET", keys.CDP_WALLET_SECRET));
  } else {
    lines.push("# CDP_WALLET_SECRET=");
  }
  if (keys.CDP_NETWORK_ID) {
    lines.push(formatEnvLine("CDP_NETWORK_ID", keys.CDP_NETWORK_ID));
  } else {
    lines.push("# CDP_NETWORK_ID=base-mainnet");
  }

  lines.push("");
  lines.push("# Basescan (optional — enables Base L2 whale detection, holder queries)");
  if (keys.BASESCAN_API_KEY) {
    lines.push(formatEnvLine("BASESCAN_API_KEY", keys.BASESCAN_API_KEY));
  } else {
    lines.push("# BASESCAN_API_KEY=");
  }

  // ---- Data Providers ----
  lines.push("");
  lines.push("# ---- Data Providers ----");

  lines.push("");
  lines.push("# SynthData (AI probabilistic predictions, volatility, LP optimization)");
  if (keys.SYNTHDATA_API_KEY) {
    lines.push(formatEnvLine("SYNTHDATA_API_KEY", keys.SYNTHDATA_API_KEY));
  } else {
    lines.push("# SYNTHDATA_API_KEY=");
  }

  // ---- Gordon LLM Provider ----
  lines.push("");
  lines.push("# ---- Gordon LLM Provider ----");

  if (keys.GORDON_PROVIDER) {
    lines.push(formatEnvLine("GORDON_PROVIDER", keys.GORDON_PROVIDER));
  } else {
    lines.push("# GORDON_PROVIDER=openai");
  }
  if (keys.GORDON_MODEL) {
    lines.push(formatEnvLine("GORDON_MODEL", keys.GORDON_MODEL));
  } else {
    lines.push("# GORDON_MODEL=openai/gpt-5.2");
  }

  // Always write to ~/.gordon/.env
  await Bun.write(GORDON_ENV_PATH, lines.join("\n") + "\n");

  // Also set in process.env for immediate use
  for (const [key, value] of Object.entries(keys)) {
    if (value) {
      process.env[key] = value;
      if (key === "OPENAI_API_KEY" && !process.env.GORDON_NATIVE_OPENAI_API_KEY) {
        process.env.GORDON_NATIVE_OPENAI_API_KEY = value;
      }
    }
  }

  resetProviderRegistry();
}

/**
 * Validate environment keys and return detailed validation result
 */
export async function validateEnv(): Promise<ValidationResult> {
  const status = await checkEnvStatus();
  return validateEnvKeys(status.keys as Record<string, string | undefined>);
}

/**
 * Check if environment is properly configured for trading
 */
export async function isReadyForTrading(): Promise<{ ready: boolean; reason?: string }> {
  const validation = await validateEnv();

  if (!validation.valid) {
    return {
      ready: false,
      reason: formatValidationResult(validation),
    };
  }

  if (!validation.keys.BINANCE_API_KEY || !validation.keys.BINANCE_API_SECRET) {
    return {
      ready: false,
      reason: "Binance API credentials not configured",
    };
  }

  return { ready: true };
}

/**
 * Check if environment is properly configured for LLM
 */
export async function isReadyForLLM(): Promise<{ ready: boolean; reason?: string }> {
  const validation = await validateEnv();

  if (!validation.keys.OPENAI_API_KEY && !validation.keys.DEDALUS_API_KEY && !validation.keys.INCEPTION_API_KEY) {
    return {
      ready: false,
      reason: "No LLM API key configured. Set OPENAI_API_KEY, INCEPTION_API_KEY, or DEDALUS_API_KEY.",
    };
  }

  return { ready: true };
}

// Export paths for external use
export { GORDON_ENV_PATH as ENV_FILE_PATH, GORDON_DIR };

// Re-export validation utilities
export {
  validateEnvKeys,
  sanitizeKeyValue,
  isPlaceholderKey,
  formatValidationResult,
  type ValidationResult,
} from "./env-validation.ts";
