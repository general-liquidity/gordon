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

/**
 * Per-task Pareto frontier (GEPA, arXiv:2507.19457) — SPECIALIST PRESERVATION.
 *
 * Standard `computeParetoFrontier` ranks candidates on K shared OBJECTIVES and
 * drops anything aggregate-dominated — which throws away a strategy that is the
 * *sole winner* in one regime/task but mediocre on average. GEPA's per-TASK
 * frontier keeps it: a candidate survives if it wins ≥1 task, and is pruned only
 * by set-cover dominance (another candidate wins a strict superset of its tasks).
 *
 * Trading use: score candidate strategies across a panel of tasks (regimes /
 * symbols / horizons); the frontier is the minimal set that covers every task's
 * winner — the regime specialists aggregate Sharpe would have hidden. Pure;
 * deterministic (no stochastic exploration sampling — Gordon wants the set, not
 * the next-explore pick).
 */

export interface PerTaskCandidate {
  id: string;
  /** Score per task; higher is better unless direction = "minimize". */
  taskScores: Record<string, number>;
}

export interface ParetoPerTaskResult {
  /** Specialist-preserving frontier (candidate ids), after set-cover pruning. */
  frontier: string[];
  /** task -> winner candidate ids (ties kept). */
  perTaskWinners: Record<string, string[]>;
  /** frontier candidate id -> tasks it wins. */
  wonTasks: Record<string, string[]>;
  /** candidates that win no task or are set-cover-dominated. */
  dropped: string[];
  nCandidates: number;
  nFrontier: number;
}

const PARETO_TASK_EPS = 1e-9;

export function computeParetoPerTask(
  candidates: PerTaskCandidate[],
  opts: { direction?: ObjectiveDirection; tasks?: string[] } = {},
): ParetoPerTaskResult {
  const direction = opts.direction ?? "maximize";
  const tasks =
    opts.tasks ?? Array.from(new Set(candidates.flatMap((c) => Object.keys(c.taskScores))));

  const better = (a: number, b: number): boolean => (direction === "maximize" ? a > b : a < b);

  // Per-task winners (ties within EPS all count).
  const perTaskWinners: Record<string, string[]> = {};
  for (const task of tasks) {
    let best: number | null = null;
    for (const c of candidates) {
      const v = c.taskScores[task];
      if (v === undefined) continue;
      if (best === null || better(v, best)) best = v;
    }
    perTaskWinners[task] =
      best === null ? [] : candidates.filter((c) => c.taskScores[task] !== undefined && Math.abs(c.taskScores[task]! - best!) <= PARETO_TASK_EPS).map((c) => c.id);
  }

  // wins[id] = set of tasks this candidate wins.
  const wins = new Map<string, Set<string>>();
  for (const c of candidates) wins.set(c.id, new Set());
  for (const task of tasks) for (const id of perTaskWinners[task]!) wins.get(id)!.add(task);

  const winners = candidates.filter((c) => wins.get(c.id)!.size > 0);

  // Set-cover dominance: drop C if some other winner D wins a STRICT superset of C's tasks.
  const isStrictSuperset = (sup: Set<string>, sub: Set<string>): boolean => {
    if (sup.size <= sub.size) return false;
    for (const t of sub) if (!sup.has(t)) return false;
    return true;
  };
  const frontier = winners.filter(
    (c) => !winners.some((d) => d.id !== c.id && isStrictSuperset(wins.get(d.id)!, wins.get(c.id)!)),
  );

  const frontierIds = new Set(frontier.map((c) => c.id));
  const wonTasks: Record<string, string[]> = {};
  for (const c of frontier) wonTasks[c.id] = Array.from(wins.get(c.id)!).sort();

  return {
    frontier: frontier.map((c) => c.id),
    perTaskWinners,
    wonTasks,
    dropped: candidates.filter((c) => !frontierIds.has(c.id)).map((c) => c.id),
    nCandidates: candidates.length,
    nFrontier: frontier.length,
  };
}
