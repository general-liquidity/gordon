/**
 * 1inch Onchain Data Source (read-only)
 *
 * Read-only OHLC over the 1inch Charts API. Onchain-addressed: answers ONLY when
 * a chain + base token address are supplied, otherwise returns [] so the manager
 * falls through to a symbol-based (CEX/broker) source.
 *
 * Docs: https://portal.1inch.dev/documentation/apis/charts/introduction
 * Base: https://api.1inch.dev — auth: `Authorization: Bearer <ONEINCH_API_KEY>`.
 * Candle endpoint: GET /charts/v1.0/chart/aggregated/candle/{token0}/{token1}/{seconds}/{chainId}
 *   → { data: [{ time:<sec>, open, high, low, close }] }   (no volume — DEX swap-derived)
 * Line endpoint (fallback): GET /charts/v1.0/chart/line/{token0}/{token1}/{period}/{chainId}
 *   → { data: [{ time:<sec>, value }] }                    (price line → synthesized flat OHLC)
 *
 * The 1inch candle endpoint carries no volume field, so volume is reported as 0.
 */

import type { Candle } from "../../../types/index.ts";
import type { DataSource, DataSourceCapabilities, OHLCParams } from "./types.ts";
import { createModuleLogger } from "../../logger/index.ts";

const logger = createModuleLogger("oneinch-source");

const BASE_URL = "https://api.1inch.dev";
const FETCH_TIMEOUT_MS = 10_000;

/** chain name → 1inch numeric chainId. Unknown chain → not addressable. */
const CHAIN_IDS: Record<string, number> = {
  ethereum: 1,
  base: 8453,
  arbitrum: 42161,
  polygon: 137,
  optimism: 10,
  bnb: 56,
  bsc: 56,
  avalanche: 43114,
};

/** Per-chain default quote token (the chain's USD stable) when none supplied. */
const DEFAULT_QUOTE: Record<number, string> = {
  1: "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48", // USDC (ethereum)
  8453: "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913", // USDC (base)
  42161: "0xaf88d065e77c8cc2239327c5edb3a432268e5831", // USDC (arbitrum)
  137: "0x3c499c542cef5e3811e1192ce70d8cc03d5c3359", // USDC (polygon)
  10: "0x0b2c639c533813f4aa9d7837caf62653d097ff85", // USDC (optimism)
  56: "0x8ac76a51cc950d9822d68b83fe1ad97b32cd580d", // USDC (bnb)
  43114: "0xb97ef9ef8734c71904d8002f8b6bc66dd9c48a6e", // USDC (avalanche)
};

/** 1inch candle `seconds` granularities. We snap the requested timeframe to the nearest. */
const TIMEFRAME_SECONDS: Record<string, number> = {
  "5m": 300,
  "15m": 900,
  "1h": 3600,
  "4h": 14400,
  "1d": 86400,
  "1w": 604800,
};

interface ChartPoint {
  time: number; // seconds
  open?: number;
  high?: number;
  low?: number;
  close?: number;
  value?: number; // line endpoint
}

export class OneInchDataSource implements DataSource {
  readonly id = "oneinch";
  readonly name = "1inch Charts";
  readonly priority = 40;
  readonly requiresAuth = true;

  async isAvailable(): Promise<boolean> {
    return Boolean(process.env.ONEINCH_API_KEY);
  }

  getCapabilities(): DataSourceCapabilities {
    return {
      supportedTimeframes: Object.keys(TIMEFRAME_SECONDS),
      maxHistoricalDays: 365,
      realtime: false,
      markets: ["crypto"],
    };
  }

  async fetchOHLC(params: OHLCParams): Promise<Candle[]> {
    const { chain, tokenAddress, timeframe, startTime, endTime } = params;

    if (!chain || !tokenAddress) return [];

    const chainId = CHAIN_IDS[chain.toLowerCase()];
    if (!chainId) {
      logger.warn("Unsupported chain", { chain });
      return [];
    }

    const quote = params.quoteTokenAddress ?? DEFAULT_QUOTE[chainId];
    if (!quote) return [];

    const seconds = TIMEFRAME_SECONDS[timeframe] ?? TIMEFRAME_SECONDS["1h"]!;
    const key = process.env.ONEINCH_API_KEY;
    if (!key) return [];

    try {
      const candleUrl = `${BASE_URL}/charts/v1.0/chart/aggregated/candle/${tokenAddress}/${quote}/${seconds}/${chainId}`;
      let points = await this.fetchPoints(candleUrl, key);

      // Fallback: candle endpoint empty → line endpoint, synthesize flat OHLC.
      if (points.length === 0) {
        const lineUrl = `${BASE_URL}/charts/v1.0/chart/line/${tokenAddress}/${quote}/${seconds}/${chainId}`;
        points = await this.fetchPoints(lineUrl, key);
      }

      const candles = points
        .map((p) => this.toCandle(p, seconds))
        .filter((c): c is Candle => c !== null)
        .filter((c) => c.openTime >= startTime && c.openTime <= endTime)
        .sort((a, b) => a.openTime - b.openTime);

      return candles;
    } catch (error) {
      logger.warn("1inch chart fetch failed", {
        chain,
        tokenAddress,
        error: error instanceof Error ? error.message : String(error),
      });
      return [];
    }
  }

  private async fetchPoints(url: string, key: string): Promise<ChartPoint[]> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    try {
      const res = await fetch(url, {
        headers: { Authorization: `Bearer ${key}`, Accept: "application/json" },
        signal: controller.signal,
      });
      if (!res.ok) {
        logger.warn("1inch API non-OK", { status: String(res.status), url });
        return [];
      }
      const body = (await res.json()) as { data?: ChartPoint[] };
      return Array.isArray(body.data) ? body.data : [];
    } finally {
      clearTimeout(timer);
    }
  }

  /** Map a chart point to a Candle. Line points (only `value`) become flat OHLC. */
  private toCandle(p: ChartPoint, seconds: number): Candle | null {
    if (typeof p.time !== "number") return null;
    const openTime = p.time * 1000;

    const close = p.close ?? p.value;
    if (typeof close !== "number") return null;

    const open = p.open ?? close;
    const high = p.high ?? Math.max(open, close);
    const low = p.low ?? Math.min(open, close);

    return {
      openTime,
      open,
      high,
      low,
      close,
      volume: 0, // 1inch chart points carry no volume
      closeTime: openTime + seconds * 1000 - 1,
    };
  }
}
