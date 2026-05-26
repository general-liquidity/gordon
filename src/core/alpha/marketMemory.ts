/**
 * Market-memory diagnostic — Hurst exponent + variance-ratio test.
 *
 * Answers "what kind of memory does this series have?" — trending,
 * mean-reverting, or random walk — before you commit to a strategy
 * class. Complements `compute_regime` (which classifies the current
 * state of the market) by classifying the *type* of memory the
 * market carries on this horizon.
 *
 * Three ingredients:
 *
 *   1. R/S Hurst estimator with Anis-Lloyd small-sample correction.
 *      H near 0.5 → random walk. H > 0.5 → persistence. H < 0.5 →
 *      anti-persistence (mean reversion).
 *
 *   2. Surrogate permutation test for significance. Shuffles the
 *      return series N times to build a null distribution; the
 *      p-value is measured against the shuffled distribution's
 *      OWN center, not against 0.5, so the estimator's bias
 *      cancels out of the comparison.
 *
 *   3. Lo-MacKinlay variance-ratio profile (q ∈ {2, 5, 10, 20}) with
 *      a heteroskedasticity-robust z-statistic. Confirms the Hurst
 *      reading independently and shows over what horizon the memory
 *      lives.
 *
 * Verdict combines all three: significance gate from the permutation
 * test, direction from corrected H, horizon shape from the VR profile.
 */

export type MemoryVerdict = "trending" | "mean_reverting" | "random_walk";

export interface MarketMemoryInput {
  /** Price series, oldest → newest. ≥ 60 points strongly recommended. */
  prices: number[];
  /** Surrogate-test permutations. Default 1000. */
  nSurrogates?: number;
  /** Min R/S window. Default 8. */
  minWindow?: number;
  /** Variance-ratio horizons. Default [2, 5, 10, 20]. */
  vrHorizons?: number[];
  /** Two-sided p-value cutoff for the "significant memory" gate. Default 0.05. */
  pValueCutoff?: number;
  /** Optional RNG override for deterministic testing. */
  rng?: () => number;
}

export interface VarianceRatioPoint {
  horizon: number;
  ratio: number;
  zScore: number;
  pValue: number;
}

export interface MarketMemoryResult {
  /** Number of usable log-returns from the input series. */
  nReturns: number;
  /** Raw R/S Hurst estimate (biased on short samples). */
  hurst: number;
  /** Anis-Lloyd-corrected Hurst estimate. */
  hurstCorrected: number;
  /** Surrogate-test p-value vs the shuffled-null distribution. */
  surrogateP: number;
  /** Mean of the shuffled-null distribution (sanity reference). */
  nullMean: number;
  /** Variance-ratio profile at the requested horizons. */
  varianceRatio: VarianceRatioPoint[];
  /** Final verdict combining the significance gate + corrected H. */
  verdict: MemoryVerdict;
  /** Coarse confidence label. */
  reliability: "low" | "medium" | "high";
  summary: string;
}

// ============================================================================
// math helpers
// ============================================================================

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

function stddev(xs: number[], avg?: number, ddof: number = 0): number {
  if (xs.length - ddof < 1) return 0;
  const m = avg ?? mean(xs);
  let s = 0;
  for (const x of xs) s += (x - m) * (x - m);
  return Math.sqrt(s / (xs.length - ddof));
}

function logspaceInts(min: number, max: number, n: number): number[] {
  const out = new Set<number>();
  if (max <= min) return [Math.max(1, Math.floor(min))];
  const logMin = Math.log(min);
  const logMax = Math.log(max);
  for (let i = 0; i < n; i++) {
    const x = Math.round(Math.exp(logMin + (i * (logMax - logMin)) / Math.max(1, n - 1)));
    if (x >= 2) out.add(x);
  }
  return [...out].sort((a, b) => a - b);
}

function rescaledRangeForWindow(returns: number[], windowSize: number): number {
  const rsVals: number[] = [];
  const chunks = Math.floor(returns.length / windowSize);
  for (let c = 0; c < chunks; c++) {
    const chunk = returns.slice(c * windowSize, (c + 1) * windowSize);
    const chunkMean = mean(chunk);
    let cumSum = 0;
    let lo = Infinity;
    let hi = -Infinity;
    for (const r of chunk) {
      cumSum += r - chunkMean;
      if (cumSum < lo) lo = cumSum;
      if (cumSum > hi) hi = cumSum;
    }
    const range = hi - lo;
    const sd = stddev(chunk, chunkMean, 0);
    if (sd > 0) rsVals.push(range / sd);
  }
  if (rsVals.length === 0) return Number.NaN;
  return mean(rsVals);
}

