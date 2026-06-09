/**
 * CoinGecko Onchain (GeckoTerminal) Data Source
 *
 * Read-only onchain DEX/pool OHLCV via the GeckoTerminal public API
 * (https://api.geckoterminal.com/api/v2, keyless) or the CoinGecko Pro onchain
 * endpoint (https://pro-api.coingecko.com/api/v3/onchain, x-cg-pro-api-key)
 * when COINGECKO_API_KEY is set.
 *
 * Answers ONLY when params.chain + a pool/token address is supplied; otherwise
 * returns [] so the manager falls through to a symbol-based source. Never throws.
 */

import type { Candle } from "../../../types/index.ts";
import type { DataSource, DataSourceCapabilities, OHLCParams } from "./types.ts";
import { createModuleLogger } from "../../logger/index.ts";

const logger = createModuleLogger("coingecko-onchain-source");

// ============================================================================
// Constants
// ============================================================================

const FREE_BASE = "https://api.geckoterminal.com/api/v2";
const PRO_BASE = "https://pro-api.coingecko.com/api/v3/onchain";
const TIMEOUT_MS = 10_000;

/** Gordon chain name → GeckoTerminal network slug. Unknown → unsupported. */
const NETWORK_SLUGS: Record<string, string> = {
  ethereum: "eth",
  eth: "eth",
  base: "base",
  arbitrum: "arbitrum",
  polygon: "polygon_pos",
  polygon_pos: "polygon_pos",
  solana: "solana",
  bsc: "bsc",
  optimism: "optimism",
  avalanche: "avax",
  avax: "avax",
};

/** Gordon timeframe → GeckoTerminal { timeframe path, aggregate }. */
const TIMEFRAME_MAP: Record<string, { tf: string; aggregate: number }> = {
  "1m": { tf: "minute", aggregate: 1 },
  "5m": { tf: "minute", aggregate: 5 },
  "15m": { tf: "minute", aggregate: 15 },
  "1h": { tf: "hour", aggregate: 1 },
  "4h": { tf: "hour", aggregate: 4 },
  "1d": { tf: "day", aggregate: 1 },
};

/** Timeframe → milliseconds (for closeTime + range math). */
const TIMEFRAME_MS: Record<string, number> = {
  "1m": 60_000,
  "5m": 5 * 60_000,
  "15m": 15 * 60_000,
  "1h": 60 * 60_000,
  "4h": 4 * 60 * 60_000,
  "1d": 24 * 60 * 60_000,
};

const SUPPORTED_TIMEFRAMES = ["1m", "5m", "15m", "1h", "4h", "1d"];

// ============================================================================
// CoinGeckoOnchainDataSource Class
// ============================================================================

export class CoinGeckoOnchainDataSource implements DataSource {
  readonly id = "coingecko-onchain";
  readonly name = "CoinGecko Onchain (GeckoTerminal)";
  readonly priority = 30;
  readonly requiresAuth = false;

  private readonly apiKey = process.env.COINGECKO_API_KEY;

  async isAvailable(): Promise<boolean> {
    return true;
  }

  getCapabilities(): DataSourceCapabilities {
    return {
      supportedTimeframes: [...SUPPORTED_TIMEFRAMES],
      // GeckoTerminal serves up to ~6 months of hourly / a few days of minute history.
      maxHistoricalDays: 180,
      realtime: true,
      markets: ["crypto"],
    };
  }

  async fetchOHLC(params: OHLCParams): Promise<Candle[]> {
    const { chain, timeframe, startTime, endTime, poolAddress, tokenAddress } = params;

    if (!chain) {
      logger.warn("No chain supplied — onchain source declines", { symbol: params.symbol });
      return [];
    }
    if (!poolAddress && !tokenAddress) {
      logger.warn("No pool or token address supplied — onchain source declines", { chain });
      return [];
    }

    const network = NETWORK_SLUGS[chain.toLowerCase()];
    if (!network) {
      logger.warn("Unsupported chain for GeckoTerminal", { chain });
      return [];
    }

    const tf = TIMEFRAME_MAP[timeframe];
    if (!tf) {
      logger.warn("Unsupported timeframe for onchain source", { timeframe });
      return [];
    }

    try {
      const pool = poolAddress ?? (await this.resolveTopPool(network, tokenAddress!));
      if (!pool) {
        logger.warn("Could not resolve a pool for token", { chain, tokenAddress });
        return [];
      }

      const intervalMs = TIMEFRAME_MS[timeframe]!;
      const url = new URL(`${this.base()}/networks/${network}/pools/${pool}/ohlcv/${tf.tf}`);
      url.searchParams.set("aggregate", String(tf.aggregate));
      url.searchParams.set("before_timestamp", String(Math.ceil(endTime / 1000)));
      url.searchParams.set("limit", "1000");

      const json = await this.get<{
        data?: { attributes?: { ohlcv_list?: Array<[number, number, number, number, number, number]> } };
      }>(url.toString());

      const list = json?.data?.attributes?.ohlcv_list ?? [];
      const candles: Candle[] = list.map(([ts, o, h, l, c, v]) => {
        const openTime = ts * 1000;
        return {
          openTime,
          open: o,
          high: h,
          low: l,
          close: c,
          volume: v,
          closeTime: openTime + intervalMs - 1,
        };
      });

      return candles
        .filter((candle) => candle.openTime >= startTime && candle.openTime <= endTime)
        .sort((a, b) => a.openTime - b.openTime);
    } catch (error) {
      logger.warn("Onchain OHLCV fetch failed", {
        chain,
        timeframe,
        error: error instanceof Error ? error.message : String(error),
      });
      return [];
    }
  }

  /** Resolve the highest-liquidity pool for a token (by reserve_in_usd). */
  private async resolveTopPool(network: string, tokenAddress: string): Promise<string | undefined> {
    const url = `${this.base()}/networks/${network}/tokens/${tokenAddress}/pools`;
    const json = await this.get<{
      data?: Array<{ attributes?: { address?: string; reserve_in_usd?: string } }>;
    }>(url);

    const pools = json?.data ?? [];
    let best: { address: string; reserve: number } | undefined;
    for (const p of pools) {
      const address = p.attributes?.address;
      if (!address) continue;
      const reserve = parseFloat(p.attributes?.reserve_in_usd ?? "0") || 0;
      if (!best || reserve > best.reserve) best = { address, reserve };
    }
    return best?.address;
  }

  private base(): string {
    return this.apiKey ? PRO_BASE : FREE_BASE;
  }

  private async get<T>(url: string): Promise<T> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      const headers: Record<string, string> = { accept: "application/json" };
      if (this.apiKey) headers["x-cg-pro-api-key"] = this.apiKey;

      const response = await fetch(url, { headers, signal: controller.signal });
      if (!response.ok) {
        throw new Error(`HTTP ${response.status} ${response.statusText}`);
      }
      return (await response.json()) as T;
    } finally {
      clearTimeout(timer);
    }
  }
}
