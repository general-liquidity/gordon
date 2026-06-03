/**
 * Candle Continuity Theory (CCT)
 *
 * Edge-School "one candle = bias" concept: derive the bias for the NEXT candle
 * from the RELATIONSHIP between the prior candle and the current (latest closed)
 * candle — where the current candle OPENED relative to the prior candle, and
 * whether it CLOSED with strength (beyond the prior candle's range) or weakness
 * (failed to). Continuity vs reversal falls out of that two-candle handoff.
 *
 * Distinct from candlestick-patterns.ts (named single/multi-bar shapes such as
 * doji / engulfing) and from open-pivot.ts (a single candle vs its own session
 * open / its own wick). CCT is strictly the two-consecutive-candle relationship.
 */

import type { Candle } from "./types.ts";

export interface CandleContinuityResult {
  type: "continuation" | "reversal" | "neutral";
  bias: "bullish" | "bearish" | "neutral";
  signal: "long" | "short" | "flat";
  openLocation: string;
  closeRelation: "strength_up" | "strength_down" | "inside";
  referenceOpen: number | null;
  continuationRate: number | null;
  samplePairs: number;
  tradeHint: string;
  interpretation: string;
}

function neutralResult(): CandleContinuityResult {
  return {
    type: "neutral",
    bias: "neutral",
    signal: "flat",
    openLocation: "at",
    closeRelation: "inside",
    referenceOpen: null,
    continuationRate: null,
    samplePairs: 0,
    tradeHint: "No decisive continuity — wait for a candle that closes beyond the prior range.",
    interpretation: "Insufficient data for candle continuity",
  };
}

export function calculateCandleContinuity(
  candles: Candle[],
  opts?: { historyBars?: number },
): CandleContinuityResult {
  if (candles == null || candles.length < 2) {
    return neutralResult();
  }

  const prior = candles[candles.length - 2]!;
  const current = candles[candles.length - 1]!;

  const priorBodyHigh = Math.max(prior.open, prior.close);
  const priorBodyLow = Math.min(prior.open, prior.close);

  // 1. openLocation: where current.open sits relative to prior
  let openLocation: string;
  if (current.open > prior.high) {
    openLocation = "above_prior_high";
  } else if (current.open < prior.low) {
    openLocation = "below_prior_low";
  } else if (current.open >= priorBodyLow && current.open <= priorBodyHigh) {
    openLocation = "inside_prior_body";
  } else if (current.open === prior.high || current.open === prior.low) {
    openLocation = "at";
  } else {
    openLocation = "inside_prior_range";
  }

  // 2. closeRelation: strength (beyond prior range) vs weakness (inside)
  let closeRelation: "strength_up" | "strength_down" | "inside";
  if (current.close > prior.high) {
    closeRelation = "strength_up";
  } else if (current.close < prior.low) {
    closeRelation = "strength_down";
  } else {
    closeRelation = "inside";
  }

  const priorBullish = prior.close > prior.open;
  const priorBearish = prior.close < prior.open;

  // 3. Classify type + bias + signal
  let type: CandleContinuityResult["type"] = "neutral";
  let bias: CandleContinuityResult["bias"] = "neutral";
  let signal: CandleContinuityResult["signal"] = "flat";

  if (priorBullish && closeRelation === "strength_up") {
    type = "continuation";
    bias = "bullish";
    signal = "long";
  } else if (priorBearish && closeRelation === "strength_down") {
    type = "continuation";
    bias = "bearish";
    signal = "short";
  } else if (priorBearish && closeRelation === "strength_up") {
    type = "reversal";
    bias = "bullish";
    signal = "long";
  } else if (priorBullish && closeRelation === "strength_down") {
    type = "reversal";
    bias = "bearish";
    signal = "short";
  } else {
    type = "neutral";
    bias = "neutral";
    signal = "flat";
  }

  // 4. referenceOpen = current.close (= the next candle's expected open)
  const referenceOpen = bias === "neutral" ? null : parseFloat(current.close.toFixed(8));

  let tradeHint: string;
  if (bias === "bullish") {
    tradeHint =
      "expect next candle to dip below the open then push above the prior high — wait for a retrace below the reference open before going long";
  } else if (bias === "bearish") {
    tradeHint =
      "expect next candle to rally above the open then push below the prior low — wait for a retrace above the reference open before going short";
  } else {
    tradeHint =
      "weakness — current candle closed inside the prior range; no decisive continuity, stand aside";
  }

  // 5. Optional history stats over the last historyBars candle pairs
  const historyBars = opts?.historyBars ?? 50;
  let continuationRate: number | null = null;
  let samplePairs = 0;

  if (historyBars >= 2 && candles.length >= 2) {
    const window = candles.slice(Math.max(0, candles.length - historyBars));
    let matches = 0;
    for (let i = 1; i < window.length; i++) {
      const p = window[i - 1]!;
      const n = window[i]!;
      const priorDir = Math.sign(p.close - p.open);
      const nextDir = Math.sign(n.close - n.open);
      if (priorDir !== 0 && priorDir === nextDir) {
        matches++;
      }
      samplePairs++;
    }
    if (samplePairs > 0) {
      continuationRate = parseFloat((matches / samplePairs).toFixed(4));
    }
  }

  const interpretation =
    type === "neutral"
      ? `Weakness: current candle opened ${openLocation} and closed inside the prior range — no continuity bias.`
      : `${type === "continuation" ? "Continuation" : "Reversal"} (${bias}): current opened ${openLocation}, closed with ${closeRelation}; ${signal} bias for the next candle off reference open ${referenceOpen}.`;

  return {
    type,
    bias,
    signal,
    openLocation,
    closeRelation,
    referenceOpen,
    continuationRate,
    samplePairs,
    tradeHint,
    interpretation,
  };
}
