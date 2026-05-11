import { describe, expect, it, beforeEach, afterEach } from "bun:test";

import {
  isLocalFallbackEnabled,
  checkProviderHealth,
  withReadOnlyFallback,
  _resetHealthCacheForTest,
} from "./localFallback.ts";

describe("localFallback", () => {
  beforeEach(() => {
    _resetHealthCacheForTest();
  });

  describe("isLocalFallbackEnabled", () => {
    it("returns false when env is unset", () => {
      expect(isLocalFallbackEnabled({})).toBe(false);
    });

    it("returns true for '1' or 'true'", () => {
      expect(isLocalFallbackEnabled({ GORDON_LOCAL_FALLBACK: "1" })).toBe(true);
      expect(isLocalFallbackEnabled({ GORDON_LOCAL_FALLBACK: "true" })).toBe(true);
    });
  });

  describe("checkProviderHealth", () => {
    const origBase = process.env.OPENAI_BASE_URL;
    const origDed = process.env.DEDALUS_BASE_URL;

    afterEach(() => {
      process.env.OPENAI_BASE_URL = origBase;
      process.env.DEDALUS_BASE_URL = origDed;
      _resetHealthCacheForTest();
    });

    it("returns available when no base URL configured", async () => {
      delete process.env.OPENAI_BASE_URL;
      delete process.env.DEDALUS_BASE_URL;
      const h = await checkProviderHealth();
      expect(h).toBe("available");
    });

    it("returns unavailable when fetch throws", async () => {
      process.env.OPENAI_BASE_URL = "https://example.test/v1";
      const fakeFetch = (() => {
        throw new Error("connection refused");
      }) as unknown as typeof fetch;
      const h = await checkProviderHealth(fakeFetch);
      expect(h).toBe("unavailable");
    });

    it("returns unavailable for 5xx", async () => {
      process.env.OPENAI_BASE_URL = "https://example.test/v1";
      const fakeFetch = (async () =>
        new Response(null, { status: 503 })) as unknown as typeof fetch;
      const h = await checkProviderHealth(fakeFetch);
      expect(h).toBe("unavailable");
    });

    it("returns available for 4xx (endpoint responsive)", async () => {
      process.env.OPENAI_BASE_URL = "https://example.test/v1";
      const fakeFetch = (async () =>
        new Response(null, { status: 401 })) as unknown as typeof fetch;
      const h = await checkProviderHealth(fakeFetch);
      expect(h).toBe("available");
    });

    it("caches the result for the TTL window", async () => {
      process.env.OPENAI_BASE_URL = "https://example.test/v1";
      let calls = 0;
      const fakeFetch = (async () => {
        calls++;
        return new Response(null, { status: 200 });
      }) as unknown as typeof fetch;
      await checkProviderHealth(fakeFetch, 1000);
      await checkProviderHealth(fakeFetch, 2000);
      expect(calls).toBe(1);
    });
  });

  describe("withReadOnlyFallback", () => {
    it("runs llmFn when fallback disabled", async () => {
      const out = await withReadOnlyFallback(
        "tool_a",
        async () => "narrated",
        async () => ({ raw: 1 }),
        {},
      );
      expect(out.source).toBe("llm");
      expect(out.data).toBe("narrated");
    });

    it("runs rawFn when fallback enabled and provider unavailable", async () => {
      // Prime cache with unavailable
      _resetHealthCacheForTest();
      const origBase = process.env.OPENAI_BASE_URL;
      process.env.OPENAI_BASE_URL = "https://example.test/v1";
      try {
        const fakeFetch = (async () => {
          throw new Error("offline");
        }) as unknown as typeof fetch;
        await checkProviderHealth(fakeFetch);

        const out = await withReadOnlyFallback(
          "positions",
          async () => "should-not-run",
          async () => ({ positions: [] }),
          { GORDON_LOCAL_FALLBACK: "1" },
        );
        expect(out.source).toBe("fallback");
        expect(out.fallbackReason).toContain("unreachable");
        expect((out.data as { positions: unknown[] }).positions).toEqual([]);
      } finally {
        process.env.OPENAI_BASE_URL = origBase;
      }
    });

    it("runs llmFn when fallback enabled and provider available", async () => {
      _resetHealthCacheForTest();
      const origBase = process.env.OPENAI_BASE_URL;
      process.env.OPENAI_BASE_URL = "https://example.test/v1";
      try {
        const fakeFetch = (async () =>
          new Response(null, { status: 200 })) as unknown as typeof fetch;
        await checkProviderHealth(fakeFetch);

        const out = await withReadOnlyFallback(
          "positions",
          async () => "narrated-positions",
          async () => ({ positions: [] }),
          { GORDON_LOCAL_FALLBACK: "1" },
        );
        expect(out.source).toBe("llm");
        expect(out.data).toBe("narrated-positions");
      } finally {
        process.env.OPENAI_BASE_URL = origBase;
      }
    });
  });
});
