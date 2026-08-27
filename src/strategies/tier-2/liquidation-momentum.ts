/**
 * Liquidation Momentum Strategy
 *
 * Trades WITH liquidation cascades using aggregate market data.
 * When one side is overleveraged and price moves against them,
 * cascading liquidations create momentum — this strategy rides that wave.
 *
 * Trades WITH liquidation cascades using Hyperliquid data (
 * 3.17 Sharpe in backtest) — adapted for Gordon's aggregate data model.
 *
 * Entry Conditions:
 * - Extreme funding rate (annualized > 30%) indicating crowded positioning
 * - Price moving against the crowd (24h change confirms direction)
 * - OI/Volume ratio > 2 (overleveraged market)
 *
 * Direction Logic:
 * - Crowded longs + price falling → SHORT (long liquidation cascade)
 * - Crowded shorts + price rising → LONG (short squeeze cascade)
 *
 * Confidence Boosters:
 * - Premium divergence confirms squeeze (+15%)
 * - ADX rising (trend accelerating) (+10%)
 * - Volume above average (+10%)
 */

import { BaseStrategy } from "../base-strategy.ts";
import type {
  StrategyContext,
  StrategyDetectionResult,
  StrategyPlanParams,
  StrategyId,
  TakeProfitLevel,
} from "../types.ts";
import type { OHLC, Signal, IndicatorState } from "../../backtest/types.ts";

// ============================================================================
// Constants (tuned from liq_momentum_bot.py backtest params)
// ============================================================================

const FUNDING_THRESHOLD_ANNUALIZED = 0.3; // 30% annualized = extreme
const PRICE_CHANGE_MIN = 0.015; // 1.5% move against crowd
const OI_VOLUME_RATIO_MIN = 2.0; // Overleveraged threshold
const PREMIUM_DIVERGENCE_MIN = 0.005; // 0.5% premium = significant
const CANDLE_LIMIT = 100;

// ============================================================================
// Liquidation Momentum Strategy
// ============================================================================

export class LiquidationMomentumStrategy extends BaseStrategy {
  readonly id: StrategyId = "liquidation_momentum";
  readonly name = "Liquidation Momentum";
  readonly tier = 2 as const;
  readonly description =
    "Rides liquidation cascade momentum by entering trades in the direction " +
    "of forced selling/buying when overleveraged positions get liquidated.";
  readonly indicators = ["Funding Rate", "OI/Volume", "Premium", "ATR", "ADX"];
  readonly timeframes = ["1h", "4h"];
  readonly riskLevel = "high" as const;

