/**
 * Apply compaction actions when the session trigger fires.
 */

import type { LLMClient } from "../../ai/llm/client.ts";
import type { Message } from "../../ai/llm/types.ts";
import type { CompactionAction } from "../../context/compaction/compactionTrigger.ts";
import { microcompactMessages } from "../../context/compaction/microcompact.ts";
import { createModuleLogger } from "../../logger/index.ts";
import { createSummarizer } from "./summarizer.ts";
import { runHooks } from "../../hooks/engine.ts";

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
    const beforeTokens = messages.reduce(
      (sum, message) => sum + Math.ceil(String(message.content).length / 4),
      0,
    );
    const preCompact = await runHooks("PreCompact", {
      estimatedTokens: beforeTokens,
      threshold: beforeTokens,
      messageCount: messages.length,
    });
    if (preCompact.action === "block") {
      return { applied: false, messages, detail: `microcompact blocked: ${preCompact.reason ?? "hook policy"}` };
    }
    const result = microcompactMessages(messages);
    if (result.cleared === 0) {
      return { applied: false, messages, detail: "microcompact: nothing to clear" };
    }
    const postCompact = await runHooks("PostCompact", {
      beforeTokens,
      afterTokens: result.messages.reduce(
        (sum, message) => sum + Math.ceil(String(message.content).length / 4),
        0,
      ),
      clearedCount: result.cleared,
    });
    if (postCompact.action === "block") {
      return { applied: false, messages, detail: `microcompact withheld: ${postCompact.reason ?? "hook policy"}` };
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
    const fallback = await applyCompactionIfNeeded({
      action: "microcompact",
      messages,
      llm: null,
    });
    return fallback.applied
      ? { ...fallback, detail: `compact fallback: ${fallback.detail} (no LLM)` }
      : { ...fallback, detail: `compact fallback: ${fallback.detail}` };
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
    // ConversationSummarizer returns the compacted projection: stable system
    // context, the generated summary/artifact index, and the recent tail. The
    // old path discarded that output and kept an arbitrary prefix of the
    // original history, losing the summary while also dropping the newest
    // messages it was supposed to preserve.
    messages: summary.messages as T[],
    detail: `compact summarized ${summary.messagesSummarized} messages (stage=${summary.compactionStage ?? "unknown"})`,
  };
}
