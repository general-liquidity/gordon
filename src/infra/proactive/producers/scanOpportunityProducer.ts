/**
 * Scan Opportunity Producer
 *
 * Converts `scan:opportunity` events from Gordon's scanner into proactive
 * candidates when the opportunity is high-confidence AND passes relevance
 * filters. The idea: if the user isn't watching the terminal but a
 * scanner finds a strong setup, surface it so they don't miss the window.
 *
 * Fires as `missed_entry` if the confidence is >= 0.7. Lower-confidence
 * opportunities are intentionally silent — we don't want proactive mode
 * to devolve into a scan-opportunity firehose.
 */

import type { CandidateProducer } from "../engine/proactiveEngine.ts";
import { buildCandidate } from "../engine/proactiveEngine.ts";
import type { ProactiveSuggestion } from "../types.ts";

const MIN_OPPORTUNITY_CONFIDENCE = 0.7;

export const scanOpportunityProducer: CandidateProducer = (obs): ProactiveSuggestion[] => {
  if (obs.source !== "event_bus" || obs.eventType !== "scan:opportunity") return [];

  const symbol = obs.symbol ?? (obs.metadata?.symbol as string | undefined);
  const scannerConfidence = typeof obs.metadata?.confidence === "number"
    ? (obs.metadata.confidence as number)
    : undefined;
  const bias = obs.metadata?.bias as string | undefined;

  if (!symbol || scannerConfidence === undefined || scannerConfidence < MIN_OPPORTUNITY_CONFIDENCE) {
    return [];
  }

  const title = `Scanner found ${symbol}${bias ? ` (${bias})` : ""}`;
  const body =
    `Gordon's scanner flagged ${symbol} with confidence ${(scannerConfidence * 100).toFixed(0)}%. ` +
    `${bias ? `Bias: ${bias}. ` : ""}If this setup matches your watchlist, review the chart before the move decays.`;

  return [
    buildCandidate("missed_entry", title, body, {
      confidence: Math.min(0.95, scannerConfidence),
      action: `Run /dd ${symbol} or get_technical_analysis for a full read`,
      triggers: {
        source: "event_bus",
        eventType: "scan:opportunity",
        symbol,
        metadata: { scannerConfidence, bias, raw: obs.metadata },
      },
    }),
  ];
};
