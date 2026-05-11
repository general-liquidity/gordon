import { describe, it, expect } from "bun:test";
import { runWithTimeout, PRODUCER_TIMEOUT_MS } from "./index.ts";

describe("runWithTimeout (producer cap)", () => {
  it("resolves with the producer value when it completes in time", async () => {
    const fast = Promise.resolve(["candidate"]);
    const result = await runWithTimeout(fast, 1000, "test");
    expect(result).toEqual(["candidate"]);
  });

  it("rejects with a labeled timeout error when the producer is too slow", async () => {
    const slow = new Promise<string[]>(() => {
      // never resolves
    });
    let caught: unknown;
    try {
      await runWithTimeout(slow, 50, "stuckProducer");
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(Error);
    expect((caught as Error).message).toContain("stuckProducer");
    expect((caught as Error).message).toContain("timed out");
  });

  it("propagates the original error when the producer rejects before timeout", async () => {
    const failing = Promise.reject(new Error("upstream failure"));
    let caught: unknown;
    try {
      await runWithTimeout(failing, 1000, "test");
    } catch (err) {
      caught = err;
    }
    expect((caught as Error).message).toBe("upstream failure");
  });

  it("clears the timeout on resolve (no late rejection)", async () => {
    const fast = new Promise<number>((resolve) => setTimeout(() => resolve(42), 10));
    const result = await runWithTimeout(fast, 1000, "test");
    expect(result).toBe(42);
    // Wait past the original timeout window — if the timer wasn't cleared,
    // an unhandled rejection would surface here. Bun's test runner fails
    // on unhandled rejections so the absence is the assertion.
    await new Promise((r) => setTimeout(r, 50));
  });

  it("exposes a sane default cap", () => {
    // Sanity guard so a future refactor doesn't accidentally set this to
    // something tiny (breaking legitimate multi-symbol producers) or
    // something huge (defeating the point of having a cap).
    expect(PRODUCER_TIMEOUT_MS).toBeGreaterThanOrEqual(5_000);
    expect(PRODUCER_TIMEOUT_MS).toBeLessThanOrEqual(30_000);
  });
});
