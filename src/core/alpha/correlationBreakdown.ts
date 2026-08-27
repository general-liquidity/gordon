/**
 * Cross-Symbol Correlation Breakdown Detector.
 *
 * Spot-market analog of "dispersion trading" — not the instrument
 * mechanism (which requires options), but the underlying signal: when
 * historical correlations decouple, that's information about regime
 * change or idiosyncratic catalysts.
 *
 * Use cases (Gordon-relevant, not toy):
 *   - BTC-ETH correlation drop → ETH-specific catalyst (likely L2 / DeFi
 *     news, regulatory action, exchange action)
 *   - BTC vs altcoin-basket decoupling → "BTC season" vs "alt season"
 *     regime shift
 *   - Sector decoupling (DeFi vs L1 vs gaming) → narrative rotation
 *   - Stock vs crypto correlation breaking → macro regime shift
 *
 * Pure detector. Pass in a map of symbol → return series; get back
 * per-pair Pearson correlation, baseline correlation, z-scored
 * deviation, and a severity verdict. Operator (or a producer) decides
 * what to do with the signal.
 *
 * Math:
 *   - Pearson correlation on log-return series (caller passes returns)
 *   - Current correlation: tail window (e.g. last 24h, configurable)
 *   - Baseline correlation: full series median (per pair, not z-scored)
 *     OR caller-supplied baseline
 *   - Deviation: (current - baseline) / baselineVolatility
 *     where baselineVolatility = stddev of (rolling baseline-window
 *     correlations) — gives a Z-score the caller can threshold
 *
 * Caller responsibilities:
 *   - Supply ALIGNED return series (same length, same time alignment)
 *   - Choose lookback windows appropriate for the asset / timeframe
 *   - Decide what to do with the verdict
 */

import { sampleCorrelation, populationStd } from "../stats/index.ts";

export interface ReturnSeries {
  /** Asset / symbol identifier (e.g. "BTC", "ETH"). */
  symbol: string;
  /**
   * Log returns ordered oldest → newest. All ReturnSeries passed
   * together MUST have the same length and the same time alignment;
   * the detector will not silently truncate or pad.
   */
  returns: ReadonlyArray<number>;
}

export type BreakdownSeverity = "stable" | "elevated" | "breakdown" | "regime_shift";

export interface PairCorrelation {
  symbolA: string;
  symbolB: string;
  /** Pearson correlation over the tail window (current). */
  currentCorr: number;
  /** Baseline correlation over the historical window. */
  baselineCorr: number;
  /** Signed deviation: currentCorr - baselineCorr. */
  delta: number;
  /**
   * Standardized deviation = delta / baselineCorrStddev. Roughly
   * "how many SDs is the current corr away from typical historical
   * variation in that pair's correlation?"
   *
   * Null when baseline stability can't be computed (window too short
   * or near-zero variance in the baseline-rolling series).
   */
  zScore: number | null;
  severity: BreakdownSeverity;
}

export interface BreakdownReport {
  /** Window sizes used. */
  tailWindow: number;
  baselineWindow: number;
  /** Number of return observations in each series. */
  observationCount: number;
  /** Per-pair results, sorted by |zScore| descending (nulls last). */
  pairs: PairCorrelation[];
  /** Number of pairs at severity "breakdown" or "regime_shift". */
  flaggedCount: number;
}

export interface BreakdownOptions {
  /**
   * Number of trailing observations to use for current correlation.
   * Default 24 — appropriate for 24×1h bars on a 1d horizon.
   */
  tailWindow?: number;
  /**
   * Number of trailing observations to use for baseline correlation.
   * Default 168 — appropriate for 1 week of 1h bars.
   */
  baselineWindow?: number;
  /**
   * Z-score thresholds for severity bucketing. Symmetric (positive
   * or negative z above threshold counts).
   *
   * Defaults: |z| > 1 = elevated, > 2 = breakdown, > 3 = regime_shift.
   */
  thresholds?: {
    elevated?: number;
    breakdown?: number;
    regimeShift?: number;
  };
}

const DEFAULT_TAIL_WINDOW = 24;
const DEFAULT_BASELINE_WINDOW = 168;
const DEFAULT_ELEVATED_Z = 1.0;
const DEFAULT_BREAKDOWN_Z = 2.0;
const DEFAULT_REGIME_SHIFT_Z = 3.0;

function pearson(x: ReadonlyArray<number>, y: ReadonlyArray<number>): number {
  if (x.length !== y.length) return 0;
  return sampleCorrelation([...x], [...y]);
}

function rollingCorrelations(
  x: ReadonlyArray<number>,
  y: ReadonlyArray<number>,
  window: number,
): number[] {
  if (x.length < window) return [];
  const out: number[] = [];
  for (let i = window; i <= x.length; i++) {
    const winX = x.slice(i - window, i);
    const winY = y.slice(i - window, i);
    out.push(pearson(winX, winY));
  }
  return out;
}

function stddev(arr: ReadonlyArray<number>): number {
  return populationStd([...arr]);
}

