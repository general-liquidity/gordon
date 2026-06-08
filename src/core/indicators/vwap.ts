/**
 * Volume Weighted Average Price (VWAP)
 * Essential for intraday trading - shows fair value based on volume
 */

import type { Candle } from "./types.ts";

export interface VWAPResult {
  values: (number | null)[];
  current: number | null;
  pricePosition: "above" | "below" | "at";
  deviation: number | null;  // How far price is from VWAP as percentage
  interpretation: string;
}

/**
 * Calculate VWAP (Volume Weighted Average Price)
 *
 * VWAP = Cumulative(Typical Price * Volume) / Cumulative(Volume)
 * where Typical Price = (High + Low + Close) / 3
 *
 * Signals:
 * - Price > VWAP: Bullish bias, buyers in control
 * - Price < VWAP: Bearish bias, sellers in control
 * - Price at VWAP: Fair value, potential support/resistance
 *
 * @param candles - Array of OHLCV candles
 * @param currentPrice - Current price for position calculation
 * @returns VWAP result with values and interpretation
 */
export function calculateVWAP(
  candles: Candle[],
  currentPrice?: number
): VWAPResult {
  if (candles.length < 1) {
    return {
      values: [],
      current: null,
      pricePosition: "at",
      deviation: null,
      interpretation: "Insufficient data for VWAP calculation",
    };
  }

  const vwapValues: (number | null)[] = [];
  let cumulativeTPV = 0;  // Cumulative Typical Price * Volume
  let cumulativeVolume = 0;

  for (const candle of candles) {
    // Typical Price = (High + Low + Close) / 3
    const typicalPrice = (candle.high + candle.low + candle.close) / 3;

    cumulativeTPV += typicalPrice * candle.volume;
    cumulativeVolume += candle.volume;

    if (cumulativeVolume > 0) {
      vwapValues.push(cumulativeTPV / cumulativeVolume);
    } else {
      vwapValues.push(null);
    }
  }

  const currentVWAP = vwapValues[vwapValues.length - 1] ?? null;
  const lastCandle = candles[candles.length - 1];
  const price = currentPrice ?? (lastCandle?.close ?? 0);

  // Determine price position relative to VWAP
  let pricePosition: "above" | "below" | "at" = "at";
  let deviation: number | null = null;

  if (currentVWAP !== null) {
    deviation = ((price - currentVWAP) / currentVWAP) * 100;

    if (Math.abs(deviation) < 0.1) {
      pricePosition = "at";
    } else if (price > currentVWAP) {
      pricePosition = "above";
    } else {
      pricePosition = "below";
    }
  }

  // Generate interpretation
  let interpretation = "";
  if (currentVWAP === null) {
    interpretation = "Insufficient data for VWAP";
  } else if (pricePosition === "above") {
    if (deviation! > 2) {
      interpretation = `Price ${deviation!.toFixed(2)}% above VWAP - extended, potential pullback to VWAP`;
    } else {
      interpretation = `Price ${deviation!.toFixed(2)}% above VWAP - bullish bias, buyers in control`;
    }
  } else if (pricePosition === "below") {
    if (deviation! < -2) {
      interpretation = `Price ${Math.abs(deviation!).toFixed(2)}% below VWAP - oversold, potential bounce to VWAP`;
    } else {
      interpretation = `Price ${Math.abs(deviation!).toFixed(2)}% below VWAP - bearish bias, sellers in control`;
    }
  } else {
    interpretation = "Price at VWAP - fair value, watch for direction";
  }

  return {
    values: vwapValues,
    current: currentVWAP,
    pricePosition,
    deviation,
    interpretation,
  };
}

export interface RollingVWAPResult {
  /** Rolling VWAP aligned 1:1 with candles; null for the first window-1 bars. */
  values: (number | null)[];
  current: number | null;
  pricePosition: "above" | "below" | "at";
  /** Price distance from current rolling VWAP, as a percentage. */
  deviation: number | null;
  /** Current rolling VWAP + stdDevMultiplier·σ over the trailing window (VAH). */
  upperBand: number | null;
  /** Current rolling VWAP − stdDevMultiplier·σ over the trailing window (VAL). */
  lowerBand: number | null;
  window: number;
  interpretation: string;
}

