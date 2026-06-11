import { describe, it, expect } from "bun:test";
import {
  RateLimiter,
  createExchangeRateLimiter,
  getExchangeThrottleSignal,
} from "./rateLimiter.ts";

describe("RateLimiter.getThrottleSignal", () => {
  it("reports not throttled when tokens are available", () => {
    const limiter = new RateLimiter({ maxRequests: 10, windowMs: 1_000, burstLimit: 10 });
    const signal = limiter.getThrottleSignal();
    expect(signal.throttled).toBe(false);
    expect(signal.queueDepth).toBe(0);
    expect(signal.estimatedWaitMs).toBe(0);
  });

  it("reports throttled with a positive wait once the bucket is drained", () => {
    // Slow refill so the drained state is observable.
    const limiter = new RateLimiter({ maxRequests: 1, windowMs: 60_000, burstLimit: 2 });
    expect(limiter.tryAcquire(2)).toBe(true);
    const signal = limiter.getThrottleSignal();
    expect(signal.throttled).toBe(true);
    expect(signal.estimatedWaitMs).toBeGreaterThan(0);
    limiter.dispose();
  });

  it("accounts for queued requests in the wait estimate", async () => {
    const limiter = new RateLimiter({ maxRequests: 1, windowMs: 60_000, burstLimit: 1 });
    expect(limiter.tryAcquire(1)).toBe(true);
    // Queue a request (will not resolve until refill/reset).
    const pending = limiter.acquire(1);
    const signal = limiter.getThrottleSignal();
    expect(signal.throttled).toBe(true);
    expect(signal.queueDepth).toBe(1);
    const drained = limiter.getWaitTime(1);
    expect(signal.estimatedWaitMs).toBeGreaterThanOrEqual(drained);
    limiter.dispose(); // resolves the queued request
    await pending;
  });
});

describe("getExchangeThrottleSignal", () => {
  it("returns null for an exchange with no limiter (never fabricates)", () => {
    expect(getExchangeThrottleSignal("no-such-exchange")).toBeNull();
  });

  it("returns the live signal for an existing limiter", () => {
    const limiter = createExchangeRateLimiter("rl-signal-test");
    const signal = getExchangeThrottleSignal("rl-signal-test");
    expect(signal).not.toBeNull();
    expect(signal!.throttled).toBe(false);
    limiter.dispose();
  });
});
