/**
 * Provider Registry
 * Model routing for Gordon on top of Mastra's native model router (ai@5).
 *
 * Mastra `Agent({ model })` accepts either:
 *  - a provider/model STRING (hosted providers + gateways), or
 *  - an OBJECT `{ id, url, apiKey?, headers? }` (local / OpenAI-compatible hosts).
 *
 * Provider classes:
 *  - First-party (native, tool-capable): anthropic, openai, google, xai.
 *    Env keys auto-detected by Mastra (ANTHROPIC_API_KEY, OPENAI_API_KEY,
 *    GOOGLE_GENERATIVE_AI_API_KEY, XAI_API_KEY).
 *  - Gateways: openrouter (OPENROUTER_API_KEY, tool-capable) and huggingface
 *    (HF_TOKEN, text/research only — NO tool-calling).
 *  - Local / custom: OpenAI-compatible host via the object form.
 *
 * This module maps an operator "provider/model" (or "provider:model") string to
 * the correct Mastra model spec and exposes tier helpers (fast / balanced /
 * flagship) used across the agent + TUI surfaces.
 */

// ============================================================================
// Types
// ============================================================================

/** First-party providers Gordon pins tool/executor paths to. */
export type DirectProviderName = "anthropic" | "openai" | "google" | "xai";

/** Hosted gateways natively in the Mastra 1.5.0 catalogue (prefix-routed). */
export type GatewayName =
  | "openrouter"
  | "huggingface"
  | "togetherai"
  | "fireworks-ai"
  | "siliconflow"
  | "deepinfra";

/**
 * Provider routing is PASS-THROUGH: any `provider/model` string the operator
 * supplies is forwarded to Mastra's model router (80+ providers in 1.5.0).
 * The named unions are convenience/typing only — `ProviderName` is any string.
 */
export type ProviderName = string;

/** Provider a request is transported to — best-effort label, not restricted. */
export type TransportProvider = string;

export interface ProviderConfig {
  name: ProviderName;
  apiKey?: string;
  model: string;
}

/**
 * Model string stored in Gordon config/env.
 * Format: "provider/model" (e.g. "anthropic/claude-opus-4-6",
 * "openrouter/anthropic/claude-sonnet-4.6", "huggingface/meta-llama/...").
 */
export type ModelString = `${string}/${string}`;

/**
 * OpenAI-compatible object spec for local / custom hosts.
 * Mastra resolves this directly against the given base URL.
 */
export interface MastraOpenAICompatibleModelConfig {
  id: string;
  url: string;
  apiKey?: string;
  headers?: Record<string, string>;
}

/**
 * MastraModelConfig — what `Agent({ model })` accepts:
 *  - a "provider/model" string for hosted providers + gateways, or
 *  - an object spec for local / OpenAI-compatible hosts.
 *
 * The trailing `unknown`-widening keeps this assignable into Mastra's own
 * `model` field (whose runtime accepts the object form but whose published
 * type is narrower). This is the deliberate interop bridge — do not remove it
 * without also casting at every Agent construction site.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type MastraModelConfig = ModelString | MastraOpenAICompatibleModelConfig | any;

/**
 * Runtime routing information for a model selection.
 */
export interface ModelRoute {
  modelString: ModelString;
  resolvedModelString: ModelString;
  provider: ProviderName;
  transportProvider: TransportProvider;
  transportModelId: string;
  /** True when routed through a hosted gateway (openrouter / huggingface). */
  viaGateway: boolean;
  /** True when routed to a local / custom OpenAI-compatible host. */
  viaLocalHost: boolean;
  baseUrl?: string;
  apiKeyEnvVar: string;
}

export interface ModelMetadata {
  id: ModelString;
  provider: DirectProviderName;
  name: string;
  tier: "flagship" | "balanced" | "fast";
}

// ============================================================================
// Model Definitions
// ============================================================================

const DIRECT_PROVIDERS: readonly DirectProviderName[] = ["anthropic", "openai", "google", "xai"];
const GATEWAY_PROVIDERS: readonly GatewayName[] = ["openrouter", "huggingface"];

/**
 * All provider ids Gordon integrates a key/route for: first-party families,
 * hosted gateways, and local / custom OpenAI-compatible host prefixes. Used by
 * selection surfaces (slash `/model`, setup) to validate a provider without
 * re-hardcoding the list. NOT an allowlist for resolution — the router itself
 * is pass-through and forwards any well-formed `provider/model` string.
 */
export const KNOWN_PROVIDER_IDS: readonly string[] = [
  "anthropic",
  "openai",
  "google",
  "xai",
  "openrouter",
  "huggingface",
  "togetherai",
  "fireworks-ai",
  "siliconflow",
  "deepinfra",
  "ollama",
  "lmstudio",
  "local",
  "custom",
];

