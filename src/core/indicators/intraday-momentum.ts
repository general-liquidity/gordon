/**
 * Market Intraday Momentum
 * Port of Gao, Han, Li & Zhou, "Market Intraday Momentum", Journal of
 * Financial Economics 129(2), 2018. Core finding: the return of the FIRST
 * half-hour of the trading session predicts the return of the LAST half-hour
 * (close), because the opening order imbalance persists into the close.
 *
 * This is a directional PREDICTOR — sign(first-window return) → sign(last-window
 * return) — not an opening-range BREAKOUT (which trades a break of the opening
 * range high/low), and not frog-in-the-pan momentum quality (which scores
 * multi-day return-path smoothness). Here the signal is purely the sign of the
 * session's first-window return.
 *
 * Return units: all returns (currentFirstReturn, meanLastGiven*) are DECIMAL
 * fractions, e.g. 0.012 == +1.2%. hitRate is a 0..1 fraction.
 */

import type { Candle } from "./types.ts";

export interface IntradayMomentumResult {
  signal: "long" | "short" | "flat";
  /** Latest session's first-window return as a decimal fraction (e.g. 0.012 = +1.2%), or null. */
  currentFirstReturn: number | null;
  /** Fraction (0..1) of complete days where sign(firstReturn) === sign(lastReturn), or null. */
  hitRate: number | null;
  sampleDays: number;
  /** Mean last-window return (decimal) on days with a positive first-window return, or null. */
  meanLastGivenPositiveFirst: number | null;
  /** Mean last-window return (decimal) on days with a negative first-window return, or null. */
  meanLastGivenNegativeFirst: number | null;
  firstWindowBars: number;
  predictWindowBars: number;
  interpretation: string;
}

const EPS = 1e-9;

/** Window return = (close[b] - open[a]) / open[a] over a slice of bars. */
function windowReturn(slice: Candle[]): number | null {
  if (slice.length === 0) return null;
  const open = slice[0]!.open;
  const close = slice[slice.length - 1]!.close;
  if (open == null || close == null || Math.abs(open) < EPS) return null;
  return (close - open) / open;
}

function neutral(firstWindowBars: number, predictWindowBars: number): IntradayMomentumResult {
  return {
    signal: "flat",
    currentFirstReturn: null,
    hitRate: null,
    sampleDays: 0,
    meanLastGivenPositiveFirst: null,
    meanLastGivenNegativeFirst: null,
    firstWindowBars,
    predictWindowBars,
    interpretation: "Insufficient data for intraday momentum",
  };
}

function signalFromReturn(r: number | null): "long" | "short" | "flat" {
  if (r == null) return "flat";
  if (r > EPS) return "long";
  if (r < -EPS) return "short";
  return "flat";
}

/**
 * Calculate Market Intraday Momentum.
 *
 * @param candles - Numeric OHLCV bars, time-ordered, no timestamp reliance (segmented by bar count).
 * @param opts.firstWindowBars - Bars in the predicting (open) window. Default 6.
 * @param opts.predictWindowBars - Bars in the predicted (close) window. Default 6.
 * @param opts.barsPerDay - Bars per session. If provided and ≥2 full days exist, cross-day stats are computed.
 * @returns IntradayMomentumResult. Returns are decimal fractions; hitRate is 0..1.
 */
