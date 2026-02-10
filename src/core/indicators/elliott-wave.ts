/**
 * Elliott Wave Detection
 * Zigzag algorithm for 5-wave impulse pattern detection.
 * Validates waves using Elliott rules and Fibonacci ratios.
 *
 * Based on Moon Dev's Elliott Wave Impulse implementation.
 */

import type { Candle } from "./types.ts";

export interface ZigzagPoint {
  /** Price at the zigzag point */
  price: number;
  /** Bar index */
  bar: number;
  /** Type: high or low */
  type: "high" | "low";
}

export interface WaveLabel {
  /** Wave number (1-5) */
  wave: number;
  /** Start price */
  startPrice: number;
  /** End price */
  endPrice: number;
  /** Start bar */
  startBar: number;
  /** End bar */
  endBar: number;
  /** Wave direction: up or down */
  direction: "up" | "down";
  /** Fibonacci retracement/extension ratio (if applicable) */
  fibRatio: number | null;
}

export interface ElliottWaveResult {
  /** Detected zigzag points */
  zigzagPoints: ZigzagPoint[];
  /** Whether a valid 5-wave impulse pattern was found */
  patternFound: boolean;
  /** Wave labels (1-5) if pattern found */
  waves: WaveLabel[];
  /** Current wave count (which wave are we in) */
  currentWave: number;
  /** Pattern direction: bullish (impulse up) or bearish (impulse down) */
  patternDirection: "bullish" | "bearish" | "none";
  /** How well the pattern matches Elliott rules (0-100) */
  patternScore: number;
  /** Whether Fibonacci ratios validate the pattern */
  fibValid: boolean;
  /** Projected Wave 5 target (if in wave 4/5) */
  wave5Target: number | null;
  /** Interpretation string */
  interpretation: string;
}

/**
 * Build zigzag from candles using percentage reversal threshold.
 */
function buildZigzag(candles: Candle[], reversalPct: number): ZigzagPoint[] {
  if (candles.length < 3) return [];

  const points: ZigzagPoint[] = [];
  let direction = 0; // 1 = looking for high, -1 = looking for low
  let lastHigh = candles[0]!.high;
  let lastLow = candles[0]!.low;
  let lastHighBar = 0;
  let lastLowBar = 0;

  for (let i = 1; i < candles.length; i++) {
    const high = candles[i]!.high;
    const low = candles[i]!.low;

    if (direction === 0) {
      // Initialize direction
      if (high > lastHigh * (1 + reversalPct)) {
        direction = 1;
        points.push({ price: lastLow, bar: lastLowBar, type: "low" });
        lastHigh = high;
        lastHighBar = i;
      } else if (low < lastLow * (1 - reversalPct)) {
        direction = -1;
        points.push({ price: lastHigh, bar: lastHighBar, type: "high" });
        lastLow = low;
        lastLowBar = i;
      }
      if (high > lastHigh) {
        lastHigh = high;
        lastHighBar = i;
      }
      if (low < lastLow) {
        lastLow = low;
        lastLowBar = i;
      }
    } else if (direction === 1) {
      // Trending up, looking for higher high
      if (high > lastHigh) {
        lastHigh = high;
        lastHighBar = i;
      }
      if (low < lastHigh * (1 - reversalPct)) {
        // Reversal down
        points.push({ price: lastHigh, bar: lastHighBar, type: "high" });
        direction = -1;
        lastLow = low;
        lastLowBar = i;
      }
    } else {
      // Trending down, looking for lower low
      if (low < lastLow) {
        lastLow = low;
        lastLowBar = i;
      }
      if (high > lastLow * (1 + reversalPct)) {
        // Reversal up
        points.push({ price: lastLow, bar: lastLowBar, type: "low" });
        direction = 1;
        lastHigh = high;
        lastHighBar = i;
      }
    }
  }

  // Add final point
  if (direction === 1) {
    points.push({ price: lastHigh, bar: lastHighBar, type: "high" });
  } else if (direction === -1) {
    points.push({ price: lastLow, bar: lastLowBar, type: "low" });
  }

  return points;
}

