/**
 * Explain Tools (Mastra Format)
 * Tools for explaining trading concepts and terminology
 *
 * This file demonstrates the Mastra tool format for migration from OpenAI Agents SDK.
 * Key differences:
 * - tool() -> createTool()
 * - name -> id
 * - parameters -> inputSchema
 * - Context access via first parameter destructuring
 */

import { createTool } from "@mastra/core/tools";
import { z } from "zod";

import { getGordonContext, MastraExecutionContext } from "./types.ts";
import { explain, getPresetExplanation } from "../../../core/explainer.ts";

// ============================================================================
// Error Messages
// ============================================================================

const errors = {
  noLLM: { error: "LLM client not connected. Please run setup first." },
};

// ============================================================================
// Explain Tool
// ============================================================================

export const explainTool = createTool({
  id: "explain",
  description:
    "Explain a trading concept, term, or strategy in simple terms. " +
    "Use when the user asks 'what is X?' or 'explain Y' or needs help understanding something",
  inputSchema: z.object({
    topic: z.string().describe("The topic to explain"),
    additionalContext: z
      .string()
      .default("")
      .describe("Additional context for the explanation"),
  }),
  outputSchema: z.object({
    explanation: z.string().optional(),
    topic: z.string(),
    error: z.string().optional(),
  }),
  execute: async ({ topic, additionalContext }, execContext: MastraExecutionContext) => {
    // Context is injected via Mastra's RuntimeContext
    const ctx = getGordonContext(execContext);
    if (!ctx?.llm) {
      return { ...errors.noLLM, topic };
    }

    // Check if it's a preset topic
    const presetExplanation = getPresetExplanation(topic);
    if (presetExplanation) {
      return { explanation: presetExplanation, topic };
    }

    // Custom explanation using AI
    try {
      const explanation = await explain(ctx.llm, topic, { topic: additionalContext || undefined });
      return { explanation, topic };
    } catch (error) {
      return { error: `Failed to explain topic: ${(error as Error).message}`, topic };
    }
  },
});

// ============================================================================
// Export as Object (Mastra format)
// ============================================================================

/**
 * Explain tools exported as an object for Mastra Agent
 * This is the format expected by Mastra's Agent class
 */
export const explainTools = {
  explain: explainTool,
};
