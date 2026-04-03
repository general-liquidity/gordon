/**
 * Time-Based Access Control Middleware
 *
 * Provides middleware that blocks trading tools if the system is not ARMED.
 * Checks the armedUntil timestamp before allowing tool execution.
 *
 * This middleware should be added to the tool execution pipeline to enforce
 * that trading operations can only occur when the system is explicitly armed.
 */

import { createModuleLogger } from "../../logger/index.ts";
import { emitEvent } from "../../../events/index.ts";
import { loadConfig } from "../../storage/config.ts";
import { auditLog } from "../../audit/index.ts";
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
// Types
// ============================================================================

/**
 * Result of access control check
 */
export interface AccessControlResult {
  allowed: boolean;
  reason?: string;
  mode: "ARMED" | "SAFE";
  armedUntil?: string | null;
  remainingTimeMs?: number;
}

/**
 * Trading tools that require ARMED mode
 */
const TRADING_TOOLS = new Set([
  // CEX order tools
  "execute_plan",
  "close_trade",
  "cancel_trade",
  "place_order",
  "place_market_order",
  "place_limit_order",
  "place_bracket_order",
  "place_oco_order",
  "cancel_order",
  "cancel_all_orders",
  "cancel_replace_order",
  "cancel_order_list",
  "set_trailing_stop",
  "update_trailing_stop",
  "close_partial_position",
  "approve_strategy_trade",
  // AgentKit (EVM)
  "agentkit_native_transfer",
  "agentkit_erc20_transfer",
  "agentkit_wrap_eth",
  "agentkit_swap",
  "moonwell_deposit",
  "moonwell_withdraw",
  // Solana execution
  "solana_trade",
  "solana_transfer",
  "solana_create_limit_order",
  "solana_cancel_limit_orders",
  "solana_stake_jup",
  "solana_launch_pumpfun",
  "solana_adrena_open_long",
  "solana_adrena_open_short",
  "solana_adrena_close_long",
  "solana_adrena_close_short",
  "solana_flash_open_trade",
  "solana_flash_close_trade",
  "solana_drift_open_perp",
  "solana_drift_deposit",
  "solana_drift_withdraw",
  "solana_drift_spot_swap",
  "solana_lulo_lend",
  "solana_lulo_withdraw",
  "solana_drift_insurance_stake",
  "solana_drift_insurance_request_unstake",
  "solana_drift_insurance_unstake",
  "solana_sanctum_swap_lst",
  "solana_sanctum_add_liquidity",
  "solana_sanctum_remove_liquidity",
  "solana_solayer_stake",
  "solana_voltr_deposit",
  "solana_voltr_withdraw",
  "solana_drift_vault_deposit",
  "solana_drift_vault_request_withdraw",
  "solana_drift_vault_withdraw",
  "solana_orca_open_centered",
  "solana_orca_open_single_sided",
  "solana_orca_close_position",
  "solana_raydium_create_clmm",
  "solana_raydium_create_cpmm",
  "solana_meteora_create_dlmm",
  "solana_manifest_limit_order",
  "solana_manifest_cancel_orders",
  "solana_manifest_withdraw",
  "solana_debridge_create_order",
  "solana_debridge_execute",
  "solana_okx_swap",
  // Polkadot execution
  "polkadot_transfer_native",
  "polkadot_xcm_transfer",
  "polkadot_join_pool",
  "polkadot_bond_extra",
  "polkadot_unbond",
  "polkadot_withdraw_unbonded",
  "polkadot_claim_rewards",
  "polkadot_swap_tokens",
  "polkadot_mint_vdot",
  "polkadot_register_identity",
  // Chainlink CCIP
  "chainlink_ccip_transfer",
]);

/**
 * Tools that modify execution state after arming
 */
const STATE_MODIFYING_TOOLS = new Set([
  "approve_plan",
]);

export function requiresArmedModeForTool(toolName: string): boolean {
  return TRADING_TOOLS.has(toolName);
}

export function isStateModifyingTool(toolName: string): boolean {
  return STATE_MODIFYING_TOOLS.has(toolName);
}

