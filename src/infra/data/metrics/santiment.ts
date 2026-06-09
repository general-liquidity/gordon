/**
 * Santiment (SanAPI) onchain-metrics provider. Broadest asset coverage incl. ERC-20s.
 *
 * GraphQL: POST https://api.santiment.net/graphql
 * Auth: "Authorization: Apikey <SANTIMENT_API_KEY>" (SANTIMENT_API_KEY).
 * Query: { getMetric(metric:"<slug>"){ timeseriesData(slug,from,to,interval){ datetime value } } }
 * Datetime is ISO8601 ("2023-05-01T08:00:00Z"); interval "1d"/"1h".
 */

import type {
  OnchainMetricSource,
  OnchainMetricsCapabilities,
  OnchainMetric,
  MetricQuery,
  MetricSeries,
} from "./types.ts";
import { createModuleLogger } from "../../logger/index.ts";

const logger = createModuleLogger("santiment");

const ENDPOINT = "https://api.santiment.net/graphql";
const TIMEOUT_MS = 10_000;
const DEFAULT_RANGE_MS = 90 * 24 * 60 * 60 * 1000;

/** Canonical metric → confirmed Santiment metric slug. */
const METRIC_SLUGS: Partial<Record<OnchainMetric, string>> = {
  exchange_inflow: "exchange_inflow",
  exchange_outflow: "exchange_outflow",
  exchange_reserve: "exchange_balance",
  mvrv: "mvrv_usd",
  nvt: "nvt",
  active_addresses: "active_addresses_24h",
  transfer_volume: "transaction_volume",
  supply_in_profit_percent: "percent_of_total_supply_in_profit",
};

/**
 * Santiment has no direct netflow metric — compute inflow − outflow.
 * Declared as a capability; resolved by differencing the two slug series.
 */
const NETFLOW_PARTS = { in: "exchange_inflow", out: "exchange_outflow" } as const;

/** query.asset (BTC/ETH/…) → Santiment slug. Unknown majors fall back to lowercase. */
const ASSET_SLUGS: Record<string, string> = {
  BTC: "bitcoin",
  ETH: "ethereum",
  SOL: "solana",
  XRP: "xrp",
  ADA: "cardano",
  DOGE: "dogecoin",
  AVAX: "avalanche",
  MATIC: "matic-network",
  LINK: "chainlink",
  DOT: "polkadot",
  LTC: "litecoin",
  BCH: "bitcoin-cash",
  UNI: "uniswap",
  USDT: "tether",
  USDC: "usd-coin",
};

function assetSlug(asset: string): string {
  return ASSET_SLUGS[asset.toUpperCase()] ?? asset.toLowerCase();
}

interface TimeseriesRow {
  datetime?: string;
  value?: number | null;
}

export class SantimentMetricSource implements OnchainMetricSource {
  readonly id = "santiment";
  readonly name = "Santiment";
  readonly priority = 34;
  readonly requiresAuth = true;

  private get apiKey(): string | undefined {
    return process.env.SANTIMENT_API_KEY;
  }

  async isAvailable(): Promise<boolean> {
    return Boolean(this.apiKey);
  }

  getCapabilities(): OnchainMetricsCapabilities {
    return {
      // Direct slugs + computed netflow. Broad coverage but strongest on BTC/ETH/majors.
      metrics: [...(Object.keys(METRIC_SLUGS) as OnchainMetric[]), "exchange_netflow"],
      assets: ["*"],
      resolutions: ["1h", "1d"],
    };
  }

  async getMetric(query: MetricQuery): Promise<MetricSeries | null> {
    const key = this.apiKey;
    if (!key) return null;

    const slug = assetSlug(query.asset);
    const interval = query.timeframe === "1h" ? "1h" : "1d";
    const from = new Date(query.startMs ?? Date.now() - DEFAULT_RANGE_MS).toISOString();
    const to = new Date(query.endMs ?? Date.now()).toISOString();

    if (query.metric === "exchange_netflow") {
      const [inflow, outflow] = await Promise.all([
        this.fetchSeries(key, NETFLOW_PARTS.in, slug, from, to, interval, query),
        this.fetchSeries(key, NETFLOW_PARTS.out, slug, from, to, interval, query),
      ]);
      if (!inflow) return null;
      const outByTs = new Map((outflow ?? []).map((p) => [p.timestamp, p.value]));
      const points = inflow.map((p) => ({
        timestamp: p.timestamp,
        value: p.value - (outByTs.get(p.timestamp) ?? 0),
      }));
      if (points.length === 0) return null;
      return {
        asset: query.asset,
        metric: query.metric,
        provider: "santiment",
        nativeMetric: "exchange_inflow-exchange_outflow",
        points,
      };
    }

    const metricSlug = METRIC_SLUGS[query.metric];
    if (!metricSlug) return null;

    const points = await this.fetchSeries(key, metricSlug, slug, from, to, interval, query);
    if (!points || points.length === 0) return null;

    return {
      asset: query.asset,
      metric: query.metric,
      provider: "santiment",
      nativeMetric: metricSlug,
      points,
    };
  }

  private async fetchSeries(
    key: string,
    metricSlug: string,
    assetSlugStr: string,
    from: string,
    to: string,
    interval: string,
    query: MetricQuery,
  ): Promise<Array<{ timestamp: number; value: number }> | null> {
    const gql = `{ getMetric(metric: "${metricSlug}") { timeseriesData(slug: "${assetSlugStr}", from: "${from}", to: "${to}", interval: "${interval}") { datetime value } } }`;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

    try {
      const res = await fetch(ENDPOINT, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Apikey ${key}`,
        },
        body: JSON.stringify({ query: gql }),
        signal: controller.signal,
      });
      if (!res.ok) {
        logger.warn("Santiment request failed", {
          metric: query.metric,
          slug: metricSlug,
          asset: query.asset,
          status: res.status,
        });
        return null;
      }

      const json = (await res.json()) as {
        data?: { getMetric?: { timeseriesData?: TimeseriesRow[] } };
        errors?: Array<{ message?: string }>;
      };
      if (json.errors?.length) {
        logger.warn("Santiment GraphQL error", {
          metric: query.metric,
          slug: metricSlug,
          asset: query.asset,
          error: json.errors[0]?.message,
        });
        return null;
      }

      const rows = json.data?.getMetric?.timeseriesData;
      if (!Array.isArray(rows)) return null;

      return rows
        .filter((r) => typeof r.datetime === "string" && typeof r.value === "number")
        .map((r) => ({ timestamp: Date.parse(r.datetime!), value: r.value as number }))
        .filter((p) => Number.isFinite(p.timestamp));
    } catch (err) {
      logger.warn("Santiment fetch error", {
        metric: query.metric,
        slug: metricSlug,
        asset: query.asset,
        error: err instanceof Error ? err.message : String(err),
      });
      return null;
    } finally {
      clearTimeout(timer);
    }
  }
}
