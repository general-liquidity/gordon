/**
 * Augmented Dickey-Fuller stationarity test (GORDON_STATIONARITY_TEST).
 *
 * Guards against the most common pitfall in time-series modeling:
 * regressing a non-stationary series on itself yields spurious
 * relationships with high R² that have zero predictive power. ADF
 * tests whether the series has a unit root (random-walk-like) and
 * therefore must be differenced (or log-returned) before any
 * autoregressive model can be trusted.
 *
 *   Regression: Δy[t] = α + γ·y[t-1] + Σ δ_i · Δy[t-i] + ε[t]
 *   Test stat:  γ̂ / SE(γ̂)
 *   H₀:         γ = 0  (series has a unit root → non-stationary)
 *   Reject H₀  when test stat is more negative than the critical value.
 *
 * Critical values are MacKinnon approximations for the "with constant"
 * variant. We do not include a deterministic trend term — most price
 * series Gordon touches don't have a deterministic linear trend, and
 * including one when there isn't one weakens the test.
 *
 * Use cases:
 *   - Before fitting any ARMA-family model to a series, run ADF on the
 *     input. If it fails (likely non-stationary), feed log-returns
 *     instead. Gordon's existing primitives (kalmanBeta, kalmanVolatility,
 *     fisherTransform, KAMA) mostly handle this internally; this test
 *     is a precondition guard for new strategy code.
 *   - On a pair-trading signal, run ADF on the residual series. If it
 *     passes, the spread is stationary and mean-reverting trades make
 *     sense. If it fails, the relationship is spurious.
 */

export const STATIONARITY_TEST_FLAG_ENV = "GORDON_STATIONARITY_TEST";

export function isStationarityTestEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env[STATIONARITY_TEST_FLAG_ENV] === "1" || env[STATIONARITY_TEST_FLAG_ENV] === "true";
}

export interface AdfInput {
  series: ReadonlyArray<number>;
  /** Number of lagged-difference terms (sets autoregressive lag p). Default 1. */
  lagOrder?: number;
  /** Confidence level for the verdict. Default 0.05 (95% confidence). */
  alpha?: 0.01 | 0.05 | 0.1;
}

export type AdfVerdict = "stationary" | "non_stationary" | "insufficient_data";

export interface AdfResult {
  verdict: AdfVerdict;
  testStatistic: number;
  criticalValue: number;
  /** Approximate p-value derived from the empirical critical-value table. */
  approximatePValue: number;
  lagOrder: number;
  sampleSize: number;
  reasoning: string;
}

const DEFAULT_LAG = 1;
const DEFAULT_ALPHA = 0.05 as const;

/**
 * MacKinnon (1996) asymptotic critical values for the "with constant, no
 * trend" ADF specification. Sufficient accuracy for n ≥ 100.
 */
const CRITICAL_VALUES: Record<0.01 | 0.05 | 0.1, number> = {
  0.01: -3.43,
  0.05: -2.86,
  0.1: -2.57,
};

/**
 * Linear-interpolation p-value approximation from the critical-value
 * lattice. Out-of-table stats clamp to {0.01, 0.99}; this is an
 * approximation, not a calibrated p-value.
 */
function approximatePValue(testStat: number): number {
  if (testStat <= CRITICAL_VALUES[0.01]) return 0.01;
  if (testStat <= CRITICAL_VALUES[0.05]) {
    const span = CRITICAL_VALUES[0.05] - CRITICAL_VALUES[0.01];
    const frac = (testStat - CRITICAL_VALUES[0.01]) / span;
    return 0.01 + frac * (0.05 - 0.01);
  }
  if (testStat <= CRITICAL_VALUES[0.1]) {
    const span = CRITICAL_VALUES[0.1] - CRITICAL_VALUES[0.05];
    const frac = (testStat - CRITICAL_VALUES[0.05]) / span;
    return 0.05 + frac * (0.1 - 0.05);
  }
  return 0.5 + 0.49 * Math.min(1, Math.max(0, (testStat - CRITICAL_VALUES[0.1]) / Math.max(0.5, Math.abs(CRITICAL_VALUES[0.1]))));
}

interface OlsResult {
  beta: number[];
  /** Standard error of each coefficient. */
  se: number[];
}

function olsWithSe(X: number[][], y: number[]): OlsResult | null {
  const n = X.length;
  const k = X[0]?.length ?? 0;
  if (n <= k || k === 0) return null;

  const xtx: number[][] = Array.from({ length: k }, () => new Array(k).fill(0));
  const xty: number[] = new Array(k).fill(0);
  for (let i = 0; i < n; i++) {
    for (let a = 0; a < k; a++) {
      xty[a]! += X[i]![a]! * y[i]!;
      for (let b = 0; b < k; b++) {
        xtx[a]![b]! += X[i]![a]! * X[i]![b]!;
      }
    }
  }

  const inv = invertSymmetric(xtx);
  if (!inv) return null;

  const beta: number[] = new Array(k).fill(0);
  for (let a = 0; a < k; a++) {
    for (let b = 0; b < k; b++) {
      beta[a]! += inv[a]![b]! * xty[b]!;
    }
  }

  let ssRes = 0;
  for (let i = 0; i < n; i++) {
    let yhat = 0;
    for (let a = 0; a < k; a++) yhat += X[i]![a]! * beta[a]!;
    const r = y[i]! - yhat;
    ssRes += r * r;
  }
  const sigma2 = ssRes / Math.max(1, n - k);

  const se: number[] = new Array(k).fill(0);
  for (let a = 0; a < k; a++) se[a] = Math.sqrt(Math.max(0, sigma2 * inv[a]![a]!));

  return { beta, se };
}

