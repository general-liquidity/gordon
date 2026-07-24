/**
 * LLM Client
 *
 * Gordon's direct (non-Mastra-agent) LLM caller for thinking / judges /
 * critique / enrichment. It resolves the model through Mastra's native model
 * router and runs a one-shot generation via an ephemeral `Agent`, so the same
 * first-party providers + gateways the agents use also serve direct calls.
 * There is no gateway base-URL swap and no hand-rolled OpenAI-compatible HTTP.
 *
 * The retry + failover seams are preserved: this client still does bounded
 * same-target retries and throws `ProviderExhaustedError` so the failover
 * layer (`executeWithFailover`) can move to the next candidate.
 */

import { z } from "zod";
import { Agent } from "@mastra/core/agent";
import type {
  LLMClientConfig,
  LLMProvider,
  LLMResponse,
  Message,
  ModelConfig,
} from "./types.ts";
import { GORDON_MODELS } from "./types.ts";
import { getMastraModel, getActiveRoute, type MastraModelConfig } from "../../runtime/providers/registry.ts";
import { providerCacheHints } from "./providerCaching.ts";
import { isCostHalted } from "../../platform/costTracker.ts";

// Default configuration values
const DEFAULT_PROVIDER: LLMProvider = "anthropic";
const DEFAULT_MODEL = "claude-sonnet-4-6";
const DEFAULT_TEMPERATURE = 0.7;
const DEFAULT_MAX_TOKENS = 2000;

// Retry configuration
const DEFAULT_MAX_RETRIES = 3;
const DEFAULT_INITIAL_RETRY_DELAY_MS = 1000;
const MAX_RETRY_DELAY_MS = 32000;

/**
 * Custom error class for LLM errors
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
    provider: LLMProvider = "anthropic",
  ) {
    super(message);
    this.name = "LLMError";
    this.statusCode = statusCode;
    this.errorType = errorType;
    this.provider = provider;
    this.isRateLimit = statusCode === 429;
    this.isRetryable =
      statusCode === 429 || statusCode === 500 || statusCode === 503 || statusCode === 0;
  }
}

/**
 * Structured "this target is done for this request" signal.
 *
 * Thrown when same-target retries terminate so a failover layer
 * (`executeWithFailover`) can move to the next provider without re-waiting any
 * backoff. Carries the provider, attempts made, and a status hint.
 */
export class ProviderExhaustedError extends LLMError {
  public attempts: number;

