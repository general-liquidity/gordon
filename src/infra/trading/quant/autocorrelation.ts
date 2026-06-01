/**
 * Autocorrelation (ACF) and Partial Autocorrelation (PACF) functions.
 *
 * The ACF measures linear dependence between a series and its own lagged
 * values. The PACF measures that dependence *after* removing the effect of
 * the intervening lags — i.e. the correlation between y[t] and y[t-k] not
 * already explained by lags 1..k-1. Together they are the classic
 * Box-Jenkins identification tool:
 *
 *   - AR(p):  PACF cuts off after lag p, ACF decays geometrically.
 *   - MA(q):  ACF cuts off after lag q, PACF decays.
 *   - White noise: both ≈ 0 for all lags > 0 (within the ±1.96/√n band).
 *
 * ACF is computed with the biased (divide-by-n) estimator — the standard
 * choice that guarantees a positive-semidefinite autocovariance sequence and
 * matches statsmodels' `acf` default. PACF uses the Durbin-Levinson
 * recursion on the sample autocorrelations.
 *
 * The ±1.96/√n band is the asymptotic 95% confidence interval for the null
 * of white noise; coefficients inside the band are statistically
 * indistinguishable from zero.
 *
 * NULL-on-missing-input: short / degenerate (constant) series return null
 * rather than fabricating zeros.
 */

export interface AcfResult {
  /** ACF values for lags 0..maxLag. acf[0] is always 1. */
  acf: number[];
  /** Approximate 95% confidence band (half-width), ±1.96/√n. */
  confidenceBand: number;
  maxLag: number;
  sampleSize: number;
}

export interface PacfResult {
  /** PACF values for lags 0..maxLag. pacf[0] is always 1 by convention. */
  pacf: number[];
  /** Approximate 95% confidence band (half-width), ±1.96/√n. */
  confidenceBand: number;
  maxLag: number;
  sampleSize: number;
}

function autocovariances(series: ReadonlyArray<number>, maxLag: number): number[] | null {
  const n = series.length;
  let mean = 0;
  for (let i = 0; i < n; i++) mean += series[i]!;
  mean /= n;

  const gamma: number[] = new Array(maxLag + 1).fill(0);
  for (let k = 0; k <= maxLag; k++) {
    let sum = 0;
    for (let t = k; t < n; t++) {
      sum += (series[t]! - mean) * (series[t - k]! - mean);
    }
    gamma[k] = sum / n; // biased estimator
  }
  if (gamma[0]! <= 0) return null; // constant series — no variance
  return gamma;
}

/**
 * Sample autocorrelation function for lags 0..maxLag.
 * Returns null on insufficient data or a constant (zero-variance) series.
 */
export function acf(series: ReadonlyArray<number>, maxLag: number): AcfResult | null {
  const n = series.length;
  const lag = Math.max(1, Math.floor(maxLag));
  if (n < lag + 2) return null;
  for (let i = 0; i < n; i++) if (!Number.isFinite(series[i]!)) return null;

  const gamma = autocovariances(series, lag);
  if (!gamma) return null;

  const out: number[] = new Array(lag + 1);
  const g0 = gamma[0]!;
  for (let k = 0; k <= lag; k++) out[k] = parseFloat((gamma[k]! / g0).toFixed(6));

  return {
    acf: out,
    confidenceBand: parseFloat((1.96 / Math.sqrt(n)).toFixed(6)),
    maxLag: lag,
    sampleSize: n,
  };
}

/**
 * Sample partial autocorrelation function via the Durbin-Levinson recursion.
 *
 * φ[k][k] is the PACF at lag k. The recursion:
 *   φ[k][k] = (ρ[k] - Σ_{j=1}^{k-1} φ[k-1][j]·ρ[k-j]) / (1 - Σ_{j=1}^{k-1} φ[k-1][j]·ρ[j])
 *   φ[k][j] = φ[k-1][j] - φ[k][k]·φ[k-1][k-j]   for j = 1..k-1
 *
 * Returns null on insufficient data or a constant series.
 */
export function pacf(series: ReadonlyArray<number>, maxLag: number): PacfResult | null {
  const n = series.length;
  const lag = Math.max(1, Math.floor(maxLag));
  if (n < lag + 2) return null;
  for (let i = 0; i < n; i++) if (!Number.isFinite(series[i]!)) return null;

  const gamma = autocovariances(series, lag);
  if (!gamma) return null;

  const g0 = gamma[0]!;
  const rho: number[] = new Array(lag + 1);
  for (let k = 0; k <= lag; k++) rho[k] = gamma[k]! / g0;

  // phi[k] holds the AR(k) coefficients φ[k][1..k] for the current order.
  const pacfVals: number[] = new Array(lag + 1).fill(0);
  pacfVals[0] = 1;

  let phiPrev: number[] = []; // φ[k-1][1..k-1], 0-indexed as φ[k-1][j] = phiPrev[j-1]
  for (let k = 1; k <= lag; k++) {
    let num = rho[k]!;
    let den = 1;
    for (let j = 1; j < k; j++) {
      num -= phiPrev[j - 1]! * rho[k - j]!;
      den -= phiPrev[j - 1]! * rho[j]!;
    }
    const phiKK = den !== 0 ? num / den : 0;
    pacfVals[k] = parseFloat(phiKK.toFixed(6));

    const phiCur: number[] = new Array(k);
    phiCur[k - 1] = phiKK;
    for (let j = 1; j < k; j++) {
      phiCur[j - 1] = phiPrev[j - 1]! - phiKK * phiPrev[k - j - 1]!;
    }
    phiPrev = phiCur;
  }

  return {
    pacf: pacfVals,
    confidenceBand: parseFloat((1.96 / Math.sqrt(n)).toFixed(6)),
    maxLag: lag,
    sampleSize: n,
  };
}
