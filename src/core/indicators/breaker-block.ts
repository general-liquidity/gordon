/**
 * ICT Breaker Block Detection
 *
 * A breaker block is a FAILED order block that flips polarity and then acts as
 * support/resistance in the OPPOSITE direction, confirming a market-structure
 * shift (MSS). Distinct from a plain order block (`order-blocks.ts`), which holds
 * in its ORIGINAL direction; a breaker is an order block that price has broken
 * THROUGH, after which price returns to it from the other side. Also distinct
 * from a change-of-character (`smc-patterns.ts`): a breaker is the specific zone
 * left behind by the broken structure, not the structural-break event itself.
 *
 * Recipe (pivot-based): detect swing highs/lows, find an SH->SL (or SL->SH) leg,
 * confirm the MSS via a close beyond the prior swing, then take the last
 * counter-direction candle body in the leg as the flipped zone.
 */

import type { Candle } from "./types.ts";

export interface BreakerBlockResult {
  breaker: "bullish" | "bearish" | "none";
  zone: { top: number; bottom: number; barIndex: number } | null;
  mssLevel: number | null;
  tested: boolean;
  pivotWindow: number;
  interpretation: string;
}

interface Pivot {
  index: number;
  price: number;
}

function neutral(pivotWindow: number): BreakerBlockResult {
  return {
    breaker: "none",
    zone: null,
    mssLevel: null,
    tested: false,
    pivotWindow,
    interpretation: "Insufficient data / no breaker block",
  };
}

function detectPivots(candles: Candle[], pivotWindow: number): { highs: Pivot[]; lows: Pivot[] } {
  const highs: Pivot[] = [];
  const lows: Pivot[] = [];

  for (let i = pivotWindow; i < candles.length - pivotWindow; i++) {
    const h = candles[i]!.high;
    const l = candles[i]!.low;
    let isHigh = true;
    let isLow = true;

    for (let j = i - pivotWindow; j <= i + pivotWindow; j++) {
      if (j === i) continue;
      if (candles[j]!.high >= h) isHigh = false;
      if (candles[j]!.low <= l) isLow = false;
    }

    if (isHigh) highs.push({ index: i, price: h });
    if (isLow) lows.push({ index: i, price: l });
  }

  return { highs, lows };
}

/**
 * Calculate the most recent confirmed ICT Breaker Block.
 *
 * @param candles - OHLCV candle array
 * @param opts.pivotWindow - bars on each side for swing detection (default 2)
 * @returns BreakerBlockResult
 */
export function calculateBreakerBlock(
  candles: Candle[],
  opts?: { pivotWindow?: number },
): BreakerBlockResult {
  const pivotWindow = opts?.pivotWindow ?? 2;

  if (candles.length < pivotWindow * 2 + 4) {
    return neutral(pivotWindow);
  }

  const { highs, lows } = detectPivots(candles, pivotWindow);
  const lastBar = candles.length - 1;
  const lastClose = candles[lastBar]!.close;

  const bull = detectBullishBreaker(candles, highs, lows, lastClose, pivotWindow);
  const bear = detectBearishBreaker(candles, highs, lows, lastClose, pivotWindow);

  // Most recent confirmed breaker wins (highest mss pivot index).
  let chosen: { result: BreakerBlockResult; order: number } | null = null;
  if (bull) chosen = { result: bull.result, order: bull.shIndex };
  if (bear && (chosen == null || bear.slIndex > chosen.order)) {
    chosen = { result: bear.result, order: bear.slIndex };
  }

  return chosen?.result ?? neutral(pivotWindow);
}

