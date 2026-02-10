/**
 * Three Mountains & Rivers (San Zan / San Sen)
 * Japanese triple top (Three Mountains) and triple bottom (Three Rivers) detection.
 * Three Mountains = bearish reversal pattern, Three Rivers = bullish reversal.
 *
 * Three Mountains & Rivers implementation.
 */

import type { Candle } from "./types.ts";

export interface TMRPattern {
  /** Pattern type */
  type: "three_mountains" | "three_rivers";
  /** Three peak/trough prices */
  prices: [number, number, number];
  /** Three peak/trough bar indices */
  bars: [number, number, number];
  /** Average level */
  averageLevel: number;
  /** How well peaks/troughs align (0-100, higher = better alignment) */
  alignment: number;
}

export interface TMRResult {
  /** Whether a pattern was detected */
  patternFound: boolean;
  /** Detected pattern (most recent) */
  pattern: TMRPattern | null;
  /** Signal */
  signal: "bearish_reversal" | "bullish_reversal" | "none";
  /** Confirmation: price broke below/above the pattern */
  confirmed: boolean;
  /** Interpretation string */
  interpretation: string;
}

/**
 * Find local peaks (highs higher than ±order neighbors)
 */
function findPeaks(values: number[], order: number): { price: number; bar: number }[] {
  const peaks: { price: number; bar: number }[] = [];
  for (let i = order; i < values.length - order; i++) {
    let isPeak = true;
    for (let j = i - order; j <= i + order; j++) {
      if (j !== i && values[j]! >= values[i]!) {
        isPeak = false;
        break;
      }
    }
    if (isPeak) peaks.push({ price: values[i]!, bar: i });
  }
  return peaks;
}

/**
 * Find local troughs (lows lower than ±order neighbors)
 */
function findTroughs(values: number[], order: number): { price: number; bar: number }[] {
  const troughs: { price: number; bar: number }[] = [];
  for (let i = order; i < values.length - order; i++) {
    let isTrough = true;
    for (let j = i - order; j <= i + order; j++) {
      if (j !== i && values[j]! <= values[i]!) {
        isTrough = false;
        break;
      }
    }
    if (isTrough) troughs.push({ price: values[i]!, bar: i });
  }
  return troughs;
}

/**
 * Calculate Three Mountains & Rivers.
 *
 * @param candles - OHLCV candle array
 * @param order - Neighborhood size for peak/trough detection (default 20)
 * @param tolerance - Max deviation from average for valid pattern (default 0.02 = 2%)
 * @param minSpacing - Minimum bars between peaks/troughs (default 15)
 * @param maxSpacing - Maximum bars between peaks/troughs (default 60)
 * @param confirmPct - Price must break N% beyond pattern for confirmation (default 0.02)
 * @returns TMRResult
 */
