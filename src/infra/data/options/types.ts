/**
 * Options-chain data feed — types.
 *
 * A read-only market-data feed that supplies an options chain (strike × expiry
 * open interest + per-contract IV + spot) to `dealerGreeksExposure.ts`, which
 * sums per-option Greeks across the chain to estimate aggregate dealer GEX /
 * vanna / charm. This module never places orders — it is a data source only.
 *
 * Provider-agnostic, capability-routed, with priority/fallback in the manager —
 * mirrors the onchain price/metrics/wallet adapters. The contract shape is NOT
 * redefined here: `OptionContract` is imported from the consumer so a snapshot
 * drops straight into `computeDealerGreeksExposure` with no re-mapping.
 */

import type { OptionContract } from "../../trading/quant/dealerGreeksExposure.ts";

export type { OptionContract };

/**
 * A point-in-time options chain for one underlying. `contracts` are already in
 * the exact shape `computeDealerGreeksExposure` consumes (strike, timeYears,
 * openInterest, optionType, iv) — no further transformation needed.
 */
export interface OptionsChainSnapshot {
  /** Underlying ticker (e.g. "BTC", "ETH"). */
  underlying: string;
  /** Spot price of the underlying in USD. */
  spotUsd: number;
  /** Epoch ms the snapshot was fetched. */
  fetchedAt: number;
  /** Live, non-expired, positive-OI option contracts across all listed expiries. */
  contracts: OptionContract[];
}

/** What an options-chain provider can serve. */
export interface OptionsChainCapabilities {
  /** Underlyings this provider lists chains for (e.g. ["BTC", "ETH"]). */
  currencies: string[];
}

/**
 * A provider-agnostic options-chain source. Resolve gracefully — throw only on
 * a genuine fetch/parse failure so the manager can fall through to the next
 * provider; an empty-but-successful chain returns a snapshot with `contracts: []`.
 */
export interface OptionsChainProvider {
  readonly id: string;
  readonly name: string;
  /** Lower = tried first. */
  readonly priority: number;
  readonly requiresAuth: boolean;

  isAvailable(): Promise<boolean>;
  getCapabilities(): OptionsChainCapabilities;
  /** Fetch the full live chain for `currency` (e.g. "BTC"). */
  getChain(currency: string): Promise<OptionsChainSnapshot>;
}
