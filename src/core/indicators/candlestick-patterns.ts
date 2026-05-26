/**
 * Candlestick pattern detector — 12 canonical patterns.
 *
 * Pure shape detection. Each pattern is a rule over the most recent 1–3
 * candles. Trend context (was the prior move down? was the stock
 * trending?) is intentionally NOT applied here — those filters belong in
 * the calling skill, the regime detector, or the strategy implementation.
 * Hammer vs hanging-man are the same shape labelled differently by
 * preceding trend; we emit the shape name only.
 *
 * Patterns:
 *   - bullish_harami / bearish_harami      — 2-bar: smaller body inside prior larger body
 *   - bullish_engulfing / bearish_engulfing — 2-bar: current body fully wraps prior body
 *   - hammer / shooting_star                — 1-bar: long shadow opposite a small body
 *   - doji                                  — 1-bar: open ≈ close (indecision)
 *   - morning_star / evening_star           — 3-bar: pause + reversal
 *   - piercing_line / dark_cloud_cover      — 2-bar: deep penetration into prior body
 *   - inside_bar                            — 2-bar: bar fully inside prior range (compression)
 */

import type { Candle } from "./types.ts";

export type CandlestickPatternName =
  | "bullish_harami"
  | "bearish_harami"
  | "bullish_engulfing"
  | "bearish_engulfing"
  | "hammer"
  | "shooting_star"
  | "doji"
  | "morning_star"
  | "evening_star"
  | "piercing_line"
  | "dark_cloud_cover"
  | "inside_bar";

export const ALL_CANDLESTICK_PATTERNS: readonly CandlestickPatternName[] = [
  "bullish_harami",
  "bearish_harami",
  "bullish_engulfing",
  "bearish_engulfing",
  "hammer",
  "shooting_star",
  "doji",
  "morning_star",
  "evening_star",
  "piercing_line",
  "dark_cloud_cover",
  "inside_bar",
];

export interface CandlestickMatch {
  pattern: CandlestickPatternName;
  /** Index of the LAST bar of the pattern within the input array. */
  barIndex: number;
  /** 0..1 — how cleanly the shape held. */
  confidence: number;
  /** Bias the pattern carries by convention. inside_bar + doji are
   *  neutral; hammer/shooting_star carry their classical direction
   *  despite trend-context being absent. */
  direction: "bullish" | "bearish" | "neutral";
}

export interface CandlestickPatternsParams {
  /** Subset to scan. Defaults to all known patterns. */
  patterns?: CandlestickPatternName[];
  /** Bars to scan back from the latest. Default 20. */
  windowBars?: number;
  /** Doji body-to-range threshold. Default 0.05 (body ≤ 5% of range). */
  dojiBodyThresholdPct?: number;
  /** Shadow-to-body ratio for hammer / shooting-star. Default 2.0. */
  shadowToBodyRatio?: number;
}

export interface CandlestickPatternsResult {
  /** All matches found within the scan window, oldest first. */
  matches: CandlestickMatch[];
  /** Convenience: matches whose barIndex equals the last bar. */
  latestBarMatches: CandlestickMatch[];
}

const DEFAULT_WINDOW = 20;
const DEFAULT_DOJI_THRESHOLD = 0.05;
const DEFAULT_SHADOW_RATIO = 2.0;

// ---------------------------------------------------------------------
// Candle shape helpers
// ---------------------------------------------------------------------

interface Shape {
  body: number;
  range: number;
  upperShadow: number;
  lowerShadow: number;
  isBullish: boolean;
  isBearish: boolean;
}

function shape(c: Candle): Shape {
  const body = Math.abs(c.close - c.open);
  const range = Math.max(c.high - c.low, 0);
  const upperShadow = c.high - Math.max(c.open, c.close);
  const lowerShadow = Math.min(c.open, c.close) - c.low;
  return {
    body,
    range,
    upperShadow: Math.max(upperShadow, 0),
    lowerShadow: Math.max(lowerShadow, 0),
    isBullish: c.close > c.open,
    isBearish: c.close < c.open,
  };
}

function clamp01(x: number): number {
  if (!Number.isFinite(x)) return 0;
  if (x < 0) return 0;
  if (x > 1) return 1;
  return x;
}

// ---------------------------------------------------------------------
// Per-pattern checks. Each returns null when the pattern doesn't match
// or a confidence in (0, 1] when it does.
// ---------------------------------------------------------------------

function checkBullishHarami(prev: Candle, curr: Candle): number | null {
  const sp = shape(prev);
  const sc = shape(curr);
  if (!sp.isBearish) return null;
  if (sp.body <= 0) return null;
  // Current body fully inside prior body — bull harami uses prior open
  // (top of bearish body) as upper bound, prior close (bottom) as lower.
  const top = Math.max(prev.open, prev.close);
  const bot = Math.min(prev.open, prev.close);
  const currTop = Math.max(curr.open, curr.close);
  const currBot = Math.min(curr.open, curr.close);
  if (currTop > top || currBot < bot) return null;
  if (sc.body >= sp.body) return null;
  // Confidence = (prev_body - curr_body) / prev_body — larger
  // discrepancy = stronger contraction.
  return clamp01((sp.body - sc.body) / sp.body);
}

