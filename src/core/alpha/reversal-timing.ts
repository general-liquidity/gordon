/**
 * Reversal-Timing Correlation
 *
 * Quantifies the pattern Spicy describes in their BTC-altcoin
 * correlation thread: highly correlated assets don't just have
 * correlated returns — they REVERSE at the same wall-clock moment.
 * BTC makes a local low → altcoin makes a local low in the same
 * bar (or within ±N bars).
 *
 * This is a different correlation axis than return-series Pearson
 * correlation (which Gordon already has in `effective-n.ts` and
 * `helpers.ts`). Two assets can have moderate return correlation
 * but very different reversal timing — or vice versa. Operator
 * should look at both.
 *
 * Procedure:
 *   1. Detect local extrema (highs + lows) in both series with an
 *      operator-tunable window
 *   2. Pair A's reversals with B's reversals greedily (1-to-1,
 *      nearest in time, same direction by default)
 *   3. Report match rates in both directions + mean lag + verdict
 *
 * Pure function over Bar arrays. Composes with:
 *   - `effective-n.ts` for return-correlation (second axis)
 *   - `marginal-contribution.ts` for diversification analysis
 *     (third axis: drawdown overlap)
 *
 * Together the three axes give a fuller picture than any single
 * correlation metric.
 */

export type ReversalKind = "low" | "high";

export interface Bar {
  /** Unix milliseconds or bar index — used only for matching by time. */
  time: number;
  high: number;
  low: number;
  /** Optional. */
  close?: number;
  /** Optional. */
  volume?: number;
}

export interface ReversalPoint {
  /** Index into the source bar array. */
  index: number;
  time: number;
  price: number;
  kind: ReversalKind;
}

export interface MatchedReversal {
  a: ReversalPoint;
  b: ReversalPoint;
  /** b.index - a.index. Negative = B led A, positive = B lagged A. */
  lagBars: number;
}

export interface ReversalTimingOptions {
  /**
   * Half-window for local-extremum detection. Bar i is a low when
   * its low is strictly less than every bar in [i-W, i-1] AND
   * [i+1, i+W]. Default 3.
   */
  extremumWindow?: number;
  /**
   * Tolerance in bars when matching reversals between assets.
   * Two reversals match when |a.index - b.index| ≤ this. Default 2.
   */
  matchToleranceBars?: number;
  /**
   * Match only same-direction pairs (low-with-low, high-with-high).
   * Default true. When false, cross-direction matches count
   * (useful for detecting anti-correlated pairs).
   */
  sameDirectionOnly?: boolean;
  /**
   * Minimum reversals required in each series to produce a verdict.
   * Default 5.
   */
  minReversalsPerSeries?: number;
}

export interface ReversalTimingResult {
  reversalsA: ReversalPoint[];
  reversalsB: ReversalPoint[];
  matchedPairs: MatchedReversal[];
  /** Count of A reversals that found a match in B. */
  matchedACount: number;
  /** Count of B reversals that found a match in A. */
  matchedBCount: number;
  /** matchedACount / reversalsA.length — fraction of A reversals B confirmed. */
  matchRateA: number;
  /** matchedBCount / reversalsB.length — fraction of B reversals A confirmed. */
  matchRateB: number;
  /** Mean lag across matched pairs. Negative = B leads A, positive = B lags A. */
  meanLagBars: number;
  /** Standard deviation of lag — high std means inconsistent timing relationship. */
  lagStdBars: number;
  verdict:
    | "highly_correlated"
    | "moderately_correlated"
    | "weakly_correlated"
    | "uncorrelated"
    | "insufficient_data";
  summary: string;
}

// ============================================================================
// Internals
// ============================================================================

/**
 * Detect local extrema using a symmetric ±window. Bar i is a low
 * when its `low` is strictly less than the lows of every bar in
 * the window on either side. Symmetric definition — i is a high
 * mirror. The first/last `window` bars are skipped.
 */
export function detectReversals(bars: Bar[], window: number): ReversalPoint[] {
  if (window < 1 || bars.length < 2 * window + 1) return [];
  const reversals: ReversalPoint[] = [];
  for (let i = window; i < bars.length - window; i++) {
    const bar = bars[i]!;
    let isLow = true;
    let isHigh = true;
    for (let j = i - window; j <= i + window; j++) {
      if (j === i) continue;
      const other = bars[j]!;
      if (other.low <= bar.low) isLow = false;
      if (other.high >= bar.high) isHigh = false;
      if (!isLow && !isHigh) break;
    }
    if (isLow) reversals.push({ index: i, time: bar.time, price: bar.low, kind: "low" });
    if (isHigh) reversals.push({ index: i, time: bar.time, price: bar.high, kind: "high" });
  }
  return reversals;
}

/**
 * Greedy 1-to-1 pairing of reversals between two series. For each
 * unmatched A reversal in time order, find the nearest unmatched B
 * reversal within tolerance (same direction if `sameDirectionOnly`).
 * Once paired, neither can match anything else.
 */
function pairReversals(
  a: ReversalPoint[],
  b: ReversalPoint[],
  toleranceBars: number,
  sameDirectionOnly: boolean,
): MatchedReversal[] {
  const pairs: MatchedReversal[] = [];
  const usedB = new Set<number>();

  for (const aRev of a) {
    let bestIdx = -1;
    let bestDist = Infinity;
    for (let i = 0; i < b.length; i++) {
      if (usedB.has(i)) continue;
      const bRev = b[i]!;
      if (sameDirectionOnly && bRev.kind !== aRev.kind) continue;
      const dist = Math.abs(bRev.index - aRev.index);
      if (dist > toleranceBars) continue;
      if (dist < bestDist) {
        bestDist = dist;
        bestIdx = i;
      }
    }
    if (bestIdx >= 0) {
      const bRev = b[bestIdx]!;
      usedB.add(bestIdx);
      pairs.push({ a: aRev, b: bRev, lagBars: bRev.index - aRev.index });
    }
  }

  return pairs;
}

