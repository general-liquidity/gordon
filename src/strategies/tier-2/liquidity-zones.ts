/**
 * Liquidity Zone Compression Strategy
 *
 * Identifies price zones that have been tested multiple times with declining
 * volume on each test (compression). When liquidity dries up at a zone,
 * expect a strong bounce or breakout.
 *
 * Entry Conditions:
 * - Zone tested 3+ times within a 0.5% price band
 * - Volume declining on successive touches (latest < 70% of first)
 * - Current price within 1% of a compressed zone
 * - Direction based on zone type (support = LONG, resistance = SHORT)
 *
 * Confidence Boosters:
 * - 4+ zone touches (+10%)
 * - 5+ zone touches (+15% instead of +10%)
 * - Volume declining on touches (+15%)
 * - ATR contracting near zone (+10%)
 * - RSI near neutral 40-60 (+5%)
 */

import { BaseStrategy } from "../base-strategy.ts";
import type {
  StrategyContext,
  StrategyDetectionResult,
  StrategyPlanParams,
  StrategyId,
  TakeProfitLevel,
} from "../types.ts";
import type { Candle } from "../../core/indicators/types.ts";
import type { OHLC, Signal, IndicatorState } from "../../backtest/types.ts";

// ============================================================================
// Constants
// ============================================================================

/** Number of candles to fetch for analysis */
const CANDLE_LIMIT = 200;

/** Minimum number of zone touches to qualify */
const MIN_ZONE_TOUCHES = 3;

/** Price band for clustering pivots into a zone (0.5%) */
const ZONE_BAND_PERCENT = 0.005;

/** How close current price must be to a zone (1%) */
const ZONE_PROXIMITY_PERCENT = 0.01;

/** Volume compression threshold — latest touch volume must be below this fraction of first touch */
const VOLUME_COMPRESSION_THRESHOLD = 0.7;

/** Lookback for local pivot detection (5-bar) */
const PIVOT_LOOKBACK = 5;

// ============================================================================
// Types
// ============================================================================

interface PivotPoint {
  index: number;
  price: number;
  volume: number;
  type: "high" | "low";
}

interface LiquidityZone {
  price: number;
  type: "support" | "resistance";
  touches: number;
  volumes: number[];
  volumeCompression: boolean;
  volumeDeclinePercent: number;
}

// ============================================================================
// Liquidity Zone Compression Strategy
// ============================================================================

export class LiquidityZonesStrategy extends BaseStrategy {
  readonly id: StrategyId = "liquidity_zones";
  readonly name = "Liquidity Zone Compression";
  readonly tier = 2 as const;
  readonly description =
    "Identifies price zones tested multiple times with declining volume " +
    "(compression). When liquidity dries up at a zone, expect a strong " +
    "bounce or breakout. High win rate when zones are properly compressed.";
  readonly indicators = ["ATR", "Volume", "Support/Resistance"];
  readonly timeframes = ["15m", "1h"];
  readonly riskLevel = "medium" as const;

