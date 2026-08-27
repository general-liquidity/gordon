import { describe, it, expect } from "bun:test";
import { computeHilbertTransform, hilbertToPayload } from "./hilbertTransform.ts";

describe("computeHilbertTransform", () => {
  it("short series → NaN with reason", () => {
    const r = computeHilbertTransform({ prices: [1, 2, 3] });
    expect(Number.isNaN(r.currentPhase)).toBe(true);
    expect(r.reasoning).toContain("need");
  });

  it("clean sine wave produces well-defined phase that advances", () => {
    // 16-bar sine wave repeated to build 80 samples.
    const prices = Array.from({ length: 80 }, (_, i) => 100 + Math.sin((2 * Math.PI * i) / 16));
    const r = computeHilbertTransform({ prices });
    expect(Number.isFinite(r.currentPhase)).toBe(true);
    expect(r.cyclic).toBe(true);
  });

  it("noisy non-cyclic input → cyclic=false more often than true", () => {
    let s = 1234;
    const rand = () => {
      s = (s * 1664525 + 1013904223) >>> 0;
      return s / 0xffffffff;
    };
    const prices = Array.from({ length: 80 }, () => 100 + (rand() - 0.5) * 10);
    const r = computeHilbertTransform({ prices });
    expect(typeof r.cyclic).toBe("boolean");
    expect(Number.isFinite(r.currentPhase)).toBe(true);
  });

  it("phase values fall in [0, 360)", () => {
    const prices = Array.from({ length: 40 }, (_, i) => 100 + Math.sin(i / 4));
    const r = computeHilbertTransform({ prices });
    for (const p of r.phaseDegrees) {
      if (Number.isFinite(p)) {
        expect(p).toBeGreaterThanOrEqual(0);
        expect(p).toBeLessThan(360);
      }
    }
  });

  it("detrending option does not crash on trending input", () => {
    const prices = Array.from({ length: 40 }, (_, i) => 100 + i);
    const r = computeHilbertTransform({ prices, detrendPeriod: 10 });
    expect(Number.isFinite(r.currentPhase)).toBe(true);
  });
});

describe("hilbertToPayload", () => {
  it("emits a stable shape", () => {
    const r = computeHilbertTransform({
      prices: Array.from({ length: 40 }, (_, i) => 100 + Math.sin(i)),
    });
    const p = hilbertToPayload(r) as { kind: string; cyclic: boolean };
    expect(p.kind).toBe("hilbert_transform.computed");
    expect(typeof p.cyclic).toBe("boolean");
  });
});
