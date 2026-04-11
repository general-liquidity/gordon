/**
 * Smart Money Concepts / ICT Structural Patterns
 *
 * Pure-function pattern detectors ported from the NinjaTrader C# indicators
 * in Algorithmic-trading-main/ninjatrader/Indicators/. Five patterns Gordon's
 * existing 70+ indicators don't cover in this specific shape:
 *
 *   - Order Block:        consolidation candle right before a Break-of-Structure
 *   - Fair Value Gap:     3-candle sandwich where the neighbors' opposite-side
 *                         wicks don't overlap the middle body
 *   - Change-of-Character: confirmed trend reversal on CLOSE through a prior swing
 *   - Premium/Discount:   Fibonacci-weighted zones over an auto-detected range
 *                         (0.5, 0.618, 0.705, 0.786)
 *   - Liquidity Sweep:    price pushes through a level to grab stops then
 *                         reverses, gated by volatility expansion
 *
 * These are the signals retail SMC/ICT traders expect Gordon to know about.
 * Implemented as pure functions over OHLC arrays — no state, no I/O, no
 * framework coupling. Call sites compose them into tool outputs or strategy
 * signal sets.
 */

export interface OHLC {
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number;
}

// ============================================================================
// Shared helpers
// ============================================================================

function bodyHigh(bar: OHLC): number {
  return Math.max(bar.open, bar.close);
}

function bodyLow(bar: OHLC): number {
  return Math.min(bar.open, bar.close);
}

function isBullish(bar: OHLC): boolean {
  return bar.close > bar.open;
}

function isBearish(bar: OHLC): boolean {
  return bar.close < bar.open;
}

function range(bar: OHLC): number {
  return bar.high - bar.low;
}

function swingHigh(bars: OHLC[], index: number, lookback: number): boolean {
  if (index < lookback || index + lookback >= bars.length) return false;
  const center = bars[index]!.high;
  for (let i = 1; i <= lookback; i++) {
    if (bars[index - i]!.high >= center) return false;
    if (bars[index + i]!.high >= center) return false;
  }
  return true;
}

function swingLow(bars: OHLC[], index: number, lookback: number): boolean {
  if (index < lookback || index + lookback >= bars.length) return false;
  const center = bars[index]!.low;
  for (let i = 1; i <= lookback; i++) {
    if (bars[index - i]!.low <= center) return false;
    if (bars[index + i]!.low <= center) return false;
  }
  return true;
}

function rollingAverage(values: number[], length: number): number {
  if (values.length === 0) return 0;
  const take = values.slice(-length);
  return take.reduce((a, b) => a + b, 0) / take.length;
}

// ============================================================================
// 1. Fair Value Gap (FVG)
// ============================================================================

export interface FairValueGap {
  /** Index of the middle bar that created the gap. */
  anchorIndex: number;
  anchorTimestamp: number;
  /** "bull" = gap is below current price, acts as demand. "bear" = above, acts as supply. */
  direction: "bull" | "bear";
  top: number;
  bottom: number;
  size: number;
  /** Width as percent of the anchor bar's price. */
  sizePct: number;
  /** True if price has not yet re-entered the gap after creation. */
  unfilled: boolean;
}

/**
 * Detect Fair Value Gaps over a bar series. A bullish FVG is a 3-candle
 * pattern where the middle candle is green, and neither neighbor's LOW
 * reaches the middle's body low (gap of untouched price). Bearish FVG is
 * the opposite. Returns gaps newest-last. `minGapPct` gates on the gap
 * width as a percent of price to filter noise.
 */
export function detectFairValueGaps(
  bars: OHLC[],
  options: { minGapPct?: number; checkFilled?: boolean } = {},
): FairValueGap[] {
  const { minGapPct = 0.05, checkFilled = true } = options;
  const gaps: FairValueGap[] = [];

  for (let i = 1; i < bars.length - 1; i++) {
    const prev = bars[i - 1]!;
    const mid = bars[i]!;
    const next = bars[i + 1]!;

    // Bullish FVG: green middle, both neighbors' lows above mid body low
    if (isBullish(mid)) {
      const midBodyLow = bodyLow(mid);
      const midBodyHigh = bodyHigh(mid);
      if (prev.high < midBodyLow && next.low > midBodyLow) {
        const top = Math.min(next.low, midBodyHigh);
        const bottom = Math.max(prev.high, midBodyLow);
        const size = top - bottom;
        const sizePct = (size / mid.close) * 100;
        if (sizePct >= minGapPct) {
          gaps.push({
            anchorIndex: i,
            anchorTimestamp: mid.timestamp,
            direction: "bull",
            top,
            bottom,
            size,
            sizePct,
            unfilled: checkFilled ? !gapFilledAfter(bars, i, bottom, top, "bull") : true,
          });
        }
      }
    }

    // Bearish FVG: red middle, both neighbors' highs below mid body high
    if (isBearish(mid)) {
      const midBodyLow = bodyLow(mid);
      const midBodyHigh = bodyHigh(mid);
      if (prev.low > midBodyHigh && next.high < midBodyHigh) {
        const top = Math.min(prev.low, midBodyHigh);
        const bottom = Math.max(next.high, midBodyLow);
        const size = top - bottom;
        const sizePct = (size / mid.close) * 100;
        if (sizePct >= minGapPct) {
          gaps.push({
            anchorIndex: i,
            anchorTimestamp: mid.timestamp,
            direction: "bear",
            top,
            bottom,
            size,
            sizePct,
            unfilled: checkFilled ? !gapFilledAfter(bars, i, bottom, top, "bear") : true,
          });
        }
      }
    }
  }

  return gaps;
}