function invertSymmetric(a: number[][]): number[][] | null {
  const n = a.length;
  const aug: number[][] = a.map((row, i) => [...row, ...Array.from({ length: n }, (_, j) => (i === j ? 1 : 0))]);
  for (let i = 0; i < n; i++) {
    let pivot = i;
    let best = Math.abs(aug[i]![i]!);
    for (let r = i + 1; r < n; r++) {
      if (Math.abs(aug[r]![i]!) > best) {
        best = Math.abs(aug[r]![i]!);
        pivot = r;
      }
    }
    if (best < 1e-12) return null;
    if (pivot !== i) {
      const tmp = aug[i]!;
      aug[i] = aug[pivot]!;
      aug[pivot] = tmp;
    }
    const div = aug[i]![i]!;
    for (let c = i; c < 2 * n; c++) aug[i]![c] = aug[i]![c]! / div;
    for (let r = 0; r < n; r++) {
      if (r === i) continue;
      const factor = aug[r]![i]!;
      for (let c = i; c < 2 * n; c++) aug[r]![c] = aug[r]![c]! - factor * aug[i]![c]!;
    }
  }
  return aug.map((row) => row.slice(n));
}

export function runAdfTest(input: AdfInput): AdfResult {
  const lag = Math.max(1, input.lagOrder ?? DEFAULT_LAG);
  const alpha = input.alpha ?? DEFAULT_ALPHA;
  const y = Array.from(input.series);
  const n = y.length;

  const minRequired = lag + 4;
  if (n < minRequired) {
    return {
      verdict: "insufficient_data",
      testStatistic: Number.NaN,
      criticalValue: CRITICAL_VALUES[alpha],
      approximatePValue: Number.NaN,
      lagOrder: lag,
      sampleSize: n,
      reasoning: `need at least ${minRequired} observations, got ${n}`,
    };
  }

  // First differences.
  const dy: number[] = new Array(n - 1);
  for (let i = 1; i < n; i++) dy[i - 1] = y[i]! - y[i - 1]!;

  // Build regressor matrix: [1, y_{t-1}, Δy_{t-1}, ..., Δy_{t-lag}]
  // Response: Δy_t starting at index `lag` of dy (so we have `lag` prior differences).
  const startIdx = lag; // Index into dy.
  const Xrows: number[][] = [];
  const yhat: number[] = [];
  for (let t = startIdx; t < dy.length; t++) {
    // y_{t-1} corresponds to y[t] in the original series (since dy[t] = y[t+1] - y[t]).
    const yLag = y[t]!;
    const row: number[] = [1, yLag];
    for (let k = 1; k <= lag; k++) row.push(dy[t - k]!);
    Xrows.push(row);
    yhat.push(dy[t]!);
  }

  const fit = olsWithSe(Xrows, yhat);
  if (!fit) {
    return {
      verdict: "insufficient_data",
      testStatistic: Number.NaN,
      criticalValue: CRITICAL_VALUES[alpha],
      approximatePValue: Number.NaN,
      lagOrder: lag,
      sampleSize: n,
      reasoning: "regressor matrix singular — series is degenerate (constant or near-constant)",
    };
  }

  // Index 1 is the coefficient on y_{t-1}; its t-statistic is the ADF stat.
  const gammaHat = fit.beta[1]!;
  const gammaSe = fit.se[1]!;
  const testStat = gammaSe > 0 ? gammaHat / gammaSe : Number.NaN;
  const criticalValue = CRITICAL_VALUES[alpha];
  const approxP = Number.isFinite(testStat) ? approximatePValue(testStat) : Number.NaN;

  let verdict: AdfVerdict;
  let reasoning: string;
  if (!Number.isFinite(testStat)) {
    verdict = "insufficient_data";
    reasoning = "could not compute test statistic — degenerate regression";
  } else if (testStat <= criticalValue) {
    verdict = "stationary";
    reasoning = `t = ${testStat.toFixed(3)} ≤ critical ${criticalValue.toFixed(2)} at α=${alpha}; reject unit root`;
  } else {
    verdict = "non_stationary";
    reasoning = `t = ${testStat.toFixed(3)} > critical ${criticalValue.toFixed(2)} at α=${alpha}; cannot reject unit root — use returns, not prices`;
  }

  return {
    verdict,
    testStatistic: testStat,
    criticalValue,
    approximatePValue: approxP,
    lagOrder: lag,
    sampleSize: n,
    reasoning,
  };
}

export function adfToPayload(result: AdfResult): Record<string, unknown> {
  return {
    kind: "stationarity_test.evaluated",
    verdict: result.verdict,
    testStatistic: Number.isFinite(result.testStatistic) ? Number(result.testStatistic.toFixed(4)) : null,
    criticalValue: Number(result.criticalValue.toFixed(2)),
    approximatePValue: Number.isFinite(result.approximatePValue) ? Number(result.approximatePValue.toFixed(4)) : null,
    sampleSize: result.sampleSize,
  };
}
