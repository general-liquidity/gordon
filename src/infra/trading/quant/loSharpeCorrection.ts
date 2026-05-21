/**
 * Lo Serial-Correlation Sharpe Correction (GORDON_LO_SHARPE_CORRECTION).
 *
 * Port of Ch 5.6.2 from Sarmento & Horta (Springer 2020), which itself
 * adopts the correction from Lo (2002), "The Statistics of Sharpe Ratios"
 * (Financial Analysts Journal 58(4):36-52).
 *
 * The naive annualisation factor √q (where q = periods per year) for the
 * Sharpe ratio assumes IID returns. Real financial returns are routinely
 * serially correlated — momentum strategies, mean-reversion strategies, and
 * autocorrelated noise all violate IID. Under positive serial correlation
 * the naive √q OVERSTATES the annualised Sharpe; under negative serial
 * correlation it UNDERSTATES it. Lo derives the bias-corrected scale
 * factor:
 *
 *   η(q) = q / √( q + 2 · Σ_{k=1}^{q-1} (q − k) · ρ_k )
 *
 * where ρ_k is the sample autocorrelation of returns at lag k. For IID
 * returns (all ρ_k = 0) η(q) reduces to √q, recovering the naive factor.
 *
 * Direct quote (Sarmento p. 66): "[the √252 scaling] is possible only under
 * very special circumstances. Depending on the serial correlation of the
 * portfolio returns, this approximation can yield Sharpe ratio values that
 * are considerably smaller (in the case of positive serial correlation) or
 * larger (in the case of negative serial correlation). The only case in
 * which the approximation is truly valid is if the portfolio returns are
 * independently and identically distributed (IID)."
 *
 * Complements `optimizationQuality.ts` (Jobson-Korkie + Lo non-normal SE)
 * which corrects for kurtosis. This primitive corrects for the orthogonal
 * concern of serial correlation. Both can be applied together.
 *
 * Pure compute. No I/O.
 */

export const LO_SHARPE_CORRECTION_FLAG_ENV = "GORDON_LO_SHARPE_CORRECTION";

export function isLoSharpeCorrectionEnabled(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return (
    env[LO_SHARPE_CORRECTION_FLAG_ENV] === "1" ||
    env[LO_SHARPE_CORRECTION_FLAG_ENV] === "true"
  );
}

export interface LoSharpeCorrectionInput {
  /** Per-period returns. Length must satisfy N ≥ periodsPerYear + 1 for full lag coverage. */
  returns: ReadonlyArray<number>;
  /** Periods per year for annualisation. 252 (daily), 52 (weekly), 12 (monthly). */
  periodsPerYear: number;
  /** Risk-free rate per period (default 0). Subtracted from each return. */
  riskFreePerPeriod?: number;
  /**
   * Max lag to include in the correction. Default min(20, periodsPerYear − 1, ⌊N/10⌋).
   *
   * Lo's formula uses a Bartlett-style (q − k) weighting which downweights
   * longer lags but does not eliminate them. In finite samples the
   * autocorrelations at high lags are dominated by noise and, summed
   * across hundreds of lags, can swamp the real autocorrelation structure
   * and bias the correction in unpredictable directions. Capping at ~20
   * lags is a common Newey-West-style truncation that captures meaningful
   * AR structure without amplifying noise.
   */
  maxLag?: number;
}

export interface LoSharpeCorrectionResult {
  /** Per-period (un-annualised) Sharpe ratio. */
  perPeriodSharpe: number;
  /** Naive annualised Sharpe = perPeriodSharpe × √periodsPerYear. */
  naiveAnnualisedSharpe: number;
  /** Lo-corrected annualised Sharpe = perPeriodSharpe × η(q). */
  correctedAnnualisedSharpe: number;
  /** η(q) — the corrected scale factor. Equals √periodsPerYear when returns are IID. */
  correctionFactor: number;
  /** Ratio correctedAnnualisedSharpe / naiveAnnualisedSharpe — < 1 means naive overstated. */
  correctionRatio: number;
  /** Sample autocorrelations ρ_k for k = 1..maxLag. */
  autocorrelations: number[];
  /** Sample size. */
  sampleSize: number;
  /** Max lag actually used. */
  lagsUsed: number;
  reasoning: string;
}

function mean(xs: ReadonlyArray<number>): number {
  if (xs.length === 0) return 0;
  let s = 0;
  for (const x of xs) s += x;
  return s / xs.length;
}

