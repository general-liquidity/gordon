/**
 * V4 Tool Surface — minimalistic trading-agent toolset.
 *
 * 22 tools = 20 explicit typed tools + 2 meta-dispatchers (compute_indicator,
 * compute_microstructure). Replaces the 405-tool current surface for the
 * generalized trading infra subset; integration tools (~229: Solana,
 * Polkadot, Finnhub fundamentals, CDP, Chainlink, etc.) stay aside.
 *
 * Activation: GORDON_V4_TOOLS=1. Coexists with the current surface for
 * empirical comparison (eval harness + manual sessions).
 *
 * Layout:
 *   - data.ts        — 5 read tools (market/account/portfolio/news/fundamentals)
 *   - analytics.ts   — 4 compute tools (indicator/regime/risk/microstructure)
 *   - plan.ts        — 6 plan/exec tools (create/verify/approve/execute/cancel/backtest)
 *   - memory.ts      — 3 memory+audit tools (search/write/audit_event)
 *   - workflow.ts    — 4 workflow tools (skill/delegate_subagent/ask_user/schedule_task)
 *
 * Stub note: most tools return stubbed payloads with a "wire to X" hint.
 * Dispatchers should be wired to the existing handler modules incrementally
 * — the descriptions are what we want to test FIRST (does Gordon pick the
 * right tool from the slimmer surface?).
 */

import { v4DataTools } from "./data.ts";
import { v4AnalyticsTools } from "./analytics.ts";
import { v4PlanTools } from "./plan.ts";
import { v4MemoryTools } from "./memory.ts";
import { v4WorkflowTools } from "./workflow.ts";

export const v4Tools = {
  ...v4DataTools,
  ...v4AnalyticsTools,
  ...v4PlanTools,
  ...v4MemoryTools,
  ...v4WorkflowTools,
};

export const V4_TOOL_IDS = Object.keys(v4Tools) as ReadonlyArray<keyof typeof v4Tools>;

/**
 * Feature flag — return v4Tools when active, else empty object that
 * spreads to nothing. Call sites can spread the result unconditionally.
 */
export function getV4Tools(): typeof v4Tools | Record<string, never> {
  return process.env.GORDON_V4_TOOLS === "1" ? v4Tools : {};
}

/**
 * Inverse — return empty object when V4 is active, current surface
 * otherwise. Use this to GATE the legacy surface so we don't double-load.
 *
 *   tools: {
 *     ...(isV4Active() ? {} : instrumentedMarketTools),
 *     ...getV4Tools(),
 *   }
 */
export function isV4Active(): boolean {
  return process.env.GORDON_V4_TOOLS === "1";
}

export { v4DataTools, v4AnalyticsTools, v4PlanTools, v4MemoryTools, v4WorkflowTools };
