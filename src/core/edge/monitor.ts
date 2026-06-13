/**
 * Evaluate an EdgeSpec's invariants + kill conditions against live metrics.
 *
 * This is the EDD step Spec-Driven Development has no analogue for: the same
 * machine-readable conditions that gate a backtest gate the RUNNING edge, so an
 * edge that stops being true in live markets is retired automatically.
 *
 * Pure — no I/O, no infra imports. The composition with the statistical decay
 * monitor (edgeDecayMonitor) lives at the infra layer (edgeStatus.ts), which can
 * depend on core; core does not depend up into infra. They share the EdgeHealth
 * vocabulary so composeHealth() folds the two verdicts.
 */

import type { EdgeHealth, EdgeInvariant, EdgeSpec, EdgeStatusResult, InvariantCheck } from "./types.ts";

export type EdgeMetrics = Record<string, number | string | undefined>;

/** Evaluate one condition (invariant or kill) against a metrics bag. Returns
 *  whether the condition AS WRITTEN is true. A missing metric → not satisfied
 *  (we can't confirm the condition either way). */
export function evaluateCondition(cond: EdgeInvariant, metrics: EdgeMetrics): InvariantCheck {
  const value = metrics[cond.metric];
  let satisfied = false;
  if (value !== undefined) {
    const num = Number(value);
    const set = (cond.threshold as string[]).map?.(String) ?? [];
    switch (cond.comparator) {
      case ">": satisfied = num > Number(cond.threshold); break;
      case ">=": satisfied = num >= Number(cond.threshold); break;
      case "<": satisfied = num < Number(cond.threshold); break;
      case "<=": satisfied = num <= Number(cond.threshold); break;
      case "==": satisfied = String(value) === String(cond.threshold); break;
      case "!=": satisfied = String(value) !== String(cond.threshold); break;
      case "in": satisfied = set.includes(String(value)); break;
      case "not-in": satisfied = !set.includes(String(value)); break;
    }
  }
  return { invariant: cond, value, satisfied };
}

/**
 * Evaluate every invariant + kill condition for an edge.
 *
 *   - An invariant must be satisfied (hold). A violated invariant → degraded.
 *   - A kill condition that fires (is satisfied) → retire (takes precedence).
 *   - All invariants hold, no kill fires → stable.
 *
 * Missing metrics fail SAFE: an invariant whose metric is absent counts as
 * violated (we can't confirm it holds → degraded), but an absent kill metric
 * does NOT fire (we won't spuriously retire on missing data).
 */
export function evaluateEdgeInvariants(spec: EdgeSpec, metrics: EdgeMetrics): EdgeStatusResult {
  const violatedInvariants = spec.invariants
    .map((inv) => evaluateCondition(inv, metrics))
    .filter((c) => !c.satisfied);
  const firedKills = spec.killConditions
    .map((k) => evaluateCondition(k, metrics))
    .filter((c) => c.satisfied);

  let health: EdgeHealth;
  let reason: string;
  if (firedKills.length > 0) {
    health = "retire";
    reason = `Kill condition${firedKills.length > 1 ? "s" : ""} fired: ${firedKills.map((c) => c.invariant.id).join(", ")}`;
  } else if (violatedInvariants.length > 0) {
    health = "degraded";
    reason = `Invariant${violatedInvariants.length > 1 ? "s" : ""} violated: ${violatedInvariants.map((c) => c.invariant.id).join(", ")}`;
  } else {
    health = "stable";
    reason = `All ${spec.invariants.length} invariants hold; no kill conditions fired`;
  }
  return { health, violatedInvariants, firedKills, reason };
}

const SEVERITY: Record<EdgeHealth, number> = { stable: 0, degraded: 1, retire: 2 };

/** Fold two health verdicts into the more severe one. Used to combine the
 *  invariant verdict with the statistical edgeDecayMonitor verdict (which shares
 *  this vocabulary) at the infra layer. */
export function composeHealth(a: EdgeHealth, b: EdgeHealth): EdgeHealth {
  return SEVERITY[a] >= SEVERITY[b] ? a : b;
}