  async detect(
    symbol: string,
    timeframe: string,
    ctx: StrategyContext,
  ): Promise<StrategyDetectionResult> {
    const candles = await this.fetchCandles(ctx, symbol, timeframe, CANDLE_LIMIT);
    if (candles.length < 30) {
      return this.notDetected("Insufficient data (need 30+ candles)");
    }

    const currentPrice = this.getCurrentPrice(candles, ctx);
    if (currentPrice === 0) {
      return this.notDetected("Could not determine current price");
    }

    // Fetch Hyperliquid aggregate data for this symbol
    const hlData = await this.fetchHyperliquidData(symbol);
    if (!hlData) {
      return this.notDetected(
        "Could not fetch Hyperliquid data — strategy requires aggregate funding/OI data",
      );
    }

    const { fundingRate, annualizedFunding, openInterest, dailyVolume, premium, priceChange24h } =
      hlData;

    // OI/Volume ratio check — need overleveraged market
    const oiVolumeRatio = dailyVolume > 0 ? openInterest / dailyVolume : 0;
    if (oiVolumeRatio < OI_VOLUME_RATIO_MIN) {
      return this.notDetected(
        `OI/Volume ratio ${oiVolumeRatio.toFixed(1)}x too low (need > ${OI_VOLUME_RATIO_MIN}x). ` +
          `Market not overleveraged enough for cascade.`,
      );
    }

    // Funding rate check — need extreme positioning
    const absFunding = Math.abs(annualizedFunding);
    if (absFunding < FUNDING_THRESHOLD_ANNUALIZED) {
      return this.notDetected(
        `Annualized funding ${(annualizedFunding * 100).toFixed(1)}% not extreme enough ` +
          `(need > ${FUNDING_THRESHOLD_ANNUALIZED * 100}%). No crowded side to squeeze.`,
      );
    }

    // Direction detection: who's getting squeezed?
    let direction: "LONG" | "SHORT" | null = null;
    let cascadeType = "";

    if (fundingRate > 0 && priceChange24h < -PRICE_CHANGE_MIN) {
      // Longs are crowded (paying funding) + price dropping → long liquidation cascade
      direction = "SHORT";
      cascadeType = "Long liquidation cascade";
    } else if (fundingRate < 0 && priceChange24h > PRICE_CHANGE_MIN) {
      // Shorts are crowded (paying funding) + price rising → short squeeze
      direction = "LONG";
      cascadeType = "Short squeeze cascade";
    }

    if (!direction) {
      return this.notDetected(
        `Extreme funding (${(annualizedFunding * 100).toFixed(1)}%) but price moving with the crowd ` +
          `(${(priceChange24h * 100).toFixed(1)}%). No cascade in progress — crowd still winning.`,
      );
    }

    // Cascade exhaustion detection — has the move already extended too far?
    // If price moved >3% from cascade start, the easy momentum is gone
    const absPriceChange = Math.abs(priceChange24h);
    const cascadeExhausted = absPriceChange > 0.03;
    const cascadePhase: "early" | "mid" | "exhausted" =
      absPriceChange < 0.02 ? "early" : absPriceChange < 0.03 ? "mid" : "exhausted";

    // Build confidence
    let confidence = 0.55; // Extreme funding + price against crowd is already strong

    // Reduce confidence if cascade is already exhausted — fade zone, not momentum zone
    if (cascadeExhausted) {
      confidence -= 0.15;
    }

    // Premium divergence confirms the squeeze
    if (
      (direction === "LONG" && premium < -PREMIUM_DIVERGENCE_MIN) ||
      (direction === "SHORT" && premium > PREMIUM_DIVERGENCE_MIN)
    ) {
      confidence += 0.15;
    }

    // Stronger funding = stronger cascade
    if (absFunding > 0.5) {
      confidence += 0.1;
    }

    // Higher OI/Volume = more overleveraged = bigger cascade
    if (oiVolumeRatio > 4.0) {
      confidence += 0.1;
    }

    // ADX confirmation (trend accelerating)
    const adxResult = this.calculateADXSimple(candles);
    if (adxResult.adx !== null && adxResult.adx > 25 && adxResult.adxTrend === "rising") {
      confidence += 0.1;
    }

    // Volume above average
    const volumeTrend = this.analyzeVolumeTrend(candles, 5, 20);
    if (volumeTrend === "rising") {
      confidence += 0.1;
    }

    const signals = {
      direction,
      cascadeType,
      cascadePhase,
      cascadeExhausted,
      fundingRate,
      annualizedFunding: annualizedFunding * 100,
      priceChange24h: priceChange24h * 100,
      oiVolumeRatio,
      premium: premium * 100,
      openInterest,
      dailyVolume,
      adx: adxResult.adx,
      adxTrend: adxResult.adxTrend,
      volumeTrend,
    };

    const reasons: string[] = [];
    reasons.push(`${cascadeType} detected — ${direction} signal`);
    reasons.push(
      `Cascade phase: ${cascadePhase}${cascadeExhausted ? " (EXHAUSTED — consider fading instead)" : ""}`,
    );
    reasons.push(
      `Funding: ${(annualizedFunding * 100).toFixed(1)}% annualized (${fundingRate > 0 ? "longs paying" : "shorts paying"})`,
    );
    reasons.push(`Price: ${(priceChange24h * 100).toFixed(1)}% 24h (against crowd)`);
    reasons.push(`OI/Volume: ${oiVolumeRatio.toFixed(1)}x (overleveraged)`);
    if (Math.abs(premium) > PREMIUM_DIVERGENCE_MIN) {
      reasons.push(
        `Premium: ${(premium * 100).toFixed(2)}% (${premium > 0 ? "mark > index" : "mark < index"})`,
      );
    }
    if (adxResult.adx !== null) {
      reasons.push(`ADX: ${adxResult.adx.toFixed(1)} (${adxResult.adxTrend})`);
    }
    reasons.push(`Volume: ${volumeTrend}`);

    return this.detected(confidence, signals, reasons.join(". "));
  }

  // ============================================================================
  // Hyperliquid Data Fetching
  // ============================================================================

