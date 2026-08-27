/**
 * Guardrail & Security Evaluation
 *
 * Extracted from orchestrator.ts — handles tool security checks,
 * access control enforcement, rate limiting, and permission initialization.
 */

import { enforceRateLimit } from "../../platform/observability/index.ts";
import { auditLog } from "../../platform/audit/index.ts";
import { evaluateRuntimeToolPolicy } from "../../../runtime/tools/ToolPolicy.ts";
import type { GordonContext } from "../types.ts";
import type { ToolSecurityCheckResult } from "./types.ts";

// ============================================================================
// Security Middleware for Tool Execution
// ============================================================================

/**
 * Check security constraints before tool execution
 *
 * This function combines:
 * - Access control (permissionMode check for trading tools)
 * - Rate limiting (per-agent-per-tool limits)
 *
 * @param agentName - Name of the agent making the call
 * @param toolName - Name of the tool being called
 * @param context - Gordon context with config
 * @param options - Optional configuration
 * @returns ToolSecurityCheckResult with allowed status and details
 */
export async function checkToolSecurity(
  agentName: string,
  toolName: string,
  context: GordonContext,
  options: { rateLimit?: number } = {},
): Promise<ToolSecurityCheckResult> {
  const userId = context.userId || "unknown";

  const policyResult = await evaluateRuntimeToolPolicy(toolName, context);
  if (!policyResult.allowed) {
    return {
      allowed: false,
      error: policyResult.reason,
      accessControlResult: policyResult.accessControlResult,
    };
  }

  // Check rate limiting
  const rateLimitResult = enforceRateLimit(agentName, toolName, options.rateLimit);
  if (!rateLimitResult.allowed) {
    auditLog.record(userId, "RATE_LIMIT_EXCEEDED", { agentName, toolName }, "BLOCKED", {
      resultDetails: rateLimitResult.error,
    });

    return {
      allowed: false,
      error: rateLimitResult.error,
      rateLimitResult,
    };
  }

  return {
    allowed: true,
    accessControlResult: policyResult.accessControlResult,
    rateLimitResult,
  };
}

// ============================================================================
// Permission Initialization
// ============================================================================

/**
 * Initialize client with permission check
 * Should be called when connecting to Binance (limited support for other exchanges)
 *
 * @param context - Gordon context with exchange client
 * @returns Permission check result
 */
export async function initializeWithPermissionCheck(context: GordonContext): Promise<{
  success: boolean;
  warnings: string[];
  errors: string[];
  isReadOnly: boolean;
}> {
  if (!context.exchange) {
    return {
      success: false,
      warnings: [],
      errors: ["Exchange client not connected"],
      isReadOnly: true,
    };
  }

  try {
    const details = await context.exchange.getFullAccountDetails();
    const isReadOnly = !details.accountInfo.canTrade;
    auditLog.success(
      context.userId || "system",
      "PERMISSION_CHECK",
      {
        read: true,
        spotTrade: details.accountInfo.canTrade,
        withdraw: details.accountInfo.canWithdraw,
      },
      { resultDetails: isReadOnly ? "Read-only mode" : "Full access" },
    );
    return {
      success: true,
      warnings: [
        "API key permission introspection is limited under CCXT; using exchange account flags.",
      ],
      errors: [],
      isReadOnly,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Permission check failed";
    auditLog.failure(context.userId || "system", "PERMISSION_CHECK", {}, message);
    return {
      success: false,
      warnings: [],
      errors: [message],
      isReadOnly: true,
    };
  }
}
