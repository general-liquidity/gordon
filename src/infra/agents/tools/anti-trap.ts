/**
 * Anti-trap tools — supervision-preservation primitives.
 *
 * Companion tools for the GORDON_EXPLAIN_FIRST / GORDON_SUPERVISION_RUST_RATE
 * flags. These let the agent capture the user's pre-articulated thesis
 * before execution and (optionally) record calibration outcomes for the
 * supervision-rust check.
 */

import { createTool } from "@mastra/core/tools";
import { z } from "zod";

import { recordStructuredObservation } from "../../platform/observability/index.ts";
import {
  recordUserThesis,
  newSupervisionRecord,
  recordSupervisionResult,
  readSupervisionScore,
  type FlawType,
} from "../../safety/index.ts";

export const recordUserThesisTool = createTool({
  id: "record_user_thesis",
  description:
    "Record the user's own thesis for a plan BEFORE revealing Gordon's analysis. " +
    "Under GORDON_EXPLAIN_FIRST mode, execute_plan refuses to run until this is captured. " +
    "Ask the user to articulate why this setup makes sense in their own words (>=10 chars), " +
    "then call this tool with their verbatim response. This builds supervision skill instead of " +
    "eroding it — anti-atrophy defense from the 'agentic coding is a trap' critique applied to trading.",
  inputSchema: z.object({
    planId: z.string().min(1).describe("The plan ID this thesis belongs to."),
    thesis: z
      .string()
      .min(10, {
        message:
          "thesis must be at least 10 characters and reflect the USER'S reasoning (verbatim), " +
          "not the agent's summary. If the user did not articulate one, ask them — do not " +
          "fabricate it on their behalf.",
      })
      .describe("The user's verbatim thesis in their own words."),
    source: z.enum(["user_input", "agent_summarized"]).optional()
      .describe(
        "How the thesis was captured. Default 'user_input'. Use 'agent_summarized' " +
        "only if the user explicitly delegated summarization — divergence will be logged.",
      ),
  }),
  outputSchema: z.object({
    captured: z.boolean(),
    planId: z.string(),
    thesisLength: z.number(),
    source: z.string(),
    capturedAt: z.string(),
  }),
  execute: async ({ planId, thesis, source }) => {
    const entry = recordUserThesis(planId, thesis, source ?? "user_input");
    recordStructuredObservation({
      eventType: "execution.thesis_captured",
      workflow: "execution",
      source: "agent_tool",
      component: "record_user_thesis",
      toolName: "record_user_thesis",
      outcome: "info",
      planId,
      details: {
        thesisLength: entry.thesis.length,
        source: entry.source,
      },
    });
    return {
      captured: true,
      planId: entry.planId,
      thesisLength: entry.thesis.length,
      source: entry.source,
      capturedAt: entry.capturedAt,
    };
  },
});

export const recordSupervisionOutcomeTool = createTool({
  id: "record_supervision_outcome",
  description:
    "Record the outcome of a supervision-rust calibration check — whether the user " +
    "caught (rejected) or missed (accepted) a deliberately-flawed plan. Use ONLY when " +
    "the surrounding system signals a flaw was injected; do not call speculatively. " +
    "Persists to ~/.gordon/supervision-rust.jsonl for catch-rate analysis.",
  inputSchema: z.object({
    flawId: z.string().describe("Identifier of the injected flaw."),
    flawType: z
      .enum([
        "wrong_direction",
        "excessive_size",
        "missing_stop",
        "inverted_rr",
        "stale_data",
      ])
      .describe("Category of the injected flaw."),
    planId: z.string().describe("Plan the flaw was injected into."),
    userAccepted: z
      .boolean()
      .describe("true if the user rubber-stamped the flawed plan (missed); false if caught."),
  }),
  outputSchema: z.object({
    recorded: z.boolean(),
    catchRate: z.number(),
    totalChecks: z.number(),
  }),
  execute: async ({ flawId, flawType, planId, userAccepted }) => {
    const rec = newSupervisionRecord(
      flawId,
      flawType as FlawType,
      planId,
      userAccepted,
    );
    recordSupervisionResult(rec);
    const score = readSupervisionScore();
    return {
      recorded: true,
      catchRate: score.catchRate,
      totalChecks: score.total,
    };
  },
});

export const antiTrapTools = {
  record_user_thesis: recordUserThesisTool,
  record_supervision_outcome: recordSupervisionOutcomeTool,
} as const;
