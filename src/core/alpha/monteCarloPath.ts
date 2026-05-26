/**
 * Monte Carlo price-path simulator.
 *
 * Given a price-history (or pre-built return distribution), simulate N
 * forward paths and return the terminal distribution + exceedance
 * probabilities. Two model modes:
 *
 *   - "markov":  discretize returns into K states, build the transition
 *                matrix from observed moves, sample state-conditional
 *                next-returns. Captures regime-conditional drift but
 *                throws away level information.
 *
 *   - "gbm":     fit μ and σ from log returns, sample iid Gaussian.
 *                Memoryless; correct under random-walk assumption.
 *
 * Returns terminal-price distribution, quantiles, exceedance probs for
 * caller-specified levels, and mean / stddev. No I/O — caller supplies
 * the price series. Use `compute_microstructure({ operation: "monte_carlo_path",
 * params: { symbol } })` for the auto-collect path that wraps this.
 *
 * Honest caveats inherited from the underlying assumptions:
 *   - GBM understates tail risk on crypto (log-normal isn't fat-tailed enough).
 *   - Markov on returns assumes the next-return distribution depends only
 *     on the current return bucket — empirically violated during regime
 *     transitions and announcement windows.
 *
 * Use it as a building block for sizing + scenario analysis, not as a
 * forecast you trust raw.
 */

export type MonteCarloModel = "markov" | "gbm";

export interface MonteCarloPathInput {
  /** Price series, oldest → newest. ≥ 60 points recommended. */
  prices: number[];
  /** Number of bars to project forward. */
  horizonBars: number;
  /** Simulations to run. Default 10000. */
  nSims?: number;
  /** Model type. Default "markov". */
  model?: MonteCarloModel;
  /** Return-discretization buckets for Markov mode. Default 10. */
  nStates?: number;
  /** Optional exceedance levels (prices). Returns P(terminal > level) for each. */
  exceedanceLevels?: number[];
  /** Optional RNG override for deterministic testing. */
  rng?: () => number;
}

export interface MonteCarloPathResult {
  model: MonteCarloModel;
  startPrice: number;
  horizonBars: number;
  nSims: number;
  /** Mean terminal price across all simulations. */
  meanTerminal: number;
  /** Stddev of terminal prices. */
  stddevTerminal: number;
  /** Sorted quantiles of the terminal distribution. */
  quantiles: {
    p05: number;
    p25: number;
    p50: number;
    p75: number;
    p95: number;
  };
  /** Per-level exceedance probabilities (P(terminal ≥ level)). */
  exceedance: Array<{ level: number; probability: number }>;
  /** Drift + volatility implied by the fitted model (annualization-free, per-bar). */
  metadata: {
    fittedMu: number;
    fittedSigma: number;
    /** "low" when < 20 prices fed in. */
    reliability: "low" | "medium" | "high";
  };
}

function defaultRng(): number {
  return Math.random();
}

/** Box-Muller transform: convert two uniforms to one standard-normal. */
function gaussian(rng: () => number): number {
  const u1 = Math.max(rng(), 1e-12);
  const u2 = rng();
  return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
}

function logReturns(prices: number[]): number[] {
  const out: number[] = [];
  for (let i = 1; i < prices.length; i++) {
    const prev = prices[i - 1]!;
    const curr = prices[i]!;
    if (prev > 0 && curr > 0) out.push(Math.log(curr / prev));
  }
  return out;
}

function mean(xs: number[]): number {
  if (xs.length === 0) return 0;
  let s = 0;
  for (const x of xs) s += x;
  return s / xs.length;
}

function stddev(xs: number[], avg?: number): number {
  if (xs.length < 2) return 0;
  const m = avg ?? mean(xs);
  let s = 0;
  for (const x of xs) s += (x - m) * (x - m);
  return Math.sqrt(s / (xs.length - 1));
}

function quantile(sorted: number[], q: number): number {
  if (sorted.length === 0) return 0;
  const i = Math.min(sorted.length - 1, Math.max(0, Math.floor(q * (sorted.length - 1))));
  return sorted[i]!;
}

/** Build a transition matrix over discretized log-returns. */
function buildReturnTransitionMatrix(
  rets: number[],
  nStates: number,
): { matrix: number[][]; binEdges: number[]; stateReturns: number[][] } {
  if (rets.length < 2) {
    const empty = Array.from({ length: nStates }, () => new Array(nStates).fill(1 / nStates) as number[]);
    return { matrix: empty, binEdges: [], stateReturns: Array.from({ length: nStates }, () => []) };
  }
  const sorted = [...rets].sort((a, b) => a - b);
  const binEdges: number[] = [];
  for (let i = 1; i < nStates; i++) {
    binEdges.push(quantile(sorted, i / nStates));
  }
  const stateOf = (r: number): number => {
    let s = 0;
    for (let i = 0; i < binEdges.length; i++) {
      if (r > binEdges[i]!) s = i + 1;
    }
    return Math.min(s, nStates - 1);
  };
  const matrix: number[][] = Array.from({ length: nStates }, () => new Array(nStates).fill(0) as number[]);
  const stateReturns: number[][] = Array.from({ length: nStates }, () => [] as number[]);
  for (let i = 0; i < rets.length; i++) {
    stateReturns[stateOf(rets[i]!)]!.push(rets[i]!);
  }
  for (let i = 0; i < rets.length - 1; i++) {
    const from = stateOf(rets[i]!);
    const to = stateOf(rets[i + 1]!);
    matrix[from]![to] = (matrix[from]![to] ?? 0) + 1;
  }
  for (let s = 0; s < nStates; s++) {
    let rowSum = 0;
    for (let t = 0; t < nStates; t++) rowSum += matrix[s]![t]!;
    if (rowSum === 0) {
      // Unobserved state — fall back to uniform transitions.
      for (let t = 0; t < nStates; t++) matrix[s]![t] = 1 / nStates;
    } else {
      for (let t = 0; t < nStates; t++) matrix[s]![t] = matrix[s]![t]! / rowSum;
    }
  }
  return { matrix, binEdges, stateReturns };
}

