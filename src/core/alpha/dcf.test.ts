import { describe, expect, test } from "bun:test";
import { computeDcf } from "./dcf.ts";

describe("computeDcf — math sanity", () => {
  test("constant FCF + zero terminal growth = perpetuity at base WACC", () => {
    // Single-year explicit period with terminal at zero growth →
    // EV = FCF / WACC (perpetuity formula). 100 / 0.10 = 1000.
    // Discounted back one year: 1000 / 1.10 = 909.09.
    // Plus the year-1 FCF discount: 100 / 1.10 = 90.91.
    // Total EV = 1000. (Math: PV of explicit + PV of TV stabilizes.)
    const r = computeDcf({
      fcfProjections: [100],
      netCash: 0,
      sharesOutstanding: 10,
      base: { wacc: 0.1, terminalGrowthPct: 0 },
    });
    // Year-1 FCF = 100, discounted = 100/1.1 ≈ 90.909
    // TV at end of year 1 = (100 * 1) / (0.10 - 0) = 1000
    // PV TV = 1000 / 1.1 ≈ 909.09
    // EV ≈ 1000
    expect(r.base.enterpriseValue).toBeCloseTo(1000, 0);
    expect(r.base.pricePerShare).toBeCloseTo(100, 0);
  });

  test("higher WACC reduces present value", () => {
    const low = computeDcf({
      fcfProjections: [100, 110, 120],
      netCash: 0,
      sharesOutstanding: 1,
      base: { wacc: 0.08, terminalGrowthPct: 0.02 },
    });
    const high = computeDcf({
      fcfProjections: [100, 110, 120],
      netCash: 0,
      sharesOutstanding: 1,
      base: { wacc: 0.15, terminalGrowthPct: 0.02 },
    });
    expect(high.base.pricePerShare).toBeLessThan(low.base.pricePerShare);
  });

  test("higher terminal growth raises present value", () => {
    const low = computeDcf({
      fcfProjections: [100, 110, 120],
      netCash: 0,
      sharesOutstanding: 1,
      base: { wacc: 0.1, terminalGrowthPct: 0.01 },
    });
    const high = computeDcf({
      fcfProjections: [100, 110, 120],
      netCash: 0,
      sharesOutstanding: 1,
      base: { wacc: 0.1, terminalGrowthPct: 0.04 },
    });
    expect(high.base.pricePerShare).toBeGreaterThan(low.base.pricePerShare);
  });

  test("netCash adds (or subtracts) one-to-one from equity value", () => {
    const noCash = computeDcf({
      fcfProjections: [100],
      netCash: 0,
      sharesOutstanding: 10,
      base: { wacc: 0.1, terminalGrowthPct: 0 },
    });
    const withCash = computeDcf({
      fcfProjections: [100],
      netCash: 200,
      sharesOutstanding: 10,
      base: { wacc: 0.1, terminalGrowthPct: 0 },
    });
    expect(withCash.base.equityValue - noCash.base.equityValue).toBeCloseTo(200, 6);
    expect(withCash.base.pricePerShare - noCash.base.pricePerShare).toBeCloseTo(20, 6);
  });
});

describe("computeDcf — bear / bull cases", () => {
  test("bear case yields lower price than base; bull higher", () => {
    const r = computeDcf({
      fcfProjections: [100, 110, 120, 130, 140],
      netCash: 0,
      sharesOutstanding: 10,
      base: { wacc: 0.1, terminalGrowthPct: 0.025 },
      bear: { wacc: 0.13, terminalGrowthPct: 0.015 },
      bull: { wacc: 0.08, terminalGrowthPct: 0.035 },
    });
    expect(r.bear).not.toBeNull();
    expect(r.bull).not.toBeNull();
    expect(r.bear!.pricePerShare).toBeLessThan(r.base.pricePerShare);
    expect(r.bull!.pricePerShare).toBeGreaterThan(r.base.pricePerShare);
  });

  test("bear/bull omitted → nulls in result, base still computed", () => {
    const r = computeDcf({
      fcfProjections: [100],
      netCash: 0,
      base: { wacc: 0.1, terminalGrowthPct: 0 },
    });
    expect(r.bear).toBeNull();
    expect(r.bull).toBeNull();
  });
});

describe("computeDcf — invariants", () => {
  test("terminalFraction is in [0, 1] for normal inputs", () => {
    const r = computeDcf({
      fcfProjections: [100, 110, 120, 130, 140],
      netCash: 0,
      sharesOutstanding: 1,
      base: { wacc: 0.1, terminalGrowthPct: 0.02 },
    });
    expect(r.base.terminalFraction).toBeGreaterThan(0);
    expect(r.base.terminalFraction).toBeLessThan(1);
  });

  test("interpretation always includes base price + terminal share", () => {
    const r = computeDcf({
      fcfProjections: [100],
      netCash: 0,
      base: { wacc: 0.1, terminalGrowthPct: 0 },
    });
    expect(r.interpretation).toContain("base:");
    expect(r.interpretation).toContain("tv-share:");
  });

  test("sensitivity grid produces multiple cells", () => {
    const r = computeDcf({
      fcfProjections: [100, 110, 120],
      netCash: 0,
      base: { wacc: 0.1, terminalGrowthPct: 0.02 },
    });
    expect(r.sensitivity.length).toBeGreaterThan(10);
  });
});

describe("computeDcf — error handling", () => {
  test("throws when wacc <= terminalGrowthPct", () => {
    expect(() =>
      computeDcf({
        fcfProjections: [100],
        netCash: 0,
        base: { wacc: 0.05, terminalGrowthPct: 0.05 },
      }),
    ).toThrow(/terminalGrowthPct/);
  });

  test("throws when fcfProjections is empty", () => {
    expect(() =>
      computeDcf({
        fcfProjections: [],
        netCash: 0,
        base: { wacc: 0.1, terminalGrowthPct: 0 },
      }),
    ).toThrow(/at least one/);
  });

  test("throws when fcfProjections contains non-finite", () => {
    expect(() =>
      computeDcf({
        fcfProjections: [100, NaN, 120],
        netCash: 0,
        base: { wacc: 0.1, terminalGrowthPct: 0 },
      }),
    ).toThrow(/not finite/);
  });

  test("throws when sharesOutstanding <= 0", () => {
    expect(() =>
      computeDcf({
        fcfProjections: [100],
        netCash: 0,
        sharesOutstanding: 0,
        base: { wacc: 0.1, terminalGrowthPct: 0 },
      }),
    ).toThrow(/sharesOutstanding/);
  });

  test("throws when wacc is non-positive", () => {
    expect(() =>
      computeDcf({
        fcfProjections: [100],
        netCash: 0,
        base: { wacc: -0.05, terminalGrowthPct: -0.1 },
      }),
    ).toThrow(/wacc/);
  });
});