/**
 * Check Elliott Wave rules for a bullish 5-wave impulse:
 * - Wave 2 retraces < 100% of Wave 1
 * - Wave 3 is not the shortest impulse wave (1, 3, 5)
 * - Wave 4 does not overlap Wave 1 end price
 */
function checkElliottRules(pts: ZigzagPoint[], direction: "bullish" | "bearish"): { valid: boolean; score: number } {
  // For bullish: points alternate low-high-low-high-low-high (6 points = 5 waves)
  // p0=low, p1=high (W1 end), p2=low (W2 end), p3=high (W3 end), p4=low (W4 end), p5=high (W5 end)

  if (pts.length < 6) return { valid: false, score: 0 };

  const p = pts.map(pt => pt.price);
  let score = 0;

  if (direction === "bullish") {
    // Wave 1: p0 → p1 (up)
    const wave1 = p[1]! - p[0]!;
    // Wave 2: p1 → p2 (down, retracement)
    const wave2Retrace = p[1]! - p[2]!;
    // Wave 3: p2 → p3 (up)
    const wave3 = p[3]! - p[2]!;
    // Wave 4: p3 → p4 (down, retracement)
    // Wave 5: p4 → p5 (up)
    const wave5 = p[5]! - p[4]!;

    // Rule 1: Wave 2 < 100% retrace of Wave 1
    if (wave1 > 0 && wave2Retrace < wave1) {
      score += 25;
    } else {
      return { valid: false, score: 0 };
    }

    // Rule 2: Wave 3 is not the shortest of 1, 3, 5
    if (wave3 >= wave1 || wave3 >= wave5) {
      score += 25;
    } else {
      return { valid: false, score: 0 };
    }

    // Rule 3: Wave 4 does not overlap Wave 1 territory
    if (p[4]! > p[1]!) {
      score += 25;
    } else {
      // Soft fail — still possible but weaker pattern
      score += 5;
    }

    // Rule 4: Overall impulse direction is up
    if (p[5]! > p[0]!) {
      score += 15;
    }

    // Bonus: Wave 3 is longest
    if (wave3 > wave1 && wave3 > wave5) {
      score += 10;
    }
  } else {
    // Bearish: p0=high, p1=low (W1 end), p2=high (W2 end), p3=low (W3 end), p4=high (W4 end), p5=low (W5 end)
    const wave1 = p[0]! - p[1]!;
    const wave2Retrace = p[2]! - p[1]!;
    const wave3 = p[2]! - p[3]!;
    const wave5 = p[4]! - p[5]!;

    if (wave1 > 0 && wave2Retrace < wave1) {
      score += 25;
    } else {
      return { valid: false, score: 0 };
    }

    if (wave3 >= wave1 || wave3 >= wave5) {
      score += 25;
    } else {
      return { valid: false, score: 0 };
    }

    if (p[4]! < p[1]!) {
      score += 25;
    } else {
      score += 5;
    }

    if (p[5]! < p[0]!) {
      score += 15;
    }

    if (wave3 > wave1 && wave3 > wave5) {
      score += 10;
    }
  }

  return { valid: score >= 50, score: Math.min(100, score) };
}

/**
 * Validate Fibonacci ratios in the wave structure.
 */
