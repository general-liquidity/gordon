/**
 * Onchain metrics provider — IntoTheBlock (ITB).
 *
 * ITB is best-in-class for holder-cohort analytics: in/out-of-the-money
 * (% of holders/addresses in profit), large-transaction / large-holder
 * netflows ("whales"), and network activity (active addresses, tx count).
 * We map ONLY the canonical metrics ITB is known to serve.
 *
 * ⚠️ UNVERIFIED-PENDING-KEY — ITB's API is enterprise/gated. Public docs
 * (https://api.intotheblock.com/docs) were unreachable/auth-walled at build
 * time (gateway returns 403/503), so the BASE URL path layout, the AUTH HEADER,
 * and the RESPONSE SHAPES below are the best-documented conventional shape, NOT
 * confirmed against the live spec. The gateway host `api.intotheblock.com` IS
 * confirmed real (returns 403 unauthenticated). Re-verify all three once a key
 * is provisioned: endpoint paths, header name (`x-api-key` vs `Authorization`),
 * and the time-series JSON field names. Parsing is defensive so unexpected
 * shapes degrade to null rather than crash.
 */

import type {
  OnchainMetricSource,
  OnchainMetricsCapabilities,
  OnchainMetric,
  MetricQuery,
  MetricSeries,
  MetricPoint,
} from "./types.ts";
import { createModuleLogger } from "../../logger/index.ts";

const logger = createModuleLogger("intotheblock");

const BASE_URL = "https://api.intotheblock.com/v1";
const TIMEOUT_MS = 10_000;

// Canonical → ITB native analytics id. Only the metrics ITB actually serves.
// UNVERIFIED-PENDING-KEY: native ids follow ITB's published analytic names but
// the exact request slugs must be confirmed against the live spec.
const METRIC_MAP: Partial<Record<OnchainMetric, string>> = {
  supply_in_profit_percent: "inOutOfTheMoney",
  whale_netflow: "largeTransactions",
  active_addresses: "activeAddresses",
  transaction_count: "transactionsCount",
};

// ITB covers BTC, ETH, and major ERC-20s. Asset slugs are uppercased symbols.
const SUPPORTED_ASSETS = ["BTC", "ETH", "USDT", "USDC", "LINK", "UNI", "AAVE", "MATIC"];

export class IntoTheBlockMetricSource implements OnchainMetricSource {
  readonly id = "intotheblock";
  readonly name = "IntoTheBlock";
  readonly priority = 36;
  readonly requiresAuth = true;

  private readonly apiKey = process.env.INTOTHEBLOCK_API_KEY;

  async isAvailable(): Promise<boolean> {
    return Boolean(this.apiKey);
  }

  getCapabilities(): OnchainMetricsCapabilities {
    return {
      metrics: Object.keys(METRIC_MAP) as OnchainMetric[],
      assets: SUPPORTED_ASSETS,
      resolutions: ["1d"], // ITB analytics are predominantly daily.
    };
  }

  async getMetric(query: MetricQuery): Promise<MetricSeries | null> {
    if (!this.apiKey) {
      logger.warn("Missing INTOTHEBLOCK_API_KEY", { metric: query.metric });
      return null;
    }

    const native = METRIC_MAP[query.metric];
    if (!native) {
      logger.warn("Unsupported metric for ITB", { metric: query.metric });
      return null;
    }

    const asset = query.asset.toUpperCase();
    if (!SUPPORTED_ASSETS.includes(asset)) {
      logger.warn("Unsupported asset for ITB", { asset: query.asset });
      return null;
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      const url = new URL(`${BASE_URL}/analytics/${asset}/${native}`);
      url.searchParams.set("resolution", query.timeframe ?? "1d");
      if (query.startMs) url.searchParams.set("from", String(Math.floor(query.startMs / 1000)));
      if (query.endMs) url.searchParams.set("to", String(Math.floor(query.endMs / 1000)));

      const res = await fetch(url, {
        headers: { "x-api-key": this.apiKey, accept: "application/json" },
        signal: controller.signal,
      });

      if (!res.ok) {
        logger.warn("ITB request failed", { status: res.status, metric: query.metric, asset });
        return null;
      }

      const body = (await res.json()) as unknown;
      const points = parsePoints(body);
      if (!points.length) {
        logger.warn("ITB returned no points", { metric: query.metric, asset });
        return null;
      }

      return {
        asset: query.asset,
        metric: query.metric,
        provider: "intotheblock",
        nativeMetric: native,
        points,
      };
    } catch (err) {
      logger.warn("ITB fetch error", {
        metric: query.metric,
        asset,
        error: err instanceof Error ? err.message : String(err),
      });
      return null;
    } finally {
      clearTimeout(timer);
    }
  }
}

/**
 * Defensive time-series extraction. UNVERIFIED-PENDING-KEY: accepts the common
 * ITB-style envelope (`{ data: [{ time/date/timestamp, value }] }`) plus a bare
 * array fallback. Anything unrecognized → []. Timestamps normalized to ms.
 */
function parsePoints(body: unknown): MetricPoint[] {
  const rows = Array.isArray(body)
    ? body
    : Array.isArray((body as { data?: unknown })?.data)
      ? (body as { data: unknown[] }).data
      : null;
  if (!rows) return [];

  const out: MetricPoint[] = [];
  for (const row of rows) {
    if (!row || typeof row !== "object") continue;
    const r = row as Record<string, unknown>;
    const rawTs = r.timestamp ?? r.time ?? r.date ?? r.t;
    const rawVal = r.value ?? r.v ?? r.y;
    const ts = toMs(rawTs);
    const val = typeof rawVal === "number" ? rawVal : Number(rawVal);
    if (ts === null || !Number.isFinite(val)) continue;
    out.push({ timestamp: ts, value: val });
  }
  return out;
}

function toMs(raw: unknown): number | null {
  if (typeof raw === "number") return raw < 1e12 ? raw * 1000 : raw; // sec → ms
  if (typeof raw === "string") {
    const n = Number(raw);
    if (Number.isFinite(n)) return n < 1e12 ? n * 1000 : n;
    const parsed = Date.parse(raw);
    return Number.isNaN(parsed) ? null : parsed;
  }
  return null;
}
