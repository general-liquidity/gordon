/**
 * 2-asset hedge-ratio selection by minimizing the Augmented Dickey-Fuller
 * (ADF) test statistic of the spread. The intuition: among all candidate
 * hedge ratios β, the one yielding the MOST stationary spread (most negative
 * ADF stat) is the strongest cointegrating combination.
 *
 * Spread(β) = y − β·x. We regress the ADF auxiliary equation
 *   Δs_t = α + γ·s_{t-1} + Σ_{i=1..p} δ_i·Δs_{t-i} + ε_t
 * by OLS and take ADF = γ / SE(γ). Then we search β: a coarse grid around the
 * OLS hedge β_ols = cov(x,y)/var(x), refined by golden-section, picking the β
 * with the smallest (most negative) ADF stat.
 *
 * Self-contained — only borrows the matrix primitives from core/alpha.
 */

import { transpose, multiply, multiplyVector, invert } from "../../../core/alpha/matrix.ts";

export interface AdfOptimalResult {
  hedgeRatio: number;
  adfStat: number;
  olsHedgeRatio: number;
  lags: number;
  sampleSize: number;
  interpretation: string;
}

/** ≈5% ADF critical value (constant, no trend, large sample). */
const ADF_CRIT_5PCT = -2.86;
const MIN_POINTS = 20;

/**
 * Augmented Dickey-Fuller statistic of a single series via the auxiliary
 * regression above. Returns NaN when there are too few effective rows for the
 * requested lag order.
 */
export function adfStatistic(series: ReadonlyArray<number>, lags: number): number {
  const n = series.length;
  const p = Math.max(0, Math.floor(lags));
  // Effective rows: t runs from p+1 .. n-1 (need s_{t-1} and p prior Δs lags).
  const rows = n - p - 1;
  // Columns: intercept + γ·s_{t-1} + p lagged differences.
  const cols = 2 + p;
  if (rows <= cols + 1) return Number.NaN;

  const diffs: number[] = [];
  for (let t = 1; t < n; t++) diffs.push(series[t]! - series[t - 1]!);
  // diffs[k] = Δs_{k+1} = series[k+1] - series[k], k = 0..n-2

  const X: number[][] = [];
  const yVec: number[] = [];
  for (let t = p + 1; t < n; t++) {
    const row: number[] = [1, series[t - 1]!];
    for (let i = 1; i <= p; i++) {
      // Δs_{t-i} = diffs[(t - i) - 1]
      row.push(diffs[t - i - 1]!);
    }
    X.push(row);
    yVec.push(diffs[t - 1]!); // Δs_t
  }

  const Xt = transpose(X);
  const XtX = multiply(Xt, X);
  const XtXinv = invert(XtX);
  if (XtXinv == null) return Number.NaN;

  const beta = multiplyVector(XtXinv, multiplyVector(Xt, yVec));

  let sse = 0;
  for (let r = 0; r < X.length; r++) {
    let pred = 0;
    for (let c = 0; c < cols; c++) pred += X[r]![c]! * beta[c]!;
    const resid = yVec[r]! - pred;
    sse += resid * resid;
  }
  const dof = rows - cols;
  if (dof <= 0) return Number.NaN;
  const sigma2 = sse / dof;

  // SE(γ) — γ is coefficient index 1.
  const varGamma = sigma2 * XtXinv[1]![1]!;
  if (!Number.isFinite(varGamma) || varGamma <= 0) return Number.NaN;
  const seGamma = Math.sqrt(varGamma);

  const gamma = beta[1]!;
  return gamma / seGamma;
}

function spread(y: ReadonlyArray<number>, x: ReadonlyArray<number>, beta: number): number[] {
  const s: number[] = [];
  for (let i = 0; i < y.length; i++) s.push(y[i]! - beta * x[i]!);
  return s;
}

