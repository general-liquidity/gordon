/**
 * Simulated Annealing Optimizer (GORDON_SIMULATED_ANNEALING).
 *
 * Port of Ch 6 (Random Search Algorithms → Simulated Annealing) from
 * Dolzhenko, "Algorithmic Trading Systems and Strategies: A New Approach"
 * (Apress 2024).
 *
 * Single-state global optimization via thermal-acceptance random walk.
 * Periodically accepts WORSE solutions with probability exp(-Δf/T), where
 * T cools over iterations. This allows escape from local optima — the
 * key advantage over pure local search.
 *
 * Direct quote (Ch 6, Simulated Annealing): "The main difference between
 * this algorithm and others is that it allows periodic deterioration of
 * the solution to the optimization problem … Improvement of the solution
 * occurs due to periodic changes in the found solution, the intensity of
 * which decreases as it approaches the optimal solution."
 *
 * Algorithm:
 *   1. Start at x₀, evaluate f(x₀). Set T = T₀.
 *   2. Propose x' = x + Gaussian perturbation in bounded space.
 *   3. If f(x') > f(x): accept unconditionally.
 *      Else: accept with probability exp((f(x') − f(x)) / T).
 *   4. Cool: T ← T × coolingRate.
 *   5. Loop until maxIterations or stagnation.
 *
 * Suitable for: strategy parameter tuning (e.g. optimising RSI period,
 * barrier thresholds, lookback windows) where the objective is non-smooth,
 * multi-modal, and expensive to evaluate. The objective MAY be stochastic
 * — SA tolerates noise well via its acceptance criterion.
 *
 * Complements Gordon's existing `optimizationQuality.ts` (which scores
 * the result of an optimization) by providing the optimizer itself.
 *
 * Pure compute. No I/O. Deterministic seeded LCG RNG for reproducibility.
 */

export interface SimulatedAnnealingInput {
  /** Objective function to MAXIMISE. */
  objective: (x: ReadonlyArray<number>) => number;
  /** Starting state. */
  initialState: ReadonlyArray<number>;
  /** Search-space bounds per dimension as [min, max]. */
  bounds: ReadonlyArray<readonly [number, number]>;
  /** Initial temperature T₀. Default 1. */
  initialTemperature?: number;
  /** Multiplicative cooling factor applied each iteration. Default 0.95. */
  coolingRate?: number;
  /** Maximum iterations. Default 1000. */
  maxIterations?: number;
  /**
   * Neighbour proposal sigma RELATIVE to each dimension's bound range.
   * e.g. 0.1 → 10% of (max - min). Default 0.1.
   */
  neighbourSigma?: number;
  /** RNG seed for deterministic runs. Default 1. */
  seed?: number;
  /** Stop early if the best value has not improved for this many iterations. Default Infinity. */
  stagnationLimit?: number;
}

export interface SimulatedAnnealingResult {
  bestState: number[];
  bestValue: number;
  iterations: number;
  acceptedMoves: number;
  acceptedWorseMoves: number;
  finalTemperature: number;
  stagnated: boolean;
  reasoning: string;
}

function makeLCG(seed: number): () => number {
  let s = (seed >>> 0) || 1;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}
function gaussian(rng: () => number): number {
  const u1 = Math.max(1e-12, rng());
  const u2 = rng();
  return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
}
function clamp(x: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, x));
}

export function computeSimulatedAnnealing(
  input: SimulatedAnnealingInput,
): SimulatedAnnealingResult {
  const N = input.initialState.length;
  if (input.bounds.length !== N) {
    throw new Error(
      `bounds length ${input.bounds.length} ≠ initialState length ${N}`,
    );
  }
  for (let i = 0; i < N; i++) {
    const [lo, hi] = input.bounds[i]!;
    if (!(lo < hi)) {
      throw new Error(`bounds[${i}] = [${lo}, ${hi}] must satisfy lo < hi`);
    }
  }
  const T0 = input.initialTemperature ?? 1;
  if (T0 <= 0) throw new Error("initialTemperature must be positive");
  const cooling = input.coolingRate ?? 0.95;
  if (!(cooling > 0 && cooling < 1)) {
    throw new Error("coolingRate must lie in (0, 1)");
  }
  const maxIterations = input.maxIterations ?? 1000;
  const sigmaRel = input.neighbourSigma ?? 0.1;
  const seed = input.seed ?? 1;
  const stagnationLimit = input.stagnationLimit ?? Number.POSITIVE_INFINITY;

  const rng = makeLCG(seed);
  let current = [...input.initialState];
  let currentValue = input.objective(current);
  let best = [...current];
  let bestValue = currentValue;
  let T = T0;
  let accepted = 0;
  let acceptedWorse = 0;
  let stagnationCounter = 0;
  let stagnated = false;
  let iter = 0;

  for (; iter < maxIterations; iter++) {
    // Propose neighbour
    const proposal = new Array<number>(N);
    for (let i = 0; i < N; i++) {
      const [lo, hi] = input.bounds[i]!;
      const range = hi - lo;
      const step = gaussian(rng) * sigmaRel * range;
      proposal[i] = clamp(current[i]! + step, lo, hi);
    }
    const proposalValue = input.objective(proposal);

    const delta = proposalValue - currentValue;
    let accept = false;
    if (delta > 0) {
      accept = true;
    } else {
      const p = Math.exp(delta / T);
      if (rng() < p) {
        accept = true;
        acceptedWorse++;
      }
    }
    if (accept) {
      current = proposal;
      currentValue = proposalValue;
      accepted++;
      if (currentValue > bestValue) {
        best = [...current];
        bestValue = currentValue;
        stagnationCounter = 0;
      } else {
        stagnationCounter++;
      }
    } else {
      stagnationCounter++;
    }

    if (stagnationCounter >= stagnationLimit) {
      stagnated = true;
      iter++;
      break;
    }

    T *= cooling;
  }

  const reasoning =
    `iter=${iter}/${maxIterations}, accepted=${accepted} ` +
    `(worse=${acceptedWorse}), T₀=${T0} → T=${T.toExponential(2)}, ` +
    `best=${bestValue.toFixed(6)}${stagnated ? " (stagnated)" : ""}`;

  return {
    bestState: best,
    bestValue,
    iterations: iter,
    acceptedMoves: accepted,
    acceptedWorseMoves: acceptedWorse,
    finalTemperature: T,
    stagnated,
    reasoning,
  };
}

export function simulatedAnnealingToPayload(
  result: SimulatedAnnealingResult,
): Record<string, unknown> {
  return {
    kind: "simulated_annealing.computed",
    bestValue: Number(result.bestValue.toFixed(8)),
    iterations: result.iterations,
    acceptedMoves: result.acceptedMoves,
    acceptedWorseMoves: result.acceptedWorseMoves,
    finalTemperature: Number(result.finalTemperature.toExponential(4)),
    stagnated: result.stagnated,
    bestState: result.bestState.map((x) => Number(x.toFixed(6))),
  };
}
