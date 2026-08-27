/**
 * Markov Chain Market Regime Detection
 * 3-state model (Bull/Bear/Neutral) with transition probability matrix.
 * Uses Z-score of returns for regime classification with Laplace smoothing.
 *
 * Markov Chain [3D] implementation.
 */

import type { Candle } from "./types.ts";
import { chiSquarePValue } from "../numerics/index.ts";
import { mean as statsMean, sampleStd } from "../stats/index.ts";

export interface MatrixStability {
  /** Pearson chi-square statistic comparing first-half vs second-half transition counts. */
  chiSquare: number;
  /** Degrees of freedom — (rows × cols) where row sum > 0 in either half. */
  degreesOfFreedom: number;
  /** Upper-tail p-value of the chi-square statistic at `degreesOfFreedom`. */
  pValue: number;
  /** Sample size used for each half. */
  sampleSizePerHalf: number;
  /** Stability verdict — `stable` (p > 0.10), `drifting` (0.01 < p ≤ 0.10), `unstable` (p ≤ 0.01). */
  verdict: "stable" | "drifting" | "unstable" | "insufficient_data";
  /** Frobenius distance between first-half and second-half matrices (raw matrix-shift magnitude). */
  frobeniusDistance: number;
}

export interface MarkovRegimeResult {
  /** Current regime: 1 (bull), 0 (neutral), -1 (bear) */
  regime: number;
  /** Current regime as string */
  regimeLabel: "bull" | "neutral" | "bear";
  /** Current Z-score of returns */
  zScore: number | null;
  /** 3x3 transition probability matrix [from][to] indexed Bear=0, Neutral=1, Bull=2 */
  transitionMatrix: number[][];
  /** Probability of transitioning to bull from current state */
  probToBull: number;
  /** Probability of staying in current state */
  probStaySame: number;
  /** Probability of transitioning to bear from current state */
  probToBear: number;
  /** Confidence in current regime (higher = more certain) */
  confidence: number;
  /** Whether a regime transition just occurred */
  transition: boolean;
  /** Previous regime label */
  prevRegime: "bull" | "neutral" | "bear";
  /** Interpretation string */
  interpretation: string;
  /**
   * Stability diagnostic for the transition matrix. Splits the lookback
   * window in half, builds a matrix from each half, and chi-square tests
   * whether the transition probabilities are stationary. When `unstable`
   * the matrix is fitting noise — downstream Kelly sizing on its
   * probabilities should be discounted or refused.
   */
  stability: MatrixStability;
}

const STATE_MAP: Record<number, number> = { [-1]: 0, 0: 1, 1: 2 };
const INDEX_TO_LABEL: Record<number, "bull" | "neutral" | "bear"> = {
  [-1]: "bear",
  0: "neutral",
  1: "bull",
};

/**
 * Calculate rolling mean of an array
 */
function rollingMean(arr: number[], window: number): (number | null)[] {
  const result: (number | null)[] = [];
  for (let i = 0; i < arr.length; i++) {
    if (i < window - 1) {
      result.push(null);
    } else {
      result.push(statsMean(arr.slice(i - window + 1, i + 1)));
    }
  }
  return result;
}

/**
 * Calculate rolling standard deviation (sample, ÷N−1)
 */
function rollingStd(arr: number[], window: number): (number | null)[] {
  const result: (number | null)[] = [];
  for (let i = 0; i < arr.length; i++) {
    if (i < window - 1) {
      result.push(null);
    } else {
      result.push(sampleStd(arr.slice(i - window + 1, i + 1)));
    }
  }
  return result;
}

/**
 * Classify regime from Z-score
 */
function classifyRegime(zScore: number, threshold: number): number {
  if (zScore > threshold) return 1; // Bull
  if (zScore < -threshold) return -1; // Bear
  return 0; // Neutral
}

/**
 * Apply smoothing to regime series to reduce whipsaws
 */
