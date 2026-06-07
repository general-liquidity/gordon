import { describe, expect, it } from "bun:test";
import { computeInverseConvexity } from "./inverseConvexity.ts";

describe("computeInverseConvexity", () => {
  it("an inverse long has negative convexity (loses 3× the BTC on a -50% vs +50%)", () => {
    // entry 10000, ±50%: up 1/10000-1/15000 = 3.333e-5; down 1/10000-1/5000 = -1e-4.
    const r = computeInverseConvexity({ entryPrice: 10000, movePct: 0.5, side: "long" });
    expect(r.asymmetryRatio).toBeCloseTo(3.0, 3);
    expect(r.convexity).toBe("negative");
    expect(r.favorablePnlBtc).toBeGreaterThan(0);
    expect(r.adversePnlBtc).toBeLessThan(0);
    expect(r.favorableExit).toBe(15000);
    expect(r.adverseExit).toBe(5000);
  });

  it("an inverse short has positive convexity (the mirror, ratio ≈ 1/3)", () => {
    const r = computeInverseConvexity({ entryPrice: 10000, movePct: 0.5, side: "short" });
    expect(r.asymmetryRatio).toBeCloseTo(1 / 3, 3);
    expect(r.convexity).toBe("positive");
    expect(r.favorablePnlBtc).toBeGreaterThan(0); // short profits on the way down
  });

  it("convexity weakens toward 1 for small moves (locally near-linear)", () => {
    const small = computeInverseConvexity({ entryPrice: 10000, movePct: 0.01, side: "long" });
    expect(small.asymmetryRatio).toBeGreaterThan(1);
    expect(small.asymmetryRatio).toBeLessThan(1.05); // ~1.02 for ±1%
  });

  it("scales BTC PnL by notional", () => {
    const one = computeInverseConvexity({ entryPrice: 10000, movePct: 0.5, side: "long", contractsUsd: 1 });
    const ten = computeInverseConvexity({ entryPrice: 10000, movePct: 0.5, side: "long", contractsUsd: 10 });
    expect(ten.adversePnlBtc).toBeCloseTo(one.adversePnlBtc * 10, 8);
  });

  it("guards invalid input", () => {
    expect(computeInverseConvexity({ entryPrice: 0, movePct: 0.5 }).convexity).toBe("neutral");
    expect(computeInverseConvexity({ entryPrice: 100, movePct: 1.5 }).convexity).toBe("neutral");
  });
});
