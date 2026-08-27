/**
 * Market Scorer
 *
 * Multi-factor scoring system for ranking trading opportunities.
 * Combines technical and flow metrics to generate a consensus view.
 */

import { createModuleLogger } from "../../infra/logger/index.ts";

const logger = createModuleLogger("market-scorer");

// ============================================================================
// Types
// ============================================================================

export interface MarketData {
  volatility: number; // Recent volatility (e.g., ATR%)
  trend: number; // Trend direction (-1 to 1, negative = bearish, positive = bullish)
  returns30d: number; // 30-day returns percentage
  rsi?: number; // RSI value (0-100)
  volume24hChange?: number; // 24h volume change percentage
}

export interface FlowFeatures {
  whaleBias?: "bullish" | "bearish" | "neutral";
  whaleStrength?: number; // 0-1
  buyPressure?: number; // 0-1
  sellPressure?: number; // 0-1
  fundingRate?: number; // Perpetual funding rate
}

export interface ScoreResult {
  symbol: string;
  technicalScore: number; // 0-1 (higher = more bullish)
  flowScore: number; // 0-1 (higher = more bullish)
  combinedScore: number; // Weighted average
  consensus: "BULLISH" | "BEARISH" | "NEUTRAL";
  confidence: number; // 0-1 (higher = more confident)
  narrative: string; // Human-readable explanation
  factors: ScoreFactors;
}

export interface ScoreFactors {
  trendScore: number;
  volatilityScore: number;
  momentumScore: number;
  whaleScore: number;
  pressureScore: number;
}

export interface ScorerConfig {
  maxVolatility: number; // Volatility above this is penalized (default 25%)
  volatilityWeight: number; // Weight for volatility in technical score
  trendWeight: number; // Weight for trend in technical score
  flowWeight: number; // Weight for flow score in combined score
}

// ============================================================================
// Market Scorer
// ============================================================================

export class MarketScorer {
  private config: ScorerConfig;

  constructor(config?: Partial<ScorerConfig>) {
    this.config = {
      maxVolatility: config?.maxVolatility ?? 25,
      volatilityWeight: config?.volatilityWeight ?? 0.3,
      trendWeight: config?.trendWeight ?? 0.4,
      flowWeight: config?.flowWeight ?? 0.3,
    };
  }

