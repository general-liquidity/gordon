/**
 * Provider Registry
 * Multi-provider support for Gordon via Mastra plus OpenAI-compatible gateways.
 *
 * Native providers:
 * - OpenAI
 * - Anthropic
 * - Google
 *
 * OpenAI-compatible providers:
 * - Inception Labs (Mercury 2)
 * - Dedalus Labs (meta-provider for OpenAI, Anthropic, Google, xAI, Moonshot)
 *
 * Returns model strings in "provider/model" format for Gordon config, then
 * resolves them to the correct Mastra provider string at runtime.
 */

// ============================================================================
// Types
// ============================================================================

/** Providers Gordon can select directly in config/UI */
export type DirectProviderName = "anthropic" | "openai" | "google" | "inception";

/** Provider prefixes that can appear inside stored model IDs */
export type ProviderPrefix = DirectProviderName | "xai" | "moonshot";

/** Full provider routing choices Gordon supports */
export type ProviderName = DirectProviderName | "dedalus";
export type TransportProvider = "openai" | "anthropic" | "google";

export interface ProviderConfig {
  name: ProviderName;
  apiKey?: string;
  model: string;
}

/**
 * Model string type stored in Gordon config/env.
 * Format: "provider/model" (e.g. "openai/gpt-5.4" or "inception/mercury-2")
 */
export type ModelString = `${string}/${string}`;

/**
 * Runtime routing information for a model selection.
 */
export interface ModelRoute {
  modelString: ModelString;
  resolvedModelString: ModelString;
  provider: ProviderName;
  transportProvider: TransportProvider;
  transportModelId: string;
  viaOpenAICompatibleProvider: boolean;
  baseUrl?: string;
  apiKeyEnvVar: string;
}

export interface MastraOpenAICompatibleModelConfig {
  providerId: string;
  modelId: string;
  url: string;
  apiKey: string;
  id?: string;
}

export type MastraModelConfig = ModelString | MastraOpenAICompatibleModelConfig;

interface OpenAICompatibleProviderConfig {
  apiKeyEnvVar: "DEDALUS_API_KEY" | "INCEPTION_API_KEY";
  baseUrl: string;
}

export interface ModelMetadata {
  id: ModelString;
  provider: ProviderPrefix;
  name: string;
  tier: "flagship" | "balanced" | "fast";
}

interface DedalusModelDiscoveryResponse {
  data?: unknown;
  models?: unknown;
}

// ============================================================================
// Model Definitions
// ============================================================================

/**
 * Native provider models exposed directly via Mastra.
 */
export const DIRECT_MODELS = {
  anthropic: {
    flagship: "claude-opus-4-6",
    balanced: "claude-sonnet-4-6",
    fast: "claude-haiku-4-5",
  },
  openai: {
    flagship: "gpt-5.4-pro",
    balanced: "gpt-5.4",
    fast: "gpt-5.4",
  },
  google: {
    flagship: "gemini-3-1-pro-preview",
    balanced: "gemini-3-1-pro-preview",
    fast: "gemini-3.1-flash-lite-preview",
  },
  inception: {
    flagship: "mercury-2",
    balanced: "mercury-2",
    fast: "mercury-2",
  },
} as const satisfies Record<DirectProviderName, { flagship: string; balanced: string; fast: string }>;

/**
 * Inception-supported chat models via the OpenAI-compatible API.
 * Mercury Edit uses separate edit/FIM endpoints and is intentionally excluded
 * from the Mastra chat selector for now.
 */
export const INCEPTION_MODELS = [
  { id: "inception/mercury-2", provider: "inception" as const, name: "Mercury 2", tier: "flagship" as const },
] as const satisfies ReadonlyArray<ModelMetadata>;

/**
 * Dedalus-supported chat models via the OpenAI-compatible API.
 * See: https://docs.dedaluslabs.ai/sdk/models
 */
