/**
 * Market Regime Detection Engine
 *
 * Classifies market conditions as trending/ranging/volatile/quiet/breakout
 * using technical indicators on OHLCV candle data.
 *
 * Usage:
 *   import { RegimeDetector } from "./core/regime/index.ts";
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
