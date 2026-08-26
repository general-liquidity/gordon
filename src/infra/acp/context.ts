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
import { createPermissionEngine } from "../../runtime/permissions/defaultPermissionEngine.ts";
import type { PermissionEngine } from "../../runtime/permissions/PermissionEngine.ts";
import { evaluateRuntimeToolPolicy } from "../../runtime/tools/ToolPolicy.ts";
import { resetActiveACELessonRevision } from "../agents/ace/activeRevision.ts";

const cachedBySession = new Map<string, GordonContext>();
const permissionEnginesBySession = new Map<string, PermissionEngine>();

export function getAcpPermissionEngine(sessionId: string): PermissionEngine {
  const existing = permissionEnginesBySession.get(sessionId);
  if (existing) return existing;
  const engine = createPermissionEngine(`acp-${sessionId}`, sessionId);
  permissionEnginesBySession.set(sessionId, engine);
  return engine;
}

function createAcpRuntimeAccess(sessionId: string): GordonRuntimeAccess {
  const engine = getAcpPermissionEngine(sessionId);
  return {
    runtimeId: `acp-${sessionId}`,
    sessionId,
    threadId: `acp-${sessionId}`,
    resourceId: `acp-${sessionId}`,
    evaluateToolAccess: async (toolName, context, args) => {
      const policy = await evaluateRuntimeToolPolicy(toolName, context);
      if (!policy.allowed) {
        return { status: "blocked", reason: policy.reason };
      }
      const permission = await engine.evaluate(toolName, context, policy, args);
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
  const existing = cachedBySession.get(sessionId);
  if (existing && !force) return existing;

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

  const context: GordonContext = {
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
    context.portfolioValue = context.portfolioValue || 0;
  }

  cachedBySession.set(sessionId, context);
  return context;
}

export function resetAcpGordonContext(sessionId?: string): void {
  if (sessionId) {
    cachedBySession.delete(sessionId);
    permissionEnginesBySession.delete(sessionId);
    resetActiveACELessonRevision([sessionId, `acp-${sessionId}`]);
  } else {
    cachedBySession.clear();
    permissionEnginesBySession.clear();
    resetActiveACELessonRevision();
  }
  getGatewayContextResolver().invalidate();
}