function smoothRegimes(regimes: number[], smoothing: number): number[] {
  if (smoothing <= 1) return regimes;

  const smoothed: number[] = [];
  for (let i = 0; i < regimes.length; i++) {
    if (i < smoothing - 1) {
      smoothed.push(regimes[i]!);
    } else {
      let sum = 0;
      for (let j = i - smoothing + 1; j <= i; j++) sum += regimes[j]!;
      const avg = sum / smoothing;
      smoothed.push(avg > 0.5 ? 1 : avg < -0.5 ? -1 : 0);
    }
  }
  return smoothed;
}

/**
 * Build transition probability matrix with Laplace smoothing
 */
function buildTransitionMatrix(states: number[], laplaceSmoothingAlpha: number = 1): number[][] {
  // 3x3 matrix: Bear(0), Neutral(1), Bull(2)
  const counts: number[][] = [
    [laplaceSmoothingAlpha, laplaceSmoothingAlpha, laplaceSmoothingAlpha],
    [laplaceSmoothingAlpha, laplaceSmoothingAlpha, laplaceSmoothingAlpha],
    [laplaceSmoothingAlpha, laplaceSmoothingAlpha, laplaceSmoothingAlpha],
  ];

  for (let i = 0; i < states.length - 1; i++) {
    const from = STATE_MAP[states[i]!];
    const to = STATE_MAP[states[i + 1]!];
    if (from !== undefined && to !== undefined) {
      counts[from]![to!]! += 1;
    }
  }

  // Normalize rows to probabilities
  const matrix: number[][] = [];
  for (const row of counts) {
    const rowSum = row.reduce((a, b) => a + b, 0);
    matrix.push(row.map((v) => v / rowSum));
  }
  return matrix;
}

/**
 * Calculate Markov Chain market regime detection.
 *
 * @param candles - OHLCV candle array
 * @param lookback - Window for rolling Z-score and transition matrix (default 50)
 * @param zThreshold - Z-score threshold for bull/bear classification (default 0.333)
 * @param regimeSmoothing - Smoothing period for regime series (default 3)
 * @returns MarkovRegimeResult
 */
