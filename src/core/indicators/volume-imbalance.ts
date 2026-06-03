/**
 * ICT Volume Imbalance (VI) Detection
 *
 * A VI is a TWO-candle BODY gap: adjacent candles whose bodies do not touch
 * (a gap between one candle's close and the next candle's open) BUT whose
 * ranges (wicks) still overlap — so it is NOT a true price gap.
 *
 * Explicitly distinct from the Fair Value Gap (FVG, see `fvg.ts`), which is a
 * THREE-candle WICK gap with no range overlap at all. Price tends to revisit
 * and rebalance the body-only gap left behind by a VI.
 */

import type { Candle } from "./types.ts";

export interface VolumeImbalance {
  /** Imbalance type */
  type: "bullish" | "bearish";
  /** Upper boundary of the VI zone */
  top: number;
  /** Lower boundary of the VI zone */
  bottom: number;
  /** Bar index where the VI was detected (the second candle, i) */
  barIndex: number;
  /** Whether price has traded back through the zone */
  filled: boolean;
}

export interface VolumeImbalanceResult {
  /** All VIs detected within the lookback window */
  imbalances: VolumeImbalance[];
  /** Bullish VIs within lookback */
  bullishImbalances: VolumeImbalance[];
  /** Bearish VIs within lookback */
  bearishImbalances: VolumeImbalance[];
  /** Nearest unfilled bullish VI below current price */
  nearestUnfilledBullish: VolumeImbalance | null;
  /** Nearest unfilled bearish VI above current price */
  nearestUnfilledBearish: VolumeImbalance | null;
  /** Most recent close */
  currentPrice: number | null;
  /** Interpretation string */
  interpretation: string;
}

/**
 * Calculate ICT Volume Imbalances.
 *
 * @param candles - OHLCV candle array (numeric open/high/low/close/volume)
 * @param opts.lookback - Only report VIs from the last N bars (default: all)
 * @returns VolumeImbalanceResult
 */
export function calculateVolumeImbalance(
  candles: Candle[],
  opts?: { lookback?: number }
): VolumeImbalanceResult {
  if (candles.length < 2) {
    return {
      imbalances: [],
      bullishImbalances: [],
      bearishImbalances: [],
      nearestUnfilledBullish: null,
      nearestUnfilledBearish: null,
      currentPrice: null,
      interpretation: "Insufficient data for volume imbalance",
    };
  }

  const lastBar = candles.length - 1;
  const currentPrice = candles[lastBar]!.close;

  const lookback = opts?.lookback;
  const startBar =
    lookback != null && lookback > 0 ? Math.max(1, candles.length - lookback) : 1;

  const allImbalances: VolumeImbalance[] = [];

  for (let i = startBar; i < candles.length; i++) {
    const prev = candles[i - 1]!;
    const cur = candles[i]!;

    // Bullish VI: body gap up (open[i] > close[i-1]) with overlapping ranges.
    if (cur.open > prev.close && cur.low <= prev.high) {
      allImbalances.push({
        type: "bullish",
        top: parseFloat(cur.open.toFixed(8)),
        bottom: parseFloat(prev.close.toFixed(8)),
        barIndex: i,
        filled: false,
      });
    }

    // Bearish VI: body gap down (open[i] < close[i-1]) with overlapping ranges.
    if (cur.open < prev.close && cur.high >= prev.low) {
      allImbalances.push({
        type: "bearish",
        top: parseFloat(prev.close.toFixed(8)),
        bottom: parseFloat(cur.open.toFixed(8)),
        barIndex: i,
        filled: false,
      });
    }
  }

  // Fill check: price returned into the zone on a later bar.
  for (const vi of allImbalances) {
    for (let j = vi.barIndex + 1; j < candles.length; j++) {
      const c = candles[j]!;
      if (vi.type === "bullish" && c.low <= vi.bottom) {
        vi.filled = true;
        break;
      }
      if (vi.type === "bearish" && c.high >= vi.top) {
        vi.filled = true;
        break;
      }
    }
  }

  const bullishImbalances = allImbalances.filter((v) => v.type === "bullish");
  const bearishImbalances = allImbalances.filter((v) => v.type === "bearish");

  // Nearest unfilled bullish VI sitting below current price.
  let nearestUnfilledBullish: VolumeImbalance | null = null;
  let minBullDist = Infinity;
  for (const v of bullishImbalances) {
    if (v.filled) continue;
    const dist = currentPrice - v.top;
    if (dist >= 0 && dist < minBullDist) {
      minBullDist = dist;
      nearestUnfilledBullish = v;
    }
  }

  // Nearest unfilled bearish VI sitting above current price.
  let nearestUnfilledBearish: VolumeImbalance | null = null;
  let minBearDist = Infinity;
  for (const v of bearishImbalances) {
    if (v.filled) continue;
    const dist = v.bottom - currentPrice;
    if (dist >= 0 && dist < minBearDist) {
      minBearDist = dist;
      nearestUnfilledBearish = v;
    }
  }

  const interpretation = buildInterpretation(
    bullishImbalances,
    bearishImbalances,
    nearestUnfilledBullish,
    nearestUnfilledBearish
  );

  return {
    imbalances: allImbalances,
    bullishImbalances,
    bearishImbalances,
    nearestUnfilledBullish,
    nearestUnfilledBearish,
    currentPrice: parseFloat(currentPrice.toFixed(8)),
    interpretation,
  };
}

function buildInterpretation(
  bullish: VolumeImbalance[],
  bearish: VolumeImbalance[],
  nearBull: VolumeImbalance | null,
  nearBear: VolumeImbalance | null
): string {
  const bullUnfilled = bullish.filter((v) => !v.filled).length;
  const bearUnfilled = bearish.filter((v) => !v.filled).length;

  let msg = `Volume Imbalance: ${bullUnfilled} bullish, ${bearUnfilled} bearish unfilled. `;

  if (nearBull) {
    msg += `Nearest unfilled bullish VI: ${nearBull.bottom}-${nearBull.top}. `;
  }
  if (nearBear) {
    msg += `Nearest unfilled bearish VI: ${nearBear.bottom}-${nearBear.top}. `;
  }

  if (bullUnfilled === 0 && bearUnfilled === 0) {
    msg += "No unfilled body-gap imbalances; price tends to rebalance these zones.";
  }

  return msg.trimEnd();
}
