/**
 * Whale Order Detection
 *
 * Analyzes order book to detect large (whale) orders and determine
 * market bias based on whale positioning.
 */

import { createModuleLogger } from "../../infra/logger/index.ts";

const logger = createModuleLogger("whale-detector");

// ============================================================================
// Types
// ============================================================================

export interface WhaleAnalysis {
  bias: "bullish" | "bearish" | "neutral";
  strength: number; // 0-1, how strong the bias is
  whaleBidsValue: number; // Total USD value of whale bids
  whaleAsksValue: number; // Total USD value of whale asks
  whaleBidsCount: number; // Number of whale bid orders
  whaleAsksCount: number; // Number of whale ask orders
  totalWhaleValue: number; // Combined whale order value
  largestBid: WhaleOrder | null;
  largestAsk: WhaleOrder | null;
}

export interface WhaleOrder {
  price: number;
  quantity: number;
  value: number; // USD value
}

export interface MarketImpactEstimate {
  impactPrice: number; // Expected average fill price
  slippagePercent: number; // Slippage from best price
  levelsConsumed: number; // Number of price levels consumed
  bestPrice: number; // Best available price
  fillPercentage: number; // How much of order can be filled (0-1)
}

export interface DepthAnalysis {
  bidDepth: number; // Total USD value of bids
  askDepth: number; // Total USD value of asks
  totalDepth: number;
  depthImbalance: number; // -1 to 1 (negative = more asks, positive = more bids)
  bidAskRatio: number;
}

export interface OrderBookEntry {
  price: number;
  quantity: number;
}

// ============================================================================
// Whale Detector
// ============================================================================

export class WhaleDetector {
  private whaleThresholdUsd: number;

  constructor(whaleThresholdUsd: number = 50000) {
    this.whaleThresholdUsd = whaleThresholdUsd;
  }

  /**
   * Analyze order book for whale orders and determine market bias
   */
  analyzeWhaleOrders(
    bids: OrderBookEntry[],
    asks: OrderBookEntry[],
    _currentPrice: number,
  ): WhaleAnalysis {
    try {
      if (!bids.length || !asks.length) {
        return this.neutralResult();
      }

      let whaleBidsValue = 0;
      let whaleAsksValue = 0;
      let whaleBidsCount = 0;
      let whaleAsksCount = 0;
      let largestBid: WhaleOrder | null = null;
      let largestAsk: WhaleOrder | null = null;

      // Analyze bids (buy orders)
      for (const bid of bids) {
        const value = bid.price * bid.quantity;
        if (value >= this.whaleThresholdUsd) {
          whaleBidsValue += value;
          whaleBidsCount++;

          if (!largestBid || value > largestBid.value) {
            largestBid = { price: bid.price, quantity: bid.quantity, value };
          }
        }
      }

      // Analyze asks (sell orders)
      for (const ask of asks) {
        const value = ask.price * ask.quantity;
        if (value >= this.whaleThresholdUsd) {
          whaleAsksValue += value;
          whaleAsksCount++;

          if (!largestAsk || value > largestAsk.value) {
            largestAsk = { price: ask.price, quantity: ask.quantity, value };
          }
        }
      }

      // Determine bias
      const totalWhaleValue = whaleBidsValue + whaleAsksValue;
      let bias: "bullish" | "bearish" | "neutral" = "neutral";
      let strength = 0;

      if (totalWhaleValue > 0) {
        const bidPercentage = whaleBidsValue / totalWhaleValue;

        if (bidPercentage > 0.6) {
          bias = "bullish";
          strength = bidPercentage;
        } else if (bidPercentage < 0.4) {
          bias = "bearish";
          strength = 1 - bidPercentage;
        } else {
          bias = "neutral";
          strength = 0.5;
        }
      }

      return {
        bias,
        strength,
        whaleBidsValue,
        whaleAsksValue,
        whaleBidsCount,
        whaleAsksCount,
        totalWhaleValue,
        largestBid,
        largestAsk,
      };
    } catch (error) {
      logger.error("Error analyzing whale orders", error as Error);
      return this.neutralResult();
    }
  }

