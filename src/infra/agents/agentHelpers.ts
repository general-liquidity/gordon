/**
 * Agent Helpers
 *
 * Shared utility functions used by per-agent definition files:
 * - resolveRuntimeModel: resolves the model config for an agent
 * - formatModelLabel: formats a model config for logging
 * - registerObservability: registers an agent with the Mastra instance
 */

import { Agent } from "@mastra/core/agent";
import { type MastraModelConfig } from "../runtime/providers/registry.ts";
import { getMastraInstance } from "../platform/observability/tracing.ts";
import { determineWorkflowPhase, resolveModelForWorkflowPhase } from "./workflowPhase.ts";
import type { GordonConfig } from "../../types/index.ts";
import type { GordonContext } from "./types.ts";

/**
 * Resolve the model configuration at runtime, supporting workflow-phase routing.
 *
 * When called without arguments, returns a static model config (used by Gordon).
 * When called as a Mastra model resolver (with requestContext), resolves dynamically.
 */
export function resolveRuntimeModel(args?: { requestContext?: { get: (key: string) => unknown } }): MastraModelConfig {
  const requestConfig = args?.requestContext?.get?.("config") as GordonConfig | undefined;
  const requestedActionId = args?.requestContext?.get?.("requestedActionId") as GordonContext["requestedActionId"];
  const requestedTaskScope = args?.requestContext?.get?.("requestedTaskScope") as GordonContext["requestedTaskScope"];
  const workflowPhase = determineWorkflowPhase({
    requestedActionId,
    requestedTaskScope,
  });
  return resolveModelForWorkflowPhase(
    requestConfig ?? ({
      modelConfig: {
        provider: process.env.GORDON_PROVIDER,
        model: process.env.GORDON_MODEL,
      },
    } as GordonConfig),
    workflowPhase,
  );
}

/**
 * Format a model config for human-readable logging.
 */
export function formatModelLabel(model: MastraModelConfig): string {
  if (typeof model === "string") {
    return model;
  }

  if (typeof model.id === "string" && model.id.length > 0) {
    return model.id;
  }

  const providerId =
    typeof model.providerId === "string" && model.providerId.length > 0
      ? model.providerId
      : undefined;
  const modelId =
    typeof model.modelId === "string" && model.modelId.length > 0
      ? model.modelId
      : undefined;

  if (providerId && modelId) {
    return `${providerId}/${modelId}`;
  }

  return JSON.stringify(model);
}

/**
 * Register an agent with the Mastra instance for observability tracing.
 * When tracing is enabled, this wires agent.#mastra so that generate()/stream()
 * calls automatically create Mastra spans (agent_run, tool_call, etc.)
 * exported to Axiom via OtelExporter with SensitiveDataFilter.
 */
export function registerObservability(agent: Agent): void {
  const mastra = getMastraInstance();
  if (mastra) {
    try {
      mastra.addAgent(agent);
    } catch {
      // Ignore duplicate registration errors
    }
  }
}
