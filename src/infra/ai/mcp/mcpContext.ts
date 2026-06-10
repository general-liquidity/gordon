/**
 * Build GordonContext + Mastra execContext for the MCP expose server.
 */

import { RequestContext } from "@mastra/core/request-context";
import { getGatewayContextResolver } from "../../../gateway/runtime/context.ts";
import { loadConfig } from "../../storage/config/config.ts";
import { createLLMClientFromEnv } from "../../ai/llm/index.ts";
import type { GordonContext, GordonRuntimeAccess } from "../../agents/types.ts";
import type { MastraExecutionContext } from "../../agents/tools/types.ts";
import { getDefaultPermissionEngine } from "../../../runtime/permissions/defaultPermissionEngine.ts";
import { evaluateRuntimeToolPolicy } from "../../../runtime/tools/ToolPolicy.ts";

let cached: { context: GordonContext; execContext: MastraExecutionContext } | null = null;

function createMcpRuntimeAccess(): GordonRuntimeAccess {
  const engine = getDefaultPermissionEngine();
  return {
    runtimeId: "mcp-expose",
    sessionId: "mcp-expose",
    threadId: "mcp-expose",
    resourceId: "mcp-expose",
    evaluateToolAccess: async (toolName, context) => {
      const policy = await evaluateRuntimeToolPolicy(toolName, context);
      if (!policy.allowed) {
        return { status: "blocked", reason: policy.reason };
      }
      const permission = await engine.evaluate(toolName, context, policy);
      if (permission.status === "allowed") {
        return { status: "allowed", reason: permission.reason };
      }
      return {
        status: permission.status,
        reason: permission.reason,
        requestId: permission.request?.id,
      };
    },
  };
}

export async function getMcpGordonExecContext(
  force = false,
): Promise<{ context: GordonContext; execContext: MastraExecutionContext }> {
  if (cached && !force) return cached;

  const config = await loadConfig();
  const resolved = await getGatewayContextResolver().resolve("mcp-expose");
  let llm = resolved.llm;
  if (!llm) {
    try {
      llm = createLLMClientFromEnv();
    } catch {
      llm = resolved.llm;
    }
  }

  const context: GordonContext = {
    exchange: resolved.exchange,
    broker: resolved.broker,
    llm: llm ?? ({} as GordonContext["llm"]),
    config,
    portfolioValue: resolved.portfolioValue,
    availableCash: resolved.availableCash,
    userId: "mcp-expose",
    threadId: "mcp-expose",
    credentialProfile: resolved.exchange?.isSandbox || resolved.broker?.isPaper ? "paper" : "live",
    runtime: createMcpRuntimeAccess(),
  };

  const requestContext = new RequestContext();
  requestContext.set("exchange", context.exchange);
  requestContext.set("broker", context.broker);
  requestContext.set("config", context.config);
  requestContext.set("llm", context.llm);
  requestContext.set("userId", context.userId);
  requestContext.set("threadId", context.threadId);
  requestContext.set("portfolioValue", context.portfolioValue);
  requestContext.set("availableCash", context.availableCash);
  requestContext.set("runtime", context.runtime);

  cached = { context, execContext: { requestContext } };
  return cached;
}

export function resetMcpGordonExecContext(): void {
  cached = null;
  getGatewayContextResolver().invalidate();
}