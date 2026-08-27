/**
 * Playbook Rule Engine
 *
 * Parses playbook entry/exit conditions into executable rules
 * that can be evaluated against candle data with indicator calculations.
 *
 * Handles the 3 built-in playbooks:
 * - momentum-breakout: Breakout above N-period high with volume and RSI confirmation
 * - mean-reversion: RSI oversold at support with volume confirmation
 * - trend-following: EMA crossover with ADX trend strength confirmation
 */

import type { Playbook, TriggerCondition } from "../playbooks/types.ts";
import type { Candle } from "./types.ts";

// ============================================================================
// Signal Types
// ============================================================================

export interface EntrySignal {
  triggered: boolean;
  side: "long" | "short";
  confidence: number;
  reason: string;
}

export interface ExitSignal {
  triggered: boolean;
  reason: "stop_loss" | "take_profit" | "trailing_stop" | "time_stop" | "signal_exit";
}

// ============================================================================
// Indicator Calculation Helpers
// ============================================================================

function calcSMA(values: number[], period: number): number | null {
  if (values.length < period) return null;
  const slice = values.slice(values.length - period);
  return slice.reduce((a, b) => a + b, 0) / period;
}

function calcEMA(values: number[], period: number): number | null {
  if (values.length < period) return null;
  const k = 2 / (period + 1);
  let ema = values[0]!;
  for (let i = 1; i < values.length; i++) {
    ema = values[i]! * k + ema * (1 - k);
  }
  return ema;
}

function calcEMAArray(values: number[], period: number): number[] {
  if (values.length < period) return [];
  const k = 2 / (period + 1);
  const result: number[] = [];
  // Seed with SMA of the first `period` values
  let ema = values.slice(0, period).reduce((a, b) => a + b, 0) / period;
  for (let i = 0; i < period; i++) {
    result.push(ema);
  }
  for (let i = period; i < values.length; i++) {
    ema = values[i]! * k + ema * (1 - k);
    result.push(ema);
  }
  return result;
}

function calcRSI(closes: number[], period: number = 14): number | null {
  if (closes.length < period + 1) return null;
  let gainSum = 0;
  let lossSum = 0;
  // Initial average gain/loss
  for (let i = 1; i <= period; i++) {
    const change = closes[i]! - closes[i - 1]!;
    if (change > 0) gainSum += change;
    else lossSum += Math.abs(change);
  }
  let avgGain = gainSum / period;
  let avgLoss = lossSum / period;
  // Smoothed
  for (let i = period + 1; i < closes.length; i++) {
    const change = closes[i]! - closes[i - 1]!;
    if (change > 0) {
      avgGain = (avgGain * (period - 1) + change) / period;
      avgLoss = (avgLoss * (period - 1)) / period;
    } else {
      avgGain = (avgGain * (period - 1)) / period;
      avgLoss = (avgLoss * (period - 1) + Math.abs(change)) / period;
    }
  }
  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return 100 - 100 / (1 + rs);
}

function _calcMACD(
  closes: number[],
  fast: number = 12,
  slow: number = 26,
  signal: number = 9,
): { macdLine: number | null; signalLine: number | null; histogram: number | null } {
  if (closes.length < slow + signal) {
    return { macdLine: null, signalLine: null, histogram: null };
  }
  const emaFast = calcEMAArray(closes, fast);
  const emaSlow = calcEMAArray(closes, slow);
  const macdValues: number[] = [];
  for (let i = 0; i < closes.length; i++) {
    if (i < slow - 1 || emaFast[i] === undefined || emaSlow[i] === undefined) {
      continue;
    }
    macdValues.push(emaFast[i]! - emaSlow[i]!);
  }
  if (macdValues.length < signal) {
    return { macdLine: null, signalLine: null, histogram: null };
  }
  const signalEma = calcEMAArray(macdValues, signal);
  const lastMacd = macdValues[macdValues.length - 1]!;
  const lastSignal = signalEma[signalEma.length - 1] ?? null;
  return {
    macdLine: lastMacd,
    signalLine: lastSignal,
    histogram: lastSignal !== null ? lastMacd - lastSignal : null,
  };
}

