import { describe, expect, it } from "bun:test";
import { computeGeneralizedImpulse } from "./generalizedImpulse.ts";

/**
 * Two cointegrated series sharing a common trend `f`, with an explicit AR(1)
 * spread `s = φ·s + v` (smaller φ → faster mean-reversion). y1 = f + s/2,
 * y2 = f − s/2, so y1 − y2 = s follows AR(1) with coefficient φ.
 */
function buildAR(phi: number, n = 220): { s1: number[]; s2: number[] } {
  let f = 100;
  let s = 1;
  const s1: number[] = [];
  const s2: number[] = [];
  for (let t = 0; t < n; t++) {
    if (t > 0) {
      f += 0.5 * Math.sin(0.3 * t) + 0.4 * Math.cos(0.17 * t); // common trend shock
      s = phi * s + 0.12 * Math.sin(1.7 * t + 0.3); // spread innovation
    }
    s1.push(f + s / 2);
    s2.push(f - s / 2);
  }
  return { s1, s2 };
}

describe("computeGeneralizedImpulse", () => {
  it("the spread re-converges after a shock in a cointegrated system", () => {
    const { s1, s2 } = buildAR(0.5);
    const r = computeGeneralizedImpulse({ series1: s1, series2: s2 });
    expect(r.confidence).toBe("high");
    expect(r.converged1).toBe(true);
    expect(r.converged2).toBe(true);
    expect(r.barsToConverge1).toBeGreaterThan(0);
    expect(r.barsToConverge1).toBeLessThanOrEqual(60);
  });

  it("a slower-mean-reverting spread (higher φ) takes MORE bars to re-converge", () => {
    const fast = computeGeneralizedImpulse({ series1: buildAR(0.5).s1, series2: buildAR(0.5).s2 });
    const slow = computeGeneralizedImpulse({ series1: buildAR(0.9).s1, series2: buildAR(0.9).s2 });
    expect(fast.converged1).toBe(true);
    expect(slow.converged1).toBe(true);
    expect(slow.barsToConverge1!).toBeGreaterThan(fast.barsToConverge1!);
  });

  it("is low-confidence on insufficient data", () => {
    const r = computeGeneralizedImpulse({ series1: [1, 2, 3], series2: [1, 2, 3] });
    expect(r.confidence).toBe("low");
    expect(r.converged1).toBe(false);
  });
});
