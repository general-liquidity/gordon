/**
 * Goal Drafter Diagnostic Tool — GE1 wrapper.
 *
 * Agent-callable. The agent gathers context (recent realized Sharpe /
 * win rate / trade count / drawdown, active mandate exclusions) and
 * calls this tool with the operator's vague intent. Returns a
 * proposed `/goal X until Y without Z` text in the existing parser
 * grammar, plus rationale per clause and a confidence rating.
 *
 * The operator reviews the proposal and decides whether to set it via
 * the existing `/goal` slash command. This tool does NOT set the goal.
 */

import { createTool } from "@mastra/core/tools";
import { z } from "zod";

import {
  composeGoalDraft,
  goalDraftToPayload,
} from "../../../../core/pipeline/goalDraft.ts";
import { recordStructuredObservation } from "../../../platform/observability/structured.ts";

export const goalDraftDiagnosticTool = createTool({
  id: "compose_goal_draft",
  description:
    "Compose a measurable /goal proposal from an operator's vague intent. Returns 'X until Y without Z' text " +
    "grounded in recent performance stats (caller-supplied) and active-mandate exclusions. " +
    "Use when the operator's framing is too fuzzy to set directly (e.g., 'make money this week'). " +
    "The operator reviews the proposal and decides whether to set it — this tool does NOT set the goal.",
  inputSchema: z.object({
    vagueIntent: z
      .string()
      .min(1)
      .describe("Operator's free-form intent (e.g., 'improve Sharpe', 'limit drawdown this week')."),
    recentStats: z
      .object({
        sharpe: z.number().optional(),
        winRatePct: z.number().min(0).max(100).optional(),
        tradeCount: z.number().int().min(0).optional(),
        maxDrawdownPct: z.number().min(0).optional(),
      })
      .optional()
      .describe("Recent performance stats over a caller-defined window. Used to ground thresholds."),
    activeMandateExclusions: z
      .array(z.string())
      .optional()
      .describe("Constraints from the active mandate (carried into the 'without' clause)."),
    preferredHorizon: z
      .enum(["hours", "days", "weeks"])
      .optional()
      .describe("Preferred horizon for time-bounded goals. Default 'days'."),
  }),
  outputSchema: z.object({
    proposedGoalText: z.string(),
    proposedObjective: z.string(),
    proposedEndState: z.object({
      type: z.enum([
        "sharpe",
        "winrate",
        "trades",
        "drawdown_under",
        "time_horizon",
        "checklist",
        "custom",
      ]),
      threshold: z.union([z.number(), z.string()]),
      rationale: z.string(),
    }),
    proposedConstraints: z.array(z.string()),
    confidence: z.enum(["high", "medium", "low"]),
    rationale: z.object({
      objective: z.string(),
      endState: z.string(),
      constraints: z.string(),
    }),
    reasoning: z.string(),
    summary: z.string(),
  }),
  execute: async (input) => {
    const result = composeGoalDraft({
      vagueIntent: input.vagueIntent,
      recentStats: input.recentStats,
      activeMandateExclusions: input.activeMandateExclusions,
      preferredHorizon: input.preferredHorizon,
    });
    recordStructuredObservation({
      eventType: "goal_draft.composed",
      workflow: "goal_authoring",
      source: "agent_tool",
      component: "compose_goal_draft",
      toolName: "compose_goal_draft",
      outcome: "info",
      details: { ...(goalDraftToPayload(result) as Record<string, unknown>) },
    });
    return {
      proposedGoalText: result.proposedGoalText,
      proposedObjective: result.proposedObjective,
      proposedEndState: result.proposedEndState,
      proposedConstraints: [...result.proposedConstraints],
      confidence: result.confidence,
      rationale: result.rationale,
      reasoning: result.reasoning,
      summary: result.reasoning,
    };
  },
});

export const goalDraftTools = {
  compose_goal_draft: goalDraftDiagnosticTool,
};
