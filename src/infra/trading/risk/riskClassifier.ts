/**
 * Trade Risk Classifier — Rule-Based Risk Scoring
 *
 * Trading equivalent of Claude Code's bash command classifier. Evaluates
 * proposed trades against multiple risk dimensions and returns a composite
 * risk score + tier. Used by the permission system to auto-approve low-risk
 * trades and escalate high-risk ones.
 *
 * Dimensions scored:
 *   1. Position size (% of portfolio)
 *   2. Concentration (single-asset weight)
 *   3. Correlation (with existing positions)
 *   4. Volatility regime (VIX/ATR context)
 *   5. Time-of-day (market hours, after-hours)
 *   6. Frequency (trades per hour)
 *   7. Drawdown proximity (how close to daily/max limits)
 *   8. Asset familiarity (traded before vs new)
 */

// ============================================================================
// Types
// ============================================================================

export type RiskTier = "low" | "medium" | "high" | "critical";

export interface RiskDimension {
  name: string;
  score: number;    // 0-100 (0 = no risk, 100 = max risk)
  weight: number;   // Importance multiplier
  reason: string;
}

export interface RiskAssessment {
  /** Composite score (0-100). */
  compositeScore: number;
  /** Risk tier derived from composite. */
  tier: RiskTier;
  /** Individual dimension scores. */
  dimensions: RiskDimension[];
  /** Top risk factors (sorted by weighted score). */
  topFactors: string[];
  /** Recommended action. */
  recommendation: "auto_approve" | "prompt_user" | "require_confirmation" | "block";
  /** Human-readable summary. */
  summary: string;
}

export interface TradeProposal {
  symbol: string;
  side: "BUY" | "SELL";
  quantity: number;
  price: number;
  notionalUsd: number;
  orderType: "MARKET" | "LIMIT" | "STOP";
  /** Venue. */
  venue?: string;
}

export interface PortfolioContext {
  totalValueUsd: number;
  cashUsd: number;
  positions: Array<{
    symbol: string;
    notionalUsd: number;
    weightPct: number;
    unrealizedPnlPct: number;
  }>;
  /** Daily realized P&L. */
  dailyPnlUsd: number;
  /** Max daily loss limit. */
  dailyLossLimitUsd: number;
  /** Max drawdown limit (%). */
  maxDrawdownPct: number;
  /** Current drawdown (%). */
  currentDrawdownPct: number;
  /** Trades executed in the last hour. */
  recentTradeCount: number;
  /** Symbols the user has traded before. */
  tradedSymbols: Set<string>;
  // ── Hedge fund-grade data (optional — enhances scoring when available) ──
  /** Historical prices for the target symbol (for vol-percentile + tail risk). */
  targetPriceHistory?: number[];
  /** Daily returns for each existing position (for correlation check). */
  positionReturns?: Record<string, { returns: number[]; weightPct: number }>;
  /** Daily returns for the new symbol (for correlation check). */
  targetReturns?: number[];
  /** Whether the asset is crypto (365 trading days) or stock (252). */
  isCrypto?: boolean;
  /**
   * Optional regime-transition snapshot from `calculateMarkovRegime` (or
   * any equivalent regime model). When supplied, the classifier scores
   * the probability of a regime shift away from the current state —
   * high shift probability means the matrix's "stay" probability is
   * weak, so the operator's existing edge assumption may not hold.
   *
   *   probShift ∈ [0, 1] = 1 - probability of staying in current state
   *   matrixStability indicates whether the transition matrix is itself
   *   trustworthy (drifting / unstable matrices reduce the weight of
   *   any signal derived from them).
   */
  regimeTransition?: {
    probShift: number;
    currentState: "bull" | "neutral" | "bear";
    matrixStability?: "stable" | "drifting" | "unstable" | "insufficient_data";
  };
  /**
   * Optional MEV-exposure classification for the venue this trade will
   * route through. Per Budish's market-design analysis: continuous-LOB
   * venues carry a structural sniping tax; crypto adds a mempool layer
   * (DEXes) where sandwich and frontrun attacks are documented. When
   * supplied, classifier surfaces the exposure as a dimension so the
   * operator sees the cost they're paying invisibly.
   *
   * Construct via `classifyVenue(venueId)` or `buildVenueMevExposure(tier)`
   * from `./venueMevExposure.ts`.
   */
  venueMevExposure?: {
    tier: "low" | "medium" | "high" | "protected" | "unknown";
    score: number;
    reason: string;
  };
}

