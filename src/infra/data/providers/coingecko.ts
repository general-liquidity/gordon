/**
 * CoinGecko Client
 *
 * Free API client for CoinGecko price data.
 * No API key required for basic endpoints.
 * Rate limit: ~10-30 calls/minute on free tier.
 */

import { createModuleLogger } from "../../logger/index.ts";

const logger = createModuleLogger("coingecko");

// ============================================================================
// Types
// ============================================================================

export interface CoinGeckoPrice {
  usd: number;
  usd_24h_vol: number;
  usd_24h_change: number;
}

interface CoinGeckoSimplePriceResponse {
  [coinId: string]: {
    usd?: number;
    usd_24h_vol?: number;
    usd_24h_change?: number;
  };
}

// ============================================================================
// Symbol-to-CoinGecko-ID mapping
// ============================================================================

const COIN_ID_MAP: Record<string, string> = {
  BTC: "bitcoin",
  ETH: "ethereum",
  SOL: "solana",
  BNB: "binancecoin",
  XRP: "ripple",
  ADA: "cardano",
  DOGE: "dogecoin",
  DOT: "polkadot",
  MATIC: "matic-network",
  AVAX: "avalanche-2",
  UNI: "uniswap",
  LINK: "chainlink",
  LTC: "litecoin",
  BCH: "bitcoin-cash",
  ATOM: "cosmos",
  XLM: "stellar",
  ALGO: "algorand",
  VET: "vechain",
  ICP: "internet-computer",
  FIL: "filecoin",
  TRX: "tron",
  ETC: "ethereum-classic",
  HBAR: "hedera-hashgraph",
  NEAR: "near",
  APT: "aptos",
  ARB: "arbitrum",
  OP: "optimism",
  SUI: "sui",
  SEI: "sei-network",
  PEPE: "pepe",
  USDC: "usd-coin",
  USDT: "tether",
  DAI: "dai",
  SHIB: "shiba-inu",
  TON: "the-open-network",
  AAVE: "aave",
  MKR: "maker",
  CRV: "curve-dao-token",
  RENDER: "render-token",
  INJ: "injective-protocol",
  FTM: "fantom",
  SAND: "the-sandbox",
  MANA: "decentraland",
  AXS: "axie-infinity",
};

const BASE_URL = "https://api.coingecko.com/api/v3";
const USER_AGENT = "gordon/0.8";

// ============================================================================
// Rate Limiter
// ============================================================================

class SimpleRateLimiter {
  private timestamps: number[] = [];
  private readonly maxCalls: number;
  private readonly windowMs: number;

  constructor(maxCalls: number, windowMs: number) {
    this.maxCalls = maxCalls;
    this.windowMs = windowMs;
  }

  async waitIfNeeded(): Promise<void> {
    const now = Date.now();
    this.timestamps = this.timestamps.filter((t) => now - t < this.windowMs);

    if (this.timestamps.length >= this.maxCalls) {
      const oldest = this.timestamps[0]!;
      const waitMs = this.windowMs - (now - oldest) + 50;
      logger.debug("Rate limit reached, waiting", { waitMs });
      await new Promise((resolve) => setTimeout(resolve, waitMs));
    }

    this.timestamps.push(Date.now());
  }
}

// ============================================================================
// CoinGecko Client
// ============================================================================

export class CoinGeckoClient {
  private rateLimiter: SimpleRateLimiter;

  constructor() {
    // Free tier: ~10-30 calls/minute; be conservative
    this.rateLimiter = new SimpleRateLimiter(10, 60_000);
  }

  /**
   * Resolve a ticker symbol to a CoinGecko coin ID.
   * Returns null if the symbol is not in the map.
   */
  resolveCoinId(symbol: string): string | null {
    const upper = symbol.toUpperCase().replace(/USDT$|USD$|BUSD$/, "");
    return COIN_ID_MAP[upper] ?? null;
  }

  /**
   * Get price data for a single symbol.
   */
  async getPrice(symbol: string): Promise<CoinGeckoPrice | null> {
    const coinId = this.resolveCoinId(symbol);
    if (!coinId) {
      logger.debug("No CoinGecko ID mapping for symbol", { symbol });
      return null;
    }

    const prices = await this.fetchSimplePrice([coinId]);
    const data = prices.get(coinId);
    return data ?? null;
  }

  /**
   * Get price data for multiple symbols in a single API call.
   */
  async getPrices(symbols: string[]): Promise<Map<string, CoinGeckoPrice>> {
    const result = new Map<string, CoinGeckoPrice>();

    // Resolve symbols to coin IDs
    const idToSymbol = new Map<string, string>();
    const coinIds: string[] = [];
    for (const symbol of symbols) {
      const coinId = this.resolveCoinId(symbol);
      if (coinId) {
        idToSymbol.set(coinId, symbol);
        coinIds.push(coinId);
      }
    }

    if (coinIds.length === 0) {
      return result;
    }

    const priceData = await this.fetchSimplePrice(coinIds);

    for (const [coinId, price] of priceData) {
      const symbol = idToSymbol.get(coinId);
      if (symbol) {
        result.set(symbol, price);
      }
    }

    return result;
  }

  /**
   * Internal: call the /simple/price endpoint.
   */
  private async fetchSimplePrice(
    coinIds: string[]
  ): Promise<Map<string, CoinGeckoPrice>> {
    const result = new Map<string, CoinGeckoPrice>();

    if (coinIds.length === 0) {
      return result;
    }

    await this.rateLimiter.waitIfNeeded();

    const ids = coinIds.join(",");
    const url = `${BASE_URL}/simple/price?ids=${ids}&vs_currencies=usd&include_24hr_vol=true&include_24hr_change=true`;

    try {
      const response = await fetch(url, {
        headers: {
          "User-Agent": USER_AGENT,
          Accept: "application/json",
        },
      });

      if (!response.ok) {
        logger.warn("CoinGecko API error", {
          status: response.status,
          statusText: response.statusText,
        });
        return result;
      }

      const data = (await response.json()) as CoinGeckoSimplePriceResponse;

      for (const coinId of coinIds) {
        const entry = data[coinId];
        if (entry && entry.usd !== undefined) {
          result.set(coinId, {
            usd: entry.usd,
            usd_24h_vol: entry.usd_24h_vol ?? 0,
            usd_24h_change: entry.usd_24h_change ?? 0,
          });
        }
      }
    } catch (error) {
      logger.warn("CoinGecko fetch failed", {
        error: error instanceof Error ? error.message : String(error),
      });
    }

    return result;
  }
}

// ============================================================================
// Singleton
// ============================================================================

let defaultClient: CoinGeckoClient | null = null;

export function getCoinGeckoClient(): CoinGeckoClient {
  if (!defaultClient) {
    defaultClient = new CoinGeckoClient();
  }
  return defaultClient;
}
