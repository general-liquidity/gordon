/**
 * Guardrail & Security Evaluation
 *
 * Extracted from orchestrator.ts — handles tool security checks,
 * access control enforcement, rate limiting, and permission initialization.
 */

import {
  enforceRateLimit,
  type RateLimitResult,
} from "../../platform/observability/index.ts";
import { auditLog } from "../../platform/audit/index.ts";
import { checkPermissionsOnInit } from "../../venues/exchange/clients/binance/permissions.ts";
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
 * - Access control (ARMED mode check for trading tools)
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
  options: { rateLimit?: number } = {}
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
    auditLog.record(
      userId,
      "RATE_LIMIT_EXCEEDED",
      { agentName, toolName },
      "BLOCKED",
      { resultDetails: rateLimitResult.error }
    );

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

  if (!context.binance || context.exchange.exchangeId !== "binance") {
    return {
      success: true,
      warnings: ["Permission check is currently available only for Binance."],
      errors: [],
      isReadOnly: false,
    };
  }

  const result = await checkPermissionsOnInit(context.binance);

  // Audit log the permission check
  if (result.success) {
    auditLog.success(
      context.userId || "system",
      "PERMISSION_CHECK",
      {
        read: result.permissions.read,
        spotTrade: result.permissions.spotTrade,
        withdraw: result.permissions.withdraw,
      },
      { resultDetails: result.isReadOnly ? "Read-only mode" : "Full access" }
    );
  } else {
    auditLog.failure(
      context.userId || "system",
      "PERMISSION_CHECK",
      {},
      result.errors.join("; ")
    );
  }

  return {
    success: result.success,
    warnings: result.warnings,
    errors: result.errors,
    isReadOnly: result.isReadOnly,
  };
}