function calcBollingerBands(
  closes: number[],
  period: number = 20,
  stdMult: number = 2,
): { upper: number | null; middle: number | null; lower: number | null; width: number | null } {
  if (closes.length < period) {
    return { upper: null, middle: null, lower: null, width: null };
  }
  const slice = closes.slice(closes.length - period);
  const mean = slice.reduce((a, b) => a + b, 0) / period;
  const variance = slice.reduce((a, b) => a + (b - mean) ** 2, 0) / period;
  const stdDev = Math.sqrt(variance);
  const upper = mean + stdMult * stdDev;
  const lower = mean - stdMult * stdDev;
  return {
    upper,
    middle: mean,
    lower,
    width: mean > 0 ? ((upper - lower) / mean) * 100 : null,
  };
}

function calcVolumeMA(volumes: number[], period: number = 20): number | null {
  return calcSMA(volumes, period);
}

function _calcATR(candles: Candle[], period: number = 14): number | null {
  if (candles.length < period + 1) return null;
  const trueRanges: number[] = [];
  for (let i = 1; i < candles.length; i++) {
    const c = candles[i]!;
    const prevClose = candles[i - 1]!.close;
    const tr = Math.max(c.high - c.low, Math.abs(c.high - prevClose), Math.abs(c.low - prevClose));
    trueRanges.push(tr);
  }
  if (trueRanges.length < period) return null;
  // Wilder's smoothing
  let atr = trueRanges.slice(0, period).reduce((a, b) => a + b, 0) / period;
  for (let i = period; i < trueRanges.length; i++) {
    atr = (atr * (period - 1) + trueRanges[i]!) / period;
  }
  return atr;
}

function calcADX(candles: Candle[], period: number = 14): number | null {
  if (candles.length < period * 2 + 1) return null;
  const plusDMs: number[] = [];
  const minusDMs: number[] = [];
  const trueRanges: number[] = [];

  for (let i = 1; i < candles.length; i++) {
    const curr = candles[i]!;
    const prev = candles[i - 1]!;
    const upMove = curr.high - prev.high;
    const downMove = prev.low - curr.low;
    plusDMs.push(upMove > downMove && upMove > 0 ? upMove : 0);
    minusDMs.push(downMove > upMove && downMove > 0 ? downMove : 0);
    trueRanges.push(
      Math.max(
        curr.high - curr.low,
        Math.abs(curr.high - prev.close),
        Math.abs(curr.low - prev.close),
      ),
    );
  }

  if (trueRanges.length < period) return null;

  // Wilder's smoothing for all three
  let smoothTR = trueRanges.slice(0, period).reduce((a, b) => a + b, 0);
  let smoothPlusDM = plusDMs.slice(0, period).reduce((a, b) => a + b, 0);
  let smoothMinusDM = minusDMs.slice(0, period).reduce((a, b) => a + b, 0);

  const dxValues: number[] = [];
  for (let i = period; i < trueRanges.length; i++) {
    smoothTR = smoothTR - smoothTR / period + trueRanges[i]!;
    smoothPlusDM = smoothPlusDM - smoothPlusDM / period + plusDMs[i]!;
    smoothMinusDM = smoothMinusDM - smoothMinusDM / period + minusDMs[i]!;

    const plusDI = smoothTR > 0 ? (smoothPlusDM / smoothTR) * 100 : 0;
    const minusDI = smoothTR > 0 ? (smoothMinusDM / smoothTR) * 100 : 0;
    const diSum = plusDI + minusDI;
    const dx = diSum > 0 ? (Math.abs(plusDI - minusDI) / diSum) * 100 : 0;
    dxValues.push(dx);
  }

  if (dxValues.length < period) return null;
  // First ADX = average of first `period` DX values
  let adx = dxValues.slice(0, period).reduce((a, b) => a + b, 0) / period;
  for (let i = period; i < dxValues.length; i++) {
    adx = (adx * (period - 1) + dxValues[i]!) / period;
  }
  return adx;
}

