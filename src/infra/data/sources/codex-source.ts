/**
 * Codex (formerly Defined.fi) onchain price DataSource — read-only OHLCV.
 *
 * GraphQL `getBars` over a DEX token, addressed as "<tokenAddress>:<networkId>".
 * Answers only when an onchain chain + token address is supplied; otherwise []
 * so the manager falls through to a symbol-based source.
 */

import type { Candle } from "../../../types/index.ts";
import type { DataSource, DataSourceCapabilities, OHLCParams } from "./types.ts";
import { createModuleLogger } from "../../logger/index.ts";

const logger = createModuleLogger("codex-source");

const ENDPOINT = "https://graph.codex.io/graphql";
const REQUEST_TIMEOUT_MS = 10_000;

/** params.timeframe → Codex resolution code. */
const RESOLUTION: Record<string, string> = {
  "1m": "1",
  "5m": "5",
  "15m": "15",
  "1h": "60",
  "4h": "240",
  "1d": "1D",
};

/** Interval length in ms, for deriving closeTime. */
const INTERVAL_MS: Record<string, number> = {
  "1m": 60_000,
  "5m": 300_000,
  "15m": 900_000,
  "1h": 3_600_000,
  "4h": 14_400_000,
  "1d": 86_400_000,
};

/** params.chain → Codex numeric networkId. */
const NETWORK_ID: Record<string, number> = {
  ethereum: 1,
  base: 8453,
  arbitrum: 42161,
  polygon: 137,
  optimism: 10,
  bsc: 56,
  avalanche: 43114,
  solana: 1399811149,
};

const GET_BARS_QUERY = `query GetBars($symbol: String!, $from: Int!, $to: Int!, $resolution: String!) {
  getBars(symbol: $symbol, from: $from, to: $to, resolution: $resolution, removeEmptyBars: true) {
    o
    h
    l
    c
    volume
    t
  }
}`;

interface BarsResponse {
  o?: Array<number | null>;
  h?: Array<number | null>;
  l?: Array<number | null>;
  c?: Array<number | null>;
  volume?: Array<string | null>;
  t?: Array<number | null>;
}

function apiKey(): string | undefined {
  return process.env.CODEX_API_KEY || process.env.DEFINED_API_KEY;
}

export class CodexDataSource implements DataSource {
  readonly id = "codex";
  readonly name = "Codex (Defined.fi)";
  readonly priority = 34;
  readonly requiresAuth = true;

  async isAvailable(): Promise<boolean> {
    return Boolean(apiKey());
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
    if (!params.chain || !params.tokenAddress) return [];

    const networkId = NETWORK_ID[params.chain.toLowerCase()];
    if (networkId === undefined) {
      logger.warn(`unknown chain: ${params.chain}`);
      return [];
    }

    const resolution = RESOLUTION[params.timeframe];
    const intervalMs = INTERVAL_MS[params.timeframe];
    if (!resolution || !intervalMs) {
      logger.warn(`unsupported timeframe: ${params.timeframe}`);
      return [];
    }

    const key = apiKey();
    if (!key) return [];

    const symbol = `${params.tokenAddress}:${networkId}`;
    const variables = {
      symbol,
      from: Math.floor(params.startTime / 1000),
      to: Math.floor(params.endTime / 1000),
      resolution,
    };

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    let bars: BarsResponse | undefined;
    try {
      const res = await fetch(ENDPOINT, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: key,
        },
        body: JSON.stringify({ query: GET_BARS_QUERY, variables }),
        signal: controller.signal,
      });
      if (!res.ok) {
        logger.warn(`http ${res.status} for ${symbol}`);
        return [];
      }
      const json = (await res.json()) as { data?: { getBars?: BarsResponse }; errors?: unknown };
      if (json.errors) {
        logger.warn(`graphql errors for ${symbol}: ${JSON.stringify(json.errors)}`);
        return [];
      }
      bars = json.data?.getBars;
    } catch (err) {
      logger.warn(
        `fetch failed for ${symbol}: ${err instanceof Error ? err.message : String(err)}`,
      );
      return [];
    } finally {
      clearTimeout(timer);
    }

    if (!bars?.t) return [];

    const { t, o, h, l, c, volume } = bars;
    const candles: Candle[] = [];
    for (let i = 0; i < t.length; i++) {
      const ts = t[i];
      const open = o?.[i];
      const high = h?.[i];
      const low = l?.[i];
      const close = c?.[i];
      if (ts == null || open == null || high == null || low == null || close == null) {
        continue;
      }
      const openTime = ts * 1000;
      if (openTime < params.startTime || openTime > params.endTime) continue;
      candles.push({
        openTime,
        open,
        high,
        low,
        close,
        volume: Number(volume?.[i] ?? 0),
        closeTime: openTime + intervalMs - 1,
      });
    }
    return candles;
  }
}
