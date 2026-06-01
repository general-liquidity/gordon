import { describe, expect, test } from "bun:test";
import { computeHolderConcentration, type Holder } from "./holder-concentration.ts";

describe("computeHolderConcentration", () => {
  test("insider-dominated supply is high risk", () => {
    const holders: Holder[] = [
      { address: "0xteam", balance: 40, label: "team" },
      { address: "0xvc", balance: 30, label: "investor" },
      ...Array.from({ length: 6 }, (_, i) => ({ address: `0xp${i}`, balance: 5, label: "community" as const })),
    ];
    const r = computeHolderConcentration({ holders, totalSupply: 100 });
    expect(r.top1Pct).toBeCloseTo(40, 4);
    expect(r.insiderControlledPct).toBeCloseTo(70, 4);
    // HHI = 0.4² + 0.3² + 6·0.05² = 0.16 + 0.09 + 0.015 = 0.265
    expect(r.hhi).toBeCloseTo(0.265, 3);
    expect(r.effectiveHolders).toBeCloseTo(3.77, 1);
    expect(r.verdict).toBe("high");
    expect(r.flags.some((f) => /exit-liquidity/.test(f))).toBe(true);
  });

  test("widely dispersed supply is low risk", () => {
    const holders: Holder[] = Array.from({ length: 100 }, (_, i) => ({
      address: `0x${i}`,
      balance: 1,
      label: "community" as const,
    }));
    const r = computeHolderConcentration({ holders, totalSupply: 100 });
    expect(r.top1Pct).toBeCloseTo(1, 4);
    expect(r.hhi).toBeCloseTo(0.01, 4);
    expect(r.effectiveHolders).toBeCloseTo(100, 0);
    expect(r.insiderControlledPct).toBeCloseTo(0, 4);
    expect(r.verdict).toBe("low");
  });

  test("exchange-held supply is tracked separately from insiders", () => {
    const holders: Holder[] = [
      { address: "0xcex", balance: 50, label: "exchange" },
      { address: "0xteam", balance: 10, label: "team" },
      { address: "0xpub", balance: 40, label: "community" },
    ];
    const r = computeHolderConcentration({ holders, totalSupply: 100 });
    expect(r.exchangePct).toBeCloseTo(50, 4);
    expect(r.insiderControlledPct).toBeCloseTo(10, 4);
  });

  test("invalid supply is reported, not crashed", () => {
    const r = computeHolderConcentration({ holders: [{ address: "0x", balance: 1 }], totalSupply: 0 });
    expect(r.summary).toContain("Invalid");
  });
});