/**
 * Per-provider tier catalog exposed directly via Mastra's router.
 * Frontier IDs, sourced from the Mastra model directory (mastra.ai/models).
 * These are the newest tool-calling / agentic models per provider — older
 * generations are omitted to avoid deprecation churn.
 */
export const DIRECT_MODELS = {
  anthropic: {
    flagship: "claude-opus-4-8",
    balanced: "claude-sonnet-5",
    fast: "claude-haiku-4-5",
  },
  openai: {
    flagship: "gpt-5.6",
    balanced: "gpt-5.5",
    fast: "gpt-5.4-mini",
  },
  google: {
    flagship: "gemini-3.1-pro-preview",
    balanced: "gemini-3.6-flash",
    fast: "gemini-3.5-flash-lite",
  },
  xai: {
    flagship: "grok-4.5",
    balanced: "grok-4.5",
    fast: "grok-4.3",
  },
} as const satisfies Record<
  DirectProviderName,
  { flagship: string; balanced: string; fast: string }
>;

const DIRECT_API_KEY_ENV: Record<DirectProviderName, string> = {
  openai: "OPENAI_API_KEY",
  anthropic: "ANTHROPIC_API_KEY",
  google: "GOOGLE_GENERATIVE_AI_API_KEY",
  xai: "XAI_API_KEY",
};

const GATEWAY_API_KEY_ENV: Partial<Record<GatewayName, string>> = {
  openrouter: "OPENROUTER_API_KEY",
  huggingface: "HF_TOKEN",
  togetherai: "TOGETHER_API_KEY",
  "fireworks-ai": "FIREWORKS_API_KEY",
  siliconflow: "SILICONFLOW_API_KEY",
  deepinfra: "DEEPINFRA_API_KEY",
};

/** Local / custom OpenAI-compatible host env knobs. */
const LOCAL_URL_ENV = "GORDON_LOCAL_MODEL_URL";
const LOCAL_API_KEY_ENV = "GORDON_LOCAL_MODEL_API_KEY";
const DEFAULT_OLLAMA_URL = "http://localhost:11434/v1";

/**
 * Provider prefixes Gordon routes to a LOCAL OpenAI-compatible host via the
 * object form. Everything else is passed through to Mastra's router as a
 * "provider/model" string — no allowlist.
 */
const LOCAL_PREFIXES = new Set(["ollama", "lmstudio", "local", "custom"]);

// ============================================================================
// Helpers
// ============================================================================

function isDirectProviderName(value: string): value is DirectProviderName {
  return (DIRECT_PROVIDERS as readonly string[]).includes(value);
}

function isGatewayName(value: string): value is GatewayName {
  return (GATEWAY_PROVIDERS as readonly string[]).includes(value);
}

/** Split "provider/rest" — prefix is the first path segment. */
function splitModelString(modelId: string): { prefix?: string; rawModelId: string } {
  if (!modelId.includes("/")) {
    return { rawModelId: modelId };
  }
  const [prefix, ...rest] = modelId.split("/");
  if (!prefix || rest.length === 0) {
    return { rawModelId: modelId };
  }
  return { prefix, rawModelId: rest.join("/") };
}

/**
 * Combine an optional provider hint + model into a canonical spec string.
 * Accepts "provider:model" (single-colon) or "provider/model", or a bare
 * model with a separate provider hint.
 */
function canonicalSpec(provider: string | undefined, model: string | undefined): string {
  if (model?.includes("/")) {
    return model;
  }
  if (model?.includes(":")) {
    const idx = model.indexOf(":");
    return `${model.slice(0, idx)}/${model.slice(idx + 1)}`;
  }
  if (provider && model) {
    return `${provider}/${model}`;
  }
  return model ?? provider ?? "";
}

const DEFAULT_LMSTUDIO_URL = "http://localhost:1234/v1";

function localUrlFor(prefix: string): string {
  if (process.env[LOCAL_URL_ENV]) return process.env[LOCAL_URL_ENV]!;
  return prefix === "lmstudio" ? DEFAULT_LMSTUDIO_URL : DEFAULT_OLLAMA_URL;
}

// ============================================================================
// Provider Registry
// ============================================================================

export class ProviderRegistry {
  private availableDirectProviders: Set<DirectProviderName> = new Set();
  private availableGateways: Set<GatewayName> = new Set();
  private initialized = false;

  private initializeFromEnv(): void {
    if (this.initialized) return;

    if (process.env.OPENAI_API_KEY) this.availableDirectProviders.add("openai");
    if (process.env.ANTHROPIC_API_KEY) this.availableDirectProviders.add("anthropic");
    if (process.env.GOOGLE_GENERATIVE_AI_API_KEY || process.env.GOOGLE_API_KEY) {
      this.availableDirectProviders.add("google");
    }
    if (process.env.XAI_API_KEY) this.availableDirectProviders.add("xai");

    if (process.env.OPENROUTER_API_KEY) this.availableGateways.add("openrouter");
    if (process.env.HF_TOKEN) this.availableGateways.add("huggingface");

    this.initialized = true;
  }