function _calcHighest(values: number[], period: number): number | null {
  if (values.length < period) return null;
  return Math.max(...values.slice(values.length - period));
}

function _calcLowest(values: number[], period: number): number | null {
  if (values.length < period) return null;
  return Math.min(...values.slice(values.length - period));
}

// ============================================================================
// Parsed Condition Types
// ============================================================================

type ConditionCheck = (candles: Candle[], currentIndex: number) => boolean;

interface ParsedCondition {
  check: ConditionCheck;
  description: string;
}

// ============================================================================
// PlaybookRuleEngine
// ============================================================================

export class PlaybookRuleEngine {
  private playbook: Playbook;
  private entryConditions: ParsedCondition[];
  private exitStopPercent: number;
  private exitTPMultiplier: number;
  private riskPercent: number;
  private trailingStopEnabled: boolean;

  constructor(playbook: Playbook) {
    this.playbook = playbook;
    this.entryConditions = this.parseEntryConditions();
    this.exitStopPercent = this.parseStopLossPercent();
    this.exitTPMultiplier = this.parseTakeProfitMultiplier();
    this.riskPercent = this.parseRiskPercent();
    this.trailingStopEnabled = this.hasTrailingStop();
  }

  /**
   * Get the risk percent for position sizing
   */
  getRiskPercent(): number {
    return this.riskPercent;
  }

  /**
   * Get the stop loss percentage
   */
  getStopLossPercent(): number {
    return this.exitStopPercent;
  }

  /**
   * Get the take profit multiplier (R:R)
   */
  getTakeProfitMultiplier(): number {
    return this.exitTPMultiplier;
  }

  /**
   * Check if entry conditions are met at current candle.
   */
  checkEntry(candles: Candle[], currentIndex: number): EntrySignal {
    if (currentIndex < 50) {
      // Not enough history for indicator calculations
      return { triggered: false, side: "long", confidence: 0, reason: "Insufficient history" };
    }

    let matchCount = 0;
    const reasons: string[] = [];

    for (const condition of this.entryConditions) {
      if (condition.check(candles, currentIndex)) {
        matchCount++;
        reasons.push(condition.description);
      }
    }

    const totalConditions = this.entryConditions.length;
    if (totalConditions === 0) {
      return {
        triggered: false,
        side: "long",
        confidence: 0,
        reason: "No entry conditions parsed",
      };
    }

    const confidence = matchCount / totalConditions;
    // Require at least 60% of conditions to match
    const triggered = confidence >= 0.6 && matchCount >= 2;

    // Determine side from playbook context
    const side = this.determineSide();

    return {
      triggered,
      side,
      confidence,
      reason: triggered
        ? `Entry: ${reasons.join("; ")}`
        : `Only ${matchCount}/${totalConditions} conditions met`,
    };
  }

