/**
 * Tool Metrics Wrapper
 *
 * Wraps Mastra tools to automatically record metrics for each tool call.
 * This provides observability into tool usage patterns, success rates,
 * and helps identify problematic tools.
 */

import { recordToolCall } from "../../../platform/observability/metrics.ts";
import { withSpan } from "../../../observability/otel.ts";
import { randomUUID } from "node:crypto";
import { runHooks } from "../../../hooks/engine.ts";
import type { PostToolUsePayload, PreToolUsePayload } from "../../../hooks/types.ts";
import { getGordonContext, type GordonContext, type MastraExecutionContext } from "../types.ts";
import { withResultSanitizer } from "./withResultSanitizer.ts";
import { toStandardSchema, type PublicSchema } from "@mastra/core/schema";

function getMastraExecutionContext(args: unknown[]): MastraExecutionContext | undefined {
  for (const arg of args) {
    if (
      arg &&
      typeof arg === "object" &&
      ("requestContext" in arg || "abortSignal" in arg || "tracingContext" in arg)
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

function finalHookPayload<T>(result: { metadata?: Record<string, unknown> }, fallback: T): T {
  return (result.metadata?.finalPayload as T | undefined) ?? fallback;
}

type ToolAccessDecision = {
  status: "allowed" | "blocked" | "pending";
  reason?: string;
  requestId?: string;
};

export async function evaluateGordonToolAccess(
  toolId: string,
  gordonContext: GordonContext | undefined,
  args?: unknown,
): Promise<ToolAccessDecision> {
  if (gordonContext?.runtime?.evaluateToolAccess) {
    return gordonContext.runtime.evaluateToolAccess(toolId, gordonContext, args);
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
  const permission = await getDefaultPermissionEngine().evaluate(
    toolId,
    gordonContext,
    policy,
    args,
  );
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
export function withToolMetrics<T extends { id: string; execute?: unknown; inputSchema?: unknown }>(
  tool: T,
): T {
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
    const toolCallId = randomUUID();

    return withSpan(`tool.${tool.id}`, { toolName: tool.id, threadId }, async (span) => {
      try {
        const prePayload: PreToolUsePayload = {
          toolName: tool.id,
          toolCallId,
          args: args[0],
        };
        const preHook = await runHooks("PreToolUse", prePayload);
        if (preHook.action === "block") {
          recordToolCall(tool.id, false);
          span.setStatus("error", preHook.reason ?? "PreToolUse hook blocked execution");
          return createRuntimeAccessError(
            tool.id,
            "blocked",
            preHook.reason ?? "PreToolUse hook blocked execution.",
          );
        }
        const hookedPrePayload = finalHookPayload(preHook, prePayload);
        const invocationArgs = [...args];
        if (invocationArgs.length > 0) {
          if (tool.inputSchema) {
            try {
              const schema = toStandardSchema(tool.inputSchema as PublicSchema<unknown>);
              const validation = await schema["~standard"].validate(hookedPrePayload.args);
              if (validation.issues) {
                const reason = validation.issues.map((issue) => issue.message).join("; ");
                recordToolCall(tool.id, false);
                span.setStatus("error", reason);
                return createRuntimeAccessError(
                  tool.id,
                  "blocked",
                  `PreToolUse replacement failed input validation: ${reason}`,
                );
              }
              invocationArgs[0] = validation.value;
            } catch (error) {
              const reason = error instanceof Error ? error.message : String(error);
              recordToolCall(tool.id, false);
              span.setStatus("error", reason);
              return createRuntimeAccessError(
                tool.id,
                "blocked",
                `PreToolUse replacement could not be validated: ${reason}`,
              );
            }
          } else {
            invocationArgs[0] = hookedPrePayload.args;
          }
        }

        const access = await evaluateGordonToolAccess(
          tool.id,
          gordonContext,
          hookedPrePayload.args,
        );
        span.setAttribute("permissionStatus", access.status);
        if (access.status !== "allowed") {
          recordToolCall(tool.id, false);
          span.setStatus("error", access.reason ?? access.status);
          return createRuntimeAccessError(tool.id, access.status, access.reason, access.requestId);
        }

        const startedAt = Date.now();
        let result: unknown;
        try {
          result = await originalExecute.apply(tool, invocationArgs);
        } catch (error) {
          // PostToolUse is a lifecycle observation, not merely a successful-
          // result transformer. Emit it for thrown tool bodies as well so an
          // audit/compliance hook never loses the failed calls it is meant to
          // observe. Preserve the original exception after hooks finish.
          const failedPostHook = await runHooks("PostToolUse", {
            toolName: tool.id,
            toolCallId,
            args: hookedPrePayload.args,
            result: {
              error: error instanceof Error ? error.message : String(error),
            },
            durationMs: Date.now() - startedAt,
            success: false,
          });
          if (failedPostHook.action === "block") {
            console.error(
              `[hooks] PostToolUse blocked after ${tool.id} failed: ${failedPostHook.reason ?? "blocked"}`,
            );
          }
          throw error;
        }

        let isError =
          result &&
          typeof result === "object" &&
          result !== null &&
          "error" in result &&
          typeof (result as Record<string, unknown>).error === "string";

        const postPayload: PostToolUsePayload = {
          toolName: tool.id,
          toolCallId,
          args: hookedPrePayload.args,
          result,
          durationMs: Date.now() - startedAt,
          success: !isError,
        };
        const postHook = await runHooks("PostToolUse", postPayload);
        if (postHook.action === "block") {
          result = createRuntimeAccessError(
            tool.id,
            "blocked",
            postHook.reason ?? "PostToolUse hook withheld the result.",
          );
          isError = true;
        } else {
          result = finalHookPayload(postHook, postPayload).result;
          isError = Boolean(
            result &&
              typeof result === "object" &&
              "error" in result &&
              typeof (result as Record<string, unknown>).error === "string",
          );
        }

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
    });
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
export function withToolsMetrics<
  T extends Record<string, { id: string; execute?: unknown; inputSchema?: unknown }>,
>(tools: T): T {
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