  /**
   * Resolve an operator "provider/model" (or "provider:model") string into a
   * ModelRoute. PASS-THROUGH: any provider string is forwarded to Mastra's
   * router unchanged. Only local prefixes route to a base-URL object form.
   */
  private routeForSpec(spec: string): ModelRoute {
    const { prefix, rawModelId } = splitModelString(spec);

    if (!prefix) {
      throw new Error(`Invalid model spec "${spec}". Expected "provider/model".`);
    }

    // Local OpenAI-compatible hosts (object form).
    if (LOCAL_PREFIXES.has(prefix)) {
      return {
        modelString: spec as ModelString,
        resolvedModelString: spec as ModelString,
        provider: prefix,
        transportProvider: "openai",
        transportModelId: rawModelId,
        viaGateway: false,
        viaLocalHost: true,
        baseUrl: localUrlFor(prefix),
        apiKeyEnvVar: LOCAL_API_KEY_ENV,
      };
    }

    // Everything else — first-party, gateways, and any of Mastra's other
    // catalogue providers — passes straight through as a "provider/model"
    // string. Mastra's router resolves the key + transport.
    const fullModelId = spec as ModelString;
    const apiKeyEnvVar = isDirectProviderName(prefix)
      ? DIRECT_API_KEY_ENV[prefix]
      : ((GATEWAY_API_KEY_ENV as Record<string, string>)[prefix] ??
        `${prefix.toUpperCase().replace(/[^A-Z0-9]+/g, "_")}_API_KEY`);

    return {
      modelString: fullModelId,
      resolvedModelString: fullModelId,
      provider: prefix,
      transportProvider: isDirectProviderName(prefix) ? prefix : "openai",
      transportModelId: rawModelId,
      viaGateway: isGatewayName(prefix),
      viaLocalHost: false,
      apiKeyEnvVar,
    };
  }

  private getRouteForSelection(
    provider: string | undefined,
    modelId: string | undefined,
  ): ModelRoute {
    return this.routeForSpec(canonicalSpec(provider, modelId));
  }

  private getDefaultRoute(): ModelRoute {
    this.initializeFromEnv();

    const rawProvider = process.env.GORDON_PROVIDER;
    const rawModel = process.env.GORDON_MODEL;

    if (rawModel?.includes("/")) {
      return this.routeForSpec(rawModel);
    }

    let provider: DirectProviderName | undefined =
      rawProvider && isDirectProviderName(rawProvider) ? rawProvider : undefined;

    if (!provider) {
      const preferredOrder: DirectProviderName[] = ["anthropic", "openai", "google", "xai"];
      const available = this.getAvailableProviders();
      provider = preferredOrder.find((candidate) => available.includes(candidate)) || available[0];
    }

    if (!provider) {
      // Fall back to a configured gateway if no first-party key is present.
      const gateway = [...this.availableGateways][0];
      if (gateway && rawModel) {
        return this.routeForSpec(`${gateway}/${rawModel}`);
      }
      throw new Error(
        "No LLM provider configured. Set one of these API keys in your .env file:\n" +
          "  ANTHROPIC_API_KEY - Anthropic Claude\n" +
          "  OPENAI_API_KEY    - OpenAI GPT\n" +
          "  GOOGLE_GENERATIVE_AI_API_KEY - Google Gemini\n" +
          "  XAI_API_KEY       - xAI Grok\n" +
          "  OPENROUTER_API_KEY / HF_TOKEN - gateways",
      );
    }

    const model = rawModel || DIRECT_MODELS[provider].flagship;
    return this.getRouteForSelection(provider, model);
  }

  getActiveRoute(): ModelRoute {
    return this.getDefaultRoute();
  }

  getModelRoute(modelId: ModelString): ModelRoute {
    this.initializeFromEnv();
    return this.routeForSpec(modelId);
  }

  /**
   * Direct-client route (thinking / judges / non-Mastra callers). Pinned to a
   * first-party or gateway spec — never a local host by default.
   */
  getDirectClientRoute(provider?: string, modelId?: string): ModelRoute {
    this.initializeFromEnv();
    return provider || modelId
      ? this.getRouteForSelection(provider, modelId)
      : this.getDefaultRoute();
  }

  isModelAvailable(modelId: ModelString): boolean {
    this.initializeFromEnv();
    const { prefix } = splitModelString(modelId);
    // Pass-through: any well-formed provider/model is resolvable by Mastra.
    // For first-party providers we can additionally confirm the env key.
    if (!prefix) return false;
    if (isDirectProviderName(prefix)) return this.availableDirectProviders.has(prefix);
    return true;
  }

