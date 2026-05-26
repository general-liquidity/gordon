/**
 * Undercut-and-Rally Detector.
 *
 * Mirror of false-breakout in shape, opposite in semantics. Detects:
 * price briefly breaks BELOW a recent support, reclaims the level on
 * volume, and reverses higher within a small number of bars. The
 * setup shakes out weak hands then reverses — typically a tighter-risk
 * entry than a clean breakout because the stop sits just below the
 * undercut wick.
 *
 * Logic:
 *   - identify the rolling support over `srLookback`
 *   - check if any of the last `reclaimWindow` bars broke below support
 *     by at least `breakdownThresholdPct`
 *   - check if a later bar reclaimed the level by at least `reclaimMargin`
 *   - require volume on the reclaim bar to be ≥ `volumeMult` × avg
 *
 * Honest caveat: this pattern only works in markets with persistent
 * memory (run market_memory first). On a true random walk the undercut
 * is just noise.
 */

import type { Candle } from "./types.ts";

export interface UndercutRallyResult {
  /** True if an undercut-and-rally pattern was detected in the recent window. */
  detected: boolean;
  /** The support level that was undercut. */
  brokenSupport: number | null;
  /** The lowest price during the undercut. */
  undercutLow: number | null;
  /** The reclaim close that triggered the signal. */
  reclaimClose: number | null;
  /** Bars between the undercut bar and the reclaim bar. */
  reclaimLagBars: number;
  /** True when reclaim bar's volume exceeded the average. */
  volumeConfirmed: boolean;
  /** Confidence score 0-100. */
  confidence: number;
  interpretation: string;
}

export interface UndercutRallyParams {
  /** Lookback for support detection. Default 20. */
  srLookback?: number;
  /** Window in which an undercut + reclaim must occur. Default 5. */
  reclaimWindow?: number;
  /** Min undercut depth as fraction of support price. Default 0.005 (0.5%). */
  breakdownThresholdPct?: number;
  /** Min reclaim margin as fraction of support price. Default 0.002 (0.2%). */
  reclaimMargin?: number;
  /** Volume multiplier on reclaim bar vs lookback avg. Default 1.2. */
  volumeMult?: number;
}

const DEFAULTS = {
  srLookback: 20,
  reclaimWindow: 5,
  breakdownThresholdPct: 0.005,
  reclaimMargin: 0.002,
  volumeMult: 1.2,
} as const;

function mean(xs: number[]): number {
  if (xs.length === 0) return 0;
  let s = 0;
  for (const x of xs) s += x;
  return s / xs.length;
}

export function calculateUndercutRally(
  candles: Candle[],
  params: UndercutRallyParams = {},
): UndercutRallyResult {
  const srLookback = params.srLookback ?? DEFAULTS.srLookback;
  const reclaimWindow = params.reclaimWindow ?? DEFAULTS.reclaimWindow;
  const breakdownThresholdPct = params.breakdownThresholdPct ?? DEFAULTS.breakdownThresholdPct;
  const reclaimMargin = params.reclaimMargin ?? DEFAULTS.reclaimMargin;
  const volumeMult = params.volumeMult ?? DEFAULTS.volumeMult;

  const empty: UndercutRallyResult = {
    detected: false,
    brokenSupport: null,
    undercutLow: null,
    reclaimClose: null,
    reclaimLagBars: 0,
    volumeConfirmed: false,
    confidence: 0,
    interpretation: "Insufficient data for undercut-rally detection.",
  };

  if (candles.length < srLookback + reclaimWindow + 1) return empty;

  // Support = lowest low over the lookback ENDING just before the
  // reclaim window starts.
  const supportEnd = candles.length - reclaimWindow;
  const supportStart = Math.max(0, supportEnd - srLookback);
  const supportSlice = candles.slice(supportStart, supportEnd);
  let support = Infinity;
  for (const c of supportSlice) if (c.low < support) support = c.low;
  if (!Number.isFinite(support) || support <= 0) return empty;

  const recent = candles.slice(-reclaimWindow);
  const avgVol = mean(supportSlice.map((c) => c.volume));

  // Find the deepest undercut bar.
  let undercutIdx = -1;
  let undercutLow = Infinity;
  for (let i = 0; i < recent.length; i++) {
    const c = recent[i]!;
    if (c.low < support * (1 - breakdownThresholdPct) && c.low < undercutLow) {
      undercutIdx = i;
      undercutLow = c.low;
    }
  }
  if (undercutIdx === -1) {
    return { ...empty, brokenSupport: support, interpretation: "Support held — no undercut in window." };
  }

  // Find a later bar in the window that closed above support + margin.
  let reclaimIdx = -1;
  for (let i = undercutIdx + 1; i < recent.length; i++) {
    if (recent[i]!.close >= support * (1 + reclaimMargin)) {
      reclaimIdx = i;
      break;
    }
  }
  // Allow the undercut bar itself to BE the reclaim if it closed back up.
  if (reclaimIdx === -1 && recent[undercutIdx]!.close >= support * (1 + reclaimMargin)) {
    reclaimIdx = undercutIdx;
  }
  if (reclaimIdx === -1) {
    return {
      ...empty,
      brokenSupport: support,
      undercutLow,
      interpretation: `Undercut at ${undercutLow.toFixed(4)} but no reclaim of ${support.toFixed(4)} yet.`,
    };
  }

  const reclaimBar = recent[reclaimIdx]!;
  const volumeConfirmed = avgVol > 0 && reclaimBar.volume >= avgVol * volumeMult;
  const undercutDepth = (support - undercutLow) / support;
  const reclaimStrength = (reclaimBar.close - support) / support;

  // Confidence blends:
  //   - undercut depth (sweet spot 0.5–2%; too shallow = noise, too deep = breakdown)
  //   - reclaim strength (further above support = cleaner)
  //   - volume confirmation
  //   - lag (sooner is better; long lag is just a regular bounce)
  const depthScore = Math.max(0, 1 - Math.abs(undercutDepth - 0.01) / 0.02);
  const strengthScore = Math.min(1, reclaimStrength / 0.01);
  const volumeScore = volumeConfirmed ? 1 : 0.3;
  const lagBars = reclaimIdx - undercutIdx;
  const lagScore = Math.max(0.3, 1 - lagBars / reclaimWindow);
  const confidence = Math.round(
    100 * (depthScore * 0.3 + strengthScore * 0.3 + volumeScore * 0.25 + lagScore * 0.15),
  );

  return {
    detected: true,
    brokenSupport: support,
    undercutLow,
    reclaimClose: reclaimBar.close,
    reclaimLagBars: lagBars,
    volumeConfirmed,
    confidence,
    interpretation: `Undercut-and-rally: support ${support.toFixed(4)} broken to ${undercutLow.toFixed(4)} (-${(undercutDepth * 100).toFixed(2)}%), reclaimed at close ${reclaimBar.close.toFixed(4)} (+${(reclaimStrength * 100).toFixed(2)}%)${volumeConfirmed ? " with volume confirmation" : " on tepid volume"}. Confidence ${confidence}/100.`,
  };
}
