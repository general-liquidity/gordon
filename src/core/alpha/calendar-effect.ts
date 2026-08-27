/**
 * Calendar Effect Analyzer
 *
 * Segments a time series of returns by a calendar attribute (day of
 * week, day of month, month of year, quarter, hour of day, etc.) and
 * reports per-segment mean + std + t-statistic + approximate p-value
 * + Wilson CI on positive-return rate + sample-size significance
 * tier.
 *
 * Operator-facing answer to "does my asset have a Tuesday-rebound
 * effect / January effect / end-of-month effect?" — checkable
 * directly without per-strategy bespoke backtest code.
 *
 * Pure function over a `{timestamp, return}` array. No I/O.
 *
 * Composes with:
 *   - `expectancy-by-tag` shares the same shape; both build on
 *     segmenter + Wilson CI primitives
 *   - `walk-forward-ic` for stability — calendar effects often look
 *     present in-sample but fail walk-forward
 *   - `too-good-check` should fire on any segment with implausibly
 *     high t-stat (>3) given retail single-operator scale
 *
 * Honest framing — calendar effects are notorious for in-sample
 * data mining. The Wilson CI + significance tier surface lets the
 * operator see "this effect has p<0.05 but n=12, so 1 lucky month
 * each year for 12 years" vs "p<0.001 and n=2500, robust signal."
 */

import { wilsonInterval } from "../../infra/safety/expectancyByTag.ts";
import { normalCdf } from "../numerics/index.ts";

export type CalendarSegmenter =
  | "day_of_week"
  | "day_of_month"
  | "week_of_month"
  | "month_of_year"
  | "quarter"
  | "hour_of_day"
  | "iso_year_week";

export interface CalendarReturn {
  /** Unix milliseconds. */
  timestamp: number;
  /** Period return as decimal (e.g. 0.012 for 1.2%). */
  return: number;
}

export interface CalendarEffectOptions {
  /** Built-in segmenter or operator-supplied function returning a segment label. */
  segment: CalendarSegmenter | ((d: Date) => string);
  /** Minimum sample size for "robust" tier. Default 100. */
  robustThreshold?: number;
  /** Minimum sample size for "preliminary" tier. Default 30. */
  preliminaryThreshold?: number;
  /** Two-sided p-value below which segment mean is flagged significant. Default 0.05. */
  significanceThreshold?: number;
  /** Use UTC for date parsing (default true). When false, uses local time of the host. */
  useUtc?: boolean;
}

export type SegmentSignificanceTier = "robust" | "preliminary" | "insufficient";

export interface SegmentStats {
  segment: string;
  sampleSize: number;
  meanReturn: number;
  stdReturn: number;
  /** Mean / (std / sqrt(n)) — t-statistic under null of zero mean. */
  tStat: number;
  /** Approximate two-sided p-value. */
  pValue: number;
  /** Fraction of segment returns that were positive. */
  positiveRate: number;
  /** 95% Wilson CI on positive-rate. */
  positiveRateCi95: { lower: number; upper: number };
  significance: SegmentSignificanceTier;
  /** True when |t| ≥ significance threshold AND sample size meets preliminary tier. */
  significantlyNonZero: boolean;
}

export interface CalendarEffectReport {
  totalObservations: number;
  segmentCount: number;
  segments: SegmentStats[];
  /** Segment with the largest |mean × sqrt(n)| (effect × sample-size-weighting). Null when no segments. */
  strongestEffect: SegmentStats | null;
  /** Segments where significantlyNonZero is true. */
  significantSegments: SegmentStats[];
  summary: string;
}

// ============================================================================
// Helpers
// ============================================================================

const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTH_NAMES = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

