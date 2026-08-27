/**
 * Durable holder for the streak circuit breaker's trip timestamp.
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
 * The authenticated halt ledger is keyed by the strongest stable portfolio
 * identity available at the order chokepoint. A restart reloads the trip;
 * GORDON_STREAK_LAST_TRIPPED_MS remains an operator-declared fallback when no
 * trip has been persisted for that identity.
 */

import { flagEnv } from "../../config/flagResolver.ts";
import {
  clearPortfolioHaltStateForTesting,
  readPortfolioHaltState,
  updatePortfolioHaltState,
} from "../../safety/durableHaltState.ts";

export const STREAK_LAST_TRIPPED_ENV = "GORDON_STREAK_LAST_TRIPPED_MS";

/**
 * Epoch ms of the most recent trip, or null when the breaker has not tripped
 * for this portfolio and the operator declared no earlier trip.
 */
export function lastStreakTripAtMs(
  identity: string = "default",
  env: NodeJS.ProcessEnv = flagEnv(),
): number | null {
  const persisted = readPortfolioHaltState(identity).streakLastTrippedAtMs;
  if (persisted !== null) return persisted;
  const declared = Number(env[STREAK_LAST_TRIPPED_ENV] ?? 0);
  return Number.isFinite(declared) && declared > 0 ? declared : null;
}

export function recordStreakTrip(identity: string, nowMs: number): boolean {
  if (!Number.isFinite(nowMs) || nowMs <= 0) return false;
  return updatePortfolioHaltState(identity, (state) => ({
    ...state,
    streakLastTrippedAtMs: nowMs,
  }));
}

/** Tests only. */
export function resetStreakCircuitForTesting(): void {
  clearPortfolioHaltStateForTesting();
}