export const DEDALUS_MODELS = [
  { id: "openai/gpt-5.2", provider: "openai" as const, name: "GPT-5.2", tier: "flagship" as const },
  { id: "anthropic/claude-opus-4-6", provider: "anthropic" as const, name: "Claude Opus 4.6", tier: "flagship" as const },
  { id: "anthropic/claude-sonnet-4-5-20250929", provider: "anthropic" as const, name: "Claude Sonnet 4.5", tier: "balanced" as const },
  { id: "anthropic/claude-haiku-4-5-20251001", provider: "anthropic" as const, name: "Claude Haiku 4.5", tier: "fast" as const },
  { id: "google/gemini-3-pro-preview", provider: "google" as const, name: "Gemini 3 Pro", tier: "flagship" as const },
  { id: "google/gemini-3-flash-preview", provider: "google" as const, name: "Gemini 3 Flash", tier: "fast" as const },
  { id: "xai/grok-4-1-fast-reasoning", provider: "xai" as const, name: "Grok 4.1 Reasoning", tier: "flagship" as const },
  { id: "xai/grok-4-1-fast-non-reasoning", provider: "xai" as const, name: "Grok 4.1 Fast", tier: "fast" as const },
  { id: "moonshot/kimi-k2.5", provider: "moonshot" as const, name: "Kimi K2.5", tier: "flagship" as const },
] as const satisfies ReadonlyArray<ModelMetadata>;

const DEDALUS_MODEL_ID_SET = new Set<ModelString>(DEDALUS_MODELS.map((model) => model.id));

/** OpenAI-compatible provider base URLs */
export const DEDALUS_BASE_URL = "https://api.dedaluslabs.ai/v1";
export const INCEPTION_BASE_URL = "https://api.inceptionlabs.ai/v1";

const OPENAI_COMPATIBLE_PROVIDERS = {
  dedalus: {
    apiKeyEnvVar: "DEDALUS_API_KEY",
    baseUrl: DEDALUS_BASE_URL,
  },
  inception: {
    apiKeyEnvVar: "INCEPTION_API_KEY",
    baseUrl: INCEPTION_BASE_URL,
  },
} as const satisfies Record<"dedalus" | "inception", OpenAICompatibleProviderConfig>;

// ============================================================================
// Helpers
// ============================================================================

function isDirectProviderName(value: string): value is DirectProviderName {
  return value === "openai" || value === "anthropic" || value === "google" || value === "inception";
}

function isProviderName(value: string): value is ProviderName {
  return isDirectProviderName(value) || value === "dedalus";
}

function splitModelString(modelId: string): { prefix?: string; rawModelId: string } {
  if (!modelId.includes("/")) {
    return { rawModelId: modelId };
  }

  const [prefix, ...rest] = modelId.split("/");
  if (!prefix || rest.length === 0) {
    return { rawModelId: modelId };
  }

  return {
    prefix,
    rawModelId: rest.join("/"),
  };
}

// ============================================================================
// Provider Registry
// ============================================================================

export class ProviderRegistry {
  private availableDirectProviders: Set<DirectProviderName> = new Set();
  private hasDedalusKey = false;
  private nativeOpenAIApiKey?: string;
  private nativeOpenAIBaseUrl?: string;
  private dedalusModels: ModelMetadata[] = [...DEDALUS_MODELS];
  private dedalusModelsRefreshInFlight: Promise<readonly ModelMetadata[]> | null = null;
  private initialized = false;

  constructor() {
    // Lazy initialization - don't check env until first use
  }

