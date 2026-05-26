import { describe, expect, test } from "bun:test";
import { computeReluctanceScore } from "./reluctance-score.ts";

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

describe("computeReluctanceScore", () => {
  test("fast log within 30 min → low score, bucket fast", () => {
    const t = 1_000_000;
    const r = computeReluctanceScore({
      tradeExecutedAtMs: t,
      journalEntryTimestampsMs: [t + 10 * MINUTE],
      nowMs: t + 24 * HOUR,
    });
    expect(r.bucket).toBe("fast");
    expect(r.reluctanceScore).toBeLessThan(0.2);
    expect(r.latencyMinutes).toBeCloseTo(10, 0);
    expect(r.interpretation).toContain("clean");
  });

  test("moderate log within 2h", () => {
    const t = 1_000_000;
    const r = computeReluctanceScore({
      tradeExecutedAtMs: t,
      journalEntryTimestampsMs: [t + 90 * MINUTE],
      nowMs: t + 24 * HOUR,
    });
    expect(r.bucket).toBe("moderate");
    expect(r.reluctanceScore).toBeGreaterThan(0.2);
    expect(r.reluctanceScore).toBeLessThan(0.5);
  });

  test("slow log between 2h and 24h triggers reluctance warning", () => {
    const t = 1_000_000;
    const r = computeReluctanceScore({
      tradeExecutedAtMs: t,
      journalEntryTimestampsMs: [t + 12 * HOUR],
      nowMs: t + 48 * HOUR,
    });
    expect(r.bucket).toBe("slow");
    expect(r.reluctanceScore).toBeGreaterThan(0.5);
    expect(r.reluctanceScore).toBeLessThan(0.8);
    expect(r.interpretation).toContain("reluctance");
  });

  test("very slow log past 24h scores ≥ 0.8", () => {
    const t = 1_000_000;
    const r = computeReluctanceScore({
      tradeExecutedAtMs: t,
      journalEntryTimestampsMs: [t + 3 * DAY],
      nowMs: t + 10 * DAY,
    });
    expect(r.bucket).toBe("very_slow");
    expect(r.reluctanceScore).toBeGreaterThanOrEqual(0.8);
  });

  test("never logged + recent trade → moderate floor", () => {
    const t = 1_000_000;
    const r = computeReluctanceScore({
      tradeExecutedAtMs: t,
      journalEntryTimestampsMs: [],
      nowMs: t + 5 * MINUTE, // very recent
    });
    expect(r.bucket).toBe("never");
    expect(r.reluctanceScore).toBe(0.5); // floor
    expect(r.latencyMs).toBeNull();
  });

  test("never logged + old trade → near 1.0", () => {
    const t = 1_000_000;
    const r = computeReluctanceScore({
      tradeExecutedAtMs: t,
      journalEntryTimestampsMs: [],
      nowMs: t + 7 * DAY,
    });
    expect(r.bucket).toBe("never");
    expect(r.reluctanceScore).toBeGreaterThanOrEqual(0.95);
  });

  test("uses earliest post-trade entry, not the latest", () => {
    const t = 1_000_000;
    const r = computeReluctanceScore({
      tradeExecutedAtMs: t,
      journalEntryTimestampsMs: [t + 15 * MINUTE, t + 4 * HOUR, t + 10 * HOUR],
      nowMs: t + DAY,
    });
    expect(r.bucket).toBe("fast");
    expect(r.latencyMinutes).toBeCloseTo(15, 0);
  });

  test("ignores pre-trade journal entries", () => {
    // Operator logged context BEFORE the trade (mentalState mirror at
    // create_plan). That's a different signal — pre-trade reflection,
    // not post-trade reluctance. Should NOT count as fast logging.
    const t = 1_000_000;
    const r = computeReluctanceScore({
      tradeExecutedAtMs: t,
      journalEntryTimestampsMs: [t - 10 * MINUTE],
      nowMs: t + 6 * HOUR,
    });
    expect(r.bucket).toBe("never");
  });

  test("filters out non-finite timestamps without throwing", () => {
    const t = 1_000_000;
    const r = computeReluctanceScore({
      tradeExecutedAtMs: t,
      journalEntryTimestampsMs: [NaN, Infinity, t + 5 * MINUTE],
      nowMs: t + DAY,
    });
    expect(r.bucket).toBe("fast");
  });

  test("zero latency yields bucket fast + score 0", () => {
    const t = 1_000_000;
    const r = computeReluctanceScore({
      tradeExecutedAtMs: t,
      journalEntryTimestampsMs: [t],
      nowMs: t + HOUR,
    });
    expect(r.bucket).toBe("fast");
    expect(r.reluctanceScore).toBe(0);
  });
});