  /**
   * Check if exit conditions are met for an open position.
   */
  checkExit(
    candles: Candle[],
    currentIndex: number,
    position: {
      entry_price: number;
      side: "long" | "short";
      entry_time: number;
      highest_since_entry: number;
      lowest_since_entry: number;
    },
  ): ExitSignal {
    const current = candles[currentIndex];
    if (!current) {
      return { triggered: false, reason: "stop_loss" };
    }

    const { entry_price, side, highest_since_entry, lowest_since_entry } = position;

    // Calculate stop and target based on playbook
    const stopDistance = entry_price * (this.exitStopPercent / 100);
    const tpDistance = stopDistance * this.exitTPMultiplier;

    if (side === "long") {
      // Stop loss
      const stopPrice = entry_price - stopDistance;
      if (current.low <= stopPrice) {
        return { triggered: true, reason: "stop_loss" };
      }

      // Take profit
      const tpPrice = entry_price + tpDistance;
      if (current.high >= tpPrice) {
        return { triggered: true, reason: "take_profit" };
      }

      // Trailing stop: if price has moved 1.5R or more, trail at entry (breakeven)
      if (this.trailingStopEnabled) {
        const moveFromEntry = highest_since_entry - entry_price;
        const riskAmount = stopDistance;
        // If we've reached 1.5R profit and now pulled back to entry, exit
        if (moveFromEntry >= riskAmount * 1.5 && current.close <= entry_price) {
          return { triggered: true, reason: "trailing_stop" };
        }
        // If we've reached 2R profit and pulled back significantly
        if (moveFromEntry >= riskAmount * 2) {
          const trailStop = highest_since_entry - riskAmount;
          if (current.low <= trailStop) {
            return { triggered: true, reason: "trailing_stop" };
          }
        }
      }

      // Signal exit: check for bearish reversal conditions
      const closesUpTo = candles.slice(0, currentIndex + 1).map((c) => c.close);
      const rsi = calcRSI(closesUpTo);
      if (rsi !== null && rsi > 80) {
        return { triggered: true, reason: "signal_exit" };
      }
    } else {
      // Short side exits (mirror of long)
      const stopPrice = entry_price + stopDistance;
      if (current.high >= stopPrice) {
        return { triggered: true, reason: "stop_loss" };
      }

      const tpPrice = entry_price - tpDistance;
      if (current.low <= tpPrice) {
        return { triggered: true, reason: "take_profit" };
      }

      if (this.trailingStopEnabled) {
        const moveFromEntry = entry_price - lowest_since_entry;
        const riskAmount = stopDistance;
        if (moveFromEntry >= riskAmount * 1.5 && current.close >= entry_price) {
          return { triggered: true, reason: "trailing_stop" };
        }
        if (moveFromEntry >= riskAmount * 2) {
          const trailStop = lowest_since_entry + riskAmount;
          if (current.high >= trailStop) {
            return { triggered: true, reason: "trailing_stop" };
          }
        }
      }

      const closesUpTo = candles.slice(0, currentIndex + 1).map((c) => c.close);
      const rsi = calcRSI(closesUpTo);
      if (rsi !== null && rsi < 20) {
        return { triggered: true, reason: "signal_exit" };
      }
    }

    return { triggered: false, reason: "stop_loss" };
  }

  // ============================================================================
  // Private: Condition Parsing
  // ============================================================================

  private parseEntryConditions(): ParsedCondition[] {
    const conditions: ParsedCondition[] = [];
    const playbookId = this.playbook.id;

    // Parse from structured trigger conditions first
    for (const cond of this.playbook.trigger.conditions) {
      const parsed = this.parseSingleCondition(cond);
      if (parsed) {
        conditions.push(parsed);
      }
    }

    // If we got some from structured parsing, return those
    if (conditions.length > 0) {
      return conditions;
    }

    // Fallback: generate conditions based on playbook ID for known playbooks
    if (playbookId === "momentum-breakout") {
      return this.getMomentumBreakoutConditions();
    }
    if (playbookId === "mean-reversion") {
      return this.getMeanReversionConditions();
    }
    if (playbookId === "trend-following") {
      return this.getTrendFollowingConditions();
    }

    return conditions;
  }

