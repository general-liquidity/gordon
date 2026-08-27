/**
 * Iterated Local Search (GORDON_ITERATED_LOCAL_SEARCH).
 *
 * Port of Ch 6 (Iterated Local Search) from Dolzhenko, "Algorithmic
 * Trading Systems and Strategies: A New Approach" (Apress 2024).
 *
 * Meta-algorithm that wraps a caller-provided LOCAL search step with a
 * caller-provided PERTURBATION operator. After each local-optimum is
 * found, the result is perturbed and used as the seed for the next local
 * search, allowing escape from local optima while preserving information
 * across restarts.
 *
 * Direct quote (Ch 6, Iterated Local Search): "The idea of this algorithm
 * is to use perturbation of the previous solution found instead of
 * generating starting points randomly. The problem with this approach is
 * that it is necessary to overcome the local extremum zone … perturbation
 * should be strong enough, but it should not be too strong. Otherwise,
 * this algorithm will differ little from the random restarts algorithm."
 *
 * Composes with `simulatedAnnealing.ts` (use SA as the local-search step)
 * and Gordon's existing parameter-tuning surface. Acceptance rule is
 * configurable:
 *   - "improve-only": only accept perturbation results that strictly
 *     improve the best-so-far
 *   - "metropolis": SA-style acceptance with a fixed temperature
 *
 * Pure compute. No I/O. Deterministic seeded LCG RNG.
 */

export type AcceptanceRule = "improve-only" | "metropolis";

export interface LocalSearchOutcome {
  state: number[];
  value: number;
}

export interface IteratedLocalSearchInput {
  /** Local-search step. Receives a seed state, returns a (possibly improved) state and its objective value. */
  localSearch: (seed: ReadonlyArray<number>) => LocalSearchOutcome;
  /** Perturbation operator. Takes the current best and produces a perturbed seed for the next local search. */
  perturb: (state: ReadonlyArray<number>, rng: () => number) => number[];
  /** Initial state. */
  initialState: ReadonlyArray<number>;
  /** Max outer iterations (perturbation+local-search cycles). Default 20. */
  maxRestarts?: number;
  /** Stop if no improvement for this many restarts. Default Infinity. */
  stagnationLimit?: number;
  /** Acceptance rule. Default "improve-only". */
  acceptance?: AcceptanceRule;
  /** Temperature for "metropolis" acceptance. Default 0.1. */
  temperature?: number;
  /** RNG seed. Default 1. */
  seed?: number;
}

export interface IteratedLocalSearchResult {
  bestState: number[];
  bestValue: number;
  restartsRun: number;
  acceptedRestarts: number;
  stagnated: boolean;
  /** Per-restart best-of-restart value (for diagnostics). */
  restartHistory: number[];
  reasoning: string;
}

function makeLCG(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}

export function computeIteratedLocalSearch(
  input: IteratedLocalSearchInput,
): IteratedLocalSearchResult {
  const maxRestarts = input.maxRestarts ?? 20;
  const stagnationLimit = input.stagnationLimit ?? Number.POSITIVE_INFINITY;
  const acceptance: AcceptanceRule = input.acceptance ?? "improve-only";
  const T = input.temperature ?? 0.1;
  if (acceptance === "metropolis" && T <= 0) {
    throw new Error("temperature must be positive for metropolis acceptance");
  }
  const rng = makeLCG(input.seed ?? 1);

  // Initial local search
  let current = input.localSearch(input.initialState);
  let best: LocalSearchOutcome = { state: [...current.state], value: current.value };
  const history: number[] = [current.value];
  let stagnation = 0;
  let stagnated = false;
  let accepted = 0;
  let r = 0;

  for (; r < maxRestarts; r++) {
    const seedState = input.perturb(current.state, rng);
    const outcome = input.localSearch(seedState);

    let accept = false;
    if (acceptance === "improve-only") {
      accept = outcome.value > current.value;
    } else {
      // metropolis
      if (outcome.value >= current.value) {
        accept = true;
      } else {
        const p = Math.exp((outcome.value - current.value) / T);
        accept = rng() < p;
      }
    }

    if (accept) {
      current = { state: [...outcome.state], value: outcome.value };
      accepted++;
    }
    if (outcome.value > best.value) {
      best = { state: [...outcome.state], value: outcome.value };
      stagnation = 0;
    } else {
      stagnation++;
    }
    history.push(best.value);

    if (stagnation >= stagnationLimit) {
      stagnated = true;
      r++;
      break;
    }
  }

  const reasoning =
    `restarts=${r}/${maxRestarts}, accepted=${accepted}, ` +
    `acceptance=${acceptance}, best=${best.value.toFixed(6)}` +
    (stagnated ? " (stagnated)" : "");

  return {
    bestState: best.state,
    bestValue: best.value,
    restartsRun: r,
    acceptedRestarts: accepted,
    stagnated,
    restartHistory: history,
    reasoning,
  };
}

export function iteratedLocalSearchToPayload(
  result: IteratedLocalSearchResult,
): Record<string, unknown> {
  return {
    kind: "iterated_local_search.computed",
    bestValue: Number(result.bestValue.toFixed(8)),
    restartsRun: result.restartsRun,
    acceptedRestarts: result.acceptedRestarts,
    stagnated: result.stagnated,
    bestState: result.bestState.map((x) => Number(x.toFixed(6))),
    improvementOverInitial: Number((result.bestValue - result.restartHistory[0]!).toFixed(6)),
  };
}
