/**
 * Permission Decision Racing
 *
 * Claude Code pattern: race hook evaluation against the UI approval dialog.
 * Whichever decides first wins; the loser is cancelled. This means hooks
 * can auto-approve instantly without the user ever seeing a dialog.
 *
 * Flow:
 *   1. Tool execution triggers permission check
 *   2. Start hook evaluation + UI dialog in parallel
 *   3. First to resolve (allow/deny) wins
 *   4. Cancel the other
 *   5. Return decision
 *
 * For Gordon: hooks check permission rules (notional < $1000 → auto-approve),
 * while ApprovalDialog shows the user the trade details. If a rule matches,
 * the dialog never appears.
 */

import { runHooks } from "../hooks/engine.ts";
import { evaluateRules, type PermissionRule, type RuleBehavior } from "./rules.ts";
import type { HookResult } from "../hooks/types.ts";

// ============================================================================
// Types
// ============================================================================

export type PermissionDecision = "allow" | "deny" | "ask";

export interface RaceResult {
  decision: PermissionDecision;
  source: "hook" | "rule" | "ui" | "timeout" | "default";
  reason?: string;
  /** If modified by a hook, the replacement args. */
  modifiedArgs?: unknown;
  /** Duration of the race in ms. */
  durationMs: number;
}

export interface RaceOptions {
  toolName: string;
  toolArgs: unknown;
  /** Active permission rules. */
  rules: PermissionRule[];
  /** If provided, show the UI dialog. Returns "allow" | "deny". */
  showDialog?: () => Promise<"allow" | "deny">;
  /** Max time to wait for a decision before defaulting. Default 30s. */
  timeoutMs?: number;
  /** Abort signal — cancels the race immediately. */
  signal?: AbortSignal;
}

// ============================================================================
// Racing Implementation
// ============================================================================

/**
 * Race hook evaluation + rule matching against the UI dialog.
 * First to produce a definitive decision wins.
 */
export async function racePermissionDecision(options: RaceOptions): Promise<RaceResult> {
  const start = Date.now();
  const { toolName, toolArgs, rules, showDialog, timeoutMs = 30_000, signal } = options;

  // ── Fast path: check rules synchronously first ──
  const ruleResult = evaluateRules(rules, { toolName, args: toolArgs });
  if (ruleResult.matchedRule) {
    return {
      decision: ruleResult.behavior,
      source: "rule",
      reason: ruleResult.reason ?? `Rule ${ruleResult.matchedRule.id} matched`,
      durationMs: Date.now() - start,
    };
  }

  // ── Race: hooks vs dialog vs timeout ──
  const abortController = new AbortController();
  const raceSignal = signal
    ? AbortSignal.any([signal, abortController.signal])
    : abortController.signal;

  const competitors: Promise<RaceResult>[] = [];

  // Competitor 1: Hooks
  competitors.push(
    runHookRacer(toolName, toolArgs, start, raceSignal),
  );

  // Competitor 2: UI Dialog (if provided)
  if (showDialog) {
    competitors.push(
      runDialogRacer(showDialog, start, raceSignal),
    );
  }

  // Competitor 3: Timeout
  competitors.push(
    runTimeoutRacer(timeoutMs, start, raceSignal),
  );

  try {
    // First to resolve wins
    const winner = await Promise.race(competitors);

    // Cancel all losers
    abortController.abort();

    return winner;
  } catch {
    // If external signal aborted, return default
    return {
      decision: "ask",
      source: "default",
      reason: "Race aborted",
      durationMs: Date.now() - start,
    };
  }
}

// ── Racers ──

async function runHookRacer(
  toolName: string,
  toolArgs: unknown,
  start: number,
  signal: AbortSignal,
): Promise<RaceResult> {
  if (signal.aborted) throw new Error("aborted");

  const hookResult: HookResult = await runHooks("PreToolUse", {
    toolName,
    toolCallId: `race_${Date.now()}`,
    args: toolArgs,
  });

  if (signal.aborted) throw new Error("aborted");

  if (hookResult.action === "block") {
    return {
      decision: "deny",
      source: "hook",
      reason: hookResult.reason,
      durationMs: Date.now() - start,
    };
  }

  if (hookResult.action === "allow") {
    return {
      decision: "allow",
      source: "hook",
      reason: "Hook auto-approved",
      modifiedArgs: hookResult.metadata?.finalPayload,
      durationMs: Date.now() - start,
    };
  }

  // Hook returned "allow" without explicit decision — don't resolve the race.
  // Wait indefinitely (will be cancelled by another racer).
  return new Promise(() => {});
}

async function runDialogRacer(
  showDialog: () => Promise<"allow" | "deny">,
  start: number,
  signal: AbortSignal,
): Promise<RaceResult> {
  if (signal.aborted) throw new Error("aborted");

  const decision = await showDialog();

  if (signal.aborted) throw new Error("aborted");

  return {
    decision,
    source: "ui",
    reason: `User chose: ${decision}`,
    durationMs: Date.now() - start,
  };
}

async function runTimeoutRacer(
  timeoutMs: number,
  start: number,
  signal: AbortSignal,
): Promise<RaceResult> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      resolve({
        decision: "deny",
        source: "timeout",
        reason: `No decision within ${timeoutMs}ms — defaulting to deny`,
        durationMs: Date.now() - start,
      });
    }, timeoutMs);

    signal.addEventListener("abort", () => {
      clearTimeout(timer);
      reject(new Error("aborted"));
    }, { once: true });
  });
}

// ============================================================================
// Convenience: Quick check without dialog
// ============================================================================

/**
 * Fast synchronous check: does any rule or registered hook auto-decide?
 * Returns null if no automatic decision — caller should show UI dialog.
 */
export function quickPermissionCheck(
  rules: PermissionRule[],
  toolName: string,
  toolArgs: unknown,
): { decision: PermissionDecision; reason: string } | null {
  const ruleResult = evaluateRules(rules, { toolName, args: toolArgs });
  if (ruleResult.matchedRule) {
    return {
      decision: ruleResult.behavior,
      reason: ruleResult.reason ?? `Rule ${ruleResult.matchedRule.id}`,
    };
  }
  return null;
}
