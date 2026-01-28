/**
 * LLM Client Types
 * Type definitions for multi-provider LLM support (OpenAI + Dedalus Labs)
 */

/**
 * Supported LLM providers
 */
export type LLMProvider = "openai" | "dedalus";

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
 * OpenAI GPT-5.2 model variants
 */
export type OpenAIModel =
  | "gpt-5.2"           // Default GPT-5.2
  | "gpt-5.2-instant"   // Fast responses
  | "gpt-5.2-thinking"  // Reasoning mode
  | "gpt-5.2-pro"       // Most capable
  | "gpt-5.2-codex"     // Code optimized
  | "o3"                // Deep reasoning
  | "o3-mini"           // Lightweight reasoning
  | "o4-mini";          // Latest reasoning

/**
 * Dedalus Labs model identifiers (provider/model format)
 */
export type DedalusModel =
  // OpenAI via Dedalus
  | "openai/gpt-5.2"
  | "openai/gpt-5.1"
  | "openai/gpt-5"
  | "openai/gpt-5-mini"
  | "openai/gpt-5-nano"
  | "openai/gpt-5-codex"
  | "openai/gpt-4o"
  | "openai/o3"
  | "openai/o3-mini"
  // Anthropic via Dedalus
  | "anthropic/claude-opus-4-5"
  | "anthropic/claude-sonnet-4-5-20250929"
  | "anthropic/claude-haiku-4-5-20251001"
  // Google via Dedalus
  | "google/gemini-2.5-pro"
  | "google/gemini-2.5-flash"
  | "google/gemini-2.5-flash-lite"
  | "google/gemini-3-pro-preview"
  // DeepSeek via Dedalus
  | "deepseek/deepseek-chat"
  | "deepseek/deepseek-reasoner"
  | "deepseek/deepseek-coder"
  // xAI via Dedalus
  | "xai/grok-4-fast-reasoning"
  | "xai/grok-4-fast-non-reasoning"
  | "xai/grok-code-fast-1"
  // Groq via Dedalus (fast inference)
  | "groq/llama-3.3-70b-versatile"
  | "groq/llama-3.1-8b-instant"
  // Cerebras via Dedalus (ultra-fast)
  | "cerebras/llama-3.3-70b"
  | "cerebras/llama3.1-8b"
  // Any other model string
  | (string & {});

/**
 * Model configuration for specific use cases
 */
export interface ModelConfig {
  provider: LLMProvider;
  model: OpenAIModel | DedalusModel;
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
    model: "openai/gpt-5-nano",
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
    provider: "openai" as LLMProvider,
    model: "gpt-5.2-thinking" as OpenAIModel,
    temperature: 0.4,
    maxTokens: 4000,
  },

  // Explanations - clear and educational
  explanations: {
    provider: "dedalus" as LLMProvider,
    model: "openai/gpt-5-mini",
    temperature: 0.7,
    maxTokens: 1000,
  },

  // Fast/cheap operations
  fast: {
    provider: "dedalus" as LLMProvider,
    model: "google/gemini-2.5-flash",
    temperature: 0.3,
    maxTokens: 500,
  },

  // Ultra-fast (Groq/Cerebras)
  ultraFast: {
    provider: "dedalus" as LLMProvider,
    model: "groq/llama-3.1-8b-instant",
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
  defaultProvider?: LLMProvider;
  defaultModel?: string;
  temperature?: number;
  maxTokens?: number;
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