  getModel(provider?: string, modelId?: string): ModelString {
    this.initializeFromEnv();
    return this.getRouteForSelection(provider, modelId).resolvedModelString;
  }

  getDefaultModel(): ModelString {
    return this.getDefaultRoute().resolvedModelString;
  }

  /**
   * Build the Mastra model spec for `Agent({ model })`.
   * Returns a string for hosted providers/gateways, or an object for local hosts.
   */
  getMastraModel(provider?: string, modelId?: string): MastraModelConfig {
    this.initializeFromEnv();

    const route =
      provider || modelId ? this.getRouteForSelection(provider, modelId) : this.getDefaultRoute();

    if (route.viaLocalHost && route.baseUrl) {
      const spec: MastraOpenAICompatibleModelConfig = {
        id: route.modelString,
        url: route.baseUrl,
      };
      const apiKey = process.env[route.apiKeyEnvVar];
      if (apiKey) spec.apiKey = apiKey;
      return spec;
    }

    return route.resolvedModelString;
  }

  private tierProvider(rawProvider: string | undefined): DirectProviderName | undefined {
    if (rawProvider && isDirectProviderName(rawProvider)) return rawProvider;
    const preferredOrder: DirectProviderName[] = ["anthropic", "openai", "google", "xai"];
    const available = this.getAvailableProviders();
    return preferredOrder.find((candidate) => available.includes(candidate)) || available[0];
  }

  getFastModel(): ModelString {
    this.initializeFromEnv();
    const provider = this.tierProvider(
      process.env.GORDON_FAST_PROVIDER || process.env.GORDON_PROVIDER,
    );
    if (!provider) return this.getDefaultModel();
    const model = process.env.GORDON_FAST_MODEL || DIRECT_MODELS[provider].fast;
    return this.getModel(provider, model);
  }

  getBalancedModel(): ModelString {
    this.initializeFromEnv();
    const provider = this.tierProvider(process.env.GORDON_PROVIDER);
    if (!provider) return this.getDefaultModel();
    return this.getModel(provider, DIRECT_MODELS[provider].balanced);
  }

  getFastMastraModel(): MastraModelConfig {
    this.initializeFromEnv();
    const provider = this.tierProvider(
      process.env.GORDON_FAST_PROVIDER || process.env.GORDON_PROVIDER,
    );
    if (!provider) return this.getMastraModel();
    const model = process.env.GORDON_FAST_MODEL || DIRECT_MODELS[provider].fast;
    return this.getMastraModel(provider, model);
  }

  getAvailableProviders(): DirectProviderName[] {
    this.initializeFromEnv();
    return Array.from(this.availableDirectProviders);
  }

  getAvailableGateways(): GatewayName[] {
    this.initializeFromEnv();
    return Array.from(this.availableGateways);
  }

  getAllAvailableModels(): Array<{ id: string; name: string; provider: string }> {
    this.initializeFromEnv();
    const models: Array<{ id: string; name: string; provider: string }> = [];
    for (const provider of this.availableDirectProviders) {
      const providerModels = DIRECT_MODELS[provider];
      for (const [tier, modelId] of Object.entries(providerModels)) {
        models.push({
          id: `${provider}/${modelId}`,
          name: `${modelId} (${tier})`,
          provider,
        });
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
    this.availableGateways.clear();
    this.initialized = false;
  }

  syncActiveProviderEnvironment(provider?: string, modelId?: string): ModelRoute {
    return this.getDirectClientRoute(provider, modelId);
  }
}

export const providerRegistry = new ProviderRegistry();

// ============================================================================
// Convenience Functions
// ============================================================================

export function getModel(provider?: string, modelId?: string): ModelString {
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

export function getMastraModel(provider?: string, modelId?: string): MastraModelConfig {
  return providerRegistry.getMastraModel(provider, modelId);
}

export function getFastMastraModel(): MastraModelConfig {
  return providerRegistry.getFastMastraModel();
}

export function getModelRoute(modelId: ModelString): ModelRoute {
  return providerRegistry.getModelRoute(modelId);
}

export function resetProviderRegistry(): void {
  providerRegistry.reset();
}

export function getDirectClientRoute(provider?: string, modelId?: string): ModelRoute {
  return providerRegistry.getDirectClientRoute(provider, modelId);
}

export function syncActiveProviderEnvironment(provider?: string, modelId?: string): ModelRoute {
  return providerRegistry.syncActiveProviderEnvironment(provider, modelId);
}

export function getActiveRoute(): ModelRoute {
  return providerRegistry.getActiveRoute();
}
