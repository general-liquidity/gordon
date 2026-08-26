/**
 * Conversation Summarizer
 * Intelligent summarization of conversation history for long contexts
 *
 * When conversation history exceeds a configurable threshold, this summarizer:
 * 1. Keeps the most recent N messages intact
 * 2. Summarizes older messages into a structured context summary
 * 3. Preserves key trading context: positions, decisions, analysis results
 */

import type { Message, MessageRole } from "../../ai/llm/types.ts";
import type { LLMClient } from "../../ai/llm/client.ts";
import { createModuleLogger } from "../../logger/index.ts";
import { resolveWorkflowPhaseModelRoute } from "../../agents/cognition/workflowPhase.ts";
import { recordPhaseLLMCost } from "../../platform/costTracker.ts";
import {
  INTEGRATION_GLOSSARY_MARKER,
  PROJECT_TRUTH_MARKER,
  RUNTIME_STATE_MARKER,
  TOOL_CONTEXT_MARKER,
} from "../../agents/context/contextBudget.ts";
import { EXCHANGE_IDS } from "../../exchange/types.ts";
import { BROKER_IDS } from "../../broker/types.ts";
import { STRATEGY_IDS } from "../../../strategies/types.ts";
import { TIMEFRAME_IDS } from "../../../types/timeframes.ts";
import { collapseContext } from "./contextCollapse.ts";
import { resolveFlag } from "../../config/flagResolver.ts";

const logger = createModuleLogger("summarizer");

// ============================================================================
// Types
// ============================================================================

/**
 * Configuration for the conversation summarizer
 */
export interface SummarizerConfig {
  /**
   * Number of messages that triggers summarization
   * @default 20
   */
  messageThreshold: number;

  /**
   * Number of recent messages to keep intact (not summarized)
   * @default 5
   */
  recentMessagesToKeep: number;

  /**
   * Maximum tokens for the summary (approximate)
   * @default 1000
   */
  maxSummaryTokens: number;

  /**
   * Temperature for summary generation (lower = more deterministic)
   * @default 0.3
   */
  temperature: number;

  /**
   * Estimated maximum prompt-token budget available to the conversation layer.
   * Used to select compaction stages from pressure ratio rather than raw message count.
   * @default 12000
   */
  maxContextTokensEstimate: number;

  /**
   * Per-stage token budgets for the "recent messages kept verbatim" window.
   * Falls back to DEFAULT_RECENT_TOKEN_BUDGET_BY_STAGE when unset.
   */
  recentTokenBudgetByStage: Record<CompactionStage, number>;
}

/**
 * Per-stage token budgets for the "recent kept" window. A tighter compaction
 * stage (higher pressure) keeps fewer tokens of recent context verbatim. Used
 * alongside the message-count floor from `RECENT_OBSERVATIONS_TO_KEEP`.
 */
export const DEFAULT_RECENT_TOKEN_BUDGET_BY_STAGE: Record<CompactionStage, number> = {
  masking: 5000,
  pruning: 3500,
  aggressive: 2000,
  collapse: 1600,
  full: 1200,
};

/**
 * Default summarizer configuration
 */
export const DEFAULT_SUMMARIZER_CONFIG: SummarizerConfig = {
  messageThreshold: 20,
  recentMessagesToKeep: 5,
  maxSummaryTokens: 1000,
  temperature: 0.3,
  maxContextTokensEstimate: 12000,
  recentTokenBudgetByStage: { ...DEFAULT_RECENT_TOKEN_BUDGET_BY_STAGE },
};

/**
 * Narrative aliases for canonical venue IDs that don't round-trip well to
 * free-text chat. Underscore-separated IDs ("binance_us") rarely appear
 * that way in user messages — they write "Binance US". Space-less IDs
 * ("trading212") get written as "Trading 212". The matching layer does
 * case-insensitive `includes`, so each alias just needs to cover the
 * space-variant the canonical ID doesn't already cover.
 */
const VENUE_NARRATIVE_ALIASES: readonly string[] = [
  "Binance US",
  "Trading 212",
];

/**
 * Narrative strategy archetypes used in user chat (e.g. "momentum setups",
 * "mean reversion play"). Kept alongside canonical `StrategyId`s because the
 * ID union uses concrete names ("support_bounce", "ema_rsi_crossover") that
 * users rarely type verbatim. Union of both maximizes detection recall.
 */
const STRATEGY_NARRATIVE_ARCHETYPES: readonly string[] = [
  "momentum", "mean reversion", "breakout", "grid", "swing", "carry", "arbitrage", "scalp",
];

/**
 * Technical indicator names that commonly appear in trading chat. No
 * canonical ID registry exists for indicators (individual files at
 * src/indicators/ are not a unified registry), so this static list is the
 * source of truth for detection. Add new indicators here when they enter
 * user-facing vocabulary.
 */
const INDICATOR_NAMES: readonly string[] = [
  "RSI", "MACD", "EMA", "SMA", "VWAP", "Bollinger", "ATR",
  "ADX", "MFI", "stochastic", "support", "resistance",
  "pivot", "fibonacci", "ichimoku",
];

/**
 * Chart pattern names commonly referenced in technical analysis. Static
 * list — no canonical registry in the codebase. Covers classical patterns,
 * candlestick formations, and common structures.
 */
const CHART_PATTERN_NAMES: readonly string[] = [
  "triangle", "wedge", "flag", "pennant", "channel",
  "head and shoulders", "double top", "double bottom",
  "cup and handle", "rounding bottom", "rounding top",
  "ascending triangle", "descending triangle", "symmetrical triangle",
  "bull flag", "bear flag", "bull pennant", "bear pennant",
  "divergence", "hidden divergence",
  "engulfing", "doji", "hammer", "shooting star", "morning star", "evening star",
  "gap", "breakout", "breakdown",
];

/**
 * Domain vocabulary used by compaction metadata + artifact-index extraction.
 * Sourced from canonical ID registries (`EXCHANGE_IDS`, `BROKER_IDS`,
 * `STRATEGY_IDS`, `TIMEFRAME_IDS`) so adding a new exchange/broker/strategy/
 * timeframe to the codebase automatically expands compaction detection — no
 * separate list to maintain. Narrative aliases fill the gaps where canonical
 * IDs (snake_case) don't match how users write in chat.
 */
