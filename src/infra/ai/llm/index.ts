/**
 * LLM Infrastructure Module
 * Direct (non-Mastra-agent) LLM calls, routed through Mastra's native model
 * router — first-party providers + gateways.
 */

// Types
export type {
  LLMProvider,
  MessageRole,
  Message,
  TokenUsage,
  LLMResponse,
  ModelConfig,
  LLMClientConfig,
} from "./types.ts";

// Constants
export { GORDON_MODELS } from "./types.ts";

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
