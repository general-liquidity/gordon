import { describe, it, expect } from "bun:test";
import {
  isKaufmanAdaptiveMaEnabled,
  computeKama,
  kamaToPayload,
  KAUFMAN_ADAPTIVE_MA_FLAG_ENV,
} from "./kaufmanAdaptiveMA.ts";

describe("isKaufmanAdaptiveMaEnabled", () => {
  it("respects the flag", () => {
    expect(isKaufmanAdaptiveMaEnabled({})).toBe(false);
    expect(isKaufmanAdaptiveMaEnabled({ [KAUFMAN_ADAPTIVE_MA_FLAG_ENV]: "1" })).toBe(true);
  });
});

describe("computeKama — edge cases", () => {
  it("short series → NaN currentKama with reason", () => {
    const r = computeKama({ prices: [100, 101, 102] });
    expect(Number.isNaN(r.currentKama)).toBe(true);
    expect(r.reasoning).toContain("need");
  });
});

describe("computeKama — tracking behavior", () => {
  it("follows a clean uptrend fast", () => {
    const prices = Array.from({ length: 50 }, (_, i) => 100 + i);
    const r = computeKama({ prices });
    expect(r.currentKama).toBeGreaterThan(140);
    expect(r.currentKama).toBeLessThan(150);
    expect(r.trend).toBe("up");
  });

  it("flattens out on choppy oscillation", () => {
    const prices = Array.from({ length: 50 }, (_, i) =>
      i % 2 === 0 ? 100 : 105,
    );
    const r = computeKama({ prices });
    // In a perfectly noisy series the smoothing constant stays small,
    // so KAMA hugs a near-constant value rather than oscillating.
    const max = Math.max(...r.kama.filter(Number.isFinite));
    const min = Math.min(...r.kama.filter(Number.isFinite));
    expect(max - min).toBeLessThan(5);
  });

  it("smoothing constant is bounded between slow and fast squared", () => {
    const prices = Array.from({ length: 60 }, (_, i) => 100 + Math.sin(i / 5));
    const r = computeKama({ prices });
    const fastSc = Math.pow(2 / (2 + 1), 2);
    const slowSc = Math.pow(2 / (30 + 1), 2);
    for (const sc of r.smoothingConstants) {
      if (Number.isFinite(sc)) {
        expect(sc).toBeGreaterThanOrEqual(slowSc * 0.99);
        expect(sc).toBeLessThanOrEqual(fastSc * 1.01);
      }
    }
  });
});

describe("computeKama — trend reversal", () => {
  it("detects flip from up to down", () => {
    const up = Array.from({ length: 40 }, (_, i) => 100 + i);
    const down = Array.from({ length: 40 }, (_, i) => 140 - i);
    const r = computeKama({ prices: [...up, ...down] });
    expect(r.trend).toBe("down");
    expect(r.trendChangeIndex).not.toBeNull();
  });
});

describe("kamaToPayload", () => {
  it("emits a stable shape", () => {
    const r = computeKama({ prices: Array.from({ length: 40 }, (_, i) => 100 + i) });
    const p = kamaToPayload(r) as { kind: string; trend: string };
    expect(p.kind).toBe("kaufman_adaptive_ma.computed");
    expect(["up", "down", "flat"]).toContain(p.trend);
  });
});
