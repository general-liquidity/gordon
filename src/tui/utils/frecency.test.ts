import { describe, expect, test } from "bun:test";
import { frecencyScore } from "./frecency.ts";

describe("frecencyScore", () => {
  const now = 1_000_000_000_000;

  test("never-used entries score zero", () => {
    expect(frecencyScore(undefined, now)).toBe(0);
    expect(frecencyScore({ usageCount: 0, lastUsed: 0 }, now)).toBe(0);
  });

  test("more recent use scores higher than older use at equal frequency", () => {
    const recent = frecencyScore({ usageCount: 1, lastUsed: now - 10 * 60_000 }, now); // 10 min
    const old = frecencyScore({ usageCount: 1, lastUsed: now - 10 * 86_400_000 }, now); // 10 days
    expect(recent).toBeGreaterThan(old);
  });

  test("more frequent use scores higher at equal recency", () => {
    const heavy = frecencyScore({ usageCount: 5, lastUsed: now }, now);
    const light = frecencyScore({ usageCount: 1, lastUsed: now }, now);
    expect(heavy).toBeGreaterThan(light);
  });
});
