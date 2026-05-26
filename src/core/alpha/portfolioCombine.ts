/**
 * Portfolio combine + rebalancing premium (Parrondo / Shannon).
 *
 * Pattern from Build Alpha (Bergstrom) + Parrondo's Paradox in game
 * theory. The premise: two losing strategies (negative geometric
 * mean) can be combined into a winning portfolio when (a) they're
 * sufficiently uncorrelated and volatile, and (b) the portfolio is
 * rebalanced periodically. The rebalance mechanically sells what
 * went up and buys what went down — harvesting the volatility
 * spread without requiring either component to be profitable alone.
 *
 * Quant formulation: geometric ≈ arithmetic − ½·variance. Combining
 * uncorrelated strategies drops portfolio variance more than it
 * drops portfolio arithmetic mean, which can flip geometric mean
 * positive. Hence "rebalancing premium" (Shannon's demon).
 *
 * NOT a free lunch:
 *
 *   - When one component is the clear long-run winner, frequent
 *     rebalancing acts like a "sell your best idea" tax — combined
 *     can underperform the winner.
 *   - Transaction costs erase the premium on tight rebalance
 *     cadences. This function takes a txCostBps param so you can
 *     see exactly when the premium dies.
 *   - Requires components to "take turns leading" (low/negative
 *     correlation). High-correlation portfolios get no benefit.
 *
 * Pure function. Input is component equity curves; output is the
 * combined curve + diagnostics (Parrondo verdict, premium magnitude).
 */

export type RebalanceCadence = "never" | "daily" | "weekly" | "monthly";

export interface PortfolioCombineInput {
  /** Equity curves, one per strategy, all the same length. Index 0
   *  is the starting equity (typically 1.0 or operator's choice). */
  equityCurves: number[][];
  /** Initial weights, one per strategy. Defaults to equal-weight.
   *  Must sum to 1 (caller normalizes; we'll do a sanity check). */
  weights?: number[];
  /** How often to rebalance back to the initial weights. Default
   *  'never' (buy-and-hold). 'daily' assumes one row per day. */
  rebalanceCadence?: RebalanceCadence;
  /** Round-trip transaction cost, in basis points, applied to the
   *  rebalanced notional per event. Default 0 (free rebalancing). */
  txCostBps?: number;
}

export interface PortfolioCombineResult {
  /** Per-bar combined equity. Length matches inputs. */
  combinedEquity: number[];
  /** Final equity value. */
  finalEquity: number;
  /** Geometric mean return per bar (combined). */
  geometricMeanReturn: number;
  /** Arithmetic mean return per bar (combined). */
  arithmeticMeanReturn: number;
  /** Volatility (per-bar return stddev). */
  volatility: number;
  /** Weighted geometric of the components — what you'd get without
   *  rebalancing. */
  weightedGeometricComponent: number;
  /** Rebalancing premium = combinedGeometric − weightedComponentGeometric.
   *  Positive means rebalancing helped; negative means it hurt. */
  rebalancingPremium: number;
  /** True when combinedGeometric > weightedComponentGeometric — the
   *  Parrondo / Shannon's-demon condition. */
  hasParrondo: boolean;
  /** Number of rebalance events that fired. */
  rebalanceEvents: number;
  /** Total tx cost paid (in equity units). */
  totalTxCost: number;
}

function rebalanceInterval(cadence: RebalanceCadence): number {
  switch (cadence) {
    case "never":
      return Infinity;
    case "daily":
      return 1;
    case "weekly":
      return 5;
    case "monthly":
      return 21;
  }
}

function geometricMean(equity: number[]): number {
  if (equity.length < 2) return 0;
  const totalReturn = equity[equity.length - 1]! / equity[0]!;
  if (totalReturn <= 0) return -Infinity;
  // Per-bar geometric mean return.
  return Math.pow(totalReturn, 1 / (equity.length - 1)) - 1;
}

function arithmeticAndVol(equity: number[]): { mean: number; vol: number } {
  if (equity.length < 2) return { mean: 0, vol: 0 };
  const returns: number[] = [];
  for (let i = 1; i < equity.length; i++) {
    returns.push(equity[i]! / equity[i - 1]! - 1);
  }
  const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
  const variance =
    returns.reduce((a, b) => a + (b - mean) * (b - mean), 0) / returns.length;
  return { mean, vol: Math.sqrt(variance) };
}

