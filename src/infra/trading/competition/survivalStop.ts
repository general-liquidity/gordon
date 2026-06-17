/**
 * Survival-stop machinery — venue-enforced protection against the competition's killer:
 * **forced liquidation at the 30% margin-level stop-out = immediate elimination** (Rules §2/§14).
 *
 * Two mechanisms, because the right protection depends on the leg type:
 *
 *   1. DIRECTIONAL positions (single-leg trader, lottery sleeve) → a per-position SERVER-SIDE
 *      STOP placed inside the move that would drag the account to the stop-out. Tie it to the
 *      same first-passage model as `liquidationGuard`: the adverse move to the stop-out for a
 *      position at gross leverage L is `liquidationDistance(L, buffer)`, where the maintenance
 *      buffer is EXACTLY the stop-out's share of one position's margin:
 *          buffer = stopOutLevel / accountMaxLeverage = 0.30 / 30 = 0.01.
 *      We place the stop at `survivalFraction` of that distance so we exit BEFORE the venue
 *      force-liquidates us. This only ever TIGHTENS a strategy stop — never loosens it.
 *
 *   2. HEDGED books (the dollar-neutral RV core) → a portfolio MARGIN CIRCUIT BREAKER, NOT
 *      per-leg stops. Per-leg stops on a hedged book are actively harmful: a stopped leg
 *      un-hedges the book and turns it directional (worse). The coherent survival action is
 *      to FLATTEN THE WHOLE BOOK if the account margin level approaches the stop-out — which
 *      the reconciliation framework expresses trivially as "all targets → 0".
 *
 * Pure compute. Validate at boundaries only; never throws.
 */

import { liquidationDistance } from "./liquidationGuard.ts";

/** Margin level (percent) at which the venue force-liquidates = elimination. */
export const COMPETITION_STOP_OUT_LEVEL_PCT = 30;
/** Account max leverage (30:1). */
export const COMPETITION_ACCOUNT_MAX_LEVERAGE = 30;
/** Default protective-stop placement: 60% of the way to the stop-out distance (40% buffer). */
export const DEFAULT_SURVIVAL_FRACTION = 0.6;
/** Default margin-level (percent) at which the hedged-book breaker flattens — well above 30%. */
export const DEFAULT_BREAKER_MARGIN_LEVEL_PCT = 50;

/**
 * Maintenance buffer (fraction of notional) equal to the stop-out's share of one position's
 * margin: stopOutLevel/accountMaxLeverage. For the competition that is 0.30/30 = 0.01, so the
 * adverse move to the stop-out is `1/L − 0.01` — exactly the venue's stop-out for a sole position.
 */
export function stopOutBuffer(
  stopOutLevelPct: number = COMPETITION_STOP_OUT_LEVEL_PCT,
  accountMaxLeverage: number = COMPETITION_ACCOUNT_MAX_LEVERAGE,
): number {
  if (!(accountMaxLeverage > 0)) return 0;
  return stopOutLevelPct / 100 / accountMaxLeverage;
}

export interface SurvivalStopInput {
  /** |notional| (USD) of the directional position. */
  positionNotional: number;
  /** Account equity (USD). */
  equity: number;
  /** Fraction of the stop-out distance at which to place the stop (default 0.6). */
  survivalFraction?: number;
  stopOutLevelPct?: number;
  accountMaxLeverage?: number;
}

/**
 * Fractional adverse price move at which a DIRECTIONAL position should be stopped to stay
 * clear of the 30% margin-level stop-out. Returns +Infinity when there is no position or no
 * equity (nothing to protect here) — callers treat Infinity as "impose no survival stop".
 */
export function survivalStopDistance(input: SurvivalStopInput): number {
  const { positionNotional, equity } = input;
  if (!(positionNotional > 0) || !(equity > 0)) return Number.POSITIVE_INFINITY;
  const frac = input.survivalFraction ?? DEFAULT_SURVIVAL_FRACTION;
  const buffer = stopOutBuffer(input.stopOutLevelPct, input.accountMaxLeverage);
  const leverage = positionNotional / equity; // gross leverage of THIS position
  const dStopOut = liquidationDistance(leverage, buffer); // adverse move to the stop-out
  return Math.max(dStopOut * frac, 1e-4);
}

/** Protective stop PRICE for a directional position given entry, side, and a fractional distance. */
export function survivalStopPrice(
  entry: number,
  side: "buy" | "sell" | "long" | "short",
  distanceFraction: number,
): number {
  if (!(entry > 0) || !Number.isFinite(distanceFraction)) return 0;
  const long = side === "buy" || side === "long";
  const d = entry * distanceFraction;
  return long ? entry - d : entry + d;
}

export interface MarginBreakerInput {
  /** Account margin level as a PERCENT (MT5 `margin_level`; equity/usedMargin×100). */
  marginLevelPct: number;
  /** Used margin (MT5 `margin`). When 0 there are no open positions → breaker stays idle. */
  usedMargin: number;
  /** Flatten-all threshold in percent (default 50). Must sit above the stop-out. */
  breakerLevelPct?: number;
  /** The venue stop-out level in percent (default 30) — for the reason string. */
  stopOutLevelPct?: number;
}

export interface MarginBreakerVerdict {
  /** True ⇒ FLATTEN THE WHOLE BOOK this cycle (reconcile all targets to 0). */
  tripped: boolean;
  marginLevelPct: number;
  reason: string;
}

/**
 * Portfolio margin circuit breaker for a hedged book: trip (flatten everything) when the
 * account margin level falls to/through the breaker threshold, which sits safely above the
 * 30% stop-out so we never reach forced liquidation (= elimination).
 */
export function marginCircuitBreaker(input: MarginBreakerInput): MarginBreakerVerdict {
  const breaker = input.breakerLevelPct ?? DEFAULT_BREAKER_MARGIN_LEVEL_PCT;
  const stopOut = input.stopOutLevelPct ?? COMPETITION_STOP_OUT_LEVEL_PCT;
  const ml = input.marginLevelPct;

  // No used margin → no open positions → nothing to liquidate (MT5 reports margin_level 0 here).
  if (!(input.usedMargin > 0)) {
    return { tripped: false, marginLevelPct: ml, reason: "no open margin — breaker idle" };
  }
  if (Number.isFinite(ml) && ml <= breaker) {
    return {
      tripped: true,
      marginLevelPct: ml,
      reason:
        `margin level ${ml.toFixed(1)}% ≤ breaker ${breaker}% (stop-out ${stopOut}% = elimination) ` +
        `→ FLATTEN ALL to protect survival.`,
    };
  }
  return {
    tripped: false,
    marginLevelPct: ml,
    reason: `margin level ${Number.isFinite(ml) ? ml.toFixed(1) + "%" : "n/a"} > breaker ${breaker}% — ok.`,
  };
}
