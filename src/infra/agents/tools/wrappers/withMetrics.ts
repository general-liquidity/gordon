/**
 * Tool Metrics Wrapper
 *
 * Wraps Mastra tools to automatically record metrics for each tool call.
 * This provides observability into tool usage patterns, success rates,
 * and helps identify problematic tools.
 */

import { recordToolCall } from "../../../platform/observability/metrics.ts";
import { withSpan } from "../../../observability/otel.ts";
import { getGordonContext, type GordonContext, type MastraExecutionContext } from "../types.ts";
import { withResultSanitizer } from "./withResultSanitizer.ts";

function getMastraExecutionContext(args: unknown[]): MastraExecutionContext | undefined {
  for (const arg of args) {
    if (
      arg
      && typeof arg === "object"
      && ("requestContext" in arg || "abortSignal" in arg || "tracingContext" in arg)
    ) {
      return arg as MastraExecutionContext;
    }
  }
  return undefined;
}

function createRuntimeAccessError(
  toolId: string,
  status: "blocked" | "pending",
  reason?: string,
  requestId?: string,
): {
  error: string;
  approvalRequestId?: string;
  runtimeStatus: "blocked" | "pending";
  toolId: string;
} {
  const suffix = requestId
    ? ` Use /runtime-approve ${requestId} or /runtime-deny ${requestId}.`
    : "";
  return {
    error: `${reason ?? `Runtime ${status} ${toolId}.`}${suffix}`,
    approvalRequestId: requestId,
    runtimeStatus: status,
    toolId,
  };
}

type ToolAccessDecision = {
  status: "allowed" | "blocked" | "pending";
  reason?: string;
  requestId?: string;
};

export async function evaluateGordonToolAccess(
  toolId: string,
  gordonContext: GordonContext | undefined,
): Promise<ToolAccessDecision> {
  if (gordonContext?.runtime?.evaluateToolAccess) {
    return gordonContext.runtime.evaluateToolAccess(toolId, gordonContext);
  }
  if (!gordonContext) {
    const { isSafetyCritical } = await import("../../../../runtime/permissions/trustTrajectory.ts");
    if (isSafetyCritical(toolId)) {
      return {
        status: "blocked",
        reason: "No Gordon context available — safety-critical tool blocked (fail-closed).",
      };
    }
    return { status: "allowed" };
  }

  const [{ getDefaultPermissionEngine }, { evaluateRuntimeToolPolicy }] = await Promise.all([
    import("../../../../runtime/permissions/defaultPermissionEngine.ts"),
    import("../../../../runtime/tools/ToolPolicy.ts"),
  ]);
  const policy = await evaluateRuntimeToolPolicy(toolId, gordonContext);
  if (!policy.allowed) {
    return { status: "blocked", reason: policy.reason };
  }
  const permission = await getDefaultPermissionEngine().evaluate(toolId, gordonContext, policy);
  if (permission.status === "allowed") {
    return { status: "allowed", reason: permission.reason };
  }
  return {
    status: permission.status,
    reason: permission.reason,
    requestId: permission.request?.id,
  };
}

/**
 * Wraps a single tool to record metrics on each execution.
 *
 * Records:
 * - Tool name
 * - Success/failure status
 *
 * Uses type assertion to preserve the original tool type while wrapping
 * the execute function with metrics recording.
 *
 * @param tool - The Mastra tool to wrap
 * @returns A new tool with metrics recording
 */
export function withToolMetrics<T extends { id: string; execute?: unknown }>(tool: T): T {
  // If no execute function, return as-is
  if (typeof tool.execute !== "function") {
    return tool;
  }

  const originalExecute = tool.execute as (...args: unknown[]) => Promise<unknown>;

  // Create a wrapped execute function that records metrics
  const wrappedExecute = async (...args: unknown[]): Promise<unknown> => {
    const execContext = getMastraExecutionContext(args);
    const gordonContext = getGordonContext(execContext) ?? undefined;
    const threadId = gordonContext?.threadId ?? "unknown";

    return withSpan(
      `tool.${tool.id}`,
      { toolName: tool.id, threadId },
      async (span) => {
        try {
          const access = await evaluateGordonToolAccess(tool.id, gordonContext);
          span.setAttribute("permissionStatus", access.status);
          if (access.status !== "allowed") {
            recordToolCall(tool.id, false);
            span.setStatus("error", access.reason ?? access.status);
            return createRuntimeAccessError(
              tool.id,
              access.status,
              access.reason,
              access.requestId,
            );
          }

          const result = await originalExecute.apply(tool, args);

          const isError =
            result &&
            typeof result === "object" &&
            result !== null &&
            "error" in result &&
            typeof (result as Record<string, unknown>).error === "string";

          recordToolCall(tool.id, !isError);
          span.setAttribute("success", !isError);
          if (isError) {
            span.setStatus("error", String((result as Record<string, unknown>).error));
          }

          return result;
        } catch (err) {
          recordToolCall(tool.id, false);
          span.recordError(err);
          throw err;
        }
      },
    );
  };

  // Return a new tool with the wrapped execute function
  // Use Object.create to preserve prototype chain
  const wrapped = Object.create(Object.getPrototypeOf(tool));
  Object.assign(wrapped, tool);
  wrapped.execute = wrappedExecute;

  return wrapped as T;
}

/**
 * Wraps all tools in an object to record metrics on each execution.
 *
 * @param tools - Object containing tools keyed by their ID
 * @returns Object with same structure but wrapped tools
 *
 * @example
 * ```typescript
 * import { marketTools } from "../market/market.ts";
 * import { withToolsMetrics } from "./withMetrics.ts";
 *
 * // Wrap all market tools with metrics
 * const instrumentedMarketTools = withToolsMetrics(marketTools);
 * ```
 */
export function withToolsMetrics<T extends Record<string, { id: string; execute?: unknown }>>(
  tools: T
): T {
  const wrapped = {} as Record<string, unknown>;

  for (const [key, tool] of Object.entries(tools)) {
    // Compose sanitizer (inner) + metrics (outer). Sanitizer runs first
    // so injection patterns in tool results are redacted before metrics
    // sees them; metrics records hit/miss accurately on the sanitized
    // value.
    wrapped[key] = withToolMetrics(withResultSanitizer(tool));
  }

  return wrapped as T;
}
