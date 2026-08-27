/**
 * RSI 50-Midpoint Regime Suite (CryptoCred's "underused RSI" thesis)
 *
 * Reads the RSI 50 line — not overbought/oversold — three ways:
 *  1. BIAS: when most RSI action sits above 50, bulls are "in control" (and vice versa).
 *  2. DYNAMIC S/R: in a bullish regime the 50 line acts as support; in a bearish
 *     regime it acts as resistance. Held vs broke tests of 50 confirm/deny the regime.
 *  3. CONSOLIDATION: RSI chopping back and forth across 50 with small deviation =
 *     no edge / range-bound — the gauge that tells you to stand down.
 *
 * This is DISTINCT from plain RSI overbought/oversold (70/30) which lives elsewhere.
 * RSI is computed locally with Wilder smoothing (self-contained, no imports).
 */

export interface RsiMidpointResult {
  /** Wilder RSI period used */
  rsiPeriod: number;
  /** Effective lookback window over non-null RSI values */
  lookback: number;
  /** Most recent RSI value (null on insufficient data) */
  currentRsi: number | null;
  /** currentRsi - 50, rounded (null on insufficient data) */
  distanceFrom50: number | null;
  /** Fraction of lookback RSI values strictly above 50 (0..1) */
  pctAbove50: number;
  /** Regime bias from pctAbove50 */
  bias: "bullish" | "bearish" | "neutral";
  /** Count of (rsi-50) sign changes across the lookback */
  crossings: number;
  /** crossings / lookback */
  crossingsPerBar: number;
  /** Mean absolute deviation of RSI from 50 over the lookback (rounded) */
  meanAbsDevFrom50: number;
  /** True when RSI is chopping across 50 with no clear bias */
  consolidation: boolean;
  /** Most recent interaction with the 50 line, classified by regime */
  lastTest: "held_support" | "held_resistance" | "broke_support" | "broke_resistance" | "none";
  /** Human-readable summary */
  interpretation: string;
}

/** Wilder-smoothed RSI series. null during warmup. */
function wilderRsi(closes: number[], period: number): (number | null)[] {
  const out: (number | null)[] = closes.map(() => null);
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
    if (l === 0) return 100;
    const rs = g / l;
    return 100 - 100 / (1 + rs);
  };

  out[period] = parseFloat(rsiAt(avgGain, avgLoss).toFixed(2));

  for (let i = period + 1; i < closes.length; i++) {
    const change = closes[i]! - closes[i - 1]!;
    const gain = change >= 0 ? change : 0;
    const loss = change < 0 ? -change : 0;
    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;
    out[i] = parseFloat(rsiAt(avgGain, avgLoss).toFixed(2));
  }

  return out;
}

function neutralResult(rsiPeriod: number, lookback: number): RsiMidpointResult {
  return {
    rsiPeriod,
    lookback,
    currentRsi: null,
    distanceFrom50: null,
    pctAbove50: 0,
    bias: "neutral",
    crossings: 0,
    crossingsPerBar: 0,
    meanAbsDevFrom50: 0,
    consolidation: false,
    lastTest: "none",
    interpretation: "Insufficient data for RSI midpoint analysis",
  };
}

/**
 * Calculate the RSI 50-midpoint regime suite.
 *
 * @param closes - close-price series
 * @param opts.rsiPeriod - Wilder RSI period (default 14)
 * @param opts.lookback - window of recent non-null RSI values to analyze (default 50)
 */