export interface ClassifierConfig {
  /** Thresholds for tier classification. */
  tiers: { low: number; medium: number; high: number };
  /** Max position size as % of portfolio before escalation. */
  maxPositionPct: number;
  /** Max single-asset concentration before escalation. */
  maxConcentrationPct: number;
  /** Max trades per hour before escalation. */
  maxTradesPerHour: number;
  /** Volatility multiplier (1.0 = normal, >1.5 = high vol). */
  volatilityMultiplier?: number;
  /** Current market hours state. */
  isMarketHours?: boolean;
  /**
   * Regime-transition probability above which the classifier escalates
   * the verdict (default 0.30 — i.e. when the matrix says there's a
   * >30% chance of leaving the current state, treat the trade as if the
   * operator's regime-based edge assumption is fragile).
   */
  regimeTransitionThreshold?: number;
}

export const DEFAULT_CLASSIFIER_CONFIG: ClassifierConfig = {
  tiers: { low: 25, medium: 50, high: 75 },
  maxPositionPct: 5,
  maxConcentrationPct: 20,
  maxTradesPerHour: 10,
  volatilityMultiplier: 1.0,
  isMarketHours: true,
  regimeTransitionThreshold: 0.30,
};

// ============================================================================
// Classifier
// ============================================================================

export function classifyTradeRisk(
  trade: TradeProposal,
  portfolio: PortfolioContext,
  config: ClassifierConfig = DEFAULT_CLASSIFIER_CONFIG,
): RiskAssessment {
  const dimensions: RiskDimension[] = [];

  // 1. Position size
  const positionPct = (trade.notionalUsd / portfolio.totalValueUsd) * 100;
  const positionScore = Math.min(100, (positionPct / config.maxPositionPct) * 50);
  dimensions.push({
    name: "Position Size",
    score: positionScore,
    weight: 1.5,
    reason: `${positionPct.toFixed(1)}% of portfolio (limit: ${config.maxPositionPct}%)`,
  });

  // 2. Concentration
  const existingWeight = portfolio.positions.find((p) => p.symbol === trade.symbol)?.weightPct ?? 0;
  const newWeight = existingWeight + (trade.notionalUsd / portfolio.totalValueUsd) * 100;
  const concentrationScore = Math.min(100, (newWeight / config.maxConcentrationPct) * 50);
  dimensions.push({
    name: "Concentration",
    score: concentrationScore,
    weight: 1.3,
    reason: `${trade.symbol} would be ${newWeight.toFixed(1)}% of portfolio (limit: ${config.maxConcentrationPct}%)`,
  });

  // 3. Drawdown proximity
  const drawdownRoom = config.maxPositionPct - portfolio.currentDrawdownPct;
  const drawdownScore = drawdownRoom <= 0 ? 100 : Math.min(100, (1 - drawdownRoom / portfolio.maxDrawdownPct) * 100);
  dimensions.push({
    name: "Drawdown Proximity",
    score: Math.max(0, drawdownScore),
    weight: 1.4,
    reason: `Current drawdown: ${portfolio.currentDrawdownPct.toFixed(1)}%, limit: ${portfolio.maxDrawdownPct}%`,
  });

  // 4. Daily loss proximity
  const dailyLossUsed = Math.abs(Math.min(0, portfolio.dailyPnlUsd));
  const dailyLossScore = portfolio.dailyLossLimitUsd > 0
    ? Math.min(100, (dailyLossUsed / portfolio.dailyLossLimitUsd) * 100)
    : 0;
  dimensions.push({
    name: "Daily Loss Budget",
    score: dailyLossScore,
    weight: 1.2,
    reason: `Used $${dailyLossUsed.toFixed(0)} of $${portfolio.dailyLossLimitUsd.toFixed(0)} daily loss limit`,
  });

  // 5. Trade frequency
  const freqScore = Math.min(100, (portfolio.recentTradeCount / config.maxTradesPerHour) * 100);
  dimensions.push({
    name: "Trade Frequency",
    score: freqScore,
    weight: 0.8,
    reason: `${portfolio.recentTradeCount} trades in last hour (limit: ${config.maxTradesPerHour})`,
  });

  // 6. Volatility regime
  const volMultiplier = config.volatilityMultiplier ?? 1.0;
  const volScore = volMultiplier > 2.0 ? 80 : volMultiplier > 1.5 ? 50 : volMultiplier > 1.2 ? 20 : 0;
  dimensions.push({
    name: "Volatility",
    score: volScore,
    weight: 1.0,
    reason: `Vol multiplier: ${volMultiplier.toFixed(1)}x normal`,
  });

  // 7. Market hours
  const hoursScore = config.isMarketHours ? 0 : 30;
  dimensions.push({
    name: "Market Hours",
    score: hoursScore,
    weight: 0.6,
    reason: config.isMarketHours ? "Within market hours" : "After-hours trading (wider spreads)",
  });

  // 8. Asset familiarity
  const familiar = portfolio.tradedSymbols.has(trade.symbol);
  const familiarityScore = familiar ? 0 : 40;
  dimensions.push({
    name: "Asset Familiarity",
    score: familiarityScore,
    weight: 0.5,
    reason: familiar ? `Previously traded ${trade.symbol}` : `First time trading ${trade.symbol}`,
  });

  // ── MANDATORY HEDGE FUND-GRADE CHECKS (when data available) ──

  // 9. Volatility-percentile position sizing
  if (portfolio.targetPriceHistory && portfolio.targetPriceHistory.length >= 60) {
    const { computeVolatilityProfile, computeAnnualizedVol, pricesToReturns, buildVolDistribution } = require("./volatilityPositionSizing.ts") as typeof import("./volatilityPositionSizing.ts");
    const isCrypto = portfolio.isCrypto ?? true;
    const tradingDays = isCrypto ? 365 : 252;
    const returns = pricesToReturns(portfolio.targetPriceHistory);
    const currentVol = computeAnnualizedVol(returns.slice(-60), tradingDays);
    const volDist = buildVolDistribution(portfolio.targetPriceHistory, 60, tradingDays);
    const volProfile = computeVolatilityProfile(currentVol, volDist, config.maxPositionPct);

    // Score: if proposed size exceeds vol-adjusted limit, escalate
    const proposedPct = (trade.notionalUsd / portfolio.totalValueUsd) * 100;
    const overageRatio = proposedPct / Math.max(1, volProfile.recommendedSizePct);
    const volSizeScore = overageRatio > 2 ? 90 : overageRatio > 1.5 ? 70 : overageRatio > 1 ? 40 : 0;
    dimensions.push({
      name: "Vol-Adjusted Sizing",
      score: volSizeScore,
      weight: 1.6,
      reason: `Vol regime: ${volProfile.regime} (${(currentVol * 100).toFixed(0)}% annualized). ` +
        `Recommended max: ${volProfile.recommendedSizePct.toFixed(1)}%, proposed: ${proposedPct.toFixed(1)}%`,
    });
  }

  // 10. Correlation with existing positions
  if (portfolio.targetReturns && portfolio.positionReturns && Object.keys(portfolio.positionReturns).length > 0) {
    const { checkCorrelationRisk } = require("./correlationLimits.ts") as typeof import("./correlationLimits.ts");
    const corrCheck = checkCorrelationRisk(
      trade.symbol,
      portfolio.targetReturns,
      portfolio.positionReturns,
      (trade.notionalUsd / portfolio.totalValueUsd) * 100,
    );
    const corrScore = corrCheck.maxCorrelation > 0.8 ? 80
      : corrCheck.maxCorrelation > 0.6 ? 50
      : corrCheck.maxCorrelation > 0.4 ? 20
      : 0;
    dimensions.push({
      name: "Correlation Risk",
      score: corrScore,
      weight: 1.4,
      reason: `Max correlation: ${(corrCheck.maxCorrelation * 100).toFixed(0)}% with ${corrCheck.mostCorrelatedWith}` +
        (corrCheck.concentrationWarning ? " — CONCENTRATION WARNING" : ""),
    });
  }

  // 13. Venue MEV exposure — surface the structural sniping/MEV tax
  // baked into the venue's market design. Per Budish's analysis: every
  // continuous-LOB venue has a sniping tax; public-mempool venues
  // (DEXes) add a sandwich/frontrun layer on top. Operator sees the
  // exposure so they can route around it (CoW Swap, MEV-protected RPC).
  if (portfolio.venueMevExposure) {
    const mev = portfolio.venueMevExposure;
    dimensions.push({
      name: "Venue MEV Exposure",
      score: Math.max(0, Math.min(100, mev.score)),
      weight: 1.0,
      reason: `Venue tier: ${mev.tier} — ${mev.reason}`,
    });
  }

  // 12. Regime-transition risk — escalate when the Markov matrix says
  // the current regime is fragile (high probability of flipping) OR
  // when the matrix itself is unstable (chi-square test rejects
  // stationarity). Either signal means the operator's regime-based
  // edge assumption shouldn't get the usual auto-approval discount.
  if (portfolio.regimeTransition) {
    const rt = portfolio.regimeTransition;
    const threshold = config.regimeTransitionThreshold ?? 0.30;
    const probShift = Math.max(0, Math.min(1, rt.probShift));

    // Base score from shift probability above threshold
    let regimeScore = probShift > threshold
      ? Math.min(80, ((probShift - threshold) / (1 - threshold)) * 80)
      : 0;

    // Matrix-stability multiplier: drifting → +20, unstable → +40,
    // insufficient_data → +10 (signal too weak to trust either way)
    let stabilityNote = "";
    if (rt.matrixStability === "drifting") {
      regimeScore = Math.min(100, regimeScore + 20);
      stabilityNote = ", transition matrix is DRIFTING";
    } else if (rt.matrixStability === "unstable") {
      regimeScore = Math.min(100, regimeScore + 40);
      stabilityNote = ", transition matrix is UNSTABLE — discard inferences";
    } else if (rt.matrixStability === "insufficient_data") {
      regimeScore = Math.min(100, regimeScore + 10);
      stabilityNote = ", insufficient data for stability check";
    }

    dimensions.push({
      name: "Regime Transition Risk",
      score: regimeScore,
      weight: 1.2,
      reason:
        `Current state ${rt.currentState}, shift probability ${(probShift * 100).toFixed(0)}% ` +
        `(threshold ${(threshold * 100).toFixed(0)}%)${stabilityNote}`,
    });
  }

  // 11. Tail risk
  if (portfolio.targetPriceHistory && portfolio.targetPriceHistory.length >= 60) {
    const { computeTailRisk } = require("./tailRisk.ts") as typeof import("./tailRisk.ts");
    const tailProfile = computeTailRisk(portfolio.targetPriceHistory);
    const tailScore = tailProfile.classification === "highly_fragile" ? 90
      : tailProfile.classification === "fragile" ? 60
      : tailProfile.classification === "robust" ? 20
      : 0; // antifragile = bonus
    dimensions.push({
      name: "Tail Risk",
      score: tailScore,
      weight: 1.3,
      reason: `${tailProfile.classification} (score: ${tailProfile.tailRiskScore.toFixed(0)}/100, ` +
        `skew: ${tailProfile.skewness.toFixed(2)}, max DD: ${(tailProfile.maxDrawdown * 100).toFixed(0)}%)`,
    });
  }

  // Compute weighted composite
  const totalWeight = dimensions.reduce((sum, d) => sum + d.weight, 0);
  const compositeScore = dimensions.reduce((sum, d) => sum + d.score * d.weight, 0) / totalWeight;

  // Classify tier
  const tier: RiskTier =
    compositeScore >= config.tiers.high ? "critical" :
    compositeScore >= config.tiers.medium ? "high" :
    compositeScore >= config.tiers.low ? "medium" :
    "low";

  // Top factors
  const topFactors = dimensions
    .filter((d) => d.score > 20)
    .sort((a, b) => b.score * b.weight - a.score * a.weight)
    .slice(0, 3)
    .map((d) => d.reason);

  // Recommendation
  const recommendation =
    tier === "critical" ? "block" as const :
    tier === "high" ? "require_confirmation" as const :
    tier === "medium" ? "prompt_user" as const :
    "auto_approve" as const;

  const summary = tier === "low"
    ? `Low risk trade: ${trade.side} ${trade.quantity} ${trade.symbol} ($${trade.notionalUsd.toFixed(0)})`
    : `${tier.toUpperCase()} risk: ${topFactors[0] ?? "multiple factors"}`;

  return {
    compositeScore: Math.round(compositeScore),
    tier,
    dimensions,
    topFactors,
    recommendation,
    summary,
  };
}
