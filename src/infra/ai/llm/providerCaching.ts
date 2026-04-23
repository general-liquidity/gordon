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
 *                uncached.
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
 *  Inception   — OpenAI-compatible. Inherits OpenAI semantics (automatic
 *                prefix caching when supported by the upstream model).
 *
 * For the Dedalus path, see `extra_body.system_blocks` wired in client.ts
 * — that's the OpenAI-compatible gateway pass-through.
 */

import type { DirectProviderName } from "../../runtime/providers/registry.ts";

/**
 * AI SDK `providerOptions` shape. Each provider reads its own key; keys
 * for other providers are ignored. The index signature matches Mastra's
 * `SharedV2ProviderOptions` so this type is assignable into `ModelMessage`
 * payloads without casts.
 */
export interface AiSdkProviderOptions {
  anthropic?: {
    cacheControl?: { type: "ephemeral" };
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
 */
export function providerCacheHints(provider: DirectProviderName): AiSdkProviderOptions | undefined {
  switch (provider) {
    case "anthropic":
      return {
        anthropic: { cacheControl: { type: "ephemeral" } },
      };
    case "openai":
    case "inception":
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
 * For providers without explicit caching (openai, inception, google),
 * the message is returned unchanged — callers don't need to branch.
 */
export function withProviderCacheHints<T extends Record<string, unknown>>(
  message: T,
  provider: DirectProviderName,
): T {
  const hints = providerCacheHints(provider);
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
  inception: {
    model: "automatic",
    notes: "OpenAI-compatible; same automatic prefix caching",
  },
  google: {
    model: "separate_api",
    notes: "CachedContent API — explicit cache creation, not providerOptions",
  },
};