  async detect(
    symbol: string,
    timeframe: string,
    ctx: StrategyContext
  ): Promise<StrategyDetectionResult> {
    const candles = await this.fetchCandles(ctx, symbol, timeframe, CANDLE_LIMIT);
    if (candles.length < 50) {
      return this.notDetected("Insufficient data (need 50+ candles)");
    }

    const currentPrice = this.getCurrentPrice(candles, ctx);
    if (currentPrice === 0) {
      return this.notDetected("Could not determine current price");
    }

    // Step 1: Detect local pivots (swing highs and lows)
    const pivots = this.detectPivots(candles);
    if (pivots.length < MIN_ZONE_TOUCHES) {
      return this.notDetected(
        `Not enough pivot points detected (${pivots.length} < ${MIN_ZONE_TOUCHES})`
      );
    }

    // Step 2: Cluster pivots into zones
    const zones = this.clusterPivotsIntoZones(pivots);
    if (zones.length === 0) {
      return this.notDetected("No liquidity zones with 3+ touches found");
    }

    // Step 3: Find compressed zones near current price
    const nearbyCompressedZones = zones.filter((z) => {
      const distance = Math.abs(currentPrice - z.price) / currentPrice;
      return distance <= ZONE_PROXIMITY_PERCENT && z.volumeCompression;
    });

    if (nearbyCompressedZones.length === 0) {
      // Check if there are any nearby zones at all (even without compression)
      const nearbyZones = zones.filter((z) => {
        const distance = Math.abs(currentPrice - z.price) / currentPrice;
        return distance <= ZONE_PROXIMITY_PERCENT;
      });

      if (nearbyZones.length === 0) {
        return this.notDetected(
          `No liquidity zones within ${(ZONE_PROXIMITY_PERCENT * 100).toFixed(1)}% of current price ($${currentPrice.toFixed(2)})`
        );
      }

      return this.notDetected(
        `Found ${nearbyZones.length} zone(s) near price but none with volume compression`
      );
    }

    // Step 4: Pick the best zone (most touches, strongest compression)
    const bestZone = nearbyCompressedZones.sort((a, b) => {
      // Prefer more touches, then stronger compression
      if (b.touches !== a.touches) return b.touches - a.touches;
      return b.volumeDeclinePercent - a.volumeDeclinePercent;
    })[0]!;

    // Step 5: Determine direction
    const direction = bestZone.type === "support" ? "long" : "short";

    // Step 6: Calculate confidence
    let confidence = 0.45; // Base confidence

    // Touch count bonuses
    if (bestZone.touches >= 5) {
      confidence += 0.15;
    } else if (bestZone.touches >= 4) {
      confidence += 0.10;
    }

    // Volume compression bonus
    if (bestZone.volumeCompression) {
      confidence += 0.15;
    }

    // ATR contraction bonus (squeeze near zone)
    const atr = this.calculateATR(candles);
    const recentCandles = candles.slice(-20);
    const olderCandles = candles.slice(-40, -20);
    if (recentCandles.length >= 20 && olderCandles.length >= 20) {
      const recentATR = this.calculateATR(recentCandles);
      const olderATR = this.calculateATR(olderCandles);
      if (
        recentATR.current !== null &&
        olderATR.current !== null &&
        olderATR.current > 0 &&
        recentATR.current < olderATR.current * 0.85
      ) {
        confidence += 0.10;
      }
    }

    // RSI near neutral bonus
    const rsi = this.calculateRSI(candles);
    const rsiNeutral =
      rsi.current !== null && rsi.current >= 40 && rsi.current <= 60;
    if (rsiNeutral) {
      confidence += 0.05;
    }

    const signals = {
      zonePrice: bestZone.price,
      zoneTouches: bestZone.touches,
      zoneType: bestZone.type,
      volumeCompression: bestZone.volumeCompression,
      volumeDeclinePercent: bestZone.volumeDeclinePercent,
      direction,
      atr: atr.current,
    };

    const reasons: string[] = [];
    reasons.push(
      `${bestZone.type.charAt(0).toUpperCase() + bestZone.type.slice(1)} zone at $${bestZone.price.toFixed(2)} tested ${bestZone.touches} times`
    );
    reasons.push(
      `Volume declined ${bestZone.volumeDeclinePercent.toFixed(0)}% from first to last touch (compression)`
    );
    reasons.push(
      `Direction: ${direction.toUpperCase()} — price near compressed ${bestZone.type}`
    );
    if (rsiNeutral) {
      reasons.push(`RSI neutral (${rsi.current?.toFixed(1)}) — not overextended`);
    }
    if (atr.current !== null) {
      reasons.push(`ATR: ${atr.current.toFixed(4)}`);
    }

    return this.detected(confidence, signals, reasons.join(". "));
  }

  // ==========================================================================
  // Zone Detection Algorithm
  // ==========================================================================

