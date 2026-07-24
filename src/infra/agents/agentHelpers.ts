/**
 * Agent Helpers
 *
 * Shared utility functions used by per-agent definition files:
 * - resolveRuntimeModel: resolves the model config for an agent
 * - createModelResolver: factory binding a role to a resolver (FW6)
 * - formatModelLabel: formats a model config for logging
 * - registerObservability: registers an agent with the Mastra instance
 *
 * FW6 — Per-Subagent Model Overrides (Deep Agents parity).
 *
 * Each role (orchestrator / executor / researcher) can be assigned its
 * own model via env vars:
 *
 *   GORDON_MODEL_ORCHESTRATOR  (e.g. "anthropic:claude-sonnet-4-6")
 *   GORDON_MODEL_EXECUTOR      (e.g. "anthropic:claude-sonnet-4-6")
 *   GORDON_MODEL_RESEARCHER    (e.g. "anthropic:claude-haiku-4-5")
 *
 * Format: `provider:model` (single colon split). If no colon, the whole
 * string is treated as the model id and the default provider is used.
 *
 * Resolution order for each agent:
 *   1. Role-specific env var (GORDON_MODEL_<ROLE>)
 *   2. RequestContext-supplied GordonConfig (workflow-phase routing intact)
 *   3. Global env vars (GORDON_PROVIDER + GORDON_MODEL)
 *   4. Built-in defaults via getMastraModel()
 *
 * Workflow-phase routing (fast-tier scan/ops/compaction) still applies
 * AFTER the role override has been folded into the GordonConfig.
 *
 * Purely additive: if no role env vars are set, behavior is identical
 * to the pre-FW6 code path.
 */

import { Agent } from "@mastra/core/agent";
import { providerRegistry, type MastraModelConfig } from "../runtime/providers/registry.ts";
import { getMastraInstance } from "../platform/observability/tracing.ts";
import { determineWorkflowPhase, resolveModelForWorkflowPhase } from "./cognition/workflowPhase.ts";
import type { GordonConfig } from "../../types/index.ts";
import type { GordonContext } from "./types.ts";

/** FW6 — per-subagent role identifier. */
export type AgentRole = "orchestrator" | "executor" | "researcher";

/** Env-var slot per role. Keep in sync with AgentRole. */
const ROLE_ENV_VAR: Record<AgentRole, string> = {
  orchestrator: "GORDON_MODEL_ORCHESTRATOR",
  executor: "GORDON_MODEL_EXECUTOR",
  researcher: "GORDON_MODEL_RESEARCHER",
};

/** Model tier each role runs at by default. */
type ModelTier = "flagship" | "fast";

const ROLE_TIER: Record<AgentRole, ModelTier> = {
  orchestrator: "flagship",
  executor: "flagship",
  researcher: "fast",
};

/**
 * First-party fallback used only when no provider key is configured yet
 * (registry tier resolution throws). Keeps the executor + orchestrator on a
 * verified first-party model even before the operator sets a key.
 */
const FIRST_PARTY_FALLBACK: Record<ModelTier, ModelOverride> = {
  flagship: { provider: "anthropic", model: "claude-opus-4-8" },
  fast: { provider: "anthropic", model: "claude-haiku-4-5" },
};

/**
 * Per-role default model, applied only when no explicit config, role env
 * override, or global GORDON_MODEL/GORDON_PROVIDER is present.
 *
 * Provider-agnostic: the tier (flagship / fast) is resolved against whichever
 * first-party provider the operator has configured (GORDON_PROVIDER or the
 * first available key), so switching families — ANTHROPIC_API_KEY,
 * OPENAI_API_KEY, XAI_API_KEY, … — automatically moves every role onto that
 * family's latest tier models. The registry tier helpers only ever return
 * first-party providers, so the executor is never routed to a gateway /
 * unverified host by default.
 */
function roleDefaultModel(role: AgentRole): ModelOverride {
  const tier = ROLE_TIER[role];
  try {
    const spec = tier === "fast"
      ? providerRegistry.getFastModel()
      : providerRegistry.getDefaultModel();
    const slash = spec.indexOf("/");
    if (slash > 0) {
      return { provider: spec.slice(0, slash), model: spec.slice(slash + 1) };
    }
  } catch {
    // No provider configured yet — fall through to the first-party fallback.
  }
  return FIRST_PARTY_FALLBACK[tier];
}

interface ModelOverride {
  provider?: string;
  model?: string;
}

/**
 * Parse a `provider:model` (or bare `model`) string into a partial
 * GordonConfig.modelConfig. Returns undefined for empty/blank input.
 *
 * Examples:
 *   "anthropic:claude-haiku-4-5"  → { provider: "anthropic", model: "claude-haiku-4-5" }
 *   "openai/anthropic/claude-...  → { provider: "openai", model: "anthropic/claude-..." }
 *                                   (multi-segment model id; first colon splits)
 *   "claude-sonnet-4-6"           → { model: "claude-sonnet-4-6" } (no provider)
 *   ""                            → undefined
 */
