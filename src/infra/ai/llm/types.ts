/**
 * LLM Client Types
 * Type definitions for Gordon's direct (non-Mastra) LLM calls.
 *
 * Direct calls (thinking / judges / critique / enrichment) resolve their model
 * through Mastra's native model router — the same first-party providers and
 * gateways the agents use. There is no gateway base-URL swap here.
 */

/**
 * First-party LLM providers for direct calls. Env keys are auto-detected by
 * Mastra (ANTHROPIC_API_KEY, OPENAI_API_KEY, GOOGLE_GENERATIVE_AI_API_KEY,
 * XAI_API_KEY). Tool/executor paths are pinned to these — never a text-only
 * gateway.
 */
export type LLMProvider = "openai" | "anthropic" | "google" | "xai";

/**
 * Message role in a chat conversation
 */
export type MessageRole = "system" | "user" | "assistant";

/**
 * A single message in a chat conversation
 */
export interface Message {
  role: MessageRole;
  content: string;
}

/**
 * Token usage information from an LLM response
 */
export interface TokenUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

/**
 * Response from the LLM
 */
export interface LLMResponse {
  content: string;
  usage: TokenUsage;
  model: string;
  provider: LLMProvider;
}

/**
 * Model configuration for a specific call.
 * `model` is a bare id (e.g. "claude-opus-4-6") or a full "provider/model"
 * string. When a bare id is given, `provider` qualifies it.
 */
export interface ModelConfig {
  provider: LLMProvider;
  model: string;
  temperature?: number;
  maxTokens?: number;
}

/**
 * Gordon's recommended models by use case (first-party).
 */
export const GORDON_MODELS = {
  // Intent parsing - fast and cheap
  intentParsing: {
    provider: "anthropic" as LLMProvider,
    model: "claude-haiku-4-5",
    temperature: 0.3,
    maxTokens: 500,
  },

  // Plan generation - needs reasoning
  planGeneration: {
    provider: "openai" as LLMProvider,
    model: "gpt-5.6",
    temperature: 0.5,
    maxTokens: 2000,
  },

  // Complex reasoning
  complexReasoning: {
    provider: "anthropic" as LLMProvider,
    model: "claude-opus-4-8",
    temperature: 0.4,
    maxTokens: 4000,
  },

  // Explanations - clear and educational
  explanations: {
    provider: "anthropic" as LLMProvider,
    model: "claude-sonnet-5",
    temperature: 0.7,
    maxTokens: 1000,
  },

  // Fast/cheap operations
  fast: {
    provider: "google" as LLMProvider,
    model: "gemini-3.5-flash-lite",
    temperature: 0.3,
    maxTokens: 500,
  },

  // Ultra-fast
  ultraFast: {
    provider: "xai" as LLMProvider,
    model: "grok-4.3",
    temperature: 0.3,
    maxTokens: 500,
  },
} as const;

/**
 * Configuration for the LLM client.
 * API keys are optional — Mastra's router auto-detects provider keys from env.
 */
export interface LLMClientConfig {
  defaultProvider?: LLMProvider;
  defaultModel?: string;
  temperature?: number;
  maxTokens?: number;
  maxRetries?: number;
  retryDelayMs?: number;
}
