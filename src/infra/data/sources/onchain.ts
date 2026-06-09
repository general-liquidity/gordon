/**
 * Onchain DEX/pool price DataSources.
 *
 * Read-only onchain market data, no wallet. Each is a standard `DataSource`
 * (priority + fallback via the DataSourceManager) that answers ONLY when the
 * caller supplies `chain` + a token/pool address on OHLCParams — otherwise it
 * returns [] and the manager falls through to a symbol-based (CEX) source.
 *
 * Auth-gated sources (1inch / Birdeye / Codex) self-skip via `isAvailable()`
 * when their API key is unset; CoinGecko-Onchain / DefiLlama / DexScreener are
 * keyless. Registering all six is therefore always safe.
 */

import type { DataSource } from "./types.ts";
import type { DataSourceManager } from "./manager.ts";
import { CoinGeckoOnchainDataSource } from "./coingecko-onchain-source.ts";
import { BirdeyeDataSource } from "./birdeye-source.ts";
import { CodexDataSource } from "./codex-source.ts";
import { DefiLlamaDataSource } from "./defillama-source.ts";
import { DexScreenerDataSource } from "./dexscreener-source.ts";
import { OneInchDataSource } from "./oneinch-source.ts";

export {
  CoinGeckoOnchainDataSource,
  BirdeyeDataSource,
  CodexDataSource,
  DefiLlamaDataSource,
  DexScreenerDataSource,
  OneInchDataSource,
};

/** All onchain price DataSources, in registration (priority) order. */
export function onchainDataSources(): DataSource[] {
  return [
    new CoinGeckoOnchainDataSource(),
    new BirdeyeDataSource(),
    new CodexDataSource(),
    new DefiLlamaDataSource(),
    new DexScreenerDataSource(),
    new OneInchDataSource(),
  ];
}

/** Register every onchain price source on a manager (one call). */
export function registerOnchainDataSources(manager: DataSourceManager): void {
  for (const source of onchainDataSources()) {
    manager.register(source);
  }
}