export const ARTIFACT_VOCABULARY = {
  venues: [...EXCHANGE_IDS, ...BROKER_IDS, ...VENUE_NARRATIVE_ALIASES],
  strategies: [...STRATEGY_IDS, ...STRATEGY_NARRATIVE_ARCHETYPES],
  indicators: [...INDICATOR_NAMES],
  chartPatterns: [...CHART_PATTERN_NAMES],
  timeframes: [...TIMEFRAME_IDS],
  researchArtifacts: ["snapshot", "dataset", "backtest", "experiment", "playbook"],
  mandates: ["mandate", "autonomous", "daemon", "schedule"],
  approvals: ["approved", "rejected", "preview", "blocked"],
} as const;

/**
 * Extracted trading context from messages
 */
export interface TradingContext {
  /** Trading decisions made in the conversation */
  decisions: string[];
  /** Active positions or analysis results */
  positionsAndAnalysis: string[];
  /** User preferences expressed during conversation */
  userPreferences: string[];
  /** Important context that should be preserved */
  importantContext: string[];
}

/**
 * Structured metadata extracted from a compaction pass.
 * Survives across sessions and is written into the compacted summary so
 * resumed sessions know which venues/mandates/orders were touched before the
 * summary was generated. Inspired by pi-mono's CompactionDetails (file-op
 * tracking) adapted to trading-domain artifacts.
 */
export interface CompactionDetails {
  /** Symbols/tickers referenced (e.g. BTCUSDT, NVDA) */
  symbols: string[];
  /** Venues / exchanges / brokers the conversation touched */
  venues: string[];
  /** Strategy archetypes referenced */
  strategies: string[];
  /** Technical indicators referenced (RSI, MACD, EMA, VWAP, …) */
  indicators: string[];
  /** Chart patterns referenced (triangle, head-and-shoulders, flag, …) */
  chartPatterns: string[];
  /** Timeframes referenced (1h, 4h, 1d, …) */
  timeframes: string[];
  /** Research/dataset/backtest artifacts */
  researchArtifacts: string[];
  /** Runtime mandates / autonomous schedules */
  mandates: string[];
  /** Approval state hints (approved / rejected / preview / blocked) */
  approvals: string[];
  /** Count of messages that were folded into the summary on this pass */
  messagesFolded: number;
  /** Whether this compaction pass built on a prior summary (iterative) */
  iterative: boolean;
}

/**
 * Result of summarization
 */
export interface SummarizationResult {
  /** Whether summarization was performed */
  summarized: boolean;
  /** The summarized messages (summary + recent messages) */
  messages: Message[];
  /** Number of messages that were summarized */
  messagesSummarized: number;
  /** The generated summary text (if summarized) */
  summaryText?: string;
  /** Extracted trading context */
  tradingContext?: TradingContext;
  /** Compaction stage used for this summarization pass */
  compactionStage?: CompactionStage;
  /** Estimated conversation fill ratio (0-1) used for stage selection */
  contextFillRatio?: number;
  /** Domain metadata extracted from messages folded into the summary */
  compactionDetails?: CompactionDetails;
}

export const COMPACTION_STAGES = [
  "masking",
  "pruning",
  "aggressive",
  "collapse",
  "full",
] as const;
export type CompactionStage = (typeof COMPACTION_STAGES)[number];

/**
 * Compaction pressure thresholds.
 *
 * History: pure ratios (0.70 / 0.80 / 0.90 / 0.99 of `maxContextTokensEstimate`)
 * per the OPENDEV paper §2.3.6. Worked at small contexts but got sluggish at
 * 200k+: each percent slot represents 2k tokens of slack, and the gap between
 * 90% and 99% is ~20k tokens — easily blown by a single tool-result heavy turn.
 *
 * Per the Claude Code audit: their auto-compact triggers at an absolute
 * 13k-token buffer below the model ceiling, with a 20k-token warning band.
 * Predictable across context sizes.
 *
 * Hybrid strategy: keep the four stages and the ratio fallback for the
 * small-context path, but ALSO compute absolute-buffer thresholds from
 * the model ceiling and pick the WORSE of the two. The full-stage trip
 * line in particular always fires by 13k below ceiling regardless of ratio.
 */
export const COMPACTION_PRESSURE_THRESHOLDS = {
  masking: 0.70,    // 70% — warn and begin gentle masking
  pruning: 0.80,    // 80% — observation masking, preserve 6 recent
  aggressive: 0.90, // 90% — aggressive masking, preserve 3 recent
  collapse: 0.94,   // 94% — non-destructive read-time projection of stale tool results
  full: 0.99,       // 99% — full LLM summary generation
} as const;

/**
 * Absolute-buffer thresholds (Claude Code parity). Evaluated as
 * `usedTokens > ceiling - BUFFER`. When the ceiling is large the absolute
 * buffer kicks in earlier than the ratio, which is exactly what we want
 * for 200k contexts.
 */
export const COMPACTION_ABSOLUTE_BUFFERS = {
  /** First gentle pass — 60k below ceiling. */
  masking: 60_000,
  /** Moderate trim — 40k below ceiling. */
  pruning: 40_000,
  /** Aggressive — 25k below ceiling. */
  aggressive: 25_000,
  /** Read-time collapse of stale tool results — 18k below ceiling. */
  collapse: 18_000,
  /** Force full LLM summary — 13k below ceiling (Claude Code's auto-compact line). */
  full: 13_000,
} as const;

/** Recent observation counts to preserve per stage (paper §2.3.6) */
export const RECENT_OBSERVATIONS_TO_KEEP: Record<CompactionStage, number> = {
  masking: 6,
  pruning: 6,
  aggressive: 3,
  collapse: 3,
  full: 3,
};

/**
 * Determine compaction stage from token-pressure ratio (0–1).
 * Preferred over message-count heuristics when token budget is known.
 *
 * Pass `usedTokens` and `maxTokens` for the absolute-buffer check too —
 * we pick the stricter of the ratio-based and absolute-buffer stages so
 * 200k contexts trigger summary at 13k from ceiling (~6% slack) rather
 * than waiting for 99% (~2k slack — too late on a heavy tool-result turn).
 */
