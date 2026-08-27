import { describe, expect, it } from "bun:test";
import { computeGeneralizedVariance } from "./generalizedVariance.ts";

// Mulberry32 PRNG → independent, equal-variance centered-uniform streams, so the
// correlation construction below hits its target ρ and distinct seeds are ρ≈0.
function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const noise = (seed: number, n: number): number[] => {
  const r = rng(seed);
  return Array.from({ length: n }, () => r() - 0.5); // zero-mean, equal variance
};

/** Build series B correlated to A at target ρ: B = ρ·A + √(1−ρ²)·indep
 *  (valid because A and indep are independent with equal variance). */
function correlated(a: number[], indep: number[], rho: number): number[] {
  return a.map((x, i) => rho * x + Math.sqrt(1 - rho * rho) * indep[i]!);
}

describe("computeGeneralizedVariance", () => {
  it("two uncorrelated series → volume near 1 (det≈1)", () => {
    const a = noise(1, 80);
    const b = noise(2, 80);
    const r = computeGeneralizedVariance({ returns: [a, b], window: 60 });
    // √det of a 2×2 corr matrix = √(1−ρ²); near-zero ρ → near 1.
    expect(r.current!).toBeGreaterThan(0.9);
  });

  it("two near-identical series → volume near 0 (rank collapse)", () => {
    const a = noise(3, 80);
    const b = correlated(a, noise(4, 80), 0.999);
    const r = computeGeneralizedVariance({ returns: [a, b], window: 60 });
    expect(r.current!).toBeLessThan(0.1); // √(1−0.999²) ≈ 0.045
  });

  it("matches √(1−ρ²) for a 2×2 at a known correlation", () => {
    const a = noise(5, 80);
    const b = correlated(a, noise(6, 80), 0.6);
    const r = computeGeneralizedVariance({ returns: [a, b], window: 60 });
    // Empirical ρ won't be exactly 0.6, but volume must sit in a sane band well inside (0,1).
    expect(r.current!).toBeGreaterThan(0.5);
    expect(r.current!).toBeLessThan(0.95);
  });

  it("detects a regime that collapses from diversified to correlated", () => {
    const n = 140;
    const a = noise(7, n);
    const indep = noise(8, n);
    // First half: independent (ρ≈0). Second half: B tracks A (ρ≈1) → volume collapses.
    const b = a.map((x, i) => (i < 70 ? indep[i]! : x));
    const r = computeGeneralizedVariance({ returns: [a, b], window: 40 });
    expect(r.current!).toBeLessThan(0.3); // late window is highly correlated
    expect(["stressed", "crash"]).toContain(r.regime);
    expect(r.trend === "collapsing" || r.volumeZ! < -1).toBe(true);
  });

  it("flags rank collapse: a near-dependency tanks det even with a third diversifier", () => {
    const n = 80;
    const a = noise(9, n);
    const b = correlated(a, noise(10, n), 0.995); // A,B nearly dependent
    const c = noise(11, n); // C independent
    const r = computeGeneralizedVariance({ returns: [a, b, c], window: 60 });
    // det = ∏λ → one tiny eigenvalue (A≈B) drives volume low despite C diversifying.
    expect(r.current!).toBeLessThan(0.2);
  });

  it("is insufficient with <2 series or too little data", () => {
    expect(computeGeneralizedVariance({ returns: [[1, 2, 3]], window: 60 }).regime).toBe(
      "insufficient",
    );
    expect(
      computeGeneralizedVariance({
        returns: [
          [1, 2],
          [3, 4],
        ],
        window: 60,
      }).regime,
    ).toBe("insufficient");
  });
});
