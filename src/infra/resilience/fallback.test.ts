/**
 * Tests for Resilience Patterns
 */

import { describe, it, expect, beforeEach, mock } from "bun:test";
import {
  withRetry,
  withFallback,
  CircuitBreaker,
  CircuitBreakerOpenError,
  resetAllCircuitBreakers,
  clearFallbackCache,
} from "./fallback.ts";

describe("withRetry", () => {
  it("should return result on first success", async () => {
    const fn = mock(() => Promise.resolve("success"));
    const result = await withRetry(fn, 3, 10);

    expect(result).toBe("success");
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("should retry on failure and succeed", async () => {
    let callCount = 0;
    const fn = mock(() => {
      callCount++;
      if (callCount < 3) {
        return Promise.reject(new Error("fail"));
      }
      return Promise.resolve("success");
    });

    const result = await withRetry(fn, 3, 10);

    expect(result).toBe("success");
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it("should throw after max retries", async () => {
    const fn = mock(() => Promise.reject(new Error("always fails")));

    await expect(withRetry(fn, 2, 10)).rejects.toThrow("always fails");
    expect(fn).toHaveBeenCalledTimes(3); // initial + 2 retries
  });

  it("should apply exponential backoff", async () => {
    let callCount = 0;
    const fn = mock(() => {
      callCount++;
      if (callCount < 2) {
        return Promise.reject(new Error("fail"));
      }
      return Promise.resolve("success");
    });

    const start = Date.now();
    await withRetry(fn, 3, 50);
    const elapsed = Date.now() - start;

    // Should have waited at least 50ms (base delay)
    expect(elapsed).toBeGreaterThanOrEqual(45);
  });
});

describe("CircuitBreaker", () => {
  let breaker: CircuitBreaker;

  beforeEach(() => {
    breaker = new CircuitBreaker(3, 100, 2);
  });

  it("should start in closed state", () => {
    expect(breaker.isClosed()).toBe(true);
    expect(breaker.isOpen()).toBe(false);
  });

  it("should allow requests when closed", async () => {
    const result = await breaker.execute(async () => "success");
    expect(result).toBe("success");
  });

  it("should trip after threshold failures", async () => {
    const failingFn = async () => {
      throw new Error("fail");
    };

    for (let i = 0; i < 3; i++) {
      try {
        await breaker.execute(failingFn);
      } catch {
        // Expected
      }
    }

    expect(breaker.isOpen()).toBe(true);
  });

  it("should fail fast when open", async () => {
    // Trip the breaker
    for (let i = 0; i < 3; i++) {
      try {
        await breaker.execute(async () => {
          throw new Error("fail");
        });
      } catch {
        // Expected
      }
    }

    await expect(
      breaker.execute(async () => "should not run")
    ).rejects.toThrow(CircuitBreakerOpenError);
  });

  it("should enter half-open state after timeout", async () => {
    // Trip the breaker
    for (let i = 0; i < 3; i++) {
      try {
        await breaker.execute(async () => {
          throw new Error("fail");
        });
      } catch {
        // Expected
      }
    }

    expect(breaker.isOpen()).toBe(true);

    // Wait for reset timeout
    await new Promise((resolve) => setTimeout(resolve, 150));

    // Should now be half-open (checked via getState)
    expect(breaker.getState()).toBe("half-open");
  });

  it("should reset after successful half-open attempts", async () => {
    // Trip the breaker
    for (let i = 0; i < 3; i++) {
      try {
        await breaker.execute(async () => {
          throw new Error("fail");
        });
      } catch {
        // Expected
      }
    }

    // Wait for reset timeout
    await new Promise((resolve) => setTimeout(resolve, 150));

    // Successful requests in half-open should close the breaker
    await breaker.execute(async () => "success");
    await breaker.execute(async () => "success");

    expect(breaker.isClosed()).toBe(true);
  });

  it("should return stats correctly", () => {
    const stats = breaker.getStats();

    expect(stats).toHaveProperty("state");
    expect(stats).toHaveProperty("failures");
    expect(stats).toHaveProperty("successes");
    expect(stats).toHaveProperty("totalCalls");
    expect(stats).toHaveProperty("totalFailures");
  });

  it("should reset manually", async () => {
    // Trip the breaker
    for (let i = 0; i < 3; i++) {
      try {
        await breaker.execute(async () => {
          throw new Error("fail");
        });
      } catch {
        // Expected
      }
    }

    expect(breaker.isOpen()).toBe(true);

    breaker.reset();

    expect(breaker.isClosed()).toBe(true);
  });
});

describe("withFallback", () => {
  beforeEach(() => {
    resetAllCircuitBreakers();
    clearFallbackCache();
  });

  it("should return fresh data on success", async () => {
    const fn = mock(() => Promise.resolve("fresh data"));

    const result = await withFallback(fn, "test-key-1", {
      maxRetries: 0,
    });

    expect(result.data).toBe("fresh data");
    expect(result.source).toBe("fresh");
    expect(result.retries).toBe(0);
  });

  it("should cache successful results", async () => {
    const fn = mock(() => Promise.resolve("cached data"));

    // First call
    await withFallback(fn, "test-key-2", { maxRetries: 0 });

    // Second call should use cache
    const result = await withFallback(fn, "test-key-2", { maxRetries: 0 });

    expect(result.data).toBe("cached data");
    expect(result.source).toBe("cache");
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("should use cached data when API fails", async () => {
    // First successful call to populate cache
    let callCount = 0;
    const fn = mock(() => {
      callCount++;
      if (callCount === 1) {
        return Promise.resolve("cached data");
      }
      return Promise.reject(new Error("fail"));
    });

    await withFallback(fn, "test-key-3-cached", {
      maxRetries: 0,
    });

    // Second call fails but should use cached data (fresh or stale)
    const result = await withFallback(fn, "test-key-3-cached", {
      maxRetries: 0,
      useStaleOnError: true,
    });

    // Should return cached data regardless of fresh/stale status
    expect(result.data).toBe("cached data");
    expect(["cache", "stale"]).toContain(result.source);
  });

  it("should use fallback value when all else fails", async () => {
    const fn = mock(() => Promise.reject(new Error("fail")));

    const result = await withFallback(fn, "test-key-4", {
      maxRetries: 0,
      fallbackValue: "fallback",
      useStaleOnError: false,
    });

    expect(result.data).toBe("fallback");
    expect(result.source).toBe("fallback");
  });

  it("should throw when no fallback available", async () => {
    const fn = mock(() => Promise.reject(new Error("no fallback")));

    await expect(
      withFallback(fn, "test-key-5", {
        maxRetries: 0,
        useStaleOnError: false,
      })
    ).rejects.toThrow("no fallback");
  });

  it("should respect circuit breaker", async () => {
    const fn = mock(() => Promise.reject(new Error("fail")));

    // Trip the circuit breaker
    for (let i = 0; i < 5; i++) {
      try {
        await withFallback(fn, "test-key-6", {
          maxRetries: 0,
          circuitBreakerThreshold: 5,
          fallbackValue: "fallback",
        });
      } catch {
        // Expected
      }
    }

    // Next call should show open circuit
    const result = await withFallback(fn, "test-key-6", {
      maxRetries: 0,
      circuitBreakerThreshold: 5,
      fallbackValue: "fallback",
    });

    expect(result.circuitState).toBe("open");
  });
});