export function calculateThreeMountainsRivers(
  candles: Candle[],
  order: number = 20,
  tolerance: number = 0.02,
  minSpacing: number = 15,
  maxSpacing: number = 60,
  confirmPct: number = 0.02
): TMRResult {
  if (candles.length < order * 2 + minSpacing * 3) {
    return {
      patternFound: false,
      pattern: null,
      signal: "none",
      confirmed: false,
      interpretation: "Insufficient data for Three Mountains/Rivers detection",
    };
  }

  const highs = candles.map(c => c.high);
  const lows = candles.map(c => c.low);
  const currentPrice = candles[candles.length - 1]!.close;

  const peaks = findPeaks(highs, order);
  const troughs = findTroughs(lows, order);

  let bestPattern: TMRPattern | null = null;

  // Check for Three Mountains (triple top — bearish)
  if (peaks.length >= 3) {
    // Try last 3 peaks
    for (let start = Math.max(0, peaks.length - 6); start <= peaks.length - 3; start++) {
      const p1 = peaks[start]!;
      const p2 = peaks[start + 1]!;
      const p3 = peaks[start + 2]!;

      // Check spacing
      const spacing12 = p2.bar - p1.bar;
      const spacing23 = p3.bar - p2.bar;
      if (spacing12 < minSpacing || spacing12 > maxSpacing) continue;
      if (spacing23 < minSpacing || spacing23 > maxSpacing) continue;

      // Check alignment (all within tolerance of average)
      const avg = (p1.price + p2.price + p3.price) / 3;
      const dev1 = Math.abs(p1.price - avg) / avg;
      const dev2 = Math.abs(p2.price - avg) / avg;
      const dev3 = Math.abs(p3.price - avg) / avg;

      if (dev1 <= tolerance && dev2 <= tolerance && dev3 <= tolerance) {
        const maxDev = Math.max(dev1, dev2, dev3);
        const alignment = parseFloat(((1 - maxDev / tolerance) * 100).toFixed(1));

        bestPattern = {
          type: "three_mountains",
          prices: [parseFloat(p1.price.toFixed(4)), parseFloat(p2.price.toFixed(4)), parseFloat(p3.price.toFixed(4))],
          bars: [p1.bar, p2.bar, p3.bar],
          averageLevel: parseFloat(avg.toFixed(4)),
          alignment,
        };
      }
    }
  }

  // Check for Three Rivers (triple bottom — bullish)
  if (!bestPattern && troughs.length >= 3) {
    for (let start = Math.max(0, troughs.length - 6); start <= troughs.length - 3; start++) {
      const t1 = troughs[start]!;
      const t2 = troughs[start + 1]!;
      const t3 = troughs[start + 2]!;

      const spacing12 = t2.bar - t1.bar;
      const spacing23 = t3.bar - t2.bar;
      if (spacing12 < minSpacing || spacing12 > maxSpacing) continue;
      if (spacing23 < minSpacing || spacing23 > maxSpacing) continue;

      const avg = (t1.price + t2.price + t3.price) / 3;
      const dev1 = Math.abs(t1.price - avg) / avg;
      const dev2 = Math.abs(t2.price - avg) / avg;
      const dev3 = Math.abs(t3.price - avg) / avg;

      if (dev1 <= tolerance && dev2 <= tolerance && dev3 <= tolerance) {
        const maxDev = Math.max(dev1, dev2, dev3);
        const alignment = parseFloat(((1 - maxDev / tolerance) * 100).toFixed(1));

        bestPattern = {
          type: "three_rivers",
          prices: [parseFloat(t1.price.toFixed(4)), parseFloat(t2.price.toFixed(4)), parseFloat(t3.price.toFixed(4))],
          bars: [t1.bar, t2.bar, t3.bar],
          averageLevel: parseFloat(avg.toFixed(4)),
          alignment,
        };
      }
    }
  }

  if (!bestPattern) {
    return {
      patternFound: false,
      pattern: null,
      signal: "none",
      confirmed: false,
      interpretation: "No Three Mountains or Three Rivers pattern found",
    };
  }

  // Confirmation
  let confirmed = false;
  let signal: "bearish_reversal" | "bullish_reversal" | "none" = "none";

  if (bestPattern.type === "three_mountains") {
    confirmed = currentPrice < bestPattern.averageLevel * (1 - confirmPct);
    signal = confirmed ? "bearish_reversal" : "none";
  } else {
    confirmed = currentPrice > bestPattern.averageLevel * (1 + confirmPct);
    signal = confirmed ? "bullish_reversal" : "none";
  }

  const interpretation = buildTMRInterpretation(bestPattern, confirmed, signal, currentPrice);

  return {
    patternFound: true,
    pattern: bestPattern,
    signal,
    confirmed,
    interpretation,
  };
}

function buildTMRInterpretation(
  pattern: TMRPattern, confirmed: boolean, signal: string, price: number
): string {
  const name = pattern.type === "three_mountains" ? "THREE MOUNTAINS (Triple Top)" : "THREE RIVERS (Triple Bottom)";
  let msg = `${name} detected at ${pattern.averageLevel.toFixed(2)} (alignment: ${pattern.alignment}%). `;
  msg += `Peaks/Troughs: ${pattern.prices.map(p => p.toFixed(2)).join(", ")}. `;

  if (confirmed) {
    msg += pattern.type === "three_mountains"
      ? "CONFIRMED — price broke below pattern. Bearish reversal signal."
      : "CONFIRMED — price broke above pattern. Bullish reversal signal.";
  } else {
    msg += pattern.type === "three_mountains"
      ? "Not yet confirmed — watching for breakdown below neckline."
      : "Not yet confirmed — watching for breakout above neckline.";
  }

  return msg;
}
