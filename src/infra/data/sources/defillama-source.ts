/**
 * DefiLlama coins API — keyless onchain price source (read-only).
 *
 * DefiLlama serves a PRICE TIME SERIES per token, not true OHLCV. We fetch the
 * series for the range and bucket points into candles by the requested
 * timeframe: open=first, high=max, low=min, close=last, volume=ALWAYS 0
 * (the feed carries no volume). Candles are synthesized, not exchange OHLCV.
 *
 * Endpoint: GET https://coins.llama.fi/chart/{chain}:{tokenAddress}
 *   ?start=<sec>&span=<n>&period=<1h|1d>&searchWidth=<sec>
 * Response: { coins: { "<coin>": { symbol, decimals, prices: [{ timestamp(sec), price }] } } }
 */
import type { Candle } from "../../../types/index.ts";
import type { DataSource, DataSourceCapabilities, OHLCParams } from "./types.ts";
import { createModuleLogger } from "../../logger/index.ts";

const logger = createModuleLogger("defillama-source");

const BASE = "https://coins.llama.fi";
const TIMEOUT_MS = 10_000;

// params.chain → DefiLlama chain slug. Unknown → undefined (caller returns []).
const CHAIN_SLUGS: Record<string, string> = {
  ethereum: "ethereum",
  eth: "ethereum",
  base: "base",
  arbitrum: "arbitrum",
  arb: "arbitrum",
  polygon: "polygon",
  matic: "polygon",
  optimism: "optimism",
  op: "optimism",
  bsc: "bsc",
  bnb: "bsc",
  avax: "avax",
  avalanche: "avax",
  solana: "solana",
  sol: "solana",
};

// timeframe → DefiLlama period + bucket width (ms).
const TIMEFRAME_MS: Record<string, number> = {
  "1h": 3_600_000,
  "4h": 14_400_000,
  "1d": 86_400_000,
};

interface LlamaChartResponse {
  coins?: Record<string, { prices?: Array<{ timestamp: number; price: number }> }>;
}

export class DefiLlamaDataSource implements DataSource {
  readonly id = "defillama";
  readonly name = "DefiLlama Coins";
  readonly priority = 36;
  readonly requiresAuth = false;

  async isAvailable(): Promise<boolean> {
    return true;
  }

  getCapabilities(): DataSourceCapabilities {
    return {
      // Synthesized candles from a price series — volume is ALWAYS 0.
      supportedTimeframes: ["1h", "4h", "1d"],
      maxHistoricalDays: 3650,
      realtime: false,
      markets: ["crypto"],
    };
  }

  async fetchOHLC(params: OHLCParams): Promise<Candle[]> {
    if (!params.chain || !params.tokenAddress) return [];

    const slug = CHAIN_SLUGS[params.chain.toLowerCase()];
    if (!slug) {
      logger.warn(`unknown chain "${params.chain}" — no DefiLlama slug`);
      return [];
    }

    const bucketMs = TIMEFRAME_MS[params.timeframe] ?? TIMEFRAME_MS["1d"]!;
    const period = bucketMs >= TIMEFRAME_MS["1d"]! ? "1d" : "1h";
    const startSec = Math.floor(params.startTime / 1000);
    const span = Math.max(1, Math.ceil((params.endTime - params.startTime) / bucketMs) + 1);
    const coin = `${slug}:${params.tokenAddress}`;

    const url =
      `${BASE}/chart/${encodeURIComponent(coin)}` +
      `?start=${startSec}&span=${span}&period=${period}&searchWidth=${Math.floor(bucketMs / 1000)}`;

    let json: LlamaChartResponse;
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
      try {
        const res = await fetch(url, { signal: ctrl.signal });
        if (!res.ok) {
          logger.warn(`DefiLlama HTTP ${res.status} for ${coin}`);
          return [];
        }
        json = (await res.json()) as LlamaChartResponse;
      } finally {
        clearTimeout(timer);
      }
    } catch (err) {
      logger.warn(`DefiLlama fetch failed for ${coin}: ${String(err)}`);
      return [];
    }

    const prices = json.coins?.[coin]?.prices;
    if (!prices || prices.length === 0) {
      logger.warn(`DefiLlama returned no prices for ${coin}`);
      return [];
    }

    return this.bucketize(prices, bucketMs, params.startTime, params.endTime);
  }

  /**
   * Bucket a price series into synthesized candles. open=first, high=max,
   * low=min, close=last per bucket; volume=0 (no volume in the feed).
   */
  private bucketize(
    prices: Array<{ timestamp: number; price: number }>,
    bucketMs: number,
    startTime: number,
    endTime: number,
  ): Candle[] {
    const buckets = new Map<number, Candle>();

    for (const p of prices) {
      const t = p.timestamp * 1000;
      if (t < startTime || t > endTime) continue;
      if (!Number.isFinite(p.price)) continue;

      const openTime = Math.floor(t / bucketMs) * bucketMs;
      const existing = buckets.get(openTime);
      if (!existing) {
        buckets.set(openTime, {
          openTime,
          open: p.price,
          high: p.price,
          low: p.price,
          close: p.price,
          volume: 0,
          closeTime: openTime + bucketMs - 1,
        });
      } else {
        existing.high = Math.max(existing.high, p.price);
        existing.low = Math.min(existing.low, p.price);
        existing.close = p.price;
      }
    }

    return [...buckets.values()].sort((a, b) => a.openTime - b.openTime);
  }
}
