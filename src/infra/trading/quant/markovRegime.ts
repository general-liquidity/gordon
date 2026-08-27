/**
 * Markov Chain Regime Detection — Predict Regime TRANSITIONS
 *
 * Unlike Hurst exponent (classifies current state) or market efficiency
 * tests (tests if patterns exist), Markov chains predict the PROBABILITY
 * of transitioning from one regime to another.
 *
 * "Market is currently bullish. What's the probability it stays bullish
 * vs transitions to bearish?" → answered by the transition matrix.
 *
 * States: Bull (+1), Neutral (0), Bear (-1)
 * Transition matrix P[i][j] = probability of moving from state i to state j
 *
 * Source: Moon Dev Trading Bots (Markov Chain strategy)
 */

// ============================================================================
// Types
// ============================================================================

export type MarkovState = "bull" | "neutral" | "bear";

export interface TransitionMatrix {
  /** P[from][to] = probability of transitioning from → to. */
  matrix: Record<MarkovState, Record<MarkovState, number>>;
  /** Number of observations used to build the matrix. */
  observations: number;
  /** Smoothing alpha used (Laplace smoothing). */
  smoothingAlpha: number;
}

export interface MarkovRegimeResult {
  /** Current classified state. */
  currentState: MarkovState;
  /** Transition probabilities FROM current state. */
  transitionProbabilities: Record<MarkovState, number>;
  /** Most likely next state. */
  predictedNextState: MarkovState;
  /** Confidence in the prediction (max transition probability). */
  confidence: number;
  /** Full transition matrix. */
  transitionMatrix: TransitionMatrix;
  /** State history (last N states). */
  stateHistory: MarkovState[];
  /** Regime strength: how persistent is the current regime? */
  regimeStrength: number;
  /** Signal based on transition probabilities. */
  signal: "stay" | "reversal_likely" | "transition_uncertain";
  /** Summary. */
  summary: string;
}

export interface MarkovConfig {
  /** Z-score threshold for bull/bear classification. Default 1.0. */
  zScoreThreshold: number;
  /** Lookback window for z-score calculation. Default 20. */
  lookbackWindow: number;
  /** Laplace smoothing alpha. Default 0.1. */
  smoothingAlpha: number;
}

export const DEFAULT_MARKOV_CONFIG: MarkovConfig = {
  zScoreThreshold: 1.0,
  lookbackWindow: 20,
  smoothingAlpha: 0.1,
};

// ============================================================================
// State Classification
// ============================================================================

function classifyState(zScore: number, threshold: number): MarkovState {
  if (zScore > threshold) return "bull";
  if (zScore < -threshold) return "bear";
  return "neutral";
}

function computeRollingZScores(returns: number[], window: number): number[] {
  const zScores: number[] = [];
  for (let i = window; i < returns.length; i++) {
    const slice = returns.slice(i - window, i);
    const mean = slice.reduce((s, v) => s + v, 0) / slice.length;
    const std = Math.sqrt(slice.reduce((s, v) => s + (v - mean) ** 2, 0) / (slice.length - 1));
    zScores.push(std > 0 ? (returns[i]! - mean) / std : 0);
  }
  return zScores;
}

// ============================================================================
// Transition Matrix
// ============================================================================

