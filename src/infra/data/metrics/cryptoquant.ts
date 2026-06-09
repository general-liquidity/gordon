/**
 * CryptoQuant onchain-metrics provider.
 *
 * Strongest on EXCHANGE FLOWS + MINER data (BTC/ETH only). Maps the canonical
 * metric keys it covers onto CryptoQuant's native (category/metric) endpoints.
 *
 * VERIFIED against the CryptoQuant API user guide (userguide.cryptoquant.com):
 *   - base https://api.cryptoquant.com/v1, auth "Authorization: Bearer <key>"
 *   - exchange-flows {netflow,inflow,outflow,reserve} + miner-flows {netflow,reserve}
 *     paths, params (window=day|hour, exchange required, from/to as YYYYMMDD[THHMMSS]),
 *     response shape { result: { data: [{ date, <metric>_total | reserve | value }] } }
 *   - `date` is "YYYY-MM-DD" at window=day, a datetime string at window=hour.
 * UNVERIFIED (API is paid/gated — Professional/Premium plan required for a key):
 *   - market-indicator {mvrv,sopr,nupl} exact value field names. We read a
 *     small set of likely keys; if absent the point is skipped. Re-verify the
 *     exact field once a key is provisioned.
 */

import type {
  OnchainMetricSource,
  OnchainMetricsCapabilities,
  OnchainMetric,
  MetricQuery,
  MetricSeries,
} from "./types.ts";
import { createModuleLogger } from "../../logger/index.ts";

const logger = createModuleLogger("cryptoquant");

const BASE = "https://api.cryptoquant.com/v1";
const TIMEOUT_MS = 10_000;

/** canonical → { category, metric } native CryptoQuant endpoint segment. */
const METRIC_MAP: Partial<Record<OnchainMetric, { category: string; metric: string }>> = {
  exchange_netflow: { category: "exchange-flows", metric: "netflow" },
  exchange_inflow: { category: "exchange-flows", metric: "inflow" },
  exchange_outflow: { category: "exchange-flows", metric: "outflow" },
  exchange_reserve: { category: "exchange-flows", metric: "reserve" },
  miner_netflow: { category: "miner-flows", metric: "netflow" },
  miner_reserve: { category: "miner-flows", metric: "reserve" },
  // market-indicator value-field UNVERIFIED — see file header.
  mvrv: { category: "market-indicator", metric: "mvrv" },
  sopr: { category: "market-indicator", metric: "sopr" },
  nupl: { category: "market-indicator", metric: "nupl" },
};

const SUPPORTED_METRICS = Object.keys(METRIC_MAP) as OnchainMetric[];

/** Per-metric candidate value fields in result.data rows (first present wins). */
const VALUE_FIELDS: Partial<Record<OnchainMetric, string[]>> = {
  exchange_netflow: ["netflow_total"],
  exchange_inflow: ["inflow_total", "inflow_mean"],
  exchange_outflow: ["outflow_total", "outflow_mean"],
  exchange_reserve: ["reserve"],
  miner_netflow: ["netflow_total"],
  miner_reserve: ["reserve"],
  mvrv: ["mvrv", "value"],
  sopr: ["sopr", "value"],
  nupl: ["nupl", "value"],
};

function assetPrefix(asset: string): "btc" | "eth" | null {
  const a = asset.trim().toLowerCase();
  if (a === "btc" || a === "bitcoin") return "btc";
  if (a === "eth" || a === "ethereum") return "eth";
  return null;
}

/** epoch ms → CryptoQuant's YYYYMMDDTHHMMSS (UTC). */
function toCqDate(ms: number): string {
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, "0");
  return (
    `${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}` +
    `T${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}`
  );
}

/** CryptoQuant "date" ("YYYY-MM-DD" or datetime string) → epoch ms. */
function parseCqDate(raw: unknown): number | null {
  if (typeof raw === "number") return raw;
  if (typeof raw !== "string") return null;
  const ms = Date.parse(raw.includes("T") || raw.includes(" ") ? raw : `${raw}T00:00:00Z`);
  return Number.isNaN(ms) ? null : ms;
}

export class CryptoQuantMetricSource implements OnchainMetricSource {
  readonly id = "cryptoquant";
  readonly name = "CryptoQuant";
  readonly priority = 32;
  readonly requiresAuth = true;

  private get key(): string | undefined {
    return process.env.CRYPTOQUANT_API_KEY;
  }

  async isAvailable(): Promise<boolean> {
    return Boolean(this.key);
  }

  getCapabilities(): OnchainMetricsCapabilities {
    return {
      metrics: SUPPORTED_METRICS,
      assets: ["BTC", "ETH"],
      resolutions: ["1h", "1d"],
    };
  }

  async getMetric(query: MetricQuery): Promise<MetricSeries | null> {
    const key = this.key;
    if (!key) {
      logger.warn("No CRYPTOQUANT_API_KEY — cannot serve metric", { metric: query.metric });
      return null;
    }

    const native = METRIC_MAP[query.metric];
    if (!native) {
      logger.warn("Unsupported canonical metric", { metric: query.metric });
      return null;
    }

    const prefix = assetPrefix(query.asset);
    if (!prefix) {
      logger.warn("Unsupported asset (CryptoQuant is BTC/ETH)", { asset: query.asset });
      return null;
    }

    const window = query.timeframe === "1h" ? "hour" : "day";
    const params = new URLSearchParams({ window, exchange: "all_exchange", limit: "1000" });
    if (query.startMs != null) params.set("from", toCqDate(query.startMs));
    if (query.endMs != null) params.set("to", toCqDate(query.endMs));

    const url = `${BASE}/${prefix}/${native.category}/${native.metric}?${params.toString()}`;
    const nativeMetric = `${prefix}/${native.category}/${native.metric}`;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      const res = await fetch(url, {
        headers: { Authorization: `Bearer ${key}`, Accept: "application/json" },
        signal: controller.signal,
      });
      if (!res.ok) {
        logger.warn("CryptoQuant request failed", { status: res.status, nativeMetric });
        return null;
      }

      const body = (await res.json()) as { result?: { data?: unknown[] } } | undefined;
      const rows = body?.result?.data;
      if (!Array.isArray(rows) || rows.length === 0) {
        logger.warn("CryptoQuant returned no data", { nativeMetric });
        return null;
      }

      const fields = VALUE_FIELDS[query.metric] ?? ["value"];
      const points: { timestamp: number; value: number }[] = [];
      for (const row of rows) {
        if (!row || typeof row !== "object") continue;
        const r = row as Record<string, unknown>;
        const ts = parseCqDate(r.date ?? r.datetime ?? r.blockheight);
        if (ts == null) continue;
        let value: number | null = null;
        for (const f of fields) {
          const v = r[f];
          if (typeof v === "number" && Number.isFinite(v)) {
            value = v;
            break;
          }
        }
        if (value == null) continue;
        points.push({ timestamp: ts, value });
      }

      if (points.length === 0) {
        logger.warn("CryptoQuant rows had no usable value field", { nativeMetric, fields });
        return null;
      }

      points.sort((a, b) => a.timestamp - b.timestamp);
      return {
        asset: query.asset,
        metric: query.metric,
        provider: "cryptoquant",
        nativeMetric,
        points,
      };
    } catch (err) {
      logger.warn("CryptoQuant fetch error", {
        nativeMetric,
        error: err instanceof Error ? err.message : String(err),
      });
      return null;
    } finally {
      clearTimeout(timer);
    }
  }
}
