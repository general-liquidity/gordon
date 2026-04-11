/**
 * Shared type definitions for the Gordon Orchestrator
 *
 * Extracted from orchestrator.ts to reduce file size and improve modularity.
 */

import type { SummarizationResult, SummarizerConfig } from "../../memory/index.ts";
import type { Message } from "../../llm/types.ts";

// ============================================================================
// Stream Event Types
// ============================================================================

/**
 * Stream event types emitted during processing
 */
export interface StreamEvent {
  type:
    | "text_delta"
    | "thinking_delta"     // LLM reasoning / chain-of-thought chunks (Vibe-Trading streaming pattern)
    | "tool_call_start"
    | "tool_call_end"
    | "agent_switch"
    | "step_complete"
    | "done"
    | "error"
    | "cancelled";
  content?: string;
  toolName?: string;
  toolArgs?: Record<string, unknown>;
  toolResult?: unknown;
  agentName?: string;
  stepIndex?: number;
  error?: string;
  usage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
}

export interface ProcessMessageStreamOptions {
  signal?: AbortSignal;
}

// ============================================================================
// Error Recovery Types
// ============================================================================

/**
 * Fallback configuration for an agent
 */
export interface AgentFallbackConfig {
  /** The primary agent to try first */
  primaryAgent: string;
  /** List of fallback agents/tools to try if primary fails */
  fallbacks: Array<{
    /** Name of the fallback agent or tool */
    name: string;
    /** Type: 'agent' for another agent, 'tool' for a basic tool, 'cache' for cached results */
    type: "agent" | "tool" | "cache";
    /** Optional condition to check before using this fallback */
    condition?: (error: Error) => boolean;
  }>;
  /** Maximum retry attempts with exponential backoff */
  maxRetries: number;
  /** Base delay in ms for exponential backoff */
  baseDelayMs: number;
  /** Whether to use cached results on failure */
  useCacheOnFailure: boolean;
}

/**
 * Fallback chain type mapping agent names to their fallback configurations
 */
export type AgentFallbackChain = Record<string, AgentFallbackConfig>;

// ============================================================================
// Security Types
// ============================================================================

/**
 * Result of security check before tool execution
 */
export interface ToolSecurityCheckResult {
  allowed: boolean;
  error?: string;
  accessControlResult?: unknown;
  rateLimitResult?: unknown;
  approvalRequestId?: string;
}

// ============================================================================
// Processing Options
// ============================================================================

/**
 * Options for message processing with summarization support
 */
export interface ProcessingOptions {
  /**
   * Enable conversation summarization when message count exceeds threshold
   * @default false
   */
  enableSummarization?: boolean;

  /**
   * Custom summarizer configuration (overrides defaults)
   */
  summarizerConfig?: Partial<SummarizerConfig>;

  /**
   * Existing conversation history to potentially summarize
   * If provided, will be checked for summarization before processing
   */
  conversationHistory?: Message[];
}

/**
 * Extended result including summarization info
 */
export interface ProcessingResultWithSummarization {
  /** The agent's response */
  response: string;
  /** Token usage statistics */
  usage: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
  /** Summarization result if summarization was performed */
  summarization?: SummarizationResult;
}
