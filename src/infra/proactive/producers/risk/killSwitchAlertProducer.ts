/**
 * Kill Switch Alert Producer
 *
 * Periodic producer that surfaces tripped kill switches as a proactive radar
 * card. Execution is already blocked at the tool layer via isExecutionAllowed;
 * this makes tripped switches visible without the operator running /killswitch.
 */

import type { CandidateProducer } from "../../engine/proactiveEngine.ts";
import { buildCandidate } from "../../engine/proactiveEngine.ts";
import type { ProactiveSuggestion } from "../../types.ts";
import { listTrippedSwitches, type KillSwitchKey } from "../../../safety/killSwitches.ts";

const ALERT_COOLDOWN_MS = 15 * 60 * 1000;

let lastAlertSignature: string | null = null;
let lastAlertAt = 0;

function keyLabel(key: KillSwitchKey): string {
  return key.id ? `${key.scope}:${key.id}` : key.scope;
}

export const killSwitchAlertProducer: CandidateProducer = async (obs): Promise<ProactiveSuggestion[]> => {
  if (obs.source !== "monitor_loop" || obs.eventType !== "tick_kill_switch") return [];

  const trips = listTrippedSwitches();
  if (trips.length === 0) return [];

  const signature = trips
    .map((trip) => `${keyLabel(trip.key)}:${trip.trippedAt}:${trip.reason}`)
    .sort()
    .join("|");
  const now = Date.now();
  if (signature === lastAlertSignature && now - lastAlertAt < ALERT_COOLDOWN_MS) {
    return [];
  }
  lastAlertSignature = signature;
  lastAlertAt = now;

  const summary = trips
    .slice(0, 5)
    .map((trip) => `${keyLabel(trip.key)} (${trip.reason})`)
    .join(", ");
  const suffix = trips.length > 5 ? `, +${trips.length - 5} more` : "";

  return [
    buildCandidate(
      "risk_warning",
      "Kill switch tripped — execution blocked",
      `${trips.length} kill switch(es) are active. Execution is blocked until reset. ` +
        `Tripped: ${summary}${suffix}. Run /killswitch list to inspect and reset when safe.`,
      {
        confidence: 0.95,
        action: "/killswitch list",
        triggers: {
          source: "monitor_loop",
          eventType: "tick_kill_switch",
          metadata: {
            tripCount: trips.length,
            trips: trips.map((trip) => ({
              scope: trip.key.scope,
              id: trip.key.id,
              reason: trip.reason,
              trippedAt: trip.trippedAt,
            })),
          },
        },
      },
    ),
  ];
};

export function resetKillSwitchAlertProducerState(): void {
  lastAlertSignature = null;
  lastAlertAt = 0;
}