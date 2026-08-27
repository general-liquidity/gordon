/**
 * RSI Trendline Break
 * Treats the RSI series like a price chart and draws trendlines on it
 * (CryptoCred: "draw trendlines on RSI"). Fits a descending resistance line
 * through recent lower RSI pivot-highs and an ascending support line through
 * recent higher RSI pivot-lows, projects each to the last bar, and flags a
 * break when RSI closes through the projected line.
 *
 * Distinct from price trendlines (angled-market-structure.ts), which fit lines
 * on OHLC highs/lows, and from RSI divergence, which compares RSI swings against
 * price swings rather than the slope of RSI itself.
 */

export interface RsiTrendlineResult {
  breakout: "above_resistance" | "below_support" | "none";
  resistanceLine: { slope: number; valueAtLastBar: number; anchorBars: [number, number] } | null;
  supportLine: { slope: number; valueAtLastBar: number; anchorBars: [number, number] } | null;
  currentRsi: number | null;
  rsiPeriod: number;
  interpretation: string;
}

/**
 * Wilder-smoothed RSI. Returns an array aligned to closes; entries before the
 * first computable bar are null.
 */
function computeRsi(closes: number[], period: number): (number | null)[] {
  const out: (number | null)[] = new Array(closes.length).fill(null);
  if (closes.length < period + 1) return out;

  let gainSum = 0;
  let lossSum = 0;
  for (let i = 1; i <= period; i++) {
    const change = closes[i]! - closes[i - 1]!;
    if (change >= 0) gainSum += change;
    else lossSum += -change;
  }
  let avgGain = gainSum / period;
  let avgLoss = lossSum / period;

  const rsiAt = (g: number, l: number): number => {
    if (l < 1e-12) return 100;
    const rs = g / l;
    return 100 - 100 / (1 + rs);
  };

  out[period] = rsiAt(avgGain, avgLoss);

  for (let i = period + 1; i < closes.length; i++) {
    const change = closes[i]! - closes[i - 1]!;
    const gain = change >= 0 ? change : 0;
    const loss = change < 0 ? -change : 0;
    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;
    out[i] = rsiAt(avgGain, avgLoss);
  }

  return out;
}

/**
 * Pivot highs on the RSI series: bar is the strict max over a ±window range.
 */
function findRsiPivotHighs(
  rsi: (number | null)[],
  window: number,
): { value: number; bar: number }[] {
  const pivots: { value: number; bar: number }[] = [];
  for (let i = window; i < rsi.length - window; i++) {
    const center = rsi[i];
    if (center == null) continue;
    let isHighest = true;
    for (let j = i - window; j <= i + window; j++) {
      const v = rsi[j];
      if (v == null) {
        isHighest = false;
        break;
      }
      if (j !== i && v >= center) {
        isHighest = false;
        break;
      }
    }
    if (isHighest) pivots.push({ value: center, bar: i });
  }
  return pivots;
}

/**
 * Pivot lows on the RSI series: bar is the strict min over a ±window range.
 */
function findRsiPivotLows(
  rsi: (number | null)[],
  window: number,
): { value: number; bar: number }[] {
  const pivots: { value: number; bar: number }[] = [];
  for (let i = window; i < rsi.length - window; i++) {
    const center = rsi[i];
    if (center == null) continue;
    let isLowest = true;
    for (let j = i - window; j <= i + window; j++) {
      const v = rsi[j];
      if (v == null) {
        isLowest = false;
        break;
      }
      if (j !== i && v <= center) {
        isLowest = false;
        break;
      }
    }
    if (isLowest) pivots.push({ value: center, bar: i });
  }
  return pivots;
}

/**
 * Calculate RSI trendline breaks.
 *
 * @param closes - Close-price series
 * @param opts.rsiPeriod - Wilder RSI period (default 14)
 * @param opts.pivotWindow - ±window for RSI pivot detection (default 2)
 */
