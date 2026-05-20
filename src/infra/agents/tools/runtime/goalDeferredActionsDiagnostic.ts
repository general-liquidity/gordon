/**
 * Per-Goal Deferred-Actions Diagnostic Tools — GE3 wrappers.
 *
 * Two agent-callable tools persisting to ~/.gordon/goal-deferred.jsonl:
 *   - record_goal_deferred_action: append a structured record
 *   - list_goal_deferred_actions:  load + filter
 *
 * Captures observations or actions the operator wants to revisit
 * later but explicitly out of scope for the current `/goal`.
 */

import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { existsSync, mkdirSync, appendFileSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";

import {
  buildDeferredAction,
  filterDeferredActions,
  serializeForJsonl,
  parseFromJsonl,
  deferredActionToPayload,
  type DeferredAction,
} from "../../../../core/pipeline/goalDeferredActions.ts";
import { getGordonDir } from "../../../storage/paths.ts";
import { recordStructuredObservation } from "../../../platform/observability/structured.ts";

const DEFERRED_PATH_ENV = "GORDON_GOAL_DEFERRED_PATH";

function defaultDeferredPath(env: NodeJS.ProcessEnv = process.env): string {
  return env[DEFERRED_PATH_ENV] ?? join(getGordonDir(), "goal-deferred.jsonl");
}

const CATEGORY_ENUM = z.enum([
  "feature",
  "investigation",
  "data",
  "observation",
  "strategy",
  "other",
]);

export const recordGoalDeferredActionTool = createTool({
  id: "record_goal_deferred_action",
  description:
    "Record a deferred action scoped to the active /goal. Use when the operator surfaces an observation or " +
    "action worth revisiting later but explicitly out of scope for the current goal. " +
    "Persists to ~/.gordon/goal-deferred.jsonl (override via GORDON_GOAL_DEFERRED_PATH).",
  inputSchema: z.object({
    goalId: z.string().min(1).describe("Active goal ID."),
    action: z.string().min(5).describe("What the operator wants to do later (>=5 chars)."),
    rationale: z.string().min(5).describe("Why it's deferred from this goal (>=5 chars)."),
    category: CATEGORY_ENUM.optional().describe("Category bucket. Default 'other'."),
    tags: z.array(z.string()).optional().describe("Optional tags for searching."),
  }),
  outputSchema: z.object({
    recorded: z.boolean(),
    goalId: z.string(),
    action: z.string(),
    category: CATEGORY_ENUM,
    recordedAt: z.string(),
    filePath: z.string(),
    reasoning: z.string(),
    summary: z.string(),
  }),
  execute: async (input) => {
    const action = buildDeferredAction({
      goalId: input.goalId,
      action: input.action,
      rationale: input.rationale,
      category: input.category,
      tags: input.tags,
    });
    const path = defaultDeferredPath();
    mkdirSync(dirname(path), { recursive: true });
    appendFileSync(path, serializeForJsonl(action) + "\n", "utf8");

    recordStructuredObservation({
      eventType: "goal_deferred_action.recorded",
      workflow: "goal_management",
      source: "agent_tool",
      component: "record_goal_deferred_action",
      toolName: "record_goal_deferred_action",
      outcome: "info",
      details: { ...(deferredActionToPayload(action) as Record<string, unknown>) },
    });

    const reasoning =
      `recorded deferred action for goal ${action.goalId} (category=${action.category}, ` +
      `${action.tags?.length ?? 0} tags) at ${action.recordedAt} → ${path}.`;

    return {
      recorded: true,
      goalId: action.goalId,
      action: action.action,
      category: action.category,
      recordedAt: action.recordedAt,
      filePath: path,
      reasoning,
      summary: reasoning,
    };
  },
});

export const listGoalDeferredActionsTool = createTool({
  id: "list_goal_deferred_actions",
  description:
    "Load and filter deferred-action records from ~/.gordon/goal-deferred.jsonl. " +
    "Filters: goalId, category, time window (sinceMs/untilMs), anyTag. " +
    "Use to surface 'things the operator wanted to do later' when reviewing a goal or starting a follow-up goal.",
  inputSchema: z.object({
    goalId: z.string().optional().describe("Filter to a specific goal ID."),
    category: CATEGORY_ENUM.optional().describe("Filter by category."),
    sinceMs: z.number().optional().describe("Only entries recorded at or after this ms timestamp."),
    untilMs: z.number().optional().describe("Only entries recorded at or before this ms timestamp."),
    anyTag: z.array(z.string()).optional().describe("Match if any tag is in this list."),
    maxResults: z
      .number()
      .int()
      .positive()
      .optional()
      .describe("Cap returned entries. Default 100."),
  }),
  outputSchema: z.object({
    count: z.number(),
    actions: z.array(
      z.object({
        goalId: z.string(),
        action: z.string(),
        rationale: z.string(),
        category: CATEGORY_ENUM,
        recordedAt: z.string(),
        tags: z.array(z.string()).optional(),
      }),
    ),
    filePath: z.string(),
    summary: z.string(),
  }),
  execute: async (input) => {
    const path = defaultDeferredPath();
    const maxResults = input.maxResults ?? 100;
    let actions: DeferredAction[] = [];
    if (existsSync(path)) {
      const lines = readFileSync(path, "utf8")
        .split("\n")
        .filter((l) => l.trim().length > 0);
      for (const line of lines) {
        try {
          actions.push(parseFromJsonl(line));
        } catch {
          // Skip malformed lines silently — log is append-only and may
          // contain partial writes; we don't want one bad line to fail
          // the whole load.
          continue;
        }
      }
    }
    const filtered = filterDeferredActions(actions, {
      goalId: input.goalId,
      category: input.category,
      sinceMs: input.sinceMs,
      untilMs: input.untilMs,
      anyTag: input.anyTag,
    }).slice(0, maxResults);

    const summary =
      `loaded ${actions.length} deferred actions from ${path}; ${filtered.length} after filter.`;

    return {
      count: filtered.length,
      actions: filtered.map((a) => ({
        goalId: a.goalId,
        action: a.action,
        rationale: a.rationale,
        category: a.category,
        recordedAt: a.recordedAt,
        tags: a.tags ? [...a.tags] : undefined,
      })),
      filePath: path,
      summary,
    };
  },
});

export const goalDeferredActionsTools = {
  record_goal_deferred_action: recordGoalDeferredActionTool,
  list_goal_deferred_actions: listGoalDeferredActionsTool,
};
