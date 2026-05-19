/**
 * Order Lifecycle Reconstruction (GORDON_LIFECYCLE_RECONSTRUCTION).
 *
 * Section 7.3 of the microstructure piece: surveillance must reconstruct
 * the full chain — order entry → modification → queue movement → partial
 * fill → cancellation → replacement → related execution → cross-venue
 * activity → position change → PnL impact.
 *
 * Gordon already emits structured observations per gate verdict (Axiom)
 * and decisionLog JSONL per decision. This module provides the *query
 * layer* that stitches those streams into a per-order or per-plan
 * forensic timeline, with toxicity scoring per the article's "intent
 * through structure" principle.
 *
 * Pure compute on already-recorded events. No new producers — uses
 * whatever audit data is already flowing.
 */

export const LIFECYCLE_RECONSTRUCTION_FLAG_ENV = "GORDON_LIFECYCLE_RECONSTRUCTION";

export function isLifecycleReconstructionEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return (
    env[LIFECYCLE_RECONSTRUCTION_FLAG_ENV] === "1" ||
    env[LIFECYCLE_RECONSTRUCTION_FLAG_ENV] === "true"
  );
}

export type LifecycleEventKind =
  | "plan_emitted"
  | "permission_checked"
  | "order_submitted"
  | "order_modified"
  | "order_partial_fill"
  | "order_filled"
  | "order_cancelled"
  | "order_replaced"
  | "related_execution"
  | "position_changed"
  | "pnl_recorded";

export interface LifecycleEvent {
  t: number;
  kind: LifecycleEventKind;
  /** Plan id or order id correlation key. */
  correlationId: string;
  /** Optional sub-kind (e.g. fill price, cancel reason). */
  meta?: Record<string, unknown>;
}

export interface ReconstructionInput {
  events: ReadonlyArray<LifecycleEvent>;
  correlationId: string;
  /** Suspicious-pattern signature thresholds. */
  suspiciousCancelWithinMs?: number; // default 200
  suspiciousModifyCount?: number; // default 5
}

export type Anomaly =
  | "rapid_cancel_after_submit"
  | "excessive_modifications"
  | "cancel_without_intermediate_fill"
  | "missing_permission_check"
  | "fill_before_submit_event";

export interface ReconstructionResult {
  correlationId: string;
  eventCount: number;
  timeline: LifecycleEvent[];
  anomalies: Anomaly[];
  toxicityHints: string[];
  durationMs: number;
  reason: string;
}

const DEFAULT_SUSPICIOUS_CANCEL_MS = 200;
const DEFAULT_SUSPICIOUS_MODIFY_COUNT = 5;

export function reconstructLifecycle(input: ReconstructionInput): ReconstructionResult {
  const timeline = input.events
    .filter((e) => e.correlationId === input.correlationId)
    .sort((a, b) => a.t - b.t);

  if (timeline.length === 0) {
    return {
      correlationId: input.correlationId,
      eventCount: 0,
      timeline: [],
      anomalies: [],
      toxicityHints: [],
      durationMs: 0,
      reason: "no events for correlation id",
    };
  }

  const cancelMs = input.suspiciousCancelWithinMs ?? DEFAULT_SUSPICIOUS_CANCEL_MS;
  const modifyCount = input.suspiciousModifyCount ?? DEFAULT_SUSPICIOUS_MODIFY_COUNT;

  const anomalies = new Set<Anomaly>();
  const hints: string[] = [];

  let submitAt: number | null = null;
  let modifyCounter = 0;
  let intermediateFillSeen = false;
  let permissionSeen = false;
  let firstFillBeforeSubmit = false;

  for (const e of timeline) {
    if (e.kind === "permission_checked") permissionSeen = true;
    if (e.kind === "order_submitted") {
      submitAt = e.t;
      modifyCounter = 0;
      intermediateFillSeen = false;
    }
    if (e.kind === "order_modified") modifyCounter += 1;
    if (e.kind === "order_partial_fill" || e.kind === "order_filled") {
      if (submitAt === null) firstFillBeforeSubmit = true;
      intermediateFillSeen = true;
    }
    if (e.kind === "order_cancelled" && submitAt !== null) {
      const dt = e.t - submitAt;
      if (dt <= cancelMs) anomalies.add("rapid_cancel_after_submit");
      if (!intermediateFillSeen) anomalies.add("cancel_without_intermediate_fill");
    }
  }

  if (modifyCounter >= modifyCount) anomalies.add("excessive_modifications");
  if (!permissionSeen) anomalies.add("missing_permission_check");
  if (firstFillBeforeSubmit) anomalies.add("fill_before_submit_event");

  if (anomalies.has("rapid_cancel_after_submit") && anomalies.has("cancel_without_intermediate_fill")) {
    hints.push("matches quote-stuffing cancel signature");
  }
  if (anomalies.has("excessive_modifications")) {
    hints.push("layered-stuffing modification pattern");
  }
  if (anomalies.has("missing_permission_check")) {
    hints.push("permission audit gap — investigate runtime");
  }

  const durationMs = timeline[timeline.length - 1]!.t - timeline[0]!.t;
  const reason =
    anomalies.size === 0
      ? `clean lifecycle: ${timeline.length} events over ${durationMs}ms`
      : `${anomalies.size} anomal(ies) over ${durationMs}ms`;

  return {
    correlationId: input.correlationId,
    eventCount: timeline.length,
    timeline,
    anomalies: Array.from(anomalies),
    toxicityHints: hints,
    durationMs,
    reason,
  };
}

export function lifecycleToPayload(result: ReconstructionResult): Record<string, unknown> {
  return {
    kind: "lifecycle_reconstruction.evaluated",
    correlationId: result.correlationId,
    eventCount: result.eventCount,
    anomalyCount: result.anomalies.length,
    anomalies: result.anomalies,
    toxicityHints: result.toxicityHints,
    durationMs: result.durationMs,
  };
}