  /**
   * Detect local swing highs and lows using a 5-bar lookback.
   * A local low (support pivot) is a bar whose low is lower than
   * the PIVOT_LOOKBACK bars on either side.
   * A local high (resistance pivot) is similar for highs.
   */
  private detectPivots(candles: Candle[]): PivotPoint[] {
    const pivots: PivotPoint[] = [];

    for (let i = PIVOT_LOOKBACK; i < candles.length - PIVOT_LOOKBACK; i++) {
      const current = candles[i]!;

      // Check for local low (support pivot)
      let isLocalLow = true;
      for (let j = 1; j <= PIVOT_LOOKBACK; j++) {
        if (
          candles[i - j]!.low <= current.low ||
          candles[i + j]!.low <= current.low
        ) {
          isLocalLow = false;
          break;
        }
      }

      if (isLocalLow) {
        pivots.push({
          index: i,
          price: current.low,
          volume: current.volume,
          type: "low",
        });
      }

      // Check for local high (resistance pivot)
      let isLocalHigh = true;
      for (let j = 1; j <= PIVOT_LOOKBACK; j++) {
        if (
          candles[i - j]!.high >= current.high ||
          candles[i + j]!.high >= current.high
        ) {
          isLocalHigh = false;
          break;
        }
      }

      if (isLocalHigh) {
        pivots.push({
          index: i,
          price: current.high,
          volume: current.volume,
          type: "high",
        });
      }
    }

    return pivots;
  }

  /**
   * Cluster pivots within 0.5% of each other into liquidity zones.
   * For each zone: count tests, track volumes, compute volume trend.
   */
  private clusterPivotsIntoZones(pivots: PivotPoint[]): LiquidityZone[] {
    const zones: LiquidityZone[] = [];
    const used = new Set<number>();

    // Sort pivots by price to facilitate clustering
    const sorted = [...pivots].sort((a, b) => a.price - b.price);

    for (let i = 0; i < sorted.length; i++) {
      if (used.has(i)) continue;

      const anchor = sorted[i]!;
      const cluster: PivotPoint[] = [anchor];
      used.add(i);

      // Find all pivots within the band
      for (let j = i + 1; j < sorted.length; j++) {
        if (used.has(j)) continue;
        const candidate = sorted[j]!;
        const distance = Math.abs(candidate.price - anchor.price) / anchor.price;
        if (distance <= ZONE_BAND_PERCENT) {
          cluster.push(candidate);
          used.add(j);
        }
      }

      if (cluster.length < MIN_ZONE_TOUCHES) continue;

      // Sort cluster by index (chronological order) for volume trend
      cluster.sort((a, b) => a.index - b.index);

      // Determine zone type by majority of pivot types
      const lowCount = cluster.filter((p) => p.type === "low").length;
      const highCount = cluster.filter((p) => p.type === "high").length;
      const zoneType: "support" | "resistance" =
        lowCount >= highCount ? "support" : "resistance";

      // Calculate zone price as the average of all pivot prices
      const zonePrice =
        cluster.reduce((sum, p) => sum + p.price, 0) / cluster.length;

      // Extract volumes in chronological order
      const volumes = cluster.map((p) => p.volume);

      // Check volume compression: latest touch volume < threshold * first touch volume
      const firstVolume = volumes[0]!;
      const lastVolume = volumes[volumes.length - 1]!;
      const volumeCompression =
        firstVolume > 0 && lastVolume < firstVolume * VOLUME_COMPRESSION_THRESHOLD;

      const volumeDeclinePercent =
        firstVolume > 0
          ? ((firstVolume - lastVolume) / firstVolume) * 100
          : 0;

      zones.push({
        price: zonePrice,
        type: zoneType,
        touches: cluster.length,
        volumes,
        volumeCompression,
        volumeDeclinePercent,
      });
    }

    return zones;
  }

  // ==========================================================================
  // Plan Parameters
  // ==========================================================================

