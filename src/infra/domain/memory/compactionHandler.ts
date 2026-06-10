/**
 * Apply compaction actions when the session trigger fires.
 */

import type { LLMClient } from "../../ai/llm/client.ts";
import type { Message } from "../../ai/llm/types.ts";
import type { CompactionAction } from "../../context/compaction/compactionTrigger.ts";
import { microcompactMessages } from "../../context/compaction/microcompact.ts";
import { createModuleLogger } from "../../logger/index.ts";
import { createSummarizer } from "./summarizer.ts";

const logger = createModuleLogger("compaction-handler");

export interface CompactionHandlerInput<T extends { role: string; content: unknown } = Message> {
  action: CompactionAction;
  messages: T[];
  llm?: LLMClient | null;
}

export interface CompactionHandlerResult<T extends { role: string; content: unknown } = Message> {
  applied: boolean;
  messages: T[];
  detail: string;
}

function toSummarizerMessages<T extends { role: string; content: unknown }>(items: T[]): Message[] {
  return items
    .filter((m) => m.role === "system" || m.role === "user" || m.role === "assistant")
    .map((m) => ({
      role: m.role as Message["role"],
      content: typeof m.content === "string" ? m.content : String(m.content),
    }));
}

/**
 * Run microcompact or LLM summarization depending on the trigger action.
 */
export async function applyCompactionIfNeeded<T extends { role: string; content: unknown }>(
  input: CompactionHandlerInput<T>,
): Promise<CompactionHandlerResult<T>> {
  const { action, messages, llm } = input;
  if (action !== "microcompact" && action !== "compact") {
    return { applied: false, messages, detail: `no-op for action=${action}` };
  }

  if (action === "microcompact") {
    const result = microcompactMessages(messages);
    if (result.cleared === 0) {
      return { applied: false, messages, detail: "microcompact: nothing to clear" };
    }
    logger.info("microcompact applied", {
      cleared: result.cleared,
      tokensSaved: result.estimatedTokensSaved,
      trigger: result.trigger,
    });
    return {
      applied: true,
      messages: result.messages as T[],
      detail: `microcompact cleared ${result.cleared} tool results (~${result.estimatedTokensSaved} tokens)`,
    };
  }

  if (!llm) {
    const fallback = microcompactMessages(messages);
    return {
      applied: fallback.cleared > 0,
      messages: fallback.messages as T[],
      detail: fallback.cleared > 0
        ? `compact fallback: microcompact cleared ${fallback.cleared} (no LLM)`
        : "compact skipped: no LLM client",
    };
  }

  const summarizer = createSummarizer(llm);
  const summary = await summarizer.summarize(toSummarizerMessages(messages));
  if (!summary.summarized) {
    return { applied: false, messages, detail: "compact: summarizer below threshold" };
  }

  logger.info("LLM compaction applied", {
    messagesSummarized: summary.messagesSummarized,
    stage: summary.compactionStage,
    ratio: summary.contextFillRatio,
  });

  return {
    applied: true,
    messages: messages.slice(0, Math.max(0, messages.length - summary.messagesSummarized)) as T[],
    detail: `compact summarized ${summary.messagesSummarized} messages (stage=${summary.compactionStage ?? "unknown"})`,
  };
}