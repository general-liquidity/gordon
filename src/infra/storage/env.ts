/**
 * Environment file detection and management
 * Handles .env file reading, writing, and key detection
 */

import { existsSync } from "node:fs";
import { join } from "node:path";

const ENV_FILE_PATH = join(process.cwd(), ".env");

export interface EnvKeys {
  OPENAI_API_KEY?: string;
  DEDALUS_API_KEY?: string;
  BINANCE_API_KEY?: string;
  BINANCE_API_SECRET?: string;
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
 * Check if .env file exists and what keys are configured
 */
export async function checkEnvStatus(): Promise<EnvStatus> {
  const fileExists = existsSync(ENV_FILE_PATH);

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
  const file = Bun.file(ENV_FILE_PATH);
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
 */
export async function loadEnvFile(): Promise<void> {
  if (!existsSync(ENV_FILE_PATH)) {
    return;
  }

  const file = Bun.file(ENV_FILE_PATH);
  const content = await file.text();
  const parsed = parseEnvContent(content);

  // Only set if not already in process.env (process.env takes precedence)
  for (const [key, value] of Object.entries(parsed)) {
    if (!process.env[key]) {
      process.env[key] = value;
    }
  }
}

/**
 * Save or update keys in .env file
 */
export async function saveEnvKeys(newKeys: Partial<EnvKeys>): Promise<void> {
  let existingContent = "";
  const existingKeys: Record<string, string> = {};

  // Read existing .env if it exists
  if (existsSync(ENV_FILE_PATH)) {
    const file = Bun.file(ENV_FILE_PATH);
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

  // Write updated content
  await Bun.write(ENV_FILE_PATH, lines.join("\n") + "\n");
}

/**
 * Create a new .env file with the given keys
 */
export async function createEnvFile(keys: Partial<EnvKeys>): Promise<void> {
  const lines: string[] = [
    "# Gordon CLI Environment Variables",
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

  await Bun.write(ENV_FILE_PATH, lines.join("\n") + "\n");

  // Also set in process.env for immediate use
  for (const [key, value] of Object.entries(keys)) {
    if (value) {
      process.env[key] = value;
    }
  }
}

export { ENV_FILE_PATH };
