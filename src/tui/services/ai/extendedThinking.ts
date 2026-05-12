// ============================================================================
// Extended Thinking — Configurable thinking budget for deep analysis mode
// ============================================================================
// /thinking on|off|budget <tokens>

import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

// ============================================================================
// Types
// ============================================================================

export interface ThinkingConfig {
  enabled: boolean;
  budgetTokens: number;
  showThinkingBlocks: boolean;
}

// ============================================================================
// State
// ============================================================================

const SETTINGS_DIR = path.join(os.homedir(), ".gordon");
const THINKING_PATH = path.join(SETTINGS_DIR, "thinking.json");

const DEFAULT_CONFIG: ThinkingConfig = {
  enabled: false,
  budgetTokens: 10_000,
  showThinkingBlocks: true,
};

let config: ThinkingConfig = loadConfig();

// ============================================================================
// Persistence helpers
// ============================================================================

function loadConfig(): ThinkingConfig {
  try {
    if (fs.existsSync(THINKING_PATH)) {
      const raw = fs.readFileSync(THINKING_PATH, "utf-8");
      const parsed = JSON.parse(raw) as Partial<ThinkingConfig>;
      return { ...DEFAULT_CONFIG, ...parsed };
    }
  } catch {
    // Corrupt or unreadable — fall back to defaults
  }
  return { ...DEFAULT_CONFIG };
}

function persistConfig(): void {
  try {
    if (!fs.existsSync(SETTINGS_DIR)) {
      fs.mkdirSync(SETTINGS_DIR, { recursive: true });
    }
    fs.writeFileSync(THINKING_PATH, JSON.stringify(config, null, 2), "utf-8");
  } catch {
    // Silently fail — settings are best-effort
  }
}

// ============================================================================
// Public API
// ============================================================================

export function getThinkingConfig(): ThinkingConfig {
  return { ...config };
}

export function setThinkingEnabled(enabled: boolean): void {
  config.enabled = enabled;
  persistConfig();
}

export function setThinkingBudget(tokens: number): void {
  config.budgetTokens = Math.max(1000, Math.min(tokens, 128_000));
  persistConfig();
}

export function setShowThinkingBlocks(show: boolean): void {
  config.showThinkingBlocks = show;
  persistConfig();
}

export function isThinkingEnabled(): boolean {
  return config.enabled;
}

export function getThinkingBudget(): number {
  return config.budgetTokens;
}

/**
 * Returns the thinking parameters to include in an LLM request
 * when extended thinking is enabled. Returns null when disabled.
 */
export function getThinkingRequestParams(): { thinking: { type: "enabled"; budget_tokens: number } } | null {
  if (!config.enabled) return null;
  return { thinking: { type: "enabled", budget_tokens: config.budgetTokens } };
}
