import { describe, it, expect } from "bun:test";

import {
  isHurstExponentEnabled,
  calculateHurst,
  hurstToPayload,
  HURST_EXPONENT_FLAG_ENV,
} from "./hurstExponent.ts";

function trendingSeries(n: number): number[] {
  // Strongly trending: monotone growth with mild oscillation.
  // R/S analysis sees this as long-range memory (H → 1).
  return Array.from({ length: n }, (_, i) => i + Math.sin(i * 0.4) * 2);
}

function meanRevertingSeries(n: number): number[] {
  const out: number[] = [];
  let level = 0;
  for (let i = 0; i < n; i++) {
    const shock = Math.sin(i * 2.3) * 0.02;
    level = -0.7 * level + shock;
    out.push(level);
  }
  return out;
}

function randomWalkLike(n: number, seed = 1): number[] {
  const out: number[] = [];
  let s = seed;
  for (let i = 0; i < n; i++) {
    s = (s * 9301 + 49297) % 233280;
    const r = s / 233280 - 0.5;
    out.push(r * 0.02);
  }
  return out;
}

describe("isHurstExponentEnabled", () => {
  it("respects the flag", () => {
    expect(isHurstExponentEnabled({})).toBe(false);
    expect(isHurstExponentEnabled({ [HURST_EXPONENT_FLAG_ENV]: "1" })).toBe(true);
  });
});

describe("calculateHurst — small sample handling", () => {
  it("returns 0.5 random_walk for n<16", () => {
    const r = calculateHurst([0.01, -0.01, 0.005]);
    expect(r.hurst).toBe(0.5);
    expect(r.regime).toBe("random_walk");
    expect(r.reliable).toBe(false);
  });

  it("flags reliable=true at n>=64", () => {
    const r = calculateHurst(trendingSeries(120));
    expect(r.reliable).toBe(true);
  });
});

describe("calculateHurst — regime detection", () => {
  it("trending series → H > 0.5", () => {
    const r = calculateHurst(trendingSeries(256));
    expect(r.hurst).toBeGreaterThan(0.5);
    expect(r.regime).toBe("trending");
  });

  it("mean-reverting series → H < 0.5", () => {
    const r = calculateHurst(meanRevertingSeries(256));
    expect(r.hurst).toBeLessThan(0.5);
    expect(r.regime).toBe("mean_reverting");
  });
});

describe("calculateHurst — clamping", () => {
  it("never returns hurst outside [0, 1]", () => {
    for (const series of [trendingSeries(100), meanRevertingSeries(100), randomWalkLike(100)]) {
      const r = calculateHurst(series);
      expect(r.hurst).toBeGreaterThanOrEqual(0);
      expect(r.hurst).toBeLessThanOrEqual(1);
    }
  });
});

describe("hurstToPayload", () => {
  it("emits stable shape", () => {
    const r = calculateHurst(trendingSeries(120));
    const p = hurstToPayload(r) as { kind: string; reliable: boolean };
    expect(p.kind).toBe("hurst_exponent.computed");
    expect(typeof p.reliable).toBe("boolean");
  });
});
