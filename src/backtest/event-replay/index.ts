/**
 * Event-replay framework — public surface.
 *
 * Tier 1 build closing the "Don't Trust Your Backtest" thread.
 * Composes with Gordon's existing walk-forward + Monte Carlo + risk
 * classifier discipline by adding the historical-break stress test
 * the post identifies as the missing layer.
 *
 * Tier 2 (auto-fetcher for event data) and Tier 3 (bundled tick
 * data) are deferred — see [[project_event_replay_tier_2_3_deferred]]
 * memory entry for revival conditions.
 */

export {
  CANONICAL_EVENTS,
  CHF_UNPEG_2015,
  PBOC_CNY_DEVALUATION_2015,
  US_ELECTION_OVERNIGHT_2016,
  COVID_VOL_SPIKE_2020,
  getCanonicalEvent,
} from "./catalog.ts";

export { runEventReplay, type ReplayInputs } from "./engine.ts";

export { evaluateReplay, formatVerdict } from "./verdict.ts";

export type {
  AssetMarket,
  AssetUniverse,
  HistoricalEvent,
  OHLCBar,
  AssetPosition,
  ReplayStrategy,
  StrategyOrder,
  ReplayTrade,
  ReplayMetrics,
  ReplayVerdict,
  VerdictThresholds,
  SlippageModel,
} from "./types.ts";

export { DEFAULT_SLIPPAGE_MODEL } from "./types.ts";
