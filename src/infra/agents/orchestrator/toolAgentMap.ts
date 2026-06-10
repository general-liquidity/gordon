/**
 * Tool-to-Agent Mapping — 4-Agent Architecture
 *
 * Gordon has ALL read-only tools directly. Only state-changing trade tools
 * map to Executor. Unmapped tools stay with the current agent (= Gordon).
 *
 * Agents: Gordon (main), Executor (trades), Researcher (parallel), Critic (internal)
 */

import { getDynamicToolAgentMap } from "../../runtime/routing/manager.ts";
import { createModuleLogger } from "../../logger/index.ts";
import { getExecutionReadiness } from "../harness/runtimeHarness.ts";
import type { GordonContext } from "../types.ts";

const logger = createModuleLogger("orchestrator-tool-map");

// ============================================================================
// Tool-to-Agent Mapping (only Executor tools — everything else = Gordon)
// ============================================================================

export const TOOL_AGENT_MAP: Record<string, string> = {
  // ── Core trade execution ──
  execute_plan: "Executor",
  close_trade: "Executor",
  set_permission_mode: "Executor",
  approve_plan: "Executor",
  set_trailing_stop: "Executor",
  update_trailing_stop: "Executor",
  close_partial_position: "Executor",
  close_position_tracking: "Executor",
  approve_strategy_trade: "Executor",

  // ── Order placement ──
  place_bracket_order: "Executor",
  place_market_order: "Executor",
  place_limit_order: "Executor",
  place_oco_order: "Executor",
  cancel_all_orders: "Executor",
  cancel_order: "Executor",
  cancel_replace_order: "Executor",
  cancel_order_list: "Executor",

  // ── Wallet mutations ──
  convert_dust: "Executor",
  transfer_funds: "Executor",
  withdraw_to_external: "Executor",

  // ── Earn mutations ──
  subscribe_flexible_earn: "Executor",
  redeem_flexible_earn: "Executor",
  subscribe_locked_earn: "Executor",

  // ── Strategy runtime mutations ──
  deploy_strategy: "Executor",
  pause_strategy: "Executor",
  resume_strategy: "Executor",
  stop_strategy: "Executor",
  rebalance_portfolio: "Executor",

  // ── Everything else is Gordon (unmapped = stays with current agent) ──
};

// ============================================================================
// Planning Artifact Helpers (used by streamProcessor)
// ============================================================================

const PLANNING_ARTIFACT_TOOLS = new Set([
  "create_plan", "create_grid_plan", "execute_plan", "approve_plan",
  "list_plans", "preview_market_order",
]);

const REQUIRES_PLANNING_ARTIFACT = new Set([
  "execute_plan", "approve_plan",
]);

export function isPlanningArtifactTool(toolName: string | undefined): boolean {
  return toolName ? PLANNING_ARTIFACT_TOOLS.has(toolName) : false;
}

export function requiresPlanningArtifact(toolName: string | undefined): boolean {
  return toolName ? REQUIRES_PLANNING_ARTIFACT.has(toolName) : false;
}

// ============================================================================
// Tool Routing Helpers
// ============================================================================

/**
 * Get the agent name that owns a specific tool.
 * Returns "Executor" for trade tools, undefined for everything else (= Gordon).
 */
export function getAgentForTool(toolName: string): string | undefined {
  // Dynamic skill-based map first (MCP/skill tools)
  const dynamicAgent = getDynamicToolAgentMap()[toolName];
  if (dynamicAgent) return dynamicAgent;

  // Static map (only Executor tools are mapped)
  return TOOL_AGENT_MAP[toolName];
}

/**
 * Build the default executor handoff budget from context and risk config
 */
export function buildDefaultExecutorHandoffBudget(
  context: GordonContext,
): { toolBudget: number; maxSteps: number } {
  const readiness = getExecutionReadiness(context);
  if (!readiness.ready) {
    return { toolBudget: 0, maxSteps: 0 };
  }
  return { toolBudget: 5, maxSteps: 10 };
}
