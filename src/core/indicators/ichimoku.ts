/**
 * Ichimoku Cloud (Full Implementation)
 * All 5 components: Tenkan-sen, Kijun-sen, Senkou Span A & B, Chikou Span.
 * Multi-timeframe trend analysis in one indicator — cloud color = trend strength.
 *
 * Ichimoku Theories implementation.
 *
 * Components:
 *   Tenkan-sen  = (9-period high + 9-period low) / 2   (conversion line)
 *   Kijun-sen   = (26-period high + 26-period low) / 2  (base line)
 *   Senkou A    = (Tenkan + Kijun) / 2                   (leading span A)
 *   Senkou B    = (52-period high + 52-period low) / 2   (leading span B)
 *   Chikou      = Close shifted back 26 periods           (lagging span)
 */

import type { Candle } from "./types.ts";

export interface IchimokuResult {
  /** Tenkan-sen (conversion line) current value */
  tenkan: number | null;
  /** Kijun-sen (base line) current value */
  kijun: number | null;
  /** Senkou Span A (leading span A) current value */
  senkouA: number | null;
  /** Senkou Span B (leading span B) current value */
  senkouB: number | null;
  /** Chikou Span (lagging span) — current close (to be plotted 26 bars back) */
  chikou: number | null;
  /** Cloud top (max of Senkou A, Senkou B) */
  cloudTop: number | null;
  /** Cloud bottom (min of Senkou A, Senkou B) */
  cloudBottom: number | null;
  /** Cloud color — bullish if A > B, bearish if B > A */
  cloudColor: "bullish" | "bearish" | "neutral";
  /** Price position relative to cloud */
  pricePosition: "above_cloud" | "in_cloud" | "below_cloud";
  /** TK cross signal */
  tkCross: "bullish_cross" | "bearish_cross" | "none";
  /** Overall signal strength */
  signal: "strong_buy" | "buy" | "neutral" | "sell" | "strong_sell";
  /** Interpretation string */
  interpretation: string;
}

/**
 * Rolling high over a window
 */
function rollingHigh(candles: Candle[], period: number, index: number): number | null {
  if (index < period - 1) return null;
  let max = -Infinity;
  for (let i = index - period + 1; i <= index; i++) {
    if (candles[i]!.high > max) max = candles[i]!.high;
  }
  return max;
}

/**
 * Rolling low over a window
 */
function rollingLow(candles: Candle[], period: number, index: number): number | null {
  if (index < period - 1) return null;
  let min = Infinity;
  for (let i = index - period + 1; i <= index; i++) {
    if (candles[i]!.low < min) min = candles[i]!.low;
  }
  return min;
}

/**
 * Calculate full Ichimoku Cloud indicator.
 *
 * @param candles - OHLCV candle array
 * @param tenkanPeriod - Tenkan-sen period (default 9)
 * @param kijunPeriod - Kijun-sen period (default 26)
 * @param senkouBPeriod - Senkou Span B period (default 52)
 * @param chikouPeriod - Chikou displacement (default 26)
 * @returns IchimokuResult
 */
