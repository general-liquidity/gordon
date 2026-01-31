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
  "execute_plan",
  "close_trade",
  "cancel_trade",
  "place_order",
  "cancel_order",
  "cancel_all_orders",
]);

/**
 * Tools that modify system state (require ARMED for safety)
 */
const STATE_MODIFYING_TOOLS = new Set([
  "arm_system",
  "approve_plan",
]);

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
  // Load config if not provided
  const currentConfig = config ?? await loadConfig();

  // Non-trading tools are always allowed
  if (!TRADING_TOOLS.has(toolName) && !STATE_MODIFYING_TOOLS.has(toolName)) {
    return {
      allowed: true,
      mode: currentConfig.mode,
      armedUntil: currentConfig.armedUntil,
    };
  }

  // Check if system is in ARMED mode
  if (currentConfig.mode !== "ARMED") {
    const reason = `System is in SAFE mode. Cannot execute ${toolName}. Use 'arm' command to enable trading.`;

    logger.warn("Access denied - system not armed", { toolName, mode: currentConfig.mode });

    await emitEvent("access_control:denied", {
      toolName,
      reason: "not_armed",
      mode: currentConfig.mode,
    });

    // Audit log the blocked access
    auditLog.blocked(userId, "ACCESS_DENIED", { toolName }, reason);

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

    auditLog.blocked(userId, "ACCESS_DENIED", { toolName }, reason);

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

    auditLog.blocked(userId, "ACCESS_DENIED", { toolName, armedUntil: currentConfig.armedUntil }, reason);

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