function classifyVerdict(matchRateA: number, matchRateB: number): ReversalTimingResult["verdict"] {
  if (matchRateA >= 0.7 && matchRateB >= 0.7) return "highly_correlated";
  if (matchRateA >= 0.4 && matchRateB >= 0.4) return "moderately_correlated";
  if (matchRateA >= 0.2 || matchRateB >= 0.2) return "weakly_correlated";
  return "uncorrelated";
}

// ============================================================================
// Public API
// ============================================================================

const DEFAULT_EXTREMUM_WINDOW = 3;
const DEFAULT_MATCH_TOLERANCE = 2;
const DEFAULT_SAME_DIRECTION = true;
const DEFAULT_MIN_REVERSALS = 5;

export function analyzeReversalTiming(
  barsA: Bar[],
  barsB: Bar[],
  options: ReversalTimingOptions = {},
): ReversalTimingResult {
  const window = options.extremumWindow ?? DEFAULT_EXTREMUM_WINDOW;
  const tolerance = options.matchToleranceBars ?? DEFAULT_MATCH_TOLERANCE;
  const sameDir = options.sameDirectionOnly ?? DEFAULT_SAME_DIRECTION;
  const minReversals = options.minReversalsPerSeries ?? DEFAULT_MIN_REVERSALS;

  const reversalsA = detectReversals(barsA, window);
  const reversalsB = detectReversals(barsB, window);

  if (reversalsA.length < minReversals || reversalsB.length < minReversals) {
    return {
      reversalsA,
      reversalsB,
      matchedPairs: [],
      matchedACount: 0,
      matchedBCount: 0,
      matchRateA: 0,
      matchRateB: 0,
      meanLagBars: 0,
      lagStdBars: 0,
      verdict: "insufficient_data",
      summary:
        `Insufficient reversals — A: ${reversalsA.length}, B: ${reversalsB.length} (need ≥ ${minReversals} in each). ` +
        `Try a smaller extremumWindow or longer series.`,
    };
  }

  const matchedPairs = pairReversals(reversalsA, reversalsB, tolerance, sameDir);
  const matchedACount = matchedPairs.length;
  const matchedBCount = matchedPairs.length; // by construction of 1-to-1 pairing

  const matchRateA = matchedACount / reversalsA.length;
  const matchRateB = matchedBCount / reversalsB.length;

  let meanLag = 0;
  let lagStd = 0;
  if (matchedPairs.length > 0) {
    const lags = matchedPairs.map((p) => p.lagBars);
    let sum = 0;
    for (const l of lags) sum += l;
    meanLag = sum / lags.length;
    if (lags.length > 1) {
      let sumSq = 0;
      for (const l of lags) sumSq += (l - meanLag) * (l - meanLag);
      lagStd = Math.sqrt(sumSq / (lags.length - 1));
    }
  }

  const verdict = classifyVerdict(matchRateA, matchRateB);

  let lagDirection = "synchronous";
  if (Math.abs(meanLag) > 0.5) {
    lagDirection = meanLag < 0 ? "B leads A" : "B lags A";
  }

  const summary =
    `${reversalsA.length} reversals in A, ${reversalsB.length} in B, ${matchedPairs.length} matched pairs. ` +
    `Match rates: A→${(matchRateA * 100).toFixed(0)}%, B→${(matchRateB * 100).toFixed(0)}%. ` +
    `Mean lag: ${meanLag.toFixed(2)} bars (${lagDirection}, σ=${lagStd.toFixed(2)}). → ${verdict}`;

  return {
    reversalsA,
    reversalsB,
    matchedPairs,
    matchedACount,
    matchedBCount,
    matchRateA: parseFloat(matchRateA.toFixed(4)),
    matchRateB: parseFloat(matchRateB.toFixed(4)),
    meanLagBars: parseFloat(meanLag.toFixed(4)),
    lagStdBars: parseFloat(lagStd.toFixed(4)),
    verdict,
    summary,
  };
}

/**
 * Render operator-readable text.
 */
export function formatReversalTiming(result: ReversalTimingResult): string {
  const lines: string[] = [
    `Reversal-Timing Correlation — ${result.verdict.toUpperCase()}`,
    "",
    `  A reversals: ${result.reversalsA.length}`,
    `  B reversals: ${result.reversalsB.length}`,
    `  Matched pairs: ${result.matchedPairs.length}`,
    `  Match rate A→B: ${(result.matchRateA * 100).toFixed(1)}%`,
    `  Match rate B→A: ${(result.matchRateB * 100).toFixed(1)}%`,
    `  Mean lag: ${result.meanLagBars.toFixed(2)} bars (σ=${result.lagStdBars.toFixed(2)})`,
  ];
  if (Math.abs(result.meanLagBars) > 0.5) {
    lines.push(`  → ${result.meanLagBars < 0 ? "B leads A" : "B lags A"} on average`);
  } else {
    lines.push(`  → synchronous (no consistent lead/lag)`);
  }
  lines.push("");
  lines.push(`Summary: ${result.summary}`);
  return lines.join("\n");
}
