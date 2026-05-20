/**
 * Pareto Frontier Tracker — PF1.
 *
 * Given N candidates each described by K numeric objectives plus a
 * per-objective direction (maximize / minimize), returns the
 * non-dominated set (the Pareto frontier) and a domination map.
 *
 * Candidate A *dominates* candidate B iff:
 *   1. A is at-least-as-good as B on every objective (using the
 *      direction), AND
 *   2. A is strictly better than B on at least one objective.
 *
 * The frontier is the subset of candidates with no dominators. Two
 * candidates with identical objective vectors do NOT dominate each
 * other; they both end up on the frontier (this is the standard
 * weak-Pareto definition).
 *
 * Generalizes Gordon's single-objective best-selection. Plausible
 * consumers:
 *   - harnessEvolution multi-objective selection: rank by (Sharpe,
 *     max-DD, latency, token-cost) rather than collapsing to one
 *     score
 *   - ACE lesson scoring: lessons compared on (score, context-cost)
 *     tradeoff rather than scalar
 *   - DEC1 vector predictions: an edit predicting multiple metric
 *     improvements is verified against the realized objective
 *     vector; verified iff realized dominates baseline
 *   - Strategy comparison: (Sharpe, drawdown, capacity) instead of
 *     Sharpe alone
 *
 * Pure compute. O(N² · K) dominance checks; fine for N up to a few
 * thousand candidates with K small.
 */

export const PARETO_FRONTIER_FLAG_ENV = "GORDON_PARETO_FRONTIER";

export function isParetoFrontierEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env[PARETO_FRONTIER_FLAG_ENV] === "1" || env[PARETO_FRONTIER_FLAG_ENV] === "true";
}

export type ObjectiveDirection = "maximize" | "minimize";

export interface ParetoCandidate {
  /** Stable identifier. Must be unique within the input set. */
  id: string;
  /** Numeric objectives keyed by name. */
  objectives: Record<string, number>;
  /** Free-form metadata preserved on the output. */
  metadata?: Record<string, unknown>;
}

export interface ParetoFrontierInput {
  candidates: ReadonlyArray<ParetoCandidate>;
  /** Direction per objective. Every key in any candidate must be covered. */
  directions: Record<string, ObjectiveDirection>;
}

export interface DominationEdge {
  /** Candidate id that is dominated. */
  candidateId: string;
  /** Candidate ids that dominate it (one or more). */
  dominatedBy: string[];
}

export interface ParetoFrontierResult {
  frontier: ParetoCandidate[];
  dominated: ParetoCandidate[];
  /** For every candidate id, the list of ids that dominate it. Frontier members have []. */
  dominationMap: Record<string, string[]>;
  nCandidates: number;
  nFrontier: number;
  objectives: string[];
  reasoning: string;
}

/**
 * Returns true iff `a` is at-least-as-good as `b` on every objective,
 * AND strictly better than `b` on at least one objective.
 */
export function dominates(
  a: ParetoCandidate,
  b: ParetoCandidate,
  directions: Record<string, ObjectiveDirection>,
): boolean {
  let strictlyBetterSomewhere = false;
  for (const key of Object.keys(directions)) {
    const av = a.objectives[key];
    const bv = b.objectives[key];
    if (av === undefined || bv === undefined) {
      throw new Error(`candidate "${a.id}" or "${b.id}" missing objective "${key}"`);
    }
    const dir = directions[key]!;
    // Normalize so larger == better; then check a >= b strictly somewhere.
    const aNorm = dir === "maximize" ? av : -av;
    const bNorm = dir === "maximize" ? bv : -bv;
    if (aNorm < bNorm) return false; // a is worse on this objective → no domination
    if (aNorm > bNorm) strictlyBetterSomewhere = true;
  }
  return strictlyBetterSomewhere;
}

