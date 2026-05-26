/**
 * Trim-state — the trim coach for the momentum-swing playbook.
 *
 * Article ladder (Wikoff / momentum swing):
 *   1. First trim — 25% at first-resistance hit; move stop to breakeven.
 *   2. Second trim — 25% on close below the 8 EMA.
 *   3. Third trim — 25% on close below the 21 EMA.
 *   4. Exit remaining 25% on close below the 50 EMA.
 *
 * This indicator does NOT auto-trim. The operator (or a coaching skill)
 * supplies the entry bar and optional first-resistance level; the
 * indicator reports observable facts — EMA values, reached-resistance,
 * close-below counts since entry, latest-bar flags — and a severityLevel
 * hint. The operator tracks which stage they're in and uses the
 * severityLevel to decide whether the NEXT trim signal has fired.
 *
 * Stateless on purpose. Coupling stage-state to the indicator would
 * collide with the operator's own record of partial cancels.
 */

import type { Candle } from "./types.ts";
import { calculateEMA } from "./ema.ts";

export interface TrimStateParams {
  /** Index of the entry bar (inclusive). Default candles.length - 1, but
   *  callers should always pass this — defaulting to the latest bar is
   *  only useful for "what if I entered right now" probes. */
  entryBarIndex?: number;
  /** Operator's first-trim target (a resistance level above entry). When
   *  omitted, reachedFirstResistance is null and severityLevel can't
   *  promote past 0 from resistance alone. */
  firstResistanceLevel?: number;
}

export interface TrimStateResult {
  daysSinceEntry: number;
  /** Latest-bar EMA values. Null when the series is shorter than the
   *  period. */
  ema8: number | null;
  ema21: number | null;
  ema50: number | null;
  /** true when ANY high between entryBarIndex and the latest bar reached
   *  the first-resistance level. Null when no level was supplied. */
  reachedFirstResistance: boolean | null;
  closesBelowEma8SinceEntry: number;
  closesBelowEma21SinceEntry: number;
  closesBelowEma50SinceEntry: number;
  /** True when the LATEST bar closed below the corresponding EMA. */
  latestCloseBelowEma8: boolean;
  latestCloseBelowEma21: boolean;
  latestCloseBelowEma50: boolean;
  /**
   * 0 = wait — no trim signal active.
   * 1 = first-resistance hit — first 25% trim due.
   * 2 = latest close below 8 EMA — second 25% trim due.
   * 3 = latest close below 21 EMA — third 25% trim due.
   * 4 = latest close below 50 EMA — exit remaining position.
   *
   * Highest-severity signal currently visible. The operator's own stage
   * record decides what to act on — see SKILL.md for the workflow.
   */
  severityLevel: 0 | 1 | 2 | 3 | 4;
  recommendation: string;
}

function emaAt(closes: number[], period: number, index: number): number | null {
  if (closes.length < period || index < 0 || index >= closes.length) return null;
  const sub = closes.slice(0, index + 1);
  const result = calculateEMA(sub, period);
  return result.current;
}

export function calculateTrimState(
  candles: Candle[],
  params: TrimStateParams = {},
): TrimStateResult {
  if (!candles || candles.length === 0) {
    return {
      daysSinceEntry: 0,
      ema8: null,
      ema21: null,
      ema50: null,
      reachedFirstResistance: params.firstResistanceLevel != null ? false : null,
      closesBelowEma8SinceEntry: 0,
      closesBelowEma21SinceEntry: 0,
      closesBelowEma50SinceEntry: 0,
      latestCloseBelowEma8: false,
      latestCloseBelowEma21: false,
      latestCloseBelowEma50: false,
      severityLevel: 0,
      recommendation: "No candles — cannot evaluate.",
    };
  }

  const closes = candles.map((c) => c.close);
  const lastIdx = candles.length - 1;
  const entryIdx = Math.max(
    0,
    Math.min(params.entryBarIndex ?? lastIdx, lastIdx),
  );
  const daysSinceEntry = lastIdx - entryIdx;

  // Full-series EMAs so we can read values at every bar after entry.
  const ema8Series = calculateEMA(closes, 8).values;
  const ema21Series = calculateEMA(closes, 21).values;
  const ema50Series = calculateEMA(closes, 50).values;

  const ema8 = emaAt(closes, 8, lastIdx);
  const ema21 = emaAt(closes, 21, lastIdx);
  const ema50 = emaAt(closes, 50, lastIdx);

  // Reached-resistance: any high from entryIdx..lastIdx >= level.
  let reachedFirstResistance: boolean | null = null;
  if (typeof params.firstResistanceLevel === "number" && Number.isFinite(params.firstResistanceLevel)) {
    reachedFirstResistance = false;
    for (let i = entryIdx; i <= lastIdx; i++) {
      if (candles[i]!.high >= params.firstResistanceLevel) {
        reachedFirstResistance = true;
        break;
      }
    }
  }

  // Count close-below events for each EMA, strictly AFTER entry. The
  // entry bar itself is excluded — a close-below on the entry day is
  // either noise (intraday fill) or means the trade should never have
  // been taken. Operator-supplied entryBarIndex is treated as
  // "post-entry," so we start counting from entryIdx + 1.
  let closesBelowEma8 = 0;
  let closesBelowEma21 = 0;
  let closesBelowEma50 = 0;
  for (let i = entryIdx + 1; i <= lastIdx; i++) {
    const c = candles[i]!.close;
    const e8 = ema8Series[i];
    const e21 = ema21Series[i];
    const e50 = ema50Series[i];
    if (typeof e8 === "number" && c < e8) closesBelowEma8++;
    if (typeof e21 === "number" && c < e21) closesBelowEma21++;
    if (typeof e50 === "number" && c < e50) closesBelowEma50++;
  }

  // Latest-bar flags — these gate severityLevel 2/3/4.
  const lastClose = candles[lastIdx]!.close;
  const latestCloseBelowEma8 = ema8 != null && lastClose < ema8;
  const latestCloseBelowEma21 = ema21 != null && lastClose < ema21;
  const latestCloseBelowEma50 = ema50 != null && lastClose < ema50;

  let severityLevel: TrimStateResult["severityLevel"] = 0;
  let recommendation = "Wait — no trim signal active.";
  if (latestCloseBelowEma50) {
    severityLevel = 4;
    recommendation = "Close below 50 EMA — exit any remaining position.";
  } else if (latestCloseBelowEma21) {
    severityLevel = 3;
    recommendation = "Close below 21 EMA — third 25% trim due if still in stage 2.";
  } else if (latestCloseBelowEma8) {
    severityLevel = 2;
    recommendation = "Close below 8 EMA — second 25% trim due if first trim already taken.";
  } else if (reachedFirstResistance === true) {
    severityLevel = 1;
    recommendation = "First resistance reached — first 25% trim due; move stop to breakeven on remaining.";
  }

  return {
    daysSinceEntry,
    ema8,
    ema21,
    ema50,
    reachedFirstResistance,
    closesBelowEma8SinceEntry: closesBelowEma8,
    closesBelowEma21SinceEntry: closesBelowEma21,
    closesBelowEma50SinceEntry: closesBelowEma50,
    latestCloseBelowEma8,
    latestCloseBelowEma21,
    latestCloseBelowEma50,
    severityLevel,
    recommendation,
  };
}
