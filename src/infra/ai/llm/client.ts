/**
 * LLM Client
 * Multi-provider support for OpenAI and Dedalus Labs.
 */

import { z } from "zod";
import type {
  LLMClientConfig,
  LLMProvider,
  LLMResponse,
  Message,
  ModelConfig,
  OpenAIRequestBody,
  OpenAIResponse,
  OpenAIErrorResponse,
} from "./types.ts";
import { API_ENDPOINTS, GORDON_MODELS } from "./types.ts";
import { getDirectClientRoute } from "../../runtime/providers/registry.ts";

// Default configuration values
const DEFAULT_PROVIDER: LLMProvider = "dedalus";
const DEFAULT_MODEL = "openai/gpt-5.2";
const DEFAULT_TEMPERATURE = 0.7;
const DEFAULT_MAX_TOKENS = 2000;

// Retry configuration
const DEFAULT_MAX_RETRIES = 3;
const DEFAULT_INITIAL_RETRY_DELAY_MS = 1000;
const MAX_RETRY_DELAY_MS = 32000;

/**
 * Custom error class for LLM API errors
 */
export class LLMError extends Error {
  public statusCode: number;
  public errorType: string;
  public isRateLimit: boolean;
  public isRetryable: boolean;
  public provider: LLMProvider;

  constructor(
    message: string,
    statusCode: number,
    errorType: string = "api_error",
    provider: LLMProvider = "dedalus"
  ) {
    super(message);
    this.name = "LLMError";
    this.statusCode = statusCode;
    this.errorType = errorType;
    this.provider = provider;
    this.isRateLimit = statusCode === 429;
    this.isRetryable =
      statusCode === 429 || statusCode === 500 || statusCode === 503;
  }
}

/**
 * Structured "this provider is done for this request" signal.
 *
 * Thrown by the client's retry loop when same-provider retries terminate:
 * immediately for non-retryable statuses (400/401/403, …) and after the
 * retry budget for retryable ones (429/5xx, network errors). Carries the
 * provider, the number of attempts made, and the final HTTP status so a
 * failover layer (`executeWithFailover`) can move to the next provider
 * without re-waiting any backoff.
 */
export class ProviderExhaustedError extends LLMError {
  public attempts: number;

  constructor(
    message: string,
    statusCode: number,
    errorType: string,
    provider: LLMProvider,
    attempts: number
  ) {
    super(
      `[${provider}] provider exhausted after ${attempts} attempt(s) (status ${statusCode}): ${message}`,
      statusCode,
      errorType,
      provider
    );
    this.name = "ProviderExhaustedError";
    this.attempts = attempts;
  }
}

/**
 * Sleep for a given number of milliseconds
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Calculate exponential backoff delay
 */
function getBackoffDelay(attempt: number, initialDelayMs: number): number {
  const delay = initialDelayMs * Math.pow(2, attempt);
  const jitter = Math.random() * 0.3 * delay;
  return Math.min(delay + jitter, MAX_RETRY_DELAY_MS);
}

/**
 * Multi-provider LLM Client for Gordon
 *
 * Supports:
 * - OpenAI direct (GPT-5.2 variants)
 * - Dedalus Labs (multi-provider orchestration)
 */
export class LLMClient {
  private openaiApiKey?: string;
  private dedalusApiKey?: string;
  private defaultProvider: LLMProvider;
  private defaultModel: string;
  private defaultTemperature: number;
  private defaultMaxTokens: number;
  private maxRetries: number;
  private retryDelayMs: number;

