/**
 * Scheduled Job Policies
 *
 * FulfillmentMode controls what happens after a job runs. Consecutive-error
 * tracking auto-disables jobs that fail repeatedly. These utilities are
 * scheduler-agnostic — any cron/scheduler can use them.
 */

export type FulfillmentMode =
  /** Keep firing on every scheduled tick (default). */
  | "keep"
  /** Run once, then auto-disable. */
  | "once"
  /** Prompt user for approval before each run. */
  | "ask";

export interface JobRunState {
  lastRunAtMs?: number;
  lastRunStatus?: "ok" | "error" | "suppressed" | "pending_approval";
  lastError?: string;
  lastDurationMs?: number;
  /** Consecutive error count (resets on success). */
  consecutiveErrors: number;
  /** Total runs attempted. */
  totalRuns: number;
  /** Total successful runs. */
  successfulRuns: number;
}

export function initialJobRunState(): JobRunState {
  return { consecutiveErrors: 0, totalRuns: 0, successfulRuns: 0 };
}

/** Default: disable a job after this many consecutive errors. */
export const DEFAULT_ERROR_DISABLE_THRESHOLD = 5;

export interface PolicyDecision {
  /** Whether to actually execute the job on this tick. */
  shouldRun: boolean;
  /** Whether to disable the job after this decision. */
  shouldDisable: boolean;
  /** User-facing reason for the decision. */
  reason: string;
  /** Whether user approval is required before running. */
  needsApproval: boolean;
}

export interface DecideRunInput {
  enabled: boolean;
  mode: FulfillmentMode;
  state: JobRunState;
  errorDisableThreshold?: number;
}

export function decideJobRun(input: DecideRunInput): PolicyDecision {
  const threshold = input.errorDisableThreshold ?? DEFAULT_ERROR_DISABLE_THRESHOLD;

  if (!input.enabled) {
    return {
      shouldRun: false,
      shouldDisable: false,
      reason: "Job is disabled",
      needsApproval: false,
    };
  }

  if (input.state.consecutiveErrors >= threshold) {
    return {
      shouldRun: false,
      shouldDisable: true,
      reason: `Disabled after ${input.state.consecutiveErrors} consecutive errors`,
      needsApproval: false,
    };
  }

  if (input.mode === "once" && input.state.successfulRuns >= 1) {
    return {
      shouldRun: false,
      shouldDisable: true,
      reason: "One-shot job already completed successfully",
      needsApproval: false,
    };
  }

  if (input.mode === "ask") {
    return {
      shouldRun: false,
      shouldDisable: false,
      reason: "Awaiting user approval",
      needsApproval: true,
    };
  }

  return {
    shouldRun: true,
    shouldDisable: false,
    reason: "Ready to run",
    needsApproval: false,
  };
}

/** Update job state after a run. */
export interface RunOutcome {
  status: "ok" | "error" | "suppressed";
  error?: string;
  durationMs?: number;
}

export function updateStateAfterRun(
  state: JobRunState,
  outcome: RunOutcome,
): JobRunState {
  const next: JobRunState = { ...state };
  next.lastRunAtMs = Date.now();
  next.lastRunStatus = outcome.status;
  next.lastError = outcome.error;
  next.lastDurationMs = outcome.durationMs;
  next.totalRuns = state.totalRuns + 1;

  if (outcome.status === "ok") {
    next.consecutiveErrors = 0;
    next.successfulRuns = state.successfulRuns + 1;
  } else if (outcome.status === "error") {
    next.consecutiveErrors = state.consecutiveErrors + 1;
  }
  // "suppressed" does not touch consecutiveErrors or run counts meaningfully.
  return next;
}

export function shouldAutoDisable(state: JobRunState, threshold: number = DEFAULT_ERROR_DISABLE_THRESHOLD): boolean {
  return state.consecutiveErrors >= threshold;
}
