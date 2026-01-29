/**
 * Stochastic RSI Indicator
 * Combines RSI with Stochastic for better overbought/oversold detection
 */

import { calculateRSI } from "./rsi.ts";

export interface StochasticRSIResult {
  k: (number | null)[];  // %K line (fast)
  d: (number | null)[];  // %D line (slow, signal)
  currentK: number | null;
  currentD: number | null;
  signal: "oversold" | "neutral" | "overbought";
  crossover: "bullish_cross" | "bearish_cross" | "none";
  action: "potential_buy" | "hold" | "potential_sell";
  interpretation: string;
}

/**
 * Calculate Stochastic RSI
 *
 * Stochastic RSI applies the Stochastic formula to RSI values instead of price.
 * This makes it more sensitive to overbought/oversold conditions.
 *
 * Formula:
 * StochRSI = (RSI - Lowest RSI) / (Highest RSI - Lowest RSI)
 * %K = SMA(StochRSI, smoothK)
 * %D = SMA(%K, smoothD)
 *
 * Signals:
 * - %K < 20: Oversold (potential buy)
 * - %K > 80: Overbought (potential sell)
 * - %K crosses above %D: Bullish crossover
 * - %K crosses below %D: Bearish crossover
 *
 * @param closes - Array of closing prices
 * @param rsiPeriod - RSI period (default 14)
 * @param stochPeriod - Stochastic lookback period (default 14)
 * @param smoothK - %K smoothing period (default 3)
 * @param smoothD - %D smoothing period (default 3)
 * @returns Stochastic RSI result
 */
export function calculateStochasticRSI(
  closes: number[],
  rsiPeriod: number = 14,
  stochPeriod: number = 14,
  smoothK: number = 3,
  smoothD: number = 3
): StochasticRSIResult {
  const minRequired = rsiPeriod + stochPeriod + smoothK + smoothD;

  if (closes.length < minRequired) {
    return {
      k: closes.map(() => null),
      d: closes.map(() => null),
      currentK: null,
      currentD: null,
      signal: "neutral",
      crossover: "none",
      action: "hold",
      interpretation: `Insufficient data for Stochastic RSI (need ${minRequired} periods)`,
    };
  }

  // Step 1: Calculate RSI values
  const rsiResult = calculateRSI(closes, rsiPeriod);
  const rsiValues = rsiResult.values;

  // Step 2: Apply Stochastic formula to RSI
  const stochRSI: (number | null)[] = [];

  for (let i = 0; i < rsiValues.length; i++) {
    if (i < rsiPeriod + stochPeriod - 1 || rsiValues[i] === null) {
      stochRSI.push(null);
      continue;
    }

    // Get RSI values for the lookback window
    const windowStart = i - stochPeriod + 1;
    const rsiWindow: number[] = [];

    for (let j = windowStart; j <= i; j++) {
      if (rsiValues[j] !== null) {
        rsiWindow.push(rsiValues[j]!);
      }
    }

    if (rsiWindow.length < stochPeriod) {
      stochRSI.push(null);
      continue;
    }

    const lowestRSI = Math.min(...rsiWindow);
    const highestRSI = Math.max(...rsiWindow);
    const rsiRange = highestRSI - lowestRSI;

    if (rsiRange === 0) {
      stochRSI.push(50); // Neutral if no range
    } else {
      const currentRSI = rsiValues[i]!;
      const stochValue = ((currentRSI - lowestRSI) / rsiRange) * 100;
      stochRSI.push(stochValue);
    }
  }

  // Step 3: Calculate %K (SMA of StochRSI)
  const kValues: (number | null)[] = [];

  for (let i = 0; i < stochRSI.length; i++) {
    if (i < smoothK - 1 || stochRSI[i] === null) {
      kValues.push(null);
      continue;
    }

    // Get window for smoothing
    const windowStart = i - smoothK + 1;
    let sum = 0;
    let count = 0;

    for (let j = windowStart; j <= i; j++) {
      if (stochRSI[j] !== null) {
        sum += stochRSI[j]!;
        count++;
      }
    }

    if (count === smoothK) {
      kValues.push(sum / count);
    } else {
      kValues.push(null);
    }
  }

  // Step 4: Calculate %D (SMA of %K)
  const dValues: (number | null)[] = [];

  for (let i = 0; i < kValues.length; i++) {
    if (i < smoothD - 1 || kValues[i] === null) {
      dValues.push(null);
      continue;
    }

    // Get window for smoothing
    const windowStart = i - smoothD + 1;
    let sum = 0;
    let count = 0;

    for (let j = windowStart; j <= i; j++) {
      if (kValues[j] !== null) {
        sum += kValues[j]!;
        count++;
      }
    }

    if (count === smoothD) {
      dValues.push(sum / count);
    } else {
      dValues.push(null);
    }
  }

  // Get current values
  const currentK = kValues[kValues.length - 1];
  const currentD = dValues[dValues.length - 1];
  const prevK = kValues[kValues.length - 2];
  const prevD = dValues[dValues.length - 2];

  // Determine signal
  let signal: "oversold" | "neutral" | "overbought" = "neutral";
  let action: "potential_buy" | "hold" | "potential_sell" = "hold";

  if (currentK !== null) {
    if (currentK < 20) {
      signal = "oversold";
      action = "potential_buy";
    } else if (currentK > 80) {
      signal = "overbought";
      action = "potential_sell";
    }
  }

  // Detect crossovers
  let crossover: "bullish_cross" | "bearish_cross" | "none" = "none";

  if (currentK !== null && currentD !== null && prevK !== null && prevD !== null) {
    // Bullish: %K crosses above %D
    if (prevK <= prevD && currentK > currentD) {
      crossover = "bullish_cross";
      if (currentK < 50) {
        action = "potential_buy";
      }
    }
    // Bearish: %K crosses below %D
    else if (prevK >= prevD && currentK < currentD) {
      crossover = "bearish_cross";
      if (currentK > 50) {
        action = "potential_sell";
      }
    }
  }

  // Generate interpretation
  let interpretation = "";
  if (currentK === null) {
    interpretation = "Insufficient data for Stochastic RSI";
  } else {
    const kStr = currentK.toFixed(1);
    const dStr = currentD?.toFixed(1) ?? "N/A";

    if (signal === "oversold") {
      interpretation = `StochRSI oversold (%K: ${kStr}, %D: ${dStr}) - potential reversal up`;
      if (crossover === "bullish_cross") {
        interpretation += ". BULLISH CROSSOVER - strong buy signal";
      }
    } else if (signal === "overbought") {
      interpretation = `StochRSI overbought (%K: ${kStr}, %D: ${dStr}) - potential reversal down`;
      if (crossover === "bearish_cross") {
        interpretation += ". BEARISH CROSSOVER - strong sell signal";
      }
    } else {
      interpretation = `StochRSI neutral (%K: ${kStr}, %D: ${dStr})`;
      if (crossover === "bullish_cross") {
        interpretation += " - bullish crossover, momentum shifting up";
      } else if (crossover === "bearish_cross") {
        interpretation += " - bearish crossover, momentum shifting down";
      }
    }
  }

  return {
    k: kValues,
    d: dValues,
    currentK,
    currentD,
    signal,
    crossover,
    action,
    interpretation,
  };
}
