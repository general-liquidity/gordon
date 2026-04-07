/**
 * Keybinding Customization System
 *
 * Load custom keybindings from ~/.gordon/keybindings.json.
 * Supports Vim mode toggle, chord bindings, and per-action key mapping.
 *
 * Claude Code pattern: Full keybinding customization with:
 *   - Default bindings (hardcoded)
 *   - User overrides (~/.gordon/keybindings.json)
 *   - Vim mode (toggle with :vim / :novm)
 *   - Chord support (e.g., ctrl+k ctrl+c for comment)
 *
 * Integration: TUI App.tsx reads bindings via `getBinding(action)` and uses
 * Ink's `useInput` to match keypress → action dispatch.
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { GORDON_DIR } from "../../infra/storage/paths.ts";

// ============================================================================
// Types
// ============================================================================

/** Actions that can be bound to keys. */
export type BindableAction =
  // Navigation
  | "submit"
  | "cancel"
  | "scrollUp"
  | "scrollDown"
  | "scrollTop"
  | "scrollBottom"
  | "pageUp"
  | "pageDown"
  // Panels
  | "togglePalette"
  | "toggleSettings"
  | "toggleExport"
  | "toggleEmergencyHalt"
  | "toggleContextView"
  | "togglePrivacy"
  // Trading
  | "quickApprove"
  | "quickDeny"
  | "toggleAutoMode"
  | "toggleStrictMode"
  // Session
  | "newSession"
  | "interruptStream"
  | "clearInput"
  | "exit"
  // Vim
  | "vimEscape"
  | "vimInsert"
  | "vimCommand";

export interface KeyBinding {
  /** Key combination (e.g., "ctrl+p", "escape", "ctrl+shift+x"). */
  key: string;
  /** Optional second key for chord binding (e.g., "ctrl+k" then "ctrl+c"). */
  chord?: string;
  /** Action to trigger. */
  action: BindableAction;
  /** When to activate (always, normalMode, insertMode). Default "always". */
  when?: "always" | "normalMode" | "insertMode";
}

export interface KeybindingsConfig {
  /** Enable Vim-style normal/insert mode. Default false. */
  vimMode?: boolean;
  /** Custom bindings (merged over defaults). */
  bindings?: KeyBinding[];
}

// ============================================================================
// Defaults
// ============================================================================

const DEFAULT_BINDINGS: KeyBinding[] = [
  // Core
  { key: "return", action: "submit" },
  { key: "escape", action: "cancel" },
  { key: "ctrl+c", action: "interruptStream" },

  // Navigation
  { key: "pageup", action: "pageUp" },
  { key: "pagedown", action: "pageDown" },
  { key: "ctrl+home", action: "scrollTop" },
  { key: "ctrl+end", action: "scrollBottom" },

  // Panels
  { key: "ctrl+p", action: "togglePalette" },
  { key: "ctrl+,", action: "toggleSettings" },
  { key: "ctrl+e", action: "toggleExport" },
  { key: "ctrl+shift+x", action: "toggleEmergencyHalt" },
  { key: "ctrl+shift+v", action: "toggleContextView" },
  { key: "ctrl+shift+p", action: "togglePrivacy" },

  // Trading shortcuts
  { key: "ctrl+y", action: "quickApprove" },
  { key: "ctrl+n", action: "quickDeny" },
  { key: "ctrl+shift+a", action: "toggleAutoMode" },
  { key: "ctrl+shift+s", action: "toggleStrictMode" },

  // Session
  { key: "ctrl+shift+n", action: "newSession" },
  { key: "ctrl+l", action: "clearInput" },

  // Vim mode bindings (only active in vim mode)
  { key: "escape", action: "vimEscape", when: "insertMode" },
  { key: "i", action: "vimInsert", when: "normalMode" },
  { key: ":", action: "vimCommand", when: "normalMode" },
  { key: "j", action: "scrollDown", when: "normalMode" },
  { key: "k", action: "scrollUp", when: "normalMode" },
  { key: "G", action: "scrollBottom", when: "normalMode" },
  { key: "g", action: "scrollTop", when: "normalMode" },
];

// ============================================================================
// Loading
// ============================================================================

const KEYBINDINGS_FILE = join(GORDON_DIR, "keybindings.json");

export function loadKeybindingsConfig(): KeybindingsConfig {
  if (!existsSync(KEYBINDINGS_FILE)) return {};
  try {
    return JSON.parse(readFileSync(KEYBINDINGS_FILE, "utf-8")) as KeybindingsConfig;
  } catch {
    return {};
  }
}

export function saveKeybindingsConfig(config: KeybindingsConfig): void {
  if (!existsSync(GORDON_DIR)) mkdirSync(GORDON_DIR, { recursive: true });
  writeFileSync(KEYBINDINGS_FILE, JSON.stringify(config, null, 2), "utf-8");
}

// ============================================================================
// Resolution
// ============================================================================

let cachedBindings: KeyBinding[] | null = null;
let cachedVimMode: boolean = false;

/**
 * Get the resolved keybinding for an action. User overrides take precedence
 * over defaults.
 */
export function getBinding(action: BindableAction): KeyBinding | undefined {
  return getResolvedBindings().find((b) => b.action === action);
}

/**
 * Get all bindings for a key combo (may match multiple if vim/non-vim differ).
 */
export function getActionsForKey(key: string, mode: "normalMode" | "insertMode" | "always" = "always"): BindableAction[] {
  return getResolvedBindings()
    .filter((b) => {
      if (b.key !== key) return false;
      if (!b.when || b.when === "always") return true;
      if (b.when === mode) return true;
      if (mode === "always") return true;
      return false;
    })
    .map((b) => b.action);
}

/**
 * Get all resolved bindings (defaults + user overrides merged).
 */
export function getResolvedBindings(): KeyBinding[] {
  if (cachedBindings) return cachedBindings;

  const userConfig = loadKeybindingsConfig();
  cachedVimMode = userConfig.vimMode ?? false;
  const userBindings = userConfig.bindings ?? [];

  // User bindings override defaults by action
  const overriddenActions = new Set(userBindings.map((b) => b.action));
  const base = DEFAULT_BINDINGS.filter((b) => !overriddenActions.has(b.action));

  cachedBindings = [...base, ...userBindings];
  return cachedBindings;
}

/**
 * Check if Vim mode is enabled.
 */
export function isVimModeEnabled(): boolean {
  if (cachedBindings === null) getResolvedBindings();
  return cachedVimMode;
}

/**
 * Invalidate keybinding cache (call after settings change).
 */
export function invalidateKeybindingCache(): void {
  cachedBindings = null;
  cachedVimMode = false;
}

/**
 * Generate a human-readable keybinding reference for /help or UI display.
 */
export function formatKeybindingHelp(): string {
  const bindings = getResolvedBindings();
  const lines: string[] = ["Keybindings:", ""];

  const groups: Record<string, KeyBinding[]> = {};
  for (const b of bindings) {
    const group = b.when === "normalMode" ? "Vim Normal Mode"
      : b.when === "insertMode" ? "Vim Insert Mode"
      : "Global";
    (groups[group] ??= []).push(b);
  }

  for (const [group, binds] of Object.entries(groups)) {
    lines.push(`  ${group}:`);
    for (const b of binds) {
      const key = b.chord ? `${b.key} ${b.chord}` : b.key;
      lines.push(`    ${key.padEnd(20)} ${b.action}`);
    }
    lines.push("");
  }

  return lines.join("\n");
}
