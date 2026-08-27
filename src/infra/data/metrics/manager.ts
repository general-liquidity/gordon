/**
 * Onchain-metrics manager — routes each metric request to the highest-priority
 * available provider that supports that canonical metric (and asset), with
 * fallback. Mirrors the DataSource / WalletIntel managers. Never throws.
 */

import { createModuleLogger } from "../../logger/index.ts";
import type { OnchainMetricSource, MetricQuery, MetricSeries } from "./types.ts";

const logger = createModuleLogger("onchain-metrics-manager");

export class OnchainMetricsManager {
  private sources: OnchainMetricSource[] = [];

  register(source: OnchainMetricSource): void {
    this.sources = this.sources.filter((s) => s.id !== source.id);
    this.sources.push(source);
    this.sources.sort((a, b) => a.priority - b.priority);
  }

  unregister(id: string): boolean {
    const before = this.sources.length;
    this.sources = this.sources.filter((s) => s.id !== id);
    return this.sources.length < before;
  }

  listSources(): ReadonlyArray<OnchainMetricSource> {
    return this.sources;
  }

  /** Canonical metrics served by at least one registered provider. */
  availableMetrics(): string[] {
    const set = new Set<string>();
    for (const s of this.sources) {
      for (const m of s.getCapabilities().metrics) set.add(m);
    }
    return [...set];
  }

  /**
   * Fetch a metric series. Tries each provider that supports the metric (and
   * the asset, when it scopes assets) in priority order; returns the first
   * non-empty series. Never throws — a failing provider is skipped.
   */
  async getMetric(query: MetricQuery): Promise<MetricSeries | null> {
    for (const source of this.sources) {
      const caps = source.getCapabilities();
      if (!caps.metrics.includes(query.metric)) continue;
      const assets = caps.assets;
      if (
        !assets.includes("*") &&
        !assets.includes(query.asset.toUpperCase()) &&
        !assets.includes(query.asset)
      ) {
        continue;
      }
      try {
        if (!(await source.isAvailable())) continue;
        const series = await source.getMetric(query);
        if (series && series.points.length > 0) return series;
      } catch (err) {
        logger.warn("Onchain-metrics source failed, falling through", {
          source: source.id,
          metric: query.metric,
          asset: query.asset,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
    return null;
  }
}

let defaultManager: OnchainMetricsManager | null = null;

export function getOnchainMetricsManager(): OnchainMetricsManager {
  if (!defaultManager) {
    defaultManager = new OnchainMetricsManager();
  }
  return defaultManager;
}

export function resetOnchainMetricsManager(): void {
  defaultManager = null;
}