  private initializeFromEnv(): void {
    if (this.initialized) return;

    this.nativeOpenAIApiKey = process.env.GORDON_NATIVE_OPENAI_API_KEY ?? process.env.OPENAI_API_KEY;
    this.nativeOpenAIBaseUrl = process.env.GORDON_NATIVE_OPENAI_BASE_URL ?? process.env.OPENAI_BASE_URL;

    if (this.nativeOpenAIApiKey && !process.env.GORDON_NATIVE_OPENAI_API_KEY) {
      process.env.GORDON_NATIVE_OPENAI_API_KEY = this.nativeOpenAIApiKey;
    }

    if (this.nativeOpenAIBaseUrl && !process.env.GORDON_NATIVE_OPENAI_BASE_URL) {
      process.env.GORDON_NATIVE_OPENAI_BASE_URL = this.nativeOpenAIBaseUrl;
    }

    if (process.env.OPENAI_API_KEY) {
      this.availableDirectProviders.add("openai");
    }

    if (process.env.ANTHROPIC_API_KEY) {
      this.availableDirectProviders.add("anthropic");
    }

    if (process.env.GOOGLE_GENERATIVE_AI_API_KEY || process.env.GOOGLE_API_KEY) {
      this.availableDirectProviders.add("google");
    }

    if (process.env.INCEPTION_API_KEY) {
      this.availableDirectProviders.add("inception");
    }

    if (process.env.DEDALUS_API_KEY) {
      this.hasDedalusKey = true;
    }

    this.initialized = true;
  }

  private getDedalusModelCatalog(): readonly ModelMetadata[] {
    return this.dedalusModels;
  }

  getDedalusModels(): readonly ModelMetadata[] {
    this.initializeFromEnv();
    return this.getDedalusModelCatalog();
  }

  private normalizeDiscoveredDedalusModels(payload: unknown): ModelMetadata[] {
    const response = (payload ?? {}) as DedalusModelDiscoveryResponse;
    const rawModels = Array.isArray(response.data)
      ? response.data
      : Array.isArray(response.models)
        ? response.models
        : Array.isArray(payload)
          ? payload
          : [];

    const normalized = rawModels.flatMap((entry): ModelMetadata[] => {
      if (!entry || typeof entry !== "object") {
        return [];
      }

      const candidate = entry as Record<string, unknown>;
      const rawId = typeof candidate.id === "string"
        ? candidate.id
        : typeof candidate.model === "string"
          ? candidate.model
          : null;

      if (!rawId || !rawId.includes("/")) {
        return [];
      }

      const { prefix, rawModelId } = splitModelString(rawId);
      if (!prefix || !rawModelId) {
        return [];
      }

      const provider = (isDirectProviderName(prefix) || prefix === "xai" || prefix === "moonshot")
        ? prefix
        : undefined;

      if (!provider) {
        return [];
      }

      const rawName = typeof candidate.name === "string"
        ? candidate.name
        : typeof candidate.display_name === "string"
          ? candidate.display_name
          : rawModelId;

      const tier = typeof candidate.tier === "string" &&
        (candidate.tier === "flagship" || candidate.tier === "balanced" || candidate.tier === "fast")
        ? candidate.tier
        : /mini|nano|flash|haiku|fast/i.test(rawId)
          ? "fast"
          : /sonnet|balanced/i.test(rawId)
            ? "balanced"
            : "flagship";

      return [{
        id: rawId as ModelString,
        provider,
        name: rawName,
        tier,
      }];
    });

    const unique = new Map<string, ModelMetadata>();
    for (const model of normalized) {
      unique.set(model.id, model);
    }

    return Array.from(unique.values());
  }

  async refreshDedalusModels(force = false): Promise<readonly ModelMetadata[]> {
    this.initializeFromEnv();

    if (!this.hasDedalusKey) {
      this.dedalusModels = [...DEDALUS_MODELS];
      return this.getDedalusModelCatalog();
    }

    if (!force && this.dedalusModelsRefreshInFlight) {
      return this.dedalusModelsRefreshInFlight;
    }

    const fetchPromise = (async () => {
      try {
        const response = await fetch(`${DEDALUS_BASE_URL}/models`, {
          headers: {
            Authorization: `Bearer ${process.env.DEDALUS_API_KEY}`,
            "Content-Type": "application/json",
          },
        });

        if (!response.ok) {
          throw new Error(`Dedalus model discovery failed (${response.status})`);
        }

        const payload = await response.json();
        const discovered = this.normalizeDiscoveredDedalusModels(payload)
          .filter((model) => DEDALUS_MODEL_ID_SET.has(model.id));
        if (discovered.length > 0) {
          const discoveredById = new Map(discovered.map((model) => [model.id, model]));
          this.dedalusModels = DEDALUS_MODELS.map((model) => discoveredById.get(model.id) ?? model);
        } else {
          this.dedalusModels = [...DEDALUS_MODELS];
        }
      } catch {
        this.dedalusModels = this.dedalusModels.length > 0 ? this.dedalusModels : [...DEDALUS_MODELS];
      } finally {
        this.dedalusModelsRefreshInFlight = null;
      }

      return this.getDedalusModelCatalog();
    })();

    this.dedalusModelsRefreshInFlight = fetchPromise;
    return fetchPromise;
  }