function detectBullishBreaker(
  candles: Candle[],
  highs: Pivot[],
  lows: Pivot[],
  lastClose: number,
  pivotWindow: number,
): { result: BreakerBlockResult; shIndex: number } | null {
  // Scan most recent swing highs first.
  for (let h = highs.length - 1; h >= 0; h--) {
    const sh = highs[h]!;
    // Need MSS: latest close above the swing-high price.
    if (lastClose <= sh.price) continue;

    // Find a swing low AFTER the SH, with price below SH.
    let sl: Pivot | null = null;
    for (let l = 0; l < lows.length; l++) {
      const cand = lows[l]!;
      if (cand.index > sh.index && cand.price < sh.price) {
        if (sl == null || cand.index > sl.index) sl = cand;
      }
    }
    if (sl == null) continue;

    // Zone = last DOWN candle body in the leg from SH down to SL.
    let zoneTop: number | null = null;
    let zoneBottom: number | null = null;
    let zoneBar = -1;
    for (let i = sh.index; i <= sl.index; i++) {
      const c = candles[i]!;
      if (c.close < c.open) {
        zoneTop = c.open;
        zoneBottom = c.close;
        zoneBar = i;
      }
    }
    if (zoneTop == null || zoneBottom == null) {
      // Fallback: candle at SL — bottom=low, top=open.
      const c = candles[sl.index]!;
      zoneTop = c.open;
      zoneBottom = c.low;
      zoneBar = sl.index;
    }

    const top = Math.max(zoneTop, zoneBottom);
    const bottom = Math.min(zoneTop, zoneBottom);

    // Tested: after MSS leg, price traded back into the zone.
    let tested = false;
    for (let i = sl.index + 1; i < candles.length; i++) {
      const c = candles[i]!;
      if (c.low <= top && c.high >= bottom) {
        tested = true;
        break;
      }
    }

    const result: BreakerBlockResult = {
      breaker: "bullish",
      zone: {
        top: parseFloat(top.toFixed(4)),
        bottom: parseFloat(bottom.toFixed(4)),
        barIndex: zoneBar,
      },
      mssLevel: parseFloat(sh.price.toFixed(4)),
      tested,
      pivotWindow,
      interpretation:
        `Bullish breaker block: swing high ${sh.price.toFixed(2)} broken to the upside ` +
        `(MSS up). Flipped support zone ${bottom.toFixed(2)}-${top.toFixed(2)}` +
        (tested ? " (tested)." : " (untested)."),
    };
    return { result, shIndex: sh.index };
  }
  return null;
}

function detectBearishBreaker(
  candles: Candle[],
  highs: Pivot[],
  lows: Pivot[],
  lastClose: number,
  pivotWindow: number,
): { result: BreakerBlockResult; slIndex: number } | null {
  for (let l = lows.length - 1; l >= 0; l--) {
    const sl = lows[l]!;
    if (lastClose >= sl.price) continue;

    // Find a swing high AFTER the SL, with price above SL.
    let sh: Pivot | null = null;
    for (let h = 0; h < highs.length; h++) {
      const cand = highs[h]!;
      if (cand.index > sl.index && cand.price > sl.price) {
        if (sh == null || cand.index > sh.index) sh = cand;
      }
    }
    if (sh == null) continue;

    // Zone = last UP candle body in the leg from SL up to SH.
    let zoneTop: number | null = null;
    let zoneBottom: number | null = null;
    let zoneBar = -1;
    for (let i = sl.index; i <= sh.index; i++) {
      const c = candles[i]!;
      if (c.close > c.open) {
        zoneBottom = c.open;
        zoneTop = c.close;
        zoneBar = i;
      }
    }
    if (zoneTop == null || zoneBottom == null) {
      // Fallback: candle at SH — top=high, bottom=open.
      const c = candles[sh.index]!;
      zoneTop = c.high;
      zoneBottom = c.open;
      zoneBar = sh.index;
    }

    const top = Math.max(zoneTop, zoneBottom);
    const bottom = Math.min(zoneTop, zoneBottom);

    let tested = false;
    for (let i = sh.index + 1; i < candles.length; i++) {
      const c = candles[i]!;
      if (c.low <= top && c.high >= bottom) {
        tested = true;
        break;
      }
    }

    const result: BreakerBlockResult = {
      breaker: "bearish",
      zone: {
        top: parseFloat(top.toFixed(4)),
        bottom: parseFloat(bottom.toFixed(4)),
        barIndex: zoneBar,
      },
      mssLevel: parseFloat(sl.price.toFixed(4)),
      tested,
      pivotWindow,
      interpretation:
        `Bearish breaker block: swing low ${sl.price.toFixed(2)} broken to the downside ` +
        `(MSS down). Flipped resistance zone ${bottom.toFixed(2)}-${top.toFixed(2)}` +
        (tested ? " (tested)." : " (untested)."),
    };
    return { result, slIndex: sl.index };
  }
  return null;
}
