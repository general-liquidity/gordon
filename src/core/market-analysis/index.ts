/**
 * Market Analysis Module
 *
 * Advanced market analysis capabilities including:
 * - Whale order detection
 * - Breakout/breakdown detection
 * - Consolidation detection
 * - Multi-factor market scoring
 */

// Whale Detection
export {
  WhaleDetector,
  whaleDetector,
  type WhaleAnalysis,
  type WhaleOrder,
  type MarketImpactEstimate,
  type DepthAnalysis,
  type OrderBookEntry,
} from "./whale-detector.ts";

// Breakout Detection
export {
  BreakoutDetector,
  breakoutDetector,
  type SupportResistanceLevels,
  type BreakoutResult,
  type BreakoutRetestResult,
} from "./breakout-detector.ts";

// Consolidation Detection
export {
  ConsolidationDetector,
  consolidationDetector,
  type ConsolidationResult,
  type ConsolidationRange,
} from "./consolidation-detector.ts";

// Market Scoring
export {
  MarketScorer,
  marketScorer,
  type MarketData,
  type FlowFeatures,
  type ScoreResult,
  type ScoreFactors,
  type ScorerConfig,
} from "./market-scorer.ts";
