import { describe, it, expect } from "bun:test";
import { computeTrix, trixToPayload } from "./trix.ts";

describe("computeTrix", () => {
  it("short series → NaN with reason", () => {
    const r = computeTrix({ prices: [1, 2, 3, 4, 5] });
    expect(Number.isNaN(r.currentTrix)).toBe(true);
    expect(r.reasoning).toContain("need");
  });

  it("monotone rise produces positive TRIX", () => {
    const prices = Array.from({ length: 100 }, (_, i) => 100 + i);
    const r = computeTrix({ prices });
    expect(r.currentTrix).toBeGreaterThan(0);
  });

  it("monotone fall produces negative TRIX", () => {
    const prices = Array.from({ length: 100 }, (_, i) => 200 - i);
    const r = computeTrix({ prices });
    expect(r.currentTrix).toBeLessThan(0);
  });

  it("flat prices produce TRIX near zero", () => {
    const prices = Array.from({ length: 100 }, () => 100);
    const r = computeTrix({ prices });
    expect(Math.abs(r.currentTrix)).toBeLessThan(1e-6);
  });

  it("identifies a crossover after a trend flip", () => {
    // Use multiplicative growth/decay so TRIX (a rate-of-change indicator)
    // stays well-behaved across the flip rather than asymptoting.
    const down = Array.from({ length: 60 }, (_, i) => 200 * Math.pow(0.98, i));
    const up = Array.from({ length: 60 }, (_, i) => down[59]! * Math.pow(1.02, i + 1));
    const r = computeTrix({ prices: [...down, ...up] });
    expect(["bullish", "bearish"]).toContain(r.lastCross);
  });
});

describe("trixToPayload", () => {
  it("emits a stable shape", () => {
    const r = computeTrix({ prices: Array.from({ length: 50 }, (_, i) => 100 + i) });
    const p = trixToPayload(r) as { kind: string; lastCross: string };
    expect(p.kind).toBe("trix.computed");
    expect(["bullish", "bearish", "none"]).toContain(p.lastCross);
  });
});
