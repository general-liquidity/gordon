/**
 * Ornstein-Uhlenbeck parameter fit via discrete AR(1) MLE.
 *
 * For dX = θ(μ − X)dt + σ dW, the discrete-time fit regresses X_t on X_{t-1}:
 *   X_t = a + b·X_{t-1} + ε
 * with closed-form OLS. Then:
 *   θ = −ln(b)/dt        (mean-reversion speed; requires 0 < b < 1)
 *   μ = a/(1 − b)        (long-run mean)
 *   σ_OU = stdev(ε) · sqrt(2θ / (1 − b²))   (standard discrete-OU equilibrium vol)
 *   halfLife = ln(2)/θ
 */

export interface OuFitResult {
  theta: number;
  mu: number;
  sigma: number;
  halfLife: number;
  ar1Beta: number;
  isMeanReverting: boolean;
  sampleSize: number;
  interpretation: string;
}

const r6 = (x: number): number => Number(x.toFixed(6));

export function fitOU(input: { series: ReadonlyArray<number>; dt?: number }): OuFitResult {
  const series = input.series;
  const dt = input.dt == null ? 1 : input.dt;
  const n = series.length;

  // Need at least 5 raw points → 4 (x_{t-1}, x_t) pairs.
  if (n < 5) {
    return {
      theta: 0,
      mu: 0,
      sigma: 0,
      halfLife: Infinity,
      ar1Beta: 0,
      isMeanReverting: false,
      sampleSize: n,
      interpretation: `Insufficient data: need at least 5 points to fit OU, got ${n}. Result is neutral.`,
    };
  }

  // Build (x = X_{t-1}, y = X_t) pairs.
  const m = n - 1;
  let sx = 0;
  let sy = 0;
  for (let i = 1; i < n; i++) {
    sx += series[i - 1]!;
    sy += series[i]!;
  }
  const mx = sx / m;
  const my = sy / m;

  let sxx = 0;
  let sxy = 0;
  for (let i = 1; i < n; i++) {
    const dxv = series[i - 1]! - mx;
    sxx += dxv * dxv;
    sxy += dxv * (series[i]! - my);
  }

  // Degenerate (constant) series → no usable regression.
  if (sxx === 0) {
    return {
      theta: 0,
      mu: 0,
      sigma: 0,
      halfLife: Infinity,
      ar1Beta: 0,
      isMeanReverting: false,
      sampleSize: n,
      interpretation:
        "Series has no variance in lagged values; OU fit is undefined. Result is neutral.",
    };
  }

  const b = sxy / sxx; // AR(1) slope
  const a = my - b * mx; // intercept

  // Residual standard deviation (sample, ddof=2 for the two estimated params).
  let sse = 0;
  for (let i = 1; i < n; i++) {
    const pred = a + b * series[i - 1]!;
    const e = series[i]! - pred;
    sse += e * e;
  }
  const ddof = m > 2 ? m - 2 : 1;
  const residStd = Math.sqrt(sse / ddof);

  const ar1Beta = r6(b);

  // No mean reversion when b >= 1 (or b <= 0, where −ln(b) is undefined/non-reverting).
  if (!(b > 0 && b < 1)) {
    return {
      theta: 0,
      mu: 0,
      sigma: r6(residStd),
      halfLife: Infinity,
      ar1Beta,
      isMeanReverting: false,
      sampleSize: n,
      interpretation:
        b >= 1
          ? `AR(1) beta ${ar1Beta} >= 1: series behaves like a random walk (non-stationary), no mean reversion. theta=0, halfLife=Infinity.`
          : `AR(1) beta ${ar1Beta} <= 0: anti-persistent / no positive autocorrelation, OU mean-reversion speed undefined. theta=0, halfLife=Infinity.`,
    };
  }

  const theta = -Math.log(b) / dt;
  const mu = a / (1 - b);
  const sigma = residStd * Math.sqrt((2 * theta) / (1 - b * b));
  const halfLife = Math.log(2) / theta;

  const halfLifeDisplay = Number.isFinite(halfLife) ? r6(Math.min(halfLife, 1e9)) : halfLife;

  return {
    theta: r6(theta),
    mu: r6(mu),
    sigma: r6(sigma),
    halfLife: halfLifeDisplay,
    ar1Beta,
    isMeanReverting: true,
    sampleSize: n,
    interpretation: `Mean-reverting OU fit: theta=${r6(theta)} (speed), mu=${r6(mu)} (long-run mean), half-life=${r6(halfLife)} bars, sigma=${r6(sigma)}. AR(1) beta=${ar1Beta}.`,
  };
}
