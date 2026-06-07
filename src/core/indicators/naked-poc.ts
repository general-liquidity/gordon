/**
 * Naked / virgin POC tracking.
 *
 * Each period's volume Point of Control (highest-volume price) acts as a magnet.
 * A POC is "naked" (virgin) if price has NOT traded back through it on any later
 * bar — those unfilled POCs are the strongest pull/target levels. Once a later
 * bar's range contains the POC it's "filled" and loses its draw.
 *
 * Distinct from `single_prints` (TPO fast-move gaps): this tracks per-period
 * VOLUME-POC revisits. Reuses `calculateVolumeProfile` for the per-period POC.
 * Pure; never throws.
 */

import { calculateVolumeProfile } from "./volume-profile.ts";
import type { Candle } from "./types.ts";

export interface NakedPocInput {
  candles: Candle[];
  /** Bars per period (e.g. 24 hourly bars = 1 day). Default 24. */
  periodBars?: number;
  /** Volume-profile bins per period. Default 24. */
  numBins?: number;
}

export interface NakedPoc {
  poc: number;
  /** Bar index at which the period (and its POC) closed. */
  createdAtBar: number;
  /** Bars elapsed since the POC was established. */
  barsSince: number;
}

export interface NakedPocResult {
  nakedPocs: NakedPoc[];
  filledCount: number;
  /** Nearest unfilled POC above / below the last close. */
  nearestNakedAbove: number | null;
  nearestNakedBelow: number | null;
  interpretation: string;
}

export function computeNakedPoc(input: NakedPocInput): NakedPocResult {
  const candles = input.candles;
  const periodBars = Math.max(2, Math.floor(input.periodBars ?? 24));
  const numBins = Math.max(4, Math.floor(input.numBins ?? 24));
  const n = candles.length;

  const empty: NakedPocResult = {
    nakedPocs: [],
    filledCount: 0,
    nearestNakedAbove: null,
    nearestNakedBelow: null,
    interpretation: "insufficient data for naked-POC",
  };
  if (n < periodBars * 2) return empty;

  const naked: NakedPoc[] = [];
  let filledCount = 0;

  for (let start = 0; start + periodBars <= n; start += periodBars) {
    const end = start + periodBars; // exclusive
    const slice = candles.slice(start, end);
    const poc = calculateVolumeProfile(slice, numBins).poc;
    if (poc == null) continue;
    const createdAtBar = end - 1;

    // Filled if any LATER bar's range contains the POC.
    let filled = false;
    for (let k = end; k < n; k++) {
      if (candles[k]!.low <= poc && poc <= candles[k]!.high) {
        filled = true;
        break;
      }
    }
    if (filled) {
      filledCount += 1;
    } else {
      naked.push({ poc: parseFloat(poc.toFixed(6)), createdAtBar, barsSince: n - 1 - createdAtBar });
    }
  }

  // Most recent naked POCs first.
  naked.sort((a, b) => b.createdAtBar - a.createdAtBar);

  const lastClose = candles[n - 1]!.close;
  let nearestAbove: number | null = null;
  let nearestBelow: number | null = null;
  for (const p of naked) {
    if (p.poc > lastClose && (nearestAbove === null || p.poc < nearestAbove)) nearestAbove = p.poc;
    if (p.poc < lastClose && (nearestBelow === null || p.poc > nearestBelow)) nearestBelow = p.poc;
  }

  const interpretation =
    naked.length === 0
      ? `no naked POCs (${filledCount} filled)`
      : `${naked.length} naked POC(s) (magnets), ${filledCount} filled` +
        (nearestAbove !== null ? `; nearest above ${nearestAbove}` : "") +
        (nearestBelow !== null ? `; nearest below ${nearestBelow}` : "");

  return {
    nakedPocs: naked,
    filledCount,
    nearestNakedAbove: nearestAbove,
    nearestNakedBelow: nearestBelow,
    interpretation,
  };
}
