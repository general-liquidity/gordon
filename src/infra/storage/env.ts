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
const GORDON_ENV_PATH = join(GORDON_DIR, ".env");

// Secondary location: current working directory (for development)
const CWD_ENV_PATH = join(process.cwd(), ".env");

// We write to GORDON_ENV_PATH but read from both
const ENV_FILE_PATH = GORDON_ENV_PATH;

export interface EnvKeys {
  OPENAI_API_KEY?: string;
  DEDALUS_API_KEY?: string;
  BINANCE_API_KEY?: string;
  BINANCE_API_SECRET?: string;
  GORDON_PROVIDER?: string;
  GORDON_MODEL?: string;
}

export interface EnvStatus {
  fileExists: boolean;
  hasLLMKey: boolean;
  hasBinanceKeys: boolean;
  keys: EnvKeys;
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

      // Remove surrounding quotes
      if ((value.startsWith("'") && value.endsWith("'")) ||
          (value.startsWith('"') && value.endsWith('"'))) {
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

/**
 * Check if .env file exists and what keys are configured
 * Checks both ~/.gordon/.env and cwd/.env
 */
export async function checkEnvStatus(): Promise<EnvStatus> {
  const envPath = findEnvFilePath();
  const fileExists = envPath !== null;

  if (!fileExists) {
    // Check environment variables directly
    const keys: EnvKeys = {
      OPENAI_API_KEY: process.env.OPENAI_API_KEY,
      DEDALUS_API_KEY: process.env.DEDALUS_API_KEY,
      BINANCE_API_KEY: process.env.BINANCE_API_KEY,
      BINANCE_API_SECRET: process.env.BINANCE_API_SECRET,
    };

    return {
      fileExists: false,
      hasLLMKey: !!(keys.OPENAI_API_KEY || keys.DEDALUS_API_KEY),
      hasBinanceKeys: !!(keys.BINANCE_API_KEY && keys.BINANCE_API_SECRET),
      keys,
    };
  }

  // Read and parse .env file
  const file = Bun.file(envPath);
  const content = await file.text();
  const parsed = parseEnvContent(content);

  const keys: EnvKeys = {
    OPENAI_API_KEY: parsed.OPENAI_API_KEY || process.env.OPENAI_API_KEY,
    DEDALUS_API_KEY: parsed.DEDALUS_API_KEY || process.env.DEDALUS_API_KEY,
    BINANCE_API_KEY: parsed.BINANCE_API_KEY || process.env.BINANCE_API_KEY,
    BINANCE_API_SECRET: parsed.BINANCE_API_SECRET || process.env.BINANCE_API_SECRET,
  };

  return {
    fileExists: true,
    hasLLMKey: !!(keys.OPENAI_API_KEY || keys.DEDALUS_API_KEY),
    hasBinanceKeys: !!(keys.BINANCE_API_KEY && keys.BINANCE_API_SECRET),
    keys,
  };
}

/**
 * Load environment variables from .env file into process.env
 * Resolution order: process.env (shell) > keyring > .env file
 * Checks ~/.gordon/.env first, then cwd/.env
 */
export async function loadEnvFile(): Promise<void> {
  const envPath = findEnvFilePath();
  if (envPath) {
    const file = Bun.file(envPath);
    const content = await file.text();
    const parsed = parseEnvContent(content);

    // Only set if not already in process.env (process.env takes precedence)
    for (const [key, value] of Object.entries(parsed)) {
      if (!process.env[key]) {
        process.env[key] = value;
      }
    }
  }

  // Load from keyring if enabled (overrides .env but not process.env)
  await loadKeysFromKeyring();
}

/**
 * Load keys from OS keyring into process.env (if enabled)
 * Only sets keys not already present in process.env
 */
async function loadKeysFromKeyring(): Promise<void> {
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
      if (!process.env[key]) {
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
      updatedKeys[key] = `${key}='${value}'`;
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
  await Bun.write(GORDON_ENV_PATH, lines.join("\n") + "\n");
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
    lines.push(`OPENAI_API_KEY='${keys.OPENAI_API_KEY}'`);
  } else {
    lines.push("# OPENAI_API_KEY=sk-...");
  }

  if (keys.DEDALUS_API_KEY) {
    lines.push(`DEDALUS_API_KEY='${keys.DEDALUS_API_KEY}'`);
  } else {
    lines.push("# DEDALUS_API_KEY=dd-...");
  }

  lines.push("");
  lines.push("# Binance (required for trading)");

  if (keys.BINANCE_API_KEY) {
    lines.push(`BINANCE_API_KEY='${keys.BINANCE_API_KEY}'`);
  } else {
    lines.push("# BINANCE_API_KEY=");
  }

  if (keys.BINANCE_API_SECRET) {
    lines.push(`BINANCE_API_SECRET='${keys.BINANCE_API_SECRET}'`);
  } else {
    lines.push("# BINANCE_API_SECRET=");
  }

  // Always write to ~/.gordon/.env
  await Bun.write(GORDON_ENV_PATH, lines.join("\n") + "\n");

  // Also set in process.env for immediate use
  for (const [key, value] of Object.entries(keys)) {
    if (value) {
      process.env[key] = value;
    }
  }
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

  if (!validation.keys.OPENAI_API_KEY && !validation.keys.DEDALUS_API_KEY) {
    return {
      ready: false,
      reason: "No LLM API key configured. Set OPENAI_API_KEY or DEDALUS_API_KEY.",
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