export function parseModelOverride(raw: string | undefined): ModelOverride | undefined {
  if (typeof raw !== "string") return undefined;
  const trimmed = raw.trim();
  if (trimmed.length === 0) return undefined;
  const colonIdx = trimmed.indexOf(":");
  if (colonIdx === -1) {
    return { model: trimmed };
  }
  const provider = trimmed.slice(0, colonIdx).trim();
  const model = trimmed.slice(colonIdx + 1).trim();
  const result: ModelOverride = {};
  if (provider.length > 0) result.provider = provider;
  if (model.length > 0) result.model = model;
  return Object.keys(result).length > 0 ? result : undefined;
}

/**
 * Read the role-specific env-var override for `role`. Returns undefined
 * when no override is set. Exposed for tests.
 */
export function getRoleModelOverride(
  role: AgentRole,
  env: NodeJS.ProcessEnv = process.env,
): ModelOverride | undefined {
  return parseModelOverride(env[ROLE_ENV_VAR[role]]);
}

/**
 * Resolve the model configuration at runtime, supporting workflow-phase
 * routing and (FW6) per-role overrides.
 *
 * When called without arguments, returns a static model config (used by
 * Gordon for logging). When called as a Mastra model resolver (with
 * requestContext), resolves dynamically per turn.
 *
 * @param args     Mastra resolver args (optional)
 * @param agentRole Per-subagent role for env-var override lookup (FW6).
 *                  When omitted, no role-specific override is applied.
 */
export function resolveRuntimeModel(
  args?: { requestContext?: { get: (key: string) => unknown } },
  agentRole?: AgentRole,
): MastraModelConfig {
  const requestConfig = args?.requestContext?.get?.("config") as GordonConfig | undefined;
  const requestedActionId = args?.requestContext?.get?.("requestedActionId") as GordonContext["requestedActionId"];
  const requestedTaskScope = args?.requestContext?.get?.("requestedTaskScope") as GordonContext["requestedTaskScope"];
  const workflowPhase = determineWorkflowPhase({
    requestedActionId,
    requestedTaskScope,
  });

  // FW6: layer role-specific override on top of the resolved config.
  // The override only fills fields that aren't explicitly set in the
  // requestContext config, so explicit per-call config still wins. Env
  // var overrides win over global GORDON_MODEL/GORDON_PROVIDER.
  const roleOverride = agentRole ? getRoleModelOverride(agentRole) : undefined;
  const roleDefault = agentRole ? roleDefaultModel(agentRole) : undefined;
  const baseModelConfig: ModelOverride = {
    provider:
      requestConfig?.modelConfig?.provider ??
      roleOverride?.provider ??
      process.env.GORDON_PROVIDER ??
      roleDefault?.provider,
    model:
      requestConfig?.modelConfig?.model ??
      roleOverride?.model ??
      process.env.GORDON_MODEL ??
      roleDefault?.model,
  };

  return resolveModelForWorkflowPhase(
    {
      ...(requestConfig ?? {}),
      modelConfig: baseModelConfig,
    } as GordonConfig,
    workflowPhase,
  );
}

/**
 * FW6 — Factory that returns a Mastra-compatible model resolver bound to
 * a specific agent role. Use in Agent constructors:
 *
 *   new Agent({
 *     id: "executor",
 *     model: createModelResolver("executor"),
 *     ...
 *   });
 *
 * The returned function calls `resolveRuntimeModel(args, role)` so per-
 * role env-var overrides apply on every Mastra model-resolution callback.
 */
export function createModelResolver(
  role: AgentRole,
): (args?: { requestContext?: { get: (key: string) => unknown } }) => MastraModelConfig {
  return (args) => resolveRuntimeModel(args, role);
}

/**
 * Format a model config for human-readable logging.
 */
export function formatModelLabel(model: MastraModelConfig): string {
  if (typeof model === "string") {
    return model;
  }

  if (typeof model.id === "string" && model.id.length > 0) {
    const url =
      typeof model.url === "string" && model.url.length > 0 ? model.url : undefined;
    return url ? `${model.id} @ ${url}` : model.id;
  }

  return JSON.stringify(model);
}

/**
 * Register an agent with the Mastra instance for observability tracing.
 * When tracing is enabled, this wires agent.#mastra so that generate()/stream()
 * calls automatically create Mastra spans (agent_run, tool_call, etc.).
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

/** Re-wire all lazy agents after tracing initializes mid-session. */
export async function registerAllAgentsForTracing(): Promise<void> {
  if (!getMastraInstance()) return;
  try {
    const { getGordon, getExecutor, getResearcher } = await import("./definitions/index.ts");
    for (const getter of [getGordon, getExecutor, getResearcher]) {
      registerObservability(getter());
    }
  } catch {
    // Agents may not be loadable in headless/test contexts
  }
}