function checkBearishHarami(prev: Candle, curr: Candle): number | null {
  const sp = shape(prev);
  const sc = shape(curr);
  if (!sp.isBullish) return null;
  if (sp.body <= 0) return null;
  const top = Math.max(prev.open, prev.close);
  const bot = Math.min(prev.open, prev.close);
  const currTop = Math.max(curr.open, curr.close);
  const currBot = Math.min(curr.open, curr.close);
  if (currTop > top || currBot < bot) return null;
  if (sc.body >= sp.body) return null;
  return clamp01((sp.body - sc.body) / sp.body);
}

function checkBullishEngulfing(prev: Candle, curr: Candle): number | null {
  const sp = shape(prev);
  const sc = shape(curr);
  if (!sp.isBearish || !sc.isBullish) return null;
  if (sc.body <= 0) return null;
  // Curr body wraps prev body.
  if (curr.open > prev.close) return null; // curr opens above prev close → bullish but doesn't engulf
  if (curr.close < prev.open) return null;
  if (sc.body <= sp.body) return null;
  return clamp01((sc.body - sp.body) / sc.body);
}

function checkBearishEngulfing(prev: Candle, curr: Candle): number | null {
  const sp = shape(prev);
  const sc = shape(curr);
  if (!sp.isBullish || !sc.isBearish) return null;
  if (sc.body <= 0) return null;
  if (curr.open < prev.close) return null;
  if (curr.close > prev.open) return null;
  if (sc.body <= sp.body) return null;
  return clamp01((sc.body - sp.body) / sc.body);
}

function checkHammer(curr: Candle, shadowRatio: number): number | null {
  const s = shape(curr);
  if (s.range <= 0 || s.body <= 0) return null;
  if (s.lowerShadow < s.body * shadowRatio) return null;
  if (s.upperShadow > s.body) return null;
  // Body should sit in the upper portion of the range.
  if (s.body / s.range > 0.4) return null;
  // Confidence: how dominant the lower shadow is relative to the bar.
  return clamp01(s.lowerShadow / s.range);
}

function checkShootingStar(curr: Candle, shadowRatio: number): number | null {
  const s = shape(curr);
  if (s.range <= 0 || s.body <= 0) return null;
  if (s.upperShadow < s.body * shadowRatio) return null;
  if (s.lowerShadow > s.body) return null;
  if (s.body / s.range > 0.4) return null;
  return clamp01(s.upperShadow / s.range);
}

function checkDoji(curr: Candle, threshold: number): number | null {
  const s = shape(curr);
  if (s.range <= 0) return null;
  const bodyRatio = s.body / s.range;
  if (bodyRatio > threshold) return null;
  // Confidence: 1 at body=0, 0 at body=threshold*range.
  return clamp01(1 - bodyRatio / threshold);
}

function checkMorningStar(c1: Candle, c2: Candle, c3: Candle): number | null {
  const s1 = shape(c1);
  const s2 = shape(c2);
  const s3 = shape(c3);
  if (!s1.isBearish) return null;
  if (!s3.isBullish) return null;
  if (s1.body <= 0 || s3.body <= 0) return null;
  // Middle candle has a small body relative to the first.
  if (s2.body > s1.body * 0.5) return null;
  // Third candle closes well into the first candle's body.
  const c1Mid = (c1.open + c1.close) / 2;
  if (c3.close < c1Mid) return null;
  // Confidence: how deep the third closes into the first's body.
  const depth = (c3.close - c1Mid) / Math.max(c1.open - c1Mid, 1e-9);
  return clamp01(depth);
}

function checkEveningStar(c1: Candle, c2: Candle, c3: Candle): number | null {
  const s1 = shape(c1);
  const s2 = shape(c2);
  const s3 = shape(c3);
  if (!s1.isBullish) return null;
  if (!s3.isBearish) return null;
  if (s1.body <= 0 || s3.body <= 0) return null;
  if (s2.body > s1.body * 0.5) return null;
  const c1Mid = (c1.open + c1.close) / 2;
  if (c3.close > c1Mid) return null;
  const depth = (c1Mid - c3.close) / Math.max(c1Mid - c1.open, 1e-9);
  return clamp01(depth);
}

function checkPiercingLine(prev: Candle, curr: Candle): number | null {
  const sp = shape(prev);
  const sc = shape(curr);
  if (!sp.isBearish || !sc.isBullish) return null;
  if (sp.body <= 0) return null;
  // Open below prior low (gap down).
  if (curr.open >= prev.low) return null;
  const prevMid = (prev.open + prev.close) / 2;
  // Close above prior midpoint but below prior open.
  if (curr.close <= prevMid || curr.close >= prev.open) return null;
  // Confidence: how deep into the prior body the close went.
  return clamp01((curr.close - prevMid) / Math.max(prev.open - prevMid, 1e-9));
}

