/**
 * Genetic Algorithm Optimizer (GORDON_GENETIC_OPTIMIZER).
 *
 * Port of Ch 6 (Genetic Algorithms) from Dolzhenko, "Algorithmic Trading
 * Systems and Strategies: A New Approach" (Apress 2024).
 *
 * Population-based parameter search. Generates many candidate strategies in
 * parallel, evolves them via tournament selection + arithmetic crossover +
 * Gauss mutation. Best individual carried via elitism. Search proceeds
 * from diversification (early generations explore broadly) to
 * intensification (late generations refine).
 *
 * Aligned with Dolzhenko's thesis (Ch 1): rather than chasing one super-
 * profitable strategy, generate MANY modest-yield candidates and run the
 * portfolio. The GA is the engine for that auto-discovery.
 *
 * Operator choices follow Dolzhenko's recommendations:
 *   - Selection: tournament size 2-3 (Ch 6.3 Tournament Method)
 *   - Crossover: arithmetic with random λ ∈ [0, 1] (Ch 6.2)
 *   - Mutation: Gauss operator with configurable σ (Ch 6.1 Gauss Operator)
 *   - Filtering: elitism (Ch 6 Elitism-Based Method) preserves top-K each
 *     generation
 *
 * Complements `simulatedAnnealing.ts` (single-state) and
 * `iteratedLocalSearch.ts` (meta-algorithm) — three orthogonal
 * optimizers covering Dolzhenko's recommended toolkit.
 *
 * Pure compute. No I/O. Deterministic seeded LCG RNG for reproducibility.
 */

export interface GeneticOptimizerInput {
  /** Objective to MAXIMISE. */
  objective: (x: ReadonlyArray<number>) => number;
  /** Search-space bounds per gene. */
  bounds: ReadonlyArray<readonly [number, number]>;
  /** Population size. Default 50. */
  populationSize?: number;
  /** Maximum generations. Default 100. */
  maxGenerations?: number;
  /** Tournament size for selection. Default 3. */
  tournamentSize?: number;
  /** Probability of mutating each gene per descendant. Default 0.1. */
  mutationRate?: number;
  /**
   * Gaussian mutation σ RELATIVE to each gene's bound range.
   * e.g. 0.05 → mutation step ~ 5% of (max - min). Default 0.05.
   */
  mutationSigma?: number;
  /** Elite count: top-K individuals carried unchanged each generation. Default 2. */
  eliteCount?: number;
  /** Stop early if best has not improved for this many generations. Default Infinity. */
  stagnationLimit?: number;
  /** RNG seed. Default 1. */
  seed?: number;
}

export interface GeneticOptimizerResult {
  bestGenome: number[];
  bestFitness: number;
  generationsRun: number;
  stagnated: boolean;
  /** Best fitness per generation (for diagnostics). */
  fitnessHistory: number[];
  reasoning: string;
}

