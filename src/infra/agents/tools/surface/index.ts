/**
 * Agent Tool Surface — the canonical 22-tool set.
 *
 * 22 tools = 20 explicit + 2 meta-dispatchers (compute_indicator,
 * compute_microstructure). This is the surface Gordon's orchestrator
 * and researcher present to the LLM for generalized trading infra.
 * Integration tools (Solana / Polkadot / Finnhub fundamentals / CDP /
 * Chainlink / AgentKit / Base / MCP) coexist as separate spreads —
 * those are venue-specific and aren't covered by the canonical surface.
 *
 * Layout:
 *   - data.ts        — 5 read tools (market/account/portfolio/news/fundamentals)
 *   - analytics.ts   — 4 compute tools (indicator/regime/risk/microstructure)
 *   - plan.ts        — 6 plan/exec tools (create/verify/approve/execute/cancel/backtest)
 *   - memory.ts      — 3 memory+audit tools (search/write/audit_event)
 *   - workflow.ts    — 4 workflow tools (skill/delegate_subagent/ask_user/schedule_task)
 *
 * Each tool dispatches into existing handler modules — risk classifier,
 * signed audit log, trading constitution, deny-list, permission engine
 * all stay where they are. This is a surface, not a re-implementation.
 */

import { dataTools } from "./data.ts";
import { analyticsTools } from "./analytics.ts";
import { planTools } from "./plan.ts";
import { memoryTools } from "./memory.ts";
import { workflowTools } from "./workflow.ts";

export const agentTools = {
  ...dataTools,
  ...analyticsTools,
  ...planTools,
  ...memoryTools,
  ...workflowTools,
};

export const AGENT_TOOL_IDS = Object.keys(agentTools) as ReadonlyArray<keyof typeof agentTools>;

export { dataTools, analyticsTools, planTools, memoryTools, workflowTools };
