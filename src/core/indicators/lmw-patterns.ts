/**
 * LMW Geometric Chart-Pattern Recognition
 * (Lo, Mamaysky & Wang 2000, "Foundations of Technical Analysis", §II)
 *
 * The paper's pattern-recognition algorithm: smooth the price series with a
 * Nadaraya–Watson Gaussian kernel regression, locate the local extrema of the
 * SMOOTHED series (so we ignore extrema that are "too local" — the failure
 * mode of detecting extrema on raw prices), then match each window of
 * consecutive extrema against the geometric definitions of 10 classic
 * patterns.
 *
 * Distinct from existing Gordon detectors:
 *   - `candlestick-patterns.ts` / `chartTools.detectPatterns` — single/triple
 *     CANDLE patterns (Doji, Hammer, Engulfing). Not multi-week geometry.
 *   - `nadaraya-watson.ts` — the SMOOTHER + envelope bands (overbought/sold),
 *     no extrema sequencing or pattern grammar. This module reuses the same
 *     kernel idea but adds the extrema → pattern pipeline.
 *   - `elliott-wave.ts` / `three-mountains-rivers.ts` — different pattern
 *     grammars (zigzag waves / Japanese three-peaks).
 *
 * Pairs with `core/alpha/conditional-distribution-test.ts` to answer the
 * paper's real question: does a detected pattern actually shift the return
 * distribution?
 *
 * The 10 patterns (each a sequence of 5 consecutive smoothed extrema, except
 * the doubles which use an initial extremum + the global sup/inf after it):
 *   HS / IHS   — head-and-shoulders / inverse
 *   BTOP/BBOT  — broadening top / bottom
 *   TTOP/TBOT  — triangle top / bottom
 *   RTOP/RBOT  — rectangle top / bottom
 *   DTOP/DBOT  — double top / bottom
 *
 * Pure functions.
 */

import type { Candle } from "./types.ts";

export type LmwPattern =
  | "HS"
  | "IHS"
  | "BTOP"
  | "BBOT"
  | "TTOP"
  | "TBOT"
  | "RTOP"
  | "RBOT"
  | "DTOP"
  | "DBOT";

export interface Extremum {
  /** Index into the price array. */
  index: number;
  /** Smoothed price at the extremum. */
  value: number;
  kind: "max" | "min";
}

export interface PatternMatch {
  pattern: LmwPattern;
  /** Human label. */
  label: string;
  /** Indices (into the price array) of the extrema that form the pattern. */
  extremaIndices: number[];
  /** First and last price-array index spanned by the pattern. */
  startIndex: number;
  endIndex: number;
}

export interface LmwPatternResult {
  /** The Nadaraya–Watson smoothed series (same length as input). */
  smoothed: number[];
  extrema: Extremum[];
  matches: PatternMatch[];
  bandwidth: number;
  interpretation: string;
}

const LABELS: Record<LmwPattern, string> = {
  HS: "head-and-shoulders",
  IHS: "inverse head-and-shoulders",
  BTOP: "broadening top",
  BBOT: "broadening bottom",
  TTOP: "triangle top",
  TBOT: "triangle bottom",
  RTOP: "rectangle top",
  RBOT: "rectangle bottom",
  DTOP: "double top",
  DBOT: "double bottom",
};

// ---------------------------------------------------------------------------
// Nadaraya–Watson smoothing (state variable = time index)
// ---------------------------------------------------------------------------

/**
 * Nadaraya–Watson kernel regression of prices on time, Gaussian kernel.
 * `bandwidth` is the kernel std-dev h (in index units). The paper uses
 * h = 0.3·h* where h* is cross-validation-optimal; here the caller tunes h
 * directly (smaller = follows price more closely; larger = smoother).
 */
export function nadarayaWatsonSmooth(prices: number[], bandwidth: number): number[] {
  const n = prices.length;
  const h = Math.max(bandwidth, 1e-9);
  const out: number[] = new Array(n);
  for (let i = 0; i < n; i++) {
    let wsum = 0;
    let vsum = 0;
    for (let j = 0; j < n; j++) {
      const u = (i - j) / h;
      const w = Math.exp(-0.5 * u * u);
      wsum += w;
      vsum += w * prices[j]!;
    }
    out[i] = wsum > 0 ? vsum / wsum : prices[i]!;
  }
  return out;
}

