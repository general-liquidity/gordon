/**
 * Ask User Tool — mid-task elicitation
 *
 * Pauses the agent and waits for the user to answer a question in the TUI.
 * Powered by `SideQuestionManager` which emits `agent:elicitation_requested`
 * and resolves when `agent:elicitation_answered` fires with the same id.
 */

import { createTool } from "@mastra/core/tools";
import { z } from "zod";

import { sideQuestionManager } from "../../../../tui/services/sideQuestion.ts";

export const askUserTool = createTool({
  id: "ask_user",
  description:
    "Ask the user a clarifying question mid-task and wait for the answer. " +
    "Use when you genuinely need a decision the user must make (e.g., which symbol, which timeframe, confirm a risk). " +
    "Do NOT use for chit-chat or when a reasonable default exists.",
  inputSchema: z.object({
    question: z.string().describe("The question to ask the user."),
    options: z
      .array(z.string())
      .optional()
      .describe("Optional multiple-choice options. Omit for free-text answer."),
    context: z
      .string()
      .optional()
      .describe("Short description of what you were doing when this question came up."),
    kind: z
      .enum(["choice", "text", "confirm"])
      .optional()
      .describe("Question style. Auto-inferred from `options` when omitted."),
  }),
  outputSchema: z.object({
    answer: z.string(),
    dismissed: z.boolean(),
  }),
  execute: async ({ question, options, context, kind }) => {
    const answer = await sideQuestionManager.ask(question, options, context, kind);
    return { answer, dismissed: answer.length === 0 };
  },
});

export const askUserTools = {
  ask_user: askUserTool,
};
