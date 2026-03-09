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
import { resolveLegacyModelRouteForWorkflowPhase } from "../agents/workflowPhase.ts";
import {
  INTEGRATION_GLOSSARY_MARKER,
  PROJECT_TRUTH_MARKER,
  RUNTIME_STATE_MARKER,
  TOOL_CONTEXT_MARKER,
} from "../agents/contextBudget.ts";

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
  /** Compaction stage used for this summarization pass */
  compactionStage?: CompactionStage;
}

export type CompactionStage = "masking" | "pruning" | "aggressive" | "full";

/** Compaction pressure thresholds (fraction of max context budget used, per OPENDEV paper §2.3.6) */
export const COMPACTION_PRESSURE_THRESHOLDS = {
  masking: 0.70,    // 70% — warn and begin gentle masking
  pruning: 0.80,    // 80% — observation masking, preserve 6 recent
  aggressive: 0.90, // 90% — aggressive masking, preserve 3 recent
  full: 0.99,       // 99% — full LLM summary generation
} as const;

/** Recent observation counts to preserve per stage (paper §2.3.6) */
export const RECENT_OBSERVATIONS_TO_KEEP: Record<CompactionStage, number> = {
  masking: 6,
  pruning: 6,
  aggressive: 3,
  full: 3,
};

/**
 * Determine compaction stage from token-pressure ratio (0–1).
 * Preferred over message-count heuristics when token budget is known.
 */
export function determineCompactionStageFromPressure(contextFillRatio: number): CompactionStage {
  if (contextFillRatio >= COMPACTION_PRESSURE_THRESHOLDS.full) return "full";
  if (contextFillRatio >= COMPACTION_PRESSURE_THRESHOLDS.aggressive) return "aggressive";
  if (contextFillRatio >= COMPACTION_PRESSURE_THRESHOLDS.pruning) return "pruning";
  return "masking";
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

const ARTIFACT_INDEX_MARKER = "[GORDON_ARTIFACT_INDEX]";

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
    const compactionStage = this.determineCompactionStage(messages.length);
    logger.info("Starting conversation summarization", {
      totalMessages: messages.length,
      messagesToSummarize,
      keepingRecent: this.config.recentMessagesToKeep,
      compactionStage,
    });

    try {
      // Preserve stable system context outside compaction across the full message list.
      const preservedStableMessages = messages.filter((message) => this.isStableContextMessage(message));
      const nonStableMessages = messages.filter((message) => !this.isStableContextMessage(message));
      const desiredRecentKeepCount = this.getRecentMessagesToKeepForStage(compactionStage);
      const recentKeepCount = Math.min(
        Math.max(this.config.recentMessagesToKeep, desiredRecentKeepCount),
        Math.max(this.config.recentMessagesToKeep, nonStableMessages.length - 1),
      );
      const adjustedMessagesToSummarize = Math.max(0, nonStableMessages.length - recentKeepCount);
      const olderMessages = nonStableMessages.slice(0, adjustedMessagesToSummarize);
      const recentMessages = nonStableMessages.slice(adjustedMessagesToSummarize);
      const summarizableOlderMessages = this.preprocessMessagesForStage(olderMessages, compactionStage);

      if (summarizableOlderMessages.length === 0) {
        return {
          summarized: false,
          messages: [...preservedStableMessages, ...recentMessages],
          messagesSummarized: 0,
          compactionStage,
        };
      }

      // Format older messages for summarization
      const conversationText = this.formatMessagesForSummary(summarizableOlderMessages);

      // Generate summary using LLM
      const summaryText = await this.generateSummary(conversationText);

      // Extract trading context from summary
      const tradingContext = this.extractTradingContext(summaryText);

      const artifactIndexBlock = this.buildArtifactIndexBlock(olderMessages, tradingContext);

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

      return {
        summarized: true,
        messages: summarizedMessages,
        messagesSummarized: adjustedMessagesToSummarize,
        summaryText,
        tradingContext,
        compactionStage,
      };
    } catch (error) {
      logger.error("Summarization failed, returning original messages", error as Error);
      // On failure, return original messages to avoid data loss
      return {
        summarized: false,
        messages,
        messagesSummarized: 0,
        compactionStage,
      };
    }
  }

  private determineCompactionStage(messageCount: number): CompactionStage {
    const overage = messageCount - this.config.messageThreshold;
    if (overage >= Math.max(12, Math.floor(this.config.messageThreshold * 1.0))) {
      return "full";
    }
    if (overage >= Math.max(8, Math.floor(this.config.messageThreshold * 0.75))) {
      return "aggressive";
    }
    if (overage >= Math.max(4, Math.floor(this.config.messageThreshold * 0.35))) {
      return "pruning";
    }
    return "masking";
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

    for (const venue of ["Binance", "Coinbase", "Kraken", "Hyperliquid", "Uniswap", "Robinhood", "Webull", "Alpaca", "IBKR", "Trading 212", "Schwab", "tastytrade"]) {
      if (combinedText.toLowerCase().includes(venue.toLowerCase())) {
        venueMatches.add(venue);
      }
    }

    for (const strategy of ["momentum", "mean reversion", "breakout", "grid", "swing", "carry", "arbitrage"]) {
      if (combinedText.toLowerCase().includes(strategy.toLowerCase())) {
        strategyMatches.add(strategy);
      }
    }

    for (const dataset of ["snapshot", "dataset", "backtest", "experiment", "playbook"]) {
      if (combinedText.toLowerCase().includes(dataset)) {
        datasetMatches.add(dataset);
      }
    }

    for (const mandate of ["mandate", "autonomous", "daemon", "schedule"]) {
      if (combinedText.toLowerCase().includes(mandate)) {
        mandateMatches.add(mandate);
      }
    }

    for (const approval of ["approved", "rejected", "preview", "blocked"]) {
      if (combinedText.toLowerCase().includes(approval)) {
        approvalMatches.add(approval);
      }
    }

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
    const route = resolveLegacyModelRouteForWorkflowPhase("compaction");

    const response = await this.llm.chatWithConfig([
      { role: "system", content: SUMMARIZATION_SYSTEM_PROMPT },
      { role: "user", content: userPrompt },
    ], {
      provider: route.provider,
      model: route.model,
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
    patterns: [/\b(binance|coinbase|hyperliquid|bybit|kraken|uniswap|alpaca|robinhood|ibkr|schwab)\b/i],
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
  };
}
