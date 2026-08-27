/**
 * Cross-Sectional Signed Order-Flow Factor
 *
 * Order flow = the log difference between buyer-initiated and
 * seller-initiated volume on an instrument. Anastasopoulos, Behrendt &
 * Kolokolova (J. Financial Markets, 2026, "Order flow and cryptocurrency
 * returns") show that, CROSS-SECTIONALLY, instruments carrying high net
 * buyer-initiated flow tend to outperform those carrying net seller-
 * initiated flow. A long-high / short-low predictor built on this signal
 * dominated fundamental factors out-of-sample in their study.
 *
 * This primitive ranks a universe by per-instrument signed flow imbalance,
 * cross-sectionally z-scores the imbalances, and produces dollar-neutral
 * long-short weights (Σ weight ≈ 0, long the high-flow names, short the
 * low-flow names, Σ|weight| = 1).
 *
 * IMPORTANT — this is a CAPABILITY to validate, NOT a claimed edge. The
 * factor is only meaningful on REAL venue data with genuine participant
 * order flow; it is STRUCTURALLY ABSENT in per-account paper sims that
 * have no other participants (buyInitiated/sellInitiated there are just
 * the operator's own fills, carrying no cross-sectional information).
 * Validate via the isolated-experiment harness on real venue feeds before
 * treating the output as alpha.
 *
 * Distinct from:
 *   - `aggression-ratio.ts`  (PER-INSTRUMENT EMA taker-buy/sell ratio over
 *                             a bar series of ONE symbol — time-series, not
 *                             cross-sectional ranking)
 *   - `vpin.ts` / `delta-ladder.ts` / `as-market-making.ts`
 *                            (single-instrument microstructure primitives)
 *   - `cross-sectional-momentum.ts`
 *                            (ranks the universe by RETURN, not by flow)
 *
 * Pure, self-contained. Caller supplies the per-instrument buy/sell split;
 * primitive doesn't fetch or estimate it.
 */

export interface InstrumentFlow {
  symbol: string;
  /** Buyer-initiated (taker-buy) volume over the measurement window. */
  buyInitiatedVolume: number;
  /** Seller-initiated (taker-sell) volume over the measurement window. */
  sellInitiatedVolume: number;
}

export interface CrossSectionalOrderFlowEntry {
  symbol: string;
  /** Per-instrument signed flow imbalance = log((buy+eps)/(sell+eps)). */
  flow: number;
  /** Cross-sectional z-score of `flow` across the universe. */
  zScore: number;
  /** Dollar-neutral long-short weight (Σ ≈ 0, Σ|weight| = 1). */
  weight: number;
}

export interface CrossSectionalOrderFlowOptions {
  /**
   * Produce dollar-neutral long-short weights. When false, the raw
   * z-scores are returned as weights without neutralization/normalization.
   * Default true.
   */
  longShort?: boolean;
  /**
   * Winsorize the cross-sectional flow distribution to ±this many standard
   * deviations before z-scoring, clipping outliers. 0 (default) disables.
   */
  winsorize?: number;
}

const EPS = 1e-9;

/**
 * Per-instrument signed order-flow imbalance: the paper's log-difference
 * between buyer- and seller-initiated volume. eps guards the zero-volume
 * case. Positive ⇒ net buyer-initiated; negative ⇒ net seller-initiated.
 */
export function orderFlowImbalance(f: InstrumentFlow): number {
  return Math.log((f.buyInitiatedVolume + EPS) / (f.sellInitiatedVolume + EPS));
}

function mean(values: number[]): number {
  let sum = 0;
  for (const v of values) sum += v;
  return sum / values.length;
}

function std(values: number[], mu: number): number {
  let acc = 0;
  for (const v of values) {
    const d = v - mu;
    acc += d * d;
  }
  return Math.sqrt(acc / values.length);
}

export function crossSectionalOrderFlowSignal(
  flows: InstrumentFlow[],
  opts: CrossSectionalOrderFlowOptions = {},
): CrossSectionalOrderFlowEntry[] {
  const longShort = opts.longShort ?? true;
  const winsorize = opts.winsorize ?? 0;

  // Guard: need at least 2 instruments for a cross-section.
  if (flows.length < 2) {
    return flows.map((f) => ({
      symbol: f.symbol,
      flow: orderFlowImbalance(f),
      zScore: 0,
      weight: 0,
    }));
  }

  let imbalances = flows.map((f) => orderFlowImbalance(f));

  // Optional winsorization: clip raw flow at ±winsorize·σ around the mean.
  if (winsorize > 0) {
    const mu = mean(imbalances);
    const sigma = std(imbalances, mu);
    if (sigma > 0) {
      const lo = mu - winsorize * sigma;
      const hi = mu + winsorize * sigma;
      imbalances = imbalances.map((v) => Math.min(hi, Math.max(lo, v)));
    }
  }

  const mu = mean(imbalances);
  const sigma = std(imbalances, mu);

  // Guard: zero cross-sectional variance ⇒ no information ⇒ all weights 0.
  if (sigma <= EPS) {
    return flows.map((f, i) => ({
      symbol: f.symbol,
      flow: imbalances[i]!,
      zScore: 0,
      weight: 0,
    }));
  }

  const zScores = imbalances.map((v) => (v - mu) / sigma);

  if (!longShort) {
    return flows.map((f, i) => ({
      symbol: f.symbol,
      flow: imbalances[i]!,
      zScore: zScores[i]!,
      weight: zScores[i]!,
    }));
  }

  // Dollar-neutral long-short weights: weight ∝ z-score (already mean-zero,
  // so Σ weight ≈ 0), normalized so Σ|weight| = 1 (gross exposure of 1).
  const grossZ = zScores.reduce((acc, z) => acc + Math.abs(z), 0);
  const weights = grossZ <= EPS ? zScores.map(() => 0) : zScores.map((z) => z / grossZ);

  return flows.map((f, i) => ({
    symbol: f.symbol,
    flow: imbalances[i]!,
    zScore: zScores[i]!,
    weight: weights[i]!,
  }));
}
