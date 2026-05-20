/**
 * Goal-Mandate Linkage Diagnostic Tool — GE2 wrapper.
 *
 * Agent-callable. Reads the mandate file at the supplied path,
 * computes its hash + snapshot timestamp, and returns a structured
 * link record. Optionally compares to a prior link to detect mandate
 * drift (was the mandate edited since the goal was set?).
 */

import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { existsSync, readFileSync } from "node:fs";

import {
  linkGoalToMandate,
  detectMandateDrift,
  mandateLinkToPayload,
} from "../../../../core/pipeline/goalMandateLink.ts";
import { recordStructuredObservation } from "../../../platform/observability/structured.ts";

export const goalMandateLinkDiagnosticTool = createTool({
  id: "link_goal_to_mandate",
  description:
    "Read the active mandate file, compute its SHA-256 hash + snapshot timestamp, and return a structured " +
    "link record suitable for stamping into goal state. Optionally compares to a prior link to detect mandate " +
    "drift (whether the mandate was edited since the goal was set). " +
    "Use at goal-set time, or when resuming a paused goal to verify the constraint set hasn't changed.",
  inputSchema: z.object({
    mandatePath: z
      .string()
      .min(1)
      .describe("Absolute path to the mandate file. Typically ~/.gordon/active-mandate.json."),
    priorLink: z
      .object({
        path: z.string(),
        sha256: z.string(),
        snapshotAt: z.string(),
        byteLength: z.number(),
      })
      .optional()
      .describe(
        "Prior mandate link (e.g., from when the goal was set). If supplied, drift detection runs.",
      ),
  }),
  outputSchema: z.object({
    link: z.object({
      path: z.string(),
      sha256: z.string(),
      snapshotAt: z.string(),
      byteLength: z.number(),
    }),
    drift: z
      .object({
        pathMatches: z.boolean(),
        contentMatches: z.boolean(),
        drifted: z.boolean(),
        reasoning: z.string(),
      })
      .nullable(),
    reasoning: z.string(),
    summary: z.string(),
  }),
  execute: async (input) => {
    if (!existsSync(input.mandatePath)) {
      throw new Error(`mandate file not found: ${input.mandatePath}`);
    }
    const content = readFileSync(input.mandatePath, "utf8");
    const link = linkGoalToMandate({
      mandateContent: content,
      mandatePath: input.mandatePath,
    });

    let drift: ReturnType<typeof detectMandateDrift> | null = null;
    if (input.priorLink) {
      drift = detectMandateDrift(input.priorLink, link);
    }

    const reasoning = drift
      ? `${drift.reasoning} (current sha=${link.sha256.slice(0, 8)}, snapshot=${link.snapshotAt})`
      : `linked mandate at ${link.path} (sha=${link.sha256.slice(0, 8)}, ${link.byteLength}B, snapshot=${link.snapshotAt})`;

    recordStructuredObservation({
      eventType: "goal_mandate_link.computed",
      workflow: "goal_authoring",
      source: "agent_tool",
      component: "link_goal_to_mandate",
      toolName: "link_goal_to_mandate",
      outcome: "info",
      details: {
        ...(mandateLinkToPayload(link) as Record<string, unknown>),
        drifted: drift?.drifted ?? null,
      },
    });

    return {
      link,
      drift,
      reasoning,
      summary: reasoning,
    };
  },
});

export const goalMandateLinkTools = {
  link_goal_to_mandate: goalMandateLinkDiagnosticTool,
};
