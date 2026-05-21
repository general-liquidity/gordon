/**
 * Optimal f — Ralph Vince's Terminal Wealth Relative position sizing
 * (GORDON_OPTIMAL_F).
 *
 * Port of Ch 2 (Capital Management → Optimal f) from Dolzhenko,
 * "Algorithmic Trading Systems and Strategies: A New Approach" (Apress
 * 2024), which itself attributes the method to Ralph Vince.
 *
 * Distinct from Kelly criterion (Gordon's `cubeRootKelly.ts` and Wright's
 * `pathDependentSizer.ts`):
 *   - Kelly uses AGGREGATE statistics (win rate, avg win, avg loss)
 *   - Optimal f uses the ACTUAL TRADE SEQUENCE and finds the fraction f
 *     that maximises terminal wealth relative (TWR) over that history
 *
 * TWR formula (Dolzhenko Ch 2 → Vince):
 *
 *   TWR(f) = ∏ᵢ (1 + f × (−tradeᵢ / biggestLoss))
 *
 * where biggestLoss is the largest single losing trade (negative number)
 * and tradeᵢ is the signed per-trade P&L. For a loss tradeᵢ (negative),
 * the factor (−tradeᵢ / biggestLoss) is positive (loss / loss = positive)
 * but combined with f scales the equity DOWN. For a profit tradeᵢ
 * (positive), the factor is negative, but with the sign flip inside (1 +
 * f × negative) we effectively multiply by (1 + |gain|/|biggestLoss| × f)
 * — i.e. proportional gain.
 *
 * Search: f* ∈ (0, 1) maximising TWR. Implementation grid-searches with
 * configurable granularity (default 0.01, matching Vince's recommendation).
 *
 * Important practical limits noted by Dolzhenko (p. 27):
 *   "the main drawback is the impossibility of determining the optimal f
 *    during live trading, since it is based on past data. The optimal
 *    share for one trading period may be 25%, while for another period
 *    it may be 20%, and so on."
 *
 * Therefore this primitive ships with a `recommended` field that ALSO
 * surfaces the half-Kelly-style conservative size (optimalF divided by 2)
 * commonly used in practice to absorb sample variance.
 *
 * Pure compute. No I/O.
 */

export const OPTIMAL_F_FLAG_ENV = "GORDON_OPTIMAL_F";

export function isOptimalFEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env[OPTIMAL_F_FLAG_ENV] === "1" || env[OPTIMAL_F_FLAG_ENV] === "true";
}

export interface OptimalFInput {
  /** Signed per-trade P&L. Positive = win, negative = loss, units arbitrary. */
  trades: ReadonlyArray<number>;
  /** Search granularity for f ∈ (0, 1). Default 0.01 (Vince's recommendation). */
  step?: number;
  /** Lower bound for f search. Default 0.01. */
  minF?: number;
  /** Upper bound for f search. Default 0.99. */
  maxF?: number;
}

export interface OptimalFResult {
  /** f value that maximises TWR. NaN if undefined (e.g. no losses). */
  optimalF: number;
  /** TWR at optimal f. */
  twrAtOptimal: number;
  /** Geometric mean return per trade at optimal f = TWR^(1/N). */
  geometricMean: number;
  /** Conservative recommendation: optimalF / 2 (half-Kelly analogue). */
  conservativeF: number;
  /** Largest single-trade loss (most negative trade). NaN if no losses. */
  biggestLoss: number;
  /** Number of trades used. */
  sampleSize: number;
  /** Number of winning trades. */
  winCount: number;
  /** Number of losing trades. */
  lossCount: number;
  reasoning: string;
}

export function computeOptimalF(input: OptimalFInput): OptimalFResult {
  const trades = input.trades;
  const N = trades.length;
  const step = input.step ?? 0.01;
  const minF = input.minF ?? 0.01;
  const maxF = input.maxF ?? 0.99;

  if (step <= 0 || step >= 1) throw new Error("step must lie in (0, 1)");
  if (minF <= 0 || minF >= 1) throw new Error("minF must lie in (0, 1)");
  if (maxF <= minF || maxF >= 1) throw new Error("maxF must satisfy minF < maxF < 1");

  if (N === 0) {
    return {
      optimalF: NaN,
      twrAtOptimal: NaN,
      geometricMean: NaN,
      conservativeF: NaN,
      biggestLoss: NaN,
      sampleSize: 0,
      winCount: 0,
      lossCount: 0,
      reasoning: "empty trades; optimal f undefined",
    };
  }

  let winCount = 0;
  let lossCount = 0;
  let biggestLoss = 0;
  for (const t of trades) {
    if (t > 0) winCount++;
    else if (t < 0) {
      lossCount++;
      if (t < biggestLoss) biggestLoss = t;
    }
  }

  if (lossCount === 0) {
    // No losses — TWR grows unboundedly with f; no valid optimisation.
    return {
      optimalF: NaN,
      twrAtOptimal: NaN,
      geometricMean: NaN,
      conservativeF: NaN,
      biggestLoss: NaN,
      sampleSize: N,
      winCount,
      lossCount: 0,
      reasoning:
        "no losing trades; optimal f undefined (TWR is unbounded in f) — small history or genuine no-loss period",
    };
  }

  // Grid search f
  let bestF = minF;
  let bestTWR = -Infinity;
  for (let f = minF; f <= maxF + 1e-12; f += step) {
    let twr = 1;
    let bust = false;
    for (const t of trades) {
      // Equity multiplier: 1 + f × (−t / biggestLoss)
      // Note: biggestLoss is negative, so dividing a positive (−t for loss) by
      // negative gives the correct negative factor → reduces equity.
      const factor = 1 + f * ((-t) / biggestLoss);
      if (factor <= 0) {
        // Bankruptcy under this f — TWR = 0, abandon
        twr = 0;
        bust = true;
        break;
      }
      twr *= factor;
    }
    if (twr > bestTWR) {
      bestTWR = twr;
      bestF = f;
    }
    if (bust && bestTWR <= 0) {
      // Still searching upward — keep going, smaller f may survive
    }
  }

  const geometricMean = Math.pow(Math.max(0, bestTWR), 1 / N);
  const conservativeF = bestF / 2;

  const reasoning =
    `N=${N} (${winCount} wins, ${lossCount} losses), ` +
    `biggest loss=${biggestLoss.toFixed(4)}; ` +
    `optimal f=${bestF.toFixed(3)}, TWR=${bestTWR.toFixed(4)}, ` +
    `geometric mean=${geometricMean.toFixed(6)}/trade; ` +
    `conservative (half-Kelly analogue) f=${conservativeF.toFixed(3)}`;

  return {
    optimalF: bestF,
    twrAtOptimal: bestTWR,
    geometricMean,
    conservativeF,
    biggestLoss,
    sampleSize: N,
    winCount,
    lossCount,
    reasoning,
  };
}

export function optimalFToPayload(result: OptimalFResult): Record<string, unknown> {
  const finite = (x: number): number | null =>
    Number.isFinite(x) ? Number(x.toFixed(6)) : null;
  return {
    kind: "optimal_f.computed",
    optimalF: finite(result.optimalF),
    twrAtOptimal: finite(result.twrAtOptimal),
    geometricMean: finite(result.geometricMean),
    conservativeF: finite(result.conservativeF),
    biggestLoss: finite(result.biggestLoss),
    sampleSize: result.sampleSize,
    winCount: result.winCount,
    lossCount: result.lossCount,
  };
}
