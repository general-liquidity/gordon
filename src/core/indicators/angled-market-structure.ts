/**
 * Angled Market Structure (AMS)
 * ATR-decaying pivot lines that slope over time.
 * Detects structure breaks when price crosses angled S/R.
 *
 * Angled Market Structure implementation.
 */

import type { Candle } from "./types.ts";

export interface PivotLine {
  /** Price at the pivot point */
  pivotPrice: number;
  /** Current angled price (decayed/risen over time) */
  currentPrice: number;
  /** Bar index where pivot was detected */
  pivotBar: number;
  /** Type: support or resistance */
  type: "support" | "resistance";
  /** Whether this pivot line has been broken */
  broken: boolean;
  /** Bars since pivot was established */
  age: number;
}

export interface AMSResult {
  /** Active (unbroken) support lines */
  supportLines: PivotLine[];
  /** Active (unbroken) resistance lines */
  resistanceLines: PivotLine[];
  /** Nearest support level (angled current price) */
  nearestSupport: number | null;
  /** Nearest resistance level (angled current price) */
  nearestResistance: number | null;
  /** Whether a structure break just occurred */
  structureBreak: boolean;
  /** Direction of most recent break */
  breakDirection: "bullish" | "bearish" | "none";
  /** ATR value used for angle calculation */
  atr: number | null;
  /** Bias based on structure */
  bias: "bullish" | "bearish" | "neutral";
  /** Interpretation string */
  interpretation: string;
}

/**
 * Detect pivot highs: candle is highest in a window of ±pivotLen
 */
function findPivotHighs(candles: Candle[], pivotLen: number): { price: number; bar: number }[] {
  const pivots: { price: number; bar: number }[] = [];
  for (let i = pivotLen; i < candles.length - pivotLen; i++) {
    let isHighest = true;
    for (let j = i - pivotLen; j <= i + pivotLen; j++) {
      if (j !== i && candles[j]!.high >= candles[i]!.high) {
        isHighest = false;
        break;
      }
    }
    if (isHighest) {
      pivots.push({ price: candles[i]!.high, bar: i });
    }
  }
  return pivots;
}

/**
 * Detect pivot lows: candle is lowest in a window of ±pivotLen
 */
function findPivotLows(candles: Candle[], pivotLen: number): { price: number; bar: number }[] {
  const pivots: { price: number; bar: number }[] = [];
  for (let i = pivotLen; i < candles.length - pivotLen; i++) {
    let isLowest = true;
    for (let j = i - pivotLen; j <= i + pivotLen; j++) {
      if (j !== i && candles[j]!.low <= candles[i]!.low) {
        isLowest = false;
        break;
      }
    }
    if (isLowest) {
      pivots.push({ price: candles[i]!.low, bar: i });
    }
  }
  return pivots;
}

/**
 * Calculate ATR manually over a window
 */
function calcATR(candles: Candle[], period: number): number | null {
  if (candles.length < period + 1) return null;

  let sum = 0;
  for (let i = candles.length - period; i < candles.length; i++) {
    const high = candles[i]!.high;
    const low = candles[i]!.low;
    const prevClose = candles[i - 1]!.close;
    const tr = Math.max(high - low, Math.abs(high - prevClose), Math.abs(low - prevClose));
    sum += tr;
  }
  return sum / period;
}

/**
 * Calculate Angled Market Structure.
 *
 * @param candles - OHLCV candle array
 * @param pivotLen - Lookback/forward for pivot detection (default 5)
 * @param angleFactor - ATR fraction for per-bar angle decay/rise (default 0.01)
 * @param atrPeriod - ATR period for angle calculation (default 14)
 * @param maxPivots - Max pivot lines to track per side (default 5)
 * @returns AMSResult
 */
