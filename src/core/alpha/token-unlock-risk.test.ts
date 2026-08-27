import { describe, expect, test } from "bun:test";
import { computeTokenUnlockRisk } from "./token-unlock-risk.ts";

describe("computeTokenUnlockRisk", () => {
  test("a >5% cliff into investor wallets is high risk", () => {
    const r = computeTokenUnlockRisk({
      events: [{ date: "2026-06-01", amount: 100_000_000, recipient: "investor" }],
      circulatingSupply: 200_000_000,
      now: "2026-01-01",
    });
    expect(r.shape).toBe("cliff");
    expect(r.nextUnlock?.pctOfCirculating).toBeCloseTo(50, 4);
    expect(r.nextUnlock?.flagged).toBe(true);
    expect(r.verdict).toBe("high_risk");
    expect(r.flags.length).toBeGreaterThan(0);
  });

  test("small even monthly drips are low risk (linear)", () => {
    const events = Array.from({ length: 12 }, (_, i) => ({
      date: `2026-${String(i + 1).padStart(2, "0")}-01`,
      amount: 2_000_000, // 1% of circulating each
      recipient: "community" as const,
    }));
    const r = computeTokenUnlockRisk({ events, circulatingSupply: 200_000_000, now: "2026-01-01" });
    expect(r.shape).toBe("linear");
    expect(r.largestUnlockPct).toBeCloseTo(1, 4);
    expect(r.verdict).toBe("low");
    expect(r.flags).toEqual([]);
  });

  test("next unlock respects injected now, and FDV ratio computes", () => {
    const r = computeTokenUnlockRisk({
      events: [
        { date: "2026-01-15", amount: 1_000_000 },
        { date: "2026-06-15", amount: 1_000_000 },
        { date: "2026-12-15", amount: 1_000_000 },
      ],
      circulatingSupply: 200_000_000,
      totalSupply: 1_000_000_000,
      now: "2026-03-01",
    });
    expect(r.nextUnlock?.date).toBe("2026-06-15");
    expect(r.fdvToCirculating).toBeCloseTo(5, 4);
  });

  test("invalid circulating supply is reported, not crashed", () => {
    const r = computeTokenUnlockRisk({
      events: [{ date: "2026-06-01", amount: 1 }],
      circulatingSupply: 0,
    });
    expect(r.summary).toContain("Invalid");
  });
});
