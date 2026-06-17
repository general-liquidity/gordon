/**
 * FW7 — `delegate_to_subagents_parallel` tool.
 *
 * The fan-out sibling of `delegate_to_subagent`: dispatches a BATCH of
 * read-only subagent tasks concurrently and returns a gathered digest.
 * Implements the 2026 orchestrator-worker consensus — isolated read-only
 * subagents, self-contained briefs, no peer channel — over `subagentFanout`.
 *
 * Same hard invariants as the singular tool (read-only filtering, strict
 * permission mode, bounded turns) flow through `dispatchSubagentTask`. This
 * tool can NEVER fan out execution: it is for breadth-first READ/research
 * only. The orchestrator synthesizes the gather itself — splitting a trade
 * DECISION across parallel agents is exactly the failure mode the research
 * warns against, so the write path stays single-threaded by construction.
 *
 * Gated identically to the singular tool via `shouldRegisterTaskDispatchTool`
 * + the `GORDON_DYNAMIC_SUBAGENTS` runtime check inside the dispatcher.
 */

import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import {
  fanoutSubagentTasks,
  MAX_FANOUT_TASKS,
  MAX_FANOUT_CONCURRENCY,
} from "../../../profiles/subagentFanout.ts";
import type { SubagentProfile } from "../../../profiles/subagentProfile.ts";

/**
 * Build the `delegate_to_subagents_parallel` tool given the loaded profile
 * set + the read-only tool registry the dispatcher resolves against.
 */
export function buildTaskFanoutTool(
  profiles: ReadonlyMap<string, SubagentProfile>,
  readOnlyToolRegistry: Record<string, unknown>,
) {
  const activeProfiles = [...profiles.values()].filter((p) => p.status !== "deprecated");
  const roleList =
    activeProfiles.length === 0
      ? "(no profiles configured — set up .claude/subagents/*.json files to enable delegation)"
      : activeProfiles.map((p) => `'${p.name}' — ${p.description}`).join("\n  • ");

  const description = [
    "Run several READ-ONLY subagent research tasks IN PARALLEL and gather their summaries.",
    "Use for breadth-first work that genuinely parallelizes — scan N tickers, test N",
    "independent hypotheses, research N sources at once — where the tasks DON'T depend on",
    "each other. Each subagent is read-only, isolated (it sees only its own brief, not the",
    "conversation or its siblings), and bounded. They CANNOT place trades or mutate state.",
    "",
    "You synthesize the gathered digest yourself. Do NOT use this to split a trade decision",
    `across agents — parallel deciders produce incoherent results. Max ${MAX_FANOUT_TASKS} tasks.`,
    "",
    "Available roles:",
    `  • ${roleList}`,
  ].join("\n");

  const roleNames = activeProfiles.map((p) => p.name);
  const roleSchema =
    roleNames.length > 0
      ? z
          .enum(roleNames as [string, ...string[]])
          .describe("Profile name — must be one of the configured subagent roles.")
      : z.string().min(1).describe("Profile name — (no profiles configured at tool-build time).");

  return createTool({
    id: "delegate_to_subagents_parallel",
    description,
    inputSchema: z.object({
      tasks: z
        .array(
          z.object({
            role: roleSchema,
            task: z
              .string()
              .min(1)
              .describe("Self-contained brief: objective + scope. The subagent sees ONLY this."),
            label: z.string().optional().describe("Optional short label for the gather (e.g. the ticker)."),
          }),
        )
        .min(1)
        .max(MAX_FANOUT_TASKS)
        .describe("Independent read-only research tasks to run concurrently."),
      concurrency: z
        .number()
        .int()
        .min(1)
        .max(MAX_FANOUT_CONCURRENCY)
        .optional()
        .describe(`Max subagents at once (default 4, ceiling ${MAX_FANOUT_CONCURRENCY}). Mind the token cost.`),
    }),
    outputSchema: z.object({
      total: z.number(),
      dropped: z.number(),
      completed: z.number(),
      failed: z.number(),
      refused: z.number(),
      disabled: z.number(),
      concurrency: z.number(),
      digest: z.string(),
      usage: z.object({ inputTokens: z.number(), outputTokens: z.number() }),
      items: z.array(
        z.object({
          role: z.string(),
          label: z.string().optional(),
          status: z.enum(["completed", "failed", "refused", "disabled"]),
          subagentId: z.string(),
          result: z.string().optional(),
          error: z.string().optional(),
        }),
      ),
    }),
    execute: async ({
      tasks,
      concurrency,
    }: {
      tasks: { role: string; task: string; label?: string }[];
      concurrency?: number;
    }) => {
      const report = await fanoutSubagentTasks(profiles, tasks, readOnlyToolRegistry, { concurrency });
      return {
        total: report.total,
        dropped: report.dropped,
        completed: report.completed,
        failed: report.failed,
        refused: report.refused,
        disabled: report.disabled,
        concurrency: report.concurrency,
        digest: report.digest,
        usage: report.usage,
        items: report.items.map((it) => ({
          role: it.role,
          ...(it.label !== undefined && { label: it.label }),
          status: it.result.status,
          subagentId: it.result.subagentId,
          ...(it.result.text !== undefined && { result: it.result.text }),
          ...(it.result.error !== undefined && { error: it.result.error }),
        })),
      };
    },
  });
}