export function calculateAMS(
  candles: Candle[],
  pivotLen: number = 5,
  angleFactor: number = 0.01,
  atrPeriod: number = 14,
  maxPivots: number = 5
): AMSResult {
  if (candles.length < pivotLen * 2 + atrPeriod + 2) {
    return {
      supportLines: [],
      resistanceLines: [],
      nearestSupport: null,
      nearestResistance: null,
      structureBreak: false,
      breakDirection: "none",
      atr: null,
      bias: "neutral",
      interpretation: "Insufficient data for Angled Market Structure analysis",
    };
  }

  const atr = calcATR(candles, atrPeriod);
  if (atr === null || atr < 1e-10) {
    return {
      supportLines: [],
      resistanceLines: [],
      nearestSupport: null,
      nearestResistance: null,
      structureBreak: false,
      breakDirection: "none",
      atr: null,
      bias: "neutral",
      interpretation: "Could not calculate ATR for angle computation",
    };
  }

  const anglePerBar = atr * angleFactor;
  const lastBar = candles.length - 1;
  const currentPrice = candles[lastBar]!.close;

  // Find pivots
  const pivotHighs = findPivotHighs(candles, pivotLen);
  const pivotLows = findPivotLows(candles, pivotLen);

  // Build angled resistance lines (pivot highs decay downward over time)
  const resistanceLines: PivotLine[] = [];
  const recentHighs = pivotHighs.slice(-maxPivots * 2);
  for (const ph of recentHighs) {
    const age = lastBar - ph.bar;
    const angledPrice = ph.price - anglePerBar * age; // Resistance decays down
    const broken = currentPrice > angledPrice;
    resistanceLines.push({
      pivotPrice: parseFloat(ph.price.toFixed(4)),
      currentPrice: parseFloat(angledPrice.toFixed(4)),
      pivotBar: ph.bar,
      type: "resistance",
      broken,
      age,
    });
  }

  // Build angled support lines (pivot lows rise upward over time)
  const supportLines: PivotLine[] = [];
  const recentLows = pivotLows.slice(-maxPivots * 2);
  for (const pl of recentLows) {
    const age = lastBar - pl.bar;
    const angledPrice = pl.price + anglePerBar * age; // Support rises up
    const broken = currentPrice < angledPrice;
    supportLines.push({
      pivotPrice: parseFloat(pl.price.toFixed(4)),
      currentPrice: parseFloat(angledPrice.toFixed(4)),
      pivotBar: pl.bar,
      type: "support",
      broken,
      age,
    });
  }

  // Filter to active (unbroken) lines, keep most recent
  const activeResistance = resistanceLines.filter(l => !l.broken).slice(-maxPivots);
  const activeSupport = supportLines.filter(l => !l.broken).slice(-maxPivots);

  // Find nearest levels
  let nearestResistance: number | null = null;
  let minResistDist = Infinity;
  for (const r of activeResistance) {
    const dist = r.currentPrice - currentPrice;
    if (dist > 0 && dist < minResistDist) {
      minResistDist = dist;
      nearestResistance = r.currentPrice;
    }
  }

  let nearestSupport: number | null = null;
  let minSupportDist = Infinity;
  for (const s of activeSupport) {
    const dist = currentPrice - s.currentPrice;
    if (dist > 0 && dist < minSupportDist) {
      minSupportDist = dist;
      nearestSupport = s.currentPrice;
    }
  }

  // Detect structure break on the last bar
  // Check if the previous bar's close was on the other side
  let structureBreak = false;
  let breakDirection: "bullish" | "bearish" | "none" = "none";

  if (candles.length >= 2) {
    const prevClose = candles[lastBar - 1]!.close;

    // Check resistance breaks: prev below, current above
    for (const r of resistanceLines) {
      const prevAngled = r.pivotPrice - anglePerBar * (lastBar - 1 - r.pivotBar);
      if (prevClose <= prevAngled && currentPrice > r.currentPrice) {
        structureBreak = true;
        breakDirection = "bullish";
        break;
      }
    }

    // Check support breaks: prev above, current below
    if (!structureBreak) {
      for (const s of supportLines) {
        const prevAngled = s.pivotPrice + anglePerBar * (lastBar - 1 - s.pivotBar);
        if (prevClose >= prevAngled && currentPrice < s.currentPrice) {
          structureBreak = true;
          breakDirection = "bearish";
          break;
        }
      }
    }
  }

  // Determine bias
  let bias: "bullish" | "bearish" | "neutral" = "neutral";
  if (breakDirection === "bullish") {
    bias = "bullish";
  } else if (breakDirection === "bearish") {
    bias = "bearish";
  } else if (nearestSupport !== null && nearestResistance !== null) {
    const distToSupport = currentPrice - nearestSupport;
    const distToResistance = nearestResistance - currentPrice;
    if (distToResistance < distToSupport * 0.5) bias = "bearish";
    else if (distToSupport < distToResistance * 0.5) bias = "bullish";
  }

  const interpretation = buildAMSInterpretation(
    currentPrice,
    nearestSupport,
    nearestResistance,
    structureBreak,
    breakDirection,
    bias,
    atr,
    activeSupport.length,
    activeResistance.length
  );

  return {
    supportLines: activeSupport,
    resistanceLines: activeResistance,
    nearestSupport,
    nearestResistance,
    structureBreak,
    breakDirection,
    atr: parseFloat(atr.toFixed(4)),
    bias,
    interpretation,
  };
}

function buildAMSInterpretation(
  price: number,
  support: number | null,
  resistance: number | null,
  structBreak: boolean,
  breakDir: string,
  bias: string,
  atr: number,
  supportCount: number,
  resistCount: number
): string {
  let msg = `AMS: ${supportCount} support, ${resistCount} resistance lines active. `;

  if (support !== null) {
    msg += `Nearest support: ${support.toFixed(2)} (${((price - support) / atr).toFixed(1)} ATR away). `;
  }
  if (resistance !== null) {
    msg += `Nearest resistance: ${resistance.toFixed(2)} (${((resistance - price) / atr).toFixed(1)} ATR away). `;
  }

  if (structBreak) {
    msg += `STRUCTURE BREAK ${breakDir.toUpperCase()} — `;
    msg += breakDir === "bullish"
      ? "price broke above angled resistance. "
      : "price broke below angled support. ";
  }

  msg += `Bias: ${bias.toUpperCase()}.`;
  return msg;
}
