import { createOpenAI, openai } from "@ai-sdk/openai";
import { anthropic } from "@ai-sdk/anthropic";
import { google } from "@ai-sdk/google";
import type { LanguageModelV1 } from "ai";

// ============================================================================
// Types
// ============================================================================

export type ProviderName = "anthropic" | "openai" | "google";

export interface ProviderConfig {
  name: ProviderName;
  apiKey?: string;
  model: string;
}

// ============================================================================
// Model Definitions (January 2026)
// ============================================================================

/**
 * Latest models per provider
 */
const MODELS = {
  anthropic: {
    flagship: "claude-opus-4-5-20250514",      // Most capable
    balanced: "claude-sonnet-4-5-20250514",    // Good balance
    fast: "claude-haiku-4-5-20250514",         // Fast & cheap
  },
  openai: {
    flagship: "gpt-5.2-pro",                   // Most capable
    balanced: "gpt-5.2",                       // Thinking model
    fast: "gpt-5.2-instant",                   // Fast & cheap
  },
  google: {
    flagship: "gemini-3-pro",                  // Most capable
    balanced: "gemini-3-pro",                  // Same as flagship
    fast: "gemini-3-flash",                    // Fast & cheap
  },
} as const;

// ============================================================================
// Provider Registry
// ============================================================================

/**
 * Provider Registry - manages available LLM providers
 *
 * Returns LanguageModelV1 objects for direct use in Mastra Agents.
 */
export class ProviderRegistry {
  private availableProviders: Set<ProviderName> = new Set();
  private initialized = false;

  constructor() {
    // Lazy initialization
  }

  private initializeFromEnv(): void {
    if (this.initialized) return;

    if (process.env.OPENAI_API_KEY) {
      this.availableProviders.add("openai");
    }

    if (process.env.ANTHROPIC_API_KEY) {
      this.availableProviders.add("anthropic");
    }

    if (process.env.GOOGLE_GENERATIVE_AI_API_KEY) {
      this.availableProviders.add("google");
    }

    this.initialized = true;
  }

  /**
   * Get a LanguageModelV1 instance
   */
  getModel(provider: ProviderName, modelId: string): LanguageModelV1 {
    this.initializeFromEnv();

    if (!this.availableProviders.has(provider)) {
      throw new Error(`Provider "${provider}" not configured.`);
    }

    switch (provider) {
      case "openai":
        return openai(modelId);
      case "anthropic":
        return anthropic(modelId);
      case "google":
        return google(modelId);
      default:
        throw new Error(`Unknown provider: ${provider}`);
    }
  }

  /**
   * Get the default (flagship) model
   */
  getDefaultModel(): LanguageModelV1 {
    this.initializeFromEnv();

    let provider = process.env.GORDON_PROVIDER as ProviderName | undefined;

    if (!provider) {
      const preferredOrder: ProviderName[] = ["openai", "anthropic", "google"];
      const available = this.getAvailableProviders();
      provider = preferredOrder.find(p => available.includes(p)) || available[0];

      if (!provider) {
        throw new Error("No LLM provider configured.");
      }
    }

    const model = process.env.GORDON_MODEL || MODELS[provider].flagship;
    return this.getModel(provider, model);
  }

  /**
   * Get a fast/cheap model
   */
  getFastModel(): LanguageModelV1 {
    this.initializeFromEnv();

    let provider = (process.env.GORDON_FAST_PROVIDER || process.env.GORDON_PROVIDER) as ProviderName | undefined;

    if (!provider) {
      const preferredOrder: ProviderName[] = ["openai", "google", "anthropic"];
      const available = this.getAvailableProviders();
      provider = preferredOrder.find(p => available.includes(p)) || available[0];

      if (!provider) {
        return this.getDefaultModel();
      }
    }

    const model = process.env.GORDON_FAST_MODEL || MODELS[provider].fast;
    return this.getModel(provider, model);
  }

  /**
   * Get a balanced model
   */
  getBalancedModel(): LanguageModelV1 {
    this.initializeFromEnv();

    let provider = process.env.GORDON_PROVIDER as ProviderName | undefined;

    if (!provider) {
      const preferredOrder: ProviderName[] = ["openai", "anthropic", "google"];
      const available = this.getAvailableProviders();
      provider = preferredOrder.find(p => available.includes(p)) || available[0];

      if (!provider) {
        return this.getDefaultModel();
      }
    }

    const model = MODELS[provider].balanced;
    return this.getModel(provider, model);
  }

  getAvailableProviders(): ProviderName[] {
    this.initializeFromEnv();
    return Array.from(this.availableProviders);
  }

  reset(): void {
    this.availableProviders.clear();
    this.initialized = false;
  }
}

export const providerRegistry = new ProviderRegistry();

// ============================================================================
// Convenience Functions
// ============================================================================

export function getModel(
  provider?: ProviderName | string,
  modelId?: string
): LanguageModelV1 {
  if (!provider || !modelId) {
    return providerRegistry.getDefaultModel();
  }
  return providerRegistry.getModel(provider as ProviderName, modelId);
}

export function getFastModel(): LanguageModelV1 {
  return providerRegistry.getFastModel();
}

export function getBalancedModel(): LanguageModelV1 {
  return providerRegistry.getBalancedModel();
}