function buildSegmenter(
  segmenter: CalendarSegmenter | ((d: Date) => string),
  useUtc: boolean,
): (d: Date) => string {
  if (typeof segmenter === "function") return segmenter;

  if (useUtc) {
    switch (segmenter) {
      case "day_of_week":
        return (d) => DAY_NAMES[d.getUTCDay()]!;
      case "day_of_month":
        return (d) => String(d.getUTCDate()).padStart(2, "0");
      case "week_of_month":
        return (d) => `W${Math.ceil(d.getUTCDate() / 7)}`;
      case "month_of_year":
        return (d) => MONTH_NAMES[d.getUTCMonth()]!;
      case "quarter":
        return (d) => `Q${Math.floor(d.getUTCMonth() / 3) + 1}`;
      case "hour_of_day":
        return (d) => `${String(d.getUTCHours()).padStart(2, "0")}h`;
      case "iso_year_week":
        return (d) => isoYearWeek(d, true);
    }
  } else {
    switch (segmenter) {
      case "day_of_week":
        return (d) => DAY_NAMES[d.getDay()]!;
      case "day_of_month":
        return (d) => String(d.getDate()).padStart(2, "0");
      case "week_of_month":
        return (d) => `W${Math.ceil(d.getDate() / 7)}`;
      case "month_of_year":
        return (d) => MONTH_NAMES[d.getMonth()]!;
      case "quarter":
        return (d) => `Q${Math.floor(d.getMonth() / 3) + 1}`;
      case "hour_of_day":
        return (d) => `${String(d.getHours()).padStart(2, "0")}h`;
      case "iso_year_week":
        return (d) => isoYearWeek(d, false);
    }
  }
  // Exhaustive — TS will complain if a case is missed
  return () => "unknown";
}

/**
 * ISO 8601 year-week identifier (e.g. "2026-W21"). Useful for testing
 * "week-of-year" effects vs. naive month-of-year, since ISO weeks
 * align with Mon-Sun and handle year-boundary edge cases.
 */
function isoYearWeek(d: Date, useUtc: boolean): string {
  // Get the target date and shift to nearest Thursday (ISO week convention)
  const target = new Date(useUtc ? d.getTime() : d.getTime());
  const day = useUtc ? target.getUTCDay() : target.getDay();
  // Convert Sun=0..Sat=6 to Mon=0..Sun=6
  const isoDay = (day + 6) % 7;
  const shifted = new Date(target.getTime() - isoDay * 86400000 + 3 * 86400000);
  const year = useUtc ? shifted.getUTCFullYear() : shifted.getFullYear();
  const firstThursday = new Date(Date.UTC(year, 0, 4));
  const firstThursdayDay = (firstThursday.getUTCDay() + 6) % 7;
  firstThursday.setUTCDate(firstThursday.getUTCDate() - firstThursdayDay + 3);
  const weekNumber = Math.round((shifted.getTime() - firstThursday.getTime()) / (7 * 86400000)) + 1;
  return `${year}-W${String(weekNumber).padStart(2, "0")}`;
}

function sampleMean(values: number[]): number {
  if (values.length === 0) return 0;
  let s = 0;
  for (const v of values) s += v;
  return s / values.length;
}

function sampleStd(values: number[]): number {
  if (values.length < 2) return 0;
  const m = sampleMean(values);
  let sumSq = 0;
  for (const v of values) sumSq += (v - m) * (v - m);
  return Math.sqrt(sumSq / (values.length - 1));
}

/**
 * Two-sided p-value from a t-statistic, normal approximation
 * (acceptable for n ≥ 30; for smaller samples the segment is
 * flagged "insufficient" anyway).
 */
function twoSidedPValue(t: number): number {
  return 2 * (1 - normalCdf(Math.abs(t)));
}

// ============================================================================
// Public API
// ============================================================================

const DEFAULT_ROBUST = 100;
const DEFAULT_PRELIMINARY = 30;
const DEFAULT_SIGNIFICANCE = 0.05;