  private getRouteForSelection(provider: DirectProviderName | string, modelId: string): ModelRoute {
    const resolved = this.resolveRequestedModel(provider, modelId);

    if (resolved.provider === "dedalus") {
      if (!this.hasDedalusKey) {
        throw new Error(
          `Provider "dedalus" selected but DEDALUS_API_KEY not configured.\n` +
          `Set DEDALUS_API_KEY in your .env file or switch provider.`
        );
      }

      if (!this.getDedalusModelCatalog().some((model) => model.id === resolved.fullModelId)) {
        throw new Error(
          `Model "${resolved.fullModelId}" is not supported by Dedalus.`
        );
      }

      return {
        modelString: resolved.fullModelId,
        resolvedModelString: `openai/${resolved.fullModelId}` as ModelString,
        provider: "dedalus",
        transportProvider: "openai",
        transportModelId: resolved.fullModelId,
        viaOpenAICompatibleProvider: true,
        baseUrl: DEDALUS_BASE_URL,
        apiKeyEnvVar: "DEDALUS_API_KEY",
      };
    }

    if (resolved.provider === "inception") {
      if (!this.availableDirectProviders.has("inception")) {
        throw new Error(
          `Provider "inception" selected but INCEPTION_API_KEY not configured.\n` +
          `Set INCEPTION_API_KEY in your .env file or switch provider.`
        );
      }

      if (!INCEPTION_MODELS.some((model) => model.id === resolved.fullModelId)) {
        throw new Error(
          `Model "${resolved.fullModelId}" is not supported by Inception.`
        );
      }

      return {
        modelString: resolved.fullModelId,
        resolvedModelString: `openai/${resolved.rawModelId}` as ModelString,
        provider: "inception",
        transportProvider: "openai",
        transportModelId: resolved.rawModelId,
        viaOpenAICompatibleProvider: true,
        baseUrl: INCEPTION_BASE_URL,
        apiKeyEnvVar: "INCEPTION_API_KEY",
      };
    }

    if (isDirectProviderName(resolved.provider) && this.availableDirectProviders.has(resolved.provider)) {
      const envVarMap: Record<Exclude<DirectProviderName, "inception">, string> = {
        openai: "OPENAI_API_KEY",
        anthropic: "ANTHROPIC_API_KEY",
        google: "GOOGLE_GENERATIVE_AI_API_KEY",
      };

      if (resolved.provider === "inception") {
        throw new Error(`Unexpected provider routing state for "${resolved.fullModelId}".`);
      }

      return {
        modelString: resolved.fullModelId,
        resolvedModelString: resolved.fullModelId,
        provider: resolved.provider,
        transportProvider: resolved.provider,
        transportModelId: resolved.rawModelId,
        viaOpenAICompatibleProvider: false,
        apiKeyEnvVar: envVarMap[resolved.provider],
      };
    }

    if (this.hasDedalusKey && this.getDedalusModelCatalog().some((model) => model.id === resolved.fullModelId)) {
      return {
        modelString: resolved.fullModelId,
        resolvedModelString: `openai/${resolved.fullModelId}` as ModelString,
        provider: "dedalus",
        transportProvider: "openai",
        transportModelId: resolved.fullModelId,
        viaOpenAICompatibleProvider: true,
        baseUrl: DEDALUS_BASE_URL,
        apiKeyEnvVar: "DEDALUS_API_KEY",
      };
    }

    throw new Error(
      `Provider "${provider}" not configured. ` +
      `Set the appropriate API key in your .env file.\n` +
      `Available: ${this.getAvailableProviders().join(", ") || "none"}` +
      (this.hasDedalusKey ? " (+ Dedalus models)" : "")
    );
  }