  async getPlanParameters(
    symbol: string,
    ctx: StrategyContext
  ): Promise<StrategyPlanParams> {
    const candles = await this.fetchCandles(ctx, symbol, "1h", CANDLE_LIMIT);
    const currentPrice = this.getCurrentPrice(candles, ctx);
    const atr = this.calculateATR(candles);

    const atrVal = atr.current ?? currentPrice * 0.02;
    const entryPrice = currentPrice;

    // Detect zones to determine direction
    const pivots = this.detectPivots(candles);
    const zones = this.clusterPivotsIntoZones(pivots);

    // Find the nearest compressed zone
    const nearbyZones = zones
      .filter((z) => {
        const dist = Math.abs(currentPrice - z.price) / currentPrice;
        return dist <= ZONE_PROXIMITY_PERCENT && z.volumeCompression;
      })
      .sort((a, b) => b.touches - a.touches);

    const bestZone = nearbyZones[0];
    const isSupport = bestZone ? bestZone.type === "support" : true;

    // Stop-loss: 1 ATR beyond the zone
    let stopLoss: number;
    let takeProfits: TakeProfitLevel[];

    if (isSupport) {
      // LONG: stop below support, targets above
      stopLoss = entryPrice - atrVal;
      const risk = entryPrice - stopLoss;
      takeProfits = [
        { price: entryPrice + risk * 1.5, percentToSell: 0.4 },
        { price: entryPrice + risk * 2.5, percentToSell: 0.35 },
        { price: entryPrice + risk * 4.0, percentToSell: 0.25 },
      ];
    } else {
      // SHORT: stop above resistance, targets below
      stopLoss = entryPrice + atrVal;
      const risk = stopLoss - entryPrice;
      takeProfits = [
        { price: entryPrice - risk * 1.5, percentToSell: 0.4 },
        { price: entryPrice - risk * 2.5, percentToSell: 0.35 },
        { price: entryPrice - risk * 4.0, percentToSell: 0.25 },
      ];
    }

    const avgTpPrice = takeProfits.reduce(
      (sum, tp) => sum + tp.price * tp.percentToSell,
      0
    );
    const riskRewardRatio = this.calculateRiskReward(
      entryPrice,
      stopLoss,
      avgTpPrice
    );

    const direction = isSupport ? "LONG" : "SHORT";
    const zoneInfo = bestZone
      ? `${bestZone.touches}-touch ${bestZone.type} zone at $${bestZone.price.toFixed(2)}`
      : "nearest zone";

    return {
      entryPrice,
      stopLoss,
      takeProfits,
      riskRewardRatio,
      notes:
        `Liquidity zone compression ${direction} at ${zoneInfo}. ` +
        `Stop 1 ATR beyond zone at $${stopLoss.toFixed(2)}. ` +
        `Volume declining = liquidity drying up. R:R ${riskRewardRatio.toFixed(1)}:1`,
    };
  }

  // ==========================================================================
  // Prompt Fragment
  // ==========================================================================

  getPromptFragment(): string {
    return `
## Liquidity Zone Compression Strategy Rules

When creating a plan using the Liquidity Zone Compression strategy:

### Concept
Liquidity zones are price areas that have been tested multiple times. Each test
absorbs resting orders (stop losses, limit orders). When volume declines on
successive touches, it means liquidity is drying up — fewer orders remain at
that level. This compression signals an imminent strong bounce or breakout.

### Entry Rules
- Enter when price reaches a zone that has been tested 3+ times
- Volume must be declining on successive zone touches (compression)
- Latest touch volume should be < 70% of first touch volume
- Support zones: enter LONG (expect bounce up)
- Resistance zones: enter SHORT (expect rejection down)
- Price must be within 1% of the zone

### Stop-Loss Rules
- Place stop 1 ATR beyond the zone (tight stop — zone is validated)
- Support zone: stop 1 ATR below the zone
- Resistance zone: stop 1 ATR above the zone
- Tight stops are appropriate because the zone has been tested multiple times

### Take-Profit Rules
- TP1: 1.5x risk (sell 40%) — quick profit at nearby structure
- TP2: 2.5x risk (sell 35%) — core profit target
- TP3: 4.0x risk (sell 25%) — extended target or trail
- Move stop to breakeven after TP1 hit

### Risk Management
- Maximum position size: 4% of portfolio
- Higher confidence when 5+ touches with strong compression
- Exit if zone breaks decisively with volume (failed zone)
- Best on 15m and 1h timeframes for active trading
- High win rate when zones are properly compressed

### Best Conditions
- Range-bound or consolidating markets
- Clear multi-touch support/resistance levels
- Declining volume on each zone test
- RSI near neutral (40-60) — not overextended
- ATR contracting near the zone (volatility squeeze)
`;
  }

