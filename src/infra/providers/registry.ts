/**
 * Provider Registry
 * Multi-provider support for Gordon via Mastra
 *
 * Supported providers:
 * - OpenAI: GPT-4o, GPT-4o-mini
 * - Anthropic: Claude 3.5 Sonnet, Claude 3 Haiku
 * - Google: Gemini 1.5 Pro, Gemini 1.5 Flash
 *
 * Returns model strings in "provider/model" format for Mastra compatibility.
 */

// ============================================================================
// Types
// ============================================================================

export type ProviderName = "anthropic" | "openai" | "google";

export interface ProviderConfig {
  name: ProviderName;
  apiKey?: string;
  model: string;
}

/**
 * Model string type for Mastra compatibility
 * Format: "provider/model" (e.g., "openai/gpt-5.2")
 */
export type ModelString = `${string}/${string}`;

// ============================================================================
// Model Definitions (Mastra-compatible IDs)
// ============================================================================

/**
 * Latest models per provider - using exact Mastra model IDs
 * See: https://mastra.ai/models/providers/
 */
const MODELS = {
  anthropic: {
    flagship: "claude-opus-4-5",               // Most capable
    balanced: "claude-sonnet-4-5",             // Good balance
    fast: "claude-haiku-4-5",                  // Fast & cheap
  },
  openai: {
    flagship: "gpt-5.2-pro",                   // Most capable
    balanced: "gpt-5.2",                       // Standard model
    fast: "gpt-5-mini",                        // Fast & cheap
  },
  google: {
    flagship: "gemini-3-pro-preview",          // Most capable
    balanced: "gemini-3-pro-preview",          // Same as flagship
    fast: "gemini-3-flash-preview",            // Fast & cheap
  },
} as const;

// ============================================================================
// Provider Registry
// ============================================================================

/**
 * Provider Registry - manages available LLM providers
 *
 * Returns model strings in "provider/model" format that Mastra handles internally.
 */
export class ProviderRegistry {
  private availableProviders: Set<ProviderName> = new Set();
  private initialized = false;

  constructor() {
    // Lazy initialization - don't check env until first use
  }

  /**
   * Initialize available providers from environment variables
   */
  private initializeFromEnv(): void {
    if (this.initialized) return;

    // Check which providers have API keys configured
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
   * Get a model string in "provider/model" format
   * Mastra handles the actual model instantiation
   */
  getModel(provider: ProviderName, modelId: string): ModelString {
    this.initializeFromEnv();

    if (!this.availableProviders.has(provider)) {
      throw new Error(
        `Provider "${provider}" not configured. ` +
          `Set the appropriate API key in your .env file.\n` +
          `Available providers: ${this.getAvailableProviders().join(", ") || "none"}`
      );
    }

    return `${provider}/${modelId}` as ModelString;
  }

  /**
   * Get the default (flagship) model based on environment config
   * Falls back to first available provider if GORDON_PROVIDER not set
   */
  getDefaultModel(): ModelString {
    this.initializeFromEnv();

    let provider = process.env.GORDON_PROVIDER as ProviderName | undefined;

    if (!provider) {
      // Auto-detect first available provider (preference order)
      const preferredOrder: ProviderName[] = ["openai", "anthropic", "google"];
      const available = this.getAvailableProviders();
      provider = preferredOrder.find(p => available.includes(p)) || available[0];

      if (!provider) {
        throw new Error(
          "No LLM provider configured. Set one of these API keys in your .env file:\n" +
          "  OPENAI_API_KEY    - OpenAI GPT-5.2 (recommended)\n" +
          "  ANTHROPIC_API_KEY - Anthropic Claude Opus 4.5\n" +
          "  GOOGLE_GENERATIVE_AI_API_KEY - Google Gemini 3 Pro"
        );
      }
    }

    const model = process.env.GORDON_MODEL || MODELS[provider].flagship;
    return this.getModel(provider, model);
  }

  /**
   * Get a fast/cheap model for simple tasks
   */
  getFastModel(): ModelString {
    this.initializeFromEnv();

    let provider = (process.env.GORDON_FAST_PROVIDER || process.env.GORDON_PROVIDER) as ProviderName | undefined;

    if (!provider) {
      // Auto-detect first available provider
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
   * Get a balanced model (good performance/cost ratio)
   */
  getBalancedModel(): ModelString {
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

  /**
   * List available providers
   */
  getAvailableProviders(): ProviderName[] {
    this.initializeFromEnv();
    return Array.from(this.availableProviders);
  }

  /**
   * Check if a provider is available
   */
  hasProvider(provider: ProviderName): boolean {
    this.initializeFromEnv();
    return this.availableProviders.has(provider);
  }

  /**
   * Reset initialized state (for testing or after env changes)
   */
  reset(): void {
    this.availableProviders.clear();
    this.initialized = false;
  }
}

// Singleton instance
export const providerRegistry = new ProviderRegistry();

// ============================================================================
// Convenience Functions
// ============================================================================

/**
 * Get a model string using the configured provider
 * Returns format: "provider/model" (e.g., "openai/gpt-5.2-pro")
 */
export function getModel(
  provider?: ProviderName | string,
  modelId?: string
): ModelString {
  if (!provider || !modelId) {
    return providerRegistry.getDefaultModel();
  }
  return providerRegistry.getModel(provider as ProviderName, modelId);
}

/**
 * Get a fast model string for simple tasks
 */
export function getFastModel(): ModelString {
  return providerRegistry.getFastModel();
}

/**
 * Get a balanced model string
 */
export function getBalancedModel(): ModelString {
  return providerRegistry.getBalancedModel();
}