  private resolveRequestedModel(provider: ProviderName | string, modelId: string): {
    provider: ProviderName | string;
    fullModelId: ModelString;
    rawModelId: string;
  } {
    const { prefix, rawModelId } = splitModelString(modelId);

    if (provider === "dedalus") {
      const fullModelId = (prefix ? `${prefix}/${rawModelId}` : modelId) as ModelString;
      return { provider, fullModelId, rawModelId };
    }

    if (provider === "inception") {
      return {
        provider,
        fullModelId: `inception/${rawModelId}` as ModelString,
        rawModelId,
      };
    }

    if (isDirectProviderName(provider)) {
      return {
        provider,
        fullModelId: `${provider}/${prefix ? rawModelId : modelId}` as ModelString,
        rawModelId: prefix ? rawModelId : modelId,
      };
    }

    return {
      provider,
      fullModelId: (prefix ? `${prefix}/${rawModelId}` : modelId) as ModelString,
      rawModelId,
    };
  }

  hasDedalus(): boolean {
    this.initializeFromEnv();
    return this.hasDedalusKey;
  }

  isModelAvailable(modelId: ModelString): boolean {
    this.initializeFromEnv();

    const { prefix } = splitModelString(modelId);
    if (!prefix) return false;

    if (prefix === "inception") {
      return this.availableDirectProviders.has("inception") &&
        INCEPTION_MODELS.some((model) => model.id === modelId);
    }

    if (isDirectProviderName(prefix) && this.availableDirectProviders.has(prefix)) {
      return true;
    }

    if (this.hasDedalusKey) {
      return this.getDedalusModelCatalog().some((model) => model.id === modelId);
    }

    return false;
  }

  getModelRoute(modelId: ModelString): ModelRoute {
    this.initializeFromEnv();

    const { prefix, rawModelId } = splitModelString(modelId);
    if (!prefix) {
      throw new Error(`Invalid model string "${modelId}". Expected "provider/model".`);
    }

    if (prefix === "inception") {
      if (!this.availableDirectProviders.has("inception")) {
        throw new Error(`Model "${modelId}" not available. Set INCEPTION_API_KEY in your .env file.`);
      }

      return {
        modelString: modelId,
        resolvedModelString: `openai/${rawModelId}` as ModelString,
        provider: "inception",
        transportProvider: "openai",
        transportModelId: rawModelId,
        viaOpenAICompatibleProvider: true,
        baseUrl: INCEPTION_BASE_URL,
        apiKeyEnvVar: "INCEPTION_API_KEY",
      };
    }

    if (isDirectProviderName(prefix) && this.availableDirectProviders.has(prefix)) {
      const envVarMap: Record<Exclude<DirectProviderName, "inception">, string> = {
        openai: "OPENAI_API_KEY",
        anthropic: "ANTHROPIC_API_KEY",
        google: "GOOGLE_GENERATIVE_AI_API_KEY",
      };

      if (prefix === "inception") {
        throw new Error(`Unexpected provider routing state for "${modelId}".`);
      }

      return {
        modelString: modelId,
        resolvedModelString: modelId,
        provider: prefix,
        transportProvider: prefix,
        transportModelId: rawModelId,
        viaOpenAICompatibleProvider: false,
        apiKeyEnvVar: envVarMap[prefix],
      };
    }

    if (this.hasDedalusKey && this.getDedalusModelCatalog().some((model) => model.id === modelId)) {
      return {
        modelString: modelId,
        resolvedModelString: `openai/${modelId}` as ModelString,
        provider: "dedalus",
        transportProvider: "openai",
        transportModelId: modelId,
        viaOpenAICompatibleProvider: true,
        baseUrl: DEDALUS_BASE_URL,
        apiKeyEnvVar: "DEDALUS_API_KEY",
      };
    }

    throw new Error(
      `Model "${modelId}" not available. Set the appropriate API key in your .env file.`
    );
  }

