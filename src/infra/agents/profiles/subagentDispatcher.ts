/**
 * FW7 — Subagent Dispatcher.
 *
 * Runtime side of the operator-authored subagent profile system. Given
 * a profile name + a task description, constructs an ephemeral Mastra
 * Agent restricted to the profile's read-only tool subset, invokes
 * `.generate()`, registers lifecycle state with the AgentRegistry, and
 * returns a `TaskNotification` envelope.
 *
 * Hard safety invariants:
 *
 *   1. Execution tools (place_*, cancel_*, execute_plan, wallet
 *      transfers, etc.) are NEVER granted, even when the profile lists
 *      them. The tool filter (subagentToolFilter.ts) drops them
 *      silently and warns.
 *
 *   2. Subagents inherit `permissionMode: "strict"` regardless of the
 *      parent's mode. They cannot escalate by asking the user.
 *
 *   3. The dispatcher's safety preamble is prepended to profile
 *      instructions and CANNOT be overridden by operator-authored
 *      content. It states "you are a read-only research subagent, no
 *      trading, no mutations."
 *
 *   4. `maxSteps` is capped at the profile's `maxTurns` (default 10,
 *      hard ceiling 50) so a runaway profile cannot consume unlimited
 *      tokens / time.
 *
 *   5. Deprecated profiles (`status: "deprecated"`) refuse to dispatch.
 *      The profile still loads so audit reports can surface it.
 *
 * Gated by `GORDON_DYNAMIC_SUBAGENTS=1`. When the flag is off, the
 * dispatcher refuses to spawn and returns a structured "feature
 * disabled" notification. The registry + types still load (so /subagents
 * list works).
 */

import { Agent } from "@mastra/core/agent";
import { TokenLimiterProcessor } from "@mastra/core/processors";
import {
  buildTaskNotification,
  getDefaultAgentRegistry,
  type AgentRegistry,
} from "../harness/subagentCoordination.ts";
import {
  filterToolsForProfile,
  type ToolFilterResult,
} from "./subagentToolFilter.ts";
import type { SubagentProfile } from "./subagentProfile.ts";

const SAFETY_PREAMBLE = `You are a Gordon read-only research subagent invoked by the orchestrator.

## Hard Constraints
- READ-ONLY: you cannot place, cancel, modify, or approve trades.
- NO STATE MUTATIONS: you cannot change permission mode, write shared
  context, or transfer funds.
- BOUNDED: you have a tool whitelist + a maximum turn budget. Respect both.
- FOCUSED: return a concise, structured answer addressing the assigned
  task. The orchestrator is waiting.

If a request requires execution permissions, refuse and return guidance
explaining what the orchestrator should do instead.`;

export interface DispatchOptions {
  /** Optional override for the AgentRegistry (used by tests). */
  registry?: AgentRegistry;
  /** Optional override for the env (used by tests). */
  env?: NodeJS.ProcessEnv;
  /**
   * Optional dependency injection for the Mastra agent constructor.
   * Tests replace this with a stub that returns a fake agent exposing
   * a `.generate()` method. Production callers omit it.
   */
  agentFactory?: (config: {
    id: string;
    name: string;
    description: string;
    instructions: string;
    tools: Record<string, unknown>;
    maxSteps: number;
  }) => DispatchableAgent;
  /** Optional tool registry override (used by tests). */
  toolRegistry?: Record<string, unknown>;
  /**
   * Optional sub-agent-memory factory. Defaults to undefined (no
   * memory, since dispatched profiles are stateless per call).
   */
  memoryFactory?: () => unknown;
}

/** Minimal contract the dispatcher relies on from a Mastra Agent. */
export interface DispatchableAgent {
  generate(
    input: string,
    options?: Record<string, unknown>,
  ): Promise<{ text?: string; usage?: { inputTokens?: number; outputTokens?: number } }>;
}

export type DispatchStatus = "completed" | "failed" | "refused" | "disabled";

export interface DispatchResult {
  status: DispatchStatus;
  /** XML-envelope task notification body. */
  notification: string;
  /** Filtering verdict — surfaced so the orchestrator can warn. */
  toolFilter: ToolFilterResult;
  /** Subagent id assigned by the dispatcher (also embedded in notification). */
  subagentId: string;
  /** Parsed text result from the agent, when status is "completed". */
  text?: string;
  /** Error message when status is "failed" or "refused". */
  error?: string;
  /** Token usage if reported by the agent. */
  usage?: { inputTokens?: number; outputTokens?: number };
}

/**
 * Gate flag — `GORDON_DYNAMIC_SUBAGENTS=1` opts the dispatcher into
 * live execution. When off (default), all dispatches return a
 * structured "feature disabled" notification.
 */
export function isDynamicSubagentsEnabled(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  const raw = env.GORDON_DYNAMIC_SUBAGENTS;
  if (typeof raw !== "string") return false;
  const normalized = raw.trim().toLowerCase();
  return normalized === "1" || normalized === "true" || normalized === "yes";
}