/**
 * Rolling (windowed) VWAP — a continuous VWAP over the trailing `window` bars.
 *
 * Unlike `calculateVWAP` (which accumulates from the first bar and never drops
 * data), this drops bars older than the window, so it acts as a moving fair-value
 * line: a higher-timeframe mean-reversion anchor (e.g. 30/90-bar) rather than a
 * session reset. Optional ±σ bands over the same window frame the value area
 * (upper ≈ VAH, lower ≈ VAL).
 *
 * RVWAP[i] = Σ_{j=i-window+1..i}(typicalPrice[j]·volume[j]) / Σ volume[j],
 * where typicalPrice = (high + low + close) / 3.
 *
 * @param candles - OHLCV candles, oldest-first
 * @param window - trailing window length in bars (default 20)
 * @param stdDevMultiplier - σ-band width; 0 disables bands (default 1)
 * @param currentPrice - price for position calc (defaults to last close)
 */
export function calculateRollingVWAP(
  candles: Candle[],
  window: number = 20,
  stdDevMultiplier: number = 1,
  currentPrice?: number,
): RollingVWAPResult {
  const w = Math.max(1, Math.floor(window));
  const n = candles.length;
  if (n < 1) {
    return {
      values: [],
      current: null,
      pricePosition: "at",
      deviation: null,
      upperBand: null,
      lowerBand: null,
      window: w,
      interpretation: "Insufficient data for rolling VWAP",
    };
  }

  const tp = candles.map((c) => (c.high + c.low + c.close) / 3);
  const vol = candles.map((c) => c.volume);

  const values: (number | null)[] = [];
  let sumTPV = 0;
  let sumVol = 0;
  for (let i = 0; i < n; i++) {
    sumTPV += tp[i]! * vol[i]!;
    sumVol += vol[i]!;
    if (i >= w) {
      sumTPV -= tp[i - w]! * vol[i - w]!;
      sumVol -= vol[i - w]!;
    }
    values.push(i >= w - 1 && sumVol > 0 ? sumTPV / sumVol : null);
  }

  const current = values[n - 1] ?? null;
  const lastCandle = candles[n - 1];
  const price = currentPrice ?? (lastCandle?.close ?? 0);

  let pricePosition: "above" | "below" | "at" = "at";
  let deviation: number | null = null;
  let upperBand: number | null = null;
  let lowerBand: number | null = null;

  if (current !== null) {
    deviation = ((price - current) / current) * 100;
    if (Math.abs(deviation) < 0.1) pricePosition = "at";
    else pricePosition = price > current ? "above" : "below";

    if (stdDevMultiplier > 0 && w >= 2) {
      const lo = Math.max(0, n - w);
      let sumSq = 0;
      let count = 0;
      for (let j = lo; j < n; j++) {
        const d = tp[j]! - current;
        sumSq += d * d;
        count++;
      }
      if (count > 0) {
        const stdDev = Math.sqrt(sumSq / count);
        upperBand = current + stdDev * stdDevMultiplier;
        lowerBand = current - stdDev * stdDevMultiplier;
      }
    }
  }

  let interpretation: string;
  if (current === null) {
    interpretation = `Insufficient data — need ${w} bars for rolling VWAP, got ${n}`;
  } else if (pricePosition === "above") {
    interpretation = `Price ${deviation!.toFixed(2)}% above ${w}-bar rolling VWAP — bullish bias`;
  } else if (pricePosition === "below") {
    interpretation = `Price ${Math.abs(deviation!).toFixed(2)}% below ${w}-bar rolling VWAP — bearish bias`;
  } else {
    interpretation = `Price at ${w}-bar rolling VWAP — fair value, watch for direction`;
  }

  return { values, current, pricePosition, deviation, upperBand, lowerBand, window: w, interpretation };
}

