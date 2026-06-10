/**
 * LLM Client Types
 * Type definitions for multi-provider LLM support.
 */

/**
 * Supported LLM providers
 */
export type LLMProvider = "openai" | "dedalus" | "inception";

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
 * Response from the LLM API
 */
export interface LLMResponse {
  content: string;
  usage: TokenUsage;
  model: string;
  provider: LLMProvider;
}

/**
 * OpenAI direct model variants
 */
export type OpenAIModel =
  | "gpt-5.4"           // Default direct OpenAI model
  | "gpt-5.4-pro"       // Most capable
  | "openai/gpt-5.4"
  | "openai/gpt-5.4-pro";

/**
 * Dedalus Labs model identifiers (provider/model format)
 */
export type DedalusModel =
  // OpenAI via Dedalus
  | "openai/gpt-5.4"
  // Anthropic via Dedalus
  | "anthropic/claude-opus-4-6"
  | "anthropic/claude-sonnet-4-5-20250929"
  | "anthropic/claude-haiku-4-5-20251001"
  // Google via Dedalus
  | "google/gemini-3-flash-preview"
  | "google/gemini-3-pro-preview"
  // xAI via Dedalus
  | "xai/grok-4-1-fast-reasoning"
  | "xai/grok-4-1-fast-non-reasoning"
  // Moonshot via Dedalus
  | "moonshot/kimi-k2.5"
  // Any other model string
  | (string & {});

/**
 * Inception Labs model identifiers
 */
export type InceptionModel =
  | "mercury-2"
  | (string & {});

/**
 * Model configuration for specific use cases
 */
export interface ModelConfig {
  provider: LLMProvider;
  model: OpenAIModel | DedalusModel | InceptionModel;
  temperature?: number;
  maxTokens?: number;
}

/**
 * Gordon's recommended models by use case
 */
export const GORDON_MODELS = {
  // Intent parsing - fast and cheap
  intentParsing: {
    provider: "dedalus" as LLMProvider,
    model: "anthropic/claude-haiku-4-5-20251001",
    temperature: 0.3,
    maxTokens: 500,
  },

  // Plan generation - needs reasoning
  planGeneration: {
    provider: "dedalus" as LLMProvider,
    model: "openai/gpt-5.2",
    temperature: 0.5,
    maxTokens: 2000,
  },

  // Complex reasoning (fallback to direct OpenAI)
  complexReasoning: {
    provider: "dedalus" as LLMProvider,
    model: "anthropic/claude-opus-4-6",
    temperature: 0.4,
    maxTokens: 4000,
  },

  // Explanations - clear and educational
  explanations: {
    provider: "dedalus" as LLMProvider,
    model: "anthropic/claude-sonnet-4-5-20250929",
    temperature: 0.7,
    maxTokens: 1000,
  },

  // Fast/cheap operations
  fast: {
    provider: "dedalus" as LLMProvider,
    model: "google/gemini-3-flash-preview",
    temperature: 0.3,
    maxTokens: 500,
  },

  // Ultra-fast (Groq/Cerebras)
  ultraFast: {
    provider: "dedalus" as LLMProvider,
    model: "xai/grok-4-1-fast-non-reasoning",
    temperature: 0.3,
    maxTokens: 500,
  },
} as const;

/**
 * Configuration for the LLM client
 */
export interface LLMClientConfig {
  openaiApiKey?: string;
  dedalusApiKey?: string;
  inceptionApiKey?: string;
  defaultProvider?: LLMProvider;
  defaultModel?: string;
  temperature?: number;
  maxTokens?: number;
  maxRetries?: number;
  retryDelayMs?: number;
}

/**
 * Provider-specific configuration
 */
export interface ProviderConfig {
  apiKey: string;
  baseUrl: string;
  model: string;
  temperature: number;
  maxTokens: number;
}

/**
 * API endpoints
 */
export const API_ENDPOINTS = {
  openai: "https://api.openai.com/v1",
  dedalus: "https://api.dedaluslabs.ai/v1",
  inception: "https://api.inceptionlabs.ai/v1",
} as const;

/**
 * OpenAI API message format
 */
export interface OpenAIMessage {
  role: MessageRole;
  content: string;
}

/**
 * OpenAI API request body
 */
export interface OpenAIRequestBody {
  model: string;
  messages: OpenAIMessage[];
  temperature: number;
  max_tokens: number;
  response_format?: { type: "json_object" | "text" };
  /**
   * OpenAI-compatible endpoints (vLLM, LiteLLM, Dedalus, etc.) often forward
   * extension params to the underlying model. We use `extra_body` to smuggle
   * provider-specific hints such as Anthropic prompt-cache markers. Whether
   * the active gateway forwards it is provider-dependent — runtime testing
   * required to confirm cache hits.
   */
  extra_body?: Record<string, unknown>;
}

/**
 * OpenAI API response format
 */
export interface OpenAIResponse {
  id: string;
  object: string;
  created: number;
  model: string;
  choices: OpenAIChoice[];
  usage: OpenAIUsage;
}

/**
 * OpenAI API choice in response
 */
export interface OpenAIChoice {
  index: number;
  message: {
    role: string;
    content: string;
  };
  finish_reason: string;
}

/**
 * OpenAI API usage information
 */
export interface OpenAIUsage {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
}

/**
 * OpenAI API error response
 */
export interface OpenAIErrorResponse {
  error: {
    message: string;
    type: string;
    param?: string;
    code?: string;
  };
}
