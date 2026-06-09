/**
 * Onchain-metrics provider — Messari.
 *
 * Messari's asset-metrics API exposes per-asset time series including a subset
 * of onchain network metrics (active addresses, transaction count, transfer
 * volume, realized cap, adjusted NVT). Legacy v1 base, simple key-header auth,
 * array-of-rows response.
 *
 * Verified against the public docs (data.messari.io/api/v1):
 *   GET /v1/assets/{assetKey}/metrics/{metricId}/time-series?start=&end=&interval=1d
 *   auth header: x-messari-api-key
 *   response: { data: { values: [[timestamp, ...], …], parameters: { columns } } }
 * `values` rows are arrays; column 0 is the timestamp, the value column is
 * located by name via `parameters.columns`.
 */

import type {
  OnchainMetricSource,
  OnchainMetricsCapabilities,
  OnchainMetric,
  MetricQuery,
  MetricSeries,
} from "./types.ts";
import { createModuleLogger } from "../../logger/index.ts";

const logger = createModuleLogger("messari");

const BASE = "https://data.messari.io/api";
const TIMEOUT_MS = 10_000;

/** Canonical → Messari metric id. Only confirmed onchain ids are mapped. */
const METRIC_IDS: Partial<Record<OnchainMetric, string>> = {
  active_addresses: "act.addr.cnt",
  transaction_count: "txn.cnt",
  transfer_volume: "txn.vol",
  realized_cap: "realized.marketcap",
  nvt: "nvt.adj",
};

const SUPPORTED = Object.keys(METRIC_IDS) as OnchainMetric[];

function apiKey(): string | undefined {
  return process.env.MESSARI_API_KEY;
}

/** Messari interval tokens. Defaults to 1d; only escalate to 1h when asked. */
function resolveInterval(timeframe?: string): string {
  return timeframe === "1h" ? "1h" : "1d";
}

/** Normalize an epoch that may be seconds or ms to ms. */
function toMs(ts: number): number {
  return ts < 1e12 ? ts * 1000 : ts;
}

/** Messari time-series range params want YYYY-MM-DD. */
function toDate(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

export class MessariMetricSource implements OnchainMetricSource {
  readonly id = "messari";
  readonly name = "Messari";
  readonly priority = 38;
  readonly requiresAuth = true;

  async isAvailable(): Promise<boolean> {
    return Boolean(apiKey());
  }

  getCapabilities(): OnchainMetricsCapabilities {
    return {
      metrics: SUPPORTED,
      assets: ["*"],
      resolutions: ["1d"],
    };
  }

  async getMetric(query: MetricQuery): Promise<MetricSeries | null> {
    const key = apiKey();
    if (!key) {
      logger.warn("MESSARI_API_KEY not set");
      return null;
    }

    const metricId = METRIC_IDS[query.metric];
    if (!metricId) return null;

    const assetKey = query.asset.toLowerCase();
    const params = new URLSearchParams({
      interval: resolveInterval(query.timeframe),
    });
    if (query.startMs != null) params.set("start", toDate(query.startMs));
    if (query.endMs != null) params.set("end", toDate(query.endMs));

    const url = `${BASE}/v1/assets/${encodeURIComponent(assetKey)}/metrics/${encodeURIComponent(metricId)}/time-series?${params.toString()}`;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      const res = await fetch(url, {
        headers: { "x-messari-api-key": key, accept: "application/json" },
        signal: controller.signal,
      });
      if (!res.ok) {
        logger.warn("Messari request failed", {
          status: res.status,
          metric: query.metric,
          asset: assetKey,
        });
        return null;
      }

      const body = (await res.json()) as MessariResponse;
      const values = body?.data?.values;
      const columns = body?.data?.parameters?.columns;
      if (!Array.isArray(values) || values.length === 0) return null;

      const valueCol = pickValueColumn(columns);

      const points = [] as MetricSeries["points"];
      for (const row of values) {
        if (!Array.isArray(row) || row.length < 2) continue;
        const ts = Number(row[0]);
        const value = Number(row[valueCol]);
        if (!Number.isFinite(ts) || !Number.isFinite(value)) continue;
        points.push({ timestamp: toMs(ts), value });
      }

      if (points.length === 0) return null;

      return {
        asset: query.asset,
        metric: query.metric,
        provider: this.id,
        nativeMetric: metricId,
        points,
      };
    } catch (err) {
      logger.warn("Messari fetch error", {
        metric: query.metric,
        asset: assetKey,
        error: err instanceof Error ? err.message : String(err),
      });
      return null;
    } finally {
      clearTimeout(timer);
    }
  }
}

interface MessariResponse {
  data?: {
    values?: Array<Array<number | null>>;
    parameters?: { columns?: string[] };
  };
}

/**
 * Locate the value column. Column 0 is the timestamp; prefer a "close" column
 * when present (Messari returns OHLC-shaped rows for many metrics), else the
 * first non-timestamp column.
 */
function pickValueColumn(columns?: string[]): number {
  if (!Array.isArray(columns) || columns.length === 0) return 1;
  const close = columns.findIndex((c) => c?.toLowerCase() === "close");
  if (close > 0) return close;
  return columns.length > 1 ? 1 : 0;
}
