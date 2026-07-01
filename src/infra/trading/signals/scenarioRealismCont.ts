/**
 * Scenario Realism — Cont Stylized-Facts Battery (extension)
 *
 * Gordon's `scenarioRealism.ts` checks three stylized facts (fat tails, volatility
 * clustering, leverage effect). This extension adds the remaining Cont facts a
 * Normal-path / naive generator silently violates, hardening the synthetic-futures
 * and swarm acceptance gate. All checks are deterministic reductions over the
 * return series (plus an optional aligned volume series). Nothing is plotted.
 *
 * Facts added here (numbering follows Cont's survey):
 *   - Fano / intermittency of volatility (bursty, non-Poisson volatility)
 *   - Gain/loss skew asymmetry (downside moves sharper than upside)
 *   - Volume/volatility correlation (needs volume[])
 *   - Zumbach / timescale asymmetry (coarse past vol predicts fine future vol
 *     more than the reverse)
 *   - Aggregational Gaussianity (excess kurtosis shrinks as returns are summed)
 *   - Conditional heavy tails (fat tails survive after removing clustering)
 *
 * Reference: Cont, R. (2001), "Empirical properties of asset returns: stylized
 * facts and statistical issues", Quantitative Finance 1(2), 223-236.
 */

export interface ContFactsOptions {
  /** Window (in bars) for Fano intermittency and coarse-grained volatility. */
  fanoWindow?: number;
  /** Quantile of |return| above which a bar counts as a volatility "event". */
  fanoQuantile?: number;
  /** Non-overlapping aggregation scale for aggregational Gaussianity. */
  aggregationScale?: number;
  /** Trailing window for the local-volatility normalization (conditional tails). */
  localVolWindow?: number;
  /** Lead-lag offset for the Zumbach timescale-asymmetry measure. */
  zumbachLag?: number;
}

export interface ContStylizedFacts {
  /** Fano factor of windowed squared returns; > 1 => bursty/intermittent vol. */
  fanoFactor: number;
  intermittency: boolean;

  /** Return skewness; < 0 => gain/loss asymmetry (losses sharper). */
  skewness: number;
  gainLossAsymmetry: boolean;

  /** corr(|return|, volume); null when no usable volume series supplied. */
  volumeVolatilityCorrelation: number | null;
  volumeVolatilityCoupling: boolean;

  /** Past-coarse→future-fine minus reverse; > 0 => timescale asymmetry. */
  zumbachAsymmetry: number;
  timescaleAsymmetry: boolean;

  /** Excess kurtosis at the base scale vs the aggregated scale. */
  scale1ExcessKurtosis: number;
  aggregatedExcessKurtosis: number;
  /** Kurtosis shrinks toward Gaussian as returns are aggregated. */
  aggregationalGaussianity: boolean;

  /** Excess kurtosis of vol-standardized residuals; > 0 => tails survive. */
  conditionalExcessKurtosis: number;
  conditionalHeavyTails: boolean;

  /** False when there was not enough data to compute the battery. */
  valid: boolean;
}

const EMPTY: ContStylizedFacts = {
  fanoFactor: 0,
  intermittency: false,
  skewness: 0,
  gainLossAsymmetry: false,
  volumeVolatilityCorrelation: null,
  volumeVolatilityCoupling: false,
  zumbachAsymmetry: 0,
  timescaleAsymmetry: false,
  scale1ExcessKurtosis: 0,
  aggregatedExcessKurtosis: 0,
  aggregationalGaussianity: false,
  conditionalExcessKurtosis: 0,
  conditionalHeavyTails: false,
  valid: false,
};

function mean(values: number[]): number {
  return values.length === 0
    ? 0
    : values.reduce((sum, v) => sum + v, 0) / values.length;
}

function excessKurtosis(values: number[]): number {
  if (values.length < 4) return 0;
  const m = mean(values);
  let s2 = 0;
  let s4 = 0;
  for (const v of values) {
    const d = v - m;
    s2 += d * d;
    s4 += d * d * d * d;
  }
  const variance = s2 / values.length;
  if (variance <= 0) return 0;
  return s4 / values.length / (variance * variance) - 3;
}

function skewness(values: number[]): number {
  if (values.length < 3) return 0;
  const m = mean(values);
  let s2 = 0;
  let s3 = 0;
  for (const v of values) {
    const d = v - m;
    s2 += d * d;
    s3 += d * d * d;
  }
  const variance = s2 / values.length;
  const sd = Math.sqrt(variance);
  if (sd <= 0) return 0;
  return s3 / values.length / (sd * sd * sd);
}

function correlation(left: number[], right: number[]): number {
  const n = Math.min(left.length, right.length);
  if (n < 2) return 0;
  const meanLeft = mean(left.slice(0, n));
  const meanRight = mean(right.slice(0, n));
  let cov = 0;
  let vl = 0;
  let vr = 0;
  for (let i = 0; i < n; i++) {
    const a = left[i]! - meanLeft;
    const b = right[i]! - meanRight;
    cov += a * b;
    vl += a * a;
    vr += b * b;
  }
  return vl > 0 && vr > 0 ? cov / Math.sqrt(vl * vr) : 0;
}

