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
  | "toggleTradeQueue"
  | "toggleSafetyDashboard"
  | "focusRadar"
  | "openPager"
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

export interface KeybindingConflict {
  /** Normalized key combo, e.g. "ctrl+shift+s". */
  key: string;
  /** The overlapping activation scopes. */
  when: string;
  /** All conflicting actions in resolution order. */
  actions: BindableAction[];
  /** The first action in resolution order. */
  winner: BindableAction;
}

// ============================================================================
// Defaults
// ============================================================================

export const DEFAULT_BINDINGS: KeyBinding[] = [
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
  { key: "ctrl+t", action: "toggleTradeQueue" },
  { key: "ctrl+shift+d", action: "toggleSafetyDashboard" },
  { key: "ctrl+g", action: "focusRadar" },
  { key: "ctrl+o", action: "openPager" },

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

export function validateKeybindings(
  bindings: KeyBinding[] = getResolvedBindings(),
): KeybindingConflict[] {
  const groups = new Map<string, Array<{ binding: KeyBinding; index: number; scope: NonNullable<KeyBinding["when"]> }>>();

  bindings.forEach((binding, index) => {
    const key = normalizeBindingKey(binding);
    const scope = binding.when ?? "always";
    const group = groups.get(key) ?? [];
    group.push({ binding, index, scope });
    groups.set(key, group);
  });

  const conflicts: KeybindingConflict[] = [];
  for (const [key, group] of groups.entries()) {
    const edges = new Map<number, Set<number>>();
    const visited = new Set<number>();

    for (let i = 0; i < group.length; i++) edges.set(i, new Set());

    for (let i = 0; i < group.length; i++) {
      for (let j = i + 1; j < group.length; j++) {
        const left = group[i]!;
        const right = group[j]!;
        if (left.binding.action === right.binding.action) continue;
        if (!scopesIntersect(left.scope, right.scope)) continue;
        edges.get(i)!.add(j);
        edges.get(j)!.add(i);
      }
    }

    for (let i = 0; i < group.length; i++) {
      if (visited.has(i) || (edges.get(i)?.size ?? 0) === 0) continue;

      const component: number[] = [];
      const stack = [i];
      visited.add(i);

      while (stack.length > 0) {
        const next = stack.pop()!;
        component.push(next);
        for (const neighbor of edges.get(next) ?? []) {
          if (visited.has(neighbor)) continue;
          visited.add(neighbor);
          stack.push(neighbor);
        }
      }

      const ordered = component
        .map((componentIndex) => group[componentIndex]!)
        .sort((a, b) => a.index - b.index);
      const actions = uniqueActions(ordered.map((entry) => entry.binding.action));
      if (actions.length < 2) continue;

      conflicts.push({
        key,
        when: Array.from(new Set(ordered.map((entry) => entry.scope))).join(","),
        actions,
        winner: actions[0]!,
      });
    }
  }

  return conflicts;
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

const MODIFIER_ORDER = ["ctrl", "shift", "alt", "meta"] as const;
const MODIFIER_ALIASES: Record<string, string> = {
  control: "ctrl",
  option: "alt",
  cmd: "meta",
  command: "meta",
};

function normalizeBindingKey(binding: KeyBinding): string {
  const primary = normalizeKeyCombo(binding.key);
  if (!binding.chord) return primary;
  return `${primary} ${normalizeKeyCombo(binding.chord)}`;
}

function normalizeKeyCombo(key: string): string {
  const rawParts = key.split("+").map((part) => part.trim()).filter(Boolean);
  const modifiers = new Set<string>();
  let base = "";

  for (const rawPart of rawParts) {
    const canonical = MODIFIER_ALIASES[rawPart.toLowerCase()] ?? rawPart.toLowerCase();
    if ((MODIFIER_ORDER as readonly string[]).includes(canonical)) {
      modifiers.add(canonical);
      continue;
    }
    if (/^[A-Z]$/.test(rawPart)) modifiers.add("shift");
    base = canonical;
  }

  const orderedModifiers = MODIFIER_ORDER.filter((modifier) => modifiers.has(modifier));
  return [...orderedModifiers, base].filter(Boolean).join("+");
}

function scopesIntersect(
  left: NonNullable<KeyBinding["when"]>,
  right: NonNullable<KeyBinding["when"]>,
): boolean {
  return left === "always" || right === "always" || left === right;
}

function uniqueActions(actions: BindableAction[]): BindableAction[] {
  const seen = new Set<BindableAction>();
  const unique: BindableAction[] = [];
  for (const action of actions) {
    if (seen.has(action)) continue;
    seen.add(action);
    unique.push(action);
  }
  return unique;
}