export function determineCompactionStageFromPressure(
  contextFillRatio: number,
  usedTokens?: number,
  maxTokens?: number,
): CompactionStage {
  // Debug override. GORDON_COMPACTION_STAGE is advertised by /flags as
  // "force a specific compaction stage during debugging", so it has to
  // actually short-circuit stage selection. Read through the resolver so a
  // value set via /flags (settings layer) works, not just a shell export.
  const forced = resolveFlag("GORDON_COMPACTION_STAGE");
  if (forced && (COMPACTION_STAGES as readonly string[]).includes(forced)) {
    return forced as CompactionStage;
  }

  // Ratio-based stage (legacy path, still drives small contexts).
  let ratioStage: CompactionStage = "masking";
  if (contextFillRatio >= COMPACTION_PRESSURE_THRESHOLDS.full) ratioStage = "full";
  else if (contextFillRatio >= COMPACTION_PRESSURE_THRESHOLDS.collapse) ratioStage = "collapse";
  else if (contextFillRatio >= COMPACTION_PRESSURE_THRESHOLDS.aggressive) ratioStage = "aggressive";
  else if (contextFillRatio >= COMPACTION_PRESSURE_THRESHOLDS.pruning) ratioStage = "pruning";

  // Absolute-buffer stage (Claude Code parity, dominant on large contexts).
  let absoluteStage: CompactionStage | null = null;
  if (typeof usedTokens === "number" && typeof maxTokens === "number" && maxTokens > 0) {
    const headroom = maxTokens - usedTokens;
    if (headroom <= COMPACTION_ABSOLUTE_BUFFERS.full) absoluteStage = "full";
    else if (headroom <= COMPACTION_ABSOLUTE_BUFFERS.collapse) absoluteStage = "collapse";
    else if (headroom <= COMPACTION_ABSOLUTE_BUFFERS.aggressive) absoluteStage = "aggressive";
    else if (headroom <= COMPACTION_ABSOLUTE_BUFFERS.pruning) absoluteStage = "pruning";
    else if (headroom <= COMPACTION_ABSOLUTE_BUFFERS.masking) absoluteStage = "masking";
  }

  // Pick the stricter (most aggressive) stage between the two signals.
  const order: CompactionStage[] = ["masking", "pruning", "aggressive", "collapse", "full"];
  if (!absoluteStage) return ratioStage;
  return order.indexOf(absoluteStage) > order.indexOf(ratioStage) ? absoluteStage : ratioStage;
}

// ============================================================================
// Summarization Prompt Template
// ============================================================================

const SUMMARIZATION_SYSTEM_PROMPT = `You are a trading conversation summarizer. Your job is to create a concise but complete summary of a conversation between a user and Gordon, an AI trading assistant.

IMPORTANT: Preserve ALL key trading information including:
- Trade decisions made (buy/sell, positions, sizing)
- Analysis results (technical analysis, support/resistance levels, indicators)
- Active positions and their status
- User preferences expressed (risk tolerance, preferred coins, timeframes)
- Important market observations

Format your summary using this exact template:

## Conversation Summary

### Key Decisions Made:
[List any trading decisions, approvals, or rejections. If none, write "None in this conversation."]

### Active Positions/Analysis:
[List any active positions, pending plans, or analysis results. Include specific numbers like entry prices, stop losses, and targets when mentioned.]

### Important Context:
[List any user preferences, important observations, or context that should be remembered for future messages.]

### Durable User Facts (carry across sessions):
[Distill facts worth remembering in EVERY future session, not just this one:
- Risk tolerance and per-trade/daily/drawdown limits the user has stated
- Position sizing rules (Kelly fraction, fixed %, max concentration)
- Strategy preferences ("swing trader", "no leverage", "avoids meme coins")
- Explicit exclusions/blacklists
- Primary broker/exchange and paper vs live preference
- Time horizon tier, capital size tier, tax jurisdiction if stated
If nothing durable was stated, write "None in this conversation."]

Keep the summary concise but don't lose critical trading information. Use bullet points for clarity.`;

const SUMMARIZATION_USER_PROMPT = `Please summarize the following conversation history. Focus on preserving trading-relevant information.

CONVERSATION HISTORY:
{conversation}

Remember to use the exact template format with the three sections: Key Decisions Made, Active Positions/Analysis, and Important Context.`;

// Iterative merge prompt — used when a prior compaction summary already exists
// and we only need to fold NEW messages into the previous summary rather than
// regenerate from scratch. Preserves decisions/positions across cycles.
const UPDATE_SUMMARIZATION_SYSTEM_PROMPT = `You are a trading conversation summarizer. You have been given a PRIOR SUMMARY of an earlier portion of a conversation, plus NEW MESSAGES that happened after it. Your job is to UPDATE the prior summary to incorporate anything meaningful from the new messages, while preserving every decision, position, user preference, and durable fact from the prior summary unless a new message explicitly revises or invalidates it.

Rules:
- Do NOT drop items from the prior summary unless a new message superseded them (e.g. a position closed, a decision reversed, a preference changed).
- When a new message revises a prior fact, replace the old bullet and note the transition.
- When a new message adds a genuinely new decision/position/preference, add it to the appropriate section.
- Keep the same template (Key Decisions Made / Active Positions-Analysis / Important Context / Durable User Facts).
- Keep the summary concise. Prefer merging similar bullets over padding.`;

const UPDATE_SUMMARIZATION_USER_PROMPT = `PRIOR SUMMARY:
{priorSummary}

NEW MESSAGES (since the prior summary was generated):
{conversation}

Return the FULL UPDATED SUMMARY using the exact template format. Do not describe changes — produce a complete summary the next session can read standalone.`;

const ARTIFACT_INDEX_MARKER = "[GORDON_ARTIFACT_INDEX]";
const COMPACTION_STAGE_MARKER = "[GORDON_COMPACTION_STAGE:";

// ============================================================================
// ConversationSummarizer Class
// ============================================================================

/**
 * Summarizes conversation history to manage context length
 * while preserving key trading information
 */
export class ConversationSummarizer {
  private config: SummarizerConfig;
  private llm: LLMClient;

  constructor(llm: LLMClient, config: Partial<SummarizerConfig> = {}) {
    this.llm = llm;
    this.config = { ...DEFAULT_SUMMARIZER_CONFIG, ...config };
    logger.debug("Summarizer initialized", { config: this.config });
  }

  /**
   * Check if summarization is needed based on message count
   */
  shouldSummarize(messages: Message[]): boolean {
    return messages.length > this.config.messageThreshold
      || this.estimateContextFillRatio(messages) >= COMPACTION_PRESSURE_THRESHOLDS.masking;
  }