  // ==========================================================================
  // Backtesting
  // ==========================================================================

  override getRequiredIndicators(): string[] {
    return ["atr14", "sma20"];
  }

  override generateSignal(
    bar: OHLC,
    index: number,
    data: OHLC[],
    indicators: IndicatorState
  ): Signal | null {
    // Need enough history for zone detection
    if (index < 50) return null;

    const lookback = Math.min(index + 1, CANDLE_LIMIT);
    const historicalBars = data.slice(index + 1 - lookback, index + 1);

    // Convert OHLC bars to a lightweight format for pivot detection
    const pivots = this.detectPivotsFromBars(historicalBars);
    if (pivots.length < MIN_ZONE_TOUCHES) return null;

    const zones = this.clusterPivotsIntoZones(pivots);
    if (zones.length === 0) return null;

    const price = bar.close;

    // Find compressed zones near current price
    for (const zone of zones) {
      const distance = Math.abs(price - zone.price) / price;
      if (distance > ZONE_PROXIMITY_PERCENT) continue;
      if (!zone.volumeCompression) continue;

      if (zone.type === "support" && price >= zone.price) {
        return {
          type: "BUY",
          price: bar.close,
          timestamp: bar.timestamp,
          reason: `Liquidity zone compression: ${zone.touches}-touch support at ${zone.price.toFixed(2)}, volume declined ${zone.volumeDeclinePercent.toFixed(0)}%`,
        };
      }

      if (zone.type === "resistance" && price <= zone.price) {
        return {
          type: "SELL",
          price: bar.close,
          timestamp: bar.timestamp,
          reason: `Liquidity zone compression: ${zone.touches}-touch resistance at ${zone.price.toFixed(2)}, volume declined ${zone.volumeDeclinePercent.toFixed(0)}%`,
        };
      }
    }

    return null;
  }

  /**
   * Detect pivots from OHLC bars (used in backtesting where we have OHLC not Candle).
   */
  private detectPivotsFromBars(bars: OHLC[]): PivotPoint[] {
    const pivots: PivotPoint[] = [];

    for (let i = PIVOT_LOOKBACK; i < bars.length - PIVOT_LOOKBACK; i++) {
      const current = bars[i]!;

      // Check for local low (support pivot)
      let isLocalLow = true;
      for (let j = 1; j <= PIVOT_LOOKBACK; j++) {
        if (
          bars[i - j]!.low <= current.low ||
          bars[i + j]!.low <= current.low
        ) {
          isLocalLow = false;
          break;
        }
      }

      if (isLocalLow) {
        pivots.push({
          index: i,
          price: current.low,
          volume: current.volume,
          type: "low",
        });
      }

      // Check for local high (resistance pivot)
      let isLocalHigh = true;
      for (let j = 1; j <= PIVOT_LOOKBACK; j++) {
        if (
          bars[i - j]!.high >= current.high ||
          bars[i + j]!.high >= current.high
        ) {
          isLocalHigh = false;
          break;
        }
      }

      if (isLocalHigh) {
        pivots.push({
          index: i,
          price: current.high,
          volume: current.volume,
          type: "high",
        });
      }
    }

    return pivots;
  }
}

export const liquidityZonesStrategy = new LiquidityZonesStrategy();
