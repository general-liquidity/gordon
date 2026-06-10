/**
 * Producer Health Alert Producer
 *
 * Converts producer-health degradation into a normal radar card. The health
 * tracker remains the diagnostic source of truth; this producer makes stalled
 * or errored radar pipelines visible without the operator polling manually.
 */

import type { CandidateProducer } from "../../engine/proactiveEngine.ts";
import { buildCandidate } from "../../engine/proactiveEngine.ts";
import { getProducerHealthTracker } from "../../engine/producerHealth.ts";
import type { ProactiveSuggestion } from "../../types.ts";

const ALERT_COOLDOWN_MS = 30 * 60 * 1000;

let lastAlertSignature: string | null = null;
let lastAlertAt = 0;

export const producerHealthAlertProducer: CandidateProducer = async (obs): Promise<ProactiveSuggestion[]> => {
  if (obs.source !== "monitor_loop" || obs.eventType !== "tick_producer_health") return [];

  const report = getProducerHealthTracker().report();
  const unhealthy = report.producers.filter(
    (producer) =>
      producer.name !== "producerHealthAlert" &&
      (producer.status === "stale" || producer.status === "silent" || producer.status === "errored"),
  );

  if (unhealthy.length === 0) return [];

  const signature = unhealthy
    .map((producer) => `${producer.name}:${producer.status}:${producer.totalErrors}`)
    .sort()
    .join("|");
  const now = Date.now();
  if (signature === lastAlertSignature && now - lastAlertAt < ALERT_COOLDOWN_MS) {
    return [];
  }
  lastAlertSignature = signature;
  lastAlertAt = now;

  const errored = unhealthy.filter((producer) => producer.status === "errored");
  const stalled = unhealthy.filter((producer) => producer.status === "stale" || producer.status === "silent");
  const names = unhealthy.slice(0, 5).map((producer) => `${producer.name} (${producer.status})`).join(", ");
  const suffix = unhealthy.length > 5 ? `, +${unhealthy.length - 5} more` : "";

  return [
    buildCandidate(
      "risk_warning",
      "Radar producer health degraded",
      `Proactive radar health is ${report.overall}: ${unhealthy.length} producer(s) need attention. ` +
        `${errored.length} errored, ${stalled.length} stale/silent. Affected producers: ${names}${suffix}. ` +
        `Run the health diagnostic before trusting radar silence.`,
      {
        confidence: report.overall === "down" ? 0.92 : 0.78,
        action: "Run get_producer_health to inspect stalled or errored producers",
        triggers: {
          source: "monitor_loop",
          eventType: "tick_producer_health",
          metadata: {
            overall: report.overall,
            staleCount: report.staleCount,
            erroredCount: report.erroredCount,
            unhealthy: unhealthy.map((producer) => ({
              name: producer.name,
              status: producer.status,
              ageSeconds: producer.ageSeconds,
              totalErrors: producer.totalErrors,
              lastError: producer.lastError,
            })),
          },
        },
        operation: {
          tool: "get_producer_health",
          args: {},
          readOnly: true,
          description: "Inspect proactive producer health",
        },
      },
    ),
  ];
};

export function resetProducerHealthAlertProducerState(): void {
  lastAlertSignature = null;
  lastAlertAt = 0;
}