export function calculateRsiMidpoint(
  closes: number[],
  opts?: { rsiPeriod?: number; lookback?: number },
): RsiMidpointResult {
  const rsiPeriod = opts?.rsiPeriod ?? 14;
  const requestedLookback = opts?.lookback ?? 50;

  if (closes.length < rsiPeriod + 2) {
    return neutralResult(rsiPeriod, requestedLookback);
  }

  const rsiSeries = wilderRsi(closes, rsiPeriod);
  const nonNull: number[] = [];
  for (const v of rsiSeries) {
    if (v != null) nonNull.push(v);
  }

  if (nonNull.length < 5) {
    return neutralResult(rsiPeriod, requestedLookback);
  }

  const lookback = Math.min(requestedLookback, nonNull.length);
  const window = nonNull.slice(nonNull.length - lookback);

  // 1. Bias
  let aboveCount = 0;
  let absDevSum = 0;
  for (const r of window) {
    if (r > 50) aboveCount++;
    absDevSum += Math.abs(r - 50);
  }
  const pctAbove50 = parseFloat((aboveCount / lookback).toFixed(4));
  let bias: "bullish" | "bearish" | "neutral" = "neutral";
  if (pctAbove50 >= 0.6) bias = "bullish";
  else if (pctAbove50 <= 0.4) bias = "bearish";

  // 2. Midline crossings (sign changes of rsi-50 across the window)
  let crossings = 0;
  for (let i = 1; i < window.length; i++) {
    const prev = window[i - 1]! - 50;
    const cur = window[i]! - 50;
    if (prev === 0 || cur === 0) continue;
    if (prev > 0 !== cur > 0) crossings++;
  }
  const crossingsPerBar = parseFloat((crossings / lookback).toFixed(4));

  // 3. Consolidation
  const meanAbsDevFrom50 = parseFloat((absDevSum / lookback).toFixed(2));
  const consolidation = crossingsPerBar >= 0.25 && meanAbsDevFrom50 <= 10;

  // currentRsi / distanceFrom50
  const currentRsi = window[window.length - 1]!;
  const distanceFrom50 = parseFloat((currentRsi - 50).toFixed(2));

  // 4. Dynamic S/R of the 50 line
  const lastTest = classifyLastTest(window, bias);

  const interpretation = buildInterpretation({
    bias,
    pctAbove50,
    consolidation,
    lastTest,
    currentRsi,
    distanceFrom50,
  });

  return {
    rsiPeriod,
    lookback,
    currentRsi,
    distanceFrom50,
    pctAbove50,
    bias,
    crossings,
    crossingsPerBar,
    meanAbsDevFrom50,
    consolidation,
    lastTest,
    interpretation,
  };
}

/**
 * Find the most recent bar where RSI came within ±5 of 50, then read the next
 * few bars: moving away in the bias direction = held; cleanly crossing through
 * against the bias = broke. 50 is support in a bullish regime, resistance in a
 * bearish regime. Neutral regime has no directional test → "none".
 */
function classifyLastTest(
  window: number[],
  bias: "bullish" | "bearish" | "neutral",
): RsiMidpointResult["lastTest"] {
  if (bias === "neutral") return "none";

  const band = 5;
  const followBars = 3;

  for (let i = window.length - 2; i >= 0; i--) {
    const r = window[i]!;
    if (Math.abs(r - 50) > band) continue;

    const end = Math.min(window.length - 1, i + followBars);
    const after = window[end]!;

    if (bias === "bullish") {
      // support at 50: holding = RSI back above 50; breaking = RSI below 50
      if (after > 50) return "held_support";
      if (after < 50) return "broke_support";
      return "none";
    }
    // bearish: resistance at 50: holding = RSI back below 50; breaking = above 50
    if (after < 50) return "held_resistance";
    if (after > 50) return "broke_resistance";
    return "none";
  }

  return "none";
}

function buildInterpretation(p: {
  bias: "bullish" | "bearish" | "neutral";
  pctAbove50: number;
  consolidation: boolean;
  lastTest: RsiMidpointResult["lastTest"];
  currentRsi: number;
  distanceFrom50: number;
}): string {
  const pct = Math.round(p.pctAbove50 * 100);
  const rsi = p.currentRsi.toFixed(1);

  if (p.consolidation) {
    return `RSI ${rsi} — CONSOLIDATION: RSI is chopping across the 50 line (~${pct}% of bars above 50) with small deviation. No clear edge; range-bound.`;
  }

  const dir = p.distanceFrom50 >= 0 ? "above" : "below";
  let head: string;
  if (p.bias === "bullish") {
    head = `RSI ${rsi} (${dir} 50) — BULLISH bias: ~${pct}% of recent RSI is above 50; bulls in control, treat 50 as support.`;
  } else if (p.bias === "bearish") {
    head = `RSI ${rsi} (${dir} 50) — BEARISH bias: ~${pct}% of recent RSI is above 50; bears in control, treat 50 as resistance.`;
  } else {
    head = `RSI ${rsi} (${dir} 50) — NEUTRAL bias: ~${pct}% of recent RSI is above 50; no decisive midline control.`;
  }

  let tail = "";
  switch (p.lastTest) {
    case "held_support":
      tail = " Last test of 50 HELD as support (regime confirmed).";
      break;
    case "broke_support":
      tail = " Last test BROKE 50 support (bullish regime in question).";
      break;
    case "held_resistance":
      tail = " Last test of 50 HELD as resistance (regime confirmed).";
      break;
    case "broke_resistance":
      tail = " Last test BROKE 50 resistance (bearish regime in question).";
      break;
    case "none":
      break;
  }

  return head + tail;
}