  private parseSingleCondition(cond: TriggerCondition): ParsedCondition | null {
    const desc = cond.description.toLowerCase();

    // RSI between X and Y
    if (cond.indicator === "RSI" && cond.comparison === "between" && Array.isArray(cond.value)) {
      const [low, high] = cond.value as [number, number];
      return {
        description: `RSI between ${low} and ${high}`,
        check: (candles, idx) => {
          const closes = candles.slice(0, idx + 1).map((c) => c.close);
          const rsi = calcRSI(closes);
          return rsi !== null && rsi >= low && rsi <= high;
        },
      };
    }

    // RSI crosses below X (oversold trigger)
    if (
      cond.indicator === "RSI" &&
      cond.comparison === "crosses_below" &&
      typeof cond.value === "number"
    ) {
      const threshold = cond.value;
      return {
        description: `RSI crosses below ${threshold}`,
        check: (candles, idx) => {
          if (idx < 1) return false;
          const closesPrev = candles.slice(0, idx).map((c) => c.close);
          const closesCurr = candles.slice(0, idx + 1).map((c) => c.close);
          const rsiPrev = calcRSI(closesPrev);
          const rsiCurr = calcRSI(closesCurr);
          return (
            rsiPrev !== null && rsiCurr !== null && rsiPrev >= threshold && rsiCurr < threshold
          );
        },
      };
    }

    // RSI below X
    if (cond.indicator === "RSI" && cond.comparison === "below" && typeof cond.value === "number") {
      const threshold = cond.value;
      return {
        description: `RSI below ${threshold}`,
        check: (candles, idx) => {
          const closes = candles.slice(0, idx + 1).map((c) => c.close);
          const rsi = calcRSI(closes);
          return rsi !== null && rsi < threshold;
        },
      };
    }

    // Volume spike (> Nx average)
    if (cond.comparison === "spike" && typeof cond.value === "number") {
      const multiplier = cond.value;
      return {
        description: `Volume > ${multiplier}x average`,
        check: (candles, idx) => {
          const volumes = candles.slice(0, idx + 1).map((c) => c.volume);
          const volMA = calcVolumeMA(volumes, 20);
          const currentVol = volumes[volumes.length - 1];
          return volMA !== null && currentVol !== undefined && currentVol > volMA * multiplier;
        },
      };
    }

    // Volume above average
    if (desc.includes("volume") && (desc.includes("above") || desc.includes("greater"))) {
      // Try to extract multiplier
      const multMatch = desc.match(/(\d+(?:\.\d+)?)x/);
      const multiplier = multMatch ? parseFloat(multMatch[1]!) : 1;
      return {
        description: `Volume > ${multiplier}x 20-period average`,
        check: (candles, idx) => {
          const volumes = candles.slice(0, idx + 1).map((c) => c.volume);
          const volMA = calcVolumeMA(volumes, 20);
          const currentVol = volumes[volumes.length - 1];
          return volMA !== null && currentVol !== undefined && currentVol > volMA * multiplier;
        },
      };
    }

    // Price above/closes above N-period high (breakout)
    if (desc.includes("price") && desc.includes("above") && desc.includes("period high")) {
      const periodMatch = desc.match(/(\d+)-?period/);
      const period = periodMatch ? parseInt(periodMatch[1]!, 10) : 20;
      return {
        description: `Price closes above ${period}-period high`,
        check: (candles, idx) => {
          if (idx < period) return false;
          const highs = candles.slice(idx - period, idx).map((c) => c.high);
          const highest = Math.max(...highs);
          return candles[idx]!.close > highest;
        },
      };
    }

    // EMA crossover: EMA(X) crosses above EMA(Y)
    if (cond.indicator === "EMA" && cond.comparison === "crosses_above") {
      // Parse periods from description
      const emaMatch = desc.match(/ema\s*(\d+)\s*cross(?:es)?\s*above\s*ema\s*(\d+)/);
      if (emaMatch) {
        const fastPeriod = parseInt(emaMatch[1]!, 10);
        const slowPeriod = parseInt(emaMatch[2]!, 10);
        return {
          description: `EMA(${fastPeriod}) crosses above EMA(${slowPeriod})`,
          check: (candles, idx) => {
            if (idx < 1) return false;
            const closesPrev = candles.slice(0, idx).map((c) => c.close);
            const closesCurr = candles.slice(0, idx + 1).map((c) => c.close);
            const fastPrev = calcEMA(closesPrev, fastPeriod);
            const slowPrev = calcEMA(closesPrev, slowPeriod);
            const fastCurr = calcEMA(closesCurr, fastPeriod);
            const slowCurr = calcEMA(closesCurr, slowPeriod);
            if (fastPrev === null || slowPrev === null || fastCurr === null || slowCurr === null)
              return false;
            return fastPrev <= slowPrev && fastCurr > slowCurr;
          },
        };
      }
    }

    // Price above EMA (N) — trend alignment
    if (desc.includes("price") && desc.includes("above") && desc.includes("ema")) {
      const emaMatch = desc.match(/(\d+)\s*ema/);
      const period = emaMatch ? parseInt(emaMatch[1]!, 10) : 50;
      return {
        description: `Price above EMA(${period})`,
        check: (candles, idx) => {
          const closes = candles.slice(0, idx + 1).map((c) => c.close);
          const ema = calcEMA(closes, period);
          return ema !== null && candles[idx]!.close > ema;
        },
      };
    }

    // ADX above X
    if (desc.includes("adx") && desc.includes("above") && typeof cond.value === "number") {
      const threshold = cond.value;
      return {
        description: `ADX above ${threshold}`,
        check: (candles, idx) => {
          const candleSlice = candles.slice(0, idx + 1);
          const adx = calcADX(candleSlice);
          return adx !== null && adx > threshold;
        },
      };
    }

    // Price near support (within X%)
    if (desc.includes("support") || desc.includes("within")) {
      return {
        description: "Price near support level",
        check: (candles, idx) => {
          if (idx < 50) return false;
          // Simple support detection: look for recent lows that have bounced
          const lookback = Math.min(idx, 100);
          const lows = candles.slice(idx - lookback, idx).map((c) => c.low);
          const sortedLows = [...lows].sort((a, b) => a - b);
          // Take the 10th percentile as support zone
          const supportIdx = Math.floor(sortedLows.length * 0.1);
          const support = sortedLows[supportIdx] ?? sortedLows[0]!;
          const price = candles[idx]!.close;
          const distPercent = ((price - support) / support) * 100;
          return distPercent >= 0 && distPercent <= 3;
        },
      };
    }

    // Bollinger Band width (volatility check)
    if (desc.includes("bollinger") && desc.includes("width")) {
      return {
        description: "Bollinger Band width above 2%",
        check: (candles, idx) => {
          const closes = candles.slice(0, idx + 1).map((c) => c.close);
          const bb = calcBollingerBands(closes);
          return bb.width !== null && bb.width > 2;
        },
      };
    }

    return null;
  }

