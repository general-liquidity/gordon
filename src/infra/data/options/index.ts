/**
 * Options-chain data feed.
 *
 * Provider-agnostic, capability-routed access to a live options chain (strike ×
 * expiry open interest + per-contract IV + spot) for an underlying. Today the
 * sole provider is Deribit (BTC/ETH, v2 public REST, no auth); the manager
 * supports priority/fallback so more venues can be added. Read-only — this is a
 * market-data feed, never an order path.
 *
 * Powers `dealerGreeksExposure.ts`: a snapshot's `contracts` are already in the
 * exact `OptionContract` shape `computeDealerGreeksExposure` consumes.
 *
 * @example
 * import { fetchOptionsChain } from "./infra/data/options";
 * import { computeDealerGreeksExposure } from "./infra/trading/quant/dealerGreeksExposure.ts";
 *
 * const chain = await fetchOptionsChain("BTC");
 * const exposure = computeDealerGreeksExposure(chain.contracts, {
 *   spot: chain.spotUsd,
 *   rate: 0,
 *   contractMultiplier: 1,
 * });
 */

import { DeribitOptionsProvider } from "./deribit.ts";
import {
  OptionsChainManager,
  getOptionsChainManager,
} from "./manager.ts";
import type { OptionsChainProvider, OptionsChainSnapshot } from "./types.ts";

export type {
  OptionContract,
  OptionsChainCapabilities,
  OptionsChainProvider,
  OptionsChainSnapshot,
} from "./types.ts";

export {
  OptionsChainManager,
  getOptionsChainManager,
  resetOptionsChainManager,
} from "./manager.ts";

export { DeribitOptionsProvider };

/** Every options-chain provider, in priority order. */
export function optionsChainProviders(): OptionsChainProvider[] {
  return [new DeribitOptionsProvider()];
}

/** Register every options-chain provider on a manager (one call). */
export function registerOptionsChainSources(manager: OptionsChainManager): void {
  for (const provider of optionsChainProviders()) {
    manager.register(provider);
  }
}

/**
 * Convenience: fetch the live options chain for `currency` (e.g. "BTC") via the
 * default manager, registering the providers on first use.
 */
export async function fetchOptionsChain(currency: string): Promise<OptionsChainSnapshot> {
  const manager = getOptionsChainManager();
  if (manager.listProviders().length === 0) {
    registerOptionsChainSources(manager);
  }
  return manager.getChain(currency);
}
