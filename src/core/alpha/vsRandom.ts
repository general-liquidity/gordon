/**
 * Vs Random benchmarking — Jaffray Woodriff's "beat the best random
 * strategy" filter, popularized in his Hedge Fund Market Wizards
 * chapter. Pattern adapted from Build Alpha's framework.
 *
 * Question this answers: given a strategy that produces some fitness
 * (Sharpe, profit factor, win rate, ...), could a random strategy on
 * the SAME data plausibly produce that same fitness through luck +
 * data-mining bias?
 *
 * Algorithm:
 *
 *   1. Caller supplies the strategy's realized fitness on actual data.
 *   2. We generate N random entry signals (Bernoulli with the same
 *      exposure rate as the actual strategy).
 *   3. Convert each random signal to an equity curve via simple
 *      bar-by-bar long-only PnL on the candles.
 *   4. Compute fitness on each random equity curve.
 *   5. Compare: does the actual fitness beat the best random fitness?
 *
 * Pass criteria (Woodriff, Masters): actual must beat the BEST
 * random — not the average. Generating enough strategies guarantees
 * some random ones will look good; we benchmark against the survivor.
 *
 * Distinct from MCPT (`src/infra/trading/quant/mcpt.ts`):
 *   - MCPT permutes the DATA (destroys patterns), re-runs the SAME
 *     strategy logic. Tests path-dependent edge.
 *   - Vs Random keeps the data, generates RANDOM strategies. Tests
 *     whether the strategy beat the "best of random" baseline.
 *   - Both questions matter; they don't replace each other.
 *
 * Pure function. No I/O. Caller seeds the RNG for reproducibility.
 */

export type Fitness = "sharpe" | "profit_factor" | "win_rate" | "total_return";

export interface VsRandomInput {
  /** Bar closes (or any series the strategy fed off — same units). */
  closes: number[];
  /** Strategy's realized fitness on the actual data. */
  actualFitness: number;
  /** Which fitness function was used (so we compute the same one on
   *  random equity curves). */
  fitness: Fitness;
  /** Fraction of bars the actual strategy held a position. Random
   *  signals are generated with this Bernoulli rate so comparisons
   *  are apples-to-apples (matched exposure). */
  exposureRate: number;
  /** Number of random strategies to generate. Default 1000 — enough
   *  for stable best-of-N estimate without burning forever. */
  nRandom?: number;
  /** Optional RNG seed for reproducible results. */
  seed?: number;
}

export interface VsRandomResult {
  actualFitness: number;
  bestRandomFitness: number;
  meanRandomFitness: number;
  /** Where the actual fitness sits in the random distribution
   *  (0 = worse than all random, 1 = better than all random). */
  percentile: number;
  /** Verdict: pass (beats best random), borderline (in top 5% but
   *  not best), fail (in the random pack). */
  verdict: "pass" | "borderline" | "fail";
  nRandom: number;
  interpretation: string;
}

/** Deterministic LCG so seeded runs are reproducible. */
function makeRng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    // Numerical Recipes LCG (well-known, sufficient for our scale).
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0xffffffff;
  };
}

/** Build per-bar long/flat signals at the requested exposure rate. */
function randomSignals(length: number, exposureRate: number, rng: () => number): number[] {
  const out = new Array<number>(length);
  for (let i = 0; i < length; i++) {
    out[i] = rng() < exposureRate ? 1 : 0;
  }
  return out;
}

/** Simple long/flat equity curve from a signal array + close series.
 *  Position taken at bar i applies the next bar's return. Last bar
 *  has no forward return, so it's skipped. */
function equityFromSignals(closes: number[], signals: number[]): number[] {
  if (closes.length < 2) return [1];
  const equity = new Array<number>(closes.length);
  equity[0] = 1;
  for (let i = 1; i < closes.length; i++) {
    const r = closes[i]! / closes[i - 1]! - 1;
    const held = signals[i - 1] ?? 0;
    equity[i] = equity[i - 1]! * (1 + held * r);
  }
  return equity;
}

function computeFitness(equity: number[], fitness: Fitness): number {
  if (equity.length < 2) return 0;
  const returns: number[] = [];
  for (let i = 1; i < equity.length; i++) {
    returns.push(equity[i]! / equity[i - 1]! - 1);
  }
  switch (fitness) {
    case "total_return":
      return equity[equity.length - 1]! / equity[0]! - 1;
    case "sharpe": {
      const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
      const variance = returns.reduce((a, b) => a + (b - mean) * (b - mean), 0) / returns.length;
      const sd = Math.sqrt(variance);
      // Annualize-agnostic — caller can scale. Avoid div-by-0.
      return sd > 1e-12 ? mean / sd : 0;
    }
    case "profit_factor": {
      let gains = 0;
      let losses = 0;
      for (const r of returns) {
        if (r > 0) gains += r;
        else losses += -r;
      }
      return losses > 1e-12 ? gains / losses : gains > 0 ? Infinity : 0;
    }
    case "win_rate": {
      const wins = returns.filter((r) => r > 0).length;
      return returns.length > 0 ? wins / returns.length : 0;
    }
  }
}

export function computeVsRandom(input: VsRandomInput): VsRandomResult {
  if (!input.closes || input.closes.length < 2) {
    throw new Error("computeVsRandom: closes must have at least 2 bars");
  }
  if (!Number.isFinite(input.actualFitness)) {
    throw new Error("computeVsRandom: actualFitness must be finite");
  }
  if (!(input.exposureRate >= 0 && input.exposureRate <= 1)) {
    throw new Error("computeVsRandom: exposureRate must be in [0, 1]");
  }
  const nRandom = input.nRandom ?? 1000;
  if (!(nRandom > 0)) {
    throw new Error("computeVsRandom: nRandom must be > 0");
  }

  const rng = input.seed != null ? makeRng(input.seed) : Math.random;
  const randomFitnesses: number[] = new Array<number>(nRandom);
  for (let i = 0; i < nRandom; i++) {
    const signals = randomSignals(input.closes.length, input.exposureRate, rng);
    const equity = equityFromSignals(input.closes, signals);
    randomFitnesses[i] = computeFitness(equity, input.fitness);
  }

  let bestRandom = -Infinity;
  let sum = 0;
  let beats = 0;
  for (const f of randomFitnesses) {
    if (Number.isFinite(f)) {
      if (f > bestRandom) bestRandom = f;
      sum += f;
      if (input.actualFitness > f) beats++;
    }
  }
  const meanRandom = sum / nRandom;
  const percentile = beats / nRandom;

  // Verdict thresholds:
  //   - pass: actual strictly beats best random
  //   - borderline: actual in top 5% but not best
  //   - fail: anything else
  let verdict: VsRandomResult["verdict"];
  if (input.actualFitness > bestRandom) verdict = "pass";
  else if (percentile >= 0.95) verdict = "borderline";
  else verdict = "fail";

  const interpretation =
    verdict === "pass"
      ? `Beats the best-of-${nRandom} random strategy (actual ${input.actualFitness.toFixed(3)} > best random ${bestRandom.toFixed(3)}). Not pure luck.`
      : verdict === "borderline"
        ? `In top 5% of random strategies but didn't beat the best (percentile ${(percentile * 100).toFixed(1)}%). Suggestive — not conclusive.`
        : `Inside the random pack (percentile ${(percentile * 100).toFixed(1)}%). Likely no real edge — strategy is overfit or just lucky.`;

  return {
    actualFitness: input.actualFitness,
    bestRandomFitness: bestRandom,
    meanRandomFitness: meanRandom,
    percentile,
    verdict,
    nRandom,
    interpretation,
  };
}
