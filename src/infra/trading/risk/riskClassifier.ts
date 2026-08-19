/**
 * Trade Risk Classifier — Rule-Based Risk Scoring
 *
 * Trading equivalent of Claude Code's bash command classifier. Evaluates
 * proposed trades against multiple risk dimensions and returns a composite
 * risk score + tier. Used by the permission system to auto-approve low-risk
 * trades and escalate high-risk ones.
 *
 * Dimensions scored (15 total — 8 base always-on + 7 optional when inputs exist):
 *   Base: position size, concentration, drawdown proximity, daily loss budget,
 *         trade frequency, volatility, market hours, asset familiarity.
 *   Optional: vol-adjusted sizing, correlation risk, venue MEV exposure,
 *              regime transition risk, fake liquidity, margin of error, tail risk.
 */

import {
  buildVolDistribution,
  computeAnnualizedVol,
  computeVolatilityProfile,
  pricesToReturns,
} from "./volatilityPositionSizing.ts";
import { checkCorrelationRisk } from "./correlationLimits.ts";
import { computeTailRisk } from "./tailRisk.ts";
import {
  buildFamiliarityReferences,
  evaluateFamiliarity,
  priceHistoryToStateVectors,
} from "../../../core/regime/familiarity.ts";


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
  /**
   * Optional fake-liquidity verdict from `analyzeFakeLiquidity`. When
   * supplied, classifier penalizes trades into symbols where the book
   * appears wash-traded — headline volume passes the threshold gate
   * but per-candle move-per-dollar shows outlier-heavy contamination.
   * Spicy's "huge move on no volume" tell, formalized.
   */
  fakeLiquidity?: {
    verdict: "real_liquidity" | "suspicious" | "fake_liquidity" | "insufficient_data";
    outlierFraction: number;
  };
  /**
   * Optional margin-of-error grade from `computeMarginOfError`. When
   * supplied, classifier folds the environment-fit verdict into the
   * composite — fully out-of-sync trades (Grade C) get a hard penalty,
   * A+ defensive-only trades get a smaller one, in-sync (B) gets a
   * discount. The grade also feeds suggested sizing downstream.
   */
  marginOfError?: {
    grade: "A+" | "A" | "B" | "C";
    rawScore: number;
    recommendation:
      | "take_aggressively"
      | "take_normally"
      | "take_only_high_quality"
      | "skip";
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
// Input validation — trade boundary guards
// ============================================================================

export function validateTradeProposal(trade: TradeProposal): string[] {
  const errors: string[] = [];
  if (!trade.symbol || trade.symbol.trim() === "") {
    errors.push("symbol is empty");
  }
  if (!Number.isFinite(trade.quantity) || trade.quantity <= 0) {
    errors.push(`quantity must be a finite positive number (got ${trade.quantity})`);
  }
  // price === 0 is a known failure sentinel from upstream data layers
  // (e.g. all quote sources down) — fail closed, never size against it.
  if (!Number.isFinite(trade.price) || trade.price <= 0) {
    errors.push(`price must be a finite positive number (got ${trade.price})`);
  }
  if (!Number.isFinite(trade.notionalUsd) || trade.notionalUsd <= 0) {
    errors.push(`notionalUsd must be a finite positive number (got ${trade.notionalUsd})`);
  }
  return errors;
}

export function validatePortfolioContext(portfolio: PortfolioContext): string[] {
  const errors: string[] = [];
  if (!Number.isFinite(portfolio.totalValueUsd) || portfolio.totalValueUsd <= 0) {
    errors.push(`totalValueUsd must be a finite positive number (got ${portfolio.totalValueUsd})`);
  }
  if (!Number.isFinite(portfolio.cashUsd)) {
    errors.push(`cashUsd must be a finite number (got ${portfolio.cashUsd})`);
  }
  if (!Number.isFinite(portfolio.dailyPnlUsd)) {
    errors.push(`dailyPnlUsd must be a finite number (got ${portfolio.dailyPnlUsd})`);
  }
  if (!Number.isFinite(portfolio.dailyLossLimitUsd) || portfolio.dailyLossLimitUsd < 0) {
    errors.push(`dailyLossLimitUsd must be a finite non-negative number (got ${portfolio.dailyLossLimitUsd})`);
  }
  if (!Number.isFinite(portfolio.maxDrawdownPct) || portfolio.maxDrawdownPct <= 0 || portfolio.maxDrawdownPct > 100) {
    errors.push(`maxDrawdownPct must be in (0, 100] (got ${portfolio.maxDrawdownPct})`);
  }
  if (!Number.isFinite(portfolio.currentDrawdownPct) || portfolio.currentDrawdownPct < 0 || portfolio.currentDrawdownPct > 100) {
    errors.push(`currentDrawdownPct must be in [0, 100] (got ${portfolio.currentDrawdownPct})`);
  }
  if (!Number.isFinite(portfolio.recentTradeCount) || portfolio.recentTradeCount < 0) {
    errors.push(`recentTradeCount must be a finite non-negative number (got ${portfolio.recentTradeCount})`);
  }
  return errors;
}

function invalidInputAssessment(errors: string[]): RiskAssessment {
  return {
    compositeScore: 100,
    tier: "critical",
    dimensions: [{
      name: "Input Validation",
      score: 100,
      weight: 1,
      reason: errors.join("; "),
    }],
    topFactors: errors.slice(0, 3),
    recommendation: "block",
    summary: `BLOCKED — invalid trade input: ${errors[0]}`,
  };
}

// ============================================================================
// Classifier
// ============================================================================

export function classifyTradeRisk(
  trade: TradeProposal,
  portfolio: PortfolioContext,
  config: ClassifierConfig = DEFAULT_CLASSIFIER_CONFIG,
): RiskAssessment {
  const validationErrors = [
    ...validateTradeProposal(trade),
    ...validatePortfolioContext(portfolio),
  ];
  if (validationErrors.length > 0) {
    return invalidInputAssessment(validationErrors);
  }

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
  // Having traded the symbol before says nothing about whether the market is in
  // a state the operator has seen. When price history is available the symbol
  // check is joined by a distributional one, and the dimension takes the worse
  // of the two: a known symbol in an unprecedented regime is not familiar.
  const familiar = portfolio.tradedSymbols.has(trade.symbol);
  const symbolScore = familiar ? 0 : 40;
  let familiarityScore = symbolScore;
  let familiarityReason = familiar
    ? `Previously traded ${trade.symbol}`
    : `First time trading ${trade.symbol}`;

  if (portfolio.targetPriceHistory && portfolio.targetPriceHistory.length >= 90) {
    try {
      const states = priceHistoryToStateVectors(portfolio.targetPriceHistory, 10);
      const recentCount = 3;
      if (states.length >= 12) {
        const reference = states.slice(0, -recentCount);
        const gate = evaluateFamiliarity({
          references: buildFamiliarityReferences([
            { label: "observed_history", vectors: reference },
          ]),
          window: states.slice(-recentCount),
          nowMs: 0,
        });
        if (gate.outOfDistribution) {
          familiarityScore = Math.max(symbolScore, 60);
          familiarityReason +=
            `, but the current state sits outside the distribution of the prior ` +
            `${reference.length} observed states (familiarity ${gate.score.toFixed(2)})`;
        } else if (gate.reason === "matched") {
          familiarityReason += `; market state is within observed history`;
        }
      }
    } catch (err) {
      familiarityReason +=
        `; state familiarity unavailable (${err instanceof Error ? err.message : String(err)})`;
    }
  }

  dimensions.push({
    name: "Asset Familiarity",
    score: familiarityScore,
    weight: 0.5,
    reason: familiarityReason,
  });

  // ── MANDATORY HEDGE FUND-GRADE CHECKS (when data available) ──

  // 9. Volatility-percentile position sizing
  if (portfolio.targetPriceHistory && portfolio.targetPriceHistory.length >= 60) {
    try {
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
    } catch (err) {
      dimensions.push({
        name: "Vol-Adjusted Sizing",
        score: 50,
        weight: 1.6,
        reason: `Dimension computation failed (${err instanceof Error ? err.message : String(err)}) — scored conservatively`,
      });
    }
  }

  // 10. Correlation with existing positions
  if (portfolio.targetReturns && portfolio.positionReturns && Object.keys(portfolio.positionReturns).length > 0) {
    try {
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
    } catch (err) {
      dimensions.push({
        name: "Correlation Risk",
        score: 50,
        weight: 1.4,
        reason: `Dimension computation failed (${err instanceof Error ? err.message : String(err)}) — scored conservatively`,
      });
    }
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

  // 14. Fake-liquidity penalty — headline volume can be wash-traded.
  // usdVolumeGate filters by SIZE; this filters by realness-of-book.
  // Outlier-heavy windows (Spicy's "huge move on no volume") mean
  // slippage will eat any edge regardless of sizing.
  if (portfolio.fakeLiquidity) {
    const fl = portfolio.fakeLiquidity;
    let fakeScore = 0;
    let reason = `Book verdict: ${fl.verdict}`;
    if (fl.verdict === "fake_liquidity") {
      fakeScore = 85;
      reason += ` (outlier fraction ${(fl.outlierFraction * 100).toFixed(1)}% — wash-trading suspected)`;
    } else if (fl.verdict === "suspicious") {
      fakeScore = 45;
      reason += ` (outlier fraction ${(fl.outlierFraction * 100).toFixed(1)}%)`;
    } else if (fl.verdict === "insufficient_data") {
      fakeScore = 15;
      reason += " — insufficient candles for verdict";
    }
    dimensions.push({
      name: "Fake Liquidity",
      score: fakeScore,
      weight: 1.5,
      reason,
    });
  }

  // 15. Margin-of-Error — environment fit. Out-of-sync trades (wrong
  // direction or wrong strategy type for the regime) carry a higher
  // execution-quality risk regardless of their fundamental thesis.
  // In-sync trades get a small discount on the composite.
  if (portfolio.marginOfError) {
    const moe = portfolio.marginOfError;
    let moeScore = 0;
    if (moe.grade === "C") moeScore = 80;
    else if (moe.grade === "A+") moeScore = 35;
    else if (moe.grade === "A") moeScore = moe.rawScore === 0 ? 15 : 0;
    else moeScore = 0; // B = fully in-sync → no penalty
    dimensions.push({
      name: "Margin of Error",
      score: moeScore,
      weight: 1.1,
      reason: `Grade ${moe.grade} (raw ${moe.rawScore >= 0 ? "+" : ""}${moe.rawScore}) → ${moe.recommendation}`,
    });
  }

  // 11. Tail risk
  if (portfolio.targetPriceHistory && portfolio.targetPriceHistory.length >= 60) {
    try {
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
    } catch (err) {
      dimensions.push({
        name: "Tail Risk",
        score: 50,
        weight: 1.3,
        reason: `Dimension computation failed (${err instanceof Error ? err.message : String(err)}) — scored conservatively`,
      });
    }
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
