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

  // ── Polkadot mutations ──
  polkadot_transfer_native: "Executor",
  polkadot_xcm_transfer: "Executor",
  polkadot_join_pool: "Executor",
  polkadot_bond_extra: "Executor",
  polkadot_unbond: "Executor",
  polkadot_withdraw_unbonded: "Executor",
  polkadot_claim_rewards: "Executor",
  polkadot_swap_tokens: "Executor",
  polkadot_mint_vdot: "Executor",
  polkadot_register_identity: "Executor",

  // ── Solana mutations ──
  solana_trade: "Executor",
  solana_transfer: "Executor",
  solana_create_limit_order: "Executor",
  solana_cancel_limit_orders: "Executor",
  solana_stake_jup: "Executor",
  solana_request_faucet: "Executor",
  solana_launch_pumpfun: "Executor",
  solana_adrena_open_long: "Executor",
  solana_adrena_open_short: "Executor",
  solana_adrena_close_long: "Executor",
  solana_adrena_close_short: "Executor",
  solana_flash_open_trade: "Executor",
  solana_flash_close_trade: "Executor",
  solana_drift_open_perp: "Executor",
  solana_drift_create_account: "Executor",
  solana_drift_deposit: "Executor",
  solana_drift_withdraw: "Executor",
  solana_drift_spot_swap: "Executor",
  solana_lulo_lend: "Executor",
  solana_lulo_withdraw: "Executor",
  solana_drift_insurance_stake: "Executor",
  solana_drift_insurance_request_unstake: "Executor",
  solana_drift_insurance_unstake: "Executor",
  solana_sanctum_swap_lst: "Executor",
  solana_sanctum_add_liquidity: "Executor",
  solana_sanctum_remove_liquidity: "Executor",
  solana_solayer_stake: "Executor",
  solana_voltr_deposit: "Executor",
  solana_voltr_withdraw: "Executor",
  solana_drift_vault_deposit: "Executor",
  solana_drift_vault_request_withdraw: "Executor",
  solana_drift_vault_withdraw: "Executor",
  solana_orca_open_centered: "Executor",
  solana_orca_open_single_sided: "Executor",
  solana_orca_close_position: "Executor",
  solana_orca_create_clmm: "Executor",
  solana_orca_create_whirlpool: "Executor",
  solana_raydium_create_clmm: "Executor",
  solana_raydium_create_cpmm: "Executor",
  solana_meteora_create_dlmm: "Executor",
  solana_manifest_limit_order: "Executor",
  solana_manifest_cancel_orders: "Executor",
  solana_manifest_withdraw: "Executor",
  solana_debridge_create_order: "Executor",
  solana_debridge_execute: "Executor",
  solana_okx_swap: "Executor",

  chainlink_ccip_transfer: "Executor",

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