  /**
   * Get the number of messages that would be summarized
   */
  getMessagesToSummarizeCount(messages: Message[]): number {
    if (!this.shouldSummarize(messages)) {
      return 0;
    }
    return messages.length - this.config.recentMessagesToKeep;
  }

  private estimateMessageTokens(messages: Message[]): number {
    return messages.reduce((total, message) => total + Math.ceil(message.content.length / 4), 0);
  }

  private estimateContextFillRatio(messages: Message[]): number {
    const budget = Math.max(1, this.config.maxContextTokensEstimate);
    return Math.min(1, this.estimateMessageTokens(messages) / budget);
  }

  /**
   * Summarize conversation history if threshold is exceeded
   *
   * @param messages - Full conversation history
   * @returns SummarizationResult with summarized or original messages
   */
  async summarize(messages: Message[]): Promise<SummarizationResult> {
    // Check if summarization is needed
    if (!this.shouldSummarize(messages)) {
      logger.debug("Summarization not needed", {
        messageCount: messages.length,
        threshold: this.config.messageThreshold,
      });
      return {
        summarized: false,
        messages,
        messagesSummarized: 0,
        contextFillRatio: this.estimateContextFillRatio(messages),
      };
    }

    const messagesToSummarize = messages.length - this.config.recentMessagesToKeep;
    const contextFillRatio = this.estimateContextFillRatio(messages);
    const usedTokens = this.estimateMessageTokens(messages);
    const compactionStage = determineCompactionStageFromPressure(
      contextFillRatio,
      usedTokens,
      this.config.maxContextTokensEstimate,
    );
    logger.info("Starting conversation summarization", {
      totalMessages: messages.length,
      messagesToSummarize,
      keepingRecent: this.config.recentMessagesToKeep,
      compactionStage,
      contextFillRatio,
    });

    try {
      // Preserve stable system context outside compaction across the full message list.
      const preservedStableMessages = messages.filter((message) => this.isStableContextMessage(message));
      const nonStableMessages = messages.filter((message) => !this.isStableContextMessage(message));

      // Stage 4 (collapse) — non-destructive read-time projection. Stale
      // tool-result-ish payloads become hashed placeholders that can be
      // reinflated on demand. Skips the LLM summary path entirely; cheaper
      // than `full` and reversible. Sits between aggressive (90%) and full
      // (99%) so we drain the easy wins before paying for an LLM call.
      if (compactionStage === "collapse") {
        const collapseResult = collapseContext(nonStableMessages, {
          recentMessagesToKeep: this.getRecentMessagesToKeepForStage("collapse"),
          minLengthToCollapse: 1500,
        });
        return {
          summarized: collapseResult.collapsedBlocks.length > 0,
          messages: [...preservedStableMessages, ...collapseResult.projected],
          messagesSummarized: collapseResult.collapsedBlocks.length,
          compactionStage: "collapse",
          contextFillRatio,
        };
      }

      // Iterative merge (item 2 from pi-mono audit): if the non-stable history
      // already contains a prior compaction summary, fold new messages INTO it
      // rather than regenerate from scratch. Preserves decisions across cycles.
      const priorSummaryMessage = nonStableMessages.find((m) =>
        m.role === "system" && typeof m.content === "string" && m.content.includes(COMPACTION_STAGE_MARKER),
      );
      const priorSummaryText = priorSummaryMessage
        ? extractPriorSummaryText(priorSummaryMessage.content)
        : undefined;
      const messagesSincePriorSummary = priorSummaryMessage
        ? nonStableMessages.slice(nonStableMessages.indexOf(priorSummaryMessage) + 1)
        : nonStableMessages;

      const desiredRecentKeepCount = this.getRecentMessagesToKeepForStage(compactionStage);
      // Token-budget walker (item 6): walk newest→oldest accumulating tokens
      // until we've kept at least `desiredRecentKeepCount` messages AND stayed
      // under `maxRecentKeepTokens`. Message count is a floor, token budget a ceiling.
      let recentCandidates = this.walkRecentByTokenBudget(
        messagesSincePriorSummary,
        desiredRecentKeepCount,
        this.getRecentTokenBudgetForStage(compactionStage),
      );
      // Summarize-at-least-one invariant: once shouldSummarize() decided this
      // run, the walker must not keep the ENTIRE history as "recent" — it
      // would leave nothing to fold. Cap recent at N-1 when there's no prior
      // summary to fold into instead.
      if (
        !priorSummaryText
        && messagesSincePriorSummary.length > 1
        && recentCandidates.length >= messagesSincePriorSummary.length
      ) {
        recentCandidates = recentCandidates.slice(1);
      }
      // Turn-boundary snap (item 3): the token walker may stop mid-turn
      // (e.g. keep a tool_result whose tool_call sits in the older chunk).
      // Shift the cut forward so `recentMessages` starts at a user message —
      // the LLM sees complete turns, the prefix of the partial turn gets
      // folded into the summarization input naturally.
      const recentMessages = this.snapRecentToTurnBoundary(recentCandidates);
      const olderMessages = messagesSincePriorSummary.slice(
        0,
        messagesSincePriorSummary.length - recentMessages.length,
      );
      const adjustedMessagesToSummarize = olderMessages.length;
      const summarizableOlderMessages = this.preprocessMessagesForStage(olderMessages, compactionStage);

      if (summarizableOlderMessages.length === 0 && !priorSummaryText) {
        return {
          summarized: false,
          messages: [...preservedStableMessages, ...recentMessages],
          messagesSummarized: 0,
          compactionStage,
          contextFillRatio,
        };
      }

      // Format older messages for summarization
      const conversationText = this.formatMessagesForSummary(summarizableOlderMessages);

      // Generate summary — UPDATE existing summary if we have one, else from-scratch.
      const summaryText = priorSummaryText
        ? await this.generateUpdatedSummary(priorSummaryText, conversationText)
        : await this.generateSummary(conversationText);

      // Extract trading context from summary
      const tradingContext = this.extractTradingContext(summaryText);

      const artifactIndexBlock = this.buildArtifactIndexBlock(olderMessages, tradingContext);
      const compactionDetails = this.buildCompactionDetails(
        olderMessages,
        tradingContext,
        adjustedMessagesToSummarize,
        Boolean(priorSummaryText),
      );

      // Create summary message
      const summaryMessage: Message = {
        role: "system" as MessageRole,
        content: [
          `[GORDON_COMPACTION_STAGE:${compactionStage}]`,
          artifactIndexBlock,
          summaryText,
        ].filter(Boolean).join("\n"),
      };

      // Combine summary with recent messages
      const summarizedMessages: Message[] = [...preservedStableMessages, summaryMessage, ...recentMessages];

      logger.info("Summarization complete", {
        originalCount: messages.length,
        newCount: summarizedMessages.length,
        summarizedCount: messagesToSummarize,
      });

      // Wire: record tombstones for compacted messages (audit trail)
      try {
        const { recordTombstones } = await import("../../context/compaction/tombstones.ts");
        const compactedContent = olderMessages
          .filter((m) => typeof m.content === "string")
          .map((m) => ({ role: String(m.role), content: String(m.content) }));
        void recordTombstones(compactedContent, "full_compact");
      } catch { /* non-critical */ }

      // Wire: extract durable facts to session memory before they're lost
      try {
        const { parseExtractionOutput, addSessionMemory } = await import("../../memory/sessionMemory.ts");
        // Use the "Durable User Facts" section from the summary if present
        const durableMatch = summaryText.match(/### Durable User Facts[\s\S]*?(?=###|$)/);
        if (durableMatch && !durableMatch[0].includes("None in this conversation")) {
          const facts = parseExtractionOutput(
            `[{"category":"user_fact","content":${JSON.stringify(durableMatch[0].trim())},"confidence":0.8}]`,
          );
          for (const fact of facts) addSessionMemory(fact);
        }
      } catch { /* non-critical */ }

      return {
        summarized: true,
        messages: summarizedMessages,
        messagesSummarized: adjustedMessagesToSummarize,
        summaryText,
        tradingContext,
        compactionStage,
        contextFillRatio,
        compactionDetails,
      };
    } catch (error) {
      logger.error("Summarization failed, returning original messages", error as Error);
      // On failure, return original messages to avoid data loss
      return {
        summarized: false,
        messages,
        messagesSummarized: 0,
        compactionStage,
        contextFillRatio,
      };
    }
  }

  /**
   * Token budget for "recent" messages per stage. Recent messages are kept
   * verbatim instead of folded into the summary. Tighter stages shed more
   * tokens and keep fewer recent tokens. Used alongside the message-count
   * floor from RECENT_OBSERVATIONS_TO_KEEP. Values come from config with
   * DEFAULT_RECENT_TOKEN_BUDGET_BY_STAGE as fallback.
   */
  private getRecentTokenBudgetForStage(stage: CompactionStage): number {
    const configured = this.config.recentTokenBudgetByStage?.[stage];
    return typeof configured === "number" && configured > 0
      ? configured
      : DEFAULT_RECENT_TOKEN_BUDGET_BY_STAGE[stage];
  }

  /**
   * Snap the kept-recent window forward to the next `user` message so the
   * suffix the LLM sees starts at a clean turn boundary. Anything we drop
   * flows back into the older chunk and gets summarized. Returning [] is
   * acceptable — the caller treats it as "no recent messages to preserve"
   * and the walker budget will be retried against a larger older window.
   */
  private snapRecentToTurnBoundary(recent: Message[]): Message[] {
    if (recent.length === 0) return recent;
    const firstMessage = recent[0];
    if (!firstMessage) return recent;
    if (firstMessage.role === "user") return recent;
    for (let i = 1; i < recent.length; i += 1) {
      const candidate = recent[i];
      if (candidate && candidate.role === "user") {
        return recent.slice(i);
      }
    }
    return [];
  }

  /**
   * Walk messages newest-to-oldest, keeping at least `minKeepCount` messages
   * and as many more as fit within `tokenBudget`. Returns messages in
   * original (oldest-first) order.
   */
  private walkRecentByTokenBudget(
    messages: Message[],
    minKeepCount: number,
    tokenBudget: number,
  ): Message[] {
    if (messages.length === 0) return [];
    const hardFloor = Math.min(minKeepCount, messages.length);
    const kept: Message[] = [];
    let tokens = 0;

    for (let i = messages.length - 1; i >= 0; i -= 1) {
      const message = messages[i];
      if (!message) continue;
      const msgTokens = Math.ceil(String(message.content).length / 4);
      const belowFloor = kept.length < hardFloor;
      if (belowFloor || tokens + msgTokens <= tokenBudget) {
        kept.unshift(message);
        tokens += msgTokens;
      } else {
        break;
      }
    }
    return kept;
  }

  /**
   * Generate an UPDATED summary by merging a new conversation chunk into a
   * prior summary text. Used when iterative compaction detects a pre-existing
   * summary in the message history.
   */
  private async generateUpdatedSummary(priorSummary: string, conversationText: string): Promise<string> {
    const userPrompt = UPDATE_SUMMARIZATION_USER_PROMPT
      .replace("{priorSummary}", priorSummary)
      .replace("{conversation}", conversationText || "(no new messages since prior summary — just restate)");
    const route = resolveWorkflowPhaseModelRoute("compaction");

    const response = await this.llm.chatWithConfig([
      { role: "system", content: UPDATE_SUMMARIZATION_SYSTEM_PROMPT },
      { role: "user", content: userPrompt },
    ], {
      provider: route.provider,
      model: route.model,
      temperature: this.config.temperature,
      maxTokens: this.config.maxSummaryTokens,
    });

    recordPhaseLLMCost(response.usage, route.model);
    return response.content;
  }

  /**
   * Build domain metadata block (CompactionDetails) — extracts the same
   * artifact categories the artifact-index block uses, but returns them as a
   * structured object the orchestrator can persist.
   */
  private buildCompactionDetails(
    foldedMessages: Message[],
    context: TradingContext,
    messagesFolded: number,
    iterative: boolean,
  ): CompactionDetails {
    const combinedText = [
      ...foldedMessages.map((m) => String(m.content)),
      ...context.decisions,
      ...context.positionsAndAnalysis,
      ...context.userPreferences,
      ...context.importantContext,
    ].join("\n");

    const symbols = new Set<string>();
    for (const match of combinedText.matchAll(/\b[A-Z]{2,10}(?:USDT|USD|BTC|ETH|SOL)?\b/g)) {
      const symbol = match[0];
      if (/[A-Z]{2,10}(USDT|USD|BTC|ETH|SOL)$/.test(symbol) || /^[A-Z]{1,5}$/.test(symbol)) {
        symbols.add(symbol);
      }
    }

    const lowered = combinedText.toLowerCase();
    const matchSet = (terms: readonly string[]): string[] => {
      const hit: string[] = [];
      for (const term of terms) {
        if (lowered.includes(term.toLowerCase())) hit.push(term);
      }
      return hit;
    };

    return {
      symbols: [...symbols].slice(0, 24),
      venues: matchSet(ARTIFACT_VOCABULARY.venues),
      strategies: matchSet(ARTIFACT_VOCABULARY.strategies),
      indicators: matchSet(ARTIFACT_VOCABULARY.indicators),
      chartPatterns: matchSet(ARTIFACT_VOCABULARY.chartPatterns),
      timeframes: matchSet(ARTIFACT_VOCABULARY.timeframes),
      researchArtifacts: matchSet(ARTIFACT_VOCABULARY.researchArtifacts),
      mandates: matchSet(ARTIFACT_VOCABULARY.mandates),
      approvals: matchSet(ARTIFACT_VOCABULARY.approvals),
      messagesFolded,
      iterative,
    };
  }

  private getRecentMessagesToKeepForStage(stage: CompactionStage): number {
    const observationCount = RECENT_OBSERVATIONS_TO_KEEP[stage];
    return Math.max(observationCount, Math.min(this.config.recentMessagesToKeep, observationCount + 2));
  }

  private preprocessMessagesForStage(messages: Message[], stage: CompactionStage): Message[] {
    const truncateTo = stage === "full" || stage === "aggressive" ? 450 : stage === "pruning" ? 900 : 1400;

    return messages
      .map((message) => {
        if (message.content.length <= truncateTo) {
          return message;
        }
        // Semantic masking at the masking/pruning stages: instead of blunt
        // truncation, drop low-salience sentences (meta-commentary, repeated
        // acknowledgments, verbose formatting) and replace them with a
        // [masked N tokens] marker. Full / aggressive stages still hard-
        // truncate since those already need to shed token volume fast.
        if (stage === "masking" || stage === "pruning") {
          const masked = semanticMask(message.content, truncateTo);
          return { ...message, content: masked };
        }
        return {
          ...message,
          content: `${message.content.slice(0, truncateTo)}... [${stage} compaction truncated]`,
        };
      })
      .filter((message) => message.content.trim().length > 0);
  }

  /**
   * Format messages into a readable conversation string for summarization
   */
  private formatMessagesForSummary(messages: Message[]): string {
    return messages
      .map((msg) => {
        const roleLabel = this.getRoleLabel(msg.role);
        // Truncate very long messages to avoid token explosion
        const content = msg.content.length > 2000
          ? msg.content.substring(0, 2000) + "... [truncated]"
          : msg.content;
        return `${roleLabel}: ${content}`;
      })
      .join("\n\n");
  }

  /**
   * Get human-readable label for message role
   */
  private getRoleLabel(role: MessageRole): string {
    switch (role) {
      case "user":
        return "User";
      case "assistant":
        return "Gordon";
      case "system":
        return "System";
      default:
        return role;
    }
  }

  private isStableContextMessage(message: Message): boolean {
    if (message.role !== "system") {
      return false;
    }

    return [
      PROJECT_TRUTH_MARKER,
      INTEGRATION_GLOSSARY_MARKER,
      TOOL_CONTEXT_MARKER,
      RUNTIME_STATE_MARKER,
      ARTIFACT_INDEX_MARKER,
    ].some((marker) => message.content.includes(marker));
  }

  private buildArtifactIndexBlock(messages: Message[], context: TradingContext): string {
    const symbolMatches = new Set<string>();
    const venueMatches = new Set<string>();
    const strategyMatches = new Set<string>();
    const datasetMatches = new Set<string>();
    const mandateMatches = new Set<string>();
    const approvalMatches = new Set<string>();

    const combinedText = [
      ...messages.map((message) => message.content),
      ...context.decisions,
      ...context.positionsAndAnalysis,
      ...context.userPreferences,
      ...context.importantContext,
    ].join("\n");

    for (const match of combinedText.matchAll(/\b[A-Z]{2,10}(?:USDT|USD|BTC|ETH|SOL)?\b/g)) {
      const symbol = match[0];
      if (/[A-Z]{2,10}(USDT|USD|BTC|ETH|SOL)$/.test(symbol) || /^[A-Z]{1,5}$/.test(symbol)) {
        symbolMatches.add(symbol);
      }
    }

    const loweredCombined = combinedText.toLowerCase();
    const addMatches = (bag: Set<string>, terms: readonly string[]) => {
      for (const term of terms) {
        if (loweredCombined.includes(term.toLowerCase())) bag.add(term);
      }
    };
    addMatches(venueMatches, ARTIFACT_VOCABULARY.venues);
    addMatches(strategyMatches, ARTIFACT_VOCABULARY.strategies);
    addMatches(datasetMatches, ARTIFACT_VOCABULARY.researchArtifacts);
    addMatches(mandateMatches, ARTIFACT_VOCABULARY.mandates);
    addMatches(approvalMatches, ARTIFACT_VOCABULARY.approvals);

    const lines = [
      ARTIFACT_INDEX_MARKER,
      `- Symbols: ${[...symbolMatches].slice(0, 12).join(", ") || "none"}`,
      `- Venues: ${[...venueMatches].join(", ") || "none"}`,
      `- Strategies: ${[...strategyMatches].join(", ") || "none"}`,
      `- Research artifacts: ${[...datasetMatches].join(", ") || "none"}`,
      `- Runtime mandates: ${[...mandateMatches].join(", ") || "none"}`,
      `- Approval state hints: ${[...approvalMatches].join(", ") || "none"}`,
    ];

    return lines.join("\n");
  }

  /**
   * Generate summary using the LLM
   */
  private async generateSummary(conversationText: string): Promise<string> {
    const userPrompt = SUMMARIZATION_USER_PROMPT.replace("{conversation}", conversationText);
    const route = resolveWorkflowPhaseModelRoute("compaction");

    const response = await this.llm.chatWithConfig([
      { role: "system", content: SUMMARIZATION_SYSTEM_PROMPT },
      { role: "user", content: userPrompt },
    ], {
      provider: route.provider,
      model: route.model,
      temperature: this.config.temperature,
      maxTokens: this.config.maxSummaryTokens,
    });

    recordPhaseLLMCost(response.usage, route.model);
    return response.content;
  }

  /**
   * Extract structured trading context from summary text
   */
  private extractTradingContext(summaryText: string): TradingContext {
    const context: TradingContext = {
      decisions: [],
      positionsAndAnalysis: [],
      userPreferences: [],
      importantContext: [],
    };

    // Parse the structured summary sections
    const sections = {
      decisions: /### Key Decisions Made:\s*([\s\S]*?)(?=###|$)/i,
      positions: /### Active Positions\/Analysis:\s*([\s\S]*?)(?=###|$)/i,
      context: /### Important Context:\s*([\s\S]*?)(?=###|$)/i,
    };

    // Extract decisions
    const decisionsMatch = summaryText.match(sections.decisions);
    if (decisionsMatch && decisionsMatch[1]) {
      context.decisions = this.extractBulletPoints(decisionsMatch[1]);
    }

    // Extract positions/analysis
    const positionsMatch = summaryText.match(sections.positions);
    if (positionsMatch && positionsMatch[1]) {
      context.positionsAndAnalysis = this.extractBulletPoints(positionsMatch[1]);
    }

    // Extract important context (includes user preferences)
    const contextMatch = summaryText.match(sections.context);
    if (contextMatch && contextMatch[1]) {
      const allContext = this.extractBulletPoints(contextMatch[1]);
      // Separate user preferences from other context
      allContext.forEach((item) => {
        if (this.isUserPreference(item)) {
          context.userPreferences.push(item);
        } else {
          context.importantContext.push(item);
        }
      });
    }

    return context;
  }

  /**
   * Extract bullet points from a text section
   */
  private extractBulletPoints(text: string): string[] {
    const lines = text.split("\n");
    const points: string[] = [];

    for (const line of lines) {
      const trimmed = line.trim();
      // Match bullet points (-, *, or numbered)
      const bulletMatch = trimmed.match(/^[-*]\s+(.+)$/) || trimmed.match(/^\d+\.\s+(.+)$/);
      if (bulletMatch && bulletMatch[1]) {
        points.push(bulletMatch[1].trim());
      } else if (trimmed && !trimmed.toLowerCase().includes("none")) {
        // Include non-bullet lines if they have content
        points.push(trimmed);
      }
    }

    return points.filter((p) => p.length > 0);
  }

  /**
   * Check if a context item is a user preference
   */
  private isUserPreference(item: string): boolean {
    const preferencePatterns = [
      /prefer/i,
      /risk.*(tolerance|appetite|level)/i,
      /like(s)? to/i,
      /always/i,
      /never/i,
      /style/i,
      /timeframe/i,
      /favorite/i,
      /avoid/i,
    ];
    return preferencePatterns.some((pattern) => pattern.test(item));
  }

  /**
   * Update configuration
   */
  updateConfig(config: Partial<SummarizerConfig>): void {
    this.config = { ...this.config, ...config };
    logger.debug("Summarizer config updated", { config: this.config });
  }

  /**
   * Get current configuration
   */
  getConfig(): SummarizerConfig {
    return { ...this.config };
  }
}

// ============================================================================
// Factory Functions
// ============================================================================

/**
 * Create a new ConversationSummarizer instance
 */
export function createSummarizer(
  llm: LLMClient,
  config?: Partial<SummarizerConfig>
): ConversationSummarizer {
  return new ConversationSummarizer(llm, config);
}

// ============================================================================
// ACE Reflector / Curator Pipeline
// ============================================================================

export interface ReflectorBullet {
  content: string;
  category: "decision" | "observation" | "preference" | "risk" | "venue" | "strategy";
  score: number; // 0–1, higher = more important to retain
  createdAt: number;
}

export interface CuratorResult {
  retained: ReflectorBullet[];
  pruned: number;
  totalScore: number;
}

const CATEGORY_WEIGHTS: Record<ReflectorBullet["category"], number> = {
  risk: 0.90,
  decision: 0.85,
  venue: 0.70,
  strategy: 0.70,
  observation: 0.60,
  preference: 0.50,
};

const CATEGORY_PATTERNS: Array<{ category: ReflectorBullet["category"]; patterns: RegExp[] }> = [
  {
    category: "decision",
    patterns: [/\b(buy|sell|long|short|enter|exit|place|executed?|order|trade)\b/i],
  },
  {
    category: "risk",
    patterns: [/\b(stop.?loss|risk|liquidat|drawdown|danger|blocked|reject|fail)\b/i],
  },
  {
    category: "venue",
    patterns: [/\b(binance|coinbase|hyperliquid|bybit|kraken|alpaca|robinhood|ibkr|schwab)\b/i],
  },
  {
    category: "strategy",
    patterns: [/\b(momentum|breakout|mean.?reversion|swing|grid|carry|arbitrage|scalp)\b/i],
  },
  {
    category: "preference",
    patterns: [/\b(prefer|always|never|avoid|like|want|risk.tolerance|timeframe)\b/i],
  },
  {
    category: "observation",
    patterns: [/\b(noticed|observed|appears?|seems?|trending|pumping|support|resistance|level)\b/i],
  },
];

function classifyContent(text: string): ReflectorBullet["category"] {
  for (const { category, patterns } of CATEGORY_PATTERNS) {
    if (patterns.some((p) => p.test(text))) return category;
  }
  return "observation";
}

/**
 * Extract structured memory bullets from conversation messages.
 * Deterministic — no LLM call. Used as the Reflector step in the ACE pipeline.
 */
export function reflectOnMessages(messages: Message[], maxBullets = 20): ReflectorBullet[] {
  const bullets: ReflectorBullet[] = [];
  const totalMessages = messages.length;

  messages.forEach((message, index) => {
    if (message.role === "system") return;

    const content = String(message.content);
    const recencyScore = (index + 1) / totalMessages; // newer = higher

    // Split into sentences / bullet lines for granular extraction
    const lines = content
      .split(/[.\n;]+/)
      .map((l) => l.trim())
      .filter((l) => l.length > 20 && l.length < 300);

    for (const line of lines.slice(0, 4)) { // max 4 bullets per message
      const category = classifyContent(line);
      const categoryWeight = CATEGORY_WEIGHTS[category];
      const score = Math.min(1, categoryWeight * 0.7 + recencyScore * 0.3);

      bullets.push({
        content: line,
        category,
        score,
        createdAt: Date.now(),
      });
    }
  });

  // Sort by score descending, take top N
  return bullets
    .sort((a, b) => b.score - a.score)
    .slice(0, maxBullets);
}

/**
 * Rank and prune memory bullets, removing duplicates.
 * Used as the Curator step in the ACE pipeline.
 */
export function curateMemoryBullets(bullets: ReflectorBullet[], maxRetain = 12): CuratorResult {
  if (bullets.length === 0) {
    return { retained: [], pruned: 0, totalScore: 0 };
  }

  const sorted = [...bullets].sort((a, b) => b.score - a.score);
  const retained: ReflectorBullet[] = [];

  for (const bullet of sorted) {
    if (retained.length >= maxRetain) break;

    // Deduplicate: skip if >80% word overlap with an already-retained bullet
    const words = new Set(bullet.content.toLowerCase().split(/\W+/).filter((w) => w.length > 3));
    const isDuplicate = retained.some((existing) => {
      const existingWords = new Set(existing.content.toLowerCase().split(/\W+/).filter((w) => w.length > 3));
      if (words.size === 0 || existingWords.size === 0) return false;
      const intersection = [...words].filter((w) => existingWords.has(w)).length;
      return intersection / Math.min(words.size, existingWords.size) > 0.8;
    });

    if (!isDuplicate) {
      retained.push(bullet);
    }
  }

  const totalScore = retained.reduce((sum, b) => sum + b.score, 0);
  return { retained, pruned: bullets.length - retained.length, totalScore };
}

/**
 * Format curator result as a compact memory block for injection into context.
 */
export function formatMemoryBullets(result: CuratorResult): string {
  if (result.retained.length === 0) return "";
  const lines = [
    "[GORDON_MEMORY_BULLETS]",
    ...result.retained.map((b) => `- [${b.category}] ${b.content} (score: ${b.score.toFixed(2)})`),
  ];
  return lines.join("\n");
}

/**
 * Create summarizer configuration from memory config
 */
export function createSummarizerConfigFromMemoryConfig(memoryConfig: {
  lastMessages?: number;
  memoryWarningThreshold?: number;
}): Partial<SummarizerConfig> {
  const lastMessages = memoryConfig.lastMessages || 20;
  const warningThreshold = memoryConfig.memoryWarningThreshold || 0.8;

  // Set threshold at warning level (e.g., 80% of 20 = 16 messages)
  const messageThreshold = Math.floor(lastMessages * warningThreshold);

  // Keep approximately 25% of messages as recent
  const recentMessagesToKeep = Math.max(3, Math.floor(lastMessages * 0.25));

  return {
    messageThreshold,
    recentMessagesToKeep,
    maxContextTokensEstimate: Math.max(6000, lastMessages * 600),
  };
}

// ============================================================================
// Prior-summary extraction helper (iterative merge support)
// ============================================================================

/**
 * Extract the summary body from a compaction-stage system message, stripping
 * the stage marker and the artifact index block so the LLM merging the new
 * content sees just the narrative summary, not the bookkeeping.
 */
function extractPriorSummaryText(content: string): string {
  // Drop the `[GORDON_COMPACTION_STAGE:xxx]` marker line
  const withoutStage = content.replace(/^\[GORDON_COMPACTION_STAGE:[^\]]+\]\s*\n?/m, "");
  // Drop the artifact index block (starts with [GORDON_ARTIFACT_INDEX] and runs until a blank line or first ## section)
  const withoutIndex = withoutStage.replace(
    /\[GORDON_ARTIFACT_INDEX\][\s\S]*?(?=\n##|\n\s*\n|$)/,
    "",
  );
  return withoutIndex.trim();
}

// ============================================================================
// Semantic masking helper (OPENDEV paper pattern)
// ============================================================================

/**
 * Semantic masking — the masking/pruning stages of compaction drop
 * low-salience sentences and replace them with `[masked N tokens]` markers
 * instead of blunt truncation. Keeps the high-signal content (decisions,
 * specific numbers, questions, errors) and compresses the filler
 * (acknowledgments, meta-commentary, verbose headers).
 *
 * Heuristic salience: a sentence is high-salience if it contains:
 *   - numbers, dollar signs, percent signs
 *   - trading vocabulary (entry, exit, stop, target, symbol, position)
 *   - error / warning / critical keywords
 *   - tool call or decision markers
 *   - questions (end with ?)
 * Otherwise it's droppable filler.
 */
function semanticMask(content: string, targetLength: number): string {
  if (content.length <= targetLength) return content;

  const SALIENT_PATTERNS = [
    /\$[0-9]/,
    /[0-9]+(?:\.[0-9]+)?\s*%/,
    /[0-9]{4,}/,
    /\b(entry|exit|stop|target|position|symbol|ticker|trade|price|level|support|resistance)\b/i,
    /\b(error|warning|critical|failed|rejected|blocked|violat)/i,
    /\b(buy|sell|long|short|open|close|filled)\b/i,
    /\?$/,
    /\b(decided|concluded|recommend|suggest|propose)\b/i,
  ];

  const sentences = content.split(/(?<=[.!?])\s+/).filter((s) => s.length > 0);
  if (sentences.length <= 2) {
    // Too short to meaningfully mask — fall back to truncation
    return `${content.slice(0, targetLength)}... [masked ${content.length - targetLength} tokens]`;
  }

  let kept: string[] = [];
  let droppedCount = 0;
  let droppedLength = 0;
  let currentLength = 0;

  for (const sentence of sentences) {
    const isSalient = SALIENT_PATTERNS.some((re) => re.test(sentence));
    if (isSalient || currentLength < targetLength * 0.4) {
      kept.push(sentence);
      currentLength += sentence.length + 1;
    } else {
      droppedCount += 1;
      droppedLength += sentence.length;
    }
    if (currentLength > targetLength) break;
  }

  let result = kept.join(" ");
  if (droppedCount > 0) {
    const approxTokens = Math.round(droppedLength / 4);
    result += ` [masked ${approxTokens} tokens across ${droppedCount} sentences]`;
  }
  if (result.length > targetLength + 60) {
    result = `${result.slice(0, targetLength)}... [truncated]`;
  }
  return result;
}
