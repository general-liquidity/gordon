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
  formatValidationResult,
  type ValidationResult,
} from "./env-validation.ts";
import { createKeyringProvider, KEYRING_SUPPORTED_KEYS } from "../keyring.ts";
import { GORDON_DIR } from "../paths.ts";
import { resetProviderRegistry } from "../../runtime/providers/index.ts";
import { assertRuntimeEnvProvenance } from "./runtimeEnvProvenance.ts";
import { isAllowedCwdEnvKey } from "./envTrustPolicy.ts";
const GORDON_ENV_PATH = join(GORDON_DIR, ".env");

// Secondary location: current working directory (for development)
const CWD_ENV_PATH = join(process.cwd(), ".env");

// We write to GORDON_ENV_PATH but read from both
const _ENV_FILE_PATH = GORDON_ENV_PATH;

export interface EnvKeys {
  ANTHROPIC_API_KEY?: string;
  OPENAI_API_KEY?: string;
  GOOGLE_GENERATIVE_AI_API_KEY?: string;
  XAI_API_KEY?: string;
  OPENROUTER_API_KEY?: string;
  HF_TOKEN?: string;
  TOGETHER_API_KEY?: string;
  FIREWORKS_API_KEY?: string;
  SILICONFLOW_API_KEY?: string;
  DEEPINFRA_API_KEY?: string;
  GORDON_LOCAL_MODEL_URL?: string;
  GORDON_LOCAL_MODEL_API_KEY?: string;
  ALPACA_API_KEY?: string;
  ALPACA_API_SECRET?: string;
  ALPACA_PAPER?: string;
  TASTYTRADE_API_KEY?: string;
  TASTYTRADE_API_SECRET?: string;
  TASTYTRADE_PAPER?: string;
  TASTYTRADE_ACCOUNT_ID?: string;
  IBKR_API_KEY?: string;
  IBKR_API_SECRET?: string;
  IBKR_PAPER?: string;
  IBKR_ACCOUNT_ID?: string;
  ROBINHOOD_API_KEY?: string;
  ROBINHOOD_API_SECRET?: string;
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
  // Onchain data sources (read-only)
  BIRDEYE_API_KEY?: string;
  CODEX_API_KEY?: string;
  DEFINED_API_KEY?: string;
  ONEINCH_API_KEY?: string;
  COINGECKO_API_KEY?: string;
  // Wallet intelligence (read-only)
  NANSEN_API_KEY?: string;
  MORALIS_API_KEY?: string;
  ARKHAM_API_KEY?: string;
  DEBANK_ACCESS_KEY?: string;
  ZERION_API_KEY?: string;
  GOLDRUSH_API_KEY?: string;
  COVALENT_API_KEY?: string;
  GORDON_PROVIDER?: string;
  GORDON_MODEL?: string;
  SYNTHDATA_API_KEY?: string;
}

export interface EnvStatus {
  fileExists: boolean;
  hasLLMKey: boolean;
  hasAlpacaKeys: boolean;
  hasRobinhoodKeys: boolean;
  hasBinanceKeys: boolean;
  hasBinanceUSKeys: boolean;
  hasCoinbaseKeys: boolean;
  hasKrakenKeys: boolean;
  hasBitfinexKeys: boolean;
  hasHyperliquidKey: boolean;
  hasOnchainDataKey: boolean;
  hasWalletIntelKey: boolean;
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
  "ANTHROPIC_API_KEY",
  "OPENAI_API_KEY",
  "GOOGLE_GENERATIVE_AI_API_KEY",
  "XAI_API_KEY",
  "OPENROUTER_API_KEY",
  "HF_TOKEN",
  "TOGETHER_API_KEY",
  "FIREWORKS_API_KEY",
  "SILICONFLOW_API_KEY",
  "DEEPINFRA_API_KEY",
  "GORDON_LOCAL_MODEL_URL",
  "GORDON_LOCAL_MODEL_API_KEY",
  "ALPACA_API_KEY",
  "ALPACA_API_SECRET",
  "ALPACA_PAPER",
  "TASTYTRADE_API_KEY",
  "TASTYTRADE_API_SECRET",
  "TASTYTRADE_PAPER",
  "TASTYTRADE_ACCOUNT_ID",
  "IBKR_API_KEY",
  "IBKR_API_SECRET",
  "IBKR_PAPER",
  "IBKR_ACCOUNT_ID",
  "ROBINHOOD_API_KEY",
  "ROBINHOOD_API_SECRET",
  "BINANCE_API_KEY",
  "BINANCE_API_SECRET",
  "BINANCE_US_API_KEY",
  "BINANCE_US_API_SECRET",
  "COINBASE_API_KEY",
  "COINBASE_API_SECRET",
  "COINBASE_PASSPHRASE",
  "KRAKEN_API_KEY",
  "KRAKEN_API_SECRET",
  "BITFINEX_API_KEY",
  "BITFINEX_API_SECRET",
  "HYPERLIQUID_PRIVATE_KEY",
  "GORDON_PROVIDER",
  "GORDON_MODEL",
  "BIRDEYE_API_KEY",
  "CODEX_API_KEY",
  "DEFINED_API_KEY",
  "ONEINCH_API_KEY",
  "COINGECKO_API_KEY",
  "NANSEN_API_KEY",
  "MORALIS_API_KEY",
  "ARKHAM_API_KEY",
  "DEBANK_ACCESS_KEY",
  "ZERION_API_KEY",
  "GOLDRUSH_API_KEY",
  "COVALENT_API_KEY",
  "SYNTHDATA_API_KEY",
];

