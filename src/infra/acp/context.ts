/**
 * GordonContext builder for ACP mode.
 *
 * Resolves exchange/broker clients like the gateway daemon and attaches
 * a lightweight runtime with evaluateToolAccess for permission gating.
 */

import { createLLMClientFromEnv } from "../ai/llm/index.ts";
import { loadConfig } from "../storage/config/config.ts";
import { checkEnvStatus } from "../storage/config/env.ts";
import type { GordonContext, GordonRuntimeAccess } from "../agents/types.ts";
import { getGatewayContextResolver } from "../../gateway/runtime/context.ts";
import { getDefaultPermissionEngine } from "../../runtime/permissions/defaultPermissionEngine.ts";
import { evaluateRuntimeToolPolicy } from "../../runtime/tools/ToolPolicy.ts";

let cached: GordonContext | null = null;

function createAcpRuntimeAccess(sessionId: string): GordonRuntimeAccess {
  const engine = getDefaultPermissionEngine();
  return {
    runtimeId: `acp-${sessionId}`,
    sessionId,
    threadId: `acp-${sessionId}`,
    resourceId: `acp-${sessionId}`,
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

/**
 * Build (or return cached) GordonContext for the ACP subprocess.
 */
export async function getAcpGordonContext(
  force = false,
  sessionId = "default",
): Promise<GordonContext> {
  if (cached && !force) return cached;

  const config = await loadConfig();
  const env = await checkEnvStatus();
  const resolver = getGatewayContextResolver();
  const resolved = await resolver.resolve(`acp-${sessionId}`);

  let llm = resolved.llm;
  if (!llm) {
    try {
      llm = createLLMClientFromEnv();
    } catch {
      llm = resolved.llm;
    }
  }

  cached = {
    exchange: resolved.exchange,
    broker: resolved.broker,
    llm: llm ?? ({} as GordonContext["llm"]),
    config,
    portfolioValue: resolved.portfolioValue,
    availableCash: resolved.availableCash,
    credentialProfile: resolved.exchange?.isSandbox || resolved.broker?.isPaper ? "paper" : "live",
    runtime: createAcpRuntimeAccess(sessionId),
    userId: `acp-${sessionId}`,
    threadId: `acp-${sessionId}`,
  };

  if (!env.hasLLMKey) {
    cached.portfolioValue = cached.portfolioValue || 0;
  }

  return cached;
}

export function resetAcpGordonContext(): void {
  cached = null;
  getGatewayContextResolver().invalidate();
}