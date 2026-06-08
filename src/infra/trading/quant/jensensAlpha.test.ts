import { describe, expect, it } from "bun:test";
import { computeJensensAlpha } from "./jensensAlpha.ts";

// Mulberry32 → reproducible independent centered streams.
function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const noise = (seed: number, n: number, scale = 1): number[] => {
  const r = rng(seed);
  return Array.from({ length: n }, () => (r() - 0.5) * scale);
};

describe("computeJensensAlpha", () => {
  const N = 240;

  it("detects REAL alpha: strong intercept, ~zero factor exposure", () => {
    const factor = noise(1, N, 0.04);
    const indep = noise(2, N, 0.004);
    const y = factor.map((_, i) => 0.005 + indep[i]!); // big drift, independent of factor
    const r = computeJensensAlpha({ returns: y, factors: [factor], factorNames: ["MKT"] });
    expect(r.alpha).toBeCloseTo(0.005, 3);
    expect(r.verdict).toBe("significant_alpha");
    expect(r.alphaPValue).toBeLessThan(0.05);
    expect(Math.abs(r.betas[0]!.coef)).toBeLessThan(0.1); // ~no market loading
  });

  it("calls disguised beta insignificant: pure factor exposure, no intercept", () => {
    // Demean so the TRUE intercept is exactly 0 (raw streams carry a small sample mean = a real alpha).
    const dm = (a: number[]): number[] => { const m = a.reduce((s, x) => s + x, 0) / a.length; return a.map((x) => x - m); };
    const factor = dm(noise(3, N, 0.04));
    const eps = dm(noise(4, N, 0.02));
    const y = factor.map((x, i) => 1.0 * x + eps[i]!); // y = beta·factor, true alpha = 0
    const r = computeJensensAlpha({ returns: y, factors: [factor] });
    expect(Math.abs(r.alpha)).toBeLessThan(0.002);
    expect(r.verdict).toBe("insignificant_alpha");
    expect(r.betas[0]!.coef).toBeCloseTo(1.0, 1);
    expect(r.betas[0]!.pValue).toBeLessThan(0.05); // the beta itself is significant
  });

  it("HAC p-value is more conservative than OLS under autocorrelated residuals", () => {
    const factor = noise(5, N, 0.03);
    // AR(1) autocorrelated residual + a small drift → OLS understates SE.
    const innov = noise(6, N, 0.003);
    const resid: number[] = [];
    let prev = 0;
    for (let i = 0; i < N; i++) { prev = 0.8 * prev + innov[i]!; resid.push(prev); }
    const y = factor.map((_, i) => 0.001 + resid[i]!);
    const r = computeJensensAlpha({ returns: y, factors: [factor] });
    expect(r.alphaPValue).toBeGreaterThanOrEqual(r.alphaPValueOLS); // HAC widens SE → larger p
    expect(Number.isFinite(r.alphaTStat)).toBe(true);
  });

  it("handles multiple factors", () => {
    const f1 = noise(7, N, 0.04);
    const f2 = noise(8, N, 0.04);
    const y = f1.map((x, i) => 0.003 + 0.5 * x + 0.3 * f2[i]! + noise(9, N, 0.002)[i]!);
    const r = computeJensensAlpha({ returns: y, factors: [f1, f2], factorNames: ["MKT", "SMB"] });
    expect(r.betas).toHaveLength(2);
    expect(r.betas[0]!.coef).toBeCloseTo(0.5, 1);
    expect(r.betas[1]!.coef).toBeCloseTo(0.3, 1);
  });

  it("insufficient on too little data or no factors", () => {
    expect(computeJensensAlpha({ returns: [1, 2, 3], factors: [[1, 2, 3]] }).verdict).toBe("insufficient");
    expect(computeJensensAlpha({ returns: new Array(100).fill(0.01), factors: [] }).verdict).toBe("insufficient");
  });
});
