/**
 * Tradability Mask — executability as a first-class input to every rolling operator.
 *
 * Gordon's indicators take raw arrays (`calculateRSI(closes, period)`) and have no
 * concept of whether a bar was actually executable. "Machine Learning Enhanced
 * Multi-Factor Quantitative Trading" (2026) names the resulting bug class upstream
 * contamination: once a rolling-window operator ingests a non-executable bar, the
 * contamination is inside the window average, and dropping the offending row
 * afterwards cannot repair the surrounding outputs.
 *
 * The cost is the reason this module exists. On their ablation, REMOVING the mask
 * RAISED apparent IC from 0.049 to 0.058 (a phantom +18%) while Sharpe fell 1.63 to
 * 1.23 and max drawdown rose 11.4% to 18.3%. The defect is invisible in the
 * predictive metric and shows up only in realized money. The paired diagnostic is
 * the rule: never report a predictive score without the realizable return beside it.
 *
 * Non-executable means exchange halt, LULD pause, limit-up/limit-down at a price
 * bound, trading suspension, delisting, or venue outage. Crypto sees the rarer but
 * real versions: maintenance windows, delistings, books too thin to fill.
 *
 * The propagation rule is the whole point: a 20-period average that touched one
 * halted bar is contaminated for 20 outputs, not one.
 */

import type { Candle } from "../types.ts";

export type NonTradableReason =
  | "halted"
  | "suspended"
  | "delisted"
  | "venue_outage"
  | "limit_bound"
  | "limit_move_heuristic"
  | "window_contaminated"
  | "insufficient_window";

/**
 * Venue-supplied executability facts for a bar. Every field is optional because
 * feeds differ: equities usually carry halt state and LULD bands, crypto rarely
 * carries either.
 */
export interface VenueTradability {
  /** Exchange halt or LULD pause covering this bar. */
  halted?: boolean;
  /** Trading suspension, regulatory or venue-initiated. */
  suspended?: boolean;
  /** Symbol delisted as of this bar. */
  delisted?: boolean;
  /** Venue was down or the feed gapped, so the bar is synthetic. */
  venueOutage?: boolean;
  /** Upper price bound (limit-up / LULD upper band) in force for this bar. */
  limitUp?: number;
  /** Lower price bound (limit-down / LULD lower band) in force for this bar. */
  limitDown?: number;
}

export type TradabilityBar = Candle & VenueTradability;

export interface TradabilityMask {
  readonly tradable: readonly boolean[];
  readonly reasons: readonly (NonTradableReason | null)[];
  readonly length: number;
  readonly maskedCount: number;
  /**
   * Stamp from the caller-injected clock, or null when none was injected. The
   * builder never reads the wall clock itself: a mask that changes with the time of
   * day cannot be replayed against a backtest.
   */
  readonly builtAt: number | null;
}

/** A value series paired with the mask describing which outputs are usable. */
export interface MaskedSeries {
  readonly values: (number | null)[];
  readonly mask: TradabilityMask;
}

export interface BuildMaskOptions {
  /**
   * Relative tolerance for deciding a close sits AT a limit bound. Prints land a
   * tick off the band often enough that exact equality misses real limit locks.
   * Default 1e-4.
   */
  limitTolerance?: number;
  /**
   * Absolute one-bar return above which a bar is presumed limit-locked when the
   * venue supplied no bounds. Default 0.20, high enough that ordinary crypto
   * volatility does not trip it. Consulted only as a fallback.
   */
  limitMoveThreshold?: number;
  /** Injected clock. Absent means builtAt stays null and the builder stays pure. */
  clock?: () => number;
}

const DEFAULT_LIMIT_TOLERANCE = 1e-4;
const DEFAULT_LIMIT_MOVE_THRESHOLD = 0.2;

function finalizeMask(
  tradable: boolean[],
  reasons: (NonTradableReason | null)[],
  builtAt: number | null,
): TradabilityMask {
  let maskedCount = 0;
  for (const ok of tradable) if (!ok) maskedCount++;
  return { tradable, reasons, length: tradable.length, maskedCount, builtAt };
}

function explicitFlagReason(bar: VenueTradability): NonTradableReason | null {
  if (bar.halted === true) return "halted";
  if (bar.suspended === true) return "suspended";
  if (bar.delisted === true) return "delisted";
  if (bar.venueOutage === true) return "venue_outage";
  return null;
}

