/**
 * Stop Loss Producer
 *
 * Converts stop-approaching and stop-triggered alerts into proactive
 * candidates. When price pushes within striking distance of a stop, we
 * fire a `stop_loss_tighten` suggestion — the user may want to tighten
 * the stop, move to breakeven, or scale out before getting stopped.
 *
 * `stop_triggered` events are informational only (stop already hit) but
 * could be extended to suggest a post-stop review / journal entry.
 */

import type { CandidateProducer } from "../proactiveEngine.ts";
import { buildCandidate } from "../proactiveEngine.ts";
import type { ProactiveSuggestion } from "../types.ts";

export const stopProducer: CandidateProducer = (obs): ProactiveSuggestion[] => {
  if (obs.source !== "event_bus") return [];
  const candidates: ProactiveSuggestion[] = [];

  if (obs.eventType === "alert:stop_approaching") {
    const symbol = obs.symbol ?? (obs.metadata?.symbol as string | undefined) ?? "a position";
    const distance = (obs.metadata?.distance as number | undefined) ?? 0;
    const currentPrice = (obs.metadata?.currentPrice as number | undefined);
    const stopPrice = (obs.metadata?.stopPrice as number | undefined);

    const confidence = distance < 1 ? 0.9 : distance < 2 ? 0.8 : 0.72;

    candidates.push(
      buildCandidate(
        "stop_loss_tighten",
        `${symbol} approaching stop (${distance.toFixed(2)}% away)`,
        `Price on ${symbol} is within ${distance.toFixed(2)}% of the stop` +
          (currentPrice && stopPrice ? ` (current ${currentPrice}, stop ${stopPrice})` : "") +
          `. You can tighten to breakeven, scale out, or cancel and reassess.`,
        {
          confidence,
          action: `Consider cancel_order + re-enter, or scale out via close_partial`,
          triggers: {
            source: "event_bus",
            eventType: obs.eventType,
            symbol,
            price: currentPrice,
            metadata: obs.metadata,
          },
        },
      ),
    );
  }

  if (obs.eventType === "alert:tp_hit") {
    const symbol = obs.symbol ?? (obs.metadata?.symbol as string | undefined) ?? "a position";
    const level = obs.metadata?.level as number | undefined;
    candidates.push(
      buildCandidate(
        "position_review",
        `${symbol} hit TP${level ?? ""} — consider runner management`,
        `${symbol} just hit take-profit target${level ? ` ${level}` : ""}. ` +
          `Typical next step: move stop to breakeven on the remaining position, or trail it.`,
        {
          confidence: 0.75,
          action: `Trail the stop via set_trailing_stop or move to breakeven`,
          triggers: {
            source: "event_bus",
            eventType: obs.eventType,
            symbol,
            metadata: obs.metadata,
          },
        },
      ),
    );
  }

  return candidates;
};