  // ============================================================================
  // Built-in Playbook Condition Sets
  // ============================================================================

  private getMomentumBreakoutConditions(): ParsedCondition[] {
    return [
      {
        description: "Price closes above 20-period high",
        check: (candles, idx) => {
          if (idx < 20) return false;
          const highs = candles.slice(idx - 20, idx).map((c) => c.high);
          const highest = Math.max(...highs);
          return candles[idx]!.close > highest;
        },
      },
      {
        description: "Volume > 2x 20-period average",
        check: (candles, idx) => {
          const volumes = candles.slice(0, idx + 1).map((c) => c.volume);
          const volMA = calcVolumeMA(volumes, 20);
          const currentVol = candles[idx]!.volume;
          return volMA !== null && currentVol > volMA * 2;
        },
      },
      {
        description: "RSI between 55 and 75",
        check: (candles, idx) => {
          const closes = candles.slice(0, idx + 1).map((c) => c.close);
          const rsi = calcRSI(closes);
          return rsi !== null && rsi >= 55 && rsi <= 75;
        },
      },
    ];
  }

  private getMeanReversionConditions(): ParsedCondition[] {
    return [
      {
        description: "RSI below 30 (oversold)",
        check: (candles, idx) => {
          const closes = candles.slice(0, idx + 1).map((c) => c.close);
          const rsi = calcRSI(closes);
          return rsi !== null && rsi < 30;
        },
      },
      {
        description: "Price near support (within 3%)",
        check: (candles, idx) => {
          if (idx < 50) return false;
          const lookback = Math.min(idx, 100);
          const lows = candles.slice(idx - lookback, idx).map((c) => c.low);
          const sortedLows = [...lows].sort((a, b) => a - b);
          const supportIdx = Math.floor(sortedLows.length * 0.1);
          const support = sortedLows[supportIdx] ?? sortedLows[0]!;
          const price = candles[idx]!.close;
          const distPercent = ((price - support) / support) * 100;
          return distPercent >= 0 && distPercent <= 3;
        },
      },
      {
        description: "Volume above 20-period average",
        check: (candles, idx) => {
          const volumes = candles.slice(0, idx + 1).map((c) => c.volume);
          const volMA = calcVolumeMA(volumes, 20);
          const currentVol = candles[idx]!.volume;
          return volMA !== null && currentVol > volMA;
        },
      },
    ];
  }

