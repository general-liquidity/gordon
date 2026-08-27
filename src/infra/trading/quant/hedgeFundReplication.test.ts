import { describe, it, expect } from "bun:test";
import { computeHedgeFundReplication, replicationToPayload } from "./hedgeFundReplication.ts";

describe("computeHedgeFundReplication — edge cases", () => {
  it("insufficient observations → NaN with reason", () => {
    const r = computeHedgeFundReplication({
      targetReturns: [0.01, 0.02],
      factors: [
        { id: "A", returns: [0.01, 0.02] },
        { id: "B", returns: [0.005, 0.01] },
      ],
    });
    expect(Number.isNaN(r.rSquared)).toBe(true);
    expect(r.reasoning).toContain("need T");
  });

  it("mismatched factor length → NaN with reason", () => {
    const r = computeHedgeFundReplication({
      targetReturns: [0.01, 0.02, 0.03, 0.04, 0.05],
      factors: [
        { id: "A", returns: [0.01, 0.02, 0.03, 0.04, 0.05] },
        { id: "B", returns: [0.005, 0.01] },
      ],
    });
    expect(Number.isNaN(r.rSquared)).toBe(true);
    expect(r.reasoning).toContain("does not match");
  });
});

describe("computeHedgeFundReplication — recovery", () => {
  it("recovers the true allocation from a noise-free target", () => {
    const T = 60;
    let s = 1;
    const rand = () => {
      s = (s * 1664525 + 1013904223) >>> 0;
      return s / 0xffffffff - 0.5;
    };
    const a = Array.from({ length: T }, () => rand() * 0.02);
    const b = Array.from({ length: T }, () => rand() * 0.02);
    const c = Array.from({ length: T }, () => rand() * 0.02);
    const target = a.map((_, i) => 0.6 * a[i]! + 0.3 * b[i]! + 0.1 * c[i]!);
    const r = computeHedgeFundReplication({
      targetReturns: target,
      factors: [
        { id: "A", returns: a },
        { id: "B", returns: b },
        { id: "C", returns: c },
      ],
    });
    expect(r.rSquared).toBeGreaterThan(0.999);
    const ids = Object.fromEntries(r.weights.map((w) => [w.id, w.weight]));
    expect(ids.A!).toBeCloseTo(0.6, 5);
    expect(ids.B!).toBeCloseTo(0.3, 5);
    expect(ids.C!).toBeCloseTo(0.1, 5);
  });

  it("normalizeWeights rescales to sum to 1", () => {
    const T = 40;
    let s = 17;
    const rand = () => {
      s = (s * 1664525 + 1013904223) >>> 0;
      return s / 0xffffffff - 0.5;
    };
    const a = Array.from({ length: T }, () => rand() * 0.02);
    const b = Array.from({ length: T }, () => rand() * 0.02);
    const target = a.map((_, i) => 1.5 * a[i]! + 0.5 * b[i]!);
    const r = computeHedgeFundReplication({
      targetReturns: target,
      factors: [
        { id: "A", returns: a },
        { id: "B", returns: b },
      ],
      normalizeWeights: true,
    });
    const total = r.weights.reduce((s, w) => s + w.weight, 0);
    expect(total).toBeCloseTo(1, 5);
  });

  it("collinear factors → singular-matrix reason", () => {
    const T = 30;
    const a = Array.from({ length: T }, (_, i) => i * 0.01);
    const r = computeHedgeFundReplication({
      targetReturns: a,
      factors: [
        { id: "A", returns: a },
        { id: "A-copy", returns: a.map((v) => v * 2) },
      ],
    });
    expect(r.reasoning).toContain("singular");
  });
});

describe("computeHedgeFundReplication — factor inference (MATH-ANCHOR)", () => {
  it("dominant factor has a large t-stat; irrelevant factor small + insignificant", () => {
    // target ≈ 2·f1 + tiny noise; f2 is unrelated. scipy reference on the
    // same construction: t(f1)≈307, t(f2)≈-0.98, p(f2)≈0.33.
    const T = 40;
    let s1 = 7;
    let s2 = 991;
    const gauss = (seed: () => number) => {
      // Box-Muller from two uniforms.
      const u1 = Math.max(seed(), 1e-12);
      const u2 = seed();
      return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
    };
    const r1 = () => {
      s1 = (s1 * 1664525 + 1013904223) >>> 0;
      return s1 / 0x100000000;
    };
    const r2 = () => {
      s2 = (s2 * 22695477 + 1) >>> 0;
      return s2 / 0x100000000;
    };
    const f1 = Array.from({ length: T }, () => gauss(r1));
    const f2 = Array.from({ length: T }, () => gauss(r2));
    const noise = Array.from({ length: T }, () => gauss(r1) * 0.02);
    const target = f1.map((v, i) => 2 * v + noise[i]!);

    const r = computeHedgeFundReplication({
      targetReturns: target,
      factors: [
        { id: "F1", returns: f1 },
        { id: "F2", returns: f2 },
      ],
    });

    const byId = Object.fromEntries(r.weights.map((w) => [w.id, w]));
    expect(r.degreesOfFreedom).toBe(T - 2);
    // Dominant factor: loading ~2, huge t, p ~ 0.
    expect(byId.F1!.weight).toBeCloseTo(2, 1);
    expect(Math.abs(byId.F1!.tStat!)).toBeGreaterThan(20);
    expect(byId.F1!.pValue!).toBeLessThan(0.001);
    // Irrelevant factor: small t, not significant.
    expect(Math.abs(byId.F2!.tStat!)).toBeLessThan(3);
    expect(byId.F2!.pValue!).toBeGreaterThan(0.05);
    // Interpretation flags F1 but not F2.
    expect(r.interpretation).toContain("F1");
    expect(r.interpretation).not.toContain("F2");
  });

  it("inference fields are null when df is insufficient", () => {
    const r = computeHedgeFundReplication({
      targetReturns: [0.01, 0.02],
      factors: [
        { id: "A", returns: [0.01, 0.02] },
        { id: "B", returns: [0.005, 0.01] },
      ],
    });
    expect(r.degreesOfFreedom).toBeNull();
    for (const w of r.weights) {
      expect(w.stdError).toBeNull();
      expect(w.tStat).toBeNull();
      expect(w.pValue).toBeNull();
    }
  });
});

describe("replicationToPayload", () => {
  it("emits a stable shape", () => {
    // Independent factor B so the OLS system is not singular.
    const target = [0.01, 0.02, 0.01, 0.03, 0.02, 0.01, 0.02, 0.01, 0.02, 0.01];
    const a = [0.01, 0.02, 0.01, 0.03, 0.02, 0.01, 0.02, 0.01, 0.02, 0.01];
    const b = [0.02, -0.01, 0.005, 0.012, 0.008, -0.003, 0.02, 0.0, 0.005, 0.011];
    const r = computeHedgeFundReplication({
      targetReturns: target,
      factors: [
        { id: "A", returns: a },
        { id: "B", returns: b },
      ],
    });
    const p = replicationToPayload(r) as { kind: string; rSquared: number };
    expect(p.kind).toBe("hedge_fund_replication.computed");
    expect(typeof p.rSquared).toBe("number");
  });
});