/**
 * Local extrema of the smoothed series, via sign changes of the discrete
 * first difference. The smoother guarantees the returned extrema strictly
 * alternate max/min. Endpoints are not reported as extrema.
 */
export function findAlternatingExtrema(smoothed: number[]): Extremum[] {
  const n = smoothed.length;
  const extrema: Extremum[] = [];
  if (n < 3) return extrema;

  const sign = (x: number): number => (x > 0 ? 1 : x < 0 ? -1 : 0);
  for (let i = 1; i < n - 1; i++) {
    const dPrev = sign(smoothed[i]! - smoothed[i - 1]!);
    let dNextIdx = i + 1;
    // Skip flats: find the next index where the value actually changes.
    while (dNextIdx < n && smoothed[dNextIdx]! === smoothed[i]!) dNextIdx++;
    if (dNextIdx >= n) break;
    const dNext = sign(smoothed[dNextIdx]! - smoothed[i]!);
    if (dPrev > 0 && dNext < 0) extrema.push({ index: i, value: smoothed[i]!, kind: "max" });
    else if (dPrev < 0 && dNext > 0) extrema.push({ index: i, value: smoothed[i]!, kind: "min" });
  }

  // Enforce strict alternation: if two consecutive same-kind extrema slip
  // through (flat regions), keep the more extreme of the pair.
  const cleaned: Extremum[] = [];
  for (const e of extrema) {
    const last = cleaned[cleaned.length - 1];
    if (last && last.kind === e.kind) {
      const keepNew = e.kind === "max" ? e.value > last.value : e.value < last.value;
      if (keepNew) cleaned[cleaned.length - 1] = e;
    } else {
      cleaned.push(e);
    }
  }
  return cleaned;
}

// ---------------------------------------------------------------------------
// Pattern grammar
// ---------------------------------------------------------------------------

/** |a − b| ≤ tolPct% of their average. */
function within(a: number, b: number, tolPct: number): boolean {
  const avg = (a + b) / 2;
  if (avg === 0) return Math.abs(a - b) <= tolPct / 100;
  return Math.abs(a - b) <= (tolPct / 100) * Math.abs(avg);
}

/**
 * Classify a window of 5 consecutive extrema (e1..e5) into the non-double
 * patterns. Returns null if no match. e1.kind determines top vs bottom
 * variants.
 */
function classifyFive(e: Extremum[]): LmwPattern | null {
  if (e.length !== 5) return null;
  const [e1, e2, e3, e4, e5] = e as [Extremum, Extremum, Extremum, Extremum, Extremum];
  const v1 = e1.value;
  const v2 = e2.value;
  const v3 = e3.value;
  const v4 = e4.value;
  const v5 = e5.value;

  if (e1.kind === "max") {
    // Tops: extrema are max,min,max,min,max.
    // Head-and-shoulders: middle peak highest, shoulders ~equal, troughs ~equal.
    if (v3 > v1 && v3 > v5 && within(v1, v5, 1.5) && within(v2, v4, 1.5)) return "HS";
    // Rectangle top: tops ~equal (0.75%), bottoms ~equal, lowest top > highest bottom.
    if (
      within(Math.min(v1, v3, v5), Math.max(v1, v3, v5), 0.75) &&
      within(Math.min(v2, v4), Math.max(v2, v4), 0.75) &&
      Math.min(v1, v3, v5) > Math.max(v2, v4)
    ) {
      return "RTOP";
    }
    // Broadening top: peaks rising, troughs falling (diverging).
    if (v1 < v3 && v3 < v5 && v2 > v4) return "BTOP";
    // Triangle top: peaks falling, troughs rising (converging).
    if (v1 > v3 && v3 > v5 && v2 < v4) return "TTOP";
  } else {
    // Bottoms: extrema are min,max,min,max,min.
    if (v3 < v1 && v3 < v5 && within(v1, v5, 1.5) && within(v2, v4, 1.5)) return "IHS";
    if (
      within(Math.min(v2, v4), Math.max(v2, v4), 0.75) &&
      within(Math.min(v1, v3, v5), Math.max(v1, v3, v5), 0.75) &&
      Math.min(v2, v4) > Math.max(v1, v3, v5)
    ) {
      return "RBOT";
    }
    // Broadening bottom: troughs falling, peaks rising.
    if (v1 > v3 && v3 > v5 && v2 < v4) return "BBOT";
    // Triangle bottom: troughs rising, peaks falling.
    if (v1 < v3 && v3 < v5 && v2 > v4) return "TBOT";
  }
  return null;
}