function atLimitBound(close: number, bar: VenueTradability, tolerance: number): boolean {
  if (bar.limitUp != null && close >= bar.limitUp * (1 - tolerance)) return true;
  if (bar.limitDown != null && close <= bar.limitDown * (1 + tolerance)) return true;
  return false;
}

/**
 * Build a tradability mask over a bar series.
 *
 * Precedence is deliberate and total: an explicit venue flag decides the bar on its
 * own, explicit price bounds decide it next, and the returns-based heuristic is a
 * last resort consulted only when the venue supplied neither. The heuristic cannot
 * tell a limit lock from a genuine 25% crypto move, so it never gets to overrule
 * something the venue actually reported.
 *
 * Pure: no wall clock, no I/O. The same bars produce the same mask forever.
 */
export function buildTradabilityMask(
  bars: readonly TradabilityBar[],
  options: BuildMaskOptions = {},
): TradabilityMask {
  const tolerance = options.limitTolerance ?? DEFAULT_LIMIT_TOLERANCE;
  const moveThreshold = options.limitMoveThreshold ?? DEFAULT_LIMIT_MOVE_THRESHOLD;
  const builtAt = options.clock ? options.clock() : null;

  const tradable: boolean[] = [];
  const reasons: (NonTradableReason | null)[] = [];

  for (let i = 0; i < bars.length; i++) {
    const bar = bars[i]!;
    let reason = explicitFlagReason(bar);

    if (reason === null) {
      const hasBounds = bar.limitUp != null || bar.limitDown != null;
      if (hasBounds) {
        if (atLimitBound(bar.close, bar, tolerance)) reason = "limit_bound";
      } else {
        const prev = bars[i - 1];
        if (prev != null && prev.close !== 0) {
          const ret = Math.abs(bar.close / prev.close - 1);
          if (ret >= moveThreshold) reason = "limit_move_heuristic";
        }
      }
    }

    tradable.push(reason === null);
    reasons.push(reason);
  }

  return finalizeMask(tradable, reasons, builtAt);
}

/** Mask with every cell tradable, the identity input to any masked operator. */
export function allTradable(length: number, builtAt: number | null = null): TradabilityMask {
  return finalizeMask(
    Array.from({ length }, () => true),
    Array.from({ length }, () => null),
    builtAt,
  );
}

/** Mask built from a plain boolean array, for feeds that already carry executability. */
export function maskFromFlags(
  tradableFlags: readonly boolean[],
  reason: NonTradableReason = "halted",
  builtAt: number | null = null,
): TradabilityMask {
  return finalizeMask(
    [...tradableFlags],
    tradableFlags.map((ok) => (ok ? null : reason)),
    builtAt,
  );
}

export type MaskPolicy = "invalidate" | "zero" | "hold_last";

/**
 * Resolve masked cells per an explicit caller policy so existing indicators can
 * adopt the mask without changing their signatures: shape the input here, hand the
 * result to `calculateRSI` unchanged.
 *
 * `hold_last` keeps the last executable price instead of a fabricated one, but it
 * still feeds a stale value into the window, so the OUTPUT mask must still be
 * propagated. It is a shaping policy, not a repair.
 */
export function applyMaskPolicy(
  series: readonly (number | null)[],
  mask: TradabilityMask,
  policy: MaskPolicy,
): (number | null)[] {
  const out: (number | null)[] = [];
  let lastValid: number | null = null;

  for (let i = 0; i < series.length; i++) {
    const value = series[i] ?? null;
    if (mask.tradable[i] === true) {
      if (value !== null) lastValid = value;
      out.push(value);
      continue;
    }
    if (policy === "zero") out.push(0);
    else if (policy === "hold_last") out.push(lastValid);
    else out.push(null);
  }

  return out;
}

/**
 * Propagate an input mask through a rolling dependency window: an output is valid
 * only when EVERY input cell it depends on was executable. This is the rule the
 * paper's ablation was measuring, and anything weaker leaves the contamination in.
 */
