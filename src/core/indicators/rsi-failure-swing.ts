/**
 * Welles Wilder's RSI Failure Swing.
 *
 * A failure swing is defined ENTIRELY on the RSI line — it does not reference
 * price at all, which distinguishes it from RSI/price divergence.
 *
 * Top (bearish) failure swing: RSI pushes above 70 (pivot-high P1), pulls back
 * to a trough T, then rallies to a LOWER pivot-high P2 (which need not exceed 70),
 * and finally breaks BELOW the trough level rsi(T). The break confirms the signal.
 * Bottom (bullish) failure swing is the mirror below 30. Divergence compares RSI
 * against price highs/lows; a failure swing compares RSI against its own prior
 * pivots only.
 */

import type { Candle } from "./types.ts";

export interface RsiFailureSwingResult {
  signal: "top_failure_swing" | "bottom_failure_swing" | "none";
  confirmed: boolean;
  firedOnLastBar: boolean;
  confirmBar: number | null;
  points: {
    p1Bar: number;
    p1Rsi: number;
    troughBar: number;
    troughRsi: number;
    p2Bar: number;
    p2Rsi: number;
  } | null;
  currentRsi: number | null;
  rsiPeriod: number;
  interpretation: string;
}

/** RSI with Wilder smoothing. Returns a (number|null)[] aligned to closes (nulls during warmup). */
function calcRsi(closes: number[], period: number): (number | null)[] {
  const out: (number | null)[] = new Array(closes.length).fill(null);
  if (closes.length < period + 1) return out;

  let avgGain = 0;
  let avgLoss = 0;
  for (let i = 1; i <= period; i++) {
    const change = closes[i]! - closes[i - 1]!;
    if (change > 0) avgGain += change;
    else avgLoss += Math.abs(change);
  }
  avgGain /= period;
  avgLoss /= period;

  out[period] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);

  for (let i = period + 1; i < closes.length; i++) {
    const change = closes[i]! - closes[i - 1]!;
    const gain = change > 0 ? change : 0;
    const loss = change < 0 ? Math.abs(change) : 0;
    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;
    out[i] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
  }

  return out;
}

interface Pivot {
  bar: number;
  rsi: number;
  kind: "high" | "low";
}

/** Strict local extrema on the RSI line, ignoring warmup nulls. */
function findPivots(rsi: (number | null)[], window: number): Pivot[] {
  const pivots: Pivot[] = [];
  for (let i = window; i < rsi.length - window; i++) {
    const center = rsi[i];
    if (center == null) continue;

    let isHigh = true;
    let isLow = true;
    for (let j = i - window; j <= i + window; j++) {
      if (j === i) continue;
      const v = rsi[j];
      if (v == null) {
        isHigh = false;
        isLow = false;
        break;
      }
      if (v >= center) isHigh = false;
      if (v <= center) isLow = false;
    }

    if (isHigh) pivots.push({ bar: i, rsi: center, kind: "high" });
    else if (isLow) pivots.push({ bar: i, rsi: center, kind: "low" });
  }
  return pivots;
}

const r1 = (x: number): number => parseFloat(x.toFixed(1));

