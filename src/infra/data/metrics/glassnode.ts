/**
 * Glassnode onchain-metrics provider. Gold-standard BTC/ETH aggregate metrics.
 *
 * Base: https://api.glassnode.com/v1/metrics/<path>?a=<TICKER>&i=<24h|1h>&s=<sec>&u=<sec>
 * Auth: X-Api-Key header (GLASSNODE_API_KEY). Response: [{ t: <unix sec>, v: <number> }].
 */

import type {
  OnchainMetricSource,
  OnchainMetricsCapabilities,
  OnchainMetric,
  MetricQuery,
  MetricSeries,
} from "./types.ts";
import { createModuleLogger } from "../../logger/index.ts";

const logger = createModuleLogger("glassnode");

const BASE = "https://api.glassnode.com/v1/metrics";
const TIMEOUT_MS = 10_000;

/** Canonical metric → confirmed Glassnode endpoint path. */
const METRIC_PATHS: Partial<Record<OnchainMetric, string>> = {
  exchange_netflow: "transactions/transfers_volume_exchanges_net",
  exchange_inflow: "transactions/transfers_volume_to_exchanges_sum",
  exchange_outflow: "transactions/transfers_volume_from_exchanges_sum",
  exchange_reserve: "distribution/balance_exchanges",
  mvrv: "market/mvrv",
  sopr: "indicators/sopr",
  nupl: "indicators/net_unrealized_profit_loss",
  realized_cap: "market/marketcap_realized_usd",
  realized_price: "market/price_realized_usd",
  nvt: "indicators/nvt",
  active_addresses: "addresses/active_count",
  new_addresses: "addresses/new_non_zero_count",
  transaction_count: "transactions/count",
  transfer_volume: "transactions/transfers_volume_sum",
  supply_in_profit_percent: "supply/profit_relative",
  miner_netflow: "distribution/transfers_volume_miners_net",
  miner_reserve: "distribution/balance_miners",
};

export class GlassnodeMetricSource implements OnchainMetricSource {
  readonly id = "glassnode";
  readonly name = "Glassnode";
  readonly priority = 30;
  readonly requiresAuth = true;

  private get apiKey(): string | undefined {
    return process.env.GLASSNODE_API_KEY;
  }

  async isAvailable(): Promise<boolean> {
    return Boolean(this.apiKey);
  }

  getCapabilities(): OnchainMetricsCapabilities {
    return {
      metrics: Object.keys(METRIC_PATHS) as OnchainMetric[],
      assets: ["BTC", "ETH"],
      resolutions: ["1h", "1d"],
    };
  }

  async getMetric(query: MetricQuery): Promise<MetricSeries | null> {
    const key = this.apiKey;
    if (!key) return null;

    const path = METRIC_PATHS[query.metric];
    if (!path) return null;

    const params = new URLSearchParams({
      a: query.asset.toUpperCase(),
      i: query.timeframe === "1h" ? "1h" : "24h",
    });
    if (query.startMs !== undefined) params.set("s", String(Math.floor(query.startMs / 1000)));
    if (query.endMs !== undefined) params.set("u", String(Math.floor(query.endMs / 1000)));

    const url = `${BASE}/${path}?${params.toString()}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

    try {
      const res = await fetch(url, {
        headers: { "X-Api-Key": key },
        signal: controller.signal,
      });
      if (!res.ok) {
        logger.warn("Glassnode request failed", {
          metric: query.metric,
          asset: query.asset,
          status: res.status,
        });
        return null;
      }

      const raw = (await res.json()) as Array<{ t?: number; v?: number }>;
      if (!Array.isArray(raw)) return null;

      const points = raw
        .filter((r) => typeof r.t === "number" && typeof r.v === "number")
        .map((r) => ({ timestamp: r.t! * 1000, value: r.v! }));

      if (points.length === 0) return null;

      return {
        asset: query.asset,
        metric: query.metric,
        provider: "glassnode",
        nativeMetric: path,
        points,
      };
    } catch (err) {
      logger.warn("Glassnode fetch error", {
        metric: query.metric,
        asset: query.asset,
        error: err instanceof Error ? err.message : String(err),
      });
      return null;
    } finally {
      clearTimeout(timer);
    }
  }
}
