/**
 * Competition risk preset — survive-and-compound sizing for the Model to Market
 * hack (and any short, leveraged, Sharpe-judged window).
 *
 * Composes Gordon's existing risk philosophy (per-trade risk cap, volatility
 * targeting, leverage cap, fractional Kelly, exposure cap, daily-loss kill) into
 * ONE sizing decision tuned for the contest's constraints: $1M virtual, leverage
 * available, FX/metals/crypto, judged on Sharpe over ~1 week with a blind phase.
 *
 * Principle: the most CONSERVATIVE binding constraint wins (take the min across
 * caps), so a string of losses can't cause ruin, while volatility targeting keeps
 * risk-adjusted return (Sharpe) front-and-centre. A daily-loss kill halts trading
 * for the day; an exposure cap prevents over-commitment. Pure; never throws.
 *
 * NOT auto-wired into live execution — invoked by selecting this risk profile.
 */

export interface CompetitionRiskParams {
  /** Max fraction of equity risked to the stop on one trade. */
  maxRiskPerTradePct: number;
  /** Max gross leverage (notional / equity) on one position. */
  maxLeverage: number;
  /** Annualized portfolio volatility budget (drives Sharpe-oriented sizing). */
  volTargetAnnual: number;
  /** Daily loss (fraction of equity) that halts trading for the day. */
  dailyLossKillPct: number;
  /** Max fraction of equity in concurrent open notional. */
  maxConcurrentExposurePct: number;
  /** Cap on the Kelly fraction actually used (fractional Kelly). */
  fractionalKelly: number;
}

export const COMPETITION_RISK_DEFAULTS: CompetitionRiskParams = {
  maxRiskPerTradePct: 0.005, // 0.5% per trade — survive a long losing streak
  maxLeverage: 3,
  volTargetAnnual: 0.15, // 15% annualized vol budget
  dailyLossKillPct: 0.03, // stop the day at −3%
  maxConcurrentExposurePct: 0.6,
  fractionalKelly: 0.25,
};

export interface CompetitionTradeInput {
  equity: number;
  price: number;
  /** Price distance from entry to stop (> 0). */
  stopDistance: number;
  /** Annualized volatility of the instrument (fraction; e.g. 0.8 = 80%). */
  instrumentVolAnnual: number;
  /** Current open notional across all positions. */
  openExposureNotional: number;
  /** Today's PnL (realized + unrealized); negative = down on the day. */
  dailyPnL: number;
  /** Optional edge for the Kelly cap. */
  edge?: { winProb: number; payoffRatio: number };
  params?: Partial<CompetitionRiskParams>;
}

export type BindingConstraint =
  | "risk_per_trade"
  | "vol_target"
  | "leverage"
  | "kelly"
  | "exposure_cap"
  | "daily_loss_kill"
  | "none";

export interface CompetitionTradeResult {
  sizeNotional: number;
  sizeUnits: number;
  leverageUsed: number;
  /** Fraction of equity at risk to the stop. */
  riskPct: number;
  bindingConstraint: BindingConstraint;
  verdict: "trade" | "skip" | "halt";
  interpretation: string;
}

const round = (x: number, p = 4): number => parseFloat(x.toFixed(p));

export function sizeCompetitionTrade(input: CompetitionTradeInput): CompetitionTradeResult {
  const p: CompetitionRiskParams = { ...COMPETITION_RISK_DEFAULTS, ...input.params };
  const { equity, price, stopDistance, instrumentVolAnnual, openExposureNotional, dailyPnL } = input;

  const zero = (binding: BindingConstraint, verdict: "skip" | "halt", interp: string): CompetitionTradeResult => ({
    sizeNotional: 0, sizeUnits: 0, leverageUsed: 0, riskPct: 0, bindingConstraint: binding, verdict, interpretation: interp,
  });

  if (!(equity > 0) || !(price > 0) || !(stopDistance > 0) || !(instrumentVolAnnual > 0)) {
    return zero("none", "skip", "invalid inputs (equity, price, stopDistance, instrumentVolAnnual must be > 0)");
  }

  // Daily-loss kill: stop trading for the day.
  if (dailyPnL <= -p.dailyLossKillPct * equity) {
    return zero("daily_loss_kill", "halt", `daily loss ${round((dailyPnL / equity) * 100, 2)}% ≤ −${(p.dailyLossKillPct * 100).toFixed(1)}% kill — halt trading for the day`);
  }

  // Exposure cap: room left for new notional.
  const availableExposure = p.maxConcurrentExposurePct * equity - openExposureNotional;
  if (availableExposure <= 0) {
    return zero("exposure_cap", "skip", `open exposure at the ${(p.maxConcurrentExposurePct * 100).toFixed(0)}%-of-equity cap — skip new entries`);
  }

  // Candidate notionals (most conservative binds).
  const candidates: Array<{ notional: number; constraint: BindingConstraint }> = [
    { notional: (p.maxRiskPerTradePct * equity * price) / stopDistance, constraint: "risk_per_trade" },
    { notional: (p.volTargetAnnual * equity) / instrumentVolAnnual, constraint: "vol_target" },
    { notional: p.maxLeverage * equity, constraint: "leverage" },
    { notional: availableExposure, constraint: "exposure_cap" },
  ];
  if (input.edge) {
    const { winProb, payoffRatio } = input.edge;
    const rawKelly = payoffRatio > 0 ? winProb - (1 - winProb) / payoffRatio : 0;
    const usedKelly = Math.max(0, rawKelly) * p.fractionalKelly; // fractional Kelly as a risk fraction
    candidates.push({ notional: (usedKelly * equity * price) / stopDistance, constraint: "kelly" });
  }

  const binding = candidates.reduce((min, c) => (c.notional < min.notional ? c : min));
  const sizeNotional = Math.max(0, binding.notional);
  const sizeUnits = sizeNotional / price;
  const leverageUsed = sizeNotional / equity;
  const riskPct = (sizeUnits * stopDistance) / equity;

  if (sizeNotional <= 0) {
    return zero(binding.constraint, "skip", `sizing collapsed to zero (binding: ${binding.constraint})`);
  }

  return {
    sizeNotional: round(sizeNotional, 2),
    sizeUnits: round(sizeUnits, 6),
    leverageUsed: round(leverageUsed, 3),
    riskPct: round(riskPct, 5),
    bindingConstraint: binding.constraint,
    verdict: "trade",
    interpretation: `size ${round(sizeNotional, 0)} notional (${round(leverageUsed, 2)}× lev, ${round(riskPct * 100, 2)}% risk) — binding: ${binding.constraint}; survive-and-compound`,
  };
}
