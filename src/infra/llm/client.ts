/**
 * LLM Client
 * Multi-provider support for OpenAI (direct) and Dedalus Labs (orchestration)
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

// Default configuration values
const DEFAULT_PROVIDER: LLMProvider = "dedalus";
const DEFAULT_MODEL = "openai/gpt-5-nano";
const DEFAULT_TEMPERATURE = 0.7;
const DEFAULT_MAX_TOKENS = 2000;

// Retry configuration
const MAX_RETRIES = 3;
const INITIAL_RETRY_DELAY_MS = 1000;
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
 * Sleep for a given number of milliseconds
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Calculate exponential backoff delay
 */
function getBackoffDelay(attempt: number): number {
  const delay = INITIAL_RETRY_DELAY_MS * Math.pow(2, attempt);
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
    } else {
      if (!this.dedalusApiKey) {
        throw new LLMError("Dedalus API key not configured", 401, "auth_error", provider);
      }
      return this.dedalusApiKey;
    }
  }

  /**
   * Get base URL for a provider
   */
  private getBaseUrl(provider: LLMProvider): string {
    return API_ENDPOINTS[provider];
  }

  /**
   * Build request body
   */
  private buildRequestBody(
    messages: Message[],
    model: string,
    temperature: number,
    maxTokens: number,
    jsonMode: boolean = false
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
        if (error.isRetryable && attempt < MAX_RETRIES) {
          const delay = getBackoffDelay(attempt);
          console.warn(
            `[${provider}] LLM request failed (${response.status}), retrying in ${Math.round(delay)}ms...`
          );
          await sleep(delay);
          return this.makeRequest(provider, body, attempt + 1);
        }

        throw error;
      }

      return (await response.json()) as OpenAIResponse;
    } catch (error) {
      // Handle network errors
      if (
        error instanceof TypeError &&
        error.message.includes("fetch failed")
      ) {
        if (attempt < MAX_RETRIES) {
          const delay = getBackoffDelay(attempt);
          console.warn(
            `[${provider}] Network error, retrying in ${Math.round(delay)}ms...`
          );
          await sleep(delay);
          return this.makeRequest(provider, body, attempt + 1);
        }
        throw new LLMError(
          `Network error: Unable to reach ${provider} API`,
          0,
          "network_error",
          provider
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
    config: ModelConfig
  ): Promise<LLMResponse> {
    if (messages.length === 0) {
      throw new Error("Messages array cannot be empty");
    }

    const provider = config.provider;
    const model = config.model;
    const temperature = config.temperature ?? this.defaultTemperature;
    const maxTokens = config.maxTokens ?? this.defaultMaxTokens;

    const body = this.buildRequestBody(messages, model, temperature, maxTokens);
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
    const config = GORDON_MODELS[preset];
    return this.chatWithConfig(messages, config);
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
    return this.chatWithJSON(messages, schema, GORDON_MODELS.intentParsing);
  }

  /**
   * Convenience method for plan generation (reasoning)
   */
  async generatePlan<T>(messages: Message[], schema: z.ZodSchema<T>): Promise<T> {
    return this.chatWithJSON(messages, schema, GORDON_MODELS.planGeneration);
  }

  /**
   * Convenience method for explanations
   */
  async explain(messages: Message[]): Promise<LLMResponse> {
    return this.chatWithConfig(messages, GORDON_MODELS.explanations);
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
  return new LLMClient({
    openaiApiKey: process.env.OPENAI_API_KEY,
    dedalusApiKey: process.env.DEDALUS_API_KEY,
    defaultProvider: (process.env.LLM_DEFAULT_PROVIDER as LLMProvider) ?? "dedalus",
    defaultModel: process.env.LLM_DEFAULT_MODEL,
  });
}