function classifySeverity(
  zScore: number | null,
  thresholds: { elevated: number; breakdown: number; regimeShift: number },
): BreakdownSeverity {
  if (zScore === null) return "stable";
  const a = Math.abs(zScore);
  if (a > thresholds.regimeShift) return "regime_shift";
  if (a > thresholds.breakdown) return "breakdown";
  if (a > thresholds.elevated) return "elevated";
  return "stable";
}

/**
 * Detect correlation breakdowns across a basket of symbols.
 *
 * The caller passes a list of (aligned) return series. The function
 * computes pairwise current vs baseline correlation, standardizes
 * the deviation by historical correlation variability, and buckets
 * into severity tiers.
 *
 * Pre-conditions checked:
 *   - At least 2 series
 *   - All series same length
 *   - Length >= baselineWindow (otherwise can't compute stable baseline)
 *
 * Returns a report. Callers can filter pairs by severity for alerts.
 */
export function detectCorrelationBreakdown(
  series: ReadonlyArray<ReturnSeries>,
  options: BreakdownOptions = {},
): BreakdownReport {
  const tailWindow = options.tailWindow ?? DEFAULT_TAIL_WINDOW;
  const baselineWindow = options.baselineWindow ?? DEFAULT_BASELINE_WINDOW;
  const thresholds = {
    elevated: options.thresholds?.elevated ?? DEFAULT_ELEVATED_Z,
    breakdown: options.thresholds?.breakdown ?? DEFAULT_BREAKDOWN_Z,
    regimeShift: options.thresholds?.regimeShift ?? DEFAULT_REGIME_SHIFT_Z,
  };

  if (series.length < 2) {
    return {
      tailWindow,
      baselineWindow,
      observationCount: series[0]?.returns.length ?? 0,
      pairs: [],
      flaggedCount: 0,
    };
  }

  const expectedLen = series[0]!.returns.length;
  for (const s of series) {
    if (s.returns.length !== expectedLen) {
      throw new Error(
        `detectCorrelationBreakdown: series '${s.symbol}' length ${s.returns.length} != expected ${expectedLen}. All return series must be aligned.`,
      );
    }
  }

  const pairs: PairCorrelation[] = [];

  for (let i = 0; i < series.length; i++) {
    for (let j = i + 1; j < series.length; j++) {
      const a = series[i]!;
      const b = series[j]!;
      const aRet = a.returns;
      const bRet = b.returns;

      // Tail (current) correlation
      const tailA = aRet.slice(Math.max(0, aRet.length - tailWindow));
      const tailB = bRet.slice(Math.max(0, bRet.length - tailWindow));
      const currentCorr = pearson(tailA, tailB);

      // Baseline correlation over the larger window
      const baseA = aRet.slice(Math.max(0, aRet.length - baselineWindow));
      const baseB = bRet.slice(Math.max(0, bRet.length - baselineWindow));
      const baselineCorr = pearson(baseA, baseB);

      // Standardize using rolling-correlation variability
      let zScore: number | null = null;
      if (baseA.length >= baselineWindow && tailWindow < baselineWindow) {
        const rolls = rollingCorrelations(baseA, baseB, tailWindow);
        const rollStd = stddev(rolls);
        if (rollStd > 1e-9) {
          zScore = (currentCorr - baselineCorr) / rollStd;
        }
      }

      pairs.push({
        symbolA: a.symbol,
        symbolB: b.symbol,
        currentCorr,
        baselineCorr,
        delta: currentCorr - baselineCorr,
        zScore,
        severity: classifySeverity(zScore, thresholds),
      });
    }
  }

  pairs.sort((p, q) => {
    const pz = p.zScore === null ? -Infinity : Math.abs(p.zScore);
    const qz = q.zScore === null ? -Infinity : Math.abs(q.zScore);
    return qz - pz;
  });

  const flaggedCount = pairs.filter(
    (p) => p.severity === "breakdown" || p.severity === "regime_shift",
  ).length;

  return {
    tailWindow,
    baselineWindow,
    observationCount: expectedLen,
    pairs,
    flaggedCount,
  };
}

/**
 * One-line operator summary listing the top N flagged pairs.
 */
export function summarizeBreakdownReport(report: BreakdownReport, topN = 3): string {
  if (report.pairs.length === 0) {
    return `Correlation breakdown: no pairs available (need ≥2 aligned return series).`;
  }
  if (report.flaggedCount === 0) {
    return `Correlation breakdown: ${report.pairs.length} pair${report.pairs.length === 1 ? "" : "s"} checked, all stable.`;
  }
  const top = report.pairs.slice(0, topN).map((p) => {
    const z = p.zScore === null ? "n/a" : p.zScore.toFixed(2);
    return `${p.symbolA}/${p.symbolB} z=${z} (${p.severity}, ${p.currentCorr.toFixed(2)} vs baseline ${p.baselineCorr.toFixed(2)})`;
  });
  return `Correlation breakdown: ${report.flaggedCount}/${report.pairs.length} flagged — ${top.join("; ")}.`;
}
