/**
 * Feedback rating tool — exposed via /rate slash command.
 *
 * Captures explicit operator feedback on the most recent shadow plan
 * (or any tagged response). Closes the explicit-feedback half of the
 * Langfuse monitoring pattern. Persists to JSONL so traces accumulate
 * for later analysis + LLM-as-judge calibration.
 *
 * Implicit-feedback signals (retry, abandonment) are captured
 * separately by their respective tools (shadowPlanTool detects retries).
 */

import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { appendFileSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

import { getLastShadowPlanForTesting } from "./shadowPlan.ts";
import { recordStructuredObservation } from "../../../platform/observability/structured.ts";

export const FEEDBACK_PATH_ENV = "GORDON_FEEDBACK_RATING_PATH";

export function defaultFeedbackPath(env: NodeJS.ProcessEnv = process.env): string {
  return env[FEEDBACK_PATH_ENV] || join(homedir(), ".gordon", "feedback.jsonl");
}

export interface FeedbackEntry {
  id: string;
  recordedAt: string;
  targetPlanId: string | null;
  rating: "positive" | "negative";
  comment?: string;
}

function newFeedbackId(): string {
  return `fb-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export const feedbackRatingTool = createTool({
  id: "rate_response",
  description:
    "Record explicit operator feedback on the most recent shadow plan or response. " +
    "Use when the user types `/rate +`, `/rate -`, or supplies a comment. " +
    "Captures the rating into JSONL + structured-observation stream so the response quality can be evaluated over time. " +
    "Maps to the explicit-feedback half of the Langfuse monitoring pattern.",
  inputSchema: z.object({
    rating: z
      .enum(["positive", "negative", "+", "-", "up", "down"])
      .describe("Operator's rating. Accepts +/- or up/down aliases."),
    comment: z.string().optional().describe("Optional free-text comment"),
    targetPlanId: z
      .string()
      .optional()
      .describe(
        "Specific plan id to rate. Falls back to the most-recent shadow plan when omitted.",
      ),
  }),
  outputSchema: z.object({
    saved: z.boolean(),
    feedbackId: z.string(),
    targetPlanId: z.string().nullable(),
    rating: z.enum(["positive", "negative"]),
  }),
  execute: async ({ rating, comment, targetPlanId }) => {
    const normalized: "positive" | "negative" =
      rating === "+" || rating === "up" || rating === "positive" ? "positive" : "negative";

    const recent = getLastShadowPlanForTesting();
    const planId = targetPlanId ?? recent?.planId ?? null;

    const entry: FeedbackEntry = {
      id: newFeedbackId(),
      recordedAt: new Date().toISOString(),
      targetPlanId: planId,
      rating: normalized,
      comment,
    };

    const path = defaultFeedbackPath();
    try {
      mkdirSync(dirname(path), { recursive: true });
      appendFileSync(path, JSON.stringify(entry) + "\n", "utf8");
    } catch {
      /* best-effort */
    }

    recordStructuredObservation({
      eventType: "feedback.rating_recorded",
      workflow: "execution",
      source: "agent_tool",
      component: "feedback_rating",
      toolName: "rate_response",
      outcome: normalized === "positive" ? "success" : "failure",
      details: {
        feedbackId: entry.id,
        targetPlanId: planId,
        rating: normalized,
        hasComment: !!comment,
      },
    });

    return {
      saved: true,
      feedbackId: entry.id,
      targetPlanId: planId,
      rating: normalized,
    };
  },
});

export const feedbackRatingTools = {
  rate_response: feedbackRatingTool,
};