function checkFibRatios(pts: ZigzagPoint[], direction: "bullish" | "bearish"): { valid: boolean; ratios: (number | null)[] } {
  if (pts.length < 6) return { valid: false, ratios: [] };

  const p = pts.map(pt => pt.price);
  const ratios: (number | null)[] = [null]; // Wave 1 has no ratio

  if (direction === "bullish") {
    const wave1 = p[1]! - p[0]!;
    const wave2Retrace = p[1]! - p[2]!;
    const wave3 = p[3]! - p[2]!;
    const wave4Retrace = p[3]! - p[4]!;
    const wave5 = p[5]! - p[4]!;

    // Wave 2: typically 50-78.6% retrace of Wave 1
    const w2Ratio = wave1 > 0 ? wave2Retrace / wave1 : 0;
    ratios.push(parseFloat(w2Ratio.toFixed(3)));

    // Wave 3: typically 161.8% of Wave 1
    const w3Ratio = wave1 > 0 ? wave3 / wave1 : 0;
    ratios.push(parseFloat(w3Ratio.toFixed(3)));

    // Wave 4: typically 38.2% retrace of Wave 3
    const w4Ratio = wave3 > 0 ? wave4Retrace / wave3 : 0;
    ratios.push(parseFloat(w4Ratio.toFixed(3)));

    // Wave 5: typically 100% or 61.8% of Wave 1
    const w5Ratio = wave1 > 0 ? wave5 / wave1 : 0;
    ratios.push(parseFloat(w5Ratio.toFixed(3)));

    // Validate common Fibonacci ranges
    const w2Valid = w2Ratio >= 0.382 && w2Ratio <= 0.886;
    const w3Valid = w3Ratio >= 1.0 && w3Ratio <= 2.618;
    const w4Valid = w4Ratio >= 0.236 && w4Ratio <= 0.618;

    return { valid: w2Valid && w3Valid && w4Valid, ratios };
  } else {
    const wave1 = p[0]! - p[1]!;
    const wave2Retrace = p[2]! - p[1]!;
    const wave3 = p[2]! - p[3]!;
    const wave4Retrace = p[4]! - p[3]!;
    const wave5 = p[4]! - p[5]!;

    const w2Ratio = wave1 > 0 ? wave2Retrace / wave1 : 0;
    ratios.push(parseFloat(w2Ratio.toFixed(3)));
    const w3Ratio = wave1 > 0 ? wave3 / wave1 : 0;
    ratios.push(parseFloat(w3Ratio.toFixed(3)));
    const w4Ratio = wave3 > 0 ? wave4Retrace / wave3 : 0;
    ratios.push(parseFloat(w4Ratio.toFixed(3)));
    const w5Ratio = wave1 > 0 ? wave5 / wave1 : 0;
    ratios.push(parseFloat(w5Ratio.toFixed(3)));

    const w2Valid = w2Ratio >= 0.382 && w2Ratio <= 0.886;
    const w3Valid = w3Ratio >= 1.0 && w3Ratio <= 2.618;
    const w4Valid = w4Ratio >= 0.236 && w4Ratio <= 0.618;

    return { valid: w2Valid && w3Valid && w4Valid, ratios };
  }
}

/**
 * Calculate Elliott Wave detection.
 *
 * @param candles - OHLCV candle array
 * @param reversalPct - Zigzag reversal threshold as fraction (default 0.03 = 3%)
 * @returns ElliottWaveResult
 */