export function calculateMarkovRegime(
  candles: Candle[],
  lookback: number = 50,
  zThreshold: number = 1 / 3,
  regimeSmoothing: number = 3,
): MarkovRegimeResult {
  if (candles.length < lookback * 2 + 2) {
    return {
      regime: 0,
      regimeLabel: "neutral",
      zScore: null,
      transitionMatrix: [
        [1 / 3, 1 / 3, 1 / 3],
        [1 / 3, 1 / 3, 1 / 3],
        [1 / 3, 1 / 3, 1 / 3],
      ],
      probToBull: 1 / 3,
      probStaySame: 1 / 3,
      probToBear: 1 / 3,
      confidence: 0,
      transition: false,
      prevRegime: "neutral",
      interpretation: "Insufficient data for Markov regime detection",
      stability: {
        chiSquare: 0,
        degreesOfFreedom: 0,
        pValue: 1,
        sampleSizePerHalf: 0,
        verdict: "insufficient_data",
        frobeniusDistance: 0,
      },
    };
  }

  // Calculate close-to-close returns
  const returns: number[] = [0];
  for (let i = 1; i < candles.length; i++) {
    returns.push((candles[i]!.close - candles[i - 1]!.close) / candles[i - 1]!.close);
  }

  // Rolling Z-scores
  const means = rollingMean(returns, lookback);
  const stds = rollingStd(returns, lookback);
  const zScores: number[] = [];
  for (let i = 0; i < returns.length; i++) {
    const mean = means[i];
    const std = stds[i];
    if (mean === null || mean === undefined || std === null || std === undefined || std < 0.0001) {
      zScores.push(0);
    } else {
      zScores.push((returns[i]! - mean) / std);
    }
  }

  // Classify regimes from Z-scores
  const rawRegimes = zScores.map((z) => classifyRegime(z, zThreshold));
  const regimes = smoothRegimes(rawRegimes, regimeSmoothing);

  // Build transition matrix from recent lookback window
  const recentStates = regimes.slice(-lookback);
  const transitionMatrix = buildTransitionMatrix(recentStates);
  const stability = assessMatrixStability(recentStates);

  // Current and previous regime
  const currentRegime = regimes[regimes.length - 1]!;
  const prevRegime = regimes[regimes.length - 2]!;
  const transition = currentRegime !== prevRegime;

  const currentIdx = STATE_MAP[currentRegime]!;
  const probToBull = transitionMatrix[currentIdx]![2]!; // Bull = index 2
  const probToBear = transitionMatrix[currentIdx]![0]!; // Bear = index 0
  const probStaySame = transitionMatrix[currentIdx]![currentIdx]!;

  // Confidence: how dominant is the highest transition probability?
  const maxProb = Math.max(probToBull, probToBear, probStaySame);
  const confidence = parseFloat((((maxProb - 1 / 3) / (2 / 3)) * 100).toFixed(1));

  const currentZScore = zScores[zScores.length - 1]!;

  const regimeLabel = INDEX_TO_LABEL[currentRegime] ?? "neutral";
  const prevRegimeLabel = INDEX_TO_LABEL[prevRegime] ?? "neutral";

  const interpretation = buildMarkovInterpretation(
    regimeLabel,
    prevRegimeLabel,
    transition,
    probToBull,
    probToBear,
    probStaySame,
    currentZScore,
    confidence,
  );

  return {
    regime: currentRegime,
    regimeLabel,
    zScore: parseFloat(currentZScore.toFixed(3)),
    transitionMatrix,
    probToBull: parseFloat(probToBull.toFixed(3)),
    probStaySame: parseFloat(probStaySame.toFixed(3)),
    probToBear: parseFloat(probToBear.toFixed(3)),
    confidence,
    transition,
    prevRegime: prevRegimeLabel,
    interpretation,
    stability,
  };
}

// ============================================================================
// Transition-matrix stability diagnostic
// ============================================================================

function countTransitions(states: number[], laplaceAlpha: number = 0): number[][] {
  const counts: number[][] = [
    [laplaceAlpha, laplaceAlpha, laplaceAlpha],
    [laplaceAlpha, laplaceAlpha, laplaceAlpha],
    [laplaceAlpha, laplaceAlpha, laplaceAlpha],
  ];
  for (let i = 0; i < states.length - 1; i++) {
    const from = STATE_MAP[states[i]!];
    const to = STATE_MAP[states[i + 1]!];
    if (from !== undefined && to !== undefined) {
      counts[from]![to!]! += 1;
    }
  }
  return counts;
}

function frobeniusDistance(a: number[][], b: number[][]): number {
  let sumSq = 0;
  for (let i = 0; i < 3; i++) {
    for (let j = 0; j < 3; j++) {
      const d = (a[i]?.[j] ?? 0) - (b[i]?.[j] ?? 0);
      sumSq += d * d;
    }
  }
  return Math.sqrt(sumSq);
}

/**
 * Assess whether the transition matrix is stationary by splitting the
 * state series in half and chi-square testing the two empirical
 * transition tables.
 *
 * H0: rows of the transition matrix are identically distributed across
 * the two halves (stationary process).
 *
 * H1: at least one row distribution differs (regime structure drifted).
 *
 * Returns `insufficient_data` when fewer than 20 transitions are
 * available per half (chi-square approximation breaks down with sparse
 * cells).
 */
