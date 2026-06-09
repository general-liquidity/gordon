/**
 * Birdeye Data Source
 *
 * Read-only onchain OHLCV via the Birdeye DeFi API. Answers ONLY when a
 * chain + token address is supplied (onchain addressing); symbol-only requests
 * return [] so the manager falls through to a CEX/broker source.
 *
 * Docs: https://docs.birdeye.so/reference/get-defi-ohlcv
 *   base   https://public-api.birdeye.so
 *   auth   X-API-KEY: <key>
 *   chain  x-chain: <solana|ethereum|base|arbitrum|polygon|optimism|bsc|avalanche|...>
 *   GET    /defi/ohlcv?address=&type=&time_from=&time_to=   (time_* in seconds)
 *   resp   { data: { items: [{ unixTime, o, h, l, c, v }, ...] } }
 */

import type { Candle } from "../../../types/index.ts";
import type { DataSource, DataSourceCapabilities, OHLCParams } from "./types.ts";
import { createModuleLogger } from "../../logger/index.ts";

const logger = createModuleLogger("birdeye-source");

const BASE_URL = "https://public-api.birdeye.so";
const FETCH_TIMEOUT_MS = 10_000;

/** Gordon timeframe → Birdeye `type` interval code. */
const TIMEFRAME_TO_TYPE: Record<string, string> = {
  "1m": "1m",
  "3m": "3m",
  "5m": "5m",
  "15m": "15m",
  "30m": "30m",
  "1h": "1H",
  "2h": "2H",
  "4h": "4H",
  "6h": "6H",
  "8h": "8H",
  "12h": "12H",
  "1d": "1D",
  "3d": "3D",
  "1w": "1W",
};

/** Interval length in ms, used to derive closeTime. */
const TIMEFRAME_MS: Record<string, number> = {
  "1m": 60_000,
  "3m": 3 * 60_000,
  "5m": 5 * 60_000,
  "15m": 15 * 60_000,
  "30m": 30 * 60_000,
  "1h": 60 * 60_000,
  "2h": 2 * 60 * 60_000,
  "4h": 4 * 60 * 60_000,
  "6h": 6 * 60 * 60_000,
  "8h": 8 * 60 * 60_000,
  "12h": 12 * 60 * 60_000,
  "1d": 24 * 60 * 60_000,
  "3d": 3 * 24 * 60 * 60_000,
  "1w": 7 * 24 * 60 * 60_000,
};

interface BirdeyeOhlcvItem {
  unixTime: number;
  o: number;
  h: number;
  l: number;
  c: number;
  v: number;
}

interface BirdeyeOhlcvResponse {
  data?: { items?: BirdeyeOhlcvItem[] };
}

/**
 * BirdeyeDataSource — read-only onchain DEX/token OHLCV. Solana-strong with
 * broad multichain coverage. Requires BIRDEYE_API_KEY. Never throws from
 * fetchOHLC: missing addressing or any fetch error → [].
 */
export class BirdeyeDataSource implements DataSource {
  readonly id = "birdeye";
  readonly name = "Birdeye";
  readonly priority = 32;
  readonly requiresAuth = true;

  async isAvailable(): Promise<boolean> {
    return Boolean(process.env.BIRDEYE_API_KEY);
  }

  getCapabilities(): DataSourceCapabilities {
    return {
      supportedTimeframes: ["1m", "5m", "15m", "1h", "4h", "1d"],
      maxHistoricalDays: 365,
      realtime: true,
      markets: ["crypto"],
    };
  }

  async fetchOHLC(params: OHLCParams): Promise<Candle[]> {
    const { chain, tokenAddress, timeframe, startTime, endTime } = params;

    if (!chain || !tokenAddress) {
      logger.warn("Birdeye requires chain + tokenAddress; returning empty", {
        hasChain: String(Boolean(chain)),
        hasToken: String(Boolean(tokenAddress)),
      });
      return [];
    }

    const apiKey = process.env.BIRDEYE_API_KEY;
    if (!apiKey) {
      logger.warn("BIRDEYE_API_KEY not set; returning empty");
      return [];
    }

    const type = TIMEFRAME_TO_TYPE[timeframe] ?? "1H";
    const intervalMs = TIMEFRAME_MS[timeframe] ?? TIMEFRAME_MS["1h"]!;

    const url = new URL("/defi/ohlcv", BASE_URL);
    url.searchParams.set("address", tokenAddress);
    url.searchParams.set("type", type);
    url.searchParams.set("time_from", Math.floor(startTime / 1000).toString());
    url.searchParams.set("time_to", Math.floor(endTime / 1000).toString());

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

    try {
      const response = await fetch(url.toString(), {
        headers: {
          "X-API-KEY": apiKey,
          "x-chain": chain,
          accept: "application/json",
        },
        signal: controller.signal,
      });

      if (!response.ok) {
        logger.warn("Birdeye OHLCV request failed", {
          status: String(response.status),
          chain,
        });
        return [];
      }

      const body = (await response.json()) as BirdeyeOhlcvResponse;
      const items = body.data?.items ?? [];

      const candles: Candle[] = items.map((item) => {
        const openTime = item.unixTime * 1000;
        return {
          openTime,
          open: item.o,
          high: item.h,
          low: item.l,
          close: item.c,
          volume: item.v,
          closeTime: openTime + intervalMs - 1,
        };
      });

      return candles
        .filter((c) => c.openTime >= startTime && c.openTime <= endTime)
        .sort((a, b) => a.openTime - b.openTime);
    } catch (error) {
      logger.warn("Birdeye OHLCV fetch error; returning empty", {
        chain,
        error: error instanceof Error ? error.message : String(error),
      });
      return [];
    } finally {
      clearTimeout(timer);
    }
  }
}
