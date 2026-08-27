/**
 * DCA Layering Strategy
 *
 * Dollar-cost averaging approach that identifies when price is significantly
 * below its moving average, then creates layered entry points spaced by ATR.
 *
 * Entry Conditions:
 * - Price > 5% below SMA 50 (discount zone)
 * - RSI < 40 (not in extreme momentum)
 * - Split entry into 5 layers, spaced by 0.5x ATR each
 *
 * Confidence Boosters:
 * - Price > 10% below SMA (+15%)
 * - Volume increasing on dips (+10%)
 * - Price near historical support (+10%)
 * - Liquidation pressure on longs (forced selling confirms dip) (+15%)
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
// Constants
// ============================================================================

const SMA_PERIOD = 50;
const MIN_DISCOUNT_PCT = 5;
const DEEP_DISCOUNT_PCT = 10;
const RSI_MAX = 40;
const NUM_LAYERS = 5;
const LAYER_SPACING_ATR = 0.5;
const CANDLE_LIMIT = 100;

// ============================================================================
// DCA Layering Strategy
// ============================================================================

export class DCALayeringStrategy extends BaseStrategy {
  readonly id: StrategyId = "dca_layering";
  readonly name = "DCA Layering";
  readonly tier = 2 as const;
  readonly description =
    "Dollar-cost average into positions when price drops below SMA 50 " +
    "using 5 layered entry points spaced by ATR for optimal averaging.";
  readonly indicators = ["SMA 50", "RSI", "ATR"];
  readonly timeframes = ["4h", "1d"];
  readonly riskLevel = "low" as const;

  async detect(
    symbol: string,
    timeframe: string,
    ctx: StrategyContext,
  ): Promise<StrategyDetectionResult> {
    const candles = await this.fetchCandles(ctx, symbol, timeframe, CANDLE_LIMIT);
    if (candles.length < 55) {
      return this.notDetected("Insufficient data (need 55+ candles)");
    }

    const currentPrice = this.getCurrentPrice(candles, ctx);
    if (currentPrice === 0) {
      return this.notDetected("Could not determine current price");
    }

    // SMA 50 discount check
    const sma = this.calculateSMA(candles, SMA_PERIOD);
    if (!sma.current) {
      return this.notDetected("Could not calculate SMA 50");
    }

    const discountPct = ((sma.current - currentPrice) / sma.current) * 100;

    if (discountPct < MIN_DISCOUNT_PCT) {
      return this.notDetected(
        `Price only ${discountPct.toFixed(1)}% below SMA50 (need > ${MIN_DISCOUNT_PCT}%). ` +
          `Price: $${currentPrice.toFixed(2)}, SMA50: $${sma.current.toFixed(2)}`,
      );
    }

    // RSI check — avoid extreme momentum (catching falling knives)
    const rsi = this.calculateRSI(candles);
    if (rsi.current !== null && rsi.current > RSI_MAX) {
      // RSI above threshold but price is discounted — might be recovering
      // Don't reject, but reduce confidence
    }

    // ATR for layer spacing
    const atr = this.calculateATR(candles);
    const atrVal = atr.current ?? currentPrice * 0.02;

    // Calculate the 5 layers
    const layers: number[] = [];
    for (let i = 0; i < NUM_LAYERS; i++) {
      layers.push(currentPrice - i * atrVal * LAYER_SPACING_ATR);
    }

    // Build confidence
    let confidence = 0.5;

    // Deeper discount = more confident
    if (discountPct >= DEEP_DISCOUNT_PCT) {
      confidence += 0.15;
    } else {
      confidence +=
        ((discountPct - MIN_DISCOUNT_PCT) / (DEEP_DISCOUNT_PCT - MIN_DISCOUNT_PCT)) * 0.1;
    }

    // RSI in oversold zone
    if (rsi.current !== null && rsi.current < 30) {
      confidence += 0.1;
    } else if (rsi.current !== null && rsi.current < RSI_MAX) {
      confidence += 0.05;
    }

    // Volume rising on dip = institutional interest
    const volumeTrend = this.analyzeVolumeTrend(candles, 5, 20);
    if (volumeTrend === "rising") {
      confidence += 0.1;
    }

    // Near support
    const levels = this.detectLevels(candles, currentPrice);
    const supports = this.getSupports(levels, currentPrice);
    const nearSupport =
      supports.length > 0 && Math.abs(supports[0]!.price - currentPrice) / currentPrice < 0.03;
    if (nearSupport) confidence += 0.1;

    // Liquidation filter: check if forced selling is driving this dip
    // Positive funding = longs are crowded and paying → dip is likely liquidation-driven
    let liquidationConfirmed = false;
    let fundingInfo = "";
    const hlData = await this.fetchLiquidationContext(symbol);
    if (hlData) {
      const { fundingRate, annualizedFunding, priceChange24h } = hlData;
      // Longs paying extreme funding + price dropping = forced selling = ideal DCA zone
      if (fundingRate > 0.00005 && priceChange24h < -0.01) {
        liquidationConfirmed = true;
        confidence += 0.15;
        fundingInfo = `Funding: ${(annualizedFunding * 100).toFixed(1)}% ann. (longs paying, forced selling)`;
      } else if (fundingRate > 0.00005) {
        // Longs crowded but price not falling yet — mild boost
        confidence += 0.05;
        fundingInfo = `Funding: ${(annualizedFunding * 100).toFixed(1)}% ann. (longs crowded)`;
      }
    }

    const signals = {
      discountPct,
      sma50: sma.current,
      rsi: rsi.current,
      atr: atrVal,
      layers,
      layerSpacing: atrVal * LAYER_SPACING_ATR,
      volumeTrend,
      nearSupport,
      liquidationConfirmed,
    };

    const reasons: string[] = [];
    reasons.push(`Price ${discountPct.toFixed(1)}% below SMA50 (discount zone)`);
    reasons.push(`SMA50: $${sma.current.toFixed(2)}, Price: $${currentPrice.toFixed(2)}`);
    if (rsi.current !== null) reasons.push(`RSI: ${rsi.current.toFixed(1)}`);
    reasons.push(`5 DCA layers from $${layers[0]!.toFixed(2)} to $${layers[4]!.toFixed(2)}`);
    reasons.push(`Layer spacing: $${(atrVal * LAYER_SPACING_ATR).toFixed(2)} (0.5x ATR)`);
    if (nearSupport) reasons.push("Near support level");
    reasons.push(`Volume: ${volumeTrend}`);
    if (liquidationConfirmed) reasons.push(`Liquidation-driven dip confirmed. ${fundingInfo}`);
    else if (fundingInfo) reasons.push(fundingInfo);

    return this.detected(confidence, signals, reasons.join(". "));
  }

  async getPlanParameters(symbol: string, ctx: StrategyContext): Promise<StrategyPlanParams> {
    const candles = await this.fetchCandles(ctx, symbol, "4h", CANDLE_LIMIT);
    const currentPrice = this.getCurrentPrice(candles, ctx);
    const atr = this.calculateATR(candles);
    const sma = this.calculateSMA(candles, SMA_PERIOD);

    const entryPrice = currentPrice;
    const atrVal = atr.current ?? currentPrice * 0.02;

    // Stop-loss below deepest layer + 1 ATR buffer
    const deepestLayer = entryPrice - (NUM_LAYERS - 1) * atrVal * LAYER_SPACING_ATR;
    const stopLoss = deepestLayer - atrVal;

    // Take-profits: target SMA recovery
    const smaTarget = sma.current ?? currentPrice * 1.05;
    const _risk = entryPrice - stopLoss;

    const takeProfits: TakeProfitLevel[] = [
      { price: smaTarget * 0.98, percentToSell: 0.35 }, // Just below SMA
      { price: smaTarget, percentToSell: 0.35 }, // At SMA
      { price: smaTarget * 1.03, percentToSell: 0.3 }, // Above SMA
    ];

    const avgTpPrice = takeProfits.reduce((sum, tp) => sum + tp.price * tp.percentToSell, 0);
    const riskRewardRatio = this.calculateRiskReward(entryPrice, stopLoss, avgTpPrice);

    return {
      entryPrice,
      stopLoss,
      takeProfits,
      riskRewardRatio,
      notes:
        `DCA layering trade. Split into 5 equal layers spaced $${(atrVal * LAYER_SPACING_ATR).toFixed(2)} apart. ` +
        `Layer 1: $${entryPrice.toFixed(2)}, Layer 5: $${deepestLayer.toFixed(2)}. ` +
        `Target SMA50 recovery at $${smaTarget.toFixed(2)}. Stop: $${stopLoss.toFixed(2)}. R:R ${riskRewardRatio.toFixed(1)}:1`,
    };
  }

  getPromptFragment(): string {
    return `
## DCA Layering Strategy Rules

When creating a plan using the DCA Layering strategy:

### Entry Rules
- Price must be > 5% below SMA 50 (discount zone)
- RSI should be < 40 (avoid catching a knife in freefall)
- Split total position into 5 equal layers
- Space layers by 0.5x ATR apart below current price
- Execute Layer 1 immediately, set limit orders for 2-5

### Layer Structure
- Layer 1: Current price (20% of position)
- Layer 2: Price - 0.5x ATR (20%)
- Layer 3: Price - 1.0x ATR (20%)
- Layer 4: Price - 1.5x ATR (20%)
- Layer 5: Price - 2.0x ATR (20%)

### Stop-Loss Rules
- Place stop 1 ATR below the deepest layer (Layer 5)
- This is the invalidation — if it reaches here, the dip is a crash
- Never average down beyond 5 layers

### Take-Profit Rules
- TP1: Near SMA 50 (sell 35%) — mean reversion target
- TP2: At SMA 50 (sell 35%) — full recovery
- TP3: 3% above SMA 50 (sell 30%) — overshoot

### Liquidation Filter (Confidence Booster)
- If Hyperliquid shows positive funding (longs paying) during the dip, confidence is higher
- Forced long liquidations = genuine forced selling, not just a natural pullback
- Liquidation-confirmed dips have better mean-reversion odds
- If no liquidation data available, strategy still works on SMA/RSI/volume alone

### Risk Management
- Total position (all 5 layers) should be max 5% of portfolio
- Each layer = 1% of portfolio
- DCA is a PATIENCE strategy — don't rush to fill all layers
- Best for assets you have high conviction on
- Exit all if fundamental thesis changes
`;
  }

  // ============================================================================
  // Hyperliquid Liquidation Context
  // ============================================================================

  private async fetchLiquidationContext(symbol: string): Promise<{
    fundingRate: number;
    annualizedFunding: number;
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
        { funding: string; markPx: string; prevDayPx: string }[],
      ];

      const coin = symbol.replace(/USDT$/i, "").replace(/USD$/i, "").toUpperCase();
      const idx = meta.universe.findIndex((a) => a.name.toUpperCase() === coin);
      if (idx === -1) return null;

      const ctx = assetCtxs[idx];
      if (!ctx) return null;

      const fundingRate = parseFloat(ctx.funding);
      const annualizedFunding = fundingRate * 3 * 365;
      const markPrice = parseFloat(ctx.markPx);
      const prevDayPrice = parseFloat(ctx.prevDayPx);
      const priceChange24h = prevDayPrice > 0 ? (markPrice - prevDayPrice) / prevDayPrice : 0;

      return { fundingRate, annualizedFunding, priceChange24h };
    } catch {
      return null;
    }
  }

  override getRequiredIndicators(): string[] {
    return ["sma50", "rsi14", "atr14"];
  }

  override generateSignal(
    bar: OHLC,
    index: number,
    _data: OHLC[],
    indicators: IndicatorState,
  ): Signal | null {
    if (index < 50) return null;

    const sma50 = indicators.sma50;
    const rsi = indicators.rsi14;

    if (sma50 == null || rsi == null) return null;

    // Price significantly below SMA50 + RSI not extreme
    const discount = ((sma50 - bar.close) / sma50) * 100;
    if (discount >= MIN_DISCOUNT_PCT && rsi < RSI_MAX) {
      return {
        type: "BUY",
        price: bar.close,
        timestamp: bar.timestamp,
        reason: `DCA layer: ${discount.toFixed(1)}% below SMA50, RSI ${rsi.toFixed(1)}`,
      };
    }

    return null;
  }
}

export const dcaLayeringStrategy = new DCALayeringStrategy();
