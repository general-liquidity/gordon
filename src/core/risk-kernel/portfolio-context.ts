/**
 * Portfolio Context
 *
 * Provides a snapshot of the current portfolio state required by the
 * Risk Kernel to evaluate orders. Can be built from an exchange adapter
 * (live data) or from cached local state (faster, for backtesting).
 */

import { z } from "zod";
import { createModuleLogger } from "../../infra/logger/index.ts";
import type { Exchange } from "../../infra/exchange/types.ts";
import type { BrokerAdapter } from "../../infra/broker/types.ts";
import { dailyLimitTracker } from "../risk-management/daily-limits.ts";
import { drawdownTracker } from "../risk-management/drawdown-tracker.ts";

const logger = createModuleLogger("portfolio-context");

// ============================================================================
// Types
// ============================================================================

export const OpenPositionSchema = z.object({
  symbol: z.string(),
  side: z.enum(["long", "short"]),
  size: z.number(),
  entryPrice: z.number(),
  currentPrice: z.number(),
  unrealizedPnL: z.number(),
  exchangeId: z.string(),
});

export type OpenPosition = z.infer<typeof OpenPositionSchema>;

export const PortfolioContextSchema = z.object({
  totalEquity: z.number(),
  availableBalance: z.number(),
  openPositions: z.array(OpenPositionSchema),
  todayPnL: z.number(),
  todayTradeCount: z.number(),
  currentDrawdown: z.number(),
  peakEquity: z.number(),
});

export type PortfolioContext = z.infer<typeof PortfolioContextSchema>;

/**
 * Cached portfolio state for fast context building (backtesting, offline)
 */
export interface CachedPortfolioState {
  totalEquity: number;
  availableBalance: number;
  openPositions: OpenPosition[];
  todayPnL: number;
  todayTradeCount: number;
  peakEquity: number;
}

// ============================================================================
// Portfolio Context Builder
// ============================================================================

export class PortfolioContextBuilder {
  /**
   * Build portfolio context from live exchange data.
   * Queries the exchange adapter for account info, balances, and open orders,
   * then combines with local tracking state (daily PnL, drawdown).
   */
  async buildFromExchange(adapter: Exchange): Promise<PortfolioContext> {
    try {
      // Fetch account details (includes total value calculation)
      const accountDetails = await adapter.getFullAccountDetails();
      const totalEquity = accountDetails.totalUsdtValue;

      // Get available USDT balance
      let availableBalance = 0;
      const stableAssets = ["USDT", "BUSD", "USDC", "FDUSD"];
      for (const asset of stableAssets) {
        try {
          availableBalance += await adapter.getBalance(asset);
        } catch {
          // Asset not found or no balance
        }
      }

      // Build open positions from non-stable balances
      const openPositions: OpenPosition[] = [];
      const nonStable = accountDetails.nonZeroBalances.filter(
        (b) => !stableAssets.includes(b.asset) && b.total > 0
      );

      for (const balance of nonStable) {
        try {
          const symbol = `${balance.asset}USDT`;
          const currentPrice = await adapter.getPrice(symbol);
          const positionValue = balance.total * currentPrice;

          // Only include positions with meaningful value (> $1)
          if (positionValue > 1) {
            openPositions.push({
              symbol,
              side: "long", // Spot exchange = always long
              size: balance.total,
              entryPrice: 0, // Not available from exchange balance alone
              currentPrice,
              unrealizedPnL: 0, // Cannot calculate without entry price
              exchangeId: adapter.exchangeId,
            });
          }
        } catch {
          // No USDT pair for this asset, skip
        }
      }

      // Get daily PnL and drawdown from local trackers
      const dailyStatus = dailyLimitTracker.getStatus(totalEquity);
      const todayPnL = dailyStatus.totalPnL;
      const todayTradeCount = dailyLimitTracker.getTodaysTrades().length;

      // Update drawdown tracker with current equity
      drawdownTracker.updateBalance(totalEquity);
      const ddStatus = drawdownTracker.getStatus();
      const currentDrawdown = ddStatus.drawdownPercent;
      const peakEquity = ddStatus.peakBalance;

      const context: PortfolioContext = {
        totalEquity,
        availableBalance,
        openPositions,
        todayPnL,
        todayTradeCount,
        currentDrawdown,
        peakEquity: peakEquity > 0 ? peakEquity : totalEquity,
      };

      logger.debug("Portfolio context built from exchange", {
        totalEquity: totalEquity.toFixed(2),
        availableBalance: availableBalance.toFixed(2),
        openPositions: openPositions.length,
        todayPnL: todayPnL.toFixed(2),
        currentDrawdown: currentDrawdown.toFixed(2),
      });

      return context;
    } catch (error) {
      logger.error("Failed to build portfolio context from exchange", error as Error);
      throw error;
    }
  }

  async buildFromBroker(adapter: BrokerAdapter): Promise<PortfolioContext> {
    try {
      const [account, positions] = await Promise.all([
        adapter.getAccount(),
        adapter.getPositions(),
      ]);

      const totalEquity = account.portfolioValue;
      const availableBalance = account.buyingPower || account.cash;
      const openPositions: OpenPosition[] = positions.map((position) => ({
        symbol: position.symbol,
        side: position.side,
        size: position.qty,
        entryPrice: position.avgEntryPrice,
        currentPrice: position.qty !== 0 ? position.marketValue / position.qty : position.avgEntryPrice,
        unrealizedPnL: position.unrealizedPl,
        exchangeId: adapter.brokerId,
      }));

      const dailyStatus = dailyLimitTracker.getStatus(totalEquity);
      const todayPnL = dailyStatus.totalPnL;
      const todayTradeCount = dailyLimitTracker.getTodaysTrades().length;

      drawdownTracker.updateBalance(totalEquity);
      const ddStatus = drawdownTracker.getStatus();
      const currentDrawdown = ddStatus.drawdownPercent;
      const peakEquity = ddStatus.peakBalance;

      return {
        totalEquity,
        availableBalance,
        openPositions,
        todayPnL,
        todayTradeCount,
        currentDrawdown,
        peakEquity: peakEquity > 0 ? peakEquity : totalEquity,
      };
    } catch (error) {
      logger.error("Failed to build portfolio context from broker", error as Error);
      throw error;
    }
  }

  async buildFromVenue(adapter: Exchange | BrokerAdapter): Promise<PortfolioContext> {
    if ("exchangeId" in adapter) {
      return this.buildFromExchange(adapter);
    }
    return this.buildFromBroker(adapter);
  }

  /**
   * Build portfolio context from cached/local state.
   * Faster than querying the exchange -- used in backtesting or when
   * exchange data is already available in memory.
   */
  buildFromCache(state: CachedPortfolioState): PortfolioContext {
    const drawdownAmount = state.peakEquity - state.totalEquity;
    const currentDrawdown = state.peakEquity > 0
      ? (drawdownAmount / state.peakEquity) * 100
      : 0;

    const context: PortfolioContext = {
      totalEquity: state.totalEquity,
      availableBalance: state.availableBalance,
      openPositions: state.openPositions,
      todayPnL: state.todayPnL,
      todayTradeCount: state.todayTradeCount,
      currentDrawdown: Math.max(0, currentDrawdown),
      peakEquity: state.peakEquity,
    };

    logger.debug("Portfolio context built from cache", {
      totalEquity: state.totalEquity.toFixed(2),
      openPositions: state.openPositions.length,
    });

    return context;
  }
}

/** Default singleton instance */
export const portfolioContextBuilder = new PortfolioContextBuilder();