/** Build EnvStatus flags from resolved keys */
function buildEnvStatus(keys: EnvKeys, fileExists: boolean): EnvStatus {
  return {
    fileExists,
    hasLLMKey: !!(
      keys.ANTHROPIC_API_KEY ||
      keys.OPENAI_API_KEY ||
      keys.GOOGLE_GENERATIVE_AI_API_KEY ||
      keys.XAI_API_KEY ||
      keys.OPENROUTER_API_KEY ||
      keys.HF_TOKEN ||
      keys.TOGETHER_API_KEY ||
      keys.FIREWORKS_API_KEY ||
      keys.SILICONFLOW_API_KEY ||
      keys.DEEPINFRA_API_KEY ||
      keys.GORDON_LOCAL_MODEL_URL
    ),
    hasAlpacaKeys: !!(keys.ALPACA_API_KEY && keys.ALPACA_API_SECRET),
    hasRobinhoodKeys: !!(keys.ROBINHOOD_API_KEY && keys.ROBINHOOD_API_SECRET),
    hasBinanceKeys: !!(keys.BINANCE_API_KEY && keys.BINANCE_API_SECRET),
    hasBinanceUSKeys: !!(keys.BINANCE_US_API_KEY && keys.BINANCE_US_API_SECRET),
    hasCoinbaseKeys: !!(
      keys.COINBASE_API_KEY &&
      keys.COINBASE_API_SECRET &&
      keys.COINBASE_PASSPHRASE
    ),
    hasKrakenKeys: !!(keys.KRAKEN_API_KEY && keys.KRAKEN_API_SECRET),
    hasBitfinexKeys: !!(keys.BITFINEX_API_KEY && keys.BITFINEX_API_SECRET),
    hasHyperliquidKey: !!keys.HYPERLIQUID_PRIVATE_KEY,
    hasOnchainDataKey: !!(
      keys.BIRDEYE_API_KEY ||
      keys.CODEX_API_KEY ||
      keys.DEFINED_API_KEY ||
      keys.ONEINCH_API_KEY ||
      keys.COINGECKO_API_KEY
    ),
    hasWalletIntelKey: !!(
      keys.NANSEN_API_KEY ||
      keys.MORALIS_API_KEY ||
      keys.ARKHAM_API_KEY ||
      keys.DEBANK_ACCESS_KEY ||
      keys.ZERION_API_KEY ||
      keys.GOLDRUSH_API_KEY ||
      keys.COVALENT_API_KEY
    ),
    hasSynthDataKey: !!keys.SYNTHDATA_API_KEY,
    keys,
  };
}

/**
 * Check if .env file exists and what keys are configured
 * Checks both ~/.gordon/.env and cwd/.env
 */
