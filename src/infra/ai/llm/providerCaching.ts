/**
 * Provider-Native Prompt Caching Hints
 *
 * Gordon's native provider layer (Mastra + AI SDK) supports prompt caching
 * differently per provider. This module normalizes the attachment of cache
 * markers so callers don't need to remember each provider's convention.
 *
 * Caching semantics per native provider:
 *
 *  Anthropic   — EXPLICIT. Attach `providerOptions.anthropic.cacheControl`
 *                to the system/message blocks that should be cached. A
 *                minimum of ~1024 input tokens is required for the cache
 *                breakpoint to take effect; shorter prefixes are silently
 *                uncached. Supports two TTLs: default 5min (cheaper) and
 *                opt-in 1h (survives `/clear` + short breaks, but cache
 *                writes cost ~2x base input price per Anthropic pricing).
 *
 *  OpenAI      — AUTOMATIC. As long as the prefix of consecutive requests
 *                is byte-identical and ≥1024 tokens, OpenAI caches it
 *                transparently. No explicit markers. The only action Gordon
 *                needs is to keep the stable-prefix shape consistent
 *                between turns (which `contextBudget.ts` already does).
 *
 *  Google      — SEPARATE API. Gemini uses `CachedContent` creation as a
 *                distinct request; Gordon would cache content explicitly
 *                and reference it on subsequent requests. Out of scope for
 *                this helper — different control flow.
 *
 * For the Dedalus path, see `extra_body.system_blocks` wired in client.ts
 * — that's the OpenAI-compatible gateway pass-through.
 *
 * Cache TTL knob (GORDON_PROMPT_CACHE_TTL):
 *
 *   "5m" (default)  — Anthropic's default 5-minute ephemeral cache. Cheaper
 *                     on writes (1x base input price for cache_creation).
 *                     Right for active sessions where consecutive turns
 *                     happen within minutes of each other.
 *
 *   "1h"            — Anthropic's extended 1-hour cache. Cache writes cost
 *                     ~2x base input price, but reads stay at 0.1x. Right
 *                     when operators frequently `/clear` and resume within
 *                     an hour — the cache survives across sessions, saving
 *                     full prefix reprocessing on the next `/new`. The
 *                     cost-tracker's daily-budget event stream surfaces
 *                     whether the 2x write cost is paying for itself.
 *
 * Adopted from Hermes Agent's v0.14 "cross-session 1h Claude prompt cache"
 * pattern. Default 5m keeps Gordon cost-conservative; operators opt in to
 * 1h when their usage pattern justifies it.
 */

import type { DirectProviderName } from "../../runtime/providers/registry.ts";

export const PROMPT_CACHE_TTL_ENV = "GORDON_PROMPT_CACHE_TTL";

export type PromptCacheTtl = "5m" | "1h";

/**
 * Resolve the active cache TTL from environment. Accepts "5m" / "5min" /
 * "300s" → "5m"; "1h" / "60m" / "3600s" → "1h"; anything else → "5m"
 * default.
 */
export function resolvePromptCacheTtl(
  env: NodeJS.ProcessEnv = process.env,
): PromptCacheTtl {
  const raw = env[PROMPT_CACHE_TTL_ENV]?.toLowerCase().trim();
  if (!raw) return "5m";
  if (raw === "1h" || raw === "60m" || raw === "3600s") return "1h";
  return "5m";
}

/**
 * AI SDK `providerOptions` shape. Each provider reads its own key; keys
 * for other providers are ignored. The index signature matches Mastra's
 * `SharedV2ProviderOptions` so this type is assignable into `ModelMessage`
 * payloads without casts.
 */
export interface AiSdkProviderOptions {
  anthropic?: {
    cacheControl?: { type: "ephemeral"; ttl?: "5m" | "1h" };
  };
  openai?: Record<string, unknown>;
  google?: Record<string, unknown>;
  [provider: string]: Record<string, unknown> | undefined;
}

/**
 * Given a native provider, return the `providerOptions` block that marks
 * a system message (or system content block) as a cache breakpoint.
 *
 * Returns `undefined` when the provider either has automatic caching (no
 * action needed) or requires a different API entirely.
 *
 * @param provider — the active LLM provider
 * @param ttl      — cache TTL (5m default, 1h opt-in). Resolved from
 *                   `GORDON_PROMPT_CACHE_TTL` env if not passed.
 */
export function providerCacheHints(
  provider: DirectProviderName,
  ttl: PromptCacheTtl = resolvePromptCacheTtl(),
): AiSdkProviderOptions | undefined {
  switch (provider) {
    case "anthropic": {
      // Default 5m: omit ttl field entirely so the wire payload matches the
      // pre-knob shape (Anthropic's ephemeral default is 5min). Only attach
      // `ttl: "1h"` when explicitly opted in — keeps the cost-conservative
      // path byte-identical to historical requests.
      const cacheControl: { type: "ephemeral"; ttl?: "1h" } = { type: "ephemeral" };
      if (ttl === "1h") cacheControl.ttl = "1h";
      return { anthropic: { cacheControl } };
    }
    case "openai":
      // Automatic — stable prefix is cached transparently when ≥1024 tokens.
      return undefined;
    case "google":
      // Separate CachedContent API — not expressible as providerOptions.
      return undefined;
    default:
      return undefined;
  }
}

/**
 * Attach cache hints to a message object (Mastra / AI SDK shape).
 *
 * Intended use: when building the stable system prefix for an agent,
 * wrap the system message with `withProviderCacheHints(msg, provider)`
 * so the active provider sees it as a cache breakpoint.
 *
 * For providers without explicit caching (openai, google),
 * the message is returned unchanged — callers don't need to branch.
 */
export function withProviderCacheHints<T extends Record<string, unknown>>(
  message: T,
  provider: DirectProviderName,
  ttl: PromptCacheTtl = resolvePromptCacheTtl(),
): T {
  const hints = providerCacheHints(provider, ttl);
  if (!hints) return message;
  const existing = (message.providerOptions ?? {}) as AiSdkProviderOptions;
  return {
    ...message,
    providerOptions: {
      ...existing,
      ...hints,
    },
  } as T;
}

/**
 * Declare whether a provider requires explicit cache markers for Gordon
 * to get prompt-caching benefits. Useful for callers that want to decide
 * "should I bother building explicit system blocks vs just a plain string?".
 */
export function providerRequiresExplicitCacheMarkers(provider: DirectProviderName): boolean {
  return provider === "anthropic";
}

/**
 * Summary table used by `/context` or similar diagnostic surfaces to
 * explain what caching is active per provider.
 */
export const PROVIDER_CACHING_MODEL: Record<DirectProviderName, {
  model: "explicit" | "automatic" | "separate_api";
  notes: string;
}> = {
  anthropic: {
    model: "explicit",
    notes: "cache_control markers on system blocks; min ~1024 input tokens",
  },
  openai: {
    model: "automatic",
    notes: "prefix cached transparently when ≥1024 tokens (no markers)",
  },
  google: {
    model: "separate_api",
    notes: "CachedContent API — explicit cache creation, not providerOptions",
  },
};