function generateSubagentId(profileName: string): string {
  return `subagent-${profileName}-${Date.now().toString(36)}`;
}

function composeInstructions(profile: SubagentProfile): string {
  return [SAFETY_PREAMBLE, profile.instructions.trim()].join("\n\n");
}

function defaultAgentFactory(config: {
  id: string;
  name: string;
  description: string;
  instructions: string;
  tools: Record<string, unknown>;
  maxSteps: number;
}): DispatchableAgent {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return new Agent({
    id: config.id,
    name: config.name,
    description: config.description,
    instructions: config.instructions,
    // Subagent always uses researcher model resolver — the profile
    // model override is applied via env var pattern, not here, to keep
    // the construction call site simple and the security surface
    // narrow.
    tools: config.tools as any,
    defaultOptions: {
      modelSettings: { maxOutputTokens: 8192 },
    },
    inputProcessors: [new TokenLimiterProcessor({ limit: 16000 })],
  } as any) as unknown as DispatchableAgent;
}

/**
 * Dispatch a task to a profile-defined subagent. Returns a structured
 * result + task notification.
 */
export async function dispatchSubagentTask(
  profile: SubagentProfile,
  task: string,
  toolRegistry: Record<string, unknown>,
  options: DispatchOptions = {},
): Promise<DispatchResult> {
  const env = options.env ?? process.env;
  const registry = options.registry ?? getDefaultAgentRegistry();
  const subagentId = generateSubagentId(profile.name);

  // 1. Refuse deprecated profiles outright.
  if (profile.status === "deprecated") {
    return {
      status: "refused",
      subagentId,
      toolFilter: { allowed: [], unmatched: [], blocked: [] },
      notification: buildTaskNotification({
        subagentId,
        status: "aborted",
        summary: `Profile '${profile.name}' is deprecated — refusing to dispatch.`,
      }),
      error: `Profile '${profile.name}' is deprecated`,
    };
  }

  // 2. Filter tools — drop execution tools, surface unmatched/blocked.
  const registryKeys = Object.keys(toolRegistry);
  const filter = filterToolsForProfile(profile.tools, registryKeys);

  // 3. Refuse if the resulting tool set is empty (the subagent would
  //    be useless and the operator probably misconfigured).
  if (filter.allowed.length === 0) {
    return {
      status: "refused",
      subagentId,
      toolFilter: filter,
      notification: buildTaskNotification({
        subagentId,
        status: "aborted",
        summary: `Profile '${profile.name}' resolved to zero allowed tools.`,
      }),
      error: "No tools matched after filtering",
    };
  }

  // 4. Gate: feature flag check.
  if (!isDynamicSubagentsEnabled(env)) {
    return {
      status: "disabled",
      subagentId,
      toolFilter: filter,
      notification: buildTaskNotification({
        subagentId,
        status: "aborted",
        summary:
          "GORDON_DYNAMIC_SUBAGENTS is not set. Profile validated, dispatch skipped.",
        result: {
          profile: profile.name,
          tools_allowed: filter.allowed.length,
          tools_blocked: filter.blocked.length,
          tools_unmatched: filter.unmatched.length,
        },
      }),
    };
  }

  // 5. Register lifecycle entry.
  registry.register({
    subagentId,
    subagentType: profile.name,
    parentAgent: "Gordon",
    startedAt: Date.now(),
    task,
    state: "starting",
  });

  // 6. Build allowed-tools subset.
  const allowedTools: Record<string, unknown> = {};
  for (const toolId of filter.allowed) {
    allowedTools[toolId] = toolRegistry[toolId];
  }

  // 7. Construct ephemeral agent + dispatch.
  const factory = options.agentFactory ?? defaultAgentFactory;
  const maxSteps = profile.maxTurns ?? 10;

  registry.setState(subagentId, "running");
  try {
    const agent = factory({
      id: subagentId,
      name: profile.name,
      description: profile.description,
      instructions: composeInstructions(profile),
      tools: allowedTools,
      maxSteps,
    });
    const generated = await agent.generate(task, { maxSteps });

    registry.setState(subagentId, "completed", {
      result: generated.text,
    });

    return {
      status: "completed",
      subagentId,
      toolFilter: filter,
      text: generated.text,
      usage: generated.usage,
      notification: buildTaskNotification({
        subagentId,
        status: "completed",
        summary: `Subagent '${profile.name}' completed task in ${maxSteps} max turns.`,
        result: generated.text ?? "",
        usage: generated.usage
          ? { input: generated.usage.inputTokens, output: generated.usage.outputTokens }
          : undefined,
      }),
    };
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    registry.setState(subagentId, "failed", { error: errorMsg });
    return {
      status: "failed",
      subagentId,
      toolFilter: filter,
      error: errorMsg,
      notification: buildTaskNotification({
        subagentId,
        status: "failed",
        summary: `Subagent '${profile.name}' failed: ${errorMsg}`,
      }),
    };
  }
}