// ---------------------------------------------------------------------------
// Detection
// ---------------------------------------------------------------------------

export interface LmwPatternOptions {
  /**
   * Kernel bandwidth h. Default = max(2, round(0.1·n)). Smaller follows price
   * more closely (more extrema); larger smooths more (fewer extrema).
   */
  bandwidth?: number;
  /**
   * Minimum index separation for double tops/bottoms. Paper uses 22 trading
   * days (~1 month). Default 22.
   */
  doubleMinSeparation?: number;
}

/**
 * Detect the 10 LMW geometric patterns over a price series.
 */
export function detectLmwPatterns(
  prices: number[],
  options: LmwPatternOptions = {},
): LmwPatternResult {
  const n = prices.length;
  const bandwidth = options.bandwidth ?? Math.max(2, Math.round(0.1 * n));
  const minSep = options.doubleMinSeparation ?? 22;

  if (n < 10) {
    return {
      smoothed: [...prices],
      extrema: [],
      matches: [],
      bandwidth,
      interpretation: "Insufficient data for LMW pattern detection (need ≥10 prices).",
    };
  }

  const smoothed = nadarayaWatsonSmooth(prices, bandwidth);
  const extrema = findAlternatingExtrema(smoothed);
  const matches: PatternMatch[] = [];

  // Five-extrema window patterns (HS/IHS, broadening, triangle, rectangle).
  for (let i = 0; i + 5 <= extrema.length; i++) {
    const window = extrema.slice(i, i + 5);
    const pattern = classifyFive(window);
    if (pattern) {
      matches.push({
        pattern,
        label: LABELS[pattern],
        extremaIndices: window.map((e) => e.index),
        startIndex: window[0]!.index,
        endIndex: window[4]!.index,
      });
    }
  }

  // Double top / bottom: an initial extremum E1 and the global sup/inf among
  // later same-kind extrema, within 1.5% and ≥ minSep apart.
  for (let i = 0; i < extrema.length; i++) {
    const e1 = extrema[i]!;
    if (e1.kind === "max") {
      let best: Extremum | null = null;
      for (let j = i + 1; j < extrema.length; j++) {
        const ej = extrema[j]!;
        if (ej.kind !== "max") continue;
        if (ej.index - e1.index < minSep) continue;
        if (!best || ej.value > best.value) best = ej;
      }
      if (best && within(e1.value, best.value, 1.5)) {
        matches.push({
          pattern: "DTOP",
          label: LABELS.DTOP,
          extremaIndices: [e1.index, best.index],
          startIndex: e1.index,
          endIndex: best.index,
        });
      }
    } else {
      let best: Extremum | null = null;
      for (let j = i + 1; j < extrema.length; j++) {
        const ej = extrema[j]!;
        if (ej.kind !== "min") continue;
        if (ej.index - e1.index < minSep) continue;
        if (!best || ej.value < best.value) best = ej;
      }
      if (best && within(e1.value, best.value, 1.5)) {
        matches.push({
          pattern: "DBOT",
          label: LABELS.DBOT,
          extremaIndices: [e1.index, best.index],
          startIndex: e1.index,
          endIndex: best.index,
        });
      }
    }
  }

  const counts = new Map<LmwPattern, number>();
  for (const m of matches) counts.set(m.pattern, (counts.get(m.pattern) ?? 0) + 1);
  const summaryCounts = [...counts.entries()].map(([p, c]) => `${c}× ${LABELS[p]}`).join(", ");

  const interpretation =
    matches.length === 0
      ? `No LMW patterns over ${n} bars (h=${bandwidth}, ${extrema.length} smoothed extrema).`
      : `${matches.length} pattern(s) over ${n} bars (h=${bandwidth}, ${extrema.length} extrema): ${summaryCounts}.`;

  return { smoothed, extrema, matches, bandwidth, interpretation };
}

/** Convenience wrapper accepting candles (uses close prices). */
export function detectLmwPatternsFromCandles(
  candles: Candle[],
  options: LmwPatternOptions = {},
): LmwPatternResult {
  return detectLmwPatterns(
    candles.map((c) => c.close),
    options,
  );
}