  getModel(provider: DirectProviderName | string, modelId: string): ModelString {
    this.initializeFromEnv();
    return this.getRouteForSelection(provider, modelId).resolvedModelString;
  }

  private getDefaultRoute(): ModelRoute {
    this.initializeFromEnv();

    const rawProvider = process.env.GORDON_PROVIDER;

    if (rawProvider === "dedalus") {
      const dedalusDefault = this.getDedalusModelCatalog()[0]?.id || DEDALUS_MODELS[0].id;
      const model = process.env.GORDON_MODEL || dedalusDefault;
      return this.getRouteForSelection("dedalus", model);
    }

    if (rawProvider === "inception") {
      const model = process.env.GORDON_MODEL || INCEPTION_MODELS[0].id;
      return this.getRouteForSelection("inception", model);
    }

    let provider = rawProvider && isDirectProviderName(rawProvider)
      ? rawProvider
      : undefined;

    if (!provider) {
      const preferredOrder: DirectProviderName[] = ["openai", "anthropic", "google", "inception"];
      const available = this.getAvailableProviders();
      provider = preferredOrder.find((candidate) => available.includes(candidate)) || available[0];

      if (!provider && this.hasDedalusKey) {
        const dedalusDefault = this.getDedalusModelCatalog()[0]?.id || DEDALUS_MODELS[0].id;
        return this.getRouteForSelection("dedalus", dedalusDefault);
      }

      if (!provider) {
        throw new Error(
          "No LLM provider configured. Set one of these API keys in your .env file:\n" +
          "  DEDALUS_API_KEY   - Dedalus Labs (access to many providers)\n" +
          "  INCEPTION_API_KEY - Inception Labs Mercury 2\n" +
          "  OPENAI_API_KEY    - OpenAI GPT-5.4\n" +
          "  ANTHROPIC_API_KEY - Anthropic Claude Opus 4.6\n" +
          "  GOOGLE_GENERATIVE_AI_API_KEY - Google Gemini 3 Pro"
        );
      }
    }

    const model = process.env.GORDON_MODEL || DIRECT_MODELS[provider].flagship;
    return this.getRouteForSelection(provider, model);
  }

  getActiveRoute(): ModelRoute {
    return this.getDefaultRoute();
  }

  getLegacyClientRoute(provider?: DirectProviderName | string, modelId?: string): ModelRoute {
    this.initializeFromEnv();

    const route = provider && modelId
      ? this.getRouteForSelection(provider, modelId)
      : this.getDefaultRoute();

    if (route.provider === "openai" || route.provider === "dedalus" || route.provider === "inception") {
      return route;
    }

    if (this.hasDedalusKey && this.getDedalusModelCatalog().some((model) => model.id === route.modelString)) {
      return this.getRouteForSelection("dedalus", route.modelString);
    }

    throw new Error(
      `Legacy LLM client cannot route provider "${route.provider}" directly. ` +
      `Configure DEDALUS_API_KEY or switch Gordon to OpenAI/Inception.`
    );
  }

  getDefaultModel(): ModelString {
    return this.getDefaultRoute().resolvedModelString;
  }

  getMastraModel(provider?: DirectProviderName | string, modelId?: string): MastraModelConfig {
    this.initializeFromEnv();

    const route = provider && modelId
      ? this.getRouteForSelection(provider, modelId)
      : this.getDefaultRoute();

    if (!route.viaOpenAICompatibleProvider || !route.baseUrl) {
      return route.resolvedModelString;
    }

    const apiKey = process.env[route.apiKeyEnvVar];
    if (!apiKey) {
      throw new Error(`API key not found for provider "${route.provider}". Set ${route.apiKeyEnvVar}.`);
    }

    return {
      providerId: route.provider,
      modelId: route.transportModelId,
      url: route.baseUrl,
      apiKey,
      id: route.modelString,
    };
  }