export interface AnchoredVWAPResult {
  /** AVWAP aligned 1:1 with candles; null before the anchor bar. */
  values: (number | null)[];
  current: number | null;
  /** Resolved anchor bar index. */
  anchorIndex: number;
  pricePosition: "above" | "below" | "at";
  deviation: number | null;
  /** Current AVWAP ± stdDevMultiplier·σ (volume-weighted) since the anchor. */
  upperBand: number | null;
  lowerBand: number | null;
  /** AVWAP direction since a few bars back — rising AVWAP acts as support, falling as resistance. */
  slope: "rising" | "falling" | "flat";
  /** Reclaim/reject of the AVWAP line on the last bar, else support/resistance/neutral. */
  signal: "reclaim" | "reject" | "support" | "resistance" | "neutral";
  interpretation: string;
}

/**
 * Anchored VWAP (Brian Shannon) — VWAP accumulated from a fixed EVENT anchor
 * (a swing low, gap, or cycle top) with NO session reset and NO trailing window.
 *
 * Distinct from `calculateVWAP` (anchors at bar 0) and `calculateRollingVWAP`
 * (drops old bars). The anchor is the point traders agree to measure cost-basis
 * from, so a rising AVWAP off a swing low acts as dynamic support and a falling
 * AVWAP off a high as resistance; reclaim/reject of the line is the trade trigger.
 *
 * AVWAP[i] = Σ_{j=anchor..i}(tp[j]·vol[j]) / Σ vol[j],  tp = (high+low+close)/3,
 * for i ≥ anchor (null before). σ bands use the volume-weighted std of tp about
 * the running AVWAP.
 *
 * @param candles - OHLCV, oldest-first
 * @param anchor - bar index, or "low"/"high" (auto-anchor to the lowest-low /
 *   highest-high bar), or "first" (= bar 0). Default "low".
 * @param stdDevMultiplier - σ-band width; 0 disables bands (default 1)
 * @param currentPrice - price for position calc (defaults to last close)
 */