function makeLCG(seed: number): () => number {
  let s = seed >>> 0 || 1;
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

export function computeGeneticOptimizer(input: GeneticOptimizerInput): GeneticOptimizerResult {
  const G = input.bounds.length;
  if (G === 0) throw new Error("bounds must be non-empty");
  for (let i = 0; i < G; i++) {
    const [lo, hi] = input.bounds[i]!;
    if (!(lo < hi)) throw new Error(`bounds[${i}] must satisfy lo < hi`);
  }
  const popSize = input.populationSize ?? 50;
  if (popSize < 4) throw new Error("populationSize must be ≥ 4");
  const maxGens = input.maxGenerations ?? 100;
  const tourn = input.tournamentSize ?? 3;
  if (tourn < 2 || tourn > popSize) {
    throw new Error("tournamentSize must satisfy 2 ≤ k ≤ populationSize");
  }
  const mutRate = input.mutationRate ?? 0.1;
  if (mutRate < 0 || mutRate > 1) {
    throw new Error("mutationRate must lie in [0, 1]");
  }
  const mutSigma = input.mutationSigma ?? 0.05;
  if (mutSigma <= 0) throw new Error("mutationSigma must be positive");
  const elite = input.eliteCount ?? 2;
  if (elite < 0 || elite >= popSize) {
    throw new Error("eliteCount must satisfy 0 ≤ k < populationSize");
  }
  const stagnationLimit = input.stagnationLimit ?? Number.POSITIVE_INFINITY;
  const seed = input.seed ?? 1;
  const rng = makeLCG(seed);

  // Initialise random population
  const population: number[][] = [];
  for (let i = 0; i < popSize; i++) {
    const indiv = new Array<number>(G);
    for (let g = 0; g < G; g++) {
      const [lo, hi] = input.bounds[g]!;
      indiv[g] = lo + rng() * (hi - lo);
    }
    population.push(indiv);
  }

  const fitness = population.map((p) => input.objective(p));
  let bestIdx = 0;
  for (let i = 1; i < popSize; i++) {
    if (fitness[i]! > fitness[bestIdx]!) bestIdx = i;
  }
  let bestGenome = [...population[bestIdx]!];
  let bestFitness = fitness[bestIdx]!;
  const fitnessHistory: number[] = [bestFitness];
  let stagnation = 0;
  let stagnated = false;
  let gen = 0;

  for (gen = 1; gen <= maxGens; gen++) {
    // Sort by fitness descending — elites come first
    const order = Array.from({ length: popSize }, (_, i) => i).sort(
      (a, b) => fitness[b]! - fitness[a]!,
    );

    // Build next generation
    const nextPop: number[][] = [];

    // Elitism
    for (let e = 0; e < elite; e++) {
      nextPop.push([...population[order[e]!]!]);
    }

    // Fill rest via tournament selection + crossover + mutation
    while (nextPop.length < popSize) {
      // Tournament select two parents
      const selectOne = (): number => {
        let best = Math.floor(rng() * popSize);
        for (let k = 1; k < tourn; k++) {
          const c = Math.floor(rng() * popSize);
          if (fitness[c]! > fitness[best]!) best = c;
        }
        return best;
      };
      const p1 = population[selectOne()]!;
      const p2 = population[selectOne()]!;

      // Arithmetic crossover with λ ∈ [0, 1]
      const lambda = rng();
      const child = new Array<number>(G);
      for (let g = 0; g < G; g++) {
        child[g] = lambda * p1[g]! + (1 - lambda) * p2[g]!;
      }

      // Gauss mutation per gene with probability mutRate
      for (let g = 0; g < G; g++) {
        if (rng() < mutRate) {
          const [lo, hi] = input.bounds[g]!;
          const range = hi - lo;
          child[g] = clamp(child[g]! + gaussian(rng) * mutSigma * range, lo, hi);
        }
      }
      nextPop.push(child);
    }

    // Replace and re-evaluate
    population.splice(0, popSize, ...nextPop);
    for (let i = 0; i < popSize; i++) fitness[i] = input.objective(population[i]!);

    // Update best
    let genBestIdx = 0;
    for (let i = 1; i < popSize; i++) {
      if (fitness[i]! > fitness[genBestIdx]!) genBestIdx = i;
    }
    if (fitness[genBestIdx]! > bestFitness) {
      bestFitness = fitness[genBestIdx]!;
      bestGenome = [...population[genBestIdx]!];
      stagnation = 0;
    } else {
      stagnation++;
    }
    fitnessHistory.push(bestFitness);

    if (stagnation >= stagnationLimit) {
      stagnated = true;
      break;
    }
  }

  const reasoning =
    `generations=${gen}/${maxGens}, pop=${popSize}, elite=${elite}, ` +
    `tournament=${tourn}, mut=${mutRate} σ${mutSigma}; ` +
    `best=${bestFitness.toFixed(6)}${stagnated ? " (stagnated)" : ""}`;

  return {
    bestGenome,
    bestFitness,
    generationsRun: gen,
    stagnated,
    fitnessHistory,
    reasoning,
  };
}

export function geneticOptimizerToPayload(result: GeneticOptimizerResult): Record<string, unknown> {
  return {
    kind: "genetic_optimizer.computed",
    bestFitness: Number(result.bestFitness.toFixed(8)),
    generationsRun: result.generationsRun,
    stagnated: result.stagnated,
    bestGenome: result.bestGenome.map((x) => Number(x.toFixed(6))),
    fitnessTrajectory: {
      first: Number(result.fitnessHistory[0]!.toFixed(6)),
      last: Number(result.fitnessHistory[result.fitnessHistory.length - 1]!.toFixed(6)),
      improvement: Number(
        (
          result.fitnessHistory[result.fitnessHistory.length - 1]! - result.fitnessHistory[0]!
        ).toFixed(6),
      ),
    },
  };
}
