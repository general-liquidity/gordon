import { describe, expect, it } from "bun:test";
import { computeDupont } from "./dupont.ts";

describe("computeDupont", () => {
  it("returns neutral on zero equity / assets / revenue", () => {
    expect(
      computeDupont({ revenue: 0, netIncome: 5, totalAssets: 100, equity: 50 }).threeWay,
    ).toBeNull();
    expect(
      computeDupont({ revenue: 100, netIncome: 5, totalAssets: 100, equity: 0 }).reportedRoe,
    ).toBeNull();
  });

  it("3-way factors multiply back to reported ROE", () => {
    // NI 20, Rev 200, Assets 400, Equity 100 → ROE = 20%.
    const r = computeDupont({ revenue: 200, netIncome: 20, totalAssets: 400, equity: 100 });
    expect(r.threeWay).not.toBeNull();
    expect(r.threeWay!.netMargin).toBeCloseTo(0.1, 6); // 20/200
    expect(r.threeWay!.assetTurnover).toBeCloseTo(0.5, 6); // 200/400
    expect(r.threeWay!.equityMultiplier).toBeCloseTo(4, 6); // 400/100
    expect(r.threeWay!.reconstructedRoe).toBeCloseTo(0.2, 6);
    expect(r.reportedRoe).toBeCloseTo(0.2, 6);
    expect(r.reconstructionError).toBeCloseTo(0, 6);
  });

  it("5-way factors multiply back to reported ROE and split tax/interest/operating", () => {
    // Rev 1000, EBIT 200, PreTax 150, NI 120, Assets 800, Equity 400.
    const r = computeDupont({
      revenue: 1000,
      ebit: 200,
      pretaxIncome: 150,
      netIncome: 120,
      totalAssets: 800,
      equity: 400,
    });
    expect(r.fiveWay).not.toBeNull();
    expect(r.fiveWay!.taxBurden).toBeCloseTo(0.8, 6); // 120/150
    expect(r.fiveWay!.interestBurden).toBeCloseTo(0.75, 6); // 150/200
    expect(r.fiveWay!.operatingMargin).toBeCloseTo(0.2, 6); // 200/1000
    expect(r.fiveWay!.assetTurnover).toBeCloseTo(1.25, 6); // 1000/800
    expect(r.fiveWay!.equityMultiplier).toBeCloseTo(2, 6); // 800/400
    expect(r.fiveWay!.reconstructedRoe).toBeCloseTo(0.3, 6); // 120/400
    expect(r.reportedRoe).toBeCloseTo(0.3, 6);
  });

  it("log-attribution shares sum to ~100% when ROE and all factors are positive", () => {
    const r = computeDupont({
      revenue: 1000,
      ebit: 200,
      pretaxIncome: 150,
      netIncome: 120,
      totalAssets: 800,
      equity: 400,
    });
    const shares = r.drivers.map((d) => d.contributionPct);
    expect(shares.every((s) => s !== null)).toBe(true);
    const total = shares.reduce<number>((a, b) => a + (b ?? 0), 0);
    expect(total).toBeCloseTo(100, 1);
    expect(r.drivers.length).toBe(5);
  });

  it("flags negative ROE without producing log attribution", () => {
    const r = computeDupont({ revenue: 200, netIncome: -30, totalAssets: 400, equity: 100 });
    expect(r.reportedRoe).toBeCloseTo(-0.3, 6);
    expect(r.drivers.every((d) => d.contributionPct === null)).toBe(true);
    expect(r.interpretation).toContain("negative");
  });

  it("identifies a leverage-driven ROE", () => {
    // Thin margin, huge leverage: NI 10, Rev 1000, Assets 2000, Equity 100 (20x).
    const r = computeDupont({ revenue: 1000, netIncome: 10, totalAssets: 2000, equity: 100 });
    expect(r.threeWay!.equityMultiplier).toBeCloseTo(20, 6);
    expect(r.interpretation).toContain("Leverage-heavy");
  });

  it("falls back to 3-way attribution when 5-way inputs are absent", () => {
    const r = computeDupont({ revenue: 200, netIncome: 20, totalAssets: 400, equity: 100 });
    expect(r.fiveWay).toBeNull();
    expect(r.drivers.map((d) => d.name)).toEqual([
      "netMargin",
      "assetTurnover",
      "equityMultiplier",
    ]);
  });
});
