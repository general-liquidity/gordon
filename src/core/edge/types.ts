/**
 * Edge-Driven Development (EDD) — types for the EDGE.md spec.
 *
 * An EdgeSpec is EDD's falsifiable unit: a thesis with a mechanism (who is on
 * the wrong side and why the inefficiency exists), a set of machine-readable
 * INVARIANTS that must hold for the edge to be valid, and KILL CONDITIONS that,
 * when true, retire it. Invariants and kills share one shape — a comparison of a
 * named live metric against a threshold — so the spec doubles as a live monitor
 * (monitor.ts): the same conditions that gate a backtest gate the running edge.
 *
 * That continuous re-verification is the step Spec-Driven Development has no
 * analogue for: code is static, an edge decays, so an edge has to keep being
 * true in live markets or it gets retired.
 */

export type Comparator = ">" | ">=" | "<" | "<=" | "==" | "!=" | "in" | "not-in";

export type EdgeStatus = "proposed" | "verified" | "live" | "retired";

/** Health verdict vocabulary — deliberately the same as edgeDecayMonitor's
 *  DecayState, so the two can be composed (see infra/trading/ops/edgeStatus.ts). */
export type EdgeHealth = "stable" | "degraded" | "retire";

export interface EdgeInvariant {
  /** Stable id, e.g. "ev-net-positive". */
  id: string;
  /** The live metric key this checks, e.g. "netEdgeBps", "regime", "winRate". */
  metric: string;
  comparator: Comparator;
  /** number for numeric comparators; string[] for in/not-in; string otherwise. */
  threshold: number | string | string[];
  description: string;
}

export interface EdgeSpec {
  name: string;
  /** Playbook id this edge drives — the STRATEGY.md / "how". */
  strategy: string;
  status: EdgeStatus;
  /** Regimes in which the edge is claimed to hold. */
  regime: string[];
  instruments: string[];
  /** The thesis + mechanism: who is trapped/wrong, why the inefficiency exists. */
  hypothesis: string;
  /** Conditions that must HOLD for the edge to be valid. */
  invariants: EdgeInvariant[];
  /** Conditions that, when TRUE, retire the edge. */
  killConditions: EdgeInvariant[];
  /** Free-text gauntlet record (backtest / permutation / walk-forward /
   *  adversarial / incubation). Optional until the edge is verified. */
  verification?: string;
}

export interface InvariantCheck {
  invariant: EdgeInvariant;
  /** The metric value seen, or undefined if the metric was absent. */
  value: number | string | undefined;
  /** Whether the condition (as written) evaluated true. */
  satisfied: boolean;
}

export interface EdgeStatusResult {
  /** stable = every invariant holds and no kill fired; degraded = an invariant
   *  was violated; retire = a kill condition fired (takes precedence). */
  health: EdgeHealth;
  /** Invariants that did NOT hold. */
  violatedInvariants: InvariantCheck[];
  /** Kill conditions that fired. */
  firedKills: InvariantCheck[];
  reason: string;
}