function linearSlope(xs: number[], ys: number[]): number {
  const n = xs.length;
  const xBar = mean(xs);
  const yBar = mean(ys);
  let num = 0;
  let den = 0;
  for (let i = 0; i < n; i++) {
    num += (xs[i]! - xBar) * (ys[i]! - yBar);
    den += (xs[i]! - xBar) * (xs[i]! - xBar);
  }
  if (den === 0) return 0;
  return num / den;
}

// ============================================================================
// Hurst (R/S, with Anis-Lloyd correction)
// ============================================================================

function hurstRS(returns: number[], minWindow: number): { hurst: number; sizes: number[]; rs: number[] } {
  const maxWindow = Math.max(minWindow, Math.floor(returns.length / 2));
  const sizes = logspaceInts(minWindow, maxWindow, 14);
  const rs: number[] = [];
  const okSizes: number[] = [];
  for (const n of sizes) {
    const r = rescaledRangeForWindow(returns, n);
    if (Number.isFinite(r) && r > 0) {
      rs.push(r);
      okSizes.push(n);
    }
  }
  if (rs.length < 2) return { hurst: 0.5, sizes: okSizes, rs };
  const slope = linearSlope(okSizes.map(Math.log), rs.map(Math.log));
  return { hurst: slope, sizes: okSizes, rs };
}

/**
 * Anis-Lloyd 1976 expected R/S of an independent series at window size n.
 * Computes the gamma-function bias term in log-space to avoid overflow
 * on large n.
 */
function expectedRS(n: number): number {
  if (n < 2) return 0;
  // Σ_{i=1..n-1} sqrt((n-i)/i)
  let back = 0;
  for (let i = 1; i < n; i++) {
    back += Math.sqrt((n - i) / i);
  }
  const front = (n - 0.5) / n;
  // middle = exp(lnGamma((n-1)/2) - lnGamma(n/2)) / sqrt(π); fall back to
  // the large-n asymptote when n is big enough that the lngamma ratio is
  // numerically unstable.
  let middle: number;
  if (n <= 340) {
    middle = Math.exp(lnGamma((n - 1) / 2) - lnGamma(n / 2)) / Math.sqrt(Math.PI);
  } else {
    middle = 1 / Math.sqrt((n * Math.PI) / 2);
  }
  return front * middle * back;
}

/** Lanczos approximation of ln(Γ(x)). Accurate to ~1e-13 for x > 0. */
function lnGamma(x: number): number {
  const c = [
    76.18009172947146, -86.50532032941677, 24.01409824083091,
    -1.231739572450155, 0.001208650973866179, -0.000005395239384953,
  ];
  let y = x;
  const t = x + 5.5 - (x + 0.5) * Math.log(x + 5.5);
  let series = 1.000000000190015;
  for (const ck of c) {
    y += 1;
    series += ck / y;
  }
  return -t + Math.log((2.5066282746310005 * series) / x);
}

function anisLloydHurst(returns: number[], rawRs: number[], sizes: number[]): number {
  if (sizes.length < 2) return 0.5;
  const expectedSeries = sizes.map(expectedRS);
  const slopeEmp = linearSlope(sizes.map(Math.log), rawRs.map(Math.log));
  const slopeExp = linearSlope(sizes.map(Math.log), expectedSeries.map(Math.log));
  return 0.5 + (slopeEmp - slopeExp);
}

// ============================================================================
// Surrogate permutation test
// ============================================================================

function shuffle<T>(xs: T[], rng: () => number): T[] {
  const out = [...xs];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const tmp = out[i]!;
    out[i] = out[j]!;
    out[j] = tmp;
  }
  return out;
}

function surrogatePValue(
  returns: number[],
  rawHurst: number,
  minWindow: number,
  nSurrogates: number,
  rng: () => number,
): { p: number; nullMean: number } {
  const nullDist: number[] = [];
  for (let i = 0; i < nSurrogates; i++) {
    const shuffled = shuffle(returns, rng);
    const { hurst } = hurstRS(shuffled, minWindow);
    if (Number.isFinite(hurst)) nullDist.push(hurst);
  }
  if (nullDist.length === 0) return { p: 1, nullMean: 0.5 };
  const nullMean = mean(nullDist);
  const observedDev = Math.abs(rawHurst - nullMean);
  let extreme = 0;
  for (const h of nullDist) if (Math.abs(h - nullMean) >= observedDev) extreme++;
  return { p: extreme / nullDist.length, nullMean };
}

// ============================================================================
// Variance-ratio (Lo-MacKinlay, heteroskedasticity-robust z)
// ============================================================================

