/**
 * Provider Registry
 * Multi-provider support for Gordon via Mastra + Dedalus
 *
 * Direct Providers (require individual API keys):
 * - OpenAI: GPT-5.2, GPT-5-mini
 * - Anthropic: Claude Opus 4.5, Sonnet 4.5, Haiku 4.5
 * - Google: Gemini 3 Pro, Flash
 *
 * Dedalus Meta-Provider (one key for all):
 * - Access to OpenAI, Anthropic, Google, xAI, Moonshot models
 * - OpenAI-compatible API at https://api.dedaluslabs.ai/v1
 *
 * Returns model strings in "provider/model" format for Mastra compatibility.
 */

// ============================================================================
// Types
// ============================================================================

/** Direct providers supported via Mastra */
export type DirectProviderName = "anthropic" | "openai" | "google";

/** All provider prefixes (including Dedalus-only providers) */
export type ProviderPrefix = DirectProviderName | "xai" | "moonshot";

/** Provider routing - how to access the model */
export type ProviderName = DirectProviderName | "dedalus";

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

/**
 * Model routing information
 */
export interface ModelRoute {
  modelString: ModelString;
  viaDedalus: boolean;
  baseUrl?: string;
  apiKeyEnvVar: string;
}

// ============================================================================
// Model Definitions
// ============================================================================

/**
 * Direct provider models - using exact Mastra model IDs
 * These can be accessed with individual provider API keys
 */
const DIRECT_MODELS = {
  anthropic: {
    flagship: "claude-opus-4-6",
    balanced: "claude-sonnet-4-5",
    fast: "claude-haiku-4-5",
  },
  openai: {
    flagship: "gpt-5.2-pro",
    balanced: "gpt-5.2",
    fast: "gpt-5-mini",
  },
  google: {
    flagship: "gemini-3-pro-preview",
    balanced: "gemini-3-pro-preview",
    fast: "gemini-3-flash-preview",
  },
} as const;

/**
 * Dedalus-supported models - accessible via DEDALUS_API_KEY
 * These use Dedalus's OpenAI-compatible API
 * See: https://docs.dedaluslabs.ai/sdk/models
 */
export const DEDALUS_MODELS = [
  // OpenAI
  { id: "openai/gpt-5.2", provider: "openai" as const, name: "GPT-5.2", tier: "flagship" as const },
  // Anthropic
  { id: "anthropic/claude-opus-4-6", provider: "anthropic" as const, name: "Claude Opus 4.6", tier: "flagship" as const },
  { id: "anthropic/claude-sonnet-4-5-20250929", provider: "anthropic" as const, name: "Claude Sonnet 4.5", tier: "balanced" as const },
  { id: "anthropic/claude-haiku-4-5-20251001", provider: "anthropic" as const, name: "Claude Haiku 4.5", tier: "fast" as const },
  // Google
  { id: "google/gemini-3-pro-preview", provider: "google" as const, name: "Gemini 3 Pro", tier: "flagship" as const },
  { id: "google/gemini-3-flash-preview", provider: "google" as const, name: "Gemini 3 Flash", tier: "fast" as const },
  // xAI (Dedalus-only)
  { id: "xai/grok-4-1-fast-reasoning", provider: "xai" as const, name: "Grok 4.1 Reasoning", tier: "flagship" as const },
  { id: "xai/grok-4-1-fast-non-reasoning", provider: "xai" as const, name: "Grok 4.1 Fast", tier: "fast" as const },
  // Moonshot (Dedalus-only)
  { id: "moonshot/kimi-k2.5", provider: "moonshot" as const, name: "Kimi K2.5", tier: "flagship" as const },
] as const;

/** Dedalus API base URL */
export const DEDALUS_BASE_URL = "https://api.dedaluslabs.ai/v1";

// ============================================================================
// Provider Registry
// ============================================================================

/**
 * Provider Registry - manages available LLM providers
 *
 * Supports both direct provider access (via individual API keys)
 * and Dedalus meta-provider access (one key for all models).
 */
export class ProviderRegistry {
  private availableDirectProviders: Set<DirectProviderName> = new Set();
  private hasDedalusKey = false;
  private initialized = false;

  constructor() {
    // Lazy initialization - don't check env until first use
  }