export function propagateMask(mask: TradabilityMask, window: number): TradabilityMask {
  const tradable: boolean[] = [];
  const reasons: (NonTradableReason | null)[] = [];

  for (let i = 0; i < mask.length; i++) {
    if (i < window - 1) {
      tradable.push(false);
      reasons.push("insufficient_window");
      continue;
    }
    let clean = true;
    for (let j = i - window + 1; j <= i; j++) {
      if (mask.tradable[j] !== true) {
        clean = false;
        break;
      }
    }
    tradable.push(clean);
    reasons.push(clean ? null : "window_contaminated");
  }

  return finalizeMask(tradable, reasons, mask.builtAt);
}

/**
 * Rolling mean that never reads a masked cell and never emits a value for a
 * contaminated window. This is the reference implementation of the contract in
 * `contract.ts` and the shape new masked operators should copy.
 */
export function maskedRollingMean(
  series: readonly number[],
  mask: TradabilityMask,
  window: number,
): MaskedSeries {
  const outMask = propagateMask(mask, window);
  const values: (number | null)[] = [];

  for (let i = 0; i < series.length; i++) {
    if (outMask.tradable[i] !== true) {
      values.push(null);
      continue;
    }
    let sum = 0;
    for (let j = i - window + 1; j <= i; j++) sum += series[j]!;
    values.push(sum / window);
  }

  return { values, mask: outMask };
}

export type CrossSectionalMethod = "rank" | "zscore";

/**
 * Cross-sectional normalization across a universe at one point in time, using ONLY
 * the executable names as the denominator. Normalizing by the full universe inflates
 * ranks on halt-heavy days: the paper measured +0.003 IC across 50+ rank-based
 * factors from this one fix.
 *
 * Rank output spans [0, 1] over the valid names with ties averaged. A lone valid
 * name gets 0.5 because it carries no cross-sectional information.
 */
export function crossSectionalNormalize(
  values: readonly (number | null)[],
  mask: TradabilityMask,
  options: { method?: CrossSectionalMethod } = {},
): (number | null)[] {
  const method = options.method ?? "rank";
  const valid: Array<{ index: number; value: number }> = [];

  for (let i = 0; i < values.length; i++) {
    const value = values[i];
    if (mask.tradable[i] === true && value != null && Number.isFinite(value)) {
      valid.push({ index: i, value });
    }
  }

  const out: (number | null)[] = values.map(() => null);
  const validCount = valid.length;
  if (validCount === 0) return out;

  if (method === "zscore") {
    let sum = 0;
    for (const entry of valid) sum += entry.value;
    const mean = sum / validCount;
    let sq = 0;
    for (const entry of valid) sq += (entry.value - mean) ** 2;
    const std = Math.sqrt(sq / validCount);
    for (const entry of valid) {
      out[entry.index] = std === 0 ? 0 : (entry.value - mean) / std;
    }
    return out;
  }

  if (validCount === 1) {
    out[valid[0]!.index] = 0.5;
    return out;
  }

  const sorted = [...valid].sort((a, b) => a.value - b.value);
  let i = 0;
  while (i < sorted.length) {
    let j = i;
    while (j + 1 < sorted.length && sorted[j + 1]!.value === sorted[i]!.value) j++;
    const averageRank = (i + j) / 2;
    for (let k = i; k <= j; k++) {
      out[sorted[k]!.index] = averageRank / (validCount - 1);
    }
    i = j + 1;
  }

  return out;
}

/**
 * Per-reason counts plus the headline contamination verdict for one window.
 * `contaminated` is what a caller should branch on: a window with any masked bar
 * produces indicator values no order could have been filled against.
 */
export interface MaskSummary {
  readonly barCount: number;
  readonly tradableCount: number;
  readonly maskedCount: number;
  readonly contaminated: boolean;
  readonly reasonCounts: Readonly<Partial<Record<NonTradableReason, number>>>;
}

export function summarizeMask(mask: TradabilityMask): MaskSummary {
  const reasonCounts: Partial<Record<NonTradableReason, number>> = {};
  for (const reason of mask.reasons) {
    if (reason === null) continue;
    reasonCounts[reason] = (reasonCounts[reason] ?? 0) + 1;
  }
  return {
    barCount: mask.length,
    tradableCount: mask.length - mask.maskedCount,
    maskedCount: mask.maskedCount,
    contaminated: mask.maskedCount > 0,
    reasonCounts,
  };
}