function buildTransitionMatrix(states: MarkovState[], alpha: number): TransitionMatrix {
  const stateKeys: MarkovState[] = ["bull", "neutral", "bear"];

  // Count transitions
  const counts: Record<MarkovState, Record<MarkovState, number>> = {
    bull: { bull: alpha, neutral: alpha, bear: alpha },
    neutral: { bull: alpha, neutral: alpha, bear: alpha },
    bear: { bull: alpha, neutral: alpha, bear: alpha },
  };

  let totalTransitions = 0;
  for (let i = 1; i < states.length; i++) {
    const from = states[i - 1]!;
    const to = states[i]!;
    counts[from][to]++;
    totalTransitions++;
  }

  // Normalize to probabilities
  const matrix: Record<MarkovState, Record<MarkovState, number>> = {
    bull: { bull: 0, neutral: 0, bear: 0 },
    neutral: { bull: 0, neutral: 0, bear: 0 },
    bear: { bull: 0, neutral: 0, bear: 0 },
  };

  for (const from of stateKeys) {
    const rowSum = stateKeys.reduce((s, to) => s + counts[from][to], 0);
    for (const to of stateKeys) {
      matrix[from][to] = rowSum > 0 ? counts[from][to] / rowSum : 1 / 3;
    }
  }

  return { matrix, observations: totalTransitions, smoothingAlpha: alpha };
}

// ============================================================================
// Main Analysis
// ============================================================================

/**
 * Run Markov chain regime analysis on a price series.
 *
 * @param prices Historical prices (oldest first, at least 50 data points).
 * @param config Classification parameters.
 */
export function analyzeMarkovRegime(
  prices: number[],
  config: MarkovConfig = DEFAULT_MARKOV_CONFIG,
): MarkovRegimeResult {
  if (prices.length < config.lookbackWindow + 10) {
    return {
      currentState: "neutral",
      transitionProbabilities: { bull: 0.33, neutral: 0.34, bear: 0.33 },
      predictedNextState: "neutral",
      confidence: 0.34,
      transitionMatrix: buildTransitionMatrix([], config.smoothingAlpha),
      stateHistory: [],
      regimeStrength: 0,
      signal: "transition_uncertain",
      summary: "Insufficient data for Markov regime analysis.",
    };
  }

  // Compute returns
  const returns: number[] = [];
  for (let i = 1; i < prices.length; i++) {
    if (prices[i - 1]! > 0) returns.push((prices[i]! - prices[i - 1]!) / prices[i - 1]!);
  }

  // Classify each period into a state
  const zScores = computeRollingZScores(returns, config.lookbackWindow);
  const states = zScores.map((z) => classifyState(z, config.zScoreThreshold));

  // Build transition matrix
  const tm = buildTransitionMatrix(states, config.smoothingAlpha);

  // Current state and predictions
  const currentState = states[states.length - 1] ?? "neutral";
  const transitionProbabilities = tm.matrix[currentState];

  // Predicted next state = highest probability
  const stateKeys: MarkovState[] = ["bull", "neutral", "bear"];
  let predictedNextState: MarkovState = "neutral";
  let maxProb = 0;
  for (const s of stateKeys) {
    if (transitionProbabilities[s] > maxProb) {
      maxProb = transitionProbabilities[s];
      predictedNextState = s;
    }
  }

  // Regime strength: probability of staying in current state
  const regimeStrength = transitionProbabilities[currentState];

  // Signal
  let signal: MarkovRegimeResult["signal"];
  if (regimeStrength > 0.6) signal = "stay";
  else if (regimeStrength < 0.35) signal = "reversal_likely";
  else signal = "transition_uncertain";

  // Summary
  const pBull = (transitionProbabilities.bull * 100).toFixed(0);
  const pNeutral = (transitionProbabilities.neutral * 100).toFixed(0);
  const pBear = (transitionProbabilities.bear * 100).toFixed(0);

  const summary =
    `Current: ${currentState.toUpperCase()} | Next: ${pBull}% bull, ${pNeutral}% neutral, ${pBear}% bear | ` +
    `Predicted: ${predictedNextState.toUpperCase()} (${(maxProb * 100).toFixed(0)}%) | ` +
    `Regime strength: ${(regimeStrength * 100).toFixed(0)}% | Signal: ${signal.replace("_", " ")}`;

  return {
    currentState,
    transitionProbabilities,
    predictedNextState,
    confidence: maxProb,
    transitionMatrix: tm,
    stateHistory: states.slice(-20),
    regimeStrength,
    signal,
    summary,
  };
}
