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
 *
 * A null config fails CLOSED for gated tools. First run is not this case:
 * loadConfig() writes and returns a default config when no file exists, so
 * null here means the config could not be read, and an unreadable config
 * carries no permissionMode to honour.
 */
export async function checkToolAccess(
  toolName: string,
  config: GordonConfig | null,
  userId: string = "system",
  options: { sandboxActive?: boolean } = {},
): Promise<AccessControlResult> {
  if (!TRADING_TOOLS.has(toolName) && !STATE_MODIFYING_TOOLS.has(toolName)) {
    return { allowed: true };
  }

  if (!config) {
    const reason = `Tool ${toolName} blocked — configuration unavailable, permission mode cannot be determined`;
    safeAuditBlocked(userId, { toolName, permissionMode: null }, reason);
    logger.warn("Tool blocked — config unavailable", { toolName, userId });
    return { allowed: false, reason };
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
    const config = await loadConfig().catch((err) => {
      logger.error("Config load failed — access control failing closed", err instanceof Error ? err : new Error(String(err)));
      return null;
    });
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