/** Non-overlapping window sums of `values`, dropping any short trailing window. */
function windowSums(values: number[], window: number): number[] {
  const sums: number[] = [];
  for (let i = 0; i + window <= values.length; i += window) {
    let s = 0;
    for (let j = i; j < i + window; j++) s += values[j]!;
    sums.push(s);
  }
  return sums;
}

/** Linear-index quantile (0..1) of a numeric sample. */
function quantile(values: number[], q: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.floor(q * (sorted.length - 1))));
  return sorted[idx]!;
}

/** Trailing rolling sum ending at each index (window bars). */
function rollingSum(values: number[], window: number): number[] {
  const out: number[] = [];
  for (let t = window - 1; t < values.length; t++) {
    let s = 0;
    for (let j = t - window + 1; j <= t; j++) s += values[j]!;
    out.push(s);
  }
  return out;
}

export function validateContStylizedFacts(
  returns: number[],
  options: ContFactsOptions = {},
  volume?: number[],
): ContStylizedFacts {
  const fanoWindow = options.fanoWindow ?? 10;
  const fanoQuantile = options.fanoQuantile ?? 0.9;
  const aggregationScale = options.aggregationScale ?? 5;
  const localVolWindow = options.localVolWindow ?? 10;
  const zumbachLag = options.zumbachLag ?? 1;

  const minLen = Math.max(20, fanoWindow * 2, aggregationScale * 4, localVolWindow * 2);
  if (returns.length < minLen || returns.some((v) => !Number.isFinite(v))) {
    return { ...EMPTY };
  }

  const absReturns = returns.map(Math.abs);

  // --- Fano / intermittency: Fano factor of the volatility-EVENT count process.
  // A bar is an "event" when |return| exceeds a high quantile. Counting events
  // per window makes this a dimensionless counting process (unlike a Fano factor
  // over raw squared returns, whose scale would make the >1 test meaningless):
  // Fano ~ 1 for Poisson-like arrivals, > 1 when events cluster into bursts.
  const eventThreshold = quantile(absReturns, fanoQuantile);
  const events = absReturns.map((a) => (a > eventThreshold ? 1 : 0));
  const counts = windowSums(events, fanoWindow);
  const countMean = mean(counts);
  const countVar = counts.length > 1 ? mean(counts.map((c) => (c - countMean) ** 2)) : 0;
  const fanoFactor = countMean > 0 ? countVar / countMean : 0;

  // --- Gain/loss skew asymmetry.
  const skew = skewness(returns);

  // --- Volume/volatility correlation (needs an aligned, non-degenerate series).
  let volumeVolatilityCorrelation: number | null = null;
  if (volume && volume.length >= returns.length && volume.every(Number.isFinite)) {
    const alignedVol = volume.slice(0, returns.length);
    const distinct = new Set(alignedVol).size;
    if (distinct > 1) {
      volumeVolatilityCorrelation = correlation(absReturns, alignedVol);
    }
  }

  // --- Zumbach / timescale asymmetry: coarse past vol vs fine future vol.
  const coarse = rollingSum(absReturns, fanoWindow); // coarse-grained realized vol
  const fine = absReturns.slice(fanoWindow - 1); // instantaneous vol, aligned to coarse
  let zumbachAsymmetry = 0;
  if (coarse.length > zumbachLag + 2) {
    const pastCoarse = coarse.slice(0, coarse.length - zumbachLag);
    const futureFine = fine.slice(zumbachLag);
    const pastFine = fine.slice(0, fine.length - zumbachLag);
    const futureCoarse = coarse.slice(zumbachLag);
    zumbachAsymmetry =
      correlation(pastCoarse, futureFine) - correlation(pastFine, futureCoarse);
  }

  // --- Aggregational Gaussianity: kurtosis shrinks under aggregation.
  const scale1ExcessKurtosis = excessKurtosis(returns);
  const aggregated = windowSums(returns, aggregationScale);
  const aggregatedExcessKurtosis = excessKurtosis(aggregated);

  // --- Conditional heavy tails: standardize by trailing local vol, re-check tails.
  const residuals: number[] = [];
  for (let t = localVolWindow; t < returns.length; t++) {
    const win = returns.slice(t - localVolWindow, t);
    const wMean = mean(win);
    const wVar = mean(win.map((v) => (v - wMean) ** 2));
    const localVol = Math.sqrt(wVar);
    if (localVol > 0) residuals.push(returns[t]! / localVol);
  }
  const conditionalExcessKurtosis = excessKurtosis(residuals);

  return {
    fanoFactor,
    intermittency: fanoFactor > 1,
    skewness: skew,
    gainLossAsymmetry: skew < 0,
    volumeVolatilityCorrelation,
    volumeVolatilityCoupling:
      volumeVolatilityCorrelation !== null && volumeVolatilityCorrelation > 0,
    zumbachAsymmetry,
    timescaleAsymmetry: zumbachAsymmetry > 0,
    scale1ExcessKurtosis,
    aggregatedExcessKurtosis,
    aggregationalGaussianity: aggregatedExcessKurtosis < scale1ExcessKurtosis,
    conditionalExcessKurtosis,
    conditionalHeavyTails: conditionalExcessKurtosis > 0,
    valid: true,
  };
}