  private getTrendFollowingConditions(): ParsedCondition[] {
    return [
      {
        description: "EMA(9) crosses above EMA(21)",
        check: (candles, idx) => {
          if (idx < 1) return false;
          const closesPrev = candles.slice(0, idx).map((c) => c.close);
          const closesCurr = candles.slice(0, idx + 1).map((c) => c.close);
          const fast9Prev = calcEMA(closesPrev, 9);
          const slow21Prev = calcEMA(closesPrev, 21);
          const fast9Curr = calcEMA(closesCurr, 9);
          const slow21Curr = calcEMA(closesCurr, 21);
          if (
            fast9Prev === null ||
            slow21Prev === null ||
            fast9Curr === null ||
            slow21Curr === null
          )
            return false;
          return fast9Prev <= slow21Prev && fast9Curr > slow21Curr;
        },
      },
      {
        description: "ADX above 25",
        check: (candles, idx) => {
          const candleSlice = candles.slice(0, idx + 1);
          const adx = calcADX(candleSlice);
          return adx !== null && adx > 25;
        },
      },
      {
        description: "Price above EMA(50)",
        check: (candles, idx) => {
          const closes = candles.slice(0, idx + 1).map((c) => c.close);
          const ema50 = calcEMA(closes, 50);
          return ema50 !== null && candles[idx]!.close > ema50;
        },
      },
      {
        description: "Volume above 20-period average",
        check: (candles, idx) => {
          const volumes = candles.slice(0, idx + 1).map((c) => c.volume);
          const volMA = calcVolumeMA(volumes, 20);
          const currentVol = candles[idx]!.volume;
          return volMA !== null && currentVol > volMA;
        },
      },
    ];
  }

  // ============================================================================
  // Private: Playbook Metadata Extraction
  // ============================================================================

  private determineSide(): "long" | "short" {
    // All 3 built-in playbooks are long-only
    // Could extend based on playbook trigger descriptions
    const triggerDesc = this.playbook.trigger.description.toLowerCase();
    if (triggerDesc.includes("short") || triggerDesc.includes("sell")) {
      return "short";
    }
    return "long";
  }

  private parseStopLossPercent(): number {
    const sl = this.playbook.execution.stopLoss;
    // Percent field only: an ATR multiple read as a percent is a different
    // stop distance entirely.
    if (sl.percentValue !== undefined && sl.percentValue > 0) {
      return sl.percentValue;
    }
    // Default stop loss percentages by playbook type
    if (this.playbook.id === "momentum-breakout") return 1.5;
    if (this.playbook.id === "mean-reversion") return 1.5;
    if (this.playbook.id === "trend-following") return 2.0;
    return 2.0;
  }

  private parseTakeProfitMultiplier(): number {
    const tp = this.playbook.execution.takeProfit;
    if (tp.riskRewardRatio !== undefined && tp.riskRewardRatio > 0) {
      return tp.riskRewardRatio;
    }
    // Defaults
    if (this.playbook.id === "momentum-breakout") return 2.5;
    if (this.playbook.id === "mean-reversion") return 2.0;
    if (this.playbook.id === "trend-following") return 3.0;
    return 2.0;
  }

  private parseRiskPercent(): number {
    const sizing = this.playbook.execution.positionSizing;
    if (sizing.riskPercent !== undefined && sizing.riskPercent > 0) {
      return sizing.riskPercent;
    }
    return 1.0;
  }

  private hasTrailingStop(): boolean {
    // Check management rules for trailing stop references
    const rules = this.playbook.management.rules;
    return rules.some(
      (r) =>
        r.description.toLowerCase().includes("trail") ||
        r.description.toLowerCase().includes("breakeven") ||
        r.description.toLowerCase().includes("move stop"),
    );
  }
}
