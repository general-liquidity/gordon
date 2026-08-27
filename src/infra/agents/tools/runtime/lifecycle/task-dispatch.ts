/**
 * FW7 — `delegate_to_subagent` tool.
 *
 * Surfaces operator-authored subagent profiles to the orchestrator.
 * Given a profile name + a task description, the tool dispatches via
 * `subagentDispatcher` and returns the TaskNotification envelope.
 *
 * Construction-time concerns:
 *   - Profile list is loaded once at startup. Adding a new profile
 *     requires a Gordon restart (mirrors Deep Agents' static
 *     subagents array).
 *   - The tool description enumerates available profiles so the model
 *     can pick the right role. When no profiles are configured, the
 *     tool is registered with an "empty-set" description so the model
 *     still sees the capability but never picks it.
 *
 * Runtime concerns:
 *   - The tool itself is always registered. Whether it actually
 *     dispatches depends on:
 *       (1) profile exists for the requested role
 *       (2) profile is not deprecated
 *       (3) GORDON_DYNAMIC_SUBAGENTS=1 (feature flag for live dispatch)
 *     Failure modes return structured TaskNotification, never throw.
 *   - Read-only tool filtering is enforced inside dispatchSubagentTask;
 *     the orchestrator cannot bypass it by passing a different
 *     toolRegistry.
 */

import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import {
  dispatchSubagentTask,
  isDynamicSubagentsEnabled,
  type DispatchResult,
} from "../../../profiles/subagentDispatcher.ts";
import type { SubagentProfile } from "../../../profiles/subagentProfile.ts";

/**
 * Build the `delegate_to_subagent` tool given the loaded profile set
 * + the read-only tool registry the dispatcher should resolve against.
 *
 * The profiles map is read once at tool construction. To pick up new
 * profiles the operator must restart Gordon.
 */
export function buildTaskDispatchTool(
  profiles: ReadonlyMap<string, SubagentProfile>,
  readOnlyToolRegistry: Record<string, unknown>,
) {
  const activeProfiles = [...profiles.values()].filter((p) => p.status !== "deprecated");

  const roleList =
    activeProfiles.length === 0
      ? "(no profiles configured — set up .claude/subagents/*.json files to enable delegation)"
      : activeProfiles.map((p) => `'${p.name}' — ${p.description}`).join("\n  • ");

  const description = [
    "Delegate a task to an operator-defined subagent. Use when the work",
    "fits a specialized role better than direct orchestrator handling.",
    "Subagents are READ-ONLY — they cannot place trades or mutate state.",
    "",
    "Available roles:",
    `  • ${roleList}`,
    "",
    "Pick the role whose description best matches the task. If no role",
    "matches, decline and handle the task directly instead of forcing a",
    "poor fit. The subagent returns a structured task notification with",
    "completed/failed status + summary + result.",
  ].join("\n");

  // Patch 1 — Role schema is a zod enum drawn from active profile
  // names so the model cannot emit a tool call referencing a
  // nonexistent role. Falls back to z.string() ONLY when the active
  // set is empty (which the caller's shouldRegisterTaskDispatchTool
  // gate already prevents, but we keep the fallback for type-safety in
  // unit-test scenarios where tests construct the tool with an empty
  // profile map directly).
  const roleNames = activeProfiles.map((p) => p.name);
  const roleSchema =
    roleNames.length > 0
      ? z
          .enum(roleNames as [string, ...string[]])
          .describe(
            "Profile name — must be one of the configured subagent roles. Schema-narrowed so the model cannot hallucinate.",
          )
      : z.string().min(1).describe("Profile name — (no profiles configured at tool-build time).");

  return createTool({
    id: "delegate_to_subagent",
    description,
    inputSchema: z.object({
      role: roleSchema,
      task: z
        .string()
        .min(1)
        .describe(
          "What you want the subagent to do. Self-contained — the subagent does not see the parent's conversation.",
        ),
    }),
    outputSchema: z.object({
      status: z.enum(["completed", "failed", "refused", "disabled"]),
      subagentId: z.string(),
      summary: z.string(),
      result: z.string().optional(),
      error: z.string().optional(),
      toolsAllowed: z.number(),
      toolsBlocked: z.number(),
      toolsUnmatched: z.number(),
    }),
    execute: async ({ role, task }: { role: string; task: string }) => {
      const profile = profiles.get(role);

      if (!profile) {
        const available = [...profiles.keys()].join(", ");
        const summary = `Unknown role '${role}'. Available: ${available || "(none)"}`;
        return {
          status: "refused" as const,
          subagentId: "n/a",
          summary,
          error: summary,
          toolsAllowed: 0,
          toolsBlocked: 0,
          toolsUnmatched: 0,
        };
      }

      const result: DispatchResult = await dispatchSubagentTask(
        profile,
        task,
        readOnlyToolRegistry,
      );

      return {
        status: result.status,
        subagentId: result.subagentId,
        summary: result.notification,
        ...(result.text !== undefined && { result: result.text }),
        ...(result.error !== undefined && { error: result.error }),
        toolsAllowed: result.toolFilter.allowed.length,
        toolsBlocked: result.toolFilter.blocked.length,
        toolsUnmatched: result.toolFilter.unmatched.length,
      };
    },
  });
}

/**
 * Convenience predicate so other modules can decide whether to wire
 * the dispatch tool at all. When false (no profiles + flag off) the
 * orchestrator can skip registration entirely.
 */
export function shouldRegisterTaskDispatchTool(
  profiles: ReadonlyMap<string, SubagentProfile>,
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  if (profiles.size > 0) return true;
  return isDynamicSubagentsEnabled(env);
}
