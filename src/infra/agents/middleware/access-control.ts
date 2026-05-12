/**
 * Access Control Middleware (permissionMode gate)
 *
 * Central gate that blocks trade-impacting tools based on the current
 * permission mode. Supports all six modes (auto/ask/strict/paper/observe/plan)
 * via the shared checkTradingPermission helper — see permissionHelpers.ts
 * for the full truth table. For "auto" and "ask" modes this layer is a
 * pass-through — downstream ApprovalDialog / PermissionEngine handles
 * per-action approval.
 */

import { createModuleLogger } from "../../logger/index.ts";
import { loadConfig } from "../../storage/config/config.ts";
import { auditLog } from "../../platform/audit/index.ts";
import type { GordonConfig } from "../../../types/index.ts";
import {
  checkTradingPermission,
  type TradingOperationContext,
} from "../tools/runtime/permissionHelpers.ts";

const logger = createModuleLogger("access-control");

function safeAuditBlocked(userId: string, parameters: Record<string, unknown>, reason: string): void {
  try {
    auditLog.blocked(userId, "ACCESS_DENIED", parameters, reason);
  } catch {
    // Audit persistence must never change access-control decisions.
  }
}

export interface AccessControlResult {
  allowed: boolean;
  reason?: string;
}

/** Tools that require permissionMode !== "strict" to execute. */
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

export function isTradeTool(toolName: string): boolean {
  return TRADING_TOOLS.has(toolName);
}

export function isStateModifyingTool(toolName: string): boolean {
  return STATE_MODIFYING_TOOLS.has(toolName);
}

/**
 * Classify a trading tool by operation context so the permission helper can
 * pick the right gate (execute / cancel / transfer / autonomous / plan_create
 * / state_mutation). The mapping is coarse — exact enforcement lives in
 * checkTradingPermission.
 */
function operationContextFor(toolName: string): TradingOperationContext {
  if (toolName.startsWith("cancel_") || toolName === "cancel_order_list") return "cancel";
  if (toolName === "withdraw_to_external" || toolName === "withdraw_from_exchange") return "transfer";
  if (toolName === "transfer_funds") return "transfer";
  if (toolName === "start_autonomous_mode") return "autonomous";
  if (toolName === "approve_plan" || toolName === "create_plan") return "plan_create";
  // Default for order placements, close_trade, execute_plan, modify_order, etc.
  return "execute";
}

/**
 * Evaluate whether a tool may execute under the current permissionMode.
 * Non-trade tools always pass. Trade tools delegate to checkTradingPermission
 * which knows the truth table across all 6 modes (auto/ask/strict/paper/
 * observe/plan).
 */
export async function checkToolAccess(
  toolName: string,
  config: GordonConfig | null,
  userId: string = "system",
  options: { sandboxActive?: boolean } = {},
): Promise<AccessControlResult> {
  if (!config) return { allowed: true };
  if (!TRADING_TOOLS.has(toolName) && !STATE_MODIFYING_TOOLS.has(toolName)) {
    return { allowed: true };
  }

  const operation = operationContextFor(toolName);
  const check = checkTradingPermission(config.permissionMode, operation, {
    sandboxActive: options.sandboxActive,
  });
  if (!check.allowed) {
    const reason = `Tool ${toolName} blocked — ${check.reason}`;
    safeAuditBlocked(userId, { toolName, permissionMode: config.permissionMode, operation }, reason);
    logger.info("Tool blocked by permissionMode", {
      toolName,
      userId,
      mode: config.permissionMode,
      operation,
    });
    return { allowed: false, reason };
  }

  return { allowed: true };
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

export function getTradingTools(): string[] {
  return [...TRADING_TOOLS];
}