export function calculateRsiFailureSwing(
  closes: number[],
  opts?: { rsiPeriod?: number; pivotWindow?: number },
): RsiFailureSwingResult {
  const rsiPeriod = opts?.rsiPeriod ?? 14;
  const pivotWindow = opts?.pivotWindow ?? 2;

  const none = (interpretation: string): RsiFailureSwingResult => ({
    signal: "none",
    confirmed: false,
    firedOnLastBar: false,
    confirmBar: null,
    points: null,
    currentRsi: null,
    rsiPeriod,
    interpretation,
  });

  if (
    !Array.isArray(closes) ||
    closes.length < rsiPeriod + pivotWindow * 2 + 2 ||
    closes.some((c) => typeof c !== "number" || !Number.isFinite(c))
  ) {
    return none("Insufficient data for RSI failure swing");
  }

  const rsi = calcRsi(closes, rsiPeriod);
  const pivots = findPivots(rsi, pivotWindow);
  const lastBar = closes.length - 1;
  const currentRsiRaw = rsi[lastBar] ?? null;
  const currentRsi = currentRsiRaw == null ? null : r1(currentRsiRaw);

  interface Confirmed {
    type: "top" | "bottom";
    p1: Pivot;
    trough: Pivot;
    p2: Pivot;
    confirmBar: number;
  }

  const confirmedSwings: Confirmed[] = [];

  // TOP failure swing: pivot-high P1 (>70) → pivot-low trough T (<P1) →
  // lower pivot-high P2 (<P1) → RSI breaks below rsi(T).
  for (let a = 0; a < pivots.length; a++) {
    const p1 = pivots[a]!;
    if (p1.kind !== "high" || p1.rsi <= 70) continue;

    for (let b = a + 1; b < pivots.length; b++) {
      const trough = pivots[b]!;
      if (trough.kind !== "low" || trough.rsi >= p1.rsi) continue;

      for (let c = b + 1; c < pivots.length; c++) {
        const p2 = pivots[c]!;
        if (p2.kind !== "high" || p2.rsi >= p1.rsi) continue;

        // First bar after P2 where RSI closes below the trough level.
        let confirmBar: number | null = null;
        for (let k = p2.bar + 1; k <= lastBar; k++) {
          const v = rsi[k];
          if (v == null) continue;
          if (v < trough.rsi) {
            confirmBar = k;
            break;
          }
        }
        if (confirmBar != null) {
          confirmedSwings.push({ type: "top", p1, trough, p2, confirmBar });
        }
        break; // use the first qualifying lower pivot-high as P2
      }
      break; // use the first qualifying trough after P1
    }
  }

  // BOTTOM failure swing: pivot-low P1 (<30) → pivot-high trough T (>P1) →
  // higher pivot-low P2 (>P1) → RSI breaks above rsi(T).
  for (let a = 0; a < pivots.length; a++) {
    const p1 = pivots[a]!;
    if (p1.kind !== "low" || p1.rsi >= 30) continue;

    for (let b = a + 1; b < pivots.length; b++) {
      const trough = pivots[b]!;
      if (trough.kind !== "high" || trough.rsi <= p1.rsi) continue;

      for (let c = b + 1; c < pivots.length; c++) {
        const p2 = pivots[c]!;
        if (p2.kind !== "low" || p2.rsi <= p1.rsi) continue;

        let confirmBar: number | null = null;
        for (let k = p2.bar + 1; k <= lastBar; k++) {
          const v = rsi[k];
          if (v == null) continue;
          if (v > trough.rsi) {
            confirmBar = k;
            break;
          }
        }
        if (confirmBar != null) {
          confirmedSwings.push({ type: "bottom", p1, trough, p2, confirmBar });
        }
        break;
      }
      break;
    }
  }

  if (confirmedSwings.length === 0) {
    const rsiTxt = currentRsi == null ? "n/a" : currentRsi.toFixed(1);
    return {
      signal: "none",
      confirmed: false,
      firedOnLastBar: false,
      confirmBar: null,
      points: null,
      currentRsi,
      rsiPeriod,
      interpretation: `No RSI failure swing confirmed. Current RSI: ${rsiTxt}.`,
    };
  }

  // Most recent by confirmation bar.
  confirmedSwings.sort((x, y) => x.confirmBar - y.confirmBar);
  const recent = confirmedSwings[confirmedSwings.length - 1]!;

  const signal: RsiFailureSwingResult["signal"] =
    recent.type === "top" ? "top_failure_swing" : "bottom_failure_swing";
  const firedOnLastBar = recent.confirmBar === lastBar;

  const points = {
    p1Bar: recent.p1.bar,
    p1Rsi: r1(recent.p1.rsi),
    troughBar: recent.trough.bar,
    troughRsi: r1(recent.trough.rsi),
    p2Bar: recent.p2.bar,
    p2Rsi: r1(recent.p2.rsi),
  };

  const dir = recent.type === "top" ? "BEARISH top" : "BULLISH bottom";
  const breakDir = recent.type === "top" ? "below" : "above";
  const interpretation =
    `${dir} RSI failure swing confirmed at bar ${recent.confirmBar}` +
    `${firedOnLastBar ? " (last bar)" : ""}. ` +
    `P1 RSI ${points.p1Rsi} (bar ${points.p1Bar}) → trough ${points.troughRsi} ` +
    `(bar ${points.troughBar}) → P2 RSI ${points.p2Rsi} (bar ${points.p2Bar}); ` +
    `RSI then broke ${breakDir} the trough level.`;

  return {
    signal,
    confirmed: true,
    firedOnLastBar,
    confirmBar: recent.confirmBar,
    points,
    currentRsi,
    rsiPeriod,
    interpretation,
  };
}

// Candle is intentionally imported to align with the indicator module convention
// (callers pass closes, but the type re-export keeps this file in the family).
export type { Candle };
