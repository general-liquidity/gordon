/**
 * Access Control Middleware (permissionMode-driven)
 *
 * Legacy ARMED/SAFE gating REMOVED — replaced by config.permissionMode
 * + the ApprovalDialog flow (PermissionEngine). This file is now a thin
 * shim that translates permissionMode to the legacy access-control API
 * so the orchestrator / ToolPolicy / runtime callers still compile.
 *
 *   permissionMode="auto"   → trade tools execute without confirmation
 *   permissionMode="ask"    → ApprovalDialog gates each trade tool (DEFAULT)
 *   permissionMode="strict" → trade tools blocked entirely at this layer
 *
 * The per-action approval is handled downstream in the PermissionEngine +
 * ApprovalDialog. This middleware now only blocks "strict" mode hard-reads.
 */

import { createModuleLogger } from "../../logger/index.ts";
import { loadConfig } from "../../storage/config.ts";
import { auditLog } from "../../platform/audit/index.ts";
import type { GordonConfig } from "../../../types/index.ts";

const logger = createModuleLogger("access-control");

function safeAuditBlocked(userId: string, parameters: Record<string, unknown>, reason: string): void {
  try {
    auditLog.blocked(userId, "ACCESS_DENIED", parameters, reason);
  } catch {
    // Audit persistence must never change access-control decisions.
  }
}

// ============================================================================
// Types (legacy shape preserved for caller compatibility)
// ============================================================================

export interface AccessControlResult {
  allowed: boolean;
  reason?: string;
  /** Legacy field — always "ARMED" now unless permissionMode is "strict". */
  mode: "ARMED" | "SAFE";
  /** Legacy field — no longer used for gating, always null. */
  armedUntil?: string | null;
  remainingTimeMs?: number;
}

/** Trade tools that permissionMode="strict" fully blocks. */
const TRADING_TOOLS = new Set([
  // CEX/broker order tools
  "execute_plan", "close_trade", "cancel_trade", "place_order",
  "place_market_order", "place_limit_order", "place_bracket_order",
  "place_oco_order", "cancel_order", "cancel_all_orders",
  "cancel_replace_order", "cancel_order_list", "set_trailing_stop",
  "update_trailing_stop", "place_stop_loss", "place_take_profit",
  "modify_order", "replace_order", "close_position", "reduce_position",
  // Withdrawals
  "withdraw_to_external", "withdraw_from_exchange",
  // Solana Agent Kit execution
  "solana_trade", "solana_transfer", "solana_transfer_sol",
  "solana_transfer_spl", "solana_stake_sol", "solana_unstake_sol",
  "solana_jupiter_swap", "solana_jupiter_limit_order",
  "solana_pumpfun_launch", "solana_pumpfun_buy", "solana_pumpfun_sell",
  "solana_drift_perp_open", "solana_drift_perp_close",
  "solana_adrena_open_position", "solana_adrena_close_position",
  "solana_flash_open_position", "solana_flash_close_position",
  "solana_lulo_deposit", "solana_lulo_withdraw", "solana_sanctum_stake",
  "solana_sanctum_unstake", "solana_solayer_stake", "solana_solayer_unstake",
  "solana_voltr_deposit", "solana_voltr_withdraw",
  "solana_orca_add_liquidity", "solana_orca_remove_liquidity",
  "solana_raydium_add_liquidity", "solana_raydium_remove_liquidity",
  "solana_meteora_add_liquidity", "solana_meteora_remove_liquidity",
  "solana_manifest_place_order", "solana_manifest_cancel_order",
  "solana_debridge_bridge", "solana_okx_bridge", "solana_drift_insurance_stake",
  // Polkadot execution
  "polkadot_transfer", "polkadot_stake", "polkadot_unstake",
  "polkadot_nominate", "polkadot_claim_rewards",
  "polkadot_acala_swap", "polkadot_acala_add_liquidity",
  "polkadot_hydradx_swap", "polkadot_stellaswap_swap",
  // AgentKit execution
  "agentkit_swap", "agentkit_transfer", "agentkit_approve",
  "agentkit_stake", "agentkit_unstake", "agentkit_supply",
  "agentkit_borrow", "agentkit_repay", "agentkit_withdraw",
  // Chainlink CCIP
  "chainlink_ccip_transfer",
]);

const STATE_MODIFYING_TOOLS = new Set(["approve_plan"]);

export function requiresArmedModeForTool(toolName: string): boolean {
  // Legacy alias — kept for caller compat. Returns true for trade tools.
  return TRADING_TOOLS.has(toolName);
}

export function isStateModifyingTool(toolName: string): boolean {
  return STATE_MODIFYING_TOOLS.has(toolName);
}

/**
 * Translate permissionMode to access-control result.
 * In "auto" + "ask" modes: allowed=true (approval happens downstream).
 * In "strict" mode: blocked for any trade tool.
 */
function evaluatePermissionMode(
  toolName: string,
  cfg: GordonConfig,
  userId: string,
): AccessControlResult {
  const mode = cfg.permissionMode ?? "ask";

  if (mode === "strict" && TRADING_TOOLS.has(toolName)) {
    const reason = `Tool ${toolName} blocked — permissionMode is "strict" (read-only)`;
    safeAuditBlocked(userId, { toolName, permissionMode: mode }, reason);
    logger.info("Tool blocked by strict permissionMode", { toolName, userId });
    return { allowed: false, reason, mode: "SAFE", armedUntil: null };
  }

  // auto + ask both allow through this layer; ask defers to ApprovalDialog.
  return { allowed: true, mode: "ARMED", armedUntil: null };
}

export async function checkToolAccess(
  toolName: string,
  config: GordonConfig | null,
  userId: string = "system",
): Promise<AccessControlResult> {
  if (!config) {
    // No config — allow (startup path); downstream layers still apply.
    return { allowed: true, mode: "ARMED", armedUntil: null };
  }
  // Only apply this layer to trade tools.
  if (!TRADING_TOOLS.has(toolName)) {
    return { allowed: true, mode: "ARMED", armedUntil: null };
  }
  return evaluatePermissionMode(toolName, config, userId);
}

export async function checkExplicitExecutionAccess(
  toolName: string,
  config: GordonConfig | null,
  userId: string = "system",
): Promise<AccessControlResult> {
  // Legacy alias — same semantics now.
  return checkToolAccess(toolName, config, userId);
}

export function createAccessControlMiddleware(userId: string) {
  return async (toolName: string): Promise<AccessControlResult> => {
    const config = await loadConfig().catch(() => null);
    return checkToolAccess(toolName, config, userId);
  };
}

export async function withAccessControl<T>(
  toolName: string,
  userId: string,
  fn: () => Promise<T>,
): Promise<T> {
  const middleware = createAccessControlMiddleware(userId);
  const result = await middleware(toolName);
  if (!result.allowed) {
    throw new Error(result.reason ?? "Access denied");
  }
  return fn();
}

export function requiresArmedMode(toolName: string): boolean {
  return requiresArmedModeForTool(toolName);
}

export function getTradingTools(): string[] {
  return [...TRADING_TOOLS];
}

export function formatRemainingTime(_remainingTimeMs: number): string {
  return "n/a (permissionMode does not use time-based expiry)";
}

export async function getArmedStatus(): Promise<{
  armed: boolean;
  armedUntil: string | null;
  remainingTimeMs: number | null;
}> {
  // Legacy shape — translated from permissionMode.
  const config = await loadConfig().catch(() => null);
  const mode = config?.permissionMode ?? "ask";
  return {
    armed: mode === "auto" || mode === "ask",
    armedUntil: null,
    remainingTimeMs: null,
  };
}
