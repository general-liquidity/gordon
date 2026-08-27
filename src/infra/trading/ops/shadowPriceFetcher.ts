/**
 * Shadow market price resolver — CCXT public venues + onchain fallbacks.
 *
 * Replaces the legacy Binance-native adapter path. Tries CCXT public
 * exchanges first, then DefiLlama / DexScreener for onchain-only symbols.
 */

import { createAllPublicExchanges } from "../../exchange/publicFactory.ts";
import { toCcxtSymbol } from "../../exchange/adapters/ccxt-adapter.ts";
import { createModuleLogger } from "../../logger/index.ts";

const logger = createModuleLogger("shadow-price-fetcher");

const DEFILLAMA_BASE = "https://coins.llama.fi";
const DEXSCREENER_BASE = "https://api.dexscreener.com";
const FETCH_TIMEOUT_MS = 8_000;

/** Base asset → DefiLlama / CoinGecko coin id (keyless current-price API). */
const COINGECKO_IDS: Record<string, string> = {
  BTC: "bitcoin",
  ETH: "ethereum",
  SOL: "solana",
  BNB: "binancecoin",
  XRP: "ripple",
  ADA: "cardano",
  DOGE: "dogecoin",
  AVAX: "avalanche-2",
  LINK: "chainlink",
  DOT: "polkadot",
  MATIC: "matic-network",
  POL: "matic-network",
  LTC: "litecoin",
  UNI: "uniswap",
  ATOM: "cosmos",
  ARB: "arbitrum",
  OP: "optimism",
};

export function parseBaseAsset(symbol: string): string {
  const normalized = symbol.trim().toUpperCase();
  if (normalized.includes("/")) return normalized.split("/")[0] ?? normalized;
  for (const quote of ["USDT", "USDC", "USD", "BUSD", "EUR", "GBP", "BTC", "ETH"]) {
    if (normalized.endsWith(quote) && normalized.length > quote.length) {
      return normalized.slice(0, -quote.length);
    }
  }
  return normalized;
}

async function fetchJson<T>(url: string): Promise<T | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** Try CCXT public adapters (binance, coinbase, kraken, …). */
export async function fetchCcxtPublicPrice(symbol: string): Promise<number | null> {
  const ccxtSymbol = toCcxtSymbol(symbol);
  const exchanges = createAllPublicExchanges();
  for (const exchange of exchanges) {
    try {
      const price = await exchange.getPrice(ccxtSymbol);
      if (Number.isFinite(price) && price > 0) return price;
    } catch {
      // try next venue
    }
  }
  return null;
}

/** DefiLlama keyless current price (onchain + CEX index). */
export async function fetchDefiLlamaPrice(symbol: string): Promise<number | null> {
  const base = parseBaseAsset(symbol);
  const coinId = COINGECKO_IDS[base];
  if (!coinId) return null;

  const url = `${DEFILLAMA_BASE}/prices/current/coingecko:${coinId}`;
  const body = await fetchJson<{ coins?: Record<string, { price?: number }> }>(url);
  const key = `coingecko:${coinId}`;
  const price = body?.coins?.[key]?.price;
  return typeof price === "number" && price > 0 ? price : null;
}

/** DexScreener symbol search — useful for long-tail onchain tokens. */
export async function fetchDexScreenerSearchPrice(symbol: string): Promise<number | null> {
  const base = parseBaseAsset(symbol);
  const url = `${DEXSCREENER_BASE}/latest/dex/search?q=${encodeURIComponent(base)}`;
  const body = await fetchJson<{ pairs?: Array<{ priceUsd?: string }> }>(url);
  const pairs = body?.pairs ?? [];
  for (const pair of pairs) {
    const price = Number(pair.priceUsd);
    if (Number.isFinite(price) && price > 0) return price;
  }
  return null;
}

/**
 * Best-effort shadow reconciliation price: CCXT → DefiLlama → DexScreener.
 */
export async function fetchShadowMarketPrice(symbol: string): Promise<number | null> {
  const ccxtPrice = await fetchCcxtPublicPrice(symbol);
  if (ccxtPrice !== null) return ccxtPrice;

  const llamaPrice = await fetchDefiLlamaPrice(symbol);
  if (llamaPrice !== null) return llamaPrice;

  const dexPrice = await fetchDexScreenerSearchPrice(symbol);
  if (dexPrice !== null) return dexPrice;

  logger.debug("shadow price fetch exhausted all sources", { symbol });
  return null;
}
