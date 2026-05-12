/**
 * Risk Producer
 *
 * Converts risk-related events into proactive candidates:
 *   - `risk:rejected`         → risk_warning (a proposed action was blocked)
 *   - `autonomous:mandate_breached` → risk_warning (the autonomous loop
 *                                      breached its mandate — user needs to
 *                                      decide whether to adjust or stop)
 *
 * These are high-signal events — users need to know when the risk kernel
 * rejects an order or when the autonomous loop decided to stop itself. They
 * fire at high confidence since the underlying check is authoritative.
 */

import type { CandidateProducer } from "../../engine/proactiveEngine.ts";
import { buildCandidate } from "../../engine/proactiveEngine.ts";
import type { ProactiveSuggestion } from "../../types.ts";

export const riskProducer: CandidateProducer = (obs): ProactiveSuggestion[] => {
  if (obs.source !== "event_bus") return [];
  const candidates: ProactiveSuggestion[] = [];

  if (obs.eventType === "risk:rejected") {
    const reason = (obs.metadata?.reason as string | undefined) ?? "risk checks failed";
    const symbol = obs.symbol ?? (obs.metadata?.symbol as string | undefined) ?? "a symbol";
    const checks = (obs.metadata?.checks as string[] | undefined) ?? [];
    candidates.push(
      buildCandidate(
        "risk_warning",
        `Risk kernel rejected a ${symbol} order`,
        `The risk kernel blocked a proposed order on ${symbol}. Reason: ${reason}. ` +
          `${checks.length > 0 ? `Failed checks: ${checks.join(", ")}. ` : ""}` +
          `Review the trade idea against your risk budget before retrying.`,
        {
          confidence: 0.9,
          action: `Inspect your risk config via /risk-check or adjust the plan`,
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

  if (obs.eventType === "autonomous:mandate_breached") {
    const reason = (obs.metadata?.reason as string | undefined) ?? "mandate breach detected";
    const mandateId = (obs.metadata?.mandateId as string | undefined) ?? "unknown";
    candidates.push(
      buildCandidate(
        "risk_warning",
        "Autonomous mandate breached — loop halted",
        `The autonomous loop on mandate ${mandateId} breached its constraints and paused itself. ` +
          `Reason: ${reason}. Review the breach details and decide whether to adjust the mandate ` +
          `or stop the loop entirely before resuming.`,
        {
          confidence: 0.95,
          action: "Check get_autonomous_status and decide: adjust mandate, resume, or stop",
          triggers: {
            source: "event_bus",
            eventType: obs.eventType,
            metadata: obs.metadata,
          },
        },
      ),
    );
  }

  return candidates;
};