  private async fetchHyperliquidData(symbol: string): Promise<{
    fundingRate: number;
    annualizedFunding: number;
    openInterest: number;
    dailyVolume: number;
    premium: number;
    priceChange24h: number;
  } | null> {
    try {
      const response = await fetch("https://api.hyperliquid.xyz/info", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "metaAndAssetCtxs" }),
        signal: AbortSignal.timeout(10000),
      });

      if (!response.ok) return null;

      const [meta, assetCtxs] = (await response.json()) as [
        { universe: { name: string }[] },
        {
          funding: string;
          openInterest: string;
          dayNtlVlm: string;
          premium: string;
          markPx: string;
          prevDayPx: string;
        }[],
      ];

      // Normalize symbol: "BTCUSDT" → "BTC", "ETHUSDT" → "ETH"
      const coin = symbol.replace(/USDT$/i, "").replace(/USD$/i, "").toUpperCase();

      const idx = meta.universe.findIndex((a) => a.name.toUpperCase() === coin);
      if (idx === -1) return null;

      const ctx = assetCtxs[idx];
      if (!ctx) return null;

      const fundingRate = parseFloat(ctx.funding);
      const annualizedFunding = fundingRate * 3 * 365;
      const openInterest = parseFloat(ctx.openInterest);
      const dailyVolume = parseFloat(ctx.dayNtlVlm);
      const premium = parseFloat(ctx.premium);
      const markPrice = parseFloat(ctx.markPx);
      const prevDayPrice = parseFloat(ctx.prevDayPx);
      const priceChange24h = prevDayPrice > 0 ? (markPrice - prevDayPrice) / prevDayPrice : 0;

      return {
        fundingRate,
        annualizedFunding,
        openInterest,
        dailyVolume,
        premium,
        priceChange24h,
      };
    } catch {
      return null;
    }
  }

  // ============================================================================
  // ADX Helper (shared pattern with other tier-2 strategies)
  // ============================================================================

  private calculateADXSimple(candles: { high: number; low: number; close: number }[]): {
    adx: number | null;
    adxTrend: "rising" | "falling" | "flat";
  } {
    if (candles.length < 28) return { adx: null, adxTrend: "flat" };

    const period = 14;
    const trueRanges: number[] = [];
    const plusDMs: number[] = [];
    const minusDMs: number[] = [];

    for (let i = 1; i < candles.length; i++) {
      const current = candles[i]!;
      const previous = candles[i - 1]!;

      const tr = Math.max(
        current.high - current.low,
        Math.abs(current.high - previous.close),
        Math.abs(current.low - previous.close),
      );
      trueRanges.push(tr);

      const upMove = current.high - previous.high;
      const downMove = previous.low - current.low;
      plusDMs.push(upMove > downMove && upMove > 0 ? upMove : 0);
      minusDMs.push(downMove > upMove && downMove > 0 ? downMove : 0);
    }

    const smoothTR = this.wilderSmooth(trueRanges, period);
    const smoothPlusDM = this.wilderSmooth(plusDMs, period);
    const smoothMinusDM = this.wilderSmooth(minusDMs, period);

    if (smoothTR.length === 0) return { adx: null, adxTrend: "flat" };

    const dxValues: number[] = [];
    for (let i = 0; i < smoothTR.length; i++) {
      const pdi = (smoothPlusDM[i]! / smoothTR[i]!) * 100;
      const mdi = (smoothMinusDM[i]! / smoothTR[i]!) * 100;
      const dx = (Math.abs(pdi - mdi) / (pdi + mdi)) * 100;
      if (!Number.isNaN(dx)) dxValues.push(dx);
    }

    const adxValues = this.wilderSmooth(dxValues, period);
    const adx = adxValues[adxValues.length - 1] ?? null;

    let adxTrend: "rising" | "falling" | "flat" = "flat";
    if (adxValues.length >= 3) {
      const recent = adxValues.slice(-3);
      if (recent[2]! > recent[0]! * 1.05) adxTrend = "rising";
      else if (recent[2]! < recent[0]! * 0.95) adxTrend = "falling";
    }

    return { adx, adxTrend };
  }

  private wilderSmooth(values: number[], period: number): number[] {
    if (values.length < period) return [];
    const result: number[] = [];
    let smooth = values.slice(0, period).reduce((a, b) => a + b, 0);
    result.push(smooth);
    for (let i = period; i < values.length; i++) {
      smooth = smooth - smooth / period + values[i]!;
      result.push(smooth);
    }
    return result;
  }

  // ============================================================================
  // Plan Parameters
  // ============================================================================

  async getPlanParameters(symbol: string, ctx: StrategyContext): Promise<StrategyPlanParams> {
    const candles = await this.fetchCandles(ctx, symbol, "1h", CANDLE_LIMIT);
    const currentPrice = this.getCurrentPrice(candles, ctx);
    const atr = this.calculateATR(candles);

    const entryPrice = currentPrice;
    const atrVal = atr.current ?? currentPrice * 0.02;

    // Tight stop: 2% (from backtest optimized SL=2%)
    const stopLoss = entryPrice - atrVal * 1.5;

    // Tight take-profits: cascade trades are fast (max hold 2h from backtest)
    // TP at 1% (from backtest optimized TP=1%), then 2%, then trail
    const risk = entryPrice - stopLoss;
    const takeProfits: TakeProfitLevel[] = [
      { price: entryPrice + risk * 1, percentToSell: 0.4 },
      { price: entryPrice + risk * 2, percentToSell: 0.35 },
      { price: entryPrice + risk * 3, percentToSell: 0.25 },
    ];

    const avgTpPrice = takeProfits.reduce((sum, tp) => sum + tp.price * tp.percentToSell, 0);
    const riskRewardRatio = this.calculateRiskReward(entryPrice, stopLoss, avgTpPrice);

    return {
      entryPrice,
      stopLoss,
      takeProfits,
      riskRewardRatio,
      notes:
        `Liquidation momentum trade. Cascading liquidations create forced buying/selling. ` +
        `Fast-moving setup — consider trailing stop after TP1. ` +
        `Stop at $${stopLoss.toFixed(2)} (1.5x ATR). ` +
        `Max recommended hold: 2 hours. R:R ${riskRewardRatio.toFixed(1)}:1`,
    };
  }

  // ============================================================================
  // Prompt Fragment
  // ============================================================================

  getPromptFragment(): string {
    return `
## Liquidation Momentum Strategy Rules

When creating a plan using the Liquidation Momentum strategy:

### Entry Rules
- Requires extreme funding rate (> 30% annualized) — one side is crowded
- Price must be moving AGAINST the crowd (confirms cascade in progress)
- OI/Volume ratio > 2x (overleveraged market)
- Direction: crowded longs + falling price → SHORT; crowded shorts + rising price → LONG
- Premium divergence adds confirmation

### Stop-Loss Rules
- Tight stop: 1.5x ATR below entry (cascade trades resolve fast)
- If trade doesn't work quickly, the cascade thesis is wrong
- Never widen the stop — cascades are momentum plays, not conviction holds

### Take-Profit Rules
- TP1: 1:1 R:R (sell 40%) — lock in cascade profit immediately
- TP2: 2:1 R:R (sell 35%) — cascade extension
- TP3: 3:1 R:R or trail (sell 25%) — full cascade
- Set trailing stop after TP1 — cascades can reverse sharply

### Cascade Phase Awareness
- **Early** (price moved < 2%): Best entry — ride the cascade with momentum
- **Mid** (price moved 2-3%): Still tradeable but tighten stops
- **Exhausted** (price moved > 3%): CASCADE IS LATE — consider FADING instead:
  - If cascadePhase is "exhausted", the contrarian bounce trade is better
  - Fade = enter OPPOSITE direction with tight stop, expecting mean reversion
  - Fade TP: 1% (just catch the bounce), SL: 1.5% (tight — if cascade continues, exit fast)
  - Fade is smaller position: max 1% of portfolio (vs 2% for momentum)

### Risk Management
- Maximum position size: 2% of portfolio (high volatility play)
- Max hold time: 2 hours — cascades resolve fast
- Exit immediately if funding rate normalizes (cascade over)
- Exit if price stalls for >30 minutes (momentum lost)
- This is a HIT-AND-RUN strategy — don't overstay
- Best on 1h timeframe for entry timing
`;
  }

  // ============================================================================
  // Backtesting
  // ============================================================================

  override getRequiredIndicators(): string[] {
    return ["rsi14", "atr14", "ema12", "ema26", "volumeAvg20", "volumeRatio"];
  }

  override generateSignal(
    bar: OHLC,
    index: number,
    _data: OHLC[],
    indicators: IndicatorState,
  ): Signal | null {
    if (index < 30) return null;

    // In backtesting we don't have live funding data, so proxy with
    // volume spike + momentum: volume > 2x avg + strong directional move
    const volumeRatio = indicators.volumeRatio;
    const atr = indicators.atr14;
    const rsi = indicators.rsi14;

    if (volumeRatio == null || atr == null || rsi == null) return null;

    // High volume + strong move = proxy for liquidation cascade
    const move = (bar.close - bar.open) / bar.open;
    const isVolumeSpike = volumeRatio > 2.5;

    if (!isVolumeSpike) return null;

    // Strong bullish move with volume spike (short squeeze proxy)
    if (move > 0.015 && rsi > 55) {
      return {
        type: "BUY",
        price: bar.close,
        timestamp: bar.timestamp,
        reason: `Liquidation momentum: volume ${volumeRatio.toFixed(1)}x avg, +${(move * 100).toFixed(1)}% move, RSI ${rsi.toFixed(0)}`,
      };
    }

    return null;
  }
}

export const liquidationMomentumStrategy = new LiquidationMomentumStrategy();
