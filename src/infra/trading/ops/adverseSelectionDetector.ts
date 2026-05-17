/**
 * Adverse Selection Detector (GORDON_ADVERSE_SELECTION).
 *
 * Port of Ch 3 from Wright. The Akerlof lemon-market dynamic operates
 * continuously in your fills: when you place a limit order and get filled
 * INSTANTLY, the marginal participant on the other side likely had
 * information you didn't — your order was the lemon-buyer's offer.
 *
 *   "If you're filled easily, you're probably owning the lemon."
 *
 * Concrete detection: a fill that occurs within N seconds of order
 * placement AND moves >M ticks against the position within the next K
 * seconds is flagged adversely-selected. Track these as a fraction of
 * total fills; high rates indicate the operator is providing toxic-flow
 * exit liquidity. Composes with WW4 frictionTracker — adverse selection
 * is an implicit friction cost the marketImpact model can't see.
 */

export const ADVERSE_SELECTION_FLAG_ENV = "GORDON_ADVERSE_SELECTION";

export function isAdverseSelectionEnabled(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return (
    env[ADVERSE_SELECTION_FLAG_ENV] === "1" ||
    env[ADVERSE_SELECTION_FLAG_ENV] === "true"
  );
}

export type FillVerdict = "clean" | "neutral" | "adversely_selected";

export interface FillEvent {
  /** When the limit order was submitted. */
  orderSubmittedAtMs: number;
  /** When the fill confirmed. */
  filledAtMs: number;
  /** Order side. */
  side: "buy" | "sell";
  /** Fill price. */
  fillPrice: number;
  /** Mid price at submission (for adverse-move comparison). */
  midPriceAtSubmit: number;
  /** Mid price K seconds after fill — observation window. */
  midPriceAfterWindow: number;
}

export interface DetectorInput {
  fill: FillEvent;
  /** Fast-fill threshold in seconds. Default 2. */
  fastFillSeconds?: number;
  /**
   * Adverse move threshold in PRICE UNITS (e.g. ticks × tick size).
   * Caller picks based on instrument volatility.
   */
  adverseMoveThreshold?: number;
}

export interface DetectorResult {
  verdict: FillVerdict;
  fillLatencyMs: number;
  postFillMove: number;
  wasFastFill: boolean;
  wasAdverseMove: boolean;
  reason: string;
}

const DEFAULT_FAST_FILL_SECONDS = 2;
const DEFAULT_ADVERSE_MOVE = 0.005;

export function detectAdverseSelection(input: DetectorInput): DetectorResult {
  const fastFillMs = (input.fastFillSeconds ?? DEFAULT_FAST_FILL_SECONDS) * 1000;
  const adverseThreshold = input.adverseMoveThreshold ?? DEFAULT_ADVERSE_MOVE;
  const fill = input.fill;

  const latency = fill.filledAtMs - fill.orderSubmittedAtMs;
  const wasFast = latency >= 0 && latency <= fastFillMs;

  const move = fill.midPriceAfterWindow - fill.fillPrice;
  const adverseMove = fill.side === "buy" ? -move : move;
  const wasAdverse = adverseMove >= adverseThreshold;

  let verdict: FillVerdict;
  let reason: string;
  if (wasFast && wasAdverse) {
    verdict = "adversely_selected";
    reason = `Fast fill (${latency}ms) with ${adverseMove.toFixed(4)} adverse move — toxic flow`;
  } else if (wasFast || wasAdverse) {
    verdict = "neutral";
    reason = wasFast
      ? `Fast fill but no adverse move yet — monitor`
      : `Adverse move after slow fill — possibly fundamental, not toxic`;
  } else {
    verdict = "clean";
    reason = `Slow fill, no adverse move — likely clean liquidity`;
  }

  return {
    verdict,
    fillLatencyMs: latency,
    postFillMove: adverseMove,
    wasFastFill: wasFast,
    wasAdverseMove: wasAdverse,
    reason,
  };
}

export interface FillHistory {
  totalFills: number;
  adverselySelectedCount: number;
  fraction: number;
  /** True when toxic-flow fraction exceeds the operator's tolerance. */
  alarm: boolean;
}

export function aggregateFills(
  verdicts: ReadonlyArray<FillVerdict>,
  alarmThreshold = 0.25,
): FillHistory {
  const total = verdicts.length;
  const adverse = verdicts.filter((v) => v === "adversely_selected").length;
  const fraction = total > 0 ? adverse / total : 0;
  return {
    totalFills: total,
    adverselySelectedCount: adverse,
    fraction,
    alarm: total >= 10 && fraction > alarmThreshold,
  };
}

export function detectorToPayload(result: DetectorResult): Record<string, unknown> {
  return {
    kind: "adverse_selection.evaluated",
    verdict: result.verdict,
    fillLatencyMs: result.fillLatencyMs,
    adverseMove: Number(result.postFillMove.toFixed(5)),
  };
}
