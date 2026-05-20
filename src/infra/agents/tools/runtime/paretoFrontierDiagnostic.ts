/**
 * Pareto Frontier Diagnostic Tool — PF1 wrapper.
 *
 * Agent-callable. Given a set of candidates with K numeric objectives
 * each plus a per-objective direction (maximize/minimize), returns
 * the non-dominated set + per-candidate dominators map. Use for
 * multi-objective comparison where single-scalar scoring loses
 * information (Sharpe vs drawdown, accuracy vs context-cost,
 * profit-factor vs win-rate, etc.).
 */

import { createTool } from "@mastra/core/tools";
import { z } from "zod";

import {
  computeParetoFrontier,
  paretoFrontierToPayload,
} from "../../../trading/quant/paretoFrontier.ts";
import { recordStructuredObservation } from "../../../platform/observability/structured.ts";

const CANDIDATE_SCHEMA = z.object({
  id: z.string().min(1),
  objectives: z.record(z.string(), z.number()),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

const DIRECTION_SCHEMA = z.record(z.string(), z.enum(["maximize", "minimize"]));

export const paretoFrontierDiagnosticTool = createTool({
  id: "compute_pareto_frontier",
  description:
    "Compute the Pareto frontier (non-dominated set) over candidates with K numeric objectives. " +
    "A dominates B iff A is ≥ B on every objective AND > B on at least one (using each objective's " +
    "maximize/minimize direction). Returns frontier + dominated lists + dominationMap. " +
    "Use for multi-objective comparison: strategy evaluation (Sharpe vs drawdown), edit verification " +
    "(predicted vector vs realized), harnessEvolution multi-objective selection, ACE lesson scoring " +
    "(score vs context-cost).",
  inputSchema: z.object({
    candidates: z
      .array(CANDIDATE_SCHEMA)
      .min(1)
      .describe("Candidates with id + objectives + optional metadata. Ids must be unique."),
    directions: DIRECTION_SCHEMA.describe(
      "Per-objective direction. Every objective key used in candidates must appear here.",
    ),
  }),
  outputSchema: z.object({
    frontier: z.array(CANDIDATE_SCHEMA),
    dominated: z.array(CANDIDATE_SCHEMA),
    dominationMap: z.record(z.string(), z.array(z.string())),
    nCandidates: z.number(),
    nFrontier: z.number(),
    objectives: z.array(z.string()),
    reasoning: z.string(),
    summary: z.string(),
  }),
  execute: async (input) => {
    const result = computeParetoFrontier({
      candidates: input.candidates,
      directions: input.directions,
    });
    recordStructuredObservation({
      eventType: "pareto_frontier.computed",
      workflow: "multi_objective_evaluation",
      source: "agent_tool",
      component: "compute_pareto_frontier",
      toolName: "compute_pareto_frontier",
      outcome: "info",
      details: { ...(paretoFrontierToPayload(result) as Record<string, unknown>) },
    });
    return {
      ...result,
      summary: result.reasoning,
    };
  },
});

export const paretoFrontierTools = {
  compute_pareto_frontier: paretoFrontierDiagnosticTool,
};
