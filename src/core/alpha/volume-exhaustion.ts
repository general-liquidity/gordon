/**
 * Volume-Exhaustion Signal (in-trade)
 *
 * Spicy's Bonus Resource #2 (Volume Masterclass): If a breakout has
 * been entered and volume drops off sharply while the position is
 * still open, the conditions that justified the entry have changed.
 * The recommended response is "exit before SL" — accept a small loss
 * rather than wait for the stop.
 *
 * This primitive is a pure function over (entry-window baseline,
 * current-window observation) — caller wires it into a position-
 * monitoring hook. It does NOT invoke any execution; it emits a
 * signal that downstream code can decide to honor.
 *
 * Procedure:
 *   1. Caller passes the volume baseline computed at trade-entry time
 *      (mean USD volume of the last N entry-window candles)
 *   2. Caller passes the current observation (mean USD volume of the
 *      last M post-entry candles)
 *   3. Compute relative drop = (baseline - current) / baseline
 *   4. Classify into severity bands + emit recommended action
 *
 * Only meaningful for momentum / breakout entries. Mean-reversion
 * entries actually WANT decreasing volume — caller passes
 * `strategy: "breakout"` to enable signal emission.
 */

export type ExhaustionStrategy = "breakout" | "mean_reversion";

export interface VolumeExhaustionInput {
  /** Strategy type — only "breakout" emits actionable signals. */
  strategy: ExhaustionStrategy;
  /** Mean USD volume across the entry-window candles. */
  baselineMeanVolUSD: number;
  /** Mean USD volume across the post-entry candles. */
  currentMeanVolUSD: number;
  /** Number of post-entry candles in the current observation. */
  postEntryCandles: number;
  /** Minimum post-entry candles required before emitting. Default 5. */
  minPostEntryCandles?: number;
  /** Drop fraction for "mild" exhaustion. Default 0.25 (25% drop). */
  mildDropThreshold?: number;
  /** Drop fraction for "severe" exhaustion. Default 0.50 (50% drop). */
  severeDropThreshold?: number;
}

export type ExhaustionSeverity = "none" | "mild" | "severe";
export type ExhaustionAction =
  | "hold"
  | "tighten_stop"
  | "scale_out"
  | "exit_full"
  | "not_applicable"
  | "insufficient_data";

export interface VolumeExhaustionResult {
  applicable: boolean;
  /** baseline → current drop fraction (0..1, negative means volume rose). */
  dropFraction: number;
  severity: ExhaustionSeverity;
  action: ExhaustionAction;
  /** Set when caller should react — i.e., severity > none. */
  signal: boolean;
  summary: string;
}

const DEFAULT_MIN_POST_ENTRY = 5;
const DEFAULT_MILD_THRESHOLD = 0.25;
const DEFAULT_SEVERE_THRESHOLD = 0.5;

export function detectVolumeExhaustion(input: VolumeExhaustionInput): VolumeExhaustionResult {
  const minPost = input.minPostEntryCandles ?? DEFAULT_MIN_POST_ENTRY;
  const mildT = input.mildDropThreshold ?? DEFAULT_MILD_THRESHOLD;
  const severeT = input.severeDropThreshold ?? DEFAULT_SEVERE_THRESHOLD;

  if (input.strategy !== "breakout") {
    return {
      applicable: false,
      dropFraction: 0,
      severity: "none",
      action: "not_applicable",
      signal: false,
      summary:
        "Volume-exhaustion signal only emits for breakout entries (mean-reversion benefits from decreasing volume).",
    };
  }

  if (input.postEntryCandles < minPost) {
    return {
      applicable: false,
      dropFraction: 0,
      severity: "none",
      action: "insufficient_data",
      signal: false,
      summary: `Need ≥ ${minPost} post-entry candles (have ${input.postEntryCandles}).`,
    };
  }

  if (input.baselineMeanVolUSD <= 0) {
    return {
      applicable: false,
      dropFraction: 0,
      severity: "none",
      action: "insufficient_data",
      signal: false,
      summary: "Baseline volume is zero — cannot compute relative drop.",
    };
  }

  const dropFraction =
    (input.baselineMeanVolUSD - input.currentMeanVolUSD) / input.baselineMeanVolUSD;

  let severity: ExhaustionSeverity;
  let action: ExhaustionAction;
  if (dropFraction >= severeT) {
    severity = "severe";
    action = "exit_full";
  } else if (dropFraction >= mildT) {
    severity = "mild";
    action = "scale_out";
  } else if (dropFraction > 0) {
    severity = "none";
    action = "tighten_stop";
  } else {
    severity = "none";
    action = "hold";
  }

  const summary =
    `Volume dropped ${(dropFraction * 100).toFixed(1)}% from entry baseline ($${input.baselineMeanVolUSD.toFixed(0)} → ` +
    `$${input.currentMeanVolUSD.toFixed(0)}). Severity: ${severity}. Recommended: ${action}.`;

  return {
    applicable: true,
    dropFraction: parseFloat(dropFraction.toFixed(4)),
    severity,
    action,
    signal: severity !== "none",
    summary,
  };
}

export function formatVolumeExhaustion(result: VolumeExhaustionResult): string {
  const lines = [
    `Volume Exhaustion — ${result.severity.toUpperCase()}`,
    "",
    `  Applicable: ${result.applicable ? "yes" : "no"}`,
    `  Drop fraction: ${(result.dropFraction * 100).toFixed(1)}%`,
    `  Severity: ${result.severity}`,
    `  Recommended action: ${result.action}`,
    `  Signal emitted: ${result.signal ? "yes" : "no"}`,
    "",
    `Summary: ${result.summary}`,
  ];
  return lines.join("\n");
}
