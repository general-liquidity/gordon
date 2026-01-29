/**
 * Provider Registry
 * Multi-provider support for Gordon - supports direct providers and Dedalus gateway
 */

import { createOpenAI, openai } from "@ai-sdk/openai";
import { anthropic } from "@ai-sdk/anthropic";
import { google } from "@ai-sdk/google";
import type { LanguageModelV1 } from "ai";

// ============================================================================
// Types
// ============================================================================

export type ProviderName =
  | "anthropic"
  | "openai"
  | "google"
  | "mistral"
  | "groq"
  | "dedalus"
  | "ollama";

export interface ProviderConfig {
  name: ProviderName;
  apiKey?: string;
  baseURL?: string;
  model: string;
}

// ============================================================================
// Provider Factories
// ============================================================================

/**
 * Create a Dedalus Labs provider (OpenAI-compatible gateway)
 */
function createDedalusProvider(apiKey: string) {
  return createOpenAI({
    apiKey,
    baseURL: "https://api.dedaluslabs.ai/v1",
  });
}

/**
 * Create an Ollama provider (local models)
 */
function createOllamaProvider(baseURL: string = "http://localhost:11434/v1") {
  return createOpenAI({
    apiKey: "ollama", // Ollama doesn't need a real key
    baseURL,
  });
}

/**
 * Create a Groq provider (fast inference)
 */
function createGroqProvider(apiKey: string) {
  return createOpenAI({
    apiKey,
    baseURL: "https://api.groq.com/openai/v1",
  });
}

// ============================================================================
// Provider Registry
// ============================================================================

type ProviderFactory = ReturnType<typeof createOpenAI>;

/**
 * Provider Registry - manages all available providers
 *
 * Supports:
 * - Direct providers (Anthropic, OpenAI, Google, etc.)
 * - Dedalus Labs as a unified gateway to 20+ models
 * - Local models via Ollama
 */
export class ProviderRegistry {
  private providers: Map<ProviderName, ProviderFactory> = new Map();
  private initialized = false;

  constructor() {
    // Lazy initialization - don't load providers until first use
  }

  /**
   * Initialize providers from environment variables
   */
  private initializeFromEnv(): void {
    if (this.initialized) return;

    // Anthropic - direct provider (statically imported)
    if (process.env.ANTHROPIC_API_KEY) {
      this.providers.set("anthropic", anthropic as ProviderFactory);
    }

    // OpenAI - direct provider (statically imported)
    if (process.env.OPENAI_API_KEY) {
      this.providers.set("openai", openai as ProviderFactory);
    }

    // Google - direct provider (statically imported)
    if (process.env.GOOGLE_GENERATIVE_AI_API_KEY) {
      this.providers.set("google", google as ProviderFactory);
    }

    // Mistral - uses OpenAI-compatible endpoint
    if (process.env.MISTRAL_API_KEY) {
      this.providers.set("mistral", createOpenAI({
        apiKey: process.env.MISTRAL_API_KEY,
        baseURL: "https://api.mistral.ai/v1",
      }));
    }

    // Groq - fast inference
    if (process.env.GROQ_API_KEY) {
      this.providers.set("groq", createGroqProvider(process.env.GROQ_API_KEY));
    }

    // Dedalus Labs - multi-provider gateway
    if (process.env.DEDALUS_API_KEY) {
      this.providers.set("dedalus", createDedalusProvider(process.env.DEDALUS_API_KEY));
    }

    // Ollama - local models
    if (process.env.OLLAMA_BASE_URL || process.env.OLLAMA_ENABLED === "true") {
      this.providers.set("ollama", createOllamaProvider(process.env.OLLAMA_BASE_URL));
    }

    this.initialized = true;
  }

  /**
   * Get a model instance from a provider
   */
  getModel(provider: ProviderName, modelId: string): LanguageModelV1 {
    this.initializeFromEnv();

    const providerInstance = this.providers.get(provider);
    if (!providerInstance) {
      throw new Error(
        `Provider "${provider}" not configured. ` +
          `Set the appropriate API key in your .env file.\n` +
          `Available providers: ${this.getAvailableProviders().join(", ") || "none"}`
      );
    }
    return providerInstance(modelId);
  }

