/**
 * LLM Infrastructure Module
 * Multi-provider LLM support (OpenAI + Dedalus Labs)
 */

// Types
export type {
  LLMProvider,
  MessageRole,
  Message,
  TokenUsage,
  LLMResponse,
  OpenAIModel,
  DedalusModel,
  ModelConfig,
  LLMClientConfig,
  ProviderConfig,
  OpenAIMessage,
  OpenAIRequestBody,
  OpenAIResponse,
  OpenAIChoice,
  OpenAIUsage,
  OpenAIErrorResponse,
} from "./types.ts";

// Constants
export { API_ENDPOINTS, GORDON_MODELS } from "./types.ts";

// Client
export { LLMClient, LLMError, ProviderExhaustedError, createLLMClientFromEnv } from "./client.ts";
export { executeWithFailover } from "./providerFailover.ts";
export type { FailoverOptions, FailoverResult } from "./providerFailover.ts";

// Prompts
export {
  loadPrompt,
  buildMessages,
  buildMessagesWithHistory,
  injectContext,
  loadAndBuildMessages,
  PromptError,
} from "./prompts.ts";