function checkDarkCloudCover(prev: Candle, curr: Candle): number | null {
  const sp = shape(prev);
  const sc = shape(curr);
  if (!sp.isBullish || !sc.isBearish) return null;
  if (sp.body <= 0) return null;
  if (curr.open <= prev.high) return null;
  const prevMid = (prev.open + prev.close) / 2;
  if (curr.close >= prevMid || curr.close <= prev.open) return null;
  return clamp01((prevMid - curr.close) / Math.max(prevMid - prev.open, 1e-9));
}

function checkInsideBar(prev: Candle, curr: Candle): number | null {
  if (curr.high >= prev.high) return null;
  if (curr.low <= prev.low) return null;
  const prevRange = prev.high - prev.low;
  const currRange = curr.high - curr.low;
  if (prevRange <= 0) return null;
  return clamp01((prevRange - currRange) / prevRange);
}

// ---------------------------------------------------------------------
// Pattern catalog — direction + arity + check function
// ---------------------------------------------------------------------

const TWO_BAR: ReadonlyArray<{
  name: CandlestickPatternName;
  direction: CandlestickMatch["direction"];
  check: (prev: Candle, curr: Candle) => number | null;
}> = [
  { name: "bullish_harami", direction: "bullish", check: checkBullishHarami },
  { name: "bearish_harami", direction: "bearish", check: checkBearishHarami },
  { name: "bullish_engulfing", direction: "bullish", check: checkBullishEngulfing },
  { name: "bearish_engulfing", direction: "bearish", check: checkBearishEngulfing },
  { name: "piercing_line", direction: "bullish", check: checkPiercingLine },
  { name: "dark_cloud_cover", direction: "bearish", check: checkDarkCloudCover },
  { name: "inside_bar", direction: "neutral", check: checkInsideBar },
];

const THREE_BAR: ReadonlyArray<{
  name: CandlestickPatternName;
  direction: CandlestickMatch["direction"];
  check: (c1: Candle, c2: Candle, c3: Candle) => number | null;
}> = [
  { name: "morning_star", direction: "bullish", check: checkMorningStar },
  { name: "evening_star", direction: "bearish", check: checkEveningStar },
];

export function detectCandlestickPatterns(
  candles: Candle[],
  params: CandlestickPatternsParams = {},
): CandlestickPatternsResult {
  if (!candles || candles.length === 0) {
    return { matches: [], latestBarMatches: [] };
  }
  const wanted = new Set<CandlestickPatternName>(
    params.patterns ?? ALL_CANDLESTICK_PATTERNS,
  );
  const windowBars = params.windowBars ?? DEFAULT_WINDOW;
  const dojiThreshold = params.dojiBodyThresholdPct ?? DEFAULT_DOJI_THRESHOLD;
  const shadowRatio = params.shadowToBodyRatio ?? DEFAULT_SHADOW_RATIO;

  const start = Math.max(0, candles.length - windowBars);
  const last = candles.length - 1;
  const matches: CandlestickMatch[] = [];

  for (let i = start; i <= last; i++) {
    const curr = candles[i]!;

    // 1-bar checks.
    if (wanted.has("hammer")) {
      const c = checkHammer(curr, shadowRatio);
      if (c != null) matches.push({ pattern: "hammer", barIndex: i, confidence: c, direction: "bullish" });
    }
    if (wanted.has("shooting_star")) {
      const c = checkShootingStar(curr, shadowRatio);
      if (c != null) matches.push({ pattern: "shooting_star", barIndex: i, confidence: c, direction: "bearish" });
    }
    if (wanted.has("doji")) {
      const c = checkDoji(curr, dojiThreshold);
      if (c != null) matches.push({ pattern: "doji", barIndex: i, confidence: c, direction: "neutral" });
    }

    // 2-bar checks.
    if (i >= 1) {
      const prev = candles[i - 1]!;
      for (const spec of TWO_BAR) {
        if (!wanted.has(spec.name)) continue;
        const c = spec.check(prev, curr);
        if (c != null) matches.push({ pattern: spec.name, barIndex: i, confidence: c, direction: spec.direction });
      }
    }

    // 3-bar checks.
    if (i >= 2) {
      const c1 = candles[i - 2]!;
      const c2 = candles[i - 1]!;
      for (const spec of THREE_BAR) {
        if (!wanted.has(spec.name)) continue;
        const c = spec.check(c1, c2, curr);
        if (c != null) matches.push({ pattern: spec.name, barIndex: i, confidence: c, direction: spec.direction });
      }
    }
  }

  const latestBarMatches = matches.filter((m) => m.barIndex === last);
  return { matches, latestBarMatches };
}