export function calculateElliottWave(
  candles: Candle[],
  reversalPct: number = 0.03
): ElliottWaveResult {
  const emptyResult: ElliottWaveResult = {
    zigzagPoints: [],
    patternFound: false,
    waves: [],
    currentWave: 0,
    patternDirection: "none",
    patternScore: 0,
    fibValid: false,
    wave5Target: null,
    interpretation: "Insufficient data for Elliott Wave detection",
  };

  if (candles.length < 30) return emptyResult;

  const zigzag = buildZigzag(candles, reversalPct);

  if (zigzag.length < 6) {
    return {
      ...emptyResult,
      zigzagPoints: zigzag,
      interpretation: `Found ${zigzag.length} zigzag points — need at least 6 for 5-wave pattern`,
    };
  }

  // Try to find a 5-wave impulse in the most recent 6 zigzag points
  // Try both bullish and bearish patterns
  let bestScore = 0;
  let bestDirection: "bullish" | "bearish" | "none" = "none";
  let bestStartIdx = -1;

  // Scan from the end backward looking for valid 5-wave patterns
  for (let start = Math.max(0, zigzag.length - 10); start <= zigzag.length - 6; start++) {
    const segment = zigzag.slice(start, start + 6);

    // Determine direction from first point type
    const dir = segment[0]!.type === "low" ? "bullish" : "bearish";
    const { valid, score } = checkElliottRules(segment, dir as "bullish" | "bearish");

    if (valid && score > bestScore) {
      bestScore = score;
      bestDirection = dir as "bullish" | "bearish";
      bestStartIdx = start;
    }
  }

  if (bestStartIdx < 0 || bestDirection === "none") {
    return {
      ...emptyResult,
      zigzagPoints: zigzag,
      interpretation: "No valid 5-wave impulse pattern found in recent price action",
    };
  }

  const patternPts = zigzag.slice(bestStartIdx, bestStartIdx + 6);
  const { ratios } = checkFibRatios(patternPts, bestDirection);
  const fibResult = checkFibRatios(patternPts, bestDirection);

  // Build wave labels
  const waves: WaveLabel[] = [];
  for (let w = 0; w < 5; w++) {
    const start = patternPts[w]!;
    const end = patternPts[w + 1]!;
    const isUp = end.price > start.price;
    waves.push({
      wave: w + 1,
      startPrice: parseFloat(start.price.toFixed(4)),
      endPrice: parseFloat(end.price.toFixed(4)),
      startBar: start.bar,
      endBar: end.bar,
      direction: isUp ? "up" : "down",
      fibRatio: ratios[w + 1] !== undefined ? ratios[w + 1]! : null,
    });
  }

  // Determine current wave (where is the last bar relative to the pattern?)
  const lastPatternBar = patternPts[5]!.bar;
  const lastBar = candles.length - 1;
  let currentWave = 5;
  if (lastBar > lastPatternBar) {
    currentWave = 5; // Beyond pattern — could be in correction
  } else {
    for (let w = 0; w < 5; w++) {
      if (lastBar >= patternPts[w]!.bar && lastBar <= patternPts[w + 1]!.bar) {
        currentWave = w + 1;
        break;
      }
    }
  }

  // Project Wave 5 target if in wave 4 or early wave 5
  let wave5Target: number | null = null;
  if (currentWave >= 4 && bestDirection === "bullish") {
    const wave1Len = patternPts[1]!.price - patternPts[0]!.price;
    wave5Target = parseFloat((patternPts[4]!.price + wave1Len).toFixed(4));
  } else if (currentWave >= 4 && bestDirection === "bearish") {
    const wave1Len = patternPts[0]!.price - patternPts[1]!.price;
    wave5Target = parseFloat((patternPts[4]!.price - wave1Len).toFixed(4));
  }

  const interpretation = buildElliottInterpretation(
    bestDirection,
    bestScore,
    fibResult.valid,
    currentWave,
    wave5Target,
    waves
  );

  return {
    zigzagPoints: zigzag,
    patternFound: true,
    waves,
    currentWave,
    patternDirection: bestDirection,
    patternScore: bestScore,
    fibValid: fibResult.valid,
    wave5Target,
    interpretation,
  };
}

function buildElliottInterpretation(
  direction: string,
  score: number,
  fibValid: boolean,
  currentWave: number,
  wave5Target: number | null,
  waves: WaveLabel[]
): string {
  let msg = `Elliott Wave: ${direction.toUpperCase()} 5-wave impulse detected (score: ${score}/100). `;

  msg += `Currently in Wave ${currentWave}. `;

  if (fibValid) {
    msg += "Fibonacci ratios VALID — high-confidence pattern. ";
  } else {
    msg += "Fibonacci ratios approximate — moderate confidence. ";
  }

  if (wave5Target !== null) {
    msg += `Wave 5 target: ${wave5Target.toFixed(2)}. `;
  }

  if (currentWave <= 3) {
    msg += direction === "bullish"
      ? "Impulse in progress — look for pullbacks to ride the trend."
      : "Bearish impulse in progress — avoid longs until completion.";
  } else if (currentWave === 4) {
    msg += direction === "bullish"
      ? "Wave 4 correction — potential Wave 5 rally ahead."
      : "Wave 4 correction — potential final selloff ahead.";
  } else {
    msg += "Wave 5 complete or nearing completion — expect corrective move (ABC).";
  }

  return msg;
}
