/**
 * Conversation Summarizer
 * Intelligent summarization of conversation history for long contexts
 *
 * When conversation history exceeds a configurable threshold, this summarizer:
 * 1. Keeps the most recent N messages intact
 * 2. Summarizes older messages into a structured context summary
 * 3. Preserves key trading context: positions, decisions, analysis results
 */

import type { Message, MessageRole } from "../llm/types.ts";
import type { LLMClient } from "../llm/client.ts";
import { createModuleLogger } from "../logger/index.ts";

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
}

/**
 * Default summarizer configuration
 */
export const DEFAULT_SUMMARIZER_CONFIG: SummarizerConfig = {
  messageThreshold: 20,
  recentMessagesToKeep: 5,
  maxSummaryTokens: 1000,
  temperature: 0.3,
};

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

Keep the summary concise but don't lose critical trading information. Use bullet points for clarity.`;

const SUMMARIZATION_USER_PROMPT = `Please summarize the following conversation history. Focus on preserving trading-relevant information.

CONVERSATION HISTORY:
{conversation}

Remember to use the exact template format with the three sections: Key Decisions Made, Active Positions/Analysis, and Important Context.`;

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
    return messages.length > this.config.messageThreshold;
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
      };
    }

    const messagesToSummarize = messages.length - this.config.recentMessagesToKeep;
    logger.info("Starting conversation summarization", {
      totalMessages: messages.length,
      messagesToSummarize,
      keepingRecent: this.config.recentMessagesToKeep,
    });

    try {
      // Split messages: older ones to summarize, recent ones to keep
      const olderMessages = messages.slice(0, messagesToSummarize);
      const recentMessages = messages.slice(messagesToSummarize);

      // Format older messages for summarization
      const conversationText = this.formatMessagesForSummary(olderMessages);

      // Generate summary using LLM
      const summaryText = await this.generateSummary(conversationText);

      // Extract trading context from summary
      const tradingContext = this.extractTradingContext(summaryText);

      // Create summary message
      const summaryMessage: Message = {
        role: "system" as MessageRole,
        content: summaryText,
      };

      // Combine summary with recent messages
      const summarizedMessages: Message[] = [summaryMessage, ...recentMessages];

      logger.info("Summarization complete", {
        originalCount: messages.length,
        newCount: summarizedMessages.length,
        summarizedCount: messagesToSummarize,
      });

      return {
        summarized: true,
        messages: summarizedMessages,
        messagesSummarized: messagesToSummarize,
        summaryText,
        tradingContext,
      };
    } catch (error) {
      logger.error("Summarization failed, returning original messages", error as Error);
      // On failure, return original messages to avoid data loss
      return {
        summarized: false,
        messages,
        messagesSummarized: 0,
      };
    }
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

  /**
   * Generate summary using the LLM
   */
  private async generateSummary(conversationText: string): Promise<string> {
    const userPrompt = SUMMARIZATION_USER_PROMPT.replace("{conversation}", conversationText);

    const response = await this.llm.chatWithConfig([
      { role: "system", content: SUMMARIZATION_SYSTEM_PROMPT },
      { role: "user", content: userPrompt },
    ], {
      provider: "dedalus",
      model: "openai/gpt-5.2",
      temperature: this.config.temperature,
      maxTokens: this.config.maxSummaryTokens,
    });

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
  };
}
