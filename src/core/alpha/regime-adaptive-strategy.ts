/**
 * Regime-adaptive strategy primitive.
 *
 * HONEST POSTURE — READ THIS FIRST. This is NOT a proven alpha. Across this
 * session's cost-honest validations on the Model to Market data, no single
 * signal showed a stable edge after costs (spread + slippage), in or out of
 * sample. Short-term reversal was the least-bad cross-sectional signal; raw
 * momentum-breakout bled costs in chop. This module is the honest best-available
 * DEFAULT: it doesn't claim to find alpha, it tries not to fail catastrophically
 * in EITHER regime by adapting which (already principled) signal fires.
 *
 * The idea: a strategy that mean-reverts in a trending market, or chases
 * breakouts in a choppy one, is structurally wrong in the worst way. So:
 *
 *   1. Classify the recent regime from the last N closes via the Kaufman
 *      efficiency ratio (|net move| / Σ|bar moves|). HIGH ER (clean directional
 *      move, > ~0.4) → TRENDING; LOW ER (price churns, little net travel) → CHOPPY.
 *   2. CHOPPY  → mean-reversion. Reuse `reversalSignal`: fade oversold → long,
 *      overbought → short. Mean-reversion is the regime-appropriate bet when
 *      price oscillates around a level with no net travel.
 *   3. TRENDING → momentum. Enter WITH the trend on a fresh N-bar breakout
 *      (close > recent high → long; close < recent low → short). Chasing a
 *      breakout only makes sense when the move actually carries.
 *   4. Stop/target scale with recent realized volatility (per-bar return stdev
 *      × price), so sizing/exits are comparable across instruments.
 *   5. Return null when the chosen regime's signal doesn't fire.
 *
 * Its value, IF ANY, is robustness across regimes + not taking the structurally
 * wrong bet — NOT a demonstrated positive expectancy. Validate per-instrument,
 * out-of-sample, after costs, before trusting it (see
 * `scripts/dev/momq-regime-adaptive-validate.ts`).
 *
 * Pure: no I/O, no venue, no LLM. Defensive on short input (returns null).
 */

import { reversalSignal, type ReversalSignalOptions } from "./reversal-strategy.ts";
import type { DryRunSignal } from "../../backtest/competition-dry-run.ts";

/** Population standard deviation. Fewer than 2 points → 0. */
function std(xs: ReadonlyArray<number>): number {
  if (xs.length < 2) return 0;
  let s = 0;
  for (const v of xs) s += v;
  const m = s / xs.length;
  let acc = 0;
  for (const v of xs) acc += (v - m) ** 2;
  return Math.sqrt(acc / xs.length);
}

/** Simple consecutive-close returns of the last `n+1` closes → up to `n` returns. */
function recentReturns(closes: ReadonlyArray<number>, n: number): number[] {
  const out: number[] = [];
  const start = Math.max(1, closes.length - n);
  for (let i = start; i < closes.length; i++) {
    const prev = closes[i - 1]!;
    if (prev > 0) out.push(closes[i]! / prev - 1);
  }
  return out;
}

/**
 * Kaufman efficiency ratio over the last `lookback` closes:
 *
 *   ER = |close_last − close_first| / Σ |close_i − close_{i-1}|
 *
 * 1 = a perfectly straight directional move; → 0 = lots of motion, no net
 * travel (choppy). Degenerate input (flat series, < 2 points) → 0.
 */
export function efficiencyRatio(closes: ReadonlyArray<number>, lookback: number): number {
  const lb = Math.max(2, Math.floor(lookback));
  if (closes.length < 2) return 0;
  const window = closes.slice(-lb);
  if (window.length < 2) return 0;
  const net = Math.abs(window[window.length - 1]! - window[0]!);
  let path = 0;
  for (let i = 1; i < window.length; i++) path += Math.abs(window[i]! - window[i - 1]!);
  if (path <= 0) return 0;
  return net / path;
}

/**
 * Classify the recent regime from a close series via the efficiency ratio.
 * ER above `erThreshold` (default 0.4) → "trending"; otherwise "choppy".
 */
export function classifyRegime(
  closes: ReadonlyArray<number>,
  lookback: number,
  erThreshold = 0.4,
): "trending" | "choppy" {
  return efficiencyRatio(closes, lookback) > erThreshold ? "trending" : "choppy";
}

export interface RegimeAdaptiveOptions {
  /** Lookback for regime classification, the breakout window, and the vol estimate. Default 20. */
  lookback?: number;
  /** Efficiency-ratio cut for trending vs choppy. Default 0.4. */
  erThreshold?: number;
  /** Options forwarded to `reversalSignal` in the choppy branch. */
  reversal?: ReversalSignalOptions;
  /** Stop distance = oneSigma × stopMult (momentum branch). Default 2. */
  stopMult?: number;
  /** Target distance = oneSigma × targetMult (momentum branch). Default 3. */
  targetMult?: number;
}

/**
 * Regime-adaptive signal off a close series.
 *
 *   CHOPPY   → mean-reversion via `reversalSignal` (oversold → long, overbought → short).
 *   TRENDING → momentum breakout: close above the prior `lookback`-bar high → long,
 *              below the prior `lookback`-bar low → short, in the trend's direction.
 *   null     when the chosen regime's signal doesn't fire, or on short input.
 *
 * The breakout compares the latest close to the high/low of the PRIOR bars
 * (excluding the latest) so the fire is a genuine fresh break, not the latest
 * bar comparing against itself. Stop/target scale with recent realized vol.
 *
 * This is a principled adaptive DEFAULT, NOT a proven edge — see the module
 * header. Pure; defensive on short input.
 */
export function regimeAdaptiveSignal(
  closes: ReadonlyArray<number>,
  opts: RegimeAdaptiveOptions = {},
): DryRunSignal | null {
  const lookback = Math.max(2, Math.floor(opts.lookback ?? 20));
  const erThreshold = opts.erThreshold ?? 0.4;
  const stopMult = opts.stopMult ?? 2;
  const targetMult = opts.targetMult ?? 3;

  if (closes.length < lookback + 1) return null;

  const regime = classifyRegime(closes, lookback, erThreshold);

  if (regime === "choppy") {
    // Mean-reversion is regime-appropriate when price oscillates with no net travel.
    const rev = reversalSignal(closes, { lookback, ...opts.reversal });
    if (!rev) return null;
    return {
      side: rev.side,
      stopDistance: rev.stopDistance,
      targetDistance: rev.targetDistance,
    };
  }

  // TRENDING → momentum: fresh N-bar breakout in the direction of the move.
  const price = closes[closes.length - 1]!;
  if (!(price > 0)) return null;

  // Prior window EXCLUDING the latest close, so the break is genuine.
  const prior = closes.slice(-(lookback + 1), -1);
  if (prior.length < 2) return null;
  const hi = Math.max(...prior);
  const lo = Math.min(...prior);

  const volFraction = std(recentReturns(closes, lookback));
  const oneSigma = price * Math.max(volFraction, 1e-6);

  if (price > hi) {
    return { side: "long", stopDistance: oneSigma * stopMult, targetDistance: oneSigma * targetMult };
  }
  if (price < lo) {
    return { side: "short", stopDistance: oneSigma * stopMult, targetDistance: oneSigma * targetMult };
  }
  return null;
}
