/**
 * Conversation Summarization
 *
 * Extracted from orchestrator.ts — manages the singleton summarizer instance
 * and provides summarization-related utility functions.
 */

import { createModuleLogger } from "../../logger/index.ts";
import { emitEvent } from "../../../events/index.ts";
import {
  type ConversationSummarizer,
  createSummarizer,
  createSummarizerConfigFromMemoryConfig,
  type SummarizationResult,
} from "../../domain/memory/index.ts";
import { runLifecycleHooks } from "../harness/lifecycleHooks.ts";
import { getCompactionTrigger } from "../../context/compaction/compactionTrigger.ts";
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
  options?: ProcessingOptions,
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

    // Decide why this compaction is firing. "overflow" means the fill ratio
    // is already at the `full` threshold (emergency). "threshold" is the
    // normal case. "manual" would be set by a /compact caller that provided
    // its own reason — left as a future extension hook.
    const pressureRatio =
      messages.reduce((sum, m) => sum + Math.ceil(String(m.content).length / 4), 0) /
      Math.max(1, summarizer.getConfig().maxContextTokensEstimate);
    const compactionReason: "manual" | "threshold" | "overflow" =
      pressureRatio >= 0.99 ? "overflow" : "threshold";

    await runLifecycleHooks("before_compaction", context, {
      threadId: context.threadId,
      compactionReason,
      payload: {
        messageCount: messages.length,
        threshold: summarizer.getConfig().messageThreshold,
      },
    });

    // Lifecycle event — pairs with memory:summarized at the end so
    // TUI subscribers can render a "compacting…" spinner during the
    // LLM call.
    await emitEvent("memory:summarizing", {
      reason: compactionReason,
      messageCount: messages.length,
    });

    let result: Awaited<ReturnType<typeof summarizer.summarize>>;
    let aborted = false;
    try {
      result = await summarizer.summarize(messages);
    } catch (err) {
      // Circuit breaker: record the failure. After 3 consecutive failures
      // the compaction trigger returns "halt" instead of "compact" to
      // prevent runaway summarization loops.
      aborted = true;
      getCompactionTrigger().recordCompactFailure();
      logger.error("Summarization failed — circuit breaker incremented", {
        err: err instanceof Error ? err.message : String(err),
      });
      await runLifecycleHooks("after_compaction", context, {
        threadId: context.threadId,
        compactionReason,
        aborted,
        willRetry: false,
        error: err instanceof Error ? err.message : String(err),
        payload: {
          summarized: false,
          messagesSummarized: 0,
        },
      });
      throw err;
    }

    if (result.summarized) {
      // Successful compaction — release the sticky latch so stages can
      // downgrade on subsequent turns, and record the success so the
      // circuit breaker failure counter resets.
      const trigger = getCompactionTrigger();
      trigger.releaseLatch();
      // recordFullCompact also resets consecutiveCompactFailures internally
      const beforeTokens = Math.floor(messages.length * 200); // rough pre-compact estimate
      const afterTokens = Math.floor(result.messages.length * 200);
      trigger.recordFullCompact(beforeTokens, afterTokens, "compacted via summarizer");

      // Emit event for tracking
      await emitEvent("memory:summarized", {
        originalCount: messages.length,
        newCount: result.messages.length,
        summarizedCount: result.messagesSummarized,
      });

      // Also emit structured metadata (venues, strategies, indicators, …)
      // when the summarizer produced CompactionDetails. Subscribers can use
      // this to surface "last compaction touched Binance + momentum + 1h"
      // without having to re-parse the summary text.
      if (result.compactionDetails) {
        const d = result.compactionDetails;
        await emitEvent("memory:compacted_details", {
          stage: result.compactionStage ?? "unknown",
          iterative: d.iterative,
          messagesFolded: d.messagesFolded,
          symbols: d.symbols,
          venues: d.venues,
          strategies: d.strategies,
          indicators: d.indicators,
          chartPatterns: d.chartPatterns,
          timeframes: d.timeframes,
          researchArtifacts: d.researchArtifacts,
          mandates: d.mandates,
          approvals: d.approvals,
        });
      }
    } else {
      // Summarization ran but didn't actually shrink anything — that's a
      // soft failure. Count it so the circuit breaker eventually trips if
      // we keep hitting this path.
      getCompactionTrigger().recordCompactFailure();
    }

    // willRetry = soft failure path — summarization ran but didn't shrink,
    // so the circuit breaker incremented and the next turn will try again.
    const willRetry = !result.summarized && !aborted;

    await runLifecycleHooks("after_compaction", context, {
      threadId: context.threadId,
      compactionReason,
      aborted,
      willRetry,
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
export function needsSummarization(context: GordonContext, messages: Message[]): boolean {
  const summarizer = getSummarizer(context);
  return summarizer.shouldSummarize(messages);
}

/**
 * Get summarization statistics for current conversation
 */
export function getSummarizationStats(
  context: GordonContext,
  messages: Message[],
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
