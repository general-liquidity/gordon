/**
 * Trade Event Producer
 *
 * Converts Gordon's `trade:opened` and `trade:closed` events into proactive
 * candidates. Most trade events don't need a proactive suggestion — the
 * user knows they just filled an order. We debounce to only fire:
 *
 *   - journal_prompt: every 5 closed trades or at end of trading day
 *   - position_review: when a trade has been open for 7+ days
 *
 * The `trade:opened` event is currently informational only (no candidate
 * fires) — opening a position is already explicit user action. Could be
 * extended later to fire a risk_warning if the new trade pushes portfolio
 * concentration above a threshold, but that would need the portfolio
 * tracker wired in.
 */

import type { CandidateProducer } from "../proactiveEngine.ts";
import { buildCandidate } from "../proactiveEngine.ts";
import type { ProactiveSuggestion } from "../types.ts";

// Rolling count of closed trades since last journal prompt.
let closedTradesSincePrompt = 0;
const TRADES_PER_JOURNAL_PROMPT = 5;

export const tradeEventProducer: CandidateProducer = (obs): ProactiveSuggestion[] => {
  if (obs.source !== "event_bus") return [];
  const candidates: ProactiveSuggestion[] = [];

  if (obs.eventType === "trade:closed") {
    closedTradesSincePrompt += 1;
    if (closedTradesSincePrompt >= TRADES_PER_JOURNAL_PROMPT) {
      closedTradesSincePrompt = 0;
      const pnl = typeof obs.change === "number" ? obs.change : 0;
      candidates.push(
        buildCandidate(
          "journal_prompt",
          "Journal check-in",
          `You've closed ${TRADES_PER_JOURNAL_PROMPT} trades recently. Worth a quick journal entry — what's working, what's not, any themes? Use record_insight or just type your thoughts to Gordon.`,
          {
            confidence: 0.7,
            action: "Write a short journal note on your last 5 trades",
            triggers: {
              source: "event_bus",
              eventType: obs.eventType,
              symbol: obs.symbol,
              change: pnl,
              metadata: obs.metadata,
            },
          },
        ),
      );
    }
  }

  // position_review — fired by periodic producer instead (needs position age).
  // We keep this producer scoped to pure event reactions.
  return candidates;
};

/** Reset internal counters. Called on engine stop. */
export function resetTradeEventProducerState(): void {
  closedTradesSincePrompt = 0;
}
