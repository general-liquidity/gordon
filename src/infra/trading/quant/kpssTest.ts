/**
 * KPSS stationarity test (Kwiatkowski-Phillips-Schmidt-Shin, 1992).
 *
 * The complement to ADF. Where ADF's null is "unit root" (non-stationary),
 * KPSS *reverses* the hypotheses:
 *
 *   H₀: the series is (trend-)stationary.
 *   H₁: the series has a unit root.
 *
 *   Reject H₀ (large statistic) → non-stationary.
 *
 * Running ADF and KPSS together is the standard confirmatory pattern:
 *   - ADF rejects + KPSS fails to reject → stationary (strong).
 *   - ADF fails + KPSS rejects           → non-stationary / unit root (strong).
 *   - Both reject / both fail            → inconclusive (e.g. fractional
 *     integration, structural break, or too little data).
 *
 * Test statistic:
 *   η = (1/T²) · Σ_t S_t² / s²(ℓ)
 * where S_t = Σ_{i=1}^t e_i is the partial sum of OLS residuals from the
 * deterministic regression, and s²(ℓ) is the Newey-West long-run variance
 * estimator with Bartlett kernel over ℓ lags.
 *
 *   - Level variant  ('c'):  e_t = y_t − ȳ          (residuals about the mean)
 *   - Trend variant  ('ct'): e_t from y_t = α + β·t  (residuals about a trend)
 *
 * Critical values are the KPSS (1992) Table 1 asymptotic values. Note the
 * direction is OPPOSITE to ADF: we reject when the statistic EXCEEDS the
 * critical value.
 *
 * Lag truncation: default ℓ = floor(4·(T/100)^{1/4}) — the Schwert rule used
 * by statsmodels' "legacy" auto-lag. Caller may override via `lags`.
 *
 * NULL-on-missing-input: short / degenerate series return verdict
 * "insufficient_data" with NaN statistic, never a fabricated zero.
 */

export type KpssRegression = "c" | "ct";
export type KpssVerdict = "stationary" | "non_stationary" | "insufficient_data";
export type KpssAlpha = 0.1 | 0.05 | 0.025 | 0.01;

export interface KpssInput {
  series: ReadonlyArray<number>;
  /** "c" = level-stationary (default), "ct" = trend-stationary. */
  regression?: KpssRegression;
  /** Newey-West lag truncation. Default: Schwert rule floor(4·(T/100)^0.25). */
  lags?: number;
  /** Significance level for the verdict. Default 0.05. */
  alpha?: KpssAlpha;
}

export interface KpssResult {
  verdict: KpssVerdict;
  testStatistic: number;
  criticalValue: number;
  /** Full critical-value row for the chosen variant. */
  criticalValues: Record<KpssAlpha, number>;
  regression: KpssRegression;
  lags: number;
  sampleSize: number;
  summary: string;
}

/**
 * KPSS (1992) Table 1 asymptotic critical values.
 * Columns: 10% / 5% / 2.5% / 1%.
 */
const CRITICAL_VALUES: Record<KpssRegression, Record<KpssAlpha, number>> = {
  c: { 0.1: 0.347, 0.05: 0.463, 0.025: 0.574, 0.01: 0.739 },
  ct: { 0.1: 0.119, 0.05: 0.146, 0.025: 0.176, 0.01: 0.216 },
};

const DEFAULT_REGRESSION: KpssRegression = "c";
const DEFAULT_ALPHA: KpssAlpha = 0.05;

function schwertLags(T: number): number {
  return Math.floor(4 * Math.pow(T / 100, 0.25));
}

/** Residuals about the mean (level variant). */
function levelResiduals(y: ReadonlyArray<number>): number[] {
  const n = y.length;
  let mean = 0;
  for (let i = 0; i < n; i++) mean += y[i]!;
  mean /= n;
  const e: number[] = new Array(n);
  for (let i = 0; i < n; i++) e[i] = y[i]! - mean;
  return e;
}

