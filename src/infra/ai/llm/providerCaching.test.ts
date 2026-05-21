import { describe, it, expect } from "bun:test";
import {
  resolvePromptCacheTtl,
  providerCacheHints,
  withProviderCacheHints,
  PROMPT_CACHE_TTL_ENV,
} from "./providerCaching.ts";

describe("resolvePromptCacheTtl", () => {
  it("defaults to 5m when unset", () => {
    expect(resolvePromptCacheTtl({})).toBe("5m");
  });

  it("returns 1h for canonical values", () => {
    expect(resolvePromptCacheTtl({ [PROMPT_CACHE_TTL_ENV]: "1h" })).toBe("1h");
    expect(resolvePromptCacheTtl({ [PROMPT_CACHE_TTL_ENV]: "60m" })).toBe("1h");
    expect(resolvePromptCacheTtl({ [PROMPT_CACHE_TTL_ENV]: "3600s" })).toBe("1h");
  });

  it("normalizes case + whitespace", () => {
    expect(resolvePromptCacheTtl({ [PROMPT_CACHE_TTL_ENV]: "  1H  " })).toBe("1h");
  });

  it("falls back to 5m on unrecognized values", () => {
    expect(resolvePromptCacheTtl({ [PROMPT_CACHE_TTL_ENV]: "30m" })).toBe("5m");
    expect(resolvePromptCacheTtl({ [PROMPT_CACHE_TTL_ENV]: "forever" })).toBe("5m");
    expect(resolvePromptCacheTtl({ [PROMPT_CACHE_TTL_ENV]: "" })).toBe("5m");
  });
});

describe("providerCacheHints — TTL passthrough", () => {
  it("anthropic with default 5m omits ttl field (wire-compatible with pre-knob shape)", () => {
    const hints = providerCacheHints("anthropic", "5m");
    expect(hints?.anthropic?.cacheControl).toEqual({ type: "ephemeral" });
    expect(hints?.anthropic?.cacheControl?.ttl).toBeUndefined();
  });

  it("anthropic with 1h attaches ttl=1h", () => {
    const hints = providerCacheHints("anthropic", "1h");
    expect(hints?.anthropic?.cacheControl).toEqual({ type: "ephemeral", ttl: "1h" });
  });

  it("openai returns undefined regardless of TTL (automatic caching)", () => {
    expect(providerCacheHints("openai", "5m")).toBeUndefined();
    expect(providerCacheHints("openai", "1h")).toBeUndefined();
  });

  it("inception returns undefined regardless of TTL", () => {
    expect(providerCacheHints("inception", "5m")).toBeUndefined();
    expect(providerCacheHints("inception", "1h")).toBeUndefined();
  });

  it("google returns undefined regardless of TTL (separate CachedContent API)", () => {
    expect(providerCacheHints("google", "5m")).toBeUndefined();
    expect(providerCacheHints("google", "1h")).toBeUndefined();
  });
});

describe("withProviderCacheHints", () => {
  it("attaches cache hints to anthropic system message", () => {
    const msg = { role: "system", content: "stable prefix" };
    const out = withProviderCacheHints(msg, "anthropic", "5m") as {
      providerOptions?: { anthropic?: { cacheControl?: { type: string; ttl?: string } } };
    };
    expect(out.providerOptions?.anthropic?.cacheControl?.type).toBe("ephemeral");
    expect(out.providerOptions?.anthropic?.cacheControl?.ttl).toBeUndefined();
  });

  it("attaches ttl=1h when requested", () => {
    const msg = { role: "system", content: "stable prefix" };
    const out = withProviderCacheHints(msg, "anthropic", "1h") as {
      providerOptions?: { anthropic?: { cacheControl?: { ttl?: string } } };
    };
    expect(out.providerOptions?.anthropic?.cacheControl?.ttl).toBe("1h");
  });

  it("returns message unchanged for providers without explicit caching", () => {
    const msg = { role: "system", content: "stable prefix" };
    const out = withProviderCacheHints(msg, "openai");
    expect(out).toBe(msg);
  });

  it("preserves existing providerOptions entries", () => {
    const msg = {
      role: "system",
      content: "x",
      providerOptions: { openai: { customField: 42 } },
    };
    const out = withProviderCacheHints(msg, "anthropic", "1h") as unknown as {
      providerOptions: { openai: { customField: number }; anthropic: { cacheControl: object } };
    };
    expect(out.providerOptions.openai.customField).toBe(42);
    expect(out.providerOptions.anthropic.cacheControl).toEqual({
      type: "ephemeral",
      ttl: "1h",
    });
  });
});
