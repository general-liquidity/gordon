/**
 * ACP token-budget signal — returns max_tokens / max_turn_requests
 * stop reasons when Gordon's cost tracker or iteration budget signals
 * that the turn should halt.
 *
 * Gordon's cost tracker (`infra/platform/observability/cost-tracker.ts`)
 * publishes a `shouldHalt()` signal when the daily budget is exhausted
 * (per the cost-aware planning patterns shipped earlier). In ACP mode,
 * that signal surfaces to the editor as the appropriate stop reason
 * rather than silently truncating the turn.
 *
 * Helper resolves the right ACP StopReason from Gordon's halt signal.
 */

import type { StopReason } from "@agentclientprotocol/sdk";

export type BudgetSignal =
  | { halt: false }
  | { halt: true; reason: "daily_budget" | "max_iterations" | "token_budget" };

/**
 * Map Gordon's budget-signal reason to the ACP StopReason enum.
 *
 *   daily_budget    → max_tokens     (closest semantic: ran out of budget for this turn)
 *   max_iterations  → max_turn_requests
 *   token_budget    → max_tokens
 *
 * No-halt signals return undefined so the caller falls through to the
 * stream-completion stop reason (end_turn, etc.).
 */
export function budgetSignalToStopReason(signal: BudgetSignal): StopReason | undefined {
  if (!signal.halt) return undefined;
  switch (signal.reason) {
    case "daily_budget":
    case "token_budget":
      return "max_tokens";
    case "max_iterations":
      return "max_turn_requests";
    default:
      return undefined;
  }
}

/**
 * Probe Gordon's cost tracker for a halt signal. Returns BudgetSignal
 * shape. Returns `{ halt: false }` when the cost-tracker module isn't
 * present (e.g., during tests with a mocked context).
 *
 * The lazy require keeps this module loadable without forcing the
 * observability subsystem to initialize in test environments.
 */
export async function probeBudgetHalt(): Promise<BudgetSignal> {
  try {
    const mod = await import("../platform/costTracker.ts");
    const tracker = (mod as {
      getCostTracker?: () => { shouldHalt?: () => boolean };
      shouldHaltOnBudget?: () => boolean;
    });
    if (typeof tracker.shouldHaltOnBudget === "function" && tracker.shouldHaltOnBudget()) {
      return { halt: true, reason: "daily_budget" };
    }
    const instance = tracker.getCostTracker?.();
    if (instance?.shouldHalt && instance.shouldHalt()) {
      return { halt: true, reason: "daily_budget" };
    }
  } catch {
    // Cost tracker module not present or shape changed — return no-halt
  }
  return { halt: false };
}