  constructor(
    message: string,
    statusCode: number,
    errorType: string,
    provider: LLMProvider,
    attempts: number,
  ) {
    super(
      `[${provider}] provider exhausted after ${attempts} attempt(s) (status ${statusCode}): ${message}`,
      statusCode,
      errorType,
      provider,
    );
    this.name = "ProviderExhaustedError";
    this.attempts = attempts;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getBackoffDelay(attempt: number, initialDelayMs: number): number {
  const delay = initialDelayMs * Math.pow(2, attempt);
  const jitter = Math.random() * 0.3 * delay;
  return Math.min(delay + jitter, MAX_RETRY_DELAY_MS);
}

function specLabel(spec: MastraModelConfig): string {
  return typeof spec === "string" ? spec : (spec.id ?? "custom");
}

/**
 * Direct LLM client. Uses Mastra's model router under the hood.
 */
export class LLMClient {
  private defaultProvider: LLMProvider;
  private defaultModel: string;
  private defaultTemperature: number;
  private defaultMaxTokens: number;
  private maxRetries: number;
  private retryDelayMs: number;
  private agentCache = new Map<string, Agent>();

  constructor(config: LLMClientConfig = {}) {
    this.defaultProvider = config.defaultProvider ?? DEFAULT_PROVIDER;
    this.defaultModel = config.defaultModel ?? DEFAULT_MODEL;
    this.defaultTemperature = config.temperature ?? DEFAULT_TEMPERATURE;
    this.defaultMaxTokens = config.maxTokens ?? DEFAULT_MAX_TOKENS;
    this.maxRetries = config.maxRetries ?? DEFAULT_MAX_RETRIES;
    this.retryDelayMs = config.retryDelayMs ?? DEFAULT_INITIAL_RETRY_DELAY_MS;
  }

  /**
   * Resolve a preset into runtime config, preserving preset sampling params.
   */
  private resolvePresetConfig(
    preset: (typeof GORDON_MODELS)[keyof typeof GORDON_MODELS],
  ): ModelConfig {
    return {
      provider: preset.provider,
      model: preset.model,
      temperature: preset.temperature,
      maxTokens: preset.maxTokens,
    };
  }

  /**
   * Build (and cache) an ephemeral Mastra agent for a resolved model spec.
   * Instructions are supplied per-call via the message list, so the agent
   * itself carries a neutral system prompt.
   */
  private agentFor(spec: MastraModelConfig): Agent {
    const key = specLabel(spec);
    let agent = this.agentCache.get(key);
    if (!agent) {
      agent = new Agent({
        id: `gordon-direct:${key}`,
        name: "gordon-direct",
        // Neutral construction-time prompt — the real system prompt is passed
        // per-call in the message list so a cached agent never leaks one
        // call's system text into the next.
        instructions: "You are Gordon, a precise trading assistant.",
        model: spec as never,
      });
      this.agentCache.set(key, agent);
    }
    return agent;
  }

  /**
   * Run a one-shot generation through Mastra's model router.
   */
  private async generate(
    config: ModelConfig,
    messages: Message[],
    systemBlocks?: Array<{ type: "text"; text: string; cache_control?: { type: "ephemeral" } }>,
  ): Promise<LLMResponse> {
    if (isCostHalted()) {
      throw new LLMError("Cost budget halted — LLM dispatch blocked", 402, "cost_halt", config.provider);
    }

    const spec = getMastraModel(config.provider, config.model);
    const temperature = config.temperature ?? this.defaultTemperature;
    const maxTokens = config.maxTokens ?? this.defaultMaxTokens;

    const systemText = [
      ...messages.filter((m) => m.role === "system").map((m) => m.content),
      ...(systemBlocks?.map((b) => b.text) ?? []),
    ]
      .filter((t) => t.length > 0)
      .join("\n\n");

    // Anthropic first-party prompt caching still applies on the direct path:
    // mark the stable system prefix as a cache breakpoint when present.
    const cacheHints = systemBlocks && systemBlocks.length > 0
      ? providerCacheHints(config.provider as never)
      : undefined;

    const convo = messages
      .filter((m) => m.role !== "system")
      .map((m) => ({ role: m.role, content: m.content }));

    const systemMessage = systemText.length > 0
      ? [{ role: "system" as const, content: systemText, ...(cacheHints ? { providerOptions: cacheHints } : {}) }]
      : [];

    const agent = this.agentFor(spec);

    let attempt = 0;
    for (;;) {
      try {
        const result = await agent.generate([...systemMessage, ...convo] as never, {
          modelSettings: { temperature, maxOutputTokens: maxTokens },
        });

        const usage = (result.usage ?? {}) as {
          inputTokens?: number;
          outputTokens?: number;
          totalTokens?: number;
        };
        const promptTokens = usage.inputTokens ?? 0;
        const completionTokens = usage.outputTokens ?? 0;

        return {
          content: result.text ?? "",
          usage: {
            promptTokens,
            completionTokens,
            totalTokens: usage.totalTokens ?? promptTokens + completionTokens,
          },
          model: specLabel(spec),
          provider: config.provider,
        };
      } catch (error) {
        if (attempt < this.maxRetries) {
          const delay = getBackoffDelay(attempt, this.retryDelayMs);
          attempt += 1;
          await sleep(delay);
          continue;
        }
        const message = error instanceof Error ? error.message : String(error);
        throw new ProviderExhaustedError(message, 0, "generation_error", config.provider, attempt + 1);
      }
    }
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
       * System content blocks to prepend. On the first-party Anthropic route
       * they carry a prompt-cache breakpoint (see providerCaching.ts).
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
    return this.generate(config, messages, options.systemBlocks);
  }

  /**
   * Send a chat request using a preset model configuration
   */
  async chatWithPreset(
    messages: Message[],
    preset: keyof typeof GORDON_MODELS,
  ): Promise<LLMResponse> {
    return this.chatWithConfig(messages, this.resolvePresetConfig(GORDON_MODELS[preset]));
  }

  /**
   * Send a chat request expecting JSON, parsed with a Zod schema
   */
  async chatWithJSON<T>(
    messages: Message[],
    schema: z.ZodSchema<T>,
    config?: Partial<ModelConfig>,
  ): Promise<T> {
    if (messages.length === 0) {
      throw new Error("Messages array cannot be empty");
    }

    const provider = config?.provider ?? this.defaultProvider;
    const model = config?.model ?? this.defaultModel;
    const temperature = config?.temperature ?? this.defaultTemperature;
    const maxTokens = config?.maxTokens ?? this.defaultMaxTokens;

    const hasJsonInstruction = messages.some(
      (m) =>
        m.role === "system" &&
        (m.content.toLowerCase().includes("json") ||
          m.content.toLowerCase().includes("respond with")),
    );

    const modifiedMessages = hasJsonInstruction
      ? messages
      : messages.map((m) =>
          m.role === "system"
            ? { ...m, content: `${m.content}\n\nRespond with valid JSON.` }
            : m,
        );

    const llmResponse = await this.generate(
      { provider, model, temperature, maxTokens },
      modifiedMessages,
    );

    let jsonContent: unknown;
    try {
      jsonContent = JSON.parse(extractJson(llmResponse.content));
    } catch {
      throw new LLMError(
        `Failed to parse JSON response: ${llmResponse.content.substring(0, 100)}...`,
        500,
        "json_parse_error",
        provider,
      );
    }

    const result = schema.safeParse(jsonContent);
    if (!result.success) {
      const errorMessages = result.error.issues
        .map((e) => `${String(e.path.join("."))}: ${e.message}`)
        .join(", ");
      throw new LLMError(
        `Response validation failed: ${errorMessages}`,
        500,
        "validation_error",
        provider,
      );
    }

    return result.data;
  }

  /**
   * Convenience method for intent parsing (fast, cheap)
   */
  async parseIntent<T>(messages: Message[], schema: z.ZodSchema<T>): Promise<T> {
    return this.chatWithJSON(messages, schema, this.resolvePresetConfig(GORDON_MODELS.intentParsing));
  }

  /**
   * Convenience method for plan generation (reasoning)
   */
  async generatePlan<T>(messages: Message[], schema: z.ZodSchema<T>): Promise<T> {
    return this.chatWithJSON(messages, schema, this.resolvePresetConfig(GORDON_MODELS.planGeneration));
  }

  /**
   * Convenience method for explanations
   */
  async explain(messages: Message[]): Promise<LLMResponse> {
    return this.chatWithConfig(messages, this.resolvePresetConfig(GORDON_MODELS.explanations));
  }

  /**
   * Check if a provider is available (env key present).
   */
  hasProvider(provider: LLMProvider): boolean {
    const envVar: Record<LLMProvider, string[]> = {
      openai: ["OPENAI_API_KEY"],
      anthropic: ["ANTHROPIC_API_KEY"],
      google: ["GOOGLE_GENERATIVE_AI_API_KEY", "GOOGLE_API_KEY"],
      xai: ["XAI_API_KEY"],
    };
    return envVar[provider].some((v) => !!process.env[v]);
  }

  /**
   * Get list of available providers (env keys present).
   */
  getAvailableProviders(): LLMProvider[] {
    return (["openai", "anthropic", "google", "xai"] as LLMProvider[]).filter((p) => this.hasProvider(p));
  }
}

/**
 * Extract a JSON object/array from a model response, tolerating code fences
 * and leading prose that Mastra's text output may include.
 */
function extractJson(text: string): string {
  const trimmed = text.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (fenced?.[1]) return fenced[1].trim();
  const firstObj = trimmed.search(/[[{]/);
  if (firstObj > 0) return trimmed.slice(firstObj);
  return trimmed;
}

/**
 * Create a client from environment variables. Resolves the active first-party
 * route via the provider registry (Mastra model router).
 */
export function createLLMClientFromEnv(): LLMClient {
  const route = getActiveRoute();
  const provider: LLMProvider =
    route.transportProvider === "openai" ||
    route.transportProvider === "anthropic" ||
    route.transportProvider === "google" ||
    route.transportProvider === "xai"
      ? route.transportProvider
      : "anthropic";

  return new LLMClient({
    defaultProvider: provider,
    defaultModel: route.transportModelId,
  });
}
