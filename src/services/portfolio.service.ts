/**
 * Portfolio Service
 * Portfolio management and valuation
 */

import { getContainer } from "./container.ts";
import { createModuleLogger } from "../infra/logger/index.ts";

const logger = createModuleLogger("portfolio");

/**
 * Portfolio holding
 */
export interface Holding {
  asset: string;
  free: number;
  locked: number;
  total: number;
  usdValue: number;
  wallet: "spot" | "funding";
}

/**
 * Portfolio summary
 */
export interface PortfolioSummary {
  totalValue: number;
  holdings: Holding[];
  openTrades: number;
  availableCash: number;
}

/**
 * Stablecoins treated as 1:1 with USD
 */
const STABLECOINS = ["USDT", "USD", "USDC", "BUSD", "TUSD", "USDP", "FDUSD"];

/**
 * Portfolio service - manages portfolio data
 */
export class PortfolioService {
  /**
   * Get full portfolio with valuations
   */
  async getPortfolio(): Promise<PortfolioSummary> {
    const container = getContainer();
    const exchange = container.exchange;
    const priceCache = container.priceCache;

    if (!exchange) {
      logger.warn("Exchange client not available");
      return {
        totalValue: 0,
        holdings: [],
        openTrades: 0,
        availableCash: 0,
      };
    }

    const allBalances = await exchange.getAllBalances();
    const holdings: Holding[] = [];
    let totalValue = 0;
    let availableCash = 0;

    for (const balance of allBalances) {
      const total = balance.free + balance.locked;
      if (total <= 0) continue;

      let usdValue = 0;

      if (STABLECOINS.includes(balance.asset)) {
        // Stablecoins are 1:1
        usdValue = total;
        availableCash += balance.free;
      } else {
        // Try to get price from cache first, then fetch
        try {
          const price = await priceCache.getOrFetch(
            `${balance.asset}USDT`,
            () => exchange.getPrice(`${balance.asset}USDT`)
          );
          usdValue = total * price;
        } catch {
          // No price available, skip USD valuation
          logger.debug(`No USD price for ${balance.asset}`);
        }
      }

      if (usdValue > 0.01 || total > 0) {
        holdings.push({
          asset: balance.asset,
          free: balance.free,
          locked: balance.locked,
          total,
          usdValue,
          wallet: "spot",
        });
        totalValue += usdValue;
      }
    }

    // Sort by USD value
    holdings.sort((a, b) => b.usdValue - a.usdValue);

    // Get open trades count
    const openTrades = container.tradesRepo.count({ status: "OPEN" } as never);

    logger.debug("Portfolio fetched", { totalValue, holdingsCount: holdings.length });

    return {
      totalValue,
      holdings,
      openTrades,
      availableCash,
    };
  }

  /**
   * Get just the total portfolio value
   */
  async getTotalValue(): Promise<number> {
    const portfolio = await this.getPortfolio();
    return portfolio.totalValue;
  }

  /**
   * Get available cash (free stablecoins)
   */
  async getAvailableCash(): Promise<number> {
    const portfolio = await this.getPortfolio();
    return portfolio.availableCash;
  }

  /**
   * Get balance for a specific asset
   */
  async getAssetBalance(asset: string): Promise<{
    free: number;
    locked: number;
    total: number;
    usdValue: number;
  }> {
    const container = getContainer();
    const exchange = container.exchange;
    const priceCache = container.priceCache;

    if (!exchange) {
      return { free: 0, locked: 0, total: 0, usdValue: 0 };
    }

    const balance = await exchange.getBalance(asset);
    let usdValue = 0;

    if (STABLECOINS.includes(asset.toUpperCase())) {
      usdValue = balance;
    } else {
      try {
        const price = await priceCache.getOrFetch(
          `${asset}USDT`,
          () => exchange.getPrice(`${asset}USDT`)
        );
        usdValue = balance * price;
      } catch {
        // No price available
      }
    }

    return {
      free: balance,
      locked: 0,
      total: balance,
      usdValue,
    };
  }

  /**
   * Calculate allocation for a trade
   */
  calculateAllocation(
    portfolioValue: number,
    percentage: number,
    maxAmount?: number
  ): number {
    let allocation = portfolioValue * percentage;

    if (maxAmount && allocation > maxAmount) {
      allocation = maxAmount;
    }

    return allocation;
  }
}

// Default instance
let defaultService: PortfolioService | null = null;

export function getPortfolioService(): PortfolioService {
  if (!defaultService) {
    defaultService = new PortfolioService();
  }
  return defaultService;
}
