/**
 * Recursive Decompose tool — operator/researcher-facing Mastra tool that
 * wraps the RLM `recursiveDecompose` primitive with Gordon's LLM client.
 *
 * Surface:
 *   recursive_decompose(query, input) → answer over an oversized input
 *
 * Use when a single input is too large to reason over in one call without
 * context-rot: a full 10-K, a multi-year trade ledger, a long news history.
 * The tool partitions the input, runs a scoped sub-query per chunk (no call
 * sees the whole input), and synthesizes the partial answers.
 *
 * Read-only by construction — the primitive executes no tools and places no
 * orders. It reuses the same synthesis LLM route as the investigation/fork
 * sub-agents (compaction/fast model).
 */

import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { getGordonContext, type MastraExecutionContext } from "../../types.ts";
import { resolveWorkflowPhaseModelRoute } from "../../../cognition/workflowPhase.ts";
import {
  recursiveDecompose,
  type DecomposeMessage,
} from "../../../cognition/recursiveDecompose.ts";
import {
  withTimelineEntry,
  generateTimelineAgentId,
  estimateTokensFromMessages,
  reportTimelineProgress,
} from "../../../wiring/timelineWiring.ts";

const errors = {
  noLlm: { error: "LLM client not available in context. Cannot run recursive decomposition." },
};

export const recursiveDecomposeTool = createTool({
  id: "recursive_decompose",
  description:
    "Answer a query over an OVERSIZED input by recursive decomposition (RLM). " +
    "Partitions the input into chunks, runs a scoped sub-query per chunk (no call sees the whole " +
    "input), then synthesizes the partial answers — defeating context-rot on long inputs. " +
    "Read-only: runs no tools, places no orders. Use for a full 10-K, a multi-year trade ledger, " +
    "or a long news history that would degrade a single stuffed call. For inputs that already fit " +
    "a normal context window, just read them directly instead.",
  inputSchema: z.object({
    query: z.string().min(3).describe("The question to answer against the input."),
    input: z.string().min(1).describe("The full (possibly very large) text to reason over."),
    maxChunkChars: z
      .number()
      .int()
      .min(500)
      .max(60000)
      .default(8000)
      .describe("Per-chunk character budget (~4 chars/token). Inputs at or below this pass through undivided."),
    maxFanOut: z.number().int().min(1).max(16).default(5).describe("Max concurrent chunk sub-queries per level."),
    maxDepth: z.number().int().min(0).max(5).default(3).describe("Aggregation-tree recursion depth cap."),
  }),
  outputSchema: z.object({
    answer: z.string(),
    decomposed: z.boolean(),
    chunkCount: z.number(),
    subQueryCount: z.number(),
    synthesisCount: z.number(),
    depthReached: z.number(),
    llmCallCount: z.number(),
    error: z.string().optional(),
  }).partial(),
  execute: async (
    { query, input, maxChunkChars, maxFanOut, maxDepth },
    execContext: MastraExecutionContext,
  ) => {
    const ctx = getGordonContext(execContext);
    if (!ctx?.llm) return errors.noLlm;

    const route = resolveWorkflowPhaseModelRoute("compaction");
    const llm = async (messages: DecomposeMessage[]): Promise<string> => {
      const response = await ctx.llm.chatWithConfig(messages, {
        provider: route.provider,
        model: route.model,
        temperature: 0.3,
        maxTokens: 1500,
      });
      return response.content ?? "";
    };

    const agentId = generateTimelineAgentId("decompose");
    const result = await withTimelineEntry(
      {
        agentId,
        agentName: `decompose: ${query.slice(0, 40)}`,
        agentType: "investigation",
        initialTokens: estimateTokensFromMessages([{ content: input }]),
      },
      () => recursiveDecompose({ query, input, maxChunkChars, maxFanOut, maxDepth }, { llm }),
    );

    reportTimelineProgress(agentId, {
      tokenEstimate: estimateTokensFromMessages([{ content: result.answer }]),
      toolCallCount: result.llmCallCount,
    });

    return {
      answer: result.answer,
      decomposed: result.decomposed,
      chunkCount: result.chunkCount,
      subQueryCount: result.subQueryCount,
      synthesisCount: result.synthesisCount,
      depthReached: result.depthReached,
      llmCallCount: result.llmCallCount,
    };
  },
});

export const recursiveDecomposeTools = {
  recursive_decompose: recursiveDecomposeTool,
};