export function computePortfolioCombine(input: PortfolioCombineInput): PortfolioCombineResult {
  const curves = input.equityCurves;
  if (!Array.isArray(curves) || curves.length === 0) {
    throw new Error("computePortfolioCombine: equityCurves must be non-empty");
  }
  const barCount = curves[0]!.length;
  if (barCount < 2) {
    throw new Error("computePortfolioCombine: equityCurves must have at least 2 bars");
  }
  for (let i = 1; i < curves.length; i++) {
    if (curves[i]!.length !== barCount) {
      throw new Error(
        `computePortfolioCombine: curve ${i} length ${curves[i]!.length} doesn't match curve 0 length ${barCount}`,
      );
    }
  }
  const n = curves.length;
  const weights = input.weights ?? Array(n).fill(1 / n);
  if (weights.length !== n) {
    throw new Error("computePortfolioCombine: weights length must match equityCurves length");
  }
  const wSum = weights.reduce((a, b) => a + b, 0);
  if (!(Math.abs(wSum - 1) < 1e-6)) {
    throw new Error(`computePortfolioCombine: weights must sum to 1 (got ${wSum})`);
  }
  const cadence = input.rebalanceCadence ?? "never";
  const interval = rebalanceInterval(cadence);
  const txCostBps = input.txCostBps ?? 0;
  const txCostFrac = txCostBps / 10_000;

  // Track per-strategy notional. Starts as weight * 1.0 (one unit
  // total portfolio equity). Each bar applies that strategy's
  // bar-return; periodic rebalance redistributes to target weights.
  const notionals = weights.map((w) => w);
  const combinedEquity = new Array<number>(barCount);
  combinedEquity[0] = notionals.reduce((a, b) => a + b, 0);
  let rebalanceEvents = 0;
  let totalTxCost = 0;

  for (let bar = 1; bar < barCount; bar++) {
    // Apply each strategy's bar return to its notional.
    for (let s = 0; s < n; s++) {
      const prev = curves[s]![bar - 1]!;
      const curr = curves[s]![bar]!;
      const r = prev !== 0 ? curr / prev - 1 : 0;
      notionals[s] = notionals[s]! * (1 + r);
    }
    let total = notionals.reduce((a, b) => a + b, 0);

    // Rebalance event?
    if (interval !== Infinity && bar % interval === 0 && total > 0) {
      // Compute target notionals + total turnover (sum of |delta|).
      const targets = weights.map((w) => w * total);
      let turnover = 0;
      for (let s = 0; s < n; s++) {
        turnover += Math.abs(targets[s]! - notionals[s]!);
      }
      // Reassign to targets; charge tx cost on turnover.
      for (let s = 0; s < n; s++) notionals[s] = targets[s]!;
      const cost = turnover * txCostFrac;
      if (cost > 0) {
        // Subtract cost proportionally.
        const after = total - cost;
        const scale = after / total;
        for (let s = 0; s < n; s++) notionals[s] = notionals[s]! * scale;
        total = after;
        totalTxCost += cost;
      }
      rebalanceEvents++;
    }
    combinedEquity[bar] = notionals.reduce((a, b) => a + b, 0);
  }

  const finalEquity = combinedEquity[barCount - 1]!;
  const { mean: arithmeticMeanReturn, vol: volatility } = arithmeticAndVol(combinedEquity);
  const geometricMeanReturn = geometricMean(combinedEquity);

  // Weighted geometric of components — what naive buy-and-hold yields
  // when each strategy keeps its initial weight (no rebalance, no
  // cost). Used as the comparison baseline.
  let weightedFinal = 0;
  for (let s = 0; s < n; s++) {
    const componentFinal = curves[s]![barCount - 1]! / curves[s]![0]!;
    weightedFinal += weights[s]! * componentFinal;
  }
  const weightedGeometricComponent =
    weightedFinal > 0
      ? Math.pow(weightedFinal, 1 / (barCount - 1)) - 1
      : -Infinity;

  const rebalancingPremium = geometricMeanReturn - weightedGeometricComponent;
  const hasParrondo = geometricMeanReturn > weightedGeometricComponent;

  return {
    combinedEquity,
    finalEquity,
    geometricMeanReturn,
    arithmeticMeanReturn,
    volatility,
    weightedGeometricComponent,
    rebalancingPremium,
    hasParrondo,
    rebalanceEvents,
    totalTxCost,
  };
}
