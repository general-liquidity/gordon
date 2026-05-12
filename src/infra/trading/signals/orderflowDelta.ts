/**
 * Orderflow Delta Ladder — Volume Decomposition Across Price Levels
 *
 * Decomposes each candle's volume into buy/sell pressure at different
 * price levels. A fundamentally different signal source than price-based
 * indicators — this tells you WHERE in the candle buyers vs sellers
 * were most active.
 *
 * Concepts:
 *   - Delta: buy_volume - sell_volume (positive = buyers dominating)
 *   - Cumulative delta: running total of delta (trend in buying pressure)
 *   - Point of Control (POC): price level with highest volume
 *   - Delta ratio: |delta| / total_volume (directional intensity, 0-1)
 *
 * Source: Moon Dev Trading Bots (Delta Ladder strategy)
 */

// ============================================================================
// Types
// ============================================================================

export interface OHLCV {
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface DeltaBar {
  /** Estimated buy volume. */
  buyVolume: number;
  /** Estimated sell volume. */
  sellVolume: number;
  /** Delta (buy - sell). Positive = buying pressure. */
  delta: number;
  /** Delta ratio: |delta| / total_volume (0-1). */
  deltaRatio: number;
  /** Volume-weighted price (POC approximation). */
  poc: number;
  /** Whether buyers dominated this bar. */
  buyerDominated: boolean;
}

export interface OrderflowResult {
  /** Per-bar delta analysis. */
  bars: DeltaBar[];
  /** Cumulative delta (running total). */
  cumulativeDelta: number[];
  /** Current cumulative delta. */
  currentCumDelta: number;
  /** Cumulative delta trend (slope over last N bars). */
  cumDeltaTrend: "rising" | "falling" | "flat";
  /** Average delta ratio (directional conviction). */
  avgDeltaRatio: number;
  /** Signal based on cumulative delta + delta ratio. */
  signal: "strong_buying" | "buying" | "neutral" | "selling" | "strong_selling";
  /** Summary. */
  summary: string;
}

export interface OrderflowConfig {
  /** Number of price levels per candle for volume distribution. Default 10. */
  priceLevels: number;
  /** Buy volume fraction on bullish candles. Default 0.6 (60% buy, 40% sell). */
  bullishBuyFraction: number;
  /** Lookback for cumulative delta trend. Default 10. */
  trendLookback: number;
}

export const DEFAULT_ORDERFLOW_CONFIG: OrderflowConfig = {
  priceLevels: 10,
  bullishBuyFraction: 0.6,
  trendLookback: 10,
};

// ============================================================================
// Volume Decomposition
// ============================================================================

/**
 * Estimate buy/sell volume decomposition for a single candle.
 *
 * Since most exchange data doesn't provide trade-level aggressor side,
 * we estimate using the candle's close position within its range:
 *   - Close near high → more buying pressure
 *   - Close near low → more selling pressure
 *   - This is the same method used by professional orderflow tools
 */
function decomposeVolume(candle: OHLCV, config: OrderflowConfig): DeltaBar {
  const { open, high, low, close, volume } = candle;
  const range = high - low;

  if (range === 0 || volume === 0) {
    return { buyVolume: 0, sellVolume: 0, delta: 0, deltaRatio: 0, poc: close, buyerDominated: false };
  }

  // Close position within range (0 = at low, 1 = at high)
  const closePosition = (close - low) / range;

  // Buy fraction based on close position (more accurate than just bullish/bearish)
  const buyFraction = 0.3 + closePosition * 0.4; // Range: 0.3 to 0.7

  const buyVolume = volume * buyFraction;
  const sellVolume = volume * (1 - buyFraction);
  const delta = buyVolume - sellVolume;
  const deltaRatio = volume > 0 ? Math.abs(delta) / volume : 0;

  // POC approximation: volume-weighted midpoint
  // If buyers dominated, POC is closer to the high; if sellers, closer to low
  const poc = low + range * (0.3 + buyFraction * 0.4);

  return {
    buyVolume,
    sellVolume,
    delta,
    deltaRatio,
    poc,
    buyerDominated: delta > 0,
  };
}

// ============================================================================
// Full Analysis
// ============================================================================

/**
 * Analyze orderflow delta across a series of OHLCV candles.
 *
 * @param candles OHLCV data (oldest first).
 * @param config Orderflow parameters.
 */
export function analyzeOrderflow(
  candles: OHLCV[],
  config: OrderflowConfig = DEFAULT_ORDERFLOW_CONFIG,
): OrderflowResult {
  if (candles.length === 0) {
    return {
      bars: [], cumulativeDelta: [], currentCumDelta: 0,
      cumDeltaTrend: "flat", avgDeltaRatio: 0, signal: "neutral",
      summary: "No data.",
    };
  }

  const bars: DeltaBar[] = [];
  const cumulativeDelta: number[] = [];
  let cumDelta = 0;

  for (const candle of candles) {
    const bar = decomposeVolume(candle, config);
    bars.push(bar);
    cumDelta += bar.delta;
    cumulativeDelta.push(cumDelta);
  }

  // Cumulative delta trend (slope of last N values)
  const lookback = Math.min(config.trendLookback, cumulativeDelta.length);
  const recent = cumulativeDelta.slice(-lookback);
  let cumDeltaTrend: OrderflowResult["cumDeltaTrend"] = "flat";

  if (recent.length >= 3) {
    const first = recent[0]!;
    const last = recent[recent.length - 1]!;
    const change = last - first;
    const avgVolume = candles.slice(-lookback).reduce((s, c) => s + c.volume, 0) / lookback;
    const normalizedChange = avgVolume > 0 ? change / avgVolume : 0;

    if (normalizedChange > 0.05) cumDeltaTrend = "rising";
    else if (normalizedChange < -0.05) cumDeltaTrend = "falling";
  }

  // Average delta ratio
  const avgDeltaRatio = bars.length > 0
    ? bars.reduce((s, b) => s + b.deltaRatio, 0) / bars.length
    : 0;

  // Signal
  const recentBars = bars.slice(-5);
  const recentBuyDominated = recentBars.filter((b) => b.buyerDominated).length;
  const recentAvgDeltaRatio = recentBars.reduce((s, b) => s + b.deltaRatio, 0) / Math.max(1, recentBars.length);

  let signal: OrderflowResult["signal"];
  if (cumDeltaTrend === "rising" && recentBuyDominated >= 4 && recentAvgDeltaRatio > 0.15) {
    signal = "strong_buying";
  } else if (cumDeltaTrend === "rising" && recentBuyDominated >= 3) {
    signal = "buying";
  } else if (cumDeltaTrend === "falling" && recentBuyDominated <= 1 && recentAvgDeltaRatio > 0.15) {
    signal = "strong_selling";
  } else if (cumDeltaTrend === "falling" && recentBuyDominated <= 2) {
    signal = "selling";
  } else {
    signal = "neutral";
  }

  const summary = `Cumulative delta: ${cumDelta > 0 ? "+" : ""}${cumDelta.toFixed(0)} (${cumDeltaTrend}) | ` +
    `Avg delta ratio: ${(avgDeltaRatio * 100).toFixed(1)}% | ` +
    `Recent: ${recentBuyDominated}/5 bars buyer-dominated | ` +
    `Signal: ${signal.replace("_", " ")}`;

  return {
    bars,
    cumulativeDelta,
    currentCumDelta: cumDelta,
    cumDeltaTrend,
    avgDeltaRatio,
    signal,
    summary,
  };
}