  constructor(config: LLMClientConfig) {
    if (!config.openaiApiKey && !config.dedalusApiKey) {
      throw new Error("LLMClient requires at least one API key (openaiApiKey or dedalusApiKey)");
    }

    this.openaiApiKey = config.openaiApiKey;
    this.dedalusApiKey = config.dedalusApiKey;
    this.defaultProvider = config.defaultProvider ?? DEFAULT_PROVIDER;
    this.defaultModel = config.defaultModel ?? DEFAULT_MODEL;
    this.defaultTemperature = config.temperature ?? DEFAULT_TEMPERATURE;
    this.defaultMaxTokens = config.maxTokens ?? DEFAULT_MAX_TOKENS;
    this.maxRetries = config.maxRetries ?? DEFAULT_MAX_RETRIES;
    this.retryDelayMs = config.retryDelayMs ?? DEFAULT_INITIAL_RETRY_DELAY_MS;

    // Validate that the default provider has an API key
    if (this.defaultProvider === "openai" && !this.openaiApiKey) {
      throw new Error("OpenAI API key required when defaultProvider is 'openai'");
    }
    if (this.defaultProvider === "dedalus" && !this.dedalusApiKey) {
      throw new Error("Dedalus API key required when defaultProvider is 'dedalus'");
    }
  }

  /**
   * Get API key for a provider
   */
  private getApiKey(provider: LLMProvider): string {
    if (provider === "openai") {
      if (!this.openaiApiKey) {
        throw new LLMError("OpenAI API key not configured", 401, "auth_error", provider);
      }
      return this.openaiApiKey;
    }

    if (!this.dedalusApiKey) {
      throw new LLMError("Dedalus API key not configured", 401, "auth_error", provider);
    }
    return this.dedalusApiKey;
  }

  /**
   * Get base URL for a provider
   */
  private getBaseUrl(provider: LLMProvider): string {
    return API_ENDPOINTS[provider];
  }

  /**
   * Resolve a preset into runtime config.
   * Uses preset provider/model when that provider is configured;
   * otherwise falls back to client defaults while preserving preset sampling params.
   */
  private resolvePresetConfig(
    preset: (typeof GORDON_MODELS)[keyof typeof GORDON_MODELS]
  ): ModelConfig {
    const usePresetProvider = this.hasProvider(preset.provider);
    return {
      provider: usePresetProvider ? preset.provider : this.defaultProvider,
      model: (usePresetProvider ? preset.model : this.defaultModel) as ModelConfig["model"],
      temperature: preset.temperature,
      maxTokens: preset.maxTokens,
    };
  }

  /**
   * Build request body
   */
  private buildRequestBody(
    messages: Message[],
    model: string,
    temperature: number,
    maxTokens: number,
    jsonMode: boolean = false,
    extraBody?: Record<string, unknown>,
  ): OpenAIRequestBody {
    const body: OpenAIRequestBody = {
      model,
      messages: messages.map((m) => ({ role: m.role, content: m.content })),
      temperature,
      max_tokens: maxTokens,
    };

    if (jsonMode) {
      body.response_format = { type: "json_object" };
    }

    if (extraBody && Object.keys(extraBody).length > 0) {
      body.extra_body = extraBody;
    }

    return body;
  }

