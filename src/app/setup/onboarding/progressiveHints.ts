/**
 * Progressive Inline Hints
 *
 * Show contextual tips in the first few sessions (max N times), then hide.
 * Claude Code pattern: project onboarding steps shown max 4 times.
 *
 * Each hint has an ID and a max-show count. The hint system tracks how
 * many times each hint has been displayed and suppresses it after the limit.
 */

import { loadOnboardingState, saveOnboardingState } from "./versionReset.ts";

// ============================================================================
// Hint Definitions
// ============================================================================

export interface InlineHint {
  id: string;
  message: string;
  /** Max times to show this hint. Default 4. */
  maxShows: number;
  /** Condition: only show if this returns true. */
  condition?: (context: HintContext) => boolean;
}

export interface HintContext {
  sessionCount: number;
  onboardingComplete: boolean;
  hasExchange: boolean;
  hasBroker: boolean;
  hasGordonMd: boolean;
  permissionMode: string;
}

export const HINTS: InlineHint[] = [
  {
    id: "init_gordon_md",
    message: "Tip: Run /init to create a GORDON.md file with your trading preferences and risk rules.",
    maxShows: 4,
    condition: (ctx) => ctx.onboardingComplete && !ctx.hasGordonMd,
  },
  {
    id: "permission_mode",
    message: "Tip: Use /auto for hands-free trading, /ask for per-trade approval (default), or /strict for read-only mode. /modes shows the full matrix.",
    maxShows: 3,
    condition: (ctx) => ctx.sessionCount <= 5,
  },
  {
    id: "slash_commands",
    message: "Tip: Type / to see all commands, or press Ctrl+P to open the command palette.",
    maxShows: 3,
    condition: (ctx) => ctx.sessionCount <= 3,
  },
  {
    id: "radar_cards",
    message: "Tip: Radar cards are unsolicited heads-ups from Gordon's market observer — news, regime shifts, volatility spikes. They show up inline in chat, marked as suggestions. Turn on with /radar on, inspect with /radar status.",
    maxShows: 3,
    condition: (ctx) => ctx.sessionCount >= 2 && ctx.sessionCount <= 12,
  },
  {
    id: "keybindings",
    message: "Tip: Customize keyboard shortcuts in ~/.gordon/keybindings.json. Vim mode is supported.",
    maxShows: 2,
    condition: (ctx) => ctx.sessionCount >= 3 && ctx.sessionCount <= 8,
  },
  {
    id: "add_exchange",
    message: "Tip: Run /exchange add to connect a crypto exchange, or /broker add for stocks.",
    maxShows: 3,
    condition: (ctx) => ctx.onboardingComplete && !ctx.hasExchange && !ctx.hasBroker,
  },
  {
    id: "sandbox_mode",
    message: "Tip: Use 'create a sandbox' to test strategies with paper money before going live.",
    maxShows: 2,
    condition: (ctx) => ctx.sessionCount >= 2 && ctx.sessionCount <= 10,
  },
  {
    id: "risk_disclosure",
    message: "Remember: Gordon can place real trades. Always review orders before approving. Use /strict for read-only mode.",
    maxShows: 5,
    condition: (ctx) => ctx.permissionMode === "auto",
  },
];

// ============================================================================
// Hint Resolution
// ============================================================================

/**
 * Get the next hint to show (if any). Returns null if no hints are due.
 * Call once per session start or per major state change.
 */
export function getNextHint(context: HintContext): InlineHint | null {
  const state = loadOnboardingState();
  const counts = state.hintShowCounts ?? {};

  for (const hint of HINTS) {
    const shown = counts[hint.id] ?? 0;
    if (shown >= hint.maxShows) continue;
    if (hint.condition && !hint.condition(context)) continue;
    return hint;
  }

  return null;
}

/**
 * Record that a hint was shown. Increments its counter.
 */
export function recordHintShown(hintId: string): void {
  const state = loadOnboardingState();
  if (!state.hintShowCounts) state.hintShowCounts = {};
  state.hintShowCounts[hintId] = (state.hintShowCounts[hintId] ?? 0) + 1;
  saveOnboardingState(state);
}

/**
 * Reset hint counters (e.g., after version bump to re-show relevant hints).
 */
export function resetHintCounters(hintIds?: string[]): void {
  const state = loadOnboardingState();
  if (!state.hintShowCounts) return;
  if (hintIds) {
    for (const id of hintIds) delete state.hintShowCounts[id];
  } else {
    state.hintShowCounts = {};
  }
  saveOnboardingState(state);
}

/**
 * Format a hint for terminal display.
 */
export function formatHint(hint: InlineHint): string {
  return `\u2139 ${hint.message}`;
}
