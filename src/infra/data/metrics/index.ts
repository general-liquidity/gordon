/**
 * Onchain metrics adapter.
 *
 * Provider-agnostic, capability-routed access to aggregate asset-level onchain
 * indicators (exchange flows, SOPR/MVRV/NUPL, holder cohorts, active addresses,
 * miner flows, …). Providers map their native metric catalogs onto canonical
 * OnchainMetric keys; the manager routes each request to the highest-priority
 * available provider that offers that metric, with fallback. Read-only,
 * per-provider credentials, no lock-in.
 *
 * @example
 * const m = getOnchainMetricsManager();
 * registerOnchainMetricSources(m);
 * const netflow = await m.getMetric({ asset: "BTC", metric: "exchange_netflow", timeframe: "1d" });
 */

import type { OnchainMetricSource } from "./types.ts";
import type { OnchainMetricsManager } from "./manager.ts";
import { GlassnodeMetricSource } from "./glassnode.ts";
import { CryptoQuantMetricSource } from "./cryptoquant.ts";
import { SantimentMetricSource } from "./santiment.ts";
import { IntoTheBlockMetricSource } from "./intotheblock.ts";
import { MessariMetricSource } from "./messari.ts";

export type {
  OnchainMetric,
  MetricQuery,
  MetricPoint,
  MetricSeries,
  OnchainMetricsCapabilities,
  OnchainMetricSource,
} from "./types.ts";

export {
  OnchainMetricsManager,
  getOnchainMetricsManager,
  resetOnchainMetricsManager,
} from "./manager.ts";

export {
  GlassnodeMetricSource,
  CryptoQuantMetricSource,
  SantimentMetricSource,
  IntoTheBlockMetricSource,
  MessariMetricSource,
};

/** Every onchain-metrics provider, in priority order. Auth-gated; each
 * self-skips via isAvailable() when its key is unset. */
export function onchainMetricSources(): OnchainMetricSource[] {
  return [
    new GlassnodeMetricSource(), // 30 — gold standard BTC/ETH
    new CryptoQuantMetricSource(), // 32 — exchange + miner flows
    new SantimentMetricSource(), // 34 — broadest asset coverage
    new IntoTheBlockMetricSource(), // 36 — holder cohorts / in-out-of-money
    new MessariMetricSource(), // 38 — broad asset metrics
  ];
}

/** Register every onchain-metrics provider on a manager (one call). */
export function registerOnchainMetricSources(manager: OnchainMetricsManager): void {
  for (const source of onchainMetricSources()) {
    manager.register(source);
  }
}