function validateInputs(input: ParetoFrontierInput): { objKeys: string[] } {
  if (input.candidates.length === 0) {
    throw new Error("candidates must not be empty");
  }
  const objKeys = Object.keys(input.directions);
  if (objKeys.length === 0) {
    throw new Error("directions must not be empty");
  }
  for (const key of objKeys) {
    const dir = input.directions[key];
    if (dir !== "maximize" && dir !== "minimize") {
      throw new Error(`directions["${key}"] must be "maximize" or "minimize" (got "${dir}")`);
    }
  }
  const seenIds = new Set<string>();
  for (let i = 0; i < input.candidates.length; i++) {
    const c = input.candidates[i]!;
    if (!c.id || c.id.trim().length === 0) {
      throw new Error(`candidates[${i}].id must not be empty`);
    }
    if (seenIds.has(c.id)) {
      throw new Error(`duplicate candidate id "${c.id}"`);
    }
    seenIds.add(c.id);
    for (const key of objKeys) {
      const v = c.objectives[key];
      if (v === undefined) {
        throw new Error(`candidates[${i}] ("${c.id}") missing objective "${key}"`);
      }
      if (!Number.isFinite(v)) {
        throw new Error(`candidates[${i}] ("${c.id}") objective "${key}" must be finite (got ${v})`);
      }
    }
  }
  return { objKeys };
}

export function computeParetoFrontier(input: ParetoFrontierInput): ParetoFrontierResult {
  const { objKeys } = validateInputs(input);
  const n = input.candidates.length;

  // dominationMap: who dominates each candidate.
  const dominationMap: Record<string, string[]> = {};
  for (const c of input.candidates) dominationMap[c.id] = [];

  // O(n²) pairwise dominance check.
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      if (i === j) continue;
      const a = input.candidates[i]!;
      const b = input.candidates[j]!;
      if (dominates(a, b, input.directions)) {
        dominationMap[b.id]!.push(a.id);
      }
    }
  }

  const frontier: ParetoCandidate[] = [];
  const dominated: ParetoCandidate[] = [];
  for (const c of input.candidates) {
    if (dominationMap[c.id]!.length === 0) {
      frontier.push(c);
    } else {
      dominated.push(c);
    }
  }

  const reasoning =
    `Evaluated ${n} candidates across ${objKeys.length} objectives ` +
    `(${objKeys.map((k) => `${k}:${input.directions[k]}`).join(", ")}). ` +
    `Frontier size ${frontier.length}/${n} (${dominated.length} dominated). ` +
    (frontier.length > 0
      ? `Frontier members: ${frontier
          .slice(0, 5)
          .map((c) => c.id)
          .join(", ")}${frontier.length > 5 ? ` (+${frontier.length - 5} more)` : ""}.`
      : "No candidates on the frontier (this should be impossible — check inputs).");

  return {
    frontier,
    dominated,
    dominationMap,
    nCandidates: n,
    nFrontier: frontier.length,
    objectives: objKeys,
    reasoning,
  };
}

/**
 * Convenience: returns true iff a *weakly* dominates b (≥ on all
 * objectives, no strict-better-somewhere requirement). Useful for the
 * DEC1 verification path: realized objective vector should weakly
 * dominate the predicted threshold vector to be considered "verified".
 */
export function weaklyDominates(
  a: ParetoCandidate,
  b: ParetoCandidate,
  directions: Record<string, ObjectiveDirection>,
): boolean {
  for (const key of Object.keys(directions)) {
    const av = a.objectives[key];
    const bv = b.objectives[key];
    if (av === undefined || bv === undefined) {
      throw new Error(`candidate "${a.id}" or "${b.id}" missing objective "${key}"`);
    }
    const dir = directions[key]!;
    const aNorm = dir === "maximize" ? av : -av;
    const bNorm = dir === "maximize" ? bv : -bv;
    if (aNorm < bNorm) return false;
  }
  return true;
}

export function paretoFrontierToPayload(result: ParetoFrontierResult): Record<string, unknown> {
  return {
    kind: "pareto_frontier.computed",
    nCandidates: result.nCandidates,
    nFrontier: result.nFrontier,
    objectives: result.objectives,
    frontierIds: result.frontier.map((c) => c.id),
  };
}
