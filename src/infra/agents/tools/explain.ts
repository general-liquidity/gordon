/**
 * Explain Tools
 * Tools for explaining trading concepts and terminology
 */

import { tool } from "@openai/agents";
import { z } from "zod";

import { explain, getPresetExplanation } from "../../../core/explainer.ts";
import type { ToolRunContext } from "./types.ts";
import { errors } from "./types.ts";

// ============================================================================
// Explain Tool
// ============================================================================

export const explainTool = tool({
  name: "explain",
  description:
    "Explain a trading concept, term, or strategy in simple terms. " +
    "Use when the user asks 'what is X?' or 'explain Y' or needs help understanding something",
  parameters: z.object({
    topic: z.string().describe("The topic to explain"),
    additionalContext: z
      .string()
      .default("")
      .describe("Additional context for the explanation"),
  }),
  async execute({ topic, additionalContext }, runContext: ToolRunContext) {
    const ctx = runContext?.context;
    if (!ctx?.llm) {
      return errors.noLLM;
    }

    // Check if it's a preset topic
    const presetExplanation = getPresetExplanation(topic);
    if (presetExplanation) {
      return { explanation: presetExplanation, topic };
    }

    // Custom explanation using AI
    const explanation = await explain(ctx.llm, topic, { topic: additionalContext || undefined });
    return { explanation, topic };
  },
});

export const explainTools = [explainTool];