export function calculateAnchoredVWAP(
  candles: Candle[],
  anchor: number | "low" | "high" | "first" = "low",
  stdDevMultiplier: number = 1,
  currentPrice?: number,
): AnchoredVWAPResult {
  const n = candles.length;
  const empty: AnchoredVWAPResult = {
    values: [],
    current: null,
    anchorIndex: 0,
    pricePosition: "at",
    deviation: null,
    upperBand: null,
    lowerBand: null,
    slope: "flat",
    signal: "neutral",
    interpretation: "Insufficient data for anchored VWAP",
  };
  if (n < 1) return empty;

  // Resolve the anchor bar.
  let anchorIndex: number;
  if (typeof anchor === "number") {
    anchorIndex = Math.max(0, Math.min(n - 1, Math.floor(anchor)));
  } else if (anchor === "first") {
    anchorIndex = 0;
  } else {
    anchorIndex = 0;
    for (let i = 1; i < n; i++) {
      if (anchor === "low" && candles[i]!.low < candles[anchorIndex]!.low) anchorIndex = i;
      if (anchor === "high" && candles[i]!.high > candles[anchorIndex]!.high) anchorIndex = i;
    }
  }

  const tp = candles.map((c) => (c.high + c.low + c.close) / 3);
  const vol = candles.map((c) => c.volume);

  const values: (number | null)[] = new Array(n).fill(null);
  let sumTPV = 0;
  let sumVol = 0;
  for (let i = anchorIndex; i < n; i++) {
    sumTPV += tp[i]! * vol[i]!;
    sumVol += vol[i]!;
    values[i] = sumVol > 0 ? sumTPV / sumVol : null;
  }

  const current = values[n - 1] ?? null;
  const price = currentPrice ?? (candles[n - 1]?.close ?? 0);
  if (current === null) return { ...empty, values, anchorIndex };

  const deviation = ((price - current) / current) * 100;
  const pricePosition: "above" | "below" | "at" =
    Math.abs(deviation) < 0.1 ? "at" : price > current ? "above" : "below";

  // Volume-weighted σ of typical price about the running AVWAP, since the anchor.
  let upperBand: number | null = null;
  let lowerBand: number | null = null;
  if (stdDevMultiplier > 0 && n - anchorIndex >= 2) {
    let wSumSq = 0;
    let wSum = 0;
    for (let i = anchorIndex; i < n; i++) {
      const d = tp[i]! - values[i]!;
      wSumSq += vol[i]! * d * d;
      wSum += vol[i]!;
    }
    if (wSum > 0) {
      const sigma = Math.sqrt(wSumSq / wSum);
      upperBand = current + sigma * stdDevMultiplier;
      lowerBand = current - sigma * stdDevMultiplier;
    }
  }

  // Slope over the lesser of 5 bars / bars-since-anchor.
  const back = Math.min(5, n - 1 - anchorIndex);
  let slope: "rising" | "falling" | "flat" = "flat";
  if (back >= 1) {
    const prev = values[n - 1 - back]!;
    const chg = (current - prev) / Math.abs(prev || 1);
    slope = chg > 0.0005 ? "rising" : chg < -0.0005 ? "falling" : "flat";
  }

  // Reclaim/reject on the last bar; else support/resistance from slope + position.
  let signal: AnchoredVWAPResult["signal"] = "neutral";
  if (n - anchorIndex >= 2) {
    const prevClose = candles[n - 2]!.close;
    const prevVwap = values[n - 2]!;
    const wasBelow = prevVwap !== null && prevClose < prevVwap;
    const wasAbove = prevVwap !== null && prevClose > prevVwap;
    if (wasBelow && price > current) signal = "reclaim";
    else if (wasAbove && price < current) signal = "reject";
    else if (pricePosition === "above" && slope === "rising") signal = "support";
    else if (pricePosition === "below" && slope === "falling") signal = "resistance";
  }

  const anchorDesc =
    anchor === "low" ? "swing-low" : anchor === "high" ? "swing-high" : anchor === "first" ? "start" : `bar ${anchorIndex}`;
  const interpretation =
    signal === "reclaim"
      ? `price reclaimed the ${anchorDesc} AVWAP from below — bullish trigger`
      : signal === "reject"
        ? `price rejected the ${anchorDesc} AVWAP from above — bearish trigger`
        : signal === "support"
          ? `price ${deviation.toFixed(2)}% above a rising ${anchorDesc} AVWAP — dynamic support`
          : signal === "resistance"
            ? `price ${Math.abs(deviation).toFixed(2)}% below a falling ${anchorDesc} AVWAP — dynamic resistance`
            : `price ${deviation.toFixed(2)}% vs ${anchorDesc} AVWAP (${slope})`;

  return { values, current, anchorIndex, pricePosition, deviation, upperBand, lowerBand, slope, signal, interpretation };
}

/**
 * Calculate VWAP with standard deviation bands
 * Similar to Bollinger Bands but anchored to VWAP
 */
export function calculateVWAPBands(
  candles: Candle[],
  stdDevMultiplier: number = 2,
  currentPrice?: number
): {
  vwap: VWAPResult;
  upperBand: number | null;
  lowerBand: number | null;
  bandwidth: number | null;
} {
  const vwap = calculateVWAP(candles, currentPrice);

  if (vwap.current === null || candles.length < 2) {
    return {
      vwap,
      upperBand: null,
      lowerBand: null,
      bandwidth: null,
    };
  }

  // Calculate standard deviation of typical prices from VWAP
  let sumSquaredDev = 0;
  let cumulativeTPV = 0;
  let cumulativeVolume = 0;

  for (const candle of candles) {
    const typicalPrice = (candle.high + candle.low + candle.close) / 3;
    cumulativeTPV += typicalPrice * candle.volume;
    cumulativeVolume += candle.volume;

    if (cumulativeVolume > 0) {
      const vwapAtPoint = cumulativeTPV / cumulativeVolume;
      sumSquaredDev += Math.pow(typicalPrice - vwapAtPoint, 2);
    }
  }

  const variance = sumSquaredDev / candles.length;
  const stdDev = Math.sqrt(variance);

  const upperBand = vwap.current + (stdDev * stdDevMultiplier);
  const lowerBand = vwap.current - (stdDev * stdDevMultiplier);
  const bandwidth = ((upperBand - lowerBand) / vwap.current) * 100;

  return {
    vwap,
    upperBand,
    lowerBand,
    bandwidth,
  };
}
