/**
 * Supertrend Channel Envelope
 *
 * Builds a dynamic channel on top of the Supertrend trend state. While the
 * Supertrend direction holds (no flip), the channel tracks the running extremes
 * of price since the last flip:
 *   maxChannel = running max(high) since last flip
 *   minChannel = running min(low)  since last flip
 * On a direction flip, the channel resets/clamps to the Supertrend pivot value
 * at the flip bar (both bands collapse to the supertrend line, then re-expand
 * as the new leg develops).
 *
 * supertrendAvg = (maxChannel + minChannel) / 2 is the channel midline — a
 * dynamic mean-reversion target inside the prevailing trend leg.
 *
 * Reuses calculateSupertrend (atrPeriod default 10, multiplier 3) for the
 * trend line + per-bar direction. Bars before ATR is available are null.
 */

import type { Candle } from "./types.ts";
import { calculateSupertrend } from "./supertrend.ts";

export interface SupertrendChannelResult {
  /** Upper channel band — running max(high) since last flip (null in warmup) */
  maxChannel: (number | null)[];
  /** Lower channel band — running min(low) since last flip (null in warmup) */
  minChannel: (number | null)[];
  /** Channel midline = (maxChannel + minChannel) / 2 (null in warmup) */
  supertrendAvg: (number | null)[];
  /** Direction per bar: 1 = bullish, -1 = bearish, 0 = warmup */
  direction: number[];
  /** Underlying supertrend line per bar (null in warmup) */
  supertrend: (number | null)[];
  current: {
    maxChannel: number | null;
    minChannel: number | null;
    supertrendAvg: number | null;
    direction: 1 | -1;
    trendChange: boolean;
  };
  interpretation: string;
}

/**
 * Calculate the Supertrend Channel Envelope.
 *
 * @param candles - OHLCV candle array
 * @param params.atrPeriod - ATR period for Supertrend (default 10)
 * @param params.multiplier - ATR multiplier for Supertrend (default 3)
 * @returns SupertrendChannelResult
 */
export function calculateSupertrendChannel(
  candles: Candle[],
  params?: { atrPeriod?: number; multiplier?: number }
): SupertrendChannelResult {
  const atrPeriod = params?.atrPeriod ?? 10;
  const multiplier = params?.multiplier ?? 3;
  const n = candles.length;

  const empty = (): SupertrendChannelResult => ({
    maxChannel: candles.map(() => null),
    minChannel: candles.map(() => null),
    supertrendAvg: candles.map(() => null),
    direction: candles.map(() => 0),
    supertrend: candles.map(() => null),
    current: {
      maxChannel: null,
      minChannel: null,
      supertrendAvg: null,
      direction: 1,
      trendChange: false,
    },
    interpretation: "Insufficient data for Supertrend Channel calculation",
  });

  if (n < atrPeriod + 2) {
    return empty();
  }

  const st = calculateSupertrend(candles, atrPeriod, multiplier);
  // calculateSupertrend returns [] when under-fed; guard regardless.
  if (st.values.length !== n || st.direction.length !== n) {
    return empty();
  }

  const maxChannel: (number | null)[] = new Array(n).fill(null);
  const minChannel: (number | null)[] = new Array(n).fill(null);
  const supertrendAvg: (number | null)[] = new Array(n).fill(null);
  const direction: number[] = st.direction.slice();
  const supertrend: (number | null)[] = new Array(n).fill(null);

  let runningMax: number | null = null;
  let runningMin: number | null = null;
  let prevDir = 0;

  for (let i = 0; i < n; i++) {
    const dir = direction[i]!;
    if (dir === 0) {
      // Warmup bar — supertrend not yet computed.
      prevDir = dir;
      continue;
    }

    const stLine = st.values[i]!;
    supertrend[i] = parseFloat(stLine.toFixed(8));

    const high = candles[i]!.high;
    const low = candles[i]!.low;

    const flipped = prevDir !== 0 && dir !== prevDir;
    const firstActive = prevDir === 0;

    if (flipped || firstActive) {
      // On a flip (or first active bar) clamp the channel to the supertrend
      // pivot, then seed with this bar's extremes so the band brackets price.
      runningMax = Math.max(stLine, high);
      runningMin = Math.min(stLine, low);
    } else {
      runningMax = Math.max(runningMax!, high);
      runningMin = Math.min(runningMin!, low);
    }

    maxChannel[i] = parseFloat(runningMax.toFixed(8));
    minChannel[i] = parseFloat(runningMin.toFixed(8));
    supertrendAvg[i] = parseFloat(((runningMax + runningMin) / 2).toFixed(8));

    prevDir = dir;
  }

  const curMax = maxChannel[n - 1] ?? null;
  const curMin = minChannel[n - 1] ?? null;
  const curAvg = supertrendAvg[n - 1] ?? null;
  const curDir = (direction[n - 1] === -1 ? -1 : 1) as 1 | -1;
  const prevActiveDir = direction[n - 2] ?? 0;
  const trendChange =
    direction[n - 1] !== 0 && prevActiveDir !== 0 && direction[n - 1] !== prevActiveDir;

  const interpretation = buildInterpretation(
    candles[n - 1]!.close,
    curMax,
    curMin,
    curAvg,
    curDir,
    trendChange
  );

  return {
    maxChannel,
    minChannel,
    supertrendAvg,
    direction,
    supertrend,
    current: {
      maxChannel: curMax,
      minChannel: curMin,
      supertrendAvg: curAvg,
      direction: curDir,
      trendChange,
    },
    interpretation,
  };
}

function buildInterpretation(
  close: number,
  max: number | null,
  min: number | null,
  avg: number | null,
  dir: 1 | -1,
  trendChange: boolean
): string {
  if (max == null || min == null || avg == null) {
    return "Insufficient data for Supertrend Channel.";
  }

  const trendStr = dir === 1 ? "BULLISH" : "BEARISH";
  let msg = `Supertrend Channel: ${trendStr}. Band [${min.toFixed(2)} … ${max.toFixed(2)}], midline ${avg.toFixed(2)}. `;

  if (trendChange) {
    msg += `TREND FLIP — channel reset to the supertrend pivot; new ${dir === 1 ? "up" : "down"} leg forming. `;
  }

  if (close >= avg) {
    msg += `Price ${close.toFixed(2)} sits in the upper half of the channel`;
    msg += dir === 1 ? " — momentum aligned with the uptrend." : " — bouncing within the downtrend.";
  } else {
    msg += `Price ${close.toFixed(2)} sits in the lower half of the channel`;
    msg += dir === 1 ? " — pullback toward midline support." : " — momentum aligned with the downtrend.";
  }

  return msg;
}
