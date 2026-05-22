/**
 * Event-replay framework — shared types.
 *
 * Models the institutional discipline described in the "Don't Trust
 * Your Backtest" post: a strategy that passes walk-forward + Monte
 * Carlo + parameter sensitivity can still die at the first regime
 * crack if it was never replayed against historical breaks.
 *
 * Operator-facing contract:
 *   - Pick an event from CANONICAL_EVENTS (or supply your own)
 *   - Pass a strategy (init() + step() callback) + per-asset OHLC bars
 *   - Engine replays the strategy bar-by-bar through the event window
 *   - Metrics module extracts max intraday DD, P&L, max slippage,
 *     risk-engine response time
 *   - Verdict module compares against baseline 99th-pct DD + response
 *     time budget and returns pass/fail
 */

export type AssetMarket = "fx" | "equity_index" | "metals" | "crypto" | "rates" | "commodity";

export interface AssetUniverse {
  symbol: string;
  market: AssetMarket;
  /** Optional note about how this asset reacted in the event (for operator context). */
  reactionNote?: string;
}

/**
 * Canonical historical event. Date strings are ISO-8601; the engine
 * uses them as inclusive window boundaries.
 */
export interface HistoricalEvent {
  id: string;
  name: string;
  description: string;
  /** Start of replay window (typically opens the day before the trigger). */
  windowStart: string;
  /** End of replay window (typically closes after immediate dust settles). */
  windowEnd: string;
  /** Timestamp at which the vol expansion actually starts — used to measure risk-engine response time. */
  volExpansionStart: string;
  /** Primary assets directly hit by the event. */
  primaryAssets: AssetUniverse[];
  /** Secondary assets affected via contagion (operator should test if they trade these). */
  contagionAssets?: AssetUniverse[];
  /** Headline characteristics of the move for operator context. */
  characteristics: {
    /** "X% move in Y minutes" headline. */
    primaryMove: string;
    /** Whether the event had material gap-through-stop risk. */
    gapRisk: boolean;
    /** Whether broker spreads materially widened during the event. */
    spreadWidening: boolean;
    /** Whether market sessions were halted / circuit-breakered. */
    sessionsHalted: boolean;
  };
  /** External references (e.g., regulator announcements, post-mortems). */
  references?: string[];
}

/**
 * Single OHLC bar with optional volume. Time is unix milliseconds.
 * Engine assumes bars are sorted ascending and indexed by asset.
 */
export interface OHLCBar {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number;
}

/**
 * Per-asset position state the engine maintains across bars.
 */
export interface AssetPosition {
  /** Signed quantity — positive = long, negative = short, 0 = flat. */
  qty: number;
  /** Volume-weighted average entry price. */
  avgPrice: number;
  /** Optional stop-loss price level (gap-through-stop logic applies if breached). */
  stopLoss?: number;
  /** Optional take-profit price level. */
  takeProfit?: number;
}

/**
 * Strategy intent at a bar. Engine resolves these into fills using
 * its slippage model.
 */
export interface StrategyOrder {
  asset: string;
  side: "buy" | "sell" | "close";
  qty: number;
  /** Order type. Stops + limits fill via the bar-level approximation in the engine. */
  type: "market" | "limit" | "stop";
  /** Limit / stop trigger price. Ignored for market orders. */
  price?: number;
}

/**
 * Strategy contract. The replay engine calls `init()` once and then
 * `step()` for each (asset, bar) pair in chronological order.
 *
 * `step` receives the current state for all assets and the bar that
 * just arrived for one asset. The strategy returns the orders it
 * wants to submit BEFORE the next bar arrives.
 */
export interface ReplayStrategy {
  init: () => Record<string, AssetPosition>;
  step: (
    state: Record<string, AssetPosition>,
    bar: OHLCBar,
    asset: string,
  ) => StrategyOrder[];
}

/**
 * Resolved fill from the engine's slippage model. `slippageBps` is
 * the absolute basis-point gap between the strategy's intended price
 * and the realized fill price. Stops that gap through fill at the
 * worse-side bar open and report large positive slippage.
 */
export interface ReplayTrade {
  time: number;
  asset: string;
  side: "buy" | "sell" | "close";
  qty: number;
  /** Strategy's intended fill price (market = prev close; stop/limit = trigger price). */
  intendedPrice: number;
  /** Actual fill price after slippage modeling. */
  filledPrice: number;
  /** Absolute bps gap = |filled - intended| / intended × 10_000. */
  slippageBps: number;
  /** Order type that produced this trade. */
  orderType: "market" | "limit" | "stop";
  /** True when a stop gapped through (open beyond stop level). */
  gappedThroughStop?: boolean;
}

/**
 * Output metrics from the replay engine. These are the four headline
 * outputs the post calls for + supporting context the verdict module
 * uses for pass/fail.
 */
export interface ReplayMetrics {
  eventId: string;
  /** Inclusive replay window bounds (ms). */
  windowStart: number;
  windowEnd: number;
  /** Max peak-to-trough drawdown observed during the window (as positive fraction, e.g. 0.12 = 12%). */
  maxIntradayDrawdown: number;
  /** Equity change over the event window. Positive = profit, negative = loss. Units: quote currency. */
  eventWindowPnl: number;
  /** Worst basis-point slippage observed on any single trade. */
  maxSingleTradeSlippage: number;
  /**
   * Risk-engine response time in seconds — time between
   * `event.volExpansionStart` and the first risk-reducing trade
   * (close or position reversal). `null` when the strategy never
   * reduced exposure during the event.
   */
  riskResponseTimeSeconds: number | null;
  /** All fills the engine executed during the replay. */
  trades: ReplayTrade[];
  /** Equity time series for plotting / further analysis. */
  equityCurve: Array<{ time: number; equity: number }>;
}

/**
 * Final pass/fail with reasons. Combines the metrics + operator-
 * supplied baseline thresholds.
 */
export interface ReplayVerdict {
  passed: boolean;
  eventId: string;
  reasons: string[];
  metrics: ReplayMetrics;
  comparedTo: {
    baseline99thPctDrawdown?: number;
    responseTimeBudgetSeconds?: number;
    maxAcceptableSlippageBps?: number;
  };
}

export interface VerdictThresholds {
  /** Strategy's 99th-percentile backtested DD. Event DD must be ≤ this to pass. */
  baseline99thPctDrawdown?: number;
  /** Max acceptable risk-response time in seconds. */
  responseTimeBudgetSeconds?: number;
  /** Max acceptable single-trade slippage in bps. */
  maxAcceptableSlippageBps?: number;
}

export interface SlippageModel {
  /** Default bps applied to market orders (entry + exit cost approximation). */
  baseMarketBps: number;
  /**
   * Multiplier applied when an event flags spreadWidening — operator
   * tunes per asset class. Default 3x means market orders cost 3× the
   * normal bps during the event.
   */
  spreadWideningMultiplier?: number;
}

export const DEFAULT_SLIPPAGE_MODEL: Required<SlippageModel> = {
  baseMarketBps: 2,
  spreadWideningMultiplier: 3,
};
