/**
 * Conversation Summarization
 *
 * Extracted from orchestrator.ts — manages the singleton summarizer instance
 * and provides summarization-related utility functions.
 */

import { createModuleLogger } from "../../logger/index.ts";
import { emitEvent } from "../../../events/index.ts";
import {
  ConversationSummarizer,
  createSummarizer,
  createSummarizerConfigFromMemoryConfig,
  type SummarizerConfig,
  type SummarizationResult,
} from "../../domain/memory/index.ts";
import { runLifecycleHooks } from "../lifecycleHooks.ts";
import type { GordonContext } from "../types.ts";
import type { Message } from "../../ai/llm/types.ts";
import type { ProcessingOptions } from "./types.ts";

const logger = createModuleLogger("orchestrator-summarization");

// Singleton summarizer instance (lazy initialized)
let _summarizer: ConversationSummarizer | null = null;

/**
 * Get or create the singleton summarizer instance
 */
function getSummarizer(context: GordonContext): ConversationSummarizer {
  if (!_summarizer) {
    // Create summarizer with config from GordonConfig if available
    const summarizerConfig = context.config.memoryConfig
      ? createSummarizerConfigFromMemoryConfig(context.config.memoryConfig)
      : {};

    _summarizer = createSummarizer(context.llm, summarizerConfig);
    logger.debug("Created summarizer instance", { config: summarizerConfig });
  }
  return _summarizer;
}

/**
 * Reset the summarizer instance (for testing or reconfiguration)
 */
export function resetSummarizer(): void {
  _summarizer = null;
  logger.debug("Summarizer instance reset");
}

/**
 * Summarize conversation history if needed
 *
 * @param context - Gordon context with LLM client
 * @param messages - Conversation history to potentially summarize
 * @param options - Processing options including custom summarizer config
 * @returns SummarizationResult with original or summarized messages
 */
export async function summarizeIfNeeded(
  context: GordonContext,
  messages: Message[],
  options?: ProcessingOptions
): Promise<SummarizationResult> {
  // Check if summarization is enabled
  if (!options?.enableSummarization) {
    return {
      summarized: false,
      messages,
      messagesSummarized: 0,
    };
  }

  const summarizer = getSummarizer(context);

  // Apply custom config if provided
  if (options.summarizerConfig) {
    summarizer.updateConfig(options.summarizerConfig);
  }

  // Check if summarization is needed and perform it
  if (summarizer.shouldSummarize(messages)) {
    logger.info("Summarization triggered", {
      messageCount: messages.length,
      threshold: summarizer.getConfig().messageThreshold,
    });

    await runLifecycleHooks("before_compaction", context, {
      threadId: context.threadId,
      payload: {
        messageCount: messages.length,
        threshold: summarizer.getConfig().messageThreshold,
      },
    });

    const result = await summarizer.summarize(messages);

    if (result.summarized) {
      // Emit event for tracking
      await emitEvent("memory:summarized", {
        originalCount: messages.length,
        newCount: result.messages.length,
        summarizedCount: result.messagesSummarized,
      });
    }

    await runLifecycleHooks("after_compaction", context, {
      threadId: context.threadId,
      payload: {
        summarized: result.summarized,
        messagesSummarized: result.messagesSummarized,
        compactionStage: result.compactionStage,
      },
    });

    return result;
  }

  return {
    summarized: false,
    messages,
    messagesSummarized: 0,
  };
}

/**
 * Check if conversation history needs summarization
 */
export function needsSummarization(
  context: GordonContext,
  messages: Message[]
): boolean {
  const summarizer = getSummarizer(context);
  return summarizer.shouldSummarize(messages);
}

/**
 * Get summarization statistics for current conversation
 */
export function getSummarizationStats(
  context: GordonContext,
  messages: Message[]
): {
  messageCount: number;
  threshold: number;
  needsSummarization: boolean;
  messagesToSummarize: number;
  messagesToKeep: number;
} {
  const summarizer = getSummarizer(context);
  const config = summarizer.getConfig();
  const shouldSummarize = summarizer.shouldSummarize(messages);

  return {
    messageCount: messages.length,
    threshold: config.messageThreshold,
    needsSummarization: shouldSummarize,
    messagesToSummarize: shouldSummarize ? summarizer.getMessagesToSummarizeCount(messages) : 0,
    messagesToKeep: config.recentMessagesToKeep,
  };
}
