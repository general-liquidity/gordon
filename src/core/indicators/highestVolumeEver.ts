/**
 * Highest Volume Ever (HVE) detector.
 *
 * Detects bars where the volume exceeds every prior bar's volume
 * within a configurable lookback window. True HVE (lookback unbounded)
 * marks the historic-volume-record bars; bounded lookback ("highest
 * in N bars") gives a moving "record-relative-to-window" reading.
 *
 * Trading framing (from the source article): an HVE print on a
 * breakout day signals institutional urgency — large funds caught
 * underweight scrambling to build positions all at once. The next
 * orderly pullback to the 8-week EMA is the "first-pullback" setup
 * because institutions defend the baseline of the historic-volume
 * day. The /hve-pullback skill composes this detector with the EMA
 * stack from the momentum-swing playbook.
 *
 * Pure function. No I/O.
 */

import type { Candle } from "./types.ts";

export interface HighestVolumeEverParams {
  /** Lookback window in bars. Default Infinity (true HVE — highest
   *  volume in the entire series). Pass a finite N for "highest in
   *  the last N bars" (e.g. 252 ≈ one year of daily bars). */
  lookbackBars?: number;
  /** Minimum bars required before an HVE detection can fire. Default
   *  20 — avoids false positives on the first few bars of a series
   *  where any volume looks like a record. */
  minBarsBeforeDetection?: number;
}

export interface HighestVolumeEverResult {
  /** Per-bar boolean: true when this bar's volume exceeds every prior
   *  bar's volume within the lookback window. Length matches input. */
  isHve: boolean[];
  /** Indices where HVE fired, oldest first. */
  hveBarIndices: number[];
  /** Latest HVE bar index in the series, or null if none fired. */
  latestHveBarIndex: number | null;
  /** Bars since the latest HVE detection (lastIdx - latestHveBarIndex),
   *  or null when no HVE has fired. */
  barsSinceLatestHve: number | null;
  /** Latest HVE bar's volume as a multiple of the median volume in
   *  its lookback window — surfaces "how much of an outlier" the HVE
   *  print was. Null when no HVE has fired. */
  volumeMultipleOfMedian: number | null;
  /** Configured lookback (Infinity preserved). */
  lookbackBars: number;
  /** Human-readable summary. */
  interpretation: string;
}

const DEFAULT_MIN_BARS = 20;

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1]! + sorted[mid]!) / 2 : sorted[mid]!;
}

export function calculateHighestVolumeEver(
  candles: Candle[],
  params: HighestVolumeEverParams = {},
): HighestVolumeEverResult {
  const lookbackBars = params.lookbackBars ?? Infinity;
  const minBars = params.minBarsBeforeDetection ?? DEFAULT_MIN_BARS;
  if (!(lookbackBars > 0)) {
    throw new Error("highestVolumeEver: lookbackBars must be > 0");
  }
  if (!Number.isInteger(minBars) || minBars < 1) {
    throw new Error("highestVolumeEver: minBarsBeforeDetection must be a positive integer");
  }
  const n = candles?.length ?? 0;
  const isHve = new Array<boolean>(n).fill(false);
  const hveBarIndices: number[] = [];
  if (n === 0) {
    return {
      isHve,
      hveBarIndices,
      latestHveBarIndex: null,
      barsSinceLatestHve: null,
      volumeMultipleOfMedian: null,
      lookbackBars,
      interpretation: "No candles — nothing to evaluate.",
    };
  }

  for (let i = minBars; i < n; i++) {
    const v = candles[i]!.volume ?? 0;
    if (!Number.isFinite(v) || v <= 0) continue;
    // Define the lookback window: start at max(0, i - lookbackBars).
    const windowStart = Number.isFinite(lookbackBars) ? Math.max(0, i - lookbackBars) : 0;
    let isRecord = true;
    for (let j = windowStart; j < i; j++) {
      const w = candles[j]!.volume ?? 0;
      if (Number.isFinite(w) && w >= v) {
        isRecord = false;
        break;
      }
    }
    if (isRecord) {
      isHve[i] = true;
      hveBarIndices.push(i);
    }
  }

  const latestHveBarIndex =
    hveBarIndices.length > 0 ? hveBarIndices[hveBarIndices.length - 1]! : null;
  const lastIdx = n - 1;
  const barsSinceLatestHve = latestHveBarIndex !== null ? lastIdx - latestHveBarIndex : null;

  let volumeMultipleOfMedian: number | null = null;
  if (latestHveBarIndex !== null) {
    const hveVolume = candles[latestHveBarIndex]!.volume ?? 0;
    const windowStart = Number.isFinite(lookbackBars)
      ? Math.max(0, latestHveBarIndex - lookbackBars)
      : 0;
    const priorVolumes: number[] = [];
    for (let j = windowStart; j < latestHveBarIndex; j++) {
      const w = candles[j]!.volume ?? 0;
      if (Number.isFinite(w) && w > 0) priorVolumes.push(w);
    }
    const med = median(priorVolumes);
    volumeMultipleOfMedian = med > 0 ? hveVolume / med : null;
  }

  const interpretation =
    latestHveBarIndex === null
      ? `No HVE prints detected in ${n} bars${Number.isFinite(lookbackBars) ? ` (lookback ${lookbackBars})` : ""}.`
      : `Latest HVE: bar ${latestHveBarIndex}${barsSinceLatestHve !== null ? ` (${barsSinceLatestHve} bars ago)` : ""}` +
        (volumeMultipleOfMedian !== null
          ? `, volume ${volumeMultipleOfMedian.toFixed(1)}× window median.`
          : ".") +
        ` ${hveBarIndices.length} total HVE print(s) in the series.`;

  return {
    isHve,
    hveBarIndices,
    latestHveBarIndex,
    barsSinceLatestHve,
    volumeMultipleOfMedian,
    lookbackBars,
    interpretation,
  };
}
