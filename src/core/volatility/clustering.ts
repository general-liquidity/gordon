/**
 * Volatility clustering test — Ljung-Box on squared returns.
 *
 * "Volatility clustering" is the well-documented phenomenon that
 * high-volatility periods tend to be followed by other high-volatility
 * periods (and vice-versa for low-vol). The canonical statistical
 * test is Ljung-Box on SQUARED returns:
 *
 *     Q = n(n+2) × Σ(ρ̂²_k / (n-k))  for k = 1..h
 *
 * where ρ̂_k is the sample autocorrelation of `returns²` at lag k.
 * Under H₀ (no autocorrelation in squared returns = no vol clustering),
 * Q follows χ²(h). Reject H₀ when Q > critical value at α.
 *
 * What the operator gets:
 *
 *   - Q statistic + degrees of freedom + approximate p-value
 *   - The raw autocorrelations at each lag (so the operator can see
 *     whether clustering decays smoothly or spikes at specific lags)
 *   - Verdict: `clustered` / `stationary` / `insufficient_data`
 *
 * When verdict = `clustered`, vol-regime models (GARCH-family) are
 * applicable. When `stationary`, the simpler "vol is iid" assumption
 * holds and a static vol estimate is appropriate. This composes with
 * Gordon's existing vol-regime classifier + position-sizing without
 * replacing them.
 *
 * Pre-tabulated χ² critical values (df 1..15) — no stats library
 * required. Same approach as the Markov-stability test shipped in
 * commit e6a31f0c.
 */

export type ClusteringVerdict = "clustered" | "stationary" | "insufficient_data";

export interface ClusteringTest {
  /** Ljung-Box Q statistic on squared returns. */
  ljungBoxStatistic: number;
  /** Degrees of freedom (number of lags tested). */
  degreesOfFreedom: number;
  /** Approximate two-sided p-value from χ²(df) reference table. */
  pValue: number;
  /** Sample size used (length of returns array). */
  sampleSize: number;
  /** Lags 1..h with their sample autocorrelations on squared returns. */
  squaredReturnAutocorrelations: Array<{ lag: number; rho: number }>;
  /** Operator verdict. */
  verdict: ClusteringVerdict;
  /** Human-readable summary. */
  summary: string;
}

export interface ClusteringOptions {
  /** Number of lags to test. Default 10. Higher reveals longer-range memory. */
  lags?: number;
  /** Minimum sample size to run the test. Default 30. */
  minSampleSize?: number;
  /** p-value below which we reject stationarity. Default 0.05. */
  significanceLevel?: number;
}

const DEFAULT_OPTIONS: Required<ClusteringOptions> = {
  lags: 10,
  minSampleSize: 30,
  significanceLevel: 0.05,
};

/**
 * χ² critical values at α = 0.05 and α = 0.01 for df 1..15.
 * Sourced from standard chi-square tables.
 */
const CHI2_CRIT_005: Record<number, number> = {
  1: 3.841,
  2: 5.991,
  3: 7.815,
  4: 9.488,
  5: 11.07,
  6: 12.592,
  7: 14.067,
  8: 15.507,
  9: 16.919,
  10: 18.307,
  11: 19.675,
  12: 21.026,
  13: 22.362,
  14: 23.685,
  15: 24.996,
};

const CHI2_CRIT_001: Record<number, number> = {
  1: 6.635,
  2: 9.21,
  3: 11.345,
  4: 13.277,
  5: 15.086,
  6: 16.812,
  7: 18.475,
  8: 20.09,
  9: 21.666,
  10: 23.209,
  11: 24.725,
  12: 26.217,
  13: 27.688,
  14: 29.141,
  15: 30.578,
};

function approxChiSquarePValue(chi2: number, df: number): number {
  const crit05 = CHI2_CRIT_005[df];
  const crit01 = CHI2_CRIT_001[df];
  if (crit05 === undefined || crit01 === undefined) return 0.5;
  if (chi2 < crit05) {
    return 0.05 + ((crit05 - chi2) / Math.max(crit05, 1)) * 0.45;
  }
  if (chi2 > crit01) {
    return Math.max(0.0001, 0.01 * (crit01 / Math.max(chi2, crit01)));
  }
  const t = (chi2 - crit05) / (crit01 - crit05);
  return 0.05 - t * 0.04;
}

