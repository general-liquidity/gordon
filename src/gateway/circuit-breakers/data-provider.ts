/**
 * Circuit Breaker Live Data Provider
 *
 * Computes correlation shock and liquidity gap metrics from live
 * exchange data. Exchange-agnostic — uses the abstract Exchange interface.
 * Degrades gracefully when exchange methods are unsupported.
 */

import type { Exchange } from "../../infra/exchange/types.ts";
import type { OpenPosition } from "../../core/risk-kernel/portfolio-context.ts";
import { createModuleLogger } from "../../infra/logger/index.ts";

const logger = createModuleLogger("circuit-breaker-data");

export interface CircuitBreakerLiveData {
  correlationShockPercent: number;
  liquidityGapBps: number;
}

/**
 * Detect correlation shock across open positions.
 *
 * Uses 24h ticker data (single bulk call) to check if all positions
 * are moving in the same direction by large amounts — a sign of
 * market-wide stress where diversification breaks down.
 *
 * Returns the average absolute price change when positions are
 * highly correlated (stddev of changes < half the average), or 0
 * when positions are reasonably decorrelated.
 */
export async function computeCorrelationShock(
  exchange: Exchange,
  positions: OpenPosition[],
): Promise<number> {
  if (positions.length <= 1) return 0;

  try {
    const tickers = await exchange.get24hrTickers();
    const tickerMap = new Map(tickers.map((t) => [t.symbol, t]));

    const changes: number[] = [];
    for (const pos of positions) {
      const ticker = tickerMap.get(pos.symbol);
      if (ticker) {
        changes.push(ticker.priceChangePercent);
      }
    }

    if (changes.length <= 1) return 0;

    const absChanges = changes.map(Math.abs);
    const avgAbsChange = absChanges.reduce((a, b) => a + b, 0) / absChanges.length;

    // Check if all positions moved the same direction
    const allPositive = changes.every((c) => c >= 0);
    const allNegative = changes.every((c) => c <= 0);
    const sameDirection = allPositive || allNegative;

    // Compute standard deviation of changes
    const mean = changes.reduce((a, b) => a + b, 0) / changes.length;
    const variance = changes.reduce((sum, c) => sum + (c - mean) ** 2, 0) / changes.length;
    const stddev = Math.sqrt(variance);

    // Correlation shock: positions moving together (low stddev) with large magnitude
    // Threshold: stddev < half of average absolute change means high correlation
    if (sameDirection && avgAbsChange > 2 && stddev < avgAbsChange / 2) {
      return avgAbsChange;
    }

    return 0;
  } catch (error) {
    logger.warn("Could not compute correlation shock", {
      error: (error as Error).message,
    });
    return 0;
  }
}

/**
 * Compute average liquidity gap (bid-ask spread) across open positions.
 *
 * Calls exchange.getSpread() for each symbol and returns the average
 * spread in basis points. Gracefully skips symbols where spread data
 * is unavailable.
 */
export async function computeLiquidityGap(
  exchange: Exchange,
  symbols: string[],
): Promise<number> {
  if (symbols.length === 0) return 0;

  let totalBps = 0;
  let count = 0;

  for (const symbol of symbols) {
    try {
      const spread = await exchange.getSpread(symbol);
      totalBps += spread.spreadPercent * 100; // percent → bps
      count++;
    } catch {
      // Exchange may not support getSpread for this symbol — skip
    }
  }

  return count > 0 ? totalBps / count : 0;
}

/**
 * Compute all circuit breaker live data in parallel.
 * Returns defaults (0) on any failure.
 */
export async function computeCircuitBreakerLiveData(
  exchange: Exchange,
  positions: OpenPosition[],
): Promise<CircuitBreakerLiveData> {
  const symbols = positions.map((p) => p.symbol);

  const [correlationShockPercent, liquidityGapBps] = await Promise.all([
    computeCorrelationShock(exchange, positions).catch((err) => {
      logger.warn("Correlation shock computation failed", { error: (err as Error).message });
      return 0;
    }),
    computeLiquidityGap(exchange, symbols).catch((err) => {
      logger.warn("Liquidity gap computation failed", { error: (err as Error).message });
      return 0;
    }),
  ]);

  return { correlationShockPercent, liquidityGapBps };
}
