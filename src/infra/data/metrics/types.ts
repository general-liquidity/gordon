/**
 * Onchain metrics adapter — types.
 *
 * Aggregate, asset-level onchain indicators (exchange flows, SOPR/MVRV, holder
 * cohorts, active addresses, …) — distinct from price OHLC and per-address
 * wallet intelligence. A genuine adapter: the operation is homogeneous
 * (`getMetric(asset, metric) → time series`), and providers are interchangeable
 * per metric. Each provider maps its own metric catalog onto the CANONICAL
 * metric keys below and declares which it supports; the manager routes each
 * request to the highest-priority available provider that offers that metric,
 * with fallback.
 */

/**
 * Canonical onchain metric keys. Each provider maps its native metric ids onto
 * these so callers ask for one stable name regardless of source. (Definitions
 * differ slightly between providers — treated as the same canonical signal.)
 */
export type OnchainMetric =
  // Exchange flows — the canonical accumulation/distribution signal
  | "exchange_netflow"
  | "exchange_inflow"
  | "exchange_outflow"
  | "exchange_reserve"
  // Valuation / profitability
  | "mvrv"
  | "sopr"
  | "nupl"
  | "realized_cap"
  | "realized_price"
  | "nvt"
  // Network activity
  | "active_addresses"
  | "new_addresses"
  | "transaction_count"
  | "transfer_volume"
  // Supply / holder behavior
  | "supply_in_profit_percent"
  | "whale_netflow"
  | "stablecoin_supply"
  // Miners
  | "miner_netflow"
  | "miner_reserve";

export interface MetricQuery {
  /** Asset symbol or slug (e.g. "BTC", "ETH"). Providers map to their own id. */
  asset: string;
  /** Canonical metric key. */
  metric: OnchainMetric;
  /** Resolution (e.g. "1h", "1d"). Defaults to "1d" when omitted. */
  timeframe?: string;
  /** Range start, epoch ms (inclusive). */
  startMs?: number;
  /** Range end, epoch ms (inclusive). */
  endMs?: number;
}

export interface MetricPoint {
  /** Epoch ms. */
  timestamp: number;
  value: number;
}

export interface MetricSeries {
  asset: string;
  metric: OnchainMetric;
  /** Provider id that served this series. */
  provider: string;
  /** Provider's native metric id (for provenance/debugging). */
  nativeMetric?: string;
  points: MetricPoint[];
}

export interface OnchainMetricsCapabilities {
  /** Canonical metrics this provider can serve. */
  metrics: OnchainMetric[];
  /** Supported assets, or ["*"] for broad coverage. */
  assets: string[];
  /** Supported resolutions (e.g. ["1h","1d"]). */
  resolutions: string[];
}

/**
 * An onchain-metrics provider. Implement `getMetric` for every canonical metric
 * your `getCapabilities().metrics` declares; resolve gracefully (return null on
 * error/unsupported, never throw) so the manager can fall through.
 */
export interface OnchainMetricSource {
  readonly id: string;
  readonly name: string;
  /** Lower = tried first. */
  readonly priority: number;
  readonly requiresAuth: boolean;

  isAvailable(): Promise<boolean>;
  getCapabilities(): OnchainMetricsCapabilities;
  getMetric(query: MetricQuery): Promise<MetricSeries | null>;
}