  /**
   * Make an API request with retry logic
   */
  private async makeRequest(
    provider: LLMProvider,
    body: OpenAIRequestBody,
    attempt: number = 0
  ): Promise<OpenAIResponse> {
    const baseUrl = this.getBaseUrl(provider);
    const apiKey = this.getApiKey(provider);
    const url = `${baseUrl}/chat/completions`;

    try {
      const response = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        const errorData = (await response.json()) as OpenAIErrorResponse;
        const errorMessage =
          errorData.error?.message ?? `HTTP error ${response.status}`;
        const errorType = errorData.error?.type ?? "api_error";

        const error = new LLMError(errorMessage, response.status, errorType, provider);

        // Retry on rate limits or server errors
        if (error.isRetryable && attempt < this.maxRetries) {
          const delay = getBackoffDelay(attempt, this.retryDelayMs);
          console.warn(
            `[${provider}] LLM request failed (${response.status}), retrying in ${Math.round(delay)}ms...`
          );
          await sleep(delay);
          return this.makeRequest(provider, body, attempt + 1);
        }

        throw new ProviderExhaustedError(
          error.message,
          error.statusCode,
          error.errorType,
          provider,
          attempt + 1,
        );
      }

      return (await response.json()) as OpenAIResponse;
    } catch (error) {
      // Handle network errors
      if (
        error instanceof TypeError &&
        error.message.includes("fetch failed")
      ) {
        if (attempt < this.maxRetries) {
          const delay = getBackoffDelay(attempt, this.retryDelayMs);
          console.warn(
            `[${provider}] Network error, retrying in ${Math.round(delay)}ms...`
          );
          await sleep(delay);
          return this.makeRequest(provider, body, attempt + 1);
        }
        throw new ProviderExhaustedError(
          `Network error: Unable to reach ${provider} API`,
          0,
          "network_error",
          provider,
          attempt + 1,
        );
      }

      if (error instanceof ProviderExhaustedError) {
        throw error;
      }

      if (error instanceof LLMError) {
        throw new ProviderExhaustedError(
          error.message,
          error.statusCode,
          error.errorType,
          provider,
          attempt + 1,
        );
      }

      throw error;
    }
  }

  /**
   * Parse API response
   */
  private parseResponse(
    response: OpenAIResponse,
    provider: LLMProvider
  ): LLMResponse {
    const choice = response.choices[0];
    if (!choice) {
      throw new LLMError("No response choice returned from API", 500, "no_choice", provider);
    }

    return {
      content: choice.message.content,
      usage: {
        promptTokens: response.usage.prompt_tokens,
        completionTokens: response.usage.completion_tokens,
        totalTokens: response.usage.total_tokens,
      },
      model: response.model,
      provider,
    };
  }

  /**
   * Send a chat request using default provider/model
   */
  async chat(messages: Message[]): Promise<LLMResponse> {
    return this.chatWithConfig(messages, {
      provider: this.defaultProvider,
      model: this.defaultModel,
      temperature: this.defaultTemperature,
      maxTokens: this.defaultMaxTokens,
    });
  }

  /**
   * Send a chat request with specific model configuration
   */
  async chatWithConfig(
    messages: Message[],
    config: ModelConfig,
    options: {
      /**
       * Anthropic-style system content blocks with cache_control markers.
       * When provided, forwarded via `extra_body.system_blocks` so the
       * OpenAI-compatible gateway (Dedalus/vLLM/LiteLLM) can pass them
       * through to the underlying Anthropic model for prompt caching.
       */
      systemBlocks?: Array<{
        type: "text";
        text: string;
        cache_control?: { type: "ephemeral" };
      }>;
    } = {},
  ): Promise<LLMResponse> {
    if (messages.length === 0) {
      throw new Error("Messages array cannot be empty");
    }

    const provider = config.provider;
    const model = config.model;
    const temperature = config.temperature ?? this.defaultTemperature;
    const maxTokens = config.maxTokens ?? this.defaultMaxTokens;

    const extraBody: Record<string, unknown> = {};
    if (options.systemBlocks && options.systemBlocks.length > 0) {
      extraBody.system_blocks = options.systemBlocks;
    }

    const body = this.buildRequestBody(messages, model, temperature, maxTokens, false, extraBody);
    const response = await this.makeRequest(provider, body);
    return this.parseResponse(response, provider);
  }

  /**
   * Send a chat request using a preset model configuration
   */
  async chatWithPreset(
    messages: Message[],
    preset: keyof typeof GORDON_MODELS
  ): Promise<LLMResponse> {
    const presetConfig = GORDON_MODELS[preset];
    return this.chatWithConfig(messages, this.resolvePresetConfig(presetConfig));
  }

  /**
   * Send a chat request expecting JSON, parsed with Zod schema
   */
  async chatWithJSON<T>(
    messages: Message[],
    schema: z.ZodSchema<T>,
    config?: Partial<ModelConfig>
  ): Promise<T> {
    if (messages.length === 0) {
      throw new Error("Messages array cannot be empty");
    }

    const provider = config?.provider ?? this.defaultProvider;
    const model = config?.model ?? this.defaultModel;
    const temperature = config?.temperature ?? this.defaultTemperature;
    const maxTokens = config?.maxTokens ?? this.defaultMaxTokens;

    // Ensure JSON instruction in system prompt
    const hasJsonInstruction = messages.some(
      (m) =>
        m.role === "system" &&
        (m.content.toLowerCase().includes("json") ||
          m.content.toLowerCase().includes("respond with"))
    );

    const modifiedMessages = hasJsonInstruction
      ? messages
      : messages.map((m) =>
          m.role === "system"
            ? { ...m, content: `${m.content}\n\nRespond with valid JSON.` }
            : m
        );

    const body = this.buildRequestBody(modifiedMessages, model, temperature, maxTokens, true);
    const response = await this.makeRequest(provider, body);
    const llmResponse = this.parseResponse(response, provider);

    // Parse JSON content
    let jsonContent: unknown;
    try {
      jsonContent = JSON.parse(llmResponse.content);
    } catch {
      throw new LLMError(
        `Failed to parse JSON response: ${llmResponse.content.substring(0, 100)}...`,
        500,
        "json_parse_error",
        provider
      );
    }

    // Validate with Zod schema
    const result = schema.safeParse(jsonContent);
    if (!result.success) {
      const errorMessages = result.error.issues
        .map((e) => `${String(e.path.join("."))}: ${e.message}`)
        .join(", ");
      throw new LLMError(
        `Response validation failed: ${errorMessages}`,
        500,
        "validation_error",
        provider
      );
    }

    return result.data;
  }

  /**
   * Convenience method for intent parsing (fast, cheap)
   */
  async parseIntent<T>(messages: Message[], schema: z.ZodSchema<T>): Promise<T> {
    const preset = GORDON_MODELS.intentParsing;
    return this.chatWithJSON(messages, schema, this.resolvePresetConfig(preset));
  }

  /**
   * Convenience method for plan generation (reasoning)
   */
  async generatePlan<T>(messages: Message[], schema: z.ZodSchema<T>): Promise<T> {
    const preset = GORDON_MODELS.planGeneration;
    return this.chatWithJSON(messages, schema, this.resolvePresetConfig(preset));
  }

  /**
   * Convenience method for explanations
   */
  async explain(messages: Message[]): Promise<LLMResponse> {
    const preset = GORDON_MODELS.explanations;
    return this.chatWithConfig(messages, this.resolvePresetConfig(preset));
  }

  /**
   * Check if a provider is available
   */
  hasProvider(provider: LLMProvider): boolean {
    if (provider === "openai") return !!this.openaiApiKey;
    if (provider === "dedalus") return !!this.dedalusApiKey;
    return false;
  }

  /**
   * Get list of available providers
   */
  getAvailableProviders(): LLMProvider[] {
    const providers: LLMProvider[] = [];
    if (this.openaiApiKey) providers.push("openai");
    if (this.dedalusApiKey) providers.push("dedalus");
    return providers;
  }
}

/**
 * Create a client from environment variables
 */
export function createLLMClientFromEnv(): LLMClient {
  const configuredProvider = process.env.GORDON_PROVIDER;
  const configuredModel = process.env.GORDON_MODEL ?? process.env.LLM_DEFAULT_MODEL;
  const route = getDirectClientRoute(configuredProvider, configuredModel);

  const defaultProvider: LLMProvider =
    route.provider === "dedalus" || route.provider === "openai"
      ? route.provider
      : "dedalus";

  return new LLMClient({
    openaiApiKey: process.env.OPENAI_API_KEY,
    dedalusApiKey: process.env.DEDALUS_API_KEY,
    defaultProvider,
    defaultModel: route.transportModelId,
  });
}
