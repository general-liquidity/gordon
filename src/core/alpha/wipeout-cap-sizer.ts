/**
 * Wipeout-Cap Position Sizer (Drogan/Starkiller-style)
 *
 * Bounds a position's size such that the WORST-CASE loss (complete
 * wipeout of the position) is capped at a fraction of total book.
 * Drogan's rule from the Starkiller framework: "we never want to be
 * in anything where we believe we're going to lose more than 1% of
 * the book." A 100%-wipeout-probability position becomes a 1%-of-book
 * position; a 10%-wipeout-probability position can be larger.
 *
 * Distinct from:
 *   - `position-sizer.ts`    (Kelly-based; uses expected return +
 *                             variance; doesn't bound worst-case)
 *   - `risk-of-ruin.ts`      (portfolio-level ruin probability;
 *                             not per-position wipeout cap)
 *   - `hotStreakSizer.ts`    (recent-PnL-streak based multiplier)
 *   - `streakCircuitBreaker` (sequence-of-losses cooldown)
 *
 * This is failure-probability-based and bounds worst-case scenario,
 * NOT expected-utility-based. Useful when:
 *   - Probability distributions are unknown / hard to estimate
 *   - The downside is binary (full loss vs success)
 *   - Operator wants a guaranteed worst-case book impact bound
 *
 * Composes with: `position-sizer.ts` (take the MIN of Kelly size
 * and wipeout-cap size to honor both expected-utility-optimal AND
 * worst-case-bounded sizing).
 *
 * Pure function.
 */

export interface WipeoutCapInput {
  /** Expected yield as decimal (e.g. 0.10 = 10%). */
  expectedYield: number;
  /**
   * Probability of complete wipeout of the position. In [0, 1].
   * Drogan's framing: "if it's 100% wipeout probability, it's a
   * 1% position; if it's 10%, it can be 10%."
   */
  wipeoutProbability: number;
  /**
   * Max acceptable fraction of total book to lose on this single
   * position in the wipeout scenario. Default 0.01 (1%) per Drogan.
   */
  maxBookLossFraction?: number;
  /**
   * Optional minimum position size as fraction of book. Default 0
   * (no minimum — positions can be skipped entirely).
   */
  minPositionFraction?: number;
  /**
   * Optional cap on the position size regardless of wipeout math.
   * Default 1.0 (100% of book). Operator can clamp to e.g. 0.20
   * to prevent over-concentration even on "safe" positions.
   */
  maxPositionFraction?: number;
}

export type SizingVerdict =
  | "sized"
  | "below_minimum"
  | "invalid_inputs";

export interface WipeoutCapResult {
  /** Position size as fraction of book. */
  positionFraction: number;
  /** Expected return on the BOOK (not on the position). */
  expectedBookReturn: number;
  /** Worst-case loss on the BOOK if the position wipes out. */
  worstCaseBookLoss: number;
  /** Expected risk-adjusted return: yield × probability of success. */
  expectedYieldOnPosition: number;
  /**
   * Risk-reward verdict: positive = expected gain outweighs worst-case
   * book loss × probability; negative = the trade is structurally
   * negative-EV given the wipeout probability.
   */
  netEv: number;
  verdict: SizingVerdict;
  summary: string;
}

const DEFAULT_MAX_BOOK_LOSS = 0.01;
const DEFAULT_MIN_POSITION = 0;
const DEFAULT_MAX_POSITION = 1.0;

