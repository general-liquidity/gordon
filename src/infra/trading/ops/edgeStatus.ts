/**
 * Edge status — the infra bridge that makes an EDGE.md a LIVE monitor.
 *
 * This is the "monitor-invariants-live" phase of Edge-Driven Development: the
 * same EdgeSpec that gated the gauntlet is evaluated against live metrics on a
 * cadence, and its verdict is folded with the statistical decay monitor. Two
 * independent ways an edge dies, one verdict:
 *
 *   - INVARIANT failure (core/edge/monitor) — a stated precondition stopped
 *     holding (regime flipped, volume expanded, net edge went non-positive). A
 *     fired kill condition retires immediately.
 *   - DECAY (edgeDecayMonitor) — the realized R-multiples eroded vs baseline
 *     even while the invariants still nominally hold (crowding / imitation).
 *
 * Lives at infra because it composes a core primitive (pure invariant eval) with
 * an infra primitive (the decay monitor). core/ must not depend up into infra/,
 * so the composition has to happen here. Both share the EdgeHealth/DecayState
 * vocabulary, so composeHealth folds them into the more severe verdict.
 */

import {
  composeHealth,
  evaluateEdgeInvariants,
  type EdgeHealth,
  type EdgeMetrics,
  type EdgeSpec,
  type EdgeStatusResult,
} from "../../../core/edge/index.ts";
import { evaluateDecay, type DecayResult } from "./edgeDecayMonitor.ts";

export interface EdgeAssessment {
  edge: string;
  /** Folded verdict — the more severe of the invariant and decay verdicts. */
  health: EdgeHealth;
  /** Result of evaluating invariants + kill conditions against live metrics. */
  invariants: EdgeStatusResult;
  /** Decay verdict, present only when realized R-multiples were supplied. */
  decay?: DecayResult;
  /** 0 when retiring; the decay monitor's continuous scale-down otherwise. An
   *  invariant-only "degraded" verdict does not itself prescribe a size — it is a
   *  flag for the caller, so the multiplier stays at the decay value (1 if no
   *  decay data). */
  recommendedSizeMultiplier: number;
  reason: string;
}

/**
 * Assess a live edge: evaluate its invariants against current metrics, and —
 * when realized R-multiples are supplied — fold in the statistical decay verdict.
 */
export function assessEdge(
  spec: EdgeSpec,
  metrics: EdgeMetrics,
  rMultiples?: ReadonlyArray<number>,
): EdgeAssessment {
  const invariants = evaluateEdgeInvariants(spec, metrics);

  let decay: DecayResult | undefined;
  let health = invariants.health;
  const reasons = [invariants.reason];

  if (rMultiples && rMultiples.length > 0) {
    decay = evaluateDecay({ setupId: spec.name, rMultiples });
    health = composeHealth(health, decay.state);
    if (decay.state !== "stable") reasons.push(`decay: ${decay.reason}`);
  }

  const recommendedSizeMultiplier =
    health === "retire" ? 0 : (decay?.recommendedSizeMultiplier ?? 1);

  return {
    edge: spec.name,
    health,
    invariants,
    ...(decay ? { decay } : {}),
    recommendedSizeMultiplier,
    reason: reasons.join("; "),
  };
}