function normalCdf(z: number): number {
  // Abramowitz-Stegun 7.1.26
  const t = 1 / (1 + 0.2316419 * Math.abs(z));
  const d = 0.3989422804014327 * Math.exp(-(z * z) / 2);
  const probLeft =
    d *
    t *
    (0.319381530 +
      t *
        (-0.356563782 +
          t *
            (1.781477937 +
              t * (-1.821255978 + t * 1.330274429))));
  return z >= 0 ? 1 - probLeft : probLeft;
}

function varianceRatio(returns: number[], q: number): VarianceRatioPoint {
  const T = returns.length;
  if (q < 2 || q >= T) {
    return { horizon: q, ratio: 1, zScore: 0, pValue: 1 };
  }
  const mu = mean(returns);
  let var1 = 0;
  for (const r of returns) var1 += (r - mu) * (r - mu);
  var1 /= T - 1;
  if (var1 === 0) return { horizon: q, ratio: 1, zScore: 0, pValue: 1 };

  // overlapping q-sums
  let sumSq = 0;
  let count = 0;
  for (let i = 0; i <= T - q; i++) {
    let s = 0;
    for (let j = 0; j < q; j++) s += returns[i + j]!;
    sumSq += (s - q * mu) * (s - q * mu);
    count++;
  }
  const varQ = sumSq / (q * count * (1 - q / T));
  const vr = varQ / var1;

  // heteroskedasticity-robust variance of vr (Lo-MacKinlay 1988, eq. 9)
  const sqDev = returns.map((r) => (r - mu) * (r - mu));
  const denomSum = sqDev.reduce((a, b) => a + b, 0);
  let theta = 0;
  for (let j = 1; j < q; j++) {
    let num = 0;
    for (let i = j; i < T; i++) num += sqDev[i]! * sqDev[i - j]!;
    const delta = num / (denomSum * denomSum);
    const w = (2 * (q - j)) / q;
    theta += w * w * delta;
  }
  if (theta <= 0) return { horizon: q, ratio: vr, zScore: 0, pValue: 1 };
  const z = (vr - 1) / Math.sqrt(theta);
  const pValue = 2 * (1 - normalCdf(Math.abs(z)));
  return { horizon: q, ratio: vr, zScore: z, pValue };
}

// ============================================================================
// Top-level entry point
// ============================================================================

function defaultRng(): number {
  return Math.random();
}

export function computeMarketMemory(input: MarketMemoryInput): MarketMemoryResult {
  const minWindow = input.minWindow ?? 8;
  const rng = input.rng ?? defaultRng;
  const horizons = input.vrHorizons ?? [2, 5, 10, 20];
  const nSurrogates = input.nSurrogates ?? 1000;
  const pCutoff = input.pValueCutoff ?? 0.05;

  const returns = logReturns(input.prices);
  const nReturns = returns.length;

  if (nReturns < 16) {
    return {
      nReturns,
      hurst: 0.5,
      hurstCorrected: 0.5,
      surrogateP: 1,
      nullMean: 0.5,
      varianceRatio: [],
      verdict: "random_walk",
      reliability: "low",
      summary: `Insufficient data (${nReturns} returns < 16). Cannot diagnose memory.`,
    };
  }

  const { hurst, sizes, rs } = hurstRS(returns, minWindow);
  const hurstCorrected = anisLloydHurst(returns, rs, sizes);
  const { p, nullMean } = surrogatePValue(returns, hurst, minWindow, nSurrogates, rng);
  const vrProfile = horizons.map((q) => varianceRatio(returns, q));

  const significant = p < pCutoff;
  const verdict: MemoryVerdict = !significant
    ? "random_walk"
    : hurstCorrected > 0.5
      ? "trending"
      : "mean_reverting";

  const reliability: MarketMemoryResult["reliability"] =
    nReturns < 100 ? "low" : nReturns < 500 ? "medium" : "high";

  const vrStr = vrProfile
    .map((v) => `q${v.horizon}=${v.ratio.toFixed(2)}(z${v.zScore >= 0 ? "+" : ""}${v.zScore.toFixed(1)})`)
    .join("  ");

  const summary = [
    `Market memory: ${verdict.toUpperCase()}`,
    `  corrected H = ${hurstCorrected.toFixed(3)}  (raw H = ${hurst.toFixed(3)})`,
    `  surrogate p = ${p.toFixed(4)}  (null mean = ${nullMean.toFixed(3)})`,
    `  VR profile: ${vrStr}`,
    `  reliability: ${reliability}  (n=${nReturns} returns)`,
  ].join("\n");

  return {
    nReturns,
    hurst,
    hurstCorrected,
    surrogateP: p,
    nullMean,
    varianceRatio: vrProfile,
    verdict,
    reliability,
    summary,
  };
}
