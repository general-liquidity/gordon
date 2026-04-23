import { auditLog } from "../../infra/platform/audit/index.ts";
import { evaluateToolRequestPolicy } from "../../infra/runtime/actions/runtime.ts";
import {
  checkToolAccess,
  isTradeTool,
  type AccessControlResult,
} from "../../infra/agents/middleware/access-control.ts";
import type { GordonContext } from "../../infra/agents/types.ts";
import { CapabilityRegistry } from "./CapabilityRegistry.ts";
import type { RuntimeApprovalClass, RuntimeToolSpec } from "../contracts/types.ts";

export interface RuntimeToolPolicyDecision {
  allowed: boolean;
  reason?: string;
  tool: RuntimeToolSpec;
  approvalClass: RuntimeApprovalClass;
  accessControlResult?: AccessControlResult;
}

function getApprovalClass(spec: RuntimeToolSpec): RuntimeApprovalClass {
  if (spec.permissionScope === "transfer.execute") {
    return "always_require_human";
  }
  if (spec.permissionScope === "livetrade.execute" || spec.permissionScope === "wallet.write") {
    return "per_action";
  }
  if (spec.permissionScope === "system.mode.write" || spec.permissionScope === "plugin.install" || spec.permissionScope === "mcp.connect") {
    return "per_tool";
  }
  if (spec.permissionScope === "papertrade.execute") {
    return "session";
  }
  return "none";
}

function safeAuditRecord(
  userId: string,
  action: "PERMISSION_CHECK",
  parameters: Record<string, unknown>,
  result: "ALLOWED" | "BLOCKED",
  resultDetails?: string,
): void {
  try {
    auditLog.record(userId, action, parameters, result === "ALLOWED" ? "SUCCESS" : "BLOCKED", {
      resultDetails,
    });
  } catch {
    // Audit persistence must not block runtime policy evaluation.
  }
}

export async function evaluateRuntimeToolPolicy(
  toolName: string,
  context: GordonContext,
  capabilityRegistry?: CapabilityRegistry,
  toolOverride?: RuntimeToolSpec,
): Promise<RuntimeToolPolicyDecision> {
  const userId = context.userId || "unknown";
  const tool = toolOverride ?? (capabilityRegistry ?? new CapabilityRegistry()).resolveToolSpec(toolName);
  const approvalClass = getApprovalClass(tool);

  const actionPolicy = await evaluateToolRequestPolicy(toolName, context);
  if (!actionPolicy.allowed) {
    safeAuditRecord(userId, "PERMISSION_CHECK", {
      toolName,
      permissionScope: tool.permissionScope,
      approvalClass,
    }, "BLOCKED", actionPolicy.reason || "Tool policy denied request.");

    return {
      allowed: false,
      reason: actionPolicy.reason || "Tool policy denied request.",
      tool,
      approvalClass,
    };
  }

  const sandboxActive = (context.exchange as { isSandbox?: boolean } | null)?.isSandbox ?? context.broker?.isPaper ?? false;
  let accessControlResult = await checkToolAccess(toolName, context.config, userId, { sandboxActive });
  if (!accessControlResult.allowed) {
    return {
      allowed: false,
      reason: accessControlResult.reason,
      tool,
      approvalClass,
      accessControlResult,
    };
  }

  if ((tool.requiresTradePermission || actionPolicy.requiresTradePermission) && !isTradeTool(toolName)) {
    accessControlResult = await checkToolAccess(toolName, context.config, userId, { sandboxActive });
    if (!accessControlResult.allowed) {
      return {
        allowed: false,
        reason: accessControlResult.reason,
        tool,
        approvalClass,
        accessControlResult,
      };
    }
  }

  safeAuditRecord(userId, "PERMISSION_CHECK", {
    toolName,
    permissionScope: tool.permissionScope,
    approvalClass,
    sideEffectLevel: tool.sideEffectLevel,
    requiresTradePermission: tool.requiresTradePermission,
  }, "ALLOWED");

  return {
    allowed: true,
    tool,
    approvalClass,
    accessControlResult,
  };
}
