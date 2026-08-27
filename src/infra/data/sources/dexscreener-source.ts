/**
 * DexScreener Data Source
 *
 * Read-only onchain pair data via the keyless DexScreener API. Answers ONLY
 * when a chain + a token or pool address is supplied (onchain addressing);
 * symbol-only requests return [] so the manager falls through to a CEX/broker
 * source.
 *
 * IMPORTANT: DexScreener has NO historical OHLCV endpoint — it returns the
 * CURRENT pair snapshot plus recent price-change percentages. fetchOHLC is
 * therefore best-effort SNAPSHOT-only: it synthesizes at most a SINGLE
 * most-recent candle from the live pair data. Primarily a latest-price /
 * liquidity fallback, not a history source (maxHistoricalDays: 0).
 *
 * Docs: https://docs.dexscreener.com/api/reference
 *   base   https://api.dexscreener.com
 *   auth   none (keyless)
 *   GET    /latest/dex/pairs/{chainId}/{pairAddress}
 *   GET    /latest/dex/tokens/{tokenAddress}
 *   GET    /latest/dex/search?q=
 *   pair   { chainId, pairAddress, priceUsd, priceChange {m5,h1,h6,h24},
 *            volume {h24,...}, liquidity {usd,...}, pairCreatedAt, ... }
 */

import type { Candle } from "../../../types/index.ts";
import type { DataSource, DataSourceCapabilities, OHLCParams } from "./types.ts";
import { createModuleLogger } from "../../logger/index.ts";

const logger = createModuleLogger("dexscreener-source");

const BASE_URL = "https://api.dexscreener.com";
const FETCH_TIMEOUT_MS = 10_000;
const HOUR_MS = 60 * 60_000;

/** Gordon chain slug → DexScreener chainId slug. Identity for the common set. */
const CHAIN_TO_SLUG: Record<string, string> = {
  ethereum: "ethereum",
  base: "base",
  arbitrum: "arbitrum",
  polygon: "polygon",
  optimism: "optimism",
  bsc: "bsc",
  avalanche: "avalanche",
  solana: "solana",
};

interface DexScreenerPair {
  chainId?: string;
  pairAddress?: string;
  priceUsd?: string;
  priceChange?: { m5?: number; h1?: number; h6?: number; h24?: number };
  volume?: { h24?: number; h6?: number; h1?: number; m5?: number };
  liquidity?: { usd?: number; base?: number; quote?: number };
  pairCreatedAt?: number;
}

interface DexScreenerResponse {
  pairs?: DexScreenerPair[] | null;
  pair?: DexScreenerPair | null;
}

/**
 * DexScreenerDataSource — read-only onchain pair snapshot. Keyless, so always
 * available. Never throws from fetchOHLC: missing addressing or any fetch
 * error → logger.warn + [].
 */
export class DexScreenerDataSource implements DataSource {
  readonly id = "dexscreener";
  readonly name = "DexScreener";
  readonly priority = 38;
  readonly requiresAuth = false;

  async isAvailable(): Promise<boolean> {
    return true;
  }

  getCapabilities(): DataSourceCapabilities {
    // Snapshot-only: no historical OHLCV endpoint exists. realtime current
    // price/liquidity, zero history.
    return {
      supportedTimeframes: ["1h"],
      maxHistoricalDays: 0,
      realtime: true,
      markets: ["crypto"],
      supportsQuotes: true,
    };
  }

  async fetchOHLC(params: OHLCParams): Promise<Candle[]> {
    const { chain, tokenAddress, poolAddress, startTime, endTime } = params;

    if (!chain || (!poolAddress && !tokenAddress)) {
      logger.warn("DexScreener requires chain + (poolAddress | tokenAddress); returning empty", {
        hasChain: String(Boolean(chain)),
        hasPool: String(Boolean(poolAddress)),
        hasToken: String(Boolean(tokenAddress)),
      });
      return [];
    }

    const slug = CHAIN_TO_SLUG[chain] ?? chain;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

    try {
      const pair = poolAddress
        ? await this.fetchPair(slug, poolAddress, controller.signal)
        : await this.fetchHighestLiquidityPair(slug, tokenAddress!, controller.signal);

      if (!pair) {
        logger.warn("DexScreener returned no pair; returning empty", { chain: slug });
        return [];
      }

      const candle = this.snapshotCandle(pair);
      if (!candle) {
        logger.warn("DexScreener pair missing priceUsd; returning empty", { chain: slug });
        return [];
      }

      // Snapshot candle is the most-recent ~1h; only surface it if it overlaps
      // the requested window.
      if (candle.closeTime < startTime || candle.openTime > endTime) {
        return [];
      }
      return [candle];
    } catch (error) {
      logger.warn("DexScreener fetch error; returning empty", {
        chain: slug,
        error: error instanceof Error ? error.message : String(error),
      });
      return [];
    } finally {
      clearTimeout(timer);
    }
  }

  private async fetchPair(
    slug: string,
    pairAddress: string,
    signal: AbortSignal,
  ): Promise<DexScreenerPair | undefined> {
    const body = await this.getJson(`${BASE_URL}/latest/dex/pairs/${slug}/${pairAddress}`, signal);
    if (!body) return undefined;
    if (body.pair) return body.pair;
    return body.pairs?.[0];
  }

  private async fetchHighestLiquidityPair(
    slug: string,
    tokenAddress: string,
    signal: AbortSignal,
  ): Promise<DexScreenerPair | undefined> {
    const body = await this.getJson(`${BASE_URL}/latest/dex/tokens/${tokenAddress}`, signal);
    const pairs = (body?.pairs ?? []).filter((p) => (p.chainId ?? slug) === slug);
    if (pairs.length === 0) return undefined;
    return pairs.reduce((best, p) =>
      (p.liquidity?.usd ?? 0) > (best.liquidity?.usd ?? 0) ? p : best,
    );
  }

  private async getJson(
    url: string,
    signal: AbortSignal,
  ): Promise<DexScreenerResponse | undefined> {
    const response = await fetch(url, { headers: { accept: "application/json" }, signal });
    if (!response.ok) {
      logger.warn("DexScreener request failed", { status: String(response.status) });
      return undefined;
    }
    return (await response.json()) as DexScreenerResponse;
  }

  /** Build a single most-recent candle from the live pair snapshot. */
  private snapshotCandle(pair: DexScreenerPair): Candle | undefined {
    const close = Number(pair.priceUsd);
    if (!Number.isFinite(close) || close <= 0) return undefined;

    const h1 = pair.priceChange?.h1 ?? 0;
    // open = price one hour ago, backed out of the h1 % change.
    const open = 1 + h1 / 100 !== 0 ? close / (1 + h1 / 100) : close;
    const high = Math.max(open, close);
    const low = Math.min(open, close);
    const volume = pair.volume?.h24 ?? 0;

    const now = Date.now();
    return {
      openTime: now - HOUR_MS,
      open,
      high,
      low,
      close,
      volume,
      closeTime: now,
    };
  }
}