async function evaluateArmedModeRequirement(
  toolName: string,
  currentConfig: GordonConfig,
  userId: string,
): Promise<AccessControlResult> {
  // Check if system is in ARMED mode
  if (currentConfig.mode !== "ARMED") {
    const reason = `System is in SAFE mode. Cannot execute ${toolName}. Use /arm to enable trading.`;

    logger.warn("Access denied - system not armed", { toolName, mode: currentConfig.mode });

    await emitEvent("access_control:denied", {
      toolName,
      reason: "not_armed",
      mode: currentConfig.mode,
    });

    // Audit log the blocked access
    safeAuditBlocked(userId, { toolName }, reason);

    return {
      allowed: false,
      reason,
      mode: currentConfig.mode,
      armedUntil: currentConfig.armedUntil,
    };
  }

  // Check if armed mode has expired
  if (!currentConfig.armedUntil) {
    const reason = `System is marked as ARMED but has no expiration time. Please re-arm the system.`;

    logger.warn("Access denied - no armedUntil timestamp", { toolName });

    await emitEvent("access_control:denied", {
      toolName,
      reason: "no_armed_until",
    });

    safeAuditBlocked(userId, { toolName }, reason);

    return {
      allowed: false,
      reason,
      mode: currentConfig.mode,
      armedUntil: null,
    };
  }

  const armedUntilDate = new Date(currentConfig.armedUntil);
  const now = new Date();
  const remainingTimeMs = armedUntilDate.getTime() - now.getTime();

  if (remainingTimeMs <= 0) {
    const reason = `ARMED mode expired at ${currentConfig.armedUntil}. Please re-arm the system to continue trading.`;

    logger.warn("Access denied - armed mode expired", {
      toolName,
      armedUntil: currentConfig.armedUntil,
      expiredAgo: `${Math.abs(remainingTimeMs / 1000).toFixed(0)} seconds`,
    });

    await emitEvent("access_control:denied", {
      toolName,
      reason: "armed_expired",
      armedUntil: currentConfig.armedUntil,
    });

    safeAuditBlocked(userId, { toolName, armedUntil: currentConfig.armedUntil }, reason);

    return {
      allowed: false,
      reason,
      mode: currentConfig.mode,
      armedUntil: currentConfig.armedUntil,
      remainingTimeMs: 0,
    };
  }

  // Warn if armed mode is about to expire (less than 5 minutes)
  if (remainingTimeMs < 5 * 60 * 1000) {
    const minutesRemaining = (remainingTimeMs / 60000).toFixed(1);
    logger.warn("Armed mode expiring soon", {
      toolName,
      minutesRemaining,
      armedUntil: currentConfig.armedUntil,
    });

    await emitEvent("access_control:warning", {
      message: `Armed mode expiring in ${minutesRemaining} minutes`,
      toolName,
      warning: "armed_expiring_soon",
    });
  }

  logger.debug("Access granted", {
    toolName,
    mode: currentConfig.mode,
    remainingMinutes: (remainingTimeMs / 60000).toFixed(1),
  });

  return {
    allowed: true,
    mode: currentConfig.mode,
    armedUntil: currentConfig.armedUntil,
    remainingTimeMs,
  };
}

// ============================================================================
// Access Control Check
// ============================================================================

/**
 * Check if a tool is allowed to execute based on current system state
 *
 * @param toolName - Name of the tool being executed
 * @param config - Current Gordon configuration (optional, will load if not provided)
 * @param userId - User ID for audit logging
 * @returns AccessControlResult with allowed status and details
 */
export async function checkToolAccess(
  toolName: string,
  config?: GordonConfig,
  userId: string = "unknown"
): Promise<AccessControlResult> {
  const requiresFreshResolvedConfig = TRADING_TOOLS.has(toolName) || STATE_MODIFYING_TOOLS.has(toolName);
  const currentConfig = requiresFreshResolvedConfig
    ? await resolveAccessControlConfig(config)
    : config ?? await loadConfig();

  // Non-trading tools are always allowed
  if (!TRADING_TOOLS.has(toolName) && !STATE_MODIFYING_TOOLS.has(toolName)) {
    return {
      allowed: true,
      mode: currentConfig.mode,
      armedUntil: currentConfig.armedUntil,
    };
  }

  return evaluateArmedModeRequirement(toolName, currentConfig, userId);
}

