/**
 * Feature primitives — leakage-proof feature builders.
 *
 * Pipeline that mechanically prevents look-ahead by only handing past
 * windows to feature functions. Pair with `engine.ts` for backtest
 * inputs and with `backtestCredibility.ts` for credibility tests.
 */

export {
  FeaturePipeline,
  momentum,
  realizedVol,
  zscore,
  range,
} from "./featurePipeline.ts";

export type {
  FeatureFn,
  FeatureTransform,
  FeatureMatrix,
  OhlcvBar,
} from "./featurePipeline.ts";