/**
 * Sample autocorrelation of `values` at lag k. Returns 0 when the
 * series has zero variance or insufficient length.
 */
function autocorrelation(values: number[], k: number): number {
  const n = values.length;
  if (n <= k) return 0;
  let mean = 0;
  for (const v of values) mean += v;
  mean /= n;

  let num = 0;
  let den = 0;
  for (let t = 0; t < n - k; t++) {
    num += (values[t]! - mean) * (values[t + k]! - mean);
  }
  for (let t = 0; t < n; t++) {
    den += (values[t]! - mean) * (values[t]! - mean);
  }
  if (den === 0) return 0;
  return num / den;
}

/**
 * Test for volatility clustering via Ljung-Box on squared returns.
 *
 * @param returns array of period-over-period returns (NOT prices)
 * @param options test configuration (lags, significance, minimum sample)
 */
export function testVolatilityClustering(
  returns: number[],
  options: ClusteringOptions = {},
): ClusteringTest {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const n = returns.length;

  if (n < opts.minSampleSize) {
    return {
      ljungBoxStatistic: 0,
      degreesOfFreedom: 0,
      pValue: 1,
      sampleSize: n,
      squaredReturnAutocorrelations: [],
      verdict: "insufficient_data",
      summary: `Sample size ${n} below ${opts.minSampleSize} minimum for Ljung-Box test`,
    };
  }

  // Cap lags at min(h, df=15-table-coverage, n/4)
  const maxLag = Math.min(opts.lags, 15, Math.floor(n / 4));
  if (maxLag < 1) {
    return {
      ljungBoxStatistic: 0,
      degreesOfFreedom: 0,
      pValue: 1,
      sampleSize: n,
      squaredReturnAutocorrelations: [],
      verdict: "insufficient_data",
      summary: `Sample size ${n} produces zero valid lags`,
    };
  }

  // Square the returns
  const squared = returns.map((r) => r * r);

  // Compute Ljung-Box Q on squared returns
  const autocorrs: Array<{ lag: number; rho: number }> = [];
  let q = 0;
  for (let k = 1; k <= maxLag; k++) {
    const rho = autocorrelation(squared, k);
    autocorrs.push({ lag: k, rho });
    q += (rho * rho) / (n - k);
  }
  q *= n * (n + 2);

  const pValue = approxChiSquarePValue(q, maxLag);
  const verdict: ClusteringVerdict = pValue < opts.significanceLevel ? "clustered" : "stationary";

  const topLag = [...autocorrs].sort((a, b) => Math.abs(b.rho) - Math.abs(a.rho))[0]!;
  const summary =
    `Ljung-Box Q=${q.toFixed(2)} (df=${maxLag}, p≈${pValue.toFixed(3)}) → ${verdict}` +
    ` [max |ρ|=${topLag.rho.toFixed(3)} at lag ${topLag.lag}]`;

  return {
    ljungBoxStatistic: parseFloat(q.toFixed(3)),
    degreesOfFreedom: maxLag,
    pValue: parseFloat(pValue.toFixed(4)),
    sampleSize: n,
    squaredReturnAutocorrelations: autocorrs.map(({ lag, rho }) => ({
      lag,
      rho: parseFloat(rho.toFixed(4)),
    })),
    verdict,
    summary,
  };
}

/**
 * Convenience: convert a price series into returns + run the clustering test.
 */
export function testVolatilityClusteringFromPrices(
  prices: number[],
  options: ClusteringOptions = {},
): ClusteringTest {
  if (prices.length < 2) {
    return testVolatilityClustering([], options);
  }
  const returns: number[] = [];
  for (let i = 1; i < prices.length; i++) {
    const prev = prices[i - 1]!;
    if (prev === 0 || !Number.isFinite(prev)) continue;
    returns.push((prices[i]! - prev) / prev);
  }
  return testVolatilityClustering(returns, options);
}
