/**
 * Highest-Volume-Ever (HVE) Detector
 *
 * Qullamaggie's institutional-conviction signal: when a stock gaps
 * up on volume that exceeds all prior bars in a defined window, real
 * money has just arrived. Three tiers:
 *
 *   HVE   = highest in the supplied series (lifetime if since-IPO)
 *   HV1   = highest in the trailing 252 bars (~1 year)
 *   HV_SHORT = highest in the trailing 60 bars (~3 months)
 *
 * Qualifiers (Qullamaggie's three-check filter):
 *   - Closing range ≥ 75% (buyers in control through the day)
 *   - Float < 150M (small enough to move fast) — optional
 *   - The bar IS a gap-up (open meaningfully above prior close)
 *
 * Distinct from:
 *   - `volume-trend.ts`     (slope; relative direction, not absolute level)
 *   - `usdVolumeGate.ts`    (threshold gate; doesn't compare to history)
 *   - `fake-liquidity.ts`   (move-per-dollar outliers; opposite signal)
 *
 * Composes with:
 *   - `analyze_vcp_contraction` (HVE OUT of a coil = best-case breakout)
 *   - `detect_streak`           (HVE breaking an extreme down-streak = bottom)
 *
 * Pure function.
 */

export interface HveCandle {
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface HveOptions {
  /** Bars in the "1-year" window. Default 252 (US equity trading days). */
  hv1WindowBars?: number;
  /** Bars in the "short" window. Default 60. */
  shortWindowBars?: number;
  /** Minimum closing-range % required for conviction. Default 0.75. */
  minClosingRange?: number;
  /** Optional float (shares outstanding). Default no float gate. */
  floatShares?: number;
  /** Maximum float for "fast mover" gate. Default 150_000_000. */
  maxFloat?: number;
  /** Minimum gap-up size as fraction of prior close. Default 0.02 (2%). */
  minGapFraction?: number;
}

export type HveVerdict = "hve" | "hv1" | "hv_short" | "not_hv" | "insufficient_data";
export type HveConviction = "high" | "medium" | "low" | "fail";

export interface HveResult {
  /** Latest bar (the one being tested). */
  latestVolume: number;
  /** Rank of latest bar within full lookback. 1 = highest. */
  ranks: {
    /** Rank among the full series. */
    overall: number;
    /** Rank within HV1 window. */
    inHv1Window: number;
    /** Rank within short window. */
    inShortWindow: number;
  };
  /** True iff latest is the maximum in the full series. */
  isHve: boolean;
  /** True iff latest is the maximum within HV1 window. */
  isHv1: boolean;
  /** True iff latest is the maximum within short window. */
  isHvShort: boolean;
  isGapUp: boolean;
  closingRange: number;
  closingRangePassed: boolean;
  floatGate: "passed" | "failed" | "not_supplied";
  verdict: HveVerdict;
  conviction: HveConviction;
  summary: string;
}

const DEFAULT_HV1_WINDOW = 252;
const DEFAULT_SHORT_WINDOW = 60;
const DEFAULT_MIN_CLOSING_RANGE = 0.75;
const DEFAULT_MAX_FLOAT = 150_000_000;
const DEFAULT_MIN_GAP_FRACTION = 0.02;

function computeRank(volumes: number[], targetIndex: number): number {
  const target = volumes[targetIndex]!;
  let strictlyHigher = 0;
  for (let i = 0; i < volumes.length; i++) {
    if (i === targetIndex) continue;
    if (volumes[i]! > target) strictlyHigher += 1;
  }
  return strictlyHigher + 1; // 1 = highest
}

function closingRangeOf(bar: HveCandle): number {
  const range = bar.high - bar.low;
  if (range <= 0) return 0;
  return (bar.close - bar.low) / range;
}

export function detectHighestVolume(
  bars: ReadonlyArray<HveCandle>,
  options: HveOptions = {},
): HveResult {
  const hv1Win = options.hv1WindowBars ?? DEFAULT_HV1_WINDOW;
  const shortWin = options.shortWindowBars ?? DEFAULT_SHORT_WINDOW;
  const minClosing = options.minClosingRange ?? DEFAULT_MIN_CLOSING_RANGE;
  const maxFloat = options.maxFloat ?? DEFAULT_MAX_FLOAT;
  const minGap = options.minGapFraction ?? DEFAULT_MIN_GAP_FRACTION;

  if (bars.length < 2) {
    return {
      latestVolume: bars[bars.length - 1]?.volume ?? 0,
      ranks: { overall: 0, inHv1Window: 0, inShortWindow: 0 },
      isHve: false,
      isHv1: false,
      isHvShort: false,
      isGapUp: false,
      closingRange: 0,
      closingRangePassed: false,
      floatGate: options.floatShares !== undefined ? "failed" : "not_supplied",
      verdict: "insufficient_data",
      conviction: "fail",
      summary: "Need at least 2 bars.",
    };
  }

  const latest = bars[bars.length - 1]!;
  const prior = bars[bars.length - 2]!;
  const allVolumes = bars.map((b) => b.volume);
  const latestIdx = bars.length - 1;

  const rankOverall = computeRank(allVolumes, latestIdx);
  const hv1Start = Math.max(0, latestIdx - hv1Win + 1);
  const hv1Slice = allVolumes.slice(hv1Start, latestIdx + 1);
  const rankInHv1 = computeRank(hv1Slice, hv1Slice.length - 1);
  const shortStart = Math.max(0, latestIdx - shortWin + 1);
  const shortSlice = allVolumes.slice(shortStart, latestIdx + 1);
  const rankInShort = computeRank(shortSlice, shortSlice.length - 1);

  const isHve = rankOverall === 1;
  const isHv1 = rankInHv1 === 1 && hv1Slice.length > 1;
  const isHvShort = rankInShort === 1 && shortSlice.length > 1;

  const closingRange = closingRangeOf(latest);
  const closingRangePassed = closingRange >= minClosing;

  const isGapUp = prior.close > 0 && (latest.open - prior.close) / prior.close >= minGap;

  let floatGate: HveResult["floatGate"] = "not_supplied";
  if (options.floatShares !== undefined) {
    floatGate = options.floatShares <= maxFloat ? "passed" : "failed";
  }

  // Verdict: best level we hit, regardless of gating
  let verdict: HveVerdict;
  if (isHve) verdict = "hve";
  else if (isHv1) verdict = "hv1";
  else if (isHvShort) verdict = "hv_short";
  else verdict = "not_hv";

  // Conviction: combines volume tier × closing range × float × gap-up
  let conviction: HveConviction;
  if (verdict === "not_hv") {
    conviction = "fail";
  } else {
    const gates: boolean[] = [closingRangePassed, isGapUp];
    if (floatGate === "passed") gates.push(true);
    else if (floatGate === "failed") gates.push(false);
    const passed = gates.filter(Boolean).length;
    if (verdict === "hve" && passed >= 2) conviction = "high";
    else if ((verdict === "hve" || verdict === "hv1") && passed >= 2) conviction = "high";
    else if (passed >= 1) conviction = "medium";
    else conviction = "low";
  }

  const summary =
    `Vol ${latest.volume.toLocaleString()} → rank ${rankOverall}/${bars.length} overall, ` +
    `${rankInHv1}/${hv1Slice.length} in HV1 window, ${rankInShort}/${shortSlice.length} in short window. ` +
    `Gap-up: ${isGapUp ? "yes" : "no"}, closing range ${(closingRange * 100).toFixed(0)}% ` +
    `(threshold ${(minClosing * 100).toFixed(0)}%), float: ${floatGate}. → ${verdict} / ${conviction}`;

  return {
    latestVolume: latest.volume,
    ranks: { overall: rankOverall, inHv1Window: rankInHv1, inShortWindow: rankInShort },
    isHve,
    isHv1,
    isHvShort,
    isGapUp,
    closingRange: parseFloat(closingRange.toFixed(4)),
    closingRangePassed,
    floatGate,
    verdict,
    conviction,
    summary,
  };
}

export function formatHighestVolume(result: HveResult): string {
  const lines = [
    `HVE Detector — ${result.verdict.toUpperCase()} (${result.conviction})`,
    "",
    `  Latest volume: ${result.latestVolume.toLocaleString()}`,
    `  Rank overall:  #${result.ranks.overall}`,
    `  Rank in HV1:   #${result.ranks.inHv1Window}`,
    `  Rank in short: #${result.ranks.inShortWindow}`,
    `  Gap-up: ${result.isGapUp ? "yes" : "no"}`,
    `  Closing range: ${(result.closingRange * 100).toFixed(0)}% ${result.closingRangePassed ? "✓" : "✗"}`,
    `  Float gate: ${result.floatGate}`,
    "",
    `Summary: ${result.summary}`,
  ];
  if (result.verdict === "hve" && result.conviction === "high") {
    lines.push("");
    lines.push("🚨 HVE with high conviction: institutional money just arrived.");
    lines.push("  The gap IS the new base. Trade the gap, not the old chart.");
  }
  return lines.join("\n");
}
