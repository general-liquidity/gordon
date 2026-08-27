/**
 * Open-as-pivot / wickless-drive mean-reversion (CryptoCred "daily open" lesson).
 *
 * Two pure-OHLC facets in one primitive:
 *   1. Session open as a dynamic S/R pivot: the FIRST candle's open anchors a
 *      reclaim/lost bias for current price relative to that level.
 *   2. Wickless candle-open drive: the LATEST candle's one-sided drive off its
 *      OWN open (negligible opposite wick) flags a mean-reversion tendency back
 *      toward that candle's open.
 *
 * Distinct from opening-range-breakout (a high/low band over the first N bars)
 * and central-pivot-range (HLC-derived pivot trio) — this keys off the raw
 * session OPEN price and per-candle wick geometry, not ranges or CPR levels.
 */

import type { Candle } from "./types.ts";

export interface OpenPivotResult {
  sessionOpen: number;
  currentClose: number;
  distanceFromOpenPct: number;
  openBias: "above_open" | "below_open" | "at_open";
  reclaimEvent: "reclaimed" | "lost" | "none";
  wicklessDrive: "up_drive" | "down_drive" | "none";
  revertTarget: number | null;
  interpretation: string;
}

function neutral(): OpenPivotResult {
  return {
    sessionOpen: 0,
    currentClose: 0,
    distanceFromOpenPct: 0,
    openBias: "at_open",
    reclaimEvent: "none",
    wicklessDrive: "none",
    revertTarget: null,
    interpretation: "Insufficient data for open-pivot (need ≥2 candles).",
  };
}

/**
 * Compute session-open pivot bias + latest-candle wickless drive.
 */
export function calculateOpenPivot(
  candles: Candle[],
  opts?: { wickFracThreshold?: number },
): OpenPivotResult {
  const n = candles.length;
  if (n < 2) return neutral();

  const wickFracThreshold = opts?.wickFracThreshold ?? 0.05;

  const sessionOpen = candles[0]!.open;
  const latest = candles[n - 1]!;
  const prev = candles[n - 2]!;
  const currentClose = latest.close;

  const distanceFromOpenPct =
    sessionOpen === 0
      ? 0
      : parseFloat((((currentClose - sessionOpen) / sessionOpen) * 100).toFixed(4));

  const openBias: OpenPivotResult["openBias"] =
    currentClose > sessionOpen
      ? "above_open"
      : currentClose < sessionOpen
        ? "below_open"
        : "at_open";

  // Reclaim/lost: latest bar's close crossing the session open relative to
  // the prior bar's close.
  let reclaimEvent: OpenPivotResult["reclaimEvent"] = "none";
  if (prev.close < sessionOpen && currentClose > sessionOpen) reclaimEvent = "reclaimed";
  else if (prev.close > sessionOpen && currentClose < sessionOpen) reclaimEvent = "lost";

  // Wickless drive on the latest candle: one-sided drive off its own open with
  // negligible opposite-side wick fraction and a non-trivial body.
  const range = latest.high - latest.low;
  const body = Math.abs(latest.close - latest.open);
  let wicklessDrive: OpenPivotResult["wicklessDrive"] = "none";
  let revertTarget: number | null = null;

  if (range > 0 && body / range > wickFracThreshold) {
    if (latest.close > latest.open) {
      // Green candle: lower wick (open − low) ≈ 0 → drove up off the open.
      const lowerWickFrac = (latest.open - latest.low) / range;
      if (lowerWickFrac <= wickFracThreshold) {
        wicklessDrive = "up_drive";
        revertTarget = latest.open;
      }
    } else if (latest.close < latest.open) {
      // Red candle: upper wick (high − open) ≈ 0 → drove down off the open.
      const upperWickFrac = (latest.high - latest.open) / range;
      if (upperWickFrac <= wickFracThreshold) {
        wicklessDrive = "down_drive";
        revertTarget = latest.open;
      }
    }
  }

  const biasPhrase =
    openBias === "above_open"
      ? `price ${distanceFromOpenPct >= 0 ? "+" : ""}${distanceFromOpenPct}% above session open`
      : openBias === "below_open"
        ? `price ${distanceFromOpenPct}% below session open`
        : "price at session open";

  const reclaimPhrase =
    reclaimEvent === "reclaimed"
      ? "; latest bar RECLAIMED the open (crossed from below to above)"
      : reclaimEvent === "lost"
        ? "; latest bar LOST the open (crossed from above to below)"
        : "";

  const drivePhrase =
    wicklessDrive === "up_drive"
      ? `; wickless up-drive — mean-reversion target back to ${revertTarget}`
      : wicklessDrive === "down_drive"
        ? `; wickless down-drive — mean-reversion target back to ${revertTarget}`
        : "";

  const interpretation = `Session open ${sessionOpen}: ${biasPhrase}${reclaimPhrase}${drivePhrase}.`;

  return {
    sessionOpen,
    currentClose,
    distanceFromOpenPct,
    openBias,
    reclaimEvent,
    wicklessDrive,
    revertTarget,
    interpretation,
  };
}
