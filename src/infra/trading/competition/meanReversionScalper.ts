/**
 * Mean-reversion scalper — the trade-count + smoothness engine of the Best-Sharpe core.
 *
 * The integrated pairs book (`pairsCompetitionStrategy.ts`) produces a beautifully
 * smooth dollar-neutral curve but is TRADE-STARVED on the thin 15-instrument comp
 * universe (only ETH/XRP cointegrates over a short window → < the §17 30-trade floor).
 * This scalper fills that gap: a per-instrument mean-reversion signal that fires often
 * in the chop regime (our regime scan: ~42% of the panel is ranging), producing the
 * many small, low-variance round-trips that (a) clear the ≥30-trade Best-Sharpe floor
 * and (b) keep the equity curve smooth (high win-rate, tight brackets).
 *
 * Why mean-reversion, not trend, for Best-Sharpe: a spread/price oscillating around a
 * short mean yields many small wins (tight per-bar PnL distribution = low Sharpe
 * denominator). Trend produces lumpy, fat-tailed PnL. In a chop-dominated, zero-
 * commission, taker-only venue, cheap high-frequency reversion is the right tool.
 *
 * This is a per-symbol single-leg `SignalFn` (fits `CompetitionLiveTrader` directly).
 * It composes with the pairs core: both are low-variance, so summing them keeps the
 * combined curve smooth while the scalper carries the trade count the pairs can't.
 *
 * NOT a claimed return edge — mean-reversion didn't clear the deflated bar as durable
 * alpha. Its value here is the SHAPE of the curve (smooth, many small trades), which is
 * what the Best-Sharpe (10%) + Drawdown (15%) ranks and the §17 award actually reward.
 */

import type { Mt5Bar } from "../../broker/mt5/bridgeClient.ts";
import type { SignalFn, LiveSignal } from "./liveTrader.ts";

export interface ScalperOptions {
  /** Rolling window for the mean/stdev z-score (M15 bars). Default 24 (~6h). */
  lookback?: number;
  /** |z| beyond which a deviation is faded. Default 1.5. */
  entryZ?: number;
  /** Fraction of the current deviation captured as the take-profit (toward the mean). Default 0.7. */
  reversionFrac?: number;
  /** Protective stop in rolling-stdev units (price continues away from the mean). Default 2. */
  stopStd?: number;
  /** Skip names whose recent move looks like a strong trend, not chop (efficiency ratio gate). Default 0.6. */
  maxEfficiencyRatio?: number;
}

const mean = (xs: number[]) => xs.reduce((s, v) => s + v, 0) / (xs.length || 1);
function stdev(xs: number[]): number {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  return Math.sqrt(xs.reduce((s, v) => s + (v - m) ** 2, 0) / (xs.length - 1));
}

/**
 * Kaufman efficiency ratio over the window: |net move| / Σ|bar moves| ∈ [0,1].
 * Near 1 = clean trend (reversion is dangerous → skip); near 0 = choppy (reversion
 * is favorable). This is the gate that keeps the scalper OUT of the trending names
 * where fading bleeds — the single most important filter for a smooth curve.
 */
function efficiencyRatio(closes: number[]): number {
  if (closes.length < 2) return 1;
  const net = Math.abs(closes[closes.length - 1]! - closes[0]!);
  let path = 0;
  for (let i = 1; i < closes.length; i++) path += Math.abs(closes[i]! - closes[i - 1]!);
  return path > 0 ? net / path : 0;
}

/**
 * Build the mean-reversion scalper SignalFn. Computes a short rolling z-score of the
 * close; when |z| exceeds `entryZ` AND the window is choppy (low efficiency ratio),
 * fades the deviation: below mean → long, above mean → short. Take-profit is a
 * fraction of the snap-back to the mean (tight, reachable → high win rate); stop is
 * a few stdevs further out (cuts the occasional trend-against loss fast).
 */
export function makeMeanReversionScalper(opts: ScalperOptions = {}): SignalFn {
  const lookback = opts.lookback ?? 24;
  const entryZ = opts.entryZ ?? 1.5;
  const reversionFrac = opts.reversionFrac ?? 0.7;
  const stopStd = opts.stopStd ?? 2;
  const maxER = opts.maxEfficiencyRatio ?? 0.6;

  return (bars: Mt5Bar[]): LiveSignal | null => {
    if (bars.length < lookback + 1) return null;
    const closes = bars.slice(-lookback).map((b) => b.close);
    const last = closes[closes.length - 1]!;
    if (!(last > 0)) return null;

    const m = mean(closes);
    const sd = stdev(closes);
    if (!(sd > 0)) return null;

    const z = (last - m) / sd;
    if (Math.abs(z) < entryZ) return null; // not stretched enough

    // Chop gate: only fade when the window is NOT trending (efficiency ratio low).
    if (efficiencyRatio(closes) > maxER) return null;

    const deviation = Math.abs(last - m); // price distance from the mean
    const target = Math.max(reversionFrac * deviation, sd * 0.25); // snap-back, floored
    const stop = stopStd * sd; // continuation beyond the deviation

    return {
      side: z < 0 ? "long" : "short", // below mean → buy, above mean → sell
      stopDistance: stop,
      targetDistance: target,
    };
  };
}

/** Frozen scalper config for the live week — tuned for a smooth, ≥30-trade Best-Sharpe curve. */
export const COMPETITION_SCALPER_OPTS: Required<ScalperOptions> = {
  lookback: 24,
  entryZ: 1.5,
  reversionFrac: 0.7,
  stopStd: 2,
  maxEfficiencyRatio: 0.6,
};
