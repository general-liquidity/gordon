/**
 * Market Regime Detection Engine
 *
 * Classifies market conditions as trending/ranging/volatile/quiet/breakout
 * using technical indicators on OHLCV candle data.
 *
 * Usage:
 *   import { RegimeDetector } from "./index.ts";
 *
 *   const detector = RegimeDetector.getInstance();
 *   const signal = detector.detectRegime(candles, "BTCUSDT", "1h");
 *   // signal.regime => "trending_up" | "ranging" | ...
 *   // signal.confidence => 0.82
 *
 *   const playbooks = detector.getPlaybooksForRegime(signal.regime);
 */

// Types
export type {
  MarketRegime,
  RegimeSignal,
  RegimeMetrics,
  RegimeHistory,
  RegimeSpan,
  MultiTimeframeRegime,
} from "./types.ts";

export {
  MarketRegimeSchema,
  RegimeSignalSchema,
  RegimeMetricsSchema,
  RegimeHistorySchema,
  RegimeSpanSchema,
  MultiTimeframeRegimeSchema,
} from "./types.ts";

// Indicators (pure functions)
export {
  calculateADX,
  calculateATR,
  calculateATRPercentile,
  calculateBBWidth,
  calculateEMA,
  calculateEMAAlignment,
  calculateMACD,
  calculateRSI,
  calculateVolumeRatio,
  calculateVolumeTrend,
} from "./indicators.ts";

// Classifier
export { RegimeClassifier } from "./classifier.ts";

// Detector (singleton)
export { RegimeDetector } from "./detector.ts";

// Watcher (singleton)
export { RegimeWatcher } from "./watcher.ts";
export type { RegimeWatchResult, SlotRegimeAction } from "./watcher.ts";

// Distributional familiarity gate
export {
  buildFamiliarityReference,
  buildFamiliarityReferences,
  evaluateFamiliarity,
  familiarityPercentile,
  mahalanobisDistance,
  euclideanDistanceToCentroid,
  conservativeVerdict,
  DEFAULT_FAMILIARITY_THRESHOLD,
  DEFAULT_FAMILIARITY_EMA_SPAN,
  DEFAULT_FAMILIARITY_MIN_SAMPLES,
  DEFAULT_FAMILIARITY_VARIANCE_RIDGE,
} from "./familiarity.ts";
export type {
  FeatureVector,
  LabelledStateGroup,
  ReferenceDefect,
  FamiliarityReference,
  FamiliarityConfig,
  ReferenceScore,
  FamiliarityReason,
  PositionState,
  ConservativeAction,
  ConservativeVerdict,
  FamiliarityGateResult,
  FamiliarityGateInput,
} from "./familiarity.ts";
