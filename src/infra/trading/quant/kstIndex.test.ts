import { describe, it, expect } from "bun:test";
import { isKstIndexEnabled, computeKst, kstToPayload, KST_INDEX_FLAG_ENV } from "./kstIndex.ts";

describe("isKstIndexEnabled", () => {
  it("respects the flag", () => {
    expect(isKstIndexEnabled({})).toBe(false);
    expect(isKstIndexEnabled({ [KST_INDEX_FLAG_ENV]: "1" })).toBe(true);
  });
});

describe("computeKst", () => {
  it("short series → NaN with reason", () => {
    const r = computeKst({ prices: [1, 2, 3] });
    expect(Number.isNaN(r.currentKst)).toBe(true);
    expect(r.reasoning).toContain("need");
  });

  it("monotone rise produces positive KST eventually", () => {
    const prices = Array.from({ length: 100 }, (_, i) => 100 + i);
    const r = computeKst({ prices });
    expect(r.currentKst).toBeGreaterThan(0);
  });

  it("monotone fall produces negative KST eventually", () => {
    const prices = Array.from({ length: 100 }, (_, i) => 200 - i);
    const r = computeKst({ prices });
    expect(r.currentKst).toBeLessThan(0);
  });

  it("captures a crossover on a trend flip", () => {
    // Multiplicative price moves keep the underlying ROC series symmetric.
    const down = Array.from({ length: 80 }, (_, i) => 200 * Math.pow(0.985, i));
    const up = Array.from({ length: 80 }, (_, i) => down[79]! * Math.pow(1.02, i + 1));
    const r = computeKst({ prices: [...down, ...up] });
    expect(["bullish", "bearish"]).toContain(r.lastCross);
  });
});

describe("kstToPayload", () => {
  it("emits a stable shape", () => {
    const r = computeKst({ prices: Array.from({ length: 100 }, (_, i) => 100 + i) });
    const p = kstToPayload(r) as { kind: string; lastCross: string };
    expect(p.kind).toBe("kst_index.computed");
    expect(["bullish", "bearish", "none"]).toContain(p.lastCross);
  });
});