export function calculateIntradayMomentum(
  candles: Candle[],
  opts?: { firstWindowBars?: number; predictWindowBars?: number; barsPerDay?: number },
): IntradayMomentumResult {
  const firstWindowBars = opts?.firstWindowBars ?? 6;
  const predictWindowBars = opts?.predictWindowBars ?? 6;
  const barsPerDay = opts?.barsPerDay;

  if (firstWindowBars < 1 || predictWindowBars < 1) {
    return neutral(firstWindowBars, predictWindowBars);
  }

  const minBars = firstWindowBars + predictWindowBars;

  // Single-session mode: treat the whole series as one day, no cross-day stats.
  if (barsPerDay == null) {
    if (candles.length < minBars) return neutral(firstWindowBars, predictWindowBars);
    const firstReturn = windowReturn(candles.slice(0, firstWindowBars));
    const signal = signalFromReturn(firstReturn);
    return {
      signal,
      currentFirstReturn: firstReturn == null ? null : parseFloat(firstReturn.toFixed(6)),
      hitRate: null,
      sampleDays: 0,
      meanLastGivenPositiveFirst: null,
      meanLastGivenNegativeFirst: null,
      firstWindowBars,
      predictWindowBars,
      interpretation:
        signal === "flat"
          ? "Single session: flat open window, no directional bias into the close"
          : `Single session: ${signal === "long" ? "positive" : "negative"} open window biases the rest of the session ${signal === "long" ? "up" : "down"} (intraday momentum)`,
    };
  }

  if (barsPerDay < minBars || candles.length < barsPerDay * 2) {
    return neutral(firstWindowBars, predictWindowBars);
  }

  const fullDays = Math.floor(candles.length / barsPerDay);

  // Cross-day stats over COMPLETE days only.
  let scored = 0;
  let hits = 0;
  let sumLastPos = 0;
  let countPos = 0;
  let sumLastNeg = 0;
  let countNeg = 0;

  for (let d = 0; d < fullDays; d++) {
    const start = d * barsPerDay;
    const day = candles.slice(start, start + barsPerDay);
    const firstReturn = windowReturn(day.slice(0, firstWindowBars));
    const lastReturn = windowReturn(day.slice(barsPerDay - predictWindowBars, barsPerDay));
    if (firstReturn == null || lastReturn == null) continue;
    if (Math.abs(firstReturn) <= EPS) continue; // ignore zero first-window days

    scored++;
    const sameSign = (firstReturn > 0 && lastReturn > 0) || (firstReturn < 0 && lastReturn < 0);
    if (sameSign) hits++;

    if (firstReturn > 0) {
      sumLastPos += lastReturn;
      countPos++;
    } else {
      sumLastNeg += lastReturn;
      countNeg++;
    }
  }

  const hitRate = scored > 0 ? parseFloat((hits / scored).toFixed(4)) : null;
  const meanLastGivenPositiveFirst =
    countPos > 0 ? parseFloat((sumLastPos / countPos).toFixed(6)) : null;
  const meanLastGivenNegativeFirst =
    countNeg > 0 ? parseFloat((sumLastNeg / countNeg).toFixed(6)) : null;

  // Latest (possibly partial) day's live signal.
  const latestStart = fullDays * barsPerDay;
  const latestDay = candles.slice(latestStart);
  // If the trailing partial day has no full first window yet, fall back to the
  // last complete day's open window for the live signal.
  let currentFirstReturn: number | null = null;
  if (latestDay.length >= firstWindowBars) {
    currentFirstReturn = windowReturn(latestDay.slice(0, firstWindowBars));
  } else {
    const lastFullStart = (fullDays - 1) * barsPerDay;
    const lastFull = candles.slice(lastFullStart, lastFullStart + barsPerDay);
    currentFirstReturn = windowReturn(lastFull.slice(0, firstWindowBars));
  }

  const signal = signalFromReturn(currentFirstReturn);
  const roundedCurrent =
    currentFirstReturn == null ? null : parseFloat(currentFirstReturn.toFixed(6));

  let interpretation: string;
  if (scored === 0) {
    interpretation =
      "No scored days (all first-window returns flat) — no intraday-momentum estimate";
  } else {
    const hitPct = hitRate == null ? "n/a" : `${(hitRate * 100).toFixed(0)}%`;
    const dir =
      signal === "long"
        ? "up into the close"
        : signal === "short"
          ? "down into the close"
          : "no directional";
    interpretation =
      signal === "flat"
        ? `Flat open window on latest session; first→last hit-rate ${hitPct} over ${scored} day(s)`
        : `Intraday-momentum ${signal}: ${signal === "long" ? "positive" : "negative"} open window predicts ${dir} (hit-rate ${hitPct} over ${scored} day(s))`;
  }

  return {
    signal,
    currentFirstReturn: roundedCurrent,
    hitRate,
    sampleDays: scored,
    meanLastGivenPositiveFirst,
    meanLastGivenNegativeFirst,
    firstWindowBars,
    predictWindowBars,
    interpretation,
  };
}