  /**
   * Initialize available providers from environment variables
   */
  private initializeFromEnv(): void {
    if (this.initialized) return;

    // Check direct provider API keys
    if (process.env.OPENAI_API_KEY) {
      this.availableDirectProviders.add("openai");
    }

    if (process.env.ANTHROPIC_API_KEY) {
      this.availableDirectProviders.add("anthropic");
    }

    if (process.env.GOOGLE_GENERATIVE_AI_API_KEY || process.env.GOOGLE_API_KEY) {
      this.availableDirectProviders.add("google");
    }

    // Check Dedalus API key
    if (process.env.DEDALUS_API_KEY) {
      this.hasDedalusKey = true;
    }

    this.initialized = true;
  }

  /**
   * Check if Dedalus is available
   */
  hasDedalus(): boolean {
    this.initializeFromEnv();
    return this.hasDedalusKey;
  }

  /**
   * Check if a model is available (via direct provider or Dedalus)
   */
  isModelAvailable(modelId: ModelString): boolean {
    this.initializeFromEnv();

    const [providerPrefix] = modelId.split("/") as [ProviderPrefix, string];

    // Check if available via direct provider
    if (this.availableDirectProviders.has(providerPrefix as DirectProviderName)) {
      return true;
    }

    // Check if available via Dedalus
    if (this.hasDedalusKey) {
      return DEDALUS_MODELS.some(m => m.id === modelId);
    }

    return false;
  }

  /**
   * Get routing information for a model
   * Determines whether to use direct provider or Dedalus
   */
  getModelRoute(modelId: ModelString): ModelRoute {
    this.initializeFromEnv();

    const [providerPrefix] = modelId.split("/") as [ProviderPrefix, string];

    // Check if direct provider is available (preferred)
    if (this.availableDirectProviders.has(providerPrefix as DirectProviderName)) {
      const envVarMap: Record<DirectProviderName, string> = {
        openai: "OPENAI_API_KEY",
        anthropic: "ANTHROPIC_API_KEY",
        google: "GOOGLE_GENERATIVE_AI_API_KEY",
      };

      return {
        modelString: modelId,
        viaDedalus: false,
        apiKeyEnvVar: envVarMap[providerPrefix as DirectProviderName],
      };
    }

    // Check if available via Dedalus
    if (this.hasDedalusKey && DEDALUS_MODELS.some(m => m.id === modelId)) {
      return {
        modelString: modelId,
        viaDedalus: true,
        baseUrl: DEDALUS_BASE_URL,
        apiKeyEnvVar: "DEDALUS_API_KEY",
      };
    }

    throw new Error(
      `Model "${modelId}" not available. ` +
      `Set the appropriate API key in your .env file.`
    );
  }

  /**
   * Get a model string in "provider/model" format
   * Mastra handles the actual model instantiation
   */
  getModel(provider: DirectProviderName, modelId: string): ModelString {
    this.initializeFromEnv();

    const modelString = `${provider}/${modelId}` as ModelString;

    // Check direct provider first
    if (this.availableDirectProviders.has(provider)) {
      return modelString;
    }

    // Check Dedalus fallback
    if (this.hasDedalusKey && DEDALUS_MODELS.some(m => m.id === modelString)) {
      return modelString;
    }

    throw new Error(
      `Provider "${provider}" not configured. ` +
        `Set the appropriate API key in your .env file.\n` +
        `Available: ${this.getAvailableProviders().join(", ") || "none"}` +
        (this.hasDedalusKey ? " (+ Dedalus models)" : "")
    );
  }

  /**
   * Get the default (flagship) model based on environment config
   * Falls back to first available provider if GORDON_PROVIDER not set
   */
  getDefaultModel(): ModelString {
    this.initializeFromEnv();

    let provider = process.env.GORDON_PROVIDER as DirectProviderName | undefined;

    if (!provider) {
      // Auto-detect first available provider (preference order)
      const preferredOrder: DirectProviderName[] = ["openai", "anthropic", "google"];
      const available = this.getAvailableProviders();
      provider = preferredOrder.find(p => available.includes(p)) || available[0];

      // If no direct provider but Dedalus is available, use first Dedalus model
      if (!provider && this.hasDedalusKey) {
        return DEDALUS_MODELS[0].id as ModelString;
      }

      if (!provider) {
        throw new Error(
          "No LLM provider configured. Set one of these API keys in your .env file:\n" +
          "  DEDALUS_API_KEY  - Dedalus Labs (access to all providers)\n" +
          "  OPENAI_API_KEY   - OpenAI GPT-5.2\n" +
          "  ANTHROPIC_API_KEY - Anthropic Claude Opus 4.5\n" +
          "  GOOGLE_GENERATIVE_AI_API_KEY - Google Gemini 3 Pro"
        );
      }
    }

    const model = process.env.GORDON_MODEL || DIRECT_MODELS[provider].flagship;
    return this.getModel(provider, model);
  }

