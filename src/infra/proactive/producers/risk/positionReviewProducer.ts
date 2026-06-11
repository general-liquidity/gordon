/**
 * Position Review Producer
 *
 * Periodic producer that scans live positions (filled / monitoring) and fires
 * a `position_review` candidate when a position has been open for 7+ days.
 * Complements stopProducer, which fires `position_review` on take-profit hits.
 */

import type { CandidateProducer } from "../../engine/proactiveEngine.ts";
import { buildCandidate } from "../../engine/proactiveEngine.ts";
import type { ProactiveSuggestion } from "../../types.ts";
import { createModuleLogger } from "../../../logger/index.ts";

const logger = createModuleLogger("position-review-producer");

const MIN_HOLD_DAYS = 7;
const MS_PER_DAY = 24 * 60 * 60 * 1000;
const DEDUPE_MS = 4 * 60 * 60 * 1000;
const LIVE_STATES = new Set(["filled", "monitoring"]);

interface MinimalPosition {
  id: string;
  symbol: string;
  state: string;
  createdAt: string;
  side?: string;
  unrealizedPnL?: number;
}

interface MinimalPositionStore {
  getActive: () => Promise<MinimalPosition[]>;
}

const lastSuggestedAt = new Map<string, number>();

async function loadPositionStore(): Promise<MinimalPositionStore | null> {
  try {
    const mod = (await import("../../../../core/positions/store.ts" as string)) as {
      getPositionStore?: () => Promise<MinimalPositionStore>;
    };
    if (typeof mod.getPositionStore !== "function") return null;
    return await mod.getPositionStore();
  } catch (err) {
    logger.debug("Position store not accessible for position review producer", { err: String(err) });
    return null;
  }
}

function daysOpen(createdAt: string, nowMs: number): number {
  const opened = Date.parse(createdAt);
  if (!Number.isFinite(opened)) return 0;
  return (nowMs - opened) / MS_PER_DAY;
}

export const positionReviewProducer: CandidateProducer = async (
  obs,
): Promise<ProactiveSuggestion[]> => {
  if (obs.source !== "monitor_loop" || obs.eventType !== "tick_position_review") return [];

  const store = await loadPositionStore();
  if (!store) return [];

  let positions: MinimalPosition[];
  try {
    positions = await store.getActive();
  } catch (err) {
    logger.debug("getActive failed", { err: String(err) });
    return [];
  }

  const now = obs.timestamp;
  const candidates: ProactiveSuggestion[] = [];

  for (const pos of positions) {
    if (!LIVE_STATES.has(pos.state)) continue;

    const ageDays = daysOpen(pos.createdAt, now);
    if (ageDays < MIN_HOLD_DAYS) continue;

    const last = lastSuggestedAt.get(pos.id) ?? 0;
    if (now - last < DEDUPE_MS) continue;

    lastSuggestedAt.set(pos.id, now);
    const ageRounded = Math.floor(ageDays);
    const pnlNote =
      typeof pos.unrealizedPnL === "number"
        ? ` Unrealized P&L: ${pos.unrealizedPnL >= 0 ? "+" : ""}${pos.unrealizedPnL.toFixed(2)}.`
        : "";

    candidates.push(
      buildCandidate(
        "position_review",
        `${pos.symbol} open ${ageRounded}d — time to review`,
        `${pos.symbol} has been open for ${ageRounded} days.${pnlNote} ` +
          `Long holds drift from the original thesis — worth checking whether the entry reason still holds, ` +
          `stops are still appropriate, and the position still fits portfolio risk.`,
        {
          confidence: ageDays >= 14 ? 0.78 : 0.7,
          action: `Run /exit-review on ${pos.symbol} or ask Gordon to re-evaluate the thesis`,
          triggers: {
            source: "monitor_loop",
            eventType: obs.eventType,
            symbol: pos.symbol,
            metadata: {
              positionId: pos.id,
              ageDays: ageRounded,
              state: pos.state,
              side: pos.side,
            },
          },
        },
      ),
    );
  }

  return candidates;
};

export function resetPositionReviewProducerState(): void {
  lastSuggestedAt.clear();
}