export function assessMatrixStability(states: number[]): MatrixStability {
  const minPerHalf = 20;
  if (states.length < minPerHalf * 2 + 2) {
    return {
      chiSquare: 0,
      degreesOfFreedom: 0,
      pValue: 1,
      sampleSizePerHalf: Math.floor((states.length - 1) / 2),
      verdict: "insufficient_data",
      frobeniusDistance: 0,
    };
  }

  const mid = Math.floor(states.length / 2);
  const firstHalf = states.slice(0, mid + 1);
  const secondHalf = states.slice(mid);

  const obs1 = countTransitions(firstHalf);
  const obs2 = countTransitions(secondHalf);

  // Build normalized matrices for Frobenius distance reporting
  const norm = (counts: number[][]): number[][] =>
    counts.map((row) => {
      const sum = row.reduce((a, b) => a + b, 0);
      return sum > 0 ? row.map((v) => v / sum) : row.map(() => 0);
    });
  const frob = frobeniusDistance(norm(obs1), norm(obs2));

  // Pearson chi-square per row: sum over cells of (obs1 + obs2)
  // expected based on pooled row distribution.
  let chiSquare = 0;
  let df = 0;
  for (let i = 0; i < 3; i++) {
    const row1 = obs1[i]!;
    const row2 = obs2[i]!;
    const n1 = row1.reduce((a, b) => a + b, 0);
    const n2 = row2.reduce((a, b) => a + b, 0);
    if (n1 === 0 || n2 === 0) continue;

    const nonZeroCols: number[] = [];
    for (let j = 0; j < 3; j++) {
      const total = (row1[j] ?? 0) + (row2[j] ?? 0);
      if (total > 0) nonZeroCols.push(j);
    }
    if (nonZeroCols.length < 2) continue;

    for (const j of nonZeroCols) {
      const o1 = row1[j] ?? 0;
      const o2 = row2[j] ?? 0;
      const colTotal = o1 + o2;
      const e1 = (n1 * colTotal) / (n1 + n2);
      const e2 = (n2 * colTotal) / (n1 + n2);
      if (e1 > 0) chiSquare += (o1 - e1) ** 2 / e1;
      if (e2 > 0) chiSquare += (o2 - e2) ** 2 / e2;
    }
    df += nonZeroCols.length - 1;
  }

  if (df < 1) {
    return {
      chiSquare: 0,
      degreesOfFreedom: 0,
      pValue: 1,
      sampleSizePerHalf: mid,
      verdict: "insufficient_data",
      frobeniusDistance: frob,
    };
  }

  const pValue = chiSquarePValue(chiSquare, df);
  const verdict: MatrixStability["verdict"] =
    pValue > 0.1 ? "stable" : pValue > 0.01 ? "drifting" : "unstable";

  return {
    chiSquare: parseFloat(chiSquare.toFixed(3)),
    degreesOfFreedom: df,
    pValue: parseFloat(pValue.toFixed(4)),
    sampleSizePerHalf: mid,
    verdict,
    frobeniusDistance: parseFloat(frob.toFixed(4)),
  };
}

function buildMarkovInterpretation(
  regime: string,
  prevRegime: string,
  transition: boolean,
  pBull: number,
  pBear: number,
  pSame: number,
  zScore: number,
  confidence: number,
): string {
  let msg = `Market regime: ${regime.toUpperCase()} (Z-score: ${zScore.toFixed(2)}). `;

  if (transition) {
    msg += `REGIME CHANGE from ${prevRegime} → ${regime}. `;
  }

  msg +=
    `Transition probabilities: Bull ${(pBull * 100).toFixed(0)}%, ` +
    `Stay ${(pSame * 100).toFixed(0)}%, Bear ${(pBear * 100).toFixed(0)}%. `;

  if (confidence > 30) {
    msg += `High confidence (${confidence.toFixed(0)}%) — strong regime signal.`;
  } else if (confidence > 15) {
    msg += `Moderate confidence (${confidence.toFixed(0)}%) — regime is developing.`;
  } else {
    msg += `Low confidence (${confidence.toFixed(0)}%) — mixed signals, caution advised.`;
  }

  return msg;
}
