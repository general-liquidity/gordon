/**
 * Position Cleanup
 *
 * Cleans up stale positions that got stuck in non-terminal states.
 * Positions that linger too long in intermediate states (idea, analyzed,
 * planned) are auto-expired to prevent accumulation of zombie entries.
 *
 * Wired into the daemon health check.
 */

import { createModuleLogger } from "../../infra/logger/index.ts";
import { logEvent } from "../../infra/storage/entities/events.ts";
import { getPositionStore } from "./store.ts";
import type { PositionState } from "./types.ts";

const logger = createModuleLogger("position-cleanup");

/** Max age (in hours) before a position in a given state is considered stale */
const STALE_THRESHOLDS: Partial<Record<PositionState, number>> = {
  idea: 24,
  analyzed: 24,
  planned: 48,
  approved: 12,
  ordering: 1,
};

export interface PositionCleanupResult {
  expired: number;
  byState: Record<string, number>;
}

/**
 * Find and expire stale positions.
 * Positions past their threshold are transitioned to a terminal state.
 */
export async function cleanupStalePositions(): Promise<PositionCleanupResult> {
  const result: PositionCleanupResult = {
    expired: 0,
    byState: {},
  };

  try {
    const store = await getPositionStore();
    const now = Date.now();

    for (const [state, maxHours] of Object.entries(STALE_THRESHOLDS)) {
      const positions = await store.getByState(state as PositionState);

      for (const pos of positions) {
        // Use updatedAt (state-transition time) if available, else fall back to createdAt
        const stateEntryTime = new Date(pos.updatedAt ?? pos.createdAt).getTime();
        const ageHours = (now - stateEntryTime) / (1000 * 60 * 60);

        if (ageHours > maxHours) {
          try {
            await store.update(pos.id, {
              state: "cancelled" as PositionState,
              updatedAt: new Date().toISOString(),
            });

            result.expired++;
            result.byState[state] = (result.byState[state] ?? 0) + 1;

            logger.info("Expired stale position", {
              positionId: pos.id,
              symbol: pos.symbol,
              state,
              ageHours: Math.round(ageHours),
              threshold: maxHours,
            });
          } catch (err) {
            logger.debug("Could not expire position", {
              positionId: pos.id,
              error: (err as Error).message,
            });
          }
        }
      }
    }

    if (result.expired > 0) {
      logEvent({
        type: "SYSTEM",
        data: {
          action: "STALE_POSITIONS_CLEANED",
          expired: result.expired,
          byState: result.byState,
        },
      });
    }
  } catch (err) {
    logger.debug("Position cleanup skipped", {
      error: (err as Error).message,
    });
  }

  return result;
}
