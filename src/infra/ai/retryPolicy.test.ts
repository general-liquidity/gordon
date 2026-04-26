import { describe, it, expect } from "bun:test";
import {
  RETRY_CONSTANTS,
  backoffDelayMs,
  classifyError,
  classifyHttpStatus,
} from "./retryPolicy.ts";

describe("classifyHttpStatus", () => {
  it("classifies 429 as rate_limit (retryable)", () => {
    const d = classifyHttpStatus(429);
    expect(d.classification).toBe("rate_limit");
    expect(d.shouldRetry).toBe(true);
    expect(d.terminal).toBe(false);
  });

  it("classifies 401/403 as auth (terminal)", () => {
    expect(classifyHttpStatus(401).classification).toBe("auth");
    expect(classifyHttpStatus(401).terminal).toBe(true);
    expect(classifyHttpStatus(403).terminal).toBe(true);
  });

  it("classifies 400/422 as bad_request (terminal)", () => {
    expect(classifyHttpStatus(400).terminal).toBe(true);
    expect(classifyHttpStatus(422).terminal).toBe(true);
  });

  it("classifies 5xx as server_error (retryable)", () => {
    expect(classifyHttpStatus(500).classification).toBe("server_error");
    expect(classifyHttpStatus(503).shouldRetry).toBe(true);
  });

  it("classifies 529 as overloaded (retryable, longer backoff)", () => {
    const d = classifyHttpStatus(529);
    expect(d.classification).toBe("overloaded");
    expect(d.recommendedDelayMs).toBeGreaterThanOrEqual(2_000);
  });

  it("uses errorType to override status — overloaded_error wins", () => {
    const d = classifyHttpStatus(503, "overloaded_error");
    expect(d.classification).toBe("overloaded");
  });

  it("detects context_window via errorType regardless of status", () => {
    const d = classifyHttpStatus(400, "context_length_exceeded");
    expect(d.classification).toBe("context_window");
    expect(d.terminal).toBe(true);
  });

  it("detects content_filter / moderation as terminal", () => {
    const d = classifyHttpStatus(400, "content_policy_violation");
    expect(d.classification).toBe("content_filter");
    expect(d.terminal).toBe(true);
  });

  it("detects quota_exceeded as terminal", () => {
    const d = classifyHttpStatus(429, "insufficient_quota");
    expect(d.classification).toBe("quota_exceeded");
    expect(d.terminal).toBe(true);
  });
});

describe("classifyError (object inputs)", () => {
  it("uses statusCode when present (LLMError-shaped)", () => {
    const err = { statusCode: 429, errorType: "rate_limit_error", message: "rate limited" };
    const d = classifyError(err);
    expect(d.classification).toBe("rate_limit");
  });

  it("classifies fetch failure as network", () => {
    const err = new TypeError("fetch failed");
    expect(classifyError(err).classification).toBe("network");
  });

  it("classifies AbortError as timeout", () => {
    const err = Object.assign(new Error("aborted"), { name: "AbortError" });
    expect(classifyError(err).classification).toBe("timeout");
  });

  it("falls back to message-substring heuristics", () => {
    expect(classifyError(new Error("Operation timed out")).classification).toBe("timeout");
    expect(classifyError(new Error("ECONNRESET on stream")).classification).toBe("network");
    expect(classifyError(new Error("upstream is overloaded")).classification).toBe("overloaded");
  });

  it("returns unknown when nothing matches", () => {
    const d = classifyError(new Error("strange unique error"));
    expect(d.classification).toBe("unknown");
  });

  it("handles null / undefined gracefully", () => {
    expect(classifyError(null).classification).toBe("unknown");
    expect(classifyError(undefined).classification).toBe("unknown");
  });
});

describe("backoffDelayMs", () => {
  it("scales exponentially with attempt count", () => {
    const decision = classifyHttpStatus(429); // baseline 2000ms
    const a0 = backoffDelayMs(decision, 0, 0);
    const a1 = backoffDelayMs(decision, 1, 0);
    const a2 = backoffDelayMs(decision, 2, 0);
    expect(a1).toBe(a0 * 2);
    expect(a2).toBe(a0 * 4);
  });

  it("respects RETRY_CONSTANTS.maxDelayMs cap", () => {
    const decision = classifyHttpStatus(429);
    const huge = backoffDelayMs(decision, 20, 0);
    expect(huge).toBeLessThanOrEqual(RETRY_CONSTANTS.maxDelayMs);
  });

  it("applies jitter as a multiplier in [1, 1.2]", () => {
    const decision = classifyHttpStatus(429);
    const noJitter = backoffDelayMs(decision, 0, 0);
    const fullJitter = backoffDelayMs(decision, 0, 0.2);
    expect(fullJitter).toBeGreaterThan(noJitter);
    expect(fullJitter).toBeLessThanOrEqual(Math.round(noJitter * 1.2) + 1);
  });

  it("clamps absurd jitter values into [0,1]", () => {
    const decision = classifyHttpStatus(429);
    expect(() => backoffDelayMs(decision, 0, -5)).not.toThrow();
    expect(() => backoffDelayMs(decision, 0, 5)).not.toThrow();
  });
});