export function calculateIchimoku(
  candles: Candle[],
  tenkanPeriod: number = 9,
  kijunPeriod: number = 26,
  senkouBPeriod: number = 52,
  _chikouPeriod: number = 26,
): IchimokuResult {
  if (candles.length < senkouBPeriod + 1) {
    return {
      tenkan: null,
      kijun: null,
      senkouA: null,
      senkouB: null,
      chikou: null,
      cloudTop: null,
      cloudBottom: null,
      cloudColor: "neutral",
      pricePosition: "in_cloud",
      tkCross: "none",
      signal: "neutral",
      interpretation: "Insufficient data for Ichimoku calculation",
    };
  }

  const n = candles.length;
  const lastIdx = n - 1;
  const prevIdx = n - 2;

  // Tenkan-sen = (9-period high + 9-period low) / 2
  const tenkanHigh = rollingHigh(candles, tenkanPeriod, lastIdx);
  const tenkanLow = rollingLow(candles, tenkanPeriod, lastIdx);
  const tenkan = tenkanHigh !== null && tenkanLow !== null ? (tenkanHigh + tenkanLow) / 2 : null;

  // Previous Tenkan for crossover detection
  const prevTenkanHigh = rollingHigh(candles, tenkanPeriod, prevIdx);
  const prevTenkanLow = rollingLow(candles, tenkanPeriod, prevIdx);
  const prevTenkan =
    prevTenkanHigh !== null && prevTenkanLow !== null ? (prevTenkanHigh + prevTenkanLow) / 2 : null;

  // Kijun-sen = (26-period high + 26-period low) / 2
  const kijunHigh = rollingHigh(candles, kijunPeriod, lastIdx);
  const kijunLow = rollingLow(candles, kijunPeriod, lastIdx);
  const kijun = kijunHigh !== null && kijunLow !== null ? (kijunHigh + kijunLow) / 2 : null;

  // Previous Kijun for crossover detection
  const prevKijunHigh = rollingHigh(candles, kijunPeriod, prevIdx);
  const prevKijunLow = rollingLow(candles, kijunPeriod, prevIdx);
  const prevKijun =
    prevKijunHigh !== null && prevKijunLow !== null ? (prevKijunHigh + prevKijunLow) / 2 : null;

  // Senkou Span A = (Tenkan + Kijun) / 2
  const senkouA = tenkan !== null && kijun !== null ? (tenkan + kijun) / 2 : null;

  // Senkou Span B = (52-period high + 52-period low) / 2
  const senkouBHigh = rollingHigh(candles, senkouBPeriod, lastIdx);
  const senkouBLow = rollingLow(candles, senkouBPeriod, lastIdx);
  const senkouB =
    senkouBHigh !== null && senkouBLow !== null ? (senkouBHigh + senkouBLow) / 2 : null;

  // Chikou Span = current close (plotted 26 bars back)
  const chikou = candles[lastIdx]!.close;

  // Cloud boundaries
  const cloudTop = senkouA !== null && senkouB !== null ? Math.max(senkouA, senkouB) : null;
  const cloudBottom = senkouA !== null && senkouB !== null ? Math.min(senkouA, senkouB) : null;

  // Cloud color
  const cloudColor: "bullish" | "bearish" | "neutral" =
    senkouA !== null && senkouB !== null
      ? senkouA > senkouB
        ? "bullish"
        : senkouA < senkouB
          ? "bearish"
          : "neutral"
      : "neutral";

  // Price position
  const price = candles[lastIdx]!.close;
  let pricePosition: "above_cloud" | "in_cloud" | "below_cloud" = "in_cloud";
  if (cloudTop !== null && price > cloudTop) pricePosition = "above_cloud";
  else if (cloudBottom !== null && price < cloudBottom) pricePosition = "below_cloud";

  // TK cross detection
  let tkCross: "bullish_cross" | "bearish_cross" | "none" = "none";
  if (tenkan !== null && kijun !== null && prevTenkan !== null && prevKijun !== null) {
    if (prevTenkan <= prevKijun && tenkan > kijun) tkCross = "bullish_cross";
    else if (prevTenkan >= prevKijun && tenkan < kijun) tkCross = "bearish_cross";
  }

  // Overall signal
  const signal = computeSignal(pricePosition, cloudColor, tkCross, tenkan, kijun);

  const interpretation = buildIchimokuInterpretation(
    price,
    tenkan,
    kijun,
    cloudTop,
    cloudBottom,
    cloudColor,
    pricePosition,
    tkCross,
    signal,
  );

  return {
    tenkan: tenkan !== null ? parseFloat(tenkan.toFixed(2)) : null,
    kijun: kijun !== null ? parseFloat(kijun.toFixed(2)) : null,
    senkouA: senkouA !== null ? parseFloat(senkouA.toFixed(2)) : null,
    senkouB: senkouB !== null ? parseFloat(senkouB.toFixed(2)) : null,
    chikou: parseFloat(chikou.toFixed(2)),
    cloudTop: cloudTop !== null ? parseFloat(cloudTop.toFixed(2)) : null,
    cloudBottom: cloudBottom !== null ? parseFloat(cloudBottom.toFixed(2)) : null,
    cloudColor,
    pricePosition,
    tkCross,
    signal,
    interpretation,
  };
}

function computeSignal(
  position: string,
  cloudColor: string,
  tkCross: string,
  tenkan: number | null,
  kijun: number | null,
): "strong_buy" | "buy" | "neutral" | "sell" | "strong_sell" {
  let score = 0;

  // Price above cloud = +2, below = -2, in = 0
  if (position === "above_cloud") score += 2;
  else if (position === "below_cloud") score -= 2;

  // Cloud color
  if (cloudColor === "bullish") score += 1;
  else if (cloudColor === "bearish") score -= 1;

  // TK cross
  if (tkCross === "bullish_cross") score += 2;
  else if (tkCross === "bearish_cross") score -= 2;

  // Tenkan vs Kijun
  if (tenkan !== null && kijun !== null) {
    if (tenkan > kijun) score += 1;
    else if (tenkan < kijun) score -= 1;
  }

  if (score >= 4) return "strong_buy";
  if (score >= 2) return "buy";
  if (score <= -4) return "strong_sell";
  if (score <= -2) return "sell";
  return "neutral";
}

function buildIchimokuInterpretation(
  _price: number,
  tenkan: number | null,
  kijun: number | null,
  cloudTop: number | null,
  cloudBottom: number | null,
  cloudColor: string,
  position: string,
  tkCross: string,
  signal: string,
): string {
  let msg = "";

  if (tenkan !== null && kijun !== null) {
    msg += `Tenkan: ${tenkan.toFixed(2)}, Kijun: ${kijun.toFixed(2)}. `;
  }

  if (cloudTop !== null && cloudBottom !== null) {
    msg += `Cloud: ${cloudBottom.toFixed(2)}–${cloudTop.toFixed(2)} (${cloudColor}). `;
  }

  const posStr =
    position === "above_cloud"
      ? "ABOVE cloud — bullish"
      : position === "below_cloud"
        ? "BELOW cloud — bearish"
        : "IN cloud — indecisive";
  msg += `Price ${posStr}. `;

  if (tkCross === "bullish_cross") {
    msg += `TK BULLISH CROSS — `;
    if (position === "above_cloud") msg += `strong buy (cross above cloud).`;
    else msg += `potential buy (confirm with cloud position).`;
  } else if (tkCross === "bearish_cross") {
    msg += `TK BEARISH CROSS — `;
    if (position === "below_cloud") msg += `strong sell (cross below cloud).`;
    else msg += `potential sell (confirm with cloud position).`;
  } else {
    msg += `No TK cross. Signal: ${signal.replace("_", " ")}.`;
  }

  return msg;
}