function sampleAutocorrelation(xs: ReadonlyArray<number>, mu: number, lag: number): number {
  const N = xs.length;
  if (lag <= 0 || lag >= N) return 0;
  let num = 0;
  let den = 0;
  for (let t = 0; t < N - lag; t++) {
    num += (xs[t]! - mu) * (xs[t + lag]! - mu);
  }
  for (let t = 0; t < N; t++) {
    den += (xs[t]! - mu) ** 2;
  }
  return den > 0 ? num / den : 0;
}

export function computeLoSharpeCorrection(
  input: LoSharpeCorrectionInput,
): LoSharpeCorrectionResult {
  const returns = input.returns;
  const q = input.periodsPerYear;
  const rf = input.riskFreePerPeriod ?? 0;
  const N = returns.length;

  if (N < 2) {
    throw new Error("returns must have length ≥ 2");
  }
  if (q <= 0) {
    throw new Error("periodsPerYear must be positive");
  }

  // Excess returns
  const excess = returns.map((r) => r - rf);
  const mu = mean(excess);
  let varSum = 0;
  for (const x of excess) varSum += (x - mu) ** 2;
  const stdev = Math.sqrt(varSum / Math.max(1, N - 1));

  // Floating-point safety: when all returns are identical, varSum can be
  // a tiny float-noise residual rather than exactly zero, which would
  // yield a meaningless gigantic Sharpe. Treat any stdev below the
  // float-noise threshold relative to |mu| as zero variance.
  const noiseFloor = Math.max(Math.abs(mu), 1) * 1e-14;
  const effectivelyZero = stdev <= noiseFloor;
  const perPeriodSharpe = effectivelyZero ? 0 : mu / stdev;
  const naiveAnnualisedSharpe = perPeriodSharpe * Math.sqrt(q);

  // Determine max lag. Default truncates aggressively to avoid summing
  // noisy high-lag autocorrelations.
  const requestedLag =
    input.maxLag ?? Math.min(20, q - 1, Math.floor(N / 10));
  const maxLag = Math.max(0, Math.min(requestedLag, q - 1, N - 1));

  const autocorrelations: number[] = [];
  for (let k = 1; k <= maxLag; k++) {
    autocorrelations.push(sampleAutocorrelation(excess, mu, k));
  }

  // Lo's denominator: q + 2 · Σ (q − k) · ρ_k for k = 1..maxLag
  let denomInner = q;
  for (let k = 1; k <= maxLag; k++) {
    denomInner += 2 * (q - k) * autocorrelations[k - 1]!;
  }

  // Guard against the (rare) negative-definite case from severely
  // anti-autocorrelated returns — fall back to the naive factor.
  let correctionFactor: number;
  if (denomInner > 0) {
    correctionFactor = q / Math.sqrt(denomInner);
  } else {
    correctionFactor = Math.sqrt(q);
  }

  const correctedAnnualisedSharpe = perPeriodSharpe * correctionFactor;
  const correctionRatio =
    Math.abs(naiveAnnualisedSharpe) > 0
      ? correctedAnnualisedSharpe / naiveAnnualisedSharpe
      : 1;

  const reasoning =
    `N=${N}, q=${q}, max-lag=${maxLag}; ` +
    `per-period Sharpe=${perPeriodSharpe.toFixed(4)}, ` +
    `naive annualised=${naiveAnnualisedSharpe.toFixed(3)}, ` +
    `Lo-corrected=${correctedAnnualisedSharpe.toFixed(3)} ` +
    `(ratio ${correctionRatio.toFixed(3)}, η=${correctionFactor.toFixed(3)} ` +
    `vs naive √q=${Math.sqrt(q).toFixed(3)})`;

  return {
    perPeriodSharpe,
    naiveAnnualisedSharpe,
    correctedAnnualisedSharpe,
    correctionFactor,
    correctionRatio,
    autocorrelations,
    sampleSize: N,
    lagsUsed: maxLag,
    reasoning,
  };
}

export function loSharpeCorrectionToPayload(
  result: LoSharpeCorrectionResult,
): Record<string, unknown> {
  return {
    kind: "lo_sharpe_correction.computed",
    perPeriodSharpe: Number(result.perPeriodSharpe.toFixed(6)),
    naiveAnnualisedSharpe: Number(result.naiveAnnualisedSharpe.toFixed(4)),
    correctedAnnualisedSharpe: Number(result.correctedAnnualisedSharpe.toFixed(4)),
    correctionFactor: Number(result.correctionFactor.toFixed(4)),
    correctionRatio: Number(result.correctionRatio.toFixed(4)),
    sampleSize: result.sampleSize,
    lagsUsed: result.lagsUsed,
  };
}