function gapFilledAfter(
  bars: OHLC[],
  anchorIndex: number,
  bottom: number,
  top: number,
  direction: "bull" | "bear",
): boolean {
  for (let i = anchorIndex + 2; i < bars.length; i++) {
    const bar = bars[i]!;
    if (direction === "bull" && bar.low <= bottom) return true;
    if (direction === "bear" && bar.high >= top) return true;
  }
  return false;
}

// ============================================================================
// 2. Change-of-Character (CHoCH)
// ============================================================================

export interface ChangeOfCharacter {
  index: number;
  timestamp: number;
  /** "bull" = downtrend broken upward. "bear" = uptrend broken downward. */
  direction: "bull" | "bear";
  /** The swing level that was broken on close. */
  brokenLevel: number;
  closePrice: number;
}

/**
 * Detect Change-of-Character events — a structural trend reversal confirmed
 * by a CLOSE through the prior swing high (bull CHoCH) or swing low (bear
 * CHoCH). Different from a simple breakout: the break must be confirmed by
 * the candle close, not just a wick. Returns events in chronological order.
 */
export function detectChangeOfCharacter(
  bars: OHLC[],
  swingLookback = 5,
): ChangeOfCharacter[] {
  const events: ChangeOfCharacter[] = [];

  // Track the most recent confirmed swing high and low
  let lastSwingHigh: { index: number; level: number } | null = null;
  let lastSwingLow: { index: number; level: number } | null = null;
  let lastBias: "bull" | "bear" | null = null;

  for (let i = swingLookback; i < bars.length - swingLookback; i++) {
    if (swingHigh(bars, i, swingLookback)) {
      lastSwingHigh = { index: i, level: bars[i]!.high };
    }
    if (swingLow(bars, i, swingLookback)) {
      lastSwingLow = { index: i, level: bars[i]!.low };
    }
  }

  for (let i = swingLookback * 2; i < bars.length; i++) {
    const bar = bars[i]!;
    if (lastSwingHigh && lastBias === "bear" && bar.close > lastSwingHigh.level) {
      events.push({
        index: i,
        timestamp: bar.timestamp,
        direction: "bull",
        brokenLevel: lastSwingHigh.level,
        closePrice: bar.close,
      });
      lastBias = "bull";
    } else if (lastSwingLow && lastBias === "bull" && bar.close < lastSwingLow.level) {
      events.push({
        index: i,
        timestamp: bar.timestamp,
        direction: "bear",
        brokenLevel: lastSwingLow.level,
        closePrice: bar.close,
      });
      lastBias = "bear";
    } else if (lastBias === null) {
      // Initialize bias on the first confirmed move away from mid-range
      if (lastSwingHigh && bar.close > lastSwingHigh.level) lastBias = "bull";
      else if (lastSwingLow && bar.close < lastSwingLow.level) lastBias = "bear";
    }
  }

  return events;
}

// ============================================================================
// 3. Order Block
// ============================================================================

export interface OrderBlock {
  /** Index of the consolidation candle that became the order block. */
  index: number;
  timestamp: number;
  direction: "bull" | "bear";
  high: number;
  low: number;
  /** Index where the Break-of-Structure occurred. */
  breakIndex: number;
}

/**
 * Detect Order Blocks — the last consolidation candle before a structural
 * break. A bullish OB is the last bearish candle before a swing-high
 * breakout; a bearish OB is the last bullish candle before a swing-low
 * breakdown. Returns OBs in chronological order.
 */