  getFastModel(): ModelString {
    this.initializeFromEnv();

    const rawProvider = process.env.GORDON_FAST_PROVIDER || process.env.GORDON_PROVIDER;

    if (rawProvider === "dedalus") {
      const model = process.env.GORDON_FAST_MODEL;
      if (model) return this.getModel("dedalus", model);
      const fastModel = this.getDedalusModelCatalog().find((candidate) => candidate.tier === "fast");
      if (fastModel) return this.getModel("dedalus", fastModel.id);
      return this.getDefaultModel();
    }

    if (rawProvider === "inception") {
      const model = process.env.GORDON_FAST_MODEL || INCEPTION_MODELS[0].id;
      return this.getModel("inception", model);
    }

    let provider = rawProvider && isDirectProviderName(rawProvider)
      ? rawProvider
      : undefined;

    if (!provider) {
      const preferredOrder: DirectProviderName[] = ["openai", "google", "anthropic", "inception"];
      const available = this.getAvailableProviders();
      provider = preferredOrder.find((candidate) => available.includes(candidate)) || available[0];

      if (!provider && this.hasDedalusKey) {
        const fastModel = this.getDedalusModelCatalog().find((candidate) => candidate.tier === "fast");
        if (fastModel) return this.getModel("dedalus", fastModel.id);
      }

      if (!provider) {
        return this.getDefaultModel();
      }
    }

    const model = process.env.GORDON_FAST_MODEL || DIRECT_MODELS[provider].fast;
    return this.getModel(provider, model);
  }

  getBalancedModel(): ModelString {
    this.initializeFromEnv();

    const rawProvider = process.env.GORDON_PROVIDER;

    if (rawProvider === "dedalus") {
      const balancedModel = this.getDedalusModelCatalog().find((candidate) => candidate.tier === "balanced");
      if (balancedModel) return this.getModel("dedalus", balancedModel.id);
      return this.getDefaultModel();
    }

    if (rawProvider === "inception") {
      return this.getModel("inception", process.env.GORDON_MODEL || INCEPTION_MODELS[0].id);
    }

    let provider = rawProvider && isDirectProviderName(rawProvider)
      ? rawProvider
      : undefined;

    if (!provider) {
      const preferredOrder: DirectProviderName[] = ["openai", "anthropic", "google", "inception"];
      const available = this.getAvailableProviders();
      provider = preferredOrder.find((candidate) => available.includes(candidate)) || available[0];

      if (!provider && this.hasDedalusKey) {
        const balancedModel = this.getDedalusModelCatalog().find((candidate) => candidate.tier === "balanced");
        if (balancedModel) return this.getModel("dedalus", balancedModel.id);
      }

      if (!provider) {
        return this.getDefaultModel();
      }
    }

    return this.getModel(provider, DIRECT_MODELS[provider].balanced);
  }

  getFastMastraModel(): MastraModelConfig {
    this.initializeFromEnv();

    const rawProvider = process.env.GORDON_FAST_PROVIDER || process.env.GORDON_PROVIDER;

    if (rawProvider === "dedalus") {
      const model = process.env.GORDON_FAST_MODEL;
      if (model) return this.getMastraModel("dedalus", model);
      const fastModel = this.getDedalusModelCatalog().find((candidate) => candidate.tier === "fast");
      if (fastModel) return this.getMastraModel("dedalus", fastModel.id);
      return this.getMastraModel();
    }

    if (rawProvider === "inception") {
      const model = process.env.GORDON_FAST_MODEL || INCEPTION_MODELS[0].id;
      return this.getMastraModel("inception", model);
    }

    let provider = rawProvider && isDirectProviderName(rawProvider)
      ? rawProvider
      : undefined;

    if (!provider) {
      const preferredOrder: DirectProviderName[] = ["openai", "google", "anthropic", "inception"];
      const available = this.getAvailableProviders();
      provider = preferredOrder.find((candidate) => available.includes(candidate)) || available[0];

      if (!provider && this.hasDedalusKey) {
        const fastModel = this.getDedalusModelCatalog().find((candidate) => candidate.tier === "fast");
        if (fastModel) return this.getMastraModel("dedalus", fastModel.id);
      }

      if (!provider) {
        return this.getMastraModel();
      }
    }

    const model = process.env.GORDON_FAST_MODEL || DIRECT_MODELS[provider].fast;
    return this.getMastraModel(provider, model);
  }

