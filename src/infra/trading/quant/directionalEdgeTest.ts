/**
 * Directional-Edge Test — sign-randomization validation
 * (GORDON_DIRECTIONAL_EDGE_TEST).
 *
 * The operationalization of skfolio's "reversed-return validation" for a
 * single realized return series. Sanity-check that a strategy's reported
 * Sharpe comes from real directional information, not from random sign
 * luck on a series whose absolute moves happened to align with the
 * strategy's parameters.
 *
 *   - Compute the realized Sharpe of a strategy's return series.
 *   - Generate B sign-randomized null samples: for each return, flip
 *     its sign with probability 0.5 (independent Bernoulli per step).
 *     This preserves the marginal magnitude distribution and short-range
 *     autocorrelation of |r|, but destroys the directional structure.
 *   - Compute Sharpe on each null sample. The resulting distribution is
 *     the "what would my Sharpe be if I had no directional edge?"
 *     distribution.
 *   - Realized |Sharpe| at p > 0.95 of the null → strategy has real
 *     directional edge. Realized at p ~ 0.5 → directionality is noise.
 *
 * Complementary to stationaryBootstrap (AR1):
 *   - stationaryBootstrap → "would my Sharpe survive a reshuffled
 *     history?" (parameter fragility under resampled returns)
 *   - directionalEdgeTest → "does my Sharpe come from real direction
 *     or from random sign luck?" (directional information content)
 *
 * The two answer different questions and a robust strategy should pass
 * both. A strategy that's robust to resampling but fails the sign-flip
 * is fitting noise; a strategy that has clear directionality but fails
 * resampling is fragile to specific path realizations.
 */

export interface DirectionalEdgeTestInput {
  /** Per-period strategy returns (decimals). */
  returns: ReadonlyArray<number>;
  /** Number of sign-randomization samples. Default 500. */
  samples?: number;
  /** Optional deterministic seed for reproducibility. */
  seed?: number;
  /** Periods per year for Sharpe annualization. Default 252. */
  periodsPerYear?: number;
}

export type EdgeVerdict = "real_edge" | "marginal_edge" | "noise";

export interface DirectionalEdgeTestResult {
  realizedSharpe: number;
  /** Median |Sharpe| across the sign-randomized null distribution. */
  nullMedianAbsSharpe: number;
  nullCi05: number;
  nullCi95: number;
  /** Percentile (0..1) of |realized Sharpe| within the null |Sharpe| distribution. */
  edgePercentile: number;
  verdict: EdgeVerdict;
  samples: number;
  sampleSize: number;
  reasoning: string;
}

const DEFAULT_SAMPLES = 500;
const DEFAULT_PPY = 252;
const REAL_EDGE_PERCENTILE = 0.95;
const MARGINAL_EDGE_PERCENTILE = 0.8;

function lcg(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0xffffffff;
  };
}

function sharpe(returns: ReadonlyArray<number>, ppy: number): number {
  if (returns.length < 2) return 0;
  let sum = 0;
  for (const r of returns) sum += r;
  const mean = sum / returns.length;
  let ss = 0;
  for (const r of returns) ss += (r - mean) * (r - mean);
  const stdev = Math.sqrt(ss / (returns.length - 1));
  if (stdev === 0) return 0;
  return (mean / stdev) * Math.sqrt(ppy);
}

function quantile(sorted: ReadonlyArray<number>, q: number): number {
  if (sorted.length === 0) return 0;
  if (sorted.length === 1) return sorted[0]!;
  const pos = q * (sorted.length - 1);
  const lo = Math.floor(pos);
  const hi = Math.min(sorted.length - 1, lo + 1);
  const frac = pos - lo;
  return sorted[lo]! * (1 - frac) + sorted[hi]! * frac;
}

function signFlip(returns: ReadonlyArray<number>, rng: () => number): number[] {
  const out: number[] = new Array(returns.length);
  for (let i = 0; i < returns.length; i++) {
    out[i] = rng() < 0.5 ? -returns[i]! : returns[i]!;
  }
  return out;
}

export function runDirectionalEdgeTest(
  input: DirectionalEdgeTestInput,
): DirectionalEdgeTestResult {
  const returns = input.returns;
  const samples = input.samples ?? DEFAULT_SAMPLES;
  const ppy = input.periodsPerYear ?? DEFAULT_PPY;
  const seed = input.seed ?? Date.now();

  if (returns.length < 30) {
    return {
      realizedSharpe: Number.NaN,
      nullMedianAbsSharpe: 0,
      nullCi05: 0,
      nullCi95: 0,
      edgePercentile: 0.5,
      verdict: "noise",
      samples: 0,
      sampleSize: returns.length,
      reasoning: `need at least 30 returns, got ${returns.length}`,
    };
  }

  const rng = lcg(seed);
  const realizedSharpe = sharpe(returns, ppy);
  const realizedAbs = Math.abs(realizedSharpe);

  const nullAbsSharpes: number[] = new Array(samples);
  for (let i = 0; i < samples; i++) {
    const flipped = signFlip(returns, rng);
    nullAbsSharpes[i] = Math.abs(sharpe(flipped, ppy));
  }

  const sorted = [...nullAbsSharpes].sort((a, b) => a - b);
  const nullMedian = quantile(sorted, 0.5);
  const ci05 = quantile(sorted, 0.05);
  const ci95 = quantile(sorted, 0.95);

  let below = 0;
  for (const s of sorted) if (s < realizedAbs) below++;
  const edgePercentile = below / sorted.length;

  let verdict: EdgeVerdict;
  if (edgePercentile >= REAL_EDGE_PERCENTILE) verdict = "real_edge";
  else if (edgePercentile >= MARGINAL_EDGE_PERCENTILE) verdict = "marginal_edge";
  else verdict = "noise";

  const reasoning =
    `|Sharpe| ${realizedAbs.toFixed(2)} at p${(edgePercentile * 100).toFixed(0)} of the ${samples}-sample sign-randomized null ` +
    `(null median ${nullMedian.toFixed(2)}, 5–95 CI [${ci05.toFixed(2)}, ${ci95.toFixed(2)}]) → ${verdict}`;

  return {
    realizedSharpe,
    nullMedianAbsSharpe: nullMedian,
    nullCi05: ci05,
    nullCi95: ci95,
    edgePercentile,
    verdict,
    samples,
    sampleSize: returns.length,
    reasoning,
  };
}

export function directionalEdgeTestToPayload(
  result: DirectionalEdgeTestResult,
): Record<string, unknown> {
  return {
    kind: "directional_edge_test.evaluated",
    realizedSharpe: Number.isFinite(result.realizedSharpe)
      ? Number(result.realizedSharpe.toFixed(4))
      : null,
    nullMedianAbsSharpe: Number(result.nullMedianAbsSharpe.toFixed(4)),
    edgePercentile: Number(result.edgePercentile.toFixed(3)),
    verdict: result.verdict,
    samples: result.samples,
    sampleSize: result.sampleSize,
  };
}