export function calculateRsiTrendline(
  closes: number[],
  opts?: { rsiPeriod?: number; pivotWindow?: number },
): RsiTrendlineResult {
  const rsiPeriod = opts?.rsiPeriod ?? 14;
  const pivotWindow = opts?.pivotWindow ?? 2;

  const insufficient: RsiTrendlineResult = {
    breakout: "none",
    resistanceLine: null,
    supportLine: null,
    currentRsi: null,
    rsiPeriod,
    interpretation: "Insufficient data for RSI trendline",
  };

  // Need RSI warmup plus enough room to find two pivots and project past them.
  if (closes.length < rsiPeriod + pivotWindow * 2 + 4) return insufficient;

  const rsi = computeRsi(closes, rsiPeriod);
  const lastBar = rsi.length - 1;
  const currentRsiRaw = rsi[lastBar];
  if (currentRsiRaw == null) return insufficient;
  const currentRsi = parseFloat(currentRsiRaw.toFixed(2));

  const pivotHighs = findRsiPivotHighs(rsi, pivotWindow);
  const pivotLows = findRsiPivotLows(rsi, pivotWindow);

  // Resistance: most recent two pivot highs that descend (lower highs).
  // Anchor on the latest pivot high; walk back for a strictly-higher earlier one.
  let resistanceLine: RsiTrendlineResult["resistanceLine"] = null;
  if (pivotHighs.length >= 2) {
    const recent = pivotHighs[pivotHighs.length - 1]!;
    for (let k = pivotHighs.length - 2; k >= 0; k--) {
      const earlier = pivotHighs[k]!;
      if (earlier.value > recent.value) {
        const slope = (recent.value - earlier.value) / (recent.bar - earlier.bar);
        const valueAtLastBar = recent.value + slope * (lastBar - recent.bar);
        resistanceLine = {
          slope: parseFloat(slope.toFixed(4)),
          valueAtLastBar: parseFloat(valueAtLastBar.toFixed(2)),
          anchorBars: [earlier.bar, recent.bar],
        };
        break;
      }
    }
  }

  // Support: most recent two pivot lows that ascend (higher lows).
  let supportLine: RsiTrendlineResult["supportLine"] = null;
  if (pivotLows.length >= 2) {
    const recent = pivotLows[pivotLows.length - 1]!;
    for (let k = pivotLows.length - 2; k >= 0; k--) {
      const earlier = pivotLows[k]!;
      if (earlier.value < recent.value) {
        const slope = (recent.value - earlier.value) / (recent.bar - earlier.bar);
        const valueAtLastBar = recent.value + slope * (lastBar - recent.bar);
        supportLine = {
          slope: parseFloat(slope.toFixed(4)),
          valueAtLastBar: parseFloat(valueAtLastBar.toFixed(2)),
          anchorBars: [earlier.bar, recent.bar],
        };
        break;
      }
    }
  }

  // Break detection: RSI closing above projected descending resistance = bullish,
  // closing below projected ascending support = bearish. Resistance takes priority.
  let breakout: RsiTrendlineResult["breakout"] = "none";
  if (resistanceLine !== null && currentRsiRaw > resistanceLine.valueAtLastBar) {
    breakout = "above_resistance";
  } else if (supportLine !== null && currentRsiRaw < supportLine.valueAtLastBar) {
    breakout = "below_support";
  }

  let interpretation: string;
  if (breakout === "above_resistance") {
    interpretation =
      `Bullish RSI-trendline break: RSI ${currentRsi} closed above descending ` +
      `resistance line (projected ${resistanceLine!.valueAtLastBar}).`;
  } else if (breakout === "below_support") {
    interpretation =
      `Bearish RSI-trendline break: RSI ${currentRsi} closed below ascending ` +
      `support line (projected ${supportLine!.valueAtLastBar}).`;
  } else {
    const parts: string[] = [`RSI ${currentRsi}, no trendline break.`];
    if (resistanceLine !== null) {
      parts.push(`Descending resistance at ${resistanceLine.valueAtLastBar}.`);
    }
    if (supportLine !== null) {
      parts.push(`Ascending support at ${supportLine.valueAtLastBar}.`);
    }
    if (resistanceLine === null && supportLine === null) {
      parts.push("No qualifying RSI trendlines found.");
    }
    interpretation = parts.join(" ");
  }

  return {
    breakout,
    resistanceLine,
    supportLine,
    currentRsi,
    rsiPeriod,
    interpretation,
  };
}