export async function checkEnvStatus(): Promise<EnvStatus> {
  assertRuntimeEnvProvenance();
  const envPath = findEnvFilePath();
  const fileExists = envPath !== null;

  // Parse .env file if it exists, otherwise use empty map
  const parsed: Record<string, string> = fileExists
    ? Object.fromEntries(
        Object.entries(parseEnvContent(await Bun.file(envPath).text())).filter(
          ([name]) => envPath !== CWD_ENV_PATH || isAllowedCwdEnvKey(name),
        ),
      )
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
  assertRuntimeEnvProvenance();
  const shellEnvKeys = new Set<string>(
    ENV_KEY_NAMES.filter((name) => !!process.env[name]).map((name) => String(name)),
  );

  const envPath = findEnvFilePath();
  if (envPath) {
    const file = Bun.file(envPath);
    const content = await file.text();
    const parsed = parseEnvContent(content);
    const fromCwd = envPath === CWD_ENV_PATH;

    // Only set if not already in process.env (process.env takes precedence)
    for (const [key, value] of Object.entries(parsed)) {
      if (fromCwd && !isAllowedCwdEnvKey(key)) continue;
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

  // Only the operator-owned file is preservation input. Reading cwd/.env here
  // would promote repository content into ~/.gordon/.env when setup saved an
  // unrelated key, bypassing the source-aware read policy permanently.
  if (existsSync(GORDON_ENV_PATH)) {
    const file = Bun.file(GORDON_ENV_PATH);
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
  await Bun.write(GORDON_ENV_PATH, `${lines.join("\n")}\n`);
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

  if (keys.ANTHROPIC_API_KEY) {
    lines.push(formatEnvLine("ANTHROPIC_API_KEY", keys.ANTHROPIC_API_KEY));
  } else {
    lines.push("# ANTHROPIC_API_KEY=sk-ant-...");
  }

  if (keys.OPENAI_API_KEY) {
    lines.push(formatEnvLine("OPENAI_API_KEY", keys.OPENAI_API_KEY));
  } else {
    lines.push("# OPENAI_API_KEY=sk-...");
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
  lines.push("# ---- Onchain data (read-only; DexScreener/DefiLlama work keyless) ----");
  for (const [key, comment] of [
    ["BIRDEYE_API_KEY", "Birdeye multichain OHLCV"],
    ["CODEX_API_KEY", "Codex / Defined.fi onchain charts"],
    ["DEFINED_API_KEY", "Alias for Codex API key"],
    ["ONEINCH_API_KEY", "1inch onchain charts"],
    ["COINGECKO_API_KEY", "CoinGecko onchain pool OHLCV (optional)"],
  ] as const) {
    const val = keys[key as keyof EnvKeys];
    if (val) lines.push(formatEnvLine(key, val));
    else lines.push(`# ${key}=  # ${comment}`);
  }

  lines.push("");
  lines.push("# ---- Wallet intelligence (read-only address/portfolio data) ----");
  for (const [key, comment] of [
    ["NANSEN_API_KEY", "Nansen smart-money labels + flows"],
    ["ARKHAM_API_KEY", "Arkham entity labels"],
    ["MORALIS_API_KEY", "Moralis wallet balances + history"],
    ["DEBANK_ACCESS_KEY", "DeBank portfolio snapshots"],
    ["ZERION_API_KEY", "Zerion portfolio API"],
    ["GOLDRUSH_API_KEY", "Covalent/GoldRush token holders + balances"],
    ["COVALENT_API_KEY", "Alias for GoldRush API key"],
  ] as const) {
    const val = keys[key as keyof EnvKeys];
    if (val) lines.push(formatEnvLine(key, val));
    else lines.push(`# ${key}=  # ${comment}`);
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
    lines.push("# GORDON_MODEL=anthropic/claude-opus-4-8");
  }

  // Always write to ~/.gordon/.env
  await Bun.write(GORDON_ENV_PATH, `${lines.join("\n")}\n`);

  // Also set in process.env for immediate use
  for (const [key, value] of Object.entries(keys)) {
    if (value) {
      process.env[key] = value;
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

  const status = validation.keys as EnvKeys;
  const hasAnyLLMKey = !!(
    status.ANTHROPIC_API_KEY ||
    status.OPENAI_API_KEY ||
    status.GOOGLE_GENERATIVE_AI_API_KEY ||
    status.XAI_API_KEY ||
    status.OPENROUTER_API_KEY ||
    status.HF_TOKEN ||
    status.TOGETHER_API_KEY ||
    status.FIREWORKS_API_KEY ||
    status.SILICONFLOW_API_KEY ||
    status.DEEPINFRA_API_KEY ||
    status.GORDON_LOCAL_MODEL_URL
  );
  if (!hasAnyLLMKey) {
    return {
      ready: false,
      reason:
        "No LLM API key configured. Set ANTHROPIC_API_KEY (or OPENAI_API_KEY / another provider key).",
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
