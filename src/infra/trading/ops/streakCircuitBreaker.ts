/**
 * Streak Circuit Breaker (GORDON_STREAK_CIRCUIT_BREAKER).
 *
 * Port of Ch 8 + Ch 9. Wright's Rule of Three: after three consecutive
 * losses, mandatory cooldown lockout. Separate signal from the daily
 * loss cap — this is a SEQUENCE-based breaker, not magnitude-based.
 *
 * Also tracks the related "streak governor": after the configured
 * threshold of consecutive losses, the next position must be sized at
 * 50% of base (Wright Ch 9).
 *
 * Pure compute. State is held by the caller (recent results + last
 * trigger timestamp). Composes with WW2 absorbingBarrier (broker
 * daily-loss cap) and WW1 pathDependentSizer (the 50% multiplier).
 */

import { flagEnv } from "../../config/flagResolver.ts";

export const STREAK_CIRCUIT_BREAKER_FLAG_ENV = "GORDON_STREAK_CIRCUIT_BREAKER";

export function isStreakCircuitBreakerEnabled(
  env: NodeJS.ProcessEnv = flagEnv(),
): boolean {
  // Default-on protective gate: absence = enabled. Explicit "0"/"false" opts out.
  const raw = env[STREAK_CIRCUIT_BREAKER_FLAG_ENV];
  return raw !== "0" && raw !== "false";
}

export type CircuitState = "open" | "cooldown" | "tripped";

export interface StreakInput {
  /** Most recent N trade results, ordered most-recent first. */
  recentResults: ReadonlyArray<"win" | "loss" | "scratch">;
  /** Timestamp of the most recent breaker trip (epoch ms). null = never tripped. */
  lastTrippedAtMs?: number;
  /** Current evaluation time (epoch ms). */
  nowMs: number;
  /** Consecutive losses required to trip. Default 3 (Rule of Three). */
  threshold?: number;
  /** Cooldown duration in minutes. Default 60. */
  cooldownMinutes?: number;
}

export interface StreakResult {
  state: CircuitState;
  consecutiveLosses: number;
  /** True when next trade must be size-reduced (50% multiplier). */
  sizeReductionActive: boolean;
  /** Milliseconds remaining in cooldown (0 if not in cooldown). */
  cooldownRemainingMs: number;
  reason: string;
}

const DEFAULT_THRESHOLD = 3;
const DEFAULT_COOLDOWN_MINUTES = 60;
const SIZE_REDUCTION_MULTIPLIER = 0.5;

function countLeadingLosses(results: ReadonlyArray<"win" | "loss" | "scratch">): number {
  let count = 0;
  for (const r of results) {
    if (r === "loss") count++;
    else if (r === "win") break;
    // scratches are neutral and don't break the streak
  }
  return count;
}

export function evaluateCircuit(input: StreakInput): StreakResult {
  const threshold = input.threshold ?? DEFAULT_THRESHOLD;
  const cooldownMs = (input.cooldownMinutes ?? DEFAULT_COOLDOWN_MINUTES) * 60_000;
  const consecutiveLosses = countLeadingLosses(input.recentResults);

  const elapsed =
    input.lastTrippedAtMs !== undefined ? input.nowMs - input.lastTrippedAtMs : Number.POSITIVE_INFINITY;
  const cooldownRemaining = Math.max(0, cooldownMs - elapsed);
  const inCooldownWindow = cooldownRemaining > 0;

  if (consecutiveLosses >= threshold && !inCooldownWindow) {
    return {
      state: "tripped",
      consecutiveLosses,
      sizeReductionActive: true,
      cooldownRemainingMs: cooldownMs,
      reason: `${consecutiveLosses} consecutive losses ≥ threshold ${threshold} — cooldown for ${input.cooldownMinutes ?? DEFAULT_COOLDOWN_MINUTES}m`,
    };
  }
  if (inCooldownWindow) {
    return {
      state: "cooldown",
      consecutiveLosses,
      sizeReductionActive: true,
      cooldownRemainingMs: cooldownRemaining,
      reason: `Cooldown in progress — ${Math.ceil(cooldownRemaining / 60_000)}m remaining`,
    };
  }
  if (consecutiveLosses >= threshold - 1) {
    return {
      state: "open",
      consecutiveLosses,
      sizeReductionActive: true,
      cooldownRemainingMs: 0,
      reason: `${consecutiveLosses} of ${threshold} losses — streak governor active (size × ${SIZE_REDUCTION_MULTIPLIER})`,
    };
  }
  return {
    state: "open",
    consecutiveLosses,
    sizeReductionActive: false,
    cooldownRemainingMs: 0,
    reason: "Streak clear",
  };
}

export function shouldBlockTrade(result: StreakResult): boolean {
  return result.state === "tripped" || result.state === "cooldown";
}

export function streakToPayload(result: StreakResult): Record<string, unknown> {
  return {
    kind: "streak_circuit_breaker.evaluated",
    state: result.state,
    consecutiveLosses: result.consecutiveLosses,
    sizeReductionActive: result.sizeReductionActive,
    cooldownRemainingMs: result.cooldownRemainingMs,
  };
}
