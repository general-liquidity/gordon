import { describe, it, expect } from "bun:test";
import {
  computeDivergenceIndex,
  divergenceIndexToPayload,
} from "./divergenceIndex.ts";

describe("computeDivergenceIndex", () => {
  it("short series → NaN with reason", () => {
    const r = computeDivergenceIndex({ prices: [1, 2, 3, 4] });
    expect(Number.isNaN(r.currentDi)).toBe(true);
    expect(r.reasoning).toContain("need");
  });

  it("noisy rise → DI finite, signal not 'sell'", () => {
    // The DI denominator is the variance of price changes; a perfectly
    // arithmetic series would have zero variance and produce NaN. Add
    // small per-period noise so the variance is well-defined.
    let s = 17;
    const rand = () => {
      s = (s * 1664525 + 1013904223) >>> 0;
      return s / 0xffffffff - 0.5;
    };
    const prices = Array.from({ length: 120 }, (_, i) => 100 + i + rand() * 2);
    const r = computeDivergenceIndex({ prices });
    expect(Number.isFinite(r.currentDi)).toBe(true);
    expect(r.currentSignal).not.toBe("sell");
  });

  it("emits stable DI series for an oscillating input", () => {
    const prices = Array.from({ length: 150 }, (_, i) => 100 + 5 * Math.sin(i / 10));
    const r = computeDivergenceIndex({ prices });
    for (let i = 80; i < r.divergenceIndex.length; i++) {
      expect(Number.isFinite(r.divergenceIndex[i]!)).toBe(true);
    }
  });
});

describe("divergenceIndexToPayload", () => {
  it("emits a stable shape", () => {
    const r = computeDivergenceIndex({
      prices: Array.from({ length: 120 }, (_, i) => 100 + i),
    });
    const p = divergenceIndexToPayload(r) as { kind: string; currentSignal: string };
    expect(p.kind).toBe("divergence_index.computed");
    expect(["buy", "sell", "exit", "none"]).toContain(p.currentSignal);
  });
});