function sampleState(probs: number[], rng: () => number): number {
  const u = rng();
  let acc = 0;
  for (let i = 0; i < probs.length; i++) {
    acc += probs[i]!;
    if (u <= acc) return i;
  }
  return probs.length - 1;
}

function sampleStateReturn(stateReturns: number[][], state: number, rng: () => number, fallbackMu: number, fallbackSigma: number): number {
  const pool = stateReturns[state] ?? [];
  if (pool.length === 0) return fallbackMu + fallbackSigma * gaussian(rng);
  return pool[Math.floor(rng() * pool.length)]!;
}

export function monteCarloPath(input: MonteCarloPathInput): MonteCarloPathResult {
  const rng = input.rng ?? defaultRng;
  const nSims = input.nSims ?? 10_000;
  const model: MonteCarloModel = input.model ?? "markov";
  const nStates = Math.max(2, input.nStates ?? 10);
  const startPrice = input.prices[input.prices.length - 1] ?? 1;
  const rets = logReturns(input.prices);
  const fittedMu = mean(rets);
  const fittedSigma = stddev(rets, fittedMu);
  const reliability: MonteCarloPathResult["metadata"]["reliability"] =
    rets.length < 20 ? "low" : rets.length < 100 ? "medium" : "high";

  const terminals = new Array<number>(nSims);

  if (model === "markov" && rets.length >= 4) {
    const { matrix, stateReturns } = buildReturnTransitionMatrix(rets, nStates);
    // Initial state = bucket of the most recent return (or middle if too few).
    const lastRet = rets[rets.length - 1] ?? 0;
    const sortedRets = [...rets].sort((a, b) => a - b);
    const binEdges: number[] = [];
    for (let i = 1; i < nStates; i++) binEdges.push(quantile(sortedRets, i / nStates));
    const initialState = (() => {
      let s = 0;
      for (let i = 0; i < binEdges.length; i++) if (lastRet > binEdges[i]!) s = i + 1;
      return Math.min(s, nStates - 1);
    })();

    for (let sim = 0; sim < nSims; sim++) {
      let price = startPrice;
      let state = initialState;
      for (let step = 0; step < input.horizonBars; step++) {
        const ret = sampleStateReturn(stateReturns, state, rng, fittedMu, fittedSigma);
        price = price * Math.exp(ret);
        state = sampleState(matrix[state]!, rng);
      }
      terminals[sim] = price;
    }
  } else {
    // GBM fallback.
    for (let sim = 0; sim < nSims; sim++) {
      let price = startPrice;
      for (let step = 0; step < input.horizonBars; step++) {
        const ret = fittedMu + fittedSigma * gaussian(rng);
        price = price * Math.exp(ret);
      }
      terminals[sim] = price;
    }
  }

  const sorted = [...terminals].sort((a, b) => a - b);
  const meanTerminal = mean(terminals);
  const stddevTerminal = stddev(terminals, meanTerminal);

  const exceedance = (input.exceedanceLevels ?? []).map((level) => {
    let count = 0;
    for (const p of terminals) if (p >= level) count++;
    return { level, probability: count / nSims };
  });

  return {
    model: model === "markov" && rets.length < 4 ? "gbm" : model,
    startPrice,
    horizonBars: input.horizonBars,
    nSims,
    meanTerminal,
    stddevTerminal,
    quantiles: {
      p05: quantile(sorted, 0.05),
      p25: quantile(sorted, 0.25),
      p50: quantile(sorted, 0.5),
      p75: quantile(sorted, 0.75),
      p95: quantile(sorted, 0.95),
    },
    exceedance,
    metadata: {
      fittedMu,
      fittedSigma,
      reliability,
    },
  };
}

export function summarizeMonteCarloPath(r: MonteCarloPathResult): string {
  const pctChange = ((r.meanTerminal - r.startPrice) / r.startPrice) * 100;
  const p05Pct = ((r.quantiles.p05 - r.startPrice) / r.startPrice) * 100;
  const p95Pct = ((r.quantiles.p95 - r.startPrice) / r.startPrice) * 100;
  return [
    `Monte Carlo (${r.model}, ${r.nSims} sims, ${r.horizonBars} bars):`,
    `  start ${r.startPrice.toFixed(4)} → mean ${r.meanTerminal.toFixed(4)} (${pctChange >= 0 ? "+" : ""}${pctChange.toFixed(2)}%)`,
    `  90% band: ${r.quantiles.p05.toFixed(4)} (${p05Pct.toFixed(1)}%) … ${r.quantiles.p95.toFixed(4)} (${p95Pct.toFixed(1)}%)`,
    `  reliability: ${r.metadata.reliability}`,
  ].join("\n");
}