  /**
   * Score a symbol based on technical and flow metrics
   */
  score(symbol: string, marketData: MarketData, flowFeatures?: FlowFeatures): ScoreResult {
    try {
      // Calculate technical score components
      const volatility = Math.abs(marketData.volatility);
      const trendNumeric = marketData.trend;
      const returns30d = marketData.returns30d;

      // Volatility score (lower volatility = higher score)
      const volatilityPenalty = Math.min(volatility / Math.max(this.config.maxVolatility, 1), 1.0);
      const volatilityScore = 1 - volatilityPenalty;

      // Trend score (normalized from -1..1 to 0..1)
      const trendScore = (trendNumeric + 1) / 2;

      // Momentum score (based on 30d returns, capped)
      const momentumScore = Math.max(Math.min(returns30d / 50.0 + 0.5, 1.0), 0.0);

      // RSI contribution (if available)
      let rsiContribution = 0.5;
      if (marketData.rsi !== undefined) {
        // RSI < 30 = oversold (bullish), RSI > 70 = overbought (bearish)
        if (marketData.rsi < 30) {
          rsiContribution = 0.7; // Oversold = bullish opportunity
        } else if (marketData.rsi > 70) {
          rsiContribution = 0.3; // Overbought = bearish
        } else {
          rsiContribution = 0.5; // Neutral
        }
      }

      // Technical score (weighted average)
      const remainingWeight = 1 - this.config.trendWeight - this.config.volatilityWeight;
      const technicalScore =
        trendScore * this.config.trendWeight +
        volatilityScore * this.config.volatilityWeight +
        momentumScore * (remainingWeight * 0.6) +
        rsiContribution * (remainingWeight * 0.4);

      // Calculate flow score
      let flowScore = 0.5; // Default neutral
      const narrativeBits: string[] = [];

      if (flowFeatures) {
        // Whale analysis
        let whaleScore = 0.5;
        if (flowFeatures.whaleBias === "bullish") {
          whaleScore = 0.5 + (flowFeatures.whaleStrength ?? 0.5) * 0.3;
          narrativeBits.push(
            `Whale bias: bullish (${((flowFeatures.whaleStrength ?? 0.5) * 100).toFixed(0)}%)`,
          );
        } else if (flowFeatures.whaleBias === "bearish") {
          whaleScore = 0.5 - (flowFeatures.whaleStrength ?? 0.5) * 0.3;
          narrativeBits.push(
            `Whale bias: bearish (${((flowFeatures.whaleStrength ?? 0.5) * 100).toFixed(0)}%)`,
          );
        }

        // Buy/sell pressure
        let pressureScore = 0.5;
        if (flowFeatures.buyPressure !== undefined && flowFeatures.sellPressure !== undefined) {
          pressureScore = flowFeatures.buyPressure;
          const pressureDiff = flowFeatures.buyPressure - flowFeatures.sellPressure;
          if (Math.abs(pressureDiff) > 0.1) {
            narrativeBits.push(
              pressureDiff > 0
                ? `Buy pressure: ${(flowFeatures.buyPressure * 100).toFixed(0)}%`
                : `Sell pressure: ${(flowFeatures.sellPressure * 100).toFixed(0)}%`,
            );
          }
        }

        // Funding rate (for perpetuals)
        if (flowFeatures.fundingRate !== undefined) {
          const fundingBias =
            flowFeatures.fundingRate > 0 ? 0.6 : flowFeatures.fundingRate < 0 ? 0.4 : 0.5;
          flowScore = (whaleScore + pressureScore + fundingBias) / 3;
          narrativeBits.push(`Funding: ${(flowFeatures.fundingRate * 100).toFixed(4)}%`);
        } else {
          flowScore = (whaleScore + pressureScore) / 2;
        }
      }

      // Combined score
      const combinedScore =
        technicalScore * (1 - this.config.flowWeight) + flowScore * this.config.flowWeight;

      // Determine consensus
      let consensus: "BULLISH" | "BEARISH" | "NEUTRAL";
      if (combinedScore > 0.6) {
        consensus = "BULLISH";
      } else if (combinedScore < 0.4) {
        consensus = "BEARISH";
      } else {
        consensus = "NEUTRAL";
      }

      // Confidence = how aligned technical and flow scores are
      // Lower difference = higher confidence
      const scoreDiff = Math.abs(technicalScore - flowScore);
      const confidence = 1 - scoreDiff;

      // Build narrative
      let narrative: string;
      if (narrativeBits.length > 0) {
        narrative = narrativeBits.join(" | ");
      } else {
        narrative = `Technical: ${(technicalScore * 100).toFixed(0)}%, Flow: ${(flowScore * 100).toFixed(0)}%`;
      }

      // Add trend description
      if (trendNumeric > 0.3) {
        narrative = `Strong uptrend. ${narrative}`;
      } else if (trendNumeric < -0.3) {
        narrative = `Strong downtrend. ${narrative}`;
      } else if (volatility > 15) {
        narrative = `High volatility. ${narrative}`;
      }

      return {
        symbol,
        technicalScore,
        flowScore,
        combinedScore,
        consensus,
        confidence,
        narrative,
        factors: {
          trendScore,
          volatilityScore,
          momentumScore,
          whaleScore:
            flowFeatures?.whaleBias === "bullish"
              ? 0.7
              : flowFeatures?.whaleBias === "bearish"
                ? 0.3
                : 0.5,
          pressureScore: flowFeatures?.buyPressure ?? 0.5,
        },
      };
    } catch (error) {
      logger.error("Error scoring market", error as Error, { symbol });
      return {
        symbol,
        technicalScore: 0.5,
        flowScore: 0.5,
        combinedScore: 0.5,
        consensus: "NEUTRAL",
        confidence: 0,
        narrative: "Error calculating score",
        factors: {
          trendScore: 0.5,
          volatilityScore: 0.5,
          momentumScore: 0.5,
          whaleScore: 0.5,
          pressureScore: 0.5,
        },
      };
    }
  }

  /**
   * Score multiple symbols and rank them
   */
  rankSymbols(
    symbols: Array<{
      symbol: string;
      marketData: MarketData;
      flowFeatures?: FlowFeatures;
    }>,
  ): ScoreResult[] {
    const scores = symbols.map(({ symbol, marketData, flowFeatures }) =>
      this.score(symbol, marketData, flowFeatures),
    );

    // Sort by combined score (highest first)
    return scores.sort((a, b) => b.combinedScore - a.combinedScore);
  }

  /**
   * Filter symbols by minimum score threshold
   */
  filterByScore(
    scores: ScoreResult[],
    minScore: number = 0.6,
    minConfidence: number = 0.3,
  ): ScoreResult[] {
    return scores.filter((s) => s.combinedScore >= minScore && s.confidence >= minConfidence);
  }
}

// Default instance
export const marketScorer = new MarketScorer();
