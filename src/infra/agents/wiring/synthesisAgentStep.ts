/**
 * LLM-only synthesis agentStep adapter for `runInvestigation`.
 *
 * The investigation primitive's `agentStep` callable can be either a
 * full Mastra agent loop (tool-using sub-agent) or a simpler synthesis
 * model that just asks the LLM to produce a text answer given the
 * context. This file ships the simpler version.
 *
 * The synthesis-only adapter:
 *   - Calls Gordon's LLM with the supplied messages
 *   - Returns the response text as the assistant's content
 *   - Marks `finished: true` after the first response (no tool loop)
 *   - Reports zero tool calls
 *
 * Use cases this adapter is appropriate for:
 *   - "Summarize the last 5 trades we discussed"
 *   - "Compare the bull and bear scenarios for AAPL given what we've
 *     said so far"
 *   - "Take the orchestrator's investigation notes and produce a
 *     synthesis"
 *
 * What this adapter does NOT support:
 *   - Sub-agent makes its own tool calls — deferred to S27 (full
 *     Mastra agentStep adapter). The `allowedTools` parameter is
 *     surfaced to the LLM in the system prompt as documentation but
 *     no tools execute.
 *
 * This is the honest "wiring is live" minimum — the primitive is
 * usable for synthesis tasks, the safety surface holds (no tools
 * execute), and the upgrade path to full tool-calling sub-agents is
 * explicit.
 */

import type {
  InvestigationAgentStep,
  InvestigationAgentStepInput,
  InvestigationAgentStepOutput,
} from "../investigation.ts";

export interface LLMChatCaller {
  /**
   * Match `LLMClient.chatWithConfig` signature: takes messages +
   * provider/model/etc config, returns content text. Dependency-
   * injected so tests + alt-providers + Pro-pilot custom routing
   * all plug in identically.
   */
  call: (messages: Array<{ role: string; content: string }>) => Promise<string>;
}

export interface SynthesisAgentStepOptions {
  llm: LLMChatCaller;
  /**
   * When true, append the allowed-tool list to the system prompt so
   * the LLM knows it could mention these tools by name in its
   * synthesis. They are NOT actually called. Default true.
   */
  surfaceAllowedTools?: boolean;
}

/**
 * Build an InvestigationAgentStep that runs a single LLM call per
 * round and treats the response as the synthesis.
 *
 * Always returns `finished: true` after the first call — the LLM-only
 * adapter doesn't loop. Callers wanting multi-round tool-using
 * investigations should use the Mastra adapter (S27, deferred).
 */
export function createSynthesisAgentStep(
  opts: SynthesisAgentStepOptions,
): InvestigationAgentStep {
  const surfaceTools = opts.surfaceAllowedTools ?? true;

  return async (
    input: InvestigationAgentStepInput,
  ): Promise<InvestigationAgentStepOutput> => {
    let messages = input.messages;
    if (surfaceTools && input.allowedToolIds.length > 0) {
      // Inject a system-level note listing the tools the LLM could
      // reference but cannot actually invoke. Operator-readable
      // discipline for the synthesis.
      const note = {
        role: "system" as const,
        content:
          `Read-only context — these tool names exist in Gordon but you cannot call them ` +
          `from this synthesis: ${input.allowedToolIds.join(", ")}. ` +
          `Refer to results from prior tool calls in the conversation history. ` +
          `Do not propose new tool calls; produce a synthesis instead.`,
      };
      messages = [...messages, note];
    }

    const response = await opts.llm.call(messages);
    const trimmed = response.trim();
    return {
      messages: [
        ...input.messages,
        { role: "assistant", content: trimmed },
      ],
      toolCalls: [],
      finished: true,
    };
  };
}

/**
 * Convenience factory: build a synthesis agentStep from Gordon's
 * `context.llm.chatWithConfig` directly. The caller passes the
 * provider/model config; this helper handles the call shape.
 */
export function createSynthesisAgentStepFromChatWithConfig<
  TMessage = unknown,
  TConfig = unknown,
>(
  chatWithConfig: (messages: TMessage[], config: TConfig) => Promise<{ content?: string }>,
  config: TConfig,
  options: Omit<SynthesisAgentStepOptions, "llm"> = {},
): InvestigationAgentStep {
  return createSynthesisAgentStep({
    ...options,
    llm: {
      call: async (messages) => {
        // Cast through unknown — Gordon's Message type and ModelConfig type
        // are richer than the synthesis adapter's narrower shapes.
        // Structurally compatible (the investigation primitive never
        // produces tool-role messages and the extra config fields are
        // optional).
        const response = await chatWithConfig(
          messages as unknown as TMessage[],
          config,
        );
        return response.content ?? "";
      },
    },
  });
}