export function sizeWithWipeoutCap(input: WipeoutCapInput): WipeoutCapResult {
  const maxBookLoss = input.maxBookLossFraction ?? DEFAULT_MAX_BOOK_LOSS;
  const minPos = input.minPositionFraction ?? DEFAULT_MIN_POSITION;
  const maxPos = input.maxPositionFraction ?? DEFAULT_MAX_POSITION;

  if (
    input.wipeoutProbability < 0 ||
    input.wipeoutProbability > 1 ||
    maxBookLoss <= 0 ||
    maxBookLoss > 1
  ) {
    return {
      positionFraction: 0,
      expectedBookReturn: 0,
      worstCaseBookLoss: 0,
      expectedYieldOnPosition: 0,
      netEv: 0,
      verdict: "invalid_inputs",
      summary: "Invalid inputs: wipeoutProbability must be in [0,1], maxBookLoss in (0,1].",
    };
  }

  // Worst case: position fully wipes out. To keep that loss ≤ maxBookLoss
  // of total book, we need position ≤ maxBookLoss / wipeoutProbability.
  // But probability-of-wipeout below 1 means we expect SOME positions
  // to wipe out; the cap is on the worst-case ABSOLUTE loss per
  // position, not the expected loss. Per Drogan's framing, the right
  // math is to assume the position WILL wipe out (worst case) and
  // size such that even then we lose ≤ maxBookLoss.
  //
  // The wipeoutProbability is then used as a CONFIDENCE INPUT — higher
  // probability means we're more confident the worst case happens, so
  // we discount the position more aggressively. Mapping:
  //   p_wipeout = 1.0 → position = maxBookLoss (the wipeout IS the
  //                     book loss, no discount)
  //   p_wipeout = 0.5 → position = 2 × maxBookLoss (less likely to
  //                     wipeout, but still bounded)
  //   p_wipeout → 0   → position → maxPositionFraction (vanishing
  //                     wipeout risk, no wipeout cap binds)
  //
  // Concretely: position = min(maxBookLoss / max(p, ε), maxPositionFraction)
  const EPSILON = 1e-6;
  const wipeoutCapPosition =
    maxBookLoss / Math.max(input.wipeoutProbability, EPSILON);
  const positionFraction = Math.min(wipeoutCapPosition, maxPos);

  if (positionFraction < minPos) {
    return {
      positionFraction: 0,
      expectedBookReturn: 0,
      worstCaseBookLoss: 0,
      expectedYieldOnPosition: 0,
      netEv: 0,
      verdict: "below_minimum",
      summary:
        `Computed size ${(positionFraction * 100).toFixed(2)}% below minimum ${(minPos * 100).toFixed(2)}% — skip.`,
    };
  }

  // Expected yield on the position, accounting for wipeout probability
  // (assumes survivor scenario delivers expectedYield; wipeout = total loss)
  const successProb = 1 - input.wipeoutProbability;
  const expectedYieldOnPosition =
    successProb * input.expectedYield - input.wipeoutProbability * 1.0;
  const expectedBookReturn = positionFraction * expectedYieldOnPosition;
  const worstCaseBookLoss = positionFraction;
  const netEv = expectedBookReturn;

  const summary =
    `Sized ${(positionFraction * 100).toFixed(2)}% of book. ` +
    `Yield ${(input.expectedYield * 100).toFixed(1)}%, wipeout prob ${(input.wipeoutProbability * 100).toFixed(1)}%. ` +
    `Worst-case book loss ${(worstCaseBookLoss * 100).toFixed(2)}% (cap ${(maxBookLoss * 100).toFixed(2)}%). ` +
    `Expected book return ${(expectedBookReturn * 100).toFixed(3)}%.`;

  return {
    positionFraction: parseFloat(positionFraction.toFixed(6)),
    expectedBookReturn: parseFloat(expectedBookReturn.toFixed(6)),
    worstCaseBookLoss: parseFloat(worstCaseBookLoss.toFixed(6)),
    expectedYieldOnPosition: parseFloat(expectedYieldOnPosition.toFixed(6)),
    netEv: parseFloat(netEv.toFixed(6)),
    verdict: "sized",
    summary,
  };
}

export function formatWipeoutCap(result: WipeoutCapResult): string {
  const lines = [
    `Wipeout-Cap Sizer — ${result.verdict.toUpperCase()}`,
    "",
    `  Position fraction:        ${(result.positionFraction * 100).toFixed(2)}%`,
    `  Worst-case book loss:     ${(result.worstCaseBookLoss * 100).toFixed(2)}%`,
    `  Expected yield (on pos):  ${(result.expectedYieldOnPosition * 100).toFixed(2)}%`,
    `  Expected return (book):   ${(result.expectedBookReturn * 100).toFixed(3)}%`,
    `  Net EV:                   ${(result.netEv * 100).toFixed(3)}%`,
    "",
    `Summary: ${result.summary}`,
  ];
  if (result.verdict === "sized" && result.netEv < 0) {
    lines.push("");
    lines.push("⚠ Net EV is negative — the wipeout probability outweighs the expected yield.");
    lines.push("  Consider skipping this position regardless of the wipeout-cap math.");
  }
  return lines.join("\n");
}
