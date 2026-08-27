/**
 * Process-scoped holder for the streak circuit breaker's trip timestamp.
 *
 * `evaluateCircuit` is pure: it is handed the recent results and the moment
 * the breaker last tripped, and somebody has to remember that moment between
 * calls. Without a holder the breaker can only ever report "tripped", because
 * an absent timestamp makes the elapsed cooldown infinite, and the cooldown it
 * advertises never actually runs.
 *
 * The timestamp is what makes the halt AUTO-EXPIRING rather than a kill switch:
 * the cooldown clock starts at the trip, the gate re-evaluates on the next
 * order, and once the window has passed the breaker clears itself with no
 * operator reset. Trade results recorded before the trip are also consumed by
 * it, so a cooldown that expires with no new trades does not immediately
 * re-trip on the same three losses and strand the operator.
 *
 * DURABILITY SCOPE, stated plainly, and the same as `absorbingBarrierState`:
 * this is memory in one process. A restart forgets the trip, which shortens
 * the cooldown rather than extending it. Operators who want a trip to survive
 * a restart can state it with GORDON_STREAK_LAST_TRIPPED_MS, which is read
 * whenever this process has not tripped the breaker itself.
 */

import { flagEnv } from "../../config/flagResolver.ts";

export const STREAK_LAST_TRIPPED_ENV = "GORDON_STREAK_LAST_TRIPPED_MS";

let lastTrippedAtMs: number | null = null;

/**
 * Epoch ms of the most recent trip, or null when the breaker has not tripped
 * in this process and the operator declared no earlier trip.
 */
export function lastStreakTripAtMs(env: NodeJS.ProcessEnv = flagEnv()): number | null {
  if (lastTrippedAtMs !== null) return lastTrippedAtMs;
  const declared = Number(env[STREAK_LAST_TRIPPED_ENV] ?? 0);
  return Number.isFinite(declared) && declared > 0 ? declared : null;
}

export function recordStreakTrip(nowMs: number): void {
  if (!Number.isFinite(nowMs) || nowMs <= 0) return;
  lastTrippedAtMs = nowMs;
}

/** Tests only. */
export function resetStreakCircuitForTesting(): void {
  lastTrippedAtMs = null;
}
