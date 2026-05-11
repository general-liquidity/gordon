/**
 * Tool Output Filters — semantic compression dispatcher.
 *
 * Inspired by ztk's per-command filter pattern, adapted for Mastra
 * tool responses. Each filter is a pure function: takes the raw tool
 * result, returns a compressed equivalent that preserves decision-
 * bearing signal. Filters bypass (pass through unchanged) when:
 *   - The result shape doesn't match expectations
 *   - The result is already small
 *   - The result is an error envelope
 *
 * The dispatcher routes by canonical tool name. Unrecognized names
 * always pass through — the default is identity. Compression is
 * opt-in per filter.
 *
 * Wiring: the orchestrator calls `applyToolOutputFilter(toolName,
 * result)` after each tool returns. Filtered output goes to the
 * model; raw output is still available in the audit log for audit /
 * replay. Mastra wiring is left to the orchestrator — this module
 * is pure logic + tests.
 */

import { filterGetCandles } from "./getCandles.ts";
import { filterGetOrderbook } from "./getOrderbook.ts";
import { filterScanMarket, type ScanFilterOptions } from "./scanMarket.ts";
import { passthrough, type FilterResult, type ToolOutputFilter } from "./types.ts";

export type { FilterResult, ToolOutputFilter } from "./types.ts";
export { filterGetCandles } from "./getCandles.ts";
export { filterGetOrderbook } from "./getOrderbook.ts";
export { filterScanMarket } from "./scanMarket.ts";

const REGISTRY: Record<string, ToolOutputFilter> = {
  get_candles: filterGetCandles,
  get_historical_klines: filterGetCandles,
  get_orderbook: filterGetOrderbook,
  get_book_ticker: filterGetOrderbook,
  scan_market: filterScanMarket,
  scan_top_movers: filterScanMarket,
  scan_setups: filterScanMarket,
};

export interface ApplyOptions {
  scan?: ScanFilterOptions;
}

/**
 * Apply the registered filter for a tool name, or pass through when
 * no filter is registered.
 */
export function applyToolOutputFilter(
  toolName: string,
  result: unknown,
  options: ApplyOptions = {},
): FilterResult {
  const filter = REGISTRY[toolName];
  if (!filter) return passthrough(result);
  // scan_market accepts focus symbols; others ignore the options.
  if (filter === filterScanMarket && options.scan) {
    return filterScanMarket(result, options.scan);
  }
  return filter(result);
}

/** Inspect the registry (debug / TUI). */
export function listRegisteredFilters(): string[] {
  return Object.keys(REGISTRY).sort();
}

/** Register a custom filter at runtime (plugins, tests). */
export function registerToolOutputFilter(toolName: string, filter: ToolOutputFilter): void {
  REGISTRY[toolName] = filter;
}