function olsHedge(y: ReadonlyArray<number>, x: ReadonlyArray<number>): number {
  const n = x.length;
  let mx = 0;
  let my = 0;
  for (let i = 0; i < n; i++) {
    mx += x[i]!;
    my += y[i]!;
  }
  mx /= n;
  my /= n;
  let cov = 0;
  let varX = 0;
  for (let i = 0; i < n; i++) {
    const dx = x[i]! - mx;
    cov += dx * (y[i]! - my);
    varX += dx * dx;
  }
  if (varX === 0) return 0;
  return cov / varX;
}

export function computeAdfOptimalHedgeRatio(input: {
  pricesY: ReadonlyArray<number>;
  pricesX: ReadonlyArray<number>;
  lags?: number;
}): AdfOptimalResult {
  const { pricesY, pricesX } = input;
  const lags = input.lags == null ? 1 : Math.max(0, Math.floor(input.lags));
  const n = Math.min(pricesY.length, pricesX.length);
  const y = pricesY.slice(0, n);
  const x = pricesX.slice(0, n);

  const olsBeta = olsHedge(y, x);

  if (n < MIN_POINTS) {
    return {
      hedgeRatio: Number(olsBeta.toFixed(6)),
      adfStat: 0,
      olsHedgeRatio: Number(olsBeta.toFixed(6)),
      lags,
      sampleSize: n,
      interpretation: `Neutral — insufficient data (${n} points, need ≥${MIN_POINTS}).`,
    };
  }

  const evalAdf = (beta: number): number => {
    const stat = adfStatistic(spread(y, x, beta), lags);
    return Number.isFinite(stat) ? stat : Number.POSITIVE_INFINITY;
  };

  // Coarse grid over [β_ols·0.2, β_ols·1.8]. Handle β_ols near zero by
  // falling back to a fixed symmetric band so the search stays meaningful.
  let lo: number;
  let hi: number;
  if (Math.abs(olsBeta) < 1e-9) {
    lo = -1;
    hi = 1;
  } else if (olsBeta > 0) {
    lo = olsBeta * 0.2;
    hi = olsBeta * 1.8;
  } else {
    lo = olsBeta * 1.8;
    hi = olsBeta * 0.2;
  }

  const STEPS = 60;
  let bestBeta = olsBeta;
  let bestStat = evalAdf(olsBeta);
  for (let i = 0; i <= STEPS; i++) {
    const beta = lo + ((hi - lo) * i) / STEPS;
    const stat = evalAdf(beta);
    if (stat < bestStat) {
      bestStat = stat;
      bestBeta = beta;
    }
  }

  // Golden-section refine within the bracket centered on the coarse winner.
  const step = (hi - lo) / STEPS;
  let a = bestBeta - step;
  let b = bestBeta + step;
  const gr = (Math.sqrt(5) - 1) / 2;
  let c = b - gr * (b - a);
  let d = a + gr * (b - a);
  let fc = evalAdf(c);
  let fd = evalAdf(d);
  for (let iter = 0; iter < 50 && b - a > 1e-7; iter++) {
    if (fc < fd) {
      b = d;
      d = c;
      fd = fc;
      c = b - gr * (b - a);
      fc = evalAdf(c);
    } else {
      a = c;
      c = d;
      fc = fd;
      d = a + gr * (b - a);
      fd = evalAdf(d);
    }
  }
  const refinedBeta = (a + b) / 2;
  const refinedStat = evalAdf(refinedBeta);
  if (refinedStat < bestStat) {
    bestStat = refinedStat;
    bestBeta = refinedBeta;
  }

  const stationary = bestStat < ADF_CRIT_5PCT;
  const interpretation = stationary
    ? `Spread is stationary at ~5% (ADF ${bestStat.toFixed(2)} < ${ADF_CRIT_5PCT}) — cointegration supported at hedge ratio ${bestBeta.toFixed(4)}.`
    : `Spread NOT stationary at ~5% (ADF ${bestStat.toFixed(2)} ≥ ${ADF_CRIT_5PCT}) — cointegration not supported.`;

  return {
    hedgeRatio: Number(bestBeta.toFixed(6)),
    adfStat: Number(bestStat.toFixed(6)),
    olsHedgeRatio: Number(olsBeta.toFixed(6)),
    lags,
    sampleSize: n,
    interpretation,
  };
}