export async function checkExplicitExecutionAccess(
  toolName: string,
  config?: GordonConfig,
  userId: string = "unknown",
): Promise<AccessControlResult> {
  const currentConfig = await resolveAccessControlConfig(config);
  return evaluateArmedModeRequirement(toolName, currentConfig, userId);
}

async function resolveAccessControlConfig(config?: GordonConfig): Promise<GordonConfig> {
  try {
    return await loadConfig();
  } catch {
    if (config) {
      return config;
    }

    throw new Error("Unable to resolve current Gordon config for access control.");
  }
}

// ============================================================================
// Middleware Function
// ============================================================================

/**
 * Create an access control middleware function for tool execution
 *
 * This middleware can be used to wrap tool execution and enforce
 * ARMED mode requirements.
 *
 * @param userId - User ID for audit logging
 * @returns Middleware function that checks access before execution
 *
 * @example
 * ```typescript
 * const accessMiddleware = createAccessControlMiddleware("user123");
 *
 * // Before executing a tool:
 * const result = await accessMiddleware("execute_plan", config);
 * if (!result.allowed) {
 *   return { error: result.reason };
 * }
 * // Proceed with tool execution
 * ```
 */
export function createAccessControlMiddleware(userId: string) {
  return async (
    toolName: string,
    config?: GordonConfig
  ): Promise<AccessControlResult> => {
    return checkToolAccess(toolName, config, userId);
  };
}

/**
 * Wrapper function to execute a tool with access control
 *
 * @param toolName - Name of the tool being executed
 * @param execute - Function to execute if access is granted
 * @param config - Gordon configuration
 * @param userId - User ID for audit logging
 * @returns Result of execution or error if access denied
 */
export async function withAccessControl<T>(
  toolName: string,
  execute: () => Promise<T>,
  config?: GordonConfig,
  userId: string = "unknown"
): Promise<T | { error: string }> {
  const accessResult = await checkToolAccess(toolName, config, userId);

  if (!accessResult.allowed) {
    return { error: accessResult.reason || "Access denied" };
  }

  return execute();
}

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Check if a tool requires ARMED mode
 */
export function requiresArmedMode(toolName: string): boolean {
  return TRADING_TOOLS.has(toolName);
}

/**
 * Get the list of tools that require ARMED mode
 */
export function getTradingTools(): string[] {
  return Array.from(TRADING_TOOLS);
}

/**
 * Format remaining armed time for display
 */
export function formatRemainingTime(remainingTimeMs: number): string {
  if (remainingTimeMs <= 0) return "Expired";

  const seconds = Math.floor(remainingTimeMs / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);

  if (hours > 0) {
    return `${hours}h ${minutes % 60}m`;
  } else if (minutes > 0) {
    return `${minutes}m ${seconds % 60}s`;
  } else {
    return `${seconds}s`;
  }
}

/**
 * Get current armed status summary
 */
export async function getArmedStatus(): Promise<{
  isArmed: boolean;
  mode: "ARMED" | "SAFE";
  armedUntil: string | null;
  remainingTime: string | null;
  remainingTimeMs: number;
}> {
  const config = await loadConfig();

  if (config.mode !== "ARMED" || !config.armedUntil) {
    return {
      isArmed: false,
      mode: config.mode,
      armedUntil: config.armedUntil,
      remainingTime: null,
      remainingTimeMs: 0,
    };
  }

  const remainingTimeMs = new Date(config.armedUntil).getTime() - Date.now();
  const isArmed = remainingTimeMs > 0;

  return {
    isArmed,
    mode: config.mode,
    armedUntil: config.armedUntil,
    remainingTime: isArmed ? formatRemainingTime(remainingTimeMs) : "Expired",
    remainingTimeMs: Math.max(0, remainingTimeMs),
  };
}