export function analyzeCalendarEffect(
  returns: CalendarReturn[],
  options: CalendarEffectOptions,
): CalendarEffectReport {
  const useUtc = options.useUtc ?? true;
  const robustThreshold = options.robustThreshold ?? DEFAULT_ROBUST;
  const preliminaryThreshold = options.preliminaryThreshold ?? DEFAULT_PRELIMINARY;
  const sigThreshold = options.significanceThreshold ?? DEFAULT_SIGNIFICANCE;
  const segFn = buildSegmenter(options.segment, useUtc);

  // Bucket returns by segment
  const bySegment = new Map<string, number[]>();
  for (const obs of returns) {
    if (!Number.isFinite(obs.return)) continue;
    const d = new Date(obs.timestamp);
    if (Number.isNaN(d.getTime())) continue;
    const seg = segFn(d);
    let bucket = bySegment.get(seg);
    if (!bucket) {
      bucket = [];
      bySegment.set(seg, bucket);
    }
    bucket.push(obs.return);
  }

  // Per-segment stats
  const segments: SegmentStats[] = [];
  for (const [segment, values] of bySegment) {
    const n = values.length;
    const meanReturn = sampleMean(values);
    const std = sampleStd(values);
    const se = n > 0 && std > 0 ? std / Math.sqrt(n) : 0;
    const tStat = se > 0 ? meanReturn / se : 0;
    const pValue = se > 0 ? twoSidedPValue(tStat) : 1;
    const positiveCount = values.filter((v) => v > 0).length;
    const positiveRate = n > 0 ? positiveCount / n : 0;

    let significance: SegmentSignificanceTier;
    if (n >= robustThreshold) significance = "robust";
    else if (n >= preliminaryThreshold) significance = "preliminary";
    else significance = "insufficient";

    const significantlyNonZero = pValue < sigThreshold && significance !== "insufficient";

    segments.push({
      segment,
      sampleSize: n,
      meanReturn: parseFloat(meanReturn.toFixed(8)),
      stdReturn: parseFloat(std.toFixed(8)),
      tStat: parseFloat(tStat.toFixed(4)),
      pValue: parseFloat(pValue.toFixed(6)),
      positiveRate: parseFloat(positiveRate.toFixed(4)),
      positiveRateCi95: wilsonInterval(positiveCount, n),
      significance,
      significantlyNonZero,
    });
  }

  // Sort by effect × sqrt(n) descending for operator readability
  segments.sort((a, b) => {
    const scoreA = Math.abs(a.meanReturn) * Math.sqrt(a.sampleSize);
    const scoreB = Math.abs(b.meanReturn) * Math.sqrt(b.sampleSize);
    return scoreB - scoreA;
  });

  const strongestEffect = segments.length > 0 ? segments[0]! : null;
  const significantSegments = segments.filter((s) => s.significantlyNonZero);

  const totalObservations = returns.length;
  const summary =
    `${totalObservations} observations across ${segments.length} segments. ` +
    (strongestEffect
      ? `Strongest effect: ${strongestEffect.segment} mean=${(strongestEffect.meanReturn * 100).toFixed(3)}%, t=${strongestEffect.tStat.toFixed(2)}, n=${strongestEffect.sampleSize} (${strongestEffect.significance}). `
      : "") +
    `${significantSegments.length} segment(s) significantly non-zero at p<${sigThreshold}.`;

  return {
    totalObservations,
    segmentCount: segments.length,
    segments,
    strongestEffect,
    significantSegments,
    summary,
  };
}

/**
 * Render operator-readable text. One row per segment with sample
 * size + mean + t-stat + p-value + positive-rate CI + significance
 * marker.
 */
export function formatCalendarEffect(report: CalendarEffectReport): string {
  if (report.segments.length === 0) {
    return "(no segments — no valid returns)";
  }
  const lines: string[] = [
    `Calendar Effect Analysis — ${report.totalObservations} observations, ${report.segmentCount} segments`,
    "",
    `  ${"Segment".padEnd(12)}  ${"n".padStart(6)}  ${"mean".padStart(8)}  ${"t".padStart(7)}  ${"p".padStart(7)}  ${"pos%".padStart(7)}  Sig`,
    `  ${"─".repeat(12)}  ${"─".repeat(6)}  ${"─".repeat(8)}  ${"─".repeat(7)}  ${"─".repeat(7)}  ${"─".repeat(7)}  ${"─".repeat(20)}`,
  ];
  for (const s of report.segments) {
    const meanPct = `${(s.meanReturn * 100).toFixed(3)}%`.padStart(8);
    const t = s.tStat.toFixed(2).padStart(7);
    const p = s.pValue.toFixed(4).padStart(7);
    const pos = `${(s.positiveRate * 100).toFixed(0)}%`.padStart(7);
    const marker = s.significantlyNonZero ? "✓" : " ";
    lines.push(
      `  ${s.segment.padEnd(12)}  ${String(s.sampleSize).padStart(6)}  ${meanPct}  ${t}  ${p}  ${pos}  ${marker} ${s.significance}`,
    );
  }
  lines.push("");
  lines.push(`Summary: ${report.summary}`);
  return lines.join("\n");
}