  getAvailableProviders(): DirectProviderName[] {
    this.initializeFromEnv();
    return Array.from(this.availableDirectProviders);
  }

  getAllAvailableModels(): Array<{ id: string; name: string; provider: string; viaDedalus: boolean }> {
    this.initializeFromEnv();

    const models: Array<{ id: string; name: string; provider: string; viaDedalus: boolean }> = [];

    for (const provider of this.availableDirectProviders) {
      if (provider === "inception") {
        for (const model of INCEPTION_MODELS) {
          models.push({
            id: model.id,
            name: model.name,
            provider,
            viaDedalus: false,
          });
        }
        continue;
      }

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

    if (this.hasDedalusKey) {
      for (const model of this.getDedalusModelCatalog()) {
        const alreadyDirect = models.some((candidate) => candidate.id === model.id);
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

  hasProvider(provider: DirectProviderName): boolean {
    this.initializeFromEnv();
    return this.availableDirectProviders.has(provider);
  }

  reset(): void {
    this.availableDirectProviders.clear();
    this.hasDedalusKey = false;
    this.nativeOpenAIApiKey = undefined;
    this.nativeOpenAIBaseUrl = undefined;
    this.dedalusModels = [...DEDALUS_MODELS];
    this.dedalusModelsRefreshInFlight = null;
    this.initialized = false;
  }

  syncActiveProviderEnvironment(provider?: DirectProviderName | string, modelId?: string): ModelRoute {
    return this.getLegacyClientRoute(provider, modelId);
  }
}

export const providerRegistry = new ProviderRegistry();

// ============================================================================
// Convenience Functions
// ============================================================================

export function getModel(provider?: DirectProviderName | string, modelId?: string): ModelString {
  if (!provider || !modelId) {
    return providerRegistry.getDefaultModel();
  }
  return providerRegistry.getModel(provider, modelId);
}

export function getFastModel(): ModelString {
  return providerRegistry.getFastModel();
}

export function getBalancedModel(): ModelString {
  return providerRegistry.getBalancedModel();
}

export function getMastraModel(provider?: DirectProviderName | string, modelId?: string): MastraModelConfig {
  return providerRegistry.getMastraModel(provider, modelId);
}

export function getFastMastraModel(): MastraModelConfig {
  return providerRegistry.getFastMastraModel();
}

export function hasDedalus(): boolean {
  return providerRegistry.hasDedalus();
}

export function getModelRoute(modelId: ModelString): ModelRoute {
  return providerRegistry.getModelRoute(modelId);
}

export function resetProviderRegistry(): void {
  providerRegistry.reset();
}

export function getDedalusModels(): readonly ModelMetadata[] {
  return providerRegistry.getDedalusModels();
}

export function refreshDedalusModels(force = false): Promise<readonly ModelMetadata[]> {
  return providerRegistry.refreshDedalusModels(force);
}

export function getLegacyClientRoute(provider?: DirectProviderName | string, modelId?: string): ModelRoute {
  return providerRegistry.getLegacyClientRoute(provider, modelId);
}

export function syncActiveProviderEnvironment(provider?: DirectProviderName | string, modelId?: string): ModelRoute {
  return providerRegistry.syncActiveProviderEnvironment(provider, modelId);
}

export function getActiveRoute(): ModelRoute {
  return providerRegistry.getActiveRoute();
}
