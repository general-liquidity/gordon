/**
 * Granger Causality Test — Does X predict Y?
 *
 * Tests whether past values of series X help predict future values of Y,
 * beyond what Y's own past predicts. Directional — Granger(X→Y) ≠ Granger(Y→X).
 *
 * Different from correlation (simultaneous) and cointegration (long-run bond).
 * Granger causality is about PREDICTIVE POWER across time.
 *
 * Use cases:
 *   - "Does BTC price predict ETH?" (lead-lag relationships)
 *   - "Do insider trades predict stock moves?" (signal detection)
 *   - "Does volume predict price?" (volume-price dynamics)
 *
 * Implements the F-test approach: compare restricted model (Y's own lags)
 * vs unrestricted model (Y's lags + X's lags). If X's lags significantly
 * improve the model, X "Granger-causes" Y.
 *
 * Source: EPAT (Dr. Yves Hilpisch, The Python Quants)
 */

import { normalCdf } from "../../../core/numerics/index.ts";

// ============================================================================
// Types
// ============================================================================

export interface GrangerResult {
  /** Direction tested. */
  direction: string;
  /** Lag used. */
  lag: number;
  /** F-statistic. */
  fStatistic: number;
  /** P-value (probability F-stat is due to chance). */
  pValue: number;
  /** Whether to reject null at 5% (X does NOT Granger-cause Y). */
  rejectNull: boolean;
  /** Plain English interpretation. */
  interpretation: string;
}

export interface BiDirectionalGrangerResult {
  /** X → Y direction. */
  xToY: GrangerResult;
  /** Y → X direction. */
  yToX: GrangerResult;
  /** Overall relationship. */
  relationship: "x_leads" | "y_leads" | "bidirectional" | "independent";
  /** Summary. */
  summary: string;
}

// ============================================================================
// OLS Regression (for restricted and unrestricted models)
// ============================================================================

interface OLSResult {
  coefficients: number[];
  residuals: number[];
  rss: number; // Residual sum of squares
  df: number;  // Degrees of freedom
}

/**
 * Ordinary Least Squares regression: y = X * beta + epsilon
 * Uses normal equations: beta = (X'X)^-1 * X'y
 */
function ols(X: number[][], y: number[]): OLSResult {
  const n = y.length;
  const p = X[0]?.length ?? 0;
  if (n === 0 || p === 0) return { coefficients: [], residuals: [], rss: 0, df: n };

  // X'X
  const XtX: number[][] = Array.from({ length: p }, () => new Array(p).fill(0) as number[]);
  for (let i = 0; i < p; i++) {
    for (let j = 0; j < p; j++) {
      for (let k = 0; k < n; k++) {
        XtX[i]![j]! += X[k]![i]! * X[k]![j]!;
      }
    }
  }

  // X'y
  const Xty: number[] = new Array(p).fill(0) as number[];
  for (let i = 0; i < p; i++) {
    for (let k = 0; k < n; k++) {
      Xty[i]! += X[k]![i]! * y[k]!;
    }
  }

  // Solve via Gauss elimination (for small p, this is fine)
  const beta = solveLinearSystem(XtX, Xty);

  // Residuals
  const residuals = y.map((yi, k) => {
    let predicted = 0;
    for (let j = 0; j < p; j++) predicted += X[k]![j]! * beta[j]!;
    return yi - predicted;
  });

  const rss = residuals.reduce((s, r) => s + r * r, 0);

  return { coefficients: beta, residuals, rss, df: n - p };
}

/**
 * Solve Ax = b via Gaussian elimination with partial pivoting.
 */
function solveLinearSystem(A: number[][], b: number[]): number[] {
  const n = b.length;
  // Augmented matrix
  const aug = A.map((row, i) => [...row, b[i]!]);

  for (let col = 0; col < n; col++) {
    // Partial pivoting
    let maxRow = col;
    for (let row = col + 1; row < n; row++) {
      if (Math.abs(aug[row]![col]!) > Math.abs(aug[maxRow]![col]!)) maxRow = row;
    }
    [aug[col], aug[maxRow]] = [aug[maxRow]!, aug[col]!];

    const pivot = aug[col]![col]!;
    if (Math.abs(pivot) < 1e-12) continue; // Singular — skip

    // Eliminate below
    for (let row = col + 1; row < n; row++) {
      const factor = aug[row]![col]! / pivot;
      for (let j = col; j <= n; j++) {
        aug[row]![j]! -= factor * aug[col]![j]!;
      }
    }
  }

  // Back substitution
  const x = new Array(n).fill(0) as number[];
  for (let i = n - 1; i >= 0; i--) {
    let sum = aug[i]![n]!;
    for (let j = i + 1; j < n; j++) {
      sum -= aug[i]![j]! * x[j]!;
    }
    const diag = aug[i]![i]!;
    x[i] = Math.abs(diag) > 1e-12 ? sum / diag : 0;
  }

  return x;
}

// ============================================================================
// F-Distribution P-Value (approximation)
// ============================================================================

/**
 * Approximate p-value for F-distribution using the relationship
 * between F and Beta distributions. Uses normal approximation for large df.
 */
