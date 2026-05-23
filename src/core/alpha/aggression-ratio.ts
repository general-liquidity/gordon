/**
 * Market-Order Aggression Ratio (Scott / HyperTrend-style)
 *
 * Computes the EMA-smoothed ratio of taker-buy volume to taker-sell
 * volume from exchange-supplied market-order flow data. Scott
 * explicitly names this as a publicly-known sharp-2.5 signal in
 * crypto: when market-buys are systematically outpacing market-sells,
 * price goes up; when the reverse, price goes down.
 *
 * Distinct from:
 *   - `orderflowDelta.ts`         (estimates buy/sell from OHLCV
 *                                   candle internals; this primitive
 *                                   uses ACTUAL taker volume + ratio
 *                                   not cumulative delta)
 *   - `order-book-imbalance.ts`   (static book state — bid depth vs
 *                                   ask depth; this is flow over time)
 *   - `volume-trend.ts`           (volume slope, not signed direction)
 *
 * Many exchange APIs (Binance kline endpoint, Coinbase advanced
 * trades, Bybit linear, etc.) report per-bar `taker_buy_base_volume`
 * or equivalent. The complement (taker_sell_volume) is total volume
 * minus taker_buy_volume. Operator supplies the per-bar split
 * directly; primitive doesn't try to estimate it.
 *
 * Procedure:
 *   1. EMA(taker_buy_volume) over `lookback` bars
 *   2. EMA(taker_sell_volume) over `lookback` bars
 *   3. ratio = ema_buy / ema_sell
 *   4. logRatio = ln(ratio) — symmetric around zero
 *   5. Classify into directional bands
 *
 * Pure function.
 */

export interface TakerVolumeBar {
  /** Taker buy volume (market orders that hit the ask). */
  takerBuyVolume: number;
  /** Taker sell volume (market orders that hit the bid). */
  takerSellVolume: number;
}

export interface AggressionRatioOptions {
  /** EMA lookback in bars. Default 20. */
  lookback?: number;
  /** Minimum bars required for verdict. Default 10. */
  minBars?: number;
  /**
   * Log-ratio threshold above which the signal is "strong buy."
   * Default 0.30 (ratio > 1.35).
   */
  strongBuyThreshold?: number;
  /**
   * Log-ratio threshold above which the signal is "buy" but not strong.
   * Default 0.10 (ratio > 1.10).
   */
  buyThreshold?: number;
  /** Symmetric thresholds for sell side. Default = -buyThreshold. */
  sellThreshold?: number;
  /** Symmetric thresholds for strong-sell. Default = -strongBuyThreshold. */
  strongSellThreshold?: number;
}

export type AggressionVerdict =
  | "strong_buy"
  | "buy"
  | "neutral"
  | "sell"
  | "strong_sell"
  | "insufficient_data";

export interface AggressionRatioResult {
  sampleSize: number;
  emaBuyVolume: number;
  emaSellVolume: number;
  ratio: number;
  logRatio: number;
  verdict: AggressionVerdict;
  /** Recommended directional bias. null for neutral / insufficient. */
  directionalBias: "long" | "short" | null;
  summary: string;
}

const DEFAULT_LOOKBACK = 20;
const DEFAULT_MIN_BARS = 10;
const DEFAULT_STRONG_BUY = 0.30;
const DEFAULT_BUY = 0.10;

function ema(values: ReadonlyArray<number>, alpha: number): number {
  if (values.length === 0) return 0;
  let e = values[0]!;
  for (let i = 1; i < values.length; i++) {
    e = alpha * values[i]! + (1 - alpha) * e;
  }
  return e;
}

export function computeAggressionRatio(
  bars: ReadonlyArray<TakerVolumeBar>,
  options: AggressionRatioOptions = {},
): AggressionRatioResult {
  const lookback = options.lookback ?? DEFAULT_LOOKBACK;
  const minBars = options.minBars ?? DEFAULT_MIN_BARS;
  const strongBuy = options.strongBuyThreshold ?? DEFAULT_STRONG_BUY;
  const buy = options.buyThreshold ?? DEFAULT_BUY;
  const sell = options.sellThreshold ?? -buy;
  const strongSell = options.strongSellThreshold ?? -strongBuy;

  if (bars.length < minBars) {
    return {
      sampleSize: bars.length,
      emaBuyVolume: 0,
      emaSellVolume: 0,
      ratio: 1,
      logRatio: 0,
      verdict: "insufficient_data",
      directionalBias: null,
      summary: `Insufficient bars (${bars.length} < ${minBars}).`,
    };
  }

  // Use last `lookback` bars (or all available if fewer)
  const effective = Math.min(lookback, bars.length);
  const tail = bars.slice(bars.length - effective);
  const buyVols = tail.map((b) => Math.max(0, b.takerBuyVolume));
  const sellVols = tail.map((b) => Math.max(0, b.takerSellVolume));

  const alpha = 2 / (effective + 1);
  const emaBuy = ema(buyVols, alpha);
  const emaSell = ema(sellVols, alpha);

  // Guard against zero division
  const EPS = 1e-12;
  const ratio = emaBuy / Math.max(emaSell, EPS);
  const logRatio = Math.log(Math.max(ratio, EPS));

  let verdict: AggressionVerdict;
  let bias: "long" | "short" | null;
  if (logRatio >= strongBuy) {
    verdict = "strong_buy";
    bias = "long";
  } else if (logRatio >= buy) {
    verdict = "buy";
    bias = "long";
  } else if (logRatio <= strongSell) {
    verdict = "strong_sell";
    bias = "short";
  } else if (logRatio <= sell) {
    verdict = "sell";
    bias = "short";
  } else {
    verdict = "neutral";
    bias = null;
  }

  const summary =
    `${effective}-bar EMA: buy=${emaBuy.toFixed(2)}, sell=${emaSell.toFixed(2)}, ` +
    `ratio=${ratio.toFixed(3)} (log ${logRatio >= 0 ? "+" : ""}${logRatio.toFixed(3)}). → ${verdict}` +
    (bias ? `, recommended bias: ${bias}` : "") +
    ".";

  return {
    sampleSize: bars.length,
    emaBuyVolume: parseFloat(emaBuy.toFixed(6)),
    emaSellVolume: parseFloat(emaSell.toFixed(6)),
    ratio: parseFloat(ratio.toFixed(6)),
    logRatio: parseFloat(logRatio.toFixed(6)),
    verdict,
    directionalBias: bias,
    summary,
  };
}

export function formatAggressionRatio(result: AggressionRatioResult): string {
  const lines = [
    `Aggression Ratio — ${result.verdict.toUpperCase()}`,
    "",
    `  Sample size: ${result.sampleSize}`,
    `  EMA buy volume:  ${result.emaBuyVolume.toFixed(2)}`,
    `  EMA sell volume: ${result.emaSellVolume.toFixed(2)}`,
    `  Ratio (buy/sell): ${result.ratio.toFixed(3)}`,
    `  Log-ratio:        ${result.logRatio >= 0 ? "+" : ""}${result.logRatio.toFixed(3)}`,
    `  Directional bias: ${result.directionalBias ?? "neutral"}`,
    "",
    `Summary: ${result.summary}`,
  ];
  return lines.join("\n");
}
