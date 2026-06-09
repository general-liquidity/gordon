/**
 * Periodic Producer
 *
 * Handles time-driven proactive categories that don't correspond to a
 * single Gordon event bus signal. The observer fires a synthetic
 * `{ source: "monitor_loop", eventType: "tick_<what>" }` observation on a
 * schedule, and this producer converts it into the appropriate candidate.
 *
 * Covered ticks:
 *   - tick_session_review  → session_review (end of day / end of week)
 *   - tick_journal_prompt  → journal_prompt (end of day)
 *   - tick_whale_drain     → whale_alert  (processes CDP webhook buffer)
 *
 * Producers for tick_portfolio_drift, tick_regime_flip, tick_volatility,
 * and tick_funding are scaffolded but not implemented in v1 because they
 * need access to modules (position tracker, regime detector, price feed,
 * perp funding) that aren't uniformly available as cheap synchronous
 * reads. They'll log "not yet wired" and return no candidates — future
 * work can fill them in.
 */

import type { CandidateProducer } from "../engine/proactiveEngine.ts";
import { buildCandidate } from "../engine/proactiveEngine.ts";
import type { ProactiveSuggestion } from "../types.ts";

export const periodicProducer: CandidateProducer = async (obs): Promise<ProactiveSuggestion[]> => {
  if (obs.source !== "monitor_loop") return [];
  const candidates: ProactiveSuggestion[] = [];

  switch (obs.eventType) {
    case "tick_session_review":
      candidates.push(...buildSessionReview(obs.timestamp));
      break;

    case "tick_journal_prompt":
      candidates.push(...buildJournalPrompt(obs.timestamp));
      break;

    // tick_portfolio_drift, tick_regime_flip, tick_volatility, tick_funding
    // are handled by dedicated producers (portfolioDriftProducer,
    // regimeFlipProducer, volatilitySpikeProducer, fundingAlertProducer) —
    // this producer ignores them.
    default:
      return [];
  }

  return candidates;
};

// ============================================================================
// Session review — end-of-day and end-of-week prompts
// ============================================================================

function buildSessionReview(nowMs: number): ProactiveSuggestion[] {
  const now = new Date(nowMs);
  const dayOfWeek = now.getUTCDay();
  // Only Friday end-of-day counts as a week-end review
  const isEndOfWeek = dayOfWeek === 5 && now.getUTCHours() >= 21;
  if (!isEndOfWeek) return [];

  return [
    buildCandidate(
      "session_review",
      "Weekly review prompt",
      "Week's closing. Worth a quick weekly review: P&L by strategy, what worked, what didn't, anything to adjust for next week? Use get_weekly_pnl or review open positions.",
      {
        confidence: 0.72,
        action: "Run /weekend-review or ask Gordon for a weekly P&L summary",
        triggers: {
          source: "monitor_loop",
          eventType: "tick_session_review",
          metadata: { dayOfWeek, hour: now.getUTCHours() },
        },
      },
    ),
  ];
}

function buildJournalPrompt(nowMs: number): ProactiveSuggestion[] {
  const now = new Date(nowMs);
  // End of day prompt only around 22:00 UTC
  if (now.getUTCHours() !== 22) return [];

  return [
    buildCandidate(
      "journal_prompt",
      "End-of-day journal nudge",
      "Trading day wrapping up. Fast journal note: best call today, worst call, one thing to watch tomorrow. Keeps the learning loop tight.",
      {
        confidence: 0.65,
        action: "Drop a quick note via record_insight",
        triggers: {
          source: "monitor_loop",
          eventType: "tick_journal_prompt",
          metadata: { hour: now.getUTCHours() },
        },
      },
    ),
  ];
}

// ============================================================================
// Reset — called on engine stop to clear internal state
// ============================================================================

export function resetPeriodicProducerState(): void {
  // No internal state to reset (the CDP-webhook whale-drain buffer was removed
  // with the Base/CDP stack). Kept for API stability with the engine lifecycle.
}
