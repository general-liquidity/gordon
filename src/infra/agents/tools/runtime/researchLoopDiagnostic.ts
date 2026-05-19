/**
 * Research Loop Diagnostic Tool — agent-internal, no slash command.
 *
 * Wraps `evaluateResearchLoop` so the researcher agent (and operator-
 * driven `/research stats`) can ask "given the candidate I just ran,
 * should I keep or revert, what's the new baseline, and what should
 * I propose next?"
 */

import { createTool } from "@mastra/core/tools";
import { z } from "zod";

import {
  evaluateResearchLoop,
  researchLoopToPayload,
} from "../../research/researchLoop.ts";
import { recordStructuredObservation } from "../../../platform/observability/structured.ts";

const experimentSchema = z.object({
  id: z.string(),
  parentId: z.string().nullable(),
  hypothesis: z.string(),
  score: z.number(),
  family: z.string(),
  timestamp: z.number().int(),
  status: z.enum(["candidate", "kept", "reverted", "errored"]),
});

export const researchLoopDiagnosticTool = createTool({
  id: "evaluate_research_loop",
  description:
    "Karpathy-style autoresearch keep/revert decision engine for a strategy experiment. " +
    "Given the experiment history and the candidate just completed, returns keep/revert/investigate, " +
    "the new baseline, curated history blocks for the next prompt, and a diversity-steering hint when " +
    "the recent window clusters in one strategy family.",
  inputSchema: z.object({
    experiments: z.array(experimentSchema).describe("Full experiment history, oldest first."),
    candidate: experimentSchema.describe("The just-completed candidate awaiting a verdict."),
    keepThreshold: z.number().default(0.0).describe("Minimum score delta to count as a keep. Default 0."),
    diversityWindow: z
      .number()
      .int()
      .positive()
      .default(6)
      .describe("Recent window for family-cluster detection. Default 6."),
    diversityClusterFraction: z
      .number()
      .min(0)
      .max(1)
      .default(0.66)
      .describe("Fraction of the window that must share a family to fire a diversity hint. Default 0.66."),
  }),
  outputSchema: z.object({
    decision: z.enum(["keep", "revert", "investigate"]),
    scoreDelta: z.number().nullable(),
    baselineId: z.string().nullable(),
    baselineScore: z.number().nullable(),
    topKeptIds: z.array(z.string()),
    diversityHint: z
      .object({
        dominantFamily: z.string(),
        saturation: z.number(),
        suggestedAlternatives: z.array(z.string()),
      })
      .nullable(),
    reasoning: z.string(),
    summary: z.string(),
  }),
  execute: async (input) => {
    const result = evaluateResearchLoop({
      experiments: input.experiments,
      candidate: input.candidate,
      keepThreshold: input.keepThreshold,
      diversityWindow: input.diversityWindow,
      diversityClusterFraction: input.diversityClusterFraction,
    });
    const summary = result.reasoning;
    recordStructuredObservation({
      eventType: "research_loop.evaluated",
      workflow: "execution",
      source: "agent_tool",
      component: "evaluate_research_loop",
      toolName: "evaluate_research_loop",
      outcome:
        result.decision === "keep"
          ? "success"
          : result.decision === "revert"
            ? "info"
            : "failure",
      details: { ...(researchLoopToPayload(result) as Record<string, unknown>) },
    });
    return {
      decision: result.decision,
      scoreDelta: Number.isFinite(result.scoreDelta) ? Number(result.scoreDelta.toFixed(4)) : null,
      baselineId: result.baseline?.id ?? null,
      baselineScore: result.baseline ? Number(result.baseline.score.toFixed(4)) : null,
      topKeptIds: result.curated.topKept.map((e) => e.id),
      diversityHint: result.diversityHint
        ? {
            dominantFamily: result.diversityHint.dominantFamily,
            saturation: Number(result.diversityHint.saturation.toFixed(3)),
            suggestedAlternatives: result.diversityHint.suggestedAlternatives,
          }
        : null,
      reasoning: result.reasoning,
      summary,
    };
  },
});

export const researchLoopTools = { evaluate_research_loop: researchLoopDiagnosticTool };
