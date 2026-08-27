/**
 * Market-breadth daily-bias classifier.
 *
 * Per-symbol regime (RegimeDetector) tells you what ONE instrument is doing.
 * This is the universe-level complement: given a cross-sectional snapshot of the
 * whole market, which of the four strategy-types is it rewarding RIGHT NOW? It
 * places the market on a 2-axis grid — momentum ↔ mean-reversion (the strategy
 * axis) × long ↔ short (the direction axis) — so the agent can "trade only what
 * the market is rewarding" instead of running a momentum book into chop.
 *
 *   - Direction (Y): magnitude-weighted breadth — are returns skewed up or down
 *     across the universe (not one standout name)?
 *   - Strategy (X): trend-cleanliness of the significant movers — are they clean
 *     directional staircases (momentum) or choppy ranges (mean-reversion)?
 *   - Activity modifier: aggregate participation (ticks/volume) vs a baseline —
 *     elevated activity strengthens the momentum lean, depressed strengthens
 *     mean-reversion.
 *
 * Pure: the caller supplies the universe snapshot (Gordon's scanner already
 * produces it) and derives per-symbol trend-cleanliness from efficiency-ratio /
 * ADX / regime confidence. Deterministic tiering, no fitted parameters.
 */

export type DirectionBias = "strong_long" | "mild_long" | "neutral" | "mild_short" | "strong_short";
export type StrategyBias =
  | "strong_momentum"
  | "mild_momentum"
  | "neutral"
  | "mild_mean_reversion"
  | "strong_mean_reversion";
export type FavoredStrategy =
  | "momentum_long"
  | "momentum_short"
  | "mean_reversion_long"
  | "mean_reversion_short";

export interface SymbolSnapshot {
  symbol: string;
  /** Return over the observation window (decimal, e.g. 0.05 = +5%). */
  return: number;
  /** Trend cleanliness 0..1: 1 = clean directional staircase, 0 = pure chop.
   *  Derive from efficiency-ratio / ADX / regime confidence. */
  trendCleanliness: number;
}

export interface MarketBreadthInput {
  symbols: SymbolSnapshot[];
  /** |return| at/above which a symbol counts as a "significant mover". Default 0.05. */
  moverThreshold?: number;
  /** Return magnitude that maps to full directional weight (the breadth cap). Default 0.10. */
  breadthCap?: number;
  /** Aggregate activity (ticks/volume) vs recent baseline, as a ratio (1 = normal,
   *  >1 elevated, <1 depressed). Elevated nudges the strategy axis toward momentum. */
  activityRatio?: number;
}

export interface MarketBreadthBias {
  direction: DirectionBias;
  strategy: StrategyBias;
  /** Magnitude-weighted net breadth, −1..1 (negative = skewed down). */
  breadthScore: number;
  /** Mean trend-cleanliness across the movers (after the activity nudge), 0..1. */
  trendScore: number;
  /** 0..1 — distance from neutral on both axes, scaled by sample sufficiency. */
  conviction: number;
  /** The strategy-types the market is rewarding (0-2). Empty when fully neutral. */
  favored: FavoredStrategy[];
  summary: string;
}

const mean = (xs: number[]): number => (xs.length ? xs.reduce((s, v) => s + v, 0) / xs.length : 0);

function directionTier(b: number): DirectionBias {
  if (b >= 0.5) return "strong_long";
  if (b >= 0.15) return "mild_long";
  if (b <= -0.5) return "strong_short";
  if (b <= -0.15) return "mild_short";
  return "neutral";
}

function strategyTier(t: number): StrategyBias {
  if (t >= 0.7) return "strong_momentum";
  if (t >= 0.55) return "mild_momentum";
  if (t <= 0.3) return "strong_mean_reversion";
  if (t <= 0.45) return "mild_mean_reversion";
  return "neutral";
}

export function classifyMarketBreadth(input: MarketBreadthInput): MarketBreadthBias | null {
  const syms = input.symbols;
  if (syms.length === 0) return null;
  const moverThreshold = input.moverThreshold ?? 0.05;
  const cap = input.breadthCap ?? 0.1;

  // Direction: magnitude-weighted net breadth, bounded so one outlier can't swing it.
  const breadthScore = mean(
    syms.map((s) => Math.sign(s.return) * Math.min(Math.abs(s.return) / cap, 1)),
  );

  // Strategy: trend-cleanliness across the significant movers (fall back to the
  // whole universe when nothing has moved enough to be a mover yet).
  const movers = syms.filter((s) => Math.abs(s.return) >= moverThreshold);
  let trendScore = mean((movers.length ? movers : syms).map((s) => s.trendCleanliness));

  // Activity modifier: elevated participation → momentum, depressed → mean-reversion.
  const activity = input.activityRatio;
  if (activity !== undefined) {
    if (activity >= 1.2) trendScore = Math.min(1, trendScore + 0.07);
    else if (activity <= 0.8) trendScore = Math.max(0, trendScore - 0.07);
  }

  const direction = directionTier(breadthScore);
  const strategy = strategyTier(trendScore);

  const sampleFactor = Math.min(1, syms.length / 20);
  const conviction = Math.min(
    1,
    ((Math.abs(breadthScore) + Math.abs(trendScore - 0.5) * 2) / 2) * sampleFactor,
  );

  // Favored strategy-types from the grid: a clear lean on an axis selects it; an
  // ambiguous (neutral) axis keeps both sides of the axis that IS clear.
  const dir = breadthScore > 0.15 ? "long" : breadthScore < -0.15 ? "short" : null;
  const strat = trendScore > 0.55 ? "momentum" : trendScore < 0.45 ? "mean_reversion" : null;
  let favored: FavoredStrategy[] = [];
  if (dir && strat) favored = [`${strat}_${dir}` as FavoredStrategy];
  else if (dir && !strat)
    favored = [`momentum_${dir}`, `mean_reversion_${dir}`] as FavoredStrategy[];
  else if (!dir && strat) favored = [`${strat}_long`, `${strat}_short`] as FavoredStrategy[];

  const summary =
    favored.length === 0
      ? `No edge: direction ${direction}, strategy ${strategy} (conviction ${conviction.toFixed(2)}) — sit out`
      : `Market rewarding ${favored.join(" / ")} — direction ${direction}, strategy ${strategy}, conviction ${conviction.toFixed(2)}`;

  return { direction, strategy, breadthScore, trendScore, conviction, favored, summary };
}