  /**
   * Get the default model based on environment config
   * Falls back to first available provider if GORDON_PROVIDER not set
   */
  getDefaultModel(): LanguageModelV1 {
    let provider = process.env.GORDON_PROVIDER as ProviderName | undefined;

    if (!provider) {
      // Auto-detect first available provider (preference order)
      const preferredOrder: ProviderName[] = ["openai", "anthropic", "dedalus", "google", "groq", "mistral", "ollama"];
      const available = this.getAvailableProviders();
      provider = preferredOrder.find(p => available.includes(p)) || available[0];

      if (!provider) {
        throw new Error(
          "No LLM provider configured. Set one of these API keys in your .env file:\n" +
          "  OPENAI_API_KEY    - OpenAI (recommended)\n" +
          "  DEDALUS_API_KEY   - Dedalus Labs (multi-model gateway)\n" +
          "  ANTHROPIC_API_KEY - Anthropic Claude\n" +
          "  GOOGLE_GENERATIVE_AI_API_KEY - Google Gemini"
        );
      }
    }

    const model = process.env.GORDON_MODEL || this.getDefaultModelId(provider);
    return this.getModel(provider, model);
  }

  /**
   * Get a fast/cheap model for simple tasks
   */
  getFastModel(): LanguageModelV1 {
    let provider = (process.env.GORDON_FAST_PROVIDER || process.env.GORDON_PROVIDER) as ProviderName | undefined;

    if (!provider) {
      // Auto-detect first available provider (preference order for fast models)
      const preferredOrder: ProviderName[] = ["groq", "openai", "dedalus", "anthropic", "google", "mistral", "ollama"];
      const available = this.getAvailableProviders();
      provider = preferredOrder.find(p => available.includes(p)) || available[0];

      if (!provider) {
        // Fall back to default model if no fast provider available
        return this.getDefaultModel();
      }
    }

    const model = process.env.GORDON_FAST_MODEL || this.getFastModelId(provider);
    return this.getModel(provider, model);
  }

  /**
   * Get default model ID for a provider
   */
  private getDefaultModelId(provider: ProviderName): string {
    const defaults: Record<ProviderName, string> = {
      anthropic: "claude-sonnet-4-20250514",
      openai: "gpt-4o",
      google: "gemini-2.0-flash",
      mistral: "mistral-large-latest",
      groq: "llama-3.3-70b-versatile",
      dedalus: "anthropic/claude-sonnet-4-5",
      ollama: "llama3.2",
    };
    return defaults[provider];
  }

  /**
   * Get fast model ID for a provider
   */
  private getFastModelId(provider: ProviderName): string {
    const fastModels: Record<ProviderName, string> = {
      anthropic: "claude-3-5-haiku-20241022",
      openai: "gpt-4o-mini",
      google: "gemini-2.0-flash",
      mistral: "mistral-small-latest",
      groq: "llama-3.1-8b-instant",
      dedalus: "groq/llama-3.1-8b-instant",
      ollama: "llama3.2",
    };
    return fastModels[provider];
  }

  /**
   * List available providers
   */
  getAvailableProviders(): ProviderName[] {
    this.initializeFromEnv();
    return Array.from(this.providers.keys());
  }

  /**
   * Check if a provider is available
   */
  hasProvider(provider: ProviderName): boolean {
    this.initializeFromEnv();
    return this.providers.has(provider);
  }

  /**
   * Register a custom provider
   */
  registerProvider(name: ProviderName, factory: ProviderFactory): void {
    this.providers.set(name, factory);
  }
}

// Singleton instance
export const providerRegistry = new ProviderRegistry();

// ============================================================================
// Convenience Functions
// ============================================================================

/**
 * Get a model using the configured provider
 * Convenience function for tools and agents
 */
export function getModel(
  provider?: ProviderName | string,
  modelId?: string
): LanguageModelV1 {
  if (!provider || !modelId) {
    return providerRegistry.getDefaultModel();
  }
  return providerRegistry.getModel(provider as ProviderName, modelId);
}

/**
 * Get a fast model for simple tasks
 */
export function getFastModel(): LanguageModelV1 {
  return providerRegistry.getFastModel();
}