export function detectOrderBlocks(
  bars: OHLC[],
  swingLookback = 5,
): OrderBlock[] {
  const blocks: OrderBlock[] = [];

  for (let i = swingLookback * 2; i < bars.length; i++) {
    const bar = bars[i]!;
    // Bullish break-of-structure: close above recent swing high
    const recentHigh = Math.max(
      ...bars.slice(Math.max(0, i - swingLookback * 2), i).map((b) => b.high),
    );
    if (bar.close > recentHigh) {
      // Walk back to find the last bearish candle — that's the OB
      for (let j = i - 1; j >= Math.max(0, i - swingLookback * 2); j--) {
        if (isBearish(bars[j]!)) {
          blocks.push({
            index: j,
            timestamp: bars[j]!.timestamp,
            direction: "bull",
            high: bars[j]!.high,
            low: bars[j]!.low,
            breakIndex: i,
          });
          break;
        }
      }
    }

    // Bearish break-of-structure
    const recentLow = Math.min(
      ...bars.slice(Math.max(0, i - swingLookback * 2), i).map((b) => b.low),
    );
    if (bar.close < recentLow) {
      for (let j = i - 1; j >= Math.max(0, i - swingLookback * 2); j--) {
        if (isBullish(bars[j]!)) {
          blocks.push({
            index: j,
            timestamp: bars[j]!.timestamp,
            direction: "bear",
            high: bars[j]!.high,
            low: bars[j]!.low,
            breakIndex: i,
          });
          break;
        }
      }
    }
  }

  // Deduplicate by anchor index (same bar can be hit by multiple breaks)
  const seen = new Set<string>();
  return blocks.filter((b) => {
    const key = `${b.direction}:${b.index}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

// ============================================================================
// 4. Premium / Discount Zones (Fibonacci-weighted)
// ============================================================================

export interface PremiumDiscountZones {
  /** Range used to compute zones — auto-detected from the most recent swing high/low. */
  rangeHigh: number;
  rangeLow: number;
  /** Equilibrium (midpoint). */
  equilibrium: number;
  /** Premium zones (above equilibrium, act as resistance). */
  premium: { level50: number; level618: number; level705: number; level786: number };
  /** Discount zones (below equilibrium, act as support). */
  discount: { level50: number; level618: number; level705: number; level786: number };
  /** Where the most recent close falls: "premium" | "equilibrium" | "discount". */
  currentZone: "premium" | "equilibrium" | "discount";
}

/**
 * Compute Premium/Discount zones with Fibonacci tiers over an auto-detected
 * range. The range is the most recent confirmed swing high to swing low (or
 * vice versa). Fib tiers applied: 0.5 (equilibrium), 0.618, 0.705, 0.786.
 * Returns null if there's no confirmed range in the bars.
 */
export function detectPremiumDiscountZones(
  bars: OHLC[],
  swingLookback = 5,
): PremiumDiscountZones | null {
  if (bars.length < swingLookback * 3) return null;

  let mostRecentHigh: { index: number; level: number } | null = null;
  let mostRecentLow: { index: number; level: number } | null = null;

  for (let i = bars.length - swingLookback - 1; i >= swingLookback; i--) {
    if (!mostRecentHigh && swingHigh(bars, i, swingLookback)) {
      mostRecentHigh = { index: i, level: bars[i]!.high };
    }
    if (!mostRecentLow && swingLow(bars, i, swingLookback)) {
      mostRecentLow = { index: i, level: bars[i]!.low };
    }
    if (mostRecentHigh && mostRecentLow) break;
  }

  if (!mostRecentHigh || !mostRecentLow) return null;

  const rangeHigh = mostRecentHigh.level;
  const rangeLow = mostRecentLow.level;
  const rangeSize = rangeHigh - rangeLow;
  if (rangeSize <= 0) return null;

  const equilibrium = (rangeHigh + rangeLow) / 2;
  const premium = {
    level50: equilibrium,
    level618: rangeLow + rangeSize * 0.618,
    level705: rangeLow + rangeSize * 0.705,
    level786: rangeLow + rangeSize * 0.786,
  };
  const discount = {
    level50: equilibrium,
    level618: rangeLow + rangeSize * (1 - 0.618),
    level705: rangeLow + rangeSize * (1 - 0.705),
    level786: rangeLow + rangeSize * (1 - 0.786),
  };

  const currentClose = bars[bars.length - 1]!.close;
  const currentZone: "premium" | "equilibrium" | "discount" =
    currentClose > equilibrium * 1.01
      ? "premium"
      : currentClose < equilibrium * 0.99
        ? "discount"
        : "equilibrium";

  return { rangeHigh, rangeLow, equilibrium, premium, discount, currentZone };
}

// ============================================================================
// 5. Liquidity Sweep
// ============================================================================

export interface LiquiditySweep {
  index: number;
  timestamp: number;
  /** "bull" = price pushed below support, grabbed stops, reversed up. */
  direction: "bull" | "bear";
  sweptLevel: number;
  /** How far price wicked beyond the level before reversing, as percent of price. */
  wickDepthPct: number;
  /** True if the sweep bar's body closed back on the correct side of the level. */
  confirmed: boolean;
}

/**
 * Detect Liquidity Sweeps — bars that wick through a prior swing level then
 * close back on the original side (stop hunt). Gated by a volatility
 * expansion filter: the sweep bar's range must be at least 1.3x the 5-bar
 * average range to avoid false-positives on quiet days.
 *
 * Follows the Liquidity Sweep Pro M15 pattern from Algorithmic-trading-main.
 */
export function detectLiquiditySweeps(
  bars: OHLC[],
  options: { swingLookback?: number; minRangeMultiple?: number } = {},
): LiquiditySweep[] {
  const { swingLookback = 5, minRangeMultiple = 1.3 } = options;
  const sweeps: LiquiditySweep[] = [];

  for (let i = swingLookback * 2; i < bars.length; i++) {
    const bar = bars[i]!;
    const rangeBaseline = rollingAverage(
      bars.slice(Math.max(0, i - 5), i).map(range),
      5,
    );
    if (rangeBaseline === 0) continue;
    if (range(bar) < rangeBaseline * minRangeMultiple) continue;

    // Look back for the most recent swing high/low the sweep could be targeting
    let sweptHigh: number | null = null;
    let sweptLow: number | null = null;
    for (let j = i - 1; j >= Math.max(0, i - swingLookback * 3); j--) {
      if (sweptHigh === null && swingHigh(bars, j, swingLookback)) {
        sweptHigh = bars[j]!.high;
      }
      if (sweptLow === null && swingLow(bars, j, swingLookback)) {
        sweptLow = bars[j]!.low;
      }
      if (sweptHigh !== null && sweptLow !== null) break;
    }

    // Bearish sweep: wick above swing high, close back below
    if (sweptHigh !== null && bar.high > sweptHigh && bar.close < sweptHigh) {
      const wickDepthPct = ((bar.high - sweptHigh) / sweptHigh) * 100;
      sweeps.push({
        index: i,
        timestamp: bar.timestamp,
        direction: "bear",
        sweptLevel: sweptHigh,
        wickDepthPct,
        confirmed: bodyHigh(bar) < sweptHigh,
      });
    }

    // Bullish sweep: wick below swing low, close back above
    if (sweptLow !== null && bar.low < sweptLow && bar.close > sweptLow) {
      const wickDepthPct = ((sweptLow - bar.low) / sweptLow) * 100;
      sweeps.push({
        index: i,
        timestamp: bar.timestamp,
        direction: "bull",
        sweptLevel: sweptLow,
        wickDepthPct,
        confirmed: bodyLow(bar) > sweptLow,
      });
    }
  }

  return sweeps;
}

// ============================================================================
// Combined: run all five and return a unified SMC analysis
// ============================================================================

export interface SmcAnalysis {
  fairValueGaps: FairValueGap[];
  orderBlocks: OrderBlock[];
  changeOfCharacter: ChangeOfCharacter[];
  premiumDiscount: PremiumDiscountZones | null;
  liquiditySweeps: LiquiditySweep[];
  summary: {
    bullishSignals: number;
    bearishSignals: number;
    netBias: "bullish" | "bearish" | "neutral";
    currentZone?: "premium" | "equilibrium" | "discount";
  };
}

export function analyzeSmcPatterns(
  bars: OHLC[],
  options: { swingLookback?: number } = {},
): SmcAnalysis {
  const { swingLookback = 5 } = options;
  const fairValueGaps = detectFairValueGaps(bars);
  const orderBlocks = detectOrderBlocks(bars, swingLookback);
  const changeOfCharacter = detectChangeOfCharacter(bars, swingLookback);
  const premiumDiscount = detectPremiumDiscountZones(bars, swingLookback);
  const liquiditySweeps = detectLiquiditySweeps(bars, { swingLookback });

  let bullishSignals = 0;
  let bearishSignals = 0;

  for (const g of fairValueGaps) {
    if (g.unfilled) {
      if (g.direction === "bull") bullishSignals += 1;
      else bearishSignals += 1;
    }
  }
  for (const ob of orderBlocks) {
    if (ob.direction === "bull") bullishSignals += 1;
    else bearishSignals += 1;
  }
  for (const e of changeOfCharacter.slice(-3)) {
    if (e.direction === "bull") bullishSignals += 2;
    else bearishSignals += 2;
  }
  for (const s of liquiditySweeps) {
    if (s.confirmed) {
      if (s.direction === "bull") bullishSignals += 1;
      else bearishSignals += 1;
    }
  }

  const netBias: "bullish" | "bearish" | "neutral" =
    bullishSignals > bearishSignals * 1.3
      ? "bullish"
      : bearishSignals > bullishSignals * 1.3
        ? "bearish"
        : "neutral";

  return {
    fairValueGaps,
    orderBlocks,
    changeOfCharacter,
    premiumDiscount,
    liquiditySweeps,
    summary: {
      bullishSignals,
      bearishSignals,
      netBias,
      currentZone: premiumDiscount?.currentZone,
    },
  };
}