function fPValue(fStat: number, df1: number, df2: number): number {
  if (fStat <= 0 || df1 <= 0 || df2 <= 0) return 1;
  // Use the approximation: for large df, F ≈ chi-squared/df1
  // More precisely, use the Wilson-Hilferty-like transform
  const a = df1 / 2;
  const b = df2 / 2;
  const x = df1 * fStat / (df1 * fStat + df2);

  // Normal approximation for regularized incomplete beta
  // Accurate enough for df > 5
  if (a > 2 && b > 2) {
    const lambda = (a - 1) / (a + b - 2);
    const z = (x - lambda) / Math.sqrt(lambda * (1 - lambda) / (a + b - 1));
    return 1 - normalCdf(z);
  }

  // Fallback: very rough approximation
  return Math.exp(-fStat * df1 / (2 * df2));
}

// ============================================================================
// Granger Causality Test
// ============================================================================

/**
 * Test if series X Granger-causes series Y at a given lag.
 *
 * Restricted model:  Y_t = c + Σ(a_i * Y_{t-i}) + ε
 * Unrestricted model: Y_t = c + Σ(a_i * Y_{t-i}) + Σ(b_i * X_{t-i}) + ε
 *
 * F-test: does adding X's lags significantly reduce residual variance?
 *
 * @param returnsX Returns of the potential cause (X).
 * @param returnsY Returns of the potential effect (Y).
 * @param lag Number of lags to include (default 5).
 */
export function grangerCausalityTest(
  returnsX: number[],
  returnsY: number[],
  lag: number = 5,
  symbolX: string = "X",
  symbolY: string = "Y",
): GrangerResult {
  const n = Math.min(returnsX.length, returnsY.length);
  if (n < lag * 3 + 10) {
    return {
      direction: `${symbolX} → ${symbolY}`,
      lag,
      fStatistic: 0,
      pValue: 1,
      rejectNull: false,
      interpretation: "Insufficient data for Granger test.",
    };
  }

  const x = returnsX.slice(-n);
  const y = returnsY.slice(-n);

  // Build restricted model: Y_t = c + Σ(a_i * Y_{t-i})
  const T = n - lag;
  const yDep: number[] = [];
  const xRestricted: number[][] = [];
  const xUnrestricted: number[][] = [];

  for (let t = lag; t < n; t++) {
    yDep.push(y[t]!);

    // Restricted: constant + Y lags
    const rowR: number[] = [1]; // constant
    for (let i = 1; i <= lag; i++) rowR.push(y[t - i]!);
    xRestricted.push(rowR);

    // Unrestricted: constant + Y lags + X lags
    const rowU: number[] = [1];
    for (let i = 1; i <= lag; i++) rowU.push(y[t - i]!);
    for (let i = 1; i <= lag; i++) rowU.push(x[t - i]!);
    xUnrestricted.push(rowU);
  }

  const restricted = ols(xRestricted, yDep);
  const unrestricted = ols(xUnrestricted, yDep);

  // F-test
  const df1 = lag; // number of added regressors
  const df2 = T - 2 * lag - 1; // residual df of unrestricted model

  if (df2 <= 0 || restricted.rss === 0) {
    return {
      direction: `${symbolX} → ${symbolY}`,
      lag,
      fStatistic: 0,
      pValue: 1,
      rejectNull: false,
      interpretation: "Degenerate model — cannot compute F-statistic.",
    };
  }

  const fStat = ((restricted.rss - unrestricted.rss) / df1) / (unrestricted.rss / df2);
  const pValue = fPValue(fStat, df1, df2);
  const rejectNull = pValue < 0.05;

  return {
    direction: `${symbolX} → ${symbolY}`,
    lag,
    fStatistic: fStat,
    pValue,
    rejectNull,
    interpretation: rejectNull
      ? `${symbolX} Granger-causes ${symbolY} (F=${fStat.toFixed(2)}, p=${pValue.toFixed(4)}). Past ${symbolX} returns help predict ${symbolY}.`
      : `${symbolX} does NOT Granger-cause ${symbolY} (F=${fStat.toFixed(2)}, p=${pValue.toFixed(4)}). No predictive relationship detected.`,
  };
}

// ============================================================================
// Bidirectional Test
// ============================================================================

/**
 * Test both directions: X→Y and Y→X.
 * Determines lead-lag relationship.
 */
export function bidirectionalGrangerTest(
  returnsX: number[],
  returnsY: number[],
  lag: number = 5,
  symbolX: string = "X",
  symbolY: string = "Y",
): BiDirectionalGrangerResult {
  const xToY = grangerCausalityTest(returnsX, returnsY, lag, symbolX, symbolY);
  const yToX = grangerCausalityTest(returnsY, returnsX, lag, symbolY, symbolX);

  let relationship: BiDirectionalGrangerResult["relationship"];
  let summary: string;

  if (xToY.rejectNull && yToX.rejectNull) {
    relationship = "bidirectional";
    summary = `Bidirectional: ${symbolX} and ${symbolY} predict each other. Feedback loop detected.`;
  } else if (xToY.rejectNull) {
    relationship = "x_leads";
    summary = `${symbolX} leads ${symbolY}. Trade ${symbolY} based on ${symbolX} signals.`;
  } else if (yToX.rejectNull) {
    relationship = "y_leads";
    summary = `${symbolY} leads ${symbolX}. Trade ${symbolX} based on ${symbolY} signals.`;
  } else {
    relationship = "independent";
    summary = `No Granger causality in either direction. ${symbolX} and ${symbolY} move independently.`;
  }

  return { xToY, yToX, relationship, summary };
}