/** Residuals about a fitted linear trend (trend variant). */
function trendResiduals(y: ReadonlyArray<number>): number[] {
  const n = y.length;
  // Regress y on [1, t] with t = 1..n via closed-form OLS.
  let sumT = 0;
  let sumY = 0;
  let sumTT = 0;
  let sumTY = 0;
  for (let i = 0; i < n; i++) {
    const t = i + 1;
    sumT += t;
    sumY += y[i]!;
    sumTT += t * t;
    sumTY += t * y[i]!;
  }
  const denom = n * sumTT - sumT * sumT;
  const beta = denom !== 0 ? (n * sumTY - sumT * sumY) / denom : 0;
  const alpha = (sumY - beta * sumT) / n;
  const e: number[] = new Array(n);
  for (let i = 0; i < n; i++) e[i] = y[i]! - (alpha + beta * (i + 1));
  return e;
}

/** Newey-West long-run variance with Bartlett kernel over `lags`. */
function longRunVariance(e: ReadonlyArray<number>, lags: number): number {
  const n = e.length;
  let gamma0 = 0;
  for (let t = 0; t < n; t++) gamma0 += e[t]! * e[t]!;
  gamma0 /= n;

  let s2 = gamma0;
  for (let l = 1; l <= lags; l++) {
    let gammaL = 0;
    for (let t = l; t < n; t++) gammaL += e[t]! * e[t - l]!;
    gammaL /= n;
    const weight = 1 - l / (lags + 1); // Bartlett
    s2 += 2 * weight * gammaL;
  }
  return s2;
}

export function runKpssTest(input: KpssInput): KpssResult {
  const regression = input.regression ?? DEFAULT_REGRESSION;
  const alpha = input.alpha ?? DEFAULT_ALPHA;
  const y = Array.from(input.series);
  const n = y.length;
  const crit = CRITICAL_VALUES[regression];

  const baseResult = (verdict: KpssVerdict, stat: number, lags: number, summary: string): KpssResult => ({
    verdict,
    testStatistic: stat,
    criticalValue: crit[alpha],
    criticalValues: crit,
    regression,
    lags,
    sampleSize: n,
    summary,
  });

  if (n < 10) {
    return baseResult("insufficient_data", Number.NaN, 0, `need at least 10 observations, got ${n}`);
  }
  for (let i = 0; i < n; i++) {
    if (!Number.isFinite(y[i]!)) {
      return baseResult("insufficient_data", Number.NaN, 0, "series contains non-finite values");
    }
  }

  const lags = Math.max(0, Math.floor(input.lags ?? schwertLags(n)));
  const e = regression === "ct" ? trendResiduals(y) : levelResiduals(y);

  // Partial sums S_t and Σ S_t².
  let cumulative = 0;
  let sumSt2 = 0;
  for (let t = 0; t < n; t++) {
    cumulative += e[t]!;
    sumSt2 += cumulative * cumulative;
  }

  const s2 = longRunVariance(e, lags);
  if (s2 <= 0) {
    return baseResult("insufficient_data", Number.NaN, lags, "degenerate series — zero long-run variance");
  }

  const stat = sumSt2 / (n * n * s2);
  const criticalValue = crit[alpha];
  const reject = stat > criticalValue;

  const summary = reject
    ? `η = ${stat.toFixed(4)} > critical ${criticalValue} at α=${alpha} (${regression}); reject stationarity — likely unit root`
    : `η = ${stat.toFixed(4)} ≤ critical ${criticalValue} at α=${alpha} (${regression}); fail to reject — consistent with ${regression === "ct" ? "trend-" : "level-"}stationarity`;

  return baseResult(
    reject ? "non_stationary" : "stationary",
    parseFloat(stat.toFixed(6)),
    lags,
    summary,
  );
}

export function kpssToPayload(result: KpssResult): Record<string, unknown> {
  return {
    kind: "kpss_test.evaluated",
    verdict: result.verdict,
    testStatistic: Number.isFinite(result.testStatistic) ? result.testStatistic : null,
    criticalValue: result.criticalValue,
    regression: result.regression,
    lags: result.lags,
    sampleSize: result.sampleSize,
  };
}
