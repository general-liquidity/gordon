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

import type { CandidateProducer } from "../proactiveEngine.ts";
import { buildCandidate } from "../proactiveEngine.ts";
import type { ProactiveSuggestion } from "../types.ts";
import { getCdpWebhookReceiver } from "../../data/providers/cdpWebhookReceiver.ts";

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

    case "tick_whale_drain":
      candidates.push(...drainWhaleBuffer());
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
// Whale alert drain — pulls verified large transfers from CDP webhook receiver
// ============================================================================

// Track last processed webhook event id so we don't re-fire on the same event.
let lastProcessedWebhookEventId = 0;
const WHALE_VALUE_THRESHOLD_USD = 100_000;

function drainWhaleBuffer(): ProactiveSuggestion[] {
  const receiver = getCdpWebhookReceiver();
  if (!receiver.isRunning()) return [];

  // Pull the newest events, filter to verified ones we haven't processed yet
  const recent = receiver.getRecentEvents(50, true);
  const candidates: ProactiveSuggestion[] = [];

  for (const event of recent) {
    if (event.id <= lastProcessedWebhookEventId) continue;
    lastProcessedWebhookEventId = Math.max(lastProcessedWebhookEventId, event.id);

    // Extract value from ERC20 transfer events — CDP webhook payloads include
    // eventType and value in the payload object. Shape varies by event_type.
    const payload = event.payload as Record<string, unknown> | undefined;
    if (!payload) continue;
    const eventType = payload.eventType as string | undefined;
    if (eventType && !/(transfer|wallet_activity)/i.test(eventType)) continue;

    // Try to extract a rough USD value estimate from the payload
    const valueUsd = estimateValueUsd(payload);
    if (valueUsd < WHALE_VALUE_THRESHOLD_USD) continue;

    const fromAddress = (payload.from as string | undefined) ?? "unknown";
    const toAddress = (payload.to as string | undefined) ?? "unknown";
    const tokenSymbol = (payload.symbol as string | undefined) ?? "unknown token";

    candidates.push(
      buildCandidate(
        "whale_alert",
        `Whale transfer: ~$${(valueUsd / 1000).toFixed(0)}k ${tokenSymbol}`,
        `A verified CDP webhook event flagged a transfer of ~$${valueUsd.toLocaleString()} in ${tokenSymbol} ` +
          `from ${shortAddr(fromAddress)} to ${shortAddr(toAddress)}. ` +
          `Worth checking whether the destination is a known exchange or accumulation address.`,
        {
          confidence: valueUsd > 1_000_000 ? 0.88 : 0.72,
          action: `Inspect the addresses or query recent flows for ${tokenSymbol}`,
          triggers: {
            source: "webhook",
            eventType: "erc20_transfer",
            symbol: tokenSymbol,
            metadata: {
              from: fromAddress,
              to: toAddress,
              valueUsd,
              webhookEventId: event.eventId,
            },
          },
        },
      ),
    );
  }

  return candidates;
}

function estimateValueUsd(payload: Record<string, unknown>): number {
  // Best-effort extraction. Webhook payloads can have valueUsd, value + price,
  // or raw on-chain value — each shape is handled.
  if (typeof payload.valueUsd === "number") return payload.valueUsd;
  const value = typeof payload.value === "number" ? payload.value : Number(payload.value);
  const price = typeof payload.price === "number" ? payload.price : 0;
  if (Number.isFinite(value) && Number.isFinite(price) && price > 0) {
    return value * price;
  }
  if (Number.isFinite(value)) return value;
  return 0;
}

function shortAddr(addr: string): string {
  if (!addr || addr.length < 12) return addr;
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

// ============================================================================
// Reset — called on engine stop to clear internal state
// ============================================================================

export function resetPeriodicProducerState(): void {
  lastProcessedWebhookEventId = 0;
}