  /**
   * Calculate order book depth metrics
   */
  calculateDepth(
    bids: OrderBookEntry[],
    asks: OrderBookEntry[],
    depthLevels: number = 10,
  ): DepthAnalysis {
    try {
      if (!bids.length || !asks.length) {
        return {
          bidDepth: 0,
          askDepth: 0,
          totalDepth: 0,
          depthImbalance: 0,
          bidAskRatio: 0,
        };
      }

      let bidDepth = 0;
      let askDepth = 0;

      // Sum bid depth
      for (let i = 0; i < Math.min(depthLevels, bids.length); i++) {
        const bid = bids[i]!;
        bidDepth += bid.price * bid.quantity;
      }

      // Sum ask depth
      for (let i = 0; i < Math.min(depthLevels, asks.length); i++) {
        const ask = asks[i]!;
        askDepth += ask.price * ask.quantity;
      }

      const totalDepth = bidDepth + askDepth;
      const depthImbalance = totalDepth > 0 ? (bidDepth - askDepth) / totalDepth : 0;
      const bidAskRatio = askDepth > 0 ? bidDepth / askDepth : 0;

      return {
        bidDepth,
        askDepth,
        totalDepth,
        depthImbalance,
        bidAskRatio,
      };
    } catch (error) {
      logger.error("Error calculating depth", error as Error);
      return {
        bidDepth: 0,
        askDepth: 0,
        totalDepth: 0,
        depthImbalance: 0,
        bidAskRatio: 0,
      };
    }
  }

  /**
   * Estimate market impact of a trade (slippage)
   */
  estimateMarketImpact(
    bids: OrderBookEntry[],
    asks: OrderBookEntry[],
    orderSizeUsd: number,
    side: "BUY" | "SELL",
  ): MarketImpactEstimate {
    try {
      if (!bids.length || !asks.length) {
        return {
          impactPrice: 0,
          slippagePercent: 0,
          levelsConsumed: 0,
          bestPrice: 0,
          fillPercentage: 0,
        };
      }

      const levels = side === "BUY" ? asks : bids;
      const bestPrice = levels[0]?.price ?? 0;

      if (bestPrice === 0) {
        return {
          impactPrice: 0,
          slippagePercent: 0,
          levelsConsumed: 0,
          bestPrice: 0,
          fillPercentage: 0,
        };
      }

      let remainingSize = orderSizeUsd;
      let levelsConsumed = 0;
      let totalCost = 0;

      for (const level of levels) {
        const levelValue = level.price * level.quantity;

        if (remainingSize <= levelValue) {
          totalCost += remainingSize;
          levelsConsumed++;
          remainingSize = 0;
          break;
        } else {
          totalCost += levelValue;
          remainingSize -= levelValue;
          levelsConsumed++;
        }
      }

      // Calculate average fill price
      let avgPrice: number;
      if (remainingSize > 0) {
        // Order can't be fully filled - estimate with 10% slippage
        avgPrice = side === "BUY" ? bestPrice * 1.1 : bestPrice * 0.9;
      } else {
        avgPrice = orderSizeUsd > 0 ? totalCost / orderSizeUsd : bestPrice;
      }

      const slippagePercent =
        bestPrice > 0 ? (Math.abs(avgPrice - bestPrice) / bestPrice) * 100 : 0;

      const fillPercentage =
        remainingSize === 0 ? 1.0 : (orderSizeUsd - remainingSize) / orderSizeUsd;

      return {
        impactPrice: avgPrice,
        slippagePercent,
        levelsConsumed,
        bestPrice,
        fillPercentage,
      };
    } catch (error) {
      logger.error("Error estimating market impact", error as Error);
      return {
        impactPrice: 0,
        slippagePercent: 0,
        levelsConsumed: 0,
        bestPrice: 0,
        fillPercentage: 0,
      };
    }
  }

  private neutralResult(): WhaleAnalysis {
    return {
      bias: "neutral",
      strength: 0,
      whaleBidsValue: 0,
      whaleAsksValue: 0,
      whaleBidsCount: 0,
      whaleAsksCount: 0,
      totalWhaleValue: 0,
      largestBid: null,
      largestAsk: null,
    };
  }
}

// Default instance
export const whaleDetector = new WhaleDetector();
