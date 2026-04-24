/**
 * Trader-Relevant Reminder Categories
 *
 * The OPENDEV paper specifies 24 reminder categories used by general-purpose
 * coding agents. Gordon needs only a focused subset tuned for trading work.
 * This module defines the 6 trading-specific categories, their trigger
 * conditions, and a `gateTraderReminders()` helper that the runtime harness
 * uses to decide whether to surface the trading reminders at all.
 *
 * Behavior is gated by the `GORDON_TRADER_REMINDERS` env flag. When unset,
 * the legacy reminder logic (always-on) is used. When set to "true", the
 * categories below are activated explicitly so we can observe their effect
 * in isolation. When set to "false", trader reminders are suppressed
 * entirely (debug aid).
 *
 * Note: the actual reminder TEXT is emitted by buildEventDrivenReminders()
 * in runtimeHarness.ts. This module is the registry/contract that documents
 * each category and provides the feature gate.
 */

export type TraderReminderCategory =
  | "plan_lifecycle"
  | "execution_approval"
  | "repeated_venue_failure"
  | "stale_mandate"
  | "repeated_loop"
  | "incomplete_runtime_task";

export interface TraderReminderSpec {
  category: TraderReminderCategory;
  description: string;
  triggerCondition: string;
  /** Default fire budget per thread (how many times we may inject this reminder). */
  defaultMaxAttempts: number;
}

export const TRADER_REMINDER_CATEGORIES: Record<TraderReminderCategory, TraderReminderSpec> = {
  plan_lifecycle: {
    category: "plan_lifecycle",
    description: "Planning phase started but no plan artifact exists yet.",
    triggerCondition: "phase === 'planning' && (no planning artifact || artifact expired)",
    defaultMaxAttempts: 1,
  },
  execution_approval: {
    category: "execution_approval",
    description: "Execution requested but the active plan has not been explicitly approved.",
    triggerCondition: "phase === 'execution' && artifact.approved === false",
    defaultMaxAttempts: 2,
  },
  repeated_venue_failure: {
    category: "repeated_venue_failure",
    description: "Same venue's API has failed multiple times in a short window.",
    triggerCondition: "venueFailureCount >= 2 within 5min",
    defaultMaxAttempts: 3,
  },
  stale_mandate: {
    category: "stale_mandate",
    description: "Execution phase entered without a clear action mandate (intended symbol/direction).",
    triggerCondition: "phase === 'execution' && context.requestedActionId === undefined",
    defaultMaxAttempts: 1,
  },
  repeated_loop: {
    category: "repeated_loop",
    description: "Doom-loop detector fired — same fingerprint observed >= 3 times in last 20 calls.",
    triggerCondition: "recordToolCallFingerprint().count >= 3",
    defaultMaxAttempts: 2,
  },
  incomplete_runtime_task: {
    category: "incomplete_runtime_task",
    description: "Approved plan has outstanding next-steps; do not claim completion until executed or deferred.",
    triggerCondition: "artifact.approved && extractedTasks.length > 0",
    defaultMaxAttempts: 2,
  },
};

export type TraderReminderMode = "auto" | "force_on" | "force_off";

/**
 * Read the GORDON_TRADER_REMINDERS env flag. Three modes:
 *   - unset / "auto"  → legacy behavior (always-on; default)
 *   - "true"          → trader-specific reminders explicitly activated
 *   - "false" / "0"   → trader-specific reminders suppressed (diagnostic)
 */
export function getTraderReminderMode(): TraderReminderMode {
  const raw = (process.env.GORDON_TRADER_REMINDERS ?? "").trim().toLowerCase();
  if (raw === "true" || raw === "1" || raw === "on") return "force_on";
  if (raw === "false" || raw === "0" || raw === "off") return "force_off";
  return "auto";
}

/**
 * Decide whether the trader reminder block should be emitted.
 *
 * Returns `true` for the default ("auto") and explicit-on modes. Returns
 * `false` only when the operator explicitly suppressed them via env.
 */
export function shouldEmitTraderReminders(): boolean {
  return getTraderReminderMode() !== "force_off";
}

/** Validate that all 6 categories are registered. Used by tests as a smoke check. */
export function listTraderReminderCategories(): TraderReminderCategory[] {
  return Object.keys(TRADER_REMINDER_CATEGORIES) as TraderReminderCategory[];
}