  /**
   * Get a fast/cheap model for simple tasks
   */
  getFastModel(): ModelString {
    this.initializeFromEnv();

    let provider = (process.env.GORDON_FAST_PROVIDER || process.env.GORDON_PROVIDER) as DirectProviderName | undefined;

    if (!provider) {
      const preferredOrder: DirectProviderName[] = ["openai", "google", "anthropic"];
      const available = this.getAvailableProviders();
      provider = preferredOrder.find(p => available.includes(p)) || available[0];

      if (!provider && this.hasDedalusKey) {
        // Use Dedalus fast model
        const fastModel = DEDALUS_MODELS.find(m => m.tier === "fast");
        if (fastModel) return fastModel.id as ModelString;
      }

      if (!provider) {
        return this.getDefaultModel();
      }
    }

    const model = process.env.GORDON_FAST_MODEL || DIRECT_MODELS[provider].fast;
    return this.getModel(provider, model);
  }

  /**
   * Get a balanced model (good performance/cost ratio)
   */
  getBalancedModel(): ModelString {
    this.initializeFromEnv();

    let provider = process.env.GORDON_PROVIDER as DirectProviderName | undefined;

    if (!provider) {
      const preferredOrder: DirectProviderName[] = ["openai", "anthropic", "google"];
      const available = this.getAvailableProviders();
      provider = preferredOrder.find(p => available.includes(p)) || available[0];

      if (!provider && this.hasDedalusKey) {
        const balancedModel = DEDALUS_MODELS.find(m => m.tier === "balanced");
        if (balancedModel) return balancedModel.id as ModelString;
      }

      if (!provider) {
        return this.getDefaultModel();
      }
    }

    const model = DIRECT_MODELS[provider].balanced;
    return this.getModel(provider, model);
  }

  /**
   * List available direct providers
   */
  getAvailableProviders(): DirectProviderName[] {
    this.initializeFromEnv();
    return Array.from(this.availableDirectProviders);
  }

  /**
   * Get all available models (from direct providers + Dedalus)
   */
  getAllAvailableModels(): Array<{ id: string; name: string; provider: string; viaDedalus: boolean }> {
    this.initializeFromEnv();

    const models: Array<{ id: string; name: string; provider: string; viaDedalus: boolean }> = [];

    // Add direct provider models
    for (const provider of this.availableDirectProviders) {
      const providerModels = DIRECT_MODELS[provider];
      for (const [tier, modelId] of Object.entries(providerModels)) {
        const fullId = `${provider}/${modelId}`;
        models.push({
          id: fullId,
          name: `${modelId} (${tier})`,
          provider,
          viaDedalus: false,
        });
      }
    }

    // Add Dedalus models (excluding duplicates available directly)
    if (this.hasDedalusKey) {
      for (const model of DEDALUS_MODELS) {
        const alreadyDirect = models.some(m => m.id === model.id);
        if (!alreadyDirect) {
          models.push({
            id: model.id,
            name: model.name,
            provider: model.provider,
            viaDedalus: true,
          });
        }
      }
    }

    return models;
  }

  /**
   * Check if a provider is available (directly)
   */
  hasProvider(provider: DirectProviderName): boolean {
    this.initializeFromEnv();
    return this.availableDirectProviders.has(provider);
  }

  /**
   * Reset initialized state (for testing or after env changes)
   */
  reset(): void {
    this.availableDirectProviders.clear();
    this.hasDedalusKey = false;
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
  provider?: DirectProviderName | string,
  modelId?: string
): ModelString {
  if (!provider || !modelId) {
    return providerRegistry.getDefaultModel();
  }
  return providerRegistry.getModel(provider as DirectProviderName, modelId);
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

/**
 * Check if Dedalus is available
 */
export function hasDedalus(): boolean {
  return providerRegistry.hasDedalus();
}

/**
 * Get model routing information
 */
export function getModelRoute(modelId: ModelString): ModelRoute {
  return providerRegistry.getModelRoute(modelId);
}